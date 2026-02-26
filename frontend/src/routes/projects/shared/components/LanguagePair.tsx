import React from "react";
import { languageInfo } from "../../../../components/LanguageLabel";

type Props = {
  srcLang: string;
  tgtLang?: string;
  targetLangs?: string[];
};

export default function LanguagePair({ srcLang, tgtLang, targetLangs }: Props) {
  const normalizedTargets = Array.isArray(targetLangs)
    ? targetLangs.filter(Boolean)
    : tgtLang
      ? [tgtLang]
      : [];
  const srcInfo = languageInfo(srcLang);
  const srcFlag = srcInfo?.country;
  const srcLabel = srcInfo?.name || String(srcLang).toUpperCase();

  const primaryTarget = normalizedTargets[0] || tgtLang || "";
  const tgtInfo = primaryTarget ? languageInfo(primaryTarget) : null;
  const tgtFlag = tgtInfo?.country;
  const extraCount = Math.max(0, normalizedTargets.length - 1);
  const targetLabels = normalizedTargets.map((lang) => languageInfo(lang)?.name || String(lang).toUpperCase());
  const fullTargetLabel = targetLabels.join(", ");
  const targetLabel =
    normalizedTargets.length > 1
      ? `${tgtInfo?.name || String(primaryTarget).toUpperCase()} +${extraCount}`
      : tgtInfo?.name || String(primaryTarget || "").toUpperCase();
  const title = fullTargetLabel ? `${srcLabel} -> ${fullTargetLabel}` : srcLabel;

  return (
    <div className="d-flex align-items-center gap-2" title={title}>
      {srcFlag ? (
        <span className={`flag-icon fi fi-${srcFlag}`} aria-hidden="true" />
      ) : (
        <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
      )}
      <span className="small text-muted">{srcLabel}</span>
      <i className="bi bi-arrow-right text-muted small" aria-hidden="true" />
      {tgtFlag ? (
        <span className={`flag-icon fi fi-${tgtFlag}`} aria-hidden="true" />
      ) : (
        <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
      )}
      <span className="small text-muted">{targetLabel}</span>
    </div>
  );
}
