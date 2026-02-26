export const GLOBAL_STYLES_UI_PART_1 = String.raw`

  :root {
    --fc-font-sans: "Suisse Intl", "IBM Plex Sans", "Manrope", "Segoe UI", sans-serif;
    --fc-font-mono: "JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;

    --fc-space-8: 0.5rem;
    --fc-space-12: 0.75rem;
    --fc-space-16: 1rem;
    --fc-space-24: 1.5rem;

    /* Backwards-compatible aliases while moving to 8/12/16/24 spacing */
    --fc-space-1: var(--fc-space-8);
    --fc-space-2: var(--fc-space-12);
    --fc-space-3: var(--fc-space-16);
    --fc-space-4: var(--fc-space-24);
    --fc-space-5: var(--fc-space-24);
    --fc-space-6: 2rem;
    --fc-space-7: 2.5rem;

    --fc-radius-sm: 0.4rem;
    --fc-radius-md: 0.6rem;
    --fc-radius-lg: 0.85rem;
    --fc-radius-pill: 999px;

    --fc-shadow-xs: 0 1px 2px rgba(16, 24, 40, 0.06);
    --fc-shadow-sm: 0 4px 16px rgba(16, 24, 40, 0.07);
    --fc-shadow-focus: 0 0 0 3px rgba(17, 24, 39, 0.14);

    --fc-bg-canvas: #f8f9fb;
    --fc-bg-surface: #ffffff;
    --fc-bg-muted: #f4f5f7;
    --fc-bg-muted-2: #f0f1f3;

    --fc-border-subtle: rgba(17, 24, 39, 0.08);
    --fc-border-strong: rgba(17, 24, 39, 0.2);
    --fc-divider: rgba(17, 24, 39, 0.1);
    --fc-text-main: #111827;
    --fc-text-muted: rgba(17, 24, 39, 0.68);
    --fc-text-soft: rgba(17, 24, 39, 0.52);

    --fc-success-bg: #edf8f0;
    --fc-success-border: #9bd1a8;
    --fc-success-text: #1f6d36;

    --fc-warning-bg: #fff8e8;
    --fc-warning-border: #eccf8a;
    --fc-warning-text: #805b14;

    --fc-error-bg: #fef1f2;
    --fc-error-border: #ef9aa3;
    --fc-error-text: #912d39;

    --fc-info-bg: #eff6ff;
    --fc-info-border: #93c5fd;
    --fc-info-text: #1d4ed8;

    --fc-control-height: 2.6rem;
    --fc-toolbar-height: 3.1rem;
    --fc-table-cell-py: var(--fc-space-12);
    --fc-table-cell-px: var(--fc-space-12);
    --fc-table-header-py: var(--fc-space-8);
    --fc-table-header-px: var(--fc-space-12);
  }

  body {
    font-family: var(--fc-font-sans);
    color: var(--fc-text-main);
    background: radial-gradient(circle at 0 0, #fff 0, #f8f9fb 55%);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  body.fc-density-compact {
    --fc-table-cell-py: var(--fc-space-8);
    --fc-table-cell-px: var(--fc-space-8);
    --fc-table-header-py: 0.32rem;
    --fc-table-header-px: var(--fc-space-8);
  }

  body.fc-density-comfortable {
    --fc-table-cell-py: var(--fc-space-12);
    --fc-table-cell-px: var(--fc-space-12);
    --fc-table-header-py: var(--fc-space-8);
    --fc-table-header-px: var(--fc-space-12);
  }

  code,
  pre,
  .font-monospace {
    font-family: var(--fc-font-mono) !important;
  }

  .card-enterprise {
    border-radius: var(--fc-radius-lg);
    border-color: var(--fc-border-subtle);
    box-shadow: var(--fc-shadow-xs);
    background: var(--fc-bg-surface);
  }

  .btn {
    border-radius: var(--fc-radius-md);
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  .btn-sm {
    border-radius: var(--fc-radius-sm);
  }

  /* Force CTA consistency against legacy button radius overrides. */
  .btn-primary,
  .btn-outline-primary,
  .btn-dark,
  .btn-outline-secondary,
  .btn-secondary,
  .btn-success,
  .btn-danger {
    border-radius: var(--fc-radius-md) !important;
  }

  .btn-sm.btn-primary,
  .btn-sm.btn-outline-primary,
  .btn-sm.btn-dark,
  .btn-sm.btn-outline-secondary,
  .btn-sm.btn-secondary,
  .btn-sm.btn-success,
  .btn-sm.btn-danger {
    border-radius: var(--fc-radius-sm) !important;
  }

  .btn:focus-visible,
  .form-control:focus-visible,
  .form-select:focus-visible,
  .form-check-input:focus-visible,
  .fc-filter-toggle:focus-visible,
  .fc-stepper-item:focus-visible {
    outline: none;
    box-shadow: var(--fc-shadow-focus) !important;
  }

  .form-control,
  .form-select {
    min-height: var(--fc-control-height);
    border-radius: var(--fc-radius-md);
    border-color: var(--fc-border-subtle);
    background: #fff;
  }

  .form-control.form-control-sm,
  .form-select.form-select-sm {
    min-height: 2.15rem;
  }

  textarea.form-control {
    min-height: 6.25rem;
  }

  .form-label {
    color: var(--fc-text-main);
    font-weight: 600;
    letter-spacing: -0.005em;
    margin-bottom: 0.42rem;
  }

  .form-text,
  .text-muted {
    color: var(--fc-text-muted) !important;
  }

  .table {
    --bs-table-bg: transparent;
    --bs-table-border-color: var(--fc-divider);
    margin-bottom: 0;
  }

  .table > :not(caption) > * > * {
    padding-top: var(--fc-table-cell-py);
    padding-bottom: var(--fc-table-cell-py);
    padding-left: var(--fc-table-cell-px);
    padding-right: var(--fc-table-cell-px);
    vertical-align: middle;
  }

  .table > thead > tr > th {
    border-bottom-width: 1px;
    color: var(--fc-text-soft);
    font-size: 0.76rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 700;
    background: transparent;
    padding-top: var(--fc-table-header-py);
    padding-bottom: var(--fc-table-header-py);
    padding-left: var(--fc-table-header-px);
    padding-right: var(--fc-table-header-px);
  }

  .table > tbody > tr > td {
    border-bottom-color: var(--fc-divider);
  }

  .alert {
    border-radius: var(--fc-radius-md);
    border-width: 1px;
    box-shadow: none;
  }

  .alert-danger {
    background: var(--fc-error-bg);
    border-color: var(--fc-error-border);
    color: var(--fc-error-text);
  }

  .alert-warning {
    background: var(--fc-warning-bg);
    border-color: var(--fc-warning-border);
    color: var(--fc-warning-text);
  }

  .alert-info {
    background: var(--fc-info-bg);
    border-color: var(--fc-info-border);
    color: var(--fc-info-text);
  }

  .fc-wizard-shell {
    --fc-wizard-stepper-width: 248px;
    --fc-wizard-main-max: 1080px;
    display: grid;
    gap: var(--fc-space-3);
  }

  .fc-wizard-layout {
    display: grid;
    grid-template-columns: minmax(220px, var(--fc-wizard-stepper-width)) minmax(0, var(--fc-wizard-main-max));
    grid-template-areas:
      ". header"
      "steps main";
    gap: var(--fc-space-4);
    align-items: start;
    justify-content: center;
  }

  .fc-wizard-main-header {
    grid-area: header;
    width: 100%;
    max-width: var(--fc-wizard-main-max);
  }

  .fc-wizard-steps-rail {
    grid-area: steps;
    min-width: 0;
  }

  .fc-wizard-main {
    grid-area: main;
    width: 100%;
    max-width: var(--fc-wizard-main-max);
    min-width: 0;
    display: grid;
    gap: var(--fc-space-3);
  }

  .fc-wizard-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
    column-gap: var(--fc-space-3);
    row-gap: var(--fc-space-2);
  }

  .fc-wizard-eyebrow {
    font-size: 0.73rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fc-text-soft);
    font-weight: 700;
    margin-bottom: 0.32rem;
  }

  .fc-wizard-title {
    margin: 0;
    line-height: 1.1;
    letter-spacing: -0.02em;
    font-size: clamp(1.5rem, 2.1vw, 1.9rem);
    font-weight: 700;
  }

  .fc-wizard-header-actions {
    display: inline-flex;
    justify-self: end;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--fc-space-2);
  }

  .fc-stepper {
    display: grid;
    gap: 0.2rem;
    align-content: start;
    position: sticky;
    top: var(--fc-space-2);
    padding: var(--fc-space-2);
    border: 1px solid var(--fc-border-subtle);
    border-radius: var(--fc-radius-lg);
    background: #fff;
    box-shadow: var(--fc-shadow-xs);
  }

  .fc-stepper-item {
    appearance: none;
    border: 0;
    border-radius: var(--fc-radius-sm);
    background: transparent;
    color: var(--fc-text-soft);
    min-height: 2.25rem;
    padding: 0.29rem 0.24rem;
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr);
    align-items: center;
    column-gap: 0.55rem;
    width: 100%;
    font-size: 0.8rem;
    font-weight: 560;
    text-align: left;
    position: relative;
    transition: background-color 180ms ease, color 180ms ease;
  }

  .fc-stepper-item::after {
    content: "";
    position: absolute;
    left: 0.97rem;
    top: 1.8rem;
    bottom: -0.18rem;
    width: 1px;
    background: var(--fc-divider);
  }

  .fc-stepper-item:last-child::after {
    display: none;
  }

  .fc-stepper-item:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .fc-stepper-item:not(:disabled):hover {
    background: rgba(17, 24, 39, 0.045);
  }

  .fc-stepper-item.is-active {
    color: var(--fc-text-main);
    font-weight: 650;
  }

  .fc-stepper-item.is-complete {
    color: rgba(17, 24, 39, 0.72);
  }

  .fc-stepper-index {
    width: 1.38rem;
    height: 1.38rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.68rem;
    font-weight: 700;
    border: 1px solid rgba(17, 24, 39, 0.36);
    background: #fff;
    color: rgba(17, 24, 39, 0.74);
  }

  .fc-stepper-item.is-active .fc-stepper-index {
    background: #111827;
    color: #fff;
    border-color: #111827;
  }

  .fc-stepper-item.is-complete .fc-stepper-index {
    background: #f3f4f6;
    border-color: rgba(17, 24, 39, 0.26);
    color: #111827;
  }

  .fc-stepper-label {
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .fc-wizard-surface {
    width: 100%;
    max-width: var(--fc-wizard-main-max);
    border: 1px solid var(--fc-border-subtle);
    border-radius: var(--fc-radius-lg);
    background: var(--fc-bg-surface);
    box-shadow: var(--fc-shadow-xs);
    padding: var(--fc-space-5);
  }

  .fc-wizard-surface .row {
    --bs-gutter-x: 0.95rem;
    --bs-gutter-y: 0.85rem;
  }

  .fc-wizard-surface .form-label {
    margin-bottom: 0.3rem;
  }

  .fc-wizard-surface .fc-step-header {
    margin-bottom: var(--fc-space-2);
  }

  .fc-wizard-footer-shell {
    width: 100%;
    max-width: var(--fc-wizard-main-max);
    position: sticky;
    bottom: 0;
    z-index: 8;
    border: 1px solid var(--fc-border-subtle);
    border-radius: var(--fc-radius-lg);
    background: rgba(255, 255, 255, 0.93);
    backdrop-filter: blur(6px);
    box-shadow: var(--fc-shadow-sm);
    padding: var(--fc-space-3) var(--fc-space-4);
  }

  .fc-step-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--fc-space-3);
    margin-bottom: var(--fc-space-3);
  }

  .fc-step-header-title {
    margin: 0;
    font-size: 1.08rem;
    line-height: 1.25;
    font-weight: 650;
    letter-spacing: -0.012em;
  }

  .fc-step-header-description {
    margin: 0.2rem 0 0;
    font-size: 0.85rem;
    color: var(--fc-text-muted);
  }

  .fc-step-header-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--fc-space-2);
  }

  .fc-section-card {
    border: 1px solid var(--fc-border-subtle);
    border-radius: var(--fc-radius-lg);
    background: #fff;
    overflow: hidden;
  }

  .fc-section-card-header {
    padding: var(--fc-space-4) var(--fc-space-4) var(--fc-space-3);
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--fc-space-3);
  }

  .fc-section-card-title {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.25;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .fc-section-card-description {
    margin: 0.22rem 0 0;
    color: var(--fc-text-muted);
    font-size: 0.84rem;
  }

  .fc-section-card-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--fc-space-2);
  }

  .fc-section-card-body {
    padding: var(--fc-space-4);
  }

  .fc-field-row {
    display: grid;
    gap: 0.38rem;
  }

  .fc-field-row-labelbar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--fc-space-2);
  }

  .fc-field-row-label {
    margin: 0;
    font-size: 0.79rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fc-text-soft);
    font-weight: 700;
  }

  .fc-field-required {
    color: #991b1b;
  }

  .fc-field-row-help,
  .fc-field-row-error {
    font-size: 0.78rem;
  }

  .fc-field-row-help {
    color: var(--fc-text-muted);
  }

  .fc-field-row-error {
    color: #9f1239;
  }

  .fc-empty-state {
    border: 1px dashed var(--fc-border-subtle);
    border-radius: var(--fc-radius-lg);
    background: var(--fc-bg-muted);
    padding: var(--fc-space-6);
    text-align: center;
    display: grid;
    justify-items: center;
    gap: var(--fc-space-2);
    color: var(--fc-text-muted);
  }

  .fc-empty-state > .bi {
    font-size: 1.35rem;
    color: var(--fc-text-soft);
  }

  .fc-empty-state-title {
    color: var(--fc-text-main);
    font-size: 0.92rem;
    font-weight: 620;
  }

  .fc-empty-state-description {
    font-size: 0.82rem;
    max-width: 32rem;
  }

  .fc-empty-state-action {
    margin-top: var(--fc-space-1);
  }

  .fc-warning-banner {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--fc-space-3);
    border-radius: var(--fc-radius-md);
    border: 1px solid var(--fc-warning-border);
    background: var(--fc-warning-bg);
    color: var(--fc-warning-text);
    padding: var(--fc-space-3) var(--fc-space-4);
  }

  .fc-warning-banner.is-error {
    border-color: var(--fc-error-border);
    background: var(--fc-error-bg);
    color: var(--fc-error-text);
  }

  .fc-warning-banner.is-info {
    border-color: var(--fc-info-border);
    background: var(--fc-info-bg);
    color: var(--fc-info-text);
  }

  .fc-warning-banner.is-success {
    border-color: var(--fc-success-border);
    background: var(--fc-success-bg);
    color: var(--fc-success-text);
  }

  .fc-warning-banner-icon {
    padding-top: 0.06rem;
  }

  .fc-warning-banner-title {
    font-weight: 700;
    margin-bottom: 0.2rem;
  }

  .fc-warning-banner-list {
    margin: 0;
    padding-left: 1.2rem;
  }

  .fc-filter-panel {
    background: rgba(255, 255, 255, 0.92);
    border-right: 1px solid var(--fc-border-subtle);
    backdrop-filter: blur(10px);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
  }

  .fc-filter-header {
    min-height: var(--fc-toolbar-height);
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.95);
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    display: flex;
    align-items: center;
    gap: var(--fc-space-2);
  }

  .fc-filter-header-title {
    margin-right: auto;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fc-text-soft);
  }

  .fc-filter-reset {
    color: var(--fc-text-main) !important;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .fc-filter-body {
    padding: var(--fc-space-3);
    display: grid;
    gap: var(--fc-space-3);
  }

  .fc-filter-section {
    border: 1px solid var(--fc-border-subtle);
    border-radius: var(--fc-radius-md);
    background: #fff;
    padding: var(--fc-space-3);
    display: grid;
    gap: var(--fc-space-2);
  }

  .fc-filter-section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fc-space-2);
  }

  .fc-filter-section-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fc-text-soft);
  }

  .fc-filter-section-body {
    display: grid;
    gap: var(--fc-space-2);
  }

  .fc-filter-options {
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: var(--fc-radius-sm);
    padding: 0.4rem 0.5rem;
    background: var(--fc-bg-muted);
  }

  .fc-filter-options .form-check {
    margin-bottom: 0.28rem;
  }

  .fc-filter-options .form-check:last-child {
    margin-bottom: 0;
  }

  .fc-filter-toggle {
    border-radius: var(--fc-radius-sm);
  }

  .fc-project-card-grid {
    align-items: stretch;
  }

  .fc-project-card {
    border: 1px solid var(--fc-border-subtle);
    cursor: pointer;
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .fc-project-card:hover {
    border-color: var(--fc-border-strong);
    box-shadow: var(--fc-shadow-sm);
    transform: translateY(-1px);
  }

  .fc-project-card.selected {
    border-color: rgba(17, 24, 39, 0.6);
    box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.5), var(--fc-shadow-sm);
  }

  .fc-project-card-body {
    display: grid;
    gap: var(--fc-space-3);
    padding: var(--fc-space-4);
  }

  .fc-project-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--fc-space-2);
  }

  .fc-project-card-title-wrap {
    min-width: 0;
  }

  .fc-project-card-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
`;

