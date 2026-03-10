import { useMemo } from "react";
import { exportProjectTargetFile, type Segment } from "../../../api";
import { buildTargetOutputFilename } from "../../../utils/outputFilename";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState } from "../../../utils/segmentState";
import { useEditorFile } from "../state/useEditorFile";
import { canDownloadReviewedOutput } from "./modernEditorPageUtils";

type EditorController = ReturnType<typeof useEditorFile>;

export function useModernEditorTaskActions(params: {
  currentUser: { role?: string | null };
  editor: EditorController;
  fileId: number | null;
  nav: (to: string) => void;
  taskId: number;
  taskReadOnly: boolean;
}) {
  const { currentUser, editor, fileId, nav, taskId, taskReadOnly } = params;
  const downloadReady = useMemo(() => canDownloadReviewedOutput(editor.meta?.task?.status ?? null), [editor.meta?.task?.status]);

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
      const hasUnreviewed = editor.segments.some((segment) => stateFor(segment) !== "reviewed");
      if (hasUnreviewed) {
        window.alert("Cannot complete review: some segments are still not reviewed.");
        return;
      }

      const blocked = editor.segments.filter((segment) => {
        const state = stateFor(segment);
        if (state === "reviewed") return false;
        const target = effectiveTarget(segment.id, segment.tgt);
        if (!target.trim()) return true;
        const issues = editor.issuesById[segment.id] ?? [];
        return issues.some((issue) => issue.severity === "error");
      });
      if (blocked.length > 0) {
        window.alert("Cannot complete review: resolve blocking QA errors (or empty targets) first.");
        return;
      }
    } else {
      const emptyDrafts = editor.segments.filter((segment) => {
        const state = stateFor(segment);
        if (state !== "draft" && state !== "nmt_draft") return false;
        const target = effectiveTarget(segment.id, segment.tgt);
        return !target.trim();
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
      const filename = buildTargetOutputFilename(editor.fileName || `file-${fileId ?? taskId ?? ""}`, editor.targetLang || "");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to download file");
    }
  };

  return {
    doComplete,
    doDownload,
    downloadReady
  };
}
