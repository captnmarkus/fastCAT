# NMT draft review workflow: triage + issues + accept clean

This workflow replaces per-segment status dropdowns with a fast triage loop driven by QA issues.

## Overview
- **NMT Draft**: default state after machine generation (LLM or MT).
- **Draft**: manual edits, unlocked segments, or other user changes.
- **Reviewed**: user-confirmed state (TMX-seeded inserts are created as Reviewed).

## Reviewer flow
1) Toggle **Review queue** to filter the grid to segments with issues.
2) Use **Next issue / Prev issue** navigation to hop between problem segments.
3) Open the **Issues** panel to see all warnings/errors and click an item to jump to the segment.
4) Click **Mark reviewed** for segments you approve.
5) Use **Accept clean drafts** to bulk-review NMT drafts with no issues (and acceptable QE scores).

## QA and issue detection
Current checks include:
- Placeholder/tag mismatch
- Empty target
- Number mismatch
- Terminology issues (forbidden or missing preferred)
- Length anomaly

The issue list is the primary driver for review. Future QA and LLM validation checks can be added without changing the UI model.

## API summary
Key endpoints used by the workflow:
- `GET /api/cat/projects/:projectId/files/:fileId/segments` (supports filters)
- `POST /api/cat/segments/recompute-issues`
- `POST /api/cat/segments/mark-reviewed`
- `POST /api/cat/segments/accept-clean-llm-drafts`
