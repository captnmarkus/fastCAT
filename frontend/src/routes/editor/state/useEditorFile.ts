import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptCleanLlmDrafts,
  completeTask,
  fetchProjectTermbaseEntries,
  getTermbaseSuggestions,
  getTask,
  getTaskSegments,
  markSegmentsReviewed,
  patchTaskSegment,
  recomputeSegmentIssues,
  requestSegmentLLM,
  searchTermbaseConcordance,
  searchTM,
  type EditorFileMeta,
  type SegmentOriginDetails,
  type TermbaseConcordanceEntry,
  type TermbaseMatchEntry,
  type Match,
  type Segment,
  type SegmentRun
} from "../../../api";
import type { AuthUser } from "../../../types/app";
import { type SegmentIssue } from "../../../utils/qa";
import { type GlossaryHighlightMatch } from "../../../utils/termbase";
import { buildOccurrenceIndex, findOccurrences, normalizeConcordanceText } from "../../../utils/concordance";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState } from "../../../utils/segmentState";
import { filterSegmentsForReviewQueue } from "../../../utils/reviewQueue";
import { clearTimeoutRef } from "../../../utils/timers";
import { normalizeRuns, projectTextToRuns, runsToText } from "../../../utils/richTextRuns";
import {
  buildGlossaryEntries,
  buildGlossaryTermIndex,
  buildIssuesList,
  getGlossaryMatchesForTextFromIndex,
  computeSegmentIssues,
  type DirtyEntry,
  type DirtyReason,
  type InFlightSave,
  isNetworkError,
  resolveSegmentIssues,
  type SaveFailure,
  type SegmentHistory,
  type SourceMeta,
  stripInlineTags
} from "./useEditorFile.helpers";
import { useEditorFileActions } from "./useEditorFile.actions";
import { useEditorFileEditorActions } from "./useEditorFile.editor-actions";

export type SaveIndicatorState = "saved" | "saving" | "offline" | "error";

export type FindScope = "source" | "target" | "both";

type MtSuggestionMeta = {
  model: string | null;
  latencyMs: number | null;
  confidence: number | null;
  generatedAt: number;
};

type SuggestionKind = "tm" | "glossary" | "mt";

const TM_HINT_TTL_MS = 5 * 60 * 1000;
const CONCORDANCE_CACHE_TTL_MS = 60 * 1000;
const MT_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeReviewGateStatus(value: string | null | undefined): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

