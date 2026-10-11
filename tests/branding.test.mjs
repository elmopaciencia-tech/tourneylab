import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const views = await readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('homepage uses the standalone TourneyLab SVG without badge treatment', () => {
  assert.match(views, /class:\s*'page-icon home-brand-logo'[\s\S]*tourneylab-logo\.svg/);
  assert.match(views, /class:\s*'page-title home-brand-wordmark'[\s\S]*'aria-label':\s*'TourneyLab'[\s\S]*tourneylab-wordmark\.svg/);
  assert.match(css, /\.home-brand-logo\s*\{[^}]*width:\s*72px;[^}]*height:\s*72px;[^}]*\}/);
  assert.doesNotMatch(css, /\.home-brand-logo\s*\{[^}]*(?:border|background):/);
  assert.match(css, /\.home-brand-logo img\s*\{[\s\S]*width:\s*72px;[\s\S]*height:\s*72px/);
  assert.match(css, /\.home-brand-wordmark\s*\{[\s\S]*width:\s*360px;[\s\S]*height:\s*96px;[\s\S]*margin:\s*4px 0 8px;[\s\S]*overflow:\s*visible/);
  assert.match(css, /\.home-brand-wordmark img\s*\{[\s\S]*width:\s*360px;[\s\S]*height:\s*90px;[\s\S]*translateY\(-7px\);[\s\S]*filter:\s*brightness\(0\)/);
  assert.doesNotMatch(views, /h\('h1',\s*\{\s*class:\s*'page-title'\s*\},\s*'TourneyLab'/);
});
