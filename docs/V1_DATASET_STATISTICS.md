# Full-dataset statistics follow-up

The insight worker previously silently loaded only the first 2,000 source rows,
although the importer accepts up to 5,000 rows per batch and reports select up
to ten batches. It now reads all rows in the selected tenant-scoped batches.
The quotation evidence sent to the model remains bounded at 64 sampled items.

New reports save a platform-calculated `_dataset` snapshot, independent of model
output: source count, distinct labelled items, per-label item counts, sample size,
and valid 1–5 rating counts. Duplicate instances of a label on one item count
once; different labels can overlap. Ratings outside 1–5 or missing/nonnumeric
ratings do not enter the negative-review denominator. Ratings 1–2 are negative.
The dashboard and approved email/Discord digest expose these statistics with
their denominators and distinguish them from per-conclusion cited-source counts.

Historical reports are not rewritten; reports without `_dataset` do not display
invented population totals. Regenerate a report to obtain the new snapshot.
No migrations, secrets or new external calls are needed.

Regression coverage: a deterministic 5,000-row fixture with all complaints after
row 2,000; overlapping/duplicate labels; missing/out-of-scale ratings; a 3,000-row
worker fixture asserting tenant/batch scoping, no SQL truncation, and persisted
full counts; digest denominator checks. These are automated regressions, not
live model-quality or staging acceptance evidence.

Still pending for V1: quantitative emotion classification, full-data topic
clustering (intent totals are NOT theme frequencies), template cardinalities and
script drafts, execution feedback/weekly adoption/effect review, Discord + Google
Sheets connectors, and real staging end-to-end acceptance. No staging is available;
do not send production test messages or claim V1 ready on the basis of this patch.
