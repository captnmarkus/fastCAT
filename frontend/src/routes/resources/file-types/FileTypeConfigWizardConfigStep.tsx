import React from "react";
import Modal from "../../../components/Modal";
import { type ParsingTemplateKind } from "../../../api";
import { renderWithTags } from "../../../utils/tags";
import {
  STARTER_PARSING_TEMPLATE_CONFIG,
  STARTER_XML_PARSING_TEMPLATE_CONFIG,
  validateParsingTemplateJson
} from "./FileTypeConfigWizard.helpers";

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

                {templateEditorMode !== "none" && (
                  <Modal
                    title={
                      templateEditorMode === "edit"
                        ? "Edit extraction template"
                        : templateEditorMode === "upload"
                          ? "Import extraction template"
                          : "New extraction template"
                    }
                    onClose={() => void closeTemplateEditor()}
                    closeDisabled={templateSaving || templateSourceUploadBusy}
                    size="xl"
                    footer={
                      <>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => void closeTemplateEditor()}
                          disabled={templateSaving || templateSourceUploadBusy}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={handleValidateTemplate}
                          disabled={templateSaving || templateSourceUploadBusy}
                        >
                          Validate
                        </button>
                        {templateEditorMode === "edit" && selectedTemplate ? (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => void handleDownloadTemplate()}
                            disabled={templateSaving || templateSourceUploadBusy}
                          >
                            Download JSON
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-dark btn-sm"
                          onClick={handleSaveTemplate}
                          disabled={templateSaving || templateSourceUploadBusy || !templateDraftName.trim()}
                        >
                          {templateSaving ? "Saving..." : "Finish"}
                        </button>
                      </>
                    }
                  >
                    {templateSaveError && <div className="alert alert-danger py-2">{templateSaveError}</div>}
                    {templateDraftError && <div className="alert alert-warning py-2">{templateDraftError}</div>}
                    {templateDraftOk && !templateDraftError ? (
                      <div className="alert alert-success py-2">Template is valid.</div>
                    ) : null}
                    {templateSourceUploadBusy ? (
                      <div className="text-muted small d-flex align-items-center gap-2 mb-3">
                        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                        <span>Importing JSON...</span>
                      </div>
                    ) : null}

                    {templateEditorMode === "upload" ? (
                      <div className="mb-3">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => templateUploadInputRef.current?.click()}
                          disabled={templateSaving || templateSourceUploadBusy}
                        >
                          Choose JSON file...
                        </button>
                        <div className="form-text">
                          Upload a JSON file containing a template config (or an object with name/description/config).
                        </div>
                      </div>
                    ) : null}
                    {templateEditorMode === "edit" ? (
                      <div className="mb-3">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => templateUploadInputRef.current?.click()}
                          disabled={templateSaving || templateSourceUploadBusy}
                        >
                          Import JSON...
                        </button>
                        <div className="form-text">Replace this template from a JSON file (you can review before finishing).</div>
                      </div>
                    ) : null}

                    <div className="row g-3">
                      <div className="col-lg-6">
                        <label className="form-label">Name</label>
                        <input
                          className="form-control"
                          value={templateDraftName}
                          onChange={(e) => {
                            setTemplateDraftName(e.target.value);
                            setTemplateSaveError(null);
                          }}
                          disabled={templateSaving || templateSourceUploadBusy}
                        />
                      </div>
                      <div className="col-lg-6">
                        <label className="form-label">Description (optional)</label>
                        <input
                          className="form-control"
                          value={templateDraftDescription}
                          onChange={(e) => {
                            setTemplateDraftDescription(e.target.value);
                            setTemplateSaveError(null);
                          }}
                          disabled={templateSaving || templateSourceUploadBusy}
                        />
                      </div>
                      {effectiveFileType === "xml" ? (
                        <div className="col-12">
                          <div className="border rounded p-3 bg-light">
                            <div className="fw-semibold mb-2">XML settings</div>
                            <div className="row g-3">
                              <div className="col-12">
                                <div className="fw-semibold mb-1">Namespace map</div>
                                <div className="text-muted small mb-2">Prefix → URI mappings available to XPath rules.</div>
                                <div className="table-responsive">
                                  <table className="table table-sm align-middle mb-2">
                                    <thead>
                                      <tr className="text-muted small">
                                        <th style={{ width: 160 }}>Prefix</th>
                                        <th>URI</th>
                                        <th style={{ width: 48 }} />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {templateXmlNamespaces.length === 0 ? (
                                        <tr>
                                          <td colSpan={3} className="text-muted small">
                                            No namespaces configured.
                                          </td>
                                        </tr>
                                      ) : null}
                                      {templateXmlNamespaces.map((row, idx) => (
                                        <tr key={`${idx}:${row.prefix}`}>
                                          <td>
                                            <input
                                              className="form-control form-control-sm font-monospace"
                                              value={row.prefix}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setTemplateXmlNamespaces((prev) =>
                                                  prev.map((r, i) => (i === idx ? { ...r, prefix: v } : r))
                                                );
                                                setTemplateDraftOk(null);
                                                if (templateDraftError) setTemplateDraftError(null);
                                              }}
                                              disabled={templateSaving || templateSourceUploadBusy}
                                            />
                                          </td>
                                          <td>
                                            <input
                                              className="form-control form-control-sm font-monospace"
                                              value={row.uri}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setTemplateXmlNamespaces((prev) =>
                                                  prev.map((r, i) => (i === idx ? { ...r, uri: v } : r))
                                                );
                                                setTemplateDraftOk(null);
                                                if (templateDraftError) setTemplateDraftError(null);
                                              }}
                                              disabled={templateSaving || templateSourceUploadBusy}
                                            />
                                          </td>
                                          <td className="text-end">
                                            <button
                                              type="button"
                                              className="btn btn-outline-secondary btn-sm"
                                              onClick={() => {
                                                setTemplateXmlNamespaces((prev) => prev.filter((_, i) => i !== idx));
                                                setTemplateDraftOk(null);
                                                if (templateDraftError) setTemplateDraftError(null);
                                              }}
                                              disabled={templateSaving || templateSourceUploadBusy}
                                              aria-label="Remove namespace"
                                              title="Remove"
                                            >
                                              <i className="bi bi-x-lg" aria-hidden="true" />
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() => {
                                    setTemplateXmlNamespaces((prev) => [...prev, { prefix: "", uri: "" }]);
                                    setTemplateDraftOk(null);
                                    if (templateDraftError) setTemplateDraftError(null);
                                  }}
                                  disabled={templateSaving || templateSourceUploadBusy}
                                >
                                  <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                                  Add namespace
                                </button>
                              </div>

                              <div className="col-lg-6">
                                <label className="form-label">Default namespace prefix</label>
                                <input
                                  className="form-control font-monospace"
                                  value={templateXmlDefaultNamespacePrefix}
                                  onChange={(e) => {
                                    setTemplateXmlDefaultNamespacePrefix(e.target.value);
                                    setTemplateDraftOk(null);
                                    if (templateDraftError) setTemplateDraftError(null);
                                  }}
                                  disabled={templateSaving || templateSourceUploadBusy}
                                />
                                <div className="form-text">
                                  If the XML uses a default <span className="font-monospace">xmlns</span>, it can be mapped to this prefix for XPath.
                                </div>
                              </div>

                              <div className="col-lg-6">
                                <div className="form-check mt-4">
                                  <input
                                    id="xml-treat-cdata"
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={templateXmlTreatCdataAsText}
                                    onChange={(e) => {
                                      setTemplateXmlTreatCdataAsText(e.target.checked);
                                      setTemplateDraftOk(null);
                                      if (templateDraftError) setTemplateDraftError(null);
                                    }}
                                    disabled={templateSaving || templateSourceUploadBusy}
                                  />
                                  <label className="form-check-label" htmlFor="xml-treat-cdata">
                                    Treat CDATA as text
                                  </label>
                                </div>
                              </div>

                              <div className="col-12">
                                <div className="form-check">
                                  <input
                                    id="xml-translate-attrs"
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={templateXmlTranslateAttributes}
                                    onChange={(e) => {
                                      setTemplateXmlTranslateAttributes(e.target.checked);
                                      setTemplateDraftOk(null);
                                      if (templateDraftError) setTemplateDraftError(null);
                                    }}
                                    disabled={templateSaving || templateSourceUploadBusy}
                                  />
                                  <label className="form-check-label" htmlFor="xml-translate-attrs">
                                    Translate attributes (allowlist)
                                  </label>
                                </div>
                                {templateXmlTranslateAttributes ? (
                                  <div className="mt-2">
                                    <label className="form-label">Attribute allowlist</label>
                                    <textarea
                                      className="form-control font-monospace"
                                      rows={4}
                                      value={templateXmlAttributeAllowlistText}
                                      onChange={(e) => {
                                        setTemplateXmlAttributeAllowlistText(e.target.value);
                                        setTemplateDraftOk(null);
                                        if (templateDraftError) setTemplateDraftError(null);
                                      }}
                                      disabled={templateSaving || templateSourceUploadBusy}
                                    />
                                    <div className="form-text">One attribute per line (e.g. title, alt, aria-label).</div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="col-12">
                        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                          <label className="form-label mb-0">Rules</label>
                          <div className="form-check form-switch m-0">
                            <input
                              id="tpl-advanced-json"
                              className="form-check-input"
                              type="checkbox"
                              checked={templateAdvancedJson}
                              onChange={(e) => {
                                const next = e.target.checked;
                                if (next) {
                                  const cfg = buildTemplateConfigFromRules();
                                  setTemplateDraftJson(JSON.stringify(cfg, null, 2));
                                  setTemplateAdvancedJson(true);
                                  setTemplateDraftOk(null);
                                  setTemplateDraftError(null);
                                  return;
                                }
                                const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";
                                const validated = validateParsingTemplateJson(templateDraftJson, kind);
                                if ("error" in validated) {
                                  setTemplateDraftError(validated.error);
                                  setTemplateDraftOk(false);
                                  return;
                                }
                                if (kind === "xml") {
                                  const cfg = validated.config as any;
                                  setTemplateRuleBlockText((cfg.block_xpath || []).join("\n"));
                                  setTemplateRuleInlineText((cfg.inline_xpath || []).join("\n"));
                                  setTemplateRuleIgnoreText((cfg.ignored_xpath || []).join("\n"));
                                  const nsObj = (cfg.namespaces && typeof cfg.namespaces === "object" ? cfg.namespaces : {}) as Record<string, any>;
                                  setTemplateXmlNamespaces(
                                    Object.entries(nsObj).map(([prefix, uri]) => ({
                                      prefix: String(prefix || "").trim(),
                                      uri: String(uri || "").trim()
                                    }))
                                  );
                                  setTemplateXmlDefaultNamespacePrefix(String(cfg.default_namespace_prefix ?? "d"));
                                  setTemplateXmlTranslateAttributes(Boolean(cfg.translate_attributes));
                                  setTemplateXmlAttributeAllowlistText((cfg.attribute_allowlist || []).join("\n"));
                                  setTemplateXmlTreatCdataAsText(cfg.treat_cdata_as_text !== undefined ? Boolean(cfg.treat_cdata_as_text) : true);
                                } else {
                                  const cfg = validated.config as any;
                                  setTemplateRuleBlockText((cfg.block_tags || []).join("\n"));
                                  setTemplateRuleInlineText((cfg.inline_tags || []).join("\n"));
                                  setTemplateRuleIgnoreText((cfg.ignored_tags || []).join("\n"));
                                }
                                setTemplateDraftJson(JSON.stringify(validated.config, null, 2));
                                setTemplateAdvancedJson(false);
                                setTemplateDraftOk(true);
                                setTemplateDraftError(null);
                              }}
                              disabled={templateSaving || templateSourceUploadBusy}
                            />
                            <label className="form-check-label" htmlFor="tpl-advanced-json">
                              Advanced JSON
                            </label>
                          </div>
                        </div>

                        {!templateAdvancedJson ? (
                          <div className="mt-2">
                            <ul className="nav nav-tabs">
                              <li className="nav-item">
                                <button
                                  type="button"
                                  className={`nav-link${templateRuleTab === "block" ? " active" : ""}`}
                                  onClick={() => setTemplateRuleTab("block")}
                                  disabled={templateSaving || templateSourceUploadBusy}
                                >
                                  {effectiveFileType === "xml" ? "Block XPath" : "Block"}
                                </button>
                              </li>
                              <li className="nav-item">
                                <button
                                  type="button"
                                  className={`nav-link${templateRuleTab === "inline" ? " active" : ""}`}
                                  onClick={() => setTemplateRuleTab("inline")}
                                  disabled={templateSaving || templateSourceUploadBusy}
                                >
                                  {effectiveFileType === "xml" ? "Inline XPath" : "Inline"}
                                </button>
                              </li>
                              <li className="nav-item">
                                <button
                                  type="button"
                                  className={`nav-link${templateRuleTab === "ignore" ? " active" : ""}`}
                                  onClick={() => setTemplateRuleTab("ignore")}
                                  disabled={templateSaving || templateSourceUploadBusy}
                                >
                                  {effectiveFileType === "xml" ? "Ignore XPath" : "Ignore"}
                                </button>
                              </li>
                            </ul>
                            <div className="border border-top-0 rounded-bottom p-3 bg-white">
                              {templateRuleTab === "block" && (
                                <>
                                  <div className="fw-semibold mb-1">{effectiveFileType === "xml" ? "Block XPath rules" : "Block rules"}</div>
                                  <div className="text-muted small mb-2">
                                    {effectiveFileType === "xml"
                                      ? "Elements matching these XPath rules are extracted as translatable segments."
                                      : "These selectors define block boundaries for segmentation. One rule per line."}
                                  </div>
                                  <textarea
                                    className={`form-control font-monospace${templateDraftError ? " is-invalid" : ""}`}
                                    rows={6}
                                    value={templateRuleBlockText}
                                    onChange={(e) => {
                                      setTemplateRuleBlockText(e.target.value);
                                      setTemplateDraftOk(null);
                                      if (templateDraftError) setTemplateDraftError(null);
                                    }}
                                    disabled={templateSaving || templateSourceUploadBusy}
                                  />
                                  <div className="form-text">
                                    {effectiveFileType === "xml"
                                      ? "Use XPath expressions (e.g. //para, //ns:para). One rule per line."
                                      : "Use HTML tag names or CSS selectors (e.g. div#content, p, .translatable)."}
                                  </div>
                                </>
                              )}
                              {templateRuleTab === "inline" && (
                                <>
                                  <div className="fw-semibold mb-1">{effectiveFileType === "xml" ? "Inline XPath rules" : "Inline rules"}</div>
                                  <div className="text-muted small mb-2">
                                    {effectiveFileType === "xml"
                                      ? "Elements matching these XPath rules are preserved as placeholders/tags."
                                      : "Elements matching these rules are kept inline with the surrounding text (treated as placeholders)."}
                                  </div>
                                  <textarea
                                    className="form-control font-monospace"
                                    rows={6}
                                    value={templateRuleInlineText}
                                    onChange={(e) => {
                                      setTemplateRuleInlineText(e.target.value);
                                      setTemplateDraftOk(null);
                                      if (templateDraftError) setTemplateDraftError(null);
                                    }}
                                    disabled={templateSaving || templateSourceUploadBusy}
                                  />
                                  <div className="form-text">One rule per line.</div>
                                </>
                              )}
                              {templateRuleTab === "ignore" && (
                                <>
                                  <div className="fw-semibold mb-1">{effectiveFileType === "xml" ? "Ignore XPath rules" : "Ignore rules"}</div>
                                  <div className="text-muted small mb-2">
                                    {effectiveFileType === "xml"
                                      ? "Elements matching these XPath rules are skipped entirely (not translated)."
                                      : "Elements matching these rules are skipped entirely (not translated)."}
                                  </div>
                                  <textarea
                                    className="form-control font-monospace"
                                    rows={6}
                                    value={templateRuleIgnoreText}
                                    onChange={(e) => {
                                      setTemplateRuleIgnoreText(e.target.value);
                                      setTemplateDraftOk(null);
                                      if (templateDraftError) setTemplateDraftError(null);
                                    }}
                                    disabled={templateSaving || templateSourceUploadBusy}
                                  />
                                  <div className="form-text">One rule per line.</div>
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <label className="form-label">Template JSON</label>
                            <textarea
                              className={`form-control font-monospace${templateDraftError ? " is-invalid" : ""}`}
                              rows={12}
                              value={templateDraftJson}
                              onChange={(e) => {
                                setTemplateDraftJson(e.target.value);
                                setTemplateDraftOk(null);
                                if (templateDraftError) setTemplateDraftError(null);
                              }}
                              disabled={templateSaving || templateSourceUploadBusy}
                            />
                            <div className="form-text">
                              {effectiveFileType === "xml" ? (
                                <>
                                  Accepted keys: <span className="font-monospace">block_xpath</span>/<span className="font-monospace">block</span>,{" "}
                                  <span className="font-monospace">inline_xpath</span>/<span className="font-monospace">inline</span>,{" "}
                                  <span className="font-monospace">ignored_xpath</span>/<span className="font-monospace">ignore</span>,{" "}
                                  <span className="font-monospace">namespaces</span>, <span className="font-monospace">default_namespace_prefix</span>,{" "}
                                  <span className="font-monospace">translate_attributes</span>, <span className="font-monospace">attribute_allowlist</span>,{" "}
                                  <span className="font-monospace">treat_cdata_as_text</span>.
                                </>
                              ) : (
                                <>
                                  Accepted keys: <span className="font-monospace">block_tags</span>/<span className="font-monospace">block</span>,{" "}
                                  <span className="font-monospace">inline_tags</span>/<span className="font-monospace">inline</span>,{" "}
                                  <span className="font-monospace">ignored_tags</span>/<span className="font-monospace">ignore</span>.
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Modal>
                )}

                {viewTemplateJsonOpen && (
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
                )}
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
