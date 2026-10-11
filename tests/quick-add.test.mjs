import { test } from 'node:test';
import assert from 'node:assert/strict';

import { store } from '../renderer/js/store.js';

globalThis.window = {};

test('quick add parses comma-separated names and ignores blanks', () => {
  assert.equal(typeof store.parseQuickAddNames, 'function');

  assert.deepEqual(
    store.parseQuickAddNames(' Alice Smith, Bob Tan,,   Carol Lee  , '),
    ['Alice Smith', 'Bob Tan', 'Carol Lee']
  );
});

test('quick add detects existing and repeated names case-insensitively', () => {
  assert.equal(typeof store.findDuplicatePlayerNames, 'function');

  const t = { players: [
    { name: 'Alice Smith' },
    { name: 'Bob Tan' }
  ] };

  assert.deepEqual(
    store.findDuplicatePlayerNames(t, ['alice smith', 'Carol Lee', 'Carol Lee', 'BOB TAN']),
    ['alice smith', 'Carol Lee', 'BOB TAN']
  );
});

test('addPlayers creates defaults with sequential numbers and emits once', () => {
  assert.equal(typeof store.addPlayers, 'function');

  store.persist = () => {};
  store.data = { tournaments: [], settings: { backupGenerations: 3 }, activeId: null };
  store.listeners.clear();
  const t = store.newTournament({ defaultFed: 'USA' });

  store.listeners.clear();
  let emits = 0;
  store.subscribe(() => { emits++; });

  const added = store.addPlayers(t, [{ name: 'Alice Smith' }, { name: 'Bob Tan' }]);

  assert.equal(emits, 1);
  assert.equal(added.length, 2);
  assert.deepEqual(t.players.map(p => [p.no, p.name, p.fed, p.active]), [
    [1, 'Alice Smith', 'USA', true],
    [2, 'Bob Tan', 'USA', true]
  ]);
});

test('new tournaments include publishing metadata defaults', () => {
  store.persist = () => {};
  store.data = { tournaments: [], settings: { backupGenerations: 3 }, activeId: null };
  store.listeners.clear();

  const t = store.newTournament();

  assert.deepEqual(t.publish, {
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
  });
});
