import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('sidebar navigation renders inside its own scroll viewport', () => {
  assert.match(appSource, /const scrollArea = h\('div', \{ class: 'sb-scroll-area' \}\);/);
  assert.match(appSource, /sb\.append\(scrollArea\);/);
  assert.match(appSource, /scrollArea\.append\([\s\S]*class:\s*'sb-workspace'/);
  assert.match(appSource, /scrollArea\.append\(h\('div', \{ class: 'sb-section' \}, 'Tournaments'\)\)/);
});

test('the app shell stays fixed while sidebar and page scroll independently', () => {
  assert.match(stylesSource, /body\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(stylesSource, /#sidebar\s*\{[\s\S]*display:\s*flex;[\s\S]*height:\s*100vh;[\s\S]*overflow:\s*visible/);
  assert.match(stylesSource, /\.sb-scroll-area\s*\{[\s\S]*flex:\s*1;[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(stylesSource, /#main\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden/);
  assert.match(stylesSource, /#page\s*\{[\s\S]*overflow-y:\s*auto/);
});

test('sidebar scrollbar is hidden without disabling wheel scrolling', () => {
  assert.match(stylesSource, /\.sb-scroll-area\s*\{[\s\S]*scrollbar-width:\s*none/);
  assert.match(stylesSource, /\.sb-scroll-area::-webkit-scrollbar\s*\{[\s\S]*display:\s*none/);
});

test('compact sidebar keeps hover flyouts while using the scroll viewport', () => {
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-scroll-area\s*\{[\s\S]*width:\s*244px;[\s\S]*clip-path:\s*inset\(0 188px 0 0\)/);
  assert.match(stylesSource, /#app\.sidebar-collapsed\s+\.sb-scroll-area:has\([\s\S]*clip-path:\s*inset\(0\)/);
});
