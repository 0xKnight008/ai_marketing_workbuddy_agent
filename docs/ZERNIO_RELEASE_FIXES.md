# Zernio release fixes

## Step 1 — Account health and capability contract (review R2 / R3)

Account sync reads the official account list and each eligible account's health
endpoint. It no longer trusts an undocumented `capabilities` field. Valid tokens
with `permissions.canPost` receive `publish` and `schedule`; analytics permission
is tracked independently. Pipeline readiness uses the same capability mapping as
the worker.

Revoked tokens become `expired`; disabled/inactive or provider-error accounts
become `disconnected`. Inconclusive or unavailable health checks become `syncing`
with no executable capabilities. A subsequent sync can recover these accounts.
Malformed list snapshots abort rather than marking all existing accounts missing.

No schema migration is required: these statuses already exist. After deployment,
use Accounts → Sync account health to refresh existing rows. Existing permissions
are not grandfathered or fabricated. Health calls consume supplier API capacity;
the existing shared limiter and request timeouts still apply.

Tests cover official-shaped responses, permission denial, expired tokens, disabled
accounts, mismatched health identity, provider errors, persistence and worker gates.
These tests do not replace live staging OAuth acceptance.

Still pending in separate steps: publishing API/result reconciliation (R1/R4),
media/platform scope (R5/R7), selection confirmation and disconnect (R6/R8).

## Step 2 — Publishing API and verified outcomes (review R1 / R4)

Approved actions now POST `/v1/posts` with an explicit target, X → twitter
mapping, complete approved text including hashtags, and either `publishNow` or
`scheduledFor`. Internal workflow/approval fields are not sent to the supplier.

Success requires the post AND the exact target to be published. HTTP 207,
failed, partial and draft responses cannot complete a run or delivery. Scheduled
and accepted responses remain pending; the worker saves the supplier post ID in
the job's `zernioReceipts` payload and polls GET `/v1/posts/{postId}`. Other approved
targets are submitted without waiting for a scheduled target. Confirmed published
receipts can be replayed locally without another POST or duplicated task charge.

The same confirmation gate applies to Discord notifications and report delivery.
Publishing jobs now use the existing heartbeat/lease fence. A submission intent is
saved before POST, and retries reuse its key. If an ambiguous submission has no
post ID after 23 hours, automatic POST stops before the supplier's 24-hour replay
guarantee expires. An operator must reconcile the supplier outcome; do not delete
the receipt or generate a new key blindly. Pending posts time out 24 hours after
submission or their scheduled time, whichever is later, and use the existing job
failure/dead-letter handling. Receipt storage uses the existing tenant-scoped job
JSONB payload, so no migration is required.

Accepted pipeline posts are reconciled even if the subscription or connection
has since become unavailable: this performs GET only, not a newly authorized
publish. New submissions still require the normal billing/account checks.

Staging acceptance: verify an immediate post's destination URL, a scheduled post
remaining incomplete until published, and failure/partial responses not marking
notifications sent. Restart the worker while pending and confirm the post ID is
reused. No live-provider success is implied by local fixture tests. R5/R7 and
R6/R8 remain separate follow-ups.

## Step 3 — Confirm headless account selection (R6)

Selection responses retain the Zernio account ID (not the native page/location
ID). Before returning success, Piggybot checks that exact account in the scoped
profile, with the expected platform and a connected health state. Visibility is
checked up to three times without replaying the selection POST. Missing identity,
empty snapshots and unhealthy accounts return a 202 pending page without a
success message or popup success event. The page directs the user to Accounts →
Sync account health; missing-target snapshots are not persisted over existing
connections. Both Egg and the legacy gateway follow this contract.

## Step 4 — Disconnect and explicit reconnect (R8)

Migration `0035_zernio_disconnect.sql` adds a local disconnect marker. Owners and
admins can disconnect through Accounts with confirmation. The server resolves
the account inside the authenticated workspace and its Zernio profile before
calling DELETE `/v1/accounts/{id}`. Local status/capabilities are blocked first,
so supplier failure does not leave new jobs enabled. Retrying disconnect is safe;
provider 404 means already absent. The UI does not claim remote success on errors.

A delayed sync cannot re-enable a locally disconnected row. Only a verified
OAuth callback/selection for that exact provider account clears the marker;
ordinary callbacks must include the provider accountId rather than matching an
arbitrary old account on the same platform. The existing worker gates reject
new submissions for disconnected rows. Already submitted/scheduled posts are
not cancelled by disconnect; review/cancel those separately in the supplier.

This step also fixes JSONB capability parameter encoding (`JSON.stringify` rather
than the pg driver's native array encoding). The real PostgreSQL auth-schema CI
suite now exercises permission persistence, cross-tenant/role rejection, provider
failure, stale sync suppression, and explicit reconnection against actual SQL.
Run migrations before the new server code. No production provider calls were
made during local testing.

## Step 5 — Explicit V1 publishing scope (R5 / R7)

Product decision: retain connections, defer unsupported media publishing.
The shared `platform/src/zernio/social-platforms.ts` catalogue now drives
the 14 Accounts connection options and the product publishing gates. V1
announcement pipelines support LinkedIn/X text only. Discord remains a separate
report/notification delivery path, not an announcement destination. Instagram,
TikTok, YouTube and Pinterest media publishing is disabled; all other existing
connection-only destinations remain visible with explicit scope labels.

The builder disables unavailable destinations while allowing old selections to
be removed. Server readiness/activation, AI target/action schemas, worker execution
and the provider adapter independently enforce the scope. Legacy approved but
unsubmitted unsupported jobs cannot bypass the restriction. Legacy media prepare
jobs are rejected before reserving AI credits. AI schemas mirror the contract
with a cross-service regression test, without coupling the ESM runtime loader to
the CommonJS server. Already-submitted
posts retain read-only outcome reconciliation; this release does not cancel them.

Website Chinese/English/Spanish copy now states 14 connection options and the
limited V1 publishing scope instead of promising 15+ fully publishable platforms.
Connections/credentials are not removed and no new migration is needed for this
step. The prior disconnect step still requires migration 0035. Live staging
OAuth and posting acceptance remains required; passing local tests is not a claim
that all 14 platforms have been exercised with real accounts.
