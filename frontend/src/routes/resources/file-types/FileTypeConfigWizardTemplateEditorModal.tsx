import React from "react";
import Modal from "../../../components/Modal";
import { type ParsingTemplateKind } from "../../../api";
import { validateParsingTemplateJson } from "./FileTypeConfigWizard.helpers";

export default function FileTypeConfigWizardTemplateEditorModal(props: any) {
  const {
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
  } = props;

  function clearTemplateValidation() {
    setTemplateDraftOk(null);
    if (templateDraftError) setTemplateDraftError(null);
  }

  function applyValidatedRules(config: any, kind: ParsingTemplateKind) {
    if (kind === "xml") {
      setTemplateRuleBlockText((config.block_xpath || []).join("\n"));
      setTemplateRuleInlineText((config.inline_xpath || []).join("\n"));
      setTemplateRuleIgnoreText((config.ignored_xpath || []).join("\n"));
      const namespaces =
        config.namespaces && typeof config.namespaces === "object" ? config.namespaces : {};
      setTemplateXmlNamespaces(
        Object.entries(namespaces).map(([prefix, uri]) => ({
          prefix: String(prefix || "").trim(),
          uri: String(uri || "").trim()
        }))
      );
      setTemplateXmlDefaultNamespacePrefix(String(config.default_namespace_prefix ?? "d"));
      setTemplateXmlTranslateAttributes(Boolean(config.translate_attributes));
      setTemplateXmlAttributeAllowlistText((config.attribute_allowlist || []).join("\n"));
      setTemplateXmlTreatCdataAsText(config.treat_cdata_as_text !== undefined ? Boolean(config.treat_cdata_as_text) : true);
    } else {
      setTemplateRuleBlockText((config.block_tags || []).join("\n"));
      setTemplateRuleInlineText((config.inline_tags || []).join("\n"));
      setTemplateRuleIgnoreText((config.ignored_tags || []).join("\n"));
    }
    setTemplateDraftJson(JSON.stringify(config, null, 2));
    setTemplateAdvancedJson(false);
    setTemplateDraftOk(true);
    setTemplateDraftError(null);
  }

  if (templateEditorMode === "none") return null;

  return (
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
                  <div className="text-muted small mb-2">Prefix {"->"} URI mappings available to XPath rules.</div>
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
                        {templateXmlNamespaces.map((row: any, idx: number) => (
                          <tr key={`${idx}:${row.prefix}`}>
                            <td>
                              <input
                                className="form-control form-control-sm font-monospace"
                                value={row.prefix}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setTemplateXmlNamespaces((prev: any[]) =>
                                    prev.map((entry, entryIndex) => (entryIndex === idx ? { ...entry, prefix: value } : entry))
                                  );
                                  clearTemplateValidation();
                                }}
                                disabled={templateSaving || templateSourceUploadBusy}
                              />
                            </td>
                            <td>
                              <input
                                className="form-control form-control-sm font-monospace"
                                value={row.uri}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setTemplateXmlNamespaces((prev: any[]) =>
                                    prev.map((entry, entryIndex) => (entryIndex === idx ? { ...entry, uri: value } : entry))
                                  );
                                  clearTemplateValidation();
                                }}
                                disabled={templateSaving || templateSourceUploadBusy}
                              />
                            </td>
                            <td className="text-end">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => {
                                  setTemplateXmlNamespaces((prev: any[]) => prev.filter((_, entryIndex) => entryIndex !== idx));
                                  clearTemplateValidation();
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
                      setTemplateXmlNamespaces((prev: any[]) => [...prev, { prefix: "", uri: "" }]);
                      clearTemplateValidation();
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
                      clearTemplateValidation();
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
                        clearTemplateValidation();
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
                        clearTemplateValidation();
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
                          clearTemplateValidation();
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
                    const config = buildTemplateConfigFromRules();
                    setTemplateDraftJson(JSON.stringify(config, null, 2));
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
                  applyValidatedRules(validated.config, kind);
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
                        clearTemplateValidation();
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
                        clearTemplateValidation();
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
                        clearTemplateValidation();
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
                  clearTemplateValidation();
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
  );
}
