# Quantitative emotion classification

Apply migration 0027 before starting the new platform worker. It adds nullable
`import_item.sentiment` under the existing tenant RLS. New runtime generation
requires one sentiment per assignment: excited, confused, complaining, urging,
purchase_intent, neutral, or mixed, with confidence and a verbatim quote.
The platform validates the whole chunk before any writes, and stores emotion
alongside intent tags in the same transaction. Invalid emotion evidence retries
the same paid chunk; no separate emotion charge is introduced.

Compatibility: old runtimes/responses and historical rows without sentiment are
accepted as unknown, NOT neutral. There is no automatic backfill or extra cost.
Reimporting data for new classification is a new charge under existing billing.
Existing saved reports stay unchanged; regenerate to obtain the new snapshot.

All selected source rows contribute to `_dataset.sentiments`, independently of
intent tags and the bounded quotation sample. Only schema-valid classifications
with matching original quotes are counted. Each source has one dominant label;
mixed is used when conflicting signals cannot be reduced to one. Percentages use
ALL source rows, including unknown, as denominator. Dashboard and approved report
digests expose this coverage. These are model classifications with verified
provenance, not independently verified semantic accuracy.

Tests: deterministic 500-known-label aggregation, missing/invalid evidence,
mandatory new-runtime output, legacy compatibility, PostgreSQL worker regression
for atomic storage and unchanged retry charges, browser percentages/unknown.
The PostgreSQL regression requires disposable CI PostgreSQL; no production tests.
Live multilingual model-quality evaluation and staging acceptance remain pending,
along with full-data theme clustering, review ranking, connectors, and weekly
execution/adoption/effect feedback. This does not certify all V1 requirements.
