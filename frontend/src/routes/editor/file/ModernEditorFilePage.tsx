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

type BottomTab = "history" | "qa" | "segment_comments" | "document_comments" | "rendered_preview" | "rendered_status";
type PreviewLayout = "split" | "side";
type StatusFilter = "all" | "draft" | "under_review" | "reviewed";
type BulkApproveAction = EditorBulkApproveScope;

type EditorFilterPrefs = {
  statusFilter: StatusFilter;
  untranslatedOnly: boolean;
  draftOnly: boolean;
  reviewedOnly: boolean;
  withQaOnly: boolean;
  lockedOnly: boolean;
  termHitsOnly: boolean;
  ntmDraftOnly: boolean;
  tmxOnly: boolean;
};

type ModernViewPrefs = {
  rightSidebarOpen: boolean;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  previewEnabled: boolean;
  previewLayout: PreviewLayout;
  showWhitespace: boolean;
  showTags: boolean;
};

const VIEW_PREF_KEY_PREFIX = "fc:editor:modern:view:";
const FONT_PREF_KEY_PREFIX = "fc:editor:modern:font-size:";
const FILTER_PREF_KEY_PREFIX = "fc:editor:modern:filters:";
const TERMBASE_CONCORDANCE_MIN_QUERY = 2;
const TERMBASE_CONCORDANCE_CACHE_TTL_MS = 45_000;
const TERMBASE_CONCORDANCE_DEBOUNCE_MS = 320;
const EDITOR_FONT_SIZE_MIN = 13;
const EDITOR_FONT_SIZE_MAX = 19;
const EDITOR_FONT_SIZE_STEP = 1;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const BOTTOM_PANEL_MIN_HEIGHT = 180;
const BOTTOM_PANEL_MAX_HEIGHT = 640;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 300;
const HOTKEY_PREF_KEY_PREFIX = "fc:editor:modern:hotkeys:";
const RENDERED_PREVIEW_DEBOUNCE_MS = 1500;
const RENDERED_PREVIEW_POLL_MS = 1200;
const RENDERED_PREVIEW_POLL_TIMEOUT_MS = 60_000;
const SYMBOL_PICKER_ITEMS = [
  "©",
  "®",
  "™",
  "°",
  "±",
  "≈",
  "≠",
  "≤",
  "≥",
  "→",
  "←",
  "•",
  "…",
  "€",
  "£",
  "¥",
  "§",
  "¶",
  "—",
  "–",
  "✓",
  "✕"
] as const;

const BULK_SKIP_REASON_LABELS: Record<string, string> = {
  already_reviewed: "Already approved",
  empty_target: "Empty target",
  qa_issues: "QA issues",
  locked: "Locked",
  permission_denied: "Permission denied",
  task_read_only: "Task is read-only",
  update_failed: "Update failed"
};

const DEFAULT_FILTER_PREFS: EditorFilterPrefs = {
  statusFilter: "all",
  untranslatedOnly: false,
  draftOnly: false,
  reviewedOnly: false,
  withQaOnly: false,
  lockedOnly: false,
  termHitsOnly: false,
  ntmDraftOnly: false,
  tmxOnly: false
};

const DEFAULT_VIEW_PREFS: ModernViewPrefs = {
  rightSidebarOpen: true,
  bottomPanelOpen: true,
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
  previewEnabled: true,
  previewLayout: "split",
  showWhitespace: false,
  showTags: true
};

function viewPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${VIEW_PREF_KEY_PREFIX}${scope}`;
}

function fontPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${FONT_PREF_KEY_PREFIX}${scope}`;
}

function filterPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${FILTER_PREF_KEY_PREFIX}${scope}`;
}

type HotkeyPrefs = {
  enableConcordanceCtrlK: boolean;
};

function hotkeyPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${HOTKEY_PREF_KEY_PREFIX}${scope}`;
}

function readHotkeyPrefs(key: string): HotkeyPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return { enableConcordanceCtrlK: true };
    }
    const parsed = JSON.parse(raw) as Partial<HotkeyPrefs>;
    return {
      enableConcordanceCtrlK: parsed.enableConcordanceCtrlK !== false
    };
  } catch {
    return { enableConcordanceCtrlK: true };
  }
}

function writeHotkeyPrefs(key: string, prefs: HotkeyPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function readFilterPrefs(key: string): EditorFilterPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_FILTER_PREFS;
    const parsed = JSON.parse(raw) as Partial<EditorFilterPrefs>;
    const status =
      parsed.statusFilter === "draft" || parsed.statusFilter === "under_review" || parsed.statusFilter === "reviewed"
        ? parsed.statusFilter
        : "all";
    return {
      statusFilter: status,
      untranslatedOnly: parsed.untranslatedOnly === true,
      draftOnly: parsed.draftOnly === true,
      reviewedOnly: parsed.reviewedOnly === true,
      withQaOnly: parsed.withQaOnly === true,
      lockedOnly: parsed.lockedOnly === true,
      termHitsOnly: parsed.termHitsOnly === true,
      ntmDraftOnly: parsed.ntmDraftOnly === true,
      tmxOnly: parsed.tmxOnly === true
    };
  } catch {
    return DEFAULT_FILTER_PREFS;
  }
}

function writeFilterPrefs(key: string, prefs: EditorFilterPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function readViewPrefs(key: string): ModernViewPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_VIEW_PREFS;
    const parsed = JSON.parse(raw) as Partial<ModernViewPrefs>;
    const parsedBottomPanelHeight = Number(parsed.bottomPanelHeight);
    const bottomPanelHeight = Number.isFinite(parsedBottomPanelHeight)
      ? Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(BOTTOM_PANEL_MAX_HEIGHT, Math.round(parsedBottomPanelHeight)))
      : DEFAULT_BOTTOM_PANEL_HEIGHT;
    return {
      rightSidebarOpen: parsed.rightSidebarOpen ?? DEFAULT_VIEW_PREFS.rightSidebarOpen,
      bottomPanelOpen: parsed.bottomPanelOpen ?? DEFAULT_VIEW_PREFS.bottomPanelOpen,
      bottomPanelHeight,
      previewEnabled: parsed.previewEnabled ?? DEFAULT_VIEW_PREFS.previewEnabled,
      previewLayout: parsed.previewLayout === "side" ? "side" : "split",
      showWhitespace: parsed.showWhitespace ?? DEFAULT_VIEW_PREFS.showWhitespace,
      showTags: parsed.showTags ?? DEFAULT_VIEW_PREFS.showTags
    };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

function writeViewPrefs(key: string, prefs: ModernViewPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function readEditorFontSize(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_EDITOR_FONT_SIZE;
    return Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, Math.round(parsed)));
  } catch {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
}

function normalizeReviewGateStatus(value: string | null | undefined): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

function canDownloadReviewedOutput(taskStatus: string | null | undefined) {
  return normalizeReviewGateStatus(taskStatus) === "reviewed";
}

