import { REPORT_CLIENT_SCRIPT } from '../../report-client.mjs';
import { parseReportArchive } from '../src/report-bundle';
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { finishGoogle } from '../src/auth';
import { billingPortal, checkout } from '../src/billing';
import { base64UrlJson, hashToken, randomToken, reportId, signStripePayload, verifyStripeSignature } from '../src/security';

const now = '2026-07-11T10:00:00.000Z';
// Ephemeral credential used only in the isolated test database.
const token = randomToken();

async function seedUser() {
  await env.DB.prepare('DELETE FROM audit_log; DELETE FROM webhook_events; DELETE FROM orders; DELETE FROM subscriptions; DELETE FROM report_revisions; DELETE FROM reports; DELETE FROM device_authorizations; DELETE FROM browser_sessions; DELETE FROM device_tokens; DELETE FROM oauth_states; DELETE FROM users;').run();
  await env.DB.prepare('INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind('user-1', 'google-1', 'arbiter@example.test', 'Chief Arbiter', now).run();
  await env.DB.prepare('INSERT INTO device_tokens (token_hash, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), 'user-1', 'MacBook', now).run();
}

async function signedWebhook(event: any) {
  const payload = JSON.stringify(event);
  return SELF.fetch('https://publish.tourneylab.app/v1/webhooks/stripe', {
    method: 'POST', body: payload,
    headers: { 'Stripe-Signature': await signStripePayload(payload, 'whsec_test_secret', Math.floor(Date.now() / 1000)) }
  });
}

async function createDraft(title = 'Open', visibility = 'listed') {
  return (await api('/v1/reports', { method: 'POST', body: JSON.stringify({ title, visibility }) })).json<any>();
}

async function grantPass(id: string) {
  await env.DB.prepare('UPDATE reports SET publish_until = ? WHERE id = ?').bind(new Date(Date.now() + 90 * 86400_000).toISOString(), id).run();
}

const reportHtml = (title = 'Open') => `<!doctype html><meta name="generator" content="TourneyLab"><meta name="tourneylab-report" content="event"><h1>${title}</h1>`;

async function reportBundleArchive(files: Array<{ path: string; contentType: string; content?: string; bytes?: Uint8Array }>, entry = 'index.html') {
  const encoder = new TextEncoder();
  const payloads = files.map(file => file.bytes ?? encoder.encode(file.content));
  const hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  let offset = 0;
  const records = [];
  for (let index = 0; index < files.length; index++) {
    const payload = payloads[index];
    records.push({ path: files[index].path, contentType: files[index].contentType, offset, length: payload.length, sha256: await hex(payload) });
    offset += payload.length;
  }
  const manifest = encoder.encode(JSON.stringify({ format: 'tourneylab-report-bundle', version: 1, entry, files: records }));
  const magic = encoder.encode('TLABRB1\n');
  const archive = new Uint8Array(magic.length + 4 + manifest.length + offset);
  archive.set(magic);
  new DataView(archive.buffer).setUint32(magic.length, manifest.length, false);
  archive.set(manifest, magic.length + 4);
  let cursor = magic.length + 4 + manifest.length;
  for (const payload of payloads) { archive.set(payload, cursor); cursor += payload.length; }
  return archive;
}

function bundlePage(title: string, body = '') {
  return `<!doctype html><meta name="generator" content="TourneyLab"><meta name="tourneylab-report" content="event"><meta name="tourneylab-page" content="player"><title>${title}</title>${body}`;
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return SELF.fetch(`https://publish.tourneylab.app${path}`, { ...init, headers });
}

beforeEach(seedUser);

describe('device authorization', () => {
  it('creates a short-lived code without exposing a stored credential', async () => {
    const response = await SELF.fetch('https://publish.tourneylab.app/v1/device/authorizations', {
      method: 'POST', body: JSON.stringify({ deviceName: 'Tournament laptop' }), headers: { 'Content-Type': 'application/json' }
    });
    const body = await response.json<any>();
    expect(response.status).toBe(201);
    expect(body.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.deviceCode).toBeTruthy();
    expect(body.verificationUrl).toContain('/device');
  });

  it('requires browser sign-in, approves once, and issues one revocable device token', async () => {
    const created = await (await SELF.fetch('https://publish.tourneylab.app/v1/device/authorizations', {
      method: 'POST', body: JSON.stringify({ deviceName: 'Pairing desk' }), headers: { 'Content-Type': 'application/json' }
    })).json<any>();
    const pending = await SELF.fetch('https://publish.tourneylab.app/v1/device/token', {
      method: 'POST', body: JSON.stringify({ deviceCode: created.deviceCode }), headers: { 'Content-Type': 'application/json' }
    });
    expect(pending.status).toBe(428);
    expect((await SELF.fetch(`https://publish.tourneylab.app/device?user_code=${created.userCode}`)).status).toBe(200);

    const browserToken = 'browser-session';
    await env.DB.prepare('INSERT INTO browser_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await hashToken(browserToken), 'user-1', new Date(Date.now() + 60_000).toISOString(), now).run();
    const approved = await SELF.fetch('https://publish.tourneylab.app/v1/device/approve', {
      method: 'POST', body: JSON.stringify({ userCode: created.userCode }),
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-tlab_session=${browserToken}` }
    });
    expect(approved.status).toBe(200);
    const exchanged = await SELF.fetch('https://publish.tourneylab.app/v1/device/token', {
      method: 'POST', body: JSON.stringify({ deviceCode: created.deviceCode }), headers: { 'Content-Type': 'application/json' }
    });
    const credential = await exchanged.json<any>();
    expect(credential.token).toMatch(/^tl_device_/);
    expect(credential.account.email).toBe('arbiter@example.test');
    expect((await SELF.fetch('https://publish.tourneylab.app/v1/device/token', {
      method: 'POST', body: JSON.stringify({ deviceCode: created.deviceCode }), headers: { 'Content-Type': 'application/json' }
    })).status).toBe(410);

    const devices = await api('/v1/devices');
    expect((await devices.json<any>()).devices).toHaveLength(2);
    const issuedHash = await hashToken(credential.token);
    expect((await api(`/v1/devices/${issuedHash}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('consumes an approved device code exactly once under concurrent polling', async () => {
    const created = await (await SELF.fetch('https://publish.tourneylab.app/v1/device/authorizations', {
      method: 'POST', body: JSON.stringify({ deviceName: 'Pairing desk' }), headers: { 'Content-Type': 'application/json' }
    })).json<any>();
    await env.DB.prepare("UPDATE device_authorizations SET user_id = 'user-1', status = 'approved' WHERE user_code = ?")
      .bind(created.userCode).run();
    const request = () => SELF.fetch('https://publish.tourneylab.app/v1/device/token', {
      method: 'POST', body: JSON.stringify({ deviceCode: created.deviceCode }), headers: { 'Content-Type': 'application/json' }
    });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 410]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM device_tokens WHERE name = 'Pairing desk'").first<any>()).count).toBe(1);
  });
});

describe('Google account sessions', () => {
  it('starts with PKCE and rejects missing or expired callback state', async () => {
    const start = await SELF.fetch('https://publish.tourneylab.app/auth/google/start?returnTo=/device', { redirect: 'manual' });
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location')!);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect((await SELF.fetch('https://publish.tourneylab.app/auth/google/callback?state=bad&code=bad')).status).toBe(400);
  });

  it('validates Google identity, deduplicates by verified email, and creates a secure session', async () => {
    const state = 'oauth-state'; const nonce = 'oauth-nonce';
    await env.DB.prepare('INSERT INTO oauth_states (state_hash, verifier, nonce, return_to, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hashToken(state), 'verifier', nonce, '/account', new Date(Date.now() + 60_000).toISOString()).run();
    const encoded = (value: object) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const idToken = `${encoded({ alg: 'none' })}.${encoded({ nonce })}.signature`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/tokeninfo')) return new Response(JSON.stringify({ aud: 'google-client-id.test', email_verified: true, sub: 'google-1', email: 'arbiter@example.test', name: 'Updated Arbiter' }), { status: 200 });
      return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await finishGoogle(new Request(`https://publish.tourneylab.app/auth/google/callback?state=${state}&code=code`), env);
    vi.unstubAllGlobals();
    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').bind('arbiter@example.test').first<any>()).count).toBe(1);
  });

  it('revokes the server-side browser session on logout', async () => {
    const browserToken = 'logout-session';
    const tokenHash = await hashToken(browserToken);
    await env.DB.prepare('INSERT INTO browser_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, 'user-1', new Date(Date.now() + 60_000).toISOString(), now).run();
    const response = await SELF.fetch('https://publish.tourneylab.app/auth/logout', {
      method: 'POST', headers: { Cookie: `__Host-tlab_session=${browserToken}` }
    });
    expect(response.status).toBe(204);
    expect(await env.DB.prepare('SELECT token_hash FROM browser_sessions WHERE token_hash = ?').bind(tokenHash).first()).toBeNull();
  });

  it('serves a signed-in account dashboard and browser device revocation control', async () => {
    const browserToken = 'account-session';
    await env.DB.prepare('INSERT INTO browser_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await hashToken(browserToken), 'user-1', new Date(Date.now() + 60_000).toISOString(), now).run();
    const dashboard = await SELF.fetch('https://publish.tourneylab.app/account', {
      headers: { Cookie: `__Host-tlab_session=${browserToken}` }
    });
    const html = await dashboard.text();
    expect(html).toContain('arbiter@example.test');
    expect(html).toContain('MacBook');
    const response = await SELF.fetch('https://publish.tourneylab.app/device/revoke', {
      method: 'POST', body: new URLSearchParams({ deviceId: await hashToken(token) }), redirect: 'manual',
      headers: { Cookie: `__Host-tlab_session=${browserToken}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    expect(response.status).toBe(303);
    expect((await env.DB.prepare('SELECT revoked_at FROM device_tokens WHERE token_hash = ?').bind(await hashToken(token)).first<any>()).revoked_at).toBeTruthy();
  });

  it('serves Stripe return pages without granting an entitlement', async () => {
    const draft = await createDraft();
    expect((await SELF.fetch('https://publish.tourneylab.app/billing/return?order=untrusted')).status).toBe(200);
    expect((await SELF.fetch('https://publish.tourneylab.app/billing/cancelled')).status).toBe(200);
    expect((await env.DB.prepare('SELECT publish_until FROM reports WHERE id = ?').bind(draft.reportId).first<any>()).publish_until).toBeNull();
  });
});

describe('managed reports', () => {
  it('creates a stable draft owned by the connected organizer', async () => {
    const response = await api('/v1/reports', { method: 'POST', body: JSON.stringify({ title: 'Schools Championship' }) });
    const body = await response.json<any>();
    expect(response.status).toBe(201);
    expect(body.reportId).toMatch(/^TL-[A-Z0-9]{5}$/);
    expect(body.publicUrl).toBe(`https://results.tourneylab.app/${body.reportId}`);
    expect(body.state).toBe('draft');
  });

  it('requires a pass or active Pro subscription before publishing', async () => {
    const draft = await (await api('/v1/reports', { method: 'POST', body: JSON.stringify({ title: 'Open' }) })).json<any>();
    const response = await api(`/v1/reports/${draft.reportId}/html`, {
      method: 'PUT', headers: { 'Content-Type': 'text/html; charset=utf-8', 'If-Match': '0' },
      body: '<!doctype html><meta name="generator" content="TourneyLab"><meta name="tourneylab-report" content="event"><h1>Open</h1>'
    });
    expect(response.status).toBe(402);
  });

  it('publishes versioned HTML, protects revisions, and serves permanent secure results', async () => {
    const draft = await createDraft();
    await grantPass(draft.reportId);
    const html = reportHtml();
    const publish = await api(`/v1/reports/${draft.reportId}/html`, {
      method: 'PUT', headers: { 'Content-Type': 'text/html; charset=utf-8', 'If-Match': '0' }, body: html
    });
    const status = await publish.json<any>();
    expect(publish.status).toBe(200);
    expect(status.revision).toBe(1);

    const conflict = await api(`/v1/reports/${draft.reportId}/html`, {
      method: 'PUT', headers: { 'Content-Type': 'text/html; charset=utf-8', 'If-Match': '0' }, body: html
    });
    expect(conflict.status).toBe(409);

    await env.DB.prepare("UPDATE reports SET state = 'frozen' WHERE id = ?").bind(draft.reportId).run();
    const publicPage = await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`);
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toBe(html);
    expect(publicPage.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(publicPage.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('publishes one indexed bundle revision and serves only the requested deep page', async () => {
    const draft = await createDraft('Schools Festival'); await grantPass(draft.reportId);
    const archive = await reportBundleArchive([
      { path: 'index.html', contentType: 'text/html; charset=utf-8', content: bundlePage('Festival', '<link rel="stylesheet" href="assets/report.css"><a href="players/r1.html">Alice</a>') },
      { path: 'assets/report.css', contentType: 'text/css; charset=utf-8', content: 'body{color:#37352f}' },
      { path: 'players/r1.html', contentType: 'text/html; charset=utf-8', content: bundlePage('Alice', '<link rel="stylesheet" href="../assets/report.css"><h1>Alice history</h1>') }
    ]);
    const published = await api(`/v1/reports/${draft.reportId}/bundle`, {
      method: 'PUT', headers: { 'Content-Type': 'application/vnd.tourneylab.report-bundle', 'If-Match': '0' }, body: archive
    });
    expect(published.status).toBe(200);
    expect((await published.json<any>()).revision).toBe(1);
    expect((await env.DB.prepare('SELECT format FROM report_revisions WHERE report_id = ?').bind(draft.reportId).first<any>()).format).toBe('bundle_v1');

    const root = await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`);
    const player = await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}/players/r1.html`);
    const css = await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}/assets/report.css`);
    expect(await root.text()).toContain('players/r1.html');
    expect(await player.text()).toContain('Alice history');
    expect(player.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(player.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await css.text()).toBe('body{color:#37352f}');
    const missing = await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}/players/missing.html`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('Return to the tournament overview');
  });

  it('rejects unsafe or inconsistent report bundles before storing a revision', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    const unsafe = await reportBundleArchive([
      { path: 'index.html', contentType: 'text/html; charset=utf-8', content: bundlePage('Unsafe', '<a href="missing.html" onclick="alert(1)">Bad</a>') }
    ]);
    const response = await api(`/v1/reports/${draft.reportId}/bundle`, {
      method: 'PUT', headers: { 'Content-Type': 'application/vnd.tourneylab.report-bundle', 'If-Match': '0' }, body: unsafe
    });
    expect(response.status).toBe(422);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM report_revisions WHERE report_id = ?').bind(draft.reportId).first<any>()).count).toBe(0);

    const traversal = await reportBundleArchive([
      { path: '../index.html', contentType: 'text/html; charset=utf-8', content: bundlePage('Bad path') }
    ], '../index.html');
    expect((await api(`/v1/reports/${draft.reportId}/bundle`, {
      method: 'PUT', headers: { 'Content-Type': 'application/vnd.tourneylab.report-bundle', 'If-Match': '0' }, body: traversal
    })).status).toBe(422);
  });

  it('rolls between legacy HTML and bundle revisions without changing the permanent root URL', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '0' }, body: reportHtml('Legacy') });
    const archive = await reportBundleArchive([
      { path: 'index.html', contentType: 'text/html; charset=utf-8', content: bundlePage('Bundle', '<h1>Bundle</h1>') }
    ]);
    await api(`/v1/reports/${draft.reportId}/bundle`, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.tourneylab.report-bundle', 'If-Match': '1' }, body: archive });
    expect(await (await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`)).text()).toContain('Bundle');
    await api(`/v1/reports/${draft.reportId}/rollback`, { method: 'POST', body: JSON.stringify({ revision: 1 }) });
    expect(await (await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`)).text()).toContain('Legacy');
    expect((await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}/players/r1.html`)).status).toBe(404);
  });

  it('allows only one concurrent revision promotion and serves the winning object', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    const publish = (title: string) => api(`/v1/reports/${draft.reportId}/html`, {
      method: 'PUT', headers: { 'Content-Type': 'text/html; charset=utf-8', 'If-Match': '0' }, body: reportHtml(title)
    });
    const responses = await Promise.all([publish('Concurrent one'), publish('Concurrent two')]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const page = await (await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`)).text();
    expect(['Concurrent one', 'Concurrent two'].some(title => page.includes(title))).toBe(true);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM report_revisions WHERE report_id = ?').bind(draft.reportId).first<any>()).count).toBe(1);
  });

  it('omits unlisted reports from directory search while preserving direct access', async () => {
    const draft = await (await api('/v1/reports', { method: 'POST', body: JSON.stringify({ title: 'Private Open', visibility: 'unlisted' }) })).json<any>();
    const search = await SELF.fetch('https://results.tourneylab.app/v1/public/reports?q=Private');
    expect((await search.json<any>()).reports).toEqual([]);
    expect((await api(`/v1/reports/${draft.reportId}`)).status).toBe(200);
  });

  it('rejects a copied report ID owned by another publishing account', async () => {
    const draft = await createDraft();
    await env.DB.prepare('INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('user-2', 'google-2', 'other@example.test', 'Other Organizer', now).run();
    const otherToken = 'tl_device_other';
    await env.DB.prepare('INSERT INTO device_tokens (token_hash, user_id, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(await hashToken(otherToken), 'user-2', 'Other laptop', now).run();
    const response = await SELF.fetch(`https://publish.tourneylab.app/v1/reports/${draft.reportId}`, {
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    expect(response.status).toBe(403);
    expect((await response.json<any>()).error).toMatch(/another publishing account/i);
  });

  it('validates uploads, updates metadata, rolls back, unpublishes, and deletes', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    expect((await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '0' }, body: '{}' })).status).toBe(415);
    expect((await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '0' }, body: '<h1>not generated</h1>' })).status).toBe(422);
    expect((await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '0' }, body: reportHtml().replace('content="event"', 'content="section"') })).status).toBe(422);
    expect((await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': 'bad' }, body: reportHtml() })).status).toBe(409);
    expect((await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '0' }, body: reportHtml('One') })).status).toBe(200);
    expect((await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '1' }, body: reportHtml('Two') })).status).toBe(200);

    const changed = await api(`/v1/reports/${draft.reportId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed', visibility: 'unlisted' }) });
    expect((await changed.json<any>()).visibility).toBe('unlisted');
    const rolled = await api(`/v1/reports/${draft.reportId}/rollback`, { method: 'POST', body: JSON.stringify({ revision: 1 }) });
    expect((await rolled.json<any>()).revision).toBe(1);
    expect(await (await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`)).text()).toContain('One');
    expect((await api(`/v1/reports/${draft.reportId}/unpublish`, { method: 'POST' })).status).toBe(200);
    expect((await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`)).status).toBe(404);
    expect((await api(`/v1/reports/${draft.reportId}/delete`, { method: 'POST' })).status).toBe(200);
    expect((await api(`/v1/reports/${draft.reportId}`)).status).toBe(404);
  });

  it('rejects malformed UTF-8 before storing a report', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    const prefix = new TextEncoder().encode(reportHtml());
    const malformed = new Uint8Array(prefix.length + 2);
    malformed.set(prefix); malformed.set([0xc3, 0x28], prefix.length);
    const response = await api(`/v1/reports/${draft.reportId}/html`, {
      method: 'PUT', headers: { 'Content-Type': 'text/html; charset=utf-8', 'If-Match': '0' }, body: malformed
    });
    expect(response.status).toBe(422);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM report_revisions WHERE report_id = ?').bind(draft.reportId).first<any>()).count).toBe(0);
  });

  it('derives a frozen status after access expires without removing public HTML', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '0' }, body: reportHtml() });
    await env.DB.prepare('UPDATE reports SET publish_until = ? WHERE id = ?').bind('2020-01-01T00:00:00.000Z', draft.reportId).run();
    const status = await (await api(`/v1/reports/${draft.reportId}`)).json<any>();
    expect(status.state).toBe('frozen');
    expect((await SELF.fetch(`https://results.tourneylab.app/${draft.reportId}`)).status).toBe(200);
  });

  it('rejects anonymous management and exposes a searchable directory page', async () => {
    expect((await SELF.fetch('https://publish.tourneylab.app/v1/reports', { method: 'POST' })).status).toBe(401);
    expect((await SELF.fetch('https://results.tourneylab.app/')).status).toBe(200);
    expect((await SELF.fetch('https://publish.tourneylab.app/unknown')).status).toBe(404);
  });
});

