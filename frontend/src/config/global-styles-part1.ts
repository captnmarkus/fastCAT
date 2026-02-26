import {
  FC_APP_BG,
  FC_BLACK,
  FC_BORDER,
  FC_MUTED,
  FC_TEAL,
  FC_TEAL_DARK,
  FC_WHITE
} from "./theme-colors";

export const GLOBAL_STYLES_PART1 = `

  :root {
    --fc-primary: ${FC_BLACK};
    --fc-primary-hover: #000000;
    --fc-topbar-bg: ${FC_WHITE};
    --fc-topbar-fg: ${FC_BLACK};
    --fc-app-bg: ${FC_APP_BG};
    --fc-topbar-height: 54px;
    --fc-adminbar-height: 44px;
    --fc-subnav-height: 44px;

    --bs-primary: var(--fc-primary);
    --bs-primary-rgb: 17, 24, 39;
    --bs-body-bg: var(--fc-app-bg);
    --bs-body-color: ${FC_BLACK};
    --bs-border-color: ${FC_BORDER};
    --fc-muted: ${FC_MUTED};
    --fc-border: ${FC_BORDER};
  }

  body {
    background: var(--bs-body-bg);
    color: var(--bs-body-color);
  }

  /* Enterprise cards */
  .card-enterprise {
    background: #fff;
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: 2px;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }

  /* Enterprise buttons */
  .btn {
    border-radius: 2px;
  }
  .btn-primary {
    background-color: var(--bs-primary) !important;
    border-color: var(--bs-primary) !important;
    color: #fff !important;
    border-radius: 2px !important;
  }
  .btn-primary:hover, .btn-primary:active, .btn-primary:focus {
    background-color: var(--fc-primary-hover) !important;
    border-color: var(--fc-primary-hover) !important;
  }

  .btn-outline-primary {
    color: var(--bs-primary) !important;
    border-color: var(--bs-primary) !important;
    border-radius: 2px !important;
  }
  .btn-outline-primary:hover {
    background-color: var(--bs-primary) !important;
    color: #fff !important;
  }

  /* Keep old classnames monochrome for backwards-compat */
  .text-gold { color: var(--bs-primary) !important; }
  .bg-gold { background-color: var(--bs-primary) !important; }
  .border-gold { border-color: var(--bs-primary) !important; }

  /* Shell (top + secondary navigation bars) */
  .fc-topbar {
    background: var(--fc-topbar-bg);
    color: var(--fc-topbar-fg);
    border-bottom: 1px solid rgba(17, 24, 39, 0.12);
    min-height: var(--fc-topbar-height);
  }

  .fc-topnav {
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: thin;
  }

  .fc-topnav-link {
    color: rgba(17, 24, 39, 0.86);
    padding: 0.52rem 0.65rem;
    border-radius: 2px;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .fc-topnav-link:hover {
    color: var(--bs-body-color);
    background: #f3f4f6;
  }
  .fc-topnav-link.active {
    color: var(--bs-primary);
    background: transparent;
    box-shadow: inset 0 -2px 0 var(--bs-primary);
  }

  .fc-role-badge {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 2px;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.45rem;
  }

  .fc-topbar-chip-button {
    width: 26px;
    height: 22px;
    padding: 0 !important;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .fc-topbar-chip-button:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }
  .fc-topbar-chip-button.active {
    background: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.38);
  }
  .fc-topbar-chip-button:focus {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.18);
  }
  .fc-topbar-chip-button .bi {
    font-size: 14px;
    line-height: 1;
  }

  .fc-adminbar {
    background: #fff;
    border-bottom: 1px solid transparent;
    overflow: hidden;
    max-height: 0;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition: max-height 160ms ease, opacity 160ms ease, transform 160ms ease;
    will-change: max-height, opacity, transform;
  }
  .fc-adminbar.open {
    max-height: var(--fc-adminbar-height);
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
    border-bottom-color: rgba(17, 24, 39, 0.08);
  }
  .fc-adminbar-nav {
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: thin;
    flex-wrap: nowrap;
    justify-content: flex-end;
    align-items: center;
  }
  .fc-adminbar-separator {
    width: 1px;
    height: 22px;
    margin: 0 0.35rem;
    background: rgba(17, 24, 39, 0.14);
    flex: 0 0 auto;
  }
  .fc-adminbar .nav-link {
    padding: 0.52rem 0.65rem;
    border-radius: 2px;
    font-weight: 600;
    font-size: 0.92rem;
    color: rgba(17, 24, 39, 0.86);
  }
  .fc-adminbar .nav-link:hover {
    background: #f3f4f6;
  }
  .fc-adminbar .nav-link.active {
    color: var(--bs-primary);
    background: transparent;
    box-shadow: inset 0 -2px 0 var(--bs-primary);
  }
  .fc-accountbar-logout {
    border: 1px solid rgba(17, 24, 39, 0.16);
    border-radius: 999px !important;
    padding: 0.34rem 0.7rem !important;
    display: inline-flex !important;
    align-items: center;
    gap: 0.4rem;
    font-weight: 700 !important;
    line-height: 1;
    background: rgba(17, 24, 39, 0.03);
    box-shadow: none !important;
  }
  .fc-accountbar-logout:hover {
    background: rgba(17, 24, 39, 0.08) !important;
    border-color: rgba(17, 24, 39, 0.24) !important;
  }
  .fc-accountbar-logout .bi {
    font-size: 14px;
    line-height: 1;
  }

  .fc-subnav {
    background: #fff;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    min-height: var(--fc-subnav-height);
    display: flex;
    align-items: center;
  }

  .fc-subnav .nav-link {
    padding: 0.52rem 0.65rem;
    border-radius: 2px;
    font-weight: 600;
    font-size: 0.92rem;
    color: rgba(17, 24, 39, 0.86);
  }
  .fc-subnav .nav {
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: thin;
    flex-wrap: nowrap;
  }
  .fc-subnav .nav-link:hover {
    background: #f3f4f6;
  }
  .fc-subnav .nav-link.active {
    color: var(--bs-primary);
    background: transparent;
    box-shadow: inset 0 -2px 0 var(--bs-primary);
  }

  .fc-icon-button {
    width: 34px;
    height: 34px;
    padding: 0 !important;
    border-radius: 999px;
    border: 1px solid var(--fc-border);
    background: #fff;
    color: var(--bs-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .fc-icon-button:hover {
    background: #f3f4f6;
    color: var(--bs-primary);
  }
  .fc-icon-button:focus {
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }
  .fc-icon-button .bi {
    font-size: 18px;
    line-height: 1;
  }

  /* Count badge (Inbox + bell) */
  .fc-count-badge {
    background: var(--bs-body-color);
    color: #fff;
    border-radius: 999px;
    font-weight: 800;
    font-size: 0.72rem;
    padding: 0.14rem 0.42rem;
    line-height: 1;
    min-width: 22px;
    text-align: center;
  }

  /* Notifications bell */
  .fc-bell-button {
    width: 34px;
    height: 34px;
    padding: 0 !important;
    border-radius: 999px;
    border: 1px solid var(--fc-border);
    background: #fff;
    color: var(--bs-body-color);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    line-height: 1;
  }
  .fc-bell-button:hover {
    background: #f3f4f6;
    color: var(--bs-body-color);
  }
  .fc-bell-button:focus {
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }
  .fc-bell-button.active {
    background: #f3f4f6;
  }
  .fc-bell-button .bi {
    font-size: 16px;
    line-height: 1;
  }

  .fc-count-badge.fc-count-badge-dot {
    position: absolute;
    top: -6px;
    right: -8px;
    padding: 0.1rem 0.38rem;
    min-width: 20px;
    border: 2px solid #fff;
  }

  .fc-bell-panel {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    width: 360px;
    max-width: min(92vw, 380px);
    z-index: 1060;
  }

  .fc-bell-panel-header {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-bell-panel-body {
    padding: 0.45rem 0.35rem;
    max-height: 320px;
    overflow: auto;
  }

  .fc-bell-panel-footer {
    padding: 0.55rem 0.75rem;
    border-top: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-bell-item {
    width: 100%;
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 2px;
    padding: 0.55rem 0.65rem;
    display: block;
    cursor: pointer;
  }
  .fc-bell-item:hover {
    background: #f3f4f6;
  }
  .fc-bell-item:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }

  .fc-bell-item-title {
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--bs-body-color);
  }
  .fc-bell-item-sub {
    font-size: 0.75rem;
    color: rgba(17, 24, 39, 0.72);
  }

  .fc-bell-status {
    background: #f9fafb;
    border: 1px solid rgba(17, 24, 39, 0.12);
    color: rgba(17, 24, 39, 0.86);
    border-radius: 2px;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    font-weight: 800;
    padding: 0.2rem 0.38rem;
    text-transform: uppercase;
    white-space: nowrap;
  }

  /* Avatar button (role ring) */
  .fc-avatar-button {
    width: 40px;
    height: 40px;
    padding: 0 !important;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .fc-avatar-button:hover {
    transform: translateY(-1px);
  }
  .fc-avatar-button:active {
    transform: scale(0.94);
  }
  .fc-avatar-button:focus {
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }

  .fc-avatar-button.role-reviewer {
    --fc-avatar-ring: #16a34a;
  }
  .fc-avatar-button.role-manager {
    --fc-avatar-ring: #2563eb;
  }
  .fc-avatar-button.role-admin {
    --fc-avatar-ring: #dc2626;
  }

  .fc-avatar-initials {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid var(--fc-avatar-ring, #9ca3af);
    background: linear-gradient(150deg, #ffffff, #f3f4f6);
    box-shadow: 0 6px 14px rgba(17, 24, 39, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.82);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    color: var(--bs-primary);
    user-select: none;
  }
  .fc-avatar-image {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid var(--fc-avatar-ring, #9ca3af);
    box-shadow: 0 6px 14px rgba(17, 24, 39, 0.16);
    background: #fff;
    object-fit: cover;
    display: block;
  }

  .fc-account-avatar-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
  }
  .fc-account-avatar-preview {
    width: 64px;
    height: 64px;
    border-radius: 999px;
    border: 2px solid rgba(17, 24, 39, 0.2);
    background: linear-gradient(160deg, #ffffff, #f3f4f6);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .fc-account-avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .fc-account-avatar-fallback {
    font-size: 1.02rem;
    font-weight: 900;
    letter-spacing: 0.03em;
    color: var(--bs-primary);
    user-select: none;
  }
  .fc-account-avatar-actions {
    min-width: min(420px, 100%);
    display: grid;
    gap: 0.45rem;
  }

  /* Admin pills */
  .nav-pills .nav-link.active {
    background-color: var(--bs-primary) !important;
    color: #fff !important;
  }
  .nav-pills .nav-link {
    color: var(--bs-primary);
  }
  .nav-pills .nav-link:hover {
    background-color: #f3f4f6;
  }

  /* List group active state (projects panel) */
  .list-group-item.active {
    background-color: var(--bs-primary) !important;
    border-color: var(--bs-primary) !important;
  }

  .fc-brand-link {
    color: var(--bs-body-color);
  }
  .fc-brand-link:hover {
    color: var(--bs-body-color);
  }

  .fastcat-brand {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    letter-spacing: -0.04em;
    font-weight: 900;
    font-size: 1.05rem;
    text-transform: none;
    line-height: 1;
    color: var(--bs-body-color);
    display: inline-flex;
    align-items: baseline;
  }
  .fastcat-brand-fast {
    font-weight: 800;
    opacity: 0.9;
  }
  .fastcat-brand-cat {
    font-weight: 950;
    letter-spacing: -0.03em;
  }

  /* --- Projects page (enterprise layout) --- */
  .fc-projects-layout {
    gap: 0;
  }

  .fc-filter-panel {
    width: 320px;
    flex: 0 0 320px;
    background: #fff;
    border-right: 1px solid rgba(17, 24, 39, 0.12);
    border-radius: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .fc-filter-panel.collapsed {
    width: 44px;
    flex: 0 0 44px;
  }

  .fc-filter-collapsed {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding-top: 0.4rem;
    gap: 0.6rem;
  }

  .fc-filter-collapsed-label {
    writing-mode: vertical-rl;
    text-orientation: upright;
    font-weight: 600;
    font-size: 0.75rem;
    color: rgba(17, 24, 39, 0.72);
    letter-spacing: 0.02em;
    user-select: none;
    margin-top: 0.25rem;
  }

  .fc-filter-expanded {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .fc-filter-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    flex: 0 0 auto;
  }

  .fc-filter-title {
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: none;
    font-size: 0.75rem;
    color: rgba(17, 24, 39, 0.78);
  }

  .fc-filter-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .fc-filter-toggle {
    width: 32px;
    height: 32px;
    padding: 0 !important;
    border-radius: 2px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(17, 24, 39, 0.72);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .fc-filter-toggle:hover {
    background: #f3f4f6;
    color: var(--bs-body-color);
  }

  .fc-filter-toggle:focus {
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
  }

  .fc-filter-toggle .bi {
    font-size: 16px;
    line-height: 1;
  }

  .fc-filter-options {
    max-height: 180px;
    overflow: auto;
    padding-right: 4px;
  }

  .fc-projects-main {
    min-height: 0;
  }

  .fc-projects-results {
    overflow: auto;
  }

  .fc-project-card {
    cursor: pointer;
    transition: box-shadow 140ms ease, background-color 140ms ease;
  }

  .fc-project-card:hover {
    box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.08);
  }

  .fc-project-card.selected {
    box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.24);
  }

  .fc-toolbar-title {
    font-weight: 900;
    letter-spacing: -0.02em;
    color: var(--bs-body-color);
  }

  .fc-toolbar {
    background: #fff;
    border: 1px solid rgba(17, 24, 39, 0.12);
    border-radius: 2px;
    padding: 0.6rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .fc-projects-toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
  }

  .fc-search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 2px;
    padding: 0.25rem 0.5rem;
    background: #fff;
  }

  .fc-search .bi {
    color: rgba(17, 24, 39, 0.55);
    font-size: 14px;
    line-height: 1;
  }

  .fc-search input.form-control {
    border: 0;
    padding: 0;
    background: transparent;
    box-shadow: none !important;
    width: 240px;
  }

  .fc-search input.form-control:focus {
    box-shadow: none !important;
  }

  .fc-table-compact {
    font-size: 0.875rem;
  }

  .fc-output-menu summary {
    list-style: none;
    cursor: pointer;
  }

  .fc-output-menu summary::-webkit-details-marker {
    display: none;
  }

  .fc-output-menu-list {
    margin-top: 6px;
    display: grid;
    gap: 4px;
  }

  .fc-file-subrow td {
    background: #f9fafb;
  }

  .fc-file-subtable {
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: 2px;
    background: #fff;
    padding: 8px;
  }

  .fc-project-info-summary {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    font-weight: 700;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(17, 24, 39, 0.68);
    cursor: pointer;
    list-style: none;
  }

  .fc-project-info-summary::-webkit-details-marker {
    display: none;
  }

  .fc-project-description summary {
    cursor: pointer;
  }

  .fc-table-sort {
    color: rgba(17, 24, 39, 0.82);
    font-weight: 700;
  }

  .fc-table-sort:hover {
    color: var(--bs-body-color);
  }

  .fc-table-sort:focus {
    box-shadow: none;
  }

  .fc-table-row {
    cursor: pointer;
  }

  .fc-table-row.selected {
    background: #f3f4f6;
  }

  .fc-table-row:hover {
    background: #f9fafb;
  }

  .fc-status-pill {
    border-radius: 2px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 0.35rem 0.5rem;
    font-size: 0.72rem;
  }

  .fc-project-drawer {
    width: 340px;
    flex: 0 0 340px;
    background: #fff;
    border-left: 1px solid rgba(17, 24, 39, 0.12);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .fc-project-drawer.collapsed {
    width: 44px;
    flex: 0 0 44px;
  }

  .fc-project-drawer-collapsed {
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 0.4rem;
  }

  .fc-project-drawer-inner {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .fc-project-drawer-header {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    flex: 0 0 auto;
  }

  .fc-project-drawer-title {
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 0.7rem;
    color: rgba(17, 24, 39, 0.78);
  }

  .fc-project-drawer-body {
    padding: 0.75rem;
    overflow: auto;
    min-height: 0;
  }

  .fc-project-drawer-section {
    padding-top: 0.85rem;
    border-top: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-project-drawer-section-title {
`;
