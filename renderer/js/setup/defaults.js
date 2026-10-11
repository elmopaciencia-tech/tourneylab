import { normalizeTeamPolicy } from '../engine/team.js';
// TourneyLab setup defaults and schema helpers (MIT).

export const SETUP_SCHEMA_VERSION = 2;

export const TOURNAMENT_SETUP_FIELDS = Object.freeze([
  'site', 'startDate', 'endDate', 'timeControl', 'ratingType', 'rated',
  'fideEventCode', 'fideReportCode'
]);

export const PROFILE_SETUP_FIELDS = Object.freeze([
  'type', 'rounds', 'timeControl', 'ratingType', 'rated', 'ratingPolicy',
  'initialRanking', 'pairingSystem', 'doubleRR', 'rrMode', 'koReplays',
  'koAdvancement', 'scoring', 'matchScoring', 'pabValue', 'fideMode',
  'tiebreakRules',   'initialColor', 'acceleration', 'byeWeakest', 'ignoreColour', 'pairByTiebreak',
  'clubProtection', 'restrictionPolicy', 'lateEntryPolicy', 'byePolicy', 'teamColourPreference',
  'tiebreaks', 'tiebreakConfig', 'allowExcludedResults',
  'boardsPerMatch', 'teamPairBy', 'teamBoardOrderCheck', 'teamByeMatchScore'
]);

export const INHERITABLE_SETUP_FIELDS = Object.freeze([
  ...new Set([...TOURNAMENT_SETUP_FIELDS, ...PROFILE_SETUP_FIELDS, 'roundSchedule'])
]);

export const EDITABLE_AFTER_PAIRING_SETUP_FIELDS = Object.freeze([
  'site',
  'startDate',
  'endDate',
  'timeControl',
  'ratingType',
  'rated',
  'fideEventCode',
  'fideReportCode',
  'roundSchedule'
]);

export const CHILD_SETUP_KEYS = [
  'type', 'rounds', 'finalRound', 'startingBoard', 'sideGame',
  'excludeFromRatingReport', 'ratingMin', 'ratingMax', 'eligibility',
  'ratingPolicy', 'ratingProjection', 'initialRanking',
  'pairingSystem', 'doubleRR', 'rrMode', 'koReplays', 'koAdvancement',
  'scoring', 'matchScoring', 'pabValue', 'fideMode', 'tiebreakRules',
  'initialColor', 'acceleration', 'byeWeakest', 'ignoreColour', 'pairByTiebreak',
  'clubProtection', 'restrictionPolicy', 'lateEntryPolicy', 'byePolicy', 'teamColourPreference',
  'tiebreaks', 'tiebreakConfig', 'ageGroups', 'listOptions', 'titleNorm',
  'allowExcludedResults', 'boardsPerMatch', 'teamPairBy',
  'teamBoardOrderCheck', 'teamByeMatchScore', 'roundSchedule'
];

export const publishDefaults = {
  creator: '',
  lastUpdate: '',
  homepageUrl: '',
  registrationUrl: '',
  calendarUrl: '',
  qrUrl: '',
  provider: '',
  reportId: '',
  publicUrl: '',
  visibility: 'listed',
  lastRevision: 0,
  lastPublishedAt: '',
  lastPublishedFingerprint: ''
};

export const organizerProfileDefaults = {
  id: '',
  name: 'Organizer profile',
  organizer: '',
  federation: '',
  defaultFed: '',
  site: '',
  chiefArbiter: '',
  deputyArbiters: '',
  arbiterEmail: '',
  defaultRatingType: 'standard',
  defaultRatingSource: 'rating',
  listOptions: {
    showFideId: true,
    showFederation: true,
    showClub: true,
    showBirthYear: false,
    showTitles: true
  }
};

