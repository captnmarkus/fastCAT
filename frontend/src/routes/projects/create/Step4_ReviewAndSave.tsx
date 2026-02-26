import type { ProjectCreateWizard } from "./useProjectCreateWizard";
import BadgePill from "../../../components/ui/BadgePill";

export default function Step4_ReviewAndSave({ wizard }: { wizard: ProjectCreateWizard }) {
  const { state, data, derived } = wizard;

  return (
    <>
      <div className="col-12">
        <div className="fw-semibold mb-2">Review</div>
        <div className="text-muted small">Confirm details before saving.</div>
      </div>

      <div className="col-md-4">
        <div className="text-muted small">Department</div>
        <div className="fw-semibold">{derived.selectedDepartment?.name || state.basics.departmentId || "-"}</div>
      </div>
      <div className="col-md-4">
        <div className="text-muted small">Project owner</div>
        <div className="fw-semibold">{derived.projectOwnerLabel || "-"}</div>
      </div>
      <div className="col-md-4">
        <div className="text-muted small">Due date</div>
        <div className="fw-semibold">{derived.dueAtDisplay || "-"}</div>
      </div>
      <div className="col-12">
        <div className="text-muted small">Title</div>
        <div className="fw-semibold">{derived.trimmedName || "-"}</div>
      </div>
      <div className="col-12">
        <div className="text-muted small">Description</div>
        <div className="small">
          {state.basics.description.trim() || <span className="text-muted">-</span>}
        </div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">Languages</div>
        <div className="fw-semibold">
          {state.languages.sourceLang && state.languages.targetLangs.length > 0
            ? `${state.languages.sourceLang} -> ${state.languages.targetLangs.join(", ")}`
            : "-"}
        </div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">Tasks</div>
        <div className="fw-semibold">{derived.translationTasks.length} tasks</div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">Project template</div>
        <div className="fw-semibold">{derived.selectedProjectTemplate ? derived.selectedProjectTemplate.name : "None"}</div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">TMX seeding</div>
        <div className="fw-semibold">
          <BadgePill tone={state.tmx.enabled ? "ready" : "draft"}>{state.tmx.enabled ? "Enabled" : "Disabled"}</BadgePill>
        </div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">Translation engine</div>
        <div className="fw-semibold">{derived.engineSummaryLabel || "None"}</div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">Rules</div>
        <div className="fw-semibold">{derived.rulesetSummaryLabel || "None"}</div>
      </div>
      <div className="col-md-6">
        <div className="text-muted small">Glossary</div>
        <div className="fw-semibold">{derived.glossarySummaryLabel || "None"}</div>
      </div>
      {state.tmx.enabled && (
        <div className="col-12">
          <div className="text-muted small mb-2">TMX per target</div>
          {state.languages.targetLangs.length === 0 ? (
            <div className="text-muted small">No target languages selected.</div>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              {state.languages.targetLangs.map((target) => {
                const tmxId = derived.resolvedTmxByTarget[target] ?? null;
                const sample = tmxId != null ? derived.tmSampleById.get(tmxId) ?? null : null;
                const meta = derived.targetMetaByTag.get(target);
                return (
                  <BadgePill key={target}>
                    {meta?.label || target}: {sample?.label || "None"}
                  </BadgePill>
                );
              })}
            </div>
          )}
        </div>
      )}

      {derived.hasRulesetTargetOverrides && (
        <div className="col-12">
          <div className="text-muted small mb-2">Rules per target</div>
          {state.languages.targetLangs.length === 0 ? (
            <div className="text-muted small">No target languages selected.</div>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              {state.languages.targetLangs.map((target) => {
                const rulesetId = derived.resolvedRulesetByTarget[target] ?? null;
                const ruleset = rulesetId != null ? data.rulesets.find((r) => r.id === rulesetId) ?? null : null;
                const meta = derived.targetMetaByTag.get(target);
                return (
                  <BadgePill key={target}>
                    {meta?.label || target}: {ruleset?.name || "None"}
                  </BadgePill>
                );
              })}
            </div>
          )}
        </div>
      )}

      {derived.hasGlossaryTargetOverrides && (
        <div className="col-12">
          <div className="text-muted small mb-2">Termbase per target</div>
          {state.languages.targetLangs.length === 0 ? (
            <div className="text-muted small">No target languages selected.</div>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              {state.languages.targetLangs.map((target) => {
                const glossaryId = derived.resolvedGlossaryByTarget[target] ?? null;
                const glossary =
                  glossaryId != null ? data.glossaries.find((g) => g.id === glossaryId) ?? null : null;
                const meta = derived.targetMetaByTag.get(target);
                return (
                  <BadgePill key={target}>
                    {meta?.label || target}: {glossary?.label || "None"}
                  </BadgePill>
                );
              })}
            </div>
          )}
        </div>
      )}

      {state.engine.mtSeedingEnabled && derived.translationTasks.length > 0 && (
        <div className="col-12">
          <div className="text-muted small mb-2">Engine resolution</div>
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Target</th>
                  <th>Engine</th>
                </tr>
              </thead>
              <tbody>
                {derived.translationTasks.map((task) => {
                  const file = state.files.pending.find((entry) => entry.localId === task.fileLocalId);
                  const engine = task.engineId != null ? data.translationEngines.find((e) => e.id === task.engineId) : null;
                  const meta = derived.targetMetaByTag.get(task.targetLang);
                  return (
                    <tr key={`${task.fileLocalId}:${task.targetLang}`}>
                      <td className="fw-semibold">{file?.file.name || task.fileName}</td>
                      <td className="text-muted small">{meta?.label || task.targetLang}</td>
                      <td className="text-muted small">{engine?.name || "None"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="col-12">
        <div className="text-muted small mb-2">Files</div>
        {state.files.pending.length === 0 ? (
          <div className="text-muted small">No files added.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Targets</th>
                  <th>Assignees</th>
                  <th>Configuration</th>
                </tr>
              </thead>
              <tbody>
                {state.files.pending.map((entry) => {
                  const ext = entry.file.name.split(".").pop() || "file";
                  const needsConfig = entry.fileType !== "other";
                  const options = needsConfig ? derived.fileTypeConfigsByType.get(entry.fileType) ?? [] : [];
                  const cfg =
                    needsConfig && entry.fileTypeConfigId
                      ? options.find((c) => String(c.id) === entry.fileTypeConfigId) ?? null
                      : null;
                  const fileTargets =
                    entry.usage === "translatable"
                      ? state.assignments.planMode === "simple"
                        ? state.languages.targetLangs
                        : entry.translationTargets
                      : [];
                  const taskSummary = derived.taskSummaryByFile.get(entry.localId) ?? [];
                  return (
                    <tr key={entry.localId}>
                      <td className="fw-semibold">{entry.file.name}</td>
                      <td className="text-muted small">{ext.toLowerCase()}</td>
                      <td className="text-muted small">
                        {fileTargets.length > 0 ? fileTargets.join(", ") : "-"}
                      </td>
                      <td className="text-muted small">
                        {taskSummary.length > 0
                          ? taskSummary
                              .map((task) => {
                                const meta = derived.targetMetaByTag.get(task.targetLang);
                                const label = meta?.label || task.targetLang;
                                return `${label}: ${task.assigneeLabel}`;
                              })
                              .join(", ")
                          : "-"}
                      </td>
                      <td className="text-muted small">{needsConfig ? cfg?.name || "-" : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
