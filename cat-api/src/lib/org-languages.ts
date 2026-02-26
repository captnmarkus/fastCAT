import { db, withTransaction } from "../db.js";
import {
  LANGUAGE_CATALOG,
  getCatalogByTag,
  normalizeLanguageTag,
  normalizeLanguageTags,
  primarySubtag,
  type LanguageCatalogEntry
} from "./language-catalog.js";

export type OrgLanguageSettings = {
  enabledLanguageTags: string[];
  defaultSourceTag: string;
  defaultTargetTags: string[];
  preferredVariantsByPrimary: Record<string, string>;
  allowSingleLanguage: boolean;
};

export type NormalizedLocale = {
  inputRaw: string;
  language: string;
  region?: string;
  canonical: string;
  flagTag?: string;
};

export type LanguageEntry = {
  canonical: string;
  language: string;
  region?: string;
  displayName?: string;
  active: boolean;
  allowedAsSource: boolean;
  allowedAsTarget: boolean;
  isDefaultSource?: boolean;
  isDefaultTarget?: boolean;
};

export type LanguageDefaults = {
  defaultSource?: string;
  defaultTargets?: string[];
};

export type LanguageConfig = {
  languages: LanguageEntry[];
  defaults: LanguageDefaults;
  allowSingleLanguage?: boolean;
};

const DEFAULT_REGION_BY_LANGUAGE: Record<string, string> = {
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
  pl: "PL",
  sv: "SE",
  da: "DK",
  fi: "FI",
  no: "NO",
  is: "IS",
  cs: "CZ",
  sk: "SK",
  sl: "SI",
  hr: "HR",
  hu: "HU",
  ro: "RO",
  bg: "BG",
  el: "GR",
  et: "EE",
  lv: "LV",
  lt: "LT",
  mt: "MT",
  ga: "IE",
  uk: "UA",
  tr: "TR",
  sq: "AL",
  mk: "MK",
  sr: "RS",
  bs: "BA",
  en: "GB",
  zh: "CN"
};

const DEFAULT_SETTINGS: OrgLanguageSettings = {
  enabledLanguageTags: normalizeLanguageTags([
    "de-DE",
    "en-GB",
    "fr-FR",
    "it-IT",
    "es-ES",
    "pt-PT",
    "nl-NL",
    "pl-PL",
    "sv-SE",
    "da-DK",
    "fi-FI",
    "no-NO",
    "is-IS",
    "cs-CZ",
    "sk-SK",
    "sl-SI",
    "hr-HR",
    "hu-HU",
    "ro-RO",
    "bg-BG",
    "el-GR",
    "et-EE",
    "lv-LV",
    "lt-LT",
    "ga-IE",
    "uk-UA",
    "tr-TR",
    "sq-AL",
    "mk-MK",
    "sr-RS",
    "bs-BA"
  ]),
  defaultSourceTag: "de-DE",
  defaultTargetTags: ["en-GB"],
  preferredVariantsByPrimary: { en: "en-GB", de: "de-DE" },
  allowSingleLanguage: false
};

type OrgLanguageSettingsRow = {
  enabled_language_tags: any;
  default_source_tag: string | null;
  default_target_tags: any;
  preferred_variants_by_primary: any;
  allow_single_language: boolean | null;
  languages?: any;
  defaults?: any;
};

const DEFAULT_LANGUAGE_CONFIG: LanguageConfig = languageConfigFromLegacy(DEFAULT_SETTINGS);

function coerceJsonArray(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return Object.values(parsed);
    } catch {
      return [];
    }
  }
  if (input && typeof input === "object") {
    return Object.values(input);
  }
  return [];
}

function coerceJsonObject<T extends Record<string, any>>(input: any): T {
  if (!input) return {} as T;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    } catch {
      return {} as T;
    }
  }
  if (typeof input === "object" && !Array.isArray(input)) return input as T;
  return {} as T;
}

function coerceTagList(input: any): string[] {
  if (Array.isArray(input)) return input.filter((value) => typeof value === "string");
  if (typeof input === "string") {
    try {
      return coerceTagList(JSON.parse(input));
    } catch {
      return [];
    }
  }
  if (input && typeof input === "object") {
    const values = Object.values(input);
    const stringValues = values.filter((value) => typeof value === "string") as string[];
    if (stringValues.length > 0) return stringValues;
    return Object.keys(input);
  }
  return [];
}

