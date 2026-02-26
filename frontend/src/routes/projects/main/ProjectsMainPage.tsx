import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteProject,
  downloadProjectBucketOutputFile,
  downloadProjectBucketSourceFile,
  getProjectAnalytics,
  getProjectBucket,
  listProjects,
  type Project,
  type ProjectBucketMeta
} from "../../../api";
import type { AuthUser, ProjectCardMeta } from "../../../types/app";
import FiltersPanel from "../filter/FiltersPanel";
import { DEFAULT_FILTERS, type ProjectFilters } from "../filter/filters";
import DetailsDrawer from "./components/DetailsDrawer";
import ProjectsCards from "./components/ProjectsCards";
import ProjectsTable from "./components/ProjectsTable";
import type { ProjectRow, SortDir, SortKey } from "./types";
import { safeLocalStorageGet, safeLocalStorageSet } from "../shared/storage";
import { parseDateEnd, parseDateStart } from "../shared/dates";
import { normalizeQuery } from "../shared/format";
import { triggerDownload } from "../shared/download";
import { deriveProjectCardMeta } from "../shared/status";
import TableToolbar from "../../../components/ui/TableToolbar";
import Divider from "../../../components/ui/Divider";
import CollectionPageShell from "../../../components/ui/CollectionPageShell";
import ViewModeToggle from "../../../components/ui/ViewModeToggle";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";

