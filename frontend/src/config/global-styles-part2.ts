import {
  FC_APP_BG,
  FC_BLACK,
  FC_BORDER,
  FC_MUTED,
  FC_TEAL,
  FC_TEAL_DARK,
  FC_WHITE
} from "./theme-colors";

export const GLOBAL_STYLES_PART2 = `
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(17, 24, 39, 0.68);
    margin-bottom: 0.35rem;
  }

  .fc-project-drawer-dl {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 0.35rem 0.75rem;
    margin: 0;
    font-size: 0.875rem;
  }

  .fc-project-drawer-dl dt {
    font-weight: 700;
    color: rgba(17, 24, 39, 0.72);
  }

  .fc-project-drawer-dl dd {
    margin: 0;
    color: var(--bs-body-color);
    overflow-wrap: anywhere;
  }

  .glossary-highlight {
    background-color: rgba(17, 24, 39, 0.08);
    border-bottom: 2px solid var(--bs-primary);
    color: var(--bs-primary);
    font-weight: 600;
    padding: 0 2px;
    border-radius: 2px;
    cursor: pointer;
  }

  .glossary-highlight:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
  }

  /* --- Editor / Workspace --- */
  .segment-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }
  .segment-row:hover {
    background-color: #f8fafc;
  }
  .segment-row-active {
    background-color: #f9fafb;
    box-shadow: inset 4px 0 0 var(--bs-primary);
  }
  .segment-meta {
    min-width: 110px;
  }
  .segment-number {
    font-weight: 700;
  }
  .segment-status-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--fc-border);
    background: #fff;
  }
  .segment-status-draft {
    color: var(--bs-primary);
    border-color: var(--fc-border);
    background: #fff;
  }
  .segment-status-under_review {
    color: #fff;
    border-color: var(--bs-primary);
    background: var(--bs-primary);
  }
  .segment-status-reviewed {
    color: #fff;
    border-color: #16a34a;
    background: #16a34a;
  }
  .segment-snippet-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fc-muted);
  }
  .segment-snippet-text {
    color: var(--bs-primary);
    line-height: 1.4;
    font-size: 0.95rem;
  }
  .segment-snippet-target {
    color: var(--bs-primary);
    font-weight: 600;
  }
  .segment-match-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--fc-border);
    background: #f3f4f6;
    color: var(--bs-primary);
  }
  .segment-match-strong {
    background: var(--bs-primary);
    border-color: var(--bs-primary);
    color: #fff;
  }
  .segment-match-fuzzy {
    background: #e5e7eb;
    border-color: #d1d5db;
    color: var(--bs-primary);
  }
  .segment-match-weak {
    background: #f3f4f6;
    border-color: var(--fc-border);
    color: var(--fc-muted);
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.8em;
    font-weight: 700;
    background: #f3f4f6;
    color: var(--bs-primary);
    border: 1px solid var(--fc-border);
    vertical-align: middle;
  }
  .tag-pill .bi {
    font-size: 0.85em;
  }

  .ws-marker {
    background: #e5e7eb;
    color: var(--bs-primary);
    border-radius: 4px;
    padding: 0 2px;
    margin: 0 1px;
    font-size: 0.75em;
  }

  .qa-flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    background: #f3f4f6;
    color: var(--bs-primary);
    border: 1px solid var(--fc-border);
  }
  .qa-flag-muted {
    background: #f9fafb;
    color: var(--fc-muted);
    border-color: var(--fc-border);
  }

  .filter-pill {
    border-radius: 999px;
    border: 1px solid var(--fc-border);
    background: #fff;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--bs-primary);
  }
  .filter-pill.active {
    background: var(--bs-primary);
    color: #fff;
    border-color: var(--bs-primary);
  }

  .fc-resizable-th {
    position: relative;
    user-select: none;
  }

  .fc-col-resize-handle {
    position: absolute;
    top: 0;
    right: -2px;
    width: 8px;
    height: 100%;
    display: block;
    cursor: col-resize;
    touch-action: none;
  }

  .fc-col-resize-handle::after {
    content: "";
    position: absolute;
    top: 0;
    right: 2px;
    width: 1px;
    height: 100%;
    background: transparent;
  }

  .fc-resizable-th:hover .fc-col-resize-handle::after {
    background: var(--fc-border);
  }

  .fc-glossary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }

  .fc-table-scroll-top {
    height: 14px;
    margin-bottom: 6px;
  }

  .fc-sticky-col {
    position: sticky;
    right: 0;
    background: var(--bs-body-bg);
    box-shadow: -1px 0 0 var(--fc-border);
  }

  .fc-sticky-col-header {
    z-index: 3;
  }

  .fc-sticky-col-cell {
    z-index: 2;
  }

  .target-wrapper {
    position: relative;
    background: #fff;
    border-radius: 0.375rem;
    border: 1px solid var(--fc-border);
  }
  .target-wrapper:focus-within {
    border-color: var(--bs-primary) !important;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }
  .target-textarea {
    position: relative;
    z-index: 2;
    background-color: transparent !important;
    resize: none;
  }

  /* --- Editor vNext (segment grid) --- */
  .fc-editor-vnext {
    height: 100vh;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bs-body-bg);
  }

  .fc-editor-topbar {
    position: sticky;
    top: 0;
    z-index: 40;
    background: #fff;
    border-bottom: 1px solid rgba(17, 24, 39, 0.12);
  }

  .fc-editor-topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    min-height: var(--fc-topbar-height);
  }

  .fc-editor-ribbon {
    position: sticky;
    top: var(--fc-topbar-height);
    z-index: 35;
    background: #fff;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-editor-ribbon-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 10px 0 10px;
  }

  .fc-editor-ribbon-tab {
    appearance: none;
    border: 1px solid transparent;
    border-bottom: none;
    background: transparent;
    padding: 8px 12px;
    font-weight: 700;
    font-size: 0.9rem;
    color: rgba(17, 24, 39, 0.8);
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
  }

  .fc-editor-ribbon-tab:hover {
    background: #f9fafb;
  }

  .fc-editor-ribbon-tab.active {
    background: #fff;
    border-color: rgba(17, 24, 39, 0.12);
    color: var(--bs-primary);
  }

  .fc-editor-ribbon-content {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 10px 14px;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .fc-editor-ribbon-group {
    border-right: 1px solid rgba(17, 24, 39, 0.08);
    padding-right: 14px;
  }

  .fc-editor-ribbon-group:last-child {
    border-right: none;
    padding-right: 0;
  }

  .fc-editor-ribbon-group-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(17, 24, 39, 0.55);
    font-weight: 800;
    margin-bottom: 6px;
  }

  .fc-editor-ribbon-home {
    display: flex;
    align-items: stretch;
    gap: 12px;
    padding: 8px 12px 10px;
    overflow: visible;
    flex-wrap: nowrap;
  }

  .fc-editor-ribbon-home .fc-editor-ribbon-group {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding-right: 12px;
    border-right: 1px solid rgba(17, 24, 39, 0.12);
    min-width: 0;
  }

  .fc-editor-ribbon-home .fc-editor-ribbon-group:last-of-type {
    border-right: none;
    padding-right: 0;
  }

  .fc-editor-ribbon-group-body {
    --fc-ribbon-row: 52px;
    --fc-ribbon-gap: 6px;
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(2, var(--fc-ribbon-row));
    grid-auto-columns: minmax(72px, auto);
    gap: var(--fc-ribbon-gap) 8px;
    align-items: stretch;
  }

  .fc-editor-ribbon-home .fc-editor-ribbon-group-title {
    margin: 0;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(17, 24, 39, 0.58);
    font-weight: 800;
    text-align: center;
  }

  .fc-ribbon-button {
    height: var(--fc-ribbon-row);
    min-width: 72px;
    padding: 4px 6px;
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 2px;
    background: #fff;
    color: var(--bs-body-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.1;
  }

  .fc-ribbon-button:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .fc-ribbon-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .fc-ribbon-button.is-pressed {
    background: #e5e7eb;
    border-color: rgba(17, 24, 39, 0.24);
  }

  .fc-ribbon-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
  }

  .fc-ribbon-button.is-large {
    grid-row: span 2;
    height: calc(var(--fc-ribbon-row) * 2 + var(--fc-ribbon-gap));
    min-width: 86px;
  }

  .fc-ribbon-button.is-menu {
    flex-direction: row;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
    height: auto;
    padding: 6px 8px;
    font-size: 0.8rem;
  }

  .fc-ribbon-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .fc-ribbon-icon svg {
    width: 20px;
    height: 20px;
  }

  .fc-ribbon-button.is-menu .fc-ribbon-label {
    text-align: left;
  }

  .fc-ribbon-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
  }

  .fc-ribbon-button.has-caret {
    position: relative;
    padding-right: 20px;
  }

  .fc-ribbon-button.has-caret .fc-ribbon-caret {
    position: absolute;
    right: 6px;
    bottom: 6px;
  }

  .fc-ribbon-split {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 2px;
    overflow: hidden;
    height: var(--fc-ribbon-row);
    background: #fff;
  }

  .fc-ribbon-split .fc-ribbon-button {
    border: 0;
    border-radius: 0;
    height: 100%;
    min-width: 70px;
  }

  .fc-ribbon-split .fc-ribbon-split-caret {
    min-width: 28px;
    padding: 0;
  }

  .fc-ribbon-input {
    grid-row: span 2;
    min-width: 120px;
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 2px;
    background: #fff;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
  }

  .fc-ribbon-input-header {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
  }

  .fc-ribbon-input-field {
    height: 30px;
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 2px;
    padding: 0 6px;
    font-size: 0.82rem;
    text-align: center;
  }

  .fc-ribbon-input-field:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
    border-color: rgba(17, 24, 39, 0.35);
  }

  .fc-ribbon-dropdown {
    position: relative;
  }

  .fc-ribbon-dropdown > summary {
    list-style: none;
    cursor: pointer;
  }

  .fc-ribbon-dropdown > summary::-webkit-details-marker {
    display: none;
  }

  .fc-ribbon-dropdown[open] > summary {
    background: #f3f4f6;
    border-color: rgba(17, 24, 39, 0.24);
  }

  .fc-ribbon-dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 230px;
    padding: 8px;
    background: #fff;
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 2px;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
    z-index: 60;
  }

  .fc-ribbon-panel {
    display: grid;
    gap: 8px;
  }

  .fc-ribbon-panel-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .fc-ribbon-panel-label {
    font-size: 0.72rem;
    font-weight: 700;
    color: rgba(17, 24, 39, 0.7);
    min-width: 52px;
  }

  .fc-ribbon-panel-input,
  .fc-ribbon-panel-select {
    height: 30px;
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 2px;
    padding: 0 6px;
    font-size: 0.82rem;
    background: #fff;
  }

  .fc-ribbon-panel-input {
    flex: 1 1 160px;
  }

  .fc-ribbon-panel-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: rgba(17, 24, 39, 0.75);
  }

  .fc-ribbon-panel-actions {
    justify-content: flex-start;
  }

  .fc-ribbon-panel-button {
    border: 1px solid rgba(17, 24, 39, 0.16);
    background: #fff;
    border-radius: 2px;
    padding: 3px 8px;
    font-size: 0.78rem;
  }

  .fc-ribbon-panel-button:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .fc-ribbon-panel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fc-ribbon-panel-input:focus-visible,
  .fc-ribbon-panel-select:focus-visible,
  .fc-ribbon-panel-button:focus-visible,
  .fc-ribbon-menu-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
  }

  .fc-ribbon-panel-meta {
    font-size: 0.75rem;
    color: rgba(17, 24, 39, 0.6);
  }

  .fc-ribbon-symbols {
    min-width: 320px;
  }

  .fc-ribbon-symbol-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .fc-ribbon-symbol-tab {
    border: 1px solid rgba(17, 24, 39, 0.16);
    background: #fff;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.72rem;
    font-weight: 700;
    color: rgba(17, 24, 39, 0.7);
  }

  .fc-ribbon-symbol-tab.active {
    background: #111827;
    border-color: #111827;
    color: #fff;
  }

  .fc-ribbon-symbol-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
    gap: 6px;
  }

  .fc-ribbon-symbol-button {
    border: 1px solid rgba(17, 24, 39, 0.16);
    background: #fff;
    border-radius: 4px;
    height: 32px;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .fc-ribbon-symbol-button:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .fc-ribbon-symbol-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fc-ribbon-symbol-button.is-space {
    font-size: 0.7rem;
    letter-spacing: 0.04em;
  }

  .fc-ribbon-symbol-tab:focus-visible,
  .fc-ribbon-symbol-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.18);
  }

  .fc-ribbon-menu-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 2px;
    padding: 6px 8px;
    font-size: 0.8rem;
    color: var(--bs-body-color);
  }

  .fc-ribbon-menu-button:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .fc-ribbon-menu-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fc-ribbon-menu-button.is-pressed {
    background: #e5e7eb;
  }

  .fc-ribbon-overflow {
    margin-left: auto;
    position: relative;
  }

  .fc-ribbon-overflow-button {
    min-width: 40px;
  }

  .fc-ribbon-overflow-menu {
    right: 0;
    left: auto;
    min-width: 220px;
  }

  .fc-ribbon-overflow-group {
    border-top: 1px solid rgba(17, 24, 39, 0.08);
    padding-top: 6px;
    margin-top: 6px;
  }

  .fc-ribbon-overflow-group:first-child {
    border-top: 0;
    padding-top: 0;
    margin-top: 0;
  }

  .fc-ribbon-overflow-title {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(17, 24, 39, 0.55);
    margin-bottom: 4px;
  }

  .fc-ribbon-overflow-items {
    display: grid;
    gap: 4px;
  }

  .fc-editor-vnext-body {
    flex: 1;
`;
