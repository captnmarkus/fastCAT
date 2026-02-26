import LanguageSelect from "../../../features/languages/LanguageSelect";
import TargetLanguagesMultiSelect from "../shared/components/TargetLanguagesMultiSelect";
import TranslationPlan from "../shared/components/TranslationPlan";
import UserSelect from "../shared/components/UserSelect";
import type { ProjectCreateWizard } from "./useProjectCreateWizard";
import InlineSelect from "../../../components/ui/InlineSelect";
import BadgePill from "../../../components/ui/BadgePill";

export default function Step1_BasicsAndFiles({ wizard }: { wizard: ProjectCreateWizard }) {
  const { state, ui, data, derived, flags, actions, refs, currentUser } = wizard;
  const usageOptions = [
    { value: "translatable", label: "Translatable" },
    { value: "reference", label: "Reference" }
  ];

  return (
    <>
      <div className="col-12">
        <label className="form-label small text-uppercase text-muted">Use Project Template (optional)</label>
        <div className="d-flex gap-2">
          <select
            className="form-select"
            value={state.basics.projectTemplateId}
            onChange={(e) => actions.setProjectTemplateId(e.target.value)}
            disabled={ui.creating || !flags.projectTemplatesLoaded || data.projectTemplates.length === 0}
          >
            <option value="">None</option>
            {data.projectTemplates.map((tpl) => (
              <option key={tpl.id} value={String(tpl.id)}>
                {tpl.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => derived.selectedProjectTemplate && actions.applyTemplateDefaults(derived.selectedProjectTemplate)}
            disabled={ui.creating || !derived.selectedProjectTemplate}
          >
            Reapply defaults
          </button>
        </div>
        {!flags.projectTemplatesLoaded ? (
          <div className="form-text text-muted">Loading project templates...</div>
        ) : data.projectTemplates.length === 0 ? (
          <div className="form-text text-muted">No project templates available (optional).</div>
        ) : derived.selectedProjectTemplate ? (
          <div className="form-text text-muted">
            {derived.selectedProjectTemplate.description
              ? derived.selectedProjectTemplate.description
              : `Languages: ${derived.selectedProjectTemplate.languages.src} -> ${derived.selectedProjectTemplate.languages.targets.join(", ")}`}
          </div>
        ) : (
          <div className="form-text text-muted">Template defaults apply automatically when selected.</div>
        )}
      </div>

      <div className="col-md-4">
        <label className="form-label small text-uppercase text-muted">Department</label>
        <select
          className={`form-select${derived.departmentInvalid ? " is-invalid" : ""}`}
          value={state.basics.departmentId}
          onChange={(e) => actions.setDepartmentId(e.target.value)}
          disabled={ui.creating || !flags.departmentsLoaded || !flags.isAdmin}
        >
          <option value="">Select department...</option>
          {derived.departmentOptions.map((dept) => (
            <option key={dept.id} value={String(dept.id)} disabled={dept.disabled}>
              {dept.name}
              {dept.disabled ? " (disabled)" : ""}
            </option>
          ))}
        </select>
        {!flags.departmentsLoaded ? (
          <div className="form-text text-muted">Loading departments...</div>
        ) : derived.departmentInvalid ? (
          <div className="invalid-feedback d-block">
            {derived.selectedDepartment?.disabled ? "Selected department is disabled." : "Department is required."}
          </div>
        ) : null}
      </div>

      <div className="col-md-4">
        <label className="form-label small text-uppercase text-muted">Project owner</label>
        {flags.isAdmin ? (
          <select
            className={`form-select${state.showValidation && !state.basics.projectOwnerId ? " is-invalid" : ""}`}
            value={state.basics.projectOwnerId}
            onChange={(e) => actions.setProjectOwnerId(e.target.value)}
            disabled={ui.creating}
          >
            <option value="">Select owner...</option>
            {derived.projectOwnerOptions.map((user) => (
              <option key={user.id} value={user.username}>
                {user.displayName || user.username}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="form-control"
            value={currentUser.displayName || currentUser.username || "You"}
            disabled
          />
        )}
        {state.showValidation && !state.basics.projectOwnerId ? (
          <div className="invalid-feedback d-block">Project owner is required.</div>
        ) : null}
      </div>

      <div className="col-md-4">
        <label className="form-label small text-uppercase text-muted">Due date</label>
        <div className="d-flex gap-2">
          <input
            type="date"
            className="form-control"
            value={state.basics.dueDate}
            onChange={(e) => actions.setDueDate(e.target.value)}
            disabled={ui.creating}
          />
          <input
            type="time"
            className="form-control"
            value={state.basics.dueTime}
            onChange={(e) => actions.setDueTime(e.target.value)}
            disabled={ui.creating || !state.basics.dueDate}
          />
        </div>
        <div className="form-text text-muted">Time is optional.</div>
      </div>

      <div className="col-12">
        <label className="form-label small text-uppercase text-muted">Title</label>
        <input
          className={`form-control${state.showValidation && !derived.trimmedName ? " is-invalid" : ""}${ui.nameAvailable === false ? " is-invalid" : ""}`}
          value={state.basics.name}
          onChange={(e) => actions.setName(e.target.value)}
          placeholder="Launch campaign"
          disabled={ui.creating}
        />
        {ui.nameChecking && derived.trimmedName && <div className="form-text text-muted">Checking title...</div>}
        {!ui.nameChecking && ui.nameAvailable === false && (
          <div className="invalid-feedback d-block">A project with this title already exists.</div>
        )}
        {!ui.nameChecking && ui.nameAvailable === null && ui.nameCheckError && (
          <div className="form-text text-warning">{ui.nameCheckError}</div>
        )}
      </div>

      <div className="col-12">
        <label className="form-label small text-uppercase text-muted">Description (optional)</label>
        <textarea
          className="form-control"
          rows={2}
          value={state.basics.description}
          onChange={(e) => actions.setDescription(e.target.value)}
          disabled={ui.creating}
        />
      </div>

      <div className="col-md-3">
        <label className="form-label small text-uppercase text-muted">Source</label>
        <LanguageSelect
          kind="source"
          value={state.languages.sourceLang}
          onChange={actions.setSrcLang}
          disabled={ui.creating}
          className={`form-select${state.showValidation && !state.languages.sourceLang ? " is-invalid" : ""}`}
        />
      </div>

      <div className="col-md-9">
        <label className="form-label small text-uppercase text-muted">Target languages</label>
        <TargetLanguagesMultiSelect
          value={state.languages.targetLangs}
          onChange={actions.handleProjectTargetsChange}
          sourceLang={state.languages.sourceLang}
          allowedTargets={derived.allowedProjectTargets}
          disabled={ui.creating || derived.availableTargets.length === 0}
        />
        {state.showValidation && state.languages.targetLangs.length === 0 ? (
          <div className="text-danger small mt-1">Select at least one target language.</div>
        ) : null}
      </div>

      <div className="col-12">
        <div className="card-enterprise">
          <div className="card-body">
            <div className="fw-semibold mb-2">Defaults</div>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label small text-uppercase text-muted">Default assignee for all tasks</label>
                {flags.canAssign ? (
                  <UserSelect
                    users={derived.translationPlanUsers}
                    departmentId={state.basics.departmentId}
                    value={state.assignments.defaultAssigneeId}
                    onChange={actions.setDefaultAssigneeId}
                    includeEmpty
                    emptyLabel="Select assignee..."
                    allowAdmins={flags.isAdmin}
                    disabled={ui.creating}
                  />
                ) : (
                  <input className="form-control" value="You" disabled />
                )}
                {state.showValidation && !state.assignments.defaultAssigneeId ? (
                  <div className="text-danger small mt-1">Assignee required.</div>
                ) : null}
              </div>
              <div className="col-md-6">
                <label className="form-label small text-uppercase text-muted">Behavior</label>
                {state.assignments.planMode === "simple" ? (
                  <>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="useSameAssignee"
                        checked={state.assignments.useSameAssignee}
                        onChange={(e) => actions.setUseSameAssignee(e.target.checked)}
                        disabled={ui.creating || flags.isReviewer}
                      />
                      <label className="form-check-label" htmlFor="useSameAssignee">
                        Use same assignee for all target languages
                      </label>
                    </div>
                    <div className="form-text text-muted">
                      {flags.isReviewer
                        ? "Reviewer projects are assigned to you only."
                        : "Assignees must belong to the project department."}
                    </div>
                  </>
                ) : (
                  <div className="form-text text-muted">Advanced mode uses per-language assignees inside each file.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="d-flex align-items-center justify-content-between gap-2">
          <label className="form-label small text-uppercase text-muted mb-0">Files</label>
          <div className="d-flex align-items-center gap-2">
            <input
              className="form-control form-control-sm"
              placeholder="Search files..."
              value={state.files.fileSearch}
              onChange={(e) => actions.setFileSearch(e.target.value)}
              style={{ width: 220 }}
              aria-label="Search files"
              disabled={ui.creating}
            />
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => refs.fileInputRef.current?.click()}
              disabled={ui.creating}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Add files
            </button>
            <input
              ref={refs.fileInputRef}
              type="file"
              multiple
              className="d-none"
              onChange={(e) => {
                actions.addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
              aria-label="Add project files"
            />
          </div>
        </div>

        {state.files.pending.length === 0 ? (
          <div className="text-muted small mt-2">No files added yet.</div>
        ) : (
          <div className="card-enterprise mt-2">
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0 fc-table-compact">
                <thead>
                  <tr>
                    <th style={{ width: "34%" }}>Name</th>
                    <th style={{ width: "18%" }}>Type</th>
                    <th style={{ width: "16%" }}>Usage</th>
                    <th style={{ width: "22%" }}>Configuration</th>
                    <th style={{ width: "10%" }}>Status</th>
                    <th style={{ width: 54 }} />
                  </tr>
                </thead>
                <tbody>
                  {derived.filteredPendingFiles.map((entry) => {
                    const ext = entry.file.name.split(".").pop() || "file";
                    const needsConfig = entry.fileType !== "other";
                    const options = needsConfig ? derived.fileTypeConfigsByType.get(entry.fileType) ?? [] : [];
                    const hasConfig = !needsConfig || Boolean(entry.fileTypeConfigId);
                    const configMissing = state.showValidation && needsConfig && (!hasConfig || options.length === 0);
                    const statusLabel =
                      entry.uploadState === "uploading"
                        ? "Uploading"
                        : entry.uploadState === "uploaded"
                          ? "Ready"
                          : entry.uploadState === "error"
                            ? "Error"
                            : !needsConfig
                              ? "Ready"
                              : options.length === 0
                                ? "Config missing"
                                : hasConfig
                                  ? "Ready"
                                  : "Config required";

                    return (
                      <tr key={entry.localId}>
                        <td>
                          <div className="fw-semibold">{entry.file.name}</div>
                          <div className="text-muted small">
                            {entry.file.size.toLocaleString()} bytes
                            {entry.createdSegments != null ? ` | ${entry.createdSegments} segments` : ""}
                          </div>
                        </td>
                        <td className="text-muted small">{ext.toLowerCase()}</td>
                        <td>
                          <InlineSelect
                            value={entry.usage}
                            onChange={(value) =>
                              actions.updatePendingFile(entry.localId, {
                                usage: value === "reference" ? "reference" : "translatable"
                              })
                            }
                            options={usageOptions}
                            placeholder="Usage"
                            disabled={ui.creating || entry.uploadState === "uploading"}
                            ariaLabel={`Usage for ${entry.file.name}`}
                          />
                        </td>
                        <td>
                          {needsConfig ? (
                            <>
                              <InlineSelect
                                value={entry.fileTypeConfigId}
                                onChange={(value) => actions.updatePendingFile(entry.localId, { fileTypeConfigId: value })}
                                options={options.map((cfg) => ({
                                  value: String(cfg.id),
                                  label: cfg.name
                                }))}
                                placeholder="Select configuration..."
                                disabled={ui.creating || entry.uploadState === "uploading" || options.length === 0}
                                invalid={configMissing}
                                ariaLabel={`Configuration for ${entry.file.name}`}
                              />
                              {options.length === 0 ? (
                                <div className="text-danger small mt-1 d-flex align-items-center justify-content-between gap-2">
                                  <span>{derived.missingFileTypeConfigMessage}</span>
                                  <button
                                    type="button"
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={() => actions.openFileTypeConfig(entry.fileType)}
                                    disabled={ui.creating}
                                  >
                                    Create
                                  </button>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted small">-</span>
                          )}
                          {entry.uploadState === "error" && entry.uploadError ? (
                            <div className="text-danger small mt-1">{entry.uploadError}</div>
                          ) : null}
                        </td>
                        <td>
                          {entry.uploadState === "uploading" ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <span className="spinner-border spinner-border-sm" />
                              <BadgePill tone="info">Uploading</BadgePill>
                            </span>
                          ) : entry.uploadState === "error" ? (
                            <BadgePill tone="danger" className="text-uppercase" title={entry.uploadError || undefined}>
                              Error
                            </BadgePill>
                          ) : (
                            <BadgePill tone={statusLabel === "Config required" ? "warning" : "ready"}>{statusLabel}</BadgePill>
                          )}
                        </td>
                        <td className="text-end">
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => actions.removePendingFile(entry.localId)}
                            disabled={ui.creating || entry.uploadState === "uploading"}
                            aria-label={`Remove ${entry.file.name}`}
                            title="Remove"
                          >
                            <i className="bi bi-x-lg" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {derived.translationPlanFiles.length > 0 ? (
        <div className="col-12">
          <TranslationPlan
            mode={state.assignments.planMode}
            sourceLang={state.languages.sourceLang}
            projectTargets={state.languages.targetLangs}
            files={derived.translationPlanFiles}
            users={derived.translationPlanUsers}
            departmentId={state.basics.departmentId}
            defaultAssigneeId={state.assignments.defaultAssigneeId}
            taskCount={derived.translationTasks.length}
            showValidation={state.showValidation}
            missingAssignments={derived.missingAssignments}
            allowAdmins={flags.isAdmin}
            onModeChange={actions.setTranslationPlanMode}
            onFileTargetsChange={actions.handleFileTargetsChange}
            onAssignmentChange={actions.handleAssignmentChange}
            onCopyDefaults={actions.handleCopyDefaults}
            onFileAssigneeAllChange={actions.handleFileAssigneeAllChange}
            onBulkFileAssignee={actions.applyAssigneeToFile}
            onResetFileDefaults={actions.resetFileDefaults}
            disabled={ui.creating || flags.isReviewer}
          />
        </div>
      ) : null}
    </>
  );
}
