import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../renderer/js/store.js';
import { migrateWorkspace } from '../renderer/js/setup/schema.js';

globalThis.window = {};
function fixture() {
  store.persist = () => {};
  store.listeners.clear();
  store.data = migrateWorkspace({ tournaments: [] });
  const source = store.newEvent({ name: 'Board test' }, { sectionCode: 'A' });
  const target = store.createChildTournament(source.eventId, { sectionName: 'Target', sectionCode: 'B', expectedPlayers: 1 });
  const registrations = ['Alice', 'Bob'].map(name => store.registerPlayer(source.eventId, { name, rating: 1500 }));
  registrations.forEach(registration => store.assignRegistration(source.id, registration.id));
  source.players[0].requestedByes = { 2: 0.5 };
  source.players[0].no = 17;
  source.teams = [{ id: 'team', members: [{ rosterId: source.players[0].id, board: 1 }] }];
  return { source, target, registrations, moves: registrations.map(({id}) => ({id, sectionId: target.id})) };
}

test('failed group move restores exact player IDs, numbers, byes, and team memberships without emitting', () => {
  const {source, moves} = fixture();
  const before = structuredClone(store.data);
  let emissions = 0;
  store.subscribe(() => emissions++);
  assert.throws(() => store.moveRegistrations(source.eventId, moves), /capacity/);
  assert.deepEqual(store.data, before);
  assert.equal(emissions, 0);
});

test('successful group move emits once and can be moved back as a group', () => {
  const {source, target, registrations, moves} = fixture();
  target.expectedPlayers = 2;
  let emissions = 0;
  store.subscribe(() => emissions++);
  store.moveRegistrations(source.eventId, moves);
  assert.equal(source.players.length, 0);
  assert.deepEqual(target.players.map(player => player.registrationId), registrations.map(player => player.id));
  assert.equal(emissions, 1);
  store.moveRegistrations(source.eventId, registrations.map(({id}) => ({id, sectionId: source.id})), {allowOverCapacity:true});
  assert.equal(target.players.length, 0);
  assert.equal(source.players.length, 2);
  assert.equal(emissions, 2);
});

test('a later locked assignment rolls back earlier moves, including moves into a started section', () => {
  const {source, target, registrations} = fixture();
  const locked = store.createChildTournament(source.eventId, {sectionName:'Locked', sectionCode:'C'});
  store.setRegistrationSection(source.eventId, registrations[1].id, locked.id);
  locked.currentRound = 1;
  locked.roundsData = [{ round: 1, pairings: [], byes: [] }];
  target.expectedPlayers = 3;
  target.currentRound = 1;
  target.roundsData = [{ round: 1, pairings: [], byes: [] }];
  const before = structuredClone(store.data);
  assert.throws(() => store.moveRegistrations(source.eventId, registrations.map(({id}) => ({id,sectionId:target.id}))), /locked/);
  assert.deepEqual(store.data, before);
});
