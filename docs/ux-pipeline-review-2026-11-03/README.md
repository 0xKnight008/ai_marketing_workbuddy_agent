# Pipeline review UX and implementation

Approved by the user on 2026-11-03, including the collapsible left navigation revision.

## Review artifact

Open `index.html`. This is a self-contained, interactive design reference with English, Chinese and Spanish interfaces. All accounts, drafts and credits in this artifact are synthetic. It never generates paid content or publishes externally.

The preview control switches between preparation, review, results and an uncertain start response. Navigation stays on the left at all screen sizes. Desktop supports an expanded menu or icon rail; narrow screens retain a left icon rail and open the full menu as an overlay.

## Implemented behavior

- `src/workspace/PipelineWorkspace.tsx` replaces the five-step modal and cross-page handoff with preparation, inline review/approval and results on the Publish page.
- Source material and goal are retained separately in the existing workflow version JSON. Existing briefs remain readable. No SQL migration is required.
- The server's estimated credits and maximum reservation are shown before generation. The internal pricing formula is removed from confirmation interfaces; calculation and billing policy remain unchanged.
- Expired or changed budgets require another explicit confirmation. Cancellation does not activate a run. Selected models are not silently changed.
- A lost activation response offers a read-only lookup of the saved run. Reopening a pipeline uses its latest run ID, without another generation or credit confirmation.
- Reviews show exact content, destination accounts and execution usage. Approving or rejecting requires inline confirmation. Failed decisions retain the note. A requested revision rejects the old request before preparing a new draft and budget.
- A successful approval is not presented as a successful publication. Publication success is shown only after the backend run reaches `succeeded`.
- Navigation stays at the left, remembers desktop collapse preference, and supports keyboard focus trapping in the mobile overlay. Shared dialogs have unique title IDs.

## Defects corrected

The previous activation request omitted `Content-Type: application/json`. The shared quote request inherited that omission, causing live-billed requests to fail before a run existed. The new flow sends JSON explicitly; the shared budget-fetch wrapper also normalizes JSON headers.

Previously, activation replay reused the durable run but tried to bind a fresh quote. Replay now returns the original run without another quote binding, including concurrent retries and already completed runs.

## Validation

- Platform unit tests: 355 passed, one existing skip; Egg gateway: 57 passed.
- Real disposable PostgreSQL regression: 91 passed, including source/goal persistence, latest-run lookup, concurrent activation replay, credit settlement, approval and one simulated publication.
- Chromium workspace and Pipeline regression: 85 passed. Final Chromium/Firefox Pipeline and budget regression: 28 passed.
- Production build, frontend/platform type checks and 34 UI contract tests passed.
- Current Playwright WebKit does not support this workstation's macOS 13. The repository's Linux GitHub Actions workflow runs the pinned WebKit version, along with Chromium and Firefox.

All model and publication calls in tests use local fixtures. No real post or paid AI request was submitted.

## Deployment smoke test

1. Open Publish, create a draft with source material, a goal and a connected X/LinkedIn account.
2. Check the estimated credits; cancel once and verify there is no run, then confirm generation.
3. Review the exact content and destination on the same page. Approve only an intended test post, or choose Do not publish yet to verify rejection safely.
4. Refresh the page and open the saved pipeline; it should load the existing run without generating or charging again.
5. Check the actual usage receipt and backend-confirmed result. Test expanded/collapsed navigation in all three UI languages.
