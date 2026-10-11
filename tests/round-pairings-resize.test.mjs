import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const viewsSource = fs.readFileSync(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('round pairings table exposes resizable rating columns that toggle Rtg and pRating', () => {
  const columnBlock = viewsSource.match(/const ROUND_PAIRING_COLUMNS = \[([\s\S]*?)\];/);

  assert.ok(columnBlock, 'round pairing columns should be declared in one place');
  for (const key of ['board', 'whitePts', 'whitePRating', 'white', 'result', 'black', 'blackPRating', 'blackPts']) {
    assert.match(columnBlock[1], new RegExp(`key:\\s*'${key}'`));
  }
  assert.equal((columnBlock[1].match(/rating:\s*true/g) ?? []).length, 2);
  assert.doesNotMatch(columnBlock[1], /actions/, 'action controls column should not be resizable');

  assert.match(viewsSource, /function pairingHeaderCell/);
  assert.match(viewsSource, /function resizePairingColumn/);
  assert.match(viewsSource, /onpointerdown:\s*e\s*=>\s*resizePairingColumn/);
  assert.match(viewsSource, /calculateRatingProjectionAfterRound/);
  assert.match(viewsSource, /ROUND_PAIRING_WIDTHS_KEY/);
  assert.match(viewsSource, /function pairingRatingCell/);
  assert.match(viewsSource, /ROUND_PAIRING_COLUMNS\.map\(col => pairingHeaderCell\(t, col, ratingMode\)\)/);
  assert.match(viewsSource, /toggleStandingsRatingMode\(\)/);
  assert.match(viewsSource, /pairingListHTML\(t, viewRound, \{ event: store\.activeEvent, ratingMode \}\)/);
});

test('round pairings resizing has scoped table and grip styles', () => {
  assert.match(stylesSource, /\.db\.round-pairings/);
  assert.match(stylesSource, /table-layout:\s*fixed/);
  assert.match(stylesSource, /\.round-pairings\s+th\.resizable/);
  assert.match(stylesSource, /\.round-pairings\s+\.rating-switch/);
  assert.match(stylesSource, /\.col-resizer/);
  assert.match(stylesSource, /cursor:\s*col-resize/);
});

test('round pairing widths redistribute space and remain resizable at compact zoom', () => {
  assert.match(viewsSource, /function redistributePairingWidths/);
  assert.match(viewsSource, /onkeydown: e =>/);
  assert.match(viewsSource, /resetPairingColumns/);
  assert.doesNotMatch(stylesSource, /round-pairings \.col-resizer\s*\{\s*display:\s*none/);
  assert.doesNotMatch(stylesSource, /round-pairings col:nth-child.*!important/);
});

test('truncated pairing names expose their full values as titles', () => {
  assert.match(viewsSource, /h\('td', \{ title: whiteName \}, whiteName/);
  assert.match(viewsSource, /h\('td', \{ title: blackName \}, blackName/);
  assert.match(viewsSource, /h\('td', \{ title: name \}, name/);
});

test('result dropdown text is centered within the round result column', () => {
  assert.match(viewsSource, /h\('td', \{ class: 'round-result' \}/);
  assert.match(stylesSource, /\.round-pairings \.round-result select\s*\{[\s\S]*text-align:\s*center/);
  assert.match(stylesSource, /\.round-pairings \.round-result select\s*\{[\s\S]*text-align-last:\s*center/);
  assert.match(stylesSource, /\.round-pairings \.round-result option\s*\{\s*text-align:\s*center/);
});

test('empty round result option uses a concise label without a leading dot', () => {
  assert.match(viewsSource, /h\('option', \{ value: '' \}, '\(no result\)'\)/);
  assert.doesNotMatch(viewsSource, /· \(no result\)/);
});

test('manual board controls are hidden in a menu and every action requires confirmation', () => {
  assert.match(viewsSource, /function pairingActionsMenu\(t, rd, pr\)/);
  assert.match(viewsSource, /h\('details', \{\s*class: 'pairing-actions-menu'/);
  assert.doesNotMatch(viewsSource, /These actions manually modify this round\./);
  assert.match(viewsSource, /const confirmAction = \(title, message, label, onConfirm, kind = 'primary'\)/);
  assert.match(viewsSource, /confirmAction\(\s*`Swap colours on board \$\{pr\.board\}\?`/);
  assert.match(viewsSource, /confirmAction\(\s*`Move board \$\{pr\.board\} up\?`/);
  assert.match(viewsSource, /confirmAction\(\s*`Move board \$\{pr\.board\} down\?`/);
  assert.match(viewsSource, /confirmAction\(\s*`Remove board \$\{pr\.board\}\?`/);
  assert.match(viewsSource, /pairingActionsMenu\(t, rd, pr\)/);
  assert.doesNotMatch(viewsSource, /style: 'width:120px;white-space:nowrap'/);
  assert.match(stylesSource, /\.pairing-actions-menu-panel\s*\{/);
  assert.doesNotMatch(stylesSource, /\.pairing-actions-warning\s*\{/);
});

test('confirmed board actions expose a one-step undo control for the current round', () => {
  assert.match(viewsSource, /let roundPairingUndo = null/);
  assert.match(viewsSource, /function captureRoundPairingUndo\(t, rd, label\)/);
  assert.match(viewsSource, /function undoRoundPairingAction\(t\)/);
  assert.match(viewsSource, /class: 'btn round-undo'/);
  assert.match(viewsSource, /iconLabel\('↶', 'Undo'\)/);
  assert.match(viewsSource, /roundPairingUndoAvailable\(t, viewRound\)/);
  const menuStart = viewsSource.indexOf('function pairingActionsMenu(t, rd, pr)');
  const menuEnd = viewsSource.indexOf('function captureRoundPairingUndo(', menuStart);
  assert.ok(menuStart >= 0 && menuEnd > menuStart, 'board action menu should be present');
  const menuSource = viewsSource.slice(menuStart, menuEnd);
  for (const [label, snapshot] of [
    ['Swap colours', 'colour swap'],
    ['Move up', 'move up'],
    ['Move down', 'move down'],
    ['Remove pairing', 'pairing removal']
  ]) {
    assert.match(menuSource, new RegExp(
      `'${label}',\\s*\\(\\) => \\{\\s*captureRoundPairingUndo\\(t, rd, '${snapshot}'\\);`
    ), `${label} should capture undo before changing the round`);
  }
});

test('the absent undo action does not append a literal null to the toolbar', () => {
  const roundsStart = viewsSource.indexOf('function Rounds(t)');
  const controlsBlock = viewsSource.slice(
    viewsSource.indexOf('if (t.roundsData.length) {', roundsStart),
    viewsSource.indexOf('kids.push(controls);', roundsStart)
  );
  assert.match(controlsBlock, /if \(roundPairingUndoAvailable\(t, viewRound\)\) controls\.append/);
  assert.doesNotMatch(controlsBlock, /roundPairingUndoAvailable[\s\S]*?: null/);
});

// Execute the production width logic, not an imitation, to catch no-op growth regressions.
const constants = viewsSource.slice(viewsSource.indexOf('const ROUND_PAIRING_COLUMNS'), viewsSource.indexOf('const STANDINGS_WIDTHS_KEY'));
const fit = viewsSource.slice(viewsSource.indexOf('function fittedRoundPairingWidths'), viewsSource.indexOf('function pairingHeaderCell'));
const redistribute = viewsSource.slice(viewsSource.indexOf('function redistributePairingWidths'), viewsSource.indexOf('function applyPairingWidths'));
const sizing = new Function(`${constants}\n${fit}\n${redistribute}\nreturn { columns: ROUND_PAIRING_COLUMNS, fit: fittedRoundPairingWidths, resize: redistributePairingWidths };`)();

test('each pairing column can grow and shrink without changing total width or violating minima', () => {
  const initial = sizing.fit();
  const total = widths => Object.values(widths).reduce((a, b) => a + b, 0);
  for (const col of sizing.columns) {
    for (const delta of [40, -40, 10000, -10000]) {
      const result = sizing.resize(initial, col, delta);
      assert.ok(Math.abs(total(result) - total(initial)) < 0.001);
      for (const item of sizing.columns) assert.ok(result[item.key] >= item.min - 0.001);
      if (delta > 0) assert.ok(result[col.key] > initial[col.key], `${col.key} must grow`);
      else assert.ok(result[col.key] < initial[col.key], `${col.key} must shrink`);
    }
  }
});

test('saved widths survive fitting and invalid widths recover to usable defaults', () => {
  const initial = sizing.fit();
  const changed = sizing.resize(initial, sizing.columns[3], 60);
  const restored = sizing.fit(JSON.parse(JSON.stringify(changed)));
  for (const col of sizing.columns) assert.ok(Math.abs(restored[col.key] - changed[col.key]) < 0.001);
  for (const value of [null, 'bad', Infinity, -20, 100000]) {
    const result = sizing.fit({ white: value });
    for (const col of sizing.columns) assert.ok(Number.isFinite(result[col.key]) && result[col.key] >= col.min);
  }
});

test('result shortcuts ignore nested controls and modified key combinations', () => {
  assert.match(viewsSource, /e.target !== e.currentTarget \|\| e.ctrlKey \|\| e.metaKey \|\| e.altKey \|\| team/);
});
