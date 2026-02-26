import { useEffect, useState } from "react";
import { languageInfo } from "../../../components/LanguageLabel";
import type { FieldSchema } from "../../../components/TermbaseFields";
import type { TermbaseCustomFields, TermbaseEntryDetail, TermbaseField } from "../../../api";

export type EntryPatch = {
  entryFields?: TermbaseCustomFields;
  languageFields?: Record<string, TermbaseCustomFields>;
};

export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);
  return debounced;
}

export function buildLangLabel(code: string) {
  const info = languageInfo(code);
  if (!info) return code.toUpperCase();
  return info.name;
}

export function canonicalizeLangTag(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const cleaned = raw
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "";
  const lowered = cleaned.toLowerCase();
  const aliasKey = lowered.replace(/[^a-z]/g, "");
  if (lowered === "sh" || aliasKey === "serbocroatian") return "sr-RS";
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      if (/^\d{3}$/.test(part) || part.length === 2) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

export function resolveAvailableLanguage(input: string, available: string[]) {
  const canonical = canonicalizeLangTag(input);
  if (!canonical) return "";
  const canonicalLower = canonical.toLowerCase();
  const exact = available.find((lang) => lang.toLowerCase() === canonicalLower);
  if (exact) return exact;
  const primary = canonicalLower.split("-")[0] || "";
  if (!primary) return "";
  const base = available.find((lang) => lang.toLowerCase() === primary);
  if (base) return base;
  const variant = available.find((lang) => lang.toLowerCase().startsWith(`${primary}-`));
  if (variant) return variant;
  return "";
}

function decodeTermKey(termId: string): { lang: string; text: string } | null {
  const raw = termId.startsWith("t_") ? termId.slice(2) : termId;
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((raw.length + 3) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as { lang?: string; text?: string };
    const lang = canonicalizeLangTag(parsed?.lang ?? "");
    const text = String(parsed?.text ?? "").trim();
    if (!lang || !text) return null;
    return { lang, text };
  } catch {
    return null;
  }
}

export function resolveTermLanguage(termId: string, detail: TermbaseEntryDetail | null): string {
  const decoded = decodeTermKey(termId);
  if (decoded?.lang) return decoded.lang;
  if (!detail) return "";
  for (const section of detail.languages) {
    if (section.terms.some((term) => term.termId === termId)) {
      return section.language;
    }
  }
  return "";
}

export function isImageFilename(filename: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(filename);
}

const CORE_TERM_FIELD_KEYS = new Set(["status", "part of speech", "note", "notes"]);

function normalizeFieldKey(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function isCoreTermField(field: TermbaseField) {
  return CORE_TERM_FIELD_KEYS.has(normalizeFieldKey(field.name));
}

export function toFieldSchema(field: TermbaseField, level: FieldSchema["level"]): FieldSchema {
  return {
    name: field.name,
    level,
    type: field.type,
    picklistValues: field.values,
    multiline: field.multiline
  };
}

export function mergeEntryPatch(base: EntryPatch | null, patch: EntryPatch): EntryPatch {
  const next: EntryPatch = { ...(base ?? {}) };
  if (patch.entryFields) {
    next.entryFields = {
      ...(base?.entryFields ?? {}),
      ...patch.entryFields
    };
  }
  if (patch.languageFields) {
    const merged: Record<string, TermbaseCustomFields> = { ...(base?.languageFields ?? {}) };
    Object.entries(patch.languageFields).forEach(([lang, fields]) => {
      merged[lang] = { ...(merged[lang] ?? {}), ...fields };
    });
    next.languageFields = merged;
  }
  return next;
}
