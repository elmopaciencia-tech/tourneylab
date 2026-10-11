import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultEvent, defaultSection } from '../renderer/js/setup/defaults.js';
import { eventWorkflowSummary, sectionWorkflowSummary } from '../renderer/js/setup/workflow.js';

function fixture() {
  const event = defaultEvent({ id: 'e1', name: 'Schools Festival', registrations: [] });
  const section = defaultSection({
    id: 's1', eventId: event.id, sectionName: 'Open', rounds: 3,
    defaultFed: 'SGP', timeControl: '60+30', players: []
  });
  event.sectionIds = [section.id];
  return { event, section };
}

test('tournament workflow leads organizers from registrations to assignments and sections', () => {
  const { event, section } = fixture();

  let summary = eventWorkflowSummary(event, [section]);
  assert.equal(summary.nextAction.view, 'registrations');
  assert.equal(summary.nextAction.label, 'Add registrations');

  event.registrations.push({ id: 'r1', name: 'Alice', archived: false });
  summary = eventWorkflowSummary(event, [section]);
  assert.equal(summary.unassignedRegistrations, 1);
  assert.equal(summary.nextAction.view, 'registrations');
  assert.match(summary.nextAction.label, /Assign 1 registration/);

  section.players.push({ id: 'p1', registrationId: 'r1', name: 'Alice', active: true, withdrawn: false });
  summary = eventWorkflowSummary(event, [section]);
  assert.equal(summary.assignedRegistrations, 1);
  assert.equal(summary.nextAction.view, 'event-sections');
  assert.equal(summary.nextAction.label, 'Open a section');
});

test('tournament workflow reports section blockers and active progress', () => {
  const { event, section } = fixture();
  event.registrations.push({ id: 'r1', name: 'Alice', archived: false });
  section.players.push({ id: 'p1', registrationId: 'r1', name: 'Alice', active: true, withdrawn: false });
  section.type = '';

  let summary = eventWorkflowSummary(event, [section]);
  assert.equal(summary.setupAttention, 1);
  assert.equal(summary.nextAction.label, 'Review section setup');

  section.type = 'swiss';
  section.roundsData.push({ round: 1, pairings: [], byes: [] });
  section.currentRound = 1;
  summary = eventWorkflowSummary(event, [section]);
  assert.equal(summary.startedSections, 1);
  assert.equal(summary.nextAction.label, 'Monitor sections');
});

test('section workflow prioritizes setup, roster, pairing, results, and export', () => {
  const { event, section } = fixture();

  section.type = '';
  assert.equal(sectionWorkflowSummary(event, section).nextAction.view, 'setup');

  section.type = 'swiss';
  assert.equal(sectionWorkflowSummary(event, section).nextAction.view, 'players');

  section.players.push(
    { id: 'p1', name: 'Alice', active: true, withdrawn: false },
    { id: 'p2', name: 'Bob', active: true, withdrawn: false }
  );
  assert.equal(sectionWorkflowSummary(event, section).nextAction.label, 'Pair round 1');

  section.roundsData.push({ round: 1, pairings: [{ whiteId: 'p1', blackId: 'p2', result: '' }], byes: [] });
  section.currentRound = 1;
  assert.equal(sectionWorkflowSummary(event, section).nextAction.label, 'Enter round 1 results');

  section.roundsData[0].pairings[0].result = '1-0';
  section.currentRound = section.rounds;
  assert.equal(sectionWorkflowSummary(event, section).nextAction.view, 'export');
});
