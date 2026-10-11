import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultEvent, defaultSection } from '../renderer/js/setup/defaults.js';
import {
  migrateWorkspace,
  parseTournamentDocument,
  serializeEventDocument,
  WORKSPACE_SCHEMA_VERSION
} from '../renderer/js/setup/schema.js';
import { store } from '../renderer/js/store.js';

globalThis.window = {};

function resetStore() {
  store.persist = () => {};
  store.listeners.clear();
  store.data = migrateWorkspace({ tournaments: [] });
}

test('v2 migration creates canonical registrations and merges exact federation IDs only', () => {
  const event = defaultEvent({ id: 'e1', name: 'Festival', sectionIds: ['s1', 's2', 's3'] });
  delete event.registrations;
  delete event.childDefaults;
  const originalRound = {
    round: 1,
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p5', result: '1-0' }],
    byes: []
  };
  const workspace = {
    schemaVersion: 2,
    events: [event],
    tournaments: [
      defaultSection({
        id: 's1', eventId: 'e1', sectionOrder: 1,
        players: [
          { id: 'p1', no: 1, name: 'Alice Tan', fideId: '12345', ids: {}, rating: 1800 },
          { id: 'p5', no: 2, name: 'Opponent', fideId: '54321', ids: {}, rating: 1700 }
        ],
        roundsData: [originalRound], currentRound: 1
      }),
      defaultSection({
        id: 's2', eventId: 'e1', sectionOrder: 2,
        players: [
          { id: 'p2', no: 1, name: 'Alice T.', fideId: '12345', ids: {}, rating: 1810 },
          { id: 'p3', no: 2, name: 'Sam Lee', fideId: '', ids: {}, rating: 1400 }
        ]
      }),
      defaultSection({
        id: 's3', eventId: 'e1', sectionOrder: 3,
        players: [{ id: 'p4', no: 1, name: 'Sam Lee', fideId: '', ids: {}, rating: 1400 }]
      })
    ],
    activeId: 's1'
  };

  const migrated = migrateWorkspace(workspace);
  const [first, second, third] = migrated.tournaments;
  const migratedEvent = migrated.events[0];

  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 7);
  assert.equal(first.players[0].registrationId, second.players[0].registrationId);
  assert.notEqual(second.players[1].registrationId, third.players[0].registrationId);
  assert.equal(migratedEvent.registrations.length, 4);
  assert.equal(migratedEvent.registrationDuplicateCandidates.length, 1);
  assert.deepEqual(first.roundsData[0], originalRound);
  assert.equal(first.players[0].id, 'p1');

  const again = migrateWorkspace(migrated);
  assert.deepEqual(again, migrated);
});

test('event documents include registration pools and child defaults', () => {
  const event = defaultEvent({ id: 'e1', name: 'Festival' });
  event.registrations.push({ id: 'r1', name: 'Alice', rating: 1800, ids: {}, ratings: {} });
  event.childDefaults.rounds = 9;
  const section = defaultSection({ id: 's1', eventId: event.id });
  const document = serializeEventDocument(event, [section], section.id);
  const parsed = parseTournamentDocument(document);

  assert.equal(parsed.event.registrations[0].id, 'r1');
  assert.equal(parsed.event.childDefaults.rounds, 9);
  assert.equal('timeControl' in parsed.event.childDefaults, false);
});

test('workspace loading reconciles canonical registration ratings into started sections', () => {
  const event = defaultEvent({
    id: 'e1', name: 'Festival', sectionIds: ['s1'],
    registrations: [{ id: 'r1', name: 'Alice', rating: 1200, fed: 'SIN', ratings: {} }]
  });
  const roundsData = [{
    round: 1,
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }],
    byes: []
  }];
  const section = defaultSection({
    id: 's1', eventId: event.id, currentRound: 1, roundsData,
    players: [{ id: 'p1', no: 7, registrationId: 'r1', name: 'Alice', rating: 0, fed: 'SIN' }]
  });

  const migrated = migrateWorkspace({
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    events: [event], tournaments: [section], activeId: section.id
  });
  const migratedPlayer = migrated.tournaments[0].players[0];

  assert.equal(migratedPlayer.rating, 1200);
  assert.equal(migratedPlayer.no, 7);
  assert.deepEqual(migrated.tournaments[0].roundsData, roundsData);
  assert.deepEqual(migrateWorkspace(migrated), migrated);
});

