# Weekly execution attribution

Weekly history now reads existing append-only `insight.action_feedback` audit
records, not the mutable latest feedback JSON on a report. Only changes of status
count. Note/effect edits do not move a previous completion to the editing week.
Each action contributes its last status transition within the requested UTC ISO
week; a genuine reopening and later completion can therefore count in a later week.
Effect values are those recorded at the selected transition, not subsequent edits.

Queries are workspace-scoped. Missing historical audit records are not guessed
from mutable feedback. No new table or migration is required. Existing sealed
snapshots retain their original values and legacy basis. New snapshots include
`status_transition_in_window`; comparisons between different bases are suppressed.

The live seven-day review remains a current-state view. Historical snapshots must
not be described as automatically reconstructed first-completion timestamps.
