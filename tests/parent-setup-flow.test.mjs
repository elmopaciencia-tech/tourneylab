import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultEvent,
  defaultSection,
  evaluateAgeEligibility,
  normalizeRegistration,
  profileForSection,
  tournamentReadinessSummary
} from '../renderer/js/setup/defaults.js';
import { migrateWorkspace, WORKSPACE_SCHEMA_VERSION } from '../renderer/js/setup/schema.js';
import { canEditSetupField } from '../renderer/js/setup/validation.js';
import { store } from '../renderer/js/store.js';

globalThis.window = {};

function resetStore(input = { tournaments: [] }) {
  store.persist = () => {};
  store.listeners.clear();
  store.data = migrateWorkspace(input);
}

test('new tournaments expose parent profiles, a master schedule, and an age scheme', () => {
  const event = defaultEvent({ startDate: '2027-03-12' });

  assert.equal(profileForSection(event, 'swiss').rounds, 7);
  assert.equal(profileForSection(event, 'team-swiss').pairingSystem, 'fide-c04.6');
  assert.equal(profileForSection(event, 'roundrobin').pairingSystem, 'round-robin');
  assert.equal(profileForSection(event, 'ko').pairingSystem, 'knockout');
  assert.equal(event.masterSchedule.length, 7);
  assert.equal(event.ageScheme.cutoffDate, '2027-01-01');
});

test('a section pairing-system override survives the freeze at round 1', () => {
  resetStore();
  const open = store.newEvent({ name: 'Override' }, { sectionName: 'Open' });
  store.setSectionSetupValue(open.id, 'pairingSystem', 'fide-double-swiss', { emit: false });
  store.freezeInheritedSectionSetup(open.id, { emit: false });
  assert.equal(open.pairingSystem, 'fide-double-swiss');
  assert.equal(open.setupSources.pairingSystem, 'section');
});

test('parent profile changes propagate live only to inheriting unstarted sections', () => {
  resetStore();
  const open = store.newEvent({ name: 'Schools Championship' }, { sectionName: 'Open' });
  const event = store.activeEvent;
  const under12 = store.addSection(event.id, { sectionName: 'Under 12', type: 'swiss' });

  store.setTournamentProfileValue(event.id, 'swiss', 'rounds', 9, { emit: false });
  assert.equal(open.rounds, 9);
  assert.equal(under12.rounds, 9);

  store.setSectionSetupValue(under12.id, 'rounds', 7, { emit: false });
  store.setTournamentProfileValue(event.id, 'swiss', 'rounds', 11, { emit: false });
  assert.equal(open.rounds, 11);
  assert.equal(under12.rounds, 7);

  open.roundsData.push({ round: 1, pairings: [], byes: [] });
  store.freezeInheritedSectionSetup(open.id, { emit: false });
  store.setTournamentProfileValue(event.id, 'swiss', 'rounds', 13, { emit: false });
  assert.equal(open.rounds, 11);
});

test('new sections inherit pairing defaults and FIDE codes from the parent tournament', () => {
  resetStore();
  store.newEvent({
    name: 'Schools Championship',
    fideEventCode: 'FIDE-EVENT',
    fideReportCode: 'FIDE-REPORT'
  }, { sectionName: 'Open' });
  const event = store.activeEvent;

  store.setTournamentProfileValue(event.id, 'swiss', 'initialColor', 'black', { emit: false });
  store.setTournamentProfileValue(event.id, 'swiss', 'acceleration', 'baku', { emit: false });
  store.setTournamentProfileValue(event.id, 'swiss', 'fideMode', false, { emit: false });
  store.setTournamentProfileValue(event.id, 'swiss', 'byeWeakest', true, { emit: false });

  const under12 = store.addSection(event.id, { sectionName: 'Under 12', type: 'swiss' });

  assert.deepEqual(
    {
      initialColor: under12.initialColor,
      acceleration: under12.acceleration,
      byeWeakest: under12.byeWeakest,
      fideEventCode: under12.fideEventCode,
      fideReportCode: under12.fideReportCode
    },
    {
      initialColor: 'black',
      acceleration: 'baku',
      byeWeakest: true,
      fideEventCode: 'FIDE-EVENT',
      fideReportCode: 'FIDE-REPORT'
    }
  );
  for (const field of ['initialColor', 'acceleration', 'byeWeakest', 'fideEventCode', 'fideReportCode']) {
    assert.equal(under12.setupSources[field], 'tournament', `${field} should retain tournament ownership`);
  }
});

