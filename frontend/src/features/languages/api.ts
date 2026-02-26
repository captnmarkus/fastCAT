import { CAT_API_BASE, authHeaders, httpError } from "../../api";
import type { LanguageConfig, LanguageDefaults, LanguageEntry } from "./types";
import { mergeLanguageEntries, normalizeDefaults } from "./utils";

type LanguageApiResponse = {
  languages?: LanguageEntry[];
  entries?: LanguageEntry[];
  defaults?: LanguageDefaults;
  allowSingleLanguage?: boolean;
};

function normalizeLanguageResponse(payload: LanguageApiResponse): LanguageConfig {
  const languages = mergeLanguageEntries(payload.languages || payload.entries || []);
  const defaults = normalizeDefaults(payload.defaults);
  return {
    languages,
    defaults,
    allowSingleLanguage: Boolean(payload.allowSingleLanguage)
  };
}

export async function fetchLanguages(): Promise<LanguageConfig> {
  const r = await fetch(`${CAT_API_BASE}/org/languages`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("org languages", r);
  const data = (await r.json()) as LanguageApiResponse;
  return normalizeLanguageResponse(data);
}

export async function saveLanguagesBulk(
  entries: LanguageEntry[],
  defaults?: LanguageDefaults,
  allowSingleLanguage?: boolean
): Promise<LanguageConfig> {
  const payload = {
    languages: mergeLanguageEntries(entries),
    defaults: normalizeDefaults(defaults),
    allowSingleLanguage
  };
  const r = await fetch(`${CAT_API_BASE}/admin/org/languages`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("update org languages", r);
  const data = (await r.json()) as LanguageApiResponse;
  return normalizeLanguageResponse(data);
}

export async function saveDefaults(defaults: LanguageDefaults): Promise<LanguageConfig> {
  return saveLanguagesBulk([], defaults);
}