export function normalizeOrganizerProfile(profile = {}) {
  return {
    ...organizerProfileDefaults,
    ...profile,
    id: String(profile.id || createId('OP')),
    name: String(profile.name || 'Organizer profile'),
    organizer: String(profile.organizer ?? ''),
    federation: String(profile.federation ?? '').trim().toUpperCase(),
    defaultFed: String(profile.defaultFed ?? profile.federation ?? '').trim().toUpperCase(),
    site: String(profile.site ?? ''),
    chiefArbiter: String(profile.chiefArbiter ?? ''),
    deputyArbiters: String(profile.deputyArbiters ?? ''),
    arbiterEmail: String(profile.arbiterEmail ?? ''),
    defaultRatingType: String(profile.defaultRatingType || 'standard'),
    defaultRatingSource: String(profile.defaultRatingSource || 'rating'),
    listOptions: { ...organizerProfileDefaults.listOptions, ...(profile.listOptions ?? {}) }
  };
}

export function normalizePublish(publish = {}) {
  return Object.fromEntries(Object.keys(publishDefaults).map(key => [
    key,
    key === 'lastRevision'
      ? Math.max(0, Number(publish?.[key]) || 0)
      : key === 'visibility'
        ? publish?.[key] === 'unlisted' ? 'unlisted' : 'listed'
        : String(publish?.[key] ?? publishDefaults[key])
  ]));
}

export function createId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

export function defaultEvent(partial = {}) {
  const event = normalizeEvent({
    id: createId('E'),
    setupVersion: SETUP_SCHEMA_VERSION,
    name: 'Untitled tournament',
    site: '',
    federation: '',
    organizer: '',
    startDate: '',
    endDate: '',
    timeControl: '',
    rated: true,
    ratingType: 'standard',
    ratingSource: 'rating',
    defaultFed: '',
    fideEventCode: '',
    fideReportCode: '',
    remarks: '',
    officials: { director: {}, chief: {}, deputy: {} },
    attachments: [],
    icon: '♟️',
    arbiters: {
      chief: '',
      deputies: '',
      email: ''
    },
    publish: normalizePublish(),
    registrations: [],
    registrationDuplicateCandidates: [],
    childDefaults: undefined,
    competitionProfiles: partial.competitionProfiles,
    masterSchedule: partial.masterSchedule,
    ageScheme: partial.ageScheme,
    listOptions: partial.listOptions,
    sectionIds: [],
    ...partial
  });
  return event;
}

