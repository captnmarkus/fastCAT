import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { parseGlossaryContent } from "../lib/glossary-utils.js";
import { mapXmlDescripsToCustomFields } from "../lib/termbase-import.js";
import type { LanguageCatalogEntry } from "../lib/language-catalog.js";
import type { OrgLanguageSettings } from "../lib/org-languages.js";
import {
  CSV_MAPPING_FIELDS,
  appendMissingLanguageErrors,
  applyStatusToMeta,
  autoTermId,
  buildLanguageResolver,
  normalizeUser,
  parseBool,
  parseLanguageBlocks,
  parseStatusValue,
  parseTimestampOrNull,
  resolveDescripValue,
  splitList
} from "./glossaries.helpers.core.js";
import type {
  GlossaryImportColumn,
  GlossaryImportEntry,
  GlossaryImportMapping,
  GlossaryImportParseData,
  GlossaryImportSettings,
  GlossaryImportType,
  TermStatus
} from "./glossaries.helpers.core.js";

export * from "./glossaries.helpers.core.js";

export function parseXmlDocument(xmlText: string) {
  return new DOMParser({
    errorHandler: {
      warning() {},
      error(msg) {
        throw new Error(String(msg || "Invalid XML"));
      },
      fatalError(msg) {
        throw new Error(String(msg || "Invalid XML"));
      }
    }
  }).parseFromString(xmlText, "text/xml");
}