test('store initialization persists same-version registration reconciliation', async () => {
  const event = defaultEvent({
    id: 'e1', name: 'Festival', sectionIds: ['s1'],
    registrations: [{ id: 'r1', name: 'Alice', rating: 1200, ratings: {} }]
  });
  const section = defaultSection({
    id: 's1', eventId: event.id, currentRound: 1,
    roundsData: [{ round: 1, pairings: [], byes: [] }],
    players: [{ id: 'p1', no: 1, registrationId: 'r1', name: 'Alice', rating: 0 }]
  });
  const loaded = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    events: [event], tournaments: [section], activeId: section.id
  };
  let saved = null;
  window.tl = {
    loadWorkspace: async () => loaded,
    saveWorkspace: async data => { saved = structuredClone(data); }
  };

  await store.init();

  assert.equal(store.data.tournaments[0].players[0].rating, 1200);
  assert.equal(saved.tournaments[0].players[0].rating, 1200);
  delete window.tl;
});

test('v3 migration keeps shared identity inheritance but preserves competition rules as section overrides', () => {
  const event = defaultEvent({
    id: 'e1', name: 'Festival', site: 'Main Hall', timeControl: '60+30',
    fideEventCode: 'EVENT-1', sectionIds: ['s1', 's2', 's3']
  });
  const migrated = migrateWorkspace({
    schemaVersion: 3,
    events: [event],
    tournaments: [
      defaultSection({ id: 's1', eventId: 'e1', site: 'Main Hall', timeControl: '60+30' }),
      defaultSection({ id: 's2', eventId: 'e1', site: 'Annex', timeControl: '15+10' }),
      defaultSection({ id: 's3', eventId: 'e1', site: 'Main Hall', timeControl: '60+30', roundsData: [{ pairings: [], byes: [] }] })
    ]
  });
  const [inherited, overridden, started] = migrated.tournaments;

  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(inherited.setupSources.site, 'tournament');
  assert.equal(inherited.setupSources.timeControl, 'section');
  assert.equal(inherited.fideEventCode, 'EVENT-1');
  assert.equal(overridden.setupSources.site, 'section');
  assert.equal(overridden.setupSources.timeControl, 'section');
  assert.equal(started.setupSources.site, 'section');
  assert.equal(started.setupSources.timeControl, 'section');
  assert.deepEqual(migrateWorkspace(migrated), migrated);
});

