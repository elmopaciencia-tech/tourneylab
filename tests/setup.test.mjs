import test from 'node:test';
import assert from 'node:assert/strict';

import {
  migrateWorkspace,
  parseTournamentDocument,
  serializeEventDocument,
  WORKSPACE_SCHEMA_VERSION
} from '../renderer/js/setup/schema.js';
import {
  defaultEvent,
  defaultSection,
  normalizeTiebreakConfig,
  registrationSectionLabels
} from '../renderer/js/setup/defaults.js';
import { applyRatingPolicy, ratingValue } from '../renderer/js/setup/ratingPolicy.js';
import { canEditSetupField, setupStatus } from '../renderer/js/setup/validation.js';
import { presetForType, TIEBREAK_PRESETS } from '../renderer/js/setup/presets.js';
import { store } from '../renderer/js/store.js';

globalThis.window = {};

test('time-control warnings follow the competition profile before and after pairing', () => {
  const event = defaultEvent({ name: 'School tournament', timeControl: '' });
  event.competitionProfiles.swiss.timeControl = '15+10';
  const section = defaultSection({ name: 'Open', type: 'swiss', timeControl: '' });
  section.setupSources.timeControl = 'tournament';
  const hasWarning = () => setupStatus(event, section).warnings.some(message => message.startsWith('Time control is blank'));
  assert.equal(hasWarning(), false);
  section.roundsData = [{ pairings: [] }];
  assert.equal(hasWarning(), false);
  section.setupSources.timeControl = 'section';
  assert.equal(hasWarning(), true);
  section.timeControl = '10+5';
  assert.equal(hasWarning(), false);
  section.setupSources.timeControl = 'tournament';
  event.timeControl = '90+30';
  event.competitionProfiles.swiss.timeControl = '';
  assert.equal(hasWarning(), true);
});

function legacyTournament(overrides = {}) {
  return {
    id: 'legacy-1',
    name: 'Legacy Open',
    site: 'Hall A',
    federation: 'SGP',
    organizer: 'Chief Arbiter',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    type: 'swiss',
    rounds: 7,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    tiebreaks: ['BH', 'SB'],
    players: [{ id: 'p1', no: 1, name: 'Alice', rating: 1800 }],
    roundsData: [],
    currentRound: 0,
    ...overrides
  };
}

test('legacy workspaces migrate into one event with one compatible section', () => {
  const migrated = migrateWorkspace({
    tournaments: [legacyTournament()],
    settings: { backupGenerations: 4 },
    activeId: 'legacy-1'
  });

  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(migrated.events.length, 1);
  assert.equal(migrated.tournaments.length, 1);
  assert.equal(migrated.activeId, 'legacy-1');
  assert.equal(migrated.activeEventId, migrated.events[0].id);
  assert.equal(migrated.tournaments[0].eventId, migrated.events[0].id);
  assert.equal(migrated.events[0].name, 'Legacy Open');
  assert.equal(migrated.tournaments[0].players[0].name, 'Alice');
  assert.deepEqual(migrated.tournaments[0].tiebreaks, ['BH', 'SB']);
  assert.deepEqual(migrated.tournaments[0].tiebreakConfig.map(x => x.code), ['BH', 'SB']);
  assert.equal(migrated.settings.backupGenerations, 4);
});

test('workspace migration is idempotent and repairs event section indexes', () => {
  const first = migrateWorkspace({ tournaments: [legacyTournament()], activeId: 'legacy-1' });
  first.events[0].sectionIds = [];
  const second = migrateWorkspace(first);

  assert.equal(second.events.length, 1);
  assert.equal(second.tournaments.length, 1);
  assert.deepEqual(second.events[0].sectionIds, ['legacy-1']);
  assert.equal(second.events[0].id, first.events[0].id);
});

