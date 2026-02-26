import React, { useEffect, useMemo } from "react";
import { normalizeLocale } from "../../lib/i18n/locale";
import { useLanguages } from "./hooks";
import type { LanguageEntry } from "./types";
import { formatLanguageEntryLabel, languageFlagTag } from "./utils";

type BaseProps = {
  kind: "source" | "target";
  sourceValue?: string;
  disabled?: boolean;
  className?: string;
  includeEmpty?: boolean;
  emptyLabel?: string;
  optionsOverride?: LanguageEntry[];
};

type SingleProps = BaseProps & {
  multi?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultiProps = BaseProps & {
  multi: true;
  values: string[];
  onChange: (values: string[]) => void;
  containerClassName?: string;
  optionClassName?: string;
};

type Props = SingleProps | MultiProps;

function sortByLabel(a: LanguageEntry, b: LanguageEntry) {
  const labelA = formatLanguageEntryLabel(a);
  const labelB = formatLanguageEntryLabel(b);
  return labelA.localeCompare(labelB);
}

export default function LanguageSelect(props: Props) {
  const { activeSourceLanguages, activeTargetLanguages, loading } = useLanguages();
  const {
    kind,
    sourceValue,
    optionsOverride,
    disabled,
    includeEmpty,
    emptyLabel,
    className
  } = props;
  const isMulti = props.multi === true;
  const singleValue = !isMulti ? props.value : "";
  const multiValues = isMulti ? props.values : [];
  const onChangeSingle = !isMulti ? props.onChange : undefined;
  const onChangeMulti = isMulti ? props.onChange : undefined;
  const containerClassName = isMulti ? props.containerClassName : undefined;
  const optionClassName = isMulti ? props.optionClassName : undefined;
  const optionsSource =
    optionsOverride ||
    (kind === "source" ? activeSourceLanguages : activeTargetLanguages);

  const options = useMemo(() => {
    return [...optionsSource].sort(sortByLabel);
  }, [optionsSource]);

  const sourceCanonical = sourceValue ? normalizeLocale(sourceValue).canonical : "";
  const blocked = kind === "target" && sourceCanonical ? new Set([sourceCanonical]) : new Set<string>();

  useEffect(() => {
    if (isMulti || kind !== "target" || !sourceCanonical) return;
    if (singleValue !== sourceCanonical) return;
    const next = options.find((entry) => entry.canonical !== sourceCanonical);
    onChangeSingle?.(next?.canonical || "");
  }, [isMulti, kind, onChangeSingle, options, singleValue, sourceCanonical]);

  useEffect(() => {
    if (!isMulti || kind !== "target" || !sourceCanonical) return;
    if (!multiValues.includes(sourceCanonical)) return;
    onChangeMulti?.(multiValues.filter((value) => value !== sourceCanonical));
  }, [isMulti, kind, multiValues, onChangeMulti, sourceCanonical]);

  if (isMulti) {
    return (
      <div className={containerClassName || "d-flex flex-wrap gap-2"}>
        {loading && <div className="text-muted small">Loading languages...</div>}
        {!loading &&
          options.map((entry) => {
            const checked = multiValues.includes(entry.canonical);
            const isBlocked = blocked.has(entry.canonical);
            const id = `lang-${kind}-${entry.canonical}`;
            const flag = languageFlagTag(entry);
            return (
              <div className={optionClassName || "form-check"} key={entry.canonical}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={id}
                  checked={checked}
                  disabled={disabled || isBlocked}
                  onChange={() => {
                    const next = new Set(multiValues);
                    if (next.has(entry.canonical)) next.delete(entry.canonical);
                    else next.add(entry.canonical);
                    onChangeMulti?.(Array.from(next));
                  }}
                />
                <label className="form-check-label" htmlFor={id}>
                  {flag ? (
                    <span className={`flag-icon fi fi-${flag} me-1`} aria-hidden="true" />
                  ) : (
                    <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                  )}
                  {formatLanguageEntryLabel(entry)}
                </label>
              </div>
            );
          })}
      </div>
    );
  }

  return (
    <select
      className={className || "form-select"}
      value={singleValue}
      onChange={(event) => onChangeSingle?.(event.target.value)}
      disabled={disabled || loading}
    >
      {includeEmpty && (
        <option value="">{emptyLabel || "Select..."}</option>
      )}
      {options.map((entry) => (
        <option
          key={entry.canonical}
          value={entry.canonical}
          disabled={blocked.has(entry.canonical)}
        >
          {formatLanguageEntryLabel(entry)}
        </option>
      ))}
    </select>
  );
}