test('administrative tournament defaults stay live after pairing while pairing rules freeze', () => {
  resetStore();
  const first = store.newEvent({
    name: 'Festival',
    site: 'Hall A',
    startDate: '2027-06-01',
    endDate: '2027-06-02',
    timeControl: '60+30',
    ratingType: 'standard',
    rated: true,
    fideEventCode: 'E-1',
    fideReportCode: 'R-1'
  });
  const second = store.createChildTournament(first.eventId, { sectionName: 'Rapid', sectionCode: 'B' });

  store.setTournamentSetupDefault(first.eventId, 'site', 'Hall B', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'timeControl', '90+30', { emit: false });
  assert.equal(first.site, 'Hall B');
  assert.equal(second.timeControl, '90+30');

  store.setSectionSetupValue(second.id, 'timeControl', '15+10', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'timeControl', '120+30', { emit: false });
  assert.equal(first.timeControl, '120+30');
  assert.equal(second.timeControl, '15+10');
  assert.equal(store.sectionSetupSource(second, 'timeControl'), 'section');

  store.useTournamentSetupDefault(second.id, 'timeControl', { emit: false });
  assert.equal(second.timeControl, '120+30');
  store.freezeInheritedSectionSetup(second.id, { emit: false });
  assert.equal(second.setupSources.timeControl, 'tournament');
  second.roundsData.push({ pairings: [], byes: [] });
  store.setTournamentSetupDefault(first.eventId, 'timeControl', '180+30', { emit: false });
  assert.equal(second.timeControl, '180+30');
  assert.equal(store.sectionSetupSource(second, 'timeControl'), 'tournament');
  store.setSectionSetupValue(second.id, 'timeControl', '5+3', { emit: false });
  assert.equal(second.timeControl, '5+3');
  assert.equal(store.sectionSetupSource(second, 'timeControl'), 'section');
  store.useTournamentSetupDefault(second.id, 'timeControl', { emit: false });
  assert.equal(second.timeControl, '180+30');

  store.setTournamentSetupDefault(first.eventId, 'site', 'Hall C', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'startDate', '2027-06-03', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'endDate', '2027-06-04', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'fideEventCode', 'E-2', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'fideReportCode', 'R-2', { emit: false });
  store.setTournamentProfileValue(first.eventId, 'swiss', 'ratingType', 'rapid', { emit: false });
  store.setTournamentProfileValue(first.eventId, 'swiss', 'rated', false, { emit: false });
  store.setMasterSchedule(first.eventId, [
    { round: 1, date: '2027-06-03', time: '09:30', site: 'Hall C' },
    { round: 2, date: '2027-06-03', time: '14:30', site: 'Hall C' }
  ], { emit: false });

  assert.deepEqual(
    {
      site: second.site,
      startDate: second.startDate,
      endDate: second.endDate,
      ratingType: second.ratingType,
      rated: second.rated,
      fideEventCode: second.fideEventCode,
      fideReportCode: second.fideReportCode,
      roundTime: second.roundSchedule[0].time
    },
    {
      site: 'Hall C',
      startDate: '2027-06-03',
      endDate: '2027-06-04',
      ratingType: 'rapid',
      rated: false,
      fideEventCode: 'E-2',
      fideReportCode: 'R-2',
      roundTime: '09:30'
    }
  );

  store.setSectionSetupValue(second.id, 'site', 'Annex', { emit: false });
  store.setTournamentSetupDefault(first.eventId, 'site', 'Hall D', { emit: false });
  assert.equal(second.site, 'Annex');
  store.useTournamentSetupDefault(second.id, 'site', { emit: false });
  assert.equal(second.site, 'Hall D');

  assert.throws(() => store.setSectionSetupValue(second.id, 'pabValue', 'draw', { emit: false }), /locked/i);
  assert.throws(() => store.setSectionSetupValue(second.id, 'clubProtection', true, { emit: false }), /locked/i);
  assert.throws(() => store.setSectionSetupValue(second.id, 'scoring', { win: 3, draw: 1, loss: 0 }, { emit: false }), /locked/i);
});

test('section templates preserve overrides and board allocation skips started sections', () => {
  resetStore();
  const first = store.newEvent({ name: 'Festival', timeControl: '60+30' }, { sectionCode: 'A' });
  store.setSectionSetupValue(first.id, 'timeControl', '15+10', { emit: false });
  const clone = store.createChildTournament(first.eventId, { sectionName: 'Clone', sectionCode: 'B', sourceSectionId: first.id });
  const inherited = store.createChildTournament(first.eventId, { sectionName: 'Open', sectionCode: 'C' });
  first.roundsData.push({ pairings: [], byes: [] });

  assert.equal(clone.timeControl, '15+10');
  assert.equal(clone.setupSources.timeControl, 'section');
  assert.equal(inherited.timeControl, '60+30');
  assert.equal(inherited.setupSources.timeControl, 'tournament');
  assert.equal('timeControl' in store.activeEvent.childDefaults, false);

  const proposals = store.proposeSectionBoardAllocation(first.eventId, { startBoard: 10, padding: 1 });
  store.applySectionBoardAllocation(first.eventId, proposals);
  assert.equal(first.startingBoard, 1);
  assert.equal(clone.startingBoard, proposals.find(item => item.sectionId === clone.id).startingBoard);
  assert.ok(inherited.startingBoard > clone.startingBoard);
});

test('child creation snapshots defaults and templates without competition state', () => {
  resetStore();
  const source = store.newEvent({ name: 'Schools Festival' }, { rounds: 7, sectionCode: 'A' });
  source.scoring.win = 3;
  source.players.push({ id: 'p1', no: 1, name: 'Alice', rating: 1800 });
  source.teams.push({ id: 'team-1', members: [] });
  source.forbidden.push(['p1', 'p2']);
  source.roundsData.push({ round: 1, pairings: [], byes: [] });
  source.currentRound = 1;

  store.saveChildDefaultsFromChild(source.id);
  const fromDefaults = store.createChildTournament(source.eventId, {
    sectionName: 'U12', sectionCode: 'B'
  });
  const fromTemplate = store.createChildTournament(source.eventId, {
    sectionName: 'U10', sectionCode: 'C', sourceSectionId: source.id
  });

  assert.equal(fromDefaults.rounds, 7);
  assert.equal(fromDefaults.scoring.win, 3);
  store.activeEvent.childDefaults.rounds = 5;
  assert.equal(fromDefaults.rounds, 7);
  assert.deepEqual(fromTemplate.players, []);
  assert.deepEqual(fromTemplate.teams, []);
  assert.deepEqual(fromTemplate.forbidden, []);
  assert.deepEqual(fromTemplate.roundsData, []);
  assert.equal(fromTemplate.currentRound, 0);
});

