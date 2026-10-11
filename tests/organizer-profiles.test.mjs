import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { migrateWorkspace } from '../renderer/js/setup/schema.js';
import { store } from '../renderer/js/store.js';

globalThis.window = {};

function resetStore(input = { tournaments: [] }) {
  store.persist = () => {};
  store.listeners.clear();
  store.data = migrateWorkspace(input);
}

test('workspace migration normalizes local organizer profiles and their active selection', () => {
  const migrated = migrateWorkspace({
    tournaments: [],
    settings: {
      organizerProfiles: [{ id: 'profile-1', name: 'School events', federation: 'sgp' }],
      activeOrganizerProfileId: 'missing'
    }
  });

  assert.equal(migrated.settings.organizerProfiles[0].federation, 'SGP');
  assert.equal(migrated.settings.organizerProfiles[0].defaultFed, 'SGP');
  assert.equal(migrated.settings.activeOrganizerProfileId, 'profile-1');
});

test('new tournaments inherit the active organizer profile without changing portable event data', () => {
  resetStore({
    tournaments: [],
    settings: {
      organizerProfiles: [{
        id: 'profile-1', name: 'School events', organizer: 'Tournament Office',
        federation: 'SGP', defaultFed: 'SGP', site: 'Singapore',
        chiefArbiter: 'Chief Arbiter', deputyArbiters: 'Deputy Arbiter', arbiterEmail: 'arbiter@example.com',
        defaultRatingType: 'rapid', defaultRatingSource: 'fideRapid',
        listOptions: { showFideId: false, showFederation: true, showClub: true, showBirthYear: true, showTitles: false }
      }],
      activeOrganizerProfileId: 'profile-1'
    }
  });

  const section = store.newEvent();
  const event = store.eventForSection(section);

  assert.equal(event.organizer, 'Tournament Office');
  assert.equal(event.federation, 'SGP');
  assert.equal(event.defaultFed, 'SGP');
  assert.equal(event.site, 'Singapore');
  assert.deepEqual(event.arbiters, { chief: 'Chief Arbiter', deputies: 'Deputy Arbiter', email: 'arbiter@example.com' });
  assert.equal(event.ratingType, 'rapid');
  assert.equal(event.ratingSource, 'fideRapid');
  assert.equal(event.listOptions.showBirthYear, true);
  assert.equal(section.site, 'Singapore');
  assert.equal(section.defaultFed, 'SGP');
});

test('sidebar and settings page expose organizer profile management', async () => {
  const [app, views, css] = await Promise.all([
    readFile(new URL('../renderer/js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(app, /item\('archives', 'archive', 'Archived tournaments'\),[\s\S]*item\('settings', '⚙️', 'Settings'\)/);
  assert.match(views, /case 'settings': return WorkspaceSettings\(\)/);
  assert.match(views, /function WorkspaceSettings\(/);
  assert.match(views, /function organizerProfileEditor\(/);
  for (const label of ['Organizer profiles', 'Chief arbiter', 'Default player federation', 'Make default', 'Save profile']) {
    assert.ok(views.includes(label), `missing ${label}`);
  }
  assert.match(css, /\.settings-profile-layout/);
});

test('saved setup profiles reuse rules and identity but never event dates, players or results', () => {
  resetStore();
  const source = store.newEvent({ name: 'Old event', site: 'School hall', startDate: '2026-09-19' });
  const event = store.eventForSection(source);
  store.setTournamentProfileValue(event.id, 'swiss', 'timeControl', '15+10');
  source.players.push({ id: 'private-player', name: 'Existing player' });
  const profile = store.saveTournamentSetupProfile(event, source, 'School rapid', true);
  const fresh = store.newEvent({ name: 'Next event' });
  const freshEvent = store.eventForSection(fresh);
  assert.equal(freshEvent.name, 'Next event');
  assert.equal(freshEvent.site, 'School hall');
  assert.equal(freshEvent.startDate, '');
  assert.equal(fresh.timeControl, '15+10');
  assert.deepEqual(fresh.players, []);
  assert.deepEqual(fresh.roundsData, []);
  fresh.scoring.win = 3;
  assert.equal(profile.section.scoring.win, 1);
  freshEvent.startDate = '2026-10-01';
  store.applyTournamentSetupProfile(freshEvent, fresh, profile.id);
  assert.equal(fresh.scoring.win, 1);
  assert.equal(freshEvent.startDate, '2026-10-01');
  assert.equal(freshEvent.name, 'Next event');
  const restored = migrateWorkspace(store.data);
  assert.equal(restored.settings.tournamentSetupProfiles[0].name, 'School rapid');
  fresh.roundsData.push({ pairings: [] });
  assert.throws(() => store.applyTournamentSetupProfile(freshEvent, fresh, profile.id), /before pairing/);
});
