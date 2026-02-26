import React from "react";
import LanguageSelect from "../../../features/languages/LanguageSelect";
import FilterSidebar, { FilterSection } from "../../../components/ui/FilterSidebar";
import { DEFAULT_FILTERS, type ProjectFilters } from "./filters";

function isDefaultFilters(filters: ProjectFilters) {
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
    filters.srcLang === DEFAULT_FILTERS.srcLang &&
    sameArray(filters.targetLangs, DEFAULT_FILTERS.targetLangs) &&
    sameArray(filters.statuses, DEFAULT_FILTERS.statuses) &&
    filters.createdStart === DEFAULT_FILTERS.createdStart &&
    filters.createdEnd === DEFAULT_FILTERS.createdEnd &&
    filters.dueStart === DEFAULT_FILTERS.dueStart &&
    filters.dueEnd === DEFAULT_FILTERS.dueEnd &&
    filters.modifiedStart === DEFAULT_FILTERS.modifiedStart &&
    filters.modifiedEnd === DEFAULT_FILTERS.modifiedEnd &&
    filters.overdueOnly === DEFAULT_FILTERS.overdueOnly &&
    filters.errorsOnly === DEFAULT_FILTERS.errorsOnly
  );
}

type Props = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  filters: ProjectFilters;
  onFiltersChange: (next: ProjectFilters) => void;
  statusOptions: string[];
  onReset: () => void;
};

export default function FiltersPanel({
  collapsed,
  onCollapsedChange,
  filters,
  onFiltersChange,
  statusOptions,
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
        title="Languages"
        action={
          filters.targetLangs.length > 0 ? (
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none"
              onClick={() => onFiltersChange({ ...filters, targetLangs: [] })}
            >
              Clear all
            </button>
          ) : null
        }
      >
        <label className="form-label small text-muted mb-1">Source language</label>
        <LanguageSelect
          kind="source"
          value={filters.srcLang}
          onChange={(value) => onFiltersChange({ ...filters, srcLang: value })}
          includeEmpty
          emptyLabel="Any"
          className="form-select form-select-sm"
        />

        <label className="form-label small text-muted mb-1">Target languages</label>
        <LanguageSelect
          kind="target"
          multi
          values={filters.targetLangs}
          onChange={(values) => onFiltersChange({ ...filters, targetLangs: values })}
          containerClassName="fc-filter-options"
          optionClassName="form-check"
        />
      </FilterSection>

      <FilterSection title="Dates">
        <div>
          <div className="small text-muted mb-1">Due</div>
          <div className="d-flex gap-2">
            <input
              type="date"
              className="form-control form-control-sm"
              value={filters.dueStart}
              onChange={(e) => onFiltersChange({ ...filters, dueStart: e.target.value })}
              aria-label="Due start date"
            />
            <input
              type="date"
              className="form-control form-control-sm"
              value={filters.dueEnd}
              onChange={(e) => onFiltersChange({ ...filters, dueEnd: e.target.value })}
              aria-label="Due end date"
            />
          </div>
        </div>
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

      <FilterSection title="Status">
        <div className="fc-filter-options">
          {statusOptions.map((status) => {
            const checked = filters.statuses.includes(status);
            return (
              <div className="form-check" key={status}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`flt-status-${status}`}
                  checked={checked}
                  onChange={() => {
                    const next = new Set(filters.statuses);
                    if (next.has(status)) next.delete(status);
                    else next.add(status);
                    onFiltersChange({ ...filters, statuses: Array.from(next) });
                  }}
                />
                <label className="form-check-label small" htmlFor={`flt-status-${status}`}>
                  {status}
                </label>
              </div>
            );
          })}
        </div>

        <div className="d-flex flex-column gap-2">
          <div className="form-check">
            <input
              className="form-check-input"
              type="checkbox"
              id="flt-overdue"
              checked={filters.overdueOnly}
              onChange={(e) => onFiltersChange({ ...filters, overdueOnly: e.target.checked })}
            />
            <label className="form-check-label small" htmlFor="flt-overdue">
              Overdue only
            </label>
          </div>
          <div className="form-check">
            <input
              className="form-check-input"
              type="checkbox"
              id="flt-errors"
              checked={filters.errorsOnly}
              onChange={(e) => onFiltersChange({ ...filters, errorsOnly: e.target.checked })}
            />
            <label className="form-check-label small" htmlFor="flt-errors">
              Errors only
            </label>
          </div>
        </div>
      </FilterSection>
    </FilterSidebar>
  );
}
