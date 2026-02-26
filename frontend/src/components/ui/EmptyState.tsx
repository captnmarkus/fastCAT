import React from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  iconClassName?: string;
};

export default function EmptyState({
  title,
  description,
  action = null,
  iconClassName = "bi bi-inbox"
}: EmptyStateProps) {
  return (
    <div className="fc-empty-state" role="status">
      <i className={iconClassName} aria-hidden="true" />
      <div className="fc-empty-state-title">{title}</div>
      {description ? <div className="fc-empty-state-description">{description}</div> : null}
      {action ? <div className="fc-empty-state-action">{action}</div> : null}
    </div>
  );
}
