import { useCallback, useMemo } from "react";
import type { Match, Segment } from "../../../api";
import { normalizeRuns, projectTextToRuns } from "../../../utils/richTextRuns";
import { extractPlaceholders } from "../../../utils/qa";

type SuggestionKind = "tm" | "glossary" | "mt";

export function useEditorFileActions(ctx: any) {
  const {
    acceptCleanLlmDrafts,
    active,
    applySegmentPatchList,
    bumpLocalRevision,
    coerceSegmentState,
    commitSavedSegment,
    completeTask,
    computeSegmentIssuesForCurrentGlossary,
    concordanceEntries,
    dirtyRef,
    draftById,
    draftByIdRef,
    draftRunsByIdRef,
    findMatchIndices,
    findQuery,
    findUseRegex,
    getCurrentTargetValue,
    getCurrentTargetRuns,
    getGlossaryMatchesForText,
    historyRef,
    inFlightRef,
    insertConcordanceEntry,
    insertGlossaryMatch,
    isNetworkError,
    issuesById,
    load,
    localRevisionRef,
    logSave,
    markDirty,
    markSegmentsReviewed,
    meta,
    MT_CACHE_TTL_MS,
    mtCache,
    mtInFlightRef,
    mtMetaById,
    nextSaveIdRef,
    normalizeSegmentStatus,
    patchTaskSegment,
    recomputeSegmentIssues,
    replaceQuery,
    requestSegmentLLM,
    scheduleFlush,
    searchTM,
    segments,
    segmentSrcRef,
    segmentsRef,
    serverRevisionRef,
    setActiveId,
    setDraftById,
    setDraftRunsById,
    setError,
    setIssuesById,
    setMeta,
    setMtCache,
    setMtMetaById,
    setSaveFailure,
    setSaveState,
    setSegments,
    setTmHints,
    shouldClearDraft,
    taskId,
    taskReadOnly,
    TM_HINT_TTL_MS,
    tmHintsRef,
    tmHintsTimestampRef,
    tmInFlightRef,
    updateTarget,
    visibleSegments
  } = ctx;
  const markReviewed = useCallback(
    async (segmentId: number) => {
      if (taskReadOnly) return false;
      const seg = segmentsRef.current.find((s) => s.id === segmentId);
      if (!seg) return false;
      const tgt = getCurrentTargetValue(segmentId);
      if (!tgt.trim()) {
        setIssuesById((prev) => ({ ...prev, [segmentId]: computeSegmentIssuesForCurrentGlossary(seg.src, tgt) }));
        return false;
      }

      const localRevision = localRevisionRef.current[segmentId] ?? 0;
      const serverRevision = serverRevisionRef.current[segmentId] ?? seg.version ?? 0;
      const saveId = nextSaveIdRef.current++;
      setSaveState("saving");
      logSave("send-review", {
        segmentId,
        saveId,
        localRevision,
        serverRevision
      });
      try {
        const res = await patchTaskSegment({
          taskId,
          segmentId,
          tgt,
          tgtRuns: normalizeRuns(getCurrentTargetRuns(segmentId), tgt),
          originDetails: seg.originDetails ?? undefined,
          state: "reviewed",
          markReviewed: true,
          version: serverRevision,
          sourceType: seg.sourceType,
          sourceScore: seg.sourceScore,
          sourceMatchId: seg.sourceMatchId
        });
        const clearDraft = shouldClearDraft(segmentId, tgt);
        commitSavedSegment(segmentId, {
          tgt,
          ...(Array.isArray(res.tgtRuns)
            ? { tgtRuns: normalizeRuns(res.tgtRuns, tgt) }
            : { tgtRuns: normalizeRuns(getCurrentTargetRuns(segmentId), tgt) }),
          version: res.version,
          ...(res.status ? { status: res.status } : {}),
          ...(res.state ? { state: res.state } : {}),
          ...(res.isLocked !== undefined ? { isLocked: res.isLocked } : {}),
          ...(res.originDetails !== undefined ? { originDetails: res.originDetails } : {})
        }, { clearDraft });
        if (Array.isArray(res.issues)) {
          setIssuesById((prev) => ({ ...prev, [segmentId]: res.issues ?? [] }));
        } else {
          setIssuesById((prev) => ({ ...prev, [segmentId]: computeSegmentIssuesForCurrentGlossary(seg.src, tgt) }));
        }
        if (clearDraft) dirtyRef.current.delete(segmentId);
        setSaveFailure(null);
        setSaveState(dirtyRef.current.size > 0 ? "saving" : "saved");
        logSave("ack-review", {
          segmentId,
          saveId,
          localRevision,
          serverRevision: res.version
        });
        return true;
      } catch (err: any) {
        if (err?.code === "SEGMENT_VERSION_CONFLICT") {
          const remoteDiffers =
            typeof err.currentVersion === "number" ? err.currentVersion !== serverRevision : true;
          if (typeof err.currentVersion === "number") {
            serverRevisionRef.current[segmentId] = err.currentVersion;
          }
          logSave("conflict-review", {
            segmentId,
            saveId,
            localRevision,
            serverRevision,
            currentVersion: err.currentVersion,
            remoteDiffers
          });
          if (remoteDiffers) {
            setSaveFailure({
              segmentId,
              message: "Segment modified by another user. Reload to continue.",
              kind: "conflict"
            });
            setSaveState("error");
          } else {
            setSaveFailure({
              segmentId,
              message: err?.message || "Autosave failed.",
              kind: "error"
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
          markDirty(segmentId, "state");
          scheduleFlush();
          logSave("offline-review", { segmentId, saveId });
        } else {
          setSaveFailure({
            segmentId,
            message: err?.message || "Failed to update segment.",
            kind: "error"
          });
          setSaveState("error");
          logSave("error-review", { segmentId, saveId, code: err?.code });
        }
        return false;
      }
    },
    [
      commitSavedSegment,
      computeSegmentIssuesForCurrentGlossary,
      getCurrentTargetValue,
      getCurrentTargetRuns,
      logSave,
      markDirty,
      scheduleFlush,
      shouldClearDraft,
      taskId,
      taskReadOnly
    ]
  );

  const markReviewedBulk = useCallback(
    async (segmentIds: number[]) => {
      if (taskReadOnly) return;
      const uniqueIds = Array.from(new Set(segmentIds))
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (uniqueIds.length === 0) return;
      setSaveState("saving");
      try {
        const res = await markSegmentsReviewed({ segmentIds: uniqueIds });
        applySegmentPatchList(res.segments ?? []);
        setSaveFailure(null);
        setSaveState("saved");
      } catch (err: any) {
        setSaveFailure({
          segmentId: uniqueIds[0]!,
          message: err?.message || "Failed to update selected segments.",
          kind: "error"
        });
        setSaveState("error");
      }
    },
    [applySegmentPatchList, taskReadOnly]
  );

  const setSegmentLock = useCallback(async (segmentId: number, nextLocked: boolean) => {
    if (taskReadOnly) return false;
    const seg = segmentsRef.current.find((item) => item.id === segmentId);
    if (!seg) return false;
    const tgt = getCurrentTargetValue(segmentId);
    const serverRevision = serverRevisionRef.current[segmentId] ?? seg.version ?? 0;
    const saveId = nextSaveIdRef.current++;
    setSaveState("saving");
    logSave("send-lock", { segmentId, saveId, serverRevision, nextLocked });
    try {
      const res = await patchTaskSegment({
        taskId,
        segmentId,
        tgt,
        tgtRuns: normalizeRuns(getCurrentTargetRuns(segmentId), tgt),
        originDetails: seg.originDetails ?? undefined,
        isLocked: nextLocked,
        version: serverRevision,
        sourceType: seg.sourceType,
        sourceScore: seg.sourceScore,
        sourceMatchId: seg.sourceMatchId
      });
      const clearDraft = shouldClearDraft(segmentId, tgt);
      commitSavedSegment(
        segmentId,
        {
          tgt,
          ...(Array.isArray(res.tgtRuns)
            ? { tgtRuns: normalizeRuns(res.tgtRuns, tgt) }
            : { tgtRuns: normalizeRuns(getCurrentTargetRuns(segmentId), tgt) }),
          version: res.version,
          ...(res.status ? { status: res.status } : {}),
          ...(res.state ? { state: res.state } : {}),
          ...(res.isLocked !== undefined ? { isLocked: res.isLocked } : { isLocked: nextLocked }),
          ...(res.originDetails !== undefined ? { originDetails: res.originDetails } : {})
        },
        { clearDraft }
      );
      if (Array.isArray(res.issues)) {
        setIssuesById((prev) => ({ ...prev, [segmentId]: res.issues ?? [] }));
      } else {
        setIssuesById((prev) => ({ ...prev, [segmentId]: computeSegmentIssuesForCurrentGlossary(seg.src, tgt) }));
      }
      setSaveFailure(null);
      setSaveState(dirtyRef.current.size > 0 ? "saving" : "saved");
      logSave("ack-lock", { segmentId, saveId, serverRevision: res.version, nextLocked });
      return true;
    } catch (err: any) {
      if (err?.code === "SEGMENT_VERSION_CONFLICT") {
        if (typeof err.currentVersion === "number") {
          serverRevisionRef.current[segmentId] = err.currentVersion;
        }
        setSaveFailure({
          segmentId,
          message: "Segment modified by another user. Reload to continue.",
          kind: "conflict"
        });
        setSaveState("error");
      } else if (isNetworkError(err)) {
        setSaveFailure({
          segmentId,
          message: "Offline. Changes queued.",
          kind: "offline"
        });
        setSaveState("offline");
      } else {
        setSaveFailure({
          segmentId,
          message: err?.message || "Failed to update segment.",
          kind: "error"
        });
        setSaveState("error");
      }
      logSave("error-lock", { segmentId, saveId, code: err?.code });
      return false;
    }
  }, [
    commitSavedSegment,
    computeSegmentIssuesForCurrentGlossary,
    getCurrentTargetValue,
    getCurrentTargetRuns,
    logSave,
    shouldClearDraft,
    taskId,
    taskReadOnly
  ]);

  const setSegmentStatus = useCallback(
    async (segmentId: number, nextStatus: "draft" | "under_review" | "reviewed") => {
      if (taskReadOnly) return false;
      if (nextStatus === "reviewed") {
        return markReviewed(segmentId);
      }

      const seg = segmentsRef.current.find((item) => item.id === segmentId);
      if (!seg) return false;
      const tgt = getCurrentTargetValue(segmentId);
      const localRevision = localRevisionRef.current[segmentId] ?? 0;
      const serverRevision = serverRevisionRef.current[segmentId] ?? seg.version ?? 0;
      const saveId = nextSaveIdRef.current++;
      setSaveState("saving");
      logSave("send-status", {
        segmentId,
        saveId,
        localRevision,
        serverRevision,
        nextStatus
      });

      try {
        const res = await patchTaskSegment({
          taskId,
          segmentId,
          tgt,
          tgtRuns: normalizeRuns(getCurrentTargetRuns(segmentId), tgt),
          originDetails: seg.originDetails ?? undefined,
          status: nextStatus,
          state: "draft",
          isLocked: false,
          version: serverRevision,
          sourceType: seg.sourceType,
          sourceScore: seg.sourceScore,
          sourceMatchId: seg.sourceMatchId
        });
        const clearDraft = shouldClearDraft(segmentId, tgt);
        commitSavedSegment(
          segmentId,
          {
            tgt,
            ...(Array.isArray(res.tgtRuns)
              ? { tgtRuns: normalizeRuns(res.tgtRuns, tgt) }
              : { tgtRuns: normalizeRuns(getCurrentTargetRuns(segmentId), tgt) }),
            version: res.version,
            ...(res.status ? { status: res.status } : { status: nextStatus }),
            ...(res.state ? { state: res.state } : { state: "draft" }),
            ...(res.isLocked !== undefined ? { isLocked: res.isLocked } : { isLocked: false }),
            ...(res.originDetails !== undefined ? { originDetails: res.originDetails } : {})
          },
          { clearDraft }
        );
        if (Array.isArray(res.issues)) {
          setIssuesById((prev) => ({ ...prev, [segmentId]: res.issues ?? [] }));
        } else {
          setIssuesById((prev) => ({ ...prev, [segmentId]: computeSegmentIssuesForCurrentGlossary(seg.src, tgt) }));
        }
        setSaveFailure(null);
        setSaveState(dirtyRef.current.size > 0 ? "saving" : "saved");
        logSave("ack-status", {
          segmentId,
          saveId,
          localRevision,
          serverRevision: res.version,
          nextStatus
        });
        return true;
      } catch (err: any) {
        if (err?.code === "SEGMENT_VERSION_CONFLICT") {
          const remoteDiffers =
            typeof err.currentVersion === "number" ? err.currentVersion !== serverRevision : true;
          if (typeof err.currentVersion === "number") {
            serverRevisionRef.current[segmentId] = err.currentVersion;
          }
          logSave("conflict-status", {
            segmentId,
            saveId,
            localRevision,
            serverRevision,
            currentVersion: err.currentVersion,
            remoteDiffers,
            nextStatus
          });
          setSaveFailure({
            segmentId,
            message: remoteDiffers
              ? "Segment modified by another user. Reload to continue."
              : err?.message || "Autosave failed.",
            kind: remoteDiffers ? "conflict" : "error"
          });
          setSaveState("error");
          return false;
        }

        if (isNetworkError(err)) {
          setSaveFailure({
            segmentId,
            message: "Offline. Changes queued.",
            kind: "offline"
          });
          setSaveState("offline");
          markDirty(segmentId, "state");
          scheduleFlush();
          logSave("offline-status", { segmentId, saveId, nextStatus });
          return false;
        }

        setSaveFailure({
          segmentId,
          message: err?.message || "Failed to update segment state.",
          kind: "error"
        });
        setSaveState("error");
        logSave("error-status", { segmentId, saveId, code: err?.code, nextStatus });
        return false;
      }
    },
    [
      commitSavedSegment,
      computeSegmentIssuesForCurrentGlossary,
      getCurrentTargetValue,
      getCurrentTargetRuns,
      logSave,
      markDirty,
      markReviewed,
      scheduleFlush,
      shouldClearDraft,
      taskId,
      taskReadOnly
    ]
  );

  const setSegmentReviewedState = useCallback(
    async (segmentId: number, reviewed: boolean) => {
      return setSegmentStatus(segmentId, reviewed ? "reviewed" : "draft");
    },
    [setSegmentStatus]
  );

  const toggleLock = useCallback(async () => {
    if (!active) return;
    const fallbackState = coerceSegmentState(active.state, normalizeSegmentStatus(active.status));
    const currentLocked =
      active.isLocked === undefined ? fallbackState === "reviewed" : Boolean(active.isLocked);
    await setSegmentLock(active.id, !currentLocked);
  }, [active, setSegmentLock]);

  const confirmActive = useCallback(
    async (opts?: { moveNext?: boolean }) => {
      if (!active) return;
      await markReviewed(active.id);
      if (opts?.moveNext) {
        const idx = visibleSegments.findIndex((s) => s.id === active.id);
        const next = idx >= 0 ? visibleSegments[idx + 1] : null;
        if (next) setActiveId(next.id);
      }
    },
    [active, markReviewed, visibleSegments]
  );

  const goPrev = useCallback(() => {
    if (!active) return;
    const idx = visibleSegments.findIndex((s) => s.id === active.id);
    if (idx > 0) setActiveId(visibleSegments[idx - 1]!.id);
  }, [active, visibleSegments]);

  const goNext = useCallback(() => {
    if (!active) return;
    const idx = visibleSegments.findIndex((s) => s.id === active.id);
    if (idx >= 0 && idx < visibleSegments.length - 1) setActiveId(visibleSegments[idx + 1]!.id);
  }, [active, visibleSegments]);

  const canGoPrev = useMemo(() => {
    if (!active) return false;
    const idx = visibleSegments.findIndex((s) => s.id === active.id);
    return idx > 0;
  }, [active, visibleSegments]);

  const canGoNext = useMemo(() => {
    if (!active) return false;
    const idx = visibleSegments.findIndex((s) => s.id === active.id);
    return idx >= 0 && idx < visibleSegments.length - 1;
  }, [active, visibleSegments]);

  const goToSegmentNumber = useCallback(
    (n: number) => {
      if (!Number.isFinite(n) || n <= 0) return;
      const targetIdx = n - 1;
      const match = segments.find((s) => Number(s.index) === targetIdx) ?? null;
      if (match) setActiveId(match.id);
    },
    [segments]
  );

  const goToMatch = useCallback(
    (dir: 1 | -1) => {
      if (findMatchIndices.length === 0) return;
      const activeIdx = active ? visibleSegments.findIndex((s) => s.id === active.id) : -1;
      const list = findMatchIndices;

      if (dir === 1) {
        const nextIdx = list.find((i) => i > activeIdx) ?? list[0]!;
        const seg = visibleSegments[nextIdx];
        if (seg) setActiveId(seg.id);
        return;
      }

      let prevIdx = list[list.length - 1]!;
      for (let i = list.length - 1; i >= 0; i--) {
        const idx = list[i]!;
        if (idx < activeIdx) {
          prevIdx = idx;
          break;
        }
      }
      const seg = visibleSegments[prevIdx];
      if (seg) setActiveId(seg.id);
    },
    [active, findMatchIndices, visibleSegments]
  );

  const replaceAllInTarget = useCallback(async () => {
    const q = findQuery.trim();
    if (!q) return;
    if (findUseRegex) return;
    const needle = q.toLowerCase();
    const repl = replaceQuery;
    const replacements: Record<number, string> = {};
    const changedIds: number[] = [];
    setDraftById((prev) => {
      const next = { ...prev };
      for (const seg of segments) {
        const hasDraft = Object.prototype.hasOwnProperty.call(prev, seg.id);
        const current = hasDraft ? String(prev[seg.id] ?? "") : String(seg.tgt ?? "");
        if (!current) continue;
        if (!current.toLowerCase().includes(needle)) continue;
        const replaced = current.split(q).join(repl);
        if (replaced === current) continue;
        next[seg.id] = replaced;
        replacements[seg.id] = replaced;
        changedIds.push(seg.id);
      }
      draftByIdRef.current = next;
      for (const id of changedIds) bumpLocalRevision(id);
      return next;
    });

    const ids = Object.keys(replacements).map((k) => Number(k)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return;
    setDraftRunsById((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const seg = segmentsRef.current.find((item) => item.id === id);
        if (!seg) continue;
        const nextText = String(replacements[id] ?? "");
        const currentRuns = normalizeRuns(getCurrentTargetRuns(id), getCurrentTargetValue(id));
        const sourceRuns = normalizeRuns(seg.srcRuns, String(seg.src ?? ""));
        const projected = projectTextToRuns(
          nextText,
          currentRuns.length > 0 ? currentRuns : normalizeRuns(seg.tgtRuns, String(seg.tgt ?? "")),
          sourceRuns
        );
        next[id] = normalizeRuns(projected, nextText);
      }
      draftRunsByIdRef.current = next;
      return next;
    });
    setIssuesById((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const src = segmentSrcRef.current[id];
        if (!src) continue;
        next[id] = computeSegmentIssuesForCurrentGlossary(src, replacements[id]);
      }
      return next;
    });
    for (const id of ids) markDirty(id, "tgt");
    scheduleFlush();
  }, [
    bumpLocalRevision,
    computeSegmentIssuesForCurrentGlossary,
    findQuery,
    findUseRegex,
    getCurrentTargetRuns,
    getCurrentTargetValue,
    markDirty,
    replaceQuery,
    scheduleFlush,
    segments,
    setDraftRunsById
  ]);

  const ensureTmHints = useCallback(
    async (items: Segment[]) => {
      if (!meta) return;
      const srcLang = meta.project.srcLang;
      const tgtLang = meta.project.tgtLang;
      const tmId = meta.task?.tmxId ?? undefined;
      const now = Date.now();

      const pending = items
        .filter((s) => {
          const cachedAt = tmHintsTimestampRef.current[s.id] ?? 0;
          const stale = now - cachedAt > TM_HINT_TTL_MS;
          return tmHintsRef.current[s.id] === undefined || stale;
        })
        .map((s) => s.id);
      if (pending.length === 0) return;

      const unique = Array.from(new Set(pending)).filter((id) => !tmInFlightRef.current.has(id));
      if (unique.length === 0) return;

      const BATCH = 4;
      for (let i = 0; i < unique.length; i += BATCH) {
        const batchIds = unique.slice(i, i + BATCH);
        batchIds.forEach((id) => tmInFlightRef.current.add(id));
        const batchSegments = items.filter((s) => batchIds.includes(s.id));

        const results = await Promise.all(
          batchSegments.map(async (seg) => {
            try {
              const matches = await searchTM(srcLang, tgtLang, seg.src, 5, tmId);
              return { id: seg.id, matches: Array.isArray(matches) ? matches : [] };
            } catch {
              return { id: seg.id, matches: [] as Match[] };
            }
          })
        );

        setTmHints((prev) => {
          const next = { ...prev };
          for (const r of results) {
            next[r.id] = r.matches;
            tmHintsTimestampRef.current[r.id] = Date.now();
          }
          return next;
        });

        batchIds.forEach((id) => tmInFlightRef.current.delete(id));
      }
    },
    [meta]
  );

  const normalizeMatchPct = useCallback((score: number | null | undefined) => {
    if (typeof score !== "number" || Number.isNaN(score)) return null;
    const normalized = score <= 1 ? score * 100 : score;
    return Math.round(Math.max(0, Math.min(100, normalized)));
  }, []);

  const generateMtForSegment = useCallback(
    async (segmentId: number, opts?: { force?: boolean }) => {
      const seg = segmentsRef.current.find((item) => item.id === segmentId);
      if (!seg) return "";
      const cached = mtCache[segmentId];
      const cachedMeta = mtMetaById[segmentId];
      const fresh = cachedMeta ? Date.now() - cachedMeta.generatedAt < MT_CACHE_TTL_MS : false;
      if (!opts?.force && cached && fresh) return cached;
      if (mtInFlightRef.current.has(segmentId)) {
        return cached || "";
      }

      mtInFlightRef.current.add(segmentId);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        const res = await requestSegmentLLM({ segmentId });
        const content = String(res?.choices?.[0]?.message?.content ?? res?.choices?.[0]?.text ?? "").trim();
        if (!content) return "";
        const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        const latencyMs = Math.max(0, Math.round(endedAt - startedAt));
        const model = typeof res?.model === "string" ? res.model : null;
        const rawConfidence = Number(
          res?.choices?.[0]?.confidence ?? res?.confidence ?? res?.meta?.confidence ?? Number.NaN
        );
        const confidence = Number.isFinite(rawConfidence)
          ? Math.max(0, Math.min(1, rawConfidence))
          : null;
        setMtCache((prev) => ({ ...prev, [segmentId]: content }));
        setMtMetaById((prev) => ({
          ...prev,
          [segmentId]: {
            model,
            latencyMs,
            confidence,
            generatedAt: Date.now()
          }
        }));
        return content;
      } catch {
        return "";
      } finally {
        mtInFlightRef.current.delete(segmentId);
      }
    },
    [mtCache, mtMetaById]
  );

  const generateMtForActive = useCallback(async () => {
    if (!active) return;
    await generateMtForSegment(active.id);
  }, [active, generateMtForSegment]);

  const ensureRequiredPlaceholders = useCallback((sourceText: string, suggestionText: string) => {
    const required = extractPlaceholders(sourceText);
    if (required.length === 0) {
      return { text: suggestionText, inserted: [] as string[] };
    }
    const present = extractPlaceholders(suggestionText);
    const requiredCounts = new Map<string, number>();
    const presentCounts = new Map<string, number>();
    for (const token of required) {
      requiredCounts.set(token, (requiredCounts.get(token) ?? 0) + 1);
    }
    for (const token of present) {
      presentCounts.set(token, (presentCounts.get(token) ?? 0) + 1);
    }
    const missing: string[] = [];
    requiredCounts.forEach((count, token) => {
      const have = presentCounts.get(token) ?? 0;
      for (let i = have; i < count; i += 1) missing.push(token);
    });
    if (missing.length === 0) {
      return { text: suggestionText, inserted: [] as string[] };
    }
    const spacer = suggestionText && !/\s$/.test(suggestionText) ? " " : "";
    return {
      text: `${suggestionText}${spacer}${missing.join("")}`,
      inserted: missing
    };
  }, []);

  const buildSuggestionRuns = useCallback(
    (segment: Segment, nextText: string) => {
      const currentText = getCurrentTargetValue(segment.id);
      const currentRuns = normalizeRuns(getCurrentTargetRuns(segment.id), currentText);
      const previousTargetRuns = normalizeRuns(segment.tgtRuns, String(segment.tgt ?? ""));
      const sourceRuns = normalizeRuns(segment.srcRuns, String(segment.src ?? ""));
      const templateRuns =
        currentRuns.length > 0
          ? currentRuns
          : previousTargetRuns.length > 0
          ? previousTargetRuns
          : sourceRuns;
      return normalizeRuns(
        projectTextToRuns(nextText, templateRuns, sourceRuns),
        nextText
      );
    },
    [getCurrentTargetRuns, getCurrentTargetValue]
  );

  const applySuggestionToSegment = useCallback(
    async (segmentId: number, kind: SuggestionKind) => {
      const seg = segmentsRef.current.find((item) => item.id === segmentId);
      if (!seg) return false;
      if (kind === "tm") {
        await ensureTmHints([seg]);
        const matches = tmHintsRef.current[segmentId] ?? [];
        const best = matches[0];
        if (!best?.target) return false;
        const patched = ensureRequiredPlaceholders(seg.src, best.target);
        const nextText = patched.text;
        const nextRuns = buildSuggestionRuns(seg, nextText);
        updateTarget(segmentId, nextText, {
          runs: nextRuns,
          sourceMeta: { type: "tmx", score: normalizeMatchPct(best.score), matchId: null },
          originDetails: {
            engineId: "tmx",
            matchScore: normalizeMatchPct(best.score)
          }
        });
        return true;
      }

      if (kind === "mt") {
        const mt = mtCache[segmentId] || (await generateMtForSegment(segmentId));
        if (!mt) return false;
        const patched = ensureRequiredPlaceholders(seg.src, mt);
        const nextText = patched.text;
        const nextRuns = buildSuggestionRuns(seg, nextText);
        const mtMeta = mtMetaById[segmentId];
        updateTarget(segmentId, nextText, {
          runs: nextRuns,
          sourceMeta: { type: "nmt", score: null, matchId: null },
          originDetails: {
            engineId: mtMeta?.model ?? "nmt"
          }
        });
        return true;
      }

      const isActiveSegment = active?.id === segmentId;
      if (isActiveSegment && concordanceEntries.length > 0) {
        insertConcordanceEntry(segmentId, concordanceEntries[0]!);
        return true;
      }
      const matches = getGlossaryMatchesForText(seg.src);
      const first = matches[0];
      if (!first) return false;
      insertGlossaryMatch(segmentId, first);
      return true;
    },
    [
      active?.id,
      buildSuggestionRuns,
      concordanceEntries,
      ensureRequiredPlaceholders,
      ensureTmHints,
      generateMtForSegment,
      getGlossaryMatchesForText,
      insertConcordanceEntry,
      insertGlossaryMatch,
      mtCache,
      mtMetaById,
      normalizeMatchPct,
      updateTarget
    ]
  );

  const applyBestSuggestionToSegment = useCallback(
    async (segmentId: number) => {
      const seg = segmentsRef.current.find((item) => item.id === segmentId);
      if (!seg) return false;
      await ensureTmHints([seg]);
      const tmBest = (tmHintsRef.current[segmentId] ?? [])[0] ?? null;
      const tmPct = normalizeMatchPct(tmBest?.score ?? null);
      const glossaryMatches = getGlossaryMatchesForText(seg.src);
      const hasGlossary = glossaryMatches.length > 0;
      const hasTm = Boolean(tmBest?.target);

      if (hasGlossary && hasTm && (tmPct ?? 0) >= 75) {
        const insertedTm = await applySuggestionToSegment(segmentId, "tm");
        if (insertedTm) return true;
      }
      if (hasGlossary) {
        const insertedGlossary = await applySuggestionToSegment(segmentId, "glossary");
        if (insertedGlossary) return true;
      }
      if (hasTm && (tmPct ?? 0) >= 60) {
        const insertedTm = await applySuggestionToSegment(segmentId, "tm");
        if (insertedTm) return true;
      }
      const insertedMt = await applySuggestionToSegment(segmentId, "mt");
      if (insertedMt) return true;
      if (hasTm) return applySuggestionToSegment(segmentId, "tm");
      return false;
    },
    [applySuggestionToSegment, ensureTmHints, getGlossaryMatchesForText, normalizeMatchPct]
  );

  const applySuggestionToActive = useCallback(
    async (kind: SuggestionKind) => {
      if (!active || !meta) return;
      await applySuggestionToSegment(active.id, kind);
    },
    [active, applySuggestionToSegment, meta]
  );

  const applyBestSuggestionToActive = useCallback(async () => {
    if (!active) return;
    await applyBestSuggestionToSegment(active.id);
  }, [active, applyBestSuggestionToSegment]);

  const acceptCleanDrafts = useCallback(async () => {
    if (!taskId) return;
    setSaveState("saving");
    try {
      const res = await acceptCleanLlmDrafts({ taskId });
      applySegmentPatchList(res.segments ?? []);
      setSaveFailure(null);
      setSaveState("saved");
    } catch (err: any) {
      setSaveState("error");
      setError(err?.message || "Failed to accept clean drafts.");
    }
  }, [acceptCleanLlmDrafts, applySegmentPatchList, taskId]);

  const recomputeIssues = useCallback(async () => {
    if (!taskId) return;
    setSaveState("saving");
    try {
      const res = await recomputeSegmentIssues({ taskId });
      applySegmentPatchList(res.segments ?? []);
      setSaveFailure(null);
      setSaveState("saved");
    } catch (err: any) {
      setSaveState("error");
      setError(err?.message || "Failed to recompute issues.");
    }
  }, [applySegmentPatchList, recomputeSegmentIssues, taskId]);

  const complete = useCallback(
    async (mode: "under_review" | "reviewed") => {
      if (taskReadOnly) return;
      if (!meta) return;
      setSaveState("saving");
      try {
        await completeTask(taskId, mode);
        setSegments((prev) =>
          prev.map((s) => {
            const status = normalizeSegmentStatus(s.status);
            const tgt = String(s.tgt ?? "").trim();
            if (!tgt) return s;
            if (mode === "under_review") {
              if (status !== "draft") return s;
              const state = coerceSegmentState(s.state, status);
              return {
                ...s,
                status: "under_review",
                state,
                version: (s.version ?? 0) + 1
              };
            }
            if (status !== "under_review") return s;
            const warnings = issuesById[s.id] ?? [];
            const blocking = warnings.some((w) => w.severity === "error");
            if (blocking) return s;
            return { ...s, status: "reviewed", state: "reviewed", version: (s.version ?? 0) + 1 };
          })
        );
        setMeta((prev) => {
          if (!prev) return prev;
          const stats = prev.segmentStats;
          const reviewed = mode === "reviewed" ? stats.total : stats.reviewed;
          const under_review = mode === "under_review" ? stats.total - reviewed : stats.under_review;
          return {
            ...prev,
            task: prev.task ? { ...prev.task, status: mode } : prev.task,
            segmentStats: {
              ...stats,
              reviewed,
              under_review,
              draft: Math.max(0, stats.total - reviewed - under_review)
            }
          };
        });
        setSaveState("saved");
      } catch (err: any) {
        setSaveState("error");
        setError(err?.message || "Failed to complete task.");
      }
    },
    [issuesById, meta, taskId, taskReadOnly]
  );

  const reload = useCallback(async () => {
    dirtyRef.current.clear();
    inFlightRef.current.clear();
    draftByIdRef.current = {};
    draftRunsByIdRef.current = {};
    setDraftById({});
    setDraftRunsById({});
    setSaveFailure(null);
    setSaveState("saved");
    historyRef.current = {};
    localRevisionRef.current = {};
    serverRevisionRef.current = {};
    nextSaveIdRef.current = 1;
    await load();
  }, [load, setDraftById, setDraftRunsById]);

  const canUndo = useMemo(() => {
    if (!active) return false;
    const entry = historyRef.current[active.id];
    return Boolean(entry && entry.past.length > 0);
  }, [active?.id, draftById]);

  const canRedo = useMemo(() => {
    if (!active) return false;
    const entry = historyRef.current[active.id];
    return Boolean(entry && entry.future.length > 0);
  }, [active?.id, draftById]);

  const getTmMatchesForSegment = useCallback((segmentId: number) => {
    return tmHintsRef.current[segmentId] ?? [];
  }, []);

  const getMtSuggestionForSegment = useCallback(
    (segmentId: number) => {
      return mtCache[segmentId] ?? "";
    },
    [mtCache]
  );

  const getMtSuggestionMetaForSegment = useCallback(
    (segmentId: number) => {
      return mtMetaById[segmentId] ?? null;
    },
    [mtMetaById]
  );

  return {
    markReviewed,
    markReviewedBulk,
    setSegmentStatus,
    setSegmentLock,
    setSegmentReviewedState,
    toggleLock,
    confirmActive,
    goPrev,
    goNext,
    canGoPrev,
    canGoNext,
    canUndo,
    canRedo,
    goToSegmentNumber,
    goToMatch,
    replaceAllInTarget,
    ensureTmHints,
    generateMtForSegment,
    generateMtForActive,
    applySuggestionToSegment,
    applyBestSuggestionToSegment,
    applySuggestionToActive,
    applyBestSuggestionToActive,
    acceptCleanDrafts,
    recomputeIssues,
    complete,
    reload,
    getTmMatchesForSegment,
    getMtSuggestionForSegment,
    getMtSuggestionMetaForSegment
  };
}
