// TourneyLab data store (MIT). Workspaces contain events and tournament sections.
// Pairing engines continue to receive a section-shaped tournament object.

import {
  childSetupSnapshot as snapshotChildSetup,
  CHILD_SETUP_KEYS,
  createId,
  defaultEvent,
  defaultSection,
  EDITABLE_AFTER_PAIRING_SETUP_FIELDS,
  evaluateAgeEligibility,
  INHERITABLE_SETUP_FIELDS,
  normalizeChildDefaults,
  normalizeEligibility,
  normalizeRegistration,
  normalizeRoundSchedule,
  normalizeSetupSources,
  PROFILE_SETUP_FIELDS,
  profileForSection,
  TOURNAMENT_SETUP_FIELDS
} from './setup/defaults.js';
import { applyRatingPolicy, ratingValue } from './setup/ratingPolicy.js';
import {
  migrateWorkspace,
  parseTournamentDocument,
  serializeEventDocument,
  WORKSPACE_SCHEMA_VERSION
} from './setup/schema.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isTeamSection = section => section?.type === 'team-swiss' || section?.type === 'team-rr';
const identityFields = ['name', 'fideId', 'fed', 'club', 'sex', 'birthDate', 'byear', 'title', 'group', 'type'];
const setupFields = new Set(INHERITABLE_SETUP_FIELDS);
const editableAfterPairing = new Set(EDITABLE_AFTER_PAIRING_SETUP_FIELDS);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const hasStarted = section => (section?.roundsData?.length ?? 0) > 0;

function inheritedSetupValue(event, section, field) {
  if (field === 'roundSchedule') {
    return normalizeRoundSchedule(event.masterSchedule, section.rounds, { ...event, ...section });
  }
  if (PROFILE_SETUP_FIELDS.includes(field)) return clone(profileForSection(event, section.type)[field]);
  return clone(event[field]);
}

function pairingSystemFor(type) {
  if (type === 'team-swiss') return 'fide-c04.6';
  if (type === 'swiss') return 'fide-dutch';
  if (type === 'ko') return 'knockout';
  return 'round-robin';
}

function exactIdentifierKeys(person = {}) {
  const fide = String(person.fideId ?? '').trim().toUpperCase();
  const national = String(person.ids?.national ?? '').trim().toUpperCase();
  return [fide ? `fide:${fide}` : '', national ? `national:${national}` : ''].filter(Boolean);
}

function hasValue(value) {
  return value !== '' && value != null && Number.isFinite(Number(value));
}

function hasInvalidRange(min, max) {
  return hasValue(min) && hasValue(max) && Number(min) > Number(max);
}

function rangesOverlap(aMin, aMax, bMin, bMax) {
  const leftMin = hasValue(aMin) ? Number(aMin) : -Infinity;
  const leftMax = hasValue(aMax) ? Number(aMax) : Infinity;
  const rightMin = hasValue(bMin) ? Number(bMin) : -Infinity;
  const rightMax = hasValue(bMax) ? Number(bMax) : Infinity;
  return leftMin <= rightMax && rightMin <= leftMax;
}

function eligibilityRangesOverlap(left = {}, right = {}) {
  return rangesOverlap(left.ratingMin, left.ratingMax, right.ratingMin, right.ratingMax)
    && rangesOverlap(left.birthYearMin, left.birthYearMax, right.birthYearMin, right.birthYearMax);
}

function estimatedBoardCount(row = {}) {
  return Math.max(1, Math.ceil((Number(row.estimatedParticipants) || 0) / 2));
}

