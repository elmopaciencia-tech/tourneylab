// TourneyLab engine tests (node:test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pairRound, pairRemainder, bakuVirtualPoints, checkManualPair, suggestPairColours } from '../renderer/js/engine/dutch.js';
import { computeStates, pairingChecklist, roundReadiness, pairablePlayers, byePoints, RESULTS } from '../renderer/js/engine/state.js';
import { bergerSchedule, simultaneousSchedule } from '../renderer/js/engine/roundrobin.js';
import { computeStandings, TIEBREAKS, visibleRankLabels } from '../renderer/js/engine/tiebreaks.js';
import { pairSection } from '../renderer/js/engine/pairing.js';
import { allocateTeamColours } from '../renderer/js/engine/c046.js';
import { pairOlympiad } from '../renderer/js/engine/olympiad.js';
import { pairDoubleSwiss } from '../renderer/js/engine/double-swiss.js';
import { pairingCardsHTML, teamMatchCardsHTML } from '../renderer/js/export.js';

// ----------------------------------------------------------------- helpers

function makeTournament(n, { rounds = 7, fideMode = true, acceleration = 'none' } = {}) {
  const players = [];
  for (let i = 1; i <= n; i++) {
    players.push({ id: `p${i}`, no: i, name: `Player ${i}`, rating: 2200 - i * 10 });
  }
  return {
    id: 't1', name: 'Test Open', type: 'swiss',
    players, roundsData: [], rounds,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    matchScoring: { win: 2, draw: 1, loss: 0 },
    pabValue: 'win', fideMode, byeWeakest: false,
    clubProtection: false, forbidden: [],
    initialColor: 'W', acceleration,
    tiebreaks: ['BH', 'BHC1', 'SB', 'WINS'],
    currentRound: 0,
  };
}

function makeStandingsOnlyTournament(players, tiebreaks = []) {
  return {
    id: 'rank-test',
    name: 'Rank Test',
    type: 'swiss',
    players,
    roundsData: [],
    rounds: 0,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    matchScoring: { win: 2, draw: 1, loss: 0 },
    pabValue: 'win',
    fideMode: true,
    tiebreaks,
    currentRound: 0
  };
}

// Deterministic result generator: higher pairing number (lower no) wins,
// every 5th board is a draw — enough variety to spread the score table.
function autoResults(t, round) {
  const rd = t.roundsData[round - 1];
  rd.pairings.forEach((pr, i) => {
    if (i % 5 === 4) { pr.result = '1/2-1/2'; return; }
    const w = t.players.find(p => p.id === pr.whiteId);
    const b = t.players.find(p => p.id === pr.blackId);
    pr.result = w.no < b.no ? '1-0' : '0-1';
  });
}

function playRound(t, round, resultFn = autoResults) {
  const res = pairRound(t, round);
  assert.equal(res.ok, true, `round ${round} should pair: ${res.warnings.join('; ')}`);
  t.roundsData[round - 1] = {
    round,
    pairings: res.pairings.map((p, i) => ({ board: i + 1, whiteId: p.whiteId, blackId: p.blackId, result: null })),
    byes: res.bye ? [res.bye] : [],
  };
  resultFn(t, round);
  t.currentRound = round;
  return res;
}

// ----------------------------------------------------------------- Swiss core

test('full 7-round Swiss (16 players): legality invariants', () => {
  const t = makeTournament(16);
  for (let r = 1; r <= 7; r++) playRound(t, r);

  const seen = new Set();
  for (const rd of t.roundsData) {
    const inRound = new Set();
    for (const pr of rd.pairings) {
      // no player paired twice in a round
      assert.ok(!inRound.has(pr.whiteId) && !inRound.has(pr.blackId), 'player paired twice in one round');
      inRound.add(pr.whiteId); inRound.add(pr.blackId);
      // no repeated opponents across the tournament
      const key = [pr.whiteId, pr.blackId].sort().join('|');
      assert.ok(!seen.has(key), `repeat pairing ${key}`);
      seen.add(key);
    }
    // even field, no byes expected
    assert.equal(rd.pairings.length, 8);
    assert.equal(rd.byes.length, 0);
  }

  // colour balance: nobody exceeds ±2 and nobody got 3 same colours in a row
  const states = computeStates(t, 7);
  for (const p of t.players) {
    const s = states.get(p.id);
    assert.ok(Math.abs(s.colorDiff) <= 2, `${p.id} colour diff ${s.colorDiff}`);
    const c = s.colors.join('');
    assert.ok(!c.includes('WWW') && !c.includes('BBB'), `${p.id} three same colours in a row (${c})`);
  }
});

