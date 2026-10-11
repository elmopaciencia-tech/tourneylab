import type { AuthenticatedUser, Env, ReportRow } from './types';
import { audit, isoNow } from './db';
import { verifyStripeSignature } from './security';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

async function stripeRequest(env: Env, path: string, params: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
  });
  const body = await response.json<any>();
  if (!response.ok) throw new Error(body.error?.message ?? 'Stripe request failed.');
  return body;
}

async function stripeCustomer(env: Env, user: AuthenticatedUser) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripeRequest(env, '/customers', new URLSearchParams({ email: user.email, name: user.displayName, 'metadata[user_id]': user.id }));
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(customer.id, user.id).run();
  return customer.id as string;
}

export async function checkout(request: Request, env: Env, user: AuthenticatedUser, report: ReportRow | null, kind: 'event_pass' | 'pro') {
  if (env.SELF_SERVICE_ENABLED !== 'true') return json({ error: 'Self-service checkout is not enabled yet.' }, 503);
  if (kind === 'event_pass' && !report) return json({ error: 'Tournament report not found.' }, 404);
  const orderId = crypto.randomUUID();
  const priceId = kind === 'event_pass' ? env.STRIPE_EVENT_PASS_PRICE_ID : env.STRIPE_PRO_PRICE_ID;
  const amount = Number(kind === 'event_pass' ? env.STRIPE_EVENT_PASS_AMOUNT : env.STRIPE_PRO_AMOUNT);
  await env.DB.prepare(`INSERT INTO orders (id, user_id, report_id, kind, amount, currency, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'usd', 'pending', ?)`).bind(orderId, user.id, report?.id ?? null, kind, amount, isoNow()).run();
  try {
    const customer = await stripeCustomer(env, user);
    const params = new URLSearchParams({
      customer, mode: kind === 'pro' ? 'subscription' : 'payment',
      'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
      success_url: `${env.PUBLISH_BASE}/billing/return?order=${orderId}`,
      cancel_url: `${env.PUBLISH_BASE}/billing/cancelled`,
      'automatic_tax[enabled]': 'true', 'customer_update[address]': 'auto', 'customer_update[name]': 'auto',
      'metadata[order_id]': orderId, 'metadata[user_id]': user.id, 'metadata[kind]': kind
    });
    if (report) params.set('metadata[report_id]', report.id);
    const session = await stripeRequest(env, '/checkout/sessions', params);
    await env.DB.prepare('UPDATE orders SET stripe_checkout_session_id = ? WHERE id = ?').bind(session.id, orderId).run();
    await audit(env, 'billing.checkout.created', user.id, report?.id, { kind, orderId });
    return json({ url: session.url, orderId });
  } catch (error) {
    await env.DB.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").bind(orderId).run();
    return json({ error: error instanceof Error ? error.message : 'Checkout failed.' }, 502);
  }
}

export async function billingPortal(env: Env, user: AuthenticatedUser) {
  if (!user.stripeCustomerId) return json({ error: 'No billing account exists yet.' }, 404);
  const session = await stripeRequest(env, '/billing_portal/sessions', new URLSearchParams({
    customer: user.stripeCustomerId, return_url: `${env.PUBLISH_BASE}/account`
  }));
  return json({ url: session.url });
}

function subscriptionId(object: any) {
  return typeof object.subscription === 'string' ? object.subscription
    : object.parent?.subscription_details?.subscription ?? object.subscription_details?.subscription ?? '';
}

function invoicePriceIds(object: any) {
  return (object.lines?.data ?? []).map((line: any) => line.pricing?.price_details?.price ?? line.price?.id ?? '').filter(Boolean);
}

function invoicePeriodEnd(object: any) {
  const periods = (object.lines?.data ?? []).map((line: any) => Number(line.period?.end)).filter(Number.isFinite);
  return periods.length ? new Date(Math.max(...periods) * 1000).toISOString() : null;
}

