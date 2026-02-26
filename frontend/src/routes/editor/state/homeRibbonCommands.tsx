import React from "react";
import type { Segment } from "../../../api";
import type { SegmentStatus } from "../../../types/app";
import { SEGMENT_STATUS_LABEL } from "../../../utils/segmentStatus";

const ICON_STROKE = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round"
} as const;

function RibbonIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="img">
      {children}
    </svg>
  );
}

export const RIBBON_ICONS = {
  undo: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M9 7H4v5" />
        <path d="M4 12l4-4" />
        <path d="M9 7c5 0 8 2.5 8 6" />
      </g>
    </RibbonIcon>
  ),
  redo: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M15 7h5v5" />
        <path d="M20 12l-4-4" />
        <path d="M15 7c-5 0-8 2.5-8 6" />
      </g>
    </RibbonIcon>
  ),
  paste: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="6" y="5" width="12" height="15" rx="2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 11h6" />
        <path d="M9 15h6" />
      </g>
    </RibbonIcon>
  ),
  cut: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="7" cy="17" r="2" />
        <circle cx="11" cy="17" r="2" />
        <path d="M7 15L19 3" />
        <path d="M11 15l6-6" />
      </g>
    </RibbonIcon>
  ),
  copy: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <rect x="5" y="5" width="11" height="11" rx="2" />
      </g>
    </RibbonIcon>
  ),
  clearFormatting: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 6h12" />
        <path d="M4 10h8" />
        <path d="M4 14h10" />
        <path d="M16 14l4 4" />
        <path d="M20 14l-4 4" />
      </g>
    </RibbonIcon>
  ),
  bold: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M7 5h5a3 3 0 0 1 0 6H7z" />
        <path d="M7 11h5a3 3 0 0 1 0 6H7z" />
        <path d="M7 5v12" />
      </g>
    </RibbonIcon>
  ),
  underline: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M7 5v6a3 3 0 0 0 6 0V5" />
        <path d="M5 19h10" />
      </g>
    </RibbonIcon>
  ),
  fontSmaller: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M6 7h6" />
        <path d="M9 7v7" />
        <path d="M6 14h6" />
        <path d="M18 10v6" />
        <path d="M15 13l3 3 3-3" />
      </g>
    </RibbonIcon>
  ),
  fontBigger: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M6 7h6" />
        <path d="M9 7v7" />
        <path d="M6 14h6" />
        <path d="M18 16V10" />
        <path d="M21 13l-3-3-3 3" />
      </g>
    </RibbonIcon>
  ),
  applyFormatting: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M5 18h9" />
        <path d="M14 4l5 5-6 6-5-5z" />
        <path d="M9 13l-3 3" />
      </g>
    </RibbonIcon>
  ),
  whitespace: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 12h16" />
        <circle cx="7" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
      </g>
    </RibbonIcon>
  ),
  changeCase: (
    <RibbonIcon>
      <g fill="currentColor">
        <text x="4" y="10" fontSize="8" fontFamily="Arial, sans-serif">
          A
        </text>
        <text x="12" y="18" fontSize="8" fontFamily="Arial, sans-serif">
          a
        </text>
      </g>
      <g {...ICON_STROKE} fill="none">
        <path d="M10 6h6" />
        <path d="M16 6l2 2" />
        <path d="M16 6l2-2" />
      </g>
    </RibbonIcon>
  ),
  symbols: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M12 4l2.4 4.8 5.3.7-3.8 3.7.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.8-3.7 5.3-.7z" />
      </g>
    </RibbonIcon>
  ),
  translation: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 7h8" />
        <path d="M8 7l-2 3" />
        <path d="M6 10l2 3" />
        <path d="M12 17h8" />
        <path d="M16 17l2-3" />
        <path d="M18 14l-2-3" />
        <path d="M4 12h16" />
      </g>
    </RibbonIcon>
  ),
  confirm: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M6 12l4 4 8-9" />
      </g>
    </RibbonIcon>
  ),
  confirmNext: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M5 12l3 3 6-7" />
        <path d="M14 12h5" />
        <path d="M17 9l2 3-2 3" />
      </g>
    </RibbonIcon>
  ),
  copySource: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="3" y="5" width="7" height="14" rx="1" />
        <rect x="14" y="5" width="7" height="14" rx="1" />
        <path d="M10 12h4" />
        <path d="M12 10l2 2-2 2" />
      </g>
    </RibbonIcon>
  ),
  clearTarget: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M8 8l8 8" />
        <path d="M16 8l-8 8" />
      </g>
    </RibbonIcon>
  ),
  lock: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="6" y="11" width="12" height="8" rx="2" />
        <path d="M9 11V8a3 3 0 0 1 6 0v3" />
      </g>
    </RibbonIcon>
  ),
  status: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="6" cy="7" r="1.5" />
        <circle cx="6" cy="12" r="1.5" />
        <circle cx="6" cy="17" r="1.5" />
        <path d="M10 7h10" />
        <path d="M10 12h10" />
        <path d="M10 17h10" />
      </g>
    </RibbonIcon>
  ),
  moreActions: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 7h6" />
        <path d="M14 7h6" />
        <circle cx="12" cy="7" r="1.5" />
        <path d="M4 12h10" />
        <circle cx="16" cy="12" r="1.5" />
        <path d="M4 17h8" />
        <path d="M16 17h4" />
        <circle cx="14" cy="17" r="1.5" />
      </g>
    </RibbonIcon>
  ),
  goTo: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="12" cy="12" r="7" />
        <path d="M12 9v6" />
        <path d="M9 12h6" />
      </g>
    </RibbonIcon>
  ),
  previous: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M12 6l-5 6 5 6" />
        <path d="M18 6l-5 6 5 6" />
      </g>
    </RibbonIcon>
  ),
  next: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M12 6l5 6-5 6" />
        <path d="M6 6l5 6-5 6" />
      </g>
    </RibbonIcon>
  ),
  find: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="11" cy="11" r="5" />
        <path d="M16 16l4 4" />
      </g>
    </RibbonIcon>
  ),
  replace: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M6 8h8" />
        <path d="M12 5l3 3-3 3" />
        <path d="M18 16H10" />
        <path d="M12 19l-3-3 3-3" />
      </g>
    </RibbonIcon>
  ),
  caret: (
    <RibbonIcon>
      <path d="M7 10l5 5 5-5" fill="currentColor" />
    </RibbonIcon>
  ),
  overflow: (
    <RibbonIcon>
      <g fill="currentColor">
        <circle cx="6" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="18" cy="12" r="1.5" />
      </g>
    </RibbonIcon>
  ),
  layoutVertical: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="5" y="4" width="14" height="6" rx="1" />
        <rect x="5" y="14" width="14" height="6" rx="1" />
      </g>
    </RibbonIcon>
  ),
  layoutHorizontal: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="4" y="5" width="7" height="14" rx="1" />
        <rect x="13" y="5" width="7" height="14" rx="1" />
      </g>
    </RibbonIcon>
  ),
  navigationPane: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 6h9" />
        <path d="M4 12h9" />
        <path d="M4 18h6" />
        <path d="M15 8l4 4-4 4" />
      </g>
    </RibbonIcon>
  ),
  documentStructure: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
        <path d="M10 7h4" />
        <path d="M12 7v7" />
        <path d="M12 14h2" />
      </g>
    </RibbonIcon>
  ),
  textZoom: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="10" cy="10" r="4" />
        <path d="M13 13l4 4" />
        <path d="M8 10h4" />
        <path d="M10 8v4" />
      </g>
    </RibbonIcon>
  ),
  tags: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 12l6-6h8l2 2v8l-6 6H6l-2-2z" />
        <circle cx="14" cy="8" r="1.5" />
      </g>
    </RibbonIcon>
  ),
  tagDetails: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 12l6-6h8l2 2v8l-6 6H6l-2-2z" />
        <path d="M10 12h6" />
        <path d="M10 15h4" />
      </g>
    </RibbonIcon>
  ),
  filterLookups: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M4 6h16l-6 7v5l-4 2v-7z" />
      </g>
    </RibbonIcon>
  ),
  alternativeView: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <rect x="4" y="5" width="16" height="14" rx="1" />
        <path d="M12 5v14" />
        <path d="M7 9h3" />
        <path d="M7 13h3" />
      </g>
    </RibbonIcon>
  ),
  themeLight: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="M5.5 5.5l2 2" />
        <path d="M16.5 16.5l2 2" />
        <path d="M5.5 18.5l2-2" />
        <path d="M16.5 7.5l2-2" />
      </g>
    </RibbonIcon>
  ),
  preview: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <path d="M2 12s4-5 10-5 10 5 10 5-4 5-10 5-10-5-10-5z" />
        <circle cx="12" cy="12" r="2" />
      </g>
    </RibbonIcon>
  ),
  settings: (
    <RibbonIcon>
      <g {...ICON_STROKE} fill="none">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 4v2" />
        <path d="M12 18v2" />
        <path d="M4 12h2" />
        <path d="M18 12h2" />
        <path d="M6.5 6.5l1.4 1.4" />
        <path d="M16.1 16.1l1.4 1.4" />
        <path d="M6.5 17.5l1.4-1.4" />
        <path d="M16.1 7.9l1.4-1.4" />
      </g>
    </RibbonIcon>
  )
} as const;