describe('billing entitlements', () => {
  it('keeps checkout behind the rollout flag and handles missing portal accounts', async () => {
    const draft = await createDraft();
    expect((await api(`/v1/reports/${draft.reportId}/checkout`, { method: 'POST' })).status).toBe(503);
    expect((await api('/v1/billing/pro-checkout', { method: 'POST' })).status).toBe(503);
    expect((await api('/v1/billing/portal', { method: 'POST' })).status).toBe(404);
  });

  it('creates fixed-price Stripe sessions without trusting client prices', async () => {
    const draft = await createDraft();
    const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(draft.reportId).first<any>();
    const customEnv = { ...env, SELF_SERVICE_ENABLED: 'true' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/customers') return new Response(JSON.stringify({ id: 'cus_1' }), { status: 200 });
      if (path === '/v1/billing_portal/sessions') return new Response(JSON.stringify({ id: 'bps_1', url: 'https://checkout.stripe.test/portal' }), { status: 200 });
      const body = new URLSearchParams(String(init?.body ?? ''));
      expect(body.get('line_items[0][price]')).toBe('price_event_pass_test');
      expect(body.get('automatic_tax[enabled]')).toBe('true');
      return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/session' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = { id: 'user-1', email: 'arbiter@example.test', displayName: 'Chief Arbiter' };
    const response = await checkout(new Request('https://publish.test/checkout', { method: 'POST' }), customEnv, user, report, 'event_pass');
    expect((await response.json<any>()).url).toContain('checkout.stripe.test');
    const portal = await billingPortal(customEnv, { ...user, stripeCustomerId: 'cus_1' });
    expect((await portal.json<any>()).url).toContain('checkout.stripe.test');
    vi.unstubAllGlobals();
  });

  it('activates a 90-day pass only for a verified paid matching checkout', async () => {
    const draft = await createDraft();
    await env.DB.prepare(`INSERT INTO orders (id, user_id, report_id, kind, stripe_checkout_session_id, amount, currency, status, created_at)
      VALUES ('order-1','user-1',?,'event_pass','cs_paid',600,'usd','pending',?)`).bind(draft.reportId, now).run();
    const response = await signedWebhook({ id: 'evt_pass', type: 'checkout.session.completed', data: { object: {
      id: 'cs_paid', payment_status: 'paid', currency: 'usd', amount_total: 600, metadata: { order_id: 'order-1', report_id: draft.reportId }
    } } });
    expect(response.status).toBe(200);
    expect(Date.parse((await env.DB.prepare('SELECT publish_until FROM reports WHERE id = ?').bind(draft.reportId).first<any>()).publish_until)).toBeGreaterThan(Date.now() + 89 * 86400_000);
  });

  it('rejects mismatched checkout amounts and tracks subscription grace and cancellation', async () => {
    const draft = await createDraft();
    await env.DB.prepare(`INSERT INTO orders (id, user_id, report_id, kind, stripe_checkout_session_id, amount, currency, status, created_at)
      VALUES ('order-bad','user-1',?,'event_pass','cs_bad',600,'usd','pending',?)`).bind(draft.reportId, now).run();
    expect((await signedWebhook({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {
      id: 'cs_bad', payment_status: 'paid', currency: 'usd', amount_total: 1, metadata: { order_id: 'order-bad' }
    } } })).status).toBe(400);

    await env.DB.prepare("UPDATE users SET stripe_customer_id = 'cus_1' WHERE id = 'user-1'").run();
    expect((await signedWebhook({ id: 'evt_sub', type: 'customer.subscription.updated', data: { object: {
      id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false
    } } })).status).toBe(200);
    const invoice = { customer: 'cus_1', currency: 'usd', subtotal: 5900, subscription: 'sub_1',
      lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 86400 }, pricing: { price_details: { price: 'price_pro_test' } } }] } };
    await signedWebhook({ id: 'evt_failed', type: 'invoice.payment_failed', data: { object: invoice } });
    expect((await env.DB.prepare("SELECT status, grace_until FROM subscriptions WHERE user_id = 'user-1'").first<any>()).status).toBe('past_due');
    await signedWebhook({ id: 'evt_paid', type: 'invoice.paid', data: { object: invoice } });
    expect((await env.DB.prepare("SELECT status, grace_until FROM subscriptions WHERE user_id = 'user-1'").first<any>()).grace_until).toBeNull();
    await signedWebhook({ id: 'evt_deleted', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } });
    expect((await env.DB.prepare("SELECT status FROM subscriptions WHERE user_id = 'user-1'").first<any>()).status).toBe('canceled');
  });

  it('applies an out-of-order paid Pro invoice without granting an unbounded subscription', async () => {
    await env.DB.prepare("UPDATE users SET stripe_customer_id = 'cus_out_of_order' WHERE id = 'user-1'").run();
    const periodEnd = Math.floor(Date.now() / 1000) + 365 * 86400;
    const response = await signedWebhook({ id: 'evt_invoice_first', type: 'invoice.paid', data: { object: {
      id: 'in_first', customer: 'cus_out_of_order', currency: 'usd', amount_paid: 5900,
      subscription: 'sub_out_of_order', lines: { data: [{ period: { end: periodEnd }, pricing: { price_details: { price: 'price_pro_test' } } }] }
    } } });
    expect(response.status).toBe(200);
    const subscription = await env.DB.prepare("SELECT status, current_period_end FROM subscriptions WHERE user_id = 'user-1'").first<any>();
    expect(subscription.status).toBe('active');
    expect(subscription.current_period_end).toBe(new Date(periodEnd * 1000).toISOString());
  });
});

