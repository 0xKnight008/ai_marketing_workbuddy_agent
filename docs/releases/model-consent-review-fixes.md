# Model consent, canonical workspace and approval persistence

Based on main be9a0c8 (PR #109). This release addresses production feedback on silent model downgrades, duplicate legacy tools and failed publishing approval decisions.

## Model execution and consent

An explicitly selected model cannot silently change bands. When credits cannot cover the requested step, or the task quota requires Eco, the worker saves a model-choice request in the existing job payload and stops before creating a new charge or making a model call. The job waits indefinitely until a workspace member with execution permission confirms an available band. Adding credits alone does not dismiss this confirmation: the original band becomes selectable when affordable.

The UI explains the credit requirement, offers only currently available bands and asks for an explicit confirmation. Closing the dialog leaves the task waiting. The backend rechecks membership, subscription, balance, task quota and supplier budget at confirmation; it rechecks again at execution. A concurrent balance change returns the task to waiting instead of changing its model. Confirmation affects the remaining steps of that job, preserving saved defaults, completed steps and existing charges. Paid retries retain their original billing reservation and never add a duplicate charge.

Conversation replies show actual paid bands and credits from task_event, alongside the original requested band. Report results, source details, publishing approvals, completed topic results and loaded workflow runs expose the corresponding execution history. Earlier PR #109 tasks that automatically used Eco remain visible as historical differences; their financial records are not rewritten. Token usage ledger remains unchanged.

## Legacy UI dependency audit

The sidebar and workspace search now have seven canonical destinations. The old More tools groups are removed from both navigation and account settings. No business API, source data, report, scheduled rule, billing entry or token ledger is deleted.

| Previous UI | Canonical location / preserved capability |
| --- | --- |
| Today dashboard | Current task; pending count stays in navigation, saved results in Report library |
| Sources CSV form | Current task's import stage, with file validation and editable source name |
| Sources management / Discord | Current task → Source library; existing imports and source evidence remain inspectable; Discord authorization/deduplication APIs are retained |
| Standalone Insights creator | Current task → Structured templates; all six backend templates remain selectable |
| Saved reports | Report library; full report statistics, evidence review, execution feedback and approval-based draft delivery remain available |
| Topic clustering | Report library → Topics; database-verified counts and source audits remain available |
| Weekly review/history | Report library → Weekly review; report navigation, immutable weekly snapshots and comparisons remain available |
| Notifications | Settings & usage → Digests & reminders; recurring rules and approval-based delivery remain available |
| Separate billing entry | Settings & usage → Plan & usage; Stripe management, upgrades and credit top-ups remain available |
| Activity approval controls | Link to the canonical Review & schedule queue, avoiding duplicate decision controls |

Old #dashboard, #imports, #insights, #insights/report-id, #topics, #notifications and #billing bookmarks are mapped to their canonical destinations. Existing audience and task deep links remain supported. Public SEO pages and admin Chinese/English/token-ledger interfaces are unchanged.

## Approval failure

The old workflow update used parameter $3 both as a run_status enum and an untyped CASE comparison. Actual PostgreSQL reproduced SQLSTATE 42P08, "inconsistent types deduced for parameter $3", which rolled back both approve and reject transactions. The update now casts the parameter explicitly to run_status.

Approval retries return the saved result for the same decision without a second execution job. Opposite decisions return 409 and cross-workspace IDs return 404. A failed run transition rolls back the approval and enqueues nothing. The confirmation dialog preserves its decision note and displays failures inside the dialog. Billing pause no longer makes the review queue inert; worker billing and outbound controls still apply before execution.

## Deployment

No database migration is required. Existing job JSON/last_error, task_event model bands and approval/audit fields are reused. Deploy frontend and platform/worker together using the existing production deploy process. The AI runtime contract is unchanged.

Jobs waiting for consent have last_error=model_choice_required and available_at=infinity; this is intentional. Confirm through /api/model-choices/:jobId rather than manually waking them. Before rolling back to a version that cannot honor modelBandOverride, finish or pause/drain these jobs; do not blanket-reset available_at.

## Validation

- Production frontend build and platform typecheck passed.
- Platform unit tests: 326 passed, one existing skipped; Egg production HTTP: 56 passed; UI/SEO contracts: 34 passed.
- Real disposable PostgreSQL: 31 passed, including approve/reject transaction commits, concurrent same-decision replay, opposite-decision conflicts, rollback, model consent without early debit/calls, source classification resumption, mixed-band multi-step history and fully funded Flagship execution.
- Chromium: broad regression covered 145 scenarios (143 passed initially; two new selector failures were corrected). The final 48-scenario acceptance run passed, including both corrected scenarios, the added execution-receipt views, all six templates, output/interface language independence, old links, Discord errors, en/zh/es mobile accessibility and paused billing approval decisions. Unchanged browser regressions from the broad run remain covered. Mobile English and Chinese confirmation screenshots were visually checked.

Tests use disposable PostgreSQL and stubbed model/supplier/browser responses. No production database, live paid model or outbound publication is used during development.
