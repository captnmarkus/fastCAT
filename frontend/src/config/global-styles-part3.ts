import {
  FC_APP_BG,
  FC_BLACK,
  FC_BORDER,
  FC_MUTED,
  FC_TEAL,
  FC_TEAL_DARK,
  FC_WHITE
} from "./theme-colors";

export const GLOBAL_STYLES_PART3 = `
    display: flex;
    min-height: 0;
    min-width: 0;
  }

  .fc-editor-leftbar {
    width: 260px;
    min-width: 220px;
    border-right: 1px solid rgba(17, 24, 39, 0.12);
    background: #fff;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .fc-editor-leftbar-tabs {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    background: #f9fafb;
  }

  .fc-editor-leftbar-tab {
    border: 1px solid rgba(17, 24, 39, 0.16);
    background: #fff;
    border-radius: 2px;
    padding: 4px 8px;
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(17, 24, 39, 0.76);
  }

  .fc-editor-leftbar-tab.active {
    background: var(--bs-primary);
    border-color: var(--bs-primary);
    color: #fff;
  }

  .fc-editor-leftbar-panel {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .fc-editor-leftbar-section {
    padding: 10px 8px 12px;
  }

  .fc-editor-leftbar-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .fc-editor-leftbar-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }

  .fc-editor-leftbar-item {
    width: 100%;
    text-align: left;
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: 2px;
    background: #fff;
    padding: 6px 8px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    cursor: pointer;
  }

  .fc-editor-leftbar-item:hover {
    background: #f9fafb;
  }

  .fc-editor-leftbar-item.active {
    border-color: rgba(17, 24, 39, 0.24);
    box-shadow: inset 2px 0 0 var(--bs-primary);
  }

  .fc-editor-leftbar-item:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
  }

  .fc-editor-leftbar-index {
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(17, 24, 39, 0.7);
    min-width: 24px;
    text-align: right;
  }

  .fc-editor-leftbar-text {
    font-size: 0.78rem;
    color: rgba(17, 24, 39, 0.82);
    flex: 1;
    min-width: 0;
  }

  .fc-editor-leftbar-status {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    margin-top: 6px;
    background: #e5e7eb;
    flex: 0 0 auto;
  }

  .fc-editor-leftbar-status.status-draft {
    background: #f59e0b;
  }

  .fc-editor-leftbar-status.status-under_review {
    background: #2563eb;
  }

  .fc-editor-leftbar-status.status-reviewed {
    background: #16a34a;
  }

  .fc-editor-leftbar-status.state-draft {
    background: #9ca3af;
  }

  .fc-editor-leftbar-status.state-nmt_draft {
    background: #60a5fa;
  }

  .fc-editor-leftbar-status.state-reviewed {
    background: #16a34a;
  }

  .fc-editor-vnext-grid {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .fc-editor-vnext-loadingmore {
    position: absolute;
    right: 12px;
    bottom: 10px;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(17, 24, 39, 0.12);
    padding: 4px 8px;
    border-radius: 999px;
  }

  .fc-editor-grid {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-editor-grid.is-vertical .fc-editor-grid-header,
  .fc-editor-grid.is-vertical .fc-editor-row {
    grid-template-columns: 56px minmax(280px, 1fr) 42px 42px 64px 64px 180px;
    grid-template-rows: auto auto;
    grid-template-areas:
      "num src src src src src src"
      "num tgt edited confirmed matchsrc matchpct status";
  }

  .fc-editor-grid.is-vertical .fc-col-num {
    grid-area: num;
  }

  .fc-editor-grid.is-vertical .fc-col-src {
    grid-area: src;
  }

  .fc-editor-grid.is-vertical .fc-col-tgt {
    grid-area: tgt;
  }

  .fc-editor-grid.is-vertical .fc-col-edited {
    grid-area: edited;
  }

  .fc-editor-grid.is-vertical .fc-col-confirmed {
    grid-area: confirmed;
  }

  .fc-editor-grid.is-vertical .fc-col-matchsrc {
    grid-area: matchsrc;
  }

  .fc-editor-grid.is-vertical .fc-col-matchpct {
    grid-area: matchpct;
  }

  .fc-editor-grid.is-vertical .fc-col-status {
    grid-area: status;
  }

  .fc-editor-grid-header,
  .fc-editor-row {
    display: grid;
    grid-template-columns: 56px minmax(320px, 1fr) minmax(320px, 1fr) 42px 42px 64px 64px 180px;
    align-items: stretch;
  }

  .fc-editor-grid-header {
    background: #f9fafb;
    border-bottom: 1px solid rgba(17, 24, 39, 0.12);
    font-weight: 800;
    color: rgba(17, 24, 39, 0.74);
    font-size: 0.84rem;
  }

  .fc-editor-grid-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: #fff;
  }

  .fc-editor-row {
    border-bottom: 1px solid rgba(17, 24, 39, 0.06);
    background: #fff;
  }

  .fc-editor-row:hover {
    background: #f9fafb;
  }

  .fc-editor-row.active {
    background: #f8fafc;
    box-shadow: inset 3px 0 0 var(--bs-primary);
  }

  .fc-editor-row.has-find {
    background: #fff7ed;
  }

  .fc-editor-row.has-occurrence {
    background: #fef3c7;
  }

  .fc-editor-cell {
    padding: 8px 10px;
    border-right: 1px solid rgba(17, 24, 39, 0.06);
    min-width: 0;
    overflow: hidden;
  }

  .fc-editor-grid-header .fc-editor-cell {
    padding: 10px 10px;
  }

  .fc-editor-cell:last-child {
    border-right: none;
  }

  .fc-editor-cell-preview {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .fc-editor-cell-preview.locked {
    color: rgba(17, 24, 39, 0.68);
  }

  .fc-editor-cell-input {
    width: 100%;
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 4px;
    padding: 6px 8px;
    resize: vertical;
    min-height: 34px;
    line-height: 1.35;
  }

  .fc-editor-cell-input:focus {
    outline: none;
    border-color: var(--bs-primary);
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }

  .fc-editor-placeholder-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .fc-editor-placeholder-actions .btn {
    padding: 2px 6px;
    font-size: 0.7rem;
  }

  .fc-col-num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .fc-col-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .fc-col-status {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fc-segment-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.7rem;
    font-weight: 600;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .fc-segment-pill.is-draft {
    background: #f3f4f6;
    color: #374151;
    border-color: #e5e7eb;
  }

  .fc-segment-pill.is-nmt_draft {
    background: #e0f2fe;
    color: #0369a1;
    border-color: #bae6fd;
  }

  .fc-segment-pill.is-reviewed {
    background: #dcfce7;
    color: #166534;
    border-color: #bbf7d0;
  }

  .fc-segment-issue-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 999px;
    border: 1px solid rgba(17, 24, 39, 0.12);
    background: #fff;
    padding: 2px 6px;
    font-size: 0.7rem;
  }

  .fc-segment-issue-chip:hover {
    border-color: rgba(17, 24, 39, 0.24);
    background: #f8fafc;
  }

  .fc-segment-issue-count {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .fc-ribbon-badge {
    margin-left: 6px;
    background: #f59e0b;
    color: #fff;
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: 999px;
    font-variant-numeric: tabular-nums;
  }

  .fc-issue-item {
    text-align: left;
    border: 1px solid rgba(17, 24, 39, 0.12);
    background: #fff;
    padding: 8px 10px;
    border-radius: 10px;
  }

  .fc-issue-item:hover {
    border-color: rgba(17, 24, 39, 0.22);
    background: #f8fafc;
  }

  .fc-issue-badge {
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-size: 0.6rem;
  }

  .fc-editor-sidebar {
    width: 360px;
    min-width: 320px;
    border-left: 1px solid rgba(17, 24, 39, 0.12);
    display: flex;
    min-height: 0;
    background: #fff;
  }

  .fc-editor-sidebar-icons {
    width: 46px;
    border-right: 1px solid rgba(17, 24, 39, 0.08);
    background: #f9fafb;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 6px;
    gap: 8px;
  }

  .fc-editor-sidebar-icon {
    width: 34px;
    height: 34px;
    border-radius: 6px;
    border: 1px solid rgba(17, 24, 39, 0.12);
    background: #fff;
    color: rgba(17, 24, 39, 0.76);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .fc-editor-sidebar-icon:hover {
    background: #fff;
    border-color: rgba(17, 24, 39, 0.2);
  }

  .fc-editor-sidebar-icon.active {
    background: var(--bs-primary);
    border-color: var(--bs-primary);
    color: #fff;
  }

  .fc-editor-sidebar-panel {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .fc-editor-preview {
    width: 360px;
    min-width: 280px;
    border-left: 1px solid rgba(17, 24, 39, 0.12);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #fff;
  }

  .fc-editor-preview.is-full {
    flex: 1;
    width: auto;
    min-width: 0;
    border-left: none;
  }

  .fc-editor-preview-header {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(17, 24, 39, 0.62);
    font-weight: 800;
  }

  .fc-editor-preview-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px 12px;
    display: grid;
    gap: 8px;
  }

  .fc-editor-preview-row {
    border: 1px solid rgba(17, 24, 39, 0.1);
    border-radius: 2px;
    background: #fff;
    padding: 6px 8px;
    display: flex;
    gap: 8px;
    text-align: left;
    cursor: pointer;
  }

  .fc-editor-preview-row:hover {
    background: #f9fafb;
  }

  .fc-editor-preview-row.active {
    border-color: rgba(17, 24, 39, 0.24);
    box-shadow: inset 2px 0 0 var(--bs-primary);
  }

  .fc-editor-preview-row.is-empty {
    color: rgba(17, 24, 39, 0.6);
  }

  .fc-editor-preview-row:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
  }

  .fc-editor-preview-index {
    font-size: 0.7rem;
    font-weight: 700;
    color: rgba(17, 24, 39, 0.6);
    min-width: 26px;
    text-align: right;
  }

  .fc-editor-preview-text {
    font-size: 0.82rem;
    color: rgba(17, 24, 39, 0.86);
    flex: 1;
  }

  .fc-lookups-compact .fc-lookups-compact-item {
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: 2px;
    padding: 6px 8px;
    background: #fff;
  }

  .fc-term-card {
    display: grid;
    gap: 6px;
  }

  .fc-term-source {
    font-size: 0.95rem;
  }

  .fc-term-targets {
    row-gap: 6px;
  }

  .fc-term-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    background: #fff;
    color: rgba(17, 24, 39, 0.8);
    cursor: pointer;
  }

  .fc-term-chip:hover {
    background: #f3f4f6;
  }

  .fc-term-chip.is-success {
    border-color: rgba(22, 163, 74, 0.5);
    color: #166534;
    background: rgba(22, 163, 74, 0.08);
  }

  .fc-term-chip.is-secondary {
    border-color: rgba(17, 24, 39, 0.18);
    color: rgba(17, 24, 39, 0.65);
  }

  .fc-term-chip.is-danger {
    border-color: rgba(220, 38, 38, 0.55);
    color: #991b1b;
    background: rgba(220, 38, 38, 0.08);
  }

  .fc-term-chip-badge {
    font-size: 0.6rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
  }

  .fc-term-match {
    background: rgba(250, 204, 21, 0.2);
    border-bottom: 2px solid rgba(250, 204, 21, 0.7);
    padding: 0 2px;
    border-radius: 2px;
  }

  .fc-term-match-badge {
    font-size: 0.58rem;
  }

  .fc-term-occurrence {
    margin-right: 4px;
    border: 1px solid rgba(17, 24, 39, 0.2);
    border-radius: 12px;
    padding: 0 6px;
    background: #fff;
    color: rgba(17, 24, 39, 0.8);
    font-size: 0.68rem;
    cursor: pointer;
  }

  .fc-term-occurrence:hover {
    background: #f3f4f6;
  }

  .fc-term-updated {
    border-top: 1px solid rgba(17, 24, 39, 0.08);
    padding-top: 6px;
  }

  .fc-term-illustration-thumb {
    width: 52px;
    height: 52px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid rgba(17, 24, 39, 0.12);
  }

  /* --- Termbase editor --- */
  .fc-termbase-editor {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: #fff;
  }

  .fc-termbase-header {
    border-bottom: 1px solid rgba(17, 24, 39, 0.12);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .fc-termbase-title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .fc-termbase-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .fc-termbase-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .fc-termbase-filters {
    grid-area: filters;
    padding: 10px 8px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    background: #fff;
    display: grid;
    gap: 10px;
  }

  .fc-termbase-filters-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fc-termbase-filters-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(17, 24, 39, 0.6);
  }

  .fc-termbase-filters-body {
    display: grid;
    gap: 10px;
  }

  .fc-termbase-filter-group {
    display: grid;
    gap: 6px;
  }

  .fc-termbase-filter-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .fc-termbase-filter-row > * {
    flex: 1;
  }

  .fc-termbase-filter-row .btn {
    flex: 0 0 auto;
    padding: 4px 8px;
  }

  .fc-termbase-filters-toggle {
    padding: 4px 6px;
  }

  .fc-termbase-list-grid {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: 1fr;
    grid-template-areas:
      "filters"
      "list";
    min-height: 0;
    flex: 1;
  }

  .fc-termbase-list-panel {
    grid-area: list;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .fc-termbase-active-pair {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    background: #fff;
    display: grid;
    gap: 4px;
  }

  .fc-termbase-list.is-collapsed .fc-termbase-list-grid {
    grid-template-rows: 1fr;
    grid-template-columns: 36px 1fr;
    grid-template-areas: "filters list";
  }

  .fc-termbase-filters.collapsed {
    padding: 10px 4px;
    border-bottom: none;
    border-right: 1px solid rgba(17, 24, 39, 0.08);
    align-content: start;
    justify-items: center;
  }

  .fc-termbase-filters.collapsed .fc-termbase-filters-header {
    flex-direction: column;
    gap: 6px;
  }

  .fc-termbase-filters.collapsed .fc-termbase-filters-title {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }

    .fc-termbase-body {
      display: grid;
      grid-template-columns: 340px 1fr;
      min-height: 0;
      min-width: 0;
      width: 100%;
      flex: 1;
    }

  .fc-termbase-list {
    border-right: 1px solid rgba(17, 24, 39, 0.12);
    display: flex;
    flex-direction: column;
`;
