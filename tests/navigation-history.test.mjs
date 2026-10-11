import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationHistory } from '../renderer/js/navigation.js';

const home = { view: 'home', eventId: null, sectionId: null };
const overview = { view: 'event-overview', eventId: 'E1', sectionId: 'S1' };
const sections = { view: 'event-sections', eventId: 'E1', sectionId: 'S1' };

test('navigation history travels backward and forward through distinct views', () => {
  const history = createNavigationHistory(home);
  history.push(overview);
  history.push(sections);

  assert.equal(history.canBack(), true);
  assert.deepEqual(history.back(), overview);
  assert.deepEqual(history.back(), home);
  assert.equal(history.canBack(), false);
  assert.deepEqual(history.forward(), overview);
  assert.deepEqual(history.forward(), sections);
  assert.equal(history.canForward(), false);
});

test('new navigation clears forward history and unavailable entries are skipped', () => {
  const history = createNavigationHistory(home);
  history.push(overview);
  history.push(sections);
  history.back();
  history.push({ view: 'registrations', eventId: 'E1', sectionId: 'S1' });
  assert.equal(history.canForward(), false);

  history.push({ view: 'event-overview', eventId: 'deleted', sectionId: 'deleted' });
  const available = entry => entry.eventId !== 'deleted';
  assert.deepEqual(history.back(available), { view: 'registrations', eventId: 'E1', sectionId: 'S1' });
});
