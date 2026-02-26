import React from "react";
import type { ViewMode } from "./useCollectionViewMode";

type ViewModeToggleProps = {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  ariaLabel?: string;
  className?: string;
};

export default function ViewModeToggle({
  value,
  onChange,
  ariaLabel = "View mode",
  className = ""
}: ViewModeToggleProps) {
  const wrapperClass = className ? `fc-view-toggle ${className}` : "fc-view-toggle";

  return (
    <div className={wrapperClass} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={`fc-view-toggle-btn${value === "cards" ? " is-active" : ""}`}
        onClick={() => onChange("cards")}
        aria-pressed={value === "cards"}
        aria-label="Card view"
        title="Card view"
      >
        <i className="bi bi-grid-3x3-gap" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`fc-view-toggle-btn${value === "list" ? " is-active" : ""}`}
        onClick={() => onChange("list")}
        aria-pressed={value === "list"}
        aria-label="List view"
        title="List view"
      >
        <i className="bi bi-list" aria-hidden="true" />
      </button>
    </div>
  );
}
