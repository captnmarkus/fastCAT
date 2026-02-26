import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLanguages } from "../../../../features/languages/hooks";
import type { LanguageEntry } from "../../../../features/languages/types";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../../features/languages/utils";
import { normalizeLocale } from "../../../../lib/i18n/locale";

export type TargetLanguagesMultiSelectProps = {
  value: string[];
  onChange: (next: string[]) => void;
  sourceLang?: string;
  disabled?: boolean;
  allowedTargets?: string[];
  className?: string;
};

function sortByLabel(a: LanguageEntry, b: LanguageEntry) {
  return formatLanguageEntryLabel(a).localeCompare(formatLanguageEntryLabel(b));
}

function normalizeTarget(value: string) {
  return normalizeLocale(String(value || "")).canonical;
}

export default function TargetLanguagesMultiSelect(props: TargetLanguagesMultiSelectProps) {
  const { value, onChange, sourceLang, disabled, allowedTargets, className } = props;
  const { activeTargetLanguages, loading } = useLanguages();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const sourceCanonical = sourceLang ? normalizeTarget(sourceLang) : "";
  const allowedSet = useMemo(() => {
    if (!allowedTargets || allowedTargets.length === 0) return null;
    return new Set(allowedTargets.map(normalizeTarget).filter(Boolean));
  }, [allowedTargets]);

  const options = useMemo(() => {
    const list = activeTargetLanguages.filter((entry) => !allowedSet || allowedSet.has(entry.canonical));
    return list.slice().sort(sortByLabel);
  }, [activeTargetLanguages, allowedSet]);

  const normalizedValue = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of value) {
      const canonical = normalizeTarget(raw);
      if (!canonical || seen.has(canonical)) continue;
      if (canonical === sourceCanonical) continue;
      if (allowedSet && !allowedSet.has(canonical)) continue;
      seen.add(canonical);
      out.push(canonical);
    }
    return out;
  }, [allowedSet, sourceCanonical, value]);

  useEffect(() => {
    if (normalizedValue.join("|") === value.join("|")) return;
    onChange(normalizedValue);
  }, [normalizedValue, onChange, value]);

  const optionByCanonical = useMemo(() => {
    const map = new Map<string, LanguageEntry>();
    options.forEach((entry) => map.set(entry.canonical, entry));
    return map;
  }, [options]);

  const selectedOptions = normalizedValue.map((lang) => {
    const entry = optionByCanonical.get(lang) ?? null;
    return {
      canonical: lang,
      label: entry ? formatLanguageEntryLabel(entry) : lang,
      flag: entry ? languageFlagTag(entry) : undefined
    };
  });

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = options.filter((entry) => !normalizedValue.includes(entry.canonical));
    if (sourceCanonical) {
      list = list.filter((entry) => entry.canonical !== sourceCanonical);
    }
    if (!q) return list.slice(0, 50);
    return list
      .filter((entry) => {
        const label = formatLanguageEntryLabel(entry).toLowerCase();
        return label.includes(q) || entry.canonical.toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [normalizedValue, options, search, sourceCanonical]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  const containerClassName = className || "d-flex flex-wrap gap-2 mt-2";

  function addLanguage(canonical: string) {
    if (disabled) return;
    const normalized = normalizeTarget(canonical);
    if (!normalized) return;
    if (normalized === sourceCanonical) return;
    if (allowedSet && !allowedSet.has(normalized)) return;
    if (!normalizedValue.includes(normalized)) {
      onChange([...normalizedValue, normalized]);
    }
    setSearch("");
  }

  return (
    <div className="fc-language-select">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div className="text-muted small">Selected ({normalizedValue.length})</div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
        >
          {open ? "Close language search" : "Add languages"}
        </button>
      </div>

      <div className={containerClassName}>
        {selectedOptions.length === 0 ? (
          <span className="text-muted small">No target languages selected.</span>
        ) : (
          selectedOptions.map((entry) => (
            <span key={entry.canonical} className="badge text-bg-light text-dark d-inline-flex align-items-center gap-1">
              {entry.flag ? (
                <span className={`flag-icon fi fi-${entry.flag}`} aria-hidden="true" />
              ) : (
                <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
              )}
              <span>{entry.label}</span>
              {!disabled && (
                <button
                  type="button"
                  className="btn-close btn-sm ms-1"
                  aria-label={`Remove ${entry.label}`}
                  onClick={() => onChange(normalizedValue.filter((lang) => lang !== entry.canonical))}
                />
              )}
            </span>
          ))
        )}
      </div>

      {open && (
        <div className="border rounded p-2 mt-2 bg-white">
          <div className="input-group input-group-sm">
            <span className="input-group-text">
              <i className="bi bi-search" aria-hidden="true" />
            </span>
            <input
              ref={searchRef}
              className="form-control"
              placeholder="Search languages"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={disabled}
            />
          </div>

          {loading && <div className="text-muted small mt-2">Loading languages...</div>}
          {!loading && filteredOptions.length === 0 && (
            <div className="text-muted small mt-2">No languages match your search.</div>
          )}
          {!loading && filteredOptions.length > 0 && (
            <div className="list-group list-group-flush mt-2">
              {filteredOptions.map((entry) => {
                const flag = languageFlagTag(entry);
                const label = formatLanguageEntryLabel(entry);
                return (
                  <button
                    type="button"
                    key={entry.canonical}
                    className="list-group-item list-group-item-action d-flex align-items-center justify-content-between"
                    onClick={() => addLanguage(entry.canonical)}
                    disabled={disabled}
                  >
                    <span className="d-inline-flex align-items-center gap-2">
                      {flag ? (
                        <span className={`flag-icon fi fi-${flag}`} aria-hidden="true" />
                      ) : (
                        <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
                      )}
                      <span>{label}</span>
                    </span>
                    <span className="text-muted small">Add</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