export function buildLanguageCatalogResponse() {
  return LANGUAGE_CATALOG;
}

function cleanLocaleInput(input: string): string {
  return input
    .trim()
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeLocale(input: string): NormalizedLocale {
  const inputRaw = String(input ?? "");
  const cleaned = cleanLocaleInput(inputRaw);
  if (!cleaned) {
    return { inputRaw, language: "", canonical: "" };
  }

  const cleanedLower = cleaned.toLowerCase();
  const aliasKey = cleanedLower.replace(/[^a-z]/g, "");
  if (cleanedLower === "sh" || aliasKey === "serbocroatian") {
    return {
      inputRaw,
      language: "sr",
      region: "RS",
      canonical: "sr-RS",
      flagTag: "RS"
    };
  }

  const parts = cleaned.split("-").filter(Boolean);
  const language = (parts[0] || "").toLowerCase();
  let region: string | undefined;

  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\d{3}$/.test(part) || part.length === 2) {
      region = part.toUpperCase();
      break;
    }
  }

  if (!region) {
    const fallback = DEFAULT_REGION_BY_LANGUAGE[language];
    if (fallback) region = fallback;
  }

  const canonical = language ? (region ? `${language}-${region}` : language) : "";
  return {
    inputRaw,
    language,
    region,
    canonical,
    flagTag: region
  };
}

