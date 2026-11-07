# Feedback collection, scheduled analysis and editable approvals

## Behavior

The workspace keeps its collapsible left navigation. Current task has three stages: collect sources (CSV, pasted text or connected-channel comments), confirm the goal/model/budget, then inspect evidence and save results. The interface is available in English, Chinese and Spanish. Appearance supports light, dark and system, persisted in the current browser; it does not change the public SEO pages or administrative billing/referral/token-ledger features.

The new Scheduled tasks page owns explicit daily authorizations: connected accounts, goal, model, report language, local time, IANA timezone, collection size and maximum daily credits. Creating or changing a schedule requires consent. Pausing is version checked. History links to collection coverage and the resulting report. No schedule is enabled by the migration, and a scheduled report is not automatically sent to external channels or email.

Publish & review contains both Pipeline and report-delivery approvals. Legacy `#review` links open that queue. Pending outgoing text and email subjects can be edited without changing destinations or original reports. Save creates an audit/version record; approval must reference that version and delivers the frozen edited copy. Concurrent or stale decisions return a conflict. Published or already approved messages cannot be edited through this endpoint.

## Read scope and limits

- Recent-post preview uses `GET /v1/accounts/{accountId}/posts` for Facebook, Instagram, X/Twitter, Bluesky, Threads, YouTube, LinkedIn, TikTok, Pinterest and Reddit (the official schema lists ten platforms). The collector then reads public comments for these platforms except Pinterest. TikTok comments require a TikTok for Business connection; developer-app connections can preview posts but their comment request returns `PLATFORM_LIMITATION`, shown as an actionable Business-connection requirement. It never posts, deletes comments, reads DMs or asks the LLM to browse an account. A publishing connection alone does not prove that Inbox read permission is available.
- Account IDs and Zernio profiles are checked against the authenticated workspace. Users must have workflow permissions and an eligible subscription. The worker checks membership again before collection; schedules also recheck the authorizing member.
- Collection itself uses no AI credits. It can still incur the upstream provider's normal service charges. The model is called only after manual goal/budget confirmation or an explicit scheduled authorization.
- New non-X scans discover up to 25 recent posts through the account posts endpoint, with no post-list pagination. Comment timestamps, not post timestamps, are filtered to the selected window. X scans and existing legacy checkpoints retain the Inbox listing (up to 30 days); X often returns only its first page. Posts outside those windows may have newer comments that are not collected. X/provider pagination and provider cache freshness can further restrict coverage. This is not an exhaustive social-network crawl.
- Each account is bounded to 25 read requests per scan, and each scan to the chosen item limit (maximum 2,000). Pagination checkpoints and overflow are retained. Manual scans and each schedule have independent cursor/dedup scopes. Unchanged comments are deduplicated; an edited comment is a new content version. Absence from a response is not treated as deletion. Inline replies are collected when supplied; deeply nested replies are not guaranteed.
- Coverage records distinguish partial reads, permission failures, limits, duplicate counts and invalid timestamps. Partial batches remain unavailable to analysis until an explicit acceptance is persisted. Scheduled partial reads pause for review; accepting a partial batch does not silently resume the schedule.
- Empty scans skip the model and charge nothing. All collected originals remain in the import batch. Reports use a bounded representative evidence pack, including lower-interaction feedback; they do not claim to analyze every collected comment. Raw feedback is not assigned fabricated sentiment/tag labels.

