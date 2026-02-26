import React from "react";
import { LanguageLabel } from "../../../components/LanguageLabel";
import { DynamicFieldsSection } from "../../../components/TermbaseFields";
import type { TermbaseTerm } from "../../../api";

export default function TermbaseEditorDetailPane(props: any) {
  const {
    selectedEntryId,
    detailLoading,
    entryDetail,
    addingLanguage,
    newLanguageValue,
    setNewLanguageValue,
    handleAddLanguage,
    canEdit,
    addingLanguageBusy,
    setAddingLanguage,
    hasStructureConfig,
    entryFieldSchemas,
    updateEntryCustomField,
    isImageFilename,
    entryCreatedLabel,
    entryCreatedBy,
    entryModifiedLabel,
    entryModifiedBy,
    visibleSections,
    setNewTermLang,
    setNewTermDraft,
    savingTermLang,
    handleDeleteLanguage,
    deletingLanguage,
    languageFieldSchemas,
    updateLanguageCustomField,
    showStatus,
    statusOptions,
    showPartOfSpeech,
    showNotes,
    setEntryDetail,
    queueTermUpdate,
    handleDeleteTerm,
    deletingTermId,
    formatDateTime,
    termFieldSchemas,
    updateTermCustomField,
    newTermLang,
    newTermDraft,
    handleAddTerm,
    DEFAULT_NEW_TERM,
  } = props;
  return (
        <section className="fc-termbase-detail">
          {!selectedEntryId ? (
            <div className="text-muted p-4">Select an entry to start editing.</div>
          ) : detailLoading ? (
            <div className="text-muted p-4">Loading entry...</div>
          ) : entryDetail ? (
            <div className="fc-termbase-detail-body">
              <div className="fc-termbase-detail-header">
                <div className="fw-semibold">Entry {selectedEntryId}</div>
                <div className="d-flex align-items-center gap-2">
                  {addingLanguage ? (
                    <div className="d-flex align-items-center gap-2">
                      <input
                        className="form-control form-control-sm"
                        placeholder="Language code (e.g. de)"
                        list="termbase-language-options"
                        value={newLanguageValue}
                        onChange={(e) => setNewLanguageValue(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void handleAddLanguage()}
                        disabled={!newLanguageValue.trim() || !canEdit || addingLanguageBusy}
                      >
                        {addingLanguageBusy ? "Adding..." : "Add language"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => {
                          setAddingLanguage(false);
                          setNewLanguageValue("");
                        }}
                        disabled={addingLanguageBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setAddingLanguage(true)}
                      disabled={!canEdit || addingLanguageBusy}
                    >
                      Add language
                    </button>
                  )}
                </div>
              </div>

              <div className="fc-termbase-entry-audit text-muted small">
                <div>
                  Created: {entryCreatedLabel} by {entryCreatedBy}
                </div>
                <div>
                  Last modified: {entryModifiedLabel} by {entryModifiedBy}
                </div>
              </div>

              {hasStructureConfig && entryFieldSchemas.length > 0 && (
                <div className="fc-termbase-entry-fields card-enterprise">
                  <div className="fc-termbase-section-title">Entry fields</div>
                  <DynamicFieldsSection
                    fields={entryFieldSchemas}
                    values={entryDetail.customFields}
                    disabled={!canEdit}
                    onChange={updateEntryCustomField}
                  />
                </div>
              )}

              <div className="fc-termbase-illustration text-muted small">
                Illustration:{" "}
                {entryDetail.illustration ? (
                  <span className="d-inline-flex align-items-center gap-2">
                    {entryDetail.illustration.url && isImageFilename(entryDetail.illustration.filename) && (
                      <img
                        className="fc-termbase-illustration-thumb"
                        src={entryDetail.illustration.url}
                        alt=""
                      />
                    )}
                    {entryDetail.illustration.url ? (
                      <a href={entryDetail.illustration.url} target="_blank" rel="noreferrer">
                        {entryDetail.illustration.filename}
                      </a>
                    ) : (
                      <span>{entryDetail.illustration.filename}</span>
                    )}
                  </span>
                ) : (
                  <span>Not available</span>
                )}
              </div>

              {visibleSections.map((section) => {
                const lang = section.language;
                return (
                  <div key={lang} className="fc-termbase-language-card card-enterprise">
                    <div className="fc-termbase-language-header">
                      <LanguageLabel code={lang} />
                      <div className="ms-auto d-flex align-items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => {
                            setNewTermLang(lang);
                            setNewTermDraft({ ...DEFAULT_NEW_TERM });
                          }}
                          disabled={!canEdit || savingTermLang === lang}
                        >
                          Add term
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => void handleDeleteLanguage(lang)}
                          disabled={!canEdit || deletingLanguage === lang}
                        >
                          {deletingLanguage === lang ? "Deleting..." : "Delete language"}
                        </button>
                      </div>
                    </div>

                    <div className="fc-termbase-language-body">
                      {hasStructureConfig && languageFieldSchemas.length > 0 && (
                        <div className="fc-termbase-language-fields">
                          <DynamicFieldsSection
                            fields={languageFieldSchemas}
                            values={section.customFields}
                            disabled={!canEdit}
                            onChange={(fieldName, value) => updateLanguageCustomField(lang, fieldName, value)}
                            dense
                          />
                        </div>
                      )}
                      {section.terms.map((term) => (
                        <div key={term.termId} className="fc-termbase-term-row">
                          <div className="fc-termbase-term-field">
                            <label className="form-label small text-muted">Term</label>
                            <input
                              className="form-control form-control-sm"
                              value={term.text}
                              onChange={(e) => {
                                const next = e.target.value;
                                setEntryDetail((prev) => {
                                  if (!prev) return prev;
                                  return {
                                    ...prev,
                                    languages: prev.languages.map((item) =>
                                      item.language === lang
                                        ? {
                                            ...item,
                                            terms: item.terms.map((t) => (t.termId === term.termId ? { ...t, text: next } : t))
                                          }
                                        : item
                                    )
                                  };
                                });
                                if (next.trim()) {
                                queueTermUpdate(term.termId, { text: next.trim(), updatedAt: term.updatedAt }, term);
                                }
                              }}
                              disabled={!canEdit}
                            />
                          </div>
                          {showStatus && (
                            <div className="fc-termbase-term-field">
                              <label className="form-label small text-muted">Status</label>
                              <select
                                className="form-select form-select-sm fc-termbase-status"
                                value={term.status}
                                onChange={(e) => {
                                  const next = e.target.value as TermbaseTerm["status"];
                                  setEntryDetail((prev) => {
                                    if (!prev) return prev;
                                    return {
                                      ...prev,
                                      languages: prev.languages.map((item) =>
                                        item.language === lang
                                          ? {
                                              ...item,
                                              terms: item.terms.map((t) => (t.termId === term.termId ? { ...t, status: next } : t))
                                            }
                                          : item
                                      )
                                    };
                                  });
                                  queueTermUpdate(term.termId, { status: next, updatedAt: term.updatedAt }, term);
                                }}
                                disabled={!canEdit}
                              >
                                {statusOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          {showPartOfSpeech && (
                            <div className="fc-termbase-term-field">
                              <label className="form-label small text-muted">Part of speech</label>
                              <input
                                className="form-control form-control-sm"
                                value={term.partOfSpeech || ""}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setEntryDetail((prev) => {
                                    if (!prev) return prev;
                                    return {
                                      ...prev,
                                      languages: prev.languages.map((item) =>
                                        item.language === lang
                                          ? {
                                              ...item,
                                              terms: item.terms.map((t) =>
                                                t.termId === term.termId ? { ...t, partOfSpeech: next || null } : t
                                              )
                                            }
                                          : item
                                      )
                                    };
                                  });
                                  queueTermUpdate(term.termId, { partOfSpeech: next, updatedAt: term.updatedAt }, term);
                                }}
                                disabled={!canEdit}
                              />
                            </div>
                          )}
                          {showNotes && (
                            <div className="fc-termbase-term-field fc-termbase-term-notes">
                              <label className="form-label small text-muted">Notes</label>
                              <textarea
                                className="form-control form-control-sm"
                                rows={2}
                                value={term.notes || ""}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setEntryDetail((prev) => {
                                    if (!prev) return prev;
                                    return {
                                      ...prev,
                                      languages: prev.languages.map((item) =>
                                        item.language === lang
                                          ? {
                                              ...item,
                                              terms: item.terms.map((t) =>
                                                t.termId === term.termId ? { ...t, notes: next || null } : t
                                              )
                                            }
                                          : item
                                      )
                                    };
                                  });
                                  queueTermUpdate(term.termId, { notes: next, updatedAt: term.updatedAt }, term);
                                }}
                                disabled={!canEdit}
                              />
                            </div>
                          )}
                          <div className="fc-termbase-term-actions">
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => void handleDeleteTerm(term)}
                              disabled={!canEdit || deletingTermId === term.termId}
                            >
                              {deletingTermId === term.termId ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                          <div className="fc-termbase-term-audit text-muted small">
                            <div>
                              Created: {formatDateTime(term.audit?.createdAt) || "-"} by {term.audit?.createdBy || "-"}
                            </div>
                            <div>
                              Last modified: {formatDateTime(term.audit?.modifiedAt) || "-"} by {term.audit?.modifiedBy || "-"}
                            </div>
                          </div>
                          {hasStructureConfig && termFieldSchemas.length > 0 && (
                            <div className="fc-termbase-term-custom">
                              <DynamicFieldsSection
                                fields={termFieldSchemas}
                                values={term.customFields}
                                disabled={!canEdit}
                                onChange={(fieldName, value) => updateTermCustomField(term, fieldName, value)}
                                dense
                              />
                            </div>
                          )}
                        </div>
                      ))}

                      {newTermLang === lang && (
                        <div className="fc-termbase-term-row fc-termbase-term-row-new">
                          <div className="fc-termbase-term-field">
                            <label className="form-label small text-muted">Term</label>
                            <input
                              className="form-control form-control-sm"
                              value={newTermDraft.text}
                              onChange={(e) => setNewTermDraft((prev) => ({ ...prev, text: e.target.value }))}
                            />
                          </div>
                          {showStatus && (
                            <div className="fc-termbase-term-field">
                              <label className="form-label small text-muted">Status</label>
                              <select
                                className="form-select form-select-sm fc-termbase-status"
                                value={newTermDraft.status}
                                onChange={(e) =>
                                  setNewTermDraft((prev) => ({
                                    ...prev,
                                    status: e.target.value as TermbaseTerm["status"]
                                  }))
                                }
                              >
                                {statusOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          {showPartOfSpeech && (
                            <div className="fc-termbase-term-field">
                              <label className="form-label small text-muted">Part of speech</label>
                              <input
                                className="form-control form-control-sm"
                                value={newTermDraft.partOfSpeech}
                                onChange={(e) => setNewTermDraft((prev) => ({ ...prev, partOfSpeech: e.target.value }))}
                              />
                            </div>
                          )}
                          {showNotes && (
                            <div className="fc-termbase-term-field fc-termbase-term-notes">
                              <label className="form-label small text-muted">Notes</label>
                              <textarea
                                className="form-control form-control-sm"
                                rows={2}
                                value={newTermDraft.notes}
                                onChange={(e) => setNewTermDraft((prev) => ({ ...prev, notes: e.target.value }))}
                              />
                            </div>
                          )}
                          <div className="fc-termbase-term-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => void handleAddTerm(lang)}
                              disabled={!newTermDraft.text.trim() || savingTermLang === lang}
                            >
                              {savingTermLang === lang ? "Adding..." : "Add"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => {
                                setNewTermLang(null);
                                setNewTermDraft({ ...DEFAULT_NEW_TERM });
                              }}
                              disabled={savingTermLang === lang}
                            >
                              Cancel
                            </button>
                          </div>
                          {hasStructureConfig && termFieldSchemas.length > 0 && (
                            <div className="fc-termbase-term-custom">
                              <DynamicFieldsSection
                                fields={termFieldSchemas}
                                values={newTermDraft.customFields}
                                disabled={savingTermLang === lang}
                                onChange={(fieldName, value) =>
                                  setNewTermDraft((prev) => ({
                                    ...prev,
                                    customFields: { ...(prev.customFields ?? {}), [fieldName]: value }
                                  }))
                                }
                                dense
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {section.terms.length === 0 && newTermLang !== lang && (
                        <div className="text-muted small">No terms yet. Click "Add term" to start.</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted p-4">Select an entry to start editing.</div>
          )}
        </section>
  );
}
