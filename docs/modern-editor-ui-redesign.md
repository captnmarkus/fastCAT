# FastCAT Modern Editor (Beta) - Technical Design

## 1) Scope and goals
- Replace the ribbon-heavy shell with a compact, keyboard-first editor.
- Keep FastCAT visual direction: clean black/white UI with subtle accents.
- Reuse existing backend capabilities (TM/TMX, termbase, MT/LLM, QA/QE) without mocks.
- Ship behind feature flag: **Modern UI (beta)**, retain **Classic** fallback.

## 2) High-level component architecture
- `EditorFilePage.tsx`
  - Runtime switch:
    - `ModernEditorFilePage` when feature flag/`?ui=modern`
    - `ClassicEditorFilePage` otherwise
- `ModernEditorFilePage.tsx`
  - **Top bar + search/nav/filter strip**
  - **Virtualized segment list** (`ModernSegmentList`)
  - **Inspector sidebar** (Suggestions, Concordance, QA/Issues)
  - **Bottom panel** (History, QA check, Segment comments, Document comments, Preview)
  - **Preview pane** (`ModernPreviewPane`) with segment mapping + sync
  - **Find/Replace modal** (`Ctrl+F`, `Ctrl+H`)
- Styling
  - `frontend/src/routes/editor/file/modern-editor.css`

## 3) State model
- Core editing/data state remains centralized in:
  - `useEditorFile` (segments, drafts, save queue, TM/TB/MT lookups, QA, actions)
- Modern UI local state:
  - Layout/view prefs (right sidebar, bottom panel, preview mode, density, whitespace/tags)
  - Search/filter state
  - Inspector tab + bottom tab
  - Multi-select/bulk action state
  - Find/replace modal state
  - Segment history data
  - TM concordance query/results

## 4) API/backend wiring
- Existing (reused):
  - Segment updates/save queue, mark reviewed, lock/unlock, recompute QA, complete task
  - Termbase concordance for focused segment and manual search
  - TM lookup per segment (`searchTM`)
  - MT/LLM generation per segment (`/segments/:id/llm`)
- Added/extended:
  - `GET /segments/:id/history` (cat-api)
  - `GET /api/tm/:tmId/concordance` (tm-proxy)
  - Frontend APIs:
    - `getSegmentHistory`
    - `searchTMConcordance`
    - abort-signal support for termbase concordance and segment LLM request

## 5) Caching and request strategy
- In `useEditorFile`:
  - TM hints cache with TTL refresh
  - Termbase concordance cache + debounced fetch + abort of in-flight lookup on segment switch
  - MT suggestion cache per segment with TTL + in-flight dedupe
- In modern UI:
  - TM concordance cache keyed by `tmId + langs + mode + query` with TTL
  - Debounced concordance search to avoid request storms

## 6) Suggestion logic
- Per segment actions:
  - Insert best
  - Generate MT/LLM
  - Mark reviewed/unreview
  - Lock/unlock
- Deterministic Insert Best ranking:
  - Prefer terminology/TM above raw MT when thresholds are met
  - Fallback to MT or TM based on available matches
  - Implemented in `useEditorFile.applyBestSuggestionToSegment`

## 7) Preview design
- Real content preview based on live segment content (target draft with source fallback).
- Segment mapping:
  - Segment id -> preview node ref
- Sync:
  - Editor segment selection scrolls preview to active block
  - Preview scroll heuristics update active segment (best effort)
  - Clicking preview block jumps to editor segment
- Modes:
  - `split` (segments + preview in bottom panel)
  - `side` (segments left, preview right)

## 8) Keyboard and accessibility
- Shortcuts:
  - `Alt+Up/Down`: prev/next segment
  - `Ctrl+Enter`: insert best
  - `Ctrl+Shift+R`: mark reviewed
  - `Ctrl+F`: find
  - `Ctrl+H`: replace
  - `Ctrl+Shift+C`: focus concordance
- Accessibility:
  - `aria-label` on icon-only actions
  - Keyboard activation for preview blocks
  - Focus-preserving modal behavior

## 9) Migration and rollout plan
- Feature flag:
  - LocalStorage: `fc:editor:modern-ui-beta`
  - URL override: `?ui=modern|classic`
- Safe rollout:
  1. Default to Classic
  2. Enable Modern for internal users
  3. Compare telemetry/bug rate/perf
  4. Expand audience
  5. Flip default when stable

---

# Task breakdown (tickets)

1. `FCAT-EDIT-001` Feature flag shell and classic fallback
   - Status: Done
   - Files: `frontend/src/routes/editor/file/EditorFilePage.tsx`, `frontend/src/routes/editor/file/ClassicEditorFilePage.tsx`

2. `FCAT-EDIT-002` Modern layout shell and responsive structure
   - Status: Done
   - Files: `frontend/src/routes/editor/file/ModernEditorFilePage.tsx`, `frontend/src/routes/editor/file/modern-editor.css`

3. `FCAT-EDIT-003` Virtualized segment list modernization with per-row quick actions
   - Status: Done
   - Notes: multi-select + bulk actions included

4. `FCAT-EDIT-004` Suggestions inspector wiring (TB/TM/MT + insert/copy/compare)
   - Status: Done

5. `FCAT-EDIT-005` Concordance tab (TM/TMX + termbase)
   - Status: Done
   - Added backend route in tm-proxy and frontend API integration

6. `FCAT-EDIT-006` QA/Issues panel + recompute action wiring
   - Status: Done

7. `FCAT-EDIT-007` Bottom panel tabs and segment history integration
   - Status: Done
   - Notes: comments tabs are present; backend comments API not yet available in current codebase

8. `FCAT-EDIT-008` Real preview with segment highlight + scroll sync + reverse jump
   - Status: Done (Phase 1)
   - Notes: richer formatting fidelity can be a follow-up

9. `FCAT-EDIT-009` Keyboard parity and view preference persistence
   - Status: Done

10. `FCAT-EDIT-010` Backend support additions
    - Status: Done
    - Files:
      - `cat-api/src/routes/segments.ts` (`/segments/:id/history`)
      - `tm-proxy/src/routes/tm-routes.ts` (`/api/tm/:tmId/concordance`)
      - `tm-proxy/src/t5memory.ts` (concordance query)
      - `frontend/src/api/resources-editor.ts`, `frontend/src/api/tm.ts`
