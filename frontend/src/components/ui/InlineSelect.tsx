import React, { useMemo, useState } from "react";
import BadgePill from "./BadgePill";

export type InlineSelectOption = {
  value: string;
  label: string;
};

type InlineSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: InlineSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  ariaLabel?: string;
};

export default function InlineSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Not set",
  disabled = false,
  className = "",
  invalid = false,
  ariaLabel
}: InlineSelectProps) {
  const [editing, setEditing] = useState(false);
  const current = useMemo(() => options.find((entry) => entry.value === value) || null, [options, value]);
  const baseClass = invalid ? "fc-inline-select is-invalid" : "fc-inline-select";
  const rootClass = className ? `${baseClass} ${className}` : baseClass;

  if (!editing) {
    return (
      <div className={rootClass}>
        <div className="fc-inline-select-value">
          {current ? <BadgePill>{current.label}</BadgePill> : <span className="fc-inline-select-empty">{placeholder}</span>}
        </div>
        {!disabled ? (
          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setEditing(true)}>
            Change...
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <select
        id={id}
        className={`form-select form-select-sm${invalid ? " is-invalid" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <option value="">{placeholder}</option>
        {options.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setEditing(false)}>
        Done
      </button>
    </div>
  );
}