export type HomeRibbonCommandState = {
  hasActive: boolean;
  activeStatus: SegmentStatus;
  activeLocked: boolean;
  isEditable: boolean;
  hasSelection: boolean;
  targetFocused: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  clipboardWriteAvailable: boolean;
  clipboardReadAvailable: boolean;
  showWhitespace: boolean;
  pasteHint: string | null;
};

export type HomeRibbonCommandContext = {
  active: Segment | undefined;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  bold: () => void;
  underline: () => void;
  fontSmaller: () => void;
  fontBigger: () => void;
  clearFormatting: () => void;
  changeCase: (mode: "upper" | "lower" | "title") => void;
  toggleWhitespace: () => void;
  applyTranslation: () => void;
  confirm: () => void;
  confirmNext: () => void;
  copySource: () => void;
  clearTarget: () => void;
  toggleLock: () => void;
  goPrev: () => void;
  goNext: () => void;
  focusTarget: () => void;
  noop: () => void;
};

export type HomeRibbonCommand = {
  id: string;
  label: string;
  icon: React.ReactNode;
  implemented: boolean;
  enabled: (state: HomeRibbonCommandState) => boolean;
  run: (ctx: HomeRibbonCommandContext) => void;
  toggle?: boolean;
  pressed?: (state: HomeRibbonCommandState) => boolean;
  tooltip?: (state: HomeRibbonCommandState) => string;
};

