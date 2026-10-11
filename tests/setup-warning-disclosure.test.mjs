import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { setupWarningAction } from '../renderer/js/setup/workflow.js';

const views = await readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('section overview setup warnings expand to show issues and direct actions', () => {
  const start = views.indexOf('workflow.status.errors.length');
  const end = views.indexOf('function cycleIcon', start);
  const warningView = views.slice(start, end);

  assert.match(warningView, /h\('details',\s*\{ class:\s*'callout warn setup-warnings' \}/);
  assert.match(warningView, /h\('summary'/);
  assert.match(warningView, /workflow\.status\.warnings\.map/);
  assert.match(warningView, /setupWarningAction/);
  assert.match(warningView, /go\(action\.view\)/);
  assert.match(warningView, /action\.secondaryView/);
  assert.match(warningView, /action\.guidance/);
  assert.doesNotMatch(warningView, /open:/, 'setup warnings should start collapsed');
});

test('section-specific setup differences appear in a neutral expandable disclosure', () => {
  const start = views.indexOf('workflow.status.errors.length');
  const end = views.indexOf('function cycleIcon', start);
  const overview = views.slice(start, end);

  assert.match(overview, /h\('details',\s*\{ class:\s*'callout setup-notices' \}/);
  assert.match(overview, /workflow\.status\.notices\.map/);
  assert.match(overview, /Section-specific settings/);
  assert.match(overview, /setupWarningAction/);
});

test('setup warning actions route organizers to the owning workspace', () => {
  assert.deepEqual(
    setupWarningAction('Federation is blank; player defaults and reports will be less complete.', {}),
    {
      view: 'event-setup',
      label: 'Tournament setup',
      guidance: 'Set the tournament federation used by sections, imports, and reports.'
    }
  );
  assert.equal(
    setupWarningAction('Fewer than two active participants have names.', {}).view,
    'players'
  );
  const lockedOverride = setupWarningAction('Section overrides tournament defaults: time control.', {
      currentRound: 1,
      roundsData: [{ round: 1 }]
    });
  assert.match(lockedOverride.guidance, /locked/i);
  assert.equal(lockedOverride.secondaryView, 'event-setup');
  assert.equal(
    setupWarningAction('No tie-breaks are configured.', {}).view,
    'setup'
  );
});

test('setup warning disclosure styles its summary, issue rows, and actions', () => {
  assert.match(css, /\.setup-warnings\s+summary/);
  assert.match(css, /\.setup-notices\s+summary/);
  assert.match(css, /\.setup-warning-item/);
  assert.match(css, /\.setup-warning-guidance/);
  assert.match(css, /\.setup-warning-action/);
});