describe('Stripe webhook trust boundary', () => {
  it('accepts a valid raw-body signature once and rejects tampering', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_missing' } } });
    const signature = await signStripePayload(payload, 'whsec_test_secret', Math.floor(Date.now() / 1000));
    const valid = await SELF.fetch('https://publish.tourneylab.app/v1/webhooks/stripe', {
      method: 'POST', body: payload, headers: { 'Stripe-Signature': signature }
    });
    expect(valid.status).toBe(200);
    const duplicate = await SELF.fetch('https://publish.tourneylab.app/v1/webhooks/stripe', {
      method: 'POST', body: payload, headers: { 'Stripe-Signature': signature }
    });
    expect(duplicate.status).toBe(200);
    const tampered = await SELF.fetch('https://publish.tourneylab.app/v1/webhooks/stripe', {
      method: 'POST', body: `${payload} `, headers: { 'Stripe-Signature': signature }
    });
    expect(tampered.status).toBe(400);
  });

  it('reserves duplicate webhook IDs before applying entitlement changes', async () => {
    const draft = await createDraft();
    await env.DB.prepare(`INSERT INTO orders (id, user_id, report_id, kind, stripe_checkout_session_id, amount, currency, status, created_at)
      VALUES ('order-concurrent','user-1',?,'event_pass','cs_concurrent',600,'usd','pending',?)`).bind(draft.reportId, now).run();
    const event = { id: 'evt_concurrent', type: 'checkout.session.completed', data: { object: {
      id: 'cs_concurrent', payment_status: 'paid', currency: 'usd', amount_total: 600, metadata: { order_id: 'order-concurrent' }
    } } };
    const [first, second] = await Promise.all([signedWebhook(event), signedWebhook(event)]);
    const statuses = [first.status, second.status];
    expect(statuses).toContain(200);
    expect(statuses.every(status => status === 200 || status === 409)).toBe(true);
    const until = Date.parse((await env.DB.prepare('SELECT publish_until FROM reports WHERE id = ?').bind(draft.reportId).first<any>()).publish_until);
    expect(until).toBeGreaterThan(Date.now() + 89 * 86400_000);
    expect(until).toBeLessThan(Date.now() + 91 * 86400_000);
    expect(until).toBeLessThan(Date.now() + 91 * 86400_000);
  });
});

