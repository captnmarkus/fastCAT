import React from "react";

type FieldRowProps = {
  label: string;
  htmlFor?: string;
  required?: boolean;
  helpText?: string;
  error?: string | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export default function FieldRow({
  label,
  htmlFor,
  required = false,
  helpText,
  error,
  actions = null,
  children,
  className = ""
}: FieldRowProps) {
  const wrapperClass = className ? `fc-field-row ${className}` : "fc-field-row";
  return (
    <div className={wrapperClass}>
      <div className="fc-field-row-labelbar">
        <label className="fc-field-row-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="fc-field-required"> *</span> : null}
        </label>
        {actions ? <div className="fc-field-row-actions">{actions}</div> : null}
      </div>
      <div className="fc-field-row-control">{children}</div>
      {error ? <div className="fc-field-row-error">{error}</div> : null}
      {!error && helpText ? <div className="fc-field-row-help">{helpText}</div> : null}
    </div>
  );
}
