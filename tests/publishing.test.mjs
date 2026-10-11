import test from 'node:test';
import assert from 'node:assert/strict';

import { eventReportHTML, publicationFingerprint, tournamentReportHTML } from '../renderer/js/export.js';
import { defaultEvent, defaultSection } from '../renderer/js/setup/defaults.js';
import {
  migrateWorkspace,
  parseTournamentDocument,
  serializeEventDocument,
  WORKSPACE_SCHEMA_VERSION
} from '../renderer/js/setup/schema.js';

function fixture() {
  const event = defaultEvent({
    id: 'event-1',
    name: 'Schools Championship',
    publish: {
      provider: 'tourneylab',
      reportId: 'TL-7K4Q9',
      publicUrl: 'https://results.tourneylab.app/TL-7K4Q9',
      visibility: 'listed',
      lastRevision: 3,
      lastPublishedAt: '2026-07-11T10:00:00.000Z',
      lastPublishedFingerprint: 'old-fingerprint',
      deviceCredential: 'must-not-serialize',
      stripeCustomerId: 'cus_secret',
      entitlement: { plan: 'pro' }
    },
    sectionIds: ['section-1']
  });
  const section = defaultSection({
    id: 'section-1',
    eventId: event.id,
    sectionName: 'Open',
    name: 'Schools Championship',
    players: [{ id: 'p1', no: 1, name: 'Alice', rating: 1800 }]
  });
  return { event, section };
}

test('workspace schema v7 retains normalized public publishing metadata and strips secrets', () => {
  const { event, section } = fixture();
  const migrated = migrateWorkspace({ schemaVersion: 5, events: [event], tournaments: [section] });

  assert.equal(WORKSPACE_SCHEMA_VERSION, 7);
  assert.deepEqual(migrated.events[0].publish, {
    creator: '',
    lastUpdate: '',
    homepageUrl: '',
    registrationUrl: '',
    calendarUrl: '',
    qrUrl: '',
    provider: 'tourneylab',
    reportId: 'TL-7K4Q9',
    publicUrl: 'https://results.tourneylab.app/TL-7K4Q9',
    visibility: 'listed',
    lastRevision: 3,
    lastPublishedAt: '2026-07-11T10:00:00.000Z',
    lastPublishedFingerprint: 'old-fingerprint'
  });
  assert.doesNotMatch(JSON.stringify(migrated), /must-not-serialize|cus_secret|entitlement/);
});

test('.tlab round trips retain public publishing identity without credentials or billing state', () => {
  const { event, section } = fixture();
  const serialized = serializeEventDocument(event, [section], section.id);
  const text = JSON.stringify(serialized);
  const parsed = parseTournamentDocument(text);

  assert.equal(parsed.event.publish.reportId, 'TL-7K4Q9');
  assert.equal(parsed.event.publish.visibility, 'listed');
  assert.doesNotMatch(text, /deviceCredential|stripeCustomerId|entitlement|must-not-serialize|cus_secret/);
});

test('published HTML identifies itself as a self-contained TourneyLab result', () => {
  const { event, section } = fixture();
  const html = eventReportHTML(event, [section], { generatedAt: '2026-07-11T10:00:00.000Z' });

  assert.match(html, /<meta name="generator" content="TourneyLab">/);
  assert.match(html, /<meta name="tourneylab-report" content="event">/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(tournamentReportHTML(section, { event }), /<meta name="tourneylab-report" content="section">/);
});

test('publication fingerprints ignore volatile publish state but change with report data', () => {
  const { event, section } = fixture();
  const first = publicationFingerprint(event, [section]);

  event.publish.lastPublishedAt = '2026-07-12T01:00:00.000Z';
  event.publish.lastRevision = 99;
  event.publish.lastPublishedFingerprint = first;
  assert.equal(publicationFingerprint(event, [section]), first);

  event.updatedAt = '2026-07-12T02:00:00.000Z';
  section.assignmentLog = [{ action: 'assigned', createdAt: '2026-07-12T02:01:00.000Z' }];
  const timestampOnly = publicationFingerprint(event, [section]);
  section.assignmentLog[0].createdAt = '2026-07-12T02:02:00.000Z';
  assert.equal(publicationFingerprint(event, [section]), timestampOnly);

  section.players[0].rating = 1900;
  assert.notEqual(publicationFingerprint(event, [section]), first);
});
