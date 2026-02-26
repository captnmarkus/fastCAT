import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  copyProjectTemplate,
  deleteProjectTemplate,
  getProjectTemplate,
  listEnabledFileTypeConfigs,
  listGlossaries,
  listLanguageProcessingRulesets,
  listTmSamples,
  listTranslationEngines,
  type FileTypeConfig,
  type GlossaryOption,
  type LanguageProcessingRuleset,
  type ProjectTemplate,
  type SampleAsset,
  type TranslationEngine
} from "../../../api";
import { LanguagePairLabel } from "../../../components/LanguageLabel";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../features/languages/utils";
import { useLanguages } from "../../../features/languages/hooks";
import { normalizeLocale } from "../../../lib/i18n/locale";
import { formatDateTime } from "../../../utils/format";

function statusBadge(disabled: boolean) {
  return disabled ? "text-bg-secondary" : "text-bg-success";
}

function normalizeTargetKey(value: string) {
  return normalizeLocale(String(value || "")).canonical;
}

function normalizeTargetList(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const key = normalizeTargetKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

function normalizeOverrideMap(raw: Record<string, number | null> | undefined, targets: string[]) {
  const allowed = new Set(targets);
  const next: Record<string, number | null> = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    const target = normalizeTargetKey(key);
    if (!target || !allowed.has(target)) return;
    if (value == null) {
      next[target] = null;
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    next[target] = parsed;
  });
  return next;
}

export default function ProjectTemplateDetailsPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const params = useParams();
  const templateId = Number(params.id);

  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tmSamples, setTmSamples] = useState<SampleAsset[]>([]);
  const [glossaries, setGlossaries] = useState<GlossaryOption[]>([]);
  const [rulesets, setRulesets] = useState<LanguageProcessingRuleset[]>([]);
  const [translationEngines, setTranslationEngines] = useState<TranslationEngine[]>([]);
  const [fileTypeConfigs, setFileTypeConfigs] = useState<FileTypeConfig[]>([]);

  const { activeSourceLanguages, activeTargetLanguages } = useLanguages();
  const languageMetaByTag = useMemo(() => {
    const map = new Map<string, { label: string; flag?: string }>();
    [...activeSourceLanguages, ...activeTargetLanguages].forEach((entry) => {
      map.set(entry.canonical, {
        label: formatLanguageEntryLabel(entry),
        flag: languageFlagTag(entry)
      });
    });
    return map;
  }, [activeSourceLanguages, activeTargetLanguages]);

  useEffect(() => {
    let cancelled = false;
    if (!Number.isFinite(templateId) || templateId <= 0) {
      setError("Invalid template id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [
          templateRes,
          tmList,
          glossaryList,
          rulesetList,
          engineList,
          fileTypeList
        ] = await Promise.all([
          getProjectTemplate(templateId),
          listTmSamples().catch(() => [] as SampleAsset[]),
          listGlossaries().catch(() => [] as GlossaryOption[]),
          listLanguageProcessingRulesets().catch(() => [] as LanguageProcessingRuleset[]),
          listTranslationEngines().catch(() => [] as TranslationEngine[]),
          listEnabledFileTypeConfigs().catch(() => [] as FileTypeConfig[])
        ]);
        if (cancelled) return;
        setTemplate(templateRes);
        setTmSamples(tmList);
        setGlossaries(glossaryList);
        setRulesets(rulesetList);
        setTranslationEngines(engineList);
        setFileTypeConfigs(fileTypeList);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.userMessage || err?.message || "Failed to load project template.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const tmSampleById = useMemo(() => {
    const map = new Map<number, SampleAsset>();
    tmSamples.forEach((sample) => {
      if (sample.tmId != null && Number.isFinite(sample.tmId)) {
        map.set(Number(sample.tmId), sample);
      }
    });
    return map;
  }, [tmSamples]);

  const rulesetById = useMemo(() => new Map(rulesets.map((entry) => [entry.id, entry])), [rulesets]);
  const glossaryById = useMemo(() => new Map(glossaries.map((entry) => [entry.id, entry])), [glossaries]);
  const engineById = useMemo(() => new Map(translationEngines.map((entry) => [entry.id, entry])), [translationEngines]);
  const fileTypeById = useMemo(() => new Map(fileTypeConfigs.map((entry) => [entry.id, entry])), [fileTypeConfigs]);

  const languageData = useMemo(() => {
    if (!template) return null;
    const src = normalizeTargetKey(template.languages?.src || "");
    const targets = normalizeTargetList(template.languages?.targets || []);
    const summaryTarget = targets[0] || "";
    return { source: src, targets, summaryTarget };
  }, [template]);

  const overrides = useMemo(() => {
    if (!template || !languageData) {
      return { tmx: {}, rules: {}, glossary: {} };
    }
    return {
      tmx: normalizeOverrideMap(template.tmxByTargetLang || {}, languageData.targets),
      rules: normalizeOverrideMap(template.rulesetByTargetLang || {}, languageData.targets),
      glossary: normalizeOverrideMap(template.glossaryByTargetLang || {}, languageData.targets)
    };
  }, [languageData, template]);

  if (loading) {
    return <div className="text-muted p-3">Loading project template...</div>;
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-danger mb-0">{error}</div>
      </div>
    );
  }

  if (!template || !languageData) {
    return (
      <div className="p-3">
        <div className="alert alert-warning mb-0">Project template not found.</div>
      </div>
    );
  }

  const sourceMeta = languageMetaByTag.get(languageData.source);
  const targetCount = languageData.targets.length;
  const languageSummary = languageData.source && languageData.summaryTarget
    ? { source: languageData.source, target: languageData.summaryTarget, extra: Math.max(0, targetCount - 1) }
    : null;

  const defaultEngineLabel =
    (template.translationEngineId != null && engineById.get(template.translationEngineId)?.name) ||
    template.translationEngineName ||
    "None";
  const defaultTmxLabel =
    template.defaultTmxId != null
      ? tmSampleById.get(template.defaultTmxId)?.label || `TMX #${template.defaultTmxId}`
      : "None";
  const defaultRulesLabel =
    template.defaultRulesetId != null
      ? rulesetById.get(template.defaultRulesetId)?.name || `Ruleset #${template.defaultRulesetId}`
      : "None";
  const defaultGlossaryLabel =
    template.defaultGlossaryId != null
      ? glossaryById.get(template.defaultGlossaryId)?.label || `Termbase #${template.defaultGlossaryId}`
      : "None";
  const fileTypeLabel =
    template.fileTypeConfigId != null
      ? fileTypeById.get(template.fileTypeConfigId)?.name || template.fileTypeConfigName || `Config #${template.fileTypeConfigId}`
      : "None";

  const overrideTargets = languageData.targets.filter((target) => {
    return (
      Object.prototype.hasOwnProperty.call(overrides.tmx, target) ||
      Object.prototype.hasOwnProperty.call(overrides.rules, target) ||
      Object.prototype.hasOwnProperty.call(overrides.glossary, target)
    );
  });

  async function handleDelete() {
    const confirmed = window.confirm(`Delete project template "${template.name}"?`);
    if (!confirmed) return;
    try {
      await deleteProjectTemplate(template.id);
      nav("/resources/templates");
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to delete project template.");
    }
  }

  async function handleDuplicate() {
    try {
      const copied = await copyProjectTemplate(template.id);
      nav(`/resources/templates/${copied.id}`);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to duplicate project template.");
    }
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="card-enterprise p-3">
        <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/resources/templates")}>
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            Back to templates
          </button>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => nav(`/resources/templates/${template.id}/edit`)}
            >
              <i className="bi bi-pencil me-1" aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleDuplicate}>
              <i className="bi bi-files me-1" aria-hidden="true" />
              Duplicate
            </button>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={handleDelete}>
              <i className="bi bi-trash me-1" aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap mt-3">
          <h2 className="mb-0">{template.name}</h2>
          <span className={`badge ${statusBadge(Boolean(template.disabled))}`}>
            {template.disabled ? "Disabled" : "Enabled"}
          </span>
        </div>
        <div className="text-muted small mt-1">Last modified {formatDateTime(template.updatedAt) || "-"}</div>
      </div>

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card-enterprise p-3">
            <div className="fw-semibold mb-2">Template details</div>
            <dl className="fc-project-drawer-dl">
              <dt>Name</dt>
              <dd>{template.name}</dd>
              <dt>Description</dt>
              <dd>{template.description || "-"}</dd>
              <dt>Scope / Location</dt>
              <dd>{template.scope || "-"}</dd>
              <dt>Status</dt>
              <dd>{template.disabled ? "Disabled" : "Enabled"}</dd>
              <dt>Created at</dt>
              <dd>{formatDateTime(template.createdAt) || "-"}</dd>
              <dt>Created by</dt>
              <dd>{template.createdBy || "-"}</dd>
              <dt>Last modified</dt>
              <dd>{formatDateTime(template.updatedAt) || "-"}</dd>
              <dt>Updated by</dt>
              <dd>{template.updatedBy || "-"}</dd>
            </dl>
          </div>

          <div className="card-enterprise p-3 mt-3">
            <div className="fw-semibold mb-2">Languages</div>
            <div className="text-muted small">Source language</div>
            <div className="d-flex align-items-center gap-2 mb-2">
              <span className="badge text-bg-light text-dark">
                {sourceMeta?.flag ? (
                  <span className={`flag-icon fi fi-${sourceMeta.flag} me-1`} aria-hidden="true" />
                ) : (
                  <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                )}
                {sourceMeta?.label || languageData.source || "-"}
              </span>
            </div>
            <div className="text-muted small">Target languages ({targetCount})</div>
            {languageSummary ? (
              <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                <LanguagePairLabel source={languageSummary.source} target={languageSummary.target} />
                {languageSummary.extra > 0 && <span className="text-muted small">+{languageSummary.extra}</span>}
              </div>
            ) : null}
            <div className="d-flex flex-wrap gap-2 mt-2">
              {languageData.targets.length === 0 ? (
                <span className="text-muted small">No target languages configured.</span>
              ) : (
                languageData.targets.map((target) => {
                  const meta = languageMetaByTag.get(target);
                  return (
                    <span key={target} className="badge text-bg-light text-dark">
                      {meta?.flag ? (
                        <span className={`flag-icon fi fi-${meta.flag} me-1`} aria-hidden="true" />
                      ) : (
                        <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                      )}
                      {meta?.label || target}
                    </span>
                  );
                })
              )}
            </div>
          </div>

          <div className="card-enterprise p-3 mt-3">
            <div className="fw-semibold mb-2">Defaults</div>
            <dl className="fc-project-drawer-dl">
              <dt>Translation engine</dt>
              <dd>{defaultEngineLabel}</dd>
              <dt>TMX</dt>
              <dd>{defaultTmxLabel}</dd>
              <dt>Ruleset</dt>
              <dd>{defaultRulesLabel}</dd>
              <dt>Termbase</dt>
              <dd>{defaultGlossaryLabel}</dd>
              <dt>File type configuration</dt>
              <dd>{fileTypeLabel}</dd>
            </dl>

            <div className="fw-semibold mt-3">Overrides</div>
            {overrideTargets.length === 0 ? (
              <div className="text-muted small">No per-target overrides configured.</div>
            ) : (
              <div className="table-responsive mt-2">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr className="text-muted small">
                      <th style={{ width: "28%" }}>Target language</th>
                      <th style={{ width: "24%" }}>TMX</th>
                      <th style={{ width: "24%" }}>Rules</th>
                      <th style={{ width: "24%" }}>Termbase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrideTargets.map((target) => {
                      const meta = languageMetaByTag.get(target);
                      const tmxOverride = Object.prototype.hasOwnProperty.call(overrides.tmx, target)
                        ? overrides.tmx[target]
                        : undefined;
                      const rulesOverride = Object.prototype.hasOwnProperty.call(overrides.rules, target)
                        ? overrides.rules[target]
                        : undefined;
                      const glossaryOverride = Object.prototype.hasOwnProperty.call(overrides.glossary, target)
                        ? overrides.glossary[target]
                        : undefined;
                      const tmxLabel =
                        tmxOverride == null
                          ? tmxOverride === null
                            ? "None"
                            : "Inherit"
                          : tmSampleById.get(tmxOverride)?.label || `TMX #${tmxOverride}`;
                      const rulesLabel =
                        rulesOverride == null
                          ? rulesOverride === null
                            ? "None"
                            : "Inherit"
                          : rulesetById.get(rulesOverride)?.name || `Ruleset #${rulesOverride}`;
                      const glossaryLabel =
                        glossaryOverride == null
                          ? glossaryOverride === null
                            ? "None"
                            : "Inherit"
                          : glossaryById.get(glossaryOverride)?.label || `Termbase #${glossaryOverride}`;
                      return (
                        <tr key={target}>
                          <td>
                            <span className="badge text-bg-light text-dark">
                              {meta?.flag ? (
                                <span className={`flag-icon fi fi-${meta.flag} me-1`} aria-hidden="true" />
                              ) : (
                                <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                              )}
                              {meta?.label || target}
                            </span>
                          </td>
                          <td>{tmxLabel}</td>
                          <td>{rulesLabel}</td>
                          <td>{glossaryLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-enterprise p-3 mt-3">
            <div className="fw-semibold mb-2">Permissions & policy</div>
            <ul className="list-unstyled small mb-0">
              <li>Source editing: {template.settings?.canEditSource ? "Allowed" : "Not allowed"}</li>
              <li>Download source files: {template.settings?.canDownloadSource ? "Allowed" : "Not allowed"}</li>
              <li>Download translated output: {template.settings?.canDownloadTranslated ? "Allowed" : "Not allowed"}</li>
              <li>Export intermediate formats: {template.settings?.canExportIntermediate ? "Allowed" : "Not allowed"}</li>
              <li>Auto-create inbox items: {template.settings?.autoCreateInboxItems ? "Enabled" : "Disabled"}</li>
              <li>
                Completion policy: {template.settings?.completionPolicy === "reviewer" ? "Reviewer/admin only" : "Assignee can mark complete"}
              </li>
            </ul>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card-enterprise p-3 h-100">
            <div className="fw-semibold mb-2">Used by projects</div>
            <div className="text-muted small">Usage insights will appear here in a future update.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
