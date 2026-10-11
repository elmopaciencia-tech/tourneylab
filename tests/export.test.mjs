import test from 'node:test';
import assert from 'node:assert/strict';

import { pairingListHTML, standingsHTML, standingsCSV, tournamentReportHTML } from '../renderer/js/export.js';
import { calculateRatingProjectionAfterRound } from '../renderer/js/engine/ratingProjection.js';

function tournament() {
  return {
    id: 't1',
    name: 'Example Open',
    site: 'Singapore',
    federation: 'SGP',
    organizer: 'Chief Arbiter',
    publish: {
      creator: 'Elijah Paciencia',
      homepageUrl: 'http://www.chessgrande.com/',
      registrationUrl: 'https://chessgrande.com/2026-uwc-chess-challenge/',
      calendarUrl: 'https://chess-results.com/CalendarLink.aspx?lan=1&tnr=1427449',
      qrUrl: 'https://s2.chess-results.com/QRCodes.aspx?lan=1&code=Init&tnr=1427449'
    },
    startDate: '2026-06-20',
    endDate: '2026-06-20',
    type: 'swiss',
    rounds: 2,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    matchScoring: { win: 2, draw: 1, loss: 0 },
    pabValue: 'win',
    fideMode: true,
    tiebreaks: ['BH', 'SB'],
    players: [
      { id: 'p1', no: 1, name: 'Alice Alpha', rating: 1800, fed: 'SGP', fideId: '1001', type: 'U15', club: 'North' },
      { id: 'p2', no: 2, name: 'Bob Beta', rating: 1700, fed: 'IND', fideId: '1002', type: 'U17', club: 'East' },
      { id: 'p3', no: 3, name: 'Cara Gamma', rating: 0, fed: 'SGP', fideId: '', type: 'U15', club: '' }
    ],
    roundsData: [
      {
        round: 1,
        date: '2026-06-20',
        time: '09:00',
        site: 'Hall A',
        pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0', manual: true }],
        byes: [{ playerId: 'p3', type: 'HPB' }]
      }
    ],
    currentRound: 1
  };
}

function companionTournament() {
  return {
    ...tournament(),
    id: 't2',
    name: 'Example U9',
    publish: {},
    players: [
      { id: 'q1', no: 1, name: 'Dylan Delta', rating: 1500, fed: 'MAS', fideId: '2001', type: 'U9', club: 'South' }
    ],
    roundsData: [],
    currentRound: 0
  };
}

function teamTournament() {
  return {
    ...tournament(),
    id: 'team1',
    name: 'Team Cup',
    type: 'team-swiss',
    tiebreaks: ['MP', 'GP'],
    players: [
      { id: 'T1', no: 2, name: 'Zeta Club', rating: 1500, fed: 'SGP', captain: 'Zed' },
      { id: 'T2', no: 1, name: 'Alpha Club', rating: 1600, fed: 'MAS', captain: 'Ada' }
    ],
    rosterPlayers: [
      { id: 'P1', no: 11, name: 'Zeta Board One', rating: 1500, fed: 'SGP', fideId: '3001', type: '', club: '' },
      { id: 'P2', no: 12, name: 'Zeta Board Two', rating: 1400, fed: 'SGP', fideId: '3002', type: '', club: '' },
      { id: 'P3', no: 21, name: 'Alpha Board One', rating: 1600, fed: 'MAS', fideId: '4001', type: '', club: '' }
    ],
    teams: [
      { id: 'team-zeta', playerId: 'T1', name: 'Zeta Club', members: [{ rosterId: 'P1', board: 1 }, { rosterId: 'P2', board: 2 }] },
      { id: 'team-alpha', playerId: 'T2', name: 'Alpha Club', members: [{ rosterId: 'P3', board: 1 }] }
    ],
    roundsData: [],
    currentRound: 0
  };
}