export function defaultSection(partial = {}) {
  const rounds = partial.rounds ?? 7;
  const tiebreakConfig = normalizeTiebreakConfig(partial.tiebreakConfig ?? partial.tiebreaks);
  const eligibility = normalizeEligibility(partial.eligibility ?? {
    ratingMin: partial.ratingMin,
    ratingMax: partial.ratingMax,
    birthYearMin: partial.birthYearMin,
    birthYearMax: partial.birthYearMax
  });
  const section = {
    id: partial.id ?? createId('T'),
    eventId: partial.eventId ?? null,
    sectionCode: partial.sectionCode ?? 'A',
    sectionName: partial.sectionName ?? partial.name ?? 'Open',
    name: partial.name ?? partial.sectionName ?? 'Untitled tournament',
    site: partial.site ?? '',
    federation: partial.federation ?? '',
    organizer: partial.organizer ?? '',
    startDate: partial.startDate ?? '',
    endDate: partial.endDate ?? '',
    publish: normalizePublish(partial.publish),
    type: partial.type ?? 'swiss',
    rounds,
    finalRound: partial.finalRound ?? rounds,
    startingBoard: partial.startingBoard ?? 1,
    expectedPlayers: Math.max(0, Number(partial.expectedPlayers) || 0),
    eligibilityBandId: partial.eligibilityBandId ?? '',
    eligibilityOverrides: Array.isArray(partial.eligibilityOverrides) ? partial.eligibilityOverrides : [],
    sectionOrder: partial.sectionOrder ?? 1,
    sideGame: partial.sideGame ?? false,
    excludeFromRatingReport: partial.excludeFromRatingReport ?? false,
    ratingMin: eligibility.ratingMin,
    ratingMax: eligibility.ratingMax,
    eligibility,
    rated: partial.rated ?? true,
    timeControl: partial.timeControl ?? '',
    ratingType: partial.ratingType ?? 'standard',
    fideEventCode: partial.fideEventCode ?? '',
    fideReportCode: partial.fideReportCode ?? '',
    setupSources: normalizeSetupSources(partial.setupSources),
    sectionArbiters: partial.sectionArbiters ?? '',
    ratingPolicy: normalizeRatingPolicy(partial.ratingPolicy, partial.ratingSource),
    ratingProjection: normalizeRatingProjection(partial.ratingProjection),
    initialRanking: partial.initialRanking ?? 'rating',
    pairingSystem: partial.pairingSystem ?? 'fide-dutch',
    doubleRR: partial.doubleRR ?? false,
    rrMode: partial.rrMode ?? 'berger',
    koReplays: partial.koReplays ?? 1,
    koAdvancement: partial.koAdvancement ?? 'blackInLastGame',
    scoring: { win: 1, draw: 0.5, loss: 0, ...(partial.scoring ?? {}) },
    matchScoring: { win: 2, draw: 1, loss: 0, ...(partial.matchScoring ?? {}) },
    pabValue: partial.pabValue ?? 'win',
    fideMode: partial.fideMode ?? true,
    tiebreakRules: partial.tiebreakRules ?? 'fide2026',
    initialColor: partial.initialColor ?? (Math.random() < 0.5 ? 'white' : 'black'),
    acceleration: partial.acceleration ?? 'none',
    byeWeakest: partial.byeWeakest ?? false,
    ignoreColour: partial.ignoreColour ?? false,
    pairByTiebreak: partial.pairByTiebreak ?? false,
    teamColourPreference: partial.teamColourPreference ?? 'A',
    clubProtection: partial.clubProtection ?? false,
    restrictionPolicy: partial.restrictionPolicy ?? 'hard',
    lateEntryPolicy: partial.lateEntryPolicy ?? 'manual',
    byePolicy: {
      allowHalfPoint: true,
      allowFullPoint: true,
      allowZeroPoint: true,
      maxHalfPointByes: 1,
      lastRoundByes: false,
      ...(partial.byePolicy ?? {})
    },
    defaultFed: partial.defaultFed ?? '',
    tiebreaks: tiebreakConfig.map(tb => tb.code),
    tiebreakConfig,
    ageGroups: partial.ageGroups ?? [],
    listOptions: {
      showFideId: true,
      showFederation: true,
      showClub: true,
      showBirthYear: false,
      showTitles: true,
      showNationalId: false,
      ...(partial.listOptions ?? {})
    },
    titleNorm: {
      enabled: false,
      category: '',
      reportCode: '',
      ...(partial.titleNorm ?? {})
    },
    allowExcludedResults: partial.allowExcludedResults ?? false,
    players: partial.players ?? [],
    rosterPlayers: partial.rosterPlayers ?? undefined,
    teams: partial.teams ?? [],
    teamPolicy: normalizeTeamPolicy({rankingVersion:'team-v1', ...partial.teamPolicy}),
    boardsPerMatch: partial.boardsPerMatch ?? 4,
    teamPairBy: partial.teamPairBy ?? 'matchPoints',
    teamBoardOrderCheck: partial.teamBoardOrderCheck ?? true,
    teamByeMatchScore: partial.teamByeMatchScore ?? { match: 2, game: partial.boardsPerMatch ?? 4 },
    forbidden: partial.forbidden ?? [],
    roundSchedule: normalizeRoundSchedule(partial.roundSchedule, rounds, partial),
    roundsData: partial.roundsData ?? [],
    currentRound: partial.currentRound ?? 0,
    icon: partial.icon ?? '♟️'
  };
  return { ...partial, ...section, publish: section.publish };
}

