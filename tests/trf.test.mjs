import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ratingAdminTRF } from '../renderer/js/export.js';
import { computeStandings } from '../renderer/js/engine/tiebreaks.js';
import { importTRF } from '../renderer/js/engine/trf.js';

function put(chars, start, value) {
  const s = String(value ?? '');
  for (let i = 0; i < s.length; i++) chars[start + i] = s[i];
}

function fixedPlayer({ no, sex = 'm', title = '', name, rating = 0, fed = '', fideId = '', birth = '', points = '0.0', rank = no, cells = [] }) {
  const chars = Array(91 + cells.length * 10 + 8).fill(' ');
  put(chars, 0, '001');
  put(chars, 4, String(no).padStart(4));
  put(chars, 9, sex);
  put(chars, 10, title.padEnd(3).slice(0, 3));
  put(chars, 14, name.padEnd(33).slice(0, 33));
  put(chars, 48, String(rating).padStart(4));
  put(chars, 53, fed.padEnd(3).slice(0, 3));
  put(chars, 57, String(fideId).padStart(11).slice(-11));
  put(chars, 69, birth.padEnd(10).slice(0, 10));
  put(chars, 80, String(points).padStart(4));
  put(chars, 85, String(rank).padStart(4));
  cells.forEach((cell, i) => {
    const base = 91 + i * 10;
    put(chars, base, String(cell.opp ?? 0).padStart(4));
    put(chars, base + 5, cell.color ?? '-');
    put(chars, base + 7, cell.result ?? 'Z');
  });
  return chars.join('').trimEnd();
}

function roundDates(dates) {
  const chars = Array(91 + dates.length * 10 + 8).fill(' ');
  put(chars, 0, '132');
  dates.forEach((date, i) => put(chars, 91 + i * 10, date));
  return chars.join('').trimEnd();
}

function team013(name, ids) {
  const chars = Array(37 + ids.length * 5).fill(' ');
  put(chars, 0, '013');
  put(chars, 4, name.padEnd(32).slice(0, 32));
  ids.forEach((id, i) => put(chars, 36 + i * 5, String(id).padStart(4)));
  return chars.join('').trimEnd();
}

const baseTournament = {
  id: 't',
  name: 'Round Trip',
  site: 'Singapore',
  federation: 'SGP',
  startDate: '2026-06-01',
  endDate: '2026-06-02',
  type: 'swiss',
  rounds: 2,
  currentRound: 2,
  scoring: { win: 1, draw: 0.5, loss: 0 },
  matchScoring: { win: 2, draw: 1, loss: 0 },
  pabValue: 'win',
  fideMode: true,
  tiebreaks: ['BH', 'GP'],
  players: [
    { id: 'p1', no: 1, name: 'Alpha, Ana', rating: 2100, fed: 'SGP', fideId: '1234567', byear: '1990' },
    { id: 'p2', no: 2, name: 'Beta Ben', rating: 2000, fed: 'MAS', fideId: '7654321', byear: '1988' },
    { id: 'p3', no: 3, name: 'Gamma Gia', rating: 1900, fed: 'INA', fideId: '3456789', byear: '1995' }
  ],
  teams: [],
  roundsData: [
    { round: 1, pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }], byes: [{ playerId: 'p3', type: 'PAB' }] },
    { round: 2, pairings: [{ board: 1, whiteId: 'p3', blackId: 'p1', result: '1/2-1/2' }], byes: [{ playerId: 'p2', type: 'HPB' }] }
  ]
};

test('TRF import reads fixed-column individual metadata, rounds, byes and forfeits', () => {
  const trf = [
    '012 City Championship',
    '022 Singapore',
    '032 SGP',
    '042 2026/06/01',
    '052 2026/06/02',
    '062 3',
    '072 3',
    '092 Individual: Swiss-System',
    '142 2',
    roundDates(['26/06/01', '26/06/02']),
    fixedPlayer({ no: 1, sex: 'w', title: 'WFM', name: 'Alpha, Ana', rating: 2100, fed: 'SGP', fideId: '1234567', birth: '1990/01/01', points: '1.5', rank: 1, cells: [
      { opp: 2, color: 'w', result: '1' },
      { opp: 3, color: 'b', result: '=' }
    ] }),
    fixedPlayer({ no: 2, name: 'Beta Ben', rating: 2000, fed: 'MAS', fideId: '7654321', birth: '1988/02/02', points: '0.5', rank: 3, cells: [
      { opp: 1, color: 'b', result: '0' },
      { opp: 0, color: '-', result: 'H' }
    ] }),
    fixedPlayer({ no: 3, name: 'Gamma Gia', rating: 1900, fed: 'INA', fideId: '3456789', birth: '1995/03/03', points: '1.5', rank: 2, cells: [
      { opp: 0, color: '-', result: 'U' },
      { opp: 1, color: 'w', result: '=' }
    ] })
  ].join('\n');

  const { tournament: t, warnings } = importTRF(trf);

  assert.equal(t.name, 'City Championship');
  assert.equal(t.site, 'Singapore');
  assert.equal(t.federation, 'SGP');
  assert.equal(t.startDate, '2026-06-01');
  assert.equal(t.endDate, '2026-06-02');
  assert.equal(t.rounds, 2);
  assert.equal(t.currentRound, 2);
  assert.equal(t.roundsData[0].date, '2026-06-01');
  assert.equal(t.players[0].title, 'WFM');
  assert.equal(t.players[0].byear, '1990');
  assert.deepEqual(t.roundsData[0].pairings[0], { board: 1, whiteId: 'P1', blackId: 'P2', result: '1-0', manual: false });
  assert.deepEqual(t.roundsData[0].byes, [{ playerId: 'P3', type: 'PAB' }]);
  assert.deepEqual(t.roundsData[1].pairings[0], { board: 1, whiteId: 'P3', blackId: 'P1', result: '1/2-1/2', manual: false });
  assert.deepEqual(t.roundsData[1].byes, [{ playerId: 'P2', type: 'HPB' }]);
  assert.deepEqual(warnings, []);
});