Upstream API references audited on 2026-11-07: [Accounts API](https://github.com/zernio-dev/zernio-rust/blob/main/docs/AccountsApi.md), [official OpenAPI schema](https://github.com/zernio-dev/zernio-rust/blob/main/openapi.yaml), [Zernio Comments API](https://github.com/zernio-dev/zernio-rust/blob/main/docs/CommentsApi.md). Confirm Inbox availability for the production provider plan and accounts before enabling scheduled collection.

## Channel-read and account-sync correction (after PR #127)

- The authenticated preview route is `GET /api/feedback/accounts/:accountId/posts` in both gateways. It verifies tenant/profile ownership, workflow permission, active connection and subscription before any upstream call. Preview is explicit, returns at most 25 posts, imports no source and starts no AI job. Native post IDs (LinkedIn URNs, Bluesky URIs, YouTube/TikTok video IDs) are preserved. Pinterest displays title/description when a message is absent. Links are credential-free HTTPS.
- Post reads and comment reads are different capabilities. X Inbox must be enabled per account to collect comments. X recent-post preview can require Analytics; this change never enables it automatically. Normal provider/X read charges still apply. TikTok app restrictions, expired authorization, X capability flags, billing and rate limits produce distinct messages in en/zh/es rather than a generic permission error or false successful empty scan.
- On the Accounts page, a successful sync removes disconnected accounts from the visible list and clears stale capabilities for accounts omitted by the upstream snapshot. The database rows remain for historical tasks, approvals and audit references. Locally disconnected accounts cannot be resurrected by sync; explicit reconnection is still required. Expired accounts remain visible for reconnection. A failed sync retains the displayed list and shows an error. Feedback selection also excludes disconnected accounts; workers revalidate status before reading.
- No new migration or production environment variable is required for this correction. Migration 0041 from PR #127 remains required. Existing scan checkpoints are compatible and keep their original discovery method.
- Production read-only evidence on 2026-11-07: Dora2000 TikTok account posts returned HTTP 200 with zero posts; X Inbox discovery and comments returned HTTP 200 after its account-level Inbox flag was enabled. A zero result is not proof of no comments on the social network. Other platforms and non-empty TikTok comments are covered by adapter contract tests, not live-account verification.

Deployment acceptance: sync connections and check that disconnected cards disappear; preview TikTok recent posts; scan an account with a known public comment and verify the original ID/link in the imported evidence. For TikTok, verify the connection uses the Business app if comments return the Business restriction. For Pinterest, expect preview only and disabled comment selection. Recheck permissions rather than interpreting an empty response as an error. Cached comments can lag by up to ten minutes, and nested replies can be incomplete.

## Budget and failure behavior

Scheduled analysis requires `AI_METERING_MODE=cost-v1` and verified rate snapshots. Existing pricing remains `ceil(C × 1.06 / 0.01)`; this change does not revise subscription prices, rates or top-up units. A schedule's daily ceiling is permission to spend **up to** that amount, not a fixed charge. The operation permits one report call and uses the existing reservation/settlement/refund ledger. An empty scan needs no reservation. Insufficient balance pauses the schedule without switching models, purchasing credits or converting a trial subscription.

Insight preflight checks the complete serialized provider request, including messages, evidence, tool schemas and response format. Its UTF-8 upper-bound estimate is intentionally conservative and is not a tokenizer. It never silently removes selected evidence to fit a quote. If the complete input exceeds the confirmed input/cost allowance, no upstream call is made, the deterministic error is terminal rather than retried five times, and the unused reservation is released. Users can narrow sources or confirm a suitable budget on a new attempt. Previous daily reports are excluded from daily-report recursive context.

For Pipeline/insight calls using credit-bounded output, output capacity comes from remaining confirmed cost after input costs. Optional positive-integer `providerMaxOutputTokens` and `providerContextTokens` fields in each `AI_METERING_RATES_JSON` band can cap requests at **verified provider limits**; these fields travel with the accepted rate snapshot. They are not fixed Eco/Standard/Flagship product caps. Do not invent values for a proxy alias: use the actual upstream contract/model metadata. When absent, the provider still enforces its own limits.

Schedules are unique per local calendar date and also enforce a rolling 24-hour separation, preventing repeated daily charges during clock changes or schedule edits. A 23-hour DST day can therefore delay the next run. Pausing/editing while collection is running prevents automatic analysis of that obsolete schedule snapshot. A report already authorized and started can finish; pausing does not cancel an in-flight provider request.

## Migration and deployment

Deploy platform, runtime and frontend from the same commit using the existing production deployment workflow. It backs up the database, stops the platform, runs `npm run migrate` / `npm run db:check`, restarts services and checks readiness. Do not run a separate ad hoc schema reset.

Migration `0041_feedback_schedules_approval_versions.sql` adds:

- `feedback_schedule`, `feedback_scan`, `feedback_source_state`, `feedback_comment`;
- `approval_content_version`, `approval_request.version`, `insight_report.goal`;
- the `channel_feedback` import source and a restricted due-workspace discovery function.

All five new tenant tables enable and force RLS. The discovery function returns workspace IDs only, uses explicit tenant contexts and revokes PUBLIC execution. When migrations and platform use different PostgreSQL roles, the migration owner must grant the application role access to the new tables and `EXECUTE ON FUNCTION due_feedback_workspaces()` using the deployment's existing least-privilege convention. Do not grant PUBLIC execution or BYPASSRLS. Same-role deployments need no additional grant.

**Cutover:** migration disables future implicit `enqueue_daily_ops_reports()` jobs. It does not delete historical reports, approvals or jobs already queued by the old scheduler. Before rollout, inventory and drain or explicitly cancel outstanding legacy daily jobs with the existing job administration procedure. After rollout, users create/re-authorize schedules in the new page. Existing report notification settings still apply to manually created reports; new scheduled feedback reports are excluded from implicit notification planning and evening recaps.

Runtime/platform rate configuration and LiteLLM routing remain as previously deployed. A Zernio client with Inbox access is required for collection. There is no new public secret or frontend API key.

### Server verification

Run from the deployed checkout (commands do not print secrets):

```bash
cd /opt/ai-marketing-agent
git log -1 --format='%h %s'
sudo systemctl show piggybot-platform piggybot-ai-runtime \
  -p MainPID -p ExecMainStartTimestamp -p ActiveState -p SubState
curl --fail --silent --show-error http://127.0.0.1:4100/internal/ready
curl --fail --silent --show-error http://127.0.0.1:4111/internal/health
```

Using the existing protected database session, verify the recorded migration, tables and application-role permission (do not paste connection strings into chat):

```sql
SELECT name FROM schema_migration
WHERE name = '0041_feedback_schedules_approval_versions.sql';
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN
('feedback_schedule','feedback_scan','feedback_source_state',
 'feedback_comment','approval_content_version');
SELECT has_function_privilege(current_user,
 'due_feedback_workspaces()', 'EXECUTE') AS can_discover_due_workspaces;
```

Then test as an eligible workspace user: collect a small window; inspect account coverage; confirm a manual analysis budget; verify actual usage/refund; save an outgoing approval edit and approve the saved version. Create one low-budget daily schedule and verify its history after the chosen local time. Check a partial/empty scan and insufficient balance separately. A green health endpoint confirms process/schema readiness, not upstream read permission or successful scheduled execution.

### Rollback

Pause new schedules and stop/drain new `feedback.scan` jobs before rolling back application code. Retain the additive schema and audit/history; no down migration is supplied. Do not restore the legacy implicit scheduler merely to roll back the UI. Keep the prior deployed bundle and the deployment's database backup available. A rollback must not replay approved external deliveries or reset the credit ledger.

## Validation

Regression coverage includes real PostgreSQL migration/RLS, idempotent collection and deduplication, explicit partial acceptance, independent schedule cursors, insufficient/empty budgets, exact-version edited delivery, reader pagination, complete-request preflight, provider-limit metadata, and en/zh/es desktop/mobile accessibility and appearance. Local Chromium and Firefox exercise the changed UI. WebKit runs in the existing Linux PR CI because the local macOS 13 host is unsupported by the pinned Playwright WebKit build. No production messages or paid model requests are sent by these tests.
