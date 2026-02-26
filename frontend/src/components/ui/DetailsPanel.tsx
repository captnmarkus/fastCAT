import React, { useEffect, useId, useMemo, useState } from "react";

type DetailsPanelProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  title?: string;
  ariaLabel?: string;
  empty?: boolean;
  emptyState?: React.ReactNode;
  loading?: boolean;
  onOpenFullDetails?: () => void;
  openFullDetailsLabel?: string;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

function useIsMobileDetails(breakpoint = 992) {
  const [mobile, setMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setMobile(query.matches);
    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, [breakpoint]);

  return mobile;
}

function DetailsLoadingState() {
  return (
    <div className="fc-details-loading" role="status" aria-live="polite" aria-label="Loading details">
      <div className="fc-details-skeleton" />
      <div className="fc-details-skeleton" />
      <div className="fc-details-skeleton" />
    </div>
  );
}

export default function DetailsPanel({
  collapsed,
  onCollapsedChange,
  title = "Details",
  ariaLabel = "Details panel",
  empty = false,
  emptyState,
  loading = false,
  onOpenFullDetails,
  openFullDetailsLabel = "Open full details",
  actions = null,
  className = "",
  children = null
}: DetailsPanelProps) {
  const generatedId = useId();
  const panelId = useMemo(() => `fc-details-${generatedId.replace(/:/g, "")}`, [generatedId]);
  const isMobile = useIsMobileDetails();

  useEffect(() => {
    if (!isMobile || collapsed) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCollapsedChange(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, isMobile, onCollapsedChange]);

  const panelClass = [
    "fc-project-drawer",
    "fc-details-panel",
    collapsed ? "collapsed" : "",
    isMobile ? "is-mobile" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  const showActions = !empty && !loading && (typeof onOpenFullDetails === "function" || Boolean(actions));

  return (
    <>
      {isMobile && !collapsed ? (
        <button
          type="button"
          className="fc-details-backdrop"
          aria-label="Close details"
          onClick={() => onCollapsedChange(true)}
        />
      ) : null}

      <aside className={panelClass} aria-label={ariaLabel}>
        {collapsed ? (
          <div className="fc-project-drawer-collapsed fc-details-rail">
            <button
              type="button"
              className="btn fc-filter-toggle"
              onClick={() => onCollapsedChange(false)}
              aria-label="Expand details"
              title="Details"
              aria-controls={panelId}
              aria-expanded="false"
            >
              <i className="bi bi-layout-sidebar-inset" aria-hidden="true" />
            </button>
            <div className="fc-details-rail-label" aria-hidden="true">
              Details
            </div>
          </div>
        ) : (
          <div className="fc-project-drawer-inner" id={panelId} role="region" aria-label={ariaLabel}>
            <div className="fc-project-drawer-header">
              <div className="d-flex align-items-center justify-content-between gap-2">
                <div className="fc-project-drawer-title">{title}</div>
                <button
                  type="button"
                  className="btn fc-filter-toggle"
                  onClick={() => onCollapsedChange(true)}
                  aria-label="Collapse details"
                  title="Collapse details"
                  aria-controls={panelId}
                  aria-expanded="true"
                >
                  <i className="bi bi-chevron-right" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="fc-project-drawer-body">
              {loading ? (
                <DetailsLoadingState />
              ) : empty ? (
                emptyState || <div className="text-muted small">Select an item to see details.</div>
              ) : (
                <>
                  {showActions ? (
                    <div className="fc-details-actions">
                      {onOpenFullDetails ? (
                        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onOpenFullDetails}>
                          <i className="bi bi-box-arrow-up-right me-1" aria-hidden="true" />
                          {openFullDetailsLabel}
                        </button>
                      ) : null}
                      {actions}
                    </div>
                  ) : null}
                  {children}
                </>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
