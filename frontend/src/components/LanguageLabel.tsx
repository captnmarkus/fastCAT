import React from "react";
import { normalizeLocale } from "../lib/i18n/locale";
import { getFlagIcon } from "../utils/languages";

type LangInfo = {
  code: string;
  name: string;
  country: string | null;
};

function normalizeLangCode(input: string) {
  return normalizeLocale(input).canonical;
}

export function languageInfo(code?: string | null): LangInfo | null {
  const normalized = normalizeLangCode(code ?? "");
  if (!normalized) return null;
  const locale = normalizeLocale(normalized);
  const baseTag = locale.language || normalized;
  let name = baseTag.toUpperCase();
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const value = display.of(baseTag);
    if (value) name = value;
  } catch {
    // ignore
  }

  return { code: normalized, name, country: getFlagIcon(normalized) };
}

function FlagIcon({ country, title }: { country: string | null; title?: string }) {
  if (!country) {
    return <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" title={title} />;
  }
  return (
    <span
      className={`flag-icon fi fi-${country} me-1`}
      aria-hidden="true"
      title={title}
    />
  );
}

export function LanguageLabel({
  code,
  className,
  showCode = false
}: {
  code: string | null | undefined;
  className?: string;
  showCode?: boolean;
}) {
  const info = languageInfo(code);
  if (!info) return <span className={className}>-</span>;
  return (
    <span className={className} title={info.name} style={{ whiteSpace: "nowrap" }}>
      <FlagIcon country={info.country} />
      {info.name}
      {showCode && <span className="text-muted"> ({info.code})</span>}
    </span>
  );
}

export function LanguagePairLabel({
  source,
  target,
  className,
  compact = false
}: {
  source: string | null | undefined;
  target: string | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  const src = languageInfo(source);
  const tgt = languageInfo(target);
  if (!src || !tgt) return <span className={className}>-</span>;
  return (
    <span
      className={className}
      title={`${src.name} -> ${tgt.name}`}
      style={{ whiteSpace: "nowrap" }}
    >
      <FlagIcon country={src.country} title={src.code} />
      {compact ? src.name : src.name}{" "}
      <i className="bi bi-arrow-right-short text-muted" aria-hidden="true" />{" "}
      <FlagIcon country={tgt.country} title={tgt.code} />
      {compact ? tgt.name : tgt.name}
    </span>
  );
}
