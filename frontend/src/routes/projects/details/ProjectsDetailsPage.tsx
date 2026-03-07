import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteProject,
  downloadProjectBucketOutputFile,
  downloadProjectBucketSourceFile,
  getProjectProvisionStatus,
  getProject,
  getProjectAnalytics,
  getProjectBucket,
  getProjectPretranslateStatus,
  importProjectFileToTm,
  listTmSamples,
  listProjectFiles,
  runProjectPretranslate,
  retryProjectProvision,
  type ProjectBucketMeta,
  type ProvisionStatusResponse,
  type PretranslateStatusResponse,
  type SampleAsset
} from "../../../api";
import type { AuthUser, ProjectCardMeta } from "../../../types/app";
import { formatDateTimeShort } from "../shared/dates";
import { triggerDownload } from "../shared/download";
import Modal from "../../../components/Modal";
import LanguagePair from "../shared/components/LanguagePair";
import ProgressBar from "../shared/components/ProgressBar";
import StatusPill from "../shared/components/StatusPill";
import { deriveProjectCardMeta } from "../shared/status";
import { useLanguages } from "../../../features/languages/hooks";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../features/languages/utils";
import { normalizeLocale } from "../../../lib/i18n/locale";
import { buildTargetOutputFilename } from "../../../utils/outputFilename";
import ProjectsDetailsFilesTable from "./ProjectsDetailsFilesTable";
import {
  DEFAULT_STATE,
  type LoadState,
  formatProvisioningStep,
  provisioningStepTone,
  type ImportDialogState,
  type RowImportState
} from "./ProjectsDetailsPage.helpers";

