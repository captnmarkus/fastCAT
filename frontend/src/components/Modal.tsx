import React from "react";

export default function Modal({
  title,
  children,
  footer,
  onClose,
  closeDisabled,
  size = "lg"
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  size?: "sm" | "lg" | "xl";
}) {
  const dialogClass = `modal-dialog modal-${size}`;

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className={dialogClass} role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{title}</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={closeDisabled}
            />
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

