import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const views = await readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../renderer/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('workspace navigation and breadcrumbs expose keyboard and current-page semantics', () => {
  assert.match(app, /role:\s*'button'[\s\S]*tabindex:\s*'0'[\s\S]*onkeydown/);
  assert.match(app, /const active = opts\.active \?\? \(route\.view === view\);[\s\S]*'aria-current':\s*active \? 'page' : null/);
  assert.match(app, /setAttribute\('aria-label', 'Workspace navigation'\)/);
  assert.match(app, /setAttribute\('aria-label', 'Breadcrumb'\)/);
  assert.match(views, /class:\s*'child-row', role:\s*'link', tabindex:\s*'0'/);
});

test('setup tabs and dialogs expose accessible roles and keyboard containment', () => {
  assert.match(views, /role:\s*'tablist'/);
  assert.match(views, /role:\s*'tab'/);
  assert.match(views, /'aria-selected'/);
  assert.match(views, /role:\s*'tabpanel'/);
  assert.match(app, /role:\s*'dialog'/);
  assert.match(app, /'aria-modal':\s*'true'/);
  assert.match(app, /e\.key !== 'Tab'/);
  assert.match(app, /e\.key === 'Escape'/);
});

test('focus, live updates, and visually hidden headings remain perceivable', () => {
  assert.match(css, /\.visually-hidden/);
  assert.match(css, /\*:focus-visible/);
  assert.match(html, /id="toast-root" role="status" aria-live="polite"/);
  assert.match(html, /id="page" tabindex="-1"/);
});
