import type { AuthenticatedUser, Env, ReportRow } from './types';
import { hashToken, randomToken } from './security';

export const isoNow = () => new Date().toISOString();

function cookie(request: Request, name: string) {
  return request.headers.get('Cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}

export async function authenticate(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const tokenHash = await hashToken(bearer);
    const row = await env.DB.prepare(`SELECT u.id, u.email, u.display_name, u.stripe_customer_id
      FROM device_tokens d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ? AND d.revoked_at IS NULL`).bind(tokenHash).first<any>();
    if (!row) return null;
    await env.DB.prepare('UPDATE device_tokens SET last_used_at = ? WHERE token_hash = ?').bind(isoNow(), tokenHash).run();
    return { id: row.id, email: row.email, displayName: row.display_name, stripeCustomerId: row.stripe_customer_id ?? undefined };
  }
  const session = cookie(request, '__Host-tlab_session');
  if (!session) return null;
  const row = await env.DB.prepare(`SELECT u.id, u.email, u.display_name, u.stripe_customer_id
    FROM browser_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await hashToken(session), isoNow()).first<any>();
  return row ? { id: row.id, email: row.email, displayName: row.display_name, stripeCustomerId: row.stripe_customer_id ?? undefined } : null;
}

export async function createBrowserSession(env: Env, userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO browser_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), userId, expires, isoNow()).run();
  return { token, expires };
}

export async function revokeBrowserSession(request: Request, env: Env) {
  const session = cookie(request, '__Host-tlab_session');
  if (session) await env.DB.prepare('DELETE FROM browser_sessions WHERE token_hash = ?').bind(await hashToken(session)).run();
}

export async function audit(env: Env, action: string, actorId?: string, reportId?: string, detail: Record<string, unknown> = {}) {
  await env.DB.prepare('INSERT INTO audit_log (actor_id, action, report_id, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(actorId ?? null, action, reportId ?? null, JSON.stringify(detail), isoNow()).run();
  console.log(JSON.stringify({ level: 'info', action, actorId, reportId, ...detail }));
}

export async function ownedReport(env: Env, reportId: string, userId: string) {
  return env.DB.prepare('SELECT * FROM reports WHERE id = ? AND owner_id = ?').bind(reportId, userId).first<ReportRow>();
}

export async function entitlement(env: Env, userId: string, report?: ReportRow | null) {
  const now = isoNow();
  const subscription = await env.DB.prepare(`SELECT status, current_period_end, grace_until FROM subscriptions WHERE user_id = ?`)
    .bind(userId).first<any>();
  const pro = !!subscription && (
    (['active', 'trialing'].includes(subscription.status) && subscription.current_period_end > now) ||
    (subscription.grace_until && subscription.grace_until > now)
  );
  const eventPass = !!report?.publish_until && report.publish_until > now;
  return {
    canPublish: pro || eventPass,
    kind: pro ? 'pro' : eventPass ? 'event_pass' : 'none',
    validUntil: pro ? subscription.current_period_end ?? subscription.grace_until : report?.publish_until ?? null,
    graceUntil: subscription?.grace_until ?? null
  };
}

export function reportStatus(env: Env, report: ReportRow, access: Awaited<ReturnType<typeof entitlement>>) {
  const state = report.state === 'published' && !access.canPublish ? 'frozen' : report.state;
  return {
    reportId: report.id,
    publicUrl: `${env.PUBLIC_RESULTS_BASE}/${report.id}`,
    revision: report.current_revision,
    state,
    visibility: report.visibility,
    entitlement: access,
    lastPublishedAt: report.last_published_at
  };
}
