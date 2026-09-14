# Report quotation integrity

All six report templates now require a non-empty, verbatim-verified citation on each structured conclusion carrying a citations field. A valid ref without a quotation no longer qualifies. Reports with zero grounded conclusions fail instead of publishing.

The legacy approxCount/evidenceCount fields now contain the number of distinct cited sources, NOT estimated mentions across all imported rows. UI and delivery labels state this explicitly; duplicate excerpts from the same ref count once. Population-level theme frequencies still require a separate full-data clustering/counting implementation. This patch does not pretend sample counts satisfy that requirement.

Daily tasks may cite explicit p-prefixed references to supplied prior report summaries. These secondary sources are retained in _priorEvidence and labelled separately from original imported comments. They are not evidence that every statement in a prior summary is factually correct. New high-value-member conclusions also require quotations.

Tests cover all six result contracts with a deterministic 500-item evidence fixture, invalid quotations, bare refs, exaggerated counts and duplicate excerpts. This is a provenance regression, not live LLM quality evaluation or full V1 acceptance.

Still required: quantitative emotion coverage, full-dataset trustworthy theme counts, required output cardinalities, execution feedback/weekly reviews, Discord + Google Sheets connectors and staging end-to-end validation.