test('round 1: top half plays bottom half, initial colour alternates', () => {
  const t = makeTournament(8);
  const res = pairRound(t, 1);
  assert.equal(res.ok, true);
  assert.equal(res.pairings.length, 4);
  const no = id => t.players.find(p => p.id === id).no;
  for (const pr of res.pairings) {
    const a = no(pr.whiteId), b = no(pr.blackId);
    // one side from S1 (1–4), other from S2 (5–8)
    assert.ok((a <= 4) !== (b <= 4), `R1 pairing ${a} vs ${b} not S1 vs S2`);
  }
  // alternation: colours of S1 players alternate down the board order
  const s1Colors = res.pairings.map(pr => (no(pr.whiteId) <= 4 ? 'W' : 'B'));
  for (let i = 1; i < s1Colors.length; i++) {
    assert.notEqual(s1Colors[i], s1Colors[i - 1], 'round-1 colours should alternate');
  }
});

// ----------------------------------------------------------------- byes (PAB)

test('odd field: PAB goes to an eligible lowest player and never repeats', () => {
  const t = makeTournament(9, { rounds: 5 });
  const byeHolders = [];
  for (let r = 1; r <= 5; r++) {
    const res = playRound(t, r);
    assert.ok(res.bye, `round ${r} should have a bye`);
    assert.equal(res.bye.type, 'PAB');
    byeHolders.push(res.bye.playerId);
  }
  // No player receives the PAB twice
  assert.equal(new Set(byeHolders).size, byeHolders.length, 'PAB repeated');
  // PAB is worth a full point with pabValue: 'win'
  const states = computeStates(t, 5);
  const s = states.get(byeHolders[0]);
  assert.ok(s.byeRounds.some(b => b.type === 'PAB'));
  assert.equal(byePoints('PAB', t), 1);
});

