// Workspace and .tlab migration for event/section tournament setup (MIT).

import {
  childSetupSnapshot,
  createId,
  defaultCompetitionProfile,
  defaultEvent,
  INHERITABLE_SETUP_FIELDS,
  normalizeEvent,
  normalizeOrganizerProfile,
  normalizeRegistration,
  normalizeRoundSchedule,
  normalizeSection,
  normalizeSetupSources,
  PROFILE_SETUP_FIELDS,
  profileForSection,
  TOURNAMENT_SETUP_FIELDS
} from './defaults.js';
import { ratingValue } from './ratingPolicy.js';

export const WORKSPACE_SCHEMA_VERSION = 7;
export const EVENT_DOCUMENT_FORMAT = 'tourneylab-event';

const settingsDefaults = {
  backupGenerations: 3,
  defaultFederation: '',
  defaultRatingType: 'standard',
  defaultRatingSource: 'rating',
  activeOrganizerProfileId: '',
  organizerProfiles: []
};

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const valuesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function legacyEventId(section) {
  return section.eventId || `E-${section.id || Math.random().toString(36).slice(2, 9)}`;
}

function eventFromSection(section, id = legacyEventId(section)) {
  return defaultEvent({
    id,
    name: section.name,
    site: section.site,
    federation: section.federation,
    organizer: section.organizer,
    startDate: section.startDate,
    endDate: section.endDate,
    timeControl: section.timeControl,
    rated: section.rated,
    ratingType: section.ratingType,
    ratingSource: section.ratingPolicy?.primary,
    defaultFed: section.defaultFed,
    fideEventCode: section.fideEventCode,
    fideReportCode: section.fideReportCode,
    icon: section.icon,
    publish: section.publish,
    sectionIds: [section.id]
  });
}

function identifierKeys(person = {}) {
  const fideId = String(person.fideId ?? '').trim().toUpperCase();
  const nationalId = String(person.ids?.national ?? '').trim().toUpperCase();
  return [fideId ? `fide:${fideId}` : '', nationalId ? `national:${nationalId}` : ''].filter(Boolean);
}

function mergeRegistrationData(target, source) {
  const fill = ['name', 'rating', 'fideId', 'fed', 'club', 'sex', 'birthDate', 'byear', 'title', 'group', 'type'];
  for (const key of fill) if ((target[key] === '' || target[key] == null || target[key] === 0) && source[key] !== '' && source[key] != null) target[key] = source[key];
  target.ratings = { ...(source.ratings ?? {}), ...(target.ratings ?? {}) };
  target.ids = { ...(source.ids ?? {}), ...(target.ids ?? {}) };
  target.archived = !!(target.archived && source.archived);
  return target;
}

