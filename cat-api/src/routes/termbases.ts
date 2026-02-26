
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
import { registerTermbaseMutationRoutes } from "./termbases.mutation-routes.js";
export { buildTermbaseCsvExport } from "./termbases.helpers.js";

export async function termbasesRoutes(app: FastifyInstance) {
  // Create termbase
  app.post("/termbases", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const name = String(body.name ?? body.label ?? "").trim();
    if (!name) {
      return reply.code(400).send({ error: "name is required." });
    }

    const languages = normalizeLanguages(body.languages ?? body.language ?? "");
    const allowSingleLanguage =
      Boolean(body.allowSingleLanguage ?? body.allow_single_language ?? body.allowSingleLang);
    if (languages.length < 1) {
      return reply.code(400).send({ error: "At least one language is required." });
    }
    if (languages.length < 2 && !allowSingleLanguage) {
      return reply.code(400).send({ error: "At least two languages are required unless explicitly allowed." });
    }

    let defaultSourceLang = normalizeLang(
      String(body.defaultSourceLang ?? body.default_source_lang ?? body.sourceLang ?? body.source_lang ?? "")
    );
    let defaultTargetLang = normalizeLang(
      String(body.defaultTargetLang ?? body.default_target_lang ?? body.targetLang ?? body.target_lang ?? "")
    );

    if (defaultSourceLang && !languages.includes(defaultSourceLang)) {
      languages.push(defaultSourceLang);
    }
    if (defaultTargetLang && !languages.includes(defaultTargetLang)) {
      languages.push(defaultTargetLang);
    }

    if (defaultSourceLang && defaultTargetLang && defaultSourceLang === defaultTargetLang) {
      return reply.code(400).send({ error: "Default source and target language must differ." });
    }

    const templateRaw = String(body.template ?? body.structure?.template ?? body.structure_template ?? "basic")
      .trim()
      .toLowerCase();
    const template = templateRaw === "advanced" ? "advanced" : "basic";
    const structureInput = body.structure ?? body.structure_json ?? body.structureJson ?? null;
    let structure = normalizeStructure(structureInput, template);
    const hasFields = structure.entry.length + structure.language.length + structure.term.length > 0;
    if (!hasFields) {
      structure = defaultStructure(template);
    }

    const description = String(body.description ?? "").trim() || null;
    const visibilityRaw = String(body.visibility ?? "").trim().toLowerCase();
    const visibility =
      visibilityRaw === "admins" || visibilityRaw === "private" ? visibilityRaw : "managers";
    const actor = requestUserId(getRequestUser(req)) || "admin";

    const exists = await db.query<{ id: number }>(
      "SELECT id FROM glossaries WHERE LOWER(label) = LOWER($1) LIMIT 1",
      [name]
    );
    if ((exists.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "A termbase with this name already exists." });
    }

    const created = await db.query<{ id: number }>(
      `INSERT INTO glossaries(label, description, languages, default_source_lang, default_target_lang, structure_json, visibility, disabled, uploaded_by, uploaded_at, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, FALSE, $8, NOW(), $8, NOW())
       RETURNING id`,
      [
        name,
        description,
        JSON.stringify(languages),
        defaultSourceLang || null,
        defaultTargetLang || null,
        JSON.stringify(structure),
        visibility,
        actor
      ]
    );
    const glossaryId = Number(created.rows[0]?.id);
    if (!Number.isFinite(glossaryId) || glossaryId <= 0) {
      return reply.code(500).send({ error: "Failed to create termbase." });
    }

    return reply.code(201).send({
      termbase: {
        id: glossaryId,
        name,
        languages,
        structure,
        defaultSourceLang: defaultSourceLang || null,
        defaultTargetLang: defaultTargetLang || null,
        entryCount: 0
      }
    });
  });

  // Termbase metadata
  app.get("/termbases/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const metaRes = await db.query<GlossaryRow>(
      `SELECT id, label, languages, default_source_lang, default_target_lang, structure_json, updated_at
       FROM glossaries
       WHERE id = $1`,
      [glossaryId]
    );
    const glossary = metaRes.rows[0];
    if (!glossary) {
      return reply.code(404).send({ error: "Termbase not found" });
    }

    const countRes = await db.query<{ count: number }>(
      `SELECT COUNT(DISTINCT COALESCE(concept_id, CONCAT('row-', id)))::int AS count
       FROM glossary_entries
       WHERE glossary_id = $1`,
      [glossaryId]
    );

    return {
      termbase: {
        id: glossary.id,
        name: glossary.label,
        languages: normalizeLanguages(glossary.languages),
        defaultSourceLang: glossary.default_source_lang ? normalizeLang(glossary.default_source_lang) : null,
        defaultTargetLang: glossary.default_target_lang ? normalizeLang(glossary.default_target_lang) : null,
        structure: glossary.structure_json ?? {},
        entryCount: Number(countRes.rows[0]?.count ?? 0),
        updatedAt: glossary.updated_at ? new Date(glossary.updated_at).toISOString() : null
      }
    };
  });

  // Termbase structure schema
  app.get("/termbases/:id/structure", { preHandler: [requireAuth] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const res = await db.query<GlossaryRow>(
      `SELECT id, structure_json
       FROM glossaries
       WHERE id = $1`,
      [glossaryId]
    );
    const glossary = res.rows[0];
    if (!glossary) {
      return reply.code(404).send({ error: "Termbase not found" });
    }
    const raw = glossary.structure_json ?? {};
    const templateRaw = String((raw as any)?.template ?? "").trim().toLowerCase();
    const template = templateRaw === "advanced" ? "advanced" : templateRaw === "basic" ? "basic" : "";
    const structure = normalizeStructure(raw, template);
    return { structure };
  });

  // Termbase entry list (concepts)
  app.get("/termbases/:id/entries", { preHandler: [requireAuth] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const query = (req.query as any) || {};
    const search = String(query.query ?? query.q ?? "").trim();
    const sourceLang = normalizeLang(String(query.sourceLang ?? query.srcLang ?? ""));
    const targetLang = normalizeLang(String(query.targetLang ?? query.tgtLang ?? ""));
    const displayLang = normalizeLang(String(query.displayLang ?? query.lang ?? sourceLang ?? targetLang ?? ""));
    const sourceCandidates = sourceLang ? buildLangCandidates(sourceLang) : [];
    const targetCandidates = targetLang ? buildLangCandidates(targetLang) : [];
    const displayCandidates = displayLang ? buildLangCandidates(displayLang) : [];
    const author = String(query.author ?? "").trim();
    const createdFrom = parseDateParam(query.createdFrom, false);
    const createdTo = parseDateParam(query.createdTo, true);
    const updatedFrom = parseDateParam(query.updatedFrom, false);
    const updatedTo = parseDateParam(query.updatedTo, true);
    const hasIllustrationRaw = String(query.hasIllustration ?? query.has_illustration ?? "").trim().toLowerCase();
    const hasIllustration = hasIllustrationRaw === "true" || hasIllustrationRaw === "1";
    const pageSize = Math.min(Math.max(Number(query.pageSize ?? query.limit ?? 50) || 50, 10), 200);
    const page = Math.max(Number(query.page ?? 1) || 1, 1);
    const offset = (page - 1) * pageSize;

    const where: string[] = ["glossary_id = $1"];
    const params: any[] = [glossaryId];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(term ILIKE $${params.length} OR translation ILIKE $${params.length} OR COALESCE(notes, '') ILIKE $${params.length})`);
    }
    if (sourceCandidates.length > 0) {
      params.push(sourceCandidates);
      where.push(`LOWER(source_lang) = ANY($${params.length})`);
    }
    if (targetCandidates.length > 0) {
      params.push(targetCandidates);
      where.push(`LOWER(target_lang) = ANY($${params.length})`);
    }
    if (author) {
      params.push(`%${author}%`);
      where.push(`(created_by ILIKE $${params.length} OR updated_by ILIKE $${params.length})`);
    }
    if (createdFrom) {
      params.push(createdFrom);
      where.push(`created_at >= $${params.length}`);
    }
    if (createdTo) {
      params.push(createdTo);
      where.push(`created_at <= $${params.length}`);
    }
    if (updatedFrom) {
      params.push(updatedFrom);
      where.push(`updated_at >= $${params.length}`);
    }
    if (updatedTo) {
      params.push(updatedTo);
      where.push(`updated_at <= $${params.length}`);
    }
    if (hasIllustration) {
      where.push(
        `EXISTS (
           SELECT 1
           FROM glossary_entry_media m
           WHERE m.glossary_id = glossary_entries.glossary_id
             AND (
               m.concept_id = COALESCE(glossary_entries.concept_id, CONCAT('row-', glossary_entries.id))
               OR m.entry_id = glossary_entries.id
             )
         )`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRes = await db.query<{ count: number }>(
      `SELECT COUNT(DISTINCT COALESCE(concept_id, CONCAT('row-', id)))::int AS count
       FROM glossary_entries
       ${whereSql}`,
      params
    );

    const displayTermSql = displayCandidates.length > 0
      ? `COALESCE(
          MAX(CASE WHEN LOWER(source_lang) = ANY($${params.length + 1}) THEN term END),
          MAX(CASE WHEN LOWER(target_lang) = ANY($${params.length + 1}) THEN translation END),
          MAX(term),
          MAX(translation)
        )`
      : "COALESCE(MAX(term), MAX(translation))";

    const displayLangSql = displayCandidates.length > 0
      ? `COALESCE(
          MAX(CASE WHEN LOWER(source_lang) = ANY($${params.length + 1}) THEN source_lang END),
          MAX(CASE WHEN LOWER(target_lang) = ANY($${params.length + 1}) THEN target_lang END),
          MAX(source_lang),
          MAX(target_lang)
        )`
      : "COALESCE(MAX(source_lang), MAX(target_lang))";

    const listParams = displayCandidates.length > 0
      ? [...params, displayCandidates, pageSize, offset]
      : [...params, pageSize, offset];

    const listRes = await db.query<{
      concept_key: string;
      display_term: string | null;
      display_lang: string | null;
      updated_at: string | null;
    }>(
      `SELECT COALESCE(concept_id, CONCAT('row-', id)) AS concept_key,
              ${displayTermSql} AS display_term,
              ${displayLangSql} AS display_lang,
              MAX(updated_at) AS updated_at
       FROM glossary_entries
       ${whereSql}
       GROUP BY concept_key
       ORDER BY MAX(updated_at) DESC NULLS LAST, concept_key ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return {
      entries: listRes.rows.map((row) => ({
        entryId: row.concept_key,
        displayTerm: row.display_term || "",
        displayLang: row.display_lang ? normalizeLang(row.display_lang) || null : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
      })),
      page,
      pageSize,
      total: Number(countRes.rows[0]?.count ?? 0)
    };
  });

  // Termbase concordance search (editor lookups)
  app.get("/termbases/:id/concordance", { preHandler: [requireAuth] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const query = (req.query as any) || {};
    const qRaw = String(query.q ?? query.query ?? "").trim();
    if (!qRaw) return { entries: [] };

    const sourceLang = normalizeLang(String(query.sourceLang ?? query.srcLang ?? ""));
    const targetLang = normalizeLang(String(query.targetLang ?? query.tgtLang ?? ""));
    if (!sourceLang || !targetLang) {
      return reply.code(400).send({ error: "sourceLang and targetLang are required" });
    }

    const modeRaw = String(query.mode ?? "auto").trim().toLowerCase();
    const mode = modeRaw === "search" ? "search" : "auto";
    const searchSource = parseBooleanParam(query.searchSource ?? query.search_source, true);
    const searchTarget = parseBooleanParam(query.searchTarget ?? query.search_target, mode === "search");
    const effectiveSearchSource = searchSource || (!searchSource && !searchTarget);
    const effectiveSearchTarget = searchTarget;

    const includeDeprecated = parseBooleanParam(query.includeDeprecated ?? query.include_deprecated, true);
    const includeForbidden = parseBooleanParam(query.includeForbidden ?? query.include_forbidden, true);
    const categoryFilter = String(query.category ?? query.kategorie ?? "").trim();
    const limit = clampInt(query.limit ?? query.pageSize ?? query.page_size, 1, 50, 10);

    const allowedStatuses = new Set<TermStatus>(["preferred"]);
    if (includeDeprecated) allowedStatuses.add("allowed");
    if (includeForbidden) allowedStatuses.add("forbidden");

    const queryNorm = normalizeConcordanceText(qRaw);
    const queryTokens = concordanceTokens(qRaw);
    if (!queryNorm) return { entries: [] };

    const rawTokens = String(qRaw)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1);

    const tokenLikes = Array.from(new Set([queryNorm, ...queryTokens, ...rawTokens]))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .slice(0, 10)
      .map((token) => `%${token}%`);
    if (tokenLikes.length === 0) return { entries: [] };

    const sourceCandidates = buildLangCandidates(sourceLang);
    const targetCandidates = buildLangCandidates(targetLang);

    const where: string[] = ["glossary_id = $1"];
    const params: any[] = [glossaryId];

    if (sourceCandidates.length > 0 && targetCandidates.length > 0) {
      params.push(sourceCandidates);
      const sourceIdx = params.length;
      params.push(targetCandidates);
      const targetIdx = params.length;
      where.push(
        `(LOWER(source_lang) = ANY($${sourceIdx})
          OR LOWER(target_lang) = ANY($${sourceIdx})
          OR LOWER(source_lang) = ANY($${targetIdx})
          OR LOWER(target_lang) = ANY($${targetIdx}))`
      );
    }

    params.push(tokenLikes);
    const likeIdx = params.length;
    if (effectiveSearchSource && effectiveSearchTarget) {
      where.push(`(term ILIKE ANY($${likeIdx}) OR translation ILIKE ANY($${likeIdx}))`);
    } else if (effectiveSearchSource) {
      where.push(`term ILIKE ANY($${likeIdx})`);
    } else {
      where.push(`translation ILIKE ANY($${likeIdx})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const entryIdsRes = await db.query<{ entry_id: string }>(
      `SELECT DISTINCT COALESCE(concept_id, CONCAT('row-', id)) AS entry_id
       FROM glossary_entries
       ${whereSql}`,
      params
    );
    const entryIds = entryIdsRes.rows.map((row) => String(row.entry_id)).filter(Boolean);
    if (entryIds.length === 0) return { entries: [] };

    const conceptIds = entryIds.filter((id) => !id.startsWith("row-"));
    const rowIds = entryIds
      .filter((id) => id.startsWith("row-"))
      .map((id) => Number(id.slice(4)))
      .filter((id) => Number.isFinite(id));

    const rowParams: any[] = [glossaryId];
    const entryIdConditions: string[] = [];
    if (conceptIds.length > 0) {
      rowParams.push(conceptIds);
      entryIdConditions.push(`concept_id = ANY($${rowParams.length})`);
    }
    if (rowIds.length > 0) {
      rowParams.push(rowIds);
      entryIdConditions.push(`id = ANY($${rowParams.length})`);
    }

    let languageCondition = "";
    if (sourceCandidates.length > 0 && targetCandidates.length > 0) {
      rowParams.push(sourceCandidates);
      const sourceIdx = rowParams.length;
      rowParams.push(targetCandidates);
      const targetIdx = rowParams.length;
      languageCondition = `(LOWER(source_lang) = ANY($${sourceIdx})
          OR LOWER(target_lang) = ANY($${sourceIdx})
          OR LOWER(source_lang) = ANY($${targetIdx})
          OR LOWER(target_lang) = ANY($${targetIdx}))`;
    }

    const entryWhere =
      entryIdConditions.length > 0
        ? `AND (${entryIdConditions.join(" OR ")})${languageCondition ? ` AND ${languageCondition}` : ""}`
        : languageCondition
          ? `AND ${languageCondition}`
          : "";

    const rowsRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
       ${entryWhere}
       ORDER BY id ASC`,
      rowParams
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) return { entries: [] };

    const byEntry = new Map<string, GlossaryEntryRow[]>();
    rows.forEach((row) => {
      const entryId = conceptKeyForRow(row);
      const list = byEntry.get(entryId) ?? [];
      list.push(row);
      byEntry.set(entryId, list);
    });

    const illustrationMetaByEntry = new Map<string, { filename: string; storagePath: string }>();
    if (conceptIds.length > 0 || rowIds.length > 0) {
      const mediaConditions: string[] = [];
      const mediaParams: any[] = [glossaryId];
      if (conceptIds.length > 0) {
        mediaParams.push(conceptIds);
        mediaConditions.push(`concept_id = ANY($${mediaParams.length})`);
      }
      if (rowIds.length > 0) {
        mediaParams.push(rowIds);
        mediaConditions.push(`entry_id = ANY($${mediaParams.length})`);
      }
      const whereMedia = mediaConditions.length > 0 ? `AND (${mediaConditions.join(" OR ")})` : "";
      const mediaRes = await db.query<{
        entry_id: number;
        concept_id: string | null;
        storage_path: string;
        original_filename: string | null;
      }>(
        `SELECT entry_id, concept_id, storage_path, original_filename
         FROM glossary_entry_media
         WHERE glossary_id = $1
         ${whereMedia}`,
        mediaParams
      );
      for (const row of mediaRes.rows) {
        const entryId = row.concept_id ? String(row.concept_id) : `row-${row.entry_id}`;
        if (!row.storage_path || illustrationMetaByEntry.has(entryId)) continue;
        const filename = row.original_filename ?? String(row.storage_path).split("/").pop() ?? "illustration";
        illustrationMetaByEntry.set(entryId, { filename, storagePath: row.storage_path });
      }
    }

    const results: Array<{
      entryId: string;
      score: number;
      matchType: ConcordanceMatchType;
      matchRatio?: number;
      matchTerm?: string | null;
      matchLang?: "source" | "target" | null;
      entryFields?: Record<string, any> | null;
      updatedAt: string | null;
      sourceTerms: Array<{ text: string; status: TermStatus; updatedAt: string | null }>;
      targetTerms: Array<{ text: string; status: TermStatus; updatedAt: string | null }>;
      matches: ConcordanceMatch[];
      illustration?: TermbaseIllustration | null;
    }> = [];

    for (const [entryId, entryRows] of byEntry.entries()) {
      const { entryFields, termFields } = aggregateCustomFields(entryRows);
      const termAudit = aggregateTermAudit(entryRows);
      const sections = uniqueTerms(entryRows, glossaryId, termFields, termAudit);
      const sectionByLanguage = new Map<string, (typeof sections)[number]>();
      sections.forEach((section) => {
        sectionByLanguage.set(String(section.language ?? "").toLowerCase(), section);
      });

      let sourceSection: (typeof sections)[number] | null = null;
      for (const candidate of sourceCandidates) {
        const candidateSection = sectionByLanguage.get(String(candidate ?? "").toLowerCase());
        if (candidateSection) {
          sourceSection = candidateSection;
          break;
        }
      }

      let targetSection: (typeof sections)[number] | null = null;
      for (const candidate of targetCandidates) {
        const candidateSection = sectionByLanguage.get(String(candidate ?? "").toLowerCase());
        if (candidateSection) {
          targetSection = candidateSection;
          break;
        }
      }

      const sourceTermsRaw = sourceSection?.terms ?? [];
      const targetTermsRaw = targetSection?.terms ?? [];

      const targetTerms = targetTermsRaw.filter((term) => allowedStatuses.has(term.status));
      if (targetTerms.length === 0) continue;

      const matches: ConcordanceMatch[] = [];
      if (effectiveSearchSource) {
        sourceTermsRaw.forEach((term) => {
          if (!allowedStatuses.has(term.status)) return;
          const match = matchConcordanceTerm({
            termText: term.text,
            queryNorm,
            queryTokens
          });
          if (!match) return;
          matches.push({
            term: term.text,
            lang: "source",
            type: match.type,
            ratio: match.ratio,
            score: scoreMatch(match, term.status),
            status: term.status
          });
        });
      }
      if (effectiveSearchTarget) {
        targetTermsRaw.forEach((term) => {
          if (!allowedStatuses.has(term.status)) return;
          const match = matchConcordanceTerm({
            termText: term.text,
            queryNorm,
            queryTokens
          });
          if (!match) return;
          matches.push({
            term: term.text,
            lang: "target",
            type: match.type,
            ratio: match.ratio,
            score: scoreMatch(match, term.status),
            status: term.status
          });
        });
      }

      if (matches.length === 0) continue;

      const entryUpdatedAt = entryRows.reduce<string | null>((acc, row) => {
        const ts = row.updated_at ? new Date(row.updated_at).toISOString() : null;
        if (!ts) return acc;
        if (!acc || ts > acc) return ts;
        return acc;
      }, null);

      if (categoryFilter) {
        const categoryValue =
          getEntryFieldValue(entryFields, ["Kategorie", "Category", "Domain"]) ?? "";
        if (!categoryValue || !categoryValue.toLowerCase().includes(categoryFilter.toLowerCase())) {
          continue;
        }
      }

      matches.sort((a, b) => b.score - a.score);
      const bestMatch = matches[0]!;

      const mappedSourceTerms = sourceTermsRaw.map((term) => ({
        text: term.text,
        status: term.status,
        updatedAt: term.audit?.modifiedAt ?? term.updatedAt ?? entryUpdatedAt
      }));

      const mappedTargetTerms = targetTerms
        .map((term) => ({
          text: term.text,
          status: term.status,
          updatedAt: term.audit?.modifiedAt ?? term.updatedAt ?? entryUpdatedAt
        }))
        .sort((a, b) => {
          if (a.status === b.status) return a.text.localeCompare(b.text);
          if (a.status === "preferred") return -1;
          if (b.status === "preferred") return 1;
          if (a.status === "forbidden") return 1;
          if (b.status === "forbidden") return -1;
          return 0;
        });

      results.push({
        entryId,
        score: bestMatch.score,
        matchType: bestMatch.type,
        matchRatio: bestMatch.ratio,
        matchTerm: bestMatch.term,
        matchLang: bestMatch.lang,
        entryFields: Object.keys(entryFields).length > 0 ? entryFields : null,
        updatedAt: entryUpdatedAt,
        sourceTerms: mappedSourceTerms,
        targetTerms: mappedTargetTerms,
        matches
      });
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) {
        return b.updatedAt.localeCompare(a.updatedAt);
      }
      return a.entryId.localeCompare(b.entryId);
    });

    const sliced = results.slice(0, limit);

    for (const entry of sliced) {
      if (entry.illustration) continue;
      const meta = illustrationMetaByEntry.get(entry.entryId);
      if (meta?.storagePath) {
        try {
          const presigned = await presignGetObject({
            key: meta.storagePath,
            downloadFilename: meta.filename
          });
          entry.illustration = { filename: meta.filename, url: presigned.url };
        } catch {
          entry.illustration = { filename: meta.filename, url: null };
        }
      } else {
        const illustrationField =
          getEntryFieldValue(entry.entryFields, ["Illustration", "Graphic"]) ?? null;
        if (illustrationField) {
          entry.illustration = await resolveIllustrationFromField(glossaryId, illustrationField);
        }
      }
    }

    return { entries: sliced };
  });
  // Termbase entry detail (concept)
  app.get("/termbases/:id/entries/:entryId", { preHandler: [requireAuth] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    const entryId = String((req.params as any).entryId || "").trim();
    if (!Number.isFinite(glossaryId) || !entryId) {
      return reply.code(400).send({ error: "Invalid ids" });
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

    const { entryFields, languageFields, termFields } = aggregateCustomFields(rows);
    const entryAudit = aggregateEntryAudit(rows);
    const termAudit = aggregateTermAudit(rows);
    const sections = uniqueTerms(rows, glossaryId, termFields, termAudit).map((section) => {
      const fields = languageFields[section.language] ?? {};
      return {
        ...section,
        customFields: Object.keys(fields).length > 0 ? fields : null
      };
    });
    const entryUpdatedAt = rows.reduce<string | null>((acc, row) => {
      const ts = row.updated_at ? new Date(row.updated_at).toISOString() : null;
      if (!ts) return acc;
      if (!acc || ts > acc) return ts;
      return acc;
    }, null);
    const illustration = await loadEntryIllustration(glossaryId, entryId);

    return {
      entry: {
        entryId,
        updatedAt: entryUpdatedAt,
        customFields: Object.keys(entryFields).length > 0 ? entryFields : null,
        audit: entryAudit,
        languages: sections,
        illustration
      }
    };
  });

  registerTermbaseMutationRoutes(app);

  app.get("/termbases/:id/structure/export", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const metaRes = await db.query<GlossaryRow>(
      `SELECT id, label, structure_json FROM glossaries WHERE id = $1`,
      [glossaryId]
    );
    const glossary = metaRes.rows[0];
    if (!glossary) {
      return reply.code(404).send({ error: "Termbase not found" });
    }

    const structure = normalizeStructure(
      glossary.structure_json ?? {},
      String(glossary.structure_json?.template ?? "")
    );

    reply.header("Content-Type", "application/json; charset=utf-8");
    return reply.send(structure);
  });

  // Export termbase
  app.get("/termbases/:id/export", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const glossaryId = Number((req.params as any).id);
    if (!Number.isFinite(glossaryId)) {
      return reply.code(400).send({ error: "Invalid termbase id" });
    }

    const format = String(((req.query as any) || {}).format || "csv").toLowerCase();
    if (format !== "csv" && format !== "tbx") {
      return reply.code(400).send({ error: "Invalid format (csv or tbx)" });
    }

    const metaRes = await db.query<GlossaryRow>(
      `SELECT id, label, languages, updated_at, structure_json FROM glossaries WHERE id = $1`,
      [glossaryId]
    );
    const glossary = metaRes.rows[0];
    if (!glossary) {
      return reply.code(404).send({ error: "Termbase not found" });
    }

    const entriesRes = await db.query<GlossaryEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
       ORDER BY id ASC`,
      [glossaryId]
    );

    const safeBase = String(glossary.label || `termbase-${glossaryId}`)
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || `termbase-${glossaryId}`;

    const exportStructure = normalizeStructureFields(glossary.structure_json ?? {});

    if (format === "tbx") {
      const xml = buildGlossaryTbx(entriesRes.rows, { structure: glossary.structure_json ?? {} });
      reply.header("Content-Type", "application/x-tbx+xml; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${safeBase}.tbx"`);
      return reply.send(xml);
    }

    const csv = buildTermbaseCsvExport({
      entries: entriesRes.rows,
      structure: exportStructure
    });

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${safeBase}.csv"`);
    return reply.send(csv);
  });
}