test('time control stays linked to its parent competition profile after pairing', () => {
  resetStore();
  const section = store.newEvent({ name: 'Live Controls', timeControl: '60+30' });
  const event = store.activeEvent;
  section.roundsData.push({ round: 1, pairings: [], byes: [] });
  store.freezeInheritedSectionSetup(section.id, { emit: false });

  store.setTournamentProfileValue(event.id, 'swiss', 'timeControl', '90+30', { emit: false });
  assert.equal(section.timeControl, '90+30');
  assert.equal(store.resolvedSectionSetup(event, section).timeControl, '90+30');
  assert.equal(store.sectionSetupSource(section, 'timeControl'), 'tournament');
  assert.equal(canEditSetupField(section, 'timeControl'), true);

  store.setSectionSetupValue(section.id, 'timeControl', '15+10', { emit: false });
  store.setTournamentProfileValue(event.id, 'swiss', 'timeControl', '120+30', { emit: false });
  assert.equal(section.timeControl, '15+10');
  assert.equal(store.sectionSetupSource(section, 'timeControl'), 'section');

  store.useTournamentSetupDefault(section.id, 'timeControl', { emit: false });
  assert.equal(section.timeControl, '120+30');
  assert.equal(store.sectionSetupSource(section, 'timeControl'), 'tournament');
});

test('master schedule is inherited until a section overrides or starts', () => {
  resetStore();
  const section = store.newEvent({ name: 'Open', startDate: '2027-04-01' });
  const event = store.activeEvent;

  store.setMasterSchedule(event.id, [
    { round: 1, date: '2027-04-01', time: '09:00', site: 'Main Hall' },
    { round: 2, date: '2027-04-01', time: '14:00', site: 'Main Hall' }
  ], { emit: false });
  assert.equal(section.roundSchedule[1].time, '14:00');
  assert.equal(store.sectionSetupSource(section, 'roundSchedule'), 'tournament');

  store.setSectionSetupValue(section.id, 'roundSchedule', [{ round: 1, date: '2027-04-02', time: '10:00', site: 'Room B' }], { emit: false });
  store.setMasterSchedule(event.id, [{ round: 1, date: '2027-04-03', time: '08:00', site: 'Main Hall' }], { emit: false });
  assert.equal(section.roundSchedule[0].date, '2027-04-02');
});

test('age eligibility supports exact DOB and a review state for ambiguous birth years', () => {
  const band = { id: 'u8', code: 'U8', label: 'Under 8', maxAge: 8 };
  const cutoffDate = '2027-01-01';

  assert.equal(evaluateAgeEligibility({ birthDate: '2020-01-02' }, band, cutoffDate).status, 'eligible');
  assert.equal(evaluateAgeEligibility({ birthDate: '2019-01-01' }, band, cutoffDate).status, 'ineligible');
  assert.equal(evaluateAgeEligibility({ byear: 2020 }, band, cutoffDate).status, 'eligible');
  assert.equal(evaluateAgeEligibility({ byear: 2019 }, band, cutoffDate).status, 'review');
  assert.equal(evaluateAgeEligibility({ byear: 2018 }, band, cutoffDate).status, 'ineligible');
  assert.equal(evaluateAgeEligibility({}, { id: 'open', code: 'OPEN', label: 'Open', open: true }, cutoffDate).status, 'eligible');
});

test('registrations retain full DOB while deriving the legacy birth year', () => {
  const registration = normalizeRegistration({ name: 'A Player', birthDate: '2018-07-09' });
  assert.equal(registration.birthDate, '2018-07-09');
  assert.equal(registration.byear, 2018);
});

test('schema v4 migration seeds parent profiles but preserves every existing section rule as an override', () => {
  const event = defaultEvent({ id: 'e1', name: 'Legacy Event', childDefaults: undefined });
  delete event.competitionProfiles;
  delete event.masterSchedule;
  delete event.ageScheme;
  const section = defaultSection({ id: 's1', eventId: 'e1', rounds: 6, scoring: { win: 3, draw: 1, loss: 0 } });
  const migrated = migrateWorkspace({ schemaVersion: 4, events: [event], tournaments: [section], activeId: 's1' });

  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(profileForSection(migrated.events[0], 'swiss').rounds, 6);
  assert.deepEqual(profileForSection(migrated.events[0], 'swiss').scoring, { win: 3, draw: 1, loss: 0 });
  assert.equal(migrated.tournaments[0].setupSources.rounds, 'section');
  assert.equal(migrated.tournaments[0].rounds, 6);
});