test('TRF import round-trips TourneyLab TRF export', () => {
  const text = ratingAdminTRF(baseTournament, 2);
  const { tournament: t } = importTRF(text);

  assert.equal(t.name, 'Round Trip');
  assert.equal(t.players.length, 3);
  assert.equal(t.players[0].name, 'Alpha, Ana');
  assert.equal(t.roundsData.length, 2);
  assert.equal(t.roundsData[0].pairings[0].result, '1-0');
  assert.equal(t.roundsData[0].byes[0].type, 'PAB');
  assert.equal(t.roundsData[1].pairings[0].whiteId, 'P3');
  assert.equal(t.roundsData[1].pairings[0].blackId, 'P1');
  assert.equal(t.roundsData[1].byes[0].type, 'HPB');
});

test('TRF(x) import honors XXR, XXS and DAT GROUP for team events', () => {
  const trf = [
    '012 School Team Swiss',
    '082 2',
    '092 Team Swiss-System',
    'XXR 4',
    'XXS W=3 D=1 PAB=3',
    '001 1 m   Board One 1800 SGP 111 2000 0.0 1',
    'DAT 0001 GROUP Red School',
    '001 2 m   Board Two 1700 SGP 222 2001 0.0 2',
    'DAT 0002 GROUP Red School',
    '001 3 m   Board Three 1600 MAS 333 2002 0.0 3',
    'DAT 0003 GROUP Blue School'
  ].join('\n');

  const { tournament: t } = importTRF(trf);

  assert.equal(t.type, 'team-swiss');
  assert.equal(t.rounds, 4);
  assert.deepEqual(t.scoring, { win: 3, draw: 1, loss: 0 });
  assert.equal(t.pabValue, 'win');
  assert.equal(t.players.length, 2);
  assert.deepEqual(t.players.map(p => p.name), ['Red School', 'Blue School']);
  assert.equal(t.rosterPlayers.length, 3);
  assert.equal(t.teams[0].members.length, 2);
});

test('team TRF import derives match pairings, board rows, and team standings from 013 plus 001 rows', () => {
  const trf = [
    '012 Club Team Match',
    '082 2',
    '092 Team Swiss-System',
    'XXR 1',
    team013('Red Club', [1, 2]),
    team013('Blue Club', [3, 4]),
    fixedPlayer({ no: 1, name: 'Red One', rating: 2000, fed: 'SGP', points: '1.0', cells: [{ opp: 3, color: 'w', result: '1' }] }),
    fixedPlayer({ no: 2, name: 'Red Two', rating: 1900, fed: 'SGP', points: '0.5', cells: [{ opp: 4, color: 'b', result: '=' }] }),
    fixedPlayer({ no: 3, name: 'Blue One', rating: 1950, fed: 'MAS', points: '0.0', cells: [{ opp: 1, color: 'b', result: '0' }] }),
    fixedPlayer({ no: 4, name: 'Blue Two', rating: 1850, fed: 'MAS', points: '0.5', cells: [{ opp: 2, color: 'w', result: '=' }] })
  ].join('\n');

  const { tournament: t } = importTRF(trf);

  assert.equal(t.type, 'team-swiss');
  assert.equal(t.players.length, 2);
  assert.equal(t.rosterPlayers.length, 4);
  const match = t.roundsData[0].pairings[0];
  assert.equal(t.players.find(p => p.id === match.whiteId).name, 'Red Club');
  assert.equal(t.players.find(p => p.id === match.blackId).name, 'Blue Club');
  assert.deepEqual(match.matchScore, { w: 1.5, b: 0.5 });
  assert.equal(match.result, '1-0');
  assert.equal(match.teamBoards.length, 2);
  assert.deepEqual(match.teamBoards.map(b => [b.board, b.result]), [[1, '1-0'], [2, '1/2-1/2']]);

  const standings = computeStandings(t, 1);
  const red = standings.find(r => r.player.name === 'Red Club');
  const blue = standings.find(r => r.player.name === 'Blue Club');
  assert.equal(red.score, 2);
  assert.equal(red.tbs.GP, 1.5);
  assert.equal(blue.score, 0);
  assert.equal(blue.tbs.GP, 0.5);
});

