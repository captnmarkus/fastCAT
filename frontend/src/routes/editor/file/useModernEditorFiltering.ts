import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchTermbaseConcordance, type TermbaseConcordanceEntry } from "../../../api";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { useEditorFile } from "../state/useEditorFile";
import {
  type StatusFilter,
  isSegmentLocked,
  segmentState,
  segmentTargetValue,
  stripInline,
  TERMBASE_CONCORDANCE_CACHE_TTL_MS,
  TERMBASE_CONCORDANCE_DEBOUNCE_MS,
  TERMBASE_CONCORDANCE_MIN_QUERY
} from "./modernEditorPageUtils";

type EditorController = ReturnType<typeof useEditorFile>;

export function useModernEditorFiltering(params: {
  activeSegmentId: number | null;
  draftOnly: boolean;
  editor: EditorController;
  lastProblematicIds: number[];
  lastSkippedIds: number[];
  lockedOnly: boolean;
  ntmDraftOnly: boolean;
  problematicOnly: boolean;
  reviewedOnly: boolean;
  setDraftOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setLockedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setNtmDraftOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setProblematicOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setReviewedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setSourceSearch: React.Dispatch<React.SetStateAction<string>>;
  setStatusFilter: React.Dispatch<React.SetStateAction<StatusFilter>>;
  setTargetSearch: React.Dispatch<React.SetStateAction<string>>;
  setTermHitsOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setTmxOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setUntranslatedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setWithQaOnly: React.Dispatch<React.SetStateAction<boolean>>;
  skippedOnly: boolean;
  sourceSearch: string;
  statusFilter: StatusFilter;
  targetSearch: string;
  taskId: number;
  termHitsOnly: boolean;
  tmxOnly: boolean;
  untranslatedOnly: boolean;
  withQaOnly: boolean;
}) {
  const {
    activeSegmentId,
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
  } = params;
  const didAutoResetFiltersRef = useRef(false);
  const [concordanceQuery, setConcordanceQuery] = useState("");
  const [concordanceSearchIn, setConcordanceSearchIn] = useState<"source" | "target">("source");
  const [concordanceResults, setConcordanceResults] = useState<TermbaseConcordanceEntry[]>([]);
  const [concordanceSearchLoading, setConcordanceSearchLoading] = useState(false);
  const [concordanceSearchError, setConcordanceSearchError] = useState<string | null>(null);
  const concordanceAbortRef = useRef<AbortController | null>(null);
  const concordanceCacheRef = useRef<Map<string, { timestamp: number; entries: TermbaseConcordanceEntry[] }>>(
    new Map()
  );
  const concordanceInputRef = useRef<HTMLInputElement | null>(null);

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
    didAutoResetFiltersRef.current = false;
  }, [taskId]);

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

    if (!termbaseId || !sourceLang || !targetLang || !query || query.length < TERMBASE_CONCORDANCE_MIN_QUERY) {
      setConcordanceResults([]);
      setConcordanceSearchLoading(false);
      setConcordanceSearchError(null);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      return;
    }

    const key = JSON.stringify({
      termbaseId,
      sourceLang,
      targetLang,
      query: query.toLowerCase(),
      searchIn: concordanceSearchIn,
      includeDeprecated: editor.concordanceFilters.includeDeprecated,
      includeForbidden: editor.concordanceFilters.includeForbidden,
      category: editor.concordanceFilters.category.trim().toLowerCase()
    });
    const cached = concordanceCacheRef.current.get(key);
    if (cached && Date.now() - cached.timestamp < TERMBASE_CONCORDANCE_CACHE_TTL_MS) {
      setConcordanceResults(cached.entries);
      setConcordanceSearchLoading(false);
      setConcordanceSearchError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      concordanceAbortRef.current?.abort();
      const controller = new AbortController();
      concordanceAbortRef.current = controller;
      setConcordanceSearchLoading(true);
      setConcordanceSearchError(null);
      void searchTermbaseConcordance(termbaseId, {
        query,
        sourceLang,
        targetLang,
        searchIn: concordanceSearchIn,
        signal: controller.signal,
        includeDeprecated: editor.concordanceFilters.includeDeprecated,
        includeForbidden: editor.concordanceFilters.includeForbidden,
        category: editor.concordanceFilters.category,
        limit: 24
      })
        .then((entries) => {
          const nextEntries = Array.isArray(entries) ? entries : [];
          concordanceCacheRef.current.set(key, { timestamp: Date.now(), entries: nextEntries });
          setConcordanceResults(nextEntries);
          setConcordanceSearchError(null);
        })
        .catch((err: any) => {
          if (err?.name === "AbortError") return;
          setConcordanceSearchError(err?.userMessage || err?.message || "Termbase concordance failed.");
        })
        .finally(() => {
          if (concordanceAbortRef.current === controller) {
            concordanceAbortRef.current = null;
          }
          setConcordanceSearchLoading(false);
        });
    }, TERMBASE_CONCORDANCE_DEBOUNCE_MS);

    return () => {
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

  const activeFilteredIndex = useMemo(() => {
    if (activeSegmentId == null) return -1;
    return filteredIndexById.get(activeSegmentId) ?? -1;
  }, [activeSegmentId, filteredIndexById]);

  const canGoFilteredPrev = activeFilteredIndex > 0;
  const canGoFilteredNext = activeFilteredIndex >= 0 && activeFilteredIndex < filteredSegments.length - 1;

  const goPrevFiltered = useCallback(() => {
    if (activeFilteredIndex <= 0) return;
    const prev = filteredSegments[activeFilteredIndex - 1];
    if (prev) editor.setActiveId(prev.id);
  }, [activeFilteredIndex, editor, filteredSegments]);

  const goNextFiltered = useCallback(() => {
    if (activeFilteredIndex < 0 || activeFilteredIndex >= filteredSegments.length - 1) return;
    const next = filteredSegments[activeFilteredIndex + 1];
    if (next) editor.setActiveId(next.id);
  }, [activeFilteredIndex, editor, filteredSegments]);

  return {
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
  };
}
