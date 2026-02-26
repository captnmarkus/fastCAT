import React, { useEffect, useMemo, useState } from "react";
import type { AdminUser } from "../../../../api";
import { useLanguages } from "../../../../features/languages/hooks";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../../features/languages/utils";
import TargetLanguagesMultiSelect from "./TargetLanguagesMultiSelect";
import UserSelect from "./UserSelect";
import { normalizeLocale } from "../../../../lib/i18n/locale";
import IssuesPanel from "../../../../components/ui/IssuesPanel";

export type TranslationPlanAssignment = {
  assigneeId: string;
};

export type TranslationPlanFile = {
  id: string;
  name: string;
  sizeBytes: number;
  targetLangs: string[];
  assignments: Record<string, TranslationPlanAssignment>;
  assigneeAll: string;
};

export type TranslationPlanProps = {
  mode: "simple" | "advanced";
  sourceLang: string;
  projectTargets: string[];
  files: TranslationPlanFile[];
  users: AdminUser[];
  departmentId?: number | string | null;
  defaultAssigneeId: string;
  taskCount?: number;
  showValidation?: boolean;
  missingAssignments?: Set<string>;
  allowAdmins?: boolean;
  onModeChange: (mode: "simple" | "advanced") => void;
  onFileTargetsChange: (fileId: string, targets: string[]) => void;
  onAssignmentChange: (fileId: string, targetLang: string, patch: Partial<TranslationPlanAssignment>) => void;
  onCopyDefaults: (fileId: string, targetLang: string) => void;
  onFileAssigneeAllChange: (fileId: string, assigneeId: string) => void;
  onBulkFileAssignee: (fileId: string, assigneeId: string) => void;
  onResetFileDefaults: (fileId: string) => void;
  disabled?: boolean;
};

function normalizeLangKey(value: string) {
  return normalizeLocale(String(value || "")).canonical.toLowerCase();
}