test('bulk child creation validates atomically and reports eligibility overlap warnings', () => {
  resetStore();
  const first = store.newEvent({ name: 'Festival' }, { sectionCode: 'A' });
  const eventId = first.eventId;
  const before = store.childrenForEvent(eventId).length;

  assert.throws(() => store.createChildTournaments(eventId, [
    { sectionName: 'U12 A', sectionCode: 'B', eligibility: { birthYearMin: 2014 } },
    { sectionName: 'U12 B', sectionCode: 'B', eligibility: { birthYearMin: 2014 } }
  ]), /duplicate/i);
  assert.equal(store.childrenForEvent(eventId).length, before);

  const validation = store.validateChildRows(eventId, [
    { sectionName: 'Under 1600', sectionCode: 'B', startingBoard: 10, estimatedParticipants: 20, eligibility: { ratingMax: 1600 } },
    { sectionName: 'Junior Under 1800', sectionCode: 'C', startingBoard: 15, estimatedParticipants: 20, eligibility: { ratingMax: 1800, birthYearMin: 2014 } }
  ]);
  assert.equal(validation.errors.length, 0);
  assert.ok(validation.warnings.some(message => /eligibility overlap/i.test(message)));
  assert.ok(validation.warnings.some(message => /board/i.test(message)));

  const created = store.createChildTournaments(eventId, validation.rows);
  assert.equal(created.length, 2);
  assert.equal(store.childrenForEvent(eventId).length, before + 2);
});

test('registrations belong to one section and eligibility suggestions do not mutate rosters', () => {
  resetStore();
  const open = store.newEvent({ name: 'Festival' }, { sectionCode: 'A' });
  const junior = store.createChildTournament(open.eventId, {
    sectionName: 'Junior', sectionCode: 'B',
    ratingPolicy: { primary: 'national', fallback: 'rating', unratedValue: 0 },
    eligibility: { ratingMin: 1200, ratingMax: 1800, birthYearMin: 2014, birthYearMax: 2018 }
  });
  const alice = store.registerPlayer(open.eventId, {
    name: 'Alice', rating: 1500, byear: 2015, ratings: { national: 1600 }
  });
  const unrated = store.registerPlayer(open.eventId, { name: 'New Player', rating: 0, byear: 2015 });
  const noBirthYear = store.registerPlayer(open.eventId, { name: 'No Birth Year', rating: 1500 });

  store.assignRegistration(open.id, alice.id);
  assert.throws(() => store.assignRegistration(junior.id, alice.id), /another section/i);
  assert.equal(open.players[0].registrationId, alice.id);
  assert.equal(junior.players.length, 0);

  const preview = store.suggestAssignments(open.eventId, [junior.id]);
  assert.deepEqual(preview.suggestions.find(row => row.registrationId === alice.id).childIds, [junior.id]);
  assert.deepEqual(preview.suggestions.find(row => row.registrationId === unrated.id).childIds, []);
  assert.deepEqual(preview.suggestions.find(row => row.registrationId === noBirthYear.id).childIds, []);
  assert.equal(junior.players.length, 0, 'suggestions must not mutate child rosters');
});

test('single-section selection moves unstarted registrations and locks paired history', () => {
  resetStore();
  const open = store.newEvent({ name: 'Festival' }, { sectionName: 'Open', sectionCode: 'A' });
  const junior = store.createChildTournament(open.eventId, { sectionName: 'U12', sectionCode: 'B' });
  const registration = store.registerPlayer(open.eventId, { name: 'Alice', rating: 1500 });
  store.assignRegistration(open.id, registration.id);

  store.setRegistrationSection(open.eventId, registration.id, junior.id);
  assert.equal(open.players.length, 0);
  assert.equal(junior.players[0].registrationId, registration.id);

  junior.roundsData.push({ round: 1, pairings: [], byes: [] });
  junior.currentRound = 1;
  assert.throws(
    () => store.setRegistrationSection(open.eventId, registration.id, open.id),
    /locked after pairing/i
  );
  assert.equal(junior.players[0].withdrawn, false);
  assert.equal(open.players.length, 0);
});

