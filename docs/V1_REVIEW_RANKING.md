# Review priority ranking

New review reports select up to five distinct complaint themes AFTER quotation
verification. Order: model-assessed severity (critical, high, medium, low), then
distinct cited-source count descending, then normalized theme text. Exact
case/spacing/Unicode-equivalent duplicate themes are collapsed; semantic cluster
merging remains out of scope. Sparse inputs are never padded to five issues.

Affected SKU labels and priority-fix SKU fields must match metadata on a source
actually quoted by that conclusion. Unknown or uncited model-supplied SKU values
are removed. Missing SKU metadata does not justify guessing.

Dashboard and approved digests explicitly distinguish this priority list from
sales-impact ranking and full-population theme frequency. Severity is still a
model judgment; verbatim evidence validation alone cannot certify it. Existing
reports are unchanged. No migration or production action is required.

Pending: verified full-data topic clustering/counts, sales-impact data/ranking,
execution feedback and weekly adoption/effect review, selected-draft delivery,
Discord + Google Sheets connectors, and staging/live-model acceptance. This
bounded improvement does not complete the V1 release gate.
