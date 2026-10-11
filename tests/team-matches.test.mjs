import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedBoards,
  assessMatch,
  saveMatchBoards,
  teamRoster,
  teamRating,
  normalizeTeamPolicy,
} from '../renderer/js/engine/team.js';
function fixture() {
  const t = {
    type: 'team-swiss',
    boardsPerMatch: 4,
    teamBoardOrderCheck: true,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    players: [{ id: 'a' }, { id: 'b' }],
    rosterPlayers: [],
    teams: [],
    roundsData: [],
  };
  for (const side of ['a', 'b']) {
    const members = Array.from({ length: 5 }, (_, i) => ({
      rosterId: side + i,
      board: i + 1,
      reserve: i === 4,
    }));
    t.teams.push({ playerId: side, members });
    t.rosterPlayers.push(
      ...members.map((m) => ({ id: m.rosterId, name: m.rosterId, rating: 0 })),
    );
  }
  return t;
}
test('alternating colours do not exchange team sides', () => {
  const t = fixture(),
    m = { whiteId: 'a', blackId: 'b' };
  const b = seedBoards(t, m);
  assert.deepEqual(
    b.map((x) => x.whiteRosterId),
    ['a0', 'b1', 'a2', 'b3'],
  );
  assert.deepEqual(
    b.map((x) => x.homeColor),
    ['W', 'B', 'W', 'B'],
  );
});
test('empty and partial board results remain drafts; complete results derive match points', () => {
  const t = fixture(),
    m = { whiteId: 'a', blackId: 'b' };
  const b = seedBoards(t, m);
  saveMatchBoards(t, m, b);
  assert.equal(m.result, '');
  b[0].result = '1-0';
  saveMatchBoards(t, m, b);
  assert.equal(m.result, '');
  assert.deepEqual(m.matchScore, { w: 1, b: 0 });
  b.forEach((x, i) => (x.result = i % 2 ? '0-1' : '1-0'));
  saveMatchBoards(t, m, b);
  assert.equal(m.result, '1-0');
  assert.deepEqual(m.matchScore, { w: 4, b: 0 });
});
test('lineups reject duplicate players, wrong teams, board order and invalid board numbers', () => {
  const t = fixture(),
    m = { whiteId: 'a', blackId: 'b' };
  let b = seedBoards(t, m);
  b[2].whiteRosterId = 'a0';
  assert.match(
    assessMatch(t, { ...m, teamBoards: b }).errors.join(' '),
    /more than once/,
  );
  b = seedBoards(t, m);
  b[0].whiteRosterId = 'b0';
  assert.match(
    assessMatch(t, { ...m, teamBoards: b }).errors.join(' '),
    /team/,
  );
  b = seedBoards(t, m);
  b[0].whiteRosterId = 'a4';
  assert.match(
    assessMatch(t, { ...m, teamBoards: b }).errors.join(' '),
    /order/,
  );
  b = seedBoards(t, m);
  b[0].board = 2;
  assert.match(
    assessMatch(t, { ...m, teamBoards: b }).errors.join(' '),
    /board number/i,
  );
});
test('vacancies need explicit terminal forfeits and cannot fabricate wins', () => {
  const t = fixture(),
    m = { whiteId: 'a', blackId: 'b' };
  const b = seedBoards(t, m);
  b.forEach((x) => (x.result = '1/2-1/2'));
  b[0].whiteRosterId = '';
  b[0].result = '0F-1F';
  assert.equal(assessMatch(t, { ...m, teamBoards: b }).complete, true);
  b[0].result = '1F-0F';
  assert.ok(assessMatch(t, { ...m, teamBoards: b }).errors.length);
  b[0].blackRosterId = '';
  b[0].result = '0F-0F';
  assert.equal(assessMatch(t, { ...m, teamBoards: b }).complete, true);
});
test('unrated average substitution never changes player ratings; reserves excluded by default', () => {
  const t = fixture();
  assert.equal(
    teamRating(t, 'a', normalizeTeamPolicy({ unratedValue: 1400 })),
    1400,
  );
  assert.ok(t.rosterPlayers.every((p) => p.rating === 0));
  assert.equal(teamRoster(t, 'a').length, 5);
});
test('historical correction preserves pairing identities and records a reason', () => {
  const t = fixture(),
    m = { whiteId: 'a', blackId: 'b' };
  const b = seedBoards(t, m);
  b.forEach((x) => (x.result = '1/2-1/2'));
  saveMatchBoards(t, m, b);
  const before = JSON.stringify(m.teamBoards);
  b[0].result = '1-0';
  saveMatchBoards(t, m, b, { reason: 'Corrected score slip', round: 1 });
  assert.equal(m.corrections[0].reason, 'Corrected score slip');
  assert.equal(JSON.stringify(m.corrections[0].before), before);
  assert.equal(m.whiteId, 'a');
});
test('a completely forfeited match preserves forfeit status; double forfeits award no match points', () => {
  const t = fixture(),
    m = { whiteId: 'a', blackId: 'b' },
    b = seedBoards(t, m);
  b.forEach((x) => (x.result = '0F-0F'));
  saveMatchBoards(t, m, b);
  assert.equal(m.result, '0F-0F');
  const win = seedBoards(t, { whiteId: 'a', blackId: 'b' });
  win.forEach((x, i) => (x.result = i % 2 ? '0F-1F' : '1F-0F'));
  assert.equal(
    assessMatch(t, { whiteId: 'a', blackId: 'b', teamBoards: win }).result,
    '1F-0F',
  );
});
test('legacy aggregates remain readable but must be reconciled before advancing', async () => {
  const { roundReadiness, computeStates } = await import(
    '../renderer/js/engine/state.js'
  );
  const t = fixture();
  t.matchScoring = { win: 2, draw: 1, loss: 0 };
  t.currentRound = 1;
  t.roundsData = [
    {
      pairings: [
        {
          board: 1,
          whiteId: 'a',
          blackId: 'b',
          result: '1-0',
          matchScore: { w: 3, b: 1 },
        },
      ],
      byes: [],
    },
  ];
  assert.equal(computeStates(t, 1).get('a').score, 2);
  assert.ok(roundReadiness(t, 2).blockers.some((s) => s.includes('reconcile')));
});
test('legacy board-one colour is inferred from actual players without changing historical boards', async () => {
  const {boardOneColour}=await import('../renderer/js/engine/team.js');
  const t=fixture(),m={whiteId:'a',blackId:'b',teamBoards:[{board:1,whiteRosterId:'b0',blackRosterId:'a0',result:'0-1'}]};
  const before=JSON.stringify(m);assert.equal(boardOneColour(t,m),'B');assert.equal(JSON.stringify(m),before);
});
test('corrections keep later pairings and reject a player duplicated across matches in the same round', () => {
  const t=fixture(),m={board:1,whiteId:'a',blackId:'b'};const b=seedBoards(t,m);b.forEach(x=>x.result='1/2-1/2');saveMatchBoards(t,m,b);
  const future={pairings:[{board:1,whiteId:'b',blackId:'a',result:''}],byes:[]};t.roundsData=[{pairings:[m],byes:[]},future];const before=JSON.stringify(future);b[0].result='1-0';saveMatchBoards(t,m,b,{round:1,reason:'Corrected after next round was paired'});assert.equal(JSON.stringify(future),before);
  t.roundsData[0].pairings.push({board:2,whiteId:'x',blackId:'y',teamBoards:[{whiteRosterId:'a0',blackRosterId:'z'}]});assert.throws(()=>saveMatchBoards(t,m,b,{round:1,reason:'Test'}),/another match/);
});