function migrateEventRegistrations(event, sections) {
  const registrations = [];
  const byId = new Map();
  const byIdentifier = new Map();
  const redirects = new Map();

  const addRegistration = (source, preferredId = '') => {
    const normalized = normalizeRegistration({ ...source, id: preferredId || source.id || createId('R') });
    const matched = identifierKeys(normalized).map(key => byIdentifier.get(key)).find(Boolean);
    if (matched) {
      mergeRegistrationData(matched, normalized);
      if (normalized.id !== matched.id) redirects.set(normalized.id, matched.id);
      return matched;
    }
    if (byId.has(normalized.id)) return mergeRegistrationData(byId.get(normalized.id), normalized);
    registrations.push(normalized);
    byId.set(normalized.id, normalized);
    for (const key of identifierKeys(normalized)) byIdentifier.set(key, normalized);
    return normalized;
  };

  for (const registration of event.registrations ?? []) addRegistration(registration, registration.id);

  for (const section of sections) {
    const people = section.type === 'team-swiss' || section.type === 'team-rr'
      ? (section.rosterPlayers ?? [])
      : (section.players ?? []);
    for (const person of people) {
      const redirected = redirects.get(person.registrationId);
      let registration = byId.get(redirected || person.registrationId);
      if (!registration) {
        registration = identifierKeys(person).map(key => byIdentifier.get(key)).find(Boolean);
      }
      if (!registration) registration = addRegistration(person, person.registrationId || createId('R'));
      else mergeRegistrationData(registration, person);
      person.registrationId = registration.id;
    }
  }

  const names = new Map();
  const duplicateCandidates = [];
  const candidateKeys = new Set();
  for (const registration of registrations) {
    const key = String(registration.name ?? '').trim().toLocaleLowerCase();
    if (!key) continue;
    for (const otherId of names.get(key) ?? []) {
      const pair = [otherId, registration.id].sort();
      const pairKey = pair.join('|');
      if (!candidateKeys.has(pairKey)) {
        duplicateCandidates.push(pair);
        candidateKeys.add(pairKey);
      }
    }
    names.set(key, [...(names.get(key) ?? []), registration.id]);
  }

  event.registrations = registrations;
  event.registrationDuplicateCandidates = duplicateCandidates;

  const canonicalById = new Map(registrations.map(registration => [registration.id, registration]));
  for (const section of sections) {
    const people = section.type === 'team-swiss' || section.type === 'team-rr'
      ? (section.rosterPlayers ?? [])
      : (section.players ?? []);
    for (const person of people) {
      const registration = canonicalById.get(person.registrationId);
      if (!registration) continue;
      person.ratings = clone(registration.ratings);
      person.rating = ratingValue(registration, section.ratingPolicy);
    }
  }
}

function migrateSectionSetupSources(event, section, sourceVersion) {
  const started = (section.roundsData?.length ?? 0) > 0;
  const explicit = sourceVersion >= 4 ? section.setupSources : null;
  const sources = {};

  for (const field of INHERITABLE_SETUP_FIELDS) {
    const tournamentValue = field === 'roundSchedule'
      ? event.masterSchedule
      : PROFILE_SETUP_FIELDS.includes(field) ? profileForSection(event, section.type)[field] : event[field];
    const sectionValue = section[field];
    const matchesTournament = sectionValue === '' || sectionValue == null || valuesEqual(sectionValue, tournamentValue);
    const legacyProfileOverride = sourceVersion < 5 && (PROFILE_SETUP_FIELDS.includes(field) || field === 'roundSchedule');
    const explicitSource = explicit?.[field];
    sources[field] = explicitSource === 'section' || explicitSource === 'tournament'
      ? explicitSource
      : started || legacyProfileOverride
        ? 'section'
        : matchesTournament ? 'tournament' : 'section';
    if (sources[field] === 'tournament') section[field] = tournamentValue;
  }

  section.setupSources = normalizeSetupSources(sources);
  section.defaultFed = event.defaultFed || event.federation || '';
  return section;
}

