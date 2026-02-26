
import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { db, withTransaction } from "../db.js";
import { buildGlossaryTbx } from "../lib/glossary-utils.js";
import { normalizeLanguageTag, primarySubtag } from "../lib/language-catalog.js";
import { presignGetObject } from "../lib/s3.js";
import { keyTerminologyImage } from "../lib/storage-keys.js";
import { normalizeStructureFields } from "../lib/termbase-import.js";
import { getRequestUser, requireAuth, requireManagerOrAdmin, requestUserId } from "../middleware/auth.js";
import { toText } from "../utils.js";

import {
  aggregateCustomFields,
  aggregateEntryAudit,
  aggregateTermAudit,
  applyEntryFields,
  applyLanguageFields,
  applyPartOfSpeech,
  applyStatus,
  applyTermFields,
  auditFromOriginMeta,
  auditFromRow,
  AuditMeta,
  bigramSimilarity,
  boundaryMatch,
  buildLangCandidates,
  buildTermbaseCsvExport,
  clampInt,
  conceptKeyForRow,
  ConcordanceMatch,
  ConcordanceMatchType,
  concordanceTokens,
  CustomFields,
  decodeTermKey,
  defaultStructure,
  encodeTermKey,
  ensureConceptId,
  ensureGlossaryLanguages,
  ensureSourceAudit,
  ensureSourceTermAudit,
  escapeRegExp,
  ExportStructure,
  fromBase64Url,
  getEntryFieldValue,
  getTermAuditMap,
  GlossaryEntryRow,
  GlossaryRow,
  hasAudit,
  isLikelyUrl,
  isPartOfSpeechExportField,
  isStatusExportField,
  LANGUAGE_CODE_ALIASES,
  LANGUAGE_NAME_MAP,
  LanguageFieldsMap,
  loadEntryIllustration,
  MATCH_WEIGHTS,
  matchConcordanceTerm,
  mergeAudit,
  mergeAuditAggregate,
  mergeFieldMap,
  mergeLanguageFields,
  mergeTermAuditMap,
  mergeTermFields,
  normalizeAuditMeta,
  normalizeAuditValue,
  normalizeConcordanceText,
  normalizeExportFieldKey,
  normalizeFieldMap,
  normalizeLang,
  normalizeLanguageFields,
  normalizeLanguages,
  normalizeLookupFieldKey,
  normalizeMeta,
  normalizeStructure,
  normalizeTermAuditMap,
  normalizeTermFields,
  parseBooleanParam,
  parseDateParam,
  parseIllustrationValue,
  parseStatusInput,
  pickPrimaryTerm,
  prefixMatch,
  renameTermAudit,
  renameTermFields,
  resolveIllustrationFromField,
  scoreMatch,
  setTermAuditMap,
  statusFromMeta,
  TERM_STATUS_ERROR,
  TERM_STATUS_VALUES,
  TermAuditMap,
  TermbaseField,
  TermbaseIllustration,
  TermbaseStructure,
  TermDetail,
  TermFieldsMap,
  TermKey,
  TermStatus,
  toBase64Url,
  toCsvLine,
  toIsoOrNull,
  tokenOverlap,
  touchEntryAudit,
  touchTermAudit,
  uniqueTerms
} from './termbases.helpers.js';

