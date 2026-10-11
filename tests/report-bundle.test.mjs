import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { eventReportBundle } from '../renderer/js/export.js';
import { createReportArchive, validateReportBundle, writeReportBundle } from '../report-bundle.cjs';

function eventFixture() {
  const event = {
    id: 'event-1', name: 'Schools Festival', site: 'Main Hall', organizer: 'Chief Arbiter',
    registrations: [
      { id: 'reg-alice', name: 'Alice & Co', birthDate: '2015-04-03', ids: { national: 'PRIVATE-1' } },
      { id: 'reg-bob', name: 'Bob' },
      { id: 'reg-other-alice', name: 'Alice & Co' }
    ]
  };
  const section = {
    id: 'open', eventId: event.id, sectionName: 'Open', sectionCode: 'A', name: event.name,
    type: 'swiss', rounds: 2, currentRound: 2, scoring: { win: 1, draw: 0.5, loss: 0 },
    matchScoring: { win: 2, draw: 1, loss: 0 }, pabValue: 'win', tiebreaks: [],
    players: [
      { id: 'p1', registrationId: 'reg-alice', no: 1, name: 'Alice & Co', rating: 1700, fideId: '1001' },
      { id: 'p2', registrationId: 'reg-bob', no: 2, name: 'Bob', rating: 1600 },
      { id: 'p3', registrationId: 'reg-other-alice', no: 3, name: 'Alice & Co', rating: 1500 }
    ],
    roundsData: [
      { round: 1, date: '2026-08-18', pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }], byes: [{ playerId: 'p3', type: 'HPB' }] },
      { round: 2, date: '2026-08-19', pairings: [{ board: 1, whiteId: 'p2', blackId: 'p3', result: '' }], byes: [{ playerId: 'p1', type: 'FPB' }] }
    ]
  };
  return { event, section };
}

test('event report bundle creates separate linked section, round, player, CSS, and CSV files', () => {
  const { event, section } = eventFixture();
  const bundle = eventReportBundle(event, [section], { generatedAt: '2026-08-18T00:00:00Z' });
  const paths = new Set(bundle.files.map(file => file.path));

  for (const expected of [
    'index.html', 'assets/report.css', 'sections/open/index.html', 'sections/open/standings.csv',
    'sections/open/rounds/1.html', 'sections/open/rounds/2.html',
    'players/reg-alice.html', 'players/reg-bob.html', 'players/reg-other-alice.html'
  ]) assert.ok(paths.has(expected), `missing ${expected}`);

  const sectionHtml = bundle.files.find(file => file.path === 'sections/open/index.html').content;
  const roundHtml = bundle.files.find(file => file.path === 'sections/open/rounds/1.html').content;
  const aliceHtml = bundle.files.find(file => file.path === 'players/reg-alice.html').content;
  const css = bundle.files.find(file => file.path === 'assets/report.css').content;
  assert.match(sectionHtml, /\.\.\/\.\.\/players\/reg-alice\.html/);
  assert.match(sectionHtml, /Standings after Round 1/);
  assert.doesNotMatch(sectionHtml, /Pairings and results/);
  assert.match(roundHtml, /Pairings and results/);
  assert.doesNotMatch(roundHtml, /Standings after|Tournament details|Federation statistics/);
  assert.match(aliceHtml, /Bob/);
  assert.match(aliceHtml, /Bye 1/);
  assert.doesNotMatch(aliceHtml, /2015-04-03|PRIVATE-1/);
  assert.doesNotMatch(bundle.files.filter(file => file.contentType.startsWith('text/html')).map(file => file.content).join('').replace(/<script src="(?:\.\.\/)*assets\/report-search\.js" defer><\/script>/g, ''), /<script\b|\son[a-z]+=/i);
  assert.ok(Buffer.byteLength(css, 'utf8') <= 8307, 'shared report CSS exceeds the approved size budget');
  assert.match(css, /\.status-pending|\.status-exception|\.status-bye|\.status-inactive/);
  assert.match(css, /font-size:clamp\(28px,4vw,36px\)/);
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /@media print/);
});

