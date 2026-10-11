// TourneyLab — tests for the report-driven additions (node:test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeStandings, TIEBREAKS, RATING_TIEBREAKS } from '../renderer/js/engine/tiebreaks.js';
import { rutschSchedule, scheveningenSchedule, bergerSchedule } from '../renderer/js/engine/roundrobin.js';
import { nextPowerOfTwo, koRounds, koFirstRound, koPairRound, koMiniMatchWinner } from '../renderer/js/engine/knockout.js';
import { exportXML, importXML } from '../renderer/js/engine/xml.js';

const SCORING = { win: 1, draw: 0.5, loss: 0 };
function R(w, b, res) { return { whiteId: w, blackId: b, result: res }; }

function baseT(over = {}) {
  return {
    id: 't', name: 'Test', type: 'swiss', rounds: 5, fideMode: true,
    scoring: SCORING, pabValue: 'win', tiebreaks: ['BH', 'BHC1', 'SB'],
    players: [], roundsData: [], ...over,
  };
}

// ---------------------------------------------------------- FIDE 2026 Article 16

test('PAB dummy is capped at draw-points × rounds (Art 16.4.2)', () => {
  const t = baseT({ tiebreaks: ['BH', 'SB'] });
  for (let i = 1; i <= 6; i++) t.players.push({ id: 'p' + i, no: i, name: 'P' + i, rating: 2000 });
  t.roundsData = [
    { round: 1, pairings: [R('p1', 'p2', '1-0'), R('p3', 'p4', '1-0'), R('p5', 'p6', '1-0')], byes: [] },
    { round: 2, pairings: [R('p1', 'p3', '1-0'), R('p2', 'p4', '1-0'), R('p5', 'p6', '0-1')], byes: [] },
    { round: 3, pairings: [R('p2', 'p3', '1-0'), R('p4', 'p5', '1-0')], byes: [{ playerId: 'p1', type: 'PAB' }, { playerId: 'p6', type: 'ZPB' }] },
    { round: 4, pairings: [R('p4', 'p1', '1-0'), R('p2', 'p5', '1-0'), R('p3', 'p6', '1-0')], byes: [] },
    { round: 5, pairings: [R('p1', 'p5', '1/2-1/2'), R('p2', 'p3', '1-0'), R('p4', 'p6', '1-0')], byes: [] },
  ];
  const fide = computeStandings(t, 5).find(r => r.player.id === 'p1');
  const legacy = computeStandings({ ...t, tiebreakRules: 'legacy' }, 5).find(r => r.player.id === 'p1');
  // own score 3.5 > cap (0.5*5 = 2.5) so FIDE caps the PAB dummy, legacy does not
  assert.equal(legacy.tbs.BH - fide.tbs.BH, 1.0, 'FIDE caps PAB contribution by 1.0 here');
  // SB: PAB is a win-equivalent, so it contributes dummy×1.0; the cap removes 1.0
  assert.equal(legacy.tbs.SB - fide.tbs.SB, 1.0, 'SB PAB contribution also capped');
});

test('forfeit win/loss are unplayed and capped at the scheduled opponent adjusted score (Art 16.4.1)', () => {
  const t = baseT({ tiebreaks: ['BH'], rounds: 2 });
  for (let i = 1; i <= 4; i++) t.players.push({ id: 'p' + i, no: i, name: 'P' + i, rating: 2000 });
  t.roundsData = [
    { round: 1, pairings: [R('p1', 'p2', '1F-0F'), R('p3', 'p4', '1-0')], byes: [] },
    { round: 2, pairings: [R('p1', 'p3', '1-0'), R('p2', 'p4', '0-1')], byes: [] },
  ];
  const rows = computeStandings(t, 2);
  const p1 = rows.find(r => r.player.id === 'p1');
  // p1 forfeit-beat p2 in R1 (unplayed), played-beat p3 in R2.
  // dummy for the forfeit = min(own score, opponent p2 adjusted score).
  // p2: forfeit loss R1 (adjusted = draw 0.5), real loss to p4 R2 (0) => adjusted 0.5
  // own score p1 = 2; cap = 0.5 => forfeit contributes 0.5
  // p3 score: beat p4 (1) then lost to p1 (0) = 1
  assert.equal(p1.tbs.BH, 0.5 + 1, 'forfeit dummy capped at opponent adjusted score');
});

