import React from "react";
import BadgePill from "./BadgePill";

type IssuesPanelProps = {
  issues: string[];
  title?: string;
  tone?: "warning" | "danger";
  className?: string;
};

export default function IssuesPanel({
  issues,
  title = "Issues",
  tone = "warning",
  className = ""
}: IssuesPanelProps) {
  if (!issues || issues.length === 0) return null;
  const wrapperClass = className ? `fc-issues-panel ${className}` : "fc-issues-panel";
  const pillTone = tone === "danger" ? "danger" : "warning";

  return (
    <section className={wrapperClass} role="alert" aria-live="polite">
      <div className="fc-issues-panel-header">
        <BadgePill tone={pillTone}>{title}</BadgePill>
        <span className="fc-issues-panel-count">{issues.length}</span>
      </div>
      <ul className="fc-issues-panel-list">
        {issues.map((message) => (
          <li key={message} className="fc-issues-panel-item">
            {message}
          </li>
        ))}
      </ul>
    </section>
  );
}
