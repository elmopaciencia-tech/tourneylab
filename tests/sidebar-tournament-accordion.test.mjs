import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTournamentAccordion } from '../renderer/js/sidebar-tournament-accordion.js';

const appSource = fs.readFileSync(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('tournament accordion keeps at most one tournament expanded', () => {
  const accordion = createTournamentAccordion();

  assert.equal(accordion.expandedId(), null);
  assert.equal(accordion.select('event-a'), 'event-a');
  assert.equal(accordion.isExpanded('event-a'), true);
  assert.equal(accordion.select('event-b'), 'event-b');
  assert.equal(accordion.isExpanded('event-a'), false);
  assert.equal(accordion.isExpanded('event-b'), true);
});

test('the expanded tournament can be collapsed and reopened', () => {
  const accordion = createTournamentAccordion('event-a');

  assert.equal(accordion.toggle('event-a'), null);
  assert.equal(accordion.isExpanded('event-a'), false);
  assert.equal(accordion.toggle('event-a'), 'event-a');
  assert.equal(accordion.isExpanded('event-a'), true);
});

test('tournament rows render as accessible disclosure controls', () => {
  assert.match(appSource, /createTournamentAccordion/);
  assert.match(appSource, /class:\s*`sb-tournament-children/);
  assert.match(appSource, /disclosure:\s*\{[\s\S]*expanded,[\s\S]*controls:[\s\S]*onClick:/);
  assert.match(appSource, /'aria-expanded':\s*String\(opts\.disclosure\.expanded\)/);
  assert.match(appSource, /'aria-controls':\s*opts\.disclosure\.controls/);
  assert.match(stylesSource, /\.sb-item-disclosure/);
  assert.match(stylesSource, /\.sb-item-disclosure-glyph[\s\S]*rotate\(45deg\)/);
  assert.match(stylesSource, /\.sb-item\.tournament-expanded\s+\.sb-item-disclosure-glyph[\s\S]*rotate\(-135deg\)/);
});

test('the tournament chevron sits on the right beside the row actions', () => {
  const itemSource = appSource.slice(appSource.indexOf('function item('), appSource.indexOf('function windowIcon('));
  const mainIndex = itemSource.indexOf("class: 'sb-item-main'");
  const actionsIndex = itemSource.indexOf("class: 'sb-item-actions'");
  const disclosureIndex = itemSource.indexOf("class: 'sb-item-disclosure'");

  assert.ok(mainIndex >= 0, 'missing tournament row main action');
  assert.ok(actionsIndex > mainIndex, 'row actions should follow the tournament label');
  assert.ok(disclosureIndex > actionsIndex, 'the chevron should be the rightmost row control');
});

test('selecting a tournament or section expands its tournament group', () => {
  assert.match(appSource, /tournamentAccordion\.select\(event\.id\)[\s\S]*go\('event-overview'\)/);
  assert.match(appSource, /tournamentAccordion\.select\(event\.id\)[\s\S]*go\('overview'\)/);
  assert.match(appSource, /function syncTournamentAccordion[\s\S]*tournamentAccordion\.select\(eventId\)/);
});

test('opening a tournament animates its submenu only on the expansion transition', () => {
  assert.match(appSource, /let sidebarOpeningTournamentId = null/);
  assert.equal((appSource.match(/if \(!expanded\) sidebarOpeningTournamentId = event\.id/g) ?? []).length, 2);
  assert.match(appSource, /class:\s*`sb-tournament-children\$\{sidebarOpeningTournamentId === event\.id \? ' opening' : ''\}`/);
  assert.match(appSource, /sidebarOpeningTournamentId = null/);
  assert.match(stylesSource, /@keyframes sidebar-submenu-open[\s\S]*clip-path:\s*inset\(0 0 100% 0\)/);
  assert.match(stylesSource, /\.sb-tournament-children\.opening\s*\{[\s\S]*animation:\s*sidebar-submenu-open 0\.24s/);
  assert.match(stylesSource, /prefers-reduced-motion:[\s]*reduce[\s\S]*\.sb-tournament-children\.opening\s*\{\s*animation:\s*none/);
});
