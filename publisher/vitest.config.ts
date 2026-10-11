import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
          STRIPE_SECRET_KEY: 'sk_test_secret',
          STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
          GOOGLE_CLIENT_SECRET: 'google-secret',
          SESSION_SECRET: 'session-secret'
        }
      }
    }))
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 }
    }
  }
});