test('report status styling is driven by structured results and participation state', () => {
  const registrations = Array.from({ length: 14 }, (_, i) => ({ id: `r${i + 1}`, name: `Player ${i + 1}` }));
  const players = registrations.map((registration, i) => ({
    id: `p${i + 1}`, registrationId: registration.id, no: i + 1, name: registration.name,
    ...(i === 11 ? { excludedRounds: [1] } : {}),
    ...(i === 12 ? { withdrawn: true } : {})
  }));
  const event = { id: 'status-event', name: 'Status Cup', registrations };
  const section = {
    id: 'status-section', eventId: event.id, sectionName: 'Open', name: event.name,
    type: 'swiss', rounds: 1, currentRound: 1, scoring: { win: 1, draw: 0.5, loss: 0 },
    pabValue: 'win', tiebreaks: [], players,
    roundsData: [{ round: 1, pairings: [
      { board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' },
      { board: 2, whiteId: 'p3', blackId: 'p4', result: '' },
      { board: 3, whiteId: 'p5', blackId: 'p6', result: '1F-0F' },
      { board: 4, whiteId: 'p7', blackId: 'p8', result: 'ADJ' },
      { board: 5, whiteId: 'p9', blackId: 'p10', result: '0-0' }
    ], byes: [{ playerId: 'p11', type: 'HPB' }] }]
  };
  const bundle = eventReportBundle(event, [section]);
  const file = path => bundle.files.find(item => item.path === path).content;
  const round = file('sections/status-section/rounds/1.html');

  assert.doesNotMatch(round, /class="status[^"]*"[^>]*>1 – 0/);
  assert.match(round, /class="status status-pending">Pending/);
  assert.match(round, /class="status status-pending">Adj\./);
  assert.match(round, /class="status status-exception">\+ \/ –/);
  assert.match(round, /class="status status-exception">0 – 0/);
  assert.match(round, /class="status status-bye">Bye ½/);
  assert.match(file('players/r12.html'), /class="status status-inactive">Excluded/);
  assert.match(file('players/r13.html'), /class="status status-inactive">Withdrawn \/ not paired/);
  assert.match(file('players/r14.html'), /class="status status-inactive">Not paired/);
});

test('canonical registrations merge across sections while identical names remain distinct', () => {
  const { event, section } = eventFixture();
  const rapid = {
    ...section, id: 'rapid', sectionName: 'Rapid', rounds: 1, currentRound: 1,
    players: [
      { id: 'q1', registrationId: 'reg-alice', no: 4, name: 'Alice & Co', rating: 1710 },
      { id: 'q2', registrationId: 'reg-bob', no: 5, name: 'Bob', rating: 1600 }
    ],
    roundsData: [{ round: 1, pairings: [{ board: 1, whiteId: 'q2', blackId: 'q1', result: '1/2-1/2' }], byes: [] }]
  };
  const bundle = eventReportBundle(event, [section, rapid]);
  const playerPaths = bundle.files.filter(file => file.path.startsWith('players/')).map(file => file.path);
  assert.equal(playerPaths.filter(file => file === 'players/reg-alice.html').length, 1);
  assert.ok(playerPaths.includes('players/reg-other-alice.html'));
  const alice = bundle.files.find(file => file.path === 'players/reg-alice.html').content;
  assert.match(alice, /Open round history/);
  assert.match(alice, /Rapid round history/);
});

test('team reports create team and board-player histories', () => {
  const event = { id: 'e-team', name: 'Team Cup', registrations: [{ id: 'r1', name: 'Ann' }, { id: 'r2', name: 'Ben' }, { id: 'r3', name: 'Cara' }] };
  const section = {
    id: 'teams', eventId: event.id, sectionName: 'Teams', name: event.name, type: 'team-swiss', rounds: 1, currentRound: 1,
    scoring: { win: 1, draw: 0.5, loss: 0 }, matchScoring: { win: 2, draw: 1, loss: 0 }, pabValue: 'win', tiebreaks: [], boardsPerMatch: 1,
    players: [{ id: 't1', no: 1, name: 'North' }, { id: 't2', no: 2, name: 'South' }],
    rosterPlayers: [{ id: 'rp1', registrationId: 'r1', name: 'Ann' }, { id: 'rp2', registrationId: 'r2', name: 'Ben' }, { id: 'rp3', registrationId: 'r3', name: 'Cara' }],
    teams: [{ id: 'tm1', playerId: 't1', name: 'North', members: [{ rosterId: 'rp1', board: 1 }, { rosterId: 'rp3', board: 2, reserve: true }] }, { id: 'tm2', playerId: 't2', name: 'South', members: [{ rosterId: 'rp2', board: 1 }] }],
    roundsData: [{ round: 1, pairings: [{ board: 1, whiteId: 't1', blackId: 't2', result: '1F-0F', matchScore: { w: 1, b: 0 }, teamBoards: [{ board: 1, whiteRosterId: 'rp1', blackRosterId: 'rp2', result: '1F-0F' }] }], byes: [] }]
  };
  const bundle = eventReportBundle(event, [section]);
  const file = path => bundle.files.find(item => item.path === path).content;
  assert.ok(bundle.files.some(file => file.path === 'sections/teams/teams/t1.html'));
  assert.ok(bundle.files.some(file => file.path === 'players/r1.html'));
  assert.match(file('sections/teams/rounds/1.html'), /Board results/);
  assert.match(file('players/r1.html'), /Ben/);
  assert.match(file('sections/teams/rounds/1.html'), /class="status status-exception"/);
  assert.match(file('sections/teams/teams/t1.html'), /class="status status-exception"/);
  assert.match(file('players/r1.html'), /class="status status-exception"/);
  assert.match(file('players/r3.html'), /class="status status-inactive">Not fielded/);
});

test('report bundle archive and local writer validate paths and never overwrite a site folder', () => {
  const { event, section } = eventFixture();
  const bundle = eventReportBundle(event, [section]);
  validateReportBundle(bundle);
  const archive = createReportArchive(bundle);
  assert.equal(archive.subarray(0, 8).toString('ascii'), 'TLABRB1\n');

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tourneylab-report-'));
  try {
    const first = writeReportBundle(fs, path, parent, 'Festival-report', bundle);
    const second = writeReportBundle(fs, path, parent, 'Festival-report', bundle);
    assert.notEqual(first.directory, second.directory);
    assert.equal(fs.readFileSync(first.indexPath, 'utf8').includes('Schools Festival'), true);
    assert.throws(() => validateReportBundle({ ...bundle, files: [{ ...bundle.files[0], path: '../escape.css' }] }), /Invalid report file path/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
