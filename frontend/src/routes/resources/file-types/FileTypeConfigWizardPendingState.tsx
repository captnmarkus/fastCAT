import React from "react";

export default function FileTypeConfigWizardPendingState(props: {
  loading?: boolean;
  loadError?: string | null;
  onBack: () => void;
}) {
  const { loading = false, loadError = null, onBack } = props;

  if (loading) {
    return (
      <div className="py-4">
        <div className="text-muted d-flex align-items-center gap-2">
          <span className="spinner-border spinner-border-sm" />
          <span>Loading file type configuration...</span>
        </div>
      </div>
    );
  }

  if (!loadError) return null;

  return (
    <div className="py-4">
      <div className="alert alert-danger d-flex align-items-center justify-content-between">
        <div>{loadError}</div>
        <button type="button" className="btn btn-outline-light btn-sm" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
