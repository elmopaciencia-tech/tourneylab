import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sectionHasActiveRound } from '../renderer/js/sidebar-round-status.js';

const appSource = fs.readFileSync(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('a section has an active round only while its current pairings need results', () => {
  assert.equal(sectionHasActiveRound(null), false);
  assert.equal(sectionHasActiveRound({ currentRound: 0, roundsData: [] }), false);
  assert.equal(sectionHasActiveRound({
    currentRound: 1,
    roundsData: [{ round: 1, pairings: [{ result: '' }, { result: '1-0' }] }]
  }), true);
  assert.equal(sectionHasActiveRound({
    currentRound: 1,
    roundsData: [{ round: 1, pairings: [{ result: '1/2-1/2' }, { result: '1-0' }] }]
  }), false);
});

test('active-round detection follows the named current round and tolerates imported data', () => {
  const roundsData = [
    { round: 2, pairings: [{ result: '' }] },
    { round: 1, pairings: [{ result: '1-0' }] }
  ];

  assert.equal(sectionHasActiveRound({ currentRound: 1, roundsData }), false);
  assert.equal(sectionHasActiveRound({ currentRound: 2, roundsData }), true);
  assert.equal(sectionHasActiveRound({ roundsData: [{ pairings: [{ result: '  ' }] }] }), true);
});

test('sidebar marks live sections and collapsed tournament groups', () => {
  assert.match(appSource, /sectionHasActiveRound/);
  assert.match(appSource, /const activeRoundSections = sections\.filter\(sectionHasActiveRound\)/);
  assert.match(appSource, /roundActiveIcon:\s*!expanded && activeRoundSections\.length > 0/);
  assert.match(appSource, /const roundActive = sectionHasActiveRound\(section\)/);
  assert.match(appSource, /roundActive,[\s\S]*roundActiveLabel:\s*roundActive \?/);
  assert.match(appSource, /opts\.roundActive \? ' round-active' : ''/);
  assert.match(appSource, /opts\.roundActiveIcon \? ' round-active-icon' : ''/);
});

test('Rounds & results subtab shares the active-round status', () => {
  assert.match(appSource, /for \(const v of VIEWS\)[\s\S]*const roundActive = v\.id === 'rounds' && sectionHasActiveRound\(t\)/);
  assert.match(appSource, /item\(v\.id, v\.icon,[\s\S]*?[\s\S]*roundActive,[\s\S]*roundActiveLabel:\s*roundActive \?/);
});

test('selecting a section opens Rounds & results by default', () => {
  assert.match(appSource, /store\.data\.activeId = section\.id;[\s\S]*store\.data\.activeEventId = event\.id;[\s\S]*go\('rounds'\);/);
});

test('active-round animation moves from the row to its icon in collapsed states', () => {
  assert.match(stylesSource, /@keyframes sidebar-round-row-pulse/);
  assert.match(stylesSource, /\.sb-item\.round-active\s*\{[\s\S]*animation:\s*sidebar-round-row-pulse/);
  assert.match(stylesSource, /\.sb-item\.round-active-icon\s+\.icon[\s\S]*animation:\s*sidebar-round-icon-pulse/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-item\.round-active\s*\{[\s\S]*animation:\s*none/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-item\.round-active\s+\.icon[\s\S]*animation:\s*sidebar-round-icon-pulse/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*round-active/);
});
