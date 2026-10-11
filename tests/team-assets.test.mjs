import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  defaultSection,
  defaultEvent,
  normalizeSection,
} from '../renderer/js/setup/defaults.js';
import {
  serializeEventDocument,
  parseTournamentDocument,
} from '../renderer/js/setup/schema.js';
import { exportXML, importXML } from '../renderer/js/engine/xml.js';
import { eventReportBundle } from '../renderer/js/export.js';
import { previewTeamCSV } from '../renderer/js/engine/team-csv.js';
import { seedBoards, saveMatchBoards } from '../renderer/js/engine/team.js';
import { calculateTeamReport } from '../renderer/js/engine/team-reports.js';
const require = createRequire(import.meta.url),
  { prepareReportBundle } = require('../report-assets.cjs'),
  {
    createReportArchive,
    validateReportBundle,
  } = require('../report-bundle.cjs'),
  ExcelJS = require('exceljs');
function fixture() {
  const t = defaultSection({
    id: 'team',
    eventId: 'event',
    type: 'team-swiss',
    rounds: 2,
    currentRound: 1,
    players: [
      { id: 'a', no: 1, name: 'School A' },
      { id: 'b', no: 2, name: 'School B' },
    ],
    rosterPlayers: [],
    teams: [],
    roundsData: [],
  });
  for (const id of ['a', 'b']) {
    const members = Array.from({ length: 5 }, (_, i) => ({
      rosterId: `${id}${i}`,
      board: i + 1,
      reserve: i === 4,
    }));
    t.teams.push({ playerId: id, members });
    t.rosterPlayers.push(
      ...members.map((m) => ({
        id: m.rosterId,
        no: m.board,
        name: `${id} player ${m.board}`,
        rating: 1600,
        fideId: '',
        byear: 2015,
      })),
    );
  }
  const m = { board: 1, whiteId: 'a', blackId: 'b' };
  const boards = seedBoards(t, m);
  boards.forEach((b) => (b.result = '1/2-1/2'));
  saveMatchBoards(t, m, boards);
  t.roundsData.push({ pairings: [m], byes: [] });
  return t;
}
test('CSV preview supports quoted names and validates duplicate board/identity without importing', () => {
  const p = previewTeamCSV(
    'team,board,reserve,name,rating,fideId\nSchool,1,no,"Tan, Alex",1500,100\nSchool,5,yes,Robin,0,101',
  );
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows[0].player.name, 'Tan, Alex');
  assert.equal(p.rows[1].reserve, true);
  assert.ok(
    previewTeamCSV('team,board,name\nA,1,Alex\nA,1,Alex').errors.length >= 2,
  );
  assert.throws(() => previewTeamCSV('name\nAlex'), /Missing team/);
});
test('team state, reserve histories and policies survive XML and event save/load', () => {
  const t = fixture();
  t.boardAwardManual = {
    '1:a0': { value: 3, reason: 'Eligibility adjustment' },
  };
  const imported = importXML(exportXML(t));
  for (const key of [
    'rosterPlayers',
    'teams',
    'roundsData',
    'teamPolicy',
    'boardAwardManual',
  ])
    assert.deepEqual(imported[key], t[key]);
  const event = defaultEvent({ id: 'event', sectionIds: [t.id] });
  const parsed = parseTournamentDocument(
    serializeEventDocument(event, [t], t.id),
  );
  const section = parsed.sections?.[0] ?? parsed.tournaments?.[0];
  assert.ok(section, JSON.stringify(Object.keys(parsed)));
  assert.deepEqual(section.roundsData, t.roundsData);
  assert.deepEqual(section.teamPolicy, t.teamPolicy);
  assert.equal(
    normalizeSection({ type: 'team-swiss' }).teamPolicy.rankingVersion,
    'legacy',
  );
  assert.equal(
    defaultSection({ type: 'team-swiss' }).teamPolicy.rankingVersion,
    'team-v1',
  );
});
test('changing lineup to a reserve keeps previous games intact and counts scheduled separately', () => {
  const t = fixture(),
    m = t.roundsData[0].pairings[0],
    before = JSON.stringify(m);
  const next = { board: 1, whiteId: 'a', blackId: 'b' };
  const b = seedBoards(t, next, { previous: true, round: 2 });
  b[3].blackRosterId = 'a4';
  saveMatchBoards(t, next, b);
  t.roundsData.push({ pairings: [next], byes: [] });
  const report = calculateTeamReport(t, 2);
  assert.equal(JSON.stringify(m), before);
  assert.equal(report.players.find((p) => p.player.id === 'a4').scheduled, 1);
  assert.equal(report.players.find((p) => p.player.id === 'a4').completed, 0);
  assert.equal(
    report.players.find((p) => p.player.id === 'a4').history[1].color,
    'B',
  );
  assert.equal(report.completedRound, 1);
});
test('native assets produce readable typed XLSX, PDF and QR in a compatible hashed archive', async () => {
  const t = fixture(),
    event = defaultEvent({
      id: 'event',
      name: 'Festival',
      publish: { publicUrl: 'https://example.test/results' },
      attachments: [
        {
          name: 'rules.pdf',
          label: 'Tournament rules',
          contentBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'),
        },
      ],
    });
  const before = eventReportBundle(event, [t]);
  const bundle = await prepareReportBundle(before);
  validateReportBundle(bundle);
  const paths = new Set(bundle.files.map((f) => f.path));
  for (const html of bundle.files.filter((f) =>
    f.contentType.startsWith('text/html'),
  ))
    for (const [, href] of html.content.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|data:|mailto:)/.test(href)) continue;
      const target = require('node:path').posix.normalize(
        require('node:path').posix.join(
          require('node:path').posix.dirname(html.path),
          href.split('#')[0],
        ),
      );
      assert.ok(paths.has(target), `${html.path}: broken ${href}`);
    }
  const file = bundle.files.find((f) => f.path.endsWith('.xlsx'));
  assert.ok(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(file.contentBase64, 'base64'));
  assert.equal(wb.getWorksheet('composition').rowCount, 11);
  assert.equal(
    typeof wb.getWorksheet('game-statistics').getCell('B2').value,
    'number',
  );
  assert.ok(bundle.files.some((f) => f.path.endsWith('.pdf')));
  assert.ok(bundle.files.some((f) => f.path.endsWith('.png')));
  assert.match(
    bundle.files.find((f) => f.path === 'index.html').content,
    /Tournament rules/,
  );
  assert.equal(
    createReportArchive(bundle).subarray(0, 8).toString(),
    'TLABRB1\n',
  );
  assert.ok(before.workbooks.length);
});
test('binary signature validation rejects disguised uploads', () => {
  assert.throws(
    () =>
      validateReportBundle({
        format: 'tourneylab-report-bundle',
        version: 1,
        entry: 'x.pdf',
        files: [
          {
            path: 'x.pdf',
            contentType: 'application/pdf',
            contentBase64: Buffer.from('hello').toString('base64'),
          },
        ],
      }),
    /signature/,
  );
});
