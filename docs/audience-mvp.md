# Audience landing pages and first-analysis MVP

The homepage remains the brand overview. Its Solutions menu, audience cards and footer link to three independent pages:

| Audience | English canonical URL | First report |
| --- | --- | --- |
| Creators | `/for/creators/` | `comment_insights` |
| Sellers | `/for/sellers/` | `review_attribution` |
| Community hosts | `/for/community-hosts/` | `community_digest` |

Chinese and Spanish use `/zh/for/.../` and `/es/for/.../`. These are Vite HTML entry points with server-readable headings, content, links, canonical URLs, reciprocal hreflang and WebPage/Breadcrumb structured data. The sitemap contains 21 canonical URLs. Generate content with `npm run seo:generate`; edit the source in `scripts/generate-audience-pages.mjs` and `src/audience/landing-*.json`, not the generated HTML. The English route has no `/en` alias.

## Subscription handoff

All personas use the existing account, workspace, plan catalog and Stripe billing system. Each page offers all three plans. CTA links carry the persona and selected plan through `checkoutAuthPath`; the server validates the persona allowlist. Stripe success/cancel URLs and activation email links preserve persona and language. These values select a task, never grant subscription access. Activation still requires verified Stripe entitlement. Existing subscribers can open the scenario directly without buying a second subscription.

A persona entry opens `/app?locale=...&persona=...#start`. A confirmed empty workspace without a specific destination sees the three-task chooser. Existing workspaces retain their overview. Report links use `#start/<persona>/<reportId>`; the normal report library and overview reopen these three templates in the review workflow. The full report and existing downstream actions remain reachable from the result.

## Obtain a result → check evidence → save and reuse

1. Paste one source item per line or upload CSV. Name the source and describe its date/scope; preview record counts and exact duplicates before submission. The importer preserves distinct authors, platform, external IDs and metrics. Sample input is labeled and still consumes real credits if submitted.
2. Confirm the paid import. Existing asynchronous classification runs; report generation is a separate explicit paid action scoped to the selected classified batch. Display credit availability when the role can read billing; server billing checks remain authoritative for all roles.
3. Poll persisted jobs. Leaving the page does not cancel background jobs; imported batches and reports can be resumed from the scenario library. Failures do not automatically resubmit paid work.
4. Show grounded findings and the original source text resolved through the saved report's `_evidence` map. If the full source is unavailable, label the validated excerpt accurately. Show existing full-dataset statistics when present; citation counts are not population frequencies.
5. The user explicitly confirms review and selects focus items. Save to the server and reopen with those selections intact. Saving does not enqueue AI work or publish anything. Exhausted subscriptions can still read and review saved reports; paid processing remains blocked.

## Deployment

Apply **`platform/migrations/0036_insight_review.sql` before deploying the new gateway** (`npm run migrate --prefix platform` in the normal deployment environment). This adds nullable `insight_report.review_selection`; existing report output and action feedback are unchanged.

New authenticated Egg routes:

- `GET /api/insights/:reportId/review`
- `PUT /api/insights/:reportId/review` with `{ reviewed: true, selectedKeys: [...] }`

The service uses tenant scope, generated-report checks, row locking and `workflow:run` authorization. Selection keys must refer to server-saved grounded findings. It stamps actor/time, audits writes and treats identical retries as no-ops. Viewers can read but cannot write. No changes to plan entitlement or Stripe pricing are required. The legacy gateway is not the supported import/insight API server.

## Verification

- `npm run build`
- `npm run typecheck --prefix platform`
- Platform `tsx --test src/**/*.test.ts` and `npm run test:egg`
- `node --test scripts/audience-seo.test.mjs`
- Playwright `tests-browser/audience-mvp.spec.ts`, plus existing report/statistics/navigation regressions.

Browser tests stub authenticated API responses and exercise real UI state transitions, asynchronous progress, source evidence, save failures, reload persistence, role restrictions, empty-workspace routing, CSV deduplication, three languages and mobile layouts. Server tests validate permission boundaries, tenant predicates, immutable highlight keys, idempotent saves and Stripe context. They do not create live subscriptions or call paid AI providers.
