import React from "react";
import {
  type FileTypeKind,
  type RenderedPreviewMethod
} from "./FileTypeConfigWizard.helpers";

export default function FileTypeConfigWizardBasicsStep(props: {
  name: string;
  setName: (value: string) => void;
  disabled: boolean;
  setDisabled: (value: boolean) => void;
  agentDefault: boolean;
  setAgentDefault: (value: boolean) => void;
  supportsRenderedPreview: boolean;
  setSupportsRenderedPreview: (value: boolean) => void;
  renderedPreviewMethod: RenderedPreviewMethod;
  setRenderedPreviewMethod: (value: RenderedPreviewMethod) => void;
  renderedPreviewMethodOptions: Array<{ value: RenderedPreviewMethod; label: string }>;
  renderedPreviewDefaultOn: boolean;
  setRenderedPreviewDefaultOn: (value: boolean) => void;
  effectiveFileType: FileTypeKind | null;
  xmlRenderedPreviewXsltTemplateId: string;
  setXmlRenderedPreviewXsltTemplateId: (value: string) => void;
  xmlRenderedPreviewRendererProfileId: string;
  setXmlRenderedPreviewRendererProfileId: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
}) {
  const {
    name,
    setName,
    disabled,
    setDisabled,
    agentDefault,
    setAgentDefault,
    supportsRenderedPreview,
    setSupportsRenderedPreview,
    renderedPreviewMethod,
    setRenderedPreviewMethod,
    renderedPreviewMethodOptions,
    renderedPreviewDefaultOn,
    setRenderedPreviewDefaultOn,
    effectiveFileType,
    xmlRenderedPreviewXsltTemplateId,
    setXmlRenderedPreviewXsltTemplateId,
    xmlRenderedPreviewRendererProfileId,
    setXmlRenderedPreviewRendererProfileId,
    description,
    setDescription
  } = props;

  return (
    <>
      <div className="fw-semibold mb-3">Basics</div>
      <div className="row g-3">
        <div className="col-lg-8">
          <label className="form-label">Name</label>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-lg-4">
          <label className="form-label">Status</label>
          <div className="form-check mt-2">
            <input
              id="ftc-disabled"
              type="checkbox"
              className="form-check-input"
              checked={disabled}
              onChange={(e) => setDisabled(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="ftc-disabled">
              Disabled
            </label>
          </div>
          <div className="form-check mt-2">
            <input
              id="ftc-agent-default"
              type="checkbox"
              className="form-check-input"
              checked={agentDefault}
              onChange={(e) => setAgentDefault(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="ftc-agent-default">
              Use as App Agent default
            </label>
          </div>
          <div className="form-text">
            Chat uploads prefer this configuration when multiple configs exist for the same file type.
          </div>
        </div>
        <div className="col-12">
          <div className="border rounded bg-white p-3">
            <div className="fw-semibold mb-2">Rendered Preview</div>
            <div className="row g-3">
              <div className="col-md-4">
                <div className="form-check mt-1">
                  <input
                    id="ftc-rendered-preview-enabled"
                    type="checkbox"
                    className="form-check-input"
                    checked={supportsRenderedPreview}
                    onChange={(e) => setSupportsRenderedPreview(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="ftc-rendered-preview-enabled">
                    Enable rendered preview in editor
                  </label>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label">Method</label>
                <select
                  className="form-select"
                  value={renderedPreviewMethod}
                  disabled={!supportsRenderedPreview}
                  onChange={(e) => setRenderedPreviewMethod(e.target.value as RenderedPreviewMethod)}
                >
                  {renderedPreviewMethodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <div className="form-check mt-4 pt-1">
                  <input
                    id="ftc-rendered-preview-default-on"
                    type="checkbox"
                    className="form-check-input"
                    checked={renderedPreviewDefaultOn}
                    disabled={!supportsRenderedPreview}
                    onChange={(e) => setRenderedPreviewDefaultOn(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="ftc-rendered-preview-default-on">
                    Open by default in editor
                  </label>
                </div>
              </div>
              {effectiveFileType === "xml" && renderedPreviewMethod === "xml_xslt" ? (
                <>
                  <div className="col-md-6">
                    <label className="form-label">XSLT template ID (optional)</label>
                    <input
                      className="form-control"
                      value={xmlRenderedPreviewXsltTemplateId}
                      disabled={!supportsRenderedPreview}
                      onChange={(e) => setXmlRenderedPreviewXsltTemplateId(e.target.value)}
                      placeholder="e.g. 42"
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Renderer profile ID (optional)</label>
                    <input
                      className="form-control"
                      value={xmlRenderedPreviewRendererProfileId}
                      disabled={!supportsRenderedPreview}
                      onChange={(e) => setXmlRenderedPreviewRendererProfileId(e.target.value)}
                      placeholder="e.g. default-xml-web"
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div className="form-text mt-2">
              Controls whether the editor shows bottom-panel rendered preview for this file type.
            </div>
          </div>
        </div>
        <div className="col-12">
          <label className="form-label">Description (optional)</label>
          <textarea className="form-control" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </>
  );
}
