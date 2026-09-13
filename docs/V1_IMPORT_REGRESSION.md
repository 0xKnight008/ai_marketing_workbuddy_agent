# V1 import release gate

Imports accept up to 2 MiB of decoded UTF-8 content and 5,000 items. Each item must have at most 2,000 text characters and 120 author characters (JavaScript string length, matching the runtime schema). Oversized fields are rejected before storage/credits; paste is no longer silently truncated. Item numbers in validation errors refer to non-empty parsed items, not physical CSV lines (quoted records may span lines).

Apply the `client_max_body_size 16m` setting from the Nginx example to the actual API proxy and validate/reload through your normal deployment process. Egg and legacy Fastify allow JSON escaping overhead; the service still enforces the smaller decoded-content budget.

Regression checks:

- `cd platform && npm run typecheck`
- `cd platform && node --import tsx --test src/import-service/*.test.ts`
- `npm ci && npx playwright install chromium && npx playwright test` (localhost, stubbed API; no real login, messages or billing)
- `cd platform && TEST_DATABASE_URL=<empty-disposable-postgres-db> node --import tsx --test tests-postgres/auth-schema.test.ts`

The PostgreSQL suite requires an empty disposable database, installs migrations and tests the real ImportService with trial entitlements, 1/500 records, job creation and rollback after a later chunk fails. Never point it at production. It is included in the PR's PostgreSQL CI job.

No staging is currently available. These checks do not certify production reverse-proxy configuration or the live AI processing pipeline; those remain separate staging release gates.
