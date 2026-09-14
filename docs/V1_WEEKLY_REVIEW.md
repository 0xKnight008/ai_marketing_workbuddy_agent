# Seven-day follow-up review

The Insights page now exposes an on-demand, read-only review of generated reports
from the last seven days, grouped into all six templates. No AI call, credit
charge, approval or outbound delivery occurs. It requires the migration 0028
introduced in PR64; this batch adds no migration.

Scope is a **generation cohort with current feedback**, not a historical snapshot
and not all activity completed during a calendar week. The server UTC window is
start-inclusive/end-exclusive. Older reports are not included even if completed
this week; feedback changed after generation is reflected on refresh. Reports
without generated_at are not assigned invented dates. Future snapshot/calendar
review and automated approved delivery are separate work.

Definitions:
- Suggestions = server-extracted trackable actions from the selected reports.
- Reviewed = a valid stored manual feedback record; missing/invalid is unreviewed.
- Adopted includes completed. Adoption and completion divide by ALL suggestions,
  including unreviewed/planned/dismissed.
- Effects count completed actions only. Improvement divides by known effects
  (improved + unchanged + worse); unknown is reported separately.
- Zero denominator yields null / N/A, never an invented zero-percent result.
- Phantom feedback keys not present in a report are ignored.

The review includes saved report summaries (not freshly fact-checked), action
statuses and observation notes, plus links to update feedback. Effects remain
self-reported, not measured causal impact. Refresh explicitly after updates.
The read query is tenant-scoped and uses generated_at rather than created_at.
More than 500 reports in a window returns 422 rather than misleading partial rates.

Validation covers arithmetic, missing/malformed feedback, re-opened actions,
tenant/time filters, bounds, authenticated route precedence, browser refresh/error
states and navigation. PostgreSQL CI covers the exact inclusive/exclusive boundary
and tenant isolation. Real staging is still unavailable; no production test calls.

Remaining V1 gates: full-data theme counts, Discord + Google Sheets connectors,
selected-draft delivery, activity-based/historical weekly snapshots and scheduling,
and staging/live-model acceptance. This cohort review is one incremental delivery,
not completion of the entire release checklist.
