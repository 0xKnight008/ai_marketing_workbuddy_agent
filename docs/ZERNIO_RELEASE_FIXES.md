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