function tiedRankingTournament() {
  return {
    ...tournament(),
    name: 'Tied Open',
    tiebreaks: [],
    players: [
      { id: 'p1', no: 1, name: 'Alpha', rating: 1800, fed: 'SGP', fideId: '1001', type: '', club: '' },
      { id: 'p2', no: 2, name: 'Beta', rating: 1700, fed: 'MAS', fideId: '1002', type: '', club: '' },
      { id: 'p3', no: 3, name: 'Gamma', rating: 1600, fed: 'INA', fideId: '1003', type: '', club: '' },
      { id: 'p4', no: 4, name: 'Delta', rating: 1500, fed: 'PHI', fideId: '1004', type: '', club: '' }
    ],
    roundsData: [
      {
        round: 1,
        date: '2026-06-20',
        time: '09:00',
        site: 'Hall A',
        pairings: [
          { board: 1, whiteId: 'p1', blackId: 'p2', result: '1/2-1/2' },
          { board: 2, whiteId: 'p3', blackId: 'p4', result: '1/2-1/2' }
        ],
        byes: []
      }
    ],
    currentRound: 1
  };
}

function sectionById(html, id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `missing section ${id}`);
  const end = nextId ? html.indexOf(`id="${nextId}"`, start + 1) : -1;
  return html.slice(start, end === -1 ? html.length : end);
}

function splitWithdrawnSection(section) {
  const marker = '<h3>Withdrawn players</h3>';
  const index = section.indexOf(marker);
  assert.notEqual(index, -1, 'missing withdrawn section');
  return {
    main: section.slice(0, index),
    withdrawn: section.slice(index)
  };
}

function reportBoxById(html, id) {
  const idIndex = html.indexOf(`id="${id}"`);
  assert.notEqual(idIndex, -1, `missing section ${id}`);
  const start = html.lastIndexOf('<section class="report-section">', idIndex);
  const end = html.indexOf('</section>', idIndex);
  assert.notEqual(start, -1, `missing report box for ${id}`);
  assert.notEqual(end, -1, `missing report box end for ${id}`);
  return html.slice(start, end + '</section>'.length);
}

test('pairing HTML includes Chess-Results-style pairing columns', () => {
  const html = pairingListHTML(tournament(), 1);
  assert.match(html, /Bo\./);
  assert.match(html, /No\./);
  assert.match(html, /Pts\./);
  assert.match(html, /Alice Alpha/);
  assert.match(html, /Bob Beta/);
  assert.match(html, /manually modified pairing/);
  assert.match(html, /Bye ½/);
});

test('pairing HTML uses pRating values when projected rating view is selected', () => {
  const t = tournament();
  const projections = calculateRatingProjectionAfterRound(t, 1);
  const html = pairingListHTML(t, 1, { ratingMode: 'projected' });

  assert.match(html, /<th class="num">pRating<\/th>/);
  assert.match(html, new RegExp(`<td class="num">${projections.get('p1').projectedRatingRounded}<\\/td>`));
  assert.match(html, new RegExp(`<td class="num">${projections.get('p2').projectedRatingRounded}<\\/td>`));
});

test('standings HTML includes start number and type columns', () => {
  const html = standingsHTML(tournament(), 1);
  assert.match(html, /Rank after Round 1/);
  assert.match(html, /SNo/);
  assert.match(html, /Typ/);
  assert.match(html, /U15/);
  assert.match(html, /U17/);
});

test('standings exports omit blank names and separate withdrawn players', () => {
  const t = tournament();
  t.players.push(
    { id: 'p4', no: 4, name: 'Withdrawn Delta', rating: 1200, fed: 'SGP', fideId: '1004', type: 'U15', club: '', withdrawn: true },
    { id: 'p5', no: 5, name: '', rating: 1100, fed: 'SGP', fideId: '1005', type: 'U15', club: '' },
    { id: 'p6', no: 6, name: 'Inactive Echo', rating: 1000, fed: 'SGP', fideId: '1006', type: 'U15', club: '', active: false }
  );
  t.roundsData[0].byes.push({ playerId: 'p4', type: 'ZPB' }, { playerId: 'p5', type: 'ZPB' }, { playerId: 'p6', type: 'ZPB' });

  const html = standingsHTML(t, 1);
  const main = html.slice(html.indexOf('id="ranking-r1"'), html.indexOf('<h3>Withdrawn players</h3>'));
  const withdrawn = html.slice(html.indexOf('<h3>Withdrawn players</h3>'));

  assert.doesNotMatch(html, /<td><\/td>/);
  assert.doesNotMatch(main, /Withdrawn Delta/);
  assert.doesNotMatch(main, /Inactive Echo/);
  assert.match(withdrawn, /Withdrawn Delta/);
  assert.match(withdrawn, /Inactive Echo/);

  const csv = standingsCSV(t, 1);
  const normalCsv = csv.slice(0, csv.indexOf('\n\nWithdrawn players'));
  const withdrawnCsv = csv.slice(csv.indexOf('\n\nWithdrawn players'));

  assert.doesNotMatch(csv, /,,/);
  assert.doesNotMatch(normalCsv, /Withdrawn Delta/);
  assert.doesNotMatch(normalCsv, /Inactive Echo/);
  assert.match(withdrawnCsv, /Withdrawn Delta/);
  assert.match(withdrawnCsv, /Inactive Echo/);
});

