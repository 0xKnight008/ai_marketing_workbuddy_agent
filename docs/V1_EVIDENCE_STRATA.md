# Emotion-aware evidence sampling

The report evidence builder previously counted all valid emotions but reserved
quotation slots only for engagement, intent tags and numeric low ratings. An
untagged, unrated, low-engagement expression of confusion or urgency could count
in the totals without any representative appearing in the model's evidence.

The bounded sample now takes the union of 24 engagement leaders, two sources per
intent tag, eight low-rating reviews, and one source per verified sentiment.
These disjoint quotas total 61, within the existing 64-source request limit.
Sentiment representatives are selected by confidence, then engagement and source
order. Population totals still use all selected rows, not the sample.

Selected sources carry their optional validated sentiment and verbatim evidence.
If that evidence falls after character 600, the 600-character source excerpt is
shifted to include it; excerpts remain contiguous original text. Tag quotations
remain available separately in tagSamples. No full-text/token-limit expansion or
additional classification call/credit charge is introduced.

Historical tag evidence is revalidated against source text and confidence bounds
before aggregation or selection. Duplicate labels on a source count once and
use the highest-confidence valid quotation consistently in samples. Invalid
labels no longer leak into member labels or report totals. Stored source rows
and historical saved reports are not rewritten; regenerated reports use the fix.

Verification: a deterministic 500-source fixture with all strata disjoint checks
all seven emotions, eleven tags, low ratings, opaque references, bounded excerpts
and all six runtime request contracts. This verifies coverage/provenance, not
the semantic correctness of a model's labels or a statistical random sample.

No migration is required. Deploy platform worker and AI runtime together for
sentiment metadata; older runtime schemas ignore the additive field but still
receive the improved verbatim excerpts. Browser output contracts are unchanged.

Remaining V1 gates: full-dataset theme clustering and counts, Discord and Google
Sheets import connectors, historical/activity-based scheduled weekly reviews,
and staging/live-model end-to-end acceptance. This change does not close those
gates or replace the user-confirmed absence of staging with production testing.
