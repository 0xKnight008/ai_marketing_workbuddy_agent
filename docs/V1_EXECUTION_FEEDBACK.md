# Manual action execution feedback

Apply migration 0028 before starting the updated platform. It adds an empty
`action_feedback` map to existing tenant-protected reports; it does not rewrite
the generated report or change approval/delivery state.

Generated reports expose trackable actions from all six templates through
`GET /api/insights/:reportId/actions`. Keys refer to server-saved array entries,
not arbitrary client-supplied actions. Authorized workflow runners can save
`PUT /api/insights/:reportId/actions/:actionKey` with status planned/adopted/
completed/dismissed, effect unknown/improved/unchanged/worse, and optional notes.
Only completed actions may report a known effect. Viewers can read, not write.
Reports must be generated and owned by the actor's workspace.

Writes lock the report row, merge one action's feedback, and append an audit
event in the same transaction. Identical retries are no-ops; concurrent edits to
different actions do not erase each other. Concurrent changes to the same action
are serialized with last-write-wins semantics and preserve prior state in audit.
An untouched action is unreviewed, not implicitly adopted or completed.

This is manual bookkeeping: no supplier execution, publication approval, outbound
message or AI charge occurs. Effects are self-reported observations, not measured
causal impact. The dashboard preserves edits on save failure and reloads stored
feedback when a report is reopened. Existing generated reports are supported.

Automated coverage includes six-template extraction, permissions, tenant scope,
invalid action keys, input limits, retry deduplication, saved/reopened browser UX,
and a PostgreSQL CI regression for concurrent persistence and audit history.
Real PostgreSQL CI and staging validation remain separate from local unit/UI tests.

Next: weekly adoption/completion/effect aggregation from these records. Full-data
theme clustering/counts, connector imports (Discord + Google Sheets), selected
draft delivery and staging/live-model acceptance also remain release gates.