test('120-player four-section setup reports tournament readiness totals', () => {
  const event = defaultEvent({
    startDate: '2027-01-15',
    ageScheme: {
      cutoffDate: '2027-01-01',
      bands: [
        { id: 'u8', code: 'U8', label: 'Under 8', maxAge: 8 },
        { id: 'u12', code: 'U12', label: 'Under 12', maxAge: 12 },
        { id: 'u16', code: 'U16', label: 'Under 16', maxAge: 16 },
        { id: 'open', code: 'OPEN', label: 'Open', open: true }
      ]
    }
  });
  const sections = event.ageScheme.bands.map((band, index) => defaultSection({
    eventId: event.id,
    sectionName: band.label,
    eligibilityBandId: band.id,
    expectedPlayers: 30,
    sectionOrder: index + 1,
    rounds: 7
  }));

  assert.deepEqual(tournamentReadinessSummary(event, sections), {
    sections: 4,
    plannedPlayers: 120,
    rounds: 7,
    unlinkedSections: 0,
    startedSections: 0
  });
});

test('format changes require confirmation before incompatible section overrides are reset', () => {
  resetStore();
  const section = store.newEvent({ name: 'Formats' });
  store.setSectionSetupValue(section.id, 'scoring', { win: 3, draw: 1, loss: 0 }, { emit: false });

  const preview = store.changeSectionFormat(section.id, 'ko', { emit: false });
  assert.equal(preview.changed, false);
  assert.ok(preview.incompatible.includes('scoring'));

  const changed = store.changeSectionFormat(section.id, 'ko', { confirmReset: true, emit: false });
  assert.equal(changed.changed, true);
  assert.equal(section.type, 'ko');
  assert.equal(section.pairingSystem, 'knockout');
  assert.equal(section.setupSources.scoring, 'tournament');
});

test('manual age exceptions and over-capacity assignments require explicit options and are logged', () => {
  resetStore();
  const section = store.newEvent({
    name: 'Juniors', startDate: '2027-01-10',
    ageScheme: { cutoffDate: '2027-01-01', bands: [{ id: 'u8', code: 'U8', label: 'Under 8', maxAge: 8 }] }
  }, { eligibilityBandId: 'u8', expectedPlayers: 1 });
  const event = store.activeEvent;
  const boundary = store.registerPlayer(event.id, { name: 'Boundary', byear: 2019 }, { emit: false });
  const second = store.registerPlayer(event.id, { name: 'Second', birthDate: '2020-05-01' }, { emit: false });

  assert.throws(() => store.assignRegistration(section.id, boundary.id, {}, { emit: false }), /review required/i);
  store.assignRegistration(section.id, boundary.id, {}, { eligibilityOverrideReason: 'Passport pending', emit: false });
  assert.equal(section.eligibilityOverrides.length, 1);
  assert.equal(section.eligibilityOverrides[0].reason, 'Passport pending');

  assert.throws(() => store.assignRegistration(section.id, second.id, {}, { emit: false }), /capacity/i);
  store.assignRegistration(section.id, second.id, {}, { allowOverCapacity: true, emit: false });
  assert.equal(section.players.length, 2);
});

test('age suggestions choose the youngest eligible linked section', () => {
  resetStore();
  const u8 = store.newEvent({
    name: 'Age Event', startDate: '2027-01-10',
    ageScheme: { cutoffDate: '2027-01-01', bands: [
      { id: 'u8', code: 'U8', label: 'Under 8', maxAge: 8 },
      { id: 'u12', code: 'U12', label: 'Under 12', maxAge: 12 },
      { id: 'open', code: 'OPEN', label: 'Open', open: true }
    ] }
  }, { sectionName: 'Under 8', eligibilityBandId: 'u8' });
  const event = store.activeEvent;
  store.addSection(event.id, { sectionName: 'Under 12', sectionCode: 'B', eligibilityBandId: 'u12' });
  store.addSection(event.id, { sectionName: 'Open', sectionCode: 'C', eligibilityBandId: 'open' });
  const player = store.registerPlayer(event.id, { name: 'Young', birthDate: '2021-02-01' }, { emit: false });

  const suggestion = store.suggestAssignments(event.id).suggestions.find(item => item.registrationId === player.id);
  assert.deepEqual(suggestion.childIds, [u8.id]);
});
