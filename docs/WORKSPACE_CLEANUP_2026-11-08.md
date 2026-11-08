# Workspace cleanup and activity records

## User-visible changes

- New/edit Pipeline excludes disconnected destination cards and removes their IDs from editable drafts, invalidating an old estimate. Existing runs retain their target history. Active/uncertain submissions are not edited automatically. Backend activation and publication still validate the connection.
- Activity retains AI credit reservations/actions. Its other feed is backed by `workspace_activity_audit`, a tenant-scoped, security-invoker database view. It returns schedule authorizations/pauses and scan/analysis outcomes, Pipeline activation/execution/approval records, and report-delivery outcomes. It does not return sign-in, import or general diagnostic noise. Underlying audit events remain intact: Stripe checkout recovery and report history depend on them. This retention choice was explicitly confirmed by the product owner.
- Source library offers permanent content deletion for owners/admins/editors with an explicit confirmation. `DELETE /api/imports/:batchId` requires `{ "confirm": true }`. Queued/in-flight source use is rejected with `import_in_use`. Batch locks serialize new task/report submission with deletion; topic creation and deletion share a workspace advisory lock.
- Deletion removes `import_item` rows plus cascading tags/topic assignments, and recalculates affected topic counts. A small batch tombstone remains for historical references and credit subjects. Compact channel-feedback dedup hashes remain with null item references, preventing automatic reimport of deleted originals. Library/reuse lists exclude tombstones; direct source reads return 410. Saved reports, quotations, conversations and financial ledgers remain independent. Follow-up tasks with deleted sources require new sources rather than silently running without evidence. Admin replay of a deleted-source report fails before a new AI reservation.
- Callback success pages bind the close button inside the exact CSP-hashed script instead of blocked inline `onclick`. Opener notification uses the configured public-site origin. A return link remains available if the browser refuses to close a non-script-opened tab. Both social OAuth and Google Sheets use the fix, with equivalent legacy gateway behavior for social OAuth.
- Appearance offers System and Dark. Previously stored Light selections migrate to System. System still follows OS preference (light on a light OS, dark on a dark OS); the explicit Dark setting remains persistent. New workspace copy is en/zh/es.

## Deployment

Deploy the platform and frontend together through the normal workflow. Migration `0042_workspace_activity_source_cleanup.sql` adds the filtered view, batch deletion metadata and nullable feedback item references with an index for bounded deletion work. It does not delete existing sources or audit events. Source cleanup happens only after an authorized user's explicit delete action.

The view uses PostgreSQL 15+ `security_invoker`, matching PostgreSQL 16 CI. A read-only production check on 2026-11-08 returned server_version_num 160015 (PostgreSQL 16.15). If migration owner and app role differ, grant the app role `SELECT ON workspace_activity_audit` through the existing role provisioning process; it must also retain its normal SELECT access to the underlying tenant tables. Do not grant BYPASSRLS. Readiness checks now require the new view/columns.

Verify after deployment:

1. New Pipeline: disconnected accounts are absent; connected publishing destinations still work.
2. Activity: credit reservations remain; schedule execution and publication outcomes appear; unrelated audit entries do not. Confirm existing Stripe subscription recovery still works normally.
3. Delete an expendable, finished source with no active jobs. Reopen the library on another device; the source is absent. Saved reports remain readable and opening its original evidence explains deletion. A busy source must return 409 and remain present.
4. Connect a channel and close the success popup; verify the parent account list refreshes. Open the callback as a normal tab and check its return link.
5. Appearance: only System/Dark, including browsers that previously saved Light.

PostgreSQL reuses space freed by deleted rows via normal vacuum. This does not promise an immediate reduction in the physical database file size. Saved report/conversation snapshots and small metadata are deliberately retained.

## Rollback

The schema is additive and can remain during application rollback. Older UI must not be used to reopen deleted batches; they are terminal failed tombstones with no source rows. Physical source deletion cannot be undone by reverting application code. Restore content only through the normal backup/recovery procedure, not by clearing the tombstone flag.