test('new defaults cover schedule, section administration, team policy, and rating policy', () => {
  const event = defaultEvent({ name: 'City Championship' });
  const section = defaultSection({ eventId: event.id, name: event.name, rounds: 9 });

  assert.equal(event.ratingType, 'standard');
  assert.deepEqual(event.arbiters, { chief: '', deputies: '', email: '' });
  assert.equal(section.finalRound, 9);
  assert.equal(section.startingBoard, 1);
  assert.equal(section.restrictionPolicy, 'hard');
  assert.equal(section.lateEntryPolicy, 'manual');
  assert.equal(section.teamPairBy, 'matchPoints');
  assert.equal(section.ratingPolicy.primary, 'rating');
  assert.equal(section.initialRanking, 'rating');
  assert.equal(section.pairingSystem, 'fide-dutch');
  assert.deepEqual(section.listOptions, {
    showFideId: true,
    showFederation: true,
    showClub: true,
    showBirthYear: false,
    showNationalId: false,
    showTitles: true
  });
  assert.deepEqual(section.titleNorm, { enabled: false, category: '', reportCode: '' });
  assert.equal(section.roundSchedule.length, 9);
  assert.deepEqual(section.tiebreakConfig.map(x => x.code), section.tiebreaks);
});

test('registration section labels describe sections without exposing codes', () => {
  const event = defaultEvent({ name: 'Schools Festival' });
  const sections = [
    defaultSection({ sectionName: 'Open', sectionCode: 'A' }),
    defaultSection({ sectionName: 'U12', sectionCode: 'B' }),
    defaultSection({ sectionName: 'Girls Section', sectionCode: 'C' })
  ];

  assert.deepEqual(registrationSectionLabels(event, sections), [
    'Open Section',
    'U12 Section',
    'Girls Section'
  ]);
  assert.deepEqual(registrationSectionLabels(event, [
    defaultSection({ sectionName: '  schools festival  ', sectionCode: 'A' })
  ]), ['Main Section']);
});

test('registration section labels use codes only to disambiguate duplicate names', () => {
  const event = defaultEvent({ name: 'Schools Festival' });
  const sections = [
    defaultSection({ sectionName: 'U12', sectionCode: 'A' }),
    defaultSection({ sectionName: 'U12 Section', sectionCode: 'B' }),
    defaultSection({ sectionName: 'Open', sectionCode: 'C' })
  ];

  assert.deepEqual(registrationSectionLabels(event, sections), [
    'U12 Section (A)',
    'U12 Section (B)',
    'Open Section'
  ]);
});

test('structured tie-break configuration migrates strings and retains parameters', () => {
  assert.deepEqual(normalizeTiebreakConfig(['BH', 'BHC1']), [
    { code: 'BH', cutsLow: 0, cutsHigh: 0 },
    { code: 'BHC1', cutsLow: 1, cutsHigh: 0 }
  ]);
  assert.deepEqual(normalizeTiebreakConfig([{ code: 'BH', cutsLow: 2, cutsHigh: 1 }]), [
    { code: 'BH', cutsLow: 2, cutsHigh: 1 }
  ]);
});

test('event documents round-trip all sections and legacy files still open', () => {
  const event = defaultEvent({ id: 'event-1', name: 'Schools League', sectionIds: ['a', 'b'] });
  const sections = [
    defaultSection({ id: 'a', eventId: event.id, sectionName: 'Open' }),
    defaultSection({ id: 'b', eventId: event.id, sectionName: 'U12' })
  ];
  const doc = serializeEventDocument(event, sections, 'b');
  const parsed = parseTournamentDocument(doc);

  assert.equal(parsed.event.name, 'Schools League');
  assert.deepEqual(parsed.sections.map(s => s.sectionName), ['Open', 'U12']);
  assert.equal(parsed.activeSectionId, 'b');

  const legacy = parseTournamentDocument(legacyTournament());
  assert.equal(legacy.sections.length, 1);
  assert.equal(legacy.sections[0].name, 'Legacy Open');
  assert.equal(legacy.event.name, 'Legacy Open');
});

