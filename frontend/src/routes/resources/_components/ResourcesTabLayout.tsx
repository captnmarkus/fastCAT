import React, { useEffect, useMemo, useState } from "react";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import FilterSidebar from "../../../components/ui/FilterSidebar";
import TableToolbar from "../../../components/ui/TableToolbar";
import CollectionPageShell from "../../../components/ui/CollectionPageShell";
import ViewModeToggle from "../../../components/ui/ViewModeToggle";
import type { ViewMode } from "../../../components/ui/useCollectionViewMode";

type ToolbarAction = {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "secondary" | "danger";
};

export default function ResourcesTabLayout(props: {
  storageKey: string;
  filterTitle?: string;
  filters: React.ReactNode;
  resetDisabled?: boolean;
  onReset?: () => void;

  actionsLeft: ToolbarAction[];

  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;

  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;

  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
  detailsPanel?: React.ReactNode;

  children: React.ReactNode;
}) {
  const filterCollapsedStorageKey = useMemo(() => `${props.storageKey}:filterCollapsed`, [props.storageKey]);
  const [filterCollapsed, setFilterCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(filterCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });

  useEffect(() => {
    safeLocalStorageSet(filterCollapsedStorageKey, filterCollapsed ? "1" : "0");
  }, [filterCollapsed, filterCollapsedStorageKey]);

  const sidebar = (
    <FilterSidebar
      collapsed={filterCollapsed}
      onCollapsedChange={setFilterCollapsed}
      title={props.filterTitle || "Filters"}
      resetDisabled={props.resetDisabled}
      onReset={props.onReset}
    >
      {props.filters}
    </FilterSidebar>
  );

  const toolbar = (
    <TableToolbar
      className="fc-projects-toolbar"
      left={
        <>
          {props.actionsLeft.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`btn btn-outline-${action.tone || "secondary"} btn-sm`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              <i className={`bi ${action.icon} me-1`} aria-hidden="true" />
              {action.label}
            </button>
          ))}
        </>
      }
      right={
        <>
          <div className="fc-search">
            <i className="bi bi-search" aria-hidden="true" />
            <input
              className="form-control form-control-sm"
              placeholder={props.searchPlaceholder || "Search..."}
              value={props.searchQuery}
              onChange={(e) => props.onSearchQueryChange(e.target.value)}
              aria-label={props.searchAriaLabel || "Search resources"}
            />
          </div>
          <ViewModeToggle value={props.viewMode} onChange={props.onViewModeChange} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={props.onPrimary}
            disabled={props.primaryDisabled}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            {props.primaryLabel}
          </button>
        </>
      }
    />
  );

  return (
    <CollectionPageShell
      sidebar={sidebar}
      toolbar={toolbar}
      detailsPanel={props.detailsPanel || null}
      resultsClassName={`fc-collection-viewport ${props.viewMode === "cards" ? "is-cards" : "is-list"}`}
    >
      {props.children}
    </CollectionPageShell>
  );
}
