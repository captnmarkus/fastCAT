export const GLOBAL_STYLES_UI_PART_4 = String.raw`
    justify-content: space-between;
    gap: 0.4rem;
  }

  .fc-chat-project-name {
    font-weight: 600;
    font-size: 0.86rem;
    line-height: 1.25;
    word-break: break-word;
  }

  .fc-chat-project-meta {
    font-size: 0.73rem;
    color: var(--fc-text-muted);
  }

  .fc-chat-project-progress {
    height: 0.44rem;
  }

  .fc-chat-mobile-overlay {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.28);
    z-index: 8;
    display: flex;
    justify-content: flex-start;
  }

  .fc-chat-mobile-sidebar {
    width: min(88vw, 19rem);
    height: 100%;
    background: #ffffff;
    border-right: 1px solid rgba(15, 23, 42, 0.1);
  }

  @media (max-width: 576px) {
    .fc-project-card-metrics {
      grid-template-columns: 1fr;
    }

    .fc-dashboard-hero-actions,
    .fc-dashboard-action-buttons,
    .fc-dashboard-project-actions,
    .fc-dashboard-download-actions,
    .fc-dashboard-next-actions {
      width: 100%;
      justify-content: stretch;
    }

    .fc-dashboard-hero-actions .btn,
    .fc-dashboard-action-buttons .btn,
    .fc-dashboard-project-actions .btn,
    .fc-dashboard-download-actions .btn,
    .fc-dashboard-next-actions .btn {
      flex: 1 1 auto;
    }
  }

  @media (max-width: 992px) {
    .fc-auth-page {
      grid-template-columns: minmax(0, 1fr);
      min-height: 100vh;
    }

    .fc-auth-visual {
      min-height: 13rem;
      max-height: 32vh;
    }

    .fc-auth-panel {
      align-items: flex-start;
    }

    .fc-wizard-layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        "header"
        "steps"
        "main";
      gap: var(--fc-space-2);
    }

    .fc-stepper {
      position: static;
      grid-auto-flow: column;
      grid-auto-columns: minmax(8.8rem, 1fr);
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: thin;
      border-radius: var(--fc-radius-md);
      box-shadow: none;
      padding: 0.38rem;
      gap: 0.3rem;
    }

    .fc-stepper-item {
      min-width: 8.8rem;
      border: 1px solid transparent;
      border-radius: var(--fc-radius-md);
      padding: 0.35rem 0.45rem;
      grid-template-columns: 1.24rem minmax(0, 1fr);
      column-gap: 0.44rem;
      min-height: 2.05rem;
    }

    .fc-stepper-item::after {
      display: none;
    }

    .fc-stepper-item.is-active {
      border-color: rgba(17, 24, 39, 0.2);
      background: rgba(17, 24, 39, 0.04);
    }

    .fc-wizard-surface {
      padding: var(--fc-space-4);
    }

    .fc-wizard-footer-shell {
      padding: var(--fc-space-2) var(--fc-space-3);
    }

    .fc-table-toolbar {
      padding: var(--fc-space-12);
      flex-direction: column;
      align-items: stretch;
    }

    .fc-table-toolbar-left,
    .fc-table-toolbar-right {
      width: 100%;
      justify-content: flex-start;
    }

    .fc-details-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      border: 0;
      background: rgba(15, 23, 42, 0.28);
      z-index: 69;
    }

    .fc-details-panel {
      position: fixed !important;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(88vw, 24rem) !important;
      flex: 0 0 min(88vw, 24rem) !important;
      border-left: 1px solid var(--fc-divider);
      z-index: 70;
      box-shadow: -12px 0 28px rgba(15, 23, 42, 0.18);
    }

    .fc-details-panel.collapsed {
      width: 0 !important;
      flex: 0 0 0 !important;
      border-left: 0;
      background: transparent;
      box-shadow: none;
      overflow: visible;
    }

    .fc-details-panel.collapsed .fc-details-rail {
      position: fixed;
      top: 50%;
      right: 0.4rem;
      transform: translateY(-50%);
      padding-top: 0;
      gap: 0;
    }

    .fc-details-panel.collapsed .fc-details-rail-label {
      display: none;
    }

    .fc-search input.form-control {
      width: 100%;
      min-width: 12rem;
    }

    .fc-dashboard-hero-content {
      flex-direction: column;
    }

    .fc-dashboard-hero-image {
      object-position: 62% center;
    }

    .fc-dashboard-hero::before {
      background:
        linear-gradient(90deg, rgba(3, 7, 18, 0.92) 0%, rgba(3, 7, 18, 0.78) 58%, rgba(3, 7, 18, 0.46) 100%),
        linear-gradient(180deg, rgba(3, 7, 18, 0.28) 0%, rgba(3, 7, 18, 0.42) 100%);
    }

    .fc-dashboard-metrics {
      width: 100%;
    }

    .fc-dashboard-agent-placeholder {
      grid-template-columns: minmax(0, 1fr);
    }

    .fc-dashboard-agent-visual {
      justify-self: stretch;
      width: 100%;
      max-height: 15rem;
    }

    .fc-dashboard-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .fc-dashboard-action-item,
    .fc-dashboard-project-item,
    .fc-dashboard-download-item {
      grid-template-columns: minmax(0, 1fr);
    }

    .fc-dashboard-action-side {
      justify-self: start;
    }

    .fc-chat-shell {
      grid-template-columns: 17rem minmax(0, 1fr);
    }

    .fc-chat-shell.is-threads-collapsed {
      grid-template-columns: minmax(0, 1fr);
    }

    .fc-chat-projects-panel {
      display: none;
    }

    .fc-chat-message {
      max-width: 100%;
    }

    .fc-chat-header-toggle span {
      display: none;
    }
  }

  @media (max-width: 576px) {
    .fc-stepper {
      grid-auto-columns: minmax(7.8rem, 1fr);
    }

    .fc-stepper-item {
      min-width: 7.8rem;
      font-size: 0.76rem;
    }

    .fc-wizard-surface {
      padding: var(--fc-space-3);
    }
  }

  @media (max-width: 820px) {
    .fc-chat-shell {
      grid-template-columns: minmax(0, 1fr);
    }

    .fc-chat-sidebar {
      display: none;
    }

    .fc-chat-mobile-threads-btn {
      display: inline-flex;
    }

    .fc-chat-main-actions {
      width: 100%;
      justify-content: flex-end;
    }

    .fc-chat-header-toggle {
      height: 1.85rem;
      width: 1.85rem;
      padding: 0;
      justify-content: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .fc-stepper-item {
      transition: none;
    }
  }

`;

