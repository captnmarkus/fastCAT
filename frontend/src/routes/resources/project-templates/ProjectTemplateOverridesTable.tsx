import React from "react";
import type { GlossaryOption, LanguageProcessingRuleset, SampleAsset } from "../../../api";
import { normalizeTargetKey } from "./ProjectTemplateWizard.helpers";

type TargetMeta = { label: string; flag?: string };

type Props = {
  targetLangs: string[];
  targetMetaByTag: Map<string, TargetMeta>;
  tmxByTargetLang: Record<string, number | null>;
  rulesetByTargetLang: Record<string, number | null>;
  glossaryByTargetLang: Record<string, number | null>;
  tmSampleById: Map<number, SampleAsset>;
  rulesetById: Map<number, LanguageProcessingRuleset>;
  glossaryById: Map<number, GlossaryOption>;
};

export default function ProjectTemplateOverridesTable(props: Props) {
  const {
    targetLangs,
    targetMetaByTag,
    tmxByTargetLang,
    rulesetByTargetLang,
    glossaryByTargetLang,
    tmSampleById,
    rulesetById,
    glossaryById
  } = props;

  const overrideTargets = targetLangs.filter((target) => {
    const key = normalizeTargetKey(target) || target;
    return (
      Object.prototype.hasOwnProperty.call(tmxByTargetLang, key) ||
      Object.prototype.hasOwnProperty.call(rulesetByTargetLang, key) ||
      Object.prototype.hasOwnProperty.call(glossaryByTargetLang, key)
    );
  });

  if (overrideTargets.length === 0) {
    return <div className="text-muted small">No per-target overrides.</div>;
  }

  return (
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
            const key = normalizeTargetKey(target) || target;
            const meta = targetMetaByTag.get(key) ?? targetMetaByTag.get(target);
            const tmxOverride = Object.prototype.hasOwnProperty.call(tmxByTargetLang, key)
              ? tmxByTargetLang[key]
              : undefined;
            const rulesOverride = Object.prototype.hasOwnProperty.call(rulesetByTargetLang, key)
              ? rulesetByTargetLang[key]
              : undefined;
            const glossaryOverride = Object.prototype.hasOwnProperty.call(glossaryByTargetLang, key)
              ? glossaryByTargetLang[key]
              : undefined;
            const tmxLabel =
              tmxOverride === undefined
                ? "Inherit"
                : tmxOverride == null
                  ? "None"
                  : tmSampleById.get(tmxOverride)?.label || `TMX #${tmxOverride}`;
            const rulesLabel =
              rulesOverride === undefined
                ? "Inherit"
                : rulesOverride == null
                  ? "None"
                  : rulesetById.get(rulesOverride)?.name || `Ruleset #${rulesOverride}`;
            const glossaryLabel =
              glossaryOverride === undefined
                ? "Inherit"
                : glossaryOverride == null
                  ? "None"
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
                    {meta?.label || key}
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
  );
}