export function normalizeEvent(event = {}) {
  const childDefaults = normalizeChildDefaults(event.childDefaults ?? {
    ratingPolicy: {
      primary: event.ratingSource,
      fallback: 'rating',
      unratedValue: 0,
      renumberByResolvedRating: true
    }
  });
  const startYear = String(event.startDate ?? '').match(/^(\d{4})/)?.[1] ?? '';
  const profiles = normalizeCompetitionProfiles(event.competitionProfiles, childDefaults, event);
  const maxRounds = Math.max(1, ...Object.values(profiles).map(profile => Number(profile.rounds) || 0));
  return {
    ...event,
    setupVersion: event.setupVersion ?? SETUP_SCHEMA_VERSION,
    name: event.name ?? 'Untitled tournament',
    site: event.site ?? '',
    federation: event.federation ?? '',
    organizer: event.organizer ?? '',
    startDate: event.startDate ?? '',
    endDate: event.endDate ?? '',
    timeControl: event.timeControl ?? '',
    rated: event.rated ?? true,
    ratingType: event.ratingType ?? 'standard',
    ratingSource: event.ratingSource ?? 'rating',
    defaultFed: event.defaultFed ?? event.federation ?? '',
    fideEventCode: event.fideEventCode ?? '',
    fideReportCode: event.fideReportCode ?? '',
    remarks: event.remarks ?? '',
    icon: event.icon ?? '♟️',
    archived: !!event.archived,
    arbiters: {
      chief: '',
      deputies: '',
      email: '',
      ...(event.arbiters ?? {})
    },
    publish: normalizePublish(event.publish),
    registrations: (event.registrations ?? []).map(normalizeRegistration),
    registrationDuplicateCandidates: (event.registrationDuplicateCandidates ?? [])
      .map(pair => Array.isArray(pair) ? pair.slice(0, 2) : pair)
      .filter(pair => Array.isArray(pair) && pair.length === 2),
    childDefaults,
    competitionProfiles: profiles,
    masterSchedule: normalizeRoundSchedule(event.masterSchedule, maxRounds, event),
    ageScheme: normalizeAgeScheme(event.ageScheme, startYear ? `${startYear}-01-01` : ''),
    listOptions: {
      showFideId: true,
      showFederation: true,
      showClub: true,
      showBirthYear: false,
      showTitles: true,
      ...(event.listOptions ?? {})
    },
    sectionIds: event.sectionIds ?? event.sections ?? []
  };
}

export function normalizeSection(section = {}) {
  return defaultSection({...section,teamPolicy:normalizeTeamPolicy(section.teamPolicy)});
}

export function normalizeSetupSources(sources = {}) {
  return Object.fromEntries(INHERITABLE_SETUP_FIELDS.map(field => [
    field,
    sources?.[field] === 'tournament' ? 'tournament' : 'section'
  ]));
}

export function normalizeEligibility(eligibility = {}) {
  const value = field => eligibility[field] === '' || eligibility[field] == null
    ? ''
    : Number(eligibility[field]);
  return {
    ratingMin: value('ratingMin'),
    ratingMax: value('ratingMax'),
    birthYearMin: value('birthYearMin'),
    birthYearMax: value('birthYearMax')
  };
}

export function normalizeRegistration(registration = {}) {
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(registration.birthDate ?? ''))
    ? String(registration.birthDate)
    : '';
  return {
    id: registration.id ?? createId('R'),
    name: registration.name ?? '',
    rating: Number(registration.rating) || 0,
    fideId: registration.fideId ?? '',
    fed: registration.fed ?? '',
    club: registration.club ?? '',
    ratings: { ...(registration.ratings ?? {}) },
    ids: { ...(registration.ids ?? {}) },
    sex: registration.sex ?? '',
    birthDate,
    byear: birthDate ? Number(birthDate.slice(0, 4)) : registration.byear ?? '',
    title: registration.title ?? '',
    group: registration.group ?? '',
    type: registration.type ?? '',
    archived: !!registration.archived
  };
}

export function defaultChildSetup(partial = {}) {
  const section = defaultSection({ initialColor: 'white', ...partial });
  return Object.fromEntries(CHILD_SETUP_KEYS.map(key => [key, cloneValue(section[key])]));
}

export function normalizeChildDefaults(defaults = {}) {
  return defaultChildSetup(defaults);
}

