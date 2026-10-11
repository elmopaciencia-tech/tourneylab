import test from 'node:test';
import assert from 'node:assert/strict';

import { eventReportHTML, ratingAdminTRF, standingsHTML, tournamentPGN, tournamentReportHTML } from '../renderer/js/export.js';
import { defaultEvent, defaultSection } from '../renderer/js/setup/defaults.js';

const inheritedSetupSources = {
  site: 'tournament', startDate: 'tournament', endDate: 'tournament',
  timeControl: 'tournament', ratingType: 'tournament', rated: 'tournament',
  fideEventCode: 'tournament', fideReportCode: 'tournament'
};

function fixture() {
  const event = defaultEvent({
    id: 'e1',
    name: 'National Schools Championship',
    site: 'Singapore Expo',
    federation: 'SGP',
    organizer: 'Example Chess Club',
    timeControl: '60+30',
    rated: true,
    ratingType: 'standard',
    arbiters: { chief: 'Chief Arbiter', deputies: 'Deputy One', email: 'arbiter@example.test' },
    sectionIds: ['s1', 's2']
  });
  const section = defaultSection({
    id: 's1',
    eventId: event.id,
    name: 'Open',
    sectionName: 'Open',
    sectionCode: 'A',
    site: event.site,
    startDate: event.startDate,
    endDate: event.endDate,
    timeControl: event.timeControl,
    ratingType: event.ratingType,
    rated: event.rated,
    fideEventCode: event.fideEventCode,
    fideReportCode: event.fideReportCode,
    setupSources: inheritedSetupSources,
    rounds: 2,
    roundSchedule: [
      { round: 1, date: '2026-08-01', time: '09:00', site: 'Hall A' },
      { round: 2, date: '2026-08-01', time: '14:00', site: 'Hall A' }
    ],
    players: [
      { id: 'p1', no: 1, name: 'Alice', rating: 1800, fed: 'SGP' },
      { id: 'p2', no: 2, name: 'Bob', rating: 1700, fed: 'SGP' }
    ]
  });
  const second = defaultSection({ id: 's2', eventId: event.id, name: 'U12', sectionName: 'U12', sectionCode: 'B' });
  return { event, section, second };
}

test('section reports use event metadata and planned schedules before rounds are paired', () => {
  const { event, section } = fixture();
  const html = tournamentReportHTML(section, { event, uptoRound: 0, generatedAt: '2026-08-01T08:00:00' });

  assert.match(html, /National Schools Championship/);
  assert.match(html, /Open/);
  assert.match(html, /Singapore Expo/);
  assert.match(html, /Chief Arbiter/);
  assert.match(html, /60\+30/);
  assert.match(html, /01\/08\/2026/);
  assert.match(html, /09:00/);
});

test('full event report provides navigation and a report section for every event section', () => {
  const { event, section, second } = fixture();
  const html = eventReportHTML(event, [section, second], { generatedAt: '2026-08-01T08:00:00' });

  assert.match(html, /National Schools Championship/);
  assert.match(html, /A: Open/);
  assert.match(html, /B: U12/);
  assert.match(html, /id="section-s1"/);
  assert.match(html, /id="section-s2"/);
});

test('PGN receives event and section metadata without changing game generation', () => {
  const { event, section } = fixture();
  section.roundsData = [{
    round: 1,
    date: '2026-08-01',
    site: 'Hall A',
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }],
    byes: []
  }];
  const pgn = tournamentPGN(section, { event });

  assert.match(pgn, /\[Event "National Schools Championship - Open"\]/);
  assert.match(pgn, /\[Section "Open"\]/);
  assert.match(pgn, /\[TimeControl "60\+30"\]/);
  assert.match(pgn, /\[ChiefArbiter "Chief Arbiter"\]/);
});

test('tournament identity stays live while started section metadata stays local', () => {
  const { event, section, second } = fixture();
  Object.assign(section, {
    name: 'Stale name',
    site: 'Old venue',
    federation: 'OLD',
    organizer: 'Old organizer',
    startDate: '2020-01-01',
    endDate: '2020-01-02',
    arbiters: { chief: 'Old arbiter' },
    publish: { homepageUrl: 'https://old.example.test' }
  });
  event.publish.homepageUrl = 'https://live.example.test';
  section.roundsData = [{
    round: 1,
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }],
    byes: []
  }];
  section.currentRound = 1;

  const childHtml = standingsHTML(section, 1, { event });
  const report = tournamentReportHTML(section, { event, uptoRound: 1 });
  const fullEvent = eventReportHTML(event, [section, second]);
  const pgn = tournamentPGN(section, { event });
  const trf = ratingAdminTRF(section, 1, { event });

  for (const output of [childHtml, report, fullEvent, pgn, trf]) {
    assert.match(output, /National Schools Championship/);
    assert.doesNotMatch(output, /Stale name/);
  }
  assert.match(childHtml, /Old venue/);
  assert.match(report, /Old venue/);
  assert.match(trf, /022 Old venue/);
  assert.match(report, /https:\/\/live\.example\.test/);
  assert.doesNotMatch(report, /old\.example\.test/);
  assert.match(report, /Chief Arbiter/);
  assert.doesNotMatch(report, /Old arbiter/);
});

test('section overrides win in HTML, PGN, TRF, and full tournament reports', () => {
  const { event, section, second } = fixture();
  Object.assign(section, {
    site: 'Rapid Room',
    startDate: '2026-08-03',
    endDate: '2026-08-03',
    timeControl: '15+10',
    ratingType: 'rapid',
    fideEventCode: 'SECTION-EVENT',
    fideReportCode: 'SECTION-REPORT',
    setupSources: Object.fromEntries(Object.keys(inheritedSetupSources).map(field => [field, 'section'])),
    sectionArbiters: 'Section Arbiter'
  });
  section.roundsData = [{
    round: 1, date: '', site: '',
    pairings: [{ board: 1, whiteId: 'p1', blackId: 'p2', result: '1-0' }], byes: []
  }];

  const html = tournamentReportHTML(section, { event, uptoRound: 1 });
  const full = eventReportHTML(event, [section, second]);
  const pgn = tournamentPGN(section, { event });
  const trf = ratingAdminTRF(section, 1, { event });

  for (const output of [html, full]) {
    assert.match(output, /Rapid Room/);
    assert.match(output, /15\+10/);
    assert.match(output, /SECTION-EVENT/);
    assert.match(output, /SECTION-REPORT/);
    assert.match(output, /Section Arbiter/);
  }
  assert.match(pgn, /\[Site "Rapid Room"\]/);
  assert.match(pgn, /\[TimeControl "15\+10"\]/);
  assert.match(trf, /022 Rapid Room/);
  assert.match(trf, /042 2026-08-03/);
});
