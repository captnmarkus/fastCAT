import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  bulkApproveProjectFileSegments,
  exportProjectTargetFile,
  getBulkApproveJobStatus,
  getRenderedPreviewDetails,
  getRenderedPreviewStatus,
  retryProjectProvision,
  getSegmentHistory,
  requestRenderedPreview,
  searchTermbaseConcordance,
  type EditorBulkApproveEstimate,
  type EditorBulkApproveScope,
  type EditorBulkJobStatusResponse,
  type EditorBulkJobSummary,
  type EditorBulkVisibleFilters,
  type Match,
  type RenderedPreviewDetailsResponse,
  type Segment,
  type SegmentRun,
  type SegmentHistoryEntry,
  type TermbaseConcordanceEntry
} from "../../../api";
import Modal from "../../../components/Modal";
import type { AuthUser } from "../../../types/app";
import { insertAtSelection } from "../../../utils/insert";
import { buildTargetOutputFilename } from "../../../utils/outputFilename";
import { extractPlaceholders } from "../../../utils/qa";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState } from "../../../utils/segmentState";
import { renderPlainText, renderWithTags } from "../../../utils/tags";
import { adjustFontSizeInRange, applyStylePatchToRange, normalizeRuns } from "../../../utils/richTextRuns";
import { useEditorFile } from "../state/useEditorFile";
import {
  createDefaultEditorKeymap,
  detectEditorHotkeyPlatform,
  formatKeyBinding,
  hotkeyActionLabel,
  isEditorHotkeyAllowed,
  parseDigitFromAction,
  resolveEditorHotkeyAction,
  runConfirmAndAdvance,
  type EditorHotkeyActionId,
  type EditorHotkeyMap,
  type EditorHotkeyPlatform
} from "../hotkeys/editorHotkeys";
import ModernEditorFileLayout from "./ModernEditorFileLayout";
import { SYMBOL_PICKER_ITEMS as MODERN_EDITOR_SYMBOL_PICKER_ITEMS } from "./modernEditorSymbols";
import "./modern-editor.css";
import ModernEditorBulkApproveModals from "./ModernEditorBulkApproveModals";
import {
  type BottomTab,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_STEP,
  TERMBASE_CONCORDANCE_MIN_QUERY,
  canDownloadReviewedOutput,
  copyToClipboard,
  filterCount,
  highlightConcordanceMatch,
  isDeprecatedTerm,
  isSegmentLocked,
  normalizeMatchScorePct,
  normalizeReviewGateStatus,
  previewBlockMeta,
  saveLabelForState,
  segmentState,
  segmentTargetValue,
  stripInline,
  termbaseDisplaySource,
  termbaseEntryCategory
} from "./modernEditorPageUtils";
import { useModernEditorBulkActions } from "./useModernEditorBulkActions";
import { useModernEditorFiltering } from "./useModernEditorFiltering";
import { useModernEditorHotkeys } from "./useModernEditorHotkeys";
import { useModernEditorPreferences } from "./useModernEditorPreferences";
import { useModernEditorRenderedPreview } from "./useModernEditorRenderedPreview";
import ModernEditorStatusState from "./ModernEditorStatusState";
import { useModernEditorTaskActions } from "./useModernEditorTaskActions";
export default function ModernEditorFilePage(props: {
  currentUser: AuthUser | null;
}) {
  const { currentUser } = props;
  const params = useParams<{ taskId: string }>();
  const nav = useNavigate();
  const taskId = Number(params.taskId);
  const editor = useEditorFile({ taskId, currentUser });
  const fileId = editor.fileId ?? null;
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const hotkeyPlatform: EditorHotkeyPlatform = useMemo(() => detectEditorHotkeyPlatform(), []);

  const {
    bottomPanelHeight,
    bottomPanelOpen,
    draftOnly,
    editorFontSize,
    enableConcordanceCtrlK,
    lockedOnly,
    ntmDraftOnly,
    previewEnabled,
    previewLayout,
    reviewedOnly,
    rightSidebarOpen,
    showFilters,
    showTags,
    showWhitespace,
    sourceSearch,
    startBottomPanelResize,
    statusFilter,
    targetSearch,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly,
    setBottomPanelOpen,
    setDraftOnly,
    setEditorFontSize,
    setEnableConcordanceCtrlK,
    setLockedOnly,
    setNtmDraftOnly,
    setPreviewEnabled,
    setPreviewLayout,
    setReviewedOnly,
    setRightSidebarOpen,
    setShowFilters,
    setShowTags,
    setShowWhitespace,
    setSourceSearch,
    setStatusFilter,
    setTargetSearch,
    setTermHitsOnly,
    setTmxOnly,
    setUntranslatedOnly,
    setWithQaOnly
  } = useModernEditorPreferences({ currentUser, editor, taskId, nav });
  const [skippedOnly, setSkippedOnly] = useState(false); const [problematicOnly, setProblematicOnly] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>("rendered_preview"); const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">("find");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionAnchorRef = useRef<number | null>(null);

  const [historyEntries, setHistoryEntries] = useState<SegmentHistoryEntry[]>([]); const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null); const symbolsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [catResultIndex, setCatResultIndex] = useState(0);
  const [retryingImport, setRetryingImport] = useState(false);

  const {
    bulkApproveAckQa,
    bulkApproveDialog,
    bulkApproveJob,
    bulkApproveSummary,
    bulkBusy,
    bulkClearTargets,
    bulkLock,
    bulkMarkReviewed,
    confirmBulkApprove,
    generateMt,
    lastProblematicIds,
    lastSkippedIds,
    mtGeneratingSet,
    openBulkApproveDialog,
    setBulkApproveAckQa,
    setBulkApproveDialog,
    setBulkApproveJob,
    setBulkApproveSummary
  } = useModernEditorBulkActions({
    draftOnly,
    editor,
    fileId,
    lockedOnly,
    ntmDraftOnly,
    reviewedOnly,
    selectedIds,
    setProblematicOnly,
    setSkippedOnly,
    sourceSearch,
    statusFilter,
    targetSearch,
    taskId,
    taskReadOnly: editor.taskReadOnly,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  });
  const hotkeyKeymap: EditorHotkeyMap = useMemo(
    () =>
      createDefaultEditorKeymap(hotkeyPlatform, {
        enableConcordanceCtrlK
      }),
    [enableConcordanceCtrlK, hotkeyPlatform]
  );

  const {
    activeFilteredIndex,
    canGoFilteredNext,
    canGoFilteredPrev,
    concordanceInputRef,
    concordanceQuery,
    concordanceResults,
    concordanceSearchError,
    concordanceSearchIn,
    concordanceSearchLoading,
    filteredIndexById,
    filteredSegments,
    goNextFiltered,
    goPrevFiltered,
    setConcordanceQuery,
    setConcordanceSearchIn
  } = useModernEditorFiltering({
    activeSegmentId: editor.active?.id ?? null,
    draftOnly,
    editor,
    lastProblematicIds,
    lastSkippedIds,
    lockedOnly,
    ntmDraftOnly,
    problematicOnly,
    reviewedOnly,
    setDraftOnly,
    setLockedOnly,
    setNtmDraftOnly,
    setProblematicOnly,
    setReviewedOnly,
    setSourceSearch,
    setStatusFilter,
    setTargetSearch,
    setTermHitsOnly,
    setTmxOnly,
    setUntranslatedOnly,
    setWithQaOnly,
    skippedOnly,
    sourceSearch,
    statusFilter,
    targetSearch,
    taskId,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  });

  useEffect(() => {
    if (skippedOnly && lastSkippedIds.length === 0) {
      setSkippedOnly(false);
    }
  }, [lastSkippedIds.length, skippedOnly]);

  useEffect(() => {
    if (problematicOnly && lastProblematicIds.length === 0) {
      setProblematicOnly(false);
    }
  }, [lastProblematicIds.length, problematicOnly]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => filteredIndexById.has(id)));
  }, [filteredIndexById]);

  const {
    renderedPreviewConfiguredMethod,
    renderedPreviewDetails,
    renderedPreviewError,
    renderedPreviewErrorDetails,
    renderedPreviewLoading,
    renderedPreviewLogs,
    renderedPreviewPreviewId,
    renderedPreviewRevisionId,
    renderedPreviewStatus,
    renderedPreviewSupported,
    renderedPreviewWarnings,
    openRenderedPreviewInNewTab,
    refreshRenderedPreviewNow
  } = useModernEditorRenderedPreview({
    bottomTab,
    editor,
    fileId,
    setBottomPanelOpen,
    setBottomTab,
    taskId
  });
  const activeSegmentId = editor.active?.id ?? null;

  useEffect(() => {
    if (!activeSegmentId) {
      setHistoryEntries([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    void getSegmentHistory(activeSegmentId, { signal: controller.signal })
      .then((history) => {
        setHistoryEntries(Array.isArray(history?.entries) ? history.entries : []);
      })
      .catch((err: any) => {
        if (err?.name === "AbortError") return;
        setHistoryError(err?.userMessage || err?.message || "Failed to load segment history.");
      })
      .finally(() => {
        setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [activeSegmentId]);
  const openFindModal = useCallback((mode: "find" | "replace") => {
    setFindReplaceMode(mode);
    setFindReplaceOpen(true);
  }, []);

  const taskReadOnly = editor.taskReadOnly;
  const activeSegment = editor.active;
  const userRole = String(currentUser?.role || "").trim().toLowerCase();
  const reviewMode = userRole === "reviewer" || userRole === "manager" || userRole === "admin";
  const canRevertStage = reviewMode;

  const isSegmentConfirmed = useCallback(
    (segment: Segment) => {
      const status = normalizeSegmentStatus(segment.status);
      if (reviewMode) return status === "reviewed";
      return status === "under_review" || status === "reviewed";
    },
    [reviewMode]
  );

  const focusTargetForSegment = useCallback((segmentId: number | null | undefined) => {
    if (!segmentId) return;
    window.requestAnimationFrame(() => {
      const input = document.querySelector(
        `textarea.fc-modern-target-input[data-segment-id="${segmentId}"]`
      ) as HTMLTextAreaElement | null;
      if (!input) return;
      try {
        input.focus();
      } catch {
        // ignore focus errors
      }
    });
  }, []);

  const focusSourceForSegment = useCallback((segmentId: number | null | undefined) => {
    if (!segmentId) return;
    window.requestAnimationFrame(() => {
      const source = document.querySelector(
        `.fc-modern-segment-source-text[data-segment-id="${segmentId}"]`
      ) as HTMLElement | null;
      if (!source) return;
      source.setAttribute("tabindex", "-1");
      try {
        source.focus();
      } catch {
        // ignore focus errors
      }
    });
  }, []);

  const goToNextUnconfirmed = useCallback(() => {
    if (!activeSegment || filteredSegments.length === 0) return;
    const currentIdx = filteredIndexById.get(activeSegment.id);
    if (currentIdx == null || currentIdx < 0) return;
    const size = filteredSegments.length;
    for (let offset = 1; offset <= size; offset += 1) {
      const idx = (currentIdx + offset) % size;
      const candidate = filteredSegments[idx];
      if (!candidate) continue;
      if (!isSegmentConfirmed(candidate)) {
        editor.setActiveId(candidate.id);
        focusTargetForSegment(candidate.id);
        return;
      }
    }
  }, [activeSegment, editor, filteredIndexById, filteredSegments, focusTargetForSegment, isSegmentConfirmed]);

  const openGoToSegmentDialog = useCallback(() => {
    const startValue = activeSegment ? String(activeSegment.index + 1) : "";
    const raw = window.prompt("Go to segment number:", startValue);
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    editor.goToSegmentNumber(Math.trunc(value));
  }, [activeSegment, editor]);

  const copySourceToTarget = useCallback(() => {
    if (!activeSegment || taskReadOnly || isSegmentLocked(activeSegment)) return false;
    editor.updateTarget(activeSegment.id, activeSegment.src ?? "");
    focusTargetForSegment(activeSegment.id);
    return true;
  }, [activeSegment, editor, focusTargetForSegment, taskReadOnly]);

  const insertIntoActiveTarget = useCallback(
    (text: string) => {
      const value = String(text || "");
      const active = editor.active;
      if (!active || !value) return;
      const input = document.querySelector(
        `textarea.fc-modern-target-input[data-segment-id="${active.id}"]`
      ) as HTMLTextAreaElement | null;
      const current = segmentTargetValue(active, editor.draftById);
      if (!input) {
        const needsSpace = current && !/\s$/.test(current);
        editor.updateTarget(active.id, `${current}${needsSpace ? " " : ""}${value}`);
        return;
      }
      const { nextValue, nextCursor } = insertAtSelection(
        current,
        value,
        input.selectionStart ?? current.length,
        input.selectionEnd ?? current.length
      );
      editor.updateTarget(active.id, nextValue);
      window.requestAnimationFrame(() => {
        try {
          input.focus();
          input.setSelectionRange(nextCursor, nextCursor);
        } catch {
          // ignore selection errors
        }
      });
    },
    [editor]
  );

  const insertTagByIndex = useCallback(
    (indexOneBased: number) => {
      if (!activeSegment || taskReadOnly || isSegmentLocked(activeSegment)) return false;
      const sourcePlaceholders = extractPlaceholders(String(activeSegment.src || ""));
      if (sourcePlaceholders.length === 0) return false;
      const token = sourcePlaceholders[indexOneBased - 1] ?? null;
      if (!token) return false;
      insertIntoActiveTarget(token);
      return true;
    },
    [activeSegment, insertIntoActiveTarget, taskReadOnly]
  );

  useEffect(() => {
    setCatResultIndex(0);
  }, [activeSegment?.id]);

  const navigateCatResults = useCallback(
    async (delta: 1 | -1) => {
      if (!activeSegment) return false;
      await editor.ensureTmHints([activeSegment]);
      const matches = editor.getTmMatchesForSegment(activeSegment.id);
      if (!matches || matches.length === 0) return false;
      setCatResultIndex((prev) => {
        const next = (prev + delta + matches.length) % matches.length;
        return next;
      });
      return true;
    },
    [activeSegment, editor]
  );

  const insertCatSuggestionByIndex = useCallback(
    async (indexOneBased: number) => {
      if (!activeSegment || taskReadOnly || isSegmentLocked(activeSegment)) return false;
      await editor.ensureTmHints([activeSegment]);
      const matches = editor.getTmMatchesForSegment(activeSegment.id);
      const match = matches[indexOneBased - 1];
      if (!match?.target) return false;
      const required = extractPlaceholders(String(activeSegment.src || ""));
      const provided = extractPlaceholders(String(match.target || ""));
      const requiredCounts = new Map<string, number>();
      const providedCounts = new Map<string, number>();
      for (const token of required) requiredCounts.set(token, (requiredCounts.get(token) ?? 0) + 1);
      for (const token of provided) providedCounts.set(token, (providedCounts.get(token) ?? 0) + 1);
      const missing: string[] = [];
      requiredCounts.forEach((count, token) => {
        const have = providedCounts.get(token) ?? 0;
        for (let i = have; i < count; i += 1) missing.push(token);
      });
      const baseTarget = String(match.target || "");
      const spacer = missing.length > 0 && baseTarget && !/\s$/.test(baseTarget) ? " " : "";
      const nextTarget = missing.length > 0 ? `${baseTarget}${spacer}${missing.join("")}` : baseTarget;
      editor.updateTarget(activeSegment.id, nextTarget, {
        sourceMeta: {
          type: "tmx",
          score: normalizeMatchScorePct(match),
          matchId: null
        },
        originDetails: {
          engineId: "tmx",
          matchScore: normalizeMatchScorePct(match)
        }
      });
      setCatResultIndex(indexOneBased - 1);
      focusTargetForSegment(activeSegment.id);
      return true;
    },
    [activeSegment, editor, focusTargetForSegment, taskReadOnly]
  );

  const goToNextTerminologyIssue = useCallback(() => {
    if (!activeSegment || filteredSegments.length === 0) return false;
    const currentIdx = filteredIndexById.get(activeSegment.id);
    if (currentIdx == null || currentIdx < 0) return false;
    const hasTermIssue = (segmentId: number) => {
      const issues = editor.issuesById[segmentId] ?? [];
      return issues.some((issue) => String(issue.code || "").toLowerCase().includes("term"));
    };
    const size = filteredSegments.length;
    for (let offset = 1; offset <= size; offset += 1) {
      const idx = (currentIdx + offset) % size;
      const candidate = filteredSegments[idx];
      if (!candidate) continue;
      if (!hasTermIssue(candidate.id)) continue;
      editor.setActiveId(candidate.id);
      setBottomPanelOpen(true);
      setBottomTab("qa");
      focusTargetForSegment(candidate.id);
      return true;
    }
    return false;
  }, [activeSegment, editor, filteredIndexById, filteredSegments, focusTargetForSegment]);

  const revertActiveSegmentStage = useCallback(async () => {
    if (!activeSegment || taskReadOnly) return false;
    if (!canRevertStage) return false;
    const status = normalizeSegmentStatus(activeSegment.status);
    const previousStatus = status === "reviewed" ? "under_review" : status === "under_review" ? "draft" : "draft";
    if (status === previousStatus) return false;
    const reverted = await editor.setSegmentStatus(activeSegment.id, previousStatus);
    if (reverted) focusTargetForSegment(activeSegment.id);
    return reverted;
  }, [activeSegment, canRevertStage, editor, focusTargetForSegment, taskReadOnly]);

  const confirmAndAdvance = useCallback(async () => {
    if (!activeSegment || taskReadOnly) return false;
    if (isSegmentLocked(activeSegment)) return false;
    return runConfirmAndAdvance({
      alreadyConfirmed: isSegmentConfirmed(activeSegment),
      reviewMode,
      confirm: () => editor.setSegmentStatus(activeSegment.id, reviewMode ? "reviewed" : "under_review"),
      moveNext: () => {
        goNextFiltered();
        const next = filteredSegments[activeFilteredIndex + 1];
        focusTargetForSegment(next?.id ?? null);
      },
      moveNextUnconfirmed: goToNextUnconfirmed
    });
  }, [
    activeFilteredIndex,
    activeSegment,
    editor,
    filteredSegments,
    focusTargetForSegment,
    goNextFiltered,
    goToNextUnconfirmed,
    isSegmentConfirmed,
    reviewMode,
    taskReadOnly
  ]);

  const toggleSourceTargetFocus = useCallback(() => {
    if (!activeSegment) return false;
    const activeElement = document.activeElement as HTMLElement | null;
    const inTarget = Boolean(
      activeElement?.closest("textarea.fc-modern-target-input, textarea.fc-editor-cell-input")
    );
    if (inTarget) {
      focusSourceForSegment(activeSegment.id);
      return true;
    }
    focusTargetForSegment(activeSegment.id);
    return true;
  }, [activeSegment, focusSourceForSegment, focusTargetForSegment]);

  useEffect(() => {
    if (!activeSegment) return;
    focusTargetForSegment(activeSegment.id);
  }, [activeSegment?.id, focusTargetForSegment]);

  const shortcutHelpItems = useMemo(() => {
    const actions: EditorHotkeyActionId[] = [
      "SEGMENT_CONFIRM",
      "NAV_NEXT",
      "NAV_PREV",
      "NAV_NEXT_UNCONFIRMED",
      "FOCUS_TOGGLE_SOURCE_TARGET",
      "NAV_NEXT_TERM_ISSUE",
      "COPY_SOURCE_TO_TARGET",
      "GOTO_SEGMENT_DIALOG",
      "OPEN_CONCORDANCE",
      "NAV_CAT_UP",
      "NAV_CAT_DOWN",
      ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((digit) => `INSERT_CAT_SUGGESTION_${digit}` as const),
      ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((digit) => `INSERT_TAG_${digit}` as const),
      "REVERT_STAGE"
    ];
    return actions.map((action) => ({
      id: action,
      label: hotkeyActionLabel(action),
      bindings: (hotkeyKeymap[action] ?? []).map((binding) => formatKeyBinding(binding, hotkeyPlatform))
    }));
  }, [hotkeyKeymap, hotkeyPlatform]);

  const updateSelectionFromEvent = useCallback(
    (segmentId: number, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
      editor.setActiveId(segmentId);
      const shift = Boolean(event.shiftKey);
      const toggle = Boolean(event.ctrlKey || event.metaKey);

      if (shift && selectionAnchorRef.current != null) {
        const from = filteredIndexById.get(selectionAnchorRef.current);
        const to = filteredIndexById.get(segmentId);
        if (from != null && to != null) {
          const start = Math.min(from, to);
          const end = Math.max(from, to);
          const ids = filteredSegments.slice(start, end + 1).map((seg) => seg.id);
          setSelectedIds(ids);
          return;
        }
      }

      if (toggle) {
        setSelectedIds((prev) =>
          prev.includes(segmentId) ? prev.filter((id) => id !== segmentId) : [...prev, segmentId]
        );
        selectionAnchorRef.current = segmentId;
        return;
      }

      setSelectedIds([segmentId]);
      selectionAnchorRef.current = segmentId;
    },
    [editor, filteredIndexById, filteredSegments]
  );

  const toggleSelectionOnly = useCallback(
    (segmentId: number) => {
      setSelectedIds((prev) =>
        prev.includes(segmentId) ? prev.filter((id) => id !== segmentId) : [...prev, segmentId]
      );
      selectionAnchorRef.current = segmentId;
      editor.setActiveId(segmentId);
    },
    [editor]
  );

  const selectedCount = selectedIds.length;

  const findMatchCount = editor.findMatchIndices.length;

  const saveLabel = saveLabelForState(editor.saveState);
  const saveToneClass =
    editor.saveState === "saved"
      ? "is-saved"
      : editor.saveState === "saving"
      ? "is-saving"
      : editor.saveState === "offline"
      ? "is-offline"
      : "is-error";

  const activeEditable = Boolean(activeSegment && !taskReadOnly && !isSegmentLocked(activeSegment));

  const richFormattingSupported = useMemo(() => {
    const fileType = String(
      editor.meta?.file?.fileType ?? activeSegment?.segmentContext?.fileType ?? ""
    )
      .trim()
      .toLowerCase();
    return fileType === "docx" || fileType === "pptx" || fileType === "xlsx";
  }, [activeSegment?.segmentContext?.fileType, editor.meta?.file?.fileType]);

  const getActiveSelectionContext = useCallback(() => {
    const active = editor.active;
    if (!active) return null;
    const input = document.querySelector(
      `textarea.fc-modern-target-input[data-segment-id="${active.id}"]`
    ) as HTMLTextAreaElement | null;
    const current = segmentTargetValue(active, editor.draftById);
    const rawStart = input ? input.selectionStart ?? current.length : 0;
    const rawEnd = input ? input.selectionEnd ?? rawStart : current.length;
    const start = Math.max(0, Math.min(current.length, rawStart));
    const end = Math.max(start, Math.min(current.length, rawEnd));
    const hasSelection = end > start;
    return {
      active,
      input,
      current,
      start,
      end,
      rangeStart: hasSelection ? start : 0,
      rangeEnd: hasSelection ? end : current.length
    };
  }, [editor]);

  const applyRunsToActiveSelection = useCallback(
    (buildRuns: (params: { current: string; activeId: number; rangeStart: number; rangeEnd: number }) => SegmentRun[]) => {
      if (!richFormattingSupported || !activeEditable) return false;
      const selection = getActiveSelectionContext();
      if (!selection) return false;
      if (!selection.current) return false;
      const nextRuns = normalizeRuns(
        buildRuns({
          current: selection.current,
          activeId: selection.active.id,
          rangeStart: selection.rangeStart,
          rangeEnd: selection.rangeEnd
        }),
        selection.current
      );
      editor.updateTarget(selection.active.id, selection.current, { runs: nextRuns });
      if (selection.input) {
        window.requestAnimationFrame(() => {
          try {
            selection.input?.focus();
            selection.input?.setSelectionRange(selection.start, selection.end);
          } catch {
            // ignore selection errors
          }
        });
      }
      return true;
    },
    [activeEditable, editor, getActiveSelectionContext, richFormattingSupported]
  );

  const changeFontSizeForActiveSelection = useCallback(
    (deltaPt: number) => {
      return applyRunsToActiveSelection(({ current, activeId, rangeStart, rangeEnd }) => {
        const runs = editor.getCurrentTargetRuns(activeId);
        return adjustFontSizeInRange({
          runs,
          text: current,
          start: rangeStart,
          end: rangeEnd,
          deltaPt,
          minPt: 6,
          maxPt: 96
        });
      });
    },
    [applyRunsToActiveSelection, editor]
  );

  const toggleBoldForActiveSelection = useCallback(() => {
    return applyRunsToActiveSelection(({ current, activeId, rangeStart, rangeEnd }) => {
      const runs = normalizeRuns(editor.getCurrentTargetRuns(activeId), current);
      let cursor = 0;
      let hasOverlap = false;
      let allBold = true;
      for (const run of runs) {
        const text = String(run.text ?? "");
        if (!text) continue;
        const nextCursor = cursor + text.length;
        const overlapStart = Math.max(cursor, rangeStart);
        const overlapEnd = Math.min(nextCursor, rangeEnd);
        if (overlapStart < overlapEnd) {
          hasOverlap = true;
          if (run.style?.bold !== true) allBold = false;
        }
        cursor = nextCursor;
      }
      const nextBold = hasOverlap ? !allBold : true;
      return applyStylePatchToRange({
        runs,
        text: current,
        start: rangeStart,
        end: rangeEnd,
        patch: { bold: nextBold }
      });
    });
  }, [applyRunsToActiveSelection, editor]);

  const insertSymbol = useCallback(
    (symbol: string) => {
      if (!symbol) return;
      insertIntoActiveTarget(symbol);
      if (symbolsMenuRef.current) symbolsMenuRef.current.open = false;
    },
    [insertIntoActiveTarget]
  );

  const { openConcordanceShortcut } = useModernEditorHotkeys({
    activeFilteredIndex,
    activeSegment,
    concordanceInputRef,
    confirmAndAdvance,
    copySourceToTarget,
    editorRootRef,
    filteredSegments,
    focusTargetForSegment,
    goNextFiltered,
    goPrevFiltered,
    goToNextTerminologyIssue,
    goToNextUnconfirmed,
    hotkeyKeymap,
    insertCatSuggestionByIndex,
    insertTagByIndex,
    navigateCatResults,
    openFindModal,
    openGoToSegmentDialog,
    revertActiveSegmentStage,
    setRightSidebarOpen,
    toggleSourceTargetFocus
  });
  const retryImport = useCallback(
    async (projectId: number) => {
      try {
        setRetryingImport(true);
        await retryProjectProvision(projectId);
        nav(`/projects/${projectId}/provisioning`, { replace: true });
      } catch (err: any) {
        window.alert(err?.userMessage || err?.message || "Retry import failed.");
      } finally {
        setRetryingImport(false);
      }
    },
    [nav]
  );

  const { doComplete, doDownload, downloadReady } = useModernEditorTaskActions({
    currentUser: currentUser ?? {},
    editor,
    fileId,
    nav,
    taskId,
    taskReadOnly
  });

  if (!currentUser) {
    return <ModernEditorStatusState mode="loading" />;
  }

  if (editor.error) {
    const projectId = editor.errorProjectId ?? editor.projectId;
    const isProjectFailure = editor.errorCode === "PROJECT_FAILED";
    return (
      <ModernEditorStatusState
        detail={isProjectFailure ? "Segment preparation failed. Open Logs/Status to inspect processing details." : null}
        message={editor.error}
        mode="error"
        onBack={() => nav("/inbox")}
        onOpenProvisioning={() => nav(`/projects/${projectId}/provisioning`)}
        onRetry={editor.reload}
        onRetryImport={() => (projectId ? void retryImport(projectId) : undefined)}
        projectId={projectId}
        retryingImport={retryingImport}
      />
    );
  }

  if (!editor.loading && editor.segments.length === 0) {
    const projectId = editor.projectId ?? editor.errorProjectId;
    return (
      <ModernEditorStatusState
        detail="Check processing logs and retry import if needed."
        message="No segments extracted for this file."
        mode="empty"
        onBack={() => nav("/inbox")}
        onOpenProvisioning={() => nav(`/projects/${projectId}/provisioning`)}
        onRetryImport={() => (projectId ? void retryImport(projectId) : undefined)}
        projectId={projectId}
        retryingImport={retryingImport}
      />
    );
  }

  const activeFilters = filterCount({
    statusFilter,
    untranslatedOnly,
    draftOnly,
    reviewedOnly,
    withQaOnly,
    lockedOnly,
    termHitsOnly,
    ntmDraftOnly,
    tmxOnly,
    skippedOnly,
    problematicOnly
  });
  return (
    <>
      <ModernEditorFileLayout
        {...{
          editorRootRef,
          active: activeSegment,
          activeEditable,
          activeFilteredIndex,
          activeFilters,
          activeSegment,
          changeFontSizeForActiveSelection,
          bottomPanelOpen,
          bottomTab,
          bulkBusy,
          bulkApproveBusy: bulkBusy,
          bulkApproveJob,
          onDismissBulkApproveJob: () => setBulkApproveJob(null),
          onOpenBulkApproveDialog: openBulkApproveDialog,
          ntmDraftOnly,
          tmxOnly,
          skippedOnly,
          problematicOnly,
          hasSkippedFilterData: lastSkippedIds.length > 0,
          hasProblematicFilterData: lastProblematicIds.length > 0,
          setNtmDraftOnly,
          setTmxOnly,
          setSkippedOnly,
          setProblematicOnly,
          bottomPanelHeight,
          bulkClearTargets,
          bulkLock,
          bulkMarkReviewed,
          canGoFilteredNext,
          canGoFilteredPrev,
          concordanceInputRef,
          concordanceQuery,
          concordanceResults,
          concordanceSearchError,
          concordanceSearchIn,
          concordanceSearchLoading,
          copyToClipboard,
          doComplete,
          doDownload,
          downloadReady,
          draftOnly,
          editor,
          EDITOR_FONT_SIZE_MAX,
          EDITOR_FONT_SIZE_MIN,
          EDITOR_FONT_SIZE_STEP,
          editorFontSize,
          fileId,
          filteredIndexById,
          filteredSegments,
          findMatchCount,
          findReplaceMode,
          findReplaceOpen,
          generateMt,
          goNextFiltered,
          goPrevFiltered,
          highlightConcordanceMatch,
          historyEntries,
          historyError,
          historyLoading,
          insertSymbol,
          isDeprecatedTerm,
          isSegmentLocked,
          lockedOnly,
          mtGeneratingSet,
          nav,
          openConcordanceShortcut,
          openFindModal,
          previewEnabled,
          previewLayout,
          onBottomPanelResizeStart: startBottomPanelResize,
          projectId: editor.projectId,
          reviewedOnly,
          rightSidebarOpen,
          renderPlainText,
          renderWithTags,
          saveLabel,
          saveToneClass,
          segmentState,
          segmentTargetValue,
          selectedCount,
          renderedPreviewConfiguredMethod,
          renderedPreviewDetails,
          renderedPreviewError,
          renderedPreviewErrorDetails,
          renderedPreviewLoading,
          renderedPreviewLogs,
          renderedPreviewPreviewId,
          renderedPreviewRevisionId,
          renderedPreviewStatus,
          renderedPreviewSupported,
          renderedPreviewWarnings,
          onRenderedPreviewOpenNewTab: openRenderedPreviewInNewTab,
          onRenderedPreviewRefresh: refreshRenderedPreviewNow,
          selectedIds,
          selectedSet,
          setBottomPanelOpen,
          setBottomTab,
          setConcordanceQuery,
          setConcordanceSearchIn,
          setDraftOnly,
          setEnableConcordanceCtrlK,
          setFindReplaceOpen,
          setLockedOnly,
          setPreviewEnabled,
          setPreviewLayout,
          setReviewedOnly,
          setRightSidebarOpen,
          setShowFilters,
          setShowTags,
          setShowWhitespace,
          setSourceSearch,
          setStatusFilter,
          setTargetSearch,
          setTermHitsOnly,
          setUntranslatedOnly,
          setWithQaOnly,
          showFilters,
          showTags,
          showWhitespace,
          sourceLang: editor.sourceLang,
          sourceSearch,
          statusFilter,
          stripInline,
          SYMBOL_PICKER_ITEMS: MODERN_EDITOR_SYMBOL_PICKER_ITEMS,
          symbolsMenuRef,
          targetLang: editor.targetLang,
          targetSearch,
          taskId,
          taskReadOnly,
          TERMBASE_CONCORDANCE_MIN_QUERY,
          termbaseDisplaySource,
          termbaseEntryCategory,
          previewBlockMeta,
          richFormattingSupported,
          termHitsOnly,
          toggleBoldForActiveSelection,
          toggleSelectionOnly,
          untranslatedOnly,
          updateSelectionFromEvent,
          withQaOnly,
          enableConcordanceCtrlK,
          shortcutHelpItems,
          catResultIndex,
          insertCatSuggestionByIndex
        }}
      />

      <ModernEditorBulkApproveModals
        bulkApproveAckQa={bulkApproveAckQa}
        bulkApproveDialog={bulkApproveDialog}
        bulkApproveSummary={bulkApproveSummary}
        onCloseDialog={() => {
          if (bulkApproveDialog?.loading) return;
          setBulkApproveDialog(null);
        }}
        onCloseSummary={() => setBulkApproveSummary(null)}
        onConfirmDialog={() => void confirmBulkApprove()}
        onOpenProblematicSegments={() => {
          if (!bulkApproveSummary || bulkApproveSummary.summary.problematicSegmentIds.length === 0) return;
          setProblematicOnly(true);
          setSkippedOnly(false);
          setShowFilters(true);
          setBulkApproveSummary(null);
        }}
        onOpenSkippedSegments={() => {
          if (!bulkApproveSummary || bulkApproveSummary.summary.skippedSegmentIds.length === 0) return;
          setSkippedOnly(true);
          setProblematicOnly(false);
          setShowFilters(true);
          setBulkApproveSummary(null);
        }}
        setBulkApproveAckQa={setBulkApproveAckQa}
      />
    </>
  );
}
