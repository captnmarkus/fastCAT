import React from "react";
import type { FileTypePreviewResult, ParsingTemplate } from "../../../api";
import {
  buildFileTypeConfigPayload,
  type DocxWizardConfig,
  type HtmlWizardConfig,
  type PdfWizardConfig,
  type PptxWizardConfig,
  type RenderedPreviewMethod,
  type XlsxWizardConfig,
  type XmlWizardConfig
} from "./FileTypeConfigWizard.helpers";

type FileTypeConfigPayload = ReturnType<typeof buildFileTypeConfigPayload>;

export default function FileTypeConfigWizardReviewStep(props: {
  payloadConfig: FileTypeConfigPayload | null;
  disabled: boolean;
  agentDefault: boolean;
  name: string;
  supportsRenderedPreview: boolean;
  renderedPreviewMethod: RenderedPreviewMethod;
  renderedPreviewDefaultOn: boolean;
  xmlRenderedPreviewXsltTemplateId: string;
  xmlRenderedPreviewRendererProfileId: string;
  selectedTemplate: ParsingTemplate | null;
  htmlCfg: HtmlWizardConfig;
  xmlCfg: XmlWizardConfig;
  pdfCfg: PdfWizardConfig;
  docxCfg: DocxWizardConfig;
  pptxCfg: PptxWizardConfig;
  xlsxCfg: XlsxWizardConfig;
  previewResult: FileTypePreviewResult | null;
}) {
  const {
    payloadConfig,
    disabled,
    agentDefault,
    name,
    supportsRenderedPreview,
    renderedPreviewMethod,
    renderedPreviewDefaultOn,
    xmlRenderedPreviewXsltTemplateId,
    xmlRenderedPreviewRendererProfileId,
    selectedTemplate,
    htmlCfg,
    xmlCfg,
    pdfCfg,
    docxCfg,
    pptxCfg,
    xlsxCfg,
    previewResult
  } = props;

  return (
    <>
      <div className="fw-semibold mb-2">Review</div>
      {!payloadConfig ? (
        <div className="text-muted">Complete previous steps first.</div>
      ) : (
        <div className="row g-3">
          <div className="col-lg-6">
            <div className="text-muted small">File type</div>
            <div className="fw-semibold text-uppercase">{payloadConfig.fileType}</div>
          </div>
          <div className="col-lg-6">
            <div className="text-muted small">Status</div>
            <div className="fw-semibold">{disabled ? "Disabled" : "Enabled"}</div>
          </div>
          <div className="col-lg-6">
            <div className="text-muted small">App Agent default</div>
            <div className="fw-semibold">{agentDefault ? "Yes" : "No"}</div>
          </div>
          <div className="col-12">
            <div className="text-muted small">Name</div>
            <div className="fw-semibold">{name.trim() || "-"}</div>
          </div>
          <div className="col-12">
            <div className="text-muted small">Rendered preview</div>
            <div className="small">
              Enabled: <span className="fw-semibold">{supportsRenderedPreview ? "Yes" : "No"}</span>
              {" | "}Method: <span className="fw-semibold">{renderedPreviewMethod}</span>
              {" | "}Default open: <span className="fw-semibold">{renderedPreviewDefaultOn ? "Yes" : "No"}</span>
              {payloadConfig.fileType === "xml" && renderedPreviewMethod === "xml_xslt" ? (
                <>
                  {" | "}XSLT template ID:{" "}
                  <span className="fw-semibold">{xmlRenderedPreviewXsltTemplateId.trim() || "-"}</span>
                  {" | "}Renderer profile:{" "}
                  <span className="fw-semibold">{xmlRenderedPreviewRendererProfileId.trim() || "-"}</span>
                </>
              ) : null}
            </div>
          </div>
          {(payloadConfig.fileType === "html" || payloadConfig.fileType === "xml") && (
            <div className="col-12">
              <div className="text-muted small">Extraction template</div>
              <div className="fw-semibold">{selectedTemplate ? selectedTemplate.name : "Not selected"}</div>
            </div>
          )}
          {payloadConfig.fileType === "html" && (
            <div className="col-12">
              <div className="text-muted small">HTML settings</div>
              <div className="small">
                Segmenter: <span className="fw-semibold">{htmlCfg.segmenter}</span>
                {" | "}Preserve whitespace: <span className="fw-semibold">{htmlCfg.preserveWhitespace ? "Yes" : "No"}</span>
                {" | "}Normalize spaces: <span className="fw-semibold">{htmlCfg.normalizeSpaces ? "Yes" : "No"}</span>
                {" | "}Inline tags as placeholders:{" "}
                <span className="fw-semibold">{htmlCfg.inlineTagPlaceholders ? "Yes" : "No"}</span>
              </div>
            </div>
          )}
          {payloadConfig.fileType === "xml" && (
            <div className="col-12">
              <div className="text-muted small">XML settings</div>
              <div className="small">
                Segmenter: <span className="fw-semibold">{xmlCfg.segmenter}</span>
                {" | "}Preserve structure/whitespace:{" "}
                <span className="fw-semibold">{xmlCfg.preserveWhitespace ? "Yes" : "No"}</span>
              </div>
            </div>
          )}
          {payloadConfig.fileType === "pdf" && (
            <div className="col-12">
              <div className="text-muted small">PDF settings</div>
              <div className="small">
                Layout mode: <span className="fw-semibold">{pdfCfg.layoutMode}</span>
                {" | "}Segmenter: <span className="fw-semibold">{pdfCfg.segmenter}</span>
              </div>
            </div>
          )}
          {payloadConfig.fileType === "docx" && (
            <div className="col-12">
              <div className="text-muted small">DOCX settings</div>
              <div className="small">
                Segmenter: <span className="fw-semibold">{docxCfg.segmenter}</span>
                {" | "}Comments: <span className="fw-semibold">{docxCfg.includeComments ? "Yes" : "No"}</span>
                {" | "}Footnotes: <span className="fw-semibold">{docxCfg.includeFootnotes ? "Yes" : "No"}</span>
                {" | "}Preserve formatting tags:{" "}
                <span className="fw-semibold">{docxCfg.preserveFormattingTags ? "Yes" : "No"}</span>
              </div>
            </div>
          )}
          {payloadConfig.fileType === "pptx" && (
            <div className="col-12">
              <div className="text-muted small">PPTX settings</div>
              <div className="small">
                Segmenter: <span className="fw-semibold">{pptxCfg.segmenter}</span>
                {" | "}Speaker notes: <span className="fw-semibold">{pptxCfg.includeSpeakerNotes ? "Yes" : "No"}</span>
                {" | "}Preserve formatting tags:{" "}
                <span className="fw-semibold">{pptxCfg.preserveFormattingTags ? "Yes" : "No"}</span>
              </div>
            </div>
          )}
          {payloadConfig.fileType === "xlsx" && (
            <div className="col-12">
              <div className="text-muted small">XLSX settings</div>
              <div className="small">
                Segmenter: <span className="fw-semibold">{xlsxCfg.segmenter}</span>
                {" | "}Cell comments: <span className="fw-semibold">{xlsxCfg.includeCellComments ? "Yes" : "No"}</span>
                {" | "}Preserve formatting tags:{" "}
                <span className="fw-semibold">{xlsxCfg.preserveFormattingTags ? "Yes" : "No"}</span>
              </div>
            </div>
          )}
          <div className="col-12">
            <div className="text-muted small">Preview</div>
            <div className="fw-semibold">
              {previewResult ? `${previewResult.total} segments (${previewResult.kind})` : "Not run (optional)"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
