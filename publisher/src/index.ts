import type { AuthenticatedUser, Env, ReportRow } from './types';
import { approveDevice, createDeviceAuthorization, finishGoogle, pollDevice, startGoogle } from './auth';
import { audit, authenticate, entitlement, isoNow, ownedReport, reportStatus, revokeBrowserSession } from './db';
import { billingPortal, checkout, stripeWebhook } from './billing';
import { hashToken, randomToken, reportId as makeReportId } from './security';
import {
  archiveManifestLength,
  BundleManifest,
  parseBundleManifest,
  parseReportArchive,
  REPORT_BUNDLE_HEADER_BYTES,
  validBundlePath
} from './report-bundle';

const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers }
});

async function rejected(env: Env, status: number, error: string, actorId?: string, reportId?: string) {
  await audit(env, 'request.rejected', actorId, reportId, { status, reason: error });
  return json({ error }, status);
}

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
};

async function accountPage(request: Request, env: Env) {
  const user = await authenticate(request, env);
  let account = '<section class="panel"><a class="button primary" href="/auth/google/start?returnTo=/account">Sign in with Google</a></section>';
  if (user) {
    const reports = await env.DB.prepare("SELECT id, title, state, visibility FROM reports WHERE owner_id = ? AND state <> 'deleted' ORDER BY updated_at DESC LIMIT 100")
      .bind(user.id).all<any>();
    const devices = await env.DB.prepare('SELECT token_hash, name, created_at, last_used_at FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
      .bind(user.id).all<any>();
    const reportList = reports.results.length
      ? `<ul>${reports.results.map(row => `<li><a href="${env.PUBLIC_RESULTS_BASE}/${row.id}">${escapeHtml(row.title)}</a><span>${escapeHtml(row.state)} · ${escapeHtml(row.visibility)}</span></li>`).join('')}</ul>`
      : '<p class="sub">No hosted tournaments yet. Publish the first one from TourneyLab.</p>';
    const deviceList = devices.results.length
      ? `<ul>${devices.results.map(row => `<li><span><strong>${escapeHtml(row.name || 'TourneyLab device')}</strong><small>Connected ${escapeHtml(row.created_at)}</small></span><form method="post" action="/device/revoke"><input type="hidden" name="deviceId" value="${row.token_hash}"><button type="submit">Revoke</button></form></li>`).join('')}</ul>`
      : '<p class="sub">No connected devices.</p>';
    account = `<section class="panel"><p>Signed in as <strong>${escapeHtml(user.email)}</strong>.</p><form method="post" action="/auth/logout"><button type="submit">Sign out</button></form></section>
      <section class="panel"><h2>Published tournaments</h2>${reportList}</section>
      <section class="panel"><h2>Connected devices</h2>${deviceList}</section>
      <section class="panel"><h2>Billing</h2>${user.stripeCustomerId ? '<form method="post" action="/account/portal"><button type="submit">Open Customer Portal</button></form>' : '<p class="sub">Invoices and subscription controls appear here after the first purchase.</p>'}</section>`;
  }
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TourneyLab Publish</title><style>
  body{font:15px/1.5 system-ui;margin:0;color:#242421;background:#fff}main{max-width:760px;margin:64px auto;padding:24px}h1{font-size:36px;margin:0 0 8px}.sub,small,li span:last-child{color:#686864}.panel{border-top:1px solid #e5e5e2;padding:24px 0;margin-top:28px}button,a.button{display:inline-block;border:1px solid #d6d6d2;border-radius:7px;padding:9px 14px;background:#fff;color:inherit;text-decoration:none;font:inherit}.primary{background:#2383e2!important;color:#fff!important;border-color:#2383e2!important}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;align-items:center;gap:18px;border-bottom:1px solid #e5e5e2;padding:11px 0}small{display:block}</style></head><body><main>
  <h1>TourneyLab Results</h1><p class="sub">One-click publishing for tournament organizers. HTML export and self-hosting remain free.</p>
  <p><a class="button" href="${env.PUBLIC_RESULTS_BASE}">Browse results</a></p>${account}
  </main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' } });
}

async function revokeDeviceForm(request: Request, env: Env) {
  const user = await authenticate(request, env);
  if (!user) return Response.redirect(`${env.PUBLISH_BASE}/auth/google/start?returnTo=/account`, 303);
  const form = await request.formData();
  const id = String(form.get('deviceId') ?? '');
  const changed = await env.DB.prepare('UPDATE device_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(isoNow(), id, user.id).run();
  if (changed.meta.changes) await audit(env, 'device.revoked', user.id, undefined, { deviceId: id.slice(0, 8) });
  return Response.redirect(`${env.PUBLISH_BASE}/account`, 303);
}

async function accountPortal(request: Request, env: Env) {
  const user = await authenticate(request, env);
  if (!user) return Response.redirect(`${env.PUBLISH_BASE}/auth/google/start?returnTo=/account`, 303);
  const response = await billingPortal(env, user);
  const body = await response.json<any>();
  return response.ok && body.url
    ? Response.redirect(body.url, 303)
    : new Response('A billing account is not available yet.', { status: response.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function billingReturn(cancelled = false) {
  const title = cancelled ? 'Checkout cancelled' : 'Payment processing';
  const detail = cancelled
    ? 'No payment was completed. Return to TourneyLab whenever you are ready.'
    : 'Stripe is confirming your payment. Return to TourneyLab; publishing access appears only after the verified webhook arrives.';
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><main style="font:16px/1.5 system-ui;max-width:620px;margin:72px auto;padding:24px"><h1>${title}</h1><p>${detail}</p><a href="/account">Account</a></main>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' }
  });
}

async function devicePage(request: Request, env: Env) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('user_code') ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
  const user = await authenticate(request, env);
  const content = user
    ? `<p>Signed in as <strong>${escapeHtml(user.email)}</strong>.</p><form method="post" action="/device/approve"><label>Device code <input name="userCode" value="${escapeHtml(code)}" required pattern="[A-Z0-9]{4}-[A-Z0-9]{4}"></label><button class="primary" type="submit">Approve device</button></form>`
    : `<p>Sign in before approving <strong>${escapeHtml(code || 'the code shown in TourneyLab')}</strong>.</p><a class="button primary" href="/auth/google/start?returnTo=${encodeURIComponent(`/device?user_code=${code}`)}">Sign in with Google</a>`;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect TourneyLab</title><style>
    body{font:15px/1.5 system-ui;color:#242421}main{max-width:620px;margin:72px auto;padding:24px}h1{font-size:32px}label{display:grid;gap:7px;margin:24px 0}input{font:20px ui-monospace;padding:10px;border:1px solid #d6d6d2;border-radius:7px;max-width:240px}button,.button{display:inline-block;padding:10px 15px;border:0;border-radius:7px;text-decoration:none}.primary{background:#2383e2;color:#fff}</style></head><body><main><h1>Connect TourneyLab</h1>${content}</main></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' }
  });
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

async function approveDeviceForm(request: Request, env: Env) {
  const user = await authenticate(request, env);
  if (!user) return Response.redirect(`${env.PUBLISH_BASE}/auth/google/start?returnTo=/device`, 302);
  const form = await request.formData();
  const code = String(form.get('userCode') ?? '').toUpperCase();
  const result = await env.DB.prepare(`UPDATE device_authorizations SET user_id = ?, status = 'approved'
    WHERE user_code = ? AND status = 'pending' AND expires_at > ?`).bind(user.id, code, isoNow()).run();
  if (!result.meta.changes) return new Response('Device code not found or expired.', { status: 404 });
  await audit(env, 'device.approved', user.id, undefined, { userCode: code.slice(-4) });
  return new Response('<!doctype html><meta charset="utf-8"><title>Device connected</title><p style="font:16px system-ui;margin:72px auto;max-width:620px">Device approved. Return to TourneyLab to continue.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function directoryPage(request: Request, env: Env) {
  const url = new URL(request.url);
  const queryText = (url.searchParams.get('q') ?? '').slice(0, 100);
  const result = await env.DB.prepare(`SELECT id, title, last_published_at FROM reports
    WHERE visibility = 'listed' AND state IN ('published','frozen') AND deleted_at IS NULL AND title LIKE ?
    ORDER BY last_published_at DESC LIMIT 50`).bind(`%${queryText}%`).all<any>();
  const rows = result.results.length
    ? `<ul>${result.results.map(row => `<li><a href="/${row.id}">${escapeHtml(row.title)}</a><span>${escapeHtml(row.last_published_at ?? '')}</span></li>`).join('')}</ul>`
    : '<p class="empty">No published tournaments found.</p>';
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TourneyLab Results</title><style>
  body{font:15px/1.5 system-ui;color:#242421;margin:0}main{max-width:900px;margin:56px auto;padding:24px}h1{font-size:36px;margin-bottom:4px}.sub,.empty,li span{color:#777}form{margin:28px 0}input{width:min(480px,75%);padding:10px;border:1px solid #d6d6d2;border-radius:7px}button{padding:10px 14px;margin-left:6px}ul{padding:0;list-style:none;border-top:1px solid #e5e5e2}li{display:flex;justify-content:space-between;gap:20px;padding:13px 4px;border-bottom:1px solid #e5e5e2}a{color:#1459a8;text-decoration:none}</style></head><body><main><h1>TourneyLab Results</h1><p class="sub">Published chess tournament reports</p><form><input name="q" value="${escapeHtml(queryText)}" aria-label="Search tournaments" placeholder="Search tournaments"><button>Search</button></form>${rows}</main></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' }
  });
}

async function deviceManagement(request: Request, env: Env, id = '') {
  const auth = await requireUser(request, env); if (auth.response) return auth.response;
  if (request.method === 'GET') {
    const result = await env.DB.prepare('SELECT token_hash, name, created_at, last_used_at FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
      .bind(auth.user.id).all<any>();
    return json({ devices: result.results.map(row => ({ id: row.token_hash, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at })) });
  }
  const changed = await env.DB.prepare('UPDATE device_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(isoNow(), id, auth.user.id).run();
  if (!changed.meta.changes) return json({ error: 'Device not found.' }, 404);
  await audit(env, 'device.revoked', auth.user.id, undefined, { deviceId: id.slice(0, 8) });
  return json({ revoked: true });
}

type AuthResult = { user: AuthenticatedUser; response: null } | { response: Response; user: null };

async function requireUser(request: Request, env: Env): Promise<AuthResult> {
  const user = await authenticate(request, env);
  return user ? { user, response: null } : { response: json({ error: 'Authentication required.' }, 401), user: null };
}

async function uniqueReportId(env: Env) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = makeReportId();
    if (!await env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(id).first()) return id;
  }
  throw new Error('Could not allocate a report ID.');
}

async function reportAccessError(env: Env, id: string, userId: string) {
  const row = await env.DB.prepare('SELECT owner_id, state FROM reports WHERE id = ?').bind(id).first<{ owner_id: string; state: string }>();
  if (row && row.state !== 'deleted' && row.owner_id !== userId) {
    return rejected(env, 403, 'This report belongs to another publishing account.', userId, id);
  }
  return rejected(env, 404, 'Tournament report not found.', userId, id);
}

async function createReport(request: Request, env: Env) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE actor_id = ? AND action = 'report.created' AND created_at > ?")
    .bind(auth.user.id, since).first<{ count: number }>();
  if (Number(count?.count) >= 10) return rejected(env, 429, 'New report rate limit exceeded.', auth.user.id);
  const body = await request.json<any>().catch(() => ({}));
  const title = String(body.title ?? '').trim().slice(0, 200);
  if (!title) return rejected(env, 400, 'Tournament title is required.', auth.user.id);
  const visibility = body.visibility === 'unlisted' ? 'unlisted' : 'listed';
  const id = await uniqueReportId(env); const now = isoNow();
  await env.DB.prepare(`INSERT INTO reports (id, owner_id, title, visibility, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?)`).bind(id, auth.user.id, title, visibility, now, now).run();
  await audit(env, 'report.created', auth.user.id, id);
  const report = await ownedReport(env, id, auth.user.id);
  return json(reportStatus(env, report!, await entitlement(env, auth.user.id, report)), 201);
}

function validReportHtml(html: string) {
  return /<meta\s+name=["']generator["']\s+content=["']TourneyLab["']/i.test(html)
    && /<meta\s+name=["']tourneylab-report["']\s+content=["']event["']/i.test(html)
    && !/<(?:script|iframe|frame|object|embed|form)\b/i.test(html);
}

async function publishReport(request: Request, env: Env, id: string) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response;
  const report = await ownedReport(env, id, auth.user.id);
  if (!report || report.state === 'deleted') return reportAccessError(env, id, auth.user.id);
  const access = await entitlement(env, auth.user.id, report);
  if (!access.canPublish) return rejected(env, 402, 'An Event Pass or active Organizer Pro subscription is required.', auth.user.id, id);
  const expected = Number(request.headers.get('If-Match'));
  if (!Number.isInteger(expected) || expected !== report.current_revision) {
    await audit(env, 'request.rejected', auth.user.id, id, { status: 409, reason: 'revision_conflict', revision: report.current_revision });
    return json({ error: 'The published report changed on another device.', revision: report.current_revision }, 409);
  }
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('text/html')) return rejected(env, 415, 'Only TourneyLab HTML reports can be published.', auth.user.id, id);
  const encoded = await request.arrayBuffer();
  const byteLength = encoded.byteLength;
  if (byteLength > 1_000_000) return rejected(env, 413, 'Report exceeds the 1 MB publishing limit.', auth.user.id, id);
  let html: string;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(encoded); }
  catch { return rejected(env, 422, 'Report must be valid UTF-8 HTML.', auth.user.id, id); }
  if (!validReportHtml(html)) return rejected(env, 422, 'HTML is not a safe TourneyLab event report.', auth.user.id, id);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const uploads = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE actor_id = ? AND action = 'report.published' AND created_at > ?")
    .bind(auth.user.id, since).first<{ count: number }>();
  if (Number(uploads?.count) >= 60) return rejected(env, 429, 'Publishing rate limit exceeded.', auth.user.id, id);
  const revision = report.current_revision + 1;
  const r2Key = `reports/${id}/revisions/${revision}-${randomToken(12)}.html`;
  const sha = await hashToken(html);
  const now = isoNow();
  await env.REPORTS.put(r2Key, html, { httpMetadata: { contentType: 'text/html; charset=utf-8', cacheControl: 'public, max-age=60' }, customMetadata: { reportId: id, revision: String(revision), sha256: sha } });
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO report_revisions (report_id, revision, r2_key, sha256, byte_length, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(id, revision, r2Key, sha, byteLength, now),
      env.DB.prepare(`UPDATE reports SET current_revision = ?, state = 'published', bytes_stored = bytes_stored + ?, last_published_at = ?, updated_at = ? WHERE id = ? AND current_revision = ?`)
        .bind(revision, byteLength, now, now, id, expected)
    ]);
  } catch {
    await env.REPORTS.delete(r2Key);
    const current = await ownedReport(env, id, auth.user.id);
    await audit(env, 'request.rejected', auth.user.id, id, { status: 409, reason: 'revision_conflict', revision: current?.current_revision ?? expected });
    return json({ error: 'The published report changed on another device.', revision: current?.current_revision ?? expected }, 409);
  }
  await audit(env, 'report.published', auth.user.id, id, { revision, byteLength, sha256: sha });
  const storage = await env.DB.prepare('SELECT SUM(bytes_stored) AS total FROM reports WHERE owner_id = ? AND state <> \'deleted\'')
    .bind(auth.user.id).first<{ total: number }>();
  if (Number(storage?.total) > 1_000_000_000 && Number(storage?.total) - byteLength <= 1_000_000_000) {
    await audit(env, 'account.storage.review_required', auth.user.id, id, { bytesStored: Number(storage?.total) });
  }
  const updated = await ownedReport(env, id, auth.user.id);
  return json(reportStatus(env, updated!, await entitlement(env, auth.user.id, updated)));
}

