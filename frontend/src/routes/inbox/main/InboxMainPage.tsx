import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  downloadProjectBucketOutputFile,
  downloadProjectBucketSourceFile,
  getProjectBucket,
  listInboxItems,
  type InboxItem,
  type ProjectBucketMeta
} from "../../../api";
import type { AuthUser } from "../../../types/app";
import FiltersPanel from "../filter/FiltersPanel";
import { DEFAULT_FILTERS, type InboxFilters } from "../filter/filters";
import { parseDateEnd, parseDateStart } from "../../projects/shared/dates";
import { normalizeQuery } from "../../projects/shared/format";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import { triggerDownload } from "../../projects/shared/download";
import InboxTable from "./components/InboxTable";
import InboxCards from "./components/InboxCards";
import DetailsDrawer from "./components/DetailsDrawer";
import type { InboxRow, SortDir, SortKey } from "./types";
import { labelForInboxStatus } from "../shared/status";
import TableToolbar from "../../../components/ui/TableToolbar";
import Divider from "../../../components/ui/Divider";
import IssuesPanel from "../../../components/ui/IssuesPanel";
import CollectionPageShell from "../../../components/ui/CollectionPageShell";
import ViewModeToggle from "../../../components/ui/ViewModeToggle";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";

type ProjectOption = { id: number; label: string };