test('store creates, duplicates, switches, and deletes sections under one event', () => {
  store.persist = () => {};
  store.listeners.clear();
  store.data = migrateWorkspace({ tournaments: [] });

  const first = store.newEvent({ name: 'National Schools' }, { defaultFed: 'SGP' });
  const event = store.activeEvent;
  const second = store.addSection(event.id, { sectionName: 'U12', rounds: 6 });
  const copy = store.duplicateSection(second.id);

  assert.equal(first.eventId, event.id);
  assert.equal(first.sectionName, 'Open');
  assert.deepEqual(store.sectionsForEvent(event.id).map(s => s.sectionName), ['Open', 'U12', 'U12 copy']);
  assert.equal(copy.players.length, 0);
  assert.equal(copy.roundsData.length, 0);
  assert.notEqual(copy.id, second.id);
  assert.deepEqual(event.sectionIds, [first.id, second.id, copy.id]);

  store.setActive(second.id);
  assert.equal(store.activeEvent.id, event.id);
  store.deleteSection(second.id);
  assert.equal(store.data.tournaments.some(s => s.id === second.id), false);
  assert.deepEqual(event.sectionIds, [first.id, copy.id]);
});

test('rating policy resolves federation and local ratings without affecting missing values', () => {
  const section = defaultSection({
    ratingPolicy: { primary: 'fideRapid', fallback: 'national', unratedValue: 1000 },
    players: [
      { id: 'p1', rating: 1700, ratings: { fideRapid: 1900, national: 1800 } },
      { id: 'p2', rating: 1600, ratings: { national: 1750 } },
      { id: 'p3', rating: 0, ratings: {} }
    ]
  });

  assert.equal(ratingValue(section.players[0], section.ratingPolicy), 1900);
  applyRatingPolicy(section);
  assert.deepEqual(section.players.map(p => p.rating), [1900, 1750, 1000]);
});

test('setup validation blocks missing essentials, warns on incomplete administration, and locks pairing-critical fields', () => {
  const event = defaultEvent({ name: '', federation: '', timeControl: '' });
  const section = defaultSection({ name: '', sectionName: '', defaultFed: '', players: [] });
  let status = setupStatus(event, section);

  assert.equal(status.ok, false);
  assert.ok(status.errors.some(x => /name/i.test(x)));
  assert.ok(status.warnings.some(x => /federation/i.test(x)));
  assert.ok(status.warnings.some(x => /time control/i.test(x)));
  assert.equal(canEditSetupField(section, 'type'), true);

  section.roundsData.push({ pairings: [], byes: [] });
  for (const field of [
    'site', 'startDate', 'endDate', 'timeControl', 'ratingType', 'rated',
    'fideEventCode', 'fideReportCode', 'roundSchedule', 'publish'
  ]) {
    assert.equal(canEditSetupField(section, field), true, `${field} should remain editable after pairing`);
  }
  for (const field of [
    'type', 'rounds', 'pairingSystem', 'initialRanking', 'scoring',
    'tiebreakConfig', 'ratingPolicy', 'clubProtection'
  ]) {
    assert.equal(canEditSetupField(section, field), false, `${field} should lock after pairing`);
  }
});

test('intentional section overrides are neutral setup notes rather than warnings', () => {
  const event = defaultEvent({ name: 'Festival', timeControl: '60+30', ratingType: 'standard' });
  const section = defaultSection({
    eventId: event.id,
    name: event.name,
    sectionName: 'Rapid',
    timeControl: '15+0',
    ratingType: 'national',
    setupSources: { timeControl: 'section', ratingType: 'section' }
  });

  const status = setupStatus(event, section);

  assert.equal(status.warnings.some(message => /overrides tournament defaults/i.test(message)), false);
  assert.ok(status.notices.some(message => /overrides tournament defaults: time control, rating type/i.test(message)));
});

test('industry presets provide individual, team, round-robin, and USCF-style choices', () => {
  for (const id of ['fide-swiss', 'swiss-manager', 'team-swiss', 'round-robin', 'uscf-style']) {
    assert.ok(TIEBREAK_PRESETS.some(p => p.id === id), `missing ${id}`);
  }
  assert.equal(presetForType('team-swiss').id, 'team-swiss');
  assert.equal(presetForType('roundrobin').id, 'round-robin');
  assert.equal(presetForType('swiss').id, 'fide-swiss');
});
