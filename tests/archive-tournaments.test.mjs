import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { defaultEvent, defaultSection } from '../renderer/js/setup/defaults.js';
import {
  migrateWorkspace,
  parseTournamentDocument,
  serializeEventDocument,
  WORKSPACE_SCHEMA_VERSION
} from '../renderer/js/setup/schema.js';
import { store } from '../renderer/js/store.js';

globalThis.window = {};

function resetStore(input = { tournaments: [] }) {
  store.persist = () => {};
  store.listeners.clear();
  store.data = migrateWorkspace(input);
}

test('workspace v7 migration normalizes tournament archive state', () => {
  const activeEvent = defaultEvent({ id: 'e-active', name: 'Active' });
  const archivedEvent = defaultEvent({ id: 'e-archived', name: 'Archived', archived: true });
  const migrated = migrateWorkspace({
    schemaVersion: 6,
    events: [activeEvent, archivedEvent],
    tournaments: [
      defaultSection({ id: 's-active', eventId: activeEvent.id }),
      defaultSection({ id: 's-archived', eventId: archivedEvent.id })
    ],
    activeId: 's-active'
  });

  assert.equal(WORKSPACE_SCHEMA_VERSION, 7);
  assert.equal(migrated.events[0].archived, false);
  assert.equal(migrated.events[1].archived, true);
  assert.deepEqual(migrateWorkspace(migrated), migrated);
});

test('archiving and restoring preserve tournament data, order, and inactive navigation', () => {
  resetStore();
  const firstSection = store.newEvent({
    name: 'First',
    publish: { reportId: 'TL-FIRST', publicUrl: 'https://results.tourneylab.app/TL-FIRST' }
  });
  const firstEvent = store.eventForSection(firstSection);
  const secondSection = store.newEvent({ name: 'Second' });
  const secondEvent = store.eventForSection(secondSection);
  const before = structuredClone(firstEvent);
  let emissions = 0;
  store.listeners.add(() => { emissions += 1; });

  assert.equal(store.activeEvent.id, secondEvent.id);
  assert.equal(store.archiveEvent(firstEvent.id), firstEvent);
  assert.equal(firstEvent.archived, true);
  assert.equal(store.activeEvent.id, secondEvent.id);
  assert.deepEqual({ ...firstEvent, archived: false }, before);
  assert.deepEqual(store.data.events.map(event => event.id), [firstEvent.id, secondEvent.id]);

  assert.equal(store.restoreEvent(firstEvent.id), firstEvent);
  assert.equal(firstEvent.archived, false);
  assert.deepEqual(store.data.events.map(event => event.id), [firstEvent.id, secondEvent.id]);
  assert.equal(emissions, 2);
});

test('archiving the current tournament selects the next active tournament or clears selection', () => {
  resetStore();
  const firstSection = store.newEvent({ name: 'First' });
  const firstEvent = store.eventForSection(firstSection);
  const secondSection = store.newEvent({ name: 'Second' });
  const secondEvent = store.eventForSection(secondSection);

  store.archiveEvent(secondEvent.id);
  assert.equal(store.activeEvent.id, firstEvent.id);
  assert.equal(store.data.activeId, firstSection.id);

  store.archiveEvent(firstEvent.id);
  assert.equal(store.activeEvent, null);
  assert.equal(store.data.activeEventId, null);
  assert.equal(store.data.activeId, null);
});

test('permanent deletion still cascades through an archived tournament', () => {
  resetStore();
  const section = store.newEvent({ name: 'Archived' });
  const event = store.eventForSection(section);
  store.addSection(event.id, { sectionName: 'Second section' });
  store.archiveEvent(event.id);

  store.deleteEvent(event.id);

  assert.equal(store.data.events.some(item => item.id === event.id), false);
  assert.equal(store.data.tournaments.some(item => item.eventId === event.id), false);
});

test('portable tournament documents omit workspace archive state and reopen active', () => {
  const event = defaultEvent({ id: 'e1', name: 'Archived', archived: true });
  const section = defaultSection({ id: 's1', eventId: event.id });
  const document = serializeEventDocument(event, [section], section.id);

  assert.equal('archived' in document.event, false);
  assert.equal('archived' in parseTournamentDocument(document).event, false);

  resetStore();
  store.importDocument(document);
  assert.equal(store.activeEvent.archived, false);
});

test('sidebar links to a dedicated archive page without listing archived tournaments', async () => {
  const [app, views, css, main] = await Promise.all([
    readFile(new URL('../renderer/js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../main.cjs', import.meta.url), 'utf8')
  ]);

  assert.match(app, /filter\(event => !event\.archived\)/);
  assert.doesNotMatch(app, /filter\(event => event\.archived\)/);
  assert.match(app, /item\('home', '🏠', 'Home'\)[\s\S]*item\('archives', 'archive', 'Archived tournaments'\)/);
  assert.match(app, /entry\.view === 'home' \|\| entry\.view === 'archives'/);
  assert.doesNotMatch(app, /appendTournament\(event, true\)/);
  assert.ok(app.includes('Archive tournament'));
  assert.match(app, /class:\s*'sb-item-action'/);
  assert.match(app, /label:\s*`Archive /);
  assert.match(app, /label:\s*`Delete /);
  assert.match(app, /'aria-label':\s*action\.label/);
  assert.match(views, /filter\(event => !event\.archived\)/);
  assert.match(views, /case 'archives':\s*return ArchivedTournaments\(\)/);
  assert.match(views, /function ArchivedTournaments\([\s\S]*filter\(event => event\.archived\)/);
  assert.match(views, /function ArchivedTournaments\([\s\S]*store\.restoreEvent/);
  assert.match(views, /function ArchivedTournaments\([\s\S]*store\.deleteEvent/);
  assert.ok(views.includes('No archived tournaments.'));
  assert.ok(views.includes('Restore'));
  assert.ok(views.includes('Delete permanently'));
  assert.match(css, /\.sb-item:(?:hover|focus-within)[\s\S]*\.sb-item-actions/);
  assert.match(css, /#app\.sidebar-collapsed[\s\S]*\.sb-item-actions/);
  assert.match(main, /backupMigration\(workspaceFile\(\), data, 7\)/);
});