function compareStrings(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sortDirValue(dir: SortDir) {
  return dir === "asc" ? 1 : -1;
}

export default function InboxMainPage({ currentUser }: { currentUser: AuthUser | null }) {
  const nav = useNavigate();
  if (!currentUser) {
    return <div className="text-muted p-3">Loading inbox...</div>;
  }
  const userId = currentUser ? String(currentUser.id) : "";
  const username = currentUser?.username ? String(currentUser.username) : "";
  const userKey = (username || userId).trim();
  const storagePrefix = userKey ? `fc:${userKey}:inbox` : "fc:inbox";
  const viewStorageKey = `${storagePrefix}:view`;
  const filterCollapsedStorageKey = `${storagePrefix}:filterCollapsed`;
  const detailsCollapsedStorageKey = `${storagePrefix}:detailsCollapsed`;
  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: viewStorageKey,
    defaultMode: "list"
  });

  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(filterCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });

  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const [searchQuery, setSearchQuery] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const [bucketMeta, setBucketMeta] = useState<ProjectBucketMeta | null>(null);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [bucketDownloading, setBucketDownloading] = useState<string | null>(null);
  const bucketCacheRef = useRef<Map<number, ProjectBucketMeta>>(new Map());

  useEffect(() => {
    safeLocalStorageSet(filterCollapsedStorageKey, filterCollapsed ? "1" : "0");
  }, [filterCollapsed, filterCollapsedStorageKey]);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  const rows = useMemo<InboxRow[]>(() => {
    return items.map((item) => {
      const total = Number(item.segmentStats?.total ?? 0) || 0;
      const reviewed = Number(item.segmentStats?.reviewed ?? 0) || 0;
      const pct = total > 0 ? Math.round((reviewed / total) * 100) : item.progressPct ?? 0;
      const modifiedAt = item.lastUpdatedAt || item.lastModifiedAt || null;
      return {
        ...item,
        statusLabel: labelForInboxStatus(item.status),
        progressPct: pct,
        modifiedAt
      };
    });
  }, [items]);

  const statusOptions = useMemo(() => {
    const seen = new Set<string>();
    rows.forEach((row) => seen.add(String(row.status || "").toLowerCase()));
    const ordered = ["draft", "under_review", "reviewed", "error"];
    const list = ordered.filter((s) => seen.has(s));
    for (const value of Array.from(seen).sort(compareStrings)) {
      if (!list.includes(value)) list.push(value);
    }
    return list;
  }, [rows]);

  const projectOptions = useMemo<ProjectOption[]>(() => {
    const map = new Map<number, string>();
    rows.forEach((row) => {
      if (!map.has(row.projectId)) map.set(row.projectId, row.projectName);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, label: `${name} (#${id})` }))
      .sort((a, b) => compareStrings(a.label, b.label));
  }, [rows]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => set.add(String(row.type || "").toLowerCase()));
    return Array.from(set).filter(Boolean).sort(compareStrings);
  }, [rows]);

  const normalizedSearch = useMemo(() => normalizeQuery(searchQuery), [searchQuery]);

  const filteredRows = useMemo(() => {
    const createdStartMs = parseDateStart(filters.createdStart);
    const createdEndMs = parseDateEnd(filters.createdEnd);
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
      if (filters.statuses.length > 0 && !filters.statuses.includes(String(row.status || "").toLowerCase())) {
        return false;
      }
      if (filters.srcLang && String(row.srcLang).toLowerCase() !== String(filters.srcLang).toLowerCase()) {
        return false;
      }
      if (filters.tgtLang && String(row.tgtLang).toLowerCase() !== String(filters.tgtLang).toLowerCase()) {
        return false;
      }
      if (filters.projectId && String(row.projectId) !== String(filters.projectId)) {
        return false;
      }
      if (filters.types.length > 0) {
        const type = String(row.type || "").toLowerCase();
        if (!filters.types.some((t) => String(t).toLowerCase() === type)) return false;
      }

      if (!inRange(row.createdAt, createdStartMs, createdEndMs)) return false;
      if (!inRange(row.modifiedAt || row.createdAt, modifiedStartMs, modifiedEndMs)) return false;

      if (normalizedSearch) {
        const haystack = [
          row.projectName,
          String(row.projectId),
          row.originalFilename,
          String(row.fileId),
          row.srcLang,
          row.tgtLang,
          row.status,
          row.assignedTo || "",
          row.type
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
    const dir = sortDirValue(sortDir);

    list.sort((a, b) => {
      if (sortKey === "file") return dir * compareStrings(a.originalFilename, b.originalFilename);
      if (sortKey === "project") return dir * compareStrings(a.projectName, b.projectName);
      if (sortKey === "status") return dir * compareStrings(a.statusLabel, b.statusLabel);
      if (sortKey === "progress") return dir * ((a.progressPct ?? 0) - (b.progressPct ?? 0));
      const aMs = new Date(a.modifiedAt || a.createdAt).getTime();
      const bMs = new Date(b.modifiedAt || b.createdAt).getTime();
      return dir * (aMs - bMs);
    });

    return list;
  }, [filteredRows, sortDir, sortKey]);

  const selectedCount = selectedIds.size;
  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const selectedRow = selectedSingleId != null ? rows.find((r) => r.taskId === selectedSingleId) ?? null : null;

  const canOpenSelected = selectedRow != null;
  const canOpenProjectDetails = useMemo(() => {
    if (!selectedRow) return false;
    const ownerRef = String(selectedRow.projectOwnerId || "").trim();
    if (!ownerRef) return false;
    const candidateIds = new Set([String(currentUser.username || "").trim(), String(currentUser.id || "").trim()]);
    candidateIds.delete("");
    return candidateIds.has(ownerRef);
  }, [currentUser.id, currentUser.username, selectedRow]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const visibleIds = sortedRows.map((row) => row.taskId);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    const someSelected = visibleIds.some((id) => selectedIds.has(id));
    el.checked = allSelected;
    el.indeterminate = someSelected && !allSelected;
  }, [selectedIds, sortedRows]);

  async function loadInbox() {
    setError(null);
    setLoading(true);
    try {
      const list = await listInboxItems();
      setItems(list);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("inbox load failed", err);
      setError(err?.message || "Failed to load inbox");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    void loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;

    function handleRefreshEvent() {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void loadInbox();
      }, 250);
    }

    window.addEventListener("fc:inbox:refresh", handleRefreshEvent as EventListener);
    return () => {
      window.removeEventListener("fc:inbox:refresh", handleRefreshEvent as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    if (!selectedRow) {
      setBucketMeta(null);
      setBucketError(null);
      setBucketLoading(false);
      return;
    }
    const projectId = selectedRow.projectId;
    const cached = bucketCacheRef.current.get(projectId);
    if (cached) {
      setBucketMeta(cached);
      setBucketError(null);
      setBucketLoading(false);
      return;
    }

    let cancelled = false;
    setBucketMeta(null);
    setBucketError(null);
    setBucketLoading(true);
    (async () => {
      try {
        const meta = await getProjectBucket(projectId);
        if (cancelled) return;
        bucketCacheRef.current.set(projectId, meta);
        setBucketMeta(meta);
      } catch (err: any) {
        if (cancelled) return;
        setBucketError(err?.message || "Failed to load project files");
        setBucketMeta(null);
      } finally {
        if (!cancelled) setBucketLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRow?.projectId]);

  function setSort(next: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === next) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir(next === "modified" ? "desc" : "asc");
      return next;
    });
  }

  function toggleSelected(taskId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
        setDetailsCollapsed(false);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = sortedRows.map((row) => row.taskId);
      if (visibleIds.length === 0) return prev;
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      setDetailsCollapsed(false);
      return new Set(visibleIds);
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const list = await listInboxItems();
      setItems(list);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("inbox refresh failed", err);
      setError(err?.message || "Failed to refresh inbox");
    } finally {
      setRefreshing(false);
    }
  }

  function handleOpenSelected() {
    if (!selectedRow) return;
    nav(`/editor/${selectedRow.taskId}`);
  }

  function clearFiltersAndSearch() {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery("");
  }

  async function handleDownloadSource(projectId: number, fileId: number, filename: string) {
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

  async function handleDownloadOutput(projectId: number, fileId: number, lang: string, filename: string) {
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
          projectOptions={projectOptions}
          typeOptions={typeOptions}
          onReset={clearFiltersAndSearch}
        />
      }
      toolbar={
        <TableToolbar
          className="fc-projects-toolbar"
          left={
            <>
              <div className="fc-toolbar-title">Inbox</div>
              <div className="text-muted small">{sortedRows.length} tasks</div>
              <Divider orientation="vertical" />

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
            </>
          }
          right={
            <>
              <div className="fc-search">
                <i className="bi bi-search" aria-hidden="true" />
                <input
                  className="form-control form-control-sm"
                  placeholder="Search inbox..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search inbox"
                />
              </div>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </>
          }
        />
      }
      detailsPanel={
        <DetailsDrawer
          collapsed={detailsCollapsed}
          onCollapsedChange={setDetailsCollapsed}
          rows={rows}
          selectedIds={selectedIds}
          selectedSingleId={selectedSingleId}
          canOpenProject={canOpenProjectDetails}
          bucketMeta={bucketMeta}
          bucketLoading={bucketLoading}
          bucketError={bucketError}
          bucketDownloading={bucketDownloading}
          onOpen={handleOpenSelected}
          onOpenProjectDetails={(projectId) => nav(`/projects/${projectId}`)}
          onDownloadSource={handleDownloadSource}
          onDownloadOutput={handleDownloadOutput}
        />
      }
      resultsClassName={`fc-collection-viewport ${viewMode === "cards" ? "is-cards" : "is-list"}`}
    >
      {error ? (
        <div className="d-flex align-items-start gap-2 mt-2">
          <IssuesPanel issues={[error]} tone="danger" className="flex-grow-1" />
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleRefresh}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="text-muted p-3">Loading inbox...</div>
      ) : sortedRows.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No inbox items assigned to you.</div>
          <div className="small">When tasks are assigned, they will appear here.</div>
        </div>
      ) : viewMode === "list" ? (
        <InboxTable
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
        <InboxCards rows={sortedRows} selectedIds={selectedIds} onToggleSelected={toggleSelected} />
      )}
    </CollectionPageShell>
  );
}
