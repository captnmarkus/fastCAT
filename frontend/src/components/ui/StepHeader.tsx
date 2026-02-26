import React from "react";

type StepHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export default function StepHeader({ title, description, actions = null, className = "" }: StepHeaderProps) {
  const wrapperClass = className ? `fc-step-header ${className}` : "fc-step-header";
  return (
    <div className={wrapperClass}>
      <div>
        <h3 className="fc-step-header-title">{title}</h3>
        {description ? <p className="fc-step-header-description">{description}</p> : null}
      </div>
      {actions ? <div className="fc-step-header-actions">{actions}</div> : null}
    </div>
  );
}