test('Buchholz cut-1 removes a Voluntary Unplayed Round first (Art 16.5)', () => {
  const t = baseT({ tiebreaks: ['BHC1'], rounds: 3 });
  for (let i = 1; i <= 4; i++) t.players.push({ id: 'p' + i, no: i, name: 'P' + i, rating: 2000 });
  // p1: R1 half-point bye (VUR), R2 beat strong p2, R3 beat p3
  t.roundsData = [
    { round: 1, pairings: [R('p2', 'p3', '1-0')], byes: [{ playerId: 'p1', type: 'HPB' }, { playerId: 'p4', type: 'ZPB' }] },
    { round: 2, pairings: [R('p1', 'p2', '1-0'), R('p3', 'p4', '1-0')], byes: [] },
    { round: 3, pairings: [R('p1', 'p3', '1-0'), R('p2', 'p4', '1-0')], byes: [] },
  ];
  const rows = computeStandings(t, 3);
  const p1 = rows.find(r => r.player.id === 'p1');
  // contributions: HPB(VUR) dummy, p2 score, p3 score. Cut-1 must drop the VUR
  // even though it might not be numerically the smallest.
  const p2s = rows.find(r => r.player.id === 'p2').score;
  const p3s = rows.find(r => r.player.id === 'p3').score;
  assert.equal(p1.tbs.BHC1, p2s + p3s, 'VUR contribution is the one cut');
});

test('tie-break registry exposes the new families', () => {
  for (const k of ['FBH', 'WINSO', 'OCUM', 'MP', 'GP', 'EMMSB', 'EGGSB', 'SSSC']) {
    assert.ok(TIEBREAKS[k], `missing ${k}`);
  }
  assert.ok(RATING_TIEBREAKS.has('AROC') && RATING_TIEBREAKS.has('PERF'));
});

test('structured tie-break settings apply custom Buchholz cuts', () => {
  const t = baseT({
    rounds: 2,
    tiebreaks: ['BH', 'BHC1'],
    tiebreakConfig: [
      { code: 'BH', cutsLow: 1, cutsHigh: 0 },
      { code: 'BHC1', cutsLow: 1, cutsHigh: 0 }
    ],
    players: [
      { id: 'p1', no: 1, name: 'P1', rating: 2000 },
      { id: 'p2', no: 2, name: 'P2', rating: 1900 },
      { id: 'p3', no: 3, name: 'P3', rating: 1800 },
      { id: 'p4', no: 4, name: 'P4', rating: 1700 }
    ],
    roundsData: [
      { pairings: [R('p1', 'p2', '1-0'), R('p3', 'p4', '1-0')], byes: [] },
      { pairings: [R('p1', 'p3', '1-0'), R('p2', 'p4', '1-0')], byes: [] }
    ]
  });
  const p1 = computeStandings(t, 2).find(row => row.player.id === 'p1');
  assert.equal(p1.tbs.BH, p1.tbs.BHC1);
});

test('opponent cumulative sums the cumulative scores of played opponents', () => {
  const t = baseT({
    rounds: 2,
    tiebreaks: ['CUM', 'OCUM'],
    players: [
      { id: 'p1', no: 1, name: 'P1', rating: 2000 },
      { id: 'p2', no: 2, name: 'P2', rating: 1900 },
      { id: 'p3', no: 3, name: 'P3', rating: 1800 },
      { id: 'p4', no: 4, name: 'P4', rating: 1700 }
    ],
    roundsData: [
      { pairings: [R('p1', 'p2', '1-0'), R('p3', 'p4', '1-0')], byes: [] },
      { pairings: [R('p1', 'p3', '1-0'), R('p2', 'p4', '1-0')], byes: [] }
    ]
  });
  const rows = computeStandings(t, 2);
  assert.equal(rows.find(row => row.player.id === 'p1').tbs.OCUM, 3);
  assert.equal(rows.find(row => row.player.id === 'p2').tbs.OCUM, 3);
});

// ----------------------------------------------------------------- Rutsch

test('Rutsch schedule is a valid round robin (every pair once)', () => {
  for (const n of [6, 8]) {
    const sched = rutschSchedule(n);
    assert.equal(sched.length, n - 1);
    const met = new Set();
    for (const rd of sched) {
      const used = new Set();
      for (const g of rd) {
        if (g.bye !== undefined) continue;
        assert.ok(!used.has(g.white) && !used.has(g.black));
        used.add(g.white); used.add(g.black);
        const k = [g.white, g.black].sort((x, y) => x - y).join('|');
        assert.ok(!met.has(k), `repeat ${k}`);
        met.add(k);
      }
    }
    assert.equal(met.size, n * (n - 1) / 2);
  }
});

// ----------------------------------------------------------------- Scheveningen

test('Scheveningen: every A plays every B exactly once', () => {
  const A = [1, 2, 3], B = [4, 5, 6];
  const sched = scheveningenSchedule(A, B);
  assert.equal(sched.length, 3);
  const met = new Set();
  for (const rd of sched) {
    const used = new Set();
    for (const g of rd) {
      assert.ok(!used.has(g.white) && !used.has(g.black), 'player twice in a round');
      used.add(g.white); used.add(g.black);
      met.add([g.white, g.black].sort((x, y) => x - y).join('|'));
    }
  }
  // 3×3 = 9 cross meetings, none within a team
  assert.equal(met.size, 9);
  for (const a of A) for (const b of B) assert.ok(met.has([a, b].sort((x, y) => x - y).join('|')), `${a} vs ${b} missing`);
});

// ----------------------------------------------------------------- knockout