export default function ProjectsMainPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const currentUserId = currentUser ? String(currentUser.id) : "";
  const currentUsername = currentUser?.username ? String(currentUser.username) : "";
  const currentUserKey = currentUsername || currentUserId;
  const storagePrefix = currentUserKey ? `fc:${currentUserKey}:projects` : "fc:projects";
  const viewStorageKey = `${storagePrefix}:view`;
  const filterCollapsedStorageKey = `${storagePrefix}:filterCollapsed`;
  const detailsCollapsedStorageKey = `${storagePrefix}:detailsCollapsed`;

  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: viewStorageKey,
    defaultMode: "cards"
  });
  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(filterCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ProjectFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [projectStatusMeta, setProjectStatusMeta] = useState<Record<number, ProjectCardMeta>>({});

  const [bucketMeta, setBucketMeta] = useState<ProjectBucketMeta | null>(null);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [bucketDownloading, setBucketDownloading] = useState<string | null>(null);

  useEffect(() => {
    safeLocalStorageSet(filterCollapsedStorageKey, filterCollapsed ? "1" : "0");
  }, [filterCollapsed, filterCollapsedStorageKey]);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = await listProjects();
        if (!cancelled) setProjects(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const hasProvisioningProjects = useMemo(
    () => projects.some((project) => String(project.status || "").trim().toLowerCase() === "provisioning"),
    [projects]
  );

  useEffect(() => {
    if (!hasProvisioningProjects) return;
    let cancelled = false;
    let timer: number | null = null;
    const startedAt = Date.now();

    const schedule = (delayMs: number) => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        try {
          const refreshed = await listProjects();
          if (!cancelled) setProjects(refreshed);
        } catch {
          // silent refresh
        } finally {
          if (cancelled) return;
          const elapsed = Date.now() - startedAt;
          const nextDelay = elapsed >= 3 * 60 * 1000 ? 15000 : 5000;
          schedule(nextDelay);
        }
      }, delayMs);
    };

    schedule(5000);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [currentUser?.id, hasProvisioningProjects]);

  useEffect(() => {
    let cancelled = false;
    async function loadAnalytics() {
      if (projects.length === 0) {
        setProjectStatusMeta({});
        return;
      }
      const entries = await Promise.all(
        projects.map(async (project) => {
          const projectStatus = String(project.status || "").trim().toLowerCase();
          if (projectStatus === "provisioning" || projectStatus === "failed" || projectStatus === "draft" || projectStatus === "canceled") {
            return { id: project.id, analytics: null, status: project.status };
          }
          try {
            const analytics = await getProjectAnalytics(project.id);
            return { id: project.id, analytics, status: project.status };
          } catch {
            return { id: project.id, analytics: null, status: project.status };
          }
        })
      );
      if (cancelled) return;
      const next: Record<number, ProjectCardMeta> = {};
      for (const entry of entries) {
        next[entry.id] = deriveProjectCardMeta(entry.analytics, { projectStatus: entry.status });
      }
      setProjectStatusMeta(next);
    }
    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const rows = useMemo<ProjectRow[]>(() => {
    const now = Date.now();

    function ownerLabel(project: Project) {
      const val = project.assignedUser || project.createdBy || "";
      if (!val) return "unassigned";
      if (val === currentUsername || val === currentUserId) return "you";
      return val;
    }

    return projects.map((p) => {
      const meta = projectStatusMeta[p.id];
      const statusLabel = String(meta?.label || "ANALYZING").toUpperCase();
      const statusTone = (meta?.tone || "secondary") as ProjectCardMeta["tone"];
      const projectStatus = String(p.status || "").trim().toLowerCase();
      const isProvisioning = projectStatus === "provisioning";
      const isFailed = projectStatus === "failed";
      const provisioningProgressRaw = Number(p.provisioningProgress);
      const provisioningProgress =
        Number.isFinite(provisioningProgressRaw) ? Math.max(0, Math.min(100, Math.round(provisioningProgressRaw))) : null;
      const progressPct = isProvisioning || isFailed
        ? provisioningProgress ?? 0
        : meta && meta.total > 0
          ? Math.round(((meta.total - meta.pending) / meta.total) * 100)
          : 0;
      const dueAt = p.dueAt ?? null;
      const lastModifiedAt = p.lastModifiedAt || p.createdAt;
      const errorCount = Number(p.errorCount ?? 0) || 0;
      let overdueDays: number | null = null;
      if (dueAt) {
        const dueMs = new Date(dueAt).getTime();
        if (Number.isFinite(dueMs) && dueMs < now && progressPct < 100) {
          overdueDays = Math.max(0, Math.floor((now - dueMs) / (24 * 60 * 60 * 1000)));
        }
      }
      return {
        project: p,
        meta,
        statusLabel,
        statusTone,
        progressPct,
        provisioningStep: isProvisioning ? String(p.provisioningCurrentStep || "").trim() || null : null,
        provisioningUpdatedAt: isProvisioning ? p.provisioningUpdatedAt ?? null : null,
        isProvisioning,
        dueAt,
        lastModifiedAt,
        errorCount,
        overdueDays,
        ownerLabel: ownerLabel(p)
      };
    });
  }, [projects, projectStatusMeta, currentUsername, currentUserId]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => set.add(row.statusLabel));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const normalizedSearch = useMemo(() => normalizeQuery(searchQuery), [searchQuery]);

  const filteredRows = useMemo(() => {
    const createdStartMs = parseDateStart(filters.createdStart);
    const createdEndMs = parseDateEnd(filters.createdEnd);
    const dueStartMs = parseDateStart(filters.dueStart);
    const dueEndMs = parseDateEnd(filters.dueEnd);
    const modifiedStartMs = parseDateStart(filters.modifiedStart);
    const modifiedEndMs = parseDateEnd(filters.modifiedEnd);

    function inRange(iso: string | null | undefined, startMs: number | null, endMs: number | null) {
      if (startMs == null && endMs == null) return true;
      if (!iso) return false;
      const ms = new Date(iso).getTime();
      if (!Number.isFinite(ms)) return false;
      if (startMs != null && ms < startMs) return false;
      if (endMs != null && ms > endMs) return false;
      return true;
    }

    return rows.filter((row) => {
      const p = row.project;
      if (filters.srcLang && String(p.srcLang).toLowerCase() !== String(filters.srcLang).toLowerCase()) {
        return false;
      }
      if (filters.targetLangs.length > 0) {
        const targets = Array.isArray(p.targetLangs) && p.targetLangs.length > 0
          ? p.targetLangs
          : [p.tgtLang].filter(Boolean);
        const hasMatch = targets.some((lang) =>
          filters.targetLangs.some((t) => String(t).toLowerCase() === String(lang).toLowerCase())
        );
        if (!hasMatch) return false;
      }
      if (filters.statuses.length > 0) {
        if (!filters.statuses.includes(row.statusLabel)) return false;
      }
      if (filters.overdueOnly) {
        if (!(row.overdueDays != null && row.overdueDays > 0)) return false;
      }
      if (filters.errorsOnly) {
        if (row.errorCount <= 0) return false;
      }

      if (!inRange(p.createdAt, createdStartMs, createdEndMs)) return false;
      if (!inRange(row.dueAt, dueStartMs, dueEndMs)) return false;
      if (!inRange(row.lastModifiedAt, modifiedStartMs, modifiedEndMs)) return false;

      if (normalizedSearch) {
        const haystack = [
          p.name,
          String(p.id),
          p.assignedUser || "",
          p.createdBy || "",
          row.ownerLabel,
          row.statusLabel,
          row.provisioningStep || "",
          p.srcLang,
          p.tgtLang
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }

      return true;
    });
  }, [filters, normalizedSearch, rows]);

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const statusRank: Record<string, number> = {
      PROVISIONING: 0,
      FAILED: 1,
      ANALYZING: 0,
      READY: 2,
      "IN PROGRESS": 3,
      DONE: 4
    };

    function dateKey(value: string | null | undefined) {
      if (!value) return Number.NaN;
      return new Date(value).getTime();
    }

    function compareDates(a: string | null | undefined, b: string | null | undefined) {
      const ams = dateKey(a);
      const bms = dateKey(b);
      const aOk = Number.isFinite(ams);
      const bOk = Number.isFinite(bms);
      if (!aOk && !bOk) return 0;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return ams - bms;
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = String(a.project.name || "").localeCompare(String(b.project.name || ""), undefined, { sensitivity: "base" });
      } else if (sortKey === "progress") {
        cmp = a.progressPct - b.progressPct;
      } else if (sortKey === "status") {
        const ar = statusRank[a.statusLabel] ?? 99;
        const br = statusRank[b.statusLabel] ?? 99;
        cmp = ar - br;
      } else if (sortKey === "due") {
        cmp = compareDates(a.dueAt, b.dueAt);
      } else if (sortKey === "modified") {
        cmp = compareDates(a.lastModifiedAt, b.lastModifiedAt);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, sortDir, sortKey]);

  const selectedCount = selectedIds.size;
  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const canOpenSelected = selectedSingleId != null;
  const canDeleteSelected = selectedCount > 0;

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(sortedRows.map((row) => row.project.id));
      const next = new Set<number>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [sortedRows]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const visibleCount = sortedRows.length;
    if (visibleCount === 0) {
      el.indeterminate = false;
      el.checked = false;
      return;
    }
    const selectedVisible = sortedRows.reduce((sum, row) => sum + (selectedIds.has(row.project.id) ? 1 : 0), 0);
    el.indeterminate = selectedVisible > 0 && selectedVisible < visibleCount;
    el.checked = selectedVisible > 0 && selectedVisible === visibleCount;
  }, [selectedIds, sortedRows]);

  useEffect(() => {
    let cancelled = false;
    setBucketDownloading(null);
    if (selectedSingleId == null) {
      setBucketMeta(null);
      setBucketError(null);
      setBucketLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setBucketLoading(true);
    setBucketError(null);
    (async () => {
      try {
        const meta = await getProjectBucket(selectedSingleId);
        if (!cancelled) setBucketMeta(meta);
      } catch (err: any) {
        if (!cancelled) {
          setBucketMeta(null);
          setBucketError(err?.userMessage || err?.message || "Failed to load project files");
        }
      } finally {
        if (!cancelled) setBucketLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSingleId]);

  function setSort(nextKey: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey !== nextKey) {
        setSortDir("asc");
        return nextKey;
      }
      setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      return prevKey;
    });
  }

  function clearFiltersAndSearch() {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery("");
    setSelectedIds(new Set());
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setDetailsCollapsed(false);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = sortedRows.map((row) => row.project.id);
      if (visibleIds.length === 0) return prev;
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      setDetailsCollapsed(false);
      return new Set(visibleIds);
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const p = await listProjects();
      setProjects(p);
    } catch (err: any) {
      window.alert(err?.message || "Failed to refresh projects");
    } finally {
      setRefreshing(false);
    }
  }

  function handleOpenSelected() {
    if (!selectedSingleId) return;
    nav(`/projects/${selectedSingleId}`);
  }

  function handleOpenProvisioningSelected() {
    if (!selectedSingleId) return;
    nav(`/projects/${selectedSingleId}/provisioning`);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = window.confirm(
      `Delete ${count} project${count === 1 ? "" : "s"}? All segments, files, and glossary items will be removed.`
    );
    if (!confirmed) return;
    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await deleteProject(id);
      }
      setProjects((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setProjectStatusMeta((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      setSelectedIds(new Set());
    } catch (err: any) {
      window.alert(err?.message || "Failed to delete selected projects");
    }
  }

  async function handleDownloadSourceFile(projectId: number, fileId: number, filename: string) {
    setBucketDownloading(filename);
    try {
      const blob = await downloadProjectBucketSourceFile(projectId, fileId, filename);
      triggerDownload(blob, filename);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to download file");
    } finally {
      setBucketDownloading(null);
    }
  }

  async function handleDownloadOutputFile(projectId: number, fileId: number, lang: string, filename: string) {
    setBucketDownloading(filename);
    try {
      const blob = await downloadProjectBucketOutputFile(projectId, fileId, lang, filename);
      triggerDownload(blob, filename);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to download file");
    } finally {
      setBucketDownloading(null);
    }
  }

  return (
    <CollectionPageShell
      sidebar={
        <FiltersPanel
          collapsed={filterCollapsed}
          onCollapsedChange={setFilterCollapsed}
          filters={filters}
          onFiltersChange={setFilters}
          statusOptions={statusOptions}
          onReset={clearFiltersAndSearch}
        />
      }
      toolbar={
        <TableToolbar
          className="fc-projects-toolbar"
          left={
            <>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleRefresh}
                disabled={loading || refreshing}
              >
                <i className={`bi ${refreshing ? "bi-arrow-repeat" : "bi-arrow-clockwise"} me-1`} aria-hidden="true" />
                Refresh
              </button>

              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={!canOpenSelected}
                onClick={handleOpenSelected}
              >
                <i className="bi bi-box-arrow-up-right me-1" aria-hidden="true" />
                Open
              </button>

              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={!canDeleteSelected}
                onClick={handleDeleteSelected}
              >
                <i className="bi bi-trash me-1" aria-hidden="true" />
                Delete{canDeleteSelected ? ` (${selectedCount})` : ""}
              </button>
            </>
          }
          right={
            <>
              <div className="fc-search">
                <i className="bi bi-search" aria-hidden="true" />
                <input
                  className="form-control form-control-sm"
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search projects"
                />
              </div>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
              <Divider orientation="vertical" />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => nav("/projects/create")}>
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                New Project
              </button>
            </>
          }
        />
      }
      detailsPanel={
        <DetailsDrawer
          collapsed={detailsCollapsed}
          onCollapsedChange={setDetailsCollapsed}
          rows={sortedRows}
          selectedIds={selectedIds}
          selectedSingleId={selectedSingleId}
          canOpenSelected={canOpenSelected}
          canDeleteSelected={canDeleteSelected}
          bucketMeta={bucketMeta}
          bucketLoading={bucketLoading}
          bucketError={bucketError}
          bucketDownloading={bucketDownloading}
          onOpen={handleOpenSelected}
          onOpenProvisioning={handleOpenProvisioningSelected}
          onDeleteSelected={handleDeleteSelected}
          onDownloadSource={handleDownloadSourceFile}
          onDownloadOutput={handleDownloadOutputFile}
        />
      }
      resultsClassName={`fc-collection-viewport ${viewMode === "cards" ? "is-cards" : "is-list"}`}
    >
      {loading ? (
        <div className="text-muted p-3">Loading projects...</div>
      ) : sortedRows.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No projects found</div>
          <div className="small">Adjust filters/search or create a new project.</div>
        </div>
      ) : viewMode === "list" ? (
        <ProjectsTable
          rows={sortedRows}
          selectedIds={selectedIds}
          selectAllRef={selectAllRef as React.RefObject<HTMLInputElement>}
          onToggleSelected={toggleSelected}
          onToggleSelectAllVisible={toggleSelectAllVisible}
          onSetSort={setSort}
          sortKey={sortKey}
          sortDir={sortDir}
        />
      ) : (
        <ProjectsCards rows={sortedRows} selectedIds={selectedIds} onToggleSelected={toggleSelected} />
      )}
    </CollectionPageShell>
  );
}