async function publishBundle(request: Request, env: Env, id: string) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response;
  const report = await ownedReport(env, id, auth.user.id);
  if (!report || report.state === 'deleted') return reportAccessError(env, id, auth.user.id);
  const access = await entitlement(env, auth.user.id, report);
  if (!access.canPublish) return rejected(env, 402, 'An Event Pass or active Organizer Pro subscription is required.', auth.user.id, id);
  const expected = Number(request.headers.get('If-Match'));
  if (!Number.isInteger(expected) || expected !== report.current_revision) {
    await audit(env, 'request.rejected', auth.user.id, id, { status: 409, reason: 'revision_conflict', revision: report.current_revision });
    return json({ error: 'The published report changed on another device.', revision: report.current_revision }, 409);
  }
  if ((request.headers.get('Content-Type') ?? '').toLowerCase() !== 'application/vnd.tourneylab.report-bundle') {
    return rejected(env, 415, 'Only TourneyLab report bundles can be published.', auth.user.id, id);
  }
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > 30 * 1024 * 1024) return rejected(env, 413, 'Report bundle exceeds the 30 MiB archive limit.', auth.user.id, id);
  let parsed: Awaited<ReturnType<typeof parseReportArchive>>;
  try { parsed = await parseReportArchive(await request.arrayBuffer()); }
  catch (error) { return rejected(env, 422, error instanceof Error ? error.message : 'Invalid TourneyLab report bundle.', auth.user.id, id); }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const uploads = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE actor_id = ? AND action = 'report.published' AND created_at > ?")
    .bind(auth.user.id, since).first<{ count: number }>();
  if (Number(uploads?.count) >= 60) return rejected(env, 429, 'Publishing rate limit exceeded.', auth.user.id, id);

  const revision = report.current_revision + 1;
  const r2Key = `reports/${id}/revisions/${revision}-${randomToken(12)}.tlrb`;
  const byteLength = parsed.bytes.byteLength;
  const now = isoNow();
  await env.REPORTS.put(r2Key, parsed.bytes, {
    httpMetadata: { contentType: 'application/vnd.tourneylab.report-bundle', cacheControl: 'public, max-age=60' },
    customMetadata: { reportId: id, revision: String(revision), sha256: parsed.sha256 }
  });
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO report_revisions (report_id, revision, r2_key, sha256, byte_length, created_at, format)
        VALUES (?, ?, ?, ?, ?, ?, 'bundle_v1')`).bind(id, revision, r2Key, parsed.sha256, byteLength, now),
      env.DB.prepare(`UPDATE reports SET current_revision = ?, state = 'published', bytes_stored = bytes_stored + ?, last_published_at = ?, updated_at = ? WHERE id = ? AND current_revision = ?`)
        .bind(revision, byteLength, now, now, id, expected)
    ]);
  } catch {
    await env.REPORTS.delete(r2Key);
    const current = await ownedReport(env, id, auth.user.id);
    await audit(env, 'request.rejected', auth.user.id, id, { status: 409, reason: 'revision_conflict', revision: current?.current_revision ?? expected });
    return json({ error: 'The published report changed on another device.', revision: current?.current_revision ?? expected }, 409);
  }
  await audit(env, 'report.published', auth.user.id, id, { revision, byteLength, sha256: parsed.sha256, format: 'bundle_v1', fileCount: parsed.manifest.files.length });
  const storage = await env.DB.prepare("SELECT SUM(bytes_stored) AS total FROM reports WHERE owner_id = ? AND state <> 'deleted'")
    .bind(auth.user.id).first<{ total: number }>();
  if (Number(storage?.total) > 1_000_000_000 && Number(storage?.total) - byteLength <= 1_000_000_000) {
    await audit(env, 'account.storage.review_required', auth.user.id, id, { bytesStored: Number(storage?.total) });
  }
  const updated = await ownedReport(env, id, auth.user.id);
  return json(reportStatus(env, updated!, await entitlement(env, auth.user.id, updated)));
}

async function readBundleManifest(env: Env, r2Key: string) {
  const headerObject = await env.REPORTS.get(r2Key, { range: { offset: 0, length: REPORT_BUNDLE_HEADER_BYTES } });
  if (!headerObject || !('body' in headerObject)) return null;
  const header = new Uint8Array(await headerObject.arrayBuffer());
  const manifestLength = archiveManifestLength(header);
  const manifestObject = await env.REPORTS.get(r2Key, { range: { offset: REPORT_BUNDLE_HEADER_BYTES, length: manifestLength } });
  if (!manifestObject || !('body' in manifestObject)) return null;
  const manifestBytes = new Uint8Array(await manifestObject.arrayBuffer());
  return { manifest: parseBundleManifest(header, manifestBytes), payloadOffset: REPORT_BUNDLE_HEADER_BYTES + manifestLength };
}

function reportNotFound(id: string, detail = 'The requested report page was not found.') {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Report page not found</title><main style="font:14px/1.5 system-ui;max-width:620px;margin:72px auto;padding:24px"><h1>Report page not found</h1><p>${detail}</p><a href="/${id}">Return to the tournament overview</a></main>`, {
    status: 404,
    headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function serveReport(env: Env, id: string, requestedPath = '') {
  const report = await env.DB.prepare("SELECT * FROM reports WHERE id = ? AND state IN ('published','frozen') AND deleted_at IS NULL").bind(id).first<ReportRow>();
  if (!report?.current_revision) return new Response('Tournament results not found.', { status: 404 });
  const revision = await env.DB.prepare('SELECT r2_key, format FROM report_revisions WHERE report_id = ? AND revision = ?').bind(id, report.current_revision).first<{ r2_key: string; format: string }>();
  if (!revision) return new Response('Tournament results temporarily unavailable.', { status: 503 });
  if (revision.format !== 'bundle_v1') {
    if (requestedPath && requestedPath !== 'index.html') return reportNotFound(id);
    const object = await env.REPORTS.get(revision.r2_key);
    if (!object) return new Response('Tournament results temporarily unavailable.', { status: 503 });
    return new Response(object.body, { headers: { ...securityHeaders, ETag: object.httpEtag, 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let archive: { manifest: BundleManifest; payloadOffset: number } | null;
  try { archive = await readBundleManifest(env, revision.r2_key); }
  catch { return new Response('Tournament results temporarily unavailable.', { status: 503 }); }
  if (!archive) return new Response('Tournament results temporarily unavailable.', { status: 503 });
  let filePath = requestedPath || archive.manifest.entry;
  try { filePath = decodeURIComponent(filePath); } catch { return reportNotFound(id); }
  if (filePath.endsWith('/')) filePath += 'index.html';
  if (!validBundlePath(filePath)) return reportNotFound(id);
  const file = archive.manifest.files.find(item => item.path === filePath);
  if (!file) return reportNotFound(id);
  const object = await env.REPORTS.get(revision.r2_key, { range: { offset: archive.payloadOffset + file.offset, length: file.length } });
  if (!object || !('body' in object)) return new Response('Tournament results temporarily unavailable.', { status: 503 });
  return new Response(object.body, {
    headers: { ...securityHeaders, 'Content-Security-Policy': securityHeaders['Content-Security-Policy'].replace("script-src 'none'", "script-src 'self'"), ETag: `"${file.sha256}"`, 'Content-Type': file.contentType }
  });
}

async function directory(request: Request, env: Env) {
  const url = new URL(request.url); const query = `%${(url.searchParams.get('q') ?? '').slice(0, 100)}%`;
  const results = await env.DB.prepare(`SELECT id, title, last_published_at FROM reports
    WHERE visibility = 'listed' AND state IN ('published','frozen') AND deleted_at IS NULL AND title LIKE ?
    ORDER BY last_published_at DESC LIMIT 50`).bind(query).all<any>();
  return json({ reports: results.results.map(row => ({ reportId: row.id, title: row.title, updatedAt: row.last_published_at, publicUrl: `${env.PUBLIC_RESULTS_BASE}/${row.id}` })) });
}

async function reportAction(request: Request, env: Env, id: string, action: string) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response;
  const report = await ownedReport(env, id, auth.user.id);
  if (!report || report.state === 'deleted') return reportAccessError(env, id, auth.user.id);
  if (action === 'checkout') return checkout(request, env, auth.user, report, 'event_pass');
  if (action === 'rollback') {
    const access = await entitlement(env, auth.user.id, report); if (!access.canPublish) return json({ error: 'Publishing access is required.' }, 402);
    const body = await request.json<any>().catch(() => ({})); const revision = Number(body.revision);
    if (!await env.DB.prepare('SELECT revision FROM report_revisions WHERE report_id = ? AND revision = ?').bind(id, revision).first()) return json({ error: 'Revision not found.' }, 404);
    await env.DB.prepare("UPDATE reports SET current_revision = ?, state = 'published', updated_at = ? WHERE id = ?").bind(revision, isoNow(), id).run();
    await audit(env, 'report.rolled_back', auth.user.id, id, { revision });
  } else if (action === 'unpublish') {
    await env.DB.prepare("UPDATE reports SET state = 'draft', updated_at = ? WHERE id = ?").bind(isoNow(), id).run();
    await audit(env, 'report.unpublished', auth.user.id, id);
  } else if (action === 'delete') {
    await env.DB.prepare("UPDATE reports SET state = 'deleted', deleted_at = ?, visibility = 'unlisted', updated_at = ? WHERE id = ?")
      .bind(isoNow(), isoNow(), id).run();
    const keys = await env.DB.prepare('SELECT r2_key FROM report_revisions WHERE report_id = ?').bind(id).all<{ r2_key: string }>();
    await Promise.all(keys.results.map(row => env.REPORTS.delete(row.r2_key)));
    await audit(env, 'report.deleted', auth.user.id, id);
  }
  const updated = await ownedReport(env, id, auth.user.id);
  return json(updated ? reportStatus(env, updated, await entitlement(env, auth.user.id, updated)) : { deleted: true });
}

async function updateReport(request: Request, env: Env, id: string) {
  const auth = await requireUser(request, env); if (auth.response) return auth.response;
  const report = await ownedReport(env, id, auth.user.id); if (!report) return reportAccessError(env, id, auth.user.id);
  const body = await request.json<any>().catch(() => ({}));
  const visibility = body.visibility === 'unlisted' ? 'unlisted' : body.visibility === 'listed' ? 'listed' : report.visibility;
  const title = String(body.title ?? report.title).trim().slice(0, 200) || report.title;
  await env.DB.prepare('UPDATE reports SET title = ?, visibility = ?, updated_at = ? WHERE id = ?').bind(title, visibility, isoNow(), id).run();
  await audit(env, 'report.updated', auth.user.id, id, { visibility });
  const updated = await ownedReport(env, id, auth.user.id);
  return json(reportStatus(env, updated!, await entitlement(env, auth.user.id, updated)));
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  if (path === '/' && method === 'GET') return url.hostname.startsWith('results.') ? directoryPage(request, env) : accountPage(request, env);
  if (path === '/account' && method === 'GET') return accountPage(request, env);
  if (path === '/account/portal' && method === 'POST') return accountPortal(request, env);
  if (path === '/billing/return' && method === 'GET') return billingReturn(false);
  if (path === '/billing/cancelled' && method === 'GET') return billingReturn(true);
  if (path === '/device' && method === 'GET') return devicePage(request, env);
  if (path === '/device/approve' && method === 'POST') return approveDeviceForm(request, env);
  if (path === '/device/revoke' && method === 'POST') return revokeDeviceForm(request, env);
  if (path === '/auth/google/start' && method === 'GET') return startGoogle(request, env);
  if (path === '/auth/google/callback' && method === 'GET') return finishGoogle(request, env);
  if (path === '/auth/logout' && method === 'POST') {
    await revokeBrowserSession(request, env);
    return new Response(null, { status: 204, headers: { 'Set-Cookie': '__Host-tlab_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
  }
  if (path === '/v1/device/authorizations' && method === 'POST') return createDeviceAuthorization(request, env);
  if (path === '/v1/device/approve' && method === 'POST') return approveDevice(request, env);
  if (path === '/v1/device/token' && method === 'POST') return pollDevice(request, env);
  if (path === '/v1/webhooks/stripe' && method === 'POST') return stripeWebhook(request, env);
  if (path === '/v1/public/reports' && method === 'GET') return directory(request, env);
  if (path === '/v1/account' && method === 'GET') {
    const auth = await requireUser(request, env); return auth.response ?? json({ account: auth.user });
  }
  if (path === '/v1/devices' && method === 'GET') return deviceManagement(request, env);
  const deviceMatch = path.match(/^\/v1\/devices\/([a-f0-9]{64})$/);
  if (deviceMatch && method === 'DELETE') return deviceManagement(request, env, deviceMatch[1]);
  if (path === '/v1/reports' && method === 'POST') return createReport(request, env);
  if (path === '/v1/billing/pro-checkout' && method === 'POST') {
    const auth = await requireUser(request, env); return auth.response ?? checkout(request, env, auth.user!, null, 'pro');
  }
  if (path === '/v1/billing/portal' && method === 'POST') {
    const auth = await requireUser(request, env); return auth.response ?? billingPortal(env, auth.user!);
  }
  const htmlMatch = path.match(/^\/v1\/reports\/(TL-[A-Z0-9]{5})\/html$/);
  if (htmlMatch && method === 'PUT') return publishReport(request, env, htmlMatch[1]);
  const bundleMatch = path.match(/^\/v1\/reports\/(TL-[A-Z0-9]{5})\/bundle$/);
  if (bundleMatch && method === 'PUT') return publishBundle(request, env, bundleMatch[1]);
  const actionMatch = path.match(/^\/v1\/reports\/(TL-[A-Z0-9]{5})\/(checkout|rollback|unpublish|delete)$/);
  if (actionMatch && method === 'POST') return reportAction(request, env, actionMatch[1], actionMatch[2]);
  const apiMatch = path.match(/^\/v1\/reports\/(TL-[A-Z0-9]{5})$/);
  if (apiMatch && method === 'PATCH') return updateReport(request, env, apiMatch[1]);
  if (apiMatch && method === 'GET') {
    const auth = await requireUser(request, env); if (auth.response) return auth.response;
    const report = await ownedReport(env, apiMatch[1], auth.user.id); if (!report || report.state === 'deleted') return reportAccessError(env, apiMatch[1], auth.user.id);
    return json(reportStatus(env, report, await entitlement(env, auth.user.id, report)));
  }
  const publicMatch = path.match(/^\/(TL-[A-Z0-9]{5})(?:\/(.*))?$/);
  if (publicMatch && method === 'GET') return serveReport(env, publicMatch[1], publicMatch[2] ?? '');
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      console.error(JSON.stringify({ level: 'error', message: error instanceof Error ? error.message : String(error), path: new URL(request.url).pathname }));
      return json({ error: 'Unexpected publishing service error.' }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    const old = await env.DB.prepare(`SELECT r.report_id, r.revision, r.r2_key, r.byte_length FROM report_revisions r JOIN reports p ON p.id = r.report_id
      WHERE r.created_at < ? AND r.revision <> p.current_revision AND r.revision NOT IN
      (SELECT revision FROM report_revisions recent WHERE recent.report_id = r.report_id ORDER BY revision DESC LIMIT 21) LIMIT 500`).bind(cutoff).all<any>();
    for (const row of old.results) {
      await env.REPORTS.delete(row.r2_key);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM report_revisions WHERE report_id = ? AND revision = ?').bind(row.report_id, row.revision),
        env.DB.prepare('UPDATE reports SET bytes_stored = MAX(0, bytes_stored - ?) WHERE id = ?').bind(row.byte_length, row.report_id)
      ]);
    }
  }
};