test('KO bracket sizing and byes go to the strongest', () => {
  assert.equal(nextPowerOfTwo(5), 8);
  assert.equal(nextPowerOfTwo(8), 8);
  assert.equal(koRounds(5), 3);
  const seeds = [];
  for (let i = 1; i <= 5; i++) seeds.push({ id: 'p' + i, no: i, name: 'P' + i, rating: 2200 - i * 10 });
  const r1 = koFirstRound(seeds);
  assert.equal(r1.size, 8);
  assert.equal(r1.byes.length, 3); // 8 - 5
  assert.deepEqual(r1.byes, ['p1', 'p2', 'p3'], 'strongest three get free tickets');
  // remaining 2 players play each other
  assert.equal(r1.pairings.length, 1);
});

test('KO mini-match: score wins, else black-in-last-game advances', () => {
  // decisive on points
  let w = koMiniMatchWinner('a', 'b', [
    { whiteId: 'a', blackId: 'b', result: '1-0' },
    { whiteId: 'b', blackId: 'a', result: '1-0' },
  ], SCORING);
  // a: white win (1) + black loss (0) = 1; b: 1 -> tie -> black in last game = a
  assert.equal(w.winnerId, 'a');
  assert.equal(w.reason, 'black in last game');

  // clear points winner
  w = koMiniMatchWinner('a', 'b', [
    { whiteId: 'a', blackId: 'b', result: '1-0' },
    { whiteId: 'b', blackId: 'a', result: '0-1' },
  ], SCORING);
  assert.equal(w.winnerId, 'a');
  assert.equal(w.reason, 'score');

  // better-seed rule
  w = koMiniMatchWinner('a', 'b', [{ whiteId: 'a', blackId: 'b', result: '1/2-1/2' }],
    SCORING, { advancementRule: 'betterSeed', seedOf: id => (id === 'a' ? 2 : 1) });
  assert.equal(w.winnerId, 'b', 'lower seed number is stronger');

  // manual
  w = koMiniMatchWinner('a', 'b', [{ whiteId: 'a', blackId: 'b', result: '1/2-1/2' }],
    SCORING, { advancementRule: 'manual' });
  assert.equal(w.decided, false);
});

test('KO round pairing is first vs last', () => {
  const pr = koPairRound(['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(pr, [{ aId: 'p1', bId: 'p4' }, { aId: 'p2', bId: 'p3' }]);
});

// ----------------------------------------------------------------- XML round-trip

test('XML export/import round-trips players, results and byes', () => {
  const t = baseT({ rounds: 2 });
  t.players = [
    { id: 'p1', no: 1, name: 'Alice Smith', rating: 2100, fed: 'AUT', fideId: '1700001', byear: '1990', club: 'C1' },
    { id: 'p2', no: 2, name: 'Bob Jones', rating: 2000, fed: 'GER', fideId: '4600002', byear: '1985', club: 'C2' },
    { id: 'p3', no: 3, name: 'Carol', rating: 1900, fed: 'FRA' },
  ];
  t.roundsData = [
    { round: 1, date: '2026-06-01', pairings: [R('p1', 'p2', '1-0')], byes: [{ playerId: 'p3', type: 'PAB' }] },
    { round: 2, date: '2026-06-02', pairings: [R('p1', 'p3', '1/2-1/2'), { whiteId: 'p2', blackId: 'p3', result: '1F-0F', board: 1 }], byes: [] },
  ];
  const xml = exportXML(t);
  assert.match(xml, /SwissManagerTournament/);
  assert.match(xml, /Res="1-0"/);
  assert.match(xml, /ResRtg="1-0"/);          // played game is rated
  assert.match(xml, /Res="1-0F"[^>]*ResRtg=""/); // forfeit not rated

  const back = importXML(xml);
  assert.equal(back.players.length, 3);
  const a = back.players.find(p => p.id === 'p1');
  assert.equal(a.name, 'Alice Smith');
  assert.equal(a.rating, 2100);
  assert.equal(a.fed, 'AUT');
  assert.equal(back.roundsData.length, 2);
  assert.equal(back.roundsData[0].pairings[0].result, '1-0');
  assert.equal(back.roundsData[0].byes[0].type, 'PAB');
  assert.equal(back.roundsData[1].pairings.find(p => p.whiteId === 'p2').result, '1F-0F');
});

test('XML import tolerates Surname/FirstName and SNo references', () => {
  const xml = `<?xml version="1.0"?>
  <SwissManagerTournament name="X" type="swiss" rounds="1">
    <Players>
      <Player PlayerUniqueId="a" SNo="1" Surname="Carlsen" FirstName="Magnus" Rtg="2839" Fed="NOR"/>
    </Players>
    <Results>
      <Round No="1"><Pairing Board="1" White="a" Black="a" Res="1/2"/></Round>
    </Results>
  </SwissManagerTournament>`;
  const r = importXML(xml);
  assert.equal(r.players[0].name, 'Magnus Carlsen');
  assert.equal(r.players[0].rating, 2839);
  assert.equal(r.roundsData[0].pairings[0].result, '1/2-1/2');
});
