export const GLOBAL_STYLES_UI_PART_2 = String.raw`
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }

  .fc-project-card-meta {
    margin-top: 0.22rem;
    font-size: 0.78rem;
    color: var(--fc-text-muted);
  }

  .fc-project-card-section {
    display: grid;
    gap: 0.38rem;
  }

  .fc-project-card-label {
    color: var(--fc-text-soft);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    line-height: 1;
  }

  .fc-project-card-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--fc-space-2);
  }

  .fc-project-card-metric {
    border: 1px solid rgba(17, 24, 39, 0.09);
    border-radius: var(--fc-radius-sm);
    background: var(--fc-bg-muted);
    padding: 0.5rem 0.58rem;
    display: grid;
    gap: 0.32rem;
    min-height: 3.3rem;
    align-content: start;
  }

  .fc-project-card-value {
    font-size: 0.82rem;
    line-height: 1.3;
    color: var(--fc-text-main);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .fc-project-card-value.is-danger {
    color: var(--fc-error-text);
  }

  .fc-project-card .fc-status-pill {
    border-radius: var(--fc-radius-pill);
    padding: 0.27rem 0.54rem;
    font-size: 0.68rem;
    letter-spacing: 0.05em;
  }

  .fc-project-card .progress {
    background-color: rgba(17, 24, 39, 0.12);
  }

  .card-enterprise,
  .fc-toolbar,
  .fc-table-toolbar,
  .fc-project-drawer,
  .fc-filter-panel,
  .fc-wizard-surface,
  .fc-wizard-footer-shell {
    border-color: var(--fc-divider) !important;
  }

  .fc-divider {
    display: block;
    background: var(--fc-divider);
    flex: 0 0 auto;
  }

  .fc-divider.is-horizontal {
    width: 100%;
    height: 1px;
  }

  .fc-divider.is-vertical {
    width: 1px;
    min-height: var(--fc-space-24);
    align-self: stretch;
  }

  .badge,
  .fc-status-pill {
    border-radius: var(--fc-radius-pill) !important;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .fc-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--fc-radius-pill);
    padding: 0.18rem 0.55rem;
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .fc-pill.is-neutral,
  .fc-pill.is-ready,
  .fc-pill.is-draft {
    color: rgba(17, 24, 39, 0.8);
    background: rgba(17, 24, 39, 0.05);
    border-color: rgba(17, 24, 39, 0.12);
  }

  .fc-pill.is-info {
    color: var(--fc-info-text);
    background: var(--fc-info-bg);
    border-color: var(--fc-info-border);
  }

  .fc-pill.is-success,
  .fc-pill.is-reviewed {
    color: var(--fc-success-text);
    background: var(--fc-success-bg);
    border-color: var(--fc-success-border);
  }

  .fc-pill.is-warning {
    color: var(--fc-warning-text);
    background: var(--fc-warning-bg);
    border-color: var(--fc-warning-border);
  }

  .fc-pill.is-danger,
  .fc-pill.is-overdue {
    color: var(--fc-error-text);
    background: var(--fc-error-bg);
    border-color: var(--fc-error-border);
  }

  .fc-status-pill.is-ready {
    color: rgba(17, 24, 39, 0.8);
    background: rgba(17, 24, 39, 0.05);
    border-color: rgba(17, 24, 39, 0.12);
  }

  .fc-status-pill.is-success {
    color: var(--fc-success-text);
    background: var(--fc-success-bg);
    border-color: var(--fc-success-border);
  }

  .fc-status-pill.is-warning {
    color: var(--fc-warning-text);
    background: var(--fc-warning-bg);
    border-color: var(--fc-warning-border);
  }

  .fc-status-pill.is-danger {
    color: var(--fc-error-text);
    background: var(--fc-error-bg);
    border-color: var(--fc-error-border);
  }

  .fc-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--fc-space-8);
    cursor: pointer;
    user-select: none;
  }

  .fc-toggle-input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    clip: rect(0 0 0 0);
    overflow: hidden;
  }

  .fc-toggle-track {
    position: relative;
    width: 2.2rem;
    height: 1.25rem;
    border-radius: var(--fc-radius-pill);
    border: 1px solid rgba(17, 24, 39, 0.28);
    background: rgba(17, 24, 39, 0.08);
    transition: background-color 120ms ease, border-color 120ms ease;
    flex: 0 0 auto;
  }

  .fc-toggle-track.is-sm {
    width: 2rem;
    height: 1.1rem;
  }

  .fc-toggle-thumb {
    position: absolute;
    top: 1px;
    left: 1px;
    width: calc(1.25rem - 4px);
    height: calc(1.25rem - 4px);
    border-radius: var(--fc-radius-pill);
    background: #fff;
    box-shadow: 0 1px 2px rgba(17, 24, 39, 0.2);
    transition: transform 120ms ease;
  }

  .fc-toggle-track.is-sm .fc-toggle-thumb {
    width: calc(1.1rem - 4px);
    height: calc(1.1rem - 4px);
  }

  .fc-toggle-input:checked + .fc-toggle-track {
    background: #111827;
    border-color: #111827;
  }

  .fc-toggle-input:checked + .fc-toggle-track .fc-toggle-thumb {
    transform: translateX(0.95rem);
  }

  .fc-toggle-track.is-sm .fc-toggle-thumb {
    transform: translateX(0);
  }

  .fc-toggle-input:checked + .fc-toggle-track.is-sm .fc-toggle-thumb {
    transform: translateX(0.86rem);
  }

  .fc-toggle-content {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .fc-toggle-label {
    font-size: 0.82rem;
    font-weight: 650;
    color: var(--fc-text-main);
    line-height: 1.2;
  }

  .fc-toggle-description {
    font-size: 0.72rem;
    color: var(--fc-text-muted);
    line-height: 1.25;
  }

  .fc-toggle-input:focus-visible + .fc-toggle-track {
    box-shadow: var(--fc-shadow-focus);
  }

  .fc-toggle-input:disabled + .fc-toggle-track {
    opacity: 0.55;
  }

  .fc-toggle-input:disabled ~ .fc-toggle-content {
    opacity: 0.65;
  }

  .fc-inline-select {
    display: inline-flex;
    align-items: center;
    gap: var(--fc-space-8);
    min-width: 0;
  }

  .fc-inline-select-value {
    min-width: 0;
  }

  .fc-inline-select-empty {
    font-size: 0.78rem;
    color: var(--fc-text-muted);
  }

  .fc-inline-select .form-select {
    min-height: 2rem;
    min-width: 13rem;
  }

  .fc-inline-select.is-invalid .fc-pill,
  .fc-inline-select.is-invalid .fc-inline-select-empty {
    color: var(--fc-error-text);
  }

  .fc-inline-select.is-invalid .fc-pill {
    border-color: var(--fc-error-border);
    background: var(--fc-error-bg);
  }

  .fc-issues-panel {
    border: 1px solid var(--fc-divider);
    border-radius: var(--fc-radius-md);
    background: rgba(255, 255, 255, 0.94);
    padding: var(--fc-space-12);
    display: grid;
    gap: var(--fc-space-8);
  }

  .fc-issues-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--fc-space-8);
  }

  .fc-issues-panel-count {
    color: var(--fc-text-soft);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .fc-issues-panel-list {
    margin: 0;
    padding-left: 1rem;
    display: grid;
    gap: 0.22rem;
  }

  .fc-issues-panel-item {
    font-size: 0.8rem;
    color: var(--fc-text-main);
  }

  .fc-table-toolbar {
    background: #fff;
    border: 1px solid var(--fc-divider);
    border-radius: var(--fc-radius-lg);
    padding: var(--fc-space-12) var(--fc-space-16);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--fc-space-12);
    flex-wrap: wrap;
  }

  .fc-table-toolbar-left,
  .fc-table-toolbar-right {
    display: flex;
    align-items: center;
    gap: var(--fc-space-8);
    flex-wrap: wrap;
  }

  .fc-density-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--fc-divider);
    border-radius: var(--fc-radius-pill);
    padding: 0.14rem;
    background: #fff;
  }

  .fc-density-toggle-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--fc-text-soft);
    padding: 0 0.35rem;
  }

  .fc-density-toggle-button {
    border: 0;
    background: transparent;
    border-radius: var(--fc-radius-pill);
    padding: 0.2rem 0.56rem;
    font-size: 0.74rem;
    font-weight: 650;
    color: var(--fc-text-main);
    line-height: 1.3;
  }

  .fc-density-toggle-button.is-active {
    background: #111827;
    color: #fff;
  }

  .fc-density-toggle-button:focus-visible {
    outline: none;
    box-shadow: var(--fc-shadow-focus);
  }

  .fc-view-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.16rem;
    border: 1px solid var(--fc-divider);
    border-radius: var(--fc-radius-pill);
    background: #fff;
    padding: 0.16rem;
  }

  .fc-view-toggle-btn {
    border: 0;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: var(--fc-radius-pill);
    background: transparent;
    color: var(--fc-text-soft);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .fc-view-toggle-btn:hover {
    color: var(--fc-text-main);
    background: rgba(17, 24, 39, 0.06);
  }

  .fc-view-toggle-btn.is-active {
    color: #fff;
    background: #111827;
  }

  .fc-view-toggle-btn:focus-visible {
    outline: none;
    box-shadow: var(--fc-shadow-focus);
  }

  .fc-details-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--fc-space-8);
    margin-bottom: var(--fc-space-12);
    padding-bottom: var(--fc-space-12);
    border-bottom: 1px solid var(--fc-divider);
  }

  .fc-details-loading {
    display: grid;
    gap: var(--fc-space-8);
  }

  .fc-details-skeleton {
    height: 0.85rem;
    border-radius: var(--fc-radius-pill);
    background: linear-gradient(90deg, rgba(17, 24, 39, 0.08), rgba(17, 24, 39, 0.18), rgba(17, 24, 39, 0.08));
    background-size: 220% 100%;
    animation: fcDetailsShimmer 1.2s linear infinite;
  }

  @keyframes fcDetailsShimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  .fc-details-rail {
    gap: 0.6rem;
  }

  .fc-details-rail-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fc-text-soft);
  }

  .fc-details-backdrop {
    display: none;
  }

  .fc-collection-viewport.is-cards .table-responsive {
    overflow: visible;
  }

  .fc-collection-viewport.is-cards table {
    border-collapse: separate;
    border-spacing: 0;
  }

  .fc-collection-viewport.is-cards thead {
    display: none;
  }

  .fc-collection-viewport.is-cards tbody {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--fc-space-12);
  }

  .fc-collection-viewport.is-cards tbody tr {
    display: grid;
    gap: 0.42rem;
    border: 1px solid var(--fc-divider);
    border-radius: var(--fc-radius-md);
    background: #fff;
    padding: var(--fc-space-12);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .fc-collection-viewport.is-cards tbody tr:hover {
    border-color: var(--fc-border-strong);
    box-shadow: var(--fc-shadow-xs);
  }

  .fc-collection-viewport.is-cards tbody tr.table-active,
  .fc-collection-viewport.is-cards tbody tr.fc-table-row.selected {
    border-color: rgba(17, 24, 39, 0.46);
    box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.32);
  }

  .fc-collection-viewport.is-cards tbody tr > td {
    display: block;
    width: 100%;
    border: 0 !important;
    padding: 0 !important;
    overflow-wrap: anywhere;
  }

  .fc-collection-viewport.is-cards tbody tr > td:last-child {
    margin-top: var(--fc-space-8);
  }

  .fc-table-row:focus-visible,
  .fc-project-card:focus-visible {
    outline: none;
    box-shadow: var(--fc-shadow-focus);
  }

  .fc-toolbar {
    border-radius: var(--fc-radius-lg);
    padding: var(--fc-space-12) var(--fc-space-16);
    border-color: var(--fc-divider);
  }

  .fc-search {
    border-color: var(--fc-divider);
    border-radius: var(--fc-radius-pill);
    padding: 0.32rem 0.62rem;
    min-height: 2.1rem;
  }

  .fc-search input.form-control {
    width: 14rem;
  }

  .fc-filter-panel,
  .fc-project-drawer {
    background: rgba(255, 255, 255, 0.94);
    box-shadow: none;
  }

  .fc-filter-header,
  .fc-project-drawer-header {
    border-bottom-color: var(--fc-divider);
    padding: var(--fc-space-8) var(--fc-space-12);
  }

  .fc-filter-body,
  .fc-project-drawer-body {
    padding: var(--fc-space-12);
    gap: var(--fc-space-12);
  }

  .fc-filter-section {
    border-color: var(--fc-divider);
    padding: var(--fc-space-12);
    gap: var(--fc-space-8);
  }

  .fc-table-row.selected,
  .table > tbody > tr.table-active > * {
    background: rgba(17, 24, 39, 0.05) !important;
  }

  .fc-table-row:hover,
  .table-hover > tbody > tr:hover > * {
    background: rgba(17, 24, 39, 0.025);
  }

  .table-light > tr > th,
  .table-light > tr > td,
  .table > thead.table-light > tr > th,
  .table > thead.table-light > tr > td {
    background: rgba(17, 24, 39, 0.02);
  }

  .accordion-item {
    border-color: var(--fc-divider);
    border-radius: var(--fc-radius-md) !important;
    overflow: hidden;
  }

  .accordion-button {
    padding: var(--fc-space-12) var(--fc-space-16);
    font-size: 0.9rem;
  }

  .accordion-button:not(.collapsed) {
    color: var(--fc-text-main);
    background: rgba(17, 24, 39, 0.03);
  }

  .accordion-body {
    padding: var(--fc-space-16);
  }

  .fc-dashboard-page {
    display: flex;
    flex-direction: column;
    gap: var(--fc-space-16);
    min-height: 100%;
    padding-bottom: var(--fc-space-24);
  }

  .fc-dashboard-hero {
    position: relative;
    overflow: hidden;
    padding: clamp(1.2rem, 1.4vw + 0.9rem, 2rem);
    border: 1px solid rgba(15, 23, 42, 0.2);
    box-shadow: 0 20px 42px rgba(15, 23, 42, 0.22);
    background:
      radial-gradient(circle at 88% 4%, rgba(251, 191, 36, 0.34), transparent 32%),
      radial-gradient(circle at 9% 88%, rgba(56, 189, 248, 0.28), transparent 36%),
      linear-gradient(130deg, #0f172a 0%, #0f766e 58%, #f59e0b 130%);
    color: #f8fafc;
  }

  .fc-dashboard-hero::before,
  .fc-dashboard-hero::after {
    content: "";
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
  }

  .fc-dashboard-hero::before {
    width: 22rem;
    height: 22rem;
    right: -8rem;
    top: -8rem;
    background: rgba(255, 255, 255, 0.1);
    filter: blur(2px);
  }

  .fc-dashboard-hero::after {
    width: 16rem;
    height: 16rem;
    left: -7rem;
    bottom: -8rem;
    background: rgba(255, 255, 255, 0.07);
  }

  .fc-dashboard-hero-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: var(--fc-space-16);
  }

  .fc-dashboard-hero-main {
    min-width: 0;
    flex: 1 1 auto;
  }

  .fc-dashboard-kicker {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.45);
    background: rgba(255, 255, 255, 0.14);
    padding: 0.22rem 0.6rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .fc-dashboard-title {
    margin: 0.58rem 0 0;
    font-size: clamp(1.25rem, 1.05rem + 1vw, 2rem);
    letter-spacing: -0.03em;
    line-height: 1.08;
  }

  .fc-dashboard-subtitle {
    margin: 0.68rem 0 0;
    max-width: 56ch;
    color: rgba(248, 250, 252, 0.85);
  }

  .fc-dashboard-hero-actions {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: var(--fc-space-16);
    flex-wrap: wrap;
  }

  .fc-dashboard-hero .btn-outline-secondary {
    border-color: rgba(255, 255, 255, 0.52);
    color: #f8fafc;
    background: rgba(15, 23, 42, 0.14);
  }

  .fc-dashboard-hero .btn-outline-secondary:hover {
    border-color: rgba(255, 255, 255, 0.72);
    background: rgba(15, 23, 42, 0.26);
    color: #fff;
  }

  .fc-dashboard-hero-note {
    margin-top: 0.72rem;
    font-size: 0.82rem;
    color: rgba(248, 250, 252, 0.78);
  }

  .fc-dashboard-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.62rem;
    width: min(23rem, 100%);
    flex: 0 0 auto;
  }

  .fc-dashboard-agent-placeholder {
    position: relative;
    overflow: hidden;
    padding: clamp(1.15rem, 1vw + 0.95rem, 1.6rem);
    border: 1px solid rgba(15, 23, 42, 0.1);
    background:
      radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 32%),
      linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(241, 245, 249, 0.98));
    box-shadow: 0 20px 36px rgba(15, 23, 42, 0.08);
  }

  .fc-dashboard-agent-placeholder::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 0.42rem;
    background: linear-gradient(180deg, #0ea5e9 0%, #14b8a6 100%);
  }

  .fc-dashboard-agent-placeholder-kicker {
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0369a1;
  }

  .fc-dashboard-agent-placeholder-title {
    margin-top: 0.48rem;
    font-size: clamp(1.05rem, 0.9rem + 0.45vw, 1.35rem);
    font-weight: 700;
    color: #0f172a;
  }

  .fc-dashboard-agent-placeholder-copy {
    margin-top: 0.56rem;
    max-width: 68ch;
    color: #334155;
  }

  .fc-dashboard-agent-placeholder-meta {
    margin-top: 0.7rem;
    font-size: 0.84rem;
    color: #475569;
  }

  .fc-dashboard-agent-placeholder-actions {
    margin-top: 1rem;
  }
`;

