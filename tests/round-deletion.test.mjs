import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../renderer/js/store.js';

globalThis.window = {};

test('deleting an ongoing round preserves earlier results and resets the next round', () => {
  const completed = { pairings: [{ whiteId: 'a', blackId: 'b', result: '1-0' }], byes: [] };
  const section = { currentRound: 2, roundsData: [completed, {
    pairings: [{ whiteId: 'b', blackId: 'a', result: '' }],
    byes: [{ playerId: 'c', type: 'PAB' }]
  }] };
  store.deleteFromRound(section, 2);
  assert.deepEqual(section.roundsData, [completed]);
  assert.equal(section.currentRound, 1);
  store.deleteFromRound(section, 1);
  assert.deepEqual(section.roundsData, []);
  assert.equal(section.currentRound, 0);
});

test('deleting an earlier round also removes dependent later rounds', () => {
  const section = { currentRound: 3, roundsData: [{ pairings: [] }, { pairings: [] }, { pairings: [] }] };
  store.deleteFromRound(section, 2);
  assert.equal(section.roundsData.length, 1);
  assert.equal(section.currentRound, 1);
});
