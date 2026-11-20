# Pipeline generation, language and credit activity

## Behavior

- A saved `action_plan.created` with `blockedByCompliance=true` is completed AI generation, even though the publication run fails. Settle verified usage using the operation's accepted tariff and policy, then release the unused reservation. Keep the draft and validation reasons available. Do not create an approval or publication job for invalid content.
- For example, a 6-credit reservation and verified $0.010 generation cost under `cost-106-v1` settles `ceil(0.010 × 1.06 / 0.01) = 2` credits and releases 4. This is a synthetic regression fixture, not the measured cost of production run `0b7b5055-de67-48b0-97d2-5efc2a67d30d`.
- Unknown or incomplete receipt evidence follows existing reconciliation rules. Replayed callbacks do not create another charge. Existing terminal/refunded operations are not retroactively debited by this release. Failed generation without a saved valid result retains its existing refund behavior.
- Planning, copy generation and semantic compliance receive the original brief. Explicit output-language instructions take priority over the brand default; the interface language is not an instruction to translate the post. X prompts budget for the full outbound text, including spaces and hashtags. Deterministic publication checks remain mandatory; there is no hidden paid repair request or automatic truncation.
- The Pipeline page no longer displays unrelated global model-choice prompts. A paused current run still displays its budget/payment/model recovery control inline. Completed or failed publishing runs cannot be resumed through stale model-choice jobs. Initial model selection and credit confirmation remain in the workflow.
- Activity reads both `task_event` and the positive entries in `ai_cost_journal`, scoped to the workspace. Shadow estimates are excluded. The UI distinguishes reserves, settlement from those reserves, unused-credit releases and refunds. It refreshes on entry and every five seconds while open, retaining prior records and showing an error if refresh fails. The most recent 100 entries are returned.

## Deployment and acceptance

Deploy the web build, platform and rebuilt AI runtime together, then restart the application services through the normal deployment procedure. No new SQL migration, provider routing change, rate change or production data rewrite is required.

1. Create a new Standard or Flagship Pipeline with a Chinese interface/brand default and an explicit English brief. Verify the generated post is English and the saved brief remains intact. Local provider mocks validate prompt transport and precedence; actual provider language adherence requires this production check.
2. Check the generated full X text is within the platform limit, then review/approve on the same page. Do not bypass the publication check to test invalid content in production.
3. For any newly generated but blocked draft, compare its receipt to supplier token evidence: actual settlement plus returned unused credits should reconcile to the accepted reservation. Unknown usage should remain in reconciliation.
4. Open Activity without logging out. Confirm the latest reserve/settle/release records appear and are not shown as two separate debits. Check English, Chinese and Spanish labels.
5. Confirm a completed run shows no stale model-choice prompt. A genuinely exhausted budget must still require explicit confirmation before more paid generation.

The already-refunded reported run is not automatically charged again. Historical correction, if desired, requires separate review of its stored receipts and explicit authorization.
