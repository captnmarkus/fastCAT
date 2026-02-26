import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getProjectProvisionStatus,
  retryProjectProvision,
  type ProvisionStatusResponse,
  type ProvisionStatusStep
} from "../../../api";
import ProgressBar from "../shared/components/ProgressBar";
import { formatDateTime } from "../../../utils/format";

function stepTone(step: ProvisionStatusStep["status"]) {
  if (step === "done") return "bg-success text-white";
  if (step === "failed") return "bg-danger text-white";
  if (step === "running") return "bg-warning text-dark";
  return "bg-light text-dark border";
}

function fileStatusTone(status: string): ProvisionStatusStep["status"] {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "ready") return "done";
  if (normalized === "failed") return "failed";
  if (normalized === "processing" || normalized === "uploading") return "running";
  return "pending";
}

export default function ProjectProvisioningPage() {
  const params = useParams<{ id: string }>();
  const nav = useNavigate();
  const projectId = Number(params.id);
  const [status, setStatus] = useState<ProvisionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const pollHandleRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollHandleRef.current != null) {
      window.clearTimeout(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    try {
      const response = await getProjectProvisionStatus(projectId);
      setStatus(response);
      setError(null);
      const normalizedStatus = String(response.status || "").trim().toLowerCase();
      const files = Array.isArray(response.files) ? response.files : [];
      const totalSegments = files.reduce((sum, file) => sum + Number(file.segmentCount || 0), 0);
      const readyEmpty = normalizedStatus === "ready" && totalSegments === 0;
      if (normalizedStatus === "ready") {
        if (readyEmpty) {
          setError("No segments were extracted. Check logs and retry import.");
          stopPolling();
          return false;
        }
        stopPolling();
        nav(`/projects/${projectId}`, { replace: true });
        return false;
      } else if (normalizedStatus === "failed") {
        stopPolling();
        return false;
      }
      return normalizedStatus === "provisioning";
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load provisioning status.");
      return true;
    } finally {
      setLoading(false);
    }
  }, [nav, projectId, stopPolling]);

  useEffect(() => {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    let cancelled = false;
    pollStartedAtRef.current = Date.now();

    const schedule = (delayMs: number) => {
      stopPolling();
      pollHandleRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        const shouldContinue = await poll();
        if (!cancelled && shouldContinue) {
          const elapsed = Date.now() - pollStartedAtRef.current;
          const nextDelay = elapsed >= 3 * 60 * 1000 ? 12000 : 3000;
          schedule(nextDelay);
        }
      }, delayMs);
    };

    poll().then((shouldContinue) => {
      if (!cancelled && shouldContinue) schedule(3000);
    });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [poll, projectId, stopPolling]);

  const stepList = useMemo(() => status?.steps ?? [], [status?.steps]);
  const fileStatuses = useMemo(() => (Array.isArray(status?.files) ? status.files : []), [status?.files]);
  const processingLogs = useMemo(() => (Array.isArray(status?.logs) ? status.logs : []), [status?.logs]);
  const percent = Number.isFinite(status?.percent) ? Number(status?.percent) : 0;
  const statusLabel = String(status?.status || "provisioning").toUpperCase();
  const stepLabel = status?.currentStep || status?.step ? String(status?.currentStep || status?.step).toUpperCase() : "";
  const lastUpdate = status?.lastUpdate ? formatDateTime(status.lastUpdate) : "";
  const isProvisioning = String(status?.status || "provisioning").trim().toLowerCase() === "provisioning";
  const isReadyEmpty =
    String(status?.status || "").trim().toLowerCase() === "ready" &&
    fileStatuses.length > 0 &&
    fileStatuses.every((file) => Number(file.segmentCount || 0) <= 0);
  const staleProvisioning =
    isProvisioning &&
    status?.lastUpdate != null &&
    Number.isFinite(new Date(status.lastUpdate).getTime()) &&
    Date.now() - new Date(status.lastUpdate).getTime() > 20 * 60 * 1000;

  const confirmLeaveWhileProvisioning = useCallback(() => {
    if (!isProvisioning) return true;
    return window.confirm("Project is still being prepared. You can leave now and come back later.");
  }, [isProvisioning]);

  useEffect(() => {
    if (!isProvisioning) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Project is still being prepared. You can leave now and come back later.";
      return event.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isProvisioning]);

  const handleRetry = useCallback(async () => {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    setRetrying(true);
    try {
      await retryProjectProvision(projectId);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              status: "provisioning",
              error: null
            }
          : prev
      );
      setError(null);
      setLoading(true);
      stopPolling();
      pollStartedAtRef.current = Date.now();
      const shouldContinue = await poll();
      if (shouldContinue) {
        pollHandleRef.current = window.setTimeout(async function tick() {
          const keepGoing = await poll();
          if (keepGoing) {
            const elapsed = Date.now() - pollStartedAtRef.current;
            const nextDelay = elapsed >= 3 * 60 * 1000 ? 12000 : 3000;
            pollHandleRef.current = window.setTimeout(tick, nextDelay);
          }
        }, 3000);
      }
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to retry provisioning.");
    } finally {
      setRetrying(false);
    }
  }, [poll, projectId, stopPolling]);

  if (!Number.isFinite(projectId) || projectId <= 0) {
    return <div className="alert alert-danger">Invalid project.</div>;
  }

  return (
    <div className="py-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <div className="text-muted small">Projects</div>
          <h2 className="mb-0">Preparing project</h2>
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => {
              if (!confirmLeaveWhileProvisioning()) return;
              nav("/projects");
            }}
          >
            Back to projects
          </button>
        </div>
      </div>

      {error && <div className="alert alert-warning">{error}</div>}
      {staleProvisioning ? <div className="alert alert-warning">No updates recently. It may still be running.</div> : null}
      {status?.status === "failed" && status.error ? (
        <div className="alert alert-danger">
          <div className="fw-semibold mb-1">Provisioning failed</div>
          <div className="small">{status.error}</div>
        </div>
      ) : null}
      {isReadyEmpty ? (
        <div className="alert alert-danger">
          <div className="fw-semibold mb-1">No segments extracted</div>
          <div className="small">The file import finished without segments. Review logs and retry import.</div>
        </div>
      ) : null}

      <div className="card-enterprise p-4">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div className="fw-semibold">Project setup in progress</div>
            <div className="text-muted small">
              We are importing files, seeding, and applying rules before the project becomes editable.
            </div>
          </div>
          <span className="badge text-bg-light text-dark border">{statusLabel}</span>
        </div>

        <div className="mt-3">
          <ProgressBar percent={percent} />
          <div className="d-flex justify-content-between text-muted small mt-2">
            <span>{stepLabel ? `Current step: ${stepLabel}` : "Preparing..."}</span>
            <span>{lastUpdate ? `Last update: ${lastUpdate}` : loading ? "Checking status..." : ""}</span>
          </div>
        </div>

        {stepList.length > 0 ? (
          <div className="mt-4">
            <div className="text-muted small mb-2">Provisioning steps</div>
            <div className="list-group list-group-flush">
              {stepList.map((step) => (
                <div key={step.key} className="list-group-item d-flex align-items-center justify-content-between">
                  <div>
                    <div className="fw-semibold">{step.label}</div>
                    <div className="text-muted small">{step.percent}%</div>
                  </div>
                  <span className={`badge ${stepTone(step.status)}`}>{step.status.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {fileStatuses.length > 0 ? (
          <div className="mt-4">
            <div className="text-muted small mb-2">File processing</div>
            <div className="list-group list-group-flush">
              {fileStatuses.map((file) => (
                <div key={file.fileId} className="list-group-item d-flex align-items-center justify-content-between gap-2">
                  <div>
                    <div className="fw-semibold">{file.filename || `File #${file.fileId}`}</div>
                    <div className="small text-muted">{file.segmentCount} segments</div>
                  </div>
                  <span className={`badge ${stepTone(fileStatusTone(file.status))}`}>
                    {String(file.status || "").toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {processingLogs.length > 0 ? (
          <div className="mt-4">
            <div className="text-muted small mb-2">Logs / Status</div>
            <div className="list-group list-group-flush">
              {processingLogs.slice(0, 40).map((entry) => (
                <div key={entry.id} className="list-group-item">
                  <div className="d-flex align-items-center justify-content-between gap-2">
                    <div className="small fw-semibold">
                      File #{entry.fileId} • {entry.stage} • {entry.status}
                    </div>
                    <div className="small text-muted">{entry.createdAt ? formatDateTime(entry.createdAt) : ""}</div>
                  </div>
                  <div className="small">{entry.message}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {status?.status === "failed" || isReadyEmpty ? (
          <div className="mt-4 d-flex justify-content-end">
            <button type="button" className="btn btn-dark" onClick={handleRetry} disabled={retrying}>
              {retrying ? "Retrying..." : "Retry import"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
