export const GLOBAL_STYLES_UI_PART_3 = String.raw`

  .fc-dashboard-metric {
    border-radius: 0.72rem;
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(15, 23, 42, 0.28);
    backdrop-filter: blur(3px);
    padding: 0.72rem;
    min-width: 0;
  }

  .fc-dashboard-metric-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.78);
  }

  .fc-dashboard-metric-value {
    margin-top: 0.2rem;
    font-size: 1.28rem;
    font-weight: 780;
    letter-spacing: -0.02em;
  }

  .fc-dashboard-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--fc-space-16);
  }

  .fc-dashboard-section {
    display: flex;
    flex-direction: column;
    gap: var(--fc-space-12);
    padding: var(--fc-space-16);
  }

  .fc-dashboard-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--fc-space-8);
  }

  .fc-dashboard-section-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .fc-dashboard-search {
    min-width: min(19rem, 100%);
  }

  .fc-dashboard-search input.form-control {
    width: 100%;
    min-width: 12rem;
  }

  .fc-dashboard-action-list,
  .fc-dashboard-project-list,
  .fc-dashboard-download-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .fc-dashboard-action-item,
  .fc-dashboard-project-item,
  .fc-dashboard-download-item {
    border: 1px solid var(--fc-divider);
    border-radius: var(--fc-radius-md);
    padding: 0.72rem;
    background: rgba(255, 255, 255, 0.86);
    display: grid;
    gap: 0.62rem;
  }

  .fc-dashboard-action-item {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .fc-dashboard-action-main,
  .fc-dashboard-download-main {
    min-width: 0;
  }

  .fc-dashboard-action-title,
  .fc-dashboard-download-main h3,
  .fc-dashboard-project-top h3 {
    margin: 0;
    font-size: 0.93rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fc-dashboard-action-meta,
  .fc-dashboard-project-meta {
    font-size: 0.77rem;
    color: var(--fc-text-muted);
  }

  .fc-dashboard-action-side {
    justify-self: end;
  }

  .fc-dashboard-action-buttons,
  .fc-dashboard-project-actions,
  .fc-dashboard-download-actions,
  .fc-dashboard-next-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .fc-dashboard-action-buttons {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .fc-dashboard-next-step {
    border: 1px solid rgba(14, 116, 144, 0.22);
    background:
      radial-gradient(circle at 86% 10%, rgba(34, 197, 94, 0.1), transparent 30%),
      linear-gradient(160deg, rgba(14, 116, 144, 0.08), rgba(245, 158, 11, 0.12));
  }

  .fc-dashboard-next-content {
    display: flex;
    flex-direction: column;
    gap: 0.58rem;
  }

  .fc-dashboard-next-content h3 {
    margin: 0;
    font-size: 1.02rem;
    letter-spacing: -0.015em;
  }

  .fc-dashboard-next-content p {
    margin: 0;
    color: var(--fc-text-muted);
    max-width: 46ch;
  }

  .fc-dashboard-project-item {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .fc-dashboard-project-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .fc-dashboard-project-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.62rem;
  }

  .fc-dashboard-project-progress {
    max-width: 24rem;
  }

  .fc-dashboard-project-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 0.72rem;
  }

  .fc-dashboard-download-item {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .fc-dashboard-skeleton {
    display: grid;
    gap: 0.58rem;
  }

  .fc-dashboard-skeleton-line {
    height: 0.74rem;
    border-radius: 999px;
    background: linear-gradient(95deg, rgba(17, 24, 39, 0.08), rgba(17, 24, 39, 0.17), rgba(17, 24, 39, 0.08));
    background-size: 220% 100%;
    animation: fcDashboardShimmer 1.35s linear infinite;
  }

  @keyframes fcDashboardShimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  .fc-chat-shell {
    border: 1px solid rgba(15, 23, 42, 0.12);
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
    display: grid;
    grid-template-columns: 18rem minmax(0, 1fr) 18.5rem;
    min-height: clamp(30rem, 66vh, 46rem);
    overflow: hidden;
    position: relative;
  }

  .fc-chat-shell.is-threads-collapsed {
    grid-template-columns: 0 minmax(0, 1fr) 18.5rem;
  }

  .fc-chat-shell.is-projects-collapsed {
    grid-template-columns: 18rem minmax(0, 1fr) 0;
  }

  .fc-chat-shell.is-threads-collapsed.is-projects-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .fc-chat-shell.is-threads-collapsed .fc-chat-sidebar,
  .fc-chat-shell.is-projects-collapsed .fc-chat-projects-panel {
    display: none;
  }

  .fc-chat-sidebar {
    border-right: 1px solid rgba(15, 23, 42, 0.08);
    background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.98));
    min-width: 0;
  }

  .fc-chat-sidebar-inner {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.9rem 0.8rem;
  }

  .fc-chat-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
  }

  .fc-chat-new-thread-btn {
    border: 1px solid rgba(15, 23, 42, 0.05);
    background: rgba(15, 23, 42, 0.04);
    color: #0f172a;
    border-radius: 0.74rem;
    padding: 0.42rem 0.72rem;
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    font-size: 0.9rem;
    font-weight: 500;
    transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }

  .fc-chat-new-thread-btn i {
    font-size: 0.92rem;
    opacity: 0.86;
  }

  .fc-chat-new-thread-btn:hover:not(:disabled) {
    border-color: rgba(14, 116, 144, 0.32);
    background: #ffffff;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
    transform: translateY(-1px);
  }

  .fc-chat-new-thread-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .fc-chat-panel-collapse-btn {
    border: 0;
    background: transparent;
    color: var(--fc-text-muted);
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .fc-chat-panel-collapse-btn:hover {
    background: rgba(15, 23, 42, 0.08);
    color: #0f172a;
  }

  .fc-chat-thread-list {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 0;
  }

  .fc-chat-thread-item {
    border: 1px solid rgba(15, 23, 42, 0.1);
    background: rgba(255, 255, 255, 0.9);
    border-radius: 0.7rem;
    display: flex;
    align-items: flex-start;
    gap: 0.16rem;
    padding: 0.2rem;
    position: relative;
  }

  .fc-chat-thread-item.is-active {
    border-color: rgba(14, 116, 144, 0.45);
    background: rgba(240, 249, 255, 0.95);
  }

  .fc-chat-thread-select {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    border-radius: 0.56rem;
    text-align: left;
    padding: 0.38rem 0.44rem;
    display: grid;
    gap: 0.24rem;
  }

  .fc-chat-thread-select:hover {
    background: rgba(15, 23, 42, 0.05);
  }

  .fc-chat-thread-menu-wrap {
    position: relative;
    flex: 0 0 auto;
  }

  .fc-chat-thread-menu-toggle {
    border: 0;
    background: transparent;
    color: var(--fc-text-muted);
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .fc-chat-thread-menu-toggle:hover:not(:disabled),
  .fc-chat-thread-menu-toggle[aria-expanded="true"] {
    background: rgba(15, 23, 42, 0.08);
    color: #0f172a;
  }

  .fc-chat-thread-menu-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fc-chat-thread-menu {
    position: absolute;
    top: calc(100% + 0.26rem);
    right: 0;
    width: 10.5rem;
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 0.72rem;
    background: #ffffff;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
    padding: 0.28rem;
    z-index: 20;
  }

  .fc-chat-thread-menu-item {
    width: 100%;
    border: 0;
    background: transparent;
    border-radius: 0.52rem;
    text-align: left;
    padding: 0.46rem 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: #0f172a;
    font-size: 0.84rem;
  }

  .fc-chat-thread-menu-item:hover {
    background: rgba(15, 23, 42, 0.06);
  }

  .fc-chat-thread-menu-item.is-danger {
    color: #dc2626;
  }

  .fc-chat-thread-title {
    font-weight: 600;
    font-size: 0.88rem;
    line-height: 1.25;
    word-break: break-word;
  }

  .fc-chat-thread-meta {
    font-size: 0.73rem;
    color: var(--fc-text-muted);
  }

  .fc-chat-main {
    min-width: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background:
      radial-gradient(circle at 0 0, rgba(15, 23, 42, 0.03), transparent 34%),
      linear-gradient(180deg, rgba(248, 250, 252, 0.72), rgba(255, 255, 255, 0.98));
  }

  .fc-chat-main-header {
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    padding: 0.9rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    background: rgba(255, 255, 255, 0.94);
  }

  .fc-chat-main-kicker {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fc-text-muted);
  }

  .fc-chat-main-title {
    margin: 0.2rem 0 0;
    font-size: 1.02rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .fc-chat-main-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .fc-chat-header-toggle {
    border: 1px solid rgba(15, 23, 42, 0.14);
    background: rgba(255, 255, 255, 0.96);
    color: #0f172a;
    border-radius: 999px;
    height: 2rem;
    padding: 0 0.68rem;
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    font-size: 0.78rem;
    font-weight: 500;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .fc-chat-header-toggle:hover {
    border-color: rgba(15, 23, 42, 0.24);
    background: #ffffff;
  }

  .fc-chat-mobile-threads-btn {
    display: none;
  }

  .fc-chat-main-body {
    min-height: 0;
    overflow: auto;
    padding: 0.95rem;
  }

  .fc-chat-main-window {
    width: min(100%, 48rem);
    margin: 0 auto;
    min-height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto auto auto;
    overflow: visible;
  }

  .fc-chat-messages {
    padding: 1rem;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.62rem;
    min-height: 0;
  }

  .fc-chat-message {
    display: grid;
    gap: 0.3rem;
    border: 0;
    background: transparent;
    border-radius: 0;
    padding: 0;
    max-width: min(88%, 54rem);
  }

  .fc-chat-message.is-user {
    align-self: flex-end;
    border-radius: 1rem;
    background: rgba(15, 23, 42, 0.08);
    color: #0f172a;
    padding: 0.4rem 0.72rem;
  }

  .fc-chat-message.is-assistant {
    align-self: flex-start;
    background: transparent;
    color: #0f172a;
    padding: 0;
  }

  .fc-chat-message.is-tool {
    align-self: flex-start;
    border: 1px dashed rgba(14, 116, 144, 0.3);
    border-color: rgba(14, 116, 144, 0.3);
    background: rgba(240, 249, 255, 0.92);
    border-radius: 0.7rem;
    padding: 0.56rem 0.68rem;
  }

  .fc-chat-message-role {
    font-size: 0.67rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
    opacity: 0.72;
  }

  .fc-chat-message-text {
    font-size: 0.9rem;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .fc-chat-quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.42rem;
  }

  .fc-chat-stream-status {
    border-top: 1px solid rgba(15, 23, 42, 0.08);
    padding: 0.5rem 0.9rem;
    font-size: 0.76rem;
    color: var(--fc-text-muted);
    background: rgba(255, 255, 255, 0.88);
  }

  .fc-chat-composer {
    border-top: 0;
    background: transparent;
    padding: 0.55rem 0.75rem 0.85rem;
  }

  .fc-chat-compose-shell {
    border: 1px solid rgba(15, 23, 42, 0.14);
    border-radius: 1.45rem;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06), 0 2px 6px rgba(15, 23, 42, 0.06);
    padding: 0.12rem 0.18rem 0.3rem;
    display: grid;
    gap: 0.15rem;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .fc-chat-compose-shell:focus-within {
    border-color: rgba(37, 99, 235, 0.45);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12), 0 10px 26px rgba(15, 23, 42, 0.08);
  }

  .fc-chat-compose-shell.is-busy {
    opacity: 0.9;
  }

  .fc-chat-compose-input {
    border: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
    min-height: 3.2rem;
    resize: none;
    padding: 0.78rem 0.85rem 0.2rem;
    font-size: 1.02rem;
    line-height: 1.45;
  }

  .fc-chat-compose-input::placeholder {
    color: rgba(100, 116, 139, 0.9);
  }

  .fc-chat-compose-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.2rem 0.48rem 0.08rem;
  }

  .fc-chat-compose-left,
  .fc-chat-compose-right {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
  }

  .fc-chat-compose-iconbtn {
    border: 0;
    background: transparent;
    color: #0f172a;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.05rem;
    transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
  }

  .fc-chat-compose-iconbtn:hover:not(:disabled) {
    background: rgba(15, 23, 42, 0.07);
  }

  .fc-chat-compose-iconbtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fc-chat-compose-send {
    border: 0;
    background: #020617;
    color: #f8fafc;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    transition: transform 120ms ease, background-color 120ms ease, opacity 120ms ease;
  }

  .fc-chat-compose-send i {
    font-size: 0.95rem;
  }

  .fc-chat-compose-send:hover:not(:disabled) {
    transform: translateY(-1px);
    background: #111827;
  }

  .fc-chat-compose-send:disabled {
    background: #9ca3af;
    color: #f8fafc;
    cursor: not-allowed;
  }

  .fc-chat-projects-panel {
    border-left: 1px solid rgba(15, 23, 42, 0.08);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94));
    padding: 0.9rem 0.8rem;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0.7rem;
    min-width: 0;
  }

  .fc-chat-projects-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .fc-chat-projects-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .fc-chat-projects-header h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .fc-chat-projects-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow: auto;
    min-height: 0;
  }

  .fc-chat-project-item {
    border: 1px solid rgba(15, 23, 42, 0.1);
    background: rgba(255, 255, 255, 0.95);
    border-radius: 0.75rem;
    text-align: left;
    padding: 0.6rem 0.66rem;
    display: grid;
    gap: 0.32rem;
  }

  .fc-chat-project-top {
    display: flex;
    align-items: center;
`;

