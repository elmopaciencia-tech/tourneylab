import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('sidebar exposes a persistent accessible collapse toggle', () => {
  assert.match(appSource, /SIDEBAR_COLLAPSED_KEY/);
  assert.match(appSource, /function sidebarCollapsed/);
  assert.match(appSource, /function toggleSidebar/);
  assert.match(appSource, /localStorage\?\.setItem\(SIDEBAR_COLLAPSED_KEY/);
  assert.match(appSource, /classList\.toggle\('sidebar-collapsed'/);
  assert.match(appSource, /class:\s*'sb-toggle'/);
  assert.match(appSource, /aria-label/);
  assert.match(appSource, /aria-expanded/);
});

test('sidebar menu items have restrained click feedback that respects reduced motion', () => {
  assert.match(stylesSource, /@keyframes sidebar-item-click/);
  assert.match(stylesSource, /sidebar-item-click[\s\S]*?translateX\(4px\)[\s\S]*?background-color:\s*var\(--press\)/);
  assert.match(stylesSource, /\.sb-item-main\.clicking\s*\{\s*animation:\s*sidebar-item-click 0\.14s cubic-bezier/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.sb-item-main\.clicking\s*\{\s*animation:\s*none/);
  assert.match(appSource, /classList\.add\('clicking'\)/);
  assert.match(appSource, /setTimeout\(navigate, 110\)/);
  assert.match(appSource, /prefers-reduced-motion:\s*reduce/);
});

test('pressing the current sidebar item expands a collapsed sidebar', () => {
  assert.match(appSource, /function expandSidebarIfCollapsed\(\)[\s\S]*if \(!sidebarCollapsed\(\)\) return false;[\s\S]*setSidebarCollapsed\(false\);[\s\S]*renderSidebar\(\);[\s\S]*renderTopbar\(\);[\s\S]*return true;/);
  assert.match(appSource, /const active = opts\.active \?\? \(route\.view === view\);/);
  assert.match(appSource, /onclick:\s*event => \{\s*if \(active && expandSidebarIfCollapsed\(\)\) return;/);
  assert.match(appSource, /route\.view === 'home' && expandSidebarIfCollapsed\(\)/);
});

test('workspace header brand returns home and swaps to the square logo when collapsed', () => {
  assert.match(appSource, /class:\s*'workspace-brand'[\s\S]*title:\s*'Home · Double-click to toggle sidebar'[\s\S]*'aria-label':\s*'Home'[\s\S]*onclick:\s*handleWorkspaceBrandClick[\s\S]*ondblclick:\s*handleWorkspaceBrandDoubleClick[\s\S]*workspace-brand-logo[\s\S]*tourneylab-logo\.svg[\s\S]*workspace-brand-wordmark[\s\S]*tourneylab-wordmark\.svg/);
  assert.match(stylesSource, /\.workspace-brand\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*6px;[\s\S]*width:\s*180px;[\s\S]*height:\s*32px/);
  assert.match(stylesSource, /\.workspace-brand-wordmark\s*\{[\s\S]*width:\s*146px;[\s\S]*height:\s*36\.5px;[\s\S]*translateY\(-3px\)/);
  assert.match(stylesSource, /\.workspace-brand-logo\s*\{[\s\S]*width:\s*28px;[\s\S]*height:\s*28px;[\s\S]*border:\s*1px solid var\(--divider-strong\)/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-workspace\s*\{[\s\S]*margin:\s*2px 6px 2px;[\s\S]*padding:\s*2px 0/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-workspace\s*\{[^}]*width:\s*44px/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.workspace-brand\s*\{[\s\S]*width:\s*28px;[\s\S]*height:\s*28px/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.workspace-brand-logo\s*\{[\s\S]*display:\s*block;[\s\S]*width:\s*22px;[\s\S]*height:\s*22px/);
  assert.doesNotMatch(appSource, /class:\s*'workspace-label'/);
  assert.doesNotMatch(appSource, /class:\s*'sb-settings'/);
});

test('workspace brand distinguishes pointer double-click from Home activation', () => {
  assert.match(appSource, /const WORKSPACE_BRAND_DOUBLE_CLICK_DELAY_MS = 300;/);
  assert.match(appSource, /function activateWorkspaceBrand\(\)[\s\S]*route\.view === 'home' && expandSidebarIfCollapsed\(\)[\s\S]*go\('home'\)/);
  assert.match(appSource, /function handleWorkspaceBrandClick\(event\)[\s\S]*event\.detail === 0[\s\S]*activateWorkspaceBrand\(\)[\s\S]*event\.detail > 1[\s\S]*clearWorkspaceBrandClickTimer\(\)[\s\S]*window\.setTimeout/);
  assert.match(appSource, /window\.setTimeout\([\s\S]*activateWorkspaceBrand\(\);[\s\S]*WORKSPACE_BRAND_DOUBLE_CLICK_DELAY_MS/);
  assert.match(appSource, /function handleWorkspaceBrandDoubleClick\(event\)[\s\S]*event\.preventDefault\(\);[\s\S]*clearWorkspaceBrandClickTimer\(\);[\s\S]*toggleSidebar\(\);/);
});

test('collapsed sidebar keeps icons visible and hides text chrome', () => {
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+#sidebar/);
  assert.match(stylesSource, /width:\s*56px/);
  assert.match(stylesSource, /min-width:\s*56px/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-item\s+\.label/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-section/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.addrow/);
  assert.match(stylesSource, /\.sb-toggle/);
});

test('collapsed sidebar items animate open on hover or focus to reveal labels', () => {
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-item,\s*\n#app\.sidebar-collapsed\s+\.addrow/);
  assert.match(stylesSource, /transition:\s*width\s+0\.16s\s+ease/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-item:is\(:hover,\s*:focus-within\)/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.addrow:is\(:hover,\s*:focus-within\)/);
  assert.match(stylesSource, /width:\s*224px/);
  assert.match(stylesSource, /box-shadow:\s*var\(--shadow-pop\)/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-item:is\(:hover,\s*:focus-within\)\s+\.label/);
  assert.match(stylesSource, /max-width:\s*156px/);
  assert.match(stylesSource, /opacity:\s*1/);
});
