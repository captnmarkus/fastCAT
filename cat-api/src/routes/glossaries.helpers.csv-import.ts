import { type LanguageCatalogEntry } from "../lib/language-catalog.js";
import { type OrgLanguageSettings } from "../lib/org-languages.js";
import {
  type GlossaryImportColumn,
  type GlossaryImportEntry,
  type GlossaryImportMapping,
  type GlossaryImportParseData,
  type GlossaryImportSettings,
  type TermStatus,
  appendMissingLanguageErrors,
  applyStatusToMeta,
  autoTermId,
  buildCsvSampleRows,
  buildLanguageResolver,
  parseBool,
  parseCsv,
  parseLanguageBlocks,
  parseStatusValue,
  resolveMappingIndex,
  splitList,
  suggestMapping,
  normalizeHeader,
  normalizeUser,
  parseTimestampOrNull
} from "./glossaries.helpers.import-utils.js";

export function parseCsvImport(params: {
  text: string;
  mapping: GlossaryImportMapping | null;
  languagesOverride: string[];
  importId: number;
  uploadedBy: string;
  settings: GlossaryImportSettings;
  languageSettings: OrgLanguageSettings;
  catalogByTag: Map<string, LanguageCatalogEntry>;
}): GlossaryImportParseData {
  const { headers, rows } = parseCsv(params.text);
  const errors: string[] = [];
  const warnings: string[] = [];
  const settings = params.settings;
  const missingLanguageTags = new Set<string>();
  const resolveLanguage = buildLanguageResolver({
    settings,
    enabledTags: params.languageSettings.enabledLanguageTags,
    languageSettings: params.languageSettings,
    catalogByTag: params.catalogByTag,
    errors,
    warnings,
    missingLanguageTags
  });

  if (headers.length === 0) {
    errors.push("CSV must include a header row.");
    return {
      errors,
      warnings,
      entries: [],
      columns: [],
      sampleRows: [],
      detectedLanguages: [],
      mapping: {},
      stats: { rowCount: rows.length, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const normalizedHeaders = headers.map(normalizeHeader);
  const headerIndex = new Map<string, number>();
  normalizedHeaders.forEach((h, idx) => {
    if (!headerIndex.has(h)) headerIndex.set(h, idx);
  });

  const columns: GlossaryImportColumn[] = headers.map((name, idx) => ({
    name,
    normalized: normalizedHeaders[idx]
  }));

  const suggestion = suggestMapping(headerIndex);
  const mapping = { ...suggestion, ...(params.mapping || {}) };

  const idxSourceTerm = resolveMappingIndex(headerIndex, mapping.sourceTerm);
  const idxTargetTerm = resolveMappingIndex(headerIndex, mapping.targetTerm);
  if (idxSourceTerm == null || idxTargetTerm == null) {
    errors.push("CSV mapping must include source term and target term.");
  }

  const idxSourceLang = resolveMappingIndex(headerIndex, mapping.sourceLang);
  const idxTargetLang = resolveMappingIndex(headerIndex, mapping.targetLang);
  const overrideLangs = params.languagesOverride;
  const hasLanguageOverride = overrideLangs.length >= 2;
  const hasLanguageDelimiter = Boolean(settings.multiLanguageDelimiter?.trim());
  if ((idxSourceLang == null || idxTargetLang == null) && !hasLanguageOverride && !hasLanguageDelimiter) {
    errors.push("CSV mapping must include source/target languages, specify languages in Basics, or provide multi-language tags.");
  }

  if (errors.length > 0) {
    return {
      errors,
      warnings,
      entries: [],
      columns,
      sampleRows: buildCsvSampleRows(headers, rows),
      detectedLanguages: [],
      mapping,
      stats: { rowCount: rows.length, skippedRows: 0, missingTermIds: 0 }
    };
  }

  const nowIso = new Date().toISOString();
  const entries: GlossaryImportEntry[] = [];
  let skippedRows = 0;
  let missingTermIds = 0;

  const idxTermId = resolveMappingIndex(headerIndex, mapping.termId);
  const idxDefinition = resolveMappingIndex(headerIndex, mapping.definition);
  const idxPartOfSpeech = resolveMappingIndex(headerIndex, mapping.partOfSpeech);
  const idxDomain = resolveMappingIndex(headerIndex, mapping.domain);
  const idxContext = resolveMappingIndex(headerIndex, mapping.context);
  const idxUsage = resolveMappingIndex(headerIndex, mapping.usageNote);
  const idxForbidden = resolveMappingIndex(headerIndex, mapping.forbidden);
  const idxPreferred = resolveMappingIndex(headerIndex, mapping.preferred);
  const idxStatus = resolveMappingIndex(headerIndex, mapping.status);
  const idxSynonyms = resolveMappingIndex(headerIndex, mapping.synonyms);
  const idxTags = resolveMappingIndex(headerIndex, mapping.tags);
  const idxCreatedBy = resolveMappingIndex(headerIndex, mapping.createdBy);
  const idxCreatedAt = resolveMappingIndex(headerIndex, mapping.createdAt);
  const idxUpdatedBy = resolveMappingIndex(headerIndex, mapping.updatedBy);
  const idxUpdatedAt = resolveMappingIndex(headerIndex, mapping.updatedAt);
  const idxNotes = resolveMappingIndex(headerIndex, mapping.notes);
  const idxImageId = resolveMappingIndex(headerIndex, mapping.imageId);
  const idxImageFilename = resolveMappingIndex(headerIndex, mapping.imageFilename);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 2;
    const termRaw = idxSourceTerm != null ? String(row[idxSourceTerm] ?? "").trim() : "";
    const translationRaw = idxTargetTerm != null ? String(row[idxTargetTerm] ?? "").trim() : "";
    if (!termRaw && !translationRaw) {
      skippedRows += 1;
      continue;
    }

    const termBlocks = parseLanguageBlocks(termRaw, settings.multiLanguageDelimiter);
    if (termBlocks?.error) {
      const message = `Row ${rowNumber}: ${termBlocks.error}`;
      if (settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }
    const translationBlocks = parseLanguageBlocks(translationRaw, settings.multiLanguageDelimiter);
    if (translationBlocks?.error) {
      const message = `Row ${rowNumber}: ${translationBlocks.error}`;
      if (settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }

    const termBlockList = termBlocks?.blocks ?? null;
    const translationBlockList = translationBlocks?.blocks ?? null;
    const combinedBlocks = termBlockList || translationBlockList;

    const sourceLangRaw = idxSourceLang != null ? String(row[idxSourceLang] ?? "") : overrideLangs[0] || "";
    const targetLangRaw = idxTargetLang != null ? String(row[idxTargetLang] ?? "") : overrideLangs[1] || "";
    const sourceLangInput = sourceLangRaw.trim();
    const targetLangInput = targetLangRaw.trim();
    let sourceLang = "";
    let targetLang = "";
    let sourceInvalid = false;
    let targetInvalid = false;
    if (sourceLangInput) {
      sourceLang = resolveLanguage(sourceLangInput, rowNumber, "Source");
      if (settings.strictImport && !sourceLang) sourceInvalid = true;
    }
    if (targetLangInput) {
      targetLang = resolveLanguage(targetLangInput, rowNumber, "Target");
      if (settings.strictImport && !targetLang) targetInvalid = true;
    }
    if ((!sourceLang || !targetLang) && combinedBlocks && combinedBlocks.length >= 2) {
      if (!sourceLang) {
        const blockLang = combinedBlocks[0].lang;
        if (blockLang) {
          sourceLang = resolveLanguage(blockLang, rowNumber, "Source");
          if (settings.strictImport && !sourceLang) sourceInvalid = true;
        }
      }
      if (!targetLang) {
        const blockLang = combinedBlocks[1].lang;
        if (blockLang) {
          targetLang = resolveLanguage(blockLang, rowNumber, "Target");
          if (settings.strictImport && !targetLang) targetInvalid = true;
        }
      }
    }
    if (!sourceLang || !targetLang) {
      const invalidLanguage = settings.strictImport && (sourceInvalid || targetInvalid);
      if (!invalidLanguage) {
        const message = `Row ${rowNumber}: Missing language information.`;
        if (settings.strictImport) errors.push(message);
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
      if (settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }

    let termId = idxTermId != null ? String(row[idxTermId] ?? "").trim() : "";
    if (!termId) {
      missingTermIds += 1;
      termId = autoTermId(`${params.importId}:${sourceLang}:${targetLang}:${term}:${translation}`);
    }

    const definition = idxDefinition != null ? String(row[idxDefinition] ?? "").trim() : "";
    const partOfSpeech = idxPartOfSpeech != null ? String(row[idxPartOfSpeech] ?? "").trim() : "";
    const domain = idxDomain != null ? String(row[idxDomain] ?? "").trim() : "";
    const context = idxContext != null ? String(row[idxContext] ?? "").trim() : "";
    const usageNote = idxUsage != null ? String(row[idxUsage] ?? "").trim() : "";
    const forbidden = idxForbidden != null ? parseBool(String(row[idxForbidden] ?? "")) : null;
    const preferred = idxPreferred != null ? parseBool(String(row[idxPreferred] ?? "")) : null;
    const statusRaw = idxStatus != null ? String(row[idxStatus] ?? "").trim() : "";
    let status: TermStatus | null = null;
    if (statusRaw) {
      const statusResult = parseStatusValue(statusRaw);
      status = statusResult.status;
      if (!status) {
        const message = `Row ${rowNumber}: Status "${statusRaw}" is not recognized.`;
        if (settings.strictImport) {
          errors.push(message);
          skippedRows += 1;
          continue;
        }
        warnings.push(`${message} Status ignored.`);
      }
    }
    const synonyms = idxSynonyms != null ? splitList(String(row[idxSynonyms] ?? ""), settings.synonymSeparator) : [];
    const tags = idxTags != null ? splitList(String(row[idxTags] ?? ""), settings.multiValueSeparator) : [];
    const notes = idxNotes != null ? String(row[idxNotes] ?? "").trim() : "";

    const createdByRaw = idxCreatedBy != null ? String(row[idxCreatedBy] ?? "") : "";
    const createdAtRaw = idxCreatedAt != null ? String(row[idxCreatedAt] ?? "") : "";
    const updatedByRaw = idxUpdatedBy != null ? String(row[idxUpdatedBy] ?? "") : "";
    const updatedAtRaw = idxUpdatedAt != null ? String(row[idxUpdatedAt] ?? "") : "";

    const createdBy = createdByRaw.trim() ? normalizeUser(createdByRaw) : params.uploadedBy;
    const createdAt = parseTimestampOrNull(createdAtRaw) || nowIso;
    const updatedBy = updatedByRaw.trim() ? normalizeUser(updatedByRaw) : createdBy;
    const updatedAt = parseTimestampOrNull(updatedAtRaw) || createdAt;

    const imageId = idxImageId != null ? String(row[idxImageId] ?? "").trim() : "";
    const imageFilename = idxImageFilename != null ? String(row[idxImageFilename] ?? "").trim() : "";
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

    const entriesForRow: Array<{
      sourceLang: string;
      targetLang: string;
      term: string;
      translation: string;
    }> = [];

    const canExpand =
      combinedBlocks &&
      combinedBlocks.length > 1 &&
      idxSourceLang == null &&
      idxTargetLang == null &&
      overrideLangs.length < 2 &&
      (!translationRaw || Boolean(translationBlockList));

    if (canExpand) {
      const sourceBlock = combinedBlocks[0];
      if (sourceBlock && sourceBlock.text) {
        const resolvedSource = resolveLanguage(sourceBlock.lang, rowNumber, "Source");
        if (!resolvedSource) {
          skippedRows += 1;
          continue;
        }
        for (const block of combinedBlocks.slice(1)) {
          if (!block.lang || !block.text) continue;
          const resolvedTarget = resolveLanguage(block.lang, rowNumber, "Target");
          if (!resolvedTarget) continue;
          entriesForRow.push({
            sourceLang: resolvedSource,
            targetLang: resolvedTarget,
            term: sourceBlock.text,
            translation: block.text
          });
        }
      }
    } else {
      entriesForRow.push({ sourceLang, targetLang, term, translation });
    }

    if (entriesForRow.length === 0) {
      const message = `Row ${rowNumber}: Multi-language cell could not be expanded.`;
      if (settings.strictImport) errors.push(message);
      else warnings.push(`${message} Row skipped.`);
      skippedRows += 1;
      continue;
    }

    for (const entry of entriesForRow) {
      entries.push({
        termId,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        term: entry.term,
        translation: entry.translation,
        notes: notes || null,
        createdBy,
        createdAt,
        updatedBy,
        updatedAt,
        meta,
        imageRef: imageRef || null,
        explicitImageRef
      });
    }
  }

  appendMissingLanguageErrors(errors, missingLanguageTags);
  if (entries.length === 0) {
    errors.push("No valid glossary rows found.");
  }
  if (missingTermIds > 0) {
    warnings.push("Some entries are missing term IDs; IDs will be auto-generated.");
  }
  if (skippedRows > 0) {
    warnings.push(`Skipped ${skippedRows} row${skippedRows === 1 ? "" : "s"} with missing required values.`);
  }
  if ((idxSourceLang == null || idxTargetLang == null) && hasLanguageOverride) {
    warnings.push("Using languages from Basics because CSV language columns were not mapped.");
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
    sampleRows: buildCsvSampleRows(headers, rows),
    detectedLanguages: Array.from(languageSet),
    mapping,
    stats: { rowCount: rows.length, skippedRows, missingTermIds }
  };
}