test('registration updates propagate ratings without changing started section pairings or numbers', () => {
  resetStore();
  const section = store.newEvent({ name: 'Festival' });
  const registration = store.registerPlayer(section.eventId, {
    name: 'Alice', rating: 1500, fed: 'SGP', ratings: { national: 1550 }
  });
  const player = store.assignRegistration(section.id, registration.id);

  store.updateRegistration(section.eventId, registration.id, { name: 'Alice Tan', rating: 1600 });
  assert.equal(player.name, 'Alice Tan');
  assert.equal(player.rating, 1600);

  section.roundsData.push({
    round: 1,
    pairings: [{ board: 1, whiteId: player.id, blackId: 'opponent', result: '1-0' }],
    byes: []
  });
  section.currentRound = 1;
  const roundsBeforeUpdate = structuredClone(section.roundsData);
  const pairingNumberBeforeUpdate = player.no;

  store.updateRegistration(section.eventId, registration.id, {
    name: 'Alice T.', rating: 1700, fed: 'MAS', ratings: { national: 1750 }
  });

  assert.equal(player.name, 'Alice T.');
  assert.equal(player.fed, 'MAS');
  assert.equal(player.rating, 1700);
  assert.equal(player.ratings.national, 1750);
  assert.equal(player.no, pairingNumberBeforeUpdate);
  assert.deepEqual(section.roundsData, roundsBeforeUpdate);
});

test('unassignment removes an unstarted entry and a started withdrawal can be reinstated', () => {
  resetStore();
  const first = store.newEvent({ name: 'Festival' });
  const second = store.createChildTournament(first.eventId, { sectionName: 'B', sectionCode: 'B' });
  const firstRegistration = store.registerPlayer(first.eventId, { name: 'Alice', rating: 1500 });
  const secondRegistration = store.registerPlayer(first.eventId, { name: 'Bob', rating: 1400 });
  store.assignRegistration(first.id, firstRegistration.id);
  store.assignRegistration(second.id, secondRegistration.id);

  assert.equal(store.unassignRegistration(first.id, firstRegistration.id).action, 'removed');
  assert.equal(first.players.length, 0);

  second.roundsData.push({ round: 1, pairings: [], byes: [] });
  second.currentRound = 1;
  assert.equal(store.unassignRegistration(second.id, secondRegistration.id).action, 'withdrawn');
  assert.equal(second.players[0].withdrawn, true);
  assert.equal(second.players[0].active, false);

  const roundsBeforeReinstatement = structuredClone(second.roundsData);
  const reinstated = store.reinstateRegistration(second.id, secondRegistration.id);
  assert.equal(reinstated.withdrawn, false);
  assert.equal(reinstated.active, true);
  assert.deepEqual(second.roundsData, roundsBeforeReinstatement);
  assert.throws(() => store.reinstateRegistration(second.id, secondRegistration.id), /not withdrawn/i);
});

test('team child assignments create registration-backed roster members with local board data', () => {
  resetStore();
  const individual = store.newEvent({ name: 'Festival' });
  const teamSection = store.createChildTournament(individual.eventId, {
    sectionName: 'Teams', sectionCode: 'T', type: 'team-swiss'
  });
  const team = store.addPlayer(teamSection, { name: 'North School' });
  const registration = store.registerPlayer(individual.eventId, { name: 'Alice', rating: 1500 });
  const rosterPlayer = store.assignRegistration(teamSection.id, registration.id, {
    teamPlayerId: team.id,
    board: 2,
    reserve: false
  });

  assert.equal(teamSection.players.length, 1, 'team entities stay child-local');
  assert.equal(teamSection.rosterPlayers[0].registrationId, registration.id);
  assert.equal(teamSection.teams[0].playerId, team.id);
  assert.deepEqual(teamSection.teams[0].members[0], {
    rosterId: rosterPlayer.id,
    board: 2,
    reserve: false
  });
});
