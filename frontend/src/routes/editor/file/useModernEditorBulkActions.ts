import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkApproveProjectFileSegments,
  getBulkApproveJobStatus,
  type EditorBulkApproveEstimate,
  type EditorBulkJobStatusResponse,
  type EditorBulkJobSummary,
  type EditorBulkVisibleFilters
} from "../../../api";
import { useEditorFile } from "../state/useEditorFile";
import { type BulkApproveAction } from "./modernEditorPageUtils";

type EditorController = ReturnType<typeof useEditorFile>;

export function useModernEditorBulkActions(params: {
  draftOnly: boolean;
  editor: EditorController;
  fileId: number | null;
  lockedOnly: boolean;
  ntmDraftOnly: boolean;
  reviewedOnly: boolean;
  selectedIds: number[];
  setProblematicOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setSkippedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  sourceSearch: string;
  statusFilter: string;
  targetSearch: string;
  taskId: number;
  taskReadOnly: boolean;
  termHitsOnly: boolean;
  tmxOnly: boolean;
  untranslatedOnly: boolean;
  withQaOnly: boolean;
}) {
  const {
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
    taskReadOnly,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  } = params;
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
    estimated: EditorBulkApproveEstimate | null;
    summary: EditorBulkJobSummary;
  } | null>(null);
  const [lastSkippedIds, setLastSkippedIds] = useState<number[]>([]);
  const [lastProblematicIds, setLastProblematicIds] = useState<number[]>([]);
  const bulkApprovePollTimerRef = useRef<number | null>(null);
  const [mtGeneratingIds, setMtGeneratingIds] = useState<number[]>([]);
  const mtGeneratingSet = useMemo(() => new Set(mtGeneratingIds), [mtGeneratingIds]);

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
    setProblematicOnly,
    setSkippedOnly,
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

  return {
    bulkApproveAckQa,
    bulkApproveDialog,
    bulkApproveJob,
    bulkApproveSummary,
    bulkBusy,
    confirmBulkApprove,
    generateMt,
    lastProblematicIds,
    lastSkippedIds,
    mtGeneratingSet,
    openBulkApproveDialog,
    setBulkApproveAckQa,
    setBulkApproveDialog,
    setBulkApproveJob,
    setBulkApproveSummary,
    bulkClearTargets,
    bulkLock,
    bulkMarkReviewed
  };
}
