import React from "react";
import LanguageSelect from "../../../features/languages/LanguageSelect";
import EmptyState from "../../../components/ui/EmptyState";
import FilterSidebar, { FilterSection } from "../../../components/ui/FilterSidebar";
import { DEFAULT_FILTERS, type InboxFilters } from "./filters";

function isDefaultFilters(filters: InboxFilters) {
  const normalize = (values: string[]) => values.map(String).sort((a, b) => a.localeCompare(b));
  const sameArray = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const aa = normalize(a);
    const bb = normalize(b);
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  };

  return (
    sameArray(filters.statuses, DEFAULT_FILTERS.statuses) &&
    filters.srcLang === DEFAULT_FILTERS.srcLang &&
    filters.tgtLang === DEFAULT_FILTERS.tgtLang &&
    filters.projectId === DEFAULT_FILTERS.projectId &&
    filters.createdStart === DEFAULT_FILTERS.createdStart &&
    filters.createdEnd === DEFAULT_FILTERS.createdEnd &&
    filters.modifiedStart === DEFAULT_FILTERS.modifiedStart &&
    filters.modifiedEnd === DEFAULT_FILTERS.modifiedEnd &&
    sameArray(filters.types, DEFAULT_FILTERS.types)
  );
}

type ProjectOption = { id: number; label: string };

type Props = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  filters: InboxFilters;
  onFiltersChange: (next: InboxFilters) => void;
  statusOptions: string[];
  projectOptions: ProjectOption[];
  typeOptions: string[];
  onReset: () => void;
};

export default function FiltersPanel({
  collapsed,
  onCollapsedChange,
  filters,
  onFiltersChange,
  statusOptions,
  projectOptions,
  typeOptions,
  onReset
}: Props) {
  const resetDisabled = isDefaultFilters(filters);

  return (
    <FilterSidebar
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      title="Filters"
      resetDisabled={resetDisabled}
      onReset={onReset}
    >
      <FilterSection
        title="Status"
        action={
          filters.statuses.length > 0 ? (
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none"
              onClick={() => onFiltersChange({ ...filters, statuses: [] })}
            >
              Clear all
            </button>
          ) : null
        }
      >
        <div className="fc-filter-options">
          {statusOptions.map((status) => {
            const checked = filters.statuses.includes(status);
            return (
              <div className="form-check" key={status}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`inbox-status-${status}`}
                  checked={checked}
                  onChange={() => {
                    const next = new Set(filters.statuses);
                    if (next.has(status)) next.delete(status);
                    else next.add(status);
                    onFiltersChange({ ...filters, statuses: Array.from(next) });
                  }}
                />
                <label className="form-check-label small" htmlFor={`inbox-status-${status}`}>
                  {status.replace(/_/g, " ").toUpperCase()}
                </label>
              </div>
            );
          })}
        </div>
      </FilterSection>

      <FilterSection title="Languages">
        <label className="form-label small text-muted mb-1">Source language</label>
        <LanguageSelect
          kind="source"
          value={filters.srcLang}
          onChange={(value) => onFiltersChange({ ...filters, srcLang: value })}
          includeEmpty
          emptyLabel="Any"
          className="form-select form-select-sm"
        />

        <label className="form-label small text-muted mb-1">Target language</label>
        <LanguageSelect
          kind="target"
          value={filters.tgtLang}
          onChange={(value) => onFiltersChange({ ...filters, tgtLang: value })}
          includeEmpty
          emptyLabel="Any"
          className="form-select form-select-sm"
        />
      </FilterSection>

      <FilterSection title="Project">
        <select
          className="form-select form-select-sm"
          value={filters.projectId}
          onChange={(e) => onFiltersChange({ ...filters, projectId: e.target.value })}
        >
          <option value="">Any</option>
          {projectOptions.map((project) => (
            <option key={project.id} value={String(project.id)}>
              {project.label}
            </option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Dates">
        <div>
          <div className="small text-muted mb-1">Created</div>
          <div className="d-flex gap-2">
            <input
              type="date"
              className="form-control form-control-sm"
              value={filters.createdStart}
              onChange={(e) => onFiltersChange({ ...filters, createdStart: e.target.value })}
              aria-label="Created start date"
            />
            <input
              type="date"
              className="form-control form-control-sm"
              value={filters.createdEnd}
              onChange={(e) => onFiltersChange({ ...filters, createdEnd: e.target.value })}
              aria-label="Created end date"
            />
          </div>
        </div>

        <div>
          <div className="small text-muted mb-1">Last modified</div>
          <div className="d-flex gap-2">
            <input
              type="date"
              className="form-control form-control-sm"
              value={filters.modifiedStart}
              onChange={(e) => onFiltersChange({ ...filters, modifiedStart: e.target.value })}
              aria-label="Last modified start date"
            />
            <input
              type="date"
              className="form-control form-control-sm"
              value={filters.modifiedEnd}
              onChange={(e) => onFiltersChange({ ...filters, modifiedEnd: e.target.value })}
              aria-label="Last modified end date"
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="File type">
        <div className="fc-filter-options">
          {typeOptions.length === 0 ? (
            <EmptyState
              title="No file types"
              description="File type filters appear after files are indexed."
              iconClassName="bi bi-file-earmark"
            />
          ) : (
            typeOptions.map((type) => {
              const checked = filters.types.includes(type);
              return (
                <div className="form-check" key={type}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`inbox-type-${type}`}
                    checked={checked}
                    onChange={() => {
                      const next = new Set(filters.types);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      onFiltersChange({ ...filters, types: Array.from(next) });
                    }}
                  />
                  <label className="form-check-label small" htmlFor={`inbox-type-${type}`}>
                    {type.toUpperCase()}
                  </label>
                </div>
              );
            })
          )}
        </div>
      </FilterSection>
    </FilterSidebar>
  );
}