test('a player with an unplayed full-point win is not eligible for PAB', () => {
  const t = makeTournament(5, { rounds: 3 });
  // Round 1 manually: p5 wins by forfeit, p1–p2, p3–p4 played; bye nobody (even after forfeit? field is odd → craft it)
  // 5 players: pair p1-p2, p3-p4, give p5... we need p5 to have a forfeit WIN, so pair p5 vs p4 as forfeit and bye p3? Keep it simple:
  t.roundsData[0] = {
    round: 1,
    pairings: [
      { board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' },
      { board: 2, whiteId: 'p5', blackId: 'p4', result: '1F-0F' }, // p5 unplayed full-point win
    ],
    byes: [{ playerId: 'p3', type: 'PAB' }],
  };
  t.currentRound = 1;
  const res = pairRound(t, 2);
  assert.equal(res.ok, true);
  assert.ok(res.bye, 'odd field needs a bye');
  assert.notEqual(res.bye.playerId, 'p5', 'forfeit winner must not get the PAB');
  assert.notEqual(res.bye.playerId, 'p3', 'previous PAB holder must not get it again');
});

test('forfeits record the opponent (no rematch) but no colour history', () => {
  const t = makeTournament(4, { rounds: 3 });
  t.roundsData[0] = {
    round: 1,
    pairings: [
      { board: 1, whiteId: 'p1', blackId: 'p2', result: '1F-0F' },
      { board: 2, whiteId: 'p3', blackId: 'p4', result: '1-0' },
    ],
    byes: [],
  };
  const states = computeStates(t, 1);
  const s1 = states.get('p1');
  assert.ok(s1.opponents.has('p2'), 'forfeit opponent recorded');
  assert.equal(s1.colors.length, 0, 'forfeit must not add colour history');
  assert.equal(s1.fullPointUnplayed, true);
  assert.equal(s1.score, 1);
  assert.equal(states.get('p2').score, 0);
  // and the engine must not re-pair p1 vs p2 in round 2
  const res = pairRound(t, 2);
  assert.equal(res.ok, true);
  for (const pr of res.pairings) {
    const k = [pr.whiteId, pr.blackId].sort().join('|');
    assert.notEqual(k, 'p1|p2', 'forfeited pairing repeated');
  }
});

// ----------------------------------------------------------------- readiness

test('empty results block the next round; adjourned blocks only later rounds', () => {
  const t = makeTournament(4, { rounds: 4 });
  t.roundsData[0] = {
    round: 1,
    pairings: [
      { board: 1, whiteId: 'p1', blackId: 'p2', result: null },
      { board: 2, whiteId: 'p3', blackId: 'p4', result: '1-0' },
    ],
    byes: [],
  };
  let r = roundReadiness(t, 2);
  assert.equal(r.ok, false, 'empty result must block pairing');
  assert.equal(r.summary, 'Enter 1 missing result in Round 1.');

  t.roundsData[0].pairings[0].result = 'ADJ';
  r = roundReadiness(t, 2);
  assert.equal(r.ok, true, 'adjourned game allows the immediately following round');
  assert.equal(r.summary, '');
  assert.ok(r.warnings.length > 0, 'with a warning');

  // pairing round 3 while round 1 still adjourned must be blocked
  t.roundsData[1] = { round: 2, pairings: [
    { board: 1, whiteId: 'p1', blackId: 'p3', result: '1-0' },
    { board: 2, whiteId: 'p2', blackId: 'p4', result: '0-1' },
  ], byes: [] };
  r = roundReadiness(t, 3);
  assert.equal(r.ok, false, 'unresolved adjourned game blocks rounds beyond the next');
});

test('adjourned game counts as a draw for the next pairing', () => {
  const t = makeTournament(4);
  t.roundsData[0] = { round: 1, pairings: [
    { board: 1, whiteId: 'p1', blackId: 'p2', result: 'ADJ' },
    { board: 2, whiteId: 'p3', blackId: 'p4', result: '1-0' },
  ], byes: [] };
  const states = computeStates(t, 1);
  assert.equal(states.get('p1').score, 0.5);
  assert.equal(states.get('p2').score, 0.5);
});

test('unusual results (forfeit draw etc.) are blocked in FIDE mode only', () => {
  const t = makeTournament(4);
  t.roundsData[0] = { round: 1, pairings: [
    { board: 1, whiteId: 'p1', blackId: 'p2', result: '0-0' },
    { board: 2, whiteId: 'p3', blackId: 'p4', result: '1-0' },
  ], byes: [] };
  assert.equal(roundReadiness(t, 2).ok, false, 'FIDE mode blocks unusual results');
  t.fideMode = false;
  assert.equal(roundReadiness(t, 2).ok, true, 'non-FIDE mode allows them');
});

// ----------------------------------------------------------------- exclusions

test('requested byes and exclusions remove players from the pairable field', () => {
  const t = makeTournament(8);
  t.players[0].requestedByes = { 1: 'HPB' };
  t.players[1].excludedRounds = [1];
  t.players[2].withdrawn = true;
  const list = pairablePlayers(t, 1);
  const ids = new Set(list.map(p => p.id));
  assert.ok(!ids.has('p1') && !ids.has('p2') && !ids.has('p3'));
  assert.equal(list.length, 5);
});

// ----------------------------------------------------------------- forbidden / manual

test('forbidden pairings are respected', () => {
  const t = makeTournament(4);
  t.forbidden = [['p1', 'p3']]; // p1's natural R1 opponent in a 4-player field
  const res = pairRound(t, 1);
  assert.equal(res.ok, true);
  for (const pr of res.pairings) {
    const k = [pr.whiteId, pr.blackId].sort().join('|');
    assert.notEqual(k, 'p1|p3', 'forbidden pair was produced');
  }
});

test('soft administrative restrictions may be broken only to complete the round', () => {
  const hard = makeTournament(2);
  hard.forbidden = [['p1', 'p2']];
  hard.restrictionPolicy = 'hard';
  assert.equal(pairRound(hard, 1).ok, false);

  const soft = makeTournament(2);
  soft.forbidden = [['p1', 'p2']];
  soft.restrictionPolicy = 'soft';
  const result = pairRound(soft, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.pairings.map(pairing => [pairing.whiteId, pairing.blackId].sort()), [['p1', 'p2']]);
  assert.ok(result.warnings.some(message => /soft restriction/i.test(message)));
});

test('checkManualPair flags repeats', () => {
  const t = makeTournament(4);
  t.roundsData[0] = { round: 1, pairings: [
    { board: 1, whiteId: 'p1', blackId: 'p3', result: '1-0' },
    { board: 2, whiteId: 'p2', blackId: 'p4', result: '1-0' },
  ], byes: [] };
  const chk = checkManualPair(t, 2, 'p1', 'p3');
  assert.ok(chk.length > 0, 'manual repeat should warn');
  assert.ok(chk.some(x => /Constraint/.test(x)), 'repeat reported as constraint violation');
  const ok = checkManualPair(t, 2, 'p1', 'p2');
  assert.ok(!ok.some(x => /Constraint/.test(x)), 'legal manual pair has no constraint issue');
});

// ----------------------------------------------------------------- acceleration

test('Baku virtual points: top half boosted for the first half of a 9-round event', () => {
  const t = makeTournament(16, { rounds: 9, acceleration: 'baku' });
  const accel = bakuVirtualPoints(t, 1);
  assert.equal(accel.size, 8, 'top half (8 of 16) receives a virtual point');
  for (let i = 1; i <= 8; i++) assert.equal(accel.get(`p${i}`), 1);
  // not applied to short events
  const t2 = makeTournament(16, { rounds: 7, acceleration: 'baku' });
  assert.equal(bakuVirtualPoints(t2, 1).size, 0, 'Baku requires 9+ rounds');
});

// ----------------------------------------------------------------- round robin

test('Berger schedule: everyone plays everyone exactly once', () => {
  for (const n of [6, 7, 8]) {
    const sched = bergerSchedule(n);
    const odd = n % 2 === 1;
    assert.equal(sched.length, odd ? n : n - 1, `n=${n}: round count`);
    const met = new Set();
    let byes = 0;
    for (const rd of sched) {
      const used = new Set();
      for (const g of rd) {
        if (g.bye !== undefined) { byes++; assert.ok(!used.has(g.bye)); used.add(g.bye); continue; }
        assert.ok(!used.has(g.white) && !used.has(g.black), 'seat reused in a round');
        used.add(g.white); used.add(g.black);
        const k = [g.white, g.black].sort((x, y) => x - y).join('|');
        assert.ok(!met.has(k), `n=${n}: repeat meeting ${k}`);
        met.add(k);
      }
    }
    assert.equal(met.size, n * (n - 1) / 2, `n=${n}: all meetings happen`);
    if (odd) assert.equal(byes, n, `n=${n}: one bye per round`);
  }
});

test('simultaneous schedule: seat 1 against all others in one session', () => {
  const sched = simultaneousSchedule(5);
  assert.equal(sched.length, 1);
  const opps = sched[0].map(g => (g.white === 1 ? g.black : g.white)).sort();
  assert.deepEqual(opps, [2, 3, 4, 5]);
  for (const g of sched[0]) assert.ok(g.white === 1 || g.black === 1);
});

// ----------------------------------------------------------------- tiebreaks

test('standings: ordered by score, tiebreaks computed, wins counted', () => {
  const t = makeTournament(8, { rounds: 3 });
  for (let r = 1; r <= 3; r++) playRound(t, r);
  const rows = computeStandings(t, 3);
  assert.equal(rows.length, 8);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].score >= rows[i].score, 'standings not sorted by score');
  }
  for (const row of rows) {
    assert.ok(Number.isFinite(row.tbs.BH), 'Buchholz computed');
    assert.ok(Number.isFinite(row.tbs.SB), 'Sonneborn-Berger computed');
    assert.ok(Number.isInteger(row.tbs.WINS), 'wins computed');
  }
  // sanity: total score equals number of decisive points distributed
  const total = rows.reduce((a, r) => a + r.score, 0);
  assert.equal(total, 3 * 4, 'each round distributes 4 points across 4 boards');
});

