import React from "react";
import { FILE_TYPE_CARDS, type FileTypeKind } from "./FileTypeConfigWizard.helpers";

export default function FileTypeConfigWizardTypeStep(props: {
  effectiveFileType: FileTypeKind | null;
  lockFileType: boolean;
  onSelect: (fileType: FileTypeKind) => void;
}) {
  const { effectiveFileType, lockFileType, onSelect } = props;

  return (
    <>
      <div className="fw-semibold mb-2">Choose a file type</div>
      <div className="text-muted small mb-3">Select exactly one type. The next steps will be tailored to it.</div>
      <div className="row g-3">
        {FILE_TYPE_CARDS.map((card) => {
          const selected = effectiveFileType === card.value;
          return (
            <div className="col-md-6 col-lg-4" key={card.value}>
              <button
                type="button"
                className={`w-100 text-start border rounded p-3 bg-white ${selected ? "border-dark" : "border-light"}`}
                onClick={() => onSelect(card.value)}
                disabled={lockFileType}
                style={{ minHeight: 120 }}
              >
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className={`bi ${card.icon} fs-4`} aria-hidden="true" />
                  <div className="fw-semibold">{card.label}</div>
                  {selected && <span className="badge text-bg-dark ms-auto">Selected</span>}
                </div>
                <div className="text-muted small">{card.description}</div>
                {lockFileType && selected && (
                  <div className="text-muted small mt-2">File type is locked for existing configurations.</div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
