# Workspace B — phase two

Based on main c7fb5c5 (merged/deployed PR #108). Phase one remains independently deployable. This phase adds persisted task context and real open-ended LLM conversations.

## Behavior

- Current task is a three-stage flow: import/reuse sources, confirm an editable goal and model band, then work with the result in one conversation. Structured templates remain accessible.
- A task records its goal, selected source batches, conversation, model/language choices, evidence review, status and optional parent task. Template reports can continue into a conversation with their original sources and report summary. Completed conversation results appear in the report library.
- Failed tasks are removed from the active list on the server and can be restored with a reason. Original messages, sources, credit events and audit records remain intact. A queued/running job prevents removal. Failed legacy imports/reports and publishing runs receive stable task wrappers.
- Support tickets can link to the current task. The server validates workspace ownership and stores a snapshot; the administrator sees it alongside the ticket.
- Task defaults are per workspace member and persist across devices. A delayed defaults response cannot overwrite an edited goal. File reads cannot submit an earlier CSV by accident.
- Administrative entitlement changes, ticket status changes, nonfinancial job replay and referral reversal requests require a reason stored in the existing audit JSON. Financial job replay stays blocked pending reconciliation. Admin language remains Chinese/English, and PR #106 token usage/export remains available.
- Saving a review is free, including when automation is paused. New LLM turns require an eligible subscription and sufficient credits. A deferred task can resume its existing jobs after credits are restored.

## LLM and billing boundaries

The model may ask for clarification, search explicitly selected source batches, or produce a Markdown result for an arbitrary goal. Conversations and intermediate search decisions are persisted. Each turn permits at most four charged model steps; provider retries may repeat a call without adding retail credits, and a budget fallback does not incur a fifth charge. Classification is charged separately. Eco/Standard/Flagship apply to model steps at the existing 1/6/20-credit rates.

Each queued assistant message is a stable billing subject. Completed steps survive retry, duplicate requests do not create duplicate jobs or charges, and conflicting requests are rejected. Job leases fence result writes. Citations must refer to selected-source UUIDs and contain literal source substrings; unverifiable output cannot be saved as evidence. The model sees bounded recent conversation and source context and cannot claim population counts from samples.

This orchestration has read-only source search and text generation. It does not autonomously publish, email, change accounts or execute financial actions. Existing outbound approval controls remain authoritative. Markdown and evidence CSV are available for saved conversations; CSV neutralizes spreadsheet formulas. Token ledger records use the durable task ID for `workspace-task` calls.

## Migration and deployment

`platform/migrations/0037_workspace_tasks.sql` is additive:

- New RLS-protected `workspace_task`, `workspace_task_message`, and `workspace_task_preference` tables, with tenant-consistent foreign keys.
- New nullable `feedback_message.task_id` and `task_context` fields.
- No deletion or rewriting of source, referral, billing or token ledgers.

Use the existing production deployment script. It backs up PostgreSQL, stops the platform, applies all pending migrations, rebuilds/restarts services and checks `/internal/ready`. Deploy the new AI runtime, platform/worker and frontend together; the runtime must support `/internal/task-step` before new task jobs execute.

Readiness now checks the actual task columns in the configured database. An outdated database returns `503 task_database_not_ready`. A successful response includes both `authSchema: ready` and `taskSchema: ready`. The applied migration can also be checked in `schema_migration` for `0037_workspace_tasks.sql`.

No production database has been changed by this development task. For application rollback, retain the additive schema and records. Pause or drain `task.turn` jobs before reverting to an older worker, which does not recognize that job kind. Revert the application components together; an older admin frontend cannot supply the newly required operation reason to the new admin API.

## Validation

- Frontend production build, platform typecheck and AI runtime typecheck/build.
- Platform tests: 322 passed, one existing test skipped; Egg HTTP tests: 53 passed. Frontend contract tests: 34 passed.
- Disposable UTF-8 PostgreSQL: 23 tests passed, including migration readiness, concurrent/idempotent imports and turns, cross-device defaults/removal, tenant RLS with a non-superuser role, task-linked support, parent report context, four-step billing bounds, rejected citations and credit deferral/resume.
- AI runtime: 30 tests passed. A compiled-server HTTP smoke test additionally verifies internal authentication, request validation, actual Mastra chat-completions serialization against a local model stub, and task-linked token ledger output. CI runs this smoke test after building the runtime.
- Full Chromium regression: 129 passed. After the final paused-review permission and floating-help corrections, all 14 task-focused Chromium tests passed, including mobile conversation/export/send controls and paused review saving. Browser tests use mocked platform responses. SQL tests use actual PostgreSQL and the real worker with a model stub. No live paid provider or production Stripe transaction is claimed.
