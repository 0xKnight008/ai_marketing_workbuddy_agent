# Schedule status, activity and obsolete model confirmations

An enabled daily schedule remains enabled after its current collection completes. The UI now labels that state separately from the latest collection and analysis status. Schedule cards and an open run history refresh every five seconds while visible, on window focus, and on manual refresh. Failed reads preserve the last successful data and show an error; late responses cannot replace a newer selection.

Activity retains AI reservations/actions and the audit trail. Approval actions remain in Publish & review; the empty Review link/column has been removed from Activity in all locales.

Both prepare_ai_run and reconcile_ai_run model confirmations are restricted to pending, queued or running workflow runs, including the confirmation write endpoint. Waiting-for-approval and terminal runs cannot be resumed through obsolete prompts. Genuine pending budget confirmations remain available.

No SQL migration or pricing change. Deploy the web and platform together. A separately authorized production cleanup archived one confirmed stale reconciliation prompt for a cancelled run and wrote an audit event; it did not delete the run or alter credit records.

Acceptance: verify an enabled schedule with a completed/empty collection shows both states accurately, refresh an open history through completion, verify refresh errors preserve data, and verify Activity retains billing/audit records without a Review column. Browser tests cover en/zh/es. PostgreSQL regressions cover the latest collection and both model-confirmation job kinds.
