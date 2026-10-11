import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const viewsSource = fs.readFileSync(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('players table makes every visible header resizable and gives names more room', () => {
  const columnBlock = viewsSource.match(/const PLAYER_COLUMNS = \[([\s\S]*?)\];/);
  assert.ok(columnBlock, 'player columns should be declared in one place');
  for (const key of ['number', 'name', 'rating', 'fed', 'club', 'born', 'type', 'points', 'status', 'actions']) {
    assert.match(columnBlock[1], new RegExp(`key:\\s*'${key}'`));
  }
  assert.match(columnBlock[1], /key:\s*'name'[\s\S]*?width:\s*260/);
  assert.match(viewsSource, /columns\.map\(col => playerHeaderCell\(t, col\)\)/);
  assert.match(viewsSource, /onpointerdown:\s*e => resizePlayerColumn\(e, col\)/);
  assert.match(stylesSource, /\.db\.players-table\s*\{[\s\S]*?table-layout:\s*fixed/);
});