export const HOME_RIBBON_COMMANDS: Record<string, HomeRibbonCommand> = {
  undo: {
    id: "undo",
    label: "Undo",
    icon: RIBBON_ICONS.undo,
    implemented: true,
    enabled: (state) => state.hasActive && state.canUndo,
    run: (ctx) => ctx.undo()
  },
  redo: {
    id: "redo",
    label: "Redo",
    icon: RIBBON_ICONS.redo,
    implemented: true,
    enabled: (state) => state.hasActive && state.canRedo,
    run: (ctx) => ctx.redo()
  },
  paste: {
    id: "paste",
    label: "Paste",
    icon: RIBBON_ICONS.paste,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable && state.clipboardReadAvailable,
    run: (ctx) => ctx.paste(),
    tooltip: (state) =>
      state.clipboardReadAvailable
        ? state.pasteHint || "Paste"
        : "Clipboard unavailable. Use Ctrl+V/Cmd+V."
  },
  cut: {
    id: "cut",
    label: "Cut",
    icon: RIBBON_ICONS.cut,
    implemented: true,
    enabled: (state) =>
      state.hasActive &&
      state.isEditable &&
      state.clipboardWriteAvailable &&
      state.targetFocused &&
      state.hasSelection,
    run: (ctx) => ctx.cut()
  },
  copy: {
    id: "copy",
    label: "Copy",
    icon: RIBBON_ICONS.copy,
    implemented: true,
    enabled: (state) =>
      state.hasActive &&
      state.clipboardWriteAvailable &&
      state.targetFocused &&
      state.hasSelection,
    run: (ctx) => ctx.copy()
  },
  clearFormatting: {
    id: "clearFormatting",
    label: "Clear Formatting",
    icon: RIBBON_ICONS.clearFormatting,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.clearFormatting()
  },
  bold: {
    id: "bold",
    label: "Bold",
    icon: RIBBON_ICONS.bold,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable && state.targetFocused,
    run: (ctx) => ctx.bold()
  },
  underline: {
    id: "underline",
    label: "Underline",
    icon: RIBBON_ICONS.underline,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable && state.targetFocused,
    run: (ctx) => ctx.underline()
  },
  fontSmaller: {
    id: "fontSmaller",
    label: "Font Smaller",
    icon: RIBBON_ICONS.fontSmaller,
    implemented: true,
    enabled: () => false,
    run: (ctx) => ctx.fontSmaller(),
    tooltip: () => "Formatting not supported for this file type/segment."
  },
  fontBigger: {
    id: "fontBigger",
    label: "Font Bigger",
    icon: RIBBON_ICONS.fontBigger,
    implemented: true,
    enabled: () => false,
    run: (ctx) => ctx.fontBigger(),
    tooltip: () => "Formatting not supported for this file type/segment."
  },
  applyFormatting: {
    id: "applyFormatting",
    label: "Apply Formatting",
    icon: RIBBON_ICONS.applyFormatting,
    implemented: false,
    enabled: () => false,
    run: (ctx) => ctx.noop()
  },
  showWhitespace: {
    id: "showWhitespace",
    label: "Show Whitespaces",
    icon: RIBBON_ICONS.whitespace,
    implemented: true,
    enabled: () => true,
    run: (ctx) => ctx.toggleWhitespace(),
    toggle: true,
    pressed: (state) => state.showWhitespace
  },
  changeCase: {
    id: "changeCase",
    label: "Change Case",
    icon: RIBBON_ICONS.changeCase,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.focusTarget()
  },
  changeCaseUpper: {
    id: "changeCaseUpper",
    label: "UPPERCASE",
    icon: RIBBON_ICONS.changeCase,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.changeCase("upper")
  },
  changeCaseLower: {
    id: "changeCaseLower",
    label: "lowercase",
    icon: RIBBON_ICONS.changeCase,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.changeCase("lower")
  },
  changeCaseTitle: {
    id: "changeCaseTitle",
    label: "Title Case",
    icon: RIBBON_ICONS.changeCase,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.changeCase("title")
  },
  insertSymbols: {
    id: "insertSymbols",
    label: "Insert Symbols",
    icon: RIBBON_ICONS.symbols,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.focusTarget()
  },
  applyTranslation: {
    id: "applyTranslation",
    label: "Apply Translation",
    icon: RIBBON_ICONS.translation,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.applyTranslation()
  },
  confirm: {
    id: "confirm",
    label: "Confirm",
    icon: RIBBON_ICONS.confirm,
    implemented: true,
    enabled: (state) => state.hasActive && state.activeStatus !== "reviewed",
    run: (ctx) => ctx.confirm()
  },
  confirmNext: {
    id: "confirmNext",
    label: "Confirm + Next",
    icon: RIBBON_ICONS.confirmNext,
    implemented: true,
    enabled: (state) => state.hasActive && state.activeStatus !== "reviewed",
    run: (ctx) => ctx.confirmNext()
  },
  copySource: {
    id: "copySource",
    label: "Copy Source",
    icon: RIBBON_ICONS.copySource,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.copySource()
  },
  copySourceOptions: {
    id: "copySourceOptions",
    label: "Copy Source options",
    icon: RIBBON_ICONS.caret,
    implemented: false,
    enabled: () => false,
    run: (ctx) => ctx.noop()
  },
  clearTarget: {
    id: "clearTarget",
    label: "Clear Target",
    icon: RIBBON_ICONS.clearTarget,
    implemented: true,
    enabled: (state) => state.hasActive && state.isEditable,
    run: (ctx) => ctx.clearTarget()
  },
  lockUnlock: {
    id: "lockUnlock",
    label: "Lock / Unlock",
    icon: RIBBON_ICONS.lock,
    implemented: true,
    enabled: (state) => state.hasActive,
    run: (ctx) => ctx.toggleLock(),
    toggle: true,
    pressed: (state) => state.activeLocked,
    tooltip: (state) => (state.activeLocked ? "Unlock segment" : "Lock segment")
  },
  lockUnlockOptions: {
    id: "lockUnlockOptions",
    label: "Lock / Unlock options",
    icon: RIBBON_ICONS.caret,
    implemented: false,
    enabled: () => false,
    run: (ctx) => ctx.noop()
  },
  status: {
    id: "status",
    label: "Status",
    icon: RIBBON_ICONS.status,
    implemented: true,
    enabled: (state) => state.hasActive,
    run: (ctx) => ctx.noop(),
    tooltip: (state) =>
      state.hasActive ? `Status: ${SEGMENT_STATUS_LABEL[state.activeStatus]}` : "Status"
  },
  otherActions: {
    id: "otherActions",
    label: "Other Actions",
    icon: RIBBON_ICONS.moreActions,
    implemented: true,
    enabled: (state) => state.hasActive,
    run: (ctx) => ctx.noop()
  },
  previous: {
    id: "previous",
    label: "Previous",
    icon: RIBBON_ICONS.previous,
    implemented: true,
    enabled: (state) => state.canGoPrev,
    run: (ctx) => ctx.goPrev()
  },
  next: {
    id: "next",
    label: "Next",
    icon: RIBBON_ICONS.next,
    implemented: true,
    enabled: (state) => state.canGoNext,
    run: (ctx) => ctx.goNext()
  },
  find: {
    id: "find",
    label: "Find",
    icon: RIBBON_ICONS.find,
    implemented: true,
    enabled: (state) => state.hasActive,
    run: (ctx) => ctx.noop()
  },
  replace: {
    id: "replace",
    label: "Replace",
    icon: RIBBON_ICONS.replace,
    implemented: true,
    enabled: (state) => state.hasActive,
    run: (ctx) => ctx.noop()
  },
  goTo: {
    id: "goTo",
    label: "Go To",
    icon: RIBBON_ICONS.goTo,
    implemented: true,
    enabled: (state) => state.hasActive,
    run: (ctx) => ctx.noop()
  }
};
