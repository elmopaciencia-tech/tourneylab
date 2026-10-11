export interface Env {
  DB: D1Database;
  REPORTS: R2Bucket;
  ENVIRONMENT: string;
  PUBLIC_RESULTS_BASE: string;
  PUBLISH_BASE: string;
  SELF_SERVICE_ENABLED: string;
  STRIPE_EVENT_PASS_PRICE_ID: string;
  STRIPE_PRO_PRICE_ID: string;
  STRIPE_EVENT_PASS_AMOUNT: string;
  STRIPE_PRO_AMOUNT: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  stripeCustomerId?: string;
}

export interface ReportRow {
  id: string;
  owner_id: string;
  title: string;
  visibility: 'listed' | 'unlisted';
  state: 'draft' | 'published' | 'frozen' | 'deleted';
  current_revision: number;
  publish_until: string | null;
  bytes_stored: number;
  last_published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
