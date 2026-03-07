import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { requireManagerOrAdmin, requireAuth, getRequestUser, requestUserId } from "../middleware/auth.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import { copyObject, getObjectBuffer, getS3Bucket, presignGetObject, putObjectBuffer, sha256Hex } from "../lib/s3.js";
import { keyTerminologyImage, keyTerminologyImportImage, keyTerminologyImportSource, keyTerminologyUpload } from "../lib/storage-keys.js";
import { insertAuditEvent } from "../lib/audit.js";
import { decodeGlossaryBuffer, parseGlossaryContent } from "../lib/glossary-utils.js";
import { canonicalizeLanguageTag, getCatalogByTag, normalizeLanguageTag, type LanguageCatalogEntry } from "../lib/language-catalog.js";
import {
  mapXmlDescripsToCustomFields,
  normalizeFieldLabel
} from "../lib/termbase-import.js";
import {
  getOrgLanguageSettings,
  resolveLanguageMatch,
  type OrgLanguageSettings
} from "../lib/org-languages.js";
import crypto from "crypto";
import path from "path";
import AdmZip from "adm-zip";
import xpath from "xpath";
import { DOMParser } from "@xmldom/xmldom";

import {
  appendMissingLanguageErrors,
  applyStatusToMeta,
  autoTermId,
  buildCsvSampleRows,
  buildImageMap,
  buildImagePreview,
  buildLanguageResolver,
  buildPicklistFieldRefs,
  collectPicklistUpdates,
  CSV_MAPPING_FIELDS,
  dedupeEntries,
  DEFAULT_IMPORT_SETTINGS,
  ensureGlossaryLanguages,
  entryLabel,
  evaluateXPathValues,
  extractXmlColumns,
  FRIENDLY_HEADER_FORMATS,
  GlossaryEntryRow,
  GlossaryImportColumn,
  GlossaryImportEntry,
  GlossaryImportImage,
  GlossaryImportMapping,
  GlossaryImportParseData,
  GlossaryImportRow,
  GlossaryImportSettings,
  GlossaryImportStats,
  GlossaryImportType,
  GlossaryListItem,
  GlossaryRow,
  HEADER_ALIASES,
  IMAGE_CONTENT_TYPES,
  IMAGE_EXTENSIONS,
  isAllowedImageFilename,
  LANGUAGE_NAME_MAP,
  LanguageBlock,
  mapGlossary,
  matchImages,
  mergeImportSettings,
  normalizeGlossaryLanguages,
  normalizeHeader,
  normalizeImageManifest,
  normalizeImportSettings,
  normalizeImportType,
  normalizeLang,
  normalizeLanguages,
  normalizeMapping,
  normalizePicklistKey,
  normalizePicklistValue,
  normalizeStatusKey,
  normalizeUser,
  parseBool,
  parseCsv,
  parseCsvImport,
  parseGenericXmlImport,
  parseJsonField,
  parseLanguageBlocks,
  parseStatusValue,
  parseTimestampOrNull,
  parseXlsxToCsv,
  parseXmlDocument,
  parseXmlImport,
  PICKLIST_FIELD_ALIASES,
  PicklistFieldRef,
  REQUIRED_HEADERS,
  RequiredHeader,
  resolveAnyHeaderIndex,
  resolveDescripValue,
  resolveHeaderIndex,
  resolveMappingIndex,
  resolvePicklistField,
  rowToGlossaryEntry,
  sanitizeUploadFilename,
  splitList,
  STATUS_ALIASES,
  statusLabelFromMeta,
  suggestMapping,
  TermStatus,
  toCsvLine,
  xmlValueFromNode
} from './glossaries.helpers.js';

