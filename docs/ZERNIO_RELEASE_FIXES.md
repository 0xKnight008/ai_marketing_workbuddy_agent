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
