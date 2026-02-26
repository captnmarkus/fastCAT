import React from "react";

export type CollectionPageShellProps = {
  sidebar?: React.ReactNode;
  toolbar: React.ReactNode;
  children: React.ReactNode;
  detailsPanel?: React.ReactNode;
  className?: string;
  mainClassName?: string;
  resultsClassName?: string;
};

export default function CollectionPageShell({
  sidebar = null,
  toolbar,
  children,
  detailsPanel = null,
  className = "",
  mainClassName = "",
  resultsClassName = ""
}: CollectionPageShellProps) {
  const wrapperClass = className ? `fc-projects-page d-flex flex-column ${className}` : "fc-projects-page d-flex flex-column";
  const mainSectionClass = mainClassName
    ? `flex-grow-1 d-flex flex-column fc-projects-main ${mainClassName}`
    : "flex-grow-1 d-flex flex-column fc-projects-main";
  const resultsClass = resultsClassName
    ? `fc-projects-results flex-grow-1 mt-2 ${resultsClassName}`
    : "fc-projects-results flex-grow-1 mt-2";

  return (
    <div className={wrapperClass} style={{ minHeight: 0, height: "100%" }}>
      <div className="d-flex fc-projects-layout flex-grow-1" style={{ minHeight: 0 }}>
        {sidebar}

        <section className={mainSectionClass} style={{ minWidth: 0, minHeight: 0 }}>
          {toolbar}
          <div className={resultsClass} style={{ minHeight: 0 }}>
            {children}
          </div>
        </section>

        {detailsPanel}
      </div>
    </div>
  );
}