export const FORMAT_PROFILE_KEYS = Object.freeze(['swiss', 'team-swiss', 'roundrobin', 'team-rr', 'ko']);

export function defaultCompetitionProfile(type = 'swiss', partial = {}) {
  const section = defaultSection({
    type,
    initialColor: 'white',
    pairingSystem: type === 'team-swiss'
      ? 'fide-c04.6'
      : type === 'swiss'
        ? 'fide-dutch'
        : type === 'ko' ? 'knockout' : 'round-robin',
    ...partial
  });
  return Object.fromEntries(PROFILE_SETUP_FIELDS.map(key => [key, cloneValue(section[key])]));
}

export function normalizeCompetitionProfiles(profiles = null, fallback = {}, event = {}) {
  const source = profiles && typeof profiles === 'object' ? profiles : {};
  return Object.fromEntries(FORMAT_PROFILE_KEYS.map(type => {
    const seed = source[type] ?? (fallback?.type === type ? fallback : {});
    return [type, defaultCompetitionProfile(type, {
      timeControl: seed.timeControl ?? event.timeControl,
      ratingType: seed.ratingType ?? event.ratingType,
      rated: seed.rated ?? event.rated,
      ...seed,
      type
    })];
  }));
}

export function profileForSection(event, type = 'swiss') {
  return event?.competitionProfiles?.[type]
    ?? defaultCompetitionProfile(type, event?.childDefaults?.type === type ? event.childDefaults : {});
}

