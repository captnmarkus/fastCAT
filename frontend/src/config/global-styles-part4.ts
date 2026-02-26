import {
  FC_APP_BG,
  FC_BLACK,
  FC_BORDER,
  FC_MUTED,
  FC_TEAL,
  FC_TEAL_DARK,
  FC_WHITE
} from "./theme-colors";

export const GLOBAL_STYLES_PART4 = `
    min-height: 0;
    min-width: 0;
    background: #f9fafb;
  }

  .fc-termbase-list-search {
    padding: 8px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
    background: #fff;
  }

    .fc-termbase-list-items {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 6px;
      display: grid;
      gap: 8px;
    }

    .fc-termbase-list-item {
      border: 1px solid rgba(17, 24, 39, 0.12);
      background: #fff;
      border-radius: 2px;
      padding: 10px 12px;
      text-align: left;
    }

    .fc-termbase-list-term {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.25;
    }

  .fc-termbase-list-item:hover {
    background: #f3f4f6;
  }

  .fc-termbase-list-item.active {
    border-color: rgba(17, 24, 39, 0.3);
    box-shadow: inset 3px 0 0 var(--bs-primary);
  }

  .fc-termbase-detail {
    min-height: 0;
    min-width: 0;
    height: 100%;
    overflow: auto;
    background: #f3f4f6;
  }

  .fc-termbase-detail-body {
    padding: 16px;
    display: grid;
    gap: 16px;
    min-width: 0;
  }

  .fc-termbase-section-title {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(17, 24, 39, 0.65);
  }

  .fc-termbase-entry-fields {
    padding: 12px;
    display: grid;
    gap: 8px;
  }

  .fc-termbase-fields {
    display: grid;
    gap: 8px;
  }

  .fc-termbase-field-row {
    display: grid;
    grid-template-columns: minmax(140px, 180px) 1fr;
    gap: 8px;
    align-items: start;
  }

  .fc-termbase-field-row.is-compact {
    grid-template-columns: minmax(120px, 160px) 1fr;
  }

  .fc-termbase-field-label {
    margin: 0;
    padding-top: 6px;
  }

  .fc-termbase-field-control {
    min-width: 0;
  }

  .fc-termbase-illustration {
    padding: 6px 0 2px;
  }

  .fc-termbase-illustration-thumb {
    width: 56px;
    height: 40px;
    object-fit: cover;
    border-radius: 2px;
    border: 1px solid rgba(17, 24, 39, 0.12);
  }

  .fc-termbase-detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .fc-termbase-entry-audit {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 18px;
    margin-bottom: 10px;
  }

  .fc-termbase-language-card {
    border-radius: 2px;
    overflow: hidden;
  }

  .fc-termbase-language-header {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-termbase-language-body {
    padding: 12px;
    display: grid;
    gap: 12px;
  }

  .fc-termbase-language-fields {
    padding-bottom: 4px;
    border-bottom: 1px dashed rgba(17, 24, 39, 0.12);
  }

  .fc-termbase-term-row {
    display: grid;
    grid-template-columns: minmax(160px, 1.1fr) minmax(110px, 0.6fr) minmax(120px, 0.6fr) minmax(180px, 1.2fr) auto;
    min-width: 0;
    gap: 10px;
    align-items: start;
    padding-bottom: 10px;
    border-bottom: 1px dashed rgba(17, 24, 39, 0.12);
  }

  .fc-termbase-term-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .fc-termbase-term-row-new {
    background: #f9fafb;
    border-radius: 2px;
    padding: 10px;
    border: 1px solid rgba(17, 24, 39, 0.08);
  }

  .fc-termbase-term-field {
    min-width: 0;
  }

    .fc-termbase-term-notes textarea {
      min-height: 60px;
    }

    .fc-termbase-status {
      background: #f3f4f6;
      border-color: rgba(17, 24, 39, 0.2);
    }

  .fc-termbase-term-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    padding-top: 22px;
  }

  .fc-termbase-term-audit {
    grid-column: 1 / -1;
    margin-top: 2px;
  }

  .fc-termbase-term-custom {
    grid-column: 1 / -1;
    margin-top: 4px;
  }

    .fc-wizard-footer {
      position: sticky;
      bottom: 0;
      background: #fff;
      border-top: 1px solid rgba(17, 24, 39, 0.08);
      padding: 12px 0;
      z-index: 5;
    }

    .fc-termbase-import-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }

    .fc-termbase-import-dropzone {
      border: 2px dashed rgba(17, 24, 39, 0.16);
      border-radius: 10px;
      padding: 28px;
      background: rgba(248, 250, 252, 0.9);
      text-align: center;
      color: rgba(15, 23, 42, 0.7);
      cursor: pointer;
      transition: border-color 0.2s ease, background 0.2s ease;
    }

    .fc-termbase-import-dropzone.is-dragging {
      border-color: rgba(37, 99, 235, 0.55);
      background: rgba(37, 99, 235, 0.08);
    }

    .fc-termbase-import-tile {
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 6px;
      padding: 12px;
      background: #fff;
      display: grid;
      gap: 6px;
      min-height: 200px;
      position: relative;
      text-align: left;
    }

    .fc-termbase-import-tile.selected {
      border-color: rgba(17, 24, 39, 0.6);
      box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.25);
    }

    .fc-termbase-import-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .fc-termbase-import-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(17, 24, 39, 0.16);
      background: rgba(17, 24, 39, 0.04);
    }

    .fc-termbase-import-help {
      font-size: 12px;
      color: rgba(17, 24, 39, 0.65);
    }

    .fc-termbase-import-popover {
      position: absolute;
      right: 12px;
      bottom: 12px;
      width: 240px;
      background: #fff;
      border: 1px solid rgba(17, 24, 39, 0.16);
      border-radius: 6px;
      padding: 10px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
      display: grid;
      gap: 6px;
      z-index: 2;
    }

  @media (max-width: 992px) {
    .fc-termbase-body {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .fc-termbase-list {
      border-right: none;
      border-bottom: 1px solid rgba(17, 24, 39, 0.12);
      max-height: 260px;
    }

    .fc-termbase-term-row {
      grid-template-columns: 1fr;
    }

    .fc-termbase-term-actions {
      padding-top: 0;
      flex-direction: row;
      justify-content: flex-end;
    }
  }

`;