export function extractXmlColumns(doc: any): GlossaryImportColumn[] {
  const columns = new Map<string, GlossaryImportColumn>();
  const root = doc?.documentElement;
  if (!root) return [];

  const stack: Array<{ node: any; path: string[] }> = [{ node: root as any, path: [] }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const node = current.node;
    const name = String((node as any).nodeName || "").trim();
    if (!name) continue;
    const pathParts = [...current.path, name];
    const basePath = `/${pathParts.join("/")}`;

    const attrs = (node as any).attributes;
    if (attrs && typeof attrs.length === "number") {
      for (let i = 0; i < attrs.length; i += 1) {
        const attr = attrs.item(i);
        if (!attr || !attr.name) continue;
        if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
        const attrPath = `${basePath}/@${attr.name}`;
        if (!columns.has(attrPath)) {
          columns.set(attrPath, { name: attrPath, normalized: attrPath });
        }
      }
    }

    const childNodes = Array.from((node as any).childNodes || []) as any[];
    const elementChildren = childNodes.filter((child) => (child as any).nodeType === 1) as any[];
    if (elementChildren.length === 0) {
      const text = String((node as any).textContent ?? "").trim();
      if (text && !columns.has(basePath)) {
        columns.set(basePath, { name: basePath, normalized: basePath });
      }
    }

    for (const child of elementChildren) {
      stack.push({ node: child, path: pathParts });
    }

    if (columns.size >= 500) break;
  }

  return Array.from(columns.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function xmlValueFromNode(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (typeof node === "object") {
    const rawNode = node as any;
    const nodeType = rawNode.nodeType;
    if (nodeType === 2) return String(rawNode.value ?? rawNode.nodeValue ?? "");
    if (nodeType === 3 || nodeType === 4) return String(rawNode.data ?? "");
    if (typeof rawNode.textContent === "string") return rawNode.textContent;
  }
  return String(node);
}

export function evaluateXPathValues(doc: any, expr: string): string[] {
  const trimmed = String(expr ?? "").trim();
  if (!trimmed) return [];
  let result: any;
  try {
    result = xpath.select(trimmed, doc);
  } catch (err: any) {
    throw new Error(`Invalid XPath "${trimmed}": ${err?.message || "failed to evaluate"}`);
  }
  const nodes = Array.isArray(result) ? result : result ? [result] : [];
  return nodes.map(xmlValueFromNode);
}

export function parseGenericXmlImport(params: {
  text: string;
  mapping: GlossaryImportMapping;
  settings: GlossaryImportSettings;
  languagesOverride: string[];
  importId: number;
  uploadedBy: string;
  languageSettings: OrgLanguageSettings;
  catalogByTag: Map<string, LanguageCatalogEntry>;
}): GlossaryImportParseData {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingLanguageTags = new Set<string>();
  const resolveLanguage = buildLanguageResolver({
    settings: params.settings,
    enabledTags: params.languageSettings.enabledLanguageTags,
    languageSettings: params.languageSettings,
    catalogByTag: params.catalogByTag,
    errors,
    warnings,
    missingLanguageTags
  });
  let doc: any;
  try {
    doc = parseXmlDocument(params.text);
  } catch (err: any) {
    errors.push(err?.message || "Failed to parse XML file.");
    return {
      errors,
      warnings,
      entries: [],
      columns: [],
      sampleRows: [],
      detectedLanguages: [],
      mapping: params.mapping,
      stats: { rowCount: 0, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const columns = extractXmlColumns(doc);
  const mapping = params.mapping || {};

  if (!mapping.sourceTerm || !mapping.targetTerm) {
    errors.push("XML mapping must include source term and target term.");
  }

  const hasLanguageOverride = params.languagesOverride.length >= 2;
  if ((!mapping.sourceLang || !mapping.targetLang) && !hasLanguageOverride) {
    errors.push("XML mapping must include source/target languages or specify defaults in Basics.");
  }

  if (errors.length > 0) {
    return {
      errors,
      warnings,
      entries: [],
      columns,
      sampleRows: [],
      detectedLanguages: [],
      mapping,
      stats: { rowCount: 0, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const fieldValues: Partial<Record<keyof GlossaryImportMapping, string[]>> = {};
  const fieldErrors: string[] = [];
  for (const field of CSV_MAPPING_FIELDS) {
    const path = mapping[field.key];
    if (!path) continue;
    try {
      fieldValues[field.key] = evaluateXPathValues(doc, path);
    } catch (err: any) {
      fieldErrors.push(err?.message || `Failed to evaluate XPath for ${field.label}.`);
    }
  }
  if (fieldErrors.length > 0) {
    errors.push(...fieldErrors);
    return {
      errors,
      warnings,
      entries: [],
      columns,
      sampleRows: [],
      detectedLanguages: [],
      mapping,
      stats: { rowCount: 0, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const requiredFields: Array<keyof GlossaryImportMapping> = ["sourceTerm", "targetTerm"];
  if (!hasLanguageOverride) {
    requiredFields.push("sourceLang", "targetLang");
  }
  for (const field of requiredFields) {
    const values = fieldValues[field] || [];
    if (values.length === 0) {
      errors.push(`No values found for ${String(field)} mapping.`);
    }
  }
  if (errors.length > 0) {
    return {
      errors,
      warnings,
      entries: [],
      columns,
      sampleRows: [],
      detectedLanguages: [],
      mapping,
      stats: { rowCount: 0, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const lengths = Object.values(fieldValues).map((vals) => vals.length).filter((len) => len > 1);
  const rowCount = lengths.length > 0
    ? Math.max(...lengths)
    : Math.max(...Object.values(fieldValues).map((vals) => vals.length), 0);

  const uniqueLengths = new Set(lengths);
  if (uniqueLengths.size > 1) {
    warnings.push("XML mapping paths returned different lengths; values will be aligned by index.");
  }

  if (rowCount === 0) {
    errors.push("No XML entries detected for the provided mapping.");
    return {
      errors,
      warnings,
      entries: [],
      columns,
      sampleRows: [],
      detectedLanguages: [],
      mapping,
      stats: { rowCount, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const nowIso = new Date().toISOString();
  const entries: GlossaryImportEntry[] = [];
  let skippedRows = 0;
  let missingTermIds = 0;

  function valueFor(field: keyof GlossaryImportMapping, index: number): string {
    const values = fieldValues[field] || [];
    if (values.length === 0) return "";
    if (values.length === 1) return values[0] ?? "";
    return values[index] ?? "";
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const termRaw = String(valueFor("sourceTerm", rowIndex) ?? "").trim();
    const translationRaw = String(valueFor("targetTerm", rowIndex) ?? "").trim();
    if (!termRaw && !translationRaw) {
      skippedRows += 1;
      continue;
    }

    const termBlocks = parseLanguageBlocks(termRaw, params.settings.multiLanguageDelimiter);
    if (termBlocks?.error) {
      const message = `Row ${rowNumber}: ${termBlocks.error}`;
      if (params.settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }
    const translationBlocks = parseLanguageBlocks(translationRaw, params.settings.multiLanguageDelimiter);
    if (translationBlocks?.error) {
      const message = `Row ${rowNumber}: ${translationBlocks.error}`;
      if (params.settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }

    const termBlockList = termBlocks?.blocks ?? null;
    const translationBlockList = translationBlocks?.blocks ?? null;
    const combinedBlocks = termBlockList || translationBlockList;

    const sourceLangRaw = String(valueFor("sourceLang", rowIndex) ?? "") || params.languagesOverride[0] || "";
    const targetLangRaw = String(valueFor("targetLang", rowIndex) ?? "") || params.languagesOverride[1] || "";
    const sourceLangInput = sourceLangRaw.trim();
    const targetLangInput = targetLangRaw.trim();
    let sourceLang = "";
    let targetLang = "";
    let sourceInvalid = false;
    let targetInvalid = false;
    if (sourceLangInput) {
      sourceLang = resolveLanguage(sourceLangInput, rowNumber, "Source");
      if (params.settings.strictImport && !sourceLang) sourceInvalid = true;
    }
    if (targetLangInput) {
      targetLang = resolveLanguage(targetLangInput, rowNumber, "Target");
      if (params.settings.strictImport && !targetLang) targetInvalid = true;
    }

    if ((!sourceLang || !targetLang) && combinedBlocks && combinedBlocks.length >= 2) {
      if (!sourceLang) {
        const blockLang = combinedBlocks[0].lang;
        if (blockLang) {
          sourceLang = resolveLanguage(blockLang, rowNumber, "Source");
          if (params.settings.strictImport && !sourceLang) sourceInvalid = true;
        }
      }
      if (!targetLang) {
        const blockLang = combinedBlocks[1].lang;
        if (blockLang) {
          targetLang = resolveLanguage(blockLang, rowNumber, "Target");
          if (params.settings.strictImport && !targetLang) targetInvalid = true;
        }
      }
    }

    if (!sourceLang || !targetLang) {
      const invalidLanguage = params.settings.strictImport && (sourceInvalid || targetInvalid);
      if (!invalidLanguage) {
        const message = `Row ${rowNumber}: Missing language information.`;
        if (params.settings.strictImport) errors.push(message);
        else warnings.push(`${message} Row skipped.`);
      }
      skippedRows += 1;
      continue;
    }

    let term = termRaw;
    let translation = translationRaw;

    if (termBlockList) {
      const map = new Map(termBlockList.map((block) => [block.lang, block.text]));
      const fromMap = map.get(sourceLang);
      if (fromMap) term = fromMap;
    }
    if (translationBlockList) {
      const map = new Map(translationBlockList.map((block) => [block.lang, block.text]));
      const fromMap = map.get(targetLang);
      if (fromMap) translation = fromMap;
    }

    if (!term || !translation) {
      const message = `Row ${rowNumber}: Missing term/translation for selected languages.`;
      if (params.settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }

    let termId = String(valueFor("termId", rowIndex) ?? "").trim();
    if (!termId) {
      missingTermIds += 1;
      termId = autoTermId(`${params.importId}:${sourceLang}:${targetLang}:${term}:${translation}`);
    }

    const definition = String(valueFor("definition", rowIndex) ?? "").trim();
    const partOfSpeech = String(valueFor("partOfSpeech", rowIndex) ?? "").trim();
    const domain = String(valueFor("domain", rowIndex) ?? "").trim();
    const context = String(valueFor("context", rowIndex) ?? "").trim();
    const usageNote = String(valueFor("usageNote", rowIndex) ?? "").trim();
    const forbidden = parseBool(String(valueFor("forbidden", rowIndex) ?? ""));
    const preferred = parseBool(String(valueFor("preferred", rowIndex) ?? ""));
    const statusRaw = String(valueFor("status", rowIndex) ?? "").trim();
    let status: TermStatus | null = null;
    if (statusRaw) {
      const statusResult = parseStatusValue(statusRaw);
      status = statusResult.status;
      if (!status) {
        const message = `Row ${rowNumber}: Status \"${statusRaw}\" is not recognized.`;
        if (params.settings.strictImport) {
          errors.push(message);
          skippedRows += 1;
          continue;
        }
        warnings.push(`${message} Status ignored.`);
      }
    }
    const synonyms = splitList(String(valueFor("synonyms", rowIndex) ?? ""), params.settings.synonymSeparator);
    const tags = splitList(String(valueFor("tags", rowIndex) ?? ""), params.settings.multiValueSeparator);
    const notes = String(valueFor("notes", rowIndex) ?? "").trim();

    const createdByRaw = String(valueFor("createdBy", rowIndex) ?? "");
    const createdAtRaw = String(valueFor("createdAt", rowIndex) ?? "");
    const updatedByRaw = String(valueFor("updatedBy", rowIndex) ?? "");
    const updatedAtRaw = String(valueFor("updatedAt", rowIndex) ?? "");

    const createdBy = createdByRaw.trim() ? normalizeUser(createdByRaw) : params.uploadedBy;
    const createdAt = parseTimestampOrNull(createdAtRaw) || nowIso;
    const updatedBy = updatedByRaw.trim() ? normalizeUser(updatedByRaw) : createdBy;
    const updatedAt = parseTimestampOrNull(updatedAtRaw) || createdAt;

    const imageId = String(valueFor("imageId", rowIndex) ?? "").trim();
    const imageFilename = String(valueFor("imageFilename", rowIndex) ?? "").trim();
    const explicitImageRef = Boolean(imageFilename || imageId);
    const imageRef = explicitImageRef ? (imageFilename || imageId) : termId;

    const meta: Record<string, any> = {};
    if (definition) meta.definition = definition;
    if (partOfSpeech) meta.partOfSpeech = partOfSpeech;
    if (domain) meta.domain = domain;
    if (context) meta.context = context;
    if (usageNote) meta.usageNote = usageNote;
    if (status) {
      applyStatusToMeta(meta, status);
    } else if (forbidden === true) {
      applyStatusToMeta(meta, "forbidden");
    } else if (preferred === true) {
      applyStatusToMeta(meta, "preferred");
    }
    if (synonyms.length > 0) meta.synonyms = synonyms;
    if (tags.length > 0) meta.tags = tags;
    if (imageId) meta.imageId = imageId;
    if (imageFilename) meta.imageFilename = imageFilename;

    entries.push({
      termId,
      sourceLang,
      targetLang,
      term,
      translation,
      notes: notes || null,
      createdBy,
      createdAt,
      updatedBy,
      updatedAt,
      meta,
      imageRef,
      explicitImageRef
    });
  }

  appendMissingLanguageErrors(errors, missingLanguageTags);
  if (entries.length === 0) {
    errors.push("No valid XML rows found.");
  }
  if (missingTermIds > 0) {
    warnings.push("Some entries are missing term IDs; IDs will be auto-generated.");
  }
  if (skippedRows > 0) {
    warnings.push(`Skipped ${skippedRows} row${skippedRows === 1 ? "" : "s"} with missing required values.`);
  }

  const languageSet = new Set<string>();
  entries.forEach((entry) => {
    languageSet.add(entry.sourceLang);
    languageSet.add(entry.targetLang);
  });

  return {
    errors,
    warnings,
    entries,
    columns,
    sampleRows: [],
    detectedLanguages: Array.from(languageSet),
    mapping,
    stats: { rowCount, skippedRows, missingTermIds }
  };
}

export function parseXmlImport(params: {
  text: string;
  filename: string | null;
  importId: number;
  uploadedBy: string;
  importType: GlossaryImportType;
  mapping: GlossaryImportMapping;
  settings: GlossaryImportSettings;
  languagesOverride: string[];
  languageSettings: OrgLanguageSettings;
  catalogByTag: Map<string, LanguageCatalogEntry>;
  structure?: any;
}): GlossaryImportParseData {
  if (params.importType === "xml") {
    return parseGenericXmlImport({
      text: params.text,
      mapping: params.mapping,
      settings: params.settings,
      languagesOverride: params.languagesOverride,
      importId: params.importId,
      uploadedBy: params.uploadedBy,
      languageSettings: params.languageSettings,
      catalogByTag: params.catalogByTag
    });
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const missingLanguageTags = new Set<string>();
  const resolveLanguage = buildLanguageResolver({
    settings: params.settings,
    enabledTags: params.languageSettings.enabledLanguageTags,
    languageSettings: params.languageSettings,
    catalogByTag: params.catalogByTag,
    errors,
    warnings,
    missingLanguageTags
  });
  let parsed: any[] = [];
  try {
    parsed = parseGlossaryContent({ filename: params.filename, data: params.text });
  } catch (err: any) {
    errors.push(err?.message || "Failed to parse XML/TBX file.");
    return {
      errors,
      warnings,
      entries: [],
      detectedLanguages: [],
      columns: [],
      sampleRows: [],
      mapping: {},
      stats: { rowCount: 0, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const entries: GlossaryImportEntry[] = [];
  let missingTermIds = 0;
  let skippedRows = 0;
  const nowIso = new Date().toISOString();
  parsed.forEach((row, idx) => {
    const rowNumber = idx + 1;
    const sourceLangRaw = String(row.sourceLang ?? "");
    const targetLangRaw = String(row.targetLang ?? "");
    const sourceLangInput = sourceLangRaw.trim();
    const targetLangInput = targetLangRaw.trim();
    let sourceLang = "";
    let targetLang = "";
    let sourceInvalid = false;
    let targetInvalid = false;
    if (sourceLangInput) {
      sourceLang = resolveLanguage(sourceLangInput, rowNumber, "Source");
      if (params.settings.strictImport && !sourceLang) sourceInvalid = true;
    }
    if (targetLangInput) {
      targetLang = resolveLanguage(targetLangInput, rowNumber, "Target");
      if (params.settings.strictImport && !targetLang) targetInvalid = true;
    }
    const term = String(row.term ?? "").trim();
    const translation = String(row.translation ?? "").trim();
    if (!sourceLang || !targetLang) {
      const invalidLanguage = params.settings.strictImport && (sourceInvalid || targetInvalid);
      if (!invalidLanguage) {
        const message = `Row ${rowNumber}: Missing language information.`;
        if (params.settings.strictImport) errors.push(message);
        else warnings.push(`${message} Row skipped.`);
      }
      skippedRows += 1;
      return;
    }
    if (!term || !translation) {
      const message = `Row ${rowNumber}: Missing term/translation for selected languages.`;
      if (params.settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      return;
    }

    let termId = String(row.conceptId ?? "").trim();
    if (!termId) {
      missingTermIds += 1;
      termId = autoTermId(`${params.importId}:${sourceLang}:${targetLang}:${term}:${translation}`);
    }

    const meta: Record<string, any> = {};
    if (row.sourceType) meta.sourceType = row.sourceType;
    if (row.originAuthor) meta.originAuthor = row.originAuthor;
    if (row.originDate) meta.originDate = row.originDate;
    if (row.origin) meta.origin = row.origin;

    const mappedDescrips = mapXmlDescripsToCustomFields({
      entryDescrips: row.entryDescrips ?? null,
      languageDescrips: row.languageDescrips ?? null,
      termDescrips: row.termDescrips ?? null,
      structure: params.structure
    });
    if (Object.keys(mappedDescrips.entryFields).length > 0) {
      meta.entry_fields = mappedDescrips.entryFields;
    }
    if (Object.keys(mappedDescrips.languageFields).length > 0) {
      meta.language_fields = mappedDescrips.languageFields;
    }
    if (Object.keys(mappedDescrips.termFields).length > 0) {
      meta.term_fields = mappedDescrips.termFields;
    }
    const rawEntryDescrips = mappedDescrips.rawDescrips.entry;
    const rawLanguageDescrips = mappedDescrips.rawDescrips.language;
    const rawTermDescrips = mappedDescrips.rawDescrips.term;
    const hasRawEntry = rawEntryDescrips && Object.keys(rawEntryDescrips).length > 0;
    const hasRawLanguage = rawLanguageDescrips && Object.keys(rawLanguageDescrips).length > 0;
    const hasRawTerm = rawTermDescrips && Object.keys(rawTermDescrips).length > 0;
    if (hasRawEntry || hasRawLanguage || hasRawTerm) {
      meta._raw_descrip = {
        ...(hasRawEntry ? { entry: rawEntryDescrips } : {}),
        ...(hasRawLanguage ? { language: rawLanguageDescrips } : {}),
        ...(hasRawTerm ? { term: rawTermDescrips } : {})
      };
    }

    const entryAudit =
      row.entryAudit && typeof row.entryAudit === "object" && !Array.isArray(row.entryAudit)
        ? row.entryAudit
        : null;
    if (entryAudit) {
      const values = [
        (entryAudit as any).createdAt,
        (entryAudit as any).createdBy,
        (entryAudit as any).modifiedAt,
        (entryAudit as any).modifiedBy
      ];
      if (values.some((value) => String(value ?? "").trim())) {
        meta.audit = {
          createdAt: (entryAudit as any).createdAt ?? null,
          createdBy: (entryAudit as any).createdBy ?? null,
          modifiedAt: (entryAudit as any).modifiedAt ?? null,
          modifiedBy: (entryAudit as any).modifiedBy ?? null
        };
      }
    }

    const termAudit =
      row.termAudit && typeof row.termAudit === "object" && !Array.isArray(row.termAudit)
        ? row.termAudit
        : null;
    if (termAudit && Object.keys(termAudit as Record<string, any>).length > 0) {
      meta.term_audit = termAudit;
    }

    const termDescrips = row.termDescrips?.[sourceLang]?.[term] ?? null;
    const statusValue = resolveDescripValue(termDescrips, "status");
    if (statusValue) {
      const statusResult = parseStatusValue(statusValue);
      if (statusResult.status) {
        applyStatusToMeta(meta, statusResult.status);
      }
    }

    let imageRef = termId;
    let explicitImageRef = false;
    const illustrationValue =
      resolveDescripValue(row.entryDescrips ?? null, "graphic") ??
      resolveDescripValue(row.entryDescrips ?? null, "illustration");
    if (illustrationValue) {
      imageRef = illustrationValue.split(/\r?\n/)[0]?.trim() || illustrationValue.trim();
      explicitImageRef = Boolean(imageRef);
    }

    entries.push({
      termId,
      sourceLang,
      targetLang,
      term,
      translation,
      notes: null,
      createdBy: row.createdBy ?? params.uploadedBy,
      createdAt: row.createdAt ?? nowIso,
      updatedBy: row.createdBy ?? params.uploadedBy,
      updatedAt: row.createdAt ?? nowIso,
      meta,
      imageRef,
      explicitImageRef
    });
  });

  appendMissingLanguageErrors(errors, missingLanguageTags);
  if (entries.length === 0) {
    errors.push("No terms detected in the XML/TBX file.");
  }
  if (missingTermIds > 0) {
    warnings.push("Some entries are missing term IDs; IDs will be auto-generated.");
  }
  if (skippedRows > 0) {
    warnings.push(`Skipped ${skippedRows} row${skippedRows === 1 ? "" : "s"} with missing required values.`);
  }

  const languageSet = new Set<string>();
  entries.forEach((entry) => {
    languageSet.add(entry.sourceLang);
    languageSet.add(entry.targetLang);
  });

  return {
    errors,
    warnings,
    entries,
    detectedLanguages: Array.from(languageSet),
    columns: [],
    sampleRows: [],
    mapping: {},
    stats: { rowCount: parsed.length, skippedRows, missingTermIds }
  };
}

