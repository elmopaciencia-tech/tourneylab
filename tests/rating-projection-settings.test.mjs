import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { defaultEvent, defaultSection, normalizeRatingProjection } from '../renderer/js/setup/defaults.js';
import { parseTournamentDocument, serializeEventDocument } from '../renderer/js/setup/schema.js';

const viewsSource = fs.readFileSync(new URL('../renderer/js/views.js', import.meta.url), 'utf8');

test('sections default to automatic FIDE-style projected-rating sensitivity', () => {
  assert.deepEqual(defaultSection().ratingProjection, {
    kFactorMode: 'auto',
    customKFactor: 20
  });
});

test('custom projection K-factors are normalized to a safe positive range', () => {
  assert.deepEqual(normalizeRatingProjection({ kFactorMode: 'custom', customKFactor: 35 }), {
    kFactorMode: 'custom',
    customKFactor: 35
  });
  assert.equal(normalizeRatingProjection({ kFactorMode: 'custom', customKFactor: 0 }).customKFactor, 20);
  assert.equal(normalizeRatingProjection({ kFactorMode: 'custom', customKFactor: 250 }).customKFactor, 100);
});

test('section projection K settings survive portable tournament documents', () => {
  const event = defaultEvent({ id: 'event-rating-projection' });
  const section = defaultSection({
    id: 'section-rating-projection',
    eventId: event.id,
    ratingProjection: { kFactorMode: 'custom', customKFactor: 35 }
  });

  const reopened = parseTournamentDocument(serializeEventDocument(event, [section], section.id));

  assert.deepEqual(reopened.sections[0].ratingProjection, {
    kFactorMode: 'custom',
    customKFactor: 35
  });
});

test('section Scoring setup exposes automatic, fixed, and custom projection K controls', () => {
  assert.match(viewsSource, /Projected rating K-factor/);
  assert.match(viewsSource, /Automatic · FIDE rules/);
  assert.match(viewsSource, /K = 10 · slower movement/);
  assert.match(viewsSource, /K = 20 · standard movement/);
  assert.match(viewsSource, /K = 40 · faster movement/);
  assert.match(viewsSource, /kFactorMode === 'custom'[\s\S]*Custom K-factor/);
  assert.match(viewsSource, /Display-only; projected ratings never affect pairings/);
});
