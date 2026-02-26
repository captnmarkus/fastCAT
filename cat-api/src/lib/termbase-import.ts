type DescripMap = Record<string, string>;
type LanguageDescripMap = Record<string, DescripMap>;
type TermDescripMap = Record<string, Record<string, DescripMap>>;

type StructureField = { name: string };
type NormalizedStructure = {
  entry: StructureField[];
  language: StructureField[];
  term: StructureField[];
};

const DESCRIP_FIELD_ALIASES: Record<string, string[]> = {
  graphic: ["illustration"],
  illustration: ["illustration"]
};

export function normalizeFieldLabel(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildNormalizedFieldMap(fields: StructureField[]) {
  const map = new Map<string, string>();
  fields.forEach((field) => {
    const normalized = normalizeFieldLabel(field.name);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, field.name);
    }
  });
  return map;
}

function resolveFieldName(
  rawType: string,
  fields: StructureField[],
  normalizedMap: Map<string, string>
): string | null {
  const raw = String(rawType ?? "").trim();
  if (!raw) return null;
  const exact = fields.find((field) => field.name === raw);
  if (exact) return exact.name;
  const lower = raw.toLowerCase();
  const caseMatch = fields.find((field) => field.name.toLowerCase() === lower);
  if (caseMatch) return caseMatch.name;
  const normalized = normalizeFieldLabel(raw);
  if (!normalized) return null;
  const direct = normalizedMap.get(normalized);
  if (direct) return direct;
  const aliases = DESCRIP_FIELD_ALIASES[normalized];
  if (aliases) {
    for (const alias of aliases) {
      const aliasKey = normalizeFieldLabel(alias);
      const aliasMatch = normalizedMap.get(aliasKey);
      if (aliasMatch) return aliasMatch;
    }
  }
  return null;
}

export function normalizeStructureFields(structure: any): NormalizedStructure {
  const normalizeList = (value: any): StructureField[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((field) => {
        if (!field || typeof field !== "object") return null;
        const name = String((field as any).name ?? (field as any).label ?? "").trim();
        if (!name) return null;
        return { name };
      })
      .filter(Boolean) as StructureField[];
  };
  const raw = structure && typeof structure === "object" ? structure : {};
  return {
    entry: normalizeList(raw.entry),
    language: normalizeList(raw.language),
    term: normalizeList(raw.term)
  };
}

export function mapDescripsToFields(
  descrips: DescripMap | null | undefined,
  fields: StructureField[]
): DescripMap {
  if (!descrips || Object.keys(descrips).length === 0) return {};
  if (!fields || fields.length === 0) return { ...descrips };
  const normalizedMap = buildNormalizedFieldMap(fields);
  const result: DescripMap = {};
  Object.entries(descrips).forEach(([rawType, rawValue]) => {
    const value = String(rawValue ?? "").trim();
    if (!value) return;
    const resolved = resolveFieldName(rawType, fields, normalizedMap);
    const key = resolved || rawType;
    if (!key) return;
    if (result[key]) {
      if (result[key] !== value) {
        result[key] = `${result[key]}\n${value}`;
      }
      return;
    }
    result[key] = value;
  });
  return result;
}

export function mapXmlDescripsToCustomFields(params: {
  entryDescrips?: DescripMap | null;
  languageDescrips?: LanguageDescripMap | null;
  termDescrips?: TermDescripMap | null;
  structure?: any;
}): {
  entryFields: DescripMap;
  languageFields: LanguageDescripMap;
  termFields: TermDescripMap;
  rawDescrips: { entry?: DescripMap; language?: LanguageDescripMap; term?: TermDescripMap };
} {
  const normalized = normalizeStructureFields(params.structure);
  const entryFields = mapDescripsToFields(params.entryDescrips ?? {}, normalized.entry);

  const languageFields: LanguageDescripMap = {};
  Object.entries(params.languageDescrips ?? {}).forEach(([lang, descrips]) => {
    const mapped = mapDescripsToFields(descrips, normalized.language);
    if (Object.keys(mapped).length > 0) {
      languageFields[lang] = mapped;
    }
  });

  const termFields: TermDescripMap = {};
  Object.entries(params.termDescrips ?? {}).forEach(([lang, termMap]) => {
    Object.entries(termMap || {}).forEach(([term, descrips]) => {
      const mapped = mapDescripsToFields(descrips, normalized.term);
      if (Object.keys(mapped).length === 0) return;
      if (!termFields[lang]) termFields[lang] = {};
      termFields[lang]![term] = mapped;
    });
  });

  return {
    entryFields,
    languageFields,
    termFields,
    rawDescrips: {
      entry: params.entryDescrips ?? undefined,
      language: params.languageDescrips ?? undefined,
      term: params.termDescrips ?? undefined
    }
  };
}

export type { DescripMap, LanguageDescripMap, TermDescripMap };
