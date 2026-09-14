# Template output acceptance

New content recaps must retain 3–5 distinct quoted fan themes, exactly 10 distinct
topic proposals, at least one title draft and 1–3 quoted script drafts. Daily ops
must retain 3–5 distinct task titles. Acceptance runs AFTER invalid quotations
and ungrounded conclusions are removed. Normalization catches case/spacing and
Unicode-equivalent duplicates; it is not a semantic similarity check.

Schema parsing remains permissive of short outputs so the worker can explicitly
mark the report `template_acceptance_failed`, audit the missing fields, and end
the job. It does not fill quotas with invented material or automatically retry
the same inadequate output. The generation attempt uses the existing AI charge;
a newly requested report is a new paid attempt. Add relevant sources before
regenerating. Quotation checks prove provenance, not semantic correctness.

The UI displays scripts with their source quotations and a human-review label.
It shows actual topic counts for historical reports; existing reports are not
rewritten. No new external action or publishing bypass is introduced. Script
selection/delivery and broader draft-approval UX remain follow-up work.

Pending release gates include quantitative emotion classification, full-dataset
theme frequencies, review Top-5 ranking, execution/adoption/effect reviews,
Discord + Google Sheets connectors, and staging/live-model acceptance. Tests
here are deterministic contract/worker regressions, not full six-template V1
quality certification. No staging is available and no production testing is used.
