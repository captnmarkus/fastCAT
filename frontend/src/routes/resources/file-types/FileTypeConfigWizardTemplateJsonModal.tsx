import React from "react";
import { type ParsingTemplate } from "../../../api";
import Modal from "../../../components/Modal";

export default function FileTypeConfigWizardTemplateJsonModal(props: {
  selectedTemplate: ParsingTemplate | null;
  viewTemplateJsonError: string | null;
  viewTemplateJsonLoading: boolean;
  viewTemplateJsonOpen: boolean;
  viewTemplateJsonText: string;
  setViewTemplateJsonOpen: (value: boolean) => void;
  handleDownloadTemplate: () => Promise<void>;
}) {
  const {
    selectedTemplate,
    viewTemplateJsonError,
    viewTemplateJsonLoading,
    viewTemplateJsonOpen,
    viewTemplateJsonText,
    setViewTemplateJsonOpen,
    handleDownloadTemplate
  } = props;

  if (!viewTemplateJsonOpen) return null;

  return (
    <Modal
      title={selectedTemplate ? `Template JSON: ${selectedTemplate.name}` : "Template JSON"}
      onClose={() => {
        if (viewTemplateJsonLoading) return;
        setViewTemplateJsonOpen(false);
      }}
      closeDisabled={viewTemplateJsonLoading}
      size="xl"
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setViewTemplateJsonOpen(false)}
            disabled={viewTemplateJsonLoading}
          >
            Close
          </button>
          {selectedTemplate ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleDownloadTemplate()}
              disabled={viewTemplateJsonLoading}
            >
              Download JSON
            </button>
          ) : null}
        </>
      }
    >
      {viewTemplateJsonError ? <div className="alert alert-danger py-2">{viewTemplateJsonError}</div> : null}
      {viewTemplateJsonLoading ? (
        <div className="text-muted small d-flex align-items-center gap-2">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          <span>Loading JSON...</span>
        </div>
      ) : (
        <pre
          className="bg-light border rounded p-3 mb-0 font-monospace small"
          style={{ maxHeight: 480, overflow: "auto" }}
        >
          {viewTemplateJsonText || ""}
        </pre>
      )}
    </Modal>
  );
}
