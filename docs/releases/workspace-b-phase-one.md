# Workspace B — phase one

Based on main 025a992 (PR #107). This PR changes the authenticated application and internal administrator console. It contains no platform, AI runtime, migration, billing policy, or public SEO changes.

## Customer experience

- `/app` opens the current task. Existing deep links remain supported. Primary navigation contains current task, review, reports, publishing, channels, activity, and settings; less frequent tools live under More tools.
- The three task stages are source import, explicit goal/model confirmation, and results. Classification and report generation run sequentially after confirmation. Each is billed by the existing server; the UI discloses their separate cost. Phase one supports the existing creator, seller, and community templates only.
- Report review and selected focus continue to save through the existing report review API. Markdown retains the whole report, and evidence CSV includes citations across all sections, with BOM, CRLF, quote escaping and spreadsheet formula protection.
- Channels have their own search, platform/status filters and pagination. Existing OAuth, sync and disconnect actions remain.
- Settings combines billing and account tabs. Stripe subscription management, upgrades, AI credit purchases, current subscription state, referral link generation and referral ledger remain available, subject to server permissions.
- Floating support calls the existing authenticated feedback API. Failed submissions retain the message. Linking tickets to a task requires phase two.
- Interface language remains English, Chinese or Spanish. The supplied official logo is a bundled asset included in Docker builds.

## Administrator console

- `/app/admin` keeps the existing email authentication and cookie session. It supports Chinese and English only, independent of customer language.
- The PR #106 token usage ledger retains cursor pagination, unknown versus zero values, all matching CSV export and protection against partial export. Row details expose all fifteen raw ledger fields.
- Referral filters cover pending, issuing, available, void, reversal_pending and clawed_back. Requesting reversal never claims that Stripe has completed settlement. Financial dead-letter jobs require reconciliation; generic one-click replay is disabled for those two financial job types.
- Workspace entitlements, support tickets, subscribers and nonfinancial dead-letter replay continue to use existing endpoints.

## Explicit phase-two boundary

Workspace-wide failed task removal, task-linked support, operation reason audit, persisted task preferences, unified task context and arbitrary-goal multi-turn LLM execution are separate backend work. Phase one does not simulate them in browser storage.

## Verification

Run `npm run build`, `cd platform && npm run test:ui`, and `npx playwright test --project=chromium` sequentially. The build regenerates static SEO pages; running that regeneration concurrently with Vite browser tests can reload test pages and discard in-progress form state.

The browser suite exercises desktop/mobile task completion, saved review reopening, three model bands, report files, referral pagination, support retry, billing entrances, administrator language/auth/ledger, responsive navigation and WCAG checks for all three customer languages. API calls are mocked in browser tests; these tests do not claim production Stripe delivery or live paid LLM execution.

Deployment uses the normal frontend build/image. No migration or data backfill is required for this phase; rollback uses the previous frontend image.