test('standings exports print unresolved ties with a shared rank range', () => {
  const t = tiedRankingTournament();
  const html = standingsHTML(t, 1);

  assert.match(html, /<td class="num">1-4<\/td><td class="num">1<\/td><td>Alpha<\/td>/);
  assert.match(html, /<td class="num">1-4<\/td><td class="num">2<\/td><td>Beta<\/td>/);
  assert.match(html, /<td class="num">1-4<\/td><td class="num">3<\/td><td>Gamma<\/td>/);

  const lines = standingsCSV(t, 1).split('\n');
  assert.equal(lines[1].startsWith('1-4,1,Alpha'), true);
  assert.equal(lines[2].startsWith('1-4,2,Beta'), true);
  assert.equal(lines[3].startsWith('1-4,3,Gamma'), true);
});

test('standings exports can use projected rating mode', () => {
  const html = standingsHTML(tournament(), 1, { ratingMode: 'projected' });
  assert.match(html, /<th class="num">pRating<\/th>/);
  assert.doesNotMatch(html, /<th class="num">Rtg<\/th>/);
  assert.match(html, /<td>Alice Alpha<\/td><td>U15<\/td><td>SGP<\/td><td class="num">1807<\/td>/);
  assert.match(html, /<td>Bob Beta<\/td><td>U17<\/td><td>IND<\/td><td class="num">1693<\/td>/);
  assert.match(html, /<td>Cara Gamma<\/td><td>U15<\/td><td>SGP<\/td><td class="num">—<\/td>/);

  const csv = standingsCSV(tournament(), 1, { ratingMode: 'projected' });
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Rank,No,Name,Fed,pRating,Points,BH,SB');
  assert.match(csv, /Alice Alpha,SGP,1807,/);
  assert.match(csv, /Bob Beta,IND,1693,/);
  assert.match(csv, /Cara Gamma,SGP,—,/);
});

