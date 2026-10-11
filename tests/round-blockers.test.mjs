import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const views = await readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('round pairing blockers are summarized in one tooltip on the disabled Pair Round control', () => {
  const start = views.indexOf('// pairing controls');
  const end = views.indexOf('if (ready.warnings.length && !rr)', start);
  const pairingControls = views.slice(start, end);

  assert.match(pairingControls, /class:\s*`pair-round-control\$\{pairingBlocked \? ' blocked' : ''\}`/);
  assert.match(pairingControls, /class:\s*'pair-round-tooltip'/);
  assert.match(pairingControls, /role:\s*'tooltip'/);
  assert.match(pairingControls, /ready\.summary/);
  assert.match(pairingControls, /tabindex:\s*pairingBlocked \? '0' : undefined/);
  assert.doesNotMatch(pairingControls, /ready\.blockers\.map/);
  assert.doesNotMatch(pairingControls, /round-blockers/);
});

test('Pair Round blocker tooltip appears on hover and keyboard focus', () => {
  assert.match(css, /\.pair-round-control\.blocked:hover\s+\.pair-round-tooltip/);
  assert.match(css, /\.pair-round-control\.blocked:focus\s+\.pair-round-tooltip/);
  assert.doesNotMatch(css, /\.round-blockers/);
});
