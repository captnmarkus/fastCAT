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

export async function glossariesRoutes(app: FastifyInstance) {
  // List glossaries (enabled-only) for project creation
  app.get("/library/glossaries", { preHandler: [requireAuth] }, async () => {
    const res = await db.query<GlossaryRow>(
      `SELECT id, label, filename, disabled, uploaded_by, uploaded_at, updated_by, updated_at, created_at
       FROM glossaries
       WHERE disabled = FALSE
       ORDER BY created_at DESC`
    );
    return {
      glossaries: res.rows.map((row) => ({
        id: row.id,
        label: row.label,
        disabled: Boolean(row.disabled),
        createdAt: new Date(row.created_at).toISOString()
      }))
    };
  });

  // Admin: list glossaries
  app.get("/admin/glossaries", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<GlossaryListItem>(
      `SELECT
         g.id,
         g.label,
         g.filename,
         g.description,
         g.languages,
         g.visibility,
         g.disabled,
         g.uploaded_by AS "uploadedBy",
         g.uploaded_at AS "uploadedAt",
         g.updated_by AS "updatedBy",
         g.updated_at AS "updatedAt",
         g.created_at AS "createdAt",
         COUNT(e.id)::int AS "entryCount"
       FROM glossaries g
       LEFT JOIN glossary_entries e ON e.glossary_id = g.id
       GROUP BY g.id
       ORDER BY g.created_at DESC`
    );
    return {
      glossaries: res.rows.map((row) => ({
        ...row,
        description: row.description ?? null,
        languages: normalizeGlossaryLanguages((row as any).languages),
        visibility: row.visibility ?? null
      }))
    };
  });

  // Admin: glossary details (+ preview)
  app.get("/admin/glossaries/:id", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid glossary id" });
    }

    const metaRes = await db.query<GlossaryRow>(
      `SELECT id, label, filename, description, languages, visibility, disabled, uploaded_by, uploaded_at, updated_by, updated_at, created_at
       FROM glossaries
       WHERE id = $1`,
      [glossaryId]
    );
    const glossary = metaRes.rows[0];
    if (!glossary) {
      return reply.code(404).send({ error: "Glossary not found" });
    }

    const countRes = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM glossary_entries WHERE glossary_id = $1`,
      [glossaryId]
    );
    const entryCount = countRes.rows[0]?.count ?? 0;

    const previewRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
       ORDER BY id ASC
       LIMIT 50`,
      [glossaryId]
    );

    return {
      glossary: mapGlossary(glossary, entryCount),
      preview: previewRes.rows.map(rowToGlossaryEntry)
    };
  });

  // Admin: list glossary entries (server-side search/filters/sort/pagination)
  app.get("/admin/glossaries/:id/entries", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid glossary id" });
    }

    const query = (req.query as any) || {};
    const q = String(query.q ?? "").trim();

    const createdFrom = parseTimestampOrNull(String(query.createdFrom ?? query.created_from ?? ""));
    const createdTo = parseTimestampOrNull(String(query.createdTo ?? query.created_to ?? ""));
    const updatedFrom = parseTimestampOrNull(String(query.updatedFrom ?? query.updated_from ?? ""));
    const updatedTo = parseTimestampOrNull(String(query.updatedTo ?? query.updated_to ?? ""));

    const createdBy = String(query.createdBy ?? query.created_by ?? "").trim();
    const updatedBy = String(query.updatedBy ?? query.updated_by ?? "").trim();

    const sourceLang = normalizeLang(String(query.sourceLang ?? query.source_lang ?? ""));
    const targetLang = normalizeLang(String(query.targetLang ?? query.target_lang ?? ""));

    const sourceTermContains = String(query.sourceTerm ?? query.source_term ?? query.term ?? "").trim();
    const targetTermContains = String(query.targetTerm ?? query.target_term ?? query.translation ?? "").trim();
    const notesContains = String(query.notes ?? query.note ?? "").trim();

    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limitRaw = Number(query.limit ?? 50) || 50;
    const limit = Math.max(1, Math.min(200, limitRaw));
    const offset = (page - 1) * limit;

    const sortByRaw = String(query.sortBy ?? query.sort_by ?? "updated_at").trim().toLowerCase();
    const sortDirRaw = String(query.sortDir ?? query.sort_dir ?? "desc").trim().toLowerCase();
    const sortDir = sortDirRaw === "asc" ? "ASC" : "DESC";

    const SORT_COLUMNS: Record<string, string> = {
      created_at: "created_at",
      updated_at: "updated_at",
      created_by: "created_by",
      updated_by: "updated_by",
      source_language: "source_lang",
      target_language: "target_lang",
      source_lang: "source_lang",
      target_lang: "target_lang",
      source_term: "term",
      target_term: "translation",
      term: "term",
      translation: "translation"
    };
    const sortColumn = SORT_COLUMNS[sortByRaw] || "updated_at";

    const where: string[] = ["glossary_id = $1"];
    const params: any[] = [glossaryId];

    const add = (clause: string, value: any) => {
      params.push(value);
      where.push(clause.replace(/\$\$/g, `$${params.length}`));
    };

    if (q) {
      const like = `%${q}%`;
      add(
        "(term ILIKE $$ OR translation ILIKE $$ OR COALESCE(notes,'') ILIKE $$)",
        like
      );
    }

    if (createdFrom) add("created_at >= $$", createdFrom);
    if (createdTo) add("created_at <= $$", createdTo);
    if (updatedFrom) add("updated_at >= $$", updatedFrom);
    if (updatedTo) add("updated_at <= $$", updatedTo);

    if (createdBy) add("COALESCE(created_by,'') ILIKE $$", `%${createdBy}%`);
    if (updatedBy) add("COALESCE(updated_by,'') ILIKE $$", `%${updatedBy}%`);

    if (sourceLang) add("LOWER(source_lang) = LOWER($$)", sourceLang);
    if (targetLang) add("LOWER(target_lang) = LOWER($$)", targetLang);

    if (sourceTermContains) add("term ILIKE $$", `%${sourceTermContains}%`);
    if (targetTermContains) add("translation ILIKE $$", `%${targetTermContains}%`);
    if (notesContains) add("COALESCE(notes,'') ILIKE $$", `%${notesContains}%`);

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countRes = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM glossary_entries ${whereSql}`,
      params
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

    const orderBy = `ORDER BY ${sortColumn} ${sortDir}, id ${sortDir}`;
    const listParams = [...params, limit, offset];
    const limitParam = `$${listParams.length - 1}`;
    const offsetParam = `$${listParams.length}`;

    const listRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       ${whereSql}
       ${orderBy}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      listParams
    );

    return {
      entries: listRes.rows.map(rowToGlossaryEntry),
      total,
      page,
      limit
    };
  });

  // Admin: start glossary import session  registerGlossaryImportRoutes(app);  registerTermbaseImportRoutes(app);

  // Admin: upload glossary CSV
  app.post(
    "/admin/glossaries/upload",
    { preHandler: [requireManagerOrAdmin] },
    async (req: any, reply) => {
      let fileBuffer: Buffer | null = null;
      let filename: string | null = null;
      let labelFromForm: string | null = null;

      for await (const part of req.parts()) {
        if (part.type === "file" && !fileBuffer) {
          filename = String(part.filename || "").trim() || null;
          fileBuffer = await part.toBuffer();
        } else if (part.type === "field" && part.fieldname === "label") {
          labelFromForm = String(part.value || "").trim() || null;
        } else if (part.type === "file") {
          await part.toBuffer();
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ error: "file is required" });
      }

      if (filename && !filename.toLowerCase().endsWith(".csv")) {
        return reply.code(400).send({ error: "Only CSV uploads are supported." });
      }

      if (!labelFromForm) {
        return reply.code(400).send({ error: "label is required" });
      }

      const raw = decodeGlossaryBuffer(fileBuffer);
      const { headers, rows } = parseCsv(raw);
      if (headers.length === 0) {
        return reply.code(400).send({ error: "CSV must include a header row." });
      }

      const normalizedHeaders = headers.map(normalizeHeader);
      const headerIndex = new Map<string, number>();
      normalizedHeaders.forEach((h, idx) => {
        if (!headerIndex.has(h)) headerIndex.set(h, idx);
      });

      const resolved: Record<RequiredHeader, { header: string; index: number } | null> = {
        source_lang: null,
        target_lang: null,
        term: null,
        translation: null
      };

      const missing: RequiredHeader[] = [];
      for (const reqHeader of REQUIRED_HEADERS) {
        const match = resolveHeaderIndex(headerIndex, reqHeader);
        resolved[reqHeader] = match;
        if (!match) missing.push(reqHeader);
      }
      if (missing.length > 0) {
        return reply.code(400).send({
          error:
            `CSV is missing required columns: ${missing.join(", ")}. ` +
            `Accepted header formats include: ${FRIENDLY_HEADER_FORMATS.join(" OR ")}.`,
          missing,
          found: normalizedHeaders
        });
      }

      const inferredLabel = labelFromForm;

      const uploadedBy = requestUserId(getRequestUser(req)) || "admin";
      const nowIso = new Date().toISOString();
      const entries: Array<{
        sourceLang: string;
        targetLang: string;
        term: string;
        translation: string;
        notes: string | null;
        createdBy: string | null;
        createdAt: string | null;
        updatedBy: string | null;
        updatedAt: string | null;
      }> = [];

      const idxSource = resolved.source_lang!.index;
      const idxTarget = resolved.target_lang!.index;
      const idxTerm = resolved.term!.index;
      const idxTranslation = resolved.translation!.index;

      const idxCreatedBy = resolveAnyHeaderIndex(headerIndex, ["created_by"]);
      const idxCreatedAt = resolveAnyHeaderIndex(headerIndex, ["created_at"]);
      const idxModifiedBy = resolveAnyHeaderIndex(headerIndex, ["modified_by", "updated_by"]);
      const idxModifiedAt = resolveAnyHeaderIndex(headerIndex, ["modified_at", "updated_at"]);
      const idxNotes = resolveAnyHeaderIndex(headerIndex, ["notes", "note"]);
      const idxConceptNote = resolveAnyHeaderIndex(headerIndex, ["concept_note"]);
      const idxTermNote = resolveAnyHeaderIndex(headerIndex, ["term_note"]);

      for (const row of rows) {
        const sourceLang = normalizeLang(String(row[idxSource] ?? ""));
        const targetLang = normalizeLang(String(row[idxTarget] ?? ""));
        const term = String(row[idxTerm] ?? "").trim();
        const translation = String(row[idxTranslation] ?? "").trim();
        if (!term || !translation) continue;
        if (!sourceLang || !targetLang) continue;

        const createdByRaw = idxCreatedBy === null ? "" : String(row[idxCreatedBy] ?? "");
        const createdAtRaw = idxCreatedAt === null ? "" : String(row[idxCreatedAt] ?? "");
        const modifiedByRaw = idxModifiedBy === null ? "" : String(row[idxModifiedBy] ?? "");
        const modifiedAtRaw = idxModifiedAt === null ? "" : String(row[idxModifiedAt] ?? "");
        const notesRaw = idxNotes === null ? "" : String(row[idxNotes] ?? "");
        const conceptNoteRaw = idxConceptNote === null ? "" : String(row[idxConceptNote] ?? "");
        const termNoteRaw = idxTermNote === null ? "" : String(row[idxTermNote] ?? "");

        const createdBy = createdByRaw.trim() ? normalizeUser(createdByRaw) : uploadedBy;
        const createdAt = parseTimestampOrNull(createdAtRaw) || nowIso;
        const updatedBy = modifiedByRaw.trim() ? normalizeUser(modifiedByRaw) : createdBy;
        const updatedAt = parseTimestampOrNull(modifiedAtRaw) || createdAt;

        const notesParts = [notesRaw, conceptNoteRaw, termNoteRaw]
          .map((v) => String(v ?? "").trim())
          .filter(Boolean);
        const notes = notesParts.length > 0 ? notesParts.join("\n") : null;

        entries.push({ sourceLang, targetLang, term, translation, notes, createdBy, createdAt, updatedBy, updatedAt });
      }

      if (entries.length === 0) {
        return reply.code(400).send({
          error: "No valid glossary rows found (require source_lang, target_lang, term, translation)."
        });
      }

      let result: { glossaryId: number; entryCount: number };
      try {
        const user = getRequestUser(req) as any;
        const actorUserId =
          typeof user?.sub === "number"
            ? user.sub
            : /^\d+$/.test(String(user?.sub ?? ""))
              ? Number(user.sub)
              : null;
        result = await withTransaction(async (client) => {
          const glossaryRes = await client.query<{ id: number }>(
            `INSERT INTO glossaries(label, filename, disabled, uploaded_by, uploaded_at, updated_by, updated_at)
             VALUES ($1, $2, FALSE, $3, NOW(), $3, NOW())
             RETURNING id`,
            [inferredLabel, filename, uploadedBy]
          );
          const glossaryId = Number(glossaryRes.rows[0]?.id);
          if (!Number.isFinite(glossaryId) || glossaryId <= 0) {
            throw new Error("Failed to create glossary");
          }

          const objectKey = keyTerminologyUpload({ uploadId: glossaryId });
          const put = await putObjectBuffer({ key: objectKey, buf: fileBuffer!, contentType: "text/csv" });
          const sha256 = await sha256Hex(fileBuffer!);
          const artifact = await insertFileArtifact(client, {
            kind: "terminology_upload" satisfies FileArtifactKind,
            bucket: getS3Bucket(),
            objectKey,
            sha256,
            etag: put.etag,
            sizeBytes: fileBuffer!.length,
            contentType: "text/csv",
            meta: {
              glossaryId,
              label: inferredLabel,
              originalFilename: filename,
              uploadedBy
            },
            createdBy: uploadedBy
          });

          await client.query(`UPDATE glossaries SET artifact_id = $1 WHERE id = $2`, [artifact.id, glossaryId]);

          const CHUNK_SIZE = 1000;
          for (let offset = 0; offset < entries.length; offset += CHUNK_SIZE) {
            const chunk = entries.slice(offset, offset + CHUNK_SIZE);
            const params: any[] = [];
            const valuesSql = chunk
              .map((entry, i) => {
                const base = i * 10;
                params.push(
                  glossaryId,
                  entry.sourceLang,
                  entry.targetLang,
                  entry.term,
                  entry.translation,
                  entry.notes,
                  entry.createdBy,
                  entry.createdAt,
                  entry.updatedBy,
                  entry.updatedAt
                );
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
              })
              .join(", ");
            await client.query(
              `INSERT INTO glossary_entries(glossary_id, source_lang, target_lang, term, translation, notes, created_by, created_at, updated_by, updated_at)
               VALUES ${valuesSql}`,
              params
            );
          }

          await insertAuditEvent(client, {
            actorUserId,
            actorLabel: uploadedBy,
            action: "terminology.upload",
            objectType: "glossary",
            objectId: String(glossaryId),
            details: {
              bucket: getS3Bucket(),
              objectKey,
              sizeBytes: fileBuffer!.length,
              filename
            }
          });

          return { glossaryId, entryCount: entries.length };
        });
      } catch (err: any) {
        if (err?.code === "23505") {
          return reply.code(409).send({ error: `Glossary label already exists: ${inferredLabel}` });
        }
        throw err;
      }

      return reply.code(201).send({
        ok: true,
        glossaryId: result.glossaryId,
        entryCount: result.entryCount
      });
    }
  );

  // Admin: update glossary metadata (disable/enable, label)
  app.patch("/admin/glossaries/:id", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid glossary id" });
    }
    const body = (req.body as any) || {};
    const disabled =
      body.disabled === undefined ? undefined : Boolean(body.disabled);
    const label = body.label === undefined ? undefined : String(body.label).trim();
    if (disabled === undefined && label === undefined) {
      return reply.code(400).send({ error: "No updates" });
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (label !== undefined) {
      if (!label) return reply.code(400).send({ error: "label cannot be empty" });
      params.push(label);
      updates.push(`label = $${params.length}`);
    }
    if (disabled !== undefined) {
      params.push(disabled);
      updates.push(`disabled = $${params.length}`);
    }
    params.push(glossaryId);

    const actor = requestUserId(getRequestUser(req)) || "admin";
    params.push(actor);
    updates.push(`updated_by = $${params.length}`);
    updates.push(`updated_at = NOW()`);

    let res: any;
    try {
      res = await db.query(
        `UPDATE glossaries SET ${updates.join(", ")} WHERE id = $${params.length - 1} RETURNING id`,
        params
      );
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "Glossary label already exists" });
      }
      throw err;
    }
    if (res.rowCount === 0) {
      return reply.code(404).send({ error: "Glossary not found" });
    }
    return { ok: true };
  });

  // Admin: delete glossary
  app.delete("/admin/glossaries/:id", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid glossary id" });
    }
    const res = await db.query("DELETE FROM glossaries WHERE id = $1", [glossaryId]);
    if (res.rowCount === 0) {
      return reply.code(404).send({ error: "Glossary not found" });
    }
    return { ok: true };
  });

  // Admin: create glossary entry
  app.post(
    "/admin/glossaries/:id/entries",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const glossaryId = Number((req.params as any).id);
      if (!Number.isFinite(glossaryId)) {
        return reply.code(400).send({ error: "Invalid glossary id" });
      }

      const body = (req.body as any) || {};
      const sourceLang = normalizeLang(String(body.sourceLang ?? body.source_language ?? body.source_lang ?? ""));
      const targetLang = normalizeLang(String(body.targetLang ?? body.target_language ?? body.target_lang ?? ""));
      const sourceTerm = String(body.sourceTerm ?? body.source_term ?? body.term ?? body.src_term ?? "").trim();
      const targetTerm = String(body.targetTerm ?? body.target_term ?? body.translation ?? body.tgt_term ?? "").trim();
      const notes = String(body.notes ?? body.note ?? "").trim() || null;

      if (!sourceLang || !targetLang || !sourceTerm || !targetTerm) {
        return reply.code(400).send({
          error: "Missing required fields (sourceLang, targetLang, sourceTerm, targetTerm)."
        });
      }

      const actor = requestUserId(getRequestUser(req)) || "admin";
      const nowIso = new Date().toISOString();

      const result = await withTransaction(async (client) => {
        const exists = await client.query<{ id: number }>(
          "SELECT id FROM glossaries WHERE id = $1",
          [glossaryId]
        );
        if (exists.rowCount === 0) {
          return null;
        }

        const insertRes = await client.query<GlossaryEntryRow>(
          `INSERT INTO glossary_entries
            (glossary_id, source_lang, target_lang, term, translation, notes, created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, glossary_id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at`,
          [
            glossaryId,
            sourceLang,
            targetLang,
            sourceTerm,
            targetTerm,
            notes,
            actor,
            nowIso,
            actor,
            nowIso
          ]
        );

        await client.query(
          "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
          [actor, glossaryId]
        );

        return insertRes.rows[0] ?? null;
      });

      if (!result) {
        return reply.code(404).send({ error: "Glossary not found" });
      }

      return reply.code(201).send({ entry: rowToGlossaryEntry(result) });
    }
  );

  // Admin: update glossary entry
  app.patch(
    "/admin/glossaries/:id/entries/:entryId",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const glossaryId = Number((req.params as any).id);
      const entryId = Number((req.params as any).entryId);
      if (!Number.isFinite(glossaryId) || !Number.isFinite(entryId)) {
        return reply.code(400).send({ error: "Invalid ids" });
      }

      const body = (req.body as any) || {};
      const updates: string[] = [];
      const params: any[] = [];

      const assign = (
        key: string,
        column: string,
        transform: (v: any) => any = (v) => v
      ) => {
        if (body[key] === undefined) return;
        const value = transform(body[key]);
        if (typeof value === "string" && !value.trim()) {
          throw new Error(`${key} cannot be empty`);
        }
        params.push(value);
        updates.push(`${column} = $${params.length}`);
      };

      try {
        assign("sourceLang", "source_lang", (v) => normalizeLang(String(v ?? "")));
        assign("targetLang", "target_lang", (v) => normalizeLang(String(v ?? "")));
        assign("sourceTerm", "term", (v) => String(v ?? "").trim());
        assign("targetTerm", "translation", (v) => String(v ?? "").trim());
        if (body.notes !== undefined || body.note !== undefined) {
          const raw = body.notes !== undefined ? body.notes : body.note;
          const value = String(raw ?? "").trim();
          params.push(value || null);
          updates.push(`notes = $${params.length}`);
        }
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || "Invalid update" });
      }

      if (updates.length === 0) {
        return reply.code(400).send({ error: "No updates" });
      }

      const actor = requestUserId(getRequestUser(req)) || "admin";
      params.push(actor);
      updates.push(`updated_by = $${params.length}`);
      updates.push(`updated_at = NOW()`);

      params.push(glossaryId);
      params.push(entryId);

      const updateRes = await withTransaction(async (client) => {
        const res = await client.query<GlossaryEntryRow>(
          `UPDATE glossary_entries
           SET ${updates.join(", ")}
           WHERE glossary_id = $${params.length - 1}
             AND id = $${params.length}
           RETURNING id, glossary_id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at`,
          params
        );
        if (res.rowCount === 0) return null;

        await client.query(
          "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
          [actor, glossaryId]
        );
        return res.rows[0] ?? null;
      });

      if (!updateRes) {
        return reply.code(404).send({ error: "Entry not found" });
      }

      return { entry: rowToGlossaryEntry(updateRes) };
    }
  );

  // Admin: delete glossary entry
  app.delete(
    "/admin/glossaries/:id/entries/:entryId",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const glossaryId = Number((req.params as any).id);
      const entryId = Number((req.params as any).entryId);
      if (!Number.isFinite(glossaryId) || !Number.isFinite(entryId)) {
        return reply.code(400).send({ error: "Invalid ids" });
      }

      const actor = requestUserId(getRequestUser(req)) || "admin";

      const deleted = await withTransaction(async (client) => {
        const res = await client.query(
          "DELETE FROM glossary_entries WHERE glossary_id = $1 AND id = $2",
          [glossaryId, entryId]
        );
        if (res.rowCount === 0) return false;

        await client.query(
          "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
          [actor, glossaryId]
        );

        return true;
      });

      if (!deleted) {
        return reply.code(404).send({ error: "Entry not found" });
      }

      return { ok: true };
    }
  );

  // Admin: export glossary as CSV
  app.get("/admin/glossaries/:id/export", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid glossary id" });
    }
    const metaRes = await db.query<GlossaryRow>(
      `SELECT id, label, filename, disabled, uploaded_by, uploaded_at, updated_by, updated_at, created_at
       FROM glossaries
       WHERE id = $1`,
      [glossaryId]
    );
    const glossary = metaRes.rows[0];
    if (!glossary) {
      return reply.code(404).send({ error: "Glossary not found" });
    }

    const entriesRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
       ORDER BY id ASC`,
      [glossaryId]
    );

    let csv = "";
    csv += toCsvLine([
      "source_lang",
      "target_lang",
      "term",
      "translation",
      "notes",
      "created_by",
      "created_at",
      "updated_by",
      "updated_at"
    ]);
    for (const row of entriesRes.rows) {
      csv += toCsvLine([
        row.source_lang,
        row.target_lang,
        row.term,
        row.translation,
        row.notes ?? "",
        row.created_by ?? "",
        row.created_at ? new Date(row.created_at).toISOString() : "",
        row.updated_by ?? "",
        row.updated_at ? new Date(row.updated_at).toISOString() : ""
      ]);
    }

    const safeBase = glossary.label
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || `glossary-${glossaryId}`;
    const outName = `${safeBase}.csv`;

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${outName}"`);
    return reply.send(csv);
  });
}