export function registerTermbaseImportRoutes(app: FastifyInstance) {
  // Import into existing termbase
  app.post("/termbases/:id/import/commit", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const body = (req.body as any) || {};
    const importId = Number(body.importId ?? body.import_id);
    if (!Number.isFinite(importId) || importId <= 0) {
      return reply.code(400).send({ error: "importId is required." });
    }

    const duplicateStrategyRaw = String(body.duplicateStrategy ?? body.duplicate_strategy ?? "skip").toLowerCase();
    const duplicateStrategy =
      duplicateStrategyRaw === "merge"
        ? "merge"
        : duplicateStrategyRaw === "overwrite"
          ? "overwrite"
          : "skip";
    const strictImages = Boolean(body.strictImages ?? body.strict_images);

    const mappingRaw = body.mapping;
    const settingsPayload =
      typeof body.settings === "string"
        ? parseJsonField<any>(body.settings)
        : body.settings && typeof body.settings === "object"
          ? body.settings
          : null;

    const importRes = await db.query<GlossaryImportRow>(
      `SELECT id, import_type, status, label, description, languages, settings_json, visibility,
              source_filename, source_object_key, source_sha256, source_size_bytes, source_content_type,
              images_manifest, created_by, created_at, updated_at
       FROM glossary_imports
       WHERE id = $1`,
      [importId]
    );
    const importRow = importRes.rows[0];
    if (!importRow) {
      return reply.code(404).send({ error: "Import session not found." });
    }

    const importType = normalizeImportType(importRow.import_type);
    if (!importType || importType === "empty") {
      return reply.code(400).send({ error: "Invalid import type." });
    }
    const mapping = normalizeMapping(mappingRaw, { allowPaths: importType === "xml" });

    const glossaryRes = await db.query<{
      id: number;
      languages: any;
      default_source_lang?: string | null;
      default_target_lang?: string | null;
      structure_json?: any;
    }>(
      `SELECT id, languages, default_source_lang, default_target_lang, structure_json
       FROM glossaries
       WHERE id = $1`,
      [glossaryId]
    );
    const glossaryRow = glossaryRes.rows[0];
    if (!glossaryRow) {
      return reply.code(404).send({ error: "Termbase not found." });
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const actorUserId =
      typeof (getRequestUser(req) as any)?.sub === "number"
        ? (getRequestUser(req) as any).sub
        : /^\d+$/.test(String((getRequestUser(req) as any)?.sub ?? ""))
          ? Number((getRequestUser(req) as any).sub)
          : null;

    const resolvedSettings = mergeImportSettings(
      {
        ...(settingsPayload || {}),
        synonymSeparator: body.synonymSeparator ?? body.synonym_separator,
        multiValueSeparator: body.multiValueSeparator ?? body.multi_value_separator,
        multiLanguageDelimiter: body.multiLanguageDelimiter ?? body.multi_language_delimiter,
        strictImport: body.strictImport ?? body.strict_import
      },
      importRow.settings_json
    );

    await db.query(
      `UPDATE glossary_imports
       SET settings_json = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(resolvedSettings), importRow.id]
    );

    if (!importRow.source_object_key) {
      return reply.code(400).send({ error: "No source file uploaded for this import." });
    }

    const stored = await getObjectBuffer({ key: importRow.source_object_key });
    let text = "";
    try {
      text = importType === "xlsx" ? await parseXlsxToCsv(stored.buf) : decodeGlossaryBuffer(stored.buf);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Failed to parse import file." });
    }
    const languageSettings = await getOrgLanguageSettings();
    const catalogByTag = getCatalogByTag();

    let languagesOverride = normalizeLanguages(body.languages ?? body.language ?? "");
    if (languagesOverride.length === 0) {
      const defaults: string[] = [];
      if (glossaryRow.default_source_lang) defaults.push(glossaryRow.default_source_lang);
      if (
        glossaryRow.default_target_lang &&
        glossaryRow.default_target_lang !== glossaryRow.default_source_lang
      ) {
        defaults.push(glossaryRow.default_target_lang);
      }
      languagesOverride = normalizeLanguages(defaults);
    }

    let parseResult: ReturnType<typeof parseCsvImport> | ReturnType<typeof parseXmlImport>;
    if (importType === "csv" || importType === "xlsx") {
      parseResult = parseCsvImport({
        text,
        mapping,
        languagesOverride,
        importId: importRow.id,
        uploadedBy: actor,
        settings: resolvedSettings,
        languageSettings,
        catalogByTag
      });
    } else {
      parseResult = parseXmlImport({
        text,
        filename: importRow.source_filename,
        importId: importRow.id,
        uploadedBy: actor,
        importType,
        mapping,
        settings: resolvedSettings,
        languagesOverride,
        languageSettings,
        catalogByTag
      });
    }

    if (parseResult.errors.length > 0) {
      return reply.code(400).send({ error: parseResult.errors.join(" ") });
    }

    let entries = parseResult.entries;
    const deduped = dedupeEntries(entries, "skip");
    entries = deduped.entries;

    const picklistResult = collectPicklistUpdates({
      entries,
      structure: glossaryRow.structure_json,
      strict: resolvedSettings.strictImport
    });
    if (picklistResult.errors.length > 0) {
      return reply.code(400).send({ error: picklistResult.errors.join(" ") });
    }
    const picklistWarnings = picklistResult.warnings;
    const updatedStructure = picklistResult.updatedStructure;
    const structurePayload = updatedStructure ?? glossaryRow.structure_json ?? {};
    const structureChanged =
      JSON.stringify(structurePayload ?? {}) !== JSON.stringify(glossaryRow.structure_json ?? {});

    const parsedStats = parseResult.stats ?? {
      rowCount: parseResult.entries.length,
      skippedRows: 0,
      missingTermIds: 0
    };
    const dedupeSkipped = Math.max(0, parseResult.entries.length - entries.length);
    const reportWarnings = [...parseResult.warnings, ...deduped.warnings, ...picklistWarnings];
    let baseSkipped = (parsedStats.skippedRows ?? 0) + dedupeSkipped;

    if (entries.length === 0) {
      return reply.code(400).send({ error: "No valid glossary entries to import." });
    }

    const imagesManifest = normalizeImageManifest(importRow.images_manifest);
    const imageMatch = matchImages(entries, imagesManifest);
    if (strictImages && imageMatch.missingRefs.length > 0) {
      return reply.code(400).send({ error: "Missing referenced images." });
    }
    if (imageMatch.missingRefs.length > 0) {
      reportWarnings.push("Some referenced images are missing.");
    }
    if (imageMatch.unused.length > 0) {
      reportWarnings.push("Some uploaded images were not referenced by any entry.");
    }

    const nowIso = new Date().toISOString();
    const pairKey = (entry: GlossaryImportEntry) =>
      `${entry.sourceLang}\u0000${entry.targetLang}\u0000${entry.term.toLowerCase()}\u0000${entry.translation.toLowerCase()}`;

    const uniquePairs = Array.from(
      new Map(
        entries.map((entry) => [
          pairKey(entry),
          { sourceLang: entry.sourceLang, targetLang: entry.targetLang, term: entry.term, translation: entry.translation }
        ])
      ).values()
    );

    const result = await withTransaction(async (client) => {
      let updatedCount = 0;
      let skippedCount = 0;
      const inserted: Array<{ id: number; concept_id: string | null }> = [];

      if (duplicateStrategy === "overwrite" && uniquePairs.length > 0) {
        const CHUNK_SIZE = 300;
        for (let offset = 0; offset < uniquePairs.length; offset += CHUNK_SIZE) {
          const chunk = uniquePairs.slice(offset, offset + CHUNK_SIZE);
          const params: any[] = [glossaryId];
          const valuesSql = chunk
            .map((pair, index) => {
              const base = index * 4 + 2;
              params.push(pair.sourceLang, pair.targetLang, pair.term, pair.translation);
              return `($${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
            })
            .join(", ");
          await client.query(
            `WITH incoming(source_lang, target_lang, term, translation) AS (VALUES ${valuesSql})
             DELETE FROM glossary_entries e
             USING incoming i
             WHERE e.glossary_id = $1
               AND e.source_lang = i.source_lang
               AND e.target_lang = i.target_lang
               AND e.term = i.term
               AND e.translation = i.translation`,
            params
          );
        }
      }

      const existingByPair = new Map<
        string,
        { id: number; concept_id: string | null; notes: string | null; meta_json: any }
      >();

      if (duplicateStrategy !== "overwrite" && uniquePairs.length > 0) {
        const CHUNK_SIZE = 300;
        for (let offset = 0; offset < uniquePairs.length; offset += CHUNK_SIZE) {
          const chunk = uniquePairs.slice(offset, offset + CHUNK_SIZE);
          const params: any[] = [glossaryId];
          const valuesSql = chunk
            .map((pair, index) => {
              const base = index * 4 + 2;
              params.push(pair.sourceLang, pair.targetLang, pair.term, pair.translation);
              return `($${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
            })
            .join(", ");
          const rowsRes = await client.query<{
            id: number;
            concept_id: string | null;
            source_lang: string;
            target_lang: string;
            term: string;
            translation: string;
            notes: string | null;
            meta_json: any;
          }>(
            `WITH incoming(source_lang, target_lang, term, translation) AS (VALUES ${valuesSql})
             SELECT e.id, e.concept_id, e.source_lang, e.target_lang, e.term, e.translation, e.notes, e.meta_json
             FROM glossary_entries e
             JOIN incoming i
               ON e.source_lang = i.source_lang
              AND e.target_lang = i.target_lang
              AND e.term = i.term
              AND e.translation = i.translation
             WHERE e.glossary_id = $1`,
            params
          );
          rowsRes.rows.forEach((row) => {
            const key = `${row.source_lang}\u0000${row.target_lang}\u0000${row.term.toLowerCase()}\u0000${row.translation.toLowerCase()}`;
            existingByPair.set(key, row);
          });
        }
      }

      const toInsert: GlossaryImportEntry[] = [];
      const toUpdate: Array<{
        id: number;
        notes: string | null;
        meta: Record<string, any>;
        conceptId: string | null;
      }> = [];

      for (const entry of entries) {
        const key = pairKey(entry);
        const existing = existingByPair.get(key);
        if (!existing) {
          toInsert.push(entry);
          continue;
        }

        if (duplicateStrategy === "merge") {
          const existingMeta =
            existing.meta_json && typeof existing.meta_json === "object" && !Array.isArray(existing.meta_json)
              ? existing.meta_json
              : {};
          const mergedMeta = { ...existingMeta, ...(entry.meta ?? {}) };
          const nextNotes = entry.notes && entry.notes.trim() ? entry.notes : existing.notes;
          const nextConceptId = existing.concept_id || entry.termId || null;
          toUpdate.push({ id: existing.id, notes: nextNotes, meta: mergedMeta, conceptId: nextConceptId });
        } else if (duplicateStrategy === "skip") {
          skippedCount += 1;
        }
      }

      if (toUpdate.length > 0) {
        const CHUNK_SIZE = 300;
        for (let offset = 0; offset < toUpdate.length; offset += CHUNK_SIZE) {
          const chunk = toUpdate.slice(offset, offset + CHUNK_SIZE);
          const params: any[] = [glossaryId, actor, nowIso];
          const valuesSql = chunk
            .map((row, index) => {
              const base = index * 4 + 4;
              params.push(row.id, row.notes, JSON.stringify(row.meta), row.conceptId);
              return `($${base}, $${base + 1}, $${base + 2}::jsonb, $${base + 3})`;
            })
            .join(", ");
          const updateRes = await client.query(
            `WITH incoming(id, notes, meta_json, concept_id) AS (VALUES ${valuesSql})
             UPDATE glossary_entries e
             SET notes = incoming.notes,
                 meta_json = incoming.meta_json,
                 concept_id = COALESCE(e.concept_id, incoming.concept_id),
                 updated_by = $2,
                 updated_at = $3
             FROM incoming
             WHERE e.glossary_id = $1 AND e.id = incoming.id`,
            params
          );
          updatedCount += updateRes.rowCount ?? chunk.length;
        }
      }

      if (toInsert.length > 0) {
        const CHUNK_SIZE = 800;
        for (let offset = 0; offset < toInsert.length; offset += CHUNK_SIZE) {
          const chunk = toInsert.slice(offset, offset + CHUNK_SIZE);
          const params: any[] = [];
          const valuesSql = chunk
            .map((entry, i) => {
              const base = i * 12;
              params.push(
                glossaryId,
                entry.termId,
                entry.sourceLang,
                entry.targetLang,
                entry.term,
                entry.translation,
                entry.notes,
                JSON.stringify(entry.meta ?? {}),
                entry.createdBy,
                entry.createdAt,
                entry.updatedBy,
                entry.updatedAt
              );
              return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
            })
            .join(", ");
          const insertRes = await client.query<{ id: number; concept_id: string | null }>(
            `INSERT INTO glossary_entries
              (glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, created_at, updated_by, updated_at)
             VALUES ${valuesSql}
             RETURNING id, concept_id`,
            params
          );
          inserted.push(...insertRes.rows);
        }
      }

      const entryLanguages = new Set<string>();
      entries.forEach((entry) => {
        entryLanguages.add(entry.sourceLang);
        entryLanguages.add(entry.targetLang);
      });
      await ensureGlossaryLanguages(client, glossaryId, Array.from(entryLanguages), actor);

      const objectKey = keyTerminologyUpload({ uploadId: glossaryId, filename: importRow.source_filename });
      const copyRes = await copyObject({ sourceKey: importRow.source_object_key!, destinationKey: objectKey });
      const artifact = await insertFileArtifact(client, {
        kind: "terminology_upload" satisfies FileArtifactKind,
        bucket: getS3Bucket(),
        objectKey,
        sha256: importRow.source_sha256 ?? (await sha256Hex(stored.buf)),
        etag: copyRes.etag,
        sizeBytes: importRow.source_size_bytes ?? stored.buf.length,
        contentType: importRow.source_content_type ?? stored.contentType ?? null,
        meta: {
          glossaryId,
          originalFilename: importRow.source_filename,
          uploadedBy: actor,
          importId: importRow.id
        },
        createdBy: actor
      });

      if (structureChanged) {
        await client.query(
          "UPDATE glossaries SET artifact_id = $1, structure_json = $2::jsonb, updated_by = $3, updated_at = NOW() WHERE id = $4",
          [artifact.id, JSON.stringify(structurePayload), actor, glossaryId]
        );
      } else {
        await client.query(
          "UPDATE glossaries SET artifact_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3",
          [artifact.id, actor, glossaryId]
        );
      }

      if (imagesManifest.length > 0 && imageMatch.matches.size > 0 && inserted.length > 0) {
        const imageKeyMap = new Map<string, string>();
        for (const [_, image] of imageMatch.matches) {
          const key = image.filename.toLowerCase();
          if (imageKeyMap.has(key)) continue;
          const destKey = keyTerminologyImage({ glossaryId, filename: image.filename });
          await copyObject({ sourceKey: image.objectKey, destinationKey: destKey });
          imageKeyMap.set(key, destKey);
        }

        const mediaParams: any[] = [];
        let mediaIdx = 0;
        const mediaValues = inserted
          .map((row) => {
            const conceptId = String(row.concept_id || "");
            const match = imageMatch.matches.get(conceptId);
            if (!match) return null;
            const destKey = imageKeyMap.get(match.filename.toLowerCase());
            if (!destKey) return null;
            const base = mediaIdx * 5;
            mediaIdx += 1;
            mediaParams.push(glossaryId, row.id, conceptId || null, destKey, match.filename);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
          })
          .filter(Boolean)
          .join(", ");

        if (mediaValues) {
          await client.query(
            `INSERT INTO glossary_entry_media(glossary_id, entry_id, concept_id, storage_path, original_filename)
             VALUES ${mediaValues}`,
            mediaParams
          );
        }
      }

      await insertAuditEvent(client, {
        actorUserId,
        actorLabel: actor,
        action: "terminology.import",
        objectType: "glossary",
        objectId: String(glossaryId),
        details: {
          bucket: getS3Bucket(),
          objectKey,
          sizeBytes: importRow.source_size_bytes ?? stored.buf.length,
          filename: importRow.source_filename
        }
      });

      await client.query(
        `UPDATE glossary_imports SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [importRow.id]
      );

      return { glossaryId, entryCount: inserted.length, updatedCount, skippedCount };
    });

    const report = {
      processed: parsedStats.rowCount,
      imported: result.entryCount,
      updated: result.updatedCount ?? 0,
      skipped: baseSkipped + (result.skippedCount ?? 0),
      errors: [] as string[],
      warnings: reportWarnings
    };
    return reply.code(201).send({ ...result, report });
  });
}

