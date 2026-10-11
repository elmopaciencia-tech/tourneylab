import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contentZoomAction } = require('../content-zoom-shortcuts.cjs');
const {
  CONTENT_ZOOM_DEFAULT,
  CONTENT_ZOOM_LEVELS,
  contentZoomForAction,
  normalizeContentZoom
} = await import('../renderer/js/content-zoom.js');

const mainSource = fs.readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
const preloadSource = fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('Electron recognizes platform zoom shortcuts without capturing ordinary typing', () => {
  assert.equal(contentZoomAction({ type: 'keyDown', meta: true, key: '+' }, 'darwin'), 'in');
  assert.equal(contentZoomAction({ type: 'keyDown', meta: true, key: '=' }, 'darwin'), 'in');
  assert.equal(contentZoomAction({ type: 'keyDown', meta: true, key: '-' }, 'darwin'), 'out');
  assert.equal(contentZoomAction({ type: 'keyDown', meta: true, key: '0' }, 'darwin'), 'reset');
  assert.equal(contentZoomAction({ type: 'keyDown', control: true, code: 'NumpadAdd' }, 'win32'), 'in');
  assert.equal(contentZoomAction({ type: 'keyDown', control: true, code: 'NumpadSubtract' }, 'linux'), 'out');
  assert.equal(contentZoomAction({ type: 'keyUp', meta: true, key: '+' }, 'darwin'), null);
  assert.equal(contentZoomAction({ type: 'keyDown', key: '+' }, 'darwin'), null);
  assert.equal(contentZoomAction({ type: 'keyDown', control: true, key: '+' }, 'darwin'), null);
  assert.equal(contentZoomAction({ type: 'keyDown', meta: true, alt: true, key: '+' }, 'darwin'), null);
});

test('content zoom uses bounded familiar levels and supports reset', () => {
  assert.deepEqual(CONTENT_ZOOM_LEVELS, [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
  assert.equal(CONTENT_ZOOM_DEFAULT, 1);
  assert.equal(contentZoomForAction(1, 'in'), 1.1);
  assert.equal(contentZoomForAction(1.1, 'in'), 1.25);
  assert.equal(contentZoomForAction(1, 'out'), 0.9);
  assert.equal(contentZoomForAction(2, 'in'), 2);
  assert.equal(contentZoomForAction(0.8, 'out'), 0.8);
  assert.equal(contentZoomForAction(1.75, 'reset'), 1);
  assert.equal(normalizeContentZoom('1.26'), 1.25);
  assert.equal(normalizeContentZoom(null), 1);
  assert.equal(normalizeContentZoom(''), 1);
  assert.equal(normalizeContentZoom('invalid'), 1);
});

test('native page zoom is intercepted and forwarded through the isolated preload bridge', () => {
  assert.match(mainSource, /before-input-event/);
  assert.match(mainSource, /contentZoomAction\(input/);
  assert.match(mainSource, /event\.preventDefault\(\)/);
  assert.match(mainSource, /webContents\.send\('content-zoom:shortcut', action\)/);
  assert.match(preloadSource, /onContentZoomShortcut:/);
  assert.match(preloadSource, /ipcRenderer\.on\('content-zoom:shortcut'/);
  assert.match(appSource, /window\.tl\?\.onContentZoomShortcut/);
});

test('only the main page contents receive CSS zoom', () => {
  assert.match(htmlSource, /<div id="page" tabindex="-1">\s*<div id="page-zoom"><\/div>\s*<\/div>/);
  assert.match(appSource, /document\.getElementById\('page-zoom'\)/);
  assert.match(stylesSource, /#page-zoom\s*\{[^}]*zoom:\s*var\(--content-zoom\)/);
  assert.doesNotMatch(stylesSource, /#(?:app|sidebar|topbar|main)\s*\{[^}]*\bzoom:/);
  assert.doesNotMatch(stylesSource, /body\s*\{[^}]*\bzoom:/);
});

test('zoomed content retains the full page width without overflowing its window', () => {
  assert.match(stylesSource, /#page\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(stylesSource, /#page-zoom\s*\{[^}]*width:\s*100%/);
  assert.match(appSource, /classList\.toggle\('content-zoom-compact', contentZoom >= 1\.25\)/);
  assert.doesNotMatch(appSource, /--content-zoom-inverse/);
  assert.doesNotMatch(stylesSource, /--content-zoom-inverse/);
});