describe('security helpers and maintenance', () => {
  it('uses URL-safe random identifiers and rejects stale Stripe signatures', async () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(reportId()).toMatch(/^TL-[A-Z0-9]{5}$/);
    expect(base64UrlJson(btoa(JSON.stringify({ ok: true })).replaceAll('=', ''))).toEqual({ ok: true });
    const signature = await signStripePayload('{}', ' secret ', 1);
    expect(await verifyStripeSignature('{}', signature, 'secret', Date.now())).toBe(false);
    expect(await verifyStripeSignature('{}', 'bad', 'secret')).toBe(false);
  });

  it('runs revision cleanup without deleting the current report revision', async () => {
    const draft = await createDraft(); await grantPass(draft.reportId);
    await api(`/v1/reports/${draft.reportId}/html`, { method: 'PUT', headers: { 'Content-Type': 'text/html', 'If-Match': '0' }, body: reportHtml() });
    await env.DB.prepare('UPDATE report_revisions SET created_at = ? WHERE report_id = ?').bind('2020-01-01T00:00:00.000Z', draft.reportId).run();
    await worker.scheduled({} as ScheduledController, env);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM report_revisions WHERE report_id = ?').bind(draft.reportId).first<any>()).count).toBe(1);
  });

  it('stores no plaintext device credential field in D1', async () => {
    const columns = await env.DB.prepare("PRAGMA table_info('device_authorizations')").all<any>();
    expect(columns.results.map(column => column.name)).not.toContain('approved_token');
  });
});