export function migrateWorkspace(input = {}) {
  const source = clone(input) ?? {};
  const sourceVersion = Number(source.schemaVersion ?? 0);
  const sourceEvents = source.events ?? [];
  const eventsWithChildDefaults = new Set(sourceEvents.filter(event => event.childDefaults).map(event => event.id));
  const eventsWithProfiles = new Set(sourceEvents.filter(event => event.competitionProfiles).map(event => event.id));
  const eventsWithMasterSchedule = new Set(sourceEvents.filter(event => event.masterSchedule).map(event => event.id));
  const sections = (source.tournaments ?? []).map(normalizeSection);
  const events = sourceEvents.map(normalizeEvent);
  const byId = new Map(events.map(event => [event.id, event]));

  for (const section of sections) {
    let event = section.eventId ? byId.get(section.eventId) : null;
    if (!event) {
      const eventId = legacyEventId(section);
      event = byId.get(eventId) ?? eventFromSection(section, eventId);
      byId.set(event.id, event);
      if (!events.some(item => item.id === event.id)) events.push(event);
    }
    section.eventId = event.id;
  }

  for (const event of events) {
    const eventSections = sections
      .filter(section => section.eventId === event.id)
      .sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
    event.sectionIds = eventSections.map(section => section.id);
    if (!eventsWithChildDefaults.has(event.id) && eventSections[0]) {
      event.childDefaults = childSetupSnapshot(eventSections[0]);
    }
    if (!eventsWithProfiles.has(event.id) && eventSections[0]) {
      const first = eventSections[0];
      event.competitionProfiles[first.type] = defaultCompetitionProfile(first.type, first);
    }
    if (!eventsWithMasterSchedule.has(event.id) && eventSections[0]) {
      event.masterSchedule = normalizeRoundSchedule(eventSections[0].roundSchedule, eventSections[0].rounds, eventSections[0]);
    }
    for (const section of eventSections) migrateSectionSetupSources(event, section, sourceVersion);
    migrateEventRegistrations(event, eventSections);
  }

  const activeId = sections.some(section => section.id === source.activeId)
    ? source.activeId
    : sections[0]?.id ?? null;
  const activeSection = sections.find(section => section.id === activeId);
  const activeEventId = activeSection?.eventId
    ?? (events.some(event => event.id === source.activeEventId) ? source.activeEventId : events[0]?.id ?? null);

  const organizerProfiles = Array.isArray(source.settings?.organizerProfiles)
    ? source.settings.organizerProfiles.map(normalizeOrganizerProfile)
    : [];
  const requestedProfileId = String(source.settings?.activeOrganizerProfileId ?? '');
  const activeOrganizerProfileId = organizerProfiles.some(profile => profile.id === requestedProfileId)
    ? requestedProfileId
    : organizerProfiles[0]?.id ?? '';

  return {
    ...source,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    events,
    tournaments: sections,
    settings: { ...settingsDefaults, ...(source.settings ?? {}), organizerProfiles, activeOrganizerProfileId },
    activeId,
    activeEventId
  };
}

export function serializeEventDocument(event, sections, activeSectionId = null, sourceVersion = WORKSPACE_SCHEMA_VERSION) {
  const hadChildDefaults = !!event?.childDefaults;
  const normalizedEvent = normalizeEvent(clone(event));
  delete normalizedEvent.archived;
  const normalizedSections = (clone(sections) ?? []).map(section => normalizeSection({
    ...section,
    eventId: normalizedEvent.id
  }));
  for (const section of normalizedSections) migrateSectionSetupSources(normalizedEvent, section, sourceVersion);
  if (!hadChildDefaults && normalizedSections[0]) normalizedEvent.childDefaults = childSetupSnapshot(normalizedSections[0]);
  migrateEventRegistrations(normalizedEvent, normalizedSections);
  normalizedEvent.sectionIds = normalizedSections.map(section => section.id);
  return {
    format: EVENT_DOCUMENT_FORMAT,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    event: normalizedEvent,
    sections: normalizedSections,
    activeSectionId: normalizedSections.some(section => section.id === activeSectionId)
      ? activeSectionId
      : normalizedSections[0]?.id ?? null
  };
}

export function parseTournamentDocument(input) {
  const document = typeof input === 'string' ? JSON.parse(input) : clone(input);
  if (!document || typeof document !== 'object') throw new Error('Invalid TourneyLab document.');

  if (document.format === EVENT_DOCUMENT_FORMAT || (document.event && Array.isArray(document.sections))) {
    return serializeEventDocument(document.event, document.sections, document.activeSectionId, Number(document.schemaVersion ?? 0));
  }

  if (Array.isArray(document.tournaments)) {
    const workspace = migrateWorkspace(document);
    const event = workspace.events.find(item => item.id === workspace.activeEventId) ?? workspace.events[0];
    if (!event) throw new Error('Workspace contains no events.');
    return serializeEventDocument(event, workspace.tournaments.filter(section => section.eventId === event.id), workspace.activeId);
  }

  if (Array.isArray(document.players) && Array.isArray(document.roundsData)) {
    const section = normalizeSection(document);
    const event = eventFromSection(section);
    section.eventId = event.id;
    return serializeEventDocument(event, [section], section.id, 0);
  }

  throw new Error('Not a TourneyLab tournament or event document.');
}