test('full report lists and starting rank crosstable omit blanks and separate withdrawn players', () => {
  const t = tournament();
  t.players.push(
    { id: 'p4', no: 4, name: 'Withdrawn Delta', rating: 1200, fed: 'SGP', fideId: '1004', type: 'U15', club: 'South', withdrawn: true },
    { id: 'p5', no: 5, name: '', rating: 1100, fed: 'SGP', fideId: '1005', type: 'U15', club: 'West' },
    { id: 'p6', no: 6, name: 'Inactive Echo', rating: 1000, fed: 'SGP', fideId: '1006', type: 'U15', club: 'East', active: false }
  );
  t.roundsData[0].byes.push({ playerId: 'p4', type: 'ZPB' }, { playerId: 'p5', type: 'ZPB' }, { playerId: 'p6', type: 'ZPB' });

  const html = tournamentReportHTML(t, { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  const sections = [
    sectionById(html, 'starting-rank', 'alphabetical-list'),
    sectionById(html, 'alphabetical-list', 'pairings-r1'),
    sectionById(html, 'starting-rank-crosstable', 'statistics')
  ];

  assert.doesNotMatch(html, />1005</);
  assert.doesNotMatch(html, /<td><\/td><td class="num">1100<\/td>/);

  for (const section of sections) {
    const { main, withdrawn } = splitWithdrawnSection(section);
    assert.doesNotMatch(main, /Withdrawn Delta/);
    assert.doesNotMatch(main, /Inactive Echo/);
    assert.match(withdrawn, /Withdrawn Delta/);
    assert.match(withdrawn, /Inactive Echo/);
  }
});

test('full report HTML includes details, schedule, lists, crosstables and statistics', () => {
  const html = tournamentReportHTML(tournament(), 1);
  for (const text of [
    'Tournament details',
    'Playing schedule',
    'Starting rank',
    'Alphabetical list',
    'Pairings/Results',
    'not paired / byes',
    'Rank after Round 1',
    'Ranking crosstable after Round 1',
    'Starting rank crosstable',
    'Federation statistics',
    'Game statistics'
  ]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('full report boxes each section and keeps withdrawn rows inside their parent section', () => {
  const t = tournament();
  t.players.push(
    { id: 'p4', no: 4, name: 'Withdrawn Delta', rating: 1200, fed: 'SGP', fideId: '1004', type: 'U15', club: 'South', withdrawn: true },
    { id: 'p6', no: 6, name: 'Inactive Echo', rating: 1000, fed: 'SGP', fideId: '1006', type: 'U15', club: 'East', active: false }
  );
  t.roundsData[0].byes.push({ playerId: 'p4', type: 'ZPB' }, { playerId: 'p6', type: 'ZPB' });

  const html = tournamentReportHTML(t, { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  assert.match(html, /\.report-section\{/);

  for (const [, id] of html.matchAll(/<h2 id="([^"]+)"/g)) {
    assert.match(reportBoxById(html, id), new RegExp(`id="${id}"`));
  }

  for (const id of ['starting-rank', 'alphabetical-list', 'ranking-r1', 'ranking-crosstable-r1', 'starting-rank-crosstable']) {
    const box = reportBoxById(html, id);
    assert.match(box, /<h3>Withdrawn players<\/h3>/);
    assert.match(box, /Withdrawn Delta/);
    assert.match(box, /Inactive Echo/);
  }
});

test('full report ranking and crosstables print unresolved ties with shared rank ranges', () => {
  const html = tournamentReportHTML(tiedRankingTournament(), { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  const ranking = sectionById(html, 'ranking-r1', 'ranking-crosstable-r1');
  const rankingCross = sectionById(html, 'ranking-crosstable-r1', 'starting-rank-crosstable');
  const startingCross = sectionById(html, 'starting-rank-crosstable', 'statistics');

  assert.match(ranking, /<td class="num">1-4<\/td><td class="num">1<\/td><td>Alpha<\/td>/);
  assert.match(ranking, /<td class="num">1-4<\/td><td class="num">2<\/td><td>Beta<\/td>/);
  assert.match(rankingCross, /<tr><td class="num">1-4<\/td><td>Alpha<\/td>/);
  assert.match(rankingCross, /<tr><td class="num">1-4<\/td><td>Beta<\/td>/);
  assert.match(startingCross, /<td class="num">1<\/td><td>Alpha<\/td>[\s\S]*?<td class="num"><b>½<\/b><\/td><td class="num">1-4<\/td>/);
  assert.match(startingCross, /<td class="num">2<\/td><td>Beta<\/td>[\s\S]*?<td class="num"><b>½<\/b><\/td><td class="num">1-4<\/td>/);
});

test('full report ranking sections can use projected rating mode', () => {
  const html = tournamentReportHTML(tournament(), {
    uptoRound: 1,
    generatedAt: '2026-06-20T03:40:40',
    ratingMode: 'projected'
  });
  const ranking = sectionById(html, 'ranking-r1', 'ranking-crosstable-r1');
  const rankingCross = sectionById(html, 'ranking-crosstable-r1', 'starting-rank-crosstable');
  const startingCross = sectionById(html, 'starting-rank-crosstable', 'statistics');

  assert.match(ranking, /<th class="num">pRating<\/th>/);
  assert.match(ranking, /<td>Alice Alpha<\/td><td>U15<\/td><td>SGP<\/td><td class="num">1807<\/td>/);
  assert.match(rankingCross, /<th class="num">pRating<\/th>/);
  assert.match(rankingCross, /<td>Alice Alpha<\/td><td class="num">1807<\/td>/);
  assert.match(startingCross, /<th class="num">pRating<\/th>/);
  assert.match(startingCross, /<td>Alice Alpha<\/td><td class="num">1807<\/td>/);
});

test('full report HTML includes Chess-Results-style option rows', () => {
  const html = tournamentReportHTML(tournament(), { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  for (const text of [
    'Tournament selection',
    'Links',
    'Parameters',
    'Lists',
    'Board Pairings',
    'Ranking list after',
    'Excel and Print',
    'Last update 20.06.2026 03:40:40',
    'Creator/Last Upload: Elijah Paciencia'
  ]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('full report options use internal anchors for report subsections', () => {
  const html = tournamentReportHTML(tournament(), { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  for (const fragment of [
    '#tournament-details',
    '#starting-rank',
    '#alphabetical-list',
    '#statistics',
    '#playing-schedule',
    '#ranking-crosstable-r1',
    '#starting-rank-crosstable',
    '#pairings-r1',
    '#not-paired',
    '#ranking-r1',
    '#excel-csv'
  ]) {
    assert.match(html, new RegExp(`href="${fragment}"`));
    assert.match(html, new RegExp(`id="${fragment.slice(1)}"`));
  }
  assert.doesNotMatch(html, /href="#team-roster"/);
  assert.doesNotMatch(html, /id="team-roster"/);
});

test('full report includes active tournament team roster only for team tournaments', () => {
  const current = teamTournament();
  const other = {
    ...teamTournament(),
    id: 'team2',
    name: 'Other Team Cup',
    rosterPlayers: [{ id: 'OP1', no: 1, name: 'Other Board One', rating: 1200, fed: 'SGP', fideId: '', type: '', club: '' }],
    teams: [{ id: 'other-team', playerId: 'OT1', name: 'Other Club', members: [{ rosterId: 'OP1', board: 1 }] }],
    players: [{ id: 'OT1', no: 1, name: 'Other Club', rating: 1200, fed: 'SGP' }]
  };
  const html = tournamentReportHTML(current, {
    uptoRound: 0,
    tournaments: [current, other],
    generatedAt: '2026-06-20T03:40:40'
  });
  const section = html.slice(html.indexOf('id="team-roster"'));

  assert.match(html, /href="#team-roster"/);
  assert.match(html, /id="team-roster"/);
  assert.match(html, /Team roster/);
  assert.ok(section.indexOf('Alpha Board One') < section.indexOf('Zeta Board One'));
  assert.doesNotMatch(section, /Other Board One/);
});

test('full report tournament selection links workspace tournaments to local reports', () => {
  const current = tournament();
  const other = companionTournament();
  const html = tournamentReportHTML(current, {
    uptoRound: 1,
    tournaments: [current, other],
    generatedAt: '2026-06-20T03:40:40'
  });
  assert.match(html, /Tournament selection/);
  assert.match(html, /Example Open/);
  assert.match(html, /href="Example-U9-report\.html"/);
  assert.match(html, />Example U9<\/a>/);
});

test('full report renders configured external publishing links', () => {
  const html = tournamentReportHTML(tournament(), { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  assert.match(html, /href="http:\/\/www\.chessgrande\.com\/"/);
  assert.match(html, /Official Homepage of the Organizer/);
  assert.match(html, /href="https:\/\/chessgrande\.com\/2026-uwc-chess-challenge\/"/);
  assert.match(html, /Registration/);
  assert.match(html, /href="https:\/\/chess-results\.com\/CalendarLink\.aspx\?lan=1&amp;tnr=1427449"/);
  assert.match(html, /Link with tournament calendar/);
  assert.match(html, /QR-Codes/);
});

test('full report uses generatedAt as fallback last update', () => {
  const t = tournament();
  t.publish.lastUpdate = '';
  const html = tournamentReportHTML(t, { uptoRound: 1, generatedAt: '2026-06-20T03:40:40' });
  assert.match(html, /Last update 20\.06\.2026 03:40:40/);
});