test('standings: unresolved ties keep unique order but print shared rank ranges', () => {
  const t = makeStandingsOnlyTournament([
    { id: 'p1', no: 1, name: 'Alpha', rating: 1800 },
    { id: 'p2', no: 2, name: 'Beta', rating: 1700 },
    { id: 'p3', no: 3, name: 'Gamma', rating: 1600 }
  ]);

  const rows = computeStandings(t, 0);

  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3]);
  assert.deepEqual(rows.map(r => r.rankLabel), ['1-3', '1-3', '1-3']);
  assert.deepEqual(visibleRankLabels(rows), ['1-3', '1-3', '1-3']);
  assert.equal(new Set(rows.map(r => r.tieGroupId)).size, 1);
});

test('standings: the next visible rank skips every unresolved tied place', () => {
  const t = makeStandingsOnlyTournament([
    { id: 'p1', no: 1, name: 'Alpha', rating: 1800, addedPoints: 1 },
    { id: 'p2', no: 2, name: 'Beta', rating: 1700, addedPoints: 1 },
    { id: 'p3', no: 3, name: 'Gamma', rating: 1600, addedPoints: 0 }
  ]);

  const rows = computeStandings(t, 0);

  assert.deepEqual(rows.map(r => r.player.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3]);
  assert.deepEqual(rows.map(r => r.rankLabel), ['1-2', '1-2', '3']);
});