test('TRF26 team records import 310 teams, 300 lineups, 330 forfeits and 802 match totals', () => {
  const trf = [
    '012 TRF26 Teams',
    '082 2',
    '092 Team Swiss-System',
    '142 2',
    '152 B',
    '162  W 3.0    D 1.0    L 0.0',
    '362 TW 3.0    TD 1.0    TL 0.0',
    fixedPlayer({ no: 1, name: 'Alpha One', rating: 2000 }),
    fixedPlayer({ no: 2, name: 'Alpha Two', rating: 1900 }),
    fixedPlayer({ no: 3, name: 'Beta One', rating: 1950 }),
    fixedPlayer({ no: 4, name: 'Beta Two', rating: 1850 }),
    '310   1 Alpha Team                       ALP     2000    2.0    3.0   1     1    2',
    '310   2 Beta Team                        BET     1900    0.0    1.0   2     3    4',
    '300 001 001 002 0002 0001',
    '802 001 ALP   0002.0 0003.0 002 w 03.0',
    '802 002 BET   0000.0 0001.0 001 b 01.0',
    '330 +- 002 001 002'
  ].join('\n');

  const { tournament: t, warnings } = importTRF(trf);

  assert.equal(t.initialColor, 'black');
  assert.deepEqual(t.scoring, { win: 3, draw: 1, loss: 0 });
  assert.deepEqual(t.matchScoring, { win: 3, draw: 1, loss: 0 });
  assert.equal(t.players.length, 2);
  assert.equal(t.teams[0].members[0].rosterId, 'P1');
  assert.deepEqual(t.teamLineups['1']['T1'], ['P2', 'P1']);
  assert.equal(t.roundsData[0].pairings[0].matchScore.w, 3);
  assert.equal(t.roundsData[0].pairings[0].matchScore.b, 1);
  assert.equal(t.roundsData[1].pairings[0].result, '1F-0F');
  assert.ok(warnings.some(w => w.includes('802')));
});

test('TRF26 802 bye cells do not shift later team rounds', () => {
  const trf = [
    '012 Team bye alignment',
    '082 2',
    '092 Team Swiss-System',
    '142 2',
    fixedPlayer({ no: 1, name: 'Alpha One', rating: 2000 }),
    fixedPlayer({ no: 2, name: 'Beta One', rating: 1900 }),
    '310   1 Alpha Team                       ALP     2000    2.0    3.0   1     1',
    '310   2 Beta Team                        BET     1900    0.0    1.0   2     2',
    '802   1 ALP      2.0    3.0 FPB    1.0     2 w  2.0',
    '802   2 BET      0.0    1.0 ZPB    0.0     1 b  1.0'
  ].join('\n');

  const { tournament: t } = importTRF(trf);
  assert.equal(t.roundsData.length, 1);
  assert.equal(t.roundsData[0].round, 2);
  assert.equal(t.roundsData[0].pairings[0].whiteId, 'T1');
  assert.equal(t.roundsData[0].pairings[0].blackId, 'T2');
  assert.deepEqual(t.roundsData[0].pairings[0].matchScore, { w: 2, b: 1 });
});

test('TRF26 801 team records import board-by-board players and results', () => {
  const trf = [
    '012 TRF26 Team Boards',
    '082 2',
    '092 Team Swiss-System',
    'XXR 1',
    fixedPlayer({ no: 1, name: 'Alpha One', rating: 2000 }),
    fixedPlayer({ no: 2, name: 'Alpha Two', rating: 1900 }),
    fixedPlayer({ no: 3, name: 'Beta One', rating: 1950 }),
    fixedPlayer({ no: 4, name: 'Beta Two', rating: 1850 }),
    '310 001 Alpha Team                       ALP   001000 0002.0 0001.5 001 0001 0002',
    '310 002 Beta Team                        BET   000900 0000.0 0000.5 002 0003 0004',
    '801 001 ALP 0002.0 0001.5 002 w 1= 0001 0002',
    '801 002 BET 0000.0 0000.5 001 b 0= 0003 0004'
  ].join('\n');

  const { tournament: t } = importTRF(trf);

  const match = t.roundsData[0].pairings[0];
  assert.deepEqual(match.matchScore, { w: 1.5, b: 0.5 });
  assert.equal(match.result, '1-0');
  assert.deepEqual(match.teamBoards.map(b => [b.whiteRosterId, b.blackRosterId, b.result]), [
    ['P1', 'P3', '1-0'],
    ['P2', 'P4', '1/2-1/2']
  ]);

  const exported = ratingAdminTRF(t, 1);
  const { tournament: restored } = importTRF(exported);
  assert.equal(restored.type, 'team-swiss');
  assert.deepEqual(restored.teams.map(team => team.members.map(member => member.rosterId)), [
    ['P1', 'P2'],
    ['P3', 'P4']
  ]);
  assert.deepEqual(restored.roundsData[0].pairings[0].teamBoards.map(b => [b.whiteRosterId, b.blackRosterId, b.result]), [
    ['P1', 'P3', '1-0'],
    ['P2', 'P4', '1/2-1/2']
  ]);
});