function normalizeDisplayName(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLanguageEntry(input: Partial<LanguageEntry>): LanguageEntry | null {
  const candidate = String(input.canonical || input.language || "").trim();
  const locale = normalizeLocale(candidate);
  if (!locale.canonical) return null;

  const active = Boolean(input.active);
  const allowedAsSource = input.allowedAsSource ?? (active ? true : false);
  const allowedAsTarget = input.allowedAsTarget ?? (active ? true : false);

  return {
    canonical: locale.canonical,
    language: locale.language,
    region: locale.region,
    displayName: normalizeDisplayName(input.displayName),
    active,
    allowedAsSource: Boolean(allowedAsSource),
    allowedAsTarget: Boolean(allowedAsTarget),
    isDefaultSource: input.isDefaultSource,
    isDefaultTarget: input.isDefaultTarget
  };
}

function mergeLanguageEntries(entries: Array<Partial<LanguageEntry>>): LanguageEntry[] {
  const map = new Map<string, LanguageEntry>();
  entries.forEach((raw) => {
    const normalized = normalizeLanguageEntry(raw);
    if (!normalized) return;
    const existing = map.get(normalized.canonical);
    if (!existing) {
      map.set(normalized.canonical, normalized);
      return;
    }
    map.set(normalized.canonical, {
      ...existing,
      active: existing.active || normalized.active,
      allowedAsSource: existing.allowedAsSource || normalized.allowedAsSource,
      allowedAsTarget: existing.allowedAsTarget || normalized.allowedAsTarget,
      displayName: existing.displayName || normalized.displayName,
      isDefaultSource: existing.isDefaultSource || normalized.isDefaultSource,
      isDefaultTarget: existing.isDefaultTarget || normalized.isDefaultTarget
    });
  });
  return Array.from(map.values());
}

function normalizeDefaults(input: LanguageDefaults | undefined): LanguageDefaults {
  if (!input) return {};
  const defaultSource = normalizeLocale(String(input.defaultSource || "")).canonical || "";
  const defaultTargets = Array.isArray(input.defaultTargets)
    ? Array.from(
        new Set(
          input.defaultTargets
            .map((value) => normalizeLocale(String(value || "")).canonical)
            .filter(Boolean)
        )
      )
    : [];
  return {
    defaultSource: defaultSource || undefined,
    defaultTargets
  };
}

function hasV2Config(row: OrgLanguageSettingsRow | null): boolean {
  if (!row) return false;
  const languages = coerceJsonArray(row.languages);
  if (languages.length > 0) return true;
  const defaults = coerceJsonObject(row.defaults);
  if (Object.keys(defaults).length > 0) return true;
  return false;
}

function normalizeSettingsRow(row: OrgLanguageSettingsRow | null): OrgLanguageSettings {
  if (!row) return { ...DEFAULT_SETTINGS };

  const enabled = normalizeLanguageTags(coerceTagList(row.enabled_language_tags));
  const defaultSource = normalizeLanguageTag(row.default_source_tag || "");
  const targets = normalizeLanguageTags(coerceTagList(row.default_target_tags));
  const preferredVariants = coerceJsonObject<Record<string, string>>(row.preferred_variants_by_primary);

  return {
    enabledLanguageTags: enabled,
    defaultSourceTag: defaultSource || DEFAULT_SETTINGS.defaultSourceTag,
    defaultTargetTags: targets.length > 0 ? targets : DEFAULT_SETTINGS.defaultTargetTags,
    preferredVariantsByPrimary: preferredVariants,
    allowSingleLanguage: Boolean(row.allow_single_language)
  };
}

function languageConfigFromLegacy(settings: OrgLanguageSettings): LanguageConfig {
  const entries = settings.enabledLanguageTags
    .map((tag) => {
      const locale = normalizeLocale(tag);
      if (!locale.canonical) return null;
      return {
        canonical: locale.canonical,
        language: locale.language,
        region: locale.region,
        active: true,
        allowedAsSource: true,
        allowedAsTarget: true
      } as LanguageEntry;
    })
    .filter(Boolean) as LanguageEntry[];

  return {
    languages: mergeLanguageEntries(entries),
    defaults: normalizeDefaults({
      defaultSource: settings.defaultSourceTag,
      defaultTargets: settings.defaultTargetTags
    }),
    allowSingleLanguage: settings.allowSingleLanguage
  };
}

function buildPreferredVariants(enabled: string[], defaults: LanguageDefaults): Record<string, string> {
  const byPrimary = new Map<string, string[]>();
  enabled.forEach((tag) => {
    const primary = primarySubtag(tag);
    if (!primary) return;
    if (!byPrimary.has(primary)) byPrimary.set(primary, []);
    byPrimary.get(primary)!.push(tag);
  });

  const preferred: Record<string, string> = {};
  const defaultSource = defaults.defaultSource || "";
  const defaultTargets = defaults.defaultTargets || [];

  for (const [primary, variants] of byPrimary) {
    const sorted = variants.slice().sort((a, b) => a.localeCompare(b));
    let pick = "";
    if (defaultSource && primarySubtag(defaultSource) === primary) {
      pick = defaultSource;
    } else {
      const targetPick = defaultTargets.find((tag) => primarySubtag(tag) === primary);
      if (targetPick) pick = targetPick;
    }

    if (!pick) {
      const fallback = normalizeLocale(primary).canonical;
      if (fallback && sorted.includes(fallback)) pick = fallback;
    }

    if (!pick && sorted.length > 0) pick = sorted[0];
    if (pick) preferred[primary] = pick;
  }

  return preferred;
}

function sanitizeDefaults(defaults: LanguageDefaults, languages: LanguageEntry[]): LanguageDefaults {
  const activeSources = new Set(
    languages.filter((entry) => entry.active && entry.allowedAsSource).map((entry) => entry.canonical)
  );
  const activeTargets = new Set(
    languages.filter((entry) => entry.active && entry.allowedAsTarget).map((entry) => entry.canonical)
  );

  const source = defaults.defaultSource && activeSources.has(defaults.defaultSource) ? defaults.defaultSource : undefined;
  const targets = Array.from(
    new Set(
      (defaults.defaultTargets || []).filter(
        (value) => activeTargets.has(value) && value !== source
      )
    )
  );

  return {
    defaultSource: source,
    defaultTargets: targets
  };
}

function legacySettingsFromConfig(config: LanguageConfig, preferredVariants?: Record<string, string>): OrgLanguageSettings {
  const active = config.languages.filter((entry) => entry.active);
  const enabledLanguageTags = active.map((entry) => entry.canonical);
  const allowSingleLanguage = Boolean(config.allowSingleLanguage);
  const normalizedDefaults = sanitizeDefaults(normalizeDefaults(config.defaults), config.languages);

  const fallbackSource = enabledLanguageTags[0] || DEFAULT_SETTINGS.defaultSourceTag;
  const defaultSourceTag = normalizedDefaults.defaultSource || fallbackSource;

  const allowEmptyTargets = allowSingleLanguage && enabledLanguageTags.length <= 1;
  const defaultTargets = (normalizedDefaults.defaultTargets || []).filter((tag) => tag !== defaultSourceTag);
  const fallbackTargets = allowEmptyTargets
    ? []
    : enabledLanguageTags.filter((tag) => tag !== defaultSourceTag).slice(0, 1);

  const defaultTargetTags = defaultTargets.length > 0
    ? defaultTargets
    : fallbackTargets.length > 0
      ? fallbackTargets
      : DEFAULT_SETTINGS.defaultTargetTags;

  return {
    enabledLanguageTags,
    defaultSourceTag,
    defaultTargetTags,
    preferredVariantsByPrimary: preferredVariants || buildPreferredVariants(enabledLanguageTags, {
      defaultSource: defaultSourceTag,
      defaultTargets: defaultTargetTags
    }),
    allowSingleLanguage
  };
}

function normalizeConfigRow(row: OrgLanguageSettingsRow | null): LanguageConfig {
  if (!row) return { ...DEFAULT_LANGUAGE_CONFIG };
  if (hasV2Config(row)) {
    const rawLanguages = coerceJsonArray(row.languages);
    const normalizedLanguages = rawLanguages.map((value) => {
      if (typeof value === "string") {
        return {
          canonical: value,
          active: true,
          allowedAsSource: true,
          allowedAsTarget: true
        };
      }
      return value;
    });
    const languages = mergeLanguageEntries(normalizedLanguages);
    const defaults = normalizeDefaults(coerceJsonObject(row.defaults));
    const allowSingleLanguage = Boolean(row.allow_single_language);
    if (languages.length > 0) {
      return {
        languages,
        defaults,
        allowSingleLanguage
      };
    }
    const legacy = normalizeSettingsRow(row);
    if (legacy.enabledLanguageTags.length > 0) return languageConfigFromLegacy(legacy);
    return { languages, defaults, allowSingleLanguage };
  }
  const legacy = normalizeSettingsRow(row);
  return languageConfigFromLegacy(legacy);
}

export function validateLanguageConfig(input: LanguageConfig): { normalized: LanguageConfig; errors: string[] } {
  const languages = mergeLanguageEntries(input.languages || []);
  const defaults = normalizeDefaults(input.defaults);
  const allowSingleLanguage = Boolean(input.allowSingleLanguage);

  const activeLanguages = languages.filter((entry) => entry.active);
  const activeSourceLanguages = activeLanguages.filter((entry) => entry.allowedAsSource);
  const activeTargetLanguages = activeLanguages.filter((entry) => entry.allowedAsTarget);

  const sanitizedDefaults = sanitizeDefaults(defaults, languages);

  const errors: string[] = [];
  if (activeLanguages.length === 0) errors.push("Select at least one active language.");
  if (activeSourceLanguages.length === 0) errors.push("Select at least one allowed source language.");
  if (activeTargetLanguages.length === 0) errors.push("Select at least one allowed target language.");
  if (defaults.defaultSource && !sanitizedDefaults.defaultSource) {
    errors.push("Default source language must be allowed as a source.");
  }
  if ((defaults.defaultTargets || []).some((value) => value === defaults.defaultSource)) {
    errors.push("Default targets must differ from the source language.");
  }
  if ((defaults.defaultTargets || []).some((value) =>
    !activeTargetLanguages.some((entry) => entry.canonical === value)
  )) {
    errors.push("Default targets must be allowed as targets.");
  }
  if (!allowSingleLanguage && activeLanguages.length > 0 && activeLanguages.length < 2) {
    errors.push("Enable at least two languages or allow single-language termbases.");
  }

  return {
    normalized: {
      languages,
      defaults: sanitizedDefaults,
      allowSingleLanguage
    },
    errors
  };
}

async function persistLanguageConfig(
  config: LanguageConfig,
  legacySettings: OrgLanguageSettings,
  actor: string | null
) {
  await db.query(
    `INSERT INTO org_language_settings
      (id, languages, defaults, enabled_language_tags, default_source_tag, default_target_tags, preferred_variants_by_primary, allow_single_language, updated_by, updated_at)
     VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       languages = EXCLUDED.languages,
       defaults = EXCLUDED.defaults,
       enabled_language_tags = EXCLUDED.enabled_language_tags,
       default_source_tag = EXCLUDED.default_source_tag,
       default_target_tags = EXCLUDED.default_target_tags,
       preferred_variants_by_primary = EXCLUDED.preferred_variants_by_primary,
       allow_single_language = EXCLUDED.allow_single_language,
       updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      JSON.stringify(config.languages),
      JSON.stringify(config.defaults || {}),
      JSON.stringify(legacySettings.enabledLanguageTags),
      legacySettings.defaultSourceTag,
      JSON.stringify(legacySettings.defaultTargetTags),
      JSON.stringify(legacySettings.preferredVariantsByPrimary),
      legacySettings.allowSingleLanguage,
      actor
    ]
  );
}

export async function getOrgLanguageConfig(): Promise<LanguageConfig> {
  const res = await db.query<OrgLanguageSettingsRow>(
    `SELECT enabled_language_tags, default_source_tag, default_target_tags, preferred_variants_by_primary, allow_single_language, languages, defaults
     FROM org_language_settings
     WHERE id = 1`
  );
  const row = res.rows[0] ?? null;
  if (row) return normalizeConfigRow(row);
  await ensureOrgLanguageConfig(DEFAULT_LANGUAGE_CONFIG, "system");
  return { ...DEFAULT_LANGUAGE_CONFIG };
}

export async function ensureOrgLanguageConfig(config: LanguageConfig, actor: string | null) {
  const legacy = legacySettingsFromConfig(config);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO org_language_settings
        (id, languages, defaults, enabled_language_tags, default_source_tag, default_target_tags, preferred_variants_by_primary, allow_single_language, updated_by, updated_at)
       VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7, $8, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        JSON.stringify(config.languages),
        JSON.stringify(config.defaults || {}),
        JSON.stringify(legacy.enabledLanguageTags),
        legacy.defaultSourceTag,
        JSON.stringify(legacy.defaultTargetTags),
        JSON.stringify(legacy.preferredVariantsByPrimary),
        legacy.allowSingleLanguage,
        actor
      ]
    );
  });
}

export async function updateOrgLanguageConfig(config: LanguageConfig, actor: string | null) {
  const { normalized, errors } = validateLanguageConfig(config);
  if (errors.length > 0) {
    const message = errors.join(" ");
    const err = new Error(message);
    (err as any).details = errors;
    throw err;
  }
  const legacy = legacySettingsFromConfig(normalized);
  await persistLanguageConfig(normalized, legacy, actor);
  return normalized;
}

export async function getOrgLanguageSettings(): Promise<OrgLanguageSettings> {
  const res = await db.query<OrgLanguageSettingsRow>(
    `SELECT enabled_language_tags, default_source_tag, default_target_tags, preferred_variants_by_primary, allow_single_language, languages, defaults
     FROM org_language_settings
     WHERE id = 1`
  );
  const row = res.rows[0] ?? null;
  if (row && hasV2Config(row)) {
    const config = normalizeConfigRow(row);
    return legacySettingsFromConfig(config);
  }
  if (row) return normalizeSettingsRow(row);
  await ensureOrgLanguageSettings(DEFAULT_SETTINGS, "system");
  return { ...DEFAULT_SETTINGS };
}

export async function ensureOrgLanguageSettings(settings: OrgLanguageSettings, actor: string | null) {
  const config = languageConfigFromLegacy(settings);
  const legacy = legacySettingsFromConfig(config, settings.preferredVariantsByPrimary);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO org_language_settings
        (id, languages, defaults, enabled_language_tags, default_source_tag, default_target_tags, preferred_variants_by_primary, allow_single_language, updated_by, updated_at)
       VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7, $8, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        JSON.stringify(config.languages),
        JSON.stringify(config.defaults || {}),
        JSON.stringify(legacy.enabledLanguageTags),
        legacy.defaultSourceTag,
        JSON.stringify(legacy.defaultTargetTags),
        JSON.stringify(legacy.preferredVariantsByPrimary),
        legacy.allowSingleLanguage,
        actor
      ]
    );
  });
}

export async function updateOrgLanguageSettings(settings: OrgLanguageSettings, actor: string | null) {
  const { normalized: payload, errors } = validateOrgLanguageSettings(settings);
  if (errors.length > 0) {
    const message = errors.join(" ");
    const err = new Error(message);
    (err as any).details = errors;
    throw err;
  }
  const config = languageConfigFromLegacy(payload);
  const legacy = legacySettingsFromConfig(config, payload.preferredVariantsByPrimary);
  await persistLanguageConfig(config, legacy, actor);
  return payload;
}

export function validateOrgLanguageSettings(input: OrgLanguageSettings): { normalized: OrgLanguageSettings; errors: string[] } {
  const catalogByTag = getCatalogByTag();
  const enabledRaw = normalizeLanguageTags(input.enabledLanguageTags || []);
  const enabled = enabledRaw.filter((tag) => catalogByTag.has(tag));
  const defaultSource = normalizeLanguageTag(input.defaultSourceTag || "");
  const targets = normalizeLanguageTags(input.defaultTargetTags || []).filter((tag) => tag !== defaultSource);
  const allowSingle = Boolean(input.allowSingleLanguage);
  const allowEmptyTargets = allowSingle && enabled.length <= 1;
  const preferredVariants = input.preferredVariantsByPrimary || {};

  const errors: string[] = [];
  if (enabled.length === 0) errors.push("At least one enabled language is required.");
  if (!defaultSource) errors.push("Default source language is required.");
  if (defaultSource && !enabled.includes(defaultSource)) {
    errors.push("Default source language must be enabled.");
  }
  if (!allowSingle && enabled.length < 2) {
    errors.push("At least two languages are required unless single-language mode is enabled.");
  }
  if (!allowEmptyTargets && targets.length === 0) errors.push("At least one default target language is required.");
  if (targets.some((tag) => tag === defaultSource)) {
    errors.push("Default target languages cannot include the source language.");
  }
  if (!targets.every((tag) => enabled.includes(tag))) {
    errors.push("Default target languages must be enabled.");
  }

  const normalized: OrgLanguageSettings = {
    enabledLanguageTags: enabled,
    defaultSourceTag: defaultSource || enabled[0] || DEFAULT_SETTINGS.defaultSourceTag,
    defaultTargetTags: targets.length > 0
      ? targets
      : allowEmptyTargets
        ? []
        : enabled.filter((tag) => tag !== defaultSource).slice(0, 1),
    preferredVariantsByPrimary: preferredVariants,
    allowSingleLanguage: allowSingle
  };

  return { normalized, errors };
}

export type LanguageMatchResult = {
  input: string;
  normalized: string;
  resolved: string | null;
  strategy: "exact" | "preferred" | "base" | "defaultRegion" | "fallback" | "none";
};

export function resolveLanguageMatch(
  input: string,
  enabled: string[],
  settings: OrgLanguageSettings,
  catalogByTag: Map<string, LanguageCatalogEntry>
): LanguageMatchResult {
  const normalized = normalizeLanguageTag(input);
  if (!normalized) {
    return { input, normalized: "", resolved: null, strategy: "none" };
  }
  const enabledNormalized = normalizeLanguageTags(enabled);
  if (enabledNormalized.includes(normalized)) {
    return { input, normalized, resolved: normalized, strategy: "exact" };
  }

  const primary = primarySubtag(normalized);
  if (!primary) {
    return { input, normalized, resolved: null, strategy: "none" };
  }
  const variants = enabledNormalized.filter((tag) => primarySubtag(tag) === primary);
  if (variants.length === 0) {
    return { input, normalized, resolved: null, strategy: "none" };
  }
  if (variants.length === 1) {
    return { input, normalized, resolved: variants[0], strategy: "fallback" };
  }
  const preferred = settings.preferredVariantsByPrimary?.[primary];
  if (preferred) {
    const preferredNormalized = normalizeLanguageTag(preferred);
    if (variants.includes(preferredNormalized)) {
      return { input, normalized, resolved: preferredNormalized, strategy: "preferred" };
    }
  }
  const base = variants.find((tag) => tag === primary);
  if (base) {
    return { input, normalized, resolved: base, strategy: "base" };
  }
  const catalogEntry = catalogByTag.get(primary);
  if (catalogEntry?.defaultRegionForFlag) {
    const candidate = normalizeLanguageTag(`${primary}-${catalogEntry.defaultRegionForFlag}`);
    if (variants.includes(candidate)) {
      return { input, normalized, resolved: candidate, strategy: "defaultRegion" };
    }
  }
  return { input, normalized, resolved: variants[0], strategy: "fallback" };
}
