import type { Env } from './types';
import { audit, authenticate, createBrowserSession, isoNow } from './db';
import { base64UrlJson, hashToken, randomToken, userCode } from './security';

const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers }
});

export async function startGoogle(request: Request, env: Env) {
  const url = new URL(request.url);
  const verifier = randomToken(48);
  const state = randomToken();
  const nonce = randomToken();
  const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const returnTo = url.searchParams.get('returnTo')?.startsWith('/') ? url.searchParams.get('returnTo')! : '/';
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, verifier, nonce, return_to, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await hashToken(state), verifier, nonce, returnTo, new Date(Date.now() + 10 * 60_000).toISOString()).run();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.PUBLISH_BASE}/auth/google/callback`,
    response_type: 'code', scope: 'openid email profile', state, nonce,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

export async function finishGoogle(request: Request, env: Env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const stored = await env.DB.prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND expires_at > ?')
    .bind(await hashToken(state), isoNow()).first<any>();
  if (!stored || !code) return new Response('Invalid or expired sign-in request.', { status: 400 });
  await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ?').bind(await hashToken(state)).run();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.PUBLISH_BASE}/auth/google/callback`, grant_type: 'authorization_code', code_verifier: stored.verifier })
  });
  if (!tokenResponse.ok) return new Response('Google sign-in could not be verified.', { status: 401 });
  const tokens = await tokenResponse.json<any>();
  const identityResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token ?? '')}`);
  if (!identityResponse.ok) return new Response('Google identity could not be verified.', { status: 401 });
  const identity = await identityResponse.json<any>();
  const payload = base64UrlJson(String(tokens.id_token).split('.')[1] ?? '');
  if (identity.aud !== env.GOOGLE_CLIENT_ID || !identity.email_verified || payload.nonce !== stored.nonce || !identity.sub) {
    return new Response('Google identity did not match this sign-in request.', { status: 401 });
  }
  let user = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ? OR email = ?').bind(identity.sub, identity.email).first<any>();
  if (user) {
    await env.DB.prepare('UPDATE users SET google_sub = ?, email = ?, display_name = ? WHERE id = ?')
      .bind(identity.sub, identity.email, identity.name ?? '', user.id).run();
  } else {
    user = { id: crypto.randomUUID() };
    await env.DB.prepare('INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, identity.sub, identity.email, identity.name ?? '', isoNow()).run();
  }
  const session = await createBrowserSession(env, user.id);
  await audit(env, 'auth.google.completed', user.id);
  return new Response(null, { status: 302, headers: {
    Location: `${env.PUBLISH_BASE}${stored.return_to}`,
    'Set-Cookie': `__Host-tlab_session=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(session.expires).toUTCString()}`
  }});
}

export async function createDeviceAuthorization(request: Request, env: Env) {
  const body = await request.json<any>().catch(() => ({}));
  const deviceCode = randomToken();
  const code = userCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.prepare(`INSERT INTO device_authorizations (device_hash, user_code, device_name, status, expires_at)
    VALUES (?, ?, ?, 'pending', ?)`).bind(await hashToken(deviceCode), code, String(body.deviceName ?? '').slice(0, 100), expiresAt).run();
  return json({ deviceCode, userCode: code, verificationUrl: `${env.PUBLISH_BASE}/device?user_code=${code}`, expiresIn: 600, interval: 3 }, 201);
}

export async function approveDevice(request: Request, env: Env) {
  const user = await authenticate(request, env);
  if (!user) return json({ error: 'Sign in before approving this device.' }, 401);
  const body = await request.json<any>().catch(() => ({}));
  const result = await env.DB.prepare(`UPDATE device_authorizations SET user_id = ?, status = 'approved'
    WHERE user_code = ? AND status = 'pending' AND expires_at > ?`).bind(user.id, String(body.userCode ?? '').toUpperCase(), isoNow()).run();
  if (!result.meta.changes) return json({ error: 'Code not found or expired.' }, 404);
  await audit(env, 'device.approved', user.id, undefined, { userCode: String(body.userCode ?? '').slice(-4) });
  return json({ approved: true });
}

export async function pollDevice(request: Request, env: Env) {
  const body = await request.json<any>().catch(() => ({}));
  const deviceHash = await hashToken(String(body.deviceCode ?? ''));
  const row = await env.DB.prepare('SELECT * FROM device_authorizations WHERE device_hash = ?').bind(deviceHash).first<any>();
  if (!row || row.expires_at <= isoNow()) return json({ error: 'expired_token' }, 410);
  if (row.consumed_at) return json({ error: 'already_used' }, 410);
  if (row.status !== 'approved' || !row.user_id) return json({ status: 'authorization_pending' }, 428);
  const claimed = await env.DB.prepare(`UPDATE device_authorizations SET consumed_at = ?
    WHERE device_hash = ? AND consumed_at IS NULL AND status = 'approved' AND expires_at > ?
    RETURNING user_id, device_name`).bind(isoNow(), deviceHash, isoNow()).first<any>();
  if (!claimed?.user_id) return json({ error: 'already_used' }, 410);
  const token = `tl_device_${randomToken()}`;
  await env.DB.prepare('INSERT INTO device_tokens (token_hash, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), claimed.user_id, claimed.device_name, isoNow()).run();
  const user = await env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(claimed.user_id).first<any>();
  return json({ token, account: { email: user.email, displayName: user.display_name } });
}