function writeEditorFontSize(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function mixHash(current: number, value: number) {
  return (((current << 5) - current + value) >>> 0);
}

function buildRenderedPreviewRevisionToken(taskId: number, segments: Segment[], draftById: Record<number, string>) {
  let hash = mixHash(2166136261, taskId);
  for (const segment of segments) {
    hash = mixHash(hash, Number(segment.id) || 0);
    hash = mixHash(hash, Number(segment.version ?? 0) || 0);
    hash = mixHash(hash, Number(segment.status?.length ?? 0));
  }
  const draftEntries = Object.entries(draftById).sort(([a], [b]) => Number(a) - Number(b));
  hash = mixHash(hash, draftEntries.length);
  for (const [id, valueRaw] of draftEntries) {
    const value = String(valueRaw ?? "");
    hash = mixHash(hash, Number(id) || 0);
    hash = mixHash(hash, value.length);
    if (value.length > 0) {
      hash = mixHash(hash, value.charCodeAt(0));
      hash = mixHash(hash, value.charCodeAt(value.length - 1));
    }
  }
  return `r${hash.toString(16)}`;
}

function stripInline(value: string) {
  return String(value || "")
    .replace(/<\/?\d+>/g, " ")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function segmentState(segment: Segment): "draft" | "nmt_draft" | "under_review" | "reviewed" {
  const status = normalizeSegmentStatus(segment.status);
  if (status === "under_review") return "under_review";
  const state = coerceSegmentState(segment.state, status);
  if (state === "reviewed") return "reviewed";
  if (state === "nmt_draft") return "nmt_draft";
  return "draft";
}

function isSegmentLocked(segment: Segment) {
  const state = segmentState(segment);
  return segment.isLocked === undefined ? state === "reviewed" : Boolean(segment.isLocked);
}

function segmentTargetValue(segment: Segment, draftById: Record<number, string>) {
  const hasDraft = Object.prototype.hasOwnProperty.call(draftById, segment.id);
  return hasDraft ? String(draftById[segment.id] ?? "") : String(segment.tgt ?? "");
}

function normalizeMatchScorePct(match: Match) {
  const raw = Number(match.score ?? 0);
  const normalized = raw <= 1 ? raw * 100 : raw;
  return Math.round(Math.max(0, Math.min(100, normalized)));
}

async function copyToClipboard(value: string) {
  if (!value.trim()) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // ignore
  }
}

function saveLabelForState(state: "saved" | "saving" | "offline" | "error") {
  if (state === "saving") return "Saving...";
  if (state === "offline") return "Offline (queued)";
  if (state === "error") return "Save issue";
  return "All changes saved";
}

function previewBlockMeta(source: string) {
  const heading = source.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/i);
  if (heading) {
    return { kind: "heading" as const, level: Number(heading[1] ?? 2) };
  }
  return { kind: "paragraph" as const, level: 0 };
}

function termbaseDisplaySource(entry: TermbaseConcordanceEntry) {
  if (entry.matches && entry.matches.length > 0) {
    return entry.matches[0]?.term || entry.sourceTerms[0]?.text || "";
  }
  return entry.sourceTerms[0]?.text || "";
}

function termbaseEntryCategory(entry: TermbaseConcordanceEntry) {
  const fields = entry.entryFields;
  if (!fields || typeof fields !== "object") return "";
  const map = fields as Record<string, unknown>;
  const keys = ["Category", "Kategorie", "Domain", "Product type", "Produkttyp", "ProductType"];
  for (const key of keys) {
    const value = map[key];
    if (value == null) continue;
    const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : String(value);
    if (text.trim()) return text.trim();
  }
  return "";
}

function isDeprecatedTerm(term: { status?: string } | undefined, entry: TermbaseConcordanceEntry) {
  if (!term) return false;
  const status = String(term.status || "").toLowerCase();
  if (status === "deprecated") return true;
  const fields = entry.entryFields;
  if (!fields || typeof fields !== "object") return false;
  const map = fields as Record<string, unknown>;
  const raw = map.deprecated ?? map.Deprecated;
  if (typeof raw === "boolean") return raw;
  return String(raw || "").toLowerCase() === "true";
}

