# Selected draft delivery and exact approval text

The send dialog can select saved title/script, reply, product listing/presale
poll, community announcement, or daily-task copy from the six report templates.
The server uses the same whitelist as the UI and rejects invented keys or client
text overrides. Destinations remain the existing authorized email/Discord flow;
this does not implement publishing directly to shops or social comment threads.

Before requesting approval, the server freezes content and email subject in BOTH
the approval parameters and report delivery snapshot. Activity displays the exact
message. Selected Discord drafts longer than 1900 characters are rejected (use
email); report digests are limited before approval, never afterward. Email text
is capped at 12000 characters. The worker sends the frozen text, not a rerender
of the report, and uses the approval ID for provider idempotency.

Jobs carry approvalId. Stale jobs skip newer approvals, and success/failure
updates are restricted to the matching approval. Rejected/unapproved requests
still do not send. No new migration is needed; fields are additive JSON.

Rollout: old pending deliveries have no exact text snapshot. Reject and request
them again to review the actual message. Already-approved legacy jobs fail
closed and require a new approval after their bounded retries fail; they are
not sent using an unreviewed regenerated digest. Deploy platform and worker
together; jobs already executing old code cannot be retroactively frozen.

Verification covers selected text, unknown keys, length bounds, exact snapshots,
stale/legacy jobs, all-six draft extraction and UI selection/approval preview.
No real email/Discord messages or production test calls are made.

The pure shared selector lives in `platform/src/contracts/report-drafts.ts`.
The UI imports that same file, while Egg loads it inside the platform's CommonJS
package scope. Keep it within the deployed platform directory: a root-level
helper inherits the website's ESM scope and is omitted from the backend archive.
Run `npm test --prefix platform` (including Egg boot), not just the tsx unit tests,
and `npm run build` when changing this cross-runtime contract.

Remaining V1 gates include full-data topic counts, Discord/Sheets import
connectors, historical/activity-based scheduled weekly reports and staging/live
model acceptance. This patch completes a bounded selected-draft delivery path,
not the entire V1 release checklist.
