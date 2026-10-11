# TourneyLab managed results publishing

This Cloudflare Worker owns Google account sessions, Electron device credentials,
Stripe entitlements, report metadata in D1, and versioned HTML in R2. The desktop
app still exports the same self-contained HTML for free and never stores provider
credentials in a tournament workspace or `.tlab` file.

## Local development

```bash
cd publisher
cp .dev.vars.example .dev.vars
npm install
npm test
npm run typecheck
npm run dev
```

Tests run inside Cloudflare's Workers runtime with isolated local D1 and R2
bindings. The suite enforces at least 80% statement, function, and line coverage.

## Cloudflare resources

Create separate staging and production resources, then replace the placeholder
IDs and Stripe/Google Price values in `wrangler.jsonc`:

```bash
npx wrangler d1 create tourneylab-publisher-staging
npx wrangler d1 create tourneylab-publisher-production
npx wrangler r2 bucket create tourneylab-results-staging
npx wrangler r2 bucket create tourneylab-results-production
```

Apply migrations before deploying code:

```bash
npm run migrate:staging
npm run migrate:production
```

Bind both staging hostnames to the staging Worker and both production hostnames
to the production Worker:

- `staging-publish.tourneylab.app`
- `staging-results.tourneylab.app`
- `publish.tourneylab.app`
- `results.tourneylab.app`

Enable Workers Paid and configure billing alerts before production traffic.

## Required secrets

Set these independently for `staging` and `production`; never place live values
in `wrangler.jsonc`, `.dev.vars.example`, Electron, or source control:

```bash
npx wrangler secret put STRIPE_SECRET_KEY --env staging
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

Repeat with `--env production`. The GitHub deployment token should be scoped
only to Workers, D1, R2, and the TourneyLab DNS zone.

## Google OAuth

Create separate web OAuth clients for staging and production. Configure these
exact redirect URIs:

- `https://staging-publish.tourneylab.app/auth/google/callback`
- `https://publish.tourneylab.app/auth/google/callback`

Set the matching client IDs in `wrangler.jsonc` and client secrets as Worker
secrets. The Worker requests only `openid email profile`, validates PKCE, state,
nonce, audience, and verified email, then discards Google tokens.

## Stripe

Create these Products/Prices in both test and live mode:

- Event Pass: one-time USD 6.00
- Organizer Pro: recurring USD 59.00 every year

Copy the immutable Price IDs into each Wrangler environment. Enable Stripe Tax,
billing-address collection, receipts, failed-payment notifications, and the
hosted Customer Portal. Register the matching Worker webhook for:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The webhook endpoint is `/v1/webhooks/stripe`. Its signing secret must match the
environment. Do not enable `SELF_SERVICE_ENABLED` in production until tax
registrations, remittance, terms, privacy, refund, and fair-use policies are in
place. Checkout redirects never grant publishing access; only verified webhooks
do.

## Release sequence

1. Deploy staging with `SELF_SERVICE_ENABLED=false`.
2. Complete the Google test-user and Stripe test-mode flow from Electron.
3. Verify upload, update, rollback, unlist, unpublish, delete, expiry, renewal,
   subscription cancellation, and the 14-day failed-renewal grace period.
4. Configure Cloudflare budget alerts and inspect structured audit logs.
5. Deploy production with checkout still disabled.
6. Complete live-mode smoke tests, then change only the production flag to
   `SELF_SERVICE_ENABLED=true`.

The production Worker URL can be overridden in a development Electron launch
with `TOURNEYLAB_PUBLISHER_URL`; release builds default to
`https://publish.tourneylab.app`.
