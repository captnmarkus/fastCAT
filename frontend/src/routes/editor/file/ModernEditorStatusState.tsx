export default function ModernEditorStatusState(props: any) {
  const {
    backLabel = "Back to inbox",
    detail,
    message,
    mode,
    onBack,
    onOpenProvisioning,
    onRetry,
    onRetryImport,
    provisionLabel = "Open Logs/Status",
    projectId,
    retryImportLabel = "Retry import",
    retryLabel = "Retry",
    retryingImport
  } = props;

  if (mode === "loading") {
    return <div className="text-muted p-3">Loading editor...</div>;
  }

  const toneClass = mode === "error" ? "alert-danger" : "alert-warning";

  return (
    <div className="fc-modern-editor">
      <div className={`alert ${toneClass} m-3 d-flex align-items-center justify-content-between gap-2 flex-wrap`}>
        <div>
          <div>{message}</div>
          {detail ? <div className="small mt-1">{detail}</div> : null}
        </div>
        <div className="d-flex gap-2">
          {projectId ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={retryingImport} onClick={onRetryImport}>
              {retryingImport ? "Retrying..." : retryImportLabel}
            </button>
          ) : null}
          {projectId ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onOpenProvisioning}>
              {provisionLabel}
            </button>
          ) : null}
          {onRetry ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
