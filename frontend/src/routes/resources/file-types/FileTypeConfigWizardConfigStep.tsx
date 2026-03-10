import React from "react";
import { type ParsingTemplateKind } from "../../../api";
import { renderWithTags } from "../../../utils/tags";
import {
  STARTER_PARSING_TEMPLATE_CONFIG,
  STARTER_XML_PARSING_TEMPLATE_CONFIG
} from "./FileTypeConfigWizard.helpers";
import FileTypeConfigWizardTemplateEditorModal from "./FileTypeConfigWizardTemplateEditorModal";
import FileTypeConfigWizardTemplateJsonModal from "./FileTypeConfigWizardTemplateJsonModal";

export default function FileTypeConfigWizardConfigStep(props: any) {
  const {
    buildTemplateConfigFromRules,
    closeTemplateEditor,
    disabled,
    docxCfg,
    effectiveFileType,
    handleDownloadTemplate,
    handleImportTemplateFile,
    handleSaveTemplate,
    handleValidateTemplate,
    handleViewSelectedTemplateJson,
    htmlCfg,
    name,
    openCreateTemplate,
    openEditTemplate,
    pdfCfg,
    pptxCfg,
    resetTemplateDraft,
    selectedTemplate,
    selectedTemplateId,
    setDocxCfg,
    setHtmlCfg,
    setPdfCfg,
    setPptxCfg,
    setTemplateAdvancedJson,
    setTemplateDraftDescription,
    setTemplateDraftError,
    setTemplateDraftJson,
    setTemplateDraftName,
    setTemplateDraftOk,
    setTemplateEditorMode,
    setTemplateRuleBlockText,
    setTemplateRuleIgnoreText,
    setTemplateRuleInlineText,
    setTemplateRuleTab,
    setTemplateSaveError,
    setTemplateXmlAttributeAllowlistText,
    setTemplateXmlDefaultNamespacePrefix,
    setTemplateXmlNamespaces,
    setTemplateXmlTranslateAttributes,
    setTemplateXmlTreatCdataAsText,
    setViewTemplateJsonOpen,
    setXlsxCfg,
    setXmlCfg,
    templateAdvancedJson,
    templateDraftDescription,
    templateDraftError,
    templateDraftJson,
    templateDraftName,
    templateDraftOk,
    templateEditorMode,
    templateRuleBlockText,
    templateRuleIgnoreText,
    templateRuleInlineText,
    templateRuleTab,
    templates,
    templateSaveError,
    templateSaving,
    templatesError,
    templatesLoaded,
    templatesLoading,
    templateSourceUploadBusy,
    templateUploadInputRef,
    templateXmlAttributeAllowlistText,
    templateXmlDefaultNamespacePrefix,
    templateXmlNamespaces,
    templateXmlTranslateAttributes,
    templateXmlTreatCdataAsText,
    viewTemplateJsonError,
    viewTemplateJsonLoading,
    viewTemplateJsonOpen,
    viewTemplateJsonText,
    xlsxCfg,
    xmlCfg,
    previewResult,
    previewShowTags,
    setPreviewShowTags
  } = props;
  return (
          <>
            <div className="fw-semibold mb-2">Configuration</div>
            {!effectiveFileType ? (
              <div className="text-muted">Choose a file type first.</div>
            ) : effectiveFileType === "html" || effectiveFileType === "xml" ? (
              <>
                <div className="row g-3">
                  <div className="col-lg-6">
                    <label className="form-label">Extraction Template</label>
                    <div className="d-flex gap-2 flex-wrap">
                      <select
                        className="form-select flex-grow-1"
                        value={selectedTemplateId || ""}
                        disabled={templatesLoading || templateEditorMode !== "none"}
                        onChange={(e) => {
                          const v = String(e.target.value || "");
                          if (effectiveFileType === "html") setHtmlCfg((prev) => ({ ...prev, parsingTemplateId: v }));
                          if (effectiveFileType === "xml") setXmlCfg((prev) => ({ ...prev, parsingTemplateId: v }));
                        }}
                      >
                        <option value="">Select template...</option>
                        {templates.map((tpl) => {
                          const versionLabel = tpl.version != null ? `v${tpl.version}` : "v1";
                          return (
                            <option key={tpl.id} value={String(tpl.id)}>
                              {tpl.name} ({versionLabel})
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => void handleViewSelectedTemplateJson()}
                        disabled={!selectedTemplate || templateEditorMode !== "none"}
                      >
                        View JSON
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => void handleDownloadTemplate()}
                        disabled={!selectedTemplate || templateEditorMode !== "none"}
                      >
                        Download JSON
                      </button>
                    </div>
                    {templatesError && <div className="text-danger small mt-1">{templatesError}</div>}
                    {selectedTemplateId && !selectedTemplate && !templatesLoading ? (
                      <div className="text-danger small mt-1">Selected template no longer exists. Choose another.</div>
                    ) : null}
                    {!templatesLoading && templatesLoaded && templates.length === 0 ? (
                      <div className="text-muted small mt-1">No extraction templates yet. Create or import one.</div>
                    ) : null}
                  </div>
                  <div className="col-lg-6">
                    <label className="form-label">Segmenter</label>
                    <select
                      className="form-select"
                      value={effectiveFileType === "html" ? htmlCfg.segmenter : xmlCfg.segmenter}
                      onChange={(e) => {
                        const v = e.target.value === "sentences" ? "sentences" : "lines";
                        if (effectiveFileType === "html") setHtmlCfg((prev) => ({ ...prev, segmenter: v }));
                        if (effectiveFileType === "xml") setXmlCfg((prev) => ({ ...prev, segmenter: v }));
                      }}
                    >
                      <option value="lines">Lines</option>
                      <option value="sentences">Sentences</option>
                    </select>
                  </div>
                </div>

                <div className="row g-3 mt-1">
                  {effectiveFileType === "html" ? (
                    <>
                      <div className="col-md-4">
                        <div className="form-check">
                          <input
                            id="html-preserve"
                            type="checkbox"
                            className="form-check-input"
                            checked={htmlCfg.preserveWhitespace}
                            onChange={(e) => setHtmlCfg((prev) => ({ ...prev, preserveWhitespace: e.target.checked }))}
                          />
                          <label className="form-check-label" htmlFor="html-preserve">
                            Preserve whitespace
                          </label>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="form-check">
                          <input
                            id="html-normalize"
                            type="checkbox"
                            className="form-check-input"
                            checked={htmlCfg.normalizeSpaces}
                            onChange={(e) => setHtmlCfg((prev) => ({ ...prev, normalizeSpaces: e.target.checked }))}
                          />
                          <label className="form-check-label" htmlFor="html-normalize">
                            Normalize spaces
                          </label>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="form-check">
                          <input
                            id="html-inline"
                            type="checkbox"
                            className="form-check-input"
                            checked={htmlCfg.inlineTagPlaceholders}
                            onChange={(e) => setHtmlCfg((prev) => ({ ...prev, inlineTagPlaceholders: e.target.checked }))}
                          />
                          <label className="form-check-label" htmlFor="html-inline">
                            Inline tags as placeholders
                          </label>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="col-md-6">
                      <div className="form-check">
                        <input
                          id="xml-preserve"
                          type="checkbox"
                          className="form-check-input"
                          checked={xmlCfg.preserveWhitespace}
                          onChange={(e) => setXmlCfg((prev) => ({ ...prev, preserveWhitespace: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="xml-preserve">
                          Preserve structure/whitespace
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div className="d-flex align-items-center gap-2 mt-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={templateEditorMode !== "none"}
                    onClick={openCreateTemplate}
                  >
                    <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                    Create template
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={templateEditorMode !== "none"}
                    onClick={() => templateUploadInputRef.current?.click()}
                  >
                    <i className="bi bi-upload me-1" aria-hidden="true" />
                    Import template
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={!selectedTemplate || templateEditorMode !== "none"}
                    onClick={openEditTemplate}
                  >
                    <i className="bi bi-pencil-square me-1" aria-hidden="true" />
                    Edit template
                  </button>
                  <input
                    ref={templateUploadInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="d-none"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      e.currentTarget.value = "";
                      if (!file) return;
                      if (templateEditorMode === "none") {
                        const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";
                        resetTemplateDraft({ kind, config: kind === "xml" ? STARTER_XML_PARSING_TEMPLATE_CONFIG : STARTER_PARSING_TEMPLATE_CONFIG });
                        setTemplateEditorMode("upload");
                      }
                      void handleImportTemplateFile(file);
                    }}
                  />
                  {selectedTemplate && (
                    <div className="text-muted small">
                      Selected: <span className="fw-semibold">{selectedTemplate.name}</span> (ID {selectedTemplate.id})
                    </div>
                  )}
                </div>

                <FileTypeConfigWizardTemplateEditorModal
                  {...{
                    buildTemplateConfigFromRules,
                    closeTemplateEditor,
                    effectiveFileType,
                    handleDownloadTemplate,
                    handleSaveTemplate,
                    handleValidateTemplate,
                    selectedTemplate,
                    setTemplateAdvancedJson,
                    setTemplateDraftDescription,
                    setTemplateDraftError,
                    setTemplateDraftJson,
                    setTemplateDraftName,
                    setTemplateDraftOk,
                    setTemplateRuleBlockText,
                    setTemplateRuleIgnoreText,
                    setTemplateRuleInlineText,
                    setTemplateRuleTab,
                    setTemplateSaveError,
                    setTemplateXmlAttributeAllowlistText,
                    setTemplateXmlDefaultNamespacePrefix,
                    setTemplateXmlNamespaces,
                    setTemplateXmlTranslateAttributes,
                    setTemplateXmlTreatCdataAsText,
                    templateAdvancedJson,
                    templateDraftDescription,
                    templateDraftError,
                    templateDraftJson,
                    templateDraftName,
                    templateDraftOk,
                    templateEditorMode,
                    templateRuleBlockText,
                    templateRuleIgnoreText,
                    templateRuleInlineText,
                    templateRuleTab,
                    templateSaveError,
                    templateSaving,
                    templateSourceUploadBusy,
                    templateUploadInputRef,
                    templateXmlAttributeAllowlistText,
                    templateXmlDefaultNamespacePrefix,
                    templateXmlNamespaces,
                    templateXmlTranslateAttributes,
                    templateXmlTreatCdataAsText
                  }}
                />

                <FileTypeConfigWizardTemplateJsonModal
                  selectedTemplate={selectedTemplate}
                  viewTemplateJsonError={viewTemplateJsonError}
                  viewTemplateJsonLoading={viewTemplateJsonLoading}
                  viewTemplateJsonOpen={viewTemplateJsonOpen}
                  viewTemplateJsonText={viewTemplateJsonText}
                  setViewTemplateJsonOpen={setViewTemplateJsonOpen}
                  handleDownloadTemplate={handleDownloadTemplate}
                />
              </>
            ) : effectiveFileType === "pdf" ? (
              <div className="row g-3">
                <div className="col-lg-6">
                  <label className="form-label">Layout mode</label>
                  <select
                    className="form-select"
                    value={pdfCfg.layoutMode}
                    onChange={(e) => setPdfCfg((prev) => ({ ...prev, layoutMode: e.target.value === "line" ? "line" : "paragraph" }))}
                  >
                    <option value="paragraph">Paragraph</option>
                    <option value="line">Line</option>
                  </select>
                  <div className="form-text">PDF extraction quality varies; preview is strongly recommended.</div>
                </div>
                <div className="col-lg-6">
                  <label className="form-label">Segmenter</label>
                  <select
                    className="form-select"
                    value={pdfCfg.segmenter}
                    onChange={(e) => setPdfCfg((prev) => ({ ...prev, segmenter: e.target.value === "sentences" ? "sentences" : "lines" }))}
                  >
                    <option value="lines">Lines</option>
                    <option value="sentences">Sentences</option>
                  </select>
                </div>
                <div className="col-12">
                  <div className="alert alert-warning py-2 mb-0">
                    PDF extraction is best-effort. OCR and advanced layout modes will be added later.
                  </div>
                </div>
              </div>
            ) : effectiveFileType === "docx" ? (
              <div className="row g-3">
                <div className="col-lg-6">
                  <label className="form-label">Segmenter</label>
                  <select
                    className="form-select"
                    value={docxCfg.segmenter}
                    onChange={(e) => setDocxCfg((prev) => ({ ...prev, segmenter: e.target.value === "sentences" ? "sentences" : "lines" }))}
                  >
                    <option value="lines">Paragraph/line</option>
                    <option value="sentences">Sentences</option>
                  </select>
                </div>
                <div className="col-12">
                  <div className="row g-2">
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          id="docx-comments"
                          type="checkbox"
                          className="form-check-input"
                          checked={docxCfg.includeComments}
                          onChange={(e) => setDocxCfg((prev) => ({ ...prev, includeComments: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="docx-comments">
                          Extract comments
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          id="docx-footnotes"
                          type="checkbox"
                          className="form-check-input"
                          checked={docxCfg.includeFootnotes}
                          onChange={(e) => setDocxCfg((prev) => ({ ...prev, includeFootnotes: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="docx-footnotes">
                          Extract footnotes
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          id="docx-tags"
                          type="checkbox"
                          className="form-check-input"
                          checked={docxCfg.preserveFormattingTags}
                          onChange={(e) => setDocxCfg((prev) => ({ ...prev, preserveFormattingTags: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="docx-tags">
                          Preserve formatting tags
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : effectiveFileType === "pptx" ? (
              <div className="row g-3">
                <div className="col-lg-6">
                  <label className="form-label">Segmenter</label>
                  <select
                    className="form-select"
                    value={pptxCfg.segmenter}
                    onChange={(e) => setPptxCfg((prev) => ({ ...prev, segmenter: e.target.value === "sentences" ? "sentences" : "lines" }))}
                  >
                    <option value="lines">Lines</option>
                    <option value="sentences">Sentences</option>
                  </select>
                </div>
                <div className="col-12">
                  <div className="row g-2">
                    <div className="col-md-6">
                      <div className="form-check">
                        <input
                          id="pptx-notes"
                          type="checkbox"
                          className="form-check-input"
                          checked={pptxCfg.includeSpeakerNotes}
                          onChange={(e) => setPptxCfg((prev) => ({ ...prev, includeSpeakerNotes: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="pptx-notes">
                          Extract speaker notes
                        </label>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-check">
                        <input
                          id="pptx-tags"
                          type="checkbox"
                          className="form-check-input"
                          checked={pptxCfg.preserveFormattingTags}
                          onChange={(e) => setPptxCfg((prev) => ({ ...prev, preserveFormattingTags: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="pptx-tags">
                          Preserve formatting tags
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : effectiveFileType === "xlsx" ? (
              <div className="row g-3">
                <div className="col-lg-6">
                  <label className="form-label">Segmenter</label>
                  <select
                    className="form-select"
                    value={xlsxCfg.segmenter}
                    onChange={(e) => setXlsxCfg((prev) => ({ ...prev, segmenter: e.target.value === "sentences" ? "sentences" : "lines" }))}
                  >
                    <option value="lines">Cells/lines</option>
                    <option value="sentences">Sentences</option>
                  </select>
                </div>
                <div className="col-12">
                  <div className="row g-2">
                    <div className="col-md-6">
                      <div className="form-check">
                        <input
                          id="xlsx-comments"
                          type="checkbox"
                          className="form-check-input"
                          checked={xlsxCfg.includeCellComments}
                          onChange={(e) => setXlsxCfg((prev) => ({ ...prev, includeCellComments: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="xlsx-comments">
                          Extract cell comments
                        </label>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-check">
                        <input
                          id="xlsx-tags"
                          type="checkbox"
                          className="form-check-input"
                          checked={xlsxCfg.preserveFormattingTags}
                          onChange={(e) => setXlsxCfg((prev) => ({ ...prev, preserveFormattingTags: e.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="xlsx-tags">
                          Preserve formatting tags
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
  );
}