export default function TranslationPlan(props: TranslationPlanProps) {
  const {
    mode,
    sourceLang,
    projectTargets,
    files,
    users,
    departmentId,
    defaultAssigneeId,
    taskCount,
    showValidation,
    missingAssignments,
    allowAdmins,
    onModeChange,
    onFileTargetsChange,
    onAssignmentChange,
    onCopyDefaults,
    onBulkFileAssignee,
    onResetFileDefaults,
    disabled
  } = props;

  const { activeTargetLanguages } = useLanguages();
  const optionsByTag = useMemo(() => {
    const map = new Map<string, { label: string; flag?: string }>();
    activeTargetLanguages.forEach((entry) => {
      map.set(entry.canonical, {
        label: formatLanguageEntryLabel(entry),
        flag: languageFlagTag(entry)
      });
    });
    return map;
  }, [activeTargetLanguages]);

  const isAdvanced = mode === "advanced";
  const isReadOnly = Boolean(disabled);
  const fileCount = files.length;
  const resolvedTaskCount = taskCount ?? files.reduce((sum, file) => sum + file.targetLangs.length, 0);
  const missingCount = missingAssignments ? missingAssignments.size : 0;
  const [openFileId, setOpenFileId] = useState<string | null>(null);

  useEffect(() => {
    if (files.length === 0) {
      if (openFileId) setOpenFileId(null);
      return;
    }
    if (openFileId && files.some((file) => file.id === openFileId)) return;
    setOpenFileId(files[0].id);
  }, [files, openFileId]);

  useEffect(() => {
    if (!isAdvanced) return;
    if (openFileId || files.length === 0) return;
    setOpenFileId(files[0].id);
  }, [files, isAdvanced, openFileId]);

  return (
    <div className="card-enterprise mt-3">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div className="fw-semibold">Translation Plan</div>
            <div className="text-muted small">Assign assignees per file and language.</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <span className="text-muted small">Mode</span>
            <div className="btn-group btn-group-sm" role="group" aria-label="Translation plan mode">
              <button
                type="button"
                className={`btn btn-outline-secondary${mode === "simple" ? " active" : ""}`}
                onClick={() => onModeChange("simple")}
                disabled={disabled}
              >
                Simple
              </button>
              <button
                type="button"
                className={`btn btn-outline-secondary${mode === "advanced" ? " active" : ""}`}
                onClick={() => onModeChange("advanced")}
                disabled={disabled}
              >
                Advanced
              </button>
            </div>
          </div>
        </div>

        {mode === "simple" && (
          <div className="alert alert-light border mt-3 mb-0">
            <div className="small text-muted">
              Simple mode applies project targets and the default assignee to all files. Switch to Advanced to customize per file or language.
            </div>
          </div>
        )}

        {showValidation && missingCount > 0 && (
          <IssuesPanel issues={["Assignee required for each language/task."]} tone="warning" className="mt-3" />
        )}

        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3">
          <div className="text-muted small">
            {fileCount} files - {resolvedTaskCount} tasks
          </div>
        </div>

        <div className="accordion mt-3" id="translation-plan-accordion">
          {files.map((file) => {
            const fileTargets = file.targetLangs || [];
            const fileLabel = `${fileTargets.length} target ${fileTargets.length === 1 ? "language" : "languages"} - ${fileTargets.length} tasks`;
            const bulkAssigneeValue = file.assigneeAll || defaultAssigneeId;
            const isOpen = openFileId === file.id;
            return (
              <div className="accordion-item" key={file.id}>
                <h2 className="accordion-header" id={`heading-${file.id}`}>
                  <button
                    className={`accordion-button${isOpen ? "" : " collapsed"}`}
                    type="button"
                    onClick={() => setOpenFileId(isOpen ? null : file.id)}
                    aria-expanded={isOpen}
                    aria-controls={`collapse-${file.id}`}
                  >
                    <div className="d-flex flex-column">
                      <span className="fw-semibold">{file.name}</span>
                      <span className="text-muted small">
                        {file.sizeBytes.toLocaleString()} bytes - {fileLabel}
                      </span>
                    </div>
                  </button>
                </h2>
                <div
                  id={`collapse-${file.id}`}
                  className={`accordion-collapse collapse${isOpen ? " show" : ""}`}
                  aria-labelledby={`heading-${file.id}`}
                >
                  <div className="accordion-body">
                    {isAdvanced ? (
                      <div className="row g-3">
                        <div className="col-12">
                          <label className="form-label small text-uppercase text-muted">Target languages for this file</label>
                          <TargetLanguagesMultiSelect
                            value={fileTargets}
                            onChange={(targets) => onFileTargetsChange(file.id, targets)}
                            sourceLang={sourceLang}
                            allowedTargets={projectTargets}
                            disabled={isReadOnly}
                          />
                        </div>
                        <div className="col-12">
                          <div className="d-flex flex-wrap gap-2 align-items-center">
                            <span className="text-muted small">Apply assignee to all languages</span>
                            <UserSelect
                              users={users}
                              departmentId={departmentId}
                              value={bulkAssigneeValue}
                              onChange={(value) => onFileAssigneeAllChange(file.id, value)}
                              includeEmpty
                              emptyLabel="Select assignee..."
                              allowAdmins={allowAdmins}
                              disabled={isReadOnly}
                              className="form-select form-select-sm"
                            />
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => onBulkFileAssignee(file.id, bulkAssigneeValue)}
                              disabled={isReadOnly || !bulkAssigneeValue}
                            >
                              Apply
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm ms-auto"
                              onClick={() => onResetFileDefaults(file.id)}
                              disabled={isReadOnly}
                            >
                              Reset to project defaults
                            </button>
                          </div>
                        </div>
                        <div className="col-12">
                          {fileTargets.length === 0 ? (
                            <div className="text-muted small">No target languages selected for this file.</div>
                          ) : (
                            <div className="d-flex flex-column gap-2">
                              {fileTargets.map((targetLang) => {
                                const assignment = file.assignments[targetLang] || { assigneeId: "" };
                                const resolvedAssignee = assignment.assigneeId;
                                const meta = optionsByTag.get(targetLang);
                                const missingKey = `${file.id}:${normalizeLangKey(targetLang)}`;
                                const isMissing = Boolean(missingAssignments && missingAssignments.has(missingKey));
                                return (
                                  <div
                                    key={targetLang}
                                    className={`border rounded p-2${isMissing ? " border-danger" : ""}`}
                                  >
                                    <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                      <div className="d-flex align-items-center gap-2">
                                        {meta?.flag ? (
                                          <span className={`flag-icon fi fi-${meta.flag}`} aria-hidden="true" />
                                        ) : (
                                          <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
                                        )}
                                        <span className="fw-semibold small">{meta?.label || targetLang}</span>
                                      </div>
                                      <div className="d-flex align-items-center gap-2">
                                        <span className="text-muted small">Assignee</span>
                                        <UserSelect
                                          users={users}
                                          departmentId={departmentId}
                                          value={resolvedAssignee}
                                          onChange={(value) =>
                                            onAssignmentChange(file.id, targetLang, { assigneeId: value })
                                          }
                                          includeEmpty
                                          emptyLabel="Select assignee..."
                                          allowAdmins={allowAdmins}
                                          disabled={isReadOnly}
                                          className={`form-select form-select-sm${isMissing ? " is-invalid" : ""}`}
                                        />
                                      </div>
                                    </div>
                                    {isMissing ? (
                                      <div className="text-danger small mt-1">Assignee required.</div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted small">
                        Simple mode applies the project targets and default assignee to all files.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