export async function stripeWebhook(request: Request, env: Env) {
  const payload = await request.text();
  const signature = request.headers.get('Stripe-Signature') ?? '';
  if (!await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET)) return json({ error: 'Invalid signature.' }, 400);
  let event: any;
  try { event = JSON.parse(payload); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const reserved = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (id, type, status, processed_at)
    VALUES (?, ?, 'processing', ?)`).bind(event.id, event.type, isoNow()).run();
  if (!reserved.meta.changes) {
    const existing = await env.DB.prepare('SELECT status FROM webhook_events WHERE id = ?').bind(event.id).first<{ status: string }>();
    return existing?.status === 'processed'
      ? json({ received: true, duplicate: true })
      : json({ error: 'Webhook is already being processed; retry shortly.' }, 409);
  }
  const object = event.data?.object ?? {};
  try {
    if (event.type === 'checkout.session.completed') {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND stripe_checkout_session_id = ?')
        .bind(object.metadata?.order_id ?? '', object.id ?? '').first<any>();
      if (!order) throw new Error('Checkout session does not match a pending order.');
      const baseAmount = Number(object.amount_subtotal ?? object.amount_total);
      if (object.payment_status !== 'paid' || object.currency !== order.currency || baseAmount !== order.amount) {
        throw new Error('Checkout amount or status mismatch.');
      }
      if (order?.kind === 'event_pass') {
        const base = new Date(Math.max(Date.now(), Date.parse((await env.DB.prepare('SELECT publish_until FROM reports WHERE id = ?').bind(order.report_id).first<any>())?.publish_until ?? 0)));
        base.setUTCDate(base.getUTCDate() + 90);
        await env.DB.batch([
          env.DB.prepare("UPDATE orders SET status = 'paid', completed_at = ? WHERE id = ?").bind(isoNow(), order.id),
          env.DB.prepare('UPDATE reports SET publish_until = ?, updated_at = ? WHERE id = ?').bind(base.toISOString(), isoNow(), order.report_id)
        ]);
      } else if (order?.kind === 'pro' && object.subscription) {
        await env.DB.prepare(`INSERT INTO subscriptions (user_id, stripe_subscription_id, status, updated_at)
          VALUES (?, ?, 'active', ?) ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id = excluded.stripe_subscription_id, status = 'active', updated_at = excluded.updated_at`)
          .bind(order.user_id, object.subscription, isoNow()).run();
        await env.DB.prepare("UPDATE orders SET status = 'paid', completed_at = ? WHERE id = ?").bind(isoNow(), order.id).run();
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(object.customer ?? '').first<any>();
      if (user) await env.DB.prepare(`INSERT INTO subscriptions (user_id, stripe_subscription_id, status, current_period_end, grace_until, cancel_at_period_end, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, current_period_end = excluded.current_period_end,
        grace_until = CASE WHEN excluded.status IN ('active','trialing') THEN NULL ELSE subscriptions.grace_until END,
        cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at`)
        .bind(user.id, object.id, event.type.endsWith('.deleted') ? 'canceled' : object.status,
          object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null,
          object.cancel_at_period_end ? 1 : 0, isoNow()).run();
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const id = subscriptionId(object);
      if (id) {
        const failed = event.type === 'invoice.payment_failed';
        const priceIds = invoicePriceIds(object);
        const baseAmount = Number(object.subtotal ?? object.amount_subtotal ?? (failed ? object.amount_due : object.amount_paid));
        if (object.currency !== 'usd' || baseAmount !== Number(env.STRIPE_PRO_AMOUNT) || !priceIds.includes(env.STRIPE_PRO_PRICE_ID)) {
          throw new Error('Invoice price or currency mismatch.');
        }
        const existing = await env.DB.prepare('SELECT user_id, current_period_end FROM subscriptions WHERE stripe_subscription_id = ?')
          .bind(id).first<any>();
        const customer = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(object.customer ?? '').first<any>();
        const userId = existing?.user_id ?? customer?.id;
        if (userId) {
          const periodEnd = invoicePeriodEnd(object) ?? existing?.current_period_end ?? null;
          await env.DB.prepare(`INSERT INTO subscriptions (user_id, stripe_subscription_id, status, current_period_end, grace_until, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id = excluded.stripe_subscription_id,
            status = excluded.status, current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
            grace_until = excluded.grace_until, updated_at = excluded.updated_at`)
            .bind(userId, id, failed ? 'past_due' : 'active', periodEnd,
              failed ? new Date(Date.now() + 14 * 86400_000).toISOString() : null, isoNow()).run();
        }
      }
    }
    await env.DB.prepare("UPDATE webhook_events SET status = 'processed', processed_at = ? WHERE id = ?").bind(isoNow(), event.id).run();
    await audit(env, `stripe.${event.type}`, undefined, object.metadata?.report_id, { eventId: event.id });
    return json({ received: true });
  } catch (error) {
    await audit(env, 'stripe.rejected', undefined, object.metadata?.report_id, { eventId: event.id, reason: error instanceof Error ? error.message : 'processing_failed' });
    await env.DB.prepare('DELETE FROM webhook_events WHERE id = ?').bind(event.id).run();
    return json({ error: 'Webhook could not be applied.' }, 400);
  }
}
