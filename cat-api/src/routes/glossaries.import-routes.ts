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

export function registerGlossaryImportRoutes(app: FastifyInstance) {
  app.post("/admin/glossaries/import/start", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const importType = normalizeImportType(body.importType ?? body.import_type);
    if (!importType) {
      return reply.code(400).send({ error: "Invalid import type." });
    }
    const label = String(body.label ?? "").trim() || null;
    const description = String(body.description ?? "").trim() || null;
    const languages = normalizeLanguages(body.languages ?? body.language ?? "");
    const settingsPayload =
      typeof body.settings === "string"
        ? parseJsonField<any>(body.settings)
        : body.settings && typeof body.settings === "object"
          ? body.settings
          : null;
    const settings = mergeImportSettings(
      {
        ...(settingsPayload || {}),
        synonymSeparator: body.synonymSeparator ?? body.synonym_separator,
        multiValueSeparator: body.multiValueSeparator ?? body.multi_value_separator,
        multiLanguageDelimiter: body.multiLanguageDelimiter ?? body.multi_language_delimiter,
        strictImport: body.strictImport ?? body.strict_import
      },
      null
    );
    const visibilityRaw = String(body.visibility ?? "").trim().toLowerCase();
    const visibility =
      visibilityRaw === "admins" || visibilityRaw === "private" ? visibilityRaw : "managers";

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const res = await db.query<{ id: number }>(
      `INSERT INTO glossary_imports(import_type, label, description, languages, settings_json, visibility, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW(), NOW())
       RETURNING id`,
      [importType, label, description, JSON.stringify(languages), JSON.stringify(settings), visibility, actor]
    );
    const importId = Number(res.rows[0]?.id);
    if (!Number.isFinite(importId) || importId <= 0) {
      return reply.code(500).send({ error: "Failed to create import session." });
    }
    return { importId, requestId: req.id };
  });

  // Admin: parse glossary import file + optional images
  app.post("/admin/glossaries/import/parse", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const isMultipart = typeof req.isMultipart === "function" ? req.isMultipart() : false;
    let importId: number | null = null;
    let mappingRaw: any = null;
    let mapping: GlossaryImportMapping = {};
    let languagesOverride: string[] = [];
    let strictImages = false;
    let settingsInput: Partial<GlossaryImportSettings> | null = null;

    let fileBuffer: Buffer | null = null;
    let fileName: string | null = null;
    let fileContentType: string | null = null;

    const imageFiles: Array<{ filename: string; buffer: Buffer; contentType: string | null }> = [];
    let zipBuffer: Buffer | null = null;

    if (isMultipart) {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          const safeName = sanitizeUploadFilename(part.filename || "");
          const buf = await part.toBuffer();
          const field = String(part.fieldname || "");
          if (field === "file" && !fileBuffer) {
            fileBuffer = buf;
            fileName = safeName;
            fileContentType = part.mimetype ? String(part.mimetype) : null;
          } else if (field === "images" || field === "image" || field === "imageFiles") {
            const ext = path.extname(safeName).toLowerCase();
            if (ext === ".zip") {
              zipBuffer = buf;
            } else {
              imageFiles.push({ filename: safeName, buffer: buf, contentType: part.mimetype ? String(part.mimetype) : null });
            }
          }
        } else if (part.type === "field") {
          if (part.fieldname === "importId") {
            const parsed = Number(part.value);
            if (Number.isFinite(parsed)) importId = parsed;
          } else if (part.fieldname === "mapping") {
            const parsed = parseJsonField<any>(String(part.value || ""));
            mappingRaw = parsed;
          } else if (part.fieldname === "languages") {
            languagesOverride = normalizeLanguages(part.value);
          } else if (part.fieldname === "strictImages") {
            strictImages = String(part.value || "").trim().toLowerCase() === "true";
          } else if (part.fieldname === "settings") {
            const parsed = parseJsonField<any>(String(part.value || ""));
            if (parsed && typeof parsed === "object") settingsInput = parsed;
          } else if (part.fieldname === "synonymSeparator") {
            settingsInput = { ...(settingsInput || {}), synonymSeparator: String(part.value || "") };
          } else if (part.fieldname === "multiValueSeparator") {
            settingsInput = { ...(settingsInput || {}), multiValueSeparator: String(part.value || "") };
          } else if (part.fieldname === "multiLanguageDelimiter") {
            settingsInput = { ...(settingsInput || {}), multiLanguageDelimiter: String(part.value || "") };
          } else if (part.fieldname === "strictImport") {
            settingsInput = { ...(settingsInput || {}), strictImport: String(part.value || "").trim().toLowerCase() === "true" };
          }
        }
      }
    } else {
      const body = (req.body as any) || {};
      importId = Number(body.importId ?? body.import_id);
      if (body.mapping) mappingRaw = body.mapping;
      languagesOverride = normalizeLanguages(body.languages ?? body.language ?? "");
      strictImages = Boolean(body.strictImages ?? body.strict_images);
      const settingsPayload =
        typeof body.settings === "string"
          ? parseJsonField<any>(body.settings)
          : body.settings && typeof body.settings === "object"
            ? body.settings
            : null;
      settingsInput = {
        ...(settingsPayload || {}),
        synonymSeparator: body.synonymSeparator ?? body.synonym_separator,
        multiValueSeparator: body.multiValueSeparator ?? body.multi_value_separator,
        multiLanguageDelimiter: body.multiLanguageDelimiter ?? body.multi_language_delimiter,
        strictImport: body.strictImport ?? body.strict_import
      };
    }

    if (!Number.isFinite(importId) || (importId as number) <= 0) {
      return reply.code(400).send({ error: "importId is required." });
    }

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
    if (!importType) {
      return reply.code(400).send({ error: "Invalid import type." });
    }
    mapping = normalizeMapping(mappingRaw, { allowPaths: importType === "xml" });

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const resolvedSettings = mergeImportSettings(settingsInput, importRow.settings_json);

    await db.query(
      `UPDATE glossary_imports
       SET settings_json = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(resolvedSettings), importRow.id]
    );

    if (fileBuffer) {
      const objectKey = keyTerminologyImportSource({ importId: importRow.id, filename: fileName });
      const sha256 = await sha256Hex(fileBuffer);
      await putObjectBuffer({ key: objectKey, buf: fileBuffer, contentType: fileContentType });
      await db.query(
        `UPDATE glossary_imports
         SET source_filename = $1,
             source_object_key = $2,
             source_sha256 = $3,
             source_size_bytes = $4,
             source_content_type = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [fileName, objectKey, sha256, fileBuffer.length, fileContentType, importRow.id]
      );
      importRow.source_filename = fileName;
      importRow.source_object_key = objectKey;
      importRow.source_sha256 = sha256;
      importRow.source_size_bytes = fileBuffer.length;
      importRow.source_content_type = fileContentType;
    }

    let imageWarnings: string[] = [];
    let imagesManifest = normalizeImageManifest(importRow.images_manifest);
    if (zipBuffer || imageFiles.length > 0) {
      const extracted: Array<{ filename: string; buffer: Buffer; contentType: string | null }> = [];
      if (zipBuffer) {
        try {
          const zip = new AdmZip(zipBuffer);
          const entries = zip.getEntries();
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const baseName = sanitizeUploadFilename(entry.entryName);
            if (!isAllowedImageFilename(baseName)) continue;
            extracted.push({ filename: baseName, buffer: entry.getData(), contentType: IMAGE_CONTENT_TYPES[path.extname(baseName).toLowerCase()] || null });
          }
        } catch {
          imageWarnings.push("Failed to read image zip. Only direct image uploads will be used.");
        }
      }
      extracted.push(...imageFiles.filter((img) => isAllowedImageFilename(img.filename)));

      imagesManifest = [];
      for (const img of extracted) {
        const ext = path.extname(img.filename).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) {
          imageWarnings.push(`Unsupported image type: ${img.filename}`);
          continue;
        }
        const objectKey = keyTerminologyImportImage({ importId: importRow.id, filename: img.filename });
        await putObjectBuffer({
          key: objectKey,
          buf: img.buffer,
          contentType: img.contentType || IMAGE_CONTENT_TYPES[ext] || "application/octet-stream"
        });
        const sha256 = await sha256Hex(img.buffer);
        imagesManifest.push({ filename: img.filename, objectKey, sizeBytes: img.buffer.length, sha256 });
      }
      await db.query(
        `UPDATE glossary_imports
         SET images_manifest = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(imagesManifest), importRow.id]
      );
      if (imagesManifest.length === 0) {
        imageWarnings.push("No valid images found in the upload.");
      }
    }

    if (!importRow.source_object_key && !fileBuffer && importType !== "empty") {
      return reply.code(400).send({ error: "No source file uploaded for this import." });
    }

    if (importType === "empty") {
      return {
        importId: importRow.id,
        importType,
        file: null,
        detectedLanguages: normalizeGlossaryLanguages(importRow.languages),
        columns: [],
        sampleRows: [],
        mapping: {},
        preview: { entries: [], entryCount: 0 },
        images: { provided: imagesManifest.length > 0, total: imagesManifest.length, matched: 0, missing: [], unused: [] },
        stats: { rowCount: 0, skippedRows: 0, missingTermIds: 0 },
        validation: { errors: [], warnings: ["Empty termbase selected; no file parsing is required."] },
        requestId: req.id
      };
    }

    if (!fileBuffer && importRow.source_object_key) {
      const stored = await getObjectBuffer({ key: importRow.source_object_key });
      fileBuffer = stored.buf;
      fileContentType = stored.contentType;
    }

    let text = "";
    if (fileBuffer) {
      try {
        text = importType === "xlsx" ? await parseXlsxToCsv(fileBuffer) : decodeGlossaryBuffer(fileBuffer);
      } catch (err: any) {
        return reply.code(400).send({ error: err?.message || "Failed to parse import file." });
      }
    }
    const languageSettings = await getOrgLanguageSettings();
    const catalogByTag = getCatalogByTag();
    const parseWarnings: string[] = [];
    const parseErrors: string[] = [];
    let entries: GlossaryImportEntry[] = [];
    let columns: GlossaryImportColumn[] = [];
    let sampleRows: Array<Record<string, string>> = [];
    let detectedLanguages: string[] = [];
    let mappingUsed: GlossaryImportMapping = {};
    let stats: GlossaryImportStats | null = null;

    if (importType === "csv" || importType === "xlsx") {
      const parsed = parseCsvImport({
        text,
        mapping,
        languagesOverride,
        importId: importRow.id,
        uploadedBy: actor,
        settings: resolvedSettings,
        languageSettings,
        catalogByTag
      });
      entries = parsed.entries;
      columns = parsed.columns;
      sampleRows = parsed.sampleRows;
      detectedLanguages = parsed.detectedLanguages;
      mappingUsed = parsed.mapping ?? {};
      stats = parsed.stats ?? null;
      parseWarnings.push(...parsed.warnings);
      parseErrors.push(...parsed.errors);
    } else {
      const parsed = parseXmlImport({
        text,
        filename: importRow.source_filename || fileName,
        importId: importRow.id,
        uploadedBy: actor,
        importType,
        mapping,
        settings: resolvedSettings,
        languagesOverride,
        languageSettings,
        catalogByTag
      });
      entries = parsed.entries;
      columns = parsed.columns ?? [];
      sampleRows = parsed.sampleRows ?? [];
      detectedLanguages = parsed.detectedLanguages;
      mappingUsed = parsed.mapping ?? {};
      stats = parsed.stats ?? null;
      parseWarnings.push(...parsed.warnings);
      parseErrors.push(...parsed.errors);
    }

    const deduped = dedupeEntries(entries, "skip");
    entries = deduped.entries;
    parseWarnings.push(...deduped.warnings);
    parseErrors.push(...deduped.errors);

    const imagePreview = await buildImagePreview(entries, imagesManifest);
    if (imagePreview.missingRefs.length > 0) {
      parseWarnings.push("Some referenced images are missing.");
    }
    if (imageWarnings.length > 0) parseWarnings.push(...imageWarnings);

    if (strictImages && imagePreview.missingRefs.length > 0) {
      parseErrors.push("Missing referenced images.");
    }

    const previewEntries = entries.slice(0, 50).map((entry) => {
      const image = imagePreview.previewMap.get(entry.termId) || null;
      return {
        termId: entry.termId,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        sourceTerm: entry.term,
        targetTerm: entry.translation,
        definition: entry.meta.definition ?? null,
        tags: entry.meta.tags ?? [],
        image
      };
    });

    return {
      importId: importRow.id,
      importType,
      file: importRow.source_object_key
        ? {
            filename: importRow.source_filename,
            sizeBytes: importRow.source_size_bytes,
            sha256: importRow.source_sha256,
            contentType: importRow.source_content_type || fileContentType
          }
        : null,
      detectedLanguages,
      columns,
      sampleRows,
      mapping: mappingUsed,
      preview: { entries: previewEntries, entryCount: entries.length },
      images: {
        provided: imagesManifest.length > 0,
        total: imagesManifest.length,
        matched: imagePreview.matched.size,
        missing: imagePreview.missingRefs.slice(0, 50),
        unused: imagePreview.unused.slice(0, 50).map((img) => img.filename)
      },
      stats: stats ?? { rowCount: entries.length, skippedRows: 0, missingTermIds: 0 },
      validation: { errors: parseErrors, warnings: parseWarnings },
      requestId: req.id
    };
  });

  // Admin: commit glossary import
  app.post("/admin/glossaries/import/commit", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const body = (req.body as any) || {};
    const importId = Number(body.importId ?? body.import_id);
    if (!Number.isFinite(importId) || importId <= 0) {
      return reply.code(400).send({ error: "importId is required." });
    }

    const label = String(body.label ?? "").trim();
    if (!label) {
      return reply.code(400).send({ error: "label is required." });
    }

    const existingLabel = await db.query<{ id: number }>(
      "SELECT id FROM glossaries WHERE LOWER(label) = LOWER($1) LIMIT 1",
      [label]
    );
    if ((existingLabel.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "A termbase with this name already exists." });
    }

    const description = String(body.description ?? "").trim() || null;
    const languagesOverride = normalizeLanguages(body.languages ?? body.language ?? "");
    const visibilityRaw = String(body.visibility ?? "").trim().toLowerCase();
    const visibility =
      visibilityRaw === "admins" || visibilityRaw === "private" ? visibilityRaw : "managers";
    const duplicateStrategy =
      String(body.duplicateStrategy ?? body.duplicate_strategy ?? "skip").toLowerCase() === "fail"
        ? "fail"
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
    if (!importType) {
      return reply.code(400).send({ error: "Invalid import type." });
    }
    const mapping = normalizeMapping(mappingRaw, { allowPaths: importType === "xml" });

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

    if (importType === "empty") {
      const created = await withTransaction(async (client) => {
        const res = await client.query<{ id: number }>(
          `INSERT INTO glossaries(label, description, languages, visibility, disabled, uploaded_by, uploaded_at, updated_by, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, FALSE, $5, NOW(), $5, NOW())
           RETURNING id`,
          [label, description, JSON.stringify(languagesOverride), visibility, actor]
        );
        await client.query(
          `UPDATE glossary_imports SET status = 'completed', settings_json = $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [importRow.id, JSON.stringify(resolvedSettings)]
        );
        return Number(res.rows[0]?.id);
      });
      return reply.code(201).send({ glossaryId: created, entryCount: 0 });
    }

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

    let parseResult:
      | ReturnType<typeof parseCsvImport>
      | ReturnType<typeof parseXmlImport>;
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
    const deduped = dedupeEntries(entries, duplicateStrategy);
    if (deduped.errors.length > 0) {
      return reply.code(400).send({ error: deduped.errors.join(" ") });
    }
    entries = deduped.entries;

    const parsedStats = parseResult.stats ?? {
      rowCount: parseResult.entries.length,
      skippedRows: 0,
      missingTermIds: 0
    };
    const dedupeSkipped = Math.max(0, parseResult.entries.length - entries.length);
    const reportWarnings = [...parseResult.warnings, ...deduped.warnings];
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

    const result = await withTransaction(async (client) => {
      const glossaryRes = await client.query<{ id: number }>(
        `INSERT INTO glossaries(label, filename, description, languages, visibility, disabled, uploaded_by, uploaded_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, FALSE, $6, NOW(), $6, NOW())
         RETURNING id`,
        [
          label,
          importRow.source_filename,
          description,
          JSON.stringify(languagesOverride.length ? languagesOverride : parseResult.detectedLanguages),
          visibility,
          actor
        ]
      );
      const glossaryId = Number(glossaryRes.rows[0]?.id);
      if (!Number.isFinite(glossaryId) || glossaryId <= 0) {
        throw new Error("Failed to create glossary");
      }

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
          label,
          originalFilename: importRow.source_filename,
          uploadedBy: actor,
          importId: importRow.id
        },
        createdBy: actor
      });

      await client.query(`UPDATE glossaries SET artifact_id = $1 WHERE id = $2`, [artifact.id, glossaryId]);

      const inserted: Array<{ id: number; concept_id: string | null }> = [];
      const CHUNK_SIZE = 800;
      for (let offset = 0; offset < entries.length; offset += CHUNK_SIZE) {
        const chunk = entries.slice(offset, offset + CHUNK_SIZE);
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

      if (imagesManifest.length > 0 && imageMatch.matches.size > 0) {
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

      return { glossaryId, entryCount: inserted.length };
    });

    const report = {
      processed: parsedStats.rowCount,
      imported: result.entryCount,
      skipped: baseSkipped,
      errors: [] as string[],
      warnings: reportWarnings
    };
    return reply.code(201).send({ ...result, report });
  });
}

