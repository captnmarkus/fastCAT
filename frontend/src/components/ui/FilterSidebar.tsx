import React from "react";

type FilterSidebarProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  title?: string;
  resetDisabled?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
  className?: string;
};

export function FilterSection({
  title,
  action,
  children
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="fc-filter-section">
      <div className="fc-filter-section-header">
        <h3 className="fc-filter-section-title">{title}</h3>
        {action ? <div className="fc-filter-section-action">{action}</div> : null}
      </div>
      <div className="fc-filter-section-body">{children}</div>
    </section>
  );
}

export default function FilterSidebar({
  collapsed,
  onCollapsedChange,
  title = "Filters",
  resetDisabled = true,
  onReset,
  children,
  className = ""
}: FilterSidebarProps) {
  const panelClass = className ? `fc-filter-panel ${className}` : "fc-filter-panel";
  if (collapsed) {
    return (
      <aside className={`${panelClass} collapsed`} aria-label={title}>
        <div className="fc-filter-collapsed">
          <button
            type="button"
            className="btn fc-filter-toggle"
            onClick={() => onCollapsedChange(false)}
            aria-label="Expand filters"
            title="Expand filters"
          >
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
          <div className="fc-filter-collapsed-label" aria-hidden="true">
            {title}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={panelClass} aria-label={title}>
      <div className="fc-filter-expanded">
        <div className="fc-filter-header">
          <button
            type="button"
            className="btn fc-filter-toggle"
            onClick={() => onCollapsedChange(true)}
            aria-label="Collapse filters"
            title="Collapse filters"
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <div className="fc-filter-header-title">{title}</div>
          {onReset ? (
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none fc-filter-reset"
              onClick={onReset}
              disabled={resetDisabled}
            >
              Reset
            </button>
          ) : null}
        </div>
        <div className="fc-filter-body">{children}</div>
      </div>
    </aside>
  );
}
