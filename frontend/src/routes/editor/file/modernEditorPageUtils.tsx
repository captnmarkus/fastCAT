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

export type BottomTab = "history" | "qa" | "segment_comments" | "document_comments" | "rendered_preview" | "rendered_status";
export type PreviewLayout = "split" | "side";
export type StatusFilter = "all" | "draft" | "under_review" | "reviewed";
export type BulkApproveAction = EditorBulkApproveScope;

export type EditorFilterPrefs = {
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

export type ModernViewPrefs = {
  rightSidebarOpen: boolean;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  previewEnabled: boolean;
  previewLayout: PreviewLayout;
  showWhitespace: boolean;
  showTags: boolean;
};

export const VIEW_PREF_KEY_PREFIX = "fc:editor:modern:view:";
export const FONT_PREF_KEY_PREFIX = "fc:editor:modern:font-size:";
export const FILTER_PREF_KEY_PREFIX = "fc:editor:modern:filters:";
export const TERMBASE_CONCORDANCE_MIN_QUERY = 2;
export const TERMBASE_CONCORDANCE_CACHE_TTL_MS = 45_000;
export const TERMBASE_CONCORDANCE_DEBOUNCE_MS = 320;
export const EDITOR_FONT_SIZE_MIN = 13;
export const EDITOR_FONT_SIZE_MAX = 19;
export const EDITOR_FONT_SIZE_STEP = 1;
export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const BOTTOM_PANEL_MIN_HEIGHT = 180;
export const BOTTOM_PANEL_MAX_HEIGHT = 640;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 300;
export const HOTKEY_PREF_KEY_PREFIX = "fc:editor:modern:hotkeys:";
export const RENDERED_PREVIEW_DEBOUNCE_MS = 1500;
export const RENDERED_PREVIEW_POLL_MS = 1200;
export const RENDERED_PREVIEW_POLL_TIMEOUT_MS = 60_000;

export const BULK_SKIP_REASON_LABELS: Record<string, string> = {
  already_reviewed: "Already approved",
  empty_target: "Empty target",
  qa_issues: "QA issues",
  locked: "Locked",
  permission_denied: "Permission denied",
  task_read_only: "Task is read-only",
  update_failed: "Update failed"
};

export const DEFAULT_FILTER_PREFS: EditorFilterPrefs = {
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

export const DEFAULT_VIEW_PREFS: ModernViewPrefs = {
  rightSidebarOpen: true,
  bottomPanelOpen: true,
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
  previewEnabled: true,
  previewLayout: "split",
  showWhitespace: false,
  showTags: true
};

export function viewPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${VIEW_PREF_KEY_PREFIX}${scope}`;
}

export function fontPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${FONT_PREF_KEY_PREFIX}${scope}`;
}

export function filterPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${FILTER_PREF_KEY_PREFIX}${scope}`;
}

export type HotkeyPrefs = {
  enableConcordanceCtrlK: boolean;
};

export function hotkeyPrefKey(currentUser: AuthUser | null) {
  const scope = String(currentUser?.id ?? currentUser?.username ?? "guest").trim() || "guest";
  return `${HOTKEY_PREF_KEY_PREFIX}${scope}`;
}

export function readHotkeyPrefs(key: string): HotkeyPrefs {
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

export function writeHotkeyPrefs(key: string, prefs: HotkeyPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function readFilterPrefs(key: string): EditorFilterPrefs {
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

export function writeFilterPrefs(key: string, prefs: EditorFilterPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function readViewPrefs(key: string): ModernViewPrefs {
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

export function writeViewPrefs(key: string, prefs: ModernViewPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function readEditorFontSize(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_EDITOR_FONT_SIZE;
    return Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, Math.round(parsed)));
  } catch {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
}

export function normalizeReviewGateStatus(value: string | null | undefined): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

export function canDownloadReviewedOutput(taskStatus: string | null | undefined) {
  return normalizeReviewGateStatus(taskStatus) === "reviewed";
}

export function writeEditorFontSize(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

export function mixHash(current: number, value: number) {
  return (((current << 5) - current + value) >>> 0);
}

export function buildRenderedPreviewRevisionToken(taskId: number, segments: Segment[], draftById: Record<number, string>) {
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

export function stripInline(value: string) {
  return String(value || "")
    .replace(/<\/?\d+>/g, " ")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function segmentState(segment: Segment): "draft" | "nmt_draft" | "under_review" | "reviewed" {
  const status = normalizeSegmentStatus(segment.status);
  if (status === "under_review") return "under_review";
  const state = coerceSegmentState(segment.state, status);
  if (state === "reviewed") return "reviewed";
  if (state === "nmt_draft") return "nmt_draft";
  return "draft";
}

export function isSegmentLocked(segment: Segment) {
  const state = segmentState(segment);
  return segment.isLocked === undefined ? state === "reviewed" : Boolean(segment.isLocked);
}

export function segmentTargetValue(segment: Segment, draftById: Record<number, string>) {
  const hasDraft = Object.prototype.hasOwnProperty.call(draftById, segment.id);
  return hasDraft ? String(draftById[segment.id] ?? "") : String(segment.tgt ?? "");
}

export function normalizeMatchScorePct(match: Match) {
  const raw = Number(match.score ?? 0);
  const normalized = raw <= 1 ? raw * 100 : raw;
  return Math.round(Math.max(0, Math.min(100, normalized)));
}

export async function copyToClipboard(value: string) {
  if (!value.trim()) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // ignore
  }
}

export function saveLabelForState(state: "saved" | "saving" | "offline" | "error") {
  if (state === "saving") return "Saving...";
  if (state === "offline") return "Offline (queued)";
  if (state === "error") return "Save issue";
  return "All changes saved";
}

export function previewBlockMeta(source: string) {
  const heading = source.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/i);
  if (heading) {
    return { kind: "heading" as const, level: Number(heading[1] ?? 2) };
  }
  return { kind: "paragraph" as const, level: 0 };
}

export function termbaseDisplaySource(entry: TermbaseConcordanceEntry) {
  if (entry.matches && entry.matches.length > 0) {
    return entry.matches[0]?.term || entry.sourceTerms[0]?.text || "";
  }
  return entry.sourceTerms[0]?.text || "";
}

export function termbaseEntryCategory(entry: TermbaseConcordanceEntry) {
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

export function isDeprecatedTerm(term: { status?: string } | undefined, entry: TermbaseConcordanceEntry) {
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

export function highlightConcordanceMatch(value: string, query: string) {
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

export function filterCount(params: {
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

export function bulkActionLabel(action: BulkApproveAction) {
  if (action === "all") return "Approve all";
  if (action === "visible") return "Approve visible";
  return "Approve clean translation";
}

export function bulkActionScopeText(action: BulkApproveAction) {
  if (action === "all") return "All segments in the current file";
  if (action === "visible") return "Only currently visible segments (active filters)";
  return "Only QA-clean segments with non-empty target";
}

export function skipReasonLabel(reason: string) {
  return BULK_SKIP_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

