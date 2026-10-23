# Workflow failures, model selection and metering

Subscription payment, platform credit reservations and successful model responses
are separate events. A successful Stripe trial handoff does not guarantee that
generation or publication checks will succeed.

## Diagnose without rerunning a paid task

The run detail endpoint accepts either a workflow run UUID or its canonical
workspace-task UUID. Both are scoped to the authenticated workspace. Failed
workflow task details and Activity show a safe failure category, requested band,
actual credit receipts and generated drafts when available. Raw provider
credentials and provider error messages are not returned to the browser.

- `provider_auth`: the provider rejected its server credential. Update the
  existing protected credential for that channel and verify it before retrying.
  A Flagship proxy credential is separate from the Standard Z.AI credential.
- `content_blocked`: generation completed but the publication policy rejected
  the generated text. It has not entered approval or been published. For X,
  the current platform policy counts both the content and appended hashtags
  against its 280-character cap. Correct the draft rather than approving a
  blocked action plan.
- `generation_failed`: generation stopped before producing an approvable plan.

Legacy `ai` reservation records and newer `ai.*` records both display AI credits
in Activity. Credit reservations do not establish whether an upstream provider
has charged money. Runtime token receipts establish the provider/model and
reported token usage; consult the provider's billing records for monetary costs.
Workflow agents now attach the durable platform run ID to future token receipts.
Historical receipts retain their original per-agent IDs.

Canonical workflow tasks now read their selected model from the original run,
so an existing wrapper's default Standard value cannot mask a Flagship selection.
No model routing, approval guard, historical charge or production task is changed
by this diagnostics patch. No migration is required.