export function normalizeAgeScheme(scheme = {}, defaultCutoffDate = '') {
  const bands = Array.isArray(scheme?.bands) ? scheme.bands : [];
  return {
    cutoffDate: scheme?.cutoffDate ?? defaultCutoffDate,
    bands: bands.map((band, index) => ({
      id: band.id ?? createId('B'),
      code: String(band.code ?? '').trim().toUpperCase(),
      label: String(band.label ?? band.code ?? `Band ${index + 1}`).trim(),
      open: !!band.open,
      maxAge: band.open || band.maxAge === '' || band.maxAge == null ? '' : Math.max(1, Number(band.maxAge) || 1)
    }))
  };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateAgeEligibility(person = {}, band = {}, cutoffDate = '') {
  if (band?.open) return { status: 'eligible', reason: 'Open section has no age limit.' };
  const cutoff = validDate(cutoffDate);
  const maxAge = Number(band?.maxAge);
  if (!cutoff || !Number.isFinite(maxAge) || maxAge <= 0) return { status: 'review', reason: 'Age rule is incomplete.' };
  const threshold = new Date(cutoff);
  threshold.setUTCFullYear(threshold.getUTCFullYear() - maxAge);
  const birthDate = validDate(person.birthDate);
  if (birthDate) return birthDate > threshold
    ? { status: 'eligible', reason: `Under ${maxAge} on ${cutoffDate}.` }
    : { status: 'ineligible', reason: `Age ${maxAge} or older on ${cutoffDate}.` };

  const birthYear = Number(person.byear);
  if (!Number.isInteger(birthYear)) return { status: 'review', reason: 'Full date of birth or birth year is required.' };
  const thresholdYear = threshold.getUTCFullYear();
  if (birthYear > thresholdYear) return { status: 'eligible', reason: 'Birth year is unambiguously eligible.' };
  if (birthYear < thresholdYear) return { status: 'ineligible', reason: 'Birth year is unambiguously ineligible.' };
  return { status: 'review', reason: 'Exact date of birth is needed at the age boundary.' };
}

export function tournamentReadinessSummary(event, sections = []) {
  const rounds = sections.length
    ? Math.max(...sections.map(section => Number(section.rounds) || 0))
    : Number(profileForSection(event, 'swiss').rounds) || 0;
  return {
    sections: sections.length,
    plannedPlayers: sections.reduce((sum, section) => sum + (Number(section.expectedPlayers) || 0), 0),
    rounds,
    unlinkedSections: sections.filter(section => !section.eligibilityBandId).length,
    startedSections: sections.filter(section => (section.roundsData?.length ?? 0) > 0).length
  };
}

export function childSetupSnapshot(source = {}, { includeSchedule = true } = {}) {
  const snapshot = defaultChildSetup(source);
  if (!includeSchedule) snapshot.roundSchedule = normalizeRoundSchedule([], snapshot.rounds, source);
  return snapshot;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeRatingPolicy(policy = null, source = null) {
  const p = policy ?? {};
  return {
    primary: source ?? p.primary ?? 'rating',
    fallback: p.fallback ?? 'rating',
    unratedValue: p.unratedValue ?? 0,
    renumberByResolvedRating: p.renumberByResolvedRating ?? true
  };
}

export function normalizeRatingProjection(projection = null) {
  const source = projection ?? {};
  const allowedModes = new Set(['auto', '10', '20', '40', 'custom']);
  const requestedMode = String(source.kFactorMode ?? 'auto');
  const rawCustomK = Number(source.customKFactor);
  const customKFactor = Number.isFinite(rawCustomK) && rawCustomK > 0
    ? Math.min(100, Math.max(1, Math.round(rawCustomK)))
    : 20;
  return {
    kFactorMode: allowedModes.has(requestedMode) ? requestedMode : 'auto',
    customKFactor
  };
}

export function normalizeTiebreaks(tiebreaks) {
  return normalizeTiebreakConfig(tiebreaks).map(tb => tb.code);
}

export function normalizeTiebreakConfig(tiebreaks) {
  const source = Array.isArray(tiebreaks) ? tiebreaks : ['BH', 'BHC1', 'SB', 'WINS'];
  return source.map(tb => {
    const value = typeof tb === 'string' ? { code: tb } : { ...(tb ?? {}) };
    if (!value.code) return null;
    const defaults = value.code === 'BHC1'
      ? { cutsLow: 1, cutsHigh: 0 }
      : value.code === 'BHM' || value.code === 'MMED'
        ? { cutsLow: 1, cutsHigh: 1 }
        : { cutsLow: 0, cutsHigh: 0 };
    return {
      ...value,
      cutsLow: Number.isFinite(Number(value.cutsLow)) ? Number(value.cutsLow) : defaults.cutsLow,
      cutsHigh: Number.isFinite(Number(value.cutsHigh)) ? Number(value.cutsHigh) : defaults.cutsHigh
    };
  }).filter(Boolean);
}

export function normalizeRoundSchedule(schedule, rounds, defaults = {}) {
  const source = Array.isArray(schedule) ? schedule : [];
  return Array.from({ length: Math.max(0, Number(rounds) || 0) }, (_, index) => ({
    round: index + 1,
    date: source[index]?.date ?? (index === 0 ? defaults.startDate ?? '' : ''),
    time: source[index]?.time ?? '',
    site: source[index]?.site ?? (index === 0 ? defaults.site ?? '' : '')
  }));
}

export function sectionDisplayName(section) {
  if (!section) return '';
  const label = section.sectionName || section.name || 'Section';
  return section.sectionCode ? `${section.sectionCode}: ${label}` : label;
}

export function registrationSectionLabels(event, sections = []) {
  const displayName = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const keyFor = value => displayName(value).toLocaleLowerCase();
  const eventNameKey = keyFor(event?.name);
  const bases = sections.map(section => {
    const name = displayName(section?.sectionName || section?.name);
    if (!name || (eventNameKey && keyFor(name) === eventNameKey)) return 'Main Section';
    return /\bsection$/i.test(name) ? name : `${name} Section`;
  });
  const groups = new Map();

  bases.forEach((label, index) => {
    const key = keyFor(label);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  return bases.map((label, index) => {
    const group = groups.get(keyFor(label));
    if (group.length === 1) return label;

    const code = displayName(sections[index]?.sectionCode);
    const codeIsUnique = code && group.filter(itemIndex => (
      keyFor(sections[itemIndex]?.sectionCode) === keyFor(code)
    )).length === 1;
    const suffix = codeIsUnique ? code : String(group.indexOf(index) + 1);
    return `${label} (${suffix})`;
  });
}