export const store = {
  data: migrateWorkspace({ tournaments: [] }),
  listeners: new Set(),

  async init() {
    const loaded = await window.tl?.loadWorkspace?.();
    const migrated = migrateWorkspace(loaded ?? this.data);
    this.data = migrated;
    if (loaded && JSON.stringify(loaded) !== JSON.stringify(migrated)) {
      await window.tl?.saveWorkspace?.(this.data);
    }
  },
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) fn(); this.persist(); },
  persistTimer: null,
  persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => window.tl?.saveWorkspace?.(this.data), 400);
  },

  get active() { return this.data.tournaments.find(t => t.id === this.data.activeId) ?? null; },
  get activeEvent() {
    const eventId = this.active?.eventId ?? this.data.activeEventId;
    return this.data.events?.find(event => event.id === eventId) ?? null;
  },

  ensureWorkspace() {
    if (!Array.isArray(this.data.events) || this.data.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
      this.data = migrateWorkspace(this.data);
    }
    return this.data;
  },

  childrenForEvent(eventId) {
    return (this.data.tournaments ?? [])
      .filter(section => section.eventId === eventId)
      .sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
  },

  sectionsForEvent(eventId) { return this.childrenForEvent(eventId); },

  eventForSection(section) {
    return this.data.events?.find(event => event.id === section?.eventId) ?? null;
  },

  setTournamentSharedValue(eventId, field, value, { emit = true } = {}) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    event[field] = value;
    if (field === 'defaultFed') {
      for (const section of this.childrenForEvent(eventId)) section.defaultFed = value || event.federation || '';
    } else if (['name', 'federation', 'organizer'].includes(field)) {
      for (const section of this.childrenForEvent(eventId)) section[field] = value;
      if (field === 'federation' && !event.defaultFed) {
        for (const section of this.childrenForEvent(eventId)) section.defaultFed = value;
      }
    }
    if (emit) this.emit();
    return event;
  },

  setTournamentSetupDefault(eventId, field, value, { emit = true } = {}) {
    if (!setupFields.has(field)) throw new Error(`Unsupported tournament setup default: ${field}.`);
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    event[field] = value;
    if (PROFILE_SETUP_FIELDS.includes(field)) {
      for (const profile of Object.values(event.competitionProfiles ?? {})) profile[field] = clone(value);
    }
    for (const section of this.childrenForEvent(eventId)) {
      section.setupSources = normalizeSetupSources(section.setupSources);
      if ((!hasStarted(section) || editableAfterPairing.has(field)) && section.setupSources[field] === 'tournament') {
        section[field] = clone(value);
      }
    }
    if (emit) this.emit();
    return event;
  },

  setTournamentProfileValue(eventId, type, field, value, { emit = true } = {}) {
    if (!PROFILE_SETUP_FIELDS.includes(field)) throw new Error(`Unsupported competition profile field: ${field}.`);
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const profile = event.competitionProfiles?.[type];
    if (!profile) throw new Error('Competition profile not found.');
    profile[field] = clone(value);
    if (field === 'rounds') profile.rounds = Math.max(1, Number(value) || 1);
    if (field === 'rounds') {
      const maxRounds = Math.max(1, ...Object.values(event.competitionProfiles).map(item => Number(item.rounds) || 0));
      event.masterSchedule = normalizeRoundSchedule(event.masterSchedule, maxRounds, event);
    }
    for (const section of this.childrenForEvent(eventId)) {
      if (section.type !== type || (hasStarted(section) && !editableAfterPairing.has(field))) continue;
      section.setupSources = normalizeSetupSources(section.setupSources);
      if (section.setupSources[field] !== 'tournament') continue;
      section[field] = clone(profile[field]);
      if (field === 'rounds') {
        section.finalRound = Math.min(section.finalRound || section.rounds, section.rounds);
        if (section.setupSources.roundSchedule === 'tournament') {
          section.roundSchedule = normalizeRoundSchedule(event.masterSchedule, section.rounds, { ...event, ...section });
        }
      }
    }
    if (emit) this.emit();
    return profile;
  },

  setMasterSchedule(eventId, schedule, { emit = true } = {}) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const maxRounds = Math.max(1, ...Object.values(event.competitionProfiles ?? {}).map(profile => Number(profile.rounds) || 0));
    event.masterSchedule = normalizeRoundSchedule(schedule, Math.max(maxRounds, schedule?.length ?? 0), event);
    for (const section of this.childrenForEvent(eventId)) {
      section.setupSources = normalizeSetupSources(section.setupSources);
      if ((!hasStarted(section) || editableAfterPairing.has('roundSchedule')) && section.setupSources.roundSchedule === 'tournament') {
        section.roundSchedule = normalizeRoundSchedule(event.masterSchedule, section.rounds, { ...event, ...section });
      }
    }
    if (emit) this.emit();
    return event.masterSchedule;
  },

  setSectionSetupValue(sectionId, field, value, { emit = true } = {}) {
    if (!setupFields.has(field)) throw new Error(`Unsupported section setup field: ${field}.`);
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    if (hasStarted(section) && !editableAfterPairing.has(field)) {
      throw new Error('Section setup is locked after pairing starts.');
    }
    section[field] = clone(value);
    section.setupSources = normalizeSetupSources({ ...section.setupSources, [field]: 'section' });
    if (emit) this.emit();
    return section;
  },

  useTournamentSetupDefault(sectionId, field, { emit = true } = {}) {
    if (!setupFields.has(field)) throw new Error(`Unsupported section setup field: ${field}.`);
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    if (hasStarted(section) && !editableAfterPairing.has(field)) {
      throw new Error('Started sections cannot resume tournament-default inheritance.');
    }
    const event = this.eventForSection(section);
    if (!event) throw new Error('Tournament not found.');
    section[field] = inheritedSetupValue(event, section, field);
    section.setupSources = normalizeSetupSources({ ...section.setupSources, [field]: 'tournament' });
    if (emit) this.emit();
    return section;
  },

  freezeInheritedSectionSetup(sectionId, { emit = true } = {}) {
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    const event = this.eventForSection(section);
    if (!event) throw new Error('Tournament not found.');
    section.setupSources = normalizeSetupSources(section.setupSources);
    for (const field of INHERITABLE_SETUP_FIELDS) {
      if (section.setupSources[field] !== 'tournament') continue;
      section[field] = inheritedSetupValue(event, section, field);
    }
    if (emit) this.emit();
    return section;
  },

  sectionSetupSource(section, field) {
    if (!setupFields.has(field)) return 'section';
    if (hasStarted(section) && !editableAfterPairing.has(field)) return 'locked';
    return section?.setupSources?.[field] === 'tournament' ? 'tournament' : 'section';
  },

  resolvedSectionSetup(event, section) {
    if (!section) return section;
    const tournament = event ?? this.eventForSection(section);
    if (!tournament) return section;
    const resolved = {
      ...section,
      name: tournament.name ?? section.name,
      federation: tournament.federation ?? section.federation,
      organizer: tournament.organizer ?? section.organizer,
      defaultFed: tournament.defaultFed || tournament.federation || section.defaultFed || '',
      arbiters: { ...(section.arbiters ?? {}), ...(tournament.arbiters ?? {}) },
      publish: { ...(section.publish ?? {}), ...(tournament.publish ?? {}) }
    };
    for (const field of INHERITABLE_SETUP_FIELDS) {
      resolved[field] = (!hasStarted(section) || editableAfterPairing.has(field)) && section.setupSources?.[field] === 'tournament'
        ? inheritedSetupValue(tournament, section, field)
        : section[field];
    }
    return resolved;
  },

  setActive(id) {
    this.data.activeId = id;
    this.data.activeEventId = this.active?.eventId ?? null;
    this.emit();
  },

  newEvent(eventPartial = {}, sectionPartial = {}) {
    this.ensureWorkspace();
    const settings = this.data.settings ?? {};
    const explicitSectionFields = new Set(Object.keys(sectionPartial));
    const setupProfile = settings.tournamentSetupProfiles?.find(profile => profile.id === settings.defaultTournamentSetupProfileId);
    eventPartial = { ...clone(setupProfile?.event ?? {}), ...eventPartial };
    sectionPartial = { ...clone(setupProfile?.section ?? {}), ...sectionPartial };
    const organizerProfile = settings.organizerProfiles?.find(profile => profile.id === settings.activeOrganizerProfileId) ?? null;
    const event = defaultEvent({
      federation: organizerProfile?.federation || settings.defaultFederation || '',
      defaultFed: organizerProfile?.defaultFed || organizerProfile?.federation || settings.defaultFederation || '',
      organizer: organizerProfile?.organizer || '',
      site: organizerProfile?.site || '',
      arbiters: organizerProfile ? {
        chief: organizerProfile.chiefArbiter || '',
        deputies: organizerProfile.deputyArbiters || '',
        email: organizerProfile.arbiterEmail || ''
      } : undefined,
      ratingType: organizerProfile?.defaultRatingType || settings.defaultRatingType || 'standard',
      ratingSource: organizerProfile?.defaultRatingSource || settings.defaultRatingSource || 'rating',
      listOptions: organizerProfile?.listOptions,
      ...eventPartial
    });
    const sectionType = sectionPartial.type ?? 'swiss';
    for (const field of PROFILE_SETUP_FIELDS) {
      if (explicitSectionFields.has(field)) event.competitionProfiles[sectionType][field] = clone(sectionPartial[field]);
    }
    const section = defaultSection({
      ...profileForSection(event, sectionType),
      eventId: event.id,
      name: event.name,
      sectionName: 'Open',
      site: event.site,
      federation: event.federation,
      organizer: event.organizer,
      startDate: event.startDate,
      endDate: event.endDate,
      timeControl: profileForSection(event, sectionType).timeControl,
      rated: event.rated,
      ratingType: event.ratingType,
      fideEventCode: event.fideEventCode,
      fideReportCode: event.fideReportCode,
      defaultFed: event.defaultFed || event.federation,
      ratingPolicy: {
        primary: event.ratingSource,
        fallback: 'rating',
        unratedValue: 0,
        renumberByResolvedRating: true
      },
      roundSchedule: normalizeRoundSchedule(event.masterSchedule, event.competitionProfiles[sectionType].rounds, event),
      ...sectionPartial,
      setupSources: normalizeSetupSources(Object.fromEntries(INHERITABLE_SETUP_FIELDS.map(field => [
        field,
        !explicitSectionFields.has(field) && setupProfile?.section?.setupSources?.[field]
          ? setupProfile.section.setupSources[field]
          : hasOwn(sectionPartial, field) && !PROFILE_SETUP_FIELDS.includes(field) ? 'section' : 'tournament'
      ])))
    });
    event.childDefaults = snapshotChildSetup(section);
    event.sectionIds = [section.id];
    this.data.events.push(event);
    this.data.tournaments.push(section);
    this.ensureRegistrationsForSection(section, event);
    this.data.activeEventId = event.id;
    this.data.activeId = section.id;
    this.emit();
    return section;
  },

  saveTournamentSetupProfile(event, section, name, useByDefault = false) {
    if (!String(name).trim()) throw new Error('Enter a profile name.');
    const eventKeys = ['federation', 'defaultFed', 'organizer', 'site', 'arbiters', 'officials', 'ratingType', 'ratingSource', 'rated', 'timeControl', 'competitionProfiles', 'listOptions'];
    const sectionKeys = [...new Set([...CHILD_SETUP_KEYS, ...PROFILE_SETUP_FIELDS, 'sectionName', 'setupSources', 'expectedPlayers', 'eligibilityBandId'])].filter(key => key !== 'roundSchedule');
    const pick = (source, keys) => Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, clone(source[key])]));
    const profile = { id: createId('SP'), name: String(name).trim(), event: pick(event, eventKeys), section: pick(section, sectionKeys) };
    profile.event.ageScheme = { ...clone(event.ageScheme ?? {}), cutoffDate: '' };
    // Age cutoffs belong to the new event's dates, not the reusable profile.
    if (profile.section.eligibility) delete profile.section.eligibility.cutoffDate;
    this.data.settings.tournamentSetupProfiles ??= [];
    this.data.settings.tournamentSetupProfiles.push(profile);
    if (useByDefault) this.data.settings.defaultTournamentSetupProfileId = profile.id;
    this.emit();
    return profile;
  },

  applyTournamentSetupProfile(event, section, profileId) {
    const profile = this.data.settings.tournamentSetupProfiles?.find(item => item.id === profileId);
    if (!profile) throw new Error('Setup profile not found.');
    if (this.childrenForEvent(event.id).some(item => item.roundsData?.length)) throw new Error('Profiles can only be applied before pairing starts.');
    const cutoffDate = event.ageScheme?.cutoffDate || (event.startDate ? `${event.startDate.slice(0, 4)}-01-01` : '');
    Object.assign(event, clone(profile.event));
    event.ageScheme.cutoffDate = cutoffDate;
    Object.assign(section, clone(profile.section));
    for (const child of this.childrenForEvent(event.id)) {
      child.federation = event.federation;
      child.organizer = event.organizer;
      child.defaultFed = event.defaultFed;
      this.freezeInheritedSectionSetup(child.id, { emit: false });
    }
    event.childDefaults = snapshotChildSetup(section);
    this.emit();
    return profile;
  },

  // Compatibility entry point for imports and existing callers.
  newTournament(partial = {}) {
    const eventFields = [
      'name', 'site', 'federation', 'organizer', 'startDate', 'endDate',
      'timeControl', 'rated', 'ratingType', 'icon', 'publish',
      'fideEventCode', 'fideReportCode'
    ];
    const eventPartial = Object.fromEntries(
      eventFields.filter(key => partial[key] !== undefined).map(key => [key, partial[key]])
    );
    return this.newEvent(eventPartial, partial);
  },

  addSection(eventId, partial = {}) {
    return this.createChildTournament(eventId, partial);
  },

  duplicateSection(sectionId) {
    const source = this.data.tournaments.find(item => item.id === sectionId);
    if (!source) throw new Error('Section not found.');
    return this.createChildTournament(source.eventId, {
      sourceSectionId: source.id,
      sectionName: `${source.sectionName || source.name || 'Section'} copy`
    });
  },

  childSetupSnapshot(source, options = {}) {
    return snapshotChildSetup(source, options);
  },

  saveChildDefaultsFromChild(sectionId) {
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    const event = this.data.events.find(item => item.id === section.eventId);
    if (!event) throw new Error('Tournament not found.');
    event.childDefaults = this.childSetupSnapshot(section);
    for (const field of PROFILE_SETUP_FIELDS) event.competitionProfiles[section.type][field] = clone(section[field]);
    this.emit();
    return event.childDefaults;
  },

  nextChildCode(eventId) {
    const used = new Set(this.childrenForEvent(eventId).map(child => String(child.sectionCode ?? '').toUpperCase()));
    for (let i = 0; i < 676; i++) {
      const code = i < 26
        ? String.fromCharCode(65 + i)
        : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
      if (!used.has(code)) return code;
    }
    return `S${used.size + 1}`;
  },

  validateChildRows(eventId, rows = []) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const errors = [];
    const warnings = [];
    const existing = this.childrenForEvent(eventId);
    const seenCodes = new Set(existing.map(child => String(child.sectionCode ?? '').trim().toUpperCase()).filter(Boolean));
    const normalizedRows = rows.map((row, index) => {
      const eligibility = normalizeEligibility(row.eligibility ?? {
        ratingMin: row.ratingMin,
        ratingMax: row.ratingMax,
        birthYearMin: row.birthYearMin,
        birthYearMax: row.birthYearMax
      });
      const normalized = {
        ...row,
        sectionName: String(row.sectionName ?? '').trim(),
        sectionCode: String(row.sectionCode ?? '').trim().toUpperCase(),
        startingBoard: Number(row.startingBoard) || 1,
        estimatedParticipants: Math.max(0, Number(row.estimatedParticipants) || 0),
        expectedPlayers: Math.max(0, Number(row.expectedPlayers ?? row.estimatedParticipants) || 0),
        eligibility,
        ratingMin: eligibility.ratingMin,
        ratingMax: eligibility.ratingMax
      };
      const label = normalized.sectionName || `Row ${index + 1}`;
      if (!normalized.sectionName) errors.push(`Row ${index + 1}: section name is required.`);
      if (!normalized.sectionCode) errors.push(`${label}: code is required.`);
      else if (seenCodes.has(normalized.sectionCode)) errors.push(`${label}: duplicate code ${normalized.sectionCode}.`);
      seenCodes.add(normalized.sectionCode);
      if (normalized.startingBoard < 1) errors.push(`${label}: starting board must be at least 1.`);
      if (hasInvalidRange(eligibility.ratingMin, eligibility.ratingMax)) errors.push(`${label}: minimum rating exceeds maximum rating.`);
      if (hasInvalidRange(eligibility.birthYearMin, eligibility.birthYearMax)) errors.push(`${label}: minimum birth year exceeds maximum birth year.`);
      return normalized;
    });

    for (let i = 0; i < normalizedRows.length; i++) {
      for (let j = i + 1; j < normalizedRows.length; j++) {
        const left = normalizedRows[i];
        const right = normalizedRows[j];
        if (eligibilityRangesOverlap(left.eligibility, right.eligibility)) {
          warnings.push(`${left.sectionName || left.sectionCode} and ${right.sectionName || right.sectionCode} have eligibility overlap.`);
        }
        const leftEnd = left.startingBoard + estimatedBoardCount(left) - 1;
        const rightEnd = right.startingBoard + estimatedBoardCount(right) - 1;
        if (left.startingBoard <= rightEnd && right.startingBoard <= leftEnd) {
          warnings.push(`${left.sectionName || left.sectionCode} and ${right.sectionName || right.sectionCode} have an estimated board overlap.`);
        }
      }
      const row = normalizedRows[i];
      for (const child of existing) {
        const childEligibility = normalizeEligibility(child.eligibility ?? { ratingMin: child.ratingMin, ratingMax: child.ratingMax });
        if (eligibilityRangesOverlap(row.eligibility, childEligibility)) {
          warnings.push(`${row.sectionName || row.sectionCode} overlaps the eligibility of existing section ${child.sectionName || child.sectionCode}.`);
        }
        const rowEnd = row.startingBoard + estimatedBoardCount(row) - 1;
        const childStart = Number(child.startingBoard) || 1;
        const childEnd = childStart + Math.max(1, Math.ceil(Math.max(2, child.players?.length ?? 0) / 2)) - 1;
        if (row.startingBoard <= childEnd && childStart <= rowEnd) {
          warnings.push(`${row.sectionName || row.sectionCode} has an estimated board overlap with existing section ${child.sectionName || child.sectionCode}.`);
        }
      }
    }

    return { rows: normalizedRows, errors, warnings };
  },

  buildChildTournament(event, input = {}, sectionOrder = 1) {
    const sourceSection = input.sourceSectionId
      ? this.data.tournaments.find(item => item.id === input.sourceSectionId && item.eventId === event.id)
      : null;
    if (input.sourceSectionId && !sourceSection) throw new Error('Section template not found.');
    const includeSchedule = input.includeSchedule !== false;
    const requestedType = input.type ?? sourceSection?.type ?? event.childDefaults?.type ?? 'swiss';
    const source = sourceSection ?? profileForSection(event, requestedType);
    const setup = this.childSetupSnapshot(source, { includeSchedule });
    const setupSources = {};
    const inheritedValues = {};
    for (const field of INHERITABLE_SETUP_FIELDS) {
      const explicitInput = hasOwn(input, field) && input[field] !== undefined;
      const templateOverride = sourceSection?.setupSources?.[field] === 'section';
      setupSources[field] = explicitInput || templateOverride ? 'section' : 'tournament';
      inheritedValues[field] = explicitInput
        ? clone(input[field])
        : templateOverride ? clone(sourceSection[field]) : inheritedSetupValue(event, { type: requestedType, rounds: input.rounds ?? source.rounds }, field);
    }
    const eligibility = normalizeEligibility(input.eligibility ?? {
      ratingMin: input.ratingMin ?? setup.eligibility?.ratingMin,
      ratingMax: input.ratingMax ?? setup.eligibility?.ratingMax,
      birthYearMin: input.birthYearMin ?? setup.eligibility?.birthYearMin,
      birthYearMax: input.birthYearMax ?? setup.eligibility?.birthYearMax
    });
    const type = requestedType;
    const section = defaultSection({
      ...setup,
      ...input,
      ...inheritedValues,
      id: createId('T'),
      eventId: event.id,
      sectionOrder,
      sectionCode: input.sectionCode || this.nextChildCode(event.id),
      sectionName: input.sectionName || `Section ${sectionOrder}`,
      name: event.name,
      site: inheritedValues.site,
      federation: event.federation,
      organizer: event.organizer,
      startDate: inheritedValues.startDate,
      endDate: inheritedValues.endDate,
      publish: clone(event.publish),
      setupSources: normalizeSetupSources(setupSources),
      type,
      pairingSystem: input.pairingSystem ?? (input.type && input.type !== setup.type ? pairingSystemFor(type) : setup.pairingSystem),
      defaultFed: setup.defaultFed || event.defaultFed || event.federation,
      eligibility,
      ratingMin: eligibility.ratingMin,
      ratingMax: eligibility.ratingMax,
      players: [],
      rosterPlayers: isTeamSection({ type }) ? [] : undefined,
      teams: [],
      forbidden: [],
      roundsData: [],
      currentRound: 0,
      setupCompletedAt: ''
    });
    section.roundSchedule = setupSources.roundSchedule === 'tournament'
      ? normalizeRoundSchedule(event.masterSchedule, section.rounds, { ...event, ...section })
      : normalizeRoundSchedule(section.roundSchedule, section.rounds, { ...event, ...section });
    if (!includeSchedule) section.roundSchedule = normalizeRoundSchedule([], section.rounds, { ...event, ...section });
    return section;
  },

  proposeSectionBoardAllocation(eventId, { sectionIds = null, startBoard = 1, padding = 2 } = {}) {
    const selected = sectionIds ? new Set(sectionIds) : null;
    let nextBoard = Math.max(1, Number(startBoard) || 1);
    return this.childrenForEvent(eventId).filter(section => !selected || selected.has(section.id)).map(section => {
      const teamMatches = Math.max(1, Math.ceil(Math.max(2, section.teams?.length ?? 0) / 2));
      const boardCount = isTeamSection(section)
        ? teamMatches * Math.max(1, Number(section.boardsPerMatch) || 1)
        : Math.max(1, Math.ceil(Math.max(2, section.players?.length ?? 0, Number(section.expectedPlayers) || 0) / 2));
      const proposal = {
        sectionId: section.id,
        sectionName: section.sectionName || section.sectionCode || 'Section',
        currentBoard: Number(section.startingBoard) || 1,
        startingBoard: nextBoard,
        endingBoard: nextBoard + boardCount - 1,
        boardCount,
        started: hasStarted(section)
      };
      nextBoard = proposal.endingBoard + Math.max(0, Number(padding) || 0) + 1;
      return proposal;
    });
  },

  applySectionBoardAllocation(eventId, proposals = []) {
    const byId = new Map(this.childrenForEvent(eventId).map(section => [section.id, section]));
    for (const proposal of proposals) {
      const section = byId.get(proposal.sectionId);
      if (!section || hasStarted(section)) continue;
      section.startingBoard = Math.max(1, Number(proposal.startingBoard) || 1);
    }
    this.emit();
    return proposals.filter(proposal => !proposal.started);
  },

  createChildTournament(eventId, input = {}) {
    this.ensureWorkspace();
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const existing = this.childrenForEvent(eventId);
    const prepared = {
      ...input,
      sectionName: input.sectionName || `Section ${existing.length + 1}`,
      sectionCode: input.sectionCode || this.nextChildCode(eventId)
    };
    const validation = this.validateChildRows(eventId, [prepared]);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const section = this.buildChildTournament(event, validation.rows[0], existing.length + 1);
    this.data.tournaments.push(section);
    event.sectionIds = [...existing.map(item => item.id), section.id];

    this.data.activeEventId = eventId;
    this.data.activeId = section.id;
    this.emit();
    return section;
  },

  createChildTournaments(eventId, rows = []) {
    this.ensureWorkspace();
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    if (!rows.length) throw new Error('Add at least one section.');
    const validation = this.validateChildRows(eventId, rows);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const existing = this.childrenForEvent(eventId);
    const created = validation.rows.map((row, index) => this.buildChildTournament(event, row, existing.length + index + 1));
    this.data.tournaments.push(...created);
    event.sectionIds = [...existing.map(item => item.id), ...created.map(item => item.id)];
    this.data.activeEventId = eventId;
    this.data.activeId = created[0]?.id ?? this.data.activeId;
    this.emit();
    return created;
  },

  deleteSection(id) {
    const section = this.data.tournaments.find(item => item.id === id);
    if (!section) return;
    const event = this.data.events.find(item => item.id === section.eventId);
    this.data.tournaments = this.data.tournaments.filter(item => item.id !== id);
    if (event) event.sectionIds = event.sectionIds.filter(sectionId => sectionId !== id);
    if (this.data.activeId === id) {
      const next = this.childrenForEvent(section.eventId)[0] ?? this.data.tournaments[0] ?? null;
      this.data.activeId = next?.id ?? null;
      this.data.activeEventId = next?.eventId ?? event?.id ?? null;
    }
    this.emit();
  },

  deleteTournament(id) { this.deleteSection(id); },

  archiveEvent(id) {
    const event = this.data.events.find(item => item.id === id);
    if (!event || event.archived) return event ?? null;
    const wasActive = this.activeEvent?.id === id || this.data.activeEventId === id;
    event.archived = true;
    if (wasActive) {
      const nextEvent = this.data.events.find(item => !item.archived) ?? null;
      const nextSection = nextEvent ? this.childrenForEvent(nextEvent.id)[0] ?? null : null;
      this.data.activeEventId = nextEvent?.id ?? null;
      this.data.activeId = nextSection?.id ?? null;
    }
    this.emit();
    return event;
  },

  restoreEvent(id) {
    const event = this.data.events.find(item => item.id === id);
    if (!event || !event.archived) return event ?? null;
    event.archived = false;
    this.emit();
    return event;
  },

  deleteEvent(id) {
    const sectionIds = new Set(this.sectionsForEvent(id).map(section => section.id));
    this.data.events = this.data.events.filter(event => event.id !== id);
    this.data.tournaments = this.data.tournaments.filter(section => !sectionIds.has(section.id));
    if (sectionIds.has(this.data.activeId)) {
      const nextEvent = this.data.events.find(event => !event.archived) ?? null;
      const nextSection = nextEvent ? this.childrenForEvent(nextEvent.id)[0] ?? null : null;
      this.data.activeId = nextSection?.id ?? null;
      this.data.activeEventId = nextEvent?.id ?? null;
    }
    this.emit();
  },

  eventDocument(eventId = this.activeEvent?.id) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    return serializeEventDocument(event, this.sectionsForEvent(eventId), this.data.activeId);
  },

  importDocument(input) {
    this.ensureWorkspace();
    const parsed = parseTournamentDocument(input);
    const event = defaultEvent({ ...parsed.event, id: createId('E') });
    const sectionIdMap = new Map();
    const sections = parsed.sections.map((source, index) => {
      const id = createId('T');
      sectionIdMap.set(source.id, id);
      return defaultSection({ ...source, id, eventId: event.id, sectionOrder: index + 1 });
    });
    event.sectionIds = sections.map(section => section.id);
    this.data.events.push(event);
    this.data.tournaments.push(...sections);
    for (const section of sections) this.ensureRegistrationsForSection(section, event);
    this.data.activeEventId = event.id;
    this.data.activeId = sectionIdMap.get(parsed.activeSectionId) ?? sections[0]?.id ?? null;
    this.emit();
    return this.active;
  },

  syncEventMetadata(event) {
    const shared = [
      'name', 'site', 'federation', 'organizer', 'startDate', 'endDate',
      'publish', 'arbiters'
    ];
    for (const section of this.sectionsForEvent(event.id)) {
      for (const key of shared) {
        section[key] = key === 'publish' || key === 'arbiters' ? { ...(event[key] ?? {}) } : event[key];
      }
    }
    this.emit();
  },

  registrationForPerson(event, person) {
    if (!event) return null;
    const direct = event.registrations.find(registration => registration.id === person.registrationId);
    if (direct) return direct;
    const keys = exactIdentifierKeys(person);
    return event.registrations.find(registration => exactIdentifierKeys(registration).some(key => keys.includes(key))) ?? null;
  },

  ensureRegistrationsForSection(section, event = this.data.events.find(item => item.id === section.eventId)) {
    if (!event) return;
    event.registrations ??= [];
    const people = isTeamSection(section) ? (section.rosterPlayers ?? []) : (section.players ?? []);
    for (const person of people) {
      let registration = this.registrationForPerson(event, person);
      if (!registration) {
        registration = normalizeRegistration({ ...person, id: person.registrationId || createId('R') });
        event.registrations.push(registration);
      }
      person.registrationId = registration.id;
    }
    this.refreshRegistrationDuplicateCandidates(event);
  },

  refreshRegistrationDuplicateCandidates(event) {
    const byName = new Map();
    const candidates = [];
    for (const registration of event.registrations ?? []) {
      const key = String(registration.name ?? '').trim().toLocaleLowerCase();
      if (!key) continue;
      for (const other of byName.get(key) ?? []) candidates.push([other, registration.id].sort());
      byName.set(key, [...(byName.get(key) ?? []), registration.id]);
    }
    event.registrationDuplicateCandidates = candidates;
    return candidates;
  },

  registerPlayer(eventId, partial = {}, options = {}) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const identifierKeys = exactIdentifierKeys(partial);
    const exactMatch = identifierKeys.length
      ? event.registrations.find(item => exactIdentifierKeys(item).some(key => identifierKeys.includes(key)))
      : null;
    if (exactMatch) {
      return this.updateRegistration(eventId, exactMatch.id, partial, options);
    }
    const registration = normalizeRegistration({
      fed: event.defaultFed || event.federation || '',
      ...partial,
      id: partial.id || createId('R')
    });
    if (event.registrations.some(item => item.id === registration.id)) throw new Error('Registration ID already exists.');
    event.registrations.push(registration);
    this.refreshRegistrationDuplicateCandidates(event);
    if (options.emit !== false) this.emit();
    return registration;
  },

  updateRegistration(eventId, registrationId, patch = {}, options = {}) {
    const event = this.data.events.find(item => item.id === eventId);
    const registration = event?.registrations?.find(item => item.id === registrationId);
    if (!registration) throw new Error('Registration not found.');
    const previousRatings = registration.ratings ?? {};
    const previousIds = registration.ids ?? {};
    Object.assign(registration, patch);
    if (patch.ratings) registration.ratings = { ...previousRatings, ...patch.ratings };
    if (patch.ids) registration.ids = { ...previousIds, ...patch.ids };
    registration.rating = Number(registration.rating) || 0;
    if (patch.birthDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(registration.birthDate ?? ''))) {
      registration.byear = Number(registration.birthDate.slice(0, 4));
    }

    for (const section of this.childrenForEvent(eventId)) {
      const pool = isTeamSection(section) ? (section.rosterPlayers ?? []) : (section.players ?? []);
      for (const person of pool.filter(item => item.registrationId === registrationId)) {
        for (const key of identityFields) person[key] = clone(registration[key]);
        person.ids = clone(registration.ids);
        person.ratings = clone(registration.ratings);
        person.rating = ratingValue(registration, section.ratingPolicy);
      }
      this.applyAgeGroups(section);
    }
    this.refreshRegistrationDuplicateCandidates(event);
    if (options.emit !== false) this.emit();
    return registration;
  },

  archiveRegistration(eventId, registrationId, options = {}) {
    return this.updateRegistration(eventId, registrationId, { archived: true }, options);
  },

  deleteRegistration(eventId, registrationId) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const referenced = this.childrenForEvent(eventId).filter(section => {
      const pool = isTeamSection(section) ? (section.rosterPlayers ?? []) : (section.players ?? []);
      return pool.some(person => person.registrationId === registrationId);
    });
    if (referenced.some(section => section.roundsData?.length || section.currentRound)) {
      this.archiveRegistration(eventId, registrationId);
      throw new Error('Registration is referenced by a started section and was archived instead.');
    }
    for (const section of referenced) this.unassignRegistration(section.id, registrationId, { emit: false });
    event.registrations = event.registrations.filter(item => item.id !== registrationId);
    this.refreshRegistrationDuplicateCandidates(event);
    this.emit();
  },

  mergeRegistrations(eventId, primaryId, duplicateId) {
    const event = this.data.events.find(item => item.id === eventId);
    const primary = event?.registrations?.find(item => item.id === primaryId);
    const duplicate = event?.registrations?.find(item => item.id === duplicateId);
    if (!primary || !duplicate || primaryId === duplicateId) throw new Error('Choose two different registrations.');
    for (const section of this.childrenForEvent(eventId)) {
      const pool = isTeamSection(section) ? (section.rosterPlayers ?? []) : (section.players ?? []);
      if (pool.some(person => person.registrationId === primaryId) && pool.some(person => person.registrationId === duplicateId)) {
        throw new Error('Both registrations are assigned to the same section. Unassign one before merging.');
      }
    }
    const merged = {
      ...duplicate,
      ...primary,
      ratings: { ...(duplicate.ratings ?? {}), ...(primary.ratings ?? {}) },
      ids: { ...(duplicate.ids ?? {}), ...(primary.ids ?? {}) },
      id: primaryId
    };
    Object.assign(primary, merged);
    for (const section of this.childrenForEvent(eventId)) {
      for (const person of [...(section.players ?? []), ...(section.rosterPlayers ?? [])]) {
        if (person.registrationId === duplicateId) person.registrationId = primaryId;
      }
    }
    event.registrations = event.registrations.filter(item => item.id !== duplicateId);
    this.updateRegistration(eventId, primaryId, primary, { emit: false });
    this.refreshRegistrationDuplicateCandidates(event);
    this.emit();
    return primary;
  },

  registrationEligibility(section, registration) {
    const eligibility = normalizeEligibility(section.eligibility ?? {
      ratingMin: section.ratingMin,
      ratingMax: section.ratingMax
    });
    const resolvedRating = ratingValue(registration, section.ratingPolicy);
    const birthYear = Number(registration.byear) || 0;
    const reasons = [];
    if (hasValue(eligibility.ratingMin) && resolvedRating < Number(eligibility.ratingMin)) reasons.push('below minimum rating');
    if (hasValue(eligibility.ratingMax) && resolvedRating > Number(eligibility.ratingMax)) reasons.push('above maximum rating');
    if ((hasValue(eligibility.birthYearMin) || hasValue(eligibility.birthYearMax)) && !birthYear) reasons.push('birth year required');
    if (birthYear && hasValue(eligibility.birthYearMin) && birthYear < Number(eligibility.birthYearMin)) reasons.push('before minimum birth year');
    if (birthYear && hasValue(eligibility.birthYearMax) && birthYear > Number(eligibility.birthYearMax)) reasons.push('after maximum birth year');
    const event = this.eventForSection(section);
    const band = event?.ageScheme?.bands?.find(item => item.id === section.eligibilityBandId);
    const age = band ? evaluateAgeEligibility(registration, band, event.ageScheme.cutoffDate) : null;
    if (age?.status === 'ineligible') reasons.push(age.reason);
    if (age?.status === 'review') reasons.push(age.reason);
    return {
      eligible: reasons.length === 0,
      review: age?.status === 'review',
      ageStatus: age?.status ?? 'not-configured',
      resolvedRating,
      reasons
    };
  },

  suggestAssignments(eventId, childIds = []) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const requested = new Set(childIds.length ? childIds : this.childrenForEvent(eventId).map(child => child.id));
    const children = this.childrenForEvent(eventId).filter(child => requested.has(child.id));
    return {
      suggestions: (event.registrations ?? []).filter(registration => !registration.archived).map(registration => {
        const evaluations = Object.fromEntries(children.map(child => [child.id, this.registrationEligibility(child, registration)]));
        const eligible = children.filter(child => evaluations[child.id].eligible);
        const ageLinked = eligible.filter(child => child.eligibilityBandId);
        const youngest = ageLinked.sort((left, right) => {
          const leftBand = event.ageScheme?.bands?.find(band => band.id === left.eligibilityBandId);
          const rightBand = event.ageScheme?.bands?.find(band => band.id === right.eligibilityBandId);
          return (Number(leftBand?.maxAge) || Infinity) - (Number(rightBand?.maxAge) || Infinity);
        })[0];
        return {
          registrationId: registration.id,
          childIds: youngest ? [youngest.id] : eligible.map(child => child.id),
          evaluations
        };
      }),
      childIds: children.map(child => child.id)
    };
  },

  assignRegistration(sectionId, registrationId, childData = {}, options = {}) {
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    const event = this.data.events.find(item => item.id === section.eventId);
    const registration = event?.registrations?.find(item => item.id === registrationId);
    if (!registration) throw new Error('Registration not found.');
    if (registration.archived) throw new Error('Archived registrations cannot be assigned.');
    const pool = isTeamSection(section)
      ? (section.rosterPlayers ??= [])
      : section.players;
    if (pool.some(person => person.registrationId === registrationId)) throw new Error('Registration is already assigned to this section.');
    const assignedElsewhere = this.childrenForEvent(section.eventId).some(sibling => {
      if (sibling.id === section.id) return false;
      const siblingPool = isTeamSection(sibling) ? (sibling.rosterPlayers ?? []) : (sibling.players ?? []);
      return siblingPool.some(person => person.registrationId === registrationId);
    });
    if (assignedElsewhere) throw new Error('Registration is already assigned to another section.');
    const evaluation = this.registrationEligibility(section, registration);
    if (!evaluation.eligible && section.eligibilityBandId && !options.eligibilityOverrideReason) {
      throw new Error(`Eligibility review required: ${evaluation.reasons.join(', ')}.`);
    }
    if (section.expectedPlayers > 0 && pool.length >= section.expectedPlayers && !options.allowOverCapacity) {
      throw new Error(`Section target capacity of ${section.expectedPlayers} would be exceeded.`);
    }
    if (!evaluation.eligible && options.eligibilityOverrideReason) {
      section.eligibilityOverrides ??= [];
      section.eligibilityOverrides.push({
        registrationId,
        sectionId: section.id,
        cutoffDate: this.eventForSection(section)?.ageScheme?.cutoffDate ?? '',
        reason: String(options.eligibilityOverrideReason).trim(),
        createdAt: new Date().toISOString()
      });
    }
    const player = this.playerDefaults(section, {
      id: childData.playerId || createId('P'),
      no: childData.no ?? pool.length + 1,
      registrationId,
      ...Object.fromEntries(identityFields.map(key => [key, clone(registration[key])])),
      ratings: clone(registration.ratings),
      ids: clone(registration.ids),
      rating: ratingValue(registration, section.ratingPolicy)
    });
    pool.push(player);

    if (isTeamSection(section) && childData.teamPlayerId) {
      let team = section.teams.find(item => item.playerId === childData.teamPlayerId);
      if (!team) {
        team = { id: createId('TM'), playerId: childData.teamPlayerId, members: [] };
        section.teams.push(team);
      }
      team.members ??= [];
      team.members.push({
        rosterId: player.id,
        board: Number(childData.board) || team.members.length + 1,
        reserve: !!childData.reserve
      });
    }
    this.applyAgeGroups(section);
    if (options.emit !== false) this.emit();
    return player;
  },

  changeSectionFormat(sectionId, type, { confirmReset = false, emit = true } = {}) {
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    if (hasStarted(section)) throw new Error('Started sections cannot change format.');
    if (!profileForSection(this.eventForSection(section), type)) throw new Error('Competition profile not found.');
    const incompatible = PROFILE_SETUP_FIELDS.filter(field => section.setupSources?.[field] === 'section' && field !== 'timeControl' && field !== 'ratingType' && field !== 'rated');
    if (incompatible.length && !confirmReset) return { changed: false, incompatible };
    const event = this.eventForSection(section);
    section.type = type;
    section.setupSources = normalizeSetupSources(section.setupSources);
    for (const field of PROFILE_SETUP_FIELDS) {
      if (['timeControl', 'ratingType', 'rated'].includes(field) && section.setupSources[field] === 'section') continue;
      section.setupSources[field] = 'tournament';
      section[field] = inheritedSetupValue(event, section, field);
    }
    if (section.setupSources.roundSchedule === 'tournament') {
      section.roundSchedule = inheritedSetupValue(event, section, 'roundSchedule');
    }
    section.finalRound = Math.min(section.finalRound || section.rounds, section.rounds);
    if (emit) this.emit();
    return { changed: true, incompatible };
  },

  unassignRegistration(sectionId, registrationId, options = {}) {
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    const pool = isTeamSection(section) ? (section.rosterPlayers ??= []) : section.players;
    const person = pool.find(item => item.registrationId === registrationId);
    if (!person) throw new Error('Registration is not assigned to this section.');
    let action;
    if (section.roundsData?.length || section.currentRound) {
      person.withdrawn = true;
      person.active = false;
      action = 'withdrawn';
    } else {
      const index = pool.indexOf(person);
      pool.splice(index, 1);
      for (const team of section.teams ?? []) team.members = (team.members ?? []).filter(member => member.rosterId !== person.id);
      action = 'removed';
    }
    if (options.emit !== false) this.emit();
    return { action, person };
  },

  reinstateRegistration(sectionId, registrationId, options = {}) {
    const section = this.data.tournaments.find(item => item.id === sectionId);
    if (!section) throw new Error('Section not found.');
    const pool = isTeamSection(section) ? (section.rosterPlayers ??= []) : section.players;
    const person = pool.find(item => item.registrationId === registrationId);
    if (!person) throw new Error('Registration is not assigned to this section.');
    if (!person.withdrawn) throw new Error('Registration is not withdrawn from this section.');
    person.withdrawn = false;
    person.active = true;
    if (options.emit !== false) this.emit();
    return person;
  },

  setRegistrationSection(eventId, registrationId, sectionId = '', options = {}) {
    const event = this.data.events.find(item => item.id === eventId);
    if (!event) throw new Error('Tournament not found.');
    const registration = event.registrations?.find(item => item.id === registrationId);
    if (!registration) throw new Error('Registration not found.');
    const sections = this.childrenForEvent(eventId);
    const target = sectionId ? sections.find(section => section.id === sectionId) : null;
    if (sectionId && !target) throw new Error('Section not found.');

    const assignments = sections.map(section => {
      const pool = isTeamSection(section) ? (section.rosterPlayers ?? []) : (section.players ?? []);
      return { section, person: pool.find(item => item.registrationId === registrationId) ?? null };
    }).filter(item => item.person);
    const changing = assignments.filter(item => item.section.id !== sectionId);
    if (changing.some(item => hasStarted(item.section))) {
      throw new Error('Section assignment is locked after pairing has started.');
    }
    if (target && registration.archived) throw new Error('Archived registrations cannot be assigned.');

    const currentTarget = assignments.find(item => item.section.id === sectionId)?.person ?? null;
    if (!changing.length && (!!currentTarget === !!target)) return { section: target, person: currentTarget };

    if (target && !currentTarget) {
      const evaluation = this.registrationEligibility(target, registration);
      if (!evaluation.eligible && target.eligibilityBandId && !options.eligibilityOverrideReason) {
        throw new Error(`Eligibility review required: ${evaluation.reasons.join(', ')}.`);
      }
      const targetPool = isTeamSection(target) ? (target.rosterPlayers ?? []) : (target.players ?? []);
      if (target.expectedPlayers > 0 && targetPool.length >= target.expectedPlayers && !options.allowOverCapacity) {
        throw new Error(`Section target capacity of ${target.expectedPlayers} would be exceeded.`);
      }
    }

    for (const item of changing) this.unassignRegistration(item.section.id, registrationId, { emit: false });
    const person = target && !currentTarget
      ? this.assignRegistration(target.id, registrationId, {}, { ...options, emit: false })
      : currentTarget;
    if (options.emit !== false) this.emit();
    return { section: target, person };
  },

  // Apply a board move as one transaction. Restore exact roster identities and
  // team memberships if any registration fails eligibility or capacity checks.
  moveRegistrations(eventId, moves, options = {}) {
    const sections = this.childrenForEvent(eventId);
    const snapshots = sections.map(section => ({ section, data: structuredClone(section) }));
    try {
      for (const { id, sectionId } of moves) {
        this.setRegistrationSection(eventId, id, sectionId, { ...options, emit: false });
      }
    } catch (error) {
      for (const { section, data } of snapshots) {
        for (const key of Object.keys(section)) delete section[key];
        Object.assign(section, data);
      }
      throw error;
    }
    if (options.emit !== false) this.emit();
  },

  playerDefaults(t, partial = {}) {
    return {
      id: 'P' + Math.random().toString(36).slice(2, 9),
      no: t.players.length + 1,
      name: '', rating: 0, fideId: '', fed: t.defaultFed || '', club: '',
      ratings: {}, ids: {},
      sex: '', byear: '', title: '', group: '', type: '',
      active: true, withdrawn: false,
      excludedRounds: [], requestedByes: {},
      rankCorrection: 0, addedPoints: 0,
      ...partial
    };
  },

  addPlayer(t, partial = {}) {
    const event = this.data.events?.find(item => item.id === t.eventId);
    if (event && !isTeamSection(t)) {
      const { id: playerId, no, registrationId, ...registrationData } = partial;
      const registration = partial.registrationId
        ? event.registrations.find(item => item.id === registrationId)
        : this.registerPlayer(event.id, { fed: t.defaultFed || event.defaultFed || event.federation || '', ...registrationData }, { emit: false });
      if (!registration) throw new Error('Registration not found.');
      return this.assignRegistration(t.id, registration.id, { playerId, no });
    }
    const p = this.playerDefaults(t, partial);
    t.players.push(p);
    this.applyAgeGroups(t);
    this.emit();
    return p;
  },

  addPlayers(t, partials = []) {
    const added = [];
    const event = this.data.events?.find(item => item.id === t.eventId);
    for (const partial of partials) {
      let p;
      if (event && !isTeamSection(t)) {
        const { id: playerId, no, registrationId, ...registrationData } = partial;
        const registration = partial.registrationId
          ? event.registrations.find(item => item.id === registrationId)
          : this.registerPlayer(event.id, { fed: t.defaultFed || event.defaultFed || event.federation || '', ...registrationData }, { emit: false });
        if (!registration) throw new Error('Registration not found.');
        p = this.assignRegistration(t.id, registration.id, { playerId, no }, { emit: false });
      } else {
        p = this.playerDefaults(t, partial);
        t.players.push(p);
      }
      added.push(p);
    }
    this.applyAgeGroups(t);
    this.emit();
    return added;
  },

  parseQuickAddNames(text) {
    return String(text ?? '').split(',').map(name => name.trim()).filter(Boolean);
  },

  findDuplicatePlayerNames(t, names) {
    const existing = new Set((t.players ?? [])
      .map(p => (p.name ?? '').trim().toLocaleLowerCase())
      .filter(Boolean));
    const seen = new Set();
    const duplicates = [];
    const duplicateKeys = new Set();
    for (const name of names) {
      const key = name.trim().toLocaleLowerCase();
      if (!key) continue;
      if ((existing.has(key) || seen.has(key)) && !duplicateKeys.has(key)) {
        duplicates.push(name);
        duplicateKeys.add(key);
      }
      seen.add(key);
    }
    return duplicates;
  },

  renumberByRating(t) {
    applyRatingPolicy(t);
    const sorted = [...t.players].sort((a, b) => (b.rating - a.rating) || a.name.localeCompare(b.name));
    sorted.forEach((p, i) => { p.no = i + 1; });
    this.emit();
  },

  applyAgeGroups(t) {
    if (!t.ageGroups?.length) return;
    for (const p of t.players) {
      if (!p.byear) continue;
      const group = t.ageGroups.find(item => item.code.startsWith('U')
        ? p.byear >= item.maxBirthYear
        : p.byear <= item.maxBirthYear);
      if (group) p.type = group.code;
    }
  },

  pairingNumbersFollowRatings(t) {
    const sorted = [...t.players].sort((a, b) => a.no - b.no);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].rating > sorted[i - 1].rating) return false;
    }
    return true;
  },

  deleteFromRound(t, round) {
    t.roundsData = t.roundsData.slice(0, round - 1);
    t.currentRound = t.roundsData.length;
    this.emit();
  },

  applyRatingPolicy(t) {
    applyRatingPolicy(t);
    this.emit();
    return t;
  },

  resizeRoundSchedule(t, rounds = t.rounds) {
    t.roundSchedule = normalizeRoundSchedule(t.roundSchedule, rounds, t);
    this.emit();
    return t.roundSchedule;
  }
};