function highlightConcordanceMatch(value: string, query: string) {
  const text = String(value || "");
  const needle = query.trim();
  if (!needle) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const pieces: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (from < text.length) {
    const idx = lowerText.indexOf(lowerNeedle, from);
    if (idx < 0) {
      pieces.push(text.slice(from));
      break;
    }
    if (idx > from) pieces.push(text.slice(from, idx));
    pieces.push(
      <mark key={`${text}:${idx}:${key}`} className="fc-modern-highlight">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    key += 1;
    from = idx + needle.length;
  }
  return pieces;
}

function filterCount(params: {
  statusFilter: StatusFilter;
  untranslatedOnly: boolean;
  draftOnly: boolean;
  reviewedOnly: boolean;
  withQaOnly: boolean;
  lockedOnly: boolean;
  termHitsOnly: boolean;
  ntmDraftOnly: boolean;
  tmxOnly: boolean;
  skippedOnly: boolean;
  problematicOnly: boolean;
}) {
  return (
    (params.statusFilter !== "all" ? 1 : 0) +
    (params.untranslatedOnly ? 1 : 0) +
    (params.draftOnly ? 1 : 0) +
    (params.reviewedOnly ? 1 : 0) +
    (params.withQaOnly ? 1 : 0) +
    (params.lockedOnly ? 1 : 0) +
    (params.termHitsOnly ? 1 : 0) +
    (params.ntmDraftOnly ? 1 : 0) +
    (params.tmxOnly ? 1 : 0) +
    (params.skippedOnly ? 1 : 0) +
    (params.problematicOnly ? 1 : 0)
  );
}

function bulkActionLabel(action: BulkApproveAction) {
  if (action === "all") return "Approve all";
  if (action === "visible") return "Approve visible";
  return "Approve clean translation";
}

function bulkActionScopeText(action: BulkApproveAction) {
  if (action === "all") return "All segments in the current file";
  if (action === "visible") return "Only currently visible segments (active filters)";
  return "Only QA-clean segments with non-empty target";
}

function skipReasonLabel(reason: string) {
  return BULK_SKIP_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

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

  const prefStorageKey = useMemo(() => viewPrefKey(currentUser), [currentUser]);
  const hotkeyPrefStorageKey = useMemo(() => hotkeyPrefKey(currentUser), [currentUser]);
  const filterPrefStorageKey = useMemo(() => filterPrefKey(currentUser), [currentUser]);

  const [rightSidebarOpen, setRightSidebarOpen] = useState(DEFAULT_VIEW_PREFS.rightSidebarOpen);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(DEFAULT_VIEW_PREFS.bottomPanelOpen);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_VIEW_PREFS.bottomPanelHeight);
  const [previewEnabled, setPreviewEnabled] = useState(DEFAULT_VIEW_PREFS.previewEnabled);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout>(DEFAULT_VIEW_PREFS.previewLayout);
  const [showWhitespace, setShowWhitespace] = useState(DEFAULT_VIEW_PREFS.showWhitespace);
  const [showTags, setShowTags] = useState(DEFAULT_VIEW_PREFS.showTags);

  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [untranslatedOnly, setUntranslatedOnly] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [withQaOnly, setWithQaOnly] = useState(false);
  const [lockedOnly, setLockedOnly] = useState(false);
  const [termHitsOnly, setTermHitsOnly] = useState(false);
  const [ntmDraftOnly, setNtmDraftOnly] = useState(false);
  const [tmxOnly, setTmxOnly] = useState(false);
  const [skippedOnly, setSkippedOnly] = useState(false);
  const [problematicOnly, setProblematicOnly] = useState(false);

  const [bottomTab, setBottomTab] = useState<BottomTab>("rendered_preview");
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">("find");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionAnchorRef = useRef<number | null>(null);

  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkApproveDialog, setBulkApproveDialog] = useState<{
    action: BulkApproveAction;
    estimate: EditorBulkApproveEstimate | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [bulkApproveAckQa, setBulkApproveAckQa] = useState(false);
  const [bulkApproveJob, setBulkApproveJob] = useState<EditorBulkJobStatusResponse | null>(null);
  const [bulkApproveSummary, setBulkApproveSummary] = useState<{
    action: BulkApproveAction;
    estimated: EditorBulkApproveEstimate;
    summary: EditorBulkJobSummary;
  } | null>(null);
  const bulkApprovePollTimerRef = useRef<number | null>(null);
  const [lastSkippedIds, setLastSkippedIds] = useState<number[]>([]);
  const [lastProblematicIds, setLastProblematicIds] = useState<number[]>([]);
  const [historyEntries, setHistoryEntries] = useState<SegmentHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [concordanceQuery, setConcordanceQuery] = useState("");
  const [concordanceSearchIn, setConcordanceSearchIn] = useState<"source" | "target">("source");
  const [concordanceResults, setConcordanceResults] = useState<TermbaseConcordanceEntry[]>([]);
  const [concordanceSearchLoading, setConcordanceSearchLoading] = useState(false);
  const [concordanceSearchError, setConcordanceSearchError] = useState<string | null>(null);
  const concordanceAbortRef = useRef<AbortController | null>(null);
  const concordanceCacheRef = useRef<Map<string, { timestamp: number; entries: TermbaseConcordanceEntry[] }>>(new Map());
  const concordanceInputRef = useRef<HTMLInputElement | null>(null);

  const fontStorageKey = useMemo(() => fontPrefKey(currentUser), [currentUser]);
  const [editorFontSize, setEditorFontSize] = useState(DEFAULT_EDITOR_FONT_SIZE);
  const [enableConcordanceCtrlK, setEnableConcordanceCtrlK] = useState(true);
  const symbolsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [catResultIndex, setCatResultIndex] = useState(0);

  const [mtGeneratingIds, setMtGeneratingIds] = useState<number[]>([]);
  const mtGeneratingSet = useMemo(() => new Set(mtGeneratingIds), [mtGeneratingIds]);

  const [renderedPreviewStatus, setRenderedPreviewStatus] = useState<string>("idle");
  const [renderedPreviewLoading, setRenderedPreviewLoading] = useState(false);
  const [renderedPreviewPreviewId, setRenderedPreviewPreviewId] = useState<string | null>(null);
  const [renderedPreviewDetails, setRenderedPreviewDetails] = useState<RenderedPreviewDetailsResponse | null>(null);
  const [renderedPreviewError, setRenderedPreviewError] = useState<string | null>(null);
  const [renderedPreviewErrorDetails, setRenderedPreviewErrorDetails] = useState<string | null>(null);
  const [renderedPreviewWarnings, setRenderedPreviewWarnings] = useState<string[]>([]);
  const [renderedPreviewLogs, setRenderedPreviewLogs] = useState<string[]>([]);
  const renderedPreviewPollTimerRef = useRef<number | null>(null);
  const renderedPreviewPollStartedAtRef = useRef<number>(0);
  const renderedPreviewLastRequestAtRef = useRef<number>(0);
  const bottomPanelResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const didAutoResetFiltersRef = useRef(false);
  const [retryingImport, setRetryingImport] = useState(false);

  const hotkeyKeymap: EditorHotkeyMap = useMemo(
    () =>
      createDefaultEditorKeymap(hotkeyPlatform, {
        enableConcordanceCtrlK
      }),
    [enableConcordanceCtrlK, hotkeyPlatform]
  );

  const renderedPreviewSupported = Boolean(editor.meta?.renderedPreview?.supported && editor.projectId && fileId);
  const renderedPreviewConfiguredMethod = editor.meta?.renderedPreview?.method ?? null;
  const renderedPreviewRevisionId = useMemo(
    () => buildRenderedPreviewRevisionToken(taskId, editor.segments, editor.draftById),
    [editor.draftById, editor.segments, taskId]
  );
  const renderedPreviewContextKey = `${editor.projectId ?? "none"}:${fileId ?? "none"}:${taskId}:${editor.targetLang ?? "none"}:${
    renderedPreviewConfiguredMethod ?? "none"
  }`;

  useEffect(() => {
    const prefs = readViewPrefs(prefStorageKey);
    setRightSidebarOpen(prefs.rightSidebarOpen);
    setBottomPanelOpen(prefs.bottomPanelOpen);
    setBottomPanelHeight(prefs.bottomPanelHeight);
    setPreviewEnabled(prefs.previewEnabled);
    setPreviewLayout(prefs.previewLayout);
    setShowWhitespace(prefs.showWhitespace);
    setShowTags(prefs.showTags);
  }, [prefStorageKey]);

  useEffect(() => {
    writeViewPrefs(prefStorageKey, {
      rightSidebarOpen,
      bottomPanelOpen,
      bottomPanelHeight,
      previewEnabled,
      previewLayout,
      showWhitespace,
      showTags
    });
  }, [
    bottomPanelHeight,
    bottomPanelOpen,
    prefStorageKey,
    previewEnabled,
    previewLayout,
    rightSidebarOpen,
    showTags,
    showWhitespace
  ]);

  useEffect(() => {
    setEditorFontSize(readEditorFontSize(fontStorageKey));
  }, [fontStorageKey]);

  useEffect(() => {
    const prefs = readHotkeyPrefs(hotkeyPrefStorageKey);
    setEnableConcordanceCtrlK(prefs.enableConcordanceCtrlK);
  }, [hotkeyPrefStorageKey]);

  useEffect(() => {
    writeEditorFontSize(fontStorageKey, editorFontSize);
  }, [editorFontSize, fontStorageKey]);

  useEffect(() => {
    writeHotkeyPrefs(hotkeyPrefStorageKey, {
      enableConcordanceCtrlK
    });
  }, [enableConcordanceCtrlK, hotkeyPrefStorageKey]);

  useEffect(() => {
    const prefs = readFilterPrefs(filterPrefStorageKey);
    setStatusFilter(prefs.statusFilter);
    setUntranslatedOnly(prefs.untranslatedOnly);
    setDraftOnly(prefs.draftOnly);
    setReviewedOnly(prefs.reviewedOnly);
    setWithQaOnly(prefs.withQaOnly);
    setLockedOnly(prefs.lockedOnly);
    setTermHitsOnly(prefs.termHitsOnly);
    setNtmDraftOnly(prefs.ntmDraftOnly);
    setTmxOnly(prefs.tmxOnly);
  }, [filterPrefStorageKey]);

  useEffect(() => {
    writeFilterPrefs(filterPrefStorageKey, {
      statusFilter,
      untranslatedOnly,
      draftOnly,
      reviewedOnly,
      withQaOnly,
      lockedOnly,
      termHitsOnly,
      ntmDraftOnly,
      tmxOnly
    });
  }, [
    draftOnly,
    filterPrefStorageKey,
    lockedOnly,
    ntmDraftOnly,
    reviewedOnly,
    statusFilter,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  ]);

  useEffect(() => {
    didAutoResetFiltersRef.current = false;
  }, [taskId]);

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
    editor.setShowWhitespace(showWhitespace);
  }, [editor.setShowWhitespace, showWhitespace]);

  useEffect(() => {
    editor.setShowTags(showTags);
  }, [editor.setShowTags, showTags]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const resizeState = bottomPanelResizeStateRef.current;
      if (!resizeState) return;
      const delta = resizeState.startY - event.clientY;
      const nextHeight = resizeState.startHeight + delta;
      const clamped = Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(BOTTOM_PANEL_MAX_HEIGHT, Math.round(nextHeight)));
      setBottomPanelHeight(clamped);
    };
    const endResize = () => {
      if (!bottomPanelResizeStateRef.current) return;
      bottomPanelResizeStateRef.current = null;
      document.body.classList.remove("fc-modern-editor-resizing");
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endResize);
    window.addEventListener("mouseleave", endResize);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endResize);
      window.removeEventListener("mouseleave", endResize);
      document.body.classList.remove("fc-modern-editor-resizing");
    };
  }, []);

  useEffect(() => {
    const isPreparingError =
      editor.errorCode === "PROJECT_PREPARING" ||
      (editor.errorStatus === 423 && (!editor.errorCode || editor.errorCode === "PROJECT_PREPARING"));
    if (!isPreparingError) return;
    const projectId = editor.errorProjectId;
    if (!projectId) return;
    nav(`/projects/${projectId}/provisioning`, { replace: true });
  }, [editor.errorCode, editor.errorProjectId, editor.errorStatus, nav]);

  const clearRenderedPreviewPollTimer = useCallback(() => {
    if (renderedPreviewPollTimerRef.current != null) {
      window.clearTimeout(renderedPreviewPollTimerRef.current);
      renderedPreviewPollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRenderedPreviewPollTimer();
    };
  }, [clearRenderedPreviewPollTimer]);

  useEffect(() => {
    clearRenderedPreviewPollTimer();
    renderedPreviewLastRequestAtRef.current = 0;
    renderedPreviewPollStartedAtRef.current = 0;
    setRenderedPreviewPreviewId(null);
    setRenderedPreviewDetails(null);
    setRenderedPreviewError(null);
    setRenderedPreviewErrorDetails(null);
    setRenderedPreviewWarnings([]);
    setRenderedPreviewLogs([]);
    setRenderedPreviewStatus(renderedPreviewSupported ? "idle" : "disabled");
  }, [clearRenderedPreviewPollTimer, renderedPreviewContextKey, renderedPreviewSupported]);

  useEffect(() => {
    if (renderedPreviewSupported) return;
    clearRenderedPreviewPollTimer();
    setRenderedPreviewStatus("disabled");
    setRenderedPreviewPreviewId(null);
    setRenderedPreviewDetails(null);
    setRenderedPreviewError(null);
    setRenderedPreviewErrorDetails(null);
    setRenderedPreviewWarnings([]);
    setRenderedPreviewLogs([]);
    if (bottomTab === "rendered_preview" || bottomTab === "rendered_status") {
      setBottomTab("history");
    }
  }, [bottomTab, clearRenderedPreviewPollTimer, renderedPreviewSupported]);

  useEffect(() => {
    if (!renderedPreviewSupported) return;
    if (editor.meta?.renderedPreview?.defaultOn) {
      setBottomPanelOpen(true);
    }
  }, [editor.meta?.renderedPreview?.defaultOn, renderedPreviewSupported]);

  const loadRenderedPreviewDetails = useCallback(
    async (previewId: string | number) => {
      const details = await getRenderedPreviewDetails(previewId);
      setRenderedPreviewPreviewId(String(details.previewId ?? previewId));
      setRenderedPreviewDetails(details);
      setRenderedPreviewStatus(String(details.status || "ready"));
      setRenderedPreviewWarnings(Array.isArray(details.warnings) ? details.warnings : []);
      setRenderedPreviewLogs(Array.isArray(details.logs) ? details.logs : []);
      setRenderedPreviewError(details.error ? String(details.error) : null);
      setRenderedPreviewErrorDetails(details.details ? String(details.details) : null);
      return details;
    },
    []
  );

  const pollRenderedPreviewStatus = useCallback(async function pollRenderedPreviewStatusInternal() {
    if (!renderedPreviewSupported || !editor.projectId || !fileId || !renderedPreviewConfiguredMethod) return;
    try {
      const status = await getRenderedPreviewStatus({
        projectId: editor.projectId,
        fileId,
        taskId,
        targetLang: editor.targetLang || undefined,
        draftRevisionId: renderedPreviewRevisionId,
        previewMethod: renderedPreviewConfiguredMethod
      });
      setRenderedPreviewStatus(String(status.status || "idle"));
      setRenderedPreviewPreviewId(status.previewId ? String(status.previewId) : null);
      setRenderedPreviewWarnings(Array.isArray(status.warnings) ? status.warnings : []);
      setRenderedPreviewLogs(Array.isArray(status.logs) ? status.logs : []);
      if (status.error) {
        setRenderedPreviewError(String(status.error));
      }

      if (String(status.status) === "ready" && status.previewId) {
        clearRenderedPreviewPollTimer();
        await loadRenderedPreviewDetails(status.previewId);
        return;
      }
      if (String(status.status) === "error") {
        clearRenderedPreviewPollTimer();
        if (status.previewId) {
          try {
            await loadRenderedPreviewDetails(status.previewId);
          } catch (err: any) {
            setRenderedPreviewError(err?.userMessage || err?.message || "Rendered preview failed.");
          }
        }
        return;
      }
      const elapsed = Date.now() - renderedPreviewPollStartedAtRef.current;
      if (elapsed >= RENDERED_PREVIEW_POLL_TIMEOUT_MS) {
        clearRenderedPreviewPollTimer();
        setRenderedPreviewError("Rendered preview is taking longer than expected. Try Refresh.");
        setRenderedPreviewStatus("error");
        return;
      }
      clearRenderedPreviewPollTimer();
      renderedPreviewPollTimerRef.current = window.setTimeout(() => {
        void pollRenderedPreviewStatusInternal();
      }, RENDERED_PREVIEW_POLL_MS);
    } catch (err: any) {
      clearRenderedPreviewPollTimer();
      setRenderedPreviewStatus("error");
      setRenderedPreviewError(err?.userMessage || err?.message || "Failed to fetch rendered preview status.");
    }
  }, [
    clearRenderedPreviewPollTimer,
    editor.projectId,
    editor.targetLang,
    fileId,
    loadRenderedPreviewDetails,
    renderedPreviewConfiguredMethod,
    renderedPreviewRevisionId,
    renderedPreviewSupported,
    taskId
  ]);

  const refreshRenderedPreview = useCallback(
    async (force = false) => {
      if (!renderedPreviewSupported || !editor.projectId || !fileId || !renderedPreviewConfiguredMethod) return;
      const now = Date.now();
      if (!force && now - renderedPreviewLastRequestAtRef.current < 1_000) return;
      renderedPreviewLastRequestAtRef.current = now;

      setRenderedPreviewLoading(true);
      setRenderedPreviewError(null);
      setRenderedPreviewErrorDetails(null);

      try {
        const response = await requestRenderedPreview({
          projectId: editor.projectId,
          fileId,
          taskId,
          targetLang: editor.targetLang || undefined,
          draftRevisionId: renderedPreviewRevisionId,
          previewMethod: renderedPreviewConfiguredMethod
        });

        setRenderedPreviewStatus(String(response.status || "idle"));
        setRenderedPreviewPreviewId(response.previewId ? String(response.previewId) : null);
        setRenderedPreviewWarnings(Array.isArray(response.warnings) ? response.warnings : []);
        setRenderedPreviewLogs(Array.isArray(response.logs) ? response.logs : []);

        if (String(response.status) === "ready" && response.previewId) {
          clearRenderedPreviewPollTimer();
          await loadRenderedPreviewDetails(response.previewId);
          return;
        }
        if (String(response.status) === "error") {
          if (response.previewId) {
            try {
              await loadRenderedPreviewDetails(response.previewId);
              return;
            } catch (err: any) {
              setRenderedPreviewError(err?.userMessage || err?.message || "Rendered preview failed.");
            }
          } else {
            setRenderedPreviewError(response.error || "Rendered preview failed.");
          }
          return;
        }

        if (String(response.status) === "queued" || String(response.status) === "running") {
          renderedPreviewPollStartedAtRef.current = Date.now();
          clearRenderedPreviewPollTimer();
          renderedPreviewPollTimerRef.current = window.setTimeout(() => {
            void pollRenderedPreviewStatus();
          }, RENDERED_PREVIEW_POLL_MS);
        }
      } catch (err: any) {
        setRenderedPreviewStatus("error");
        setRenderedPreviewError(err?.userMessage || err?.message || "Failed to refresh rendered preview.");
      } finally {
        setRenderedPreviewLoading(false);
      }
    },
    [
      clearRenderedPreviewPollTimer,
      editor.projectId,
      editor.targetLang,
      fileId,
      loadRenderedPreviewDetails,
      pollRenderedPreviewStatus,
      renderedPreviewConfiguredMethod,
      renderedPreviewRevisionId,
      renderedPreviewSupported,
      taskId
    ]
  );

  useEffect(() => {
    if (!renderedPreviewSupported || !renderedPreviewConfiguredMethod || !editor.projectId || !fileId) return;
    const timer = window.setTimeout(() => {
      void refreshRenderedPreview(false);
    }, RENDERED_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    editor.projectId,
    fileId,
    refreshRenderedPreview,
    renderedPreviewConfiguredMethod,
    renderedPreviewRevisionId,
    renderedPreviewSupported
  ]);

  const refreshRenderedPreviewNow = useCallback(() => {
    void refreshRenderedPreview(true);
  }, [refreshRenderedPreview]);

  const openRenderedPreviewInNewTab = useCallback(async () => {
    if (!renderedPreviewSupported) return;
    try {
      let details = renderedPreviewDetails;
      if ((!details || !details.signedUrl) && renderedPreviewPreviewId) {
        details = await loadRenderedPreviewDetails(renderedPreviewPreviewId);
      }
      const url = details?.signedUrl ? String(details.signedUrl) : "";
      if (!url) {
        setRenderedPreviewError("Rendered preview URL is not ready yet.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setRenderedPreviewError(err?.userMessage || err?.message || "Failed to open rendered preview.");
    }
  }, [loadRenderedPreviewDetails, renderedPreviewDetails, renderedPreviewPreviewId, renderedPreviewSupported]);

  const startBottomPanelResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!bottomPanelOpen) return;
      event.preventDefault();
      bottomPanelResizeStateRef.current = {
        startY: event.clientY,
        startHeight: bottomPanelHeight
      };
      document.body.classList.add("fc-modern-editor-resizing");
    },
    [bottomPanelHeight, bottomPanelOpen]
  );

  const termHitMap = useMemo(() => {
    if (!termHitsOnly) return null;
    const map = new Map<number, boolean>();
    for (const seg of editor.segments) {
      const matches = editor.getGlossaryMatchesForText(stripInline(seg.src));
      map.set(seg.id, matches.length > 0);
    }
    return map;
  }, [editor.getGlossaryMatchesForText, editor.segments, termHitsOnly]);
  const skippedSegmentSet = useMemo(() => new Set(lastSkippedIds), [lastSkippedIds]);
  const problematicSegmentSet = useMemo(() => new Set(lastProblematicIds), [lastProblematicIds]);

  const filteredSegments = useMemo(() => {
    const sourceNeedle = sourceSearch.trim().toLowerCase();
    const targetNeedle = targetSearch.trim().toLowerCase();

    return editor.segments.filter((seg) => {
      const src = String(seg.src ?? "");
      const tgt = segmentTargetValue(seg, editor.draftById);
      const state = segmentState(seg);
      const status = normalizeSegmentStatus(seg.status);
      const locked = isSegmentLocked(seg);
      const issues = editor.issuesById[seg.id] ?? seg.issues ?? [];
      const sourceType = String(seg.sourceType ?? "").trim().toLowerCase();
      const isNtmDraft = state === "nmt_draft" || sourceType === "ntm_draft";

      if (sourceNeedle && !src.toLowerCase().includes(sourceNeedle)) return false;
      if (targetNeedle && !tgt.toLowerCase().includes(targetNeedle)) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (untranslatedOnly && tgt.trim()) return false;
      if (draftOnly && state !== "draft" && state !== "nmt_draft") return false;
      if (reviewedOnly && state !== "reviewed") return false;
      if (withQaOnly && issues.length === 0) return false;
      if (lockedOnly && !locked) return false;
      if (termHitsOnly && !(termHitMap?.get(seg.id) ?? false)) return false;
      if (ntmDraftOnly && !isNtmDraft) return false;
      if (tmxOnly && sourceType !== "tmx") return false;
      if (skippedOnly && !skippedSegmentSet.has(seg.id)) return false;
      if (problematicOnly && !problematicSegmentSet.has(seg.id)) return false;

      return true;
    });
  }, [
    draftOnly,
    editor.draftById,
    editor.issuesById,
    editor.segments,
    lockedOnly,
    ntmDraftOnly,
    problematicOnly,
    problematicSegmentSet,
    reviewedOnly,
    skippedOnly,
    skippedSegmentSet,
    sourceSearch,
    statusFilter,
    targetSearch,
    termHitMap,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  ]);

  useEffect(() => {
    if (didAutoResetFiltersRef.current) return;
    if (editor.loading || editor.segments.length === 0) return;
    if (filteredSegments.length > 0) return;
    const hasActiveFilters =
      sourceSearch.trim().length > 0 ||
      targetSearch.trim().length > 0 ||
      statusFilter !== "all" ||
      untranslatedOnly ||
      draftOnly ||
      reviewedOnly ||
      withQaOnly ||
      lockedOnly ||
      termHitsOnly ||
      ntmDraftOnly ||
      tmxOnly ||
      skippedOnly ||
      problematicOnly;
    if (!hasActiveFilters) return;
    didAutoResetFiltersRef.current = true;
    setSourceSearch("");
    setTargetSearch("");
    setStatusFilter("all");
    setUntranslatedOnly(false);
    setDraftOnly(false);
    setReviewedOnly(false);
    setWithQaOnly(false);
    setLockedOnly(false);
    setTermHitsOnly(false);
    setNtmDraftOnly(false);
    setTmxOnly(false);
    setSkippedOnly(false);
    setProblematicOnly(false);
  }, [
    draftOnly,
    editor.loading,
    editor.segments.length,
    filteredSegments.length,
    lockedOnly,
    ntmDraftOnly,
    problematicOnly,
    reviewedOnly,
    skippedOnly,
    sourceSearch,
    statusFilter,
    targetSearch,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  ]);

  const filteredIndexById = useMemo(() => {
    const map = new Map<number, number>();
    filteredSegments.forEach((seg, idx) => map.set(seg.id, idx));
    return map;
  }, [filteredSegments]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => filteredIndexById.has(id)));
  }, [filteredIndexById]);

  useEffect(() => {
    if (!editor.active) return;
    void editor.ensureTmHints([editor.active]);
  }, [editor.active, editor.ensureTmHints]);

  useEffect(() => {
    editor.setConcordanceMode("auto");
    editor.setConcordanceQuery("");
  }, [editor.setConcordanceMode, editor.setConcordanceQuery]);

  useEffect(() => {
    editor.setConcordanceFilters((prev) => {
      if (prev.searchSource && !prev.searchTarget) return prev;
      return {
        ...prev,
        searchSource: true,
        searchTarget: false
      };
    });
  }, [editor.setConcordanceFilters]);

  useEffect(() => {
    const termbaseId = editor.termbaseId ?? null;
    const sourceLang = String(editor.sourceLang || "");
    const targetLang = String(editor.targetLang || "");
    const query = concordanceQuery.trim();

    if (!termbaseId || !sourceLang || !targetLang) {
      setConcordanceResults([]);
      setConcordanceSearchLoading(false);
      setConcordanceSearchError(null);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      return;
    }

    if (!query) {
      setConcordanceResults([]);
      setConcordanceSearchLoading(false);
      setConcordanceSearchError(null);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      return;
    }

    if (query.length < TERMBASE_CONCORDANCE_MIN_QUERY) {
      setConcordanceResults([]);
      setConcordanceSearchLoading(false);
      setConcordanceSearchError(null);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      return;
    }

    const key = JSON.stringify({
      termbaseId,
      query: query.toLowerCase(),
      sourceLang: sourceLang.toLowerCase(),
      targetLang: targetLang.toLowerCase(),
      searchIn: concordanceSearchIn,
      includeDeprecated: editor.concordanceFilters.includeDeprecated,
      includeForbidden: editor.concordanceFilters.includeForbidden,
      category: editor.concordanceFilters.category.trim().toLowerCase()
    });
    const cached = concordanceCacheRef.current.get(key);
    if (cached && Date.now() - cached.timestamp <= TERMBASE_CONCORDANCE_CACHE_TTL_MS) {
      setConcordanceResults(cached.entries);
      setConcordanceSearchError(null);
      setConcordanceSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      concordanceAbortRef.current?.abort();
      const controller = new AbortController();
      concordanceAbortRef.current = controller;
      setConcordanceSearchLoading(true);
      setConcordanceSearchError(null);

      if (!import.meta.env.PROD) {
        console.debug("[termbase-concordance] request", {
          termbaseId,
          query,
          sourceLang,
          targetLang,
          searchIn: concordanceSearchIn,
          includeDeprecated: editor.concordanceFilters.includeDeprecated,
          includeForbidden: editor.concordanceFilters.includeForbidden,
          category: editor.concordanceFilters.category
        });
      }

      void searchTermbaseConcordance({
        termbaseId,
        query,
        searchIn: concordanceSearchIn,
        srcLang: sourceLang,
        tgtLang: targetLang,
        filters: {
          limit: 12,
          includeDeprecated: editor.concordanceFilters.includeDeprecated,
          includeForbidden: editor.concordanceFilters.includeForbidden,
          category: editor.concordanceFilters.category,
          signal: controller.signal
        }
      })
        .then((entries) => {
          if (cancelled) return;
          const nextEntries = Array.isArray(entries) ? entries : [];
          concordanceCacheRef.current.set(key, { timestamp: Date.now(), entries: nextEntries });
          setConcordanceResults(nextEntries);
          if (!import.meta.env.PROD) {
            console.debug("[termbase-concordance] response", { count: nextEntries.length });
          }
        })
        .catch((err: any) => {
          if (cancelled || err?.name === "AbortError") return;
          setConcordanceResults([]);
          setConcordanceSearchError(err?.userMessage || err?.message || "Termbase concordance failed.");
        })
        .finally(() => {
          if (cancelled) return;
          setConcordanceSearchLoading(false);
          if (concordanceAbortRef.current === controller) {
            concordanceAbortRef.current = null;
          }
        });
    }, TERMBASE_CONCORDANCE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
    };
  }, [
    concordanceQuery,
    concordanceSearchIn,
    editor.concordanceFilters.category,
    editor.concordanceFilters.includeDeprecated,
    editor.concordanceFilters.includeForbidden,
    editor.sourceLang,
    editor.targetLang,
    editor.termbaseId
  ]);

  useEffect(() => {
    if (!editor.active) {
      setHistoryEntries([]);
      setHistoryError(null);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    void getSegmentHistory(editor.active.id, { limit: 50, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        setHistoryEntries(res.entries ?? []);
      })
      .catch((err: any) => {
        if (controller.signal.aborted) return;
        setHistoryEntries([]);
        setHistoryError(err?.userMessage || err?.message || "Could not load history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [editor.active]);

  const activeFilteredIndex = useMemo(() => {
    if (!editor.active) return -1;
    return filteredIndexById.get(editor.active.id) ?? -1;
  }, [editor.active, filteredIndexById]);

  const canGoFilteredPrev = activeFilteredIndex > 0;
  const canGoFilteredNext = activeFilteredIndex >= 0 && activeFilteredIndex < filteredSegments.length - 1;

  const goPrevFiltered = useCallback(() => {
    if (!canGoFilteredPrev) return;
    const prev = filteredSegments[activeFilteredIndex - 1];
    if (prev) editor.setActiveId(prev.id);
  }, [activeFilteredIndex, canGoFilteredPrev, editor, filteredSegments]);

  const goNextFiltered = useCallback(() => {
    if (!canGoFilteredNext) return;
    const next = filteredSegments[activeFilteredIndex + 1];
    if (next) editor.setActiveId(next.id);
  }, [activeFilteredIndex, canGoFilteredNext, editor, filteredSegments]);

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

  const clearBulkApprovePollTimer = useCallback(() => {
    if (bulkApprovePollTimerRef.current != null) {
      window.clearTimeout(bulkApprovePollTimerRef.current);
      bulkApprovePollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearBulkApprovePollTimer();
    };
  }, [clearBulkApprovePollTimer]);

  const buildVisibleBulkFilters = useCallback((): EditorBulkVisibleFilters => {
    return {
      statusFilter,
      sourceSearch,
      targetSearch,
      untranslatedOnly,
      draftOnly,
      reviewedOnly,
      withQaOnly,
      lockedOnly,
      termHitsOnly,
      ntmDraftOnly,
      tmxOnly
    };
  }, [
    draftOnly,
    lockedOnly,
    ntmDraftOnly,
    reviewedOnly,
    sourceSearch,
    statusFilter,
    targetSearch,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  ]);

  const startBulkApprovePolling = useCallback(
    (jobId: string, action: BulkApproveAction) => {
      clearBulkApprovePollTimer();
      const poll = async () => {
        try {
          const status = await getBulkApproveJobStatus(jobId);
          const statusValue = String(status.status).toLowerCase();
          if (statusValue === "completed") {
            clearBulkApprovePollTimer();
            setBulkBusy(false);
            setBulkApproveJob(null);
            const summary =
              status.summary ??
              {
                approved: Number(status.progress?.approved ?? 0),
                skipped: Number(status.progress?.skipped ?? 0),
                qaFlaggedApproved: 0,
                reasonsBreakdown: {},
                skippedSegmentIds: [],
                problematicSegmentIds: []
              };
            setBulkApproveSummary({
              action,
              estimated: status.estimated,
              summary
            });
            setLastSkippedIds(Array.isArray(summary.skippedSegmentIds) ? summary.skippedSegmentIds : []);
            setLastProblematicIds(Array.isArray(summary.problematicSegmentIds) ? summary.problematicSegmentIds : []);
            void editor.reload();
            return;
          }
          if (statusValue === "failed") {
            setBulkApproveJob(status);
            clearBulkApprovePollTimer();
            setBulkBusy(false);
            return;
          }
          setBulkApproveJob(status);
          bulkApprovePollTimerRef.current = window.setTimeout(() => {
            void poll();
          }, 900);
        } catch (err: any) {
          clearBulkApprovePollTimer();
          setBulkBusy(false);
          setBulkApproveJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: "failed",
                  error: err?.userMessage || err?.message || "Failed to poll bulk approval job."
                }
              : null
          );
        }
      };
      void poll();
    },
    [clearBulkApprovePollTimer, editor]
  );

  const openBulkApproveDialog = useCallback(
    async (action: BulkApproveAction) => {
      if (taskReadOnly || bulkBusy) return;
      if (!editor.projectId || !fileId) return;
      setBulkApproveAckQa(false);
      setBulkApproveDialog({
        action,
        estimate: null,
        loading: true,
        error: null
      });
      try {
        const estimateRes = await bulkApproveProjectFileSegments({
          projectId: editor.projectId,
          fileId,
          taskId: Number.isFinite(taskId) ? taskId : null,
          scope: action,
          qaPolicy: action === "clean" ? "require_clean" : "ignore",
          dryRun: true,
          ...(action === "visible" ? { filters: buildVisibleBulkFilters() } : {})
        });
        setBulkApproveDialog({
          action,
          estimate: estimateRes.estimated,
          loading: false,
          error: null
        });
      } catch (err: any) {
        setBulkApproveDialog({
          action,
          estimate: null,
          loading: false,
          error: err?.userMessage || err?.message || "Failed to estimate bulk approval."
        });
      }
    },
    [buildVisibleBulkFilters, bulkBusy, editor.projectId, fileId, taskId, taskReadOnly]
  );

  const confirmBulkApprove = useCallback(async () => {
    if (!bulkApproveDialog) return;
    if (taskReadOnly || bulkBusy) return;
    if (!editor.projectId || !fileId) return;
    const action = bulkApproveDialog.action;
    const estimate = bulkApproveDialog.estimate;
    if (!estimate) return;
    if (action === "all" && estimate.qaFlaggedEligible > 0 && !bulkApproveAckQa) {
      setBulkApproveDialog((prev) =>
        prev
          ? {
              ...prev,
              error: "Acknowledge QA-flagged approvals before continuing."
            }
          : prev
      );
      return;
    }

    setBulkApproveDialog((prev) => (prev ? { ...prev, loading: true, error: null } : prev));
    const pending = await editor.flushPendingChanges();
    if (pending.dirty > 0 || pending.inFlight > 0) {
      setBulkApproveDialog((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: "Please resolve pending save issues before bulk approval."
            }
          : prev
      );
      return;
    }

    setBulkBusy(true);
    setSkippedOnly(false);
    setProblematicOnly(false);
    try {
      const response = await bulkApproveProjectFileSegments({
        projectId: editor.projectId,
        fileId,
        taskId: Number.isFinite(taskId) ? taskId : null,
        scope: action,
        qaPolicy: action === "clean" ? "require_clean" : "ignore",
        ...(action === "visible" ? { filters: buildVisibleBulkFilters() } : {})
      });
      if (!response.jobId) {
        throw new Error("Bulk job id missing.");
      }
      const estimated = response.estimated;
      setBulkApproveJob({
        jobId: response.jobId,
        status: "queued",
        scope: action,
        projectId: editor.projectId,
        fileId,
        taskId: Number.isFinite(taskId) ? taskId : null,
        progress: {
          total: estimated.total,
          processed: estimated.skipped,
          approved: 0,
          skipped: estimated.skipped,
          percent: estimated.total === 0 ? 100 : Math.round((estimated.skipped / estimated.total) * 100)
        },
        estimated,
        summary: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      setBulkApproveDialog(null);
      startBulkApprovePolling(response.jobId, action);
    } catch (err: any) {
      setBulkBusy(false);
      setBulkApproveDialog((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err?.userMessage || err?.message || "Failed to start bulk approval."
            }
          : prev
      );
    }
  }, [
    bulkApproveAckQa,
    bulkApproveDialog,
    bulkBusy,
    buildVisibleBulkFilters,
    editor,
    fileId,
    startBulkApprovePolling,
    taskId,
    taskReadOnly
  ]);

  const runBulk = useCallback(
    async (fn: (ids: number[]) => Promise<void> | void) => {
      if (taskReadOnly || selectedIds.length === 0 || bulkBusy) return;
      setBulkBusy(true);
      try {
        await fn(selectedIds);
      } finally {
        setBulkBusy(false);
      }
    },
    [bulkBusy, selectedIds, taskReadOnly]
  );

  const bulkMarkReviewed = useCallback(async () => {
    await runBulk(async (ids) => {
      await editor.markReviewedBulk(ids);
    });
  }, [editor, runBulk]);

  const bulkClearTargets = useCallback(async () => {
    await runBulk((ids) => {
      for (const id of ids) editor.updateTarget(id, "");
    });
  }, [editor, runBulk]);

  const bulkLock = useCallback(
    async (nextLocked: boolean) => {
      await runBulk(async (ids) => {
        await Promise.all(ids.map((id) => editor.setSegmentLock(id, nextLocked)));
      });
    },
    [editor, runBulk]
  );

  const setMtGenerating = useCallback((segmentId: number, busy: boolean) => {
    setMtGeneratingIds((prev) => {
      const has = prev.includes(segmentId);
      if (busy && !has) return [...prev, segmentId];
      if (!busy && has) return prev.filter((id) => id !== segmentId);
      return prev;
    });
  }, []);

  const generateMt = useCallback(
    async (segmentId: number) => {
      setMtGenerating(segmentId, true);
      try {
        await editor.generateMtForSegment(segmentId);
      } finally {
        setMtGenerating(segmentId, false);
      }
    },
    [editor, setMtGenerating]
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

  const openConcordanceShortcut = useCallback(() => {
    setRightSidebarOpen(true);
    window.setTimeout(() => concordanceInputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const root = editorRootRef.current;
      if (!target || !root || !root.contains(target)) return;

      const inModal = Boolean(target.closest(".fc-modern-modal, .modal, [role='dialog']"));
      if (inModal) return;

      const inTargetEditor = Boolean(
        target.closest("textarea.fc-modern-target-input, textarea.fc-editor-cell-input")
      );
      const inSegmentRow = Boolean(target.closest(".fc-modern-segment-row, .fc-editor-row"));
      const isSegmentRowElement = Boolean(target.matches(".fc-modern-segment-row, .fc-editor-row"));
      const inSourceCell = Boolean(
        target.closest(".fc-modern-segment-source, .fc-modern-segment-source-text, .fc-editor-cell.fc-col-src")
      );
      const inFormField =
        Boolean(target.closest("input, textarea, select")) || Boolean(target.isContentEditable);

      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrl && key === "f") {
        event.preventDefault();
        openFindModal("find");
        return;
      }
      if (ctrl && key === "h") {
        event.preventDefault();
        openFindModal("replace");
        return;
      }
      if (ctrl && event.shiftKey && key === "c") {
        event.preventDefault();
        openConcordanceShortcut();
        return;
      }

      const action = resolveEditorHotkeyAction(event, hotkeyKeymap);
      if (!action) return;
      const allowed = isEditorHotkeyAllowed(action, {
        withinEditor: true,
        hasActiveSegment: Boolean(activeSegment),
        inModal,
        inTargetEditor,
        inSegmentRow,
        inSourceCell,
        inFormField
      });
      if (!allowed) return;
      if (action === "NAV_NEXT" && key === "enter" && !inTargetEditor && !isSegmentRowElement) return;

      let handled = false;
      switch (action) {
        case "SEGMENT_CONFIRM":
          handled = true;
          void confirmAndAdvance();
          break;
        case "NAV_NEXT":
          handled = true;
          goNextFiltered();
          focusTargetForSegment(filteredSegments[activeFilteredIndex + 1]?.id ?? null);
          break;
        case "NAV_PREV":
          handled = true;
          goPrevFiltered();
          focusTargetForSegment(filteredSegments[activeFilteredIndex - 1]?.id ?? null);
          break;
        case "NAV_NEXT_UNCONFIRMED":
          handled = true;
          goToNextUnconfirmed();
          break;
        case "FOCUS_TOGGLE_SOURCE_TARGET":
          handled = toggleSourceTargetFocus();
          break;
        case "NAV_NEXT_TERM_ISSUE":
          handled = goToNextTerminologyIssue();
          break;
        case "COPY_SOURCE_TO_TARGET":
          handled = copySourceToTarget();
          break;
        case "GOTO_SEGMENT_DIALOG":
          handled = true;
          openGoToSegmentDialog();
          break;
        case "OPEN_CONCORDANCE":
          handled = true;
          openConcordanceShortcut();
          break;
        case "NAV_CAT_UP":
          handled = true;
          void navigateCatResults(-1);
          break;
        case "NAV_CAT_DOWN":
          handled = true;
          void navigateCatResults(1);
          break;
        case "REVERT_STAGE":
          handled = true;
          void revertActiveSegmentStage();
          break;
        default: {
          const catIndex = parseDigitFromAction(action, "INSERT_CAT_SUGGESTION_");
          if (catIndex != null) {
            handled = true;
            void insertCatSuggestionByIndex(catIndex);
            break;
          }
          const tagIndex = parseDigitFromAction(action, "INSERT_TAG_");
          if (tagIndex != null) {
            handled = insertTagByIndex(tagIndex);
            break;
          }
        }
      }

      if (handled) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeFilteredIndex,
    activeSegment,
    confirmAndAdvance,
    copySourceToTarget,
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
    openConcordanceShortcut,
    openFindModal,
    openGoToSegmentDialog,
    revertActiveSegmentStage,
    toggleSourceTargetFocus
  ]);

  if (!currentUser) {
    return <div className="text-muted p-3">Loading editor...</div>;
  }

  if (editor.error) {
    const projectId = editor.errorProjectId ?? editor.projectId;
    const isProjectFailure = editor.errorCode === "PROJECT_FAILED";
    return (
      <div className="fc-modern-editor">
        <div className="alert alert-danger m-3 d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div>
            <div>{editor.error}</div>
            {isProjectFailure ? (
              <div className="small mt-1">
                Segment preparation failed. Open Logs/Status to inspect processing details.
              </div>
            ) : null}
          </div>
          <div className="d-flex gap-2">
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={retryingImport}
                onClick={async () => {
                  try {
                    setRetryingImport(true);
                    await retryProjectProvision(projectId);
                    nav(`/projects/${projectId}/provisioning`, { replace: true });
                  } catch (err: any) {
                    window.alert(err?.userMessage || err?.message || "Retry import failed.");
                  } finally {
                    setRetryingImport(false);
                  }
                }}
              >
                {retryingImport ? "Retrying..." : "Retry import"}
              </button>
            ) : null}
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => nav(`/projects/${projectId}/provisioning`)}
              >
                Open Logs/Status
              </button>
            ) : null}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={editor.reload}>
              Retry
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/inbox")}>
              Back to inbox
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!editor.loading && editor.segments.length === 0) {
    const projectId = editor.projectId ?? editor.errorProjectId;
    return (
      <div className="fc-modern-editor">
        <div className="alert alert-warning m-3 d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div>
            <div>No segments extracted for this file.</div>
            <div className="small mt-1">
              Check processing logs and retry import if needed.
            </div>
          </div>
          <div className="d-flex gap-2">
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={retryingImport}
                onClick={async () => {
                  try {
                    setRetryingImport(true);
                    await retryProjectProvision(projectId);
                    nav(`/projects/${projectId}/provisioning`, { replace: true });
                  } catch (err: any) {
                    window.alert(err?.userMessage || err?.message || "Retry import failed.");
                  } finally {
                    setRetryingImport(false);
                  }
                }}
              >
                {retryingImport ? "Retrying..." : "Retry import"}
              </button>
            ) : null}
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => nav(`/projects/${projectId}/provisioning`)}
              >
                Open Logs/Status
              </button>
            ) : null}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/inbox")}>
              Back to inbox
            </button>
          </div>
        </div>
      </div>
    );
  }

  const downloadReady = canDownloadReviewedOutput(editor.meta?.task?.status ?? null);

  const doComplete = async () => {
    if (taskReadOnly) return;
    const role = String(currentUser.role || "").toLowerCase();
    const mode = role === "reviewer" || role === "admin" || role === "manager" ? "reviewed" : "under_review";
    const effectiveTarget = (segmentId: number, fallback: string | null) => {
      const hasDraft = Object.prototype.hasOwnProperty.call(editor.draftById, segmentId);
      return hasDraft ? editor.draftById[segmentId] ?? "" : String(fallback ?? "");
    };
    const stateFor = (seg: Segment) => coerceSegmentState(seg.state, normalizeSegmentStatus(seg.status));

    if (mode === "reviewed") {
      const hasUnreviewed = editor.segments.some((s) => stateFor(s) !== "reviewed");
      if (hasUnreviewed) {
        window.alert("Cannot complete review: some segments are still not reviewed.");
        return;
      }

      const blocked = editor.segments.filter((s) => {
        const state = stateFor(s);
        if (state === "reviewed") return false;
        const tgt = effectiveTarget(s.id, s.tgt);
        if (!tgt.trim()) return true;
        const issues = editor.issuesById[s.id] ?? [];
        return issues.some((issue) => issue.severity === "error");
      });
      if (blocked.length > 0) {
        window.alert("Cannot complete review: resolve blocking QA errors (or empty targets) first.");
        return;
      }
    } else {
      const emptyDrafts = editor.segments.filter((s) => {
        const state = stateFor(s);
        if (state !== "draft" && state !== "nmt_draft") return false;
        const tgt = effectiveTarget(s.id, s.tgt);
        return !tgt.trim();
      }).length;
      if (emptyDrafts > 0) {
        const ok = window.confirm(
          `${emptyDrafts} draft segment${emptyDrafts === 1 ? "" : "s"} are empty and will remain Draft. Complete anyway?`
        );
        if (!ok) return;
      }
    }

    await editor.complete(mode);
    window.dispatchEvent(new CustomEvent("fc:inbox:refresh"));
    nav("/inbox");
  };

  const doDownload = async () => {
    const projectId = editor.projectId;
    if (!projectId) return;
    if (!downloadReady) {
      window.alert("Download is available only after review is marked Done.");
      return;
    }
    try {
      const blob = await exportProjectTargetFile(projectId, { taskId, fileId, lang: editor.targetLang });
      const filename = buildTargetOutputFilename(
        editor.fileName || `file-${fileId ?? taskId ?? ""}`,
        editor.targetLang || ""
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to download file");
    }
  };

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
  const dialogReasonEntries = Object.entries(bulkApproveDialog?.estimate?.reasonsBreakdown ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const summaryReasonEntries = Object.entries(bulkApproveSummary?.summary.reasonsBreakdown ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

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

      {bulkApproveDialog ? (
        <Modal
          title={bulkActionLabel(bulkApproveDialog.action)}
          onClose={() => {
            if (bulkApproveDialog.loading) return;
            setBulkApproveDialog(null);
          }}
          closeDisabled={bulkApproveDialog.loading}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setBulkApproveDialog(null)}
                disabled={bulkApproveDialog.loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => void confirmBulkApprove()}
                disabled={
                  bulkApproveDialog.loading ||
                  !bulkApproveDialog.estimate ||
                  (bulkApproveDialog.action === "all" &&
                    (bulkApproveDialog.estimate?.qaFlaggedEligible ?? 0) > 0 &&
                    !bulkApproveAckQa)
                }
              >
                {bulkApproveDialog.loading ? "Preparing..." : "Approve"}
              </button>
            </>
          }
        >
          <div className="small text-muted mb-2">{bulkActionScopeText(bulkApproveDialog.action)}</div>
          {bulkApproveDialog.error ? <div className="alert alert-warning py-2">{bulkApproveDialog.error}</div> : null}
          {bulkApproveDialog.estimate ? (
            <>
              <div className="mb-2">
                <div>Total in scope: {bulkApproveDialog.estimate.total}</div>
                <div>Eligible: {bulkApproveDialog.estimate.eligible}</div>
                <div>Skipped: {bulkApproveDialog.estimate.skipped}</div>
                <div>QA-flagged among eligible: {bulkApproveDialog.estimate.qaFlaggedEligible}</div>
              </div>
              {dialogReasonEntries.length > 0 ? (
                <details>
                  <summary>Skipped reasons</summary>
                  <div className="mt-2 small">
                    {dialogReasonEntries.map(([reason, count]) => (
                      <div key={`reason-${reason}`}>
                        {skipReasonLabel(reason)}: {count}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="alert alert-danger mt-3 mb-0 py-2">
                Bulk approval changes segment statuses for many rows at once.
              </div>
              {bulkApproveDialog.action === "all" && bulkApproveDialog.estimate.qaFlaggedEligible > 0 ? (
                <label className="form-check mt-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={bulkApproveAckQa}
                    onChange={(event) => setBulkApproveAckQa(event.target.checked)}
                    disabled={bulkApproveDialog.loading}
                  />
                  <span className="form-check-label">
                    I understand this action may approve QA-flagged segments.
                  </span>
                </label>
              ) : null}
            </>
          ) : (
            <div className="text-muted">Calculating estimate...</div>
          )}
        </Modal>
      ) : null}

      {bulkApproveSummary ? (
        <Modal
          title={`${bulkActionLabel(bulkApproveSummary.action)} summary`}
          onClose={() => setBulkApproveSummary(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  if (bulkApproveSummary.summary.skippedSegmentIds.length === 0) return;
                  setSkippedOnly(true);
                  setProblematicOnly(false);
                  setShowFilters(true);
                  setBulkApproveSummary(null);
                }}
                disabled={bulkApproveSummary.summary.skippedSegmentIds.length === 0}
              >
                View skipped segments
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  if (bulkApproveSummary.summary.problematicSegmentIds.length === 0) return;
                  setProblematicOnly(true);
                  setSkippedOnly(false);
                  setShowFilters(true);
                  setBulkApproveSummary(null);
                }}
                disabled={bulkApproveSummary.summary.problematicSegmentIds.length === 0}
              >
                Show only problematic
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setBulkApproveSummary(null)}>
                Close
              </button>
            </>
          }
        >
          <div>Approved: {bulkApproveSummary.summary.approved}</div>
          <div>Skipped: {bulkApproveSummary.summary.skipped}</div>
          <div>QA-flagged approved: {bulkApproveSummary.summary.qaFlaggedApproved}</div>
          {summaryReasonEntries.length > 0 ? (
            <details className="mt-2">
              <summary>Skipped reasons</summary>
              <div className="mt-2 small">
                {summaryReasonEntries.map(([reason, count]) => (
                  <div key={`summary-reason-${reason}`}>
                    {skipReasonLabel(reason)}: {count}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