export function useEditorFile(params: { taskId: number; currentUser: AuthUser | null }) {
  const { taskId, currentUser } = params;
  const [meta, setMeta] = useState<EditorFileMeta | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [issuesById, setIssuesById] = useState<Record<number, SegmentIssue[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorProjectId, setErrorProjectId] = useState<number | null>(null);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [reviewQueueEnabled, setReviewQueueEnabled] = useState(false);
  const [issueFilter, setIssueFilter] = useState<"all" | "error" | "warning">("all");

  const [showWhitespace, setShowWhitespace] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [enterBehavior, setEnterBehavior] = useState<"confirm" | "next">("confirm");
  const [smartCasing, setSmartCasing] = useState(false);

  const [tmHints, setTmHints] = useState<Record<number, Match[]>>({});
  const [termbaseId, setTermbaseId] = useState<number | null>(null);
  const [termbaseEntries, setTermbaseEntries] = useState<TermbaseMatchEntry[]>([]);
  const [concordanceEntries, setConcordanceEntries] = useState<TermbaseConcordanceEntry[]>([]);
  const [concordanceMode, setConcordanceMode] = useState<"auto" | "search">("auto");
  const [concordanceQuery, setConcordanceQuery] = useState("");
  const [concordanceFilters, setConcordanceFilters] = useState({
    searchSource: true,
    searchTarget: false,
    includeDeprecated: true,
    includeForbidden: true,
    category: ""
  });
  const [concordanceLoading, setConcordanceLoading] = useState(false);
  const [mtCache, setMtCache] = useState<Record<number, string>>({});
  const [mtMetaById, setMtMetaById] = useState<Record<number, MtSuggestionMeta>>({});
  const [draftById, setDraftById] = useState<Record<number, string>>({});
  const [draftRunsById, setDraftRunsById] = useState<Record<number, SegmentRun[]>>({});
  const tmHintsRef = useRef<Record<number, Match[]>>({});
  const tmHintsTimestampRef = useRef<Record<number, number>>({});
  const tmInFlightRef = useRef<Set<number>>(new Set());
  const glossaryMatchCacheRef = useRef<Map<string, GlossaryHighlightMatch[]>>(new Map());
  const concordanceCacheRef = useRef<Map<string, { timestamp: number; entries: TermbaseConcordanceEntry[] }>>(new Map());
  const concordanceAbortRef = useRef<AbortController | null>(null);
  const mtInFlightRef = useRef<Set<number>>(new Set());

  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findScope, setFindScope] = useState<FindScope>("both");
  const [findUseRegex, setFindUseRegex] = useState(false);
  const [occurrenceHighlight, setOccurrenceHighlight] = useState<{
    segmentId: number;
    term: string;
    side: "source" | "target";
  } | null>(null);

  const dirtyRef = useRef<Map<number, DirtyEntry>>(new Map());
  const inFlightRef = useRef<Map<number, InFlightSave>>(new Map());
  const retryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const segmentSrcRef = useRef<Record<number, string>>({});
  const segmentsRef = useRef<Segment[]>([]);
  const draftByIdRef = useRef<Record<number, string>>({});
  const draftRunsByIdRef = useRef<Record<number, SegmentRun[]>>({});
  const localRevisionRef = useRef<Record<number, number>>({});
  const serverRevisionRef = useRef<Record<number, number>>({});
  const nextSaveIdRef = useRef(1);
  const historyRef = useRef<Record<number, SegmentHistory>>({});
  const mountedRef = useRef(true);

  const [saveState, setSaveState] = useState<SaveIndicatorState>("saved");
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeoutRef(retryTimerRef);
      clearTimeoutRef(flushTimerRef);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      mtInFlightRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!occurrenceHighlight) return;
    const timer = window.setTimeout(() => {
      setOccurrenceHighlight(null);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [occurrenceHighlight]);

  const projectId = meta?.project?.id ?? null;
  const projectName = meta?.project?.name ?? "";
  const fileName = meta?.file?.originalFilename ?? "";
  const fileId = meta?.file?.id ?? null;
  const sourceLang = meta?.project?.srcLang ?? "";
  const targetLang = meta?.task?.targetLang ?? meta?.project?.tgtLang ?? "";
  const taskReviewStatus = useMemo(
    () => normalizeReviewGateStatus(meta?.task?.status),
    [meta?.task?.status]
  );
  const taskReadOnly = taskReviewStatus === "reviewed";

  const active = useMemo(() => segments.find((s) => s.id === activeId) ?? segments[0], [segments, activeId]);

  const isFileComplete = useMemo(() => {
    return (
      segments.length > 0 &&
      segments.every((s) => coerceSegmentState(s.state, normalizeSegmentStatus(s.status)) === "reviewed")
    );
  }, [segments]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    for (const seg of segments) {
      const version = seg.version ?? 0;
      const current = serverRevisionRef.current[seg.id] ?? 0;
      if (version > current) serverRevisionRef.current[seg.id] = version;
    }
  }, [segments]);

  useEffect(() => {
    draftByIdRef.current = draftById;
  }, [draftById]);

  useEffect(() => {
    draftRunsByIdRef.current = draftRunsById;
  }, [draftRunsById]);

  const visibleSegments = useMemo(
    () => filterSegmentsForReviewQueue(segments, issuesById, reviewQueueEnabled),
    [issuesById, reviewQueueEnabled, segments]
  );

  const findMatchIndices = useMemo(() => {
    const q = findQuery.trim();
    if (!q) return [] as number[];
    let rx: RegExp | null = null;
    if (findUseRegex) {
      try {
        rx = new RegExp(q, "i");
      } catch {
        return [];
      }
    }
    const matches: number[] = [];
    for (let i = 0; i < visibleSegments.length; i++) {
      const seg = visibleSegments[i]!;
      const src = String(seg.src || "");
      const hasDraft = Object.prototype.hasOwnProperty.call(draftById, seg.id);
      const tgt = hasDraft ? String(draftById[seg.id] || "") : String(seg.tgt || "");
      const hay =
        findScope === "source" ? src : findScope === "target" ? tgt : `${src}\n${tgt}`;
      const ok = rx ? rx.test(hay) : hay.toLowerCase().includes(q.toLowerCase());
      if (ok) matches.push(i);
    }
    return matches;
  }, [draftById, findQuery, findScope, findUseRegex, visibleSegments]);

  const termIndex = useMemo(() => buildGlossaryTermIndex(termbaseEntries), [termbaseEntries]);

  useEffect(() => {
    glossaryMatchCacheRef.current.clear();
  }, [termIndex]);

  const getGlossaryMatchesForText = useCallback(
    (text: string) =>
      getGlossaryMatchesForTextFromIndex({
        text,
        termIndex,
        cache: glossaryMatchCacheRef.current
      }),
    [termIndex]
  );

  const glossaryMatchesForActive = useMemo(() => {
    if (!active?.src) return [] as GlossaryHighlightMatch[];
    return getGlossaryMatchesForText(active.src);
  }, [active?.src, getGlossaryMatchesForText]);

  const glossaryEntriesForActive = useMemo(
    () => buildGlossaryEntries(glossaryMatchesForActive),
    [glossaryMatchesForActive]
  );

  const occurrenceIndex = useMemo(() => buildOccurrenceIndex(segments), [segments]);

  const getOccurrencesForTerm = useCallback(
    (term: string) => {
      if (!term) return { source: [], target: [] };
      return findOccurrences(occurrenceIndex, term);
    },
    [occurrenceIndex]
  );

  const computeSegmentIssuesForCurrentGlossary = useCallback(
    (src: string, tgt: string | null | undefined) => computeSegmentIssues(src, tgt, getGlossaryMatchesForText),
    [getGlossaryMatchesForText]
  );

  const resolveSegmentIssuesForCurrentGlossary = useCallback(
    (seg: Segment, tgtOverride?: string | null) => resolveSegmentIssues(seg, getGlossaryMatchesForText, tgtOverride),
    [getGlossaryMatchesForText]
  );

  const issuesList = useMemo(() => buildIssuesList(segments, issuesById), [issuesById, segments]);

  const activeTmMatches = useMemo(() => {
    if (!active) return [];
    return tmHints[active.id] ?? [];
  }, [active, tmHints]);

  useEffect(() => {
    tmHintsRef.current = tmHints;
  }, [tmHints]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!currentUser) return;
    if (!Number.isFinite(taskId) || taskId <= 0) {
      if (!signal?.aborted) {
        setError("Invalid task.");
        setLoading(false);
      }
      return;
    }
    if (signal?.aborted) return;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setErrorStatus(null);
    setErrorCode(null);
    setErrorProjectId(null);
    historyRef.current = {};
    localRevisionRef.current = {};
    serverRevisionRef.current = {};
    nextSaveIdRef.current = 1;

    try {
      tmInFlightRef.current.clear();
      mtInFlightRef.current.clear();
      tmHintsRef.current = {};
      tmHintsTimestampRef.current = {};
      concordanceCacheRef.current.clear();
      setTmHints({});
      setMtCache({});
      setMtMetaById({});
      draftByIdRef.current = {};
      setDraftById({});
      draftRunsByIdRef.current = {};
      setDraftRunsById({});
      const metaRes = await getTask(taskId, { signal });
      if (signal?.aborted) return;
      setMeta(metaRes);

      const first = await getTaskSegments(taskId, { cursor: null, limit: 250, signal });
      if (signal?.aborted) return;
      setSegments(first.segments);
      segmentSrcRef.current = Object.fromEntries(first.segments.map((s) => [s.id, s.src]));
      serverRevisionRef.current = Object.fromEntries(
        first.segments.map((s) => [s.id, s.version ?? 0])
      );
      setIssuesById(Object.fromEntries(first.segments.map((s) => [s.id, resolveSegmentIssuesForCurrentGlossary(s)])));
      setTotal(Number(first.total ?? first.segments.length) || first.segments.length);
      if (first.segments.length > 0) {
        setActiveId((prev) => (prev && first.segments.some((s) => s.id === prev) ? prev : first.segments[0]!.id));
      }

      let cursor = first.nextCursor;
      if (cursor != null) {
        setLoadingMore(true);
        while (cursor != null) {
          if (signal?.aborted) return;
          const next = await getTaskSegments(taskId, { cursor, limit: 500, signal });
          if (signal?.aborted) return;
          if (next.segments.length > 0) {
            setSegments((prev) => [...prev, ...next.segments]);
            for (const seg of next.segments) {
              segmentSrcRef.current[seg.id] = seg.src;
              serverRevisionRef.current[seg.id] = seg.version ?? 0;
            }
            setIssuesById((prev) => {
              const map = { ...prev };
              for (const seg of next.segments) {
                map[seg.id] = resolveSegmentIssuesForCurrentGlossary(seg);
              }
              return map;
            });
          }
          cursor = next.nextCursor;
          if (next.segments.length === 0) break;
        }
      }
    } catch (err: any) {
      if (signal?.aborted) return;
      setMeta(null);
      setSegments([]);
      setTotal(0);
      setIssuesById({});
      segmentSrcRef.current = {};
      historyRef.current = {};
      localRevisionRef.current = {};
      serverRevisionRef.current = {};
      const status = Number(err?.status);
      const code = typeof err?.code === "string" ? err.code : null;
      const projectId = Number(err?.payload?.projectId ?? err?.projectId ?? null);
      setErrorStatus(Number.isFinite(status) ? status : null);
      setErrorCode(code);
      setErrorProjectId(Number.isFinite(projectId) ? projectId : null);
      setError(err?.userMessage || err?.message || "Failed to load file.");
    } finally {
      if (signal?.aborted) return;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUser, resolveSegmentIssuesForCurrentGlossary, taskId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const response = await fetchProjectTermbaseEntries({ projectId, taskId });
        setTermbaseEntries(response.entries);
        setTermbaseId(response.termbaseId ?? null);
      } catch {
        setTermbaseEntries([]);
        setTermbaseId(null);
      }
    })();
  }, [projectId, taskId]);

  useEffect(() => {
    if (!termbaseId || !sourceLang || !targetLang) {
      setConcordanceEntries([]);
      setConcordanceLoading(false);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      return;
    }

    const rawQuery =
      concordanceMode === "auto"
        ? stripInlineTags(active?.src ?? "")
        : concordanceQuery;
    const trimmed = rawQuery.trim();
    if (!trimmed || !normalizeConcordanceText(trimmed)) {
      setConcordanceEntries([]);
      setConcordanceLoading(false);
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      return;
    }

    const cacheKey = JSON.stringify({
      termbaseId,
      q: trimmed.toLowerCase(),
      sourceLang: sourceLang.toLowerCase(),
      targetLang: targetLang.toLowerCase(),
      mode: concordanceMode,
      searchSource: concordanceFilters.searchSource,
      searchTarget: concordanceFilters.searchTarget,
      includeDeprecated: concordanceFilters.includeDeprecated,
      includeForbidden: concordanceFilters.includeForbidden,
      category: concordanceFilters.category.trim().toLowerCase()
    });
    const cached = concordanceCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONCORDANCE_CACHE_TTL_MS) {
      setConcordanceEntries(cached.entries);
      setConcordanceLoading(false);
      return;
    }

    let cancelled = false;
    const delay = concordanceMode === "auto" ? 150 : 300;
    const timer = window.setTimeout(() => {
      concordanceAbortRef.current?.abort();
      const controller = new AbortController();
      concordanceAbortRef.current = controller;
      setConcordanceLoading(true);
      (async () => {
        try {
          const entries =
            concordanceMode === "auto"
              ? await getTermbaseSuggestions({
                  termbaseId,
                  sourceText: trimmed,
                  srcLang: sourceLang,
                  tgtLang: targetLang,
                  filters: {
                    limit: 10,
                    searchSource: concordanceFilters.searchSource,
                    searchTarget: concordanceFilters.searchTarget,
                    includeDeprecated: concordanceFilters.includeDeprecated,
                    includeForbidden: concordanceFilters.includeForbidden,
                    category: concordanceFilters.category,
                    signal: controller.signal
                  }
                })
              : await searchTermbaseConcordance({
                  termbaseId,
                  query: trimmed,
                  searchIn: concordanceFilters.searchTarget ? "target" : "source",
                  srcLang: sourceLang,
                  tgtLang: targetLang,
                  filters: {
                    limit: 10,
                    includeDeprecated: concordanceFilters.includeDeprecated,
                    includeForbidden: concordanceFilters.includeForbidden,
                    category: concordanceFilters.category,
                    signal: controller.signal
                  }
                });
          if (cancelled) return;
          const nextEntries = Array.isArray(entries) ? entries : [];
          concordanceCacheRef.current.set(cacheKey, {
            timestamp: Date.now(),
            entries: nextEntries
          });
          setConcordanceEntries(nextEntries);
        } catch (err: any) {
          if (err?.name === "AbortError") return;
          if (!cancelled) setConcordanceEntries([]);
        } finally {
          if (!cancelled) setConcordanceLoading(false);
          if (concordanceAbortRef.current === controller) {
            concordanceAbortRef.current = null;
          }
        }
      })();
    }, delay);

    return () => {
      cancelled = true;
      concordanceAbortRef.current?.abort();
      concordanceAbortRef.current = null;
      window.clearTimeout(timer);
    };
  }, [
    active?.src,
    concordanceFilters.category,
    concordanceFilters.includeDeprecated,
    concordanceFilters.includeForbidden,
    concordanceFilters.searchSource,
    concordanceFilters.searchTarget,
    concordanceMode,
    concordanceQuery,
    sourceLang,
    targetLang,
    termbaseId
  ]);

  const markDirty = useCallback((segmentId: number, reason: DirtyReason) => {
    dirtyRef.current.set(segmentId, { reason, updatedAtMs: Date.now() });
    setSaveState("saving");
  }, []);

  const logSave = useCallback((label: string, details: Record<string, unknown>) => {
    if (import.meta.env.PROD) return;
    console.debug(`[editor-save] ${label}`, details);
  }, []);

  const bumpLocalRevision = useCallback((segmentId: number) => {
    localRevisionRef.current[segmentId] = (localRevisionRef.current[segmentId] ?? 0) + 1;
  }, []);

  const getCurrentTargetValue = useCallback((segmentId: number) => {
    const draft = draftByIdRef.current;
    if (Object.prototype.hasOwnProperty.call(draft, segmentId)) {
      return String(draft[segmentId] ?? "");
    }
    const seg = segmentsRef.current.find((s) => s.id === segmentId);
    return String(seg?.tgt ?? "");
  }, []);

  const getCurrentTargetRuns = useCallback((segmentId: number): SegmentRun[] => {
    const draftRuns = draftRunsByIdRef.current;
    if (Object.prototype.hasOwnProperty.call(draftRuns, segmentId)) {
      return normalizeRuns(draftRuns[segmentId], getCurrentTargetValue(segmentId));
    }
    const seg = segmentsRef.current.find((s) => s.id === segmentId);
    if (!seg) return [];
    const text = getCurrentTargetValue(segmentId);
    const base = normalizeRuns(seg.tgtRuns, text);
    if (base.length > 0) return base;
    return normalizeRuns(seg.srcRuns, String(seg.src ?? ""));
  }, [getCurrentTargetValue]);

  useEffect(() => {
    if (segmentsRef.current.length === 0) return;
    setIssuesById((prev) => {
      const next = { ...prev };
      for (const seg of segmentsRef.current) {
        const tgt = getCurrentTargetValue(seg.id);
        next[seg.id] = computeSegmentIssuesForCurrentGlossary(seg.src, tgt);
      }
      return next;
    });
  }, [computeSegmentIssuesForCurrentGlossary, getCurrentTargetValue]);

  const shouldClearDraft = useCallback((segmentId: number, tgt: string) => {
    const draft = draftByIdRef.current;
    if (!Object.prototype.hasOwnProperty.call(draft, segmentId)) return true;
    return String(draft[segmentId] ?? "") === String(tgt ?? "");
  }, []);

  const recordHistory = useCallback((segmentId: number, prevValue: string, nextValue: string) => {
    if (prevValue === nextValue) return;
    const entry = historyRef.current[segmentId] ?? { past: [], future: [] };
    entry.past.push(prevValue);
    entry.future = [];
    historyRef.current[segmentId] = entry;
  }, []);

    const commitSavedSegment = useCallback(
      (
        segmentId: number,
        patch: Partial<Segment>,
        options?: { clearDraft?: boolean }
    ) => {
      if (typeof patch.version === "number") {
        serverRevisionRef.current[segmentId] = patch.version;
      }
      setSegments((prev) =>
        prev.map((s) => (s.id === segmentId ? { ...s, ...patch } : s))
      );
      if (options?.clearDraft === false) return;
      setDraftById((prev) => {
        if (!(segmentId in prev)) return prev;
        const next = { ...prev };
        delete next[segmentId];
        draftByIdRef.current = next;
        return next;
      });
      setDraftRunsById((prev) => {
        if (!(segmentId in prev)) return prev;
        const next = { ...prev };
        delete next[segmentId];
        draftRunsByIdRef.current = next;
        return next;
      });
    },
    []
  );

  const applySegmentPatchList = useCallback((updates: Array<Partial<Segment> & { id: number }>) => {
    if (!updates || updates.length === 0) return;
    const map = new Map<number, Partial<Segment>>();
    for (const update of updates) {
      map.set(update.id, update);
      if (typeof update.version === "number") {
        serverRevisionRef.current[update.id] = update.version;
      }
    }
    setSegments((prev) =>
      prev.map((seg) => {
        const patch = map.get(seg.id);
        if (!patch) return seg;
        return { ...seg, ...patch };
      })
    );
    setIssuesById((prev) => {
      const next = { ...prev };
      for (const update of updates) {
        if (Array.isArray(update.issues)) {
          next[update.id] = update.issues as SegmentIssue[];
        }
      }
      return next;
    });
  }, []);

  const flushDirty = useCallback(async () => {
    if (!meta) return;
    if (dirtyRef.current.size === 0) {
      setSaveState("saved");
      setSaveFailure(null);
      return;
    }

    const pending = Array.from(dirtyRef.current.entries())
      .sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs)
      .filter(([segmentId]) => !inFlightRef.current.has(segmentId));

    if (pending.length === 0) return;

    const batch = pending.slice(0, 4);
    await Promise.all(
      batch.map(async ([segmentId, entry]) => {
        const seg = segmentsRef.current.find((s) => s.id === segmentId);
        if (!seg) return;
        const state = coerceSegmentState(seg.state, normalizeSegmentStatus(seg.status));
        const tgt = getCurrentTargetValue(segmentId);
        const draftRuns = draftRunsByIdRef.current[segmentId];
        const baseRuns = normalizeRuns(seg.tgtRuns, String(seg.tgt ?? ""));
        const sourceRuns = normalizeRuns(seg.srcRuns, String(seg.src ?? ""));
        const tgtRuns = normalizeRuns(
          draftRuns,
          tgt
        ).length > 0
          ? normalizeRuns(draftRuns, tgt)
          : projectTextToRuns(tgt, baseRuns.length > 0 ? baseRuns : sourceRuns, sourceRuns);
        const localRevision = localRevisionRef.current[segmentId] ?? 0;
        const serverRevision = serverRevisionRef.current[segmentId] ?? seg.version ?? 0;
        const saveId = nextSaveIdRef.current++;
        const markReviewedIntent = entry.reason === "state";
        inFlightRef.current.set(segmentId, {
          saveId,
          tgt,
          state,
          localRevision,
          serverRevision
        });
        logSave("send", {
          segmentId,
          saveId,
          localRevision,
          serverRevision,
          state
        });
          try {
            const res = await patchTaskSegment({
              taskId,
              segmentId,
              tgt,
              tgtRuns,
              originDetails: seg.originDetails ?? undefined,
              ...(markReviewedIntent ? { state: "reviewed", markReviewed: true } : {}),
              version: serverRevision,
              sourceType: seg.sourceType,
              sourceScore: seg.sourceScore,
              sourceMatchId: seg.sourceMatchId
            });
          const latestLocalRevision = localRevisionRef.current[segmentId] ?? 0;
          const inFlight = inFlightRef.current.get(segmentId);
          if (!inFlight || inFlight.saveId !== saveId) {
            logSave("ignore", { segmentId, saveId, reason: "stale-ack" });
            return;
          }
          const currentValue = getCurrentTargetValue(segmentId);
          const hasNewerLocal = latestLocalRevision > localRevision && currentValue !== tgt;
          const clearDraft = shouldClearDraft(segmentId, tgt);
          commitSavedSegment(segmentId, {
            tgt,
            ...(Array.isArray(res.tgtRuns) ? { tgtRuns: res.tgtRuns } : { tgtRuns }),
            version: res.version,
            ...(res.status ? { status: res.status } : {}),
            ...(res.state ? { state: res.state } : {}),
            ...(res.isLocked !== undefined ? { isLocked: res.isLocked } : {}),
            ...(res.generatedByLlm !== undefined ? { generatedByLlm: res.generatedByLlm } : {}),
            ...(res.qeScore !== undefined ? { qeScore: res.qeScore } : {}),
            ...(res.originDetails !== undefined ? { originDetails: res.originDetails } : {})
          }, { clearDraft: clearDraft && !hasNewerLocal });
          if (Array.isArray(res.issues)) {
            setIssuesById((prev) => ({ ...prev, [segmentId]: res.issues ?? [] }));
          } else {
            setIssuesById((prev) => ({ ...prev, [segmentId]: computeSegmentIssuesForCurrentGlossary(seg.src, tgt) }));
          }
          if (clearDraft && !hasNewerLocal) {
            dirtyRef.current.delete(segmentId);
          } else {
            dirtyRef.current.set(segmentId, { reason: "tgt", updatedAtMs: Date.now() });
          }
          logSave("ack", {
            segmentId,
            saveId,
            localRevision,
            serverRevision: res.version,
            hasNewerLocal
          });
        } catch (err: any) {
          if (err?.code === "SEGMENT_VERSION_CONFLICT") {
            const latestLocalRevision = localRevisionRef.current[segmentId] ?? 0;
            const hasNewerLocal = latestLocalRevision > localRevision;
            const remoteDiffers =
              typeof err.currentVersion === "number" ? err.currentVersion !== serverRevision : true;
            if (typeof err.currentVersion === "number") {
              serverRevisionRef.current[segmentId] = err.currentVersion;
            }
            logSave("conflict", {
              segmentId,
              saveId,
              localRevision,
              serverRevision,
              currentVersion: err.currentVersion,
              hasNewerLocal,
              remoteDiffers
            });
            if (hasNewerLocal || !remoteDiffers) {
              dirtyRef.current.set(segmentId, { reason: "tgt", updatedAtMs: Date.now() });
              setSaveState("saving");
              setSaveFailure(null);
            } else {
              setSaveFailure({
                segmentId,
                message: "Segment modified by another user. Reload to continue.",
                kind: "conflict"
              });
              setSaveState("error");
            }
          } else if (isNetworkError(err)) {
            setSaveFailure({
              segmentId,
              message: "Offline. Changes queued.",
              kind: "offline"
            });
            setSaveState("offline");
            logSave("offline", { segmentId, saveId });
          } else {
            setSaveFailure({
              segmentId,
              message: err?.message || "Autosave failed.",
              kind: "error"
            });
            setSaveState("error");
            logSave("error", { segmentId, saveId, code: err?.code });
          }
        } finally {
          inFlightRef.current.delete(segmentId);
        }
      })
    );

    if (dirtyRef.current.size === 0 && inFlightRef.current.size === 0) {
      setSaveFailure(null);
      setSaveState("saved");
      return;
    }

    clearTimeoutRef(retryTimerRef);
    retryTimerRef.current = window.setTimeout(() => {
      void flushDirty();
    }, 1800);
  }, [commitSavedSegment, computeSegmentIssuesForCurrentGlossary, getCurrentTargetValue, logSave, meta, shouldClearDraft, taskId]);

  const scheduleFlush = useCallback(() => {
    clearTimeoutRef(flushTimerRef);
    flushTimerRef.current = window.setTimeout(() => {
      void flushDirty();
    }, 650);
  }, [flushDirty]);

  const flushPendingChanges = useCallback(async () => {
    await flushDirty();
    const deadline = Date.now() + 8_000;
    while ((dirtyRef.current.size > 0 || inFlightRef.current.size > 0) && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      await flushDirty();
    }
    return {
      dirty: dirtyRef.current.size,
      inFlight: inFlightRef.current.size
    };
  }, [flushDirty]);

  const updateTarget = useCallback(
    (
      segmentId: number,
      value: string,
      options?: {
        skipHistory?: boolean;
        sourceMeta?: SourceMeta;
        runs?: SegmentRun[];
        originDetails?: SegmentOriginDetails | null;
      }
    ) => {
      if (taskReadOnly) return;
      const prevValue = getCurrentTargetValue(segmentId);
      const targetChanged = prevValue !== value;
      const sourceMeta = options?.sourceMeta;
      const hasOriginDetails = Object.prototype.hasOwnProperty.call(options ?? {}, "originDetails");
      const originDetails = options?.originDetails ?? {};
      const previousRuns = getCurrentTargetRuns(segmentId);
      const explicitRuns = options?.runs ? normalizeRuns(options.runs, value) : null;
      const inferredRuns =
        explicitRuns ??
        (targetChanged
          ? projectTextToRuns(value, previousRuns, normalizeRuns(segmentsRef.current.find((s) => s.id === segmentId)?.srcRuns, String(segmentsRef.current.find((s) => s.id === segmentId)?.src ?? "")))
          : previousRuns);
      const runsChanged = JSON.stringify(normalizeRuns(inferredRuns, value)) !== JSON.stringify(normalizeRuns(previousRuns, prevValue));

      if (!targetChanged && !sourceMeta && !runsChanged && !hasOriginDetails) return;

      if (targetChanged) {
        if (!options?.skipHistory) recordHistory(segmentId, prevValue, value);
        bumpLocalRevision(segmentId);
        draftByIdRef.current = { ...draftByIdRef.current, [segmentId]: value };
        setDraftById((prev) => {
          if (prev[segmentId] === value) return prev;
          return { ...prev, [segmentId]: value };
        });
        const src = segmentSrcRef.current[segmentId];
        if (src) {
          setIssuesById((prev) => ({ ...prev, [segmentId]: computeSegmentIssuesForCurrentGlossary(src, value) }));
        }
      }

      if (targetChanged || runsChanged || explicitRuns) {
        const nextRuns = normalizeRuns(inferredRuns, value);
        draftRunsByIdRef.current = { ...draftRunsByIdRef.current, [segmentId]: nextRuns };
        setDraftRunsById((prev) => ({ ...prev, [segmentId]: nextRuns }));
      }

      if (sourceMeta || hasOriginDetails) {
        setSegments((prev) => {
          const next = prev.map((seg) =>
            seg.id === segmentId
              ? {
                  ...seg,
                  ...(sourceMeta
                    ? {
                        sourceType: sourceMeta.type,
                        sourceScore: sourceMeta.score,
                        sourceMatchId: sourceMeta.matchId ?? null
                      }
                    : {}),
                  ...(hasOriginDetails ? { originDetails } : {})
                }
              : seg
          );
          segmentsRef.current = next;
          return next;
        });
      }

      markDirty(segmentId, targetChanged ? "tgt" : runsChanged ? "format" : "source");
      scheduleFlush();
    },
    [
      bumpLocalRevision,
      computeSegmentIssuesForCurrentGlossary,
      getCurrentTargetValue,
      getCurrentTargetRuns,
      markDirty,
      recordHistory,
      scheduleFlush,
      taskReadOnly
    ]
  );

  const {
    insertTextAtCursor, insertGlossaryMatch, insertGlossaryTerm, jumpToOccurrence, jumpToIssue,
    insertConcordanceEntry, copyPlaceholdersFromSource, appendMissingPlaceholders, undoActive, redoActive
  } = useEditorFileEditorActions({
    active, activeId, getCurrentTargetValue, historyRef, segmentSrcRef,
    segmentsRef, setActiveId, setOccurrenceHighlight, smartCasing, updateTarget
  });

  const actionHandlers = useEditorFileActions({
    acceptCleanLlmDrafts, active, applySegmentPatchList, bumpLocalRevision, coerceSegmentState, commitSavedSegment,
    completeTask, computeSegmentIssuesForCurrentGlossary, concordanceEntries, dirtyRef, draftById, draftByIdRef,
    draftRunsByIdRef,
    findMatchIndices, findQuery, findUseRegex, getCurrentTargetValue, getCurrentTargetRuns, getGlossaryMatchesForText, historyRef, inFlightRef,
    insertConcordanceEntry, insertGlossaryMatch, isNetworkError, issuesById, load, localRevisionRef, logSave, markDirty,
    markSegmentsReviewed, meta, MT_CACHE_TTL_MS, mtCache, mtInFlightRef, mtMetaById, nextSaveIdRef, normalizeSegmentStatus,
    patchTaskSegment, recomputeSegmentIssues, replaceQuery, requestSegmentLLM, scheduleFlush, searchTM, segments, segmentSrcRef,
    segmentsRef, serverRevisionRef, setActiveId, setDraftById, setError, setIssuesById, setMeta, setMtCache, setMtMetaById,
    setDraftRunsById, setSaveFailure, setSaveState, setSegments, setTmHints, shouldClearDraft, taskId, taskReadOnly, TM_HINT_TTL_MS, tmHintsRef,
    tmHintsTimestampRef, tmInFlightRef, updateTarget, visibleSegments
  });
  const {
    markReviewed, markReviewedBulk, setSegmentStatus, setSegmentLock, setSegmentReviewedState, toggleLock, confirmActive,
    goPrev, goNext, canGoPrev, canGoNext, canUndo, canRedo, goToSegmentNumber, goToMatch, replaceAllInTarget,
    ensureTmHints, generateMtForSegment, generateMtForActive, applySuggestionToSegment, applyBestSuggestionToSegment,
    applySuggestionToActive, applyBestSuggestionToActive, acceptCleanDrafts, recomputeIssues, complete, reload,
    getTmMatchesForSegment, getMtSuggestionForSegment, getMtSuggestionMetaForSegment
  } = actionHandlers;

  return {
    meta,
    projectId,
    projectName,
    fileName,
    fileId: fileId ?? undefined,
    segments,
    visibleSegments,
    issuesById,
    total,
    loading,
    loadingMore,
    error,
    errorStatus,
    errorCode,
    errorProjectId,
    active,
    activeId,
    setActiveId,
    saveState,
    saveFailure,
    showWhitespace,
    setShowWhitespace,
    showTags,
    setShowTags,
    enterBehavior,
    setEnterBehavior,
    smartCasing,
    setSmartCasing,
    reviewQueueEnabled,
    setReviewQueueEnabled,
    issueFilter,
    setIssueFilter,
    tmHints,
    ensureTmHints,
    getTmMatchesForSegment,
    termbaseId,
    glossaryMatchesForActive,
    glossaryEntriesForActive,
    getGlossaryMatchesForText,
    insertGlossaryMatch,
    insertGlossaryTerm,
    concordanceEntries,
    concordanceMode,
    setConcordanceMode,
    concordanceQuery,
    setConcordanceQuery,
    concordanceFilters,
    setConcordanceFilters,
    concordanceLoading,
    getOccurrencesForTerm,
    jumpToOccurrence,
    issuesList,
    jumpToIssue,
    occurrenceHighlight,
    sourceLang,
    targetLang,
    taskReviewStatus,
    taskReadOnly,
    copyPlaceholdersFromSource,
    appendMissingPlaceholders,
    activeTmMatches,
    mtSuggestion: active ? mtCache[active.id] ?? "" : "",
    mtSuggestionMeta: active ? mtMetaById[active.id] ?? null : null,
    getMtSuggestionForSegment,
    getMtSuggestionMetaForSegment,
    generateMtForSegment,
    generateMtForActive,
    draftById,
    draftRunsById,
    getCurrentTargetRuns,
    updateTarget,
    flushPendingChanges,
    undoActive,
    redoActive,
    canUndo,
    canRedo,
    markReviewed,
    markReviewedBulk,
    setSegmentStatus,
    setSegmentReviewedState,
    setSegmentLock,
    toggleLock,
    confirmActive,
    goPrev,
    goNext,
    canGoPrev,
    canGoNext,
    goToSegmentNumber,
    findQuery,
    setFindQuery,
    replaceQuery,
    setReplaceQuery,
    findScope,
    setFindScope,
    findUseRegex,
    setFindUseRegex,
    findMatchIndices,
    goToMatch,
    replaceAllInTarget,
    applySuggestionToSegment,
    applySuggestionToActive,
    applyBestSuggestionToSegment,
    applyBestSuggestionToActive,
    acceptCleanDrafts,
    recomputeIssues,
    complete,
    isFileComplete,
    reload
  };
}
