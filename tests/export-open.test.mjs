import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
const viewsSource = fs.readFileSync(new URL('../renderer/js/views.js', import.meta.url), 'utf8');

test('pairing list HTML exports request browser auto-open', () => {
  const pairingListExports = viewsSource.split('\n')
    .filter(line => line.includes('exportFile(pairingListHTML'));

  assert.equal(pairingListExports.length, 2, 'rounds and reports should both export pairing lists');
  for (const exportControl of pairingListExports) {
    assert.match(exportControl, /'HTML',\s*'html',\s*\{ openAfterExport:\s*true \}/,
      'each pairing list export should request auto-open');
  }
});

test('main export handler opens exported files when requested', () => {
  assert.match(mainSource, /openAfterExport/);
  assert.match(mainSource, /pathToFileURL/);
  assert.match(mainSource, /shell\.openExternal/);
});