export default function ProjectsDetailsPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const params = useParams();
  const rawId = String(params.id || "").trim();
  const projectId = Number(rawId);
  const [state, setState] = useState<LoadState>(DEFAULT_STATE);
  const [bucketDownloading, setBucketDownloading] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<number, boolean>>({});
  const [pretranslateStatus, setPretranslateStatus] = useState<PretranslateStatusResponse | null>(null);
  const [pretranslateError, setPretranslateError] = useState<string | null>(null);
  const [pretranslateLoading, setPretranslateLoading] = useState(false);
  const [pretranslateRetrying, setPretranslateRetrying] = useState(false);
  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatusResponse | null>(null);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionRetrying, setProvisionRetrying] = useState(false);
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null);
  const [tmOptions, setTmOptions] = useState<SampleAsset[]>([]);
  const [tmOptionsLoading, setTmOptionsLoading] = useState(false);
  const [tmOptionsError, setTmOptionsError] = useState<string | null>(null);
  const [selectedTmId, setSelectedTmId] = useState<number | null>(null);
  const [importingRowKey, setImportingRowKey] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [rowImportState, setRowImportState] = useState<Record<string, RowImportState>>({});
  const isAdmin = currentUser.role === "admin";
  const isManager = currentUser.role === "manager";
  const isReviewer = currentUser.role === "reviewer";
  const currentUserKeys = useMemo(() => {
    const keys = new Set<string>();
    if (currentUser.username) keys.add(String(currentUser.username).trim().toLowerCase());
    if (currentUser.id != null) keys.add(String(currentUser.id).trim().toLowerCase());
    return keys;
  }, [currentUser.id, currentUser.username]);
  const hydrateProjectState = useCallback(async (): Promise<LoadState> => {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return {
        project: null,
        meta: null,
        progressPct: 0,
        bucket: null,
        files: [],
        error: "Invalid project id",
        loading: false
      };
    }
    const [projectResult, analyticsResult, bucketResult, filesResult] = await Promise.allSettled([
      getProject(projectId),
      getProjectAnalytics(projectId),
      getProjectBucket(projectId),
      listProjectFiles(projectId)
    ]);
    if (projectResult.status !== "fulfilled") {
      return {
        project: null,
        meta: null,
        progressPct: 0,
        bucket: null,
        files: [],
        error: "Failed to load project",
        loading: false
      };
    }
    const project = projectResult.value;
    const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
    const bucket = bucketResult.status === "fulfilled" ? bucketResult.value : null;
    const files = filesResult.status === "fulfilled" ? filesResult.value.files : [];
    const meta = deriveProjectCardMeta(analytics, { projectStatus: project.status });
    const projectStatus = String(project.status || "").trim().toLowerCase();
    const provisioningProgressRaw = Number(project.provisioningProgress);
    const provisioningProgress = Number.isFinite(provisioningProgressRaw)
      ? Math.max(0, Math.min(100, Math.round(provisioningProgressRaw)))
      : null;
    const progressPct =
      projectStatus === "provisioning"
        ? provisioningProgress ?? 0
        : meta && meta.total > 0
          ? Math.round(((meta.total - meta.pending) / meta.total) * 100)
          : 0;
    return {
      project,
      meta,
      progressPct,
      bucket,
      files,
      error: null,
      loading: false
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setState(DEFAULT_STATE);
    (async () => {
      const next = await hydrateProjectState();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateProjectState]);

  useEffect(() => {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    const projectStatus = String(state.project?.status || "").trim().toLowerCase();
    if (projectStatus !== "provisioning" && projectStatus !== "failed") {
      setProvisionStatus(null);
      setProvisionError(null);
      setProvisionLoading(false);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const startedAt = Date.now();

    const schedule = (delayMs: number) => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        const shouldContinue = await poll(true);
        if (!cancelled && shouldContinue) {
          const elapsed = Date.now() - startedAt;
          const nextDelay = elapsed >= 3 * 60 * 1000 ? 12000 : 3000;
          schedule(nextDelay);
        }
      }, delayMs);
    };

    const poll = async (silent?: boolean) => {
      if (!silent) setProvisionLoading(true);
      try {
        const status = await getProjectProvisionStatus(projectId);
        if (cancelled) return false;
        setProvisionStatus(status);
        setProvisionError(null);
        const normalized = String(status.status || "").trim().toLowerCase();
        if (normalized === "ready" || normalized === "failed") {
          const refreshed = await hydrateProjectState();
          if (!cancelled) setState(refreshed);
          return false;
        }
        return normalized === "provisioning";
      } catch (err: any) {
        if (!cancelled) {
          setProvisionError(err?.userMessage || err?.message || "Failed to load provisioning status");
        }
        return true;
      } finally {
        if (!cancelled && !silent) setProvisionLoading(false);
      }
    };

    poll().then((shouldContinue) => {
      if (!cancelled && shouldContinue) schedule(3000);
    });

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [hydrateProjectState, projectId, state.project?.status]);

  useEffect(() => {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    const projectStatus = String(state.project?.status || "").trim().toLowerCase();
    if (projectStatus !== "ready") {
      setPretranslateStatus(null);
      setPretranslateError(null);
      setPretranslateLoading(false);
      return;
    }

    let cancelled = false;

    const loadStatus = async (silent?: boolean) => {
      if (!silent) setPretranslateLoading(true);
      try {
        const status = await getProjectPretranslateStatus(projectId);
        if (!cancelled) {
          setPretranslateStatus(status);
          setPretranslateError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setPretranslateError(err?.userMessage || err?.message || "Failed to load pretranslation status");
        }
      } finally {
        if (!cancelled && !silent) setPretranslateLoading(false);
      }
    };

    loadStatus();
    const handle = window.setInterval(() => {
      const summary = pretranslateStatus?.summary;
      if (!summary || summary.pending > 0 || summary.running > 0) {
        loadStatus(true);
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [projectId, pretranslateStatus?.summary.pending, pretranslateStatus?.summary.running, state.project?.status]);
  const overdueDays = useMemo(() => {
    const dueAt = state.project?.dueAt;
    if (!dueAt) return null;
    const dueMs = new Date(dueAt).getTime();
    if (!Number.isFinite(dueMs)) return null;
    if (dueMs >= Date.now()) return null;
    if ((state.progressPct ?? 0) >= 100) return null;
    return Math.max(0, Math.floor((Date.now() - dueMs) / (24 * 60 * 60 * 1000)));
  }, [state.progressPct, state.project?.dueAt]);
  const bucketErrorCount =
    state.bucket?.errorCount != null && Number.isFinite(Number(state.bucket.errorCount))
      ? Math.max(0, Number(state.bucket.errorCount))
      : Number(state.project?.errorCount ?? 0) || 0;
  const pretranslateSummary = pretranslateStatus?.summary ?? null;
  const pretranslateTotal = pretranslateSummary?.total ?? 0;
  const pretranslateDone = pretranslateSummary?.done ?? 0;
  const pretranslateRunning = pretranslateSummary?.running ?? 0;
  const pretranslatePending = pretranslateSummary?.pending ?? 0;
  const pretranslateFailed = pretranslateSummary?.failed ?? 0;
  const failedPretranslateJobs = pretranslateStatus?.jobs?.filter((job) => job.status === "failed") ?? [];
  const { activeTargetLanguages } = useLanguages();
  const languageMetaByKey = useMemo(() => {
    const map = new Map<string, { label: string; flag?: string }>();
    activeTargetLanguages.forEach((entry) => {
      map.set(entry.canonical.toLowerCase(), {
        label: formatLanguageEntryLabel(entry),
        flag: languageFlagTag(entry)
      });
    });
    return map;
  }, [activeTargetLanguages]);

  useEffect(() => {
    if (!importDialog) return;
    let cancelled = false;
    setTmOptionsLoading(true);
    setTmOptionsError(null);
    (async () => {
      try {
        const options = await listTmSamples();
        if (cancelled) return;
        const filtered = options.filter(
          (entry) => entry.tmId != null && Number.isFinite(Number(entry.tmId)) && Number(entry.tmId) > 0
        );
        setTmOptions(filtered);
        const preferred = filtered[0]?.tmId ?? null;
        setSelectedTmId(preferred != null ? Number(preferred) : null);
      } catch (err: any) {
        if (cancelled) return;
        setTmOptions([]);
        setSelectedTmId(null);
        setTmOptionsError(err?.userMessage || err?.message || "Failed to load translation memories");
      } finally {
        if (!cancelled) setTmOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [importDialog]);

  useEffect(() => {
    setImportDialog(null);
    setImportNotice(null);
    setImportingRowKey(null);
    setRowImportState({});
    setTmOptions([]);
    setTmOptionsError(null);
    setSelectedTmId(null);
    setProvisionStatus(null);
    setProvisionError(null);
    setProvisionLoading(false);
    setProvisionRetrying(false);
  }, [projectId]);
  const sourceByFileId = useMemo(() => {
    const map = new Map<number, ProjectBucketMeta["source"][number]>();
    (state.bucket?.source ?? []).forEach((entry) => {
      map.set(entry.fileId, entry);
    });
    return map;
  }, [state.bucket?.source]);
  const outputByFileLang = useMemo(() => {
    const map = new Map<string, ProjectBucketMeta["output"][number]>();
    (state.bucket?.output ?? []).forEach((entry) => {
      const key = `${entry.fileId}:${normalizeLangKey(entry.lang)}`;
      if (!map.has(key)) map.set(key, entry);
    });
    return map;
  }, [state.bucket?.output]);

  function rowImportKey(fileId: number, targetLang: string) {
    return `${fileId}:${normalizeLangKey(targetLang)}`;
  }
  function normalizeLangKey(value: string) {
    return normalizeLocale(String(value || "")).canonical.toLowerCase();
  }
  function resolveTaskMeta(lang: string) {
    const canonical = normalizeLangKey(lang);
    return languageMetaByKey.get(canonical) ?? null;
  }
  function normalizeTaskStatus(value: string) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
    if (raw === "under_review" || raw === "in_review" || raw === "in_progress") return "under_review";
    if (raw === "error") return "error";
    return "draft";
  }
  function formatTaskStatus(value: string) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "done" || raw === "completed") return "DONE";
    const normalized = normalizeTaskStatus(value);
    if (normalized === "under_review") return "IN REVIEW";
    if (normalized === "reviewed") return "REVIEWED";
    if (normalized === "error") return "ERROR";
    return "DRAFT";
  }
  function isTaskAssignedToUser(task: { assigneeId?: string; reviewerUserId?: string | null }) {
    const assignee = String(task?.assigneeId || "").trim().toLowerCase();
    const reviewer = String(task?.reviewerUserId || "").trim().toLowerCase();
    return (assignee && currentUserKeys.has(assignee)) || (reviewer && currentUserKeys.has(reviewer));
  }
  function deriveRollupStatus(tasks: Array<{ status?: string }>, fallback: string) {
    if (tasks.length === 0) return fallback;
    const statuses = tasks.map((task) => normalizeTaskStatus(task.status || ""));
    if (statuses.some((status) => status === "error")) return "error";
    if (statuses.every((status) => status === "reviewed")) return "reviewed";
    if (statuses.some((status) => status === "under_review" || status === "reviewed")) return "under_review";
    return "draft";
  }
  function statusToneClass(status: string) {
    const normalized = normalizeTaskStatus(status);
    if (normalized === "reviewed") return "bg-success text-white";
    if (normalized === "under_review") return "bg-warning text-dark";
    if (normalized === "error") return "bg-danger text-white";
    return "bg-light text-dark border";
  }
  function computeProgressPct(
    tasks: Array<{ status?: string; segmentStats?: { total: number; reviewed: number } }>,
    fallbackStats: { total: number; reviewed: number } | null
  ) {
    const taskStats = tasks.map((task) => task.segmentStats).filter(Boolean) as Array<{
      total: number;
      reviewed: number;
    }>;
    const taskTotal = taskStats.reduce((sum, stats) => sum + (Number(stats.total) || 0), 0);
    const taskReviewed = taskStats.reduce((sum, stats) => sum + (Number(stats.reviewed) || 0), 0);
    if (taskTotal > 0) return Math.round((taskReviewed / taskTotal) * 100);
    if (tasks.length > 0) {
      const reviewedTasks = tasks.filter((task) => normalizeTaskStatus(task.status || "") === "reviewed").length;
      return Math.round((reviewedTasks / tasks.length) * 100);
    }
    if (fallbackStats && Number(fallbackStats.total) > 0) {
      return Math.round((Number(fallbackStats.reviewed) / Number(fallbackStats.total)) * 100);
    }
    return 0;
  }
  function openImportDialog(params: { fileId: number; fileName: string; targetLang: string; targetLabel: string }) {
    setImportNotice(null);
    setTmOptionsError(null);
    setImportDialog({
      fileId: params.fileId,
      fileName: params.fileName,
      targetLang: params.targetLang,
      targetLabel: params.targetLabel
    });
  }
  async function handleConfirmImportToTm() {
    if (!state.project || !importDialog || !selectedTmId) return;
    const rowKey = rowImportKey(importDialog.fileId, importDialog.targetLang);
    setImportNotice(null);
    setImportingRowKey(rowKey);
    try {
      const result = await importProjectFileToTm(state.project.id, importDialog.fileId, {
        tmId: selectedTmId,
        targetLang: importDialog.targetLang
      });
      const importedAt = result.importedAt || new Date().toISOString();
      setRowImportState((prev) => ({
        ...prev,
        [rowKey]: { status: "imported", importedAt }
      }));
      setImportNotice({
        tone: "success",
        text: `Imported ${result.segmentsImported} segment${result.segmentsImported === 1 ? "" : "s"} to TM.`
      });
      setImportDialog(null);
    } catch (err: any) {
      const message = err?.userMessage || err?.message || "Failed to import file to TM";
      setRowImportState((prev) => ({
        ...prev,
        [rowKey]: { status: "error", message }
      }));
      setImportNotice({ tone: "danger", text: message });
    } finally {
      setImportingRowKey(null);
    }
  }
  async function handleDelete() {
    if (!state.project) return;
    const confirmed = window.confirm("Delete this project? All segments, files, and glossary items will be removed.");
    if (!confirmed) return;
    try {
      await deleteProject(state.project.id);
      nav("/projects");
    } catch (err: any) {
      window.alert(err?.message || "Failed to delete project");
    }
  }
  async function handleDownloadSource(fileId: number, filename: string) {
    if (!state.project || String(state.project.status || "").trim().toLowerCase() !== "ready") return;
    setBucketDownloading(filename);
    try {
      const blob = await downloadProjectBucketSourceFile(state.project.id, fileId, filename);
      triggerDownload(blob, filename);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to download file");
    } finally {
      setBucketDownloading(null);
    }
  }
  async function handleDownloadOutput(fileId: number, lang: string, filename: string) {
    if (!state.project || String(state.project.status || "").trim().toLowerCase() !== "ready") return;
    setBucketDownloading(filename);
    try {
      const blob = await downloadProjectBucketOutputFile(state.project.id, fileId, lang, filename);
      triggerDownload(blob, filename);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to download file");
    } finally {
      setBucketDownloading(null);
    }
  }
  async function handleRetryPretranslate(job?: { fileId: number; targetLang: string }) {
    if (!state.project || String(state.project.status || "").trim().toLowerCase() !== "ready") return;
    setPretranslateRetrying(true);
    try {
      if (job) {
        await runProjectPretranslate(state.project.id, {
          scope: "file",
          fileId: job.fileId,
          targetLang: job.targetLang
        });
      } else if (pretranslateStatus?.jobs) {
        const failedJobs = pretranslateStatus.jobs.filter((entry) => entry.status === "failed");
        for (const entry of failedJobs) {
          await runProjectPretranslate(state.project.id, {
            scope: "file",
            fileId: entry.fileId,
            targetLang: entry.targetLang
          });
        }
      }
      const updated = await getProjectPretranslateStatus(state.project.id);
      setPretranslateStatus(updated);
    } catch (err: any) {
      setPretranslateError(err?.userMessage || err?.message || "Failed to retry pretranslation");
    } finally {
      setPretranslateRetrying(false);
    }
  }
  async function handleRetryProvision() {
    if (!state.project) return;
    setProvisionRetrying(true);
    try {
      await retryProjectProvision(state.project.id);
      const refreshed = await hydrateProjectState();
      setState(refreshed);
      setProvisionError(null);
    } catch (err: any) {
      setProvisionError(err?.userMessage || err?.message || "Failed to retry provisioning");
    } finally {
      setProvisionRetrying(false);
    }
  }
  function toggleFileExpanded(fileId: number) {
    setExpandedFiles((prev) => ({
      ...prev,
      [fileId]: !prev[fileId]
    }));
  }
  if (state.loading) {
    return <div className="text-muted p-3">Loading project...</div>;
  }
  if (state.error) {
    return (
      <div className="p-3">
        <div className="alert alert-danger mb-0">{state.error}</div>
      </div>
    );
  }
  if (!state.project) {
    return (
      <div className="p-3">
        <div className="alert alert-warning mb-0">Project not found.</div>
      </div>
    );
  }
  const project = state.project;
  const projectStatus = String(project.status || "").trim().toLowerCase();
  const isProjectReady = projectStatus === "ready";
  const isProjectProvisioning = projectStatus === "provisioning";
  const isProjectFailed = projectStatus === "failed";
  const statusLabel = String(state.meta?.label || "ANALYZING").toUpperCase();
  const statusTone = (state.meta?.tone || "secondary") as ProjectCardMeta["tone"];
  const departmentLabel =
    project.departmentName || (project.departmentId ? `Department #${project.departmentId}` : "Department unknown");
  const ownerLabel = project.assignedUser || project.createdBy || "unassigned";
  const createdByLabel = project.createdBy || "unknown";
  const lastModifiedLabel = formatDateTimeShort(project.lastModifiedAt || project.createdAt);
  const dueLabel = formatDateTimeShort(project.dueAt);
  const description = String(project.description || "").trim();
  const descriptionLong = description.length > 160;
  const visibleFiles = isReviewer
    ? state.files.filter((file) => (file.tasks || []).some((task) => isTaskAssignedToUser(task)))
    : state.files;
  const filesLabel = `${visibleFiles.length} file${visibleFiles.length === 1 ? "" : "s"}`;
  const canDelete = isAdmin;
  const canDownloadSource = isAdmin || isManager;
  const assignedOwnerKey = String(project.assignedUser || project.createdBy || "").trim().toLowerCase();
  const isProjectOwner = assignedOwnerKey ? currentUserKeys.has(assignedOwnerKey) : false;
  const emptyFilesLabel = isReviewer ? "No assigned files yet." : "No files uploaded yet.";
  const activeImportRowKey = importDialog ? rowImportKey(importDialog.fileId, importDialog.targetLang) : null;
  const importDialogSubmitting = Boolean(activeImportRowKey && importingRowKey === activeImportRowKey);
  const provisioningPercentRaw = Number(provisionStatus?.percent ?? project.provisioningProgress ?? 0);
  const provisioningPercent = Number.isFinite(provisioningPercentRaw)
    ? Math.max(0, Math.min(100, Math.round(provisioningPercentRaw)))
    : 0;
  const provisioningStep = provisionStatus?.currentStep ?? provisionStatus?.step ?? project.provisioningCurrentStep ?? null;
  const provisioningLastUpdate = provisionStatus?.lastUpdate ?? project.provisioningUpdatedAt ?? null;
  const provisioningStartedAt = provisionStatus?.startedAt ?? project.provisioningStartedAt ?? null;
  const provisioningSteps = Array.isArray(provisionStatus?.steps) ? provisionStatus.steps : [];
  const provisioningFailureReason =
    provisionStatus?.error || project.initError || provisionError || "Provisioning failed.";
  const staleProvisioning =
    isProjectProvisioning &&
    provisioningLastUpdate != null &&
    Number.isFinite(new Date(provisioningLastUpdate).getTime()) &&
    Date.now() - new Date(provisioningLastUpdate).getTime() > 20 * 60 * 1000;
  return (
    <div className="d-flex flex-column gap-3" style={{ minHeight: 0 }}>
      <div className="card-enterprise p-3">
        <div className="d-flex flex-column gap-2">
          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => nav("/projects")}
            >
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Back to projects
            </button>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => nav("/inbox")}
              >
                <i className="bi bi-inbox me-1" aria-hidden="true" />
                Go to inbox
              </button>
              {canDelete ? (
                <button type="button" className="btn btn-outline-danger btn-sm" onClick={handleDelete}>
                  <i className="bi bi-trash me-1" aria-hidden="true" />
                  Delete
                </button>
              ) : null}
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <h2 className="mb-0">{project.name}</h2>
            <StatusPill label={statusLabel} tone={statusTone} />
          </div>
          <div className="text-muted small">
            <span className="fw-semibold">{departmentLabel}</span>
            <span className="mx-2">|</span>
            <span>#{project.id}</span>
            <span className="mx-2">|</span>
            <span>Created by {createdByLabel}</span>
            <span className="mx-2">|</span>
            <span>Owner: {ownerLabel}</span>
          </div>
        </div>
      </div>
      {isProjectProvisioning || isProjectFailed ? (
        <div className="card-enterprise p-3">
          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <div>
              <div className="fw-semibold">{isProjectFailed ? "Project provisioning failed" : "Preparing project"}</div>
              <div className="text-muted small">
                {isProjectFailed
                  ? "Provisioning stopped. Review the error and retry when ready."
                  : "Importing files, running seeding, and applying project resources."}
              </div>
            </div>
            <span className={`badge ${isProjectFailed ? "bg-danger text-white" : "bg-warning text-dark"}`}>
              {String(project.status || "").toUpperCase()}
            </span>
          </div>

          {provisionError ? (
            <div className="alert alert-warning mt-3 mb-0">{provisionError}</div>
          ) : null}
          {staleProvisioning ? (
            <div className="alert alert-warning mt-3 mb-0">
              No updates recently. It may still be running.
            </div>
          ) : null}
          {isProjectFailed ? (
            <div className="alert alert-danger mt-3 mb-0">
              <div className="fw-semibold mb-1">Failure reason</div>
              <div className="small">{provisioningFailureReason}</div>
            </div>
          ) : null}

          <div className="mt-3">
            <ProgressBar percent={provisioningPercent} />
            <div className="d-flex justify-content-between text-muted small mt-2 flex-wrap gap-2">
              <span>Current step: {formatProvisioningStep(provisioningStep)}</span>
              <span>{provisioningLastUpdate ? `Last update: ${formatDateTimeShort(provisioningLastUpdate)}` : provisionLoading ? "Checking status..." : ""}</span>
            </div>
            <div className="text-muted small mt-1">
              Started: {formatDateTimeShort(provisioningStartedAt)}
            </div>
          </div>

          {provisioningSteps.length > 0 ? (
            <div className="table-responsive mt-3">
              <table className="table table-sm align-middle mb-0 fc-table-compact">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th style={{ width: 120 }}>Progress</th>
                    <th style={{ width: 130 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {provisioningSteps.map((step) => (
                    <tr key={step.key}>
                      <td>
                        <div className="fw-semibold">{step.label}</div>
                        {step.message ? <div className="text-muted small">{step.message}</div> : null}
                      </td>
                      <td className="text-muted small">{Math.max(0, Math.min(100, Number(step.percent || 0)))}%</td>
                      <td>
                        <span className={`badge ${provisioningStepTone(step.status)}`}>
                          {String(step.status || "").toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {isProjectFailed ? (
            <div className="d-flex justify-content-end mt-3">
              <button
                type="button"
                className="btn btn-dark"
                onClick={handleRetryProvision}
                disabled={provisionRetrying}
              >
                {provisionRetrying ? "Retrying..." : "Retry provisioning"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {importNotice ? (
        <div className={`alert ${importNotice.tone === "success" ? "alert-success" : "alert-danger"} py-2 mb-0`}>
          {importNotice.text}
        </div>
      ) : null}
      <div className="row g-2">
        <div className="col-sm-6 col-lg">
          <div className="card-enterprise p-3 h-100">
            <div className="text-muted small">Languages</div>
            <div className="mt-1">
              <LanguagePair srcLang={project.srcLang} tgtLang={project.tgtLang} targetLangs={project.targetLangs} />
            </div>
          </div>
        </div>
        <div className="col-sm-6 col-lg">
          <div className="card-enterprise p-3 h-100">
            <div className="text-muted small">Progress</div>
            <div className="mt-2">
              <ProgressBar percent={state.progressPct} />
            </div>
          </div>
        </div>
        <div className="col-sm-6 col-lg">
          <div className="card-enterprise p-3 h-100">
            <div className="text-muted small">Due date</div>
            <div className="fw-semibold">{dueLabel}</div>
            {overdueDays != null && overdueDays > 0 ? (
              <span className="badge bg-danger text-white rounded-0 mt-2">Overdue</span>
            ) : null}
          </div>
        </div>
        <div className="col-sm-6 col-lg">
          <div className="card-enterprise p-3 h-100">
            <div className="text-muted small">Owner</div>
            <div className="fw-semibold">{ownerLabel}</div>
          </div>
        </div>
        <div className="col-sm-6 col-lg">
          <div className="card-enterprise p-3 h-100">
            <div className="text-muted small">Last modified</div>
            <div className="fw-semibold">{lastModifiedLabel}</div>
          </div>
        </div>
      </div>
      {isProjectReady && pretranslateTotal > 0 ? (
        <div className="row g-2 mt-2">
          <div className="col-12">
            <div className="card-enterprise p-3">
              <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                <div>
                  <div className="fw-semibold">Pretranslation</div>
                  <div className="text-muted small">
                    {pretranslateRunning + pretranslatePending > 0
                      ? `Pretranslation running: ${pretranslateDone}/${pretranslateTotal} file-language pairs`
                      : `Pretranslation complete: ${pretranslateDone}/${pretranslateTotal} file-language pairs`}
                  </div>
                </div>
                {failedPretranslateJobs.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => handleRetryPretranslate()}
                    disabled={pretranslateRetrying}
                  >
                    {pretranslateRetrying ? "Retrying..." : "Retry failed"}
                  </button>
                ) : null}
              </div>
              <div className="mt-2">
                <ProgressBar
                  percent={
                    pretranslateTotal > 0 ? Math.round((pretranslateDone / pretranslateTotal) * 100) : 0
                  }
                />
              </div>
              {pretranslateError ? (
                <div className="alert alert-warning mt-2 mb-0">{pretranslateError}</div>
              ) : null}
              {failedPretranslateJobs.length > 0 ? (
                <div className="table-responsive mt-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Target</th>
                        <th>Error</th>
                        <th style={{ width: 120 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {failedPretranslateJobs.map((job) => (
                        <tr key={`${job.fileId}:${job.targetLang}`}>
                          <td className="fw-semibold">{job.fileName}</td>
                          <td className="text-muted small">{job.targetLang}</td>
                          <td className="text-muted small">{job.error || "Failed"}</td>
                          <td className="text-end">
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => handleRetryPretranslate({ fileId: job.fileId, targetLang: job.targetLang })}
                              disabled={pretranslateRetrying}
                            >
                              Retry
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : pretranslateLoading ? (
                <div className="text-muted small mt-2">Loading pretranslation status...</div>
              ) : pretranslateFailed > 0 ? (
                <div className="text-muted small mt-2">Some pretranslations failed.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="row g-3 mt-2" style={{ minHeight: 0 }}>
        <div className="col-lg-8 order-lg-1">
          <div className="card-enterprise">
            <div className="p-3">
              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                <div className="fw-semibold">Files</div>
                <div className="text-muted small">{filesLabel}</div>
              </div>
              {visibleFiles.length === 0 ? (
                <div className="text-muted small">{emptyFilesLabel}</div>
              ) : (
                <ProjectsDetailsFilesTable
                  visibleFiles={visibleFiles}
                  isReviewer={isReviewer}
                  isTaskAssignedToUser={isTaskAssignedToUser}
                  deriveRollupStatus={deriveRollupStatus}
                  computeProgressPct={computeProgressPct}
                  statusToneClass={statusToneClass}
                  sourceByFileId={sourceByFileId}
                  expandedFiles={expandedFiles}
                  toggleFileExpanded={toggleFileExpanded}
                  canDownloadSource={canDownloadSource}
                  handleDownloadSource={handleDownloadSource}
                  handleDownloadOutput={handleDownloadOutput}
                  isProjectReady={isProjectReady}
                  bucketDownloading={bucketDownloading}
                  resolveTaskMeta={resolveTaskMeta}
                  normalizeTaskStatus={normalizeTaskStatus}
                  formatTaskStatus={formatTaskStatus}
                  rowImportKey={rowImportKey}
                  outputByFileLang={outputByFileLang}
                  isProjectOwner={isProjectOwner}
                  rowImportState={rowImportState}
                  importingRowKey={importingRowKey}
                  openImportDialog={openImportDialog}
                  nav={nav}
                />
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-4 order-lg-2">
          <div className="d-flex flex-column gap-3">
            <details className="card-enterprise" open>
              <summary className="fc-project-info-summary">Project info</summary>
              <div className="p-3">
                <dl className="fc-project-drawer-dl">
                  <dt>Department</dt>
                  <dd>{departmentLabel}</dd>
                  <dt>Created by</dt>
                  <dd>{createdByLabel}</dd>
                  <dt>Owner</dt>
                  <dd>{ownerLabel}</dd>
                  <dt>Created</dt>
                  <dd>{formatDateTimeShort(project.createdAt)}</dd>
                  <dt>Last modified</dt>
                  <dd>{lastModifiedLabel}</dd>
                  <dt>Errors</dt>
                  <dd>
                    {bucketErrorCount > 0 ? (
                      <span className="badge bg-danger text-white rounded-0">{bucketErrorCount}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </dd>
                  <dt>Last error</dt>
                  <dd>{state.bucket?.lastErrorMessage ? state.bucket.lastErrorMessage : "-"}</dd>
                </dl>
                <div className="mt-3">
                  <div className="text-muted small">Description</div>
                  {description ? (
                    descriptionLong ? (
                      <details className="fc-project-description">
                        <summary className="small">View description</summary>
                        <div className="small mt-2">{description}</div>
                      </details>
                    ) : (
                      <div className="small">{description}</div>
                    )
                  ) : (
                    <div className="text-muted small">-</div>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
      {importDialog ? (
        <Modal
          title="Import Finished Translation to TM"
          onClose={() => {
            if (!importDialogSubmitting) setImportDialog(null);
          }}
          closeDisabled={importDialogSubmitting}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setImportDialog(null)}
                disabled={importDialogSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmImportToTm}
                disabled={tmOptionsLoading || importDialogSubmitting || !selectedTmId}
              >
                {importDialogSubmitting ? "Importing..." : "Import to TM"}
              </button>
            </>
          }
          size="sm"
        >
          <div className="small text-muted mb-2">
            File: <span className="fw-semibold text-dark">{importDialog.fileName}</span>
            <span className="mx-2">|</span>
            Target: <span className="fw-semibold text-dark">{importDialog.targetLabel}</span>
          </div>
          <div className="small text-muted mb-3">
            This will add each segment pair (source to target) to the selected TM.
          </div>
          {tmOptionsError ? <div className="alert alert-danger py-2">{tmOptionsError}</div> : null}
          <label className="form-label small text-uppercase text-muted">Target Translation Memory</label>
          {tmOptionsLoading ? (
            <div className="text-muted small">Loading translation memories...</div>
          ) : (
            <select
              className="form-select form-select-sm"
              value={selectedTmId ?? ""}
              onChange={(e) => setSelectedTmId(e.target.value ? Number(e.target.value) : null)}
              disabled={importDialogSubmitting}
            >
              <option value="">Select TM...</option>
              {tmOptions.map((entry) => (
                <option key={`${entry.id}:${entry.tmId}`} value={entry.tmId ?? ""}>
                  {entry.label}
                </option>
              ))}
            </select>
          )}
          {!tmOptionsLoading && tmOptions.length === 0 ? (
            <div className="text-muted small mt-2">No translation memories are currently available.</div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