test('standings: rankCorrection breaks an otherwise unresolved tie', () => {
  const t = makeStandingsOnlyTournament([
    { id: 'p1', no: 1, name: 'Alpha', rating: 1800, rankCorrection: 2 },
    { id: 'p2', no: 2, name: 'Beta', rating: 1700, rankCorrection: 1 }
  ]);

  const rows = computeStandings(t, 0);

  assert.deepEqual(rows.map(r => r.player.id), ['p2', 'p1']);
  assert.deepEqual(rows.map(r => r.rankLabel), ['1', '2']);
  assert.equal(new Set(rows.map(r => r.tieGroupId)).size, 2);
});

test('TIEBREAK registry exposes the documented systems', () => {
  for (const k of ['BH', 'BHC1', 'BHM', 'SB', 'KOYA', 'WINS', 'DE', 'BLK', 'AROC', 'PERF']) {
    assert.ok(TIEBREAKS[k], `missing tiebreak ${k}`);
  }
});

// ----------------------------------------------------------------- results table

test('result table semantics match pairingLogic.md', () => {
  assert.deepEqual([RESULTS['1-0'].w, RESULTS['1-0'].b], ['win', 'loss']);
  assert.equal(RESULTS['1/2-1/2'].played, true);
  assert.equal(RESULTS['1F-0F'].played, false);
  assert.equal(RESULTS['0F-0F'].played, false);
  assert.equal(RESULTS['ADJ'].adjourned, true);
  assert.equal(RESULTS['0-0'].unusual, true, 'unusual results flagged');
  assert.equal(RESULTS['1/2-0'].unusual, true);
});

// ----------------------------------------------------------------- bigger smoke

test('excludeIds leaves the rest of the field paired and a full call unchanged', () => {
  const t = makeTournament(8);
  const full = pairRound(t, 1);
  const again = pairRound(t, 1, { excludeIds: [] });
  assert.deepEqual(again.pairings, full.pairings);
  assert.deepEqual(again.bye, full.bye);

  const partial = pairRound(t, 1, { excludeIds: new Set(['p1', 'p2']) });
  assert.equal(partial.ok, true);
  assert.equal(partial.bye, null);
  const ids = partial.pairings.flatMap(p => [p.whiteId, p.blackId]);
  assert.deepEqual([...new Set(ids)].sort(), ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
});

test('pairRemainder keeps preset pairs and byes only the remainder', () => {
  const t = makeTournament(7);
  const locked = [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '', manual: true, rated: true }];
  const res = pairRemainder(t, 1, { pairings: locked, byes: [] });
  assert.equal(res.ok, true);
  assert.equal(res.kept[0], locked[0]);
  assert.equal(res.pairings.length, 2);
  assert.equal(res.bye?.type, 'PAB');
  const used = new Set(res.pairings.flatMap(p => [p.whiteId, p.blackId]));
  used.add(res.bye.playerId);
  assert.deepEqual([...used].sort(), ['p3', 'p4', 'p5', 'p6', 'p7']);
});

