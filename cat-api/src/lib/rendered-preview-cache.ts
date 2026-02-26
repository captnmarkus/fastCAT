export function createRenderedPreviewCacheKey(params: {
  projectId: number;
  fileId: number;
  taskId: number | null;
  targetLang: string;
  previewMethod: string;
  draftRevisionId: string;
}) {
  return [
    "rp",
    params.projectId,
    params.fileId,
    params.taskId ?? "none",
    params.targetLang || "none",
    params.previewMethod || "none",
    params.draftRevisionId || "none"
  ].join(":");
}
