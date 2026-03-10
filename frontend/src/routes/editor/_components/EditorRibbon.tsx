import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "../../../api";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState } from "../../../utils/segmentState";
import { clearTimeoutRef } from "../../../utils/timers";
import type { FindScope } from "../state/useEditorFile";
import {
  HOME_RIBBON_COMMANDS,
  type HomeRibbonCommandContext,
  type HomeRibbonCommandState
} from "../state/homeRibbonCommands";
import EditorRibbonViewTab from "./EditorRibbonViewTab";
import EditorRibbonHomeTab from "./EditorRibbonHomeTab";
import {
  BASE_SYMBOL_CATEGORIES,
  HOME_OVERFLOW_ORDER,
  normalizeTokenAwareSelection,
  TOKEN_SPLIT_RE,
  TOKEN_TEST_RE,
  VIEW_OVERFLOW_ORDER,
  type RibbonAction,
  type SymbolItem,
  type TabKey,
  overflowCountForWidth
} from "./EditorRibbon.shared";
import {
  VIEW_RIBBON_COMMANDS,
  type ViewRibbonCommandContext,
  type ViewRibbonCommandState
} from "../state/viewRibbonCommands";

export default function EditorRibbon(props: {
  active: Segment | undefined;
  draftById: Record<number, string>;
  findQuery: string;
  setFindQuery: (value: string) => void;
  replaceQuery: string;
  setReplaceQuery: (value: string) => void;
  findScope: FindScope;
  setFindScope: (value: FindScope) => void;
  findUseRegex: boolean;
  setFindUseRegex: (value: boolean) => void;
  matchCount: number;
  onFindNext: () => void;
  onFindPrev: () => void;
  onReplaceAll: () => void | Promise<void>;
  onGoPrev: () => void;
  onGoNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  onGoTo: (n: number) => void;
  reviewQueueEnabled: boolean;
  setReviewQueueEnabled: (value: boolean) => void;
  issueCount: number;
  onAcceptCleanDrafts: () => void | Promise<void>;
  onRecomputeIssues?: () => void | Promise<void>;
  showWhitespace: boolean;
  setShowWhitespace: React.Dispatch<React.SetStateAction<boolean>>;
  showTags: boolean;
  setShowTags: React.Dispatch<React.SetStateAction<boolean>>;
  showTagDetails: boolean;
  setShowTagDetails: React.Dispatch<React.SetStateAction<boolean>>;
  textZoomEnabled: boolean;
  setTextZoomEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  textZoom: number;
  setTextZoom: React.Dispatch<React.SetStateAction<number>>;
  layoutMode: "horizontal" | "vertical";
  setLayoutMode: React.Dispatch<React.SetStateAction<"horizontal" | "vertical">>;
  showNavigation: boolean;
  setShowNavigation: React.Dispatch<React.SetStateAction<boolean>>;
  showDocumentStructure: boolean;
  setShowDocumentStructure: React.Dispatch<React.SetStateAction<boolean>>;
  lookupsFilter: "all" | "terms" | "tm" | "mt";
  setLookupsFilter: React.Dispatch<React.SetStateAction<"all" | "terms" | "tm" | "mt">>;
  lookupsView: "detailed" | "compact";
  setLookupsView: React.Dispatch<React.SetStateAction<"detailed" | "compact">>;
  themeMode: "light" | "dark" | "auto";
  setThemeMode: React.Dispatch<React.SetStateAction<"light" | "dark" | "auto">>;
  themeSupported: boolean;
  previewMode: "off" | "split" | "on";
  setPreviewMode: React.Dispatch<React.SetStateAction<"off" | "split" | "on">>;
  previewSupported: boolean;
  optionsSupported: boolean;
  onOpenOptions: () => void;
  hasSegments: boolean;
  documentStructureSupported: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  enterBehavior: "confirm" | "next";
  setEnterBehavior: (value: "confirm" | "next") => void;
  onCopySource: () => void;
  onClearTarget: () => void;
  onConfirm: () => void;
  onConfirmNext: () => void;
  onToggleLock: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUpdateTarget: (segmentId: number, value: string, options?: { skipHistory?: boolean }) => void;
  onApplySuggestion: (kind: "tm" | "glossary" | "mt") => void | Promise<void>;
}) {
  const [tab, setTab] = useState<TabKey>("home");
  const [goTo, setGoTo] = useState("");
  const [overflowCount, setOverflowCount] = useState(0);
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  const otherActionsRef = useRef<HTMLDetailsElement | null>(null);
  const changeCaseMenuRef = useRef<HTMLDetailsElement | null>(null);
  const symbolsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const symbolsMenuOverflowRef = useRef<HTMLDetailsElement | null>(null);
  const lookupsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const themeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const previewMenuRef = useRef<HTMLDetailsElement | null>(null);
  const lookupsMenuOverflowRef = useRef<HTMLDetailsElement | null>(null);
  const themeMenuOverflowRef = useRef<HTMLDetailsElement | null>(null);
  const previewMenuOverflowRef = useRef<HTMLDetailsElement | null>(null);
  const pasteHintTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [symbolCategory, setSymbolCategory] = useState<string>("typography");
  const [recentSymbols, setRecentSymbols] = useState<SymbolItem[]>([]);
  const [targetMeta, setTargetMeta] = useState({
    hasFocus: false,
    selectionStart: 0,
    selectionEnd: 0
  });

  const canAct = Boolean(props.active);
  const activeStatus = props.active ? normalizeSegmentStatus(props.active.status) : "draft";
  const activeState = props.active ? coerceSegmentState(props.active.state, activeStatus) : "draft";
  const activeLocked = props.active
    ? props.active.isLocked === undefined
      ? activeState === "reviewed"
      : Boolean(props.active.isLocked)
    : false;
  const isEditable = canAct && !activeLocked;

  const activeTargetValue = useMemo(() => {
    if (!props.active) return "";
    const hasDraft = Object.prototype.hasOwnProperty.call(props.draftById, props.active.id);
    if (hasDraft) return String(props.draftById[props.active.id] ?? "");
    return String(props.active.tgt ?? "");
  }, [props.active, props.draftById]);

  const clipboardSupport = useMemo(() => {
    if (typeof navigator === "undefined") {
      return { canRead: false, canWrite: false };
    }
    const canRead = typeof navigator.clipboard?.readText === "function";
    const canWrite = typeof navigator.clipboard?.writeText === "function";
    const canExecCopy =
      typeof document !== "undefined" &&
      typeof document.queryCommandSupported === "function" &&
      document.queryCommandSupported("copy");
    return { canRead, canWrite: canWrite || canExecCopy };
  }, []);

  const matchLabel = useMemo(() => {
    if (!props.findQuery.trim()) return "";
    return `${props.matchCount} match${props.matchCount === 1 ? "" : "es"}`;
  }, [props.findQuery, props.matchCount]);

  const getActiveTarget = useCallback(() => {
    if (typeof document === "undefined") return null;
    return document.querySelector(
      ".fc-editor-row.active textarea.fc-editor-cell-input"
    ) as HTMLTextAreaElement | null;
  }, []);

  const syncTargetMeta = useCallback(() => {
    const el = getActiveTarget();
    if (!el || typeof document === "undefined") {
      setTargetMeta((prev) =>
        prev.hasFocus || prev.selectionStart || prev.selectionEnd
          ? { hasFocus: false, selectionStart: 0, selectionEnd: 0 }
          : prev
      );
      return;
    }
    const selectionStart = el.selectionStart ?? 0;
    const selectionEnd = el.selectionEnd ?? selectionStart;
    const hasFocus = document.activeElement === el;
    setTargetMeta((prev) => {
      if (
        prev.hasFocus === hasFocus &&
        prev.selectionStart === selectionStart &&
        prev.selectionEnd === selectionEnd
      ) {
        return prev;
      }
      return { hasFocus, selectionStart, selectionEnd };
    });
  }, [getActiveTarget]);

  const setPasteHintWithTimeout = useCallback((message: string | null) => {
    setPasteHint(message);
    clearTimeoutRef(pasteHintTimerRef);
    if (message) {
      pasteHintTimerRef.current = window.setTimeout(() => {
        setPasteHint(null);
        pasteHintTimerRef.current = null;
      }, 2800);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => syncTargetMeta();
    document.addEventListener("selectionchange", handler);
    document.addEventListener("focusin", handler);
    document.addEventListener("focusout", handler);
    document.addEventListener("keyup", handler);
    document.addEventListener("mouseup", handler);
    document.addEventListener("input", handler);
    return () => {
      document.removeEventListener("selectionchange", handler);
      document.removeEventListener("focusin", handler);
      document.removeEventListener("focusout", handler);
      document.removeEventListener("keyup", handler);
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("input", handler);
    };
  }, [syncTargetMeta]);

  useEffect(() => {
    window.requestAnimationFrame(() => syncTargetMeta());
  }, [props.active?.id, syncTargetMeta]);

  useEffect(() => {
    return () => {
      clearTimeoutRef(pasteHintTimerRef);
    };
  }, []);
  useEffect(() => {
    if (tab !== "home" && tab !== "view") {
      setOverflowCount(0);
      return;
    }

    const el = ribbonRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateOverflow = (width: number) => {
      const next = overflowCountForWidth(width);
      setOverflowCount((prev) => (prev === next ? prev : next));
    };

    updateOverflow(el.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? el.clientWidth;
      updateOverflow(nextWidth);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);

  const hiddenHomeGroups = useMemo(() => {
    return new Set(HOME_OVERFLOW_ORDER.slice(0, overflowCount));
  }, [overflowCount]);

  const hiddenViewGroups = useMemo(() => {
    return new Set(VIEW_OVERFLOW_ORDER.slice(0, overflowCount));
  }, [overflowCount]);

  const symbolCategories = useMemo(() => {
    if (recentSymbols.length === 0) return BASE_SYMBOL_CATEGORIES;
    return [{ id: "recent", label: "Recent", symbols: recentSymbols }, ...BASE_SYMBOL_CATEGORIES];
  }, [recentSymbols]);

  useEffect(() => {
    if (symbolCategories.some((cat) => cat.id === symbolCategory)) return;
    setSymbolCategory(symbolCategories[0]?.id ?? "typography");
  }, [symbolCategories, symbolCategory]);

  const closeDetails = useCallback((ref: React.RefObject<HTMLDetailsElement>) => {
    if (ref.current) ref.current.open = false;
  }, []);

  const readSelection = useCallback(
    (opts?: { preferEndIfUnfocused?: boolean }) => {
      const el = getActiveTarget();
      const value = activeTargetValue;

      if (!el) {
        const endPos = value.length;
        return { start: endPos, end: endPos, hasSelection: false, value, el: null };
      }

      const rawStart = el.selectionStart ?? 0;
      const rawEnd = el.selectionEnd ?? rawStart;
      const hasFocus = typeof document !== "undefined" && document.activeElement === el;

      if (!hasFocus && opts?.preferEndIfUnfocused) {
        const endPos = value.length;
        return { start: endPos, end: endPos, hasSelection: false, value, el };
      }

      const max = value.length;
      const startPos = Math.min(Math.min(rawStart, rawEnd), max);
      const endPos = Math.min(Math.max(rawStart, rawEnd), max);

      return { start: startPos, end: endPos, hasSelection: startPos !== endPos, value, el };
    },
    [activeTargetValue, getActiveTarget]
  );

  const setTargetSelection = useCallback(
    (startPos: number, endPos: number) => {
      const el = getActiveTarget();
      if (!el) return;
      window.requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(startPos, endPos);
      });
    },
    [getActiveTarget]
  );

  const applyReplacement = useCallback(
    (nextValue: string, selectionStart: number, selectionEnd: number) => {
      if (!props.active) return;
      props.onUpdateTarget(props.active.id, nextValue);
      setTargetSelection(selectionStart, selectionEnd);
    },
    [props.active, props.onUpdateTarget, setTargetSelection]
  );

  const replaceSelection = useCallback(
    (replacement: string, opts?: { preferEndIfUnfocused?: boolean; keepSelection?: boolean }) => {
      if (!props.active) return;
      const selection = readSelection({ preferEndIfUnfocused: opts?.preferEndIfUnfocused });
      const range = normalizeTokenAwareSelection(selection.value, selection.start, selection.end);
      const nextValue = selection.value.slice(0, range.start) + replacement + selection.value.slice(range.end);
      const cursor = range.start + replacement.length;
      const selectionStart = opts?.keepSelection ? range.start : cursor;
      const selectionEnd = opts?.keepSelection ? cursor : cursor;
      applyReplacement(nextValue, selectionStart, selectionEnd);
    },
    [applyReplacement, props.active, readSelection]
  );

  const writeClipboardText = useCallback(async (text: string) => {
    if (!text) return false;
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through
      }
    }
    if (typeof document !== "undefined" && typeof document.execCommand === "function") {
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  const readClipboardText = useCallback(async () => {
    if (typeof navigator === "undefined" || typeof navigator.clipboard?.readText !== "function") {
      setPasteHintWithTimeout("Paste blocked. Use Ctrl+V or Cmd+V.");
      return null;
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      setPasteHintWithTimeout("Paste blocked. Use Ctrl+V or Cmd+V.");
      return null;
    }
  }, [setPasteHintWithTimeout]);

  const copySelection = useCallback(async () => {
    const selection = readSelection();
    if (!selection.hasSelection) return;
    const range = normalizeTokenAwareSelection(selection.value, selection.start, selection.end);
    if (selection.el && (range.start !== selection.start || range.end !== selection.end)) {
      setTargetSelection(range.start, range.end);
    }
    const text = selection.value.slice(range.start, range.end);
    if (!text) return;
    await writeClipboardText(text);
  }, [readSelection, setTargetSelection, writeClipboardText]);

  const cutSelection = useCallback(async () => {
    if (!props.active) return;
    const selection = readSelection();
    if (!selection.hasSelection) return;
    const range = normalizeTokenAwareSelection(selection.value, selection.start, selection.end);
    if (selection.el && (range.start !== selection.start || range.end !== selection.end)) {
      setTargetSelection(range.start, range.end);
    }
    const text = selection.value.slice(range.start, range.end);
    if (!text) return;
    const ok = await writeClipboardText(text);
    if (!ok) return;
    const nextValue = selection.value.slice(0, range.start) + selection.value.slice(range.end);
    applyReplacement(nextValue, range.start, range.start);
  }, [applyReplacement, props.active, readSelection, setTargetSelection, writeClipboardText]);

  const pasteSelection = useCallback(async () => {
    if (!props.active) return;
    const text = await readClipboardText();
    if (text === null) return;
    setPasteHintWithTimeout(null);
    replaceSelection(text, { preferEndIfUnfocused: true });
  }, [props.active, readClipboardText, replaceSelection, setPasteHintWithTimeout]);

  const clearFormatting = useCallback(() => {
    if (!props.active) return;
    const selection = readSelection();
    const range = selection.hasSelection
      ? normalizeTokenAwareSelection(selection.value, selection.start, selection.end)
      : { start: 0, end: selection.value.length };
    const slice = selection.value.slice(range.start, range.end);
    const cleaned = slice.replace(/<\/?(?:b|strong|i|em|u)>/gi, "");
    const nextValue = selection.value.slice(0, range.start) + cleaned + selection.value.slice(range.end);
    const cursor = range.start + cleaned.length;
    applyReplacement(nextValue, selection.hasSelection ? range.start : cursor, cursor);
  }, [applyReplacement, props.active, readSelection]);

  const transformPreservingTokens = useCallback((text: string, transform: (value: string) => string) => {
    return text
      .split(TOKEN_SPLIT_RE)
      .map((part) => (TOKEN_TEST_RE.test(part) ? part : transform(part)))
      .join("");
  }, []);

  const toTitleCase = useCallback((value: string) => {
    return value.toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
  }, []);

  const changeCase = useCallback(
    (mode: "upper" | "lower" | "title") => {
      if (!props.active) return;
      const selection = readSelection();
      const range = selection.hasSelection
        ? normalizeTokenAwareSelection(selection.value, selection.start, selection.end)
        : { start: 0, end: selection.value.length };
      const slice = selection.value.slice(range.start, range.end);
      const transform =
        mode === "upper"
          ? (value: string) => value.toUpperCase()
          : mode === "lower"
          ? (value: string) => value.toLowerCase()
          : toTitleCase;
      const transformed = transformPreservingTokens(slice, transform);
      const nextValue = selection.value.slice(0, range.start) + transformed + selection.value.slice(range.end);
      const selectionStart = selection.hasSelection ? range.start : range.start + transformed.length;
      const selectionEnd = range.start + transformed.length;
      applyReplacement(nextValue, selectionStart, selectionEnd);
    },
    [applyReplacement, props.active, readSelection, toTitleCase, transformPreservingTokens]
  );

  const findWordRange = useCallback((value: string, caret: number) => {
    const isWordChar = (ch: string) => Boolean(ch) && !/\s/.test(ch) && ch !== "<" && ch !== ">";
    let start = Math.min(Math.max(caret, 0), value.length);
    let end = start;
    while (start > 0 && isWordChar(value[start - 1]!)) start -= 1;
    while (end < value.length && isWordChar(value[end]!)) end += 1;
    if (start === end) return null;
    return { start, end };
  }, []);

  const applyInlineTag = useCallback(
    (tag: "b" | "u") => {
      if (!props.active) return;
      const selection = readSelection();
      if (!selection.el) return;
      let range = normalizeTokenAwareSelection(selection.value, selection.start, selection.end);
      if (!selection.hasSelection) {
        const wordRange = findWordRange(selection.value, range.start);
        if (!wordRange) return;
        range = normalizeTokenAwareSelection(selection.value, wordRange.start, wordRange.end);
      }
      if (range.start === range.end) return;
      const slice = selection.value.slice(range.start, range.end);
      if (!slice) return;
      const wrapped = `<${tag}>${slice}</${tag}>`;
      const nextValue = selection.value.slice(0, range.start) + wrapped + selection.value.slice(range.end);
      const cursor = range.start + wrapped.length;
      applyReplacement(nextValue, cursor, cursor);
    },
    [applyReplacement, findWordRange, props.active, readSelection]
  );

  const applyBold = useCallback(() => {
    applyInlineTag("b");
  }, [applyInlineTag]);

  const applyUnderline = useCallback(() => {
    applyInlineTag("u");
  }, [applyInlineTag]);

  const toggleLock = useCallback(() => {
    if (!props.active) return;
    void props.onToggleLock();
  }, [props.active, props.onToggleLock]);

  const focusTarget = useCallback(() => {
    const el = getActiveTarget();
    el?.focus();
  }, [getActiveTarget]);

  const insertSymbol = useCallback(
    (symbol: SymbolItem, ref?: React.RefObject<HTMLDetailsElement>) => {
      replaceSelection(symbol.value, { preferEndIfUnfocused: true });
      setRecentSymbols((prev) => {
        const next = [symbol, ...prev.filter((item) => item.value !== symbol.value)];
        return next.slice(0, 12);
      });
      closeDetails(ref ?? symbolsMenuRef);
    },
    [closeDetails, replaceSelection]
  );

  const commandState = useMemo<HomeRibbonCommandState>(
    () => ({
      hasActive: canAct,
      activeStatus,
      activeLocked,
      isEditable,
      hasSelection: targetMeta.selectionStart !== targetMeta.selectionEnd,
      targetFocused: targetMeta.hasFocus,
      canUndo: props.canUndo,
      canRedo: props.canRedo,
      canGoPrev: props.canGoPrev,
      canGoNext: props.canGoNext,
      clipboardWriteAvailable: clipboardSupport.canWrite,
      clipboardReadAvailable: clipboardSupport.canRead,
      showWhitespace: props.showWhitespace,
      pasteHint
    }),
    [
      activeStatus,
      activeLocked,
      canAct,
      clipboardSupport.canRead,
      clipboardSupport.canWrite,
      isEditable,
      pasteHint,
      props.canGoNext,
      props.canGoPrev,
      props.canRedo,
      props.canUndo,
      props.showWhitespace,
      targetMeta.hasFocus,
      targetMeta.selectionEnd,
      targetMeta.selectionStart
    ]
  );

  const commandCtx = useMemo<HomeRibbonCommandContext>(
    () => ({
      active: props.active,
      undo: props.onUndo,
      redo: props.onRedo,
      cut: () => void cutSelection(),
      copy: () => void copySelection(),
      paste: () => void pasteSelection(),
      bold: applyBold,
      underline: applyUnderline,
      fontSmaller: () => {},
      fontBigger: () => {},
      clearFormatting,
      changeCase,
      toggleWhitespace: () => props.setShowWhitespace(!props.showWhitespace),
      applyTranslation: () => void props.onApplySuggestion("mt"),
      confirm: () => void props.onConfirm(),
      confirmNext: () => void props.onConfirmNext(),
      copySource: props.onCopySource,
      clearTarget: props.onClearTarget,
      toggleLock,
      goPrev: props.onGoPrev,
      goNext: props.onGoNext,
      focusTarget,
      noop: () => {}
    }),
    [
      applyBold,
      applyUnderline,
      changeCase,
      clearFormatting,
      copySelection,
      cutSelection,
      focusTarget,
      pasteSelection,
      props.active,
      props.onApplySuggestion,
      props.onClearTarget,
      props.onConfirm,
      props.onConfirmNext,
      props.onCopySource,
      props.onGoNext,
      props.onGoPrev,
      props.onRedo,
      props.onUndo,
      props.setShowWhitespace,
      props.showWhitespace,
      toggleLock
    ]
  );

  const actions = useMemo(() => {
    const makeAction = (id: string): RibbonAction => {
      const command = HOME_RIBBON_COMMANDS[id];
      if (!command) {
        return {
          label: id,
          icon: null,
          implemented: false,
          enabled: false
        };
      }
      const implemented = command.implemented;
      const enabled = implemented && command.enabled(commandState);
      return {
        label: command.label,
        icon: command.icon,
        implemented,
        enabled,
        toggle: command.toggle,
        pressed: command.pressed ? command.pressed(commandState) : undefined,
        tooltip: command.tooltip ? command.tooltip(commandState) : undefined,
        onClick: implemented ? () => command.run(commandCtx) : undefined
      };
    };

    const confirm = makeAction("confirm");
    confirm.label = "Mark reviewed";
    const confirmNext = makeAction("confirmNext");
    confirmNext.label = props.reviewQueueEnabled ? "Review + Next issue" : "Review + Next";
    const lockUnlock = makeAction("lockUnlock");
    lockUnlock.label = activeLocked ? "Unlock" : "Lock";
    const previous = makeAction("previous");
    const next = makeAction("next");
    if (props.reviewQueueEnabled) {
      previous.label = "Prev issue";
      next.label = "Next issue";
    }

    return {
      undo: makeAction("undo"),
      redo: makeAction("redo"),
      paste: makeAction("paste"),
      cut: makeAction("cut"),
      copy: makeAction("copy"),
      clearFormatting: makeAction("clearFormatting"),
      bold: makeAction("bold"),
      underline: makeAction("underline"),
      fontSmaller: makeAction("fontSmaller"),
      fontBigger: makeAction("fontBigger"),
      applyFormatting: makeAction("applyFormatting"),
      showWhitespace: makeAction("showWhitespace"),
      changeCase: makeAction("changeCase"),
      changeCaseUpper: makeAction("changeCaseUpper"),
      changeCaseLower: makeAction("changeCaseLower"),
      changeCaseTitle: makeAction("changeCaseTitle"),
      insertSymbols: makeAction("insertSymbols"),
      applyTranslation: makeAction("applyTranslation"),
      confirm,
      confirmNext,
      copySource: makeAction("copySource"),
      copySourceOptions: makeAction("copySourceOptions"),
      clearTarget: makeAction("clearTarget"),
      lockUnlock,
      lockUnlockOptions: makeAction("lockUnlockOptions"),
      status: makeAction("status"),
      otherActions: makeAction("otherActions"),
      previous,
      next,
      find: makeAction("find"),
      replace: makeAction("replace"),
      goTo: makeAction("goTo")
    };
  }, [commandCtx, commandState, props.reviewQueueEnabled, activeLocked]);
  const viewCommandState = useMemo<ViewRibbonCommandState>(
    () => ({
      hasSegments: props.hasSegments,
      layoutMode: props.layoutMode,
      showNavigation: props.showNavigation,
      showDocumentStructure: props.showDocumentStructure,
      documentStructureSupported: props.documentStructureSupported,
      textZoomEnabled: props.textZoomEnabled,
      textZoom: props.textZoom,
      showTags: props.showTags,
      showTagDetails: props.showTagDetails,
      lookupsFilter: props.lookupsFilter,
      lookupsView: props.lookupsView,
      themeMode: props.themeMode,
      themeSupported: props.themeSupported,
      previewMode: props.previewMode,
      previewSupported: props.previewSupported,
      optionsSupported: props.optionsSupported
    }),
    [
      props.documentStructureSupported,
      props.hasSegments,
      props.layoutMode,
      props.lookupsFilter,
      props.lookupsView,
      props.optionsSupported,
      props.previewMode,
      props.previewSupported,
      props.showDocumentStructure,
      props.showNavigation,
      props.showTagDetails,
      props.showTags,
      props.textZoom,
      props.textZoomEnabled,
      props.themeMode,
      props.themeSupported
    ]
  );

  const viewCommandCtx = useMemo<ViewRibbonCommandContext>(
    () => ({
      setLayoutMode: props.setLayoutMode,
      setShowNavigation: props.setShowNavigation,
      setShowDocumentStructure: props.setShowDocumentStructure,
      setTextZoomEnabled: props.setTextZoomEnabled,
      setTextZoom: props.setTextZoom,
      setShowTags: props.setShowTags,
      setShowTagDetails: props.setShowTagDetails,
      setLookupsFilter: props.setLookupsFilter,
      setLookupsView: props.setLookupsView,
      setThemeMode: props.setThemeMode,
      setPreviewMode: props.setPreviewMode,
      openOptions: props.onOpenOptions
    }),
    [
      props.onOpenOptions,
      props.setLayoutMode,
      props.setLookupsFilter,
      props.setLookupsView,
      props.setPreviewMode,
      props.setShowDocumentStructure,
      props.setShowNavigation,
      props.setShowTagDetails,
      props.setShowTags,
      props.setTextZoom,
      props.setTextZoomEnabled,
      props.setThemeMode
    ]
  );

  const viewActions = useMemo(() => {
    const makeAction = (id: string): RibbonAction => {
      const command = VIEW_RIBBON_COMMANDS[id];
      if (!command) {
        return {
          label: id,
          icon: null,
          implemented: false,
          enabled: false
        };
      }
      const label =
        typeof command.label === "function" ? command.label(viewCommandState) : command.label;
      const enabled = command.enabled(viewCommandState);
      const disabledReason = command.disabledReason?.(viewCommandState);
      return {
        label,
        icon: command.icon,
        implemented: true,
        enabled,
        toggle: command.toggle,
        pressed: command.pressed ? command.pressed(viewCommandState) : undefined,
        tooltip: !enabled && disabledReason ? disabledReason : undefined,
        onClick: enabled ? () => command.run(viewCommandCtx) : undefined
      };
    };

    return {
      layoutVertical: makeAction("layoutVertical"),
      layoutHorizontal: makeAction("layoutHorizontal"),
      showNavigation: makeAction("showNavigation"),
      showDocumentStructure: makeAction("showDocumentStructure"),
      enableTextZoom: makeAction("enableTextZoom"),
      zoomLarger: makeAction("zoomLarger"),
      zoomSmaller: makeAction("zoomSmaller"),
      showFormattingTags: makeAction("showFormattingTags"),
      showTagDetails: makeAction("showTagDetails"),
      filterLookups: makeAction("filterLookups"),
      filterLookupsAll: makeAction("filterLookupsAll"),
      filterLookupsTerms: makeAction("filterLookupsTerms"),
      filterLookupsTm: makeAction("filterLookupsTm"),
      filterLookupsMt: makeAction("filterLookupsMt"),
      alternativeView: makeAction("alternativeView"),
      theme: makeAction("theme"),
      themeLight: makeAction("themeLight"),
      themeDark: makeAction("themeDark"),
      themeAuto: makeAction("themeAuto"),
      preview: makeAction("preview"),
      previewOff: makeAction("previewOff"),
      previewSplit: makeAction("previewSplit"),
      previewOn: makeAction("previewOn"),
      options: makeAction("options")
    };
  }, [viewCommandCtx, viewCommandState]);
  const activeSymbolCategory = symbolCategories.find((cat) => cat.id === symbolCategory) ?? symbolCategories[0];


  return (
    <div className="fc-editor-ribbon">
      <div className="fc-editor-ribbon-tabs">
        <button
          type="button"
          className={`fc-editor-ribbon-tab ${tab === "home" ? "active" : ""}`}
          onClick={() => setTab("home")}
        >
          Home
        </button>
        <button
          type="button"
          className={`fc-editor-ribbon-tab ${tab === "view" ? "active" : ""}`}
          onClick={() => setTab("view")}
        >
          View
        </button>
      </div>

      <div
        className={`fc-editor-ribbon-content ${tab === "home" || tab === "view" ? "fc-editor-ribbon-home" : ""}`}
        ref={ribbonRef}
      >
        {tab === "home" ? (
          <EditorRibbonHomeTab
            {...{
              hiddenHomeGroups,
              actions,
              changeCaseMenuRef,
              closeDetails,
              symbolCategories,
              activeSymbolCategory,
              setSymbolCategory,
              insertSymbol,
              symbolsMenuRef,
              otherActionsRef,
              goTo,
              setGoTo,
              matchLabel,
              symbolsMenuOverflowRef,
              reviewQueueEnabled: props.reviewQueueEnabled,
              setReviewQueueEnabled: props.setReviewQueueEnabled,
              issueCount: props.issueCount,
              onAcceptCleanDrafts: props.onAcceptCleanDrafts,
              hasSegments: props.hasSegments,
              onRecomputeIssues: props.onRecomputeIssues,
              onGoTo: props.onGoTo,
              findQuery: props.findQuery,
              setFindQuery: props.setFindQuery,
              findScope: props.findScope,
              setFindScope: props.setFindScope,
              findUseRegex: props.findUseRegex,
              setFindUseRegex: props.setFindUseRegex,
              onFindPrev: props.onFindPrev,
              onFindNext: props.onFindNext,
              matchCount: props.matchCount,
              replaceQuery: props.replaceQuery,
              setReplaceQuery: props.setReplaceQuery,
              onReplaceAll: props.onReplaceAll
            }}
          />
        ) : tab === "view" ? (
          <EditorRibbonViewTab
            hiddenViewGroups={hiddenViewGroups}
            viewActions={viewActions}
            closeDetails={closeDetails}
            lookupsMenuRef={lookupsMenuRef}
            themeMenuRef={themeMenuRef}
            previewMenuRef={previewMenuRef}
            lookupsMenuOverflowRef={lookupsMenuOverflowRef}
            themeMenuOverflowRef={themeMenuOverflowRef}
            previewMenuOverflowRef={previewMenuOverflowRef}
          />
        ) : (
          <>
            <div className="fc-editor-ribbon-group">
              <div className="fc-editor-ribbon-group-title">Navigation</div>
              <div className="d-flex align-items-center gap-2">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={props.onGoPrev} title="Previous">
                  <i className="bi bi-chevron-up" aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={props.onGoNext} title="Next">
                  <i className="bi bi-chevron-down" aria-hidden="true" />
                </button>
                <form
                  className="d-flex align-items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(goTo);
                    if (Number.isFinite(n)) props.onGoTo(n);
                  }}
                >
                  <span className="text-muted small">Go to</span>
                  <input
                    className="form-control form-control-sm"
                    style={{ width: "90px" }}
                    placeholder="#"
                    value={goTo}
                    onChange={(e) => setGoTo(e.target.value)}
                  />
                </form>
              </div>
            </div>

            <div className="fc-editor-ribbon-group flex-grow-1" style={{ minWidth: 240 }}>
              <div className="fc-editor-ribbon-group-title">Find / Replace</div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="d-flex align-items-center gap-1">
                  <input
                    className="form-control form-control-sm"
                    style={{ width: "200px" }}
                    placeholder="Find"
                    value={props.findQuery}
                    onChange={(e) => props.setFindQuery(e.target.value)}
                  />
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "120px" }}
                    value={props.findScope}
                    onChange={(e) => props.setFindScope(e.target.value as FindScope)}
                  >
                    <option value="both">Source+Target</option>
                    <option value="source">Source</option>
                    <option value="target">Target</option>
                  </select>
                </div>
                <div className="btn-group btn-group-sm">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={props.onFindPrev}
                    disabled={!props.findQuery.trim() || props.matchCount === 0}
                    title="Previous match"
                  >
                    <i className="bi bi-arrow-up" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={props.onFindNext}
                    disabled={!props.findQuery.trim() || props.matchCount === 0}
                    title="Next match"
                  >
                    <i className="bi bi-arrow-down" aria-hidden="true" />
                  </button>
                </div>
                <label className="form-check form-check-inline small mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={props.findUseRegex}
                    onChange={(e) => props.setFindUseRegex(e.target.checked)}
                  />
                  Regex
                </label>
                <input
                  className="form-control form-control-sm"
                  style={{ width: "220px" }}
                  placeholder="Replace"
                  value={props.replaceQuery}
                  onChange={(e) => props.setReplaceQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={!props.findQuery.trim()}
                  onClick={() => void props.onReplaceAll()}
                  title="Replace all matches in target"
                >
                  Replace all
                </button>
                <span className="text-muted small">{matchLabel}</span>
              </div>
            </div>

            <div className="fc-editor-ribbon-group">
              <div className="fc-editor-ribbon-group-title">QA</div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="text-muted small">Use "Errors only" to focus blocking segments.</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}