test('pairRemainder keeps a half-point bye and releases a pairing-allocated bye', () => {
  const t = makeTournament(6);
  const locked = [{ board: 1, whiteId: 'p1', blackId: 'p2', manual: true }];
  const half = pairRemainder(t, 1, {
    pairings: locked,
    byes: [{ playerId: 'p3', type: 'HPB' }]
  });
  assert.equal(half.ok, true);
  assert.deepEqual(half.keptByes, [{ playerId: 'p3', type: 'HPB' }]);
  const halfIds = new Set([
    ...half.pairings.flatMap(p => [p.whiteId, p.blackId]),
    half.bye?.playerId
  ].filter(Boolean));
  assert.equal(halfIds.has('p3'), false);
  assert.deepEqual([...halfIds].sort(), ['p4', 'p5', 'p6']);

  const byes = [{ playerId: 'p3', type: 'PAB' }];
  const released = pairRemainder(t, 1, { pairings: locked, byes });
  assert.equal(released.ok, true);
  assert.deepEqual(released.keptByes, []);
  assert.equal(released.bye, null);
  const ids = released.pairings.flatMap(p => [p.whiteId, p.blackId]);
  assert.deepEqual([...new Set(ids)].sort(), ['p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(byes, [{ playerId: 'p3', type: 'PAB' }]);
});

test('suggestPairColours offers the engine colour first and the swap second', () => {
  const t = makeTournament(4);
  t.initialColor = 'white';
  const colours = suggestPairColours(t, 1, 'p1', 'p2');
  assert.deepEqual(colours.preferred, { whiteId: 'p1', blackId: 'p2' });
  assert.deepEqual(colours.alternative, { whiteId: 'p2', blackId: 'p1' });
});

test('pairing checklist reads preference, floats, played opponents, and bye eligibility', () => {
  const t = makeTournament(9);
  const blank = pairingChecklist(t, 1);
  assert.equal(blank.length, 9);
  assert.deepEqual(blank.map(row => row.no), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const row of blank) {
    assert.equal(row.score, 0);
    assert.equal(row.colors, '');
    assert.equal(row.preference, '');
    assert.equal(row.float1, '');
    assert.equal(row.float2, '');
    assert.deepEqual(row.opponents, []);
    assert.equal(row.noPab, false);
  }
  assert.deepEqual(pairingChecklist({ ...t, type: 'roundrobin' }, 1), []);

  const game = (board, whiteId, blackId, result) => ({ board, whiteId, blackId, result });
  // p1 plays black, then white, then white: difference 1 and two whites in a row → B1.
  // p4 up-floats in round 2 (from 0 against 1) and down-floats in round 3 (from 1 against 0.5).
  // p7's forfeit is not an opponent; the later played game is. p9's pairing-allocated bye is neither.
  t.roundsData = [
    {
      pairings: [
        game(1, 'p2', 'p1', '0-1'),
        game(2, 'p3', 'p4', '1-0'),
        game(3, 'p5', 'p6', '1/2-1/2'),
        game(4, 'p7', 'p8', '1F-0F')
      ],
      byes: [{ playerId: 'p9', type: 'PAB' }]
    },
    {
      pairings: [
        game(1, 'p1', 'p5', '1-0'),
        game(2, 'p4', 'p3', '1-0'),
        game(3, 'p7', 'p6', '1-0'),
        game(4, 'p2', 'p8', '1/2-1/2')
      ],
      byes: []
    },
    {
      pairings: [
        game(1, 'p1', 'p3', '1-0'),
        game(2, 'p8', 'p4', '0-1')
      ],
      byes: []
    }
  ];

  const rows = pairingChecklist(t, 4);
  const row = id => rows.find(item => item.id === id);
  assert.equal(row('p1').preference, 'B1');
  assert.equal(row('p1').colors, 'BWW');
  assert.equal(row('p1').noPab, false);
  assert.equal(row('p4').float1, 'down');
  assert.equal(row('p4').float2, 'up');
  assert.equal(row('p9').noPab, true);
  assert.deepEqual(row('p9').opponents, []);
  assert.deepEqual(row('p7').opponents, [6]);
  assert.equal(row('p7').noPab, true);
  assert.deepEqual(rows.map(item => item.id), ['p1', 'p4', 'p7', 'p3', 'p9', 'p2', 'p5', 'p6', 'p8']);
});

test('an unpaired pairable player blocks the next round', () => {
  const t = makeTournament(4);
  t.roundsData[0] = {
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }],
    byes: []
  };
  const blocked = roundReadiness(t, 2);
  assert.equal(blocked.ok, false);
  assert.match(blocked.summary, /Pair or bye 2 unpaired players in Round 1/);
  t.roundsData[0].byes = [
    { playerId: 'p3', type: 'HPB' },
    { playerId: 'p4', type: 'ZPB' }
  ];
  assert.equal(roundReadiness(t, 2).ok, true);
});

