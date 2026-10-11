import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Generated for the in-memory mock; never a service credential.
const testDeviceToken = randomUUID();

import { createPublisherClient } from '../publisher-client.cjs';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness({ encryption = true } = {}) {
  const files = new Map();
  const opened = [];
  const requests = [];
  const safeStorage = {
    isEncryptionAvailable: () => encryption,
    encryptString: value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptString: value => Buffer.from(String(value).replace(/^encrypted:/, ''), 'base64').toString()
  };
  const fileSystem = {
    existsSync: path => files.has(path),
    readFileSync: path => files.get(path),
    writeFileSync: (path, value) => files.set(path, value),
    mkdirSync: () => {}, chmodSync: () => {}, unlinkSync: path => files.delete(path)
  };
  let handler = async () => response({});
  const client = createPublisherClient({
    safeStorage, fileSystem, credentialFile: '/user/publisher-credential',
    openExternal: async url => opened.push(url),
    fetchImpl: async (url, init) => { requests.push({ url, init }); return handler(url, init); },
    baseUrl: 'https://publish.tourneylab.app'
  });
  return { client, files, opened, requests, setHandler: value => { handler = value; } };
}

test('device connection opens browser approval and stores only an encrypted credential', async () => {
  const { client, files, opened, setHandler } = harness();
  setHandler(async url => url.endsWith('/v1/device/authorizations')
    ? response({ deviceCode: 'device-code', userCode: 'ABCD-EFGH', verificationUrl: 'https://publish.tourneylab.app/device', interval: 3 })
    : response({ token: testDeviceToken, account: { email: 'arbiter@example.test' } }));

  const start = await client.connectStart('Tournament laptop');
  assert.equal(start.userCode, 'ABCD-EFGH');
  assert.deepEqual(opened, ['https://publish.tourneylab.app/device']);
  const connected = await client.connectPoll('device-code');
  assert.equal('token' in connected, false);
  assert.match(String(files.get('/user/publisher-credential')), /encrypted:/);
  assert.equal(String(files.get('/user/publisher-credential')).includes(testDeviceToken), false);
  assert.equal((await client.connection()).account.email, 'arbiter@example.test');
});

test('publisher requests keep authorization in the main process and protect report revisions', async () => {
  const { client, requests, setHandler } = harness();
  setHandler(async url => url.endsWith('/v1/device/token')
    ? response({ token: testDeviceToken, account: { email: 'arbiter@example.test' } })
    : response({ reportId: 'TL-ABCDE', revision: 2, state: 'published' }));
  await client.connectPoll('device-code');

  await client.publish('TL-ABCDE', '<!doctype html>', 1);
  const request = requests.at(-1);
  assert.equal(request.init.headers.Authorization, `Bearer ${testDeviceToken}`);
  assert.equal(request.init.headers['If-Match'], '1');
  assert.equal(request.init.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(request.init.body, '<!doctype html>');
});

test('publisher client encodes report bundles for the versioned bundle endpoint', async () => {
  const { client, requests, setHandler } = harness();
  setHandler(async url => url.endsWith('/v1/device/token')
    ? response({ token: testDeviceToken, account: {} })
    : response({ reportId: 'TL-ABCDE', revision: 1 }));
  await client.connectPoll('device-code');
  await client.publishBundle('TL-ABCDE', {
    format: 'tourneylab-report-bundle', version: 1, entry: 'index.html',
    files: [{ path: 'index.html', contentType: 'text/html; charset=utf-8', content: '<!doctype html><meta name="generator" content="TourneyLab">' }]
  }, 0);
  const request = requests.at(-1);
  assert.match(request.url, /\/v1\/reports\/TL-ABCDE\/bundle$/);
  assert.equal(request.init.headers['Content-Type'], 'application/vnd.tourneylab.report-bundle');
  assert.equal(request.init.headers['If-Match'], '0');
  assert.equal(Buffer.from(request.init.body).subarray(0, 8).toString('ascii'), 'TLABRB1\n');
});

test('publisher credentials stay in memory when OS encryption is unavailable', async () => {
  const { client, files, setHandler } = harness({ encryption: false });
  setHandler(async () => response({ token: 'memory-only', account: { email: 'arbiter@example.test' } }));
  const result = await client.connectPoll('device-code');

  assert.equal(result.persistent, false);
  assert.equal('token' in result, false);
  assert.equal(files.size, 0);
  assert.equal((await client.connection()).connected, true);
  await client.disconnect();
  assert.equal((await client.connection()).connected, false);
});

test('publisher client returns actionable API failures without exposing response bodies', async () => {
  const { client, setHandler } = harness({ encryption: false });
  setHandler(async url => url.endsWith('/v1/device/token')
    ? response({ token: 'memory-only', account: {} })
    : response({ error: 'Publishing access is required.', revision: 4 }, 402));
  await client.connectPoll('device-code');

  await assert.rejects(() => client.report('TL-ABCDE'), error => {
    assert.equal(error.message, 'Publishing access is required.');
    assert.equal(error.status, 402);
    assert.equal(error.data.revision, 4);
    return true;
  });
});

test('Electron bridge and parent export UI expose managed publishing without replacing free export', () => {
  const main = fs.readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
  const views = fs.readFileSync(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

  for (const operation of ['connectStart', 'connectPoll', 'connection', 'disconnect', 'createReport', 'report', 'publish', 'publishBundle', 'updateReport', 'action', 'checkout', 'proCheckout', 'billingPortal', 'openExternal', 'copyText']) {
    assert.match(preload, new RegExp(`${operation}:`), `missing preload publisher.${operation}`);
  }
  assert.match(main, /safeStorage/);
  assert.match(main, /createPublisherClient/);
  assert.match(main, /publisher:connectStart/);
  assert.match(main, /publisher:publish/);
  assert.match(views, /Publish with TourneyLab/);
  assert.match(views, /Export HTML/);
  assert.match(views, /Unpublished changes/);
  assert.match(views, /Event Pass/);
  assert.match(views, /Organizer Pro/);
  assert.match(views, /Publish as a new report/);
  assert.match(css, /managed-publishing/);
});
