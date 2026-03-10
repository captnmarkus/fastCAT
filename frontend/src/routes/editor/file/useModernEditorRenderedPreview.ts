import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getRenderedPreviewDetails,
  getRenderedPreviewStatus,
  requestRenderedPreview,
  type RenderedPreviewDetailsResponse
} from "../../../api";
import { useEditorFile } from "../state/useEditorFile";
import {
  buildRenderedPreviewRevisionToken,
  type BottomTab,
  RENDERED_PREVIEW_DEBOUNCE_MS,
  RENDERED_PREVIEW_POLL_MS,
  RENDERED_PREVIEW_POLL_TIMEOUT_MS
} from "./modernEditorPageUtils";

type EditorController = ReturnType<typeof useEditorFile>;

export function useModernEditorRenderedPreview(params: {
  bottomTab: BottomTab;
  editor: EditorController;
  fileId: number | null;
  setBottomPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBottomTab: React.Dispatch<React.SetStateAction<BottomTab>>;
  taskId: number;
}) {
  const { bottomTab, editor, fileId, setBottomPanelOpen, setBottomTab, taskId } = params;
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

  const renderedPreviewSupported = Boolean(editor.meta?.renderedPreview?.supported && editor.projectId && fileId);
  const renderedPreviewConfiguredMethod = editor.meta?.renderedPreview?.method ?? null;
  const renderedPreviewRevisionId = useMemo(
    () => buildRenderedPreviewRevisionToken(taskId, editor.segments, editor.draftById),
    [editor.draftById, editor.segments, taskId]
  );
  const renderedPreviewContextKey = `${editor.projectId ?? "none"}:${fileId ?? "none"}:${taskId}:${editor.targetLang ?? "none"}:${
    renderedPreviewConfiguredMethod ?? "none"
  }`;

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
  }, [bottomTab, clearRenderedPreviewPollTimer, renderedPreviewSupported, setBottomTab]);

  useEffect(() => {
    if (!renderedPreviewSupported) return;
    if (editor.meta?.renderedPreview?.defaultOn) {
      setBottomPanelOpen(true);
    }
  }, [editor.meta?.renderedPreview?.defaultOn, renderedPreviewSupported, setBottomPanelOpen]);

  const loadRenderedPreviewDetails = useCallback(async (previewId: string | number) => {
    const details = await getRenderedPreviewDetails(previewId);
    setRenderedPreviewPreviewId(String(details.previewId ?? previewId));
    setRenderedPreviewDetails(details);
    setRenderedPreviewStatus(String(details.status || "ready"));
    setRenderedPreviewWarnings(Array.isArray(details.warnings) ? details.warnings : []);
    setRenderedPreviewLogs(Array.isArray(details.logs) ? details.logs : []);
    setRenderedPreviewError(details.error ? String(details.error) : null);
    setRenderedPreviewErrorDetails(details.details ? String(details.details) : null);
    return details;
  }, []);

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

  return {
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
  };
}