function pairKey(pairings) {
  return pairings.map(pr => [pr.whiteId, pr.blackId].sort().join('-')).sort().join('|');
}

test('FIDE Dutch ignores the non-FIDE switches', () => {
  const plain = pairRound(makeTournament(8), 1);
  const switched = makeTournament(8);
  switched.ignoreColour = true;
  switched.pairByTiebreak = true;
  switched.players[7].rankCorrection = -50;
  const altered = pairRound(switched, 1, { ignoreColour: true, pairByTiebreak: true });
  assert.equal(altered.ok, true);
  assert.equal(pairKey(altered.pairings), pairKey(plain.pairings));
});

test('ignore colour allows an absolute colour clash outside FIDE mode', () => {
  const t = makeTournament(4, { fideMode: false });
  t.roundsData = [
    {
      pairings: [
        { whiteId: 'p1', blackId: 'p2', result: '1-0' },
        { whiteId: 'p3', blackId: 'p4', result: '1-0' }
      ],
      byes: []
    },
    {
      pairings: [
        { whiteId: 'p1', blackId: 'p4', result: '1-0' },
        { whiteId: 'p3', blackId: 'p2', result: '1-0' }
      ],
      byes: []
    }
  ];
  t.players.find(player => player.id === 'p2').withdrawn = true;
  t.players.find(player => player.id === 'p4').withdrawn = true;
  const blocked = pairRound(t, 3);
  assert.equal(blocked.ok, false);
  assert.match(blocked.warnings.join(' '), /absolute colour|no legal/i);
  t.ignoreColour = true;
  const allowed = pairRound(t, 3);
  assert.equal(allowed.ok, true);
  assert.equal(pairKey(allowed.pairings), 'p1-p3');
});

test('pair by tie-break uses standings order instead of pairing number', () => {
  const natural = pairRound(makeTournament(4, { fideMode: false }), 1);
  const t = makeTournament(4, { fideMode: false });
  t.tiebreaks = [];
  t.pairByTiebreak = true;
  t.players.find(player => player.id === 'p4').rankCorrection = -10;
  t.players.find(player => player.id === 'p1').rankCorrection = 10;
  const ranked = pairRound(t, 1);
  assert.equal(natural.ok, true);
  assert.equal(ranked.ok, true);
  assert.notEqual(pairKey(ranked.pairings), pairKey(natural.pairings));
  assert.equal(pairKey(ranked.pairings), 'p1-p2|p3-p4');
});

test('C.04.6 round 1 gives odd pairing numbers the initial colour', () => {
  const t = makeTournament(4);
  t.type = 'team-swiss';
  t.initialColor = 'white';
  t.teamColourPreference = 'A';
  const coloured = allocateTeamColours(t, 1, [
    { whiteId: 'p1', blackId: 'p3' },
    { whiteId: 'p2', blackId: 'p4' }
  ]);
  assert.deepEqual(coloured.pairings[0], { whiteId: 'p1', blackId: 'p3' });
  assert.deepEqual(coloured.pairings[1], { whiteId: 'p4', blackId: 'p2' });
});

test('C.04.6 Type B grants the strong preference', () => {
  const t = makeTournament(4);
  t.type = 'team-swiss';
  t.teamColourPreference = 'B';
  t.rounds = 5;
  t.roundsData = [
    {
      pairings: [
        { whiteId: 'p1', blackId: 'p3', result: '1-0' },
        { whiteId: 'p2', blackId: 'p4', result: '1-0' }
      ],
      byes: []
    },
    {
      pairings: [
        { whiteId: 'p1', blackId: 'p4', result: '1-0' }
      ],
      byes: []
    }
  ];
  const coloured = allocateTeamColours(t, 3, [
    { whiteId: 'p1', blackId: 'p2' }
  ]);
  assert.equal(coloured.pairings[0].whiteId, 'p2');
  assert.equal(coloured.pairings[0].blackId, 'p1');
});

test('Olympiad round 1 alternates board-1 colour in the top half', () => {
  const t = makeTournament(4);
  t.pairingSystem = 'olympiad';
  t.initialColor = 'white';
  const res = pairOlympiad(t, 1);
  assert.equal(res.ok, true);
  assert.deepEqual(res.pairings, [
    { whiteId: 'p1', blackId: 'p3' },
    { whiteId: 'p4', blackId: 'p2' }
  ]);
});

