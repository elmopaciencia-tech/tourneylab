import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pairRound } from '../renderer/js/engine/dutch.js';
import {
  calculateRatingProjectionAfterRound,
  expectedScoreFide,
  roundFideRatingChange
} from '../renderer/js/engine/ratingProjection.js';

function tournament(over = {}) {
  return {
    id: 't',
    name: 'Projection Open',
    type: 'swiss',
    rounds: 4,
    startDate: '2026-07-01',
    fideMode: true,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    matchScoring: { win: 2, draw: 1, loss: 0 },
    pabValue: 'win',
    tiebreaks: ['BH'],
    players: [
      { id: 'p1', no: 1, name: 'Alice', rating: 1800 },
      { id: 'p2', no: 2, name: 'Bob', rating: 1800 },
      { id: 'p3', no: 3, name: 'Cara', rating: 1900 },
      { id: 'p4', no: 4, name: 'Unrated', rating: 0 }
    ],
    roundsData: [
      {
        round: 1,
        pairings: [
          { board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0', manual: false },
          { board: 2, whiteId: 'p3', blackId: 'p4', result: '1-0', manual: false }
        ],
        byes: []
      },
      {
        round: 2,
        pairings: [
          { board: 1, whiteId: 'p1', blackId: 'p3', result: '1/2-1/2', manual: false },
          { board: 2, whiteId: 'p2', blackId: 'p4', result: '1F-0F', manual: false }
        ],
        byes: [{ playerId: 'p4', type: 'HPB' }]
      }
    ],
    currentRound: 2,
    ...over
  };
}

test('FIDE expected-score lookup uses the table and rating-difference cap', () => {
  assert.equal(expectedScoreFide(1800, 1800), 0.5);
  assert.equal(expectedScoreFide(1900, 1800), 0.64);
  assert.equal(expectedScoreFide(1800, 1900), 0.36);
  assert.equal(expectedScoreFide(2000, 1200), 0.92);
  assert.equal(expectedScoreFide(2700, 2100), 0.98);
});

test('rating projection is cumulative, rounded once, and does not mutate ratings', () => {
  const t = tournament();
  const originalRatings = t.players.map(p => p.rating);

  const projections = calculateRatingProjectionAfterRound(t, 2);
  const alice = projections.get('p1');

  assert.deepEqual(t.players.map(p => p.rating), originalRatings);
  assert.equal(alice.baseRating, 1800);
  assert.equal(alice.rows.length, 2);
  assert.equal(alice.projectedChangeRaw, 12.8);
  assert.equal(alice.projectedChangeRounded, 13);
  assert.equal(alice.projectedRatingRounded, 1813);
  assert.equal(roundFideRatingChange(-2.5), -3);
});

test('fixed projection K-factors let a section control rating sensitivity', () => {
  const projections = calculateRatingProjectionAfterRound(tournament({
    ratingProjection: { kFactorMode: '10', customKFactor: 20 }
  }), 1);
  const alice = projections.get('p1');

  assert.equal(alice.kFactor, 10);
  assert.equal(alice.projectedChangeRaw, 5);
  assert.equal(alice.projectedRatingRounded, 1805);
});

test('custom projection K-factors retain Elo expected-score weighting', () => {
  const projections = calculateRatingProjectionAfterRound(tournament({
    ratingProjection: { kFactorMode: 'custom', customKFactor: 30 }
  }), 2);
  const alice = projections.get('p1');

  assert.equal(alice.kFactor, 30);
  assert.equal(alice.projectedChangeRaw, 19.2);
  assert.equal(alice.projectedRatingRounded, 1819);
});

test('projection ignores unrated opponents, byes, and unplayed forfeits', () => {
  const projections = calculateRatingProjectionAfterRound(tournament(), 2);

  assert.deepEqual(projections.get('p3').rows.map(row => row.round), [2]);
  assert.equal(projections.get('p2').rows.length, 1, 'forfeit win in round 2 is not rated');
  assert.equal(projections.get('p4').status, 'unrated');
  assert.equal(projections.get('p4').rows.length, 0);
});

test('rating projection does not change the next Swiss pairing output', () => {
  const t = tournament({
    roundsData: [
      {
        round: 1,
        pairings: [
          { board: 1, whiteId: 'p1', blackId: 'p4', result: '1-0', manual: false },
          { board: 2, whiteId: 'p2', blackId: 'p3', result: '0-1', manual: false }
        ],
        byes: []
      }
    ],
    currentRound: 1
  });

  const before = pairRound(t, 2).pairings;
  calculateRatingProjectionAfterRound(t, 1);
  const after = pairRound(t, 2).pairings;

  assert.deepEqual(after, before);
});
