import React from "react";

type ToggleProps = {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  description?: React.ReactNode;
  className?: string;
  size?: "default" | "sm";
};

export default function Toggle({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  description,
  className = "",
  size = "default"
}: ToggleProps) {
  const wrapperClass = className ? `fc-toggle ${className}` : "fc-toggle";
  const trackClass = size === "sm" ? "fc-toggle-track is-sm" : "fc-toggle-track";
  return (
    <label className={wrapperClass} htmlFor={id}>
      <input
        id={id}
        className="fc-toggle-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className={trackClass} aria-hidden="true">
        <span className="fc-toggle-thumb" />
      </span>
      <span className="fc-toggle-content">
        <span className="fc-toggle-label">{label}</span>
        {description ? <span className="fc-toggle-description">{description}</span> : null}
      </span>
    </label>
  );
}