export function registerTermbaseMutationRoutes(app: FastifyInstance) {
  app.patch("/termbases/:id/entries/:entryId", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    const entryId = String((req.params as any).entryId || "").trim();
    if (!Number.isFinite(glossaryId) || !entryId) {
      return reply.code(400).send({ error: "Invalid ids" });
    }

    const body = (req.body as any) || {};
    const entryFieldsPatch = normalizeFieldMap(body.entryFields ?? body.entry_fields ?? body.customFields ?? null);
    const languageFieldsPatch = normalizeLanguageFields(body.languageFields ?? body.language_fields ?? null);

    const languagesRaw = Array.isArray(body.languages) ? body.languages : [];
    const languageFieldsFromLanguages: LanguageFieldsMap = {};
    const termUpdates: Array<{
      termId: string;
      key: TermKey;
      text?: string;
      status?: TermStatus;
      notes?: string | null;
      partOfSpeech?: string | null;
      customFields?: CustomFields | null;
      updatedAt?: string | null;
    }> = [];
    const termErrors: string[] = [];

    for (const entry of languagesRaw) {
      if (!entry || typeof entry !== "object") continue;
      const lang = normalizeLang(String((entry as any).lang ?? (entry as any).language ?? ""));
      const languageFieldPatch = normalizeFieldMap(
        (entry as any).languageFields ?? (entry as any).language_fields ?? (entry as any).fields ?? null
      );
      if (lang && Object.keys(languageFieldPatch).length > 0) {
        const current = languageFieldsFromLanguages[lang] ?? {};
        mergeFieldMap(current, languageFieldPatch);
        languageFieldsFromLanguages[lang] = current;
      }

      const termsRaw = Array.isArray((entry as any).terms) ? (entry as any).terms : [];
      for (const termPatch of termsRaw) {
        if (!termPatch || typeof termPatch !== "object") continue;
        const termId = String((termPatch as any).termId ?? (termPatch as any).term_id ?? "").trim();
        if (!termId) {
          termErrors.push("Missing termId.");
          continue;
        }
        const key = decodeTermKey(termId);
        if (!key) {
          termErrors.push("Invalid term id.");
          continue;
        }
        if (key.glossaryId !== glossaryId) {
          termErrors.push("Term does not belong to this termbase.");
          continue;
        }
        if (key.conceptId !== entryId) {
          termErrors.push("Term does not belong to this entry.");
          continue;
        }

        const textProvided = (termPatch as any).text !== undefined;
        const nextText = textProvided ? String((termPatch as any).text ?? "").trim() : null;
        if (textProvided && !nextText) {
          termErrors.push("text cannot be empty");
          continue;
        }

        const statusProvided = (termPatch as any).status !== undefined;
        const statusResult = statusProvided ? parseStatusInput((termPatch as any).status) : { status: null };
        if (statusProvided && statusResult.error) {
          termErrors.push(statusResult.error);
          continue;
        }

        const notesProvided = (termPatch as any).notes !== undefined;
        const nextNotes = notesProvided ? String((termPatch as any).notes ?? "").trim() : null;
        const posProvided = (termPatch as any).partOfSpeech !== undefined;
        const nextPos = posProvided ? String((termPatch as any).partOfSpeech ?? "").trim() : null;

        let customFieldsPatch: CustomFields | null | undefined = undefined;
        if (
          (termPatch as any).customFields !== undefined ||
          (termPatch as any).termFields !== undefined ||
          (termPatch as any).term_fields !== undefined
        ) {
          const rawFields =
            (termPatch as any).customFields ??
            (termPatch as any).termFields ??
            (termPatch as any).term_fields ??
            null;
          customFieldsPatch = rawFields === null ? null : normalizeFieldMap(rawFields);
        }

        const updatedAt = (termPatch as any).updatedAt ? String((termPatch as any).updatedAt) : null;
        const patch: {
          termId: string;
          key: TermKey;
          text?: string;
          status?: TermStatus;
          notes?: string | null;
          partOfSpeech?: string | null;
          customFields?: CustomFields | null;
          updatedAt?: string | null;
        } = {
          termId,
          key,
          updatedAt
        };

        if (textProvided && nextText) patch.text = nextText;
        if (statusProvided && statusResult.status !== null) patch.status = statusResult.status;
        if (notesProvided) patch.notes = nextNotes;
        if (posProvided) patch.partOfSpeech = nextPos;
        if (customFieldsPatch !== undefined) patch.customFields = customFieldsPatch;

        termUpdates.push(patch);
      }
    }

    if (termErrors.length > 0) {
      return reply.code(400).send({ error: termErrors[0] });
    }

    const mergedLanguageFields: LanguageFieldsMap = { ...languageFieldsPatch };
    Object.entries(languageFieldsFromLanguages).forEach(([lang, fields]) => {
      const current = mergedLanguageFields[lang] ?? {};
      mergeFieldMap(current, fields);
      mergedLanguageFields[lang] = current;
    });

    const hasEntryFields = Object.keys(entryFieldsPatch).length > 0;
    const hasLanguageFields = Object.keys(mergedLanguageFields).length > 0;
    const hasTermUpdates = termUpdates.length > 0;

    if (!hasEntryFields && !hasLanguageFields && !hasTermUpdates) {
      return reply.code(400).send({ error: "No fields to update." });
    }

    const rowsRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
       ORDER BY id ASC`,
      [glossaryId, entryId]
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) {
      return reply.code(404).send({ error: "Entry not found" });
    }

    const termMatchesByRow = new Map<
      number,
      Array<{ update: (typeof termUpdates)[number]; matchesSource: boolean; matchesTarget: boolean }>
    >();
    if (hasTermUpdates) {
      for (const update of termUpdates) {
        const matches: Array<{ row: GlossaryEntryRow; matchesSource: boolean; matchesTarget: boolean }> = [];
        for (const row of rows) {
          const normalizedSource = normalizeLang(row.source_lang) || row.source_lang;
          const normalizedTarget = normalizeLang(row.target_lang) || row.target_lang;
          const matchesSource = normalizedSource === update.key.lang && row.term === update.key.text;
          const matchesTarget = normalizedTarget === update.key.lang && row.translation === update.key.text;
          if (matchesSource || matchesTarget) {
            matches.push({ row, matchesSource, matchesTarget });
          }
        }
        if (matches.length === 0) {
          return reply.code(404).send({ error: "Term not found" });
        }
        const maxUpdatedAt = matches.reduce<string | null>((acc, item) => {
          const ts = item.row.updated_at ? new Date(item.row.updated_at).toISOString() : null;
          if (!ts) return acc;
          if (!acc || ts > acc) return ts;
          return acc;
        }, null);
        if (update.updatedAt && maxUpdatedAt && update.updatedAt < maxUpdatedAt) {
          return reply.code(409).send({ error: "Term was updated by another user.", updatedAt: maxUpdatedAt });
        }
        matches.forEach((item) => {
          const list = termMatchesByRow.get(item.row.id) ?? [];
          list.push({ update, matchesSource: item.matchesSource, matchesTarget: item.matchesTarget });
          termMatchesByRow.set(item.row.id, list);
        });
      }
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const nowIso = new Date().toISOString();

    const updatedRows = await withTransaction(async (client) => {
      const updated: GlossaryEntryRow[] = [];
      for (const row of rows) {
        const meta = normalizeMeta(row.meta_json);
        if (hasEntryFields) applyEntryFields(meta, entryFieldsPatch);
        if (hasLanguageFields) applyLanguageFields(meta, mergedLanguageFields);

        const matches = termMatchesByRow.get(row.id) ?? [];
        let nextTerm = row.term;
        let nextTranslation = row.translation;
        let nextNotes = row.notes;
        let notesUpdated = false;

        for (const update of termUpdates) {
          const termTouched =
            update.text !== undefined ||
            update.status !== undefined ||
            update.notes !== undefined ||
            update.partOfSpeech !== undefined ||
            update.customFields !== undefined;
          if (!termTouched) continue;
          if (update.text !== undefined) {
            renameTermFields(meta, update.key.lang, update.key.text, update.text);
            renameTermAudit(meta, update.key.lang, update.key.text, update.text);
          }
          if (update.customFields !== undefined) {
            if (update.customFields && Object.keys(update.customFields).length > 0) {
              applyTermFields(meta, update.key.lang, update.text ?? update.key.text, update.customFields);
            }
          }
          touchTermAudit(meta, update.key.lang, update.text ?? update.key.text, row, actor, nowIso);
        }

        for (const match of matches) {
          const update = match.update;
          if (update.status !== undefined) applyStatus(meta, update.status);
          if (update.partOfSpeech !== undefined) applyPartOfSpeech(meta, update.partOfSpeech);
          if (update.text !== undefined) {
            if (match.matchesSource) nextTerm = update.text;
            if (match.matchesTarget) nextTranslation = update.text;
          }
          if (update.notes !== undefined) {
            nextNotes = update.notes;
            notesUpdated = true;
          }
        }

        const shouldUpdate = hasEntryFields || hasLanguageFields || hasTermUpdates;
        if (!shouldUpdate) {
          updated.push(row);
          continue;
        }

        touchEntryAudit(meta, row, actor, nowIso);

        const updateRes = await client.query<GlossaryEntryRow>(
          `UPDATE glossary_entries
           SET term = $1,
               translation = $2,
               notes = $3,
               meta_json = $4,
               updated_by = $5,
               updated_at = $6
           WHERE id = $7
           RETURNING id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at`,
          [
            nextTerm,
            nextTranslation,
            notesUpdated ? nextNotes : row.notes,
            JSON.stringify(meta),
            actor,
            nowIso,
            row.id
          ]
        );
        updated.push(updateRes.rows[0] ?? row);
      }
      await client.query(
        "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
        [actor, glossaryId]
      );
      return updated;
    });

    const { entryFields, languageFields, termFields } = aggregateCustomFields(updatedRows);
    const entryAudit = aggregateEntryAudit(updatedRows);
    const termAudit = aggregateTermAudit(updatedRows);
    const sections = uniqueTerms(updatedRows, glossaryId, termFields, termAudit).map((section) => {
      const fields = languageFields[section.language] ?? {};
      return {
        ...section,
        customFields: Object.keys(fields).length > 0 ? fields : null
      };
    });
    const entryUpdatedAt = updatedRows.reduce<string | null>((acc, row) => {
      const ts = row.updated_at ? new Date(row.updated_at).toISOString() : null;
      if (!ts) return acc;
      if (!acc || ts > acc) return ts;
      return acc;
    }, null);

    return {
      entry: {
        entryId,
        updatedAt: entryUpdatedAt ?? nowIso,
        customFields: Object.keys(entryFields).length > 0 ? entryFields : null,
        audit: entryAudit,
        languages: sections
      }
    };
  });

  // Create termbase entry (concept)
  app.post("/termbases/:id/entries", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const body = (req.body as any) || {};
    const sourceLang = normalizeLang(String(body.sourceLang ?? body.language ?? ""));
    const targetLang = normalizeLang(String(body.targetLang ?? body.targetLanguage ?? sourceLang));
    const sourceTerm = String(body.sourceTerm ?? body.term ?? "").trim();
    const targetTerm = String(body.targetTerm ?? body.translation ?? "").trim();
    const notes = String(body.notes ?? "").trim() || null;
    const statusResult = parseStatusInput(body.status);
    const partOfSpeech = String(body.partOfSpeech ?? "").trim();

    if (!sourceLang || !sourceTerm) {
      return reply.code(400).send({ error: "Missing required fields (language, term)." });
    }
    if (statusResult.error) {
      return reply.code(400).send({ error: statusResult.error });
    }

    const resolvedTargetLang = targetLang || sourceLang;
    const resolvedTargetTerm = targetTerm || sourceTerm;

    const conceptId = `concept-${crypto.randomUUID()}`;
    const actor = requestUserId(getRequestUser(req)) || "admin";
    const nowIso = new Date().toISOString();
    const meta: Record<string, any> = {};
    if (statusResult.status !== null) applyStatus(meta, statusResult.status);
    if (partOfSpeech) applyPartOfSpeech(meta, partOfSpeech);

    const created = await withTransaction(async (client) => {
      const exists = await client.query<{ id: number }>(
        "SELECT id FROM glossaries WHERE id = $1",
        [glossaryId]
      );
      if ((exists.rowCount ?? 0) === 0) return null;

      const insertRes = await client.query<GlossaryEntryRow>(
        `INSERT INTO glossary_entries
          (glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $10)
         RETURNING id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at`,
        [
          glossaryId,
          conceptId,
          sourceLang,
          resolvedTargetLang,
          sourceTerm,
          resolvedTargetTerm,
          notes,
          JSON.stringify(meta),
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

    if (!created) {
      return reply.code(404).send({ error: "Termbase not found" });
    }

    await ensureGlossaryLanguages(glossaryId, [sourceLang, resolvedTargetLang], actor);

    return reply.code(201).send({
      entry: {
        entryId: conceptId,
        updatedAt: created.updated_at ? new Date(created.updated_at).toISOString() : null
      }
    });
  });

  // Delete termbase entry (concept)
  app.delete("/termbases/:id/entries/:entryId", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    const entryId = String((req.params as any).entryId || "").trim();
    if (!Number.isFinite(glossaryId) || !entryId) {
      return reply.code(400).send({ error: "Invalid ids" });
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const deleted = await withTransaction(async (client) => {
      const res = await client.query(
        `DELETE FROM glossary_entries
         WHERE glossary_id = $1
           AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))`,
        [glossaryId, entryId]
      );
      if ((res.rowCount ?? 0) === 0) return false;
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
  });

  // Add language (updates termbase language list)
  app.post("/termbases/:id/entries/:entryId/languages", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    const entryId = String((req.params as any).entryId || "").trim();
    if (!Number.isFinite(glossaryId) || !entryId) {
      return reply.code(400).send({ error: "Invalid ids" });
    }
    const body = (req.body as any) || {};
    const language = normalizeLang(String(body.language ?? body.lang ?? ""));
    if (!language) {
      return reply.code(400).send({ error: "language is required" });
    }
    const exists = await db.query(
      `SELECT id FROM glossary_entries
       WHERE glossary_id = $1
         AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
       LIMIT 1`,
      [glossaryId, entryId]
    );
    if ((exists.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "Entry not found" });
    }
    await ensureConceptId(glossaryId, entryId);
    const actor = requestUserId(getRequestUser(req)) || "admin";
    await ensureGlossaryLanguages(glossaryId, [language], actor);
    return { ok: true };
  });

  // Delete language section (optional)
  app.delete(
    "/termbases/:id/entries/:entryId/languages/:lang",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const glossaryId = Number((req.params as any).id);
      const entryId = String((req.params as any).entryId || "").trim();
      const language = normalizeLang(String((req.params as any).lang || ""));
      if (!Number.isFinite(glossaryId) || !entryId || !language) {
        return reply.code(400).send({ error: "Invalid ids" });
      }
      const langCandidates = buildLangCandidates(language);
      if (langCandidates.length === 0) {
        return reply.code(400).send({ error: "Invalid language code." });
      }

      const actor = requestUserId(getRequestUser(req)) || "admin";
      const deleted = await withTransaction(async (client) => {
        const res = await client.query(
          `DELETE FROM glossary_entries
           WHERE glossary_id = $1
             AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
             AND (
               LOWER(source_lang) = ANY($3)
               OR LOWER(target_lang) = ANY($3)
             )`,
          [glossaryId, entryId, langCandidates]
        );
        if ((res.rowCount ?? 0) === 0) return false;
        await client.query(
          "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
          [actor, glossaryId]
        );
        return true;
      });

      if (!deleted) {
        return reply.code(404).send({ error: "Language not found" });
      }

      return { ok: true };
    }
  );

  // Add term to language
  app.post("/termbases/:id/entries/:entryId/terms", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    const entryId = String((req.params as any).entryId || "").trim();
    if (!Number.isFinite(glossaryId) || !entryId) {
      return reply.code(400).send({ error: "Invalid ids" });
    }
    const body = (req.body as any) || {};
    const language = normalizeLang(String(body.language ?? body.lang ?? ""));
    const text = String(body.text ?? body.term ?? "").trim();
    const notes = String(body.notes ?? "").trim() || null;
    const statusResult = parseStatusInput(body.status);
    const partOfSpeech = String(body.partOfSpeech ?? "").trim();
    const customFields = normalizeFieldMap(body.customFields ?? body.termFields ?? body.term_fields ?? null);
    if (!language || !text) {
      return reply.code(400).send({ error: "language and text are required" });
    }
    if (statusResult.error) {
      return reply.code(400).send({ error: statusResult.error });
    }

    const rowsRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
       ORDER BY id ASC`,
      [glossaryId, entryId]
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) {
      return reply.code(404).send({ error: "Entry not found" });
    }

    await ensureConceptId(glossaryId, entryId);

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const nowIso = new Date().toISOString();
    const meta: Record<string, any> = {};
    if (statusResult.status !== null) applyStatus(meta, statusResult.status);
    if (partOfSpeech) applyPartOfSpeech(meta, partOfSpeech);
    if (Object.keys(customFields).length > 0) {
      applyTermFields(meta, language, text, customFields);
    }

    const sections = uniqueTerms(rows, glossaryId);
    const otherLanguages = sections.filter((section) => section.language !== language);

    const inserts: Array<{
      sourceLang: string;
      targetLang: string;
      term: string;
      translation: string;
    }> = [];

    if (otherLanguages.length === 0) {
      inserts.push({
        sourceLang: language,
        targetLang: language,
        term: text,
        translation: text
      });
    } else {
      for (const section of otherLanguages) {
        const primary = pickPrimaryTerm(section.terms);
        if (!primary) continue;
        inserts.push({
          sourceLang: language,
          targetLang: section.language,
          term: text,
          translation: primary
        });
      }
    }

    const conceptId = rows[0]?.concept_id || entryId;

    const created = await withTransaction(async (client) => {
      const createdRows: GlossaryEntryRow[] = [];
      for (const entry of inserts) {
        const sourceCandidates = buildLangCandidates(entry.sourceLang);
        const targetCandidates = buildLangCandidates(entry.targetLang);
        if (sourceCandidates.length === 0 || targetCandidates.length === 0) {
          continue;
        }
        const exists = await client.query(
          `SELECT id FROM glossary_entries
           WHERE glossary_id = $1
             AND concept_id = $2
             AND LOWER(source_lang) = ANY($3)
             AND LOWER(target_lang) = ANY($4)
             AND term = $5
             AND translation = $6`,
          [glossaryId, conceptId, sourceCandidates, targetCandidates, entry.term, entry.translation]
        );
        if ((exists.rowCount ?? 0) > 0) continue;
        const insertRes = await client.query<GlossaryEntryRow>(
          `INSERT INTO glossary_entries
            (glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $10)
           RETURNING id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at`,
          [
            glossaryId,
            conceptId,
            entry.sourceLang,
            entry.targetLang,
            entry.term,
            entry.translation,
            notes,
            JSON.stringify(meta),
            actor,
            nowIso
          ]
        );
        if (insertRes.rows[0]) createdRows.push(insertRes.rows[0]);
      }

      if (createdRows.length > 0) {
        await client.query(
          "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
          [actor, glossaryId]
        );
      }

      return createdRows;
    });

    await ensureGlossaryLanguages(glossaryId, [language], actor);

    return reply.code(201).send({
      terms: created.map((row) => ({
        termId: encodeTermKey({
          glossaryId,
          conceptId,
          lang: language,
          text
        }),
        text,
        status: statusFromMeta(meta),
        notes,
        partOfSpeech: partOfSpeech || null,
        customFields: Object.keys(customFields).length > 0 ? customFields : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        audit: hasAudit(auditFromRow(row)) ? auditFromRow(row) : null
      }))
    });
  });
  // Update term
  app.patch("/terms/:termId", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const termId = String((req.params as any).termId || "").trim();
    const key = decodeTermKey(termId);
    if (!key) {
      return reply.code(400).send({ error: "Invalid term id" });
    }

    const body = (req.body as any) || {};
    const nextText = body.text !== undefined ? String(body.text ?? "").trim() : null;
    const nextNotes = body.notes !== undefined ? String(body.notes ?? "").trim() : null;
    const statusResult = parseStatusInput(body.status);
    const nextStatus = statusResult.status;
    const nextPos = body.partOfSpeech !== undefined ? String(body.partOfSpeech ?? "").trim() : null;
    const nextCustomFields = normalizeFieldMap(body.customFields ?? body.termFields ?? body.term_fields ?? null);
    const expectedUpdatedAt = body.updatedAt ? String(body.updatedAt) : null;

    if (nextText !== null && !nextText) {
      return reply.code(400).send({ error: "text cannot be empty" });
    }
    if (statusResult.error) {
      return reply.code(400).send({ error: statusResult.error });
    }

    const langCandidates = buildLangCandidates(key.lang);
    if (langCandidates.length === 0) {
      return reply.code(400).send({ error: "Invalid term language." });
    }

    const rowsRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
         AND (
           (LOWER(source_lang) = ANY($3) AND term = $4)
           OR (LOWER(target_lang) = ANY($3) AND translation = $4)
         )
       ORDER BY id ASC`,
      [key.glossaryId, key.conceptId, langCandidates, key.text]
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) {
      return reply.code(404).send({ error: "Term not found" });
    }

    const entryRowsRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
       ORDER BY id ASC`,
      [key.glossaryId, key.conceptId]
    );
    const entryRows = entryRowsRes.rows;
    if (entryRows.length === 0) {
      return reply.code(404).send({ error: "Entry not found" });
    }

    const maxUpdatedAt = rows.reduce<string | null>((acc, row) => {
      const ts = row.updated_at ? new Date(row.updated_at).toISOString() : null;
      if (!ts) return acc;
      if (!acc || ts > acc) return ts;
      return acc;
    }, null);

    if (expectedUpdatedAt && maxUpdatedAt && expectedUpdatedAt < maxUpdatedAt) {
      return reply.code(409).send({ error: "Term was updated by another user.", updatedAt: maxUpdatedAt });
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const nowIso = new Date().toISOString();

    const updated = await withTransaction(async (client) => {
      const updatedRows: GlossaryEntryRow[] = [];
      for (const row of entryRows) {
        const meta = normalizeMeta(row.meta_json);

        const normalizedSource = normalizeLang(row.source_lang) || row.source_lang;
        const normalizedTarget = normalizeLang(row.target_lang) || row.target_lang;
        const matchesSource = normalizedSource === key.lang && row.term === key.text;
        const matchesTarget = normalizedTarget === key.lang && row.translation === key.text;
        const matchesTerm = matchesSource || matchesTarget;

        if (matchesTerm && nextStatus !== null) applyStatus(meta, nextStatus);
        if (matchesTerm && nextPos !== null) applyPartOfSpeech(meta, nextPos);
        const shouldUpdateNotes = nextNotes !== null && matchesTerm;
        const newTerm = nextText && matchesSource ? nextText : row.term;
        const newTranslation = nextText && matchesTarget ? nextText : row.translation;

        if (nextText) {
          renameTermFields(meta, key.lang, key.text, nextText);
          renameTermAudit(meta, key.lang, key.text, nextText);
        }
        if (Object.keys(nextCustomFields).length > 0) {
          applyTermFields(meta, key.lang, nextText ?? key.text, nextCustomFields);
        }
        const termTouched =
          nextText !== null ||
          nextStatus !== null ||
          nextPos !== null ||
          (nextNotes !== null && matchesTerm) ||
          Object.keys(nextCustomFields).length > 0;
        if (termTouched) {
          touchTermAudit(meta, key.lang, nextText ?? key.text, row, actor, nowIso);
        }
        touchEntryAudit(meta, row, actor, nowIso);

        const updateRes = await client.query<GlossaryEntryRow>(
          `UPDATE glossary_entries
           SET source_lang = $1,
               target_lang = $2,
               term = $3,
               translation = $4,
               notes = $5,
               meta_json = $6,
               updated_by = $7,
               updated_at = $8
           WHERE id = $9
           RETURNING id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at`,
          [
            normalizedSource,
            normalizedTarget,
            newTerm,
            newTranslation,
            shouldUpdateNotes ? nextNotes : row.notes,
            JSON.stringify(meta),
            actor,
            nowIso,
            row.id
          ]
        );
        if (updateRes.rows[0]) updatedRows.push(updateRes.rows[0]);
      }

      await client.query(
        "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
        [actor, key.glossaryId]
      );
      return updatedRows;
    });

    const finalText = nextText ?? key.text;
    const responseRow =
      updated.find((row) => {
        const normalizedSource = normalizeLang(row.source_lang) || row.source_lang;
        const normalizedTarget = normalizeLang(row.target_lang) || row.target_lang;
        return (
          (normalizedSource === key.lang && row.term === finalText) ||
          (normalizedTarget === key.lang && row.translation === finalText)
        );
      }) ?? updated[0] ?? rows[0];
    const finalStatus = nextStatus ?? statusFromMeta(normalizeMeta(responseRow.meta_json));
    const finalNotes = nextNotes !== null ? nextNotes : responseRow.notes ?? null;
    const finalPos = nextPos !== null ? nextPos : normalizeMeta(responseRow.meta_json).partOfSpeech ?? null;
    const metaForResponse = normalizeMeta(responseRow.meta_json ?? rows[0].meta_json);
    const termFieldMap = normalizeTermFields(metaForResponse.term_fields);
    const finalCustomFields = normalizeFieldMap(termFieldMap?.[key.lang]?.[finalText]);
    const termAuditMap = normalizeTermAuditMap(metaForResponse.term_audit ?? metaForResponse.termAudit ?? null);
    const auditCandidate = mergeAudit(
      termAuditMap[key.lang]?.[finalText] ?? {},
      auditFromRow(responseRow ?? rows[0])
    );

    return {
      term: {
        termId: encodeTermKey({
          glossaryId: key.glossaryId,
          conceptId: key.conceptId,
          lang: key.lang,
          text: finalText
        }),
        text: finalText,
        status: finalStatus,
        notes: finalNotes,
        partOfSpeech: finalPos ? String(finalPos) : null,
        customFields: Object.keys(finalCustomFields).length > 0 ? finalCustomFields : null,
        updatedAt: updated[0]?.updated_at ? new Date(updated[0].updated_at).toISOString() : nowIso,
        audit: hasAudit(auditCandidate) ? auditCandidate : null
      }
    };
  });

  // Delete term
  app.delete("/terms/:termId", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const termId = String((req.params as any).termId || "").trim();
    const key = decodeTermKey(termId);
    if (!key) {
      return reply.code(400).send({ error: "Invalid term id" });
    }

    const langCandidates = buildLangCandidates(key.lang);
    if (langCandidates.length === 0) {
      return reply.code(400).send({ error: "Invalid term language." });
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const deleted = await withTransaction(async (client) => {
      const res = await client.query(
        `DELETE FROM glossary_entries
         WHERE glossary_id = $1
           AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
           AND (
             (LOWER(source_lang) = ANY($3) AND term = $4)
             OR (LOWER(target_lang) = ANY($3) AND translation = $4)
           )`,
        [key.glossaryId, key.conceptId, langCandidates, key.text]
      );
      if ((res.rowCount ?? 0) === 0) return false;
      await client.query(
        "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
        [actor, key.glossaryId]
      );
      return true;
    });

    if (!deleted) {
      return reply.code(404).send({ error: "Term not found" });
    }
    return { ok: true };
  });

  // Export termbase
}

