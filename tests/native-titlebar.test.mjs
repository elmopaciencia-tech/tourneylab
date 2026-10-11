import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('macOS window chrome is inset into the application shell', () => {
  assert.match(main, /titleBarStyle:\s*'hiddenInset'/);
  assert.match(main, /trafficLightPosition:\s*\{\s*x:\s*16,\s*y:\s*18\s*\}/);
  assert.match(preload, /platform:\s*process\.platform/);
  assert.match(app, /document\.documentElement\.dataset\.platform\s*=\s*window\.tl\?\.platform/);
  assert.match(css, /html\[data-platform="darwin"\]\s+#sidebar/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /-webkit-app-region:\s*no-drag/);
});

test('collapsed macOS titlebar clears the traffic lights and owns the sidebar toggle', () => {
  assert.match(app, /class:\s*'titlebar-control titlebar-sidebar-toggle'/);
  assert.match(app, /class:\s*'sidebar-glyph'/);
  assert.match(css, /html\[data-platform="darwin"\]\s+\.sb-toggle\s*\{\s*display:\s*none;/);
  assert.match(css, /html\[data-platform="darwin"\]\s+\.titlebar-sidebar-toggle/);
  assert.match(css, /left:\s*86px/);
  assert.match(css, /#app\.sidebar-collapsed\s+#topbar\s*\{\s*padding-left:\s*176px;/);
});

test('collapsed sidebar extends the main titlebar surface through the rail', () => {
  assert.match(css, /#app\.sidebar-collapsed\s+#sidebar::before\s*\{\s*background:\s*var\(--bg\)/);
  assert.match(css, /#app\.sidebar-collapsed\s+#sidebar::after/);
  assert.match(css, /top:\s*var\(--titlebar-height\)/);
  assert.match(css, /background:\s*var\(--divider\)/);
});

test('titlebar aligns app navigation with native controls and exposes back and forward actions', () => {
  assert.match(css, /--titlebar-height:\s*48px/);
  assert.match(css, /#topbar\s*>\s*\*\s*\{\s*transform:\s*translateY\(2px\)/);
  assert.match(css, /\.titlebar-controls[\s\S]*align-items:\s*center;[\s\S]*gap:\s*6px/);
  assert.match(app, /'aria-label':\s*'Back'/);
  assert.match(app, /'aria-label':\s*'Forward'/);
  assert.match(app, /class:\s*'titlebar-control titlebar-settings-button'[\s\S]*'aria-label':\s*'Workspace settings'[\s\S]*onclick:\s*openWorkspaceSettings/);
  assert.match(app, /travelNavigationHistory\(-1\)/);
  assert.match(app, /travelNavigationHistory\(1\)/);
});

test('windowed macOS navigation aligns to traffic lights without changing fullscreen positioning', () => {
  assert.match(main, /ipcMain\.handle\('window:mode'/);
  assert.match(main, /win\.on\('enter-full-screen', sendWindowMode\)/);
  assert.match(main, /win\.on\('leave-full-screen', sendWindowMode\)/);
  assert.match(preload, /windowMode:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('window:mode'\)/);
  assert.match(preload, /onWindowModeChanged:/);
  assert.match(app, /dataset\.windowMode/);
  assert.match(css, /html\[data-platform="darwin"\]\[data-window-mode="windowed"\]\s+#topbar\s*>\s*\.titlebar-controls\s*\{\s*transform:\s*none;/);
});

test('fullscreen macOS navigation uses the native titlebar safe area', () => {
  assert.match(main, /titleBarOverlay:\s*true/);
  assert.match(css, /html\[data-platform="darwin"\]\[data-window-mode="fullscreen"\]\s+\.titlebar-controls\s*\{[^}]*left:\s*max\(8px,\s*calc\(env\(titlebar-area-x,\s*0px\)\s*\+\s*6px\)\)/);
  assert.match(css, /html\[data-platform="darwin"\]\[data-window-mode="fullscreen"\]\s+#app\.sidebar-collapsed\s+#topbar\s*\{[^}]*padding-left:\s*calc\(max\(8px,\s*calc\(env\(titlebar-area-x,\s*0px\)\s*\+\s*6px\)\)\s*\+\s*82px\)/);
});

test('titlebar control glyphs are reduced without scaling breadcrumb navigation', () => {
  assert.match(css, /\.sidebar-glyph\s*\{[\s\S]*transform:\s*scale\(0\.9\)/);
  assert.match(css, /\.history-glyph\s*\{[\s\S]*font-size:\s*18px/);
  assert.doesNotMatch(css, /#topbar \.crumb\s*\{[^}]*transform:/);
});

test('titlebar divider extends through the sidebar only while collapsed', () => {
  const divider = /box-shadow:\s*inset\s+0\s+-1px\s+0\s+var\(--divider\)/g;
  assert.equal([...css.matchAll(divider)].length, 2);
  assert.match(css, /#app\.sidebar-collapsed\s+#sidebar::before\s*\{[\s\S]*box-shadow:\s*inset\s+0\s+-1px\s+0\s+var\(--divider\)/);
});