describe('enhanced report bundle validation', () => {
  it('accepts only the fixed search script and preserves binary bytes', async () => {
    const archive = await reportBundleArchive([
      {path:'index.html',contentType:'text/html; charset=utf-8',content:bundlePage('Team reports','<script src="assets/report-search.js" defer></script><a href="rules.pdf">Rules</a><a href="reports.xlsx">Excel</a><img src="qr.png" alt="QR">')},
      {path:'assets/report-search.js',contentType:'text/javascript; charset=utf-8',content:REPORT_CLIENT_SCRIPT},
      {path:'rules.pdf',contentType:'application/pdf',bytes:new Uint8Array([37,80,68,70,45,49,46,55,10,255])},
      {path:'reports.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:new Uint8Array([80,75,3,4,255])},
      {path:'qr.png',contentType:'image/png',bytes:new Uint8Array([137,80,78,71,13,10,26,10,255])}
    ]);
    const parsed = await parseReportArchive(archive.buffer);
    expect(parsed.manifest.files).toHaveLength(5);
    const pdf=parsed.manifest.files.find(f=>f.path==='rules.pdf')!;
    expect(new Uint8Array(parsed.bytes)[parsed.payloadOffset+pdf.offset+pdf.length-1]).toBe(255);
  });
  it('rejects modified scripts, inline code, foreign script paths and bad binary signatures', async () => {
    for(const script of [REPORT_CLIENT_SCRIPT+';alert(1)', 'alert(1)']) {
      const archive=await reportBundleArchive([{path:'index.html',contentType:'text/html; charset=utf-8',content:bundlePage('Bad')},{path:'assets/report-search.js',contentType:'text/javascript; charset=utf-8',content:script}]);
      await expect(parseReportArchive(archive.buffer)).rejects.toThrow('built-in report search');
    }
    for(const tag of ['<script>alert(1)</script>','<script src="https://example.test/a.js" defer></script>','<script src="assets/report-search.js" onload="alert(1)"></script>']) {
      const archive=await reportBundleArchive([{path:'index.html',contentType:'text/html; charset=utf-8',content:bundlePage('Bad',tag)}]);
      await expect(parseReportArchive(archive.buffer)).rejects.toThrow('unsafe HTML');
    }
    const invalid=await reportBundleArchive([{path:'index.html',contentType:'text/html; charset=utf-8',content:bundlePage('Bad')},{path:'bad.pdf',contentType:'application/pdf',content:'not a PDF'}]);
    await expect(parseReportArchive(invalid.buffer)).rejects.toThrow('signature');
  });
});
