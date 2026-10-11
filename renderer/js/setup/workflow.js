// Tournament and section workflow summaries (MIT).

import { setupStatus } from './validation.js';

const activeRegistrations = event => (event?.registrations ?? []).filter(registration => !registration.archived);
const sectionPeople = section => section?.type === 'team-swiss' || section?.type === 'team-rr'
  ? (section.rosterPlayers ?? [])
  : (section?.players ?? []);

function activePeople(section) {
  return sectionPeople(section).filter(person => person.active !== false && !person.withdrawn && String(person.name ?? '').trim());
}

function assignedRegistrationIds(sections) {
  return new Set((sections ?? []).flatMap(section => sectionPeople(section)
    .map(person => person.registrationId)
    .filter(Boolean)));
}

function roundHasOpenResults(round) {
  return (round?.pairings ?? []).some(pairing => !pairing.result);
}

export function setupWarningAction(message = '', section = {}) {
  const started = !!(section?.roundsData?.length || section?.currentRound);

  if (message.startsWith('Federation is blank')) {
    return {
      view: 'event-setup',
      label: 'Tournament setup',
      guidance: 'Set the tournament federation used by sections, imports, and reports.'
    };
  }
  if (message.startsWith('Default federation is blank')) {
    return {
      view: 'event-setup',
      label: 'Tournament setup',
      guidance: 'Set the default federation applied to new and imported players.'
    };
  }
  if (message.startsWith('Fewer than two active participants')) {
    return {
      view: 'players',
      label: 'Manage players',
      guidance: 'Add or reinstate at least two named, active players before pairing.'
    };
  }
  if (message.startsWith('Section overrides tournament defaults')) {
    return {
      view: 'setup',
      label: started ? 'Review locked setup' : 'Review section setup',
      guidance: started
        ? 'This section has started, so pairing-critical overrides are locked. Review them here; update Tournament Setup for future sections.'
        : 'Review or remove these section overrides if they should match the tournament defaults.',
      ...(started ? { secondaryView: 'event-setup', secondaryLabel: 'Tournament setup' } : {})
    };
  }
  if (message.startsWith('Time control is blank')
    && section?.setupSources?.timeControl === 'tournament'
    && !started) {
    return {
      view: 'event-setup',
      label: 'Tournament setup',
      guidance: 'Set the inherited tournament time control used for pairing and reports.'
    };
  }

  return {
    view: 'setup',
    label: 'Section setup',
    guidance: started
      ? 'Review this section setting. Pairing-critical fields are locked after pairing starts.'
      : 'Review this setting in Section Setup before pairing.'
  };
}

export function eventWorkflowSummary(event, sections = []) {
  const registrations = activeRegistrations(event);
  const assignedIds = assignedRegistrationIds(sections);
  const assignedRegistrations = registrations.filter(registration => assignedIds.has(registration.id)).length;
  const unassignedRegistrations = Math.max(0, registrations.length - assignedRegistrations);
  const startedSections = sections.filter(section => (section.currentRound ?? 0) > 0 || section.roundsData?.length).length;
  const completedSections = sections.filter(section => Number(section.currentRound) >= Number(section.rounds) && Number(section.rounds) > 0).length;
  const setupAttention = sections.filter(section => setupStatus(event, section).errors.length).length;

  let nextAction;
  if (!sections.length) nextAction = { view: 'event-sections', label: 'Add first section' };
  else if (!registrations.length) nextAction = { view: 'registrations', label: 'Add registrations' };
  else if (unassignedRegistrations) {
    nextAction = {
      view: 'registrations',
      label: `Assign ${unassignedRegistrations} registration${unassignedRegistrations === 1 ? '' : 's'}`
    };
  } else if (setupAttention) nextAction = { view: 'event-sections', label: 'Review section setup' };
  else if (startedSections) nextAction = { view: 'event-sections', label: 'Monitor sections' };
  else nextAction = { view: 'event-sections', label: 'Open a section' };

  return {
    registrations: registrations.length,
    assignedRegistrations,
    unassignedRegistrations,
    sections: sections.length,
    startedSections,
    completedSections,
    setupAttention,
    nextAction
  };
}

export function sectionWorkflowSummary(event, section) {
  const status = setupStatus(event, section);
  const participants = activePeople(section).length;
  const currentRound = Number(section?.currentRound) || section?.roundsData?.length || 0;
  const latestRound = section?.roundsData?.[Math.max(0, currentRound - 1)] ?? section?.roundsData?.at(-1);
  const openResults = roundHasOpenResults(latestRound);

  let nextAction;
  if (status.errors.length) nextAction = { view: 'setup', label: 'Review section setup' };
  else if (participants < 2) nextAction = { view: 'players', label: 'Manage section players' };
  else if (!section?.roundsData?.length) nextAction = { view: 'rounds', label: 'Pair round 1' };
  else if (openResults) nextAction = { view: 'rounds', label: `Enter round ${currentRound} results` };
  else if (currentRound >= Number(section?.rounds)) nextAction = { view: 'export', label: 'Export section results' };
  else nextAction = { view: 'rounds', label: `Pair round ${currentRound + 1}` };

  return { participants, currentRound, status, nextAction };
}
