import React from "react";

export type WizardStep<T extends string = string> = {
  key: T;
  label: string;
};

type WizardShellProps<T extends string> = {
  eyebrow: string;
  title: string;
  onCancel: () => void;
  cancelDisabled?: boolean;
  cancelLabel?: string;
  topActions?: React.ReactNode;
  steps: WizardStep<T>[];
  currentStep: T;
  onStepSelect?: (step: T) => void;
  canSelectStep?: (step: T, index: number, currentIndex: number) => boolean;
  alerts?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export default function WizardShell<T extends string>({
  eyebrow,
  title,
  onCancel,
  cancelDisabled = false,
  cancelLabel = "Cancel",
  topActions = null,
  steps,
  currentStep,
  onStepSelect,
  canSelectStep,
  alerts = null,
  children,
  footer = null,
  className = ""
}: WizardShellProps<T>) {
  const currentIndex = Math.max(0, steps.findIndex((entry) => entry.key === currentStep));
  const wrapperClass = className ? `fc-wizard-shell ${className}` : "fc-wizard-shell";

  return (
    <div className={wrapperClass}>
      <div className="fc-wizard-layout">
        <div className="fc-wizard-main-header">
          <div className="fc-wizard-header">
            <div>
              <div className="fc-wizard-eyebrow">{eyebrow}</div>
              <h2 className="fc-wizard-title">{title}</h2>
            </div>
            <div className="fc-wizard-header-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={cancelDisabled}>
                {cancelLabel}
              </button>
              {topActions}
            </div>
          </div>
        </div>

        <aside className="fc-wizard-steps-rail">
          <div className="fc-stepper" role="list" aria-label={`${title} steps`}>
            {steps.map((entry, index) => {
              const isActive = index === currentIndex;
              const isComplete = index < currentIndex;
              const selectable = canSelectStep ? canSelectStep(entry.key, index, currentIndex) : isComplete;
              const disabled = !isActive && !selectable;
              return (
                <button
                  key={entry.key}
                  type="button"
                  className={`fc-stepper-item${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}`}
                  onClick={() => {
                    if (!disabled && onStepSelect) onStepSelect(entry.key);
                  }}
                  disabled={disabled}
                  role="listitem"
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="fc-stepper-index">{index + 1}</span>
                  <span className="fc-stepper-label">{entry.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="fc-wizard-main">
          {alerts}

          <div className="fc-wizard-surface">{children}</div>

          {footer ? <div className="fc-wizard-footer-shell">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
