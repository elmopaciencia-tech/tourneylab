// Setup validation and edit-lock policy (MIT).

import { EDITABLE_AFTER_PAIRING_SETUP_FIELDS, PROFILE_SETUP_FIELDS, profileForSection, TOURNAMENT_SETUP_FIELDS } from './defaults.js';

const LOCKED_AFTER_PAIRING = new Set([
  'type',
  'rounds',
  'ratingPolicy',
  'initialRanking',
  'pairingSystem',
  'doubleRR',
  'rrMode',
  'koReplays',
  'koAdvancement',
  'scoring',
  'matchScoring',
  'pabValue',
  'fideMode',
  'tiebreakRules',
  'tiebreaks',
  'tiebreakConfig',
  'initialColor',
  'acceleration',
  'byeWeakest',
  'clubProtection',
  'restrictionPolicy',
  'lateEntryPolicy',
  'byePolicy',
  'allowExcludedResults',
  'boardsPerMatch',
  'teamPairBy',
  'teamBoardOrderCheck',
  'teamByeMatchScore'
]);

const isTeam = section => section?.type === 'team-swiss' || section?.type === 'team-rr';

export function canEditSetupField(section, field) {
  if (!section?.roundsData?.length) return true;
  if (EDITABLE_AFTER_PAIRING_SETUP_FIELDS.includes(field)) return true;
  return !LOCKED_AFTER_PAIRING.has(field);
}

export function setupStatus(event, section) {
  const errors = [];
  const warnings = [];
  const notices = [];
  const ok = [];

  if (!event?.name?.trim() && !section?.name?.trim()) errors.push('Tournament name is required.');
  else ok.push('Tournament name set.');

  if (!section?.type) errors.push('Section format is required.');
  else ok.push(`Section format: ${section.type}.`);

  if (section?.type !== 'ko' && !(Number(section?.rounds) > 0)) errors.push('Number of rounds must be greater than zero.');
  else ok.push('Round count set.');

  if (Number(section?.finalRound) > Number(section?.rounds)) errors.push('Final round cannot be later than the configured round count.');
  const resolved = field => event && (!section?.roundsData?.length || EDITABLE_AFTER_PAIRING_SETUP_FIELDS.includes(field)) && section?.setupSources?.[field] === 'tournament'
    ? PROFILE_SETUP_FIELDS.includes(field) ? profileForSection(event, section.type)[field] : event?.[field]
    : section?.[field];
  const startDate = resolved('startDate');
  const endDate = resolved('endDate');
  if (startDate && endDate && startDate > endDate) errors.push('Section end date cannot be before its start date.');
  if (section?.ratingMin !== '' && section?.ratingMax !== '' && Number(section.ratingMin) > Number(section.ratingMax)) {
    errors.push('Minimum rating cannot be greater than maximum rating.');
  }

  if (!event?.federation?.trim() && !section?.federation?.trim()) warnings.push('Federation is blank; player defaults and reports will be less complete.');
  else ok.push('Federation set.');

  if (!section?.defaultFed?.trim()) warnings.push('Default federation is blank; imported/new players may need manual FED entry.');
  else ok.push('Default federation set.');

  if (!String(resolved('timeControl') ?? '').trim()) warnings.push('Time control is blank; rating and published reports may need it.');
  else ok.push('Time control set.');

  const overridden = TOURNAMENT_SETUP_FIELDS.filter(field => section?.setupSources?.[field] === 'section'
    && section?.[field] !== event?.[field]);
  if (overridden.length) {
    const labels = {
      site: 'venue', startDate: 'start date', endDate: 'end date', timeControl: 'time control',
      ratingType: 'rating type', rated: 'rated status', fideEventCode: 'FIDE event code', fideReportCode: 'FIDE report code'
    };
    notices.push(`Section overrides tournament defaults: ${overridden.map(field => labels[field]).join(', ')}.`);
  }

  if (!section?.tiebreaks?.length && section?.type !== 'ko') warnings.push('No tie-breaks are configured.');
  else if (section?.type !== 'ko') ok.push('Tie-break order set.');

  if (!section?.ratingPolicy?.primary) errors.push('A primary pairing rating source is required.');
  else ok.push('Pairing rating source set.');

  const scoring = isTeam(section) ? section?.matchScoring : section?.scoring;
  if (![scoring?.win, scoring?.draw, scoring?.loss].every(value => Number.isFinite(Number(value)))) {
    errors.push('Win, draw and loss scoring values are required.');
  } else if (!(Number(scoring.win) >= Number(scoring.draw) && Number(scoring.draw) >= Number(scoring.loss))) {
    warnings.push('Scoring is unusual: expected win points >= draw points >= loss points.');
  } else ok.push('Scoring set.');

  if (isTeam(section)) {
    if (!(Number(section?.boardsPerMatch) > 0)) errors.push('Team sections need boards per match.');
    else ok.push(`${section.boardsPerMatch} boards per match.`);
    if (!section?.teamPairBy) warnings.push('Team pairing basis is not set.');
    if (section?.teamBoardOrderCheck === false) warnings.push('Team board-order checking is disabled.');
  }

  const activeCount = (section?.players ?? []).filter(p => p.active !== false && !p.withdrawn && String(p.name ?? '').trim()).length;
  if (activeCount < 2) warnings.push('Fewer than two active participants have names.');
  else ok.push(`${activeCount} active participants.`);

  if (section?.fideMode && section?.byeWeakest) warnings.push('Bye weakest is ignored in FIDE mode.');
  if (section?.acceleration === 'baku' && ((section?.rounds ?? 0) < 9 || section?.scoring?.win !== 1 || section?.scoring?.draw !== 0.5)) {
    warnings.push('Baku acceleration is only valid for 9+ round standard-scoring Swiss sections.');
  }
  if ((section?.roundSchedule?.length ?? 0) < Number(section?.rounds ?? 0)) warnings.push('The playing schedule does not cover every round.');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notices,
    checklist: ok
  };
}