test('Olympiad does not give White to a team already two whites ahead', () => {
  const t = makeTournament(4);
  t.pairingSystem = 'olympiad';
  t.roundsData = [
    {
      pairings: [
        { whiteId: 'p1', blackId: 'p2', result: '1/2-1/2' },
        { whiteId: 'p3', blackId: 'p4', result: '1/2-1/2' }
      ],
      byes: []
    },
    {
      pairings: [
        { whiteId: 'p1', blackId: 'p3', result: '1/2-1/2' },
        { whiteId: 'p2', blackId: 'p4', result: '1/2-1/2' }
      ],
      byes: []
    }
  ];
  const res = pairOlympiad(t, 3);
  assert.equal(res.ok, true);
  assert.equal(res.log.some(line => /set aside/.test(line)), false);
  const top = res.pairings.find(pr => pr.whiteId === 'p1' || pr.blackId === 'p1');
  assert.equal(top.blackId, 'p1');
  assert.equal(top.whiteId, 'p4');
});

test('Double Swiss stores two games, scores a 1.5 bye, and repeats only after a double forfeit', () => {
  const odd = makeTournament(3);
  odd.pairingSystem = 'fide-double-swiss';
  odd.initialColor = 'white';
  const first = pairDoubleSwiss(odd, 1);
  assert.equal(first.ok, true);
  assert.equal(first.bye.playerId, 'p3');
  assert.equal(byePoints('PAB', odd), 1.5);
  assert.deepEqual(first.pairings[0].games, ['', '']);
  assert.equal(first.pairings[0].whiteId, 'p1');

  const t = makeTournament(2);
  t.pairingSystem = 'fide-double-swiss';
  t.roundsData = [{
    pairings: [{ whiteId: 'p1', blackId: 'p2', games: ['1-0', '0-1'] }],
    byes: []
  }];
  const states = computeStates(t, 1);
  assert.equal(states.get('p1').score, 1);
  assert.deepEqual(states.get('p1').colors, ['W']);
  assert.equal(pairDoubleSwiss(t, 2).ok, false);

  t.roundsData[0].pairings[0].games = ['1F-0F', '0F-1F'];
  assert.equal(pairDoubleSwiss(t, 2).ok, false);

  t.roundsData[0].pairings[0].games = ['0F-1F', '0F-1F'];
  const repeated = pairDoubleSwiss(t, 2);
  assert.equal(repeated.ok, true);
  assert.equal(pairKey(repeated.pairings), 'p1-p2');
});

test('pairing cards name both players and leave the result blank', () => {
  const t = makeTournament(2);
  t.roundsData = [{
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '' }],
    byes: []
  }];
  const html = pairingCardsHTML(t, 1);
  assert.match(html, /Player 1/);
  assert.match(html, /Player 2/);
  assert.match(html, /Result ________/);
  t.type = 'team-swiss';
  t.boardsPerMatch = 2;
  const cards = teamMatchCardsHTML(t, 1);
  assert.match(cards, /Player 1/);
  assert.match(cards, /Player 2/);
  assert.match(cards, /________/);
});

test('the section dispatcher keeps Dutch and recolours C.04.6', () => {
  const dutch = makeTournament(4);
  const direct = pairRound(dutch, 1);
  const via = pairSection(dutch, 1);
  assert.equal(pairKey(via.pairings), pairKey(direct.pairings));
  const teams = makeTournament(4);
  teams.type = 'team-swiss';
  teams.pairingSystem = 'fide-c04.6';
  teams.initialColor = 'white';
  const coloured = pairSection(teams, 1);
  assert.equal(coloured.ok, true);
  const even = coloured.pairings.find(pr => [pr.whiteId, pr.blackId].includes('p2') && [pr.whiteId, pr.blackId].includes('p4'));
  assert.equal(even.whiteId, 'p4');
});

test('larger Swiss (31 players, 6 rounds) completes with a PAB each round', () => {
  const t = makeTournament(31, { rounds: 6 });
  for (let r = 1; r <= 6; r++) {
    const res = playRound(t, r);
    assert.ok(res.bye, 'odd field: bye every round');
  }
  const seen = new Set();
  for (const rd of t.roundsData) {
    for (const pr of rd.pairings) {
      const k = [pr.whiteId, pr.blackId].sort().join('|');
      assert.ok(!seen.has(k), `repeat ${k}`);
      seen.add(k);
    }
  }
});
