import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import {
  requireAuth,
  requireManagerOrAdmin,
  getRequestUser,
  requestUserId
} from "../middleware/auth.js";
import { decryptJson, encryptJson } from "../lib/secrets.js";
import { maskApiKey, maskBaseUrl } from "../lib/masking.js";
import { applyLanguageProcessingRules, validateLanguageProcessingRules } from "../lib/language-processing.js";
import {
  hasInvalidOverrideKeys,
  insertRulesetVersion,
  normalizeBool,
  normalizeFileType,
  normalizeJsonObject,
  normalizeLang,
  normalizeTemplateOverrides,
  normalizeTemplateSettings,
  parseOptionalInt,
  rowToNmtProvider,
  rowToRuleset,
  rowToRulesetVersion,
  rowToTemplate,
  rowToTranslationEngine,
  uniqueCopyName,
  uniqueStrings,
  type DbClient,
  type NmtProviderRow,
  type ProjectTemplateRow,
  type RulesetRow,
  type RulesetVersionRow,
  type TranslationEngineRow
} from "./resources.helpers.js";
import { registerFileTypeConfigRoutes } from "./resources.file-type-configs.routes.js";
export async function resourcesRoutes(app: FastifyInstance) {
  // --- PROJECT TEMPLATES ---
  app.get("/resources/project-templates/check-name", { preHandler: [requireAuth] }, async (req) => {
    const query = (req.query as any) || {};
    const name = String(query.name || "").trim();
    const excludeId = parseOptionalInt(query.excludeId ?? query.exclude_id ?? query.templateId ?? query.id);
    if (!name) return { available: true };
    const res = await db.query<{ id: number }>(
      `SELECT id FROM project_templates WHERE LOWER(name) = LOWER($1) ${excludeId ? "AND id <> $2" : ""} LIMIT 1`,
      excludeId ? [name, excludeId] : [name]
    );
    return { available: (res.rows?.length ?? 0) === 0 };
  });

  app.get("/resources/project-templates", { preHandler: [requireAuth] }, async () => {
    const res = await db.query<ProjectTemplateRow>(
      `SELECT t.*,
              te.name AS translation_engine_name,
              ft.name AS file_type_config_name
       FROM project_templates t
       LEFT JOIN translation_engines te ON te.id = t.translation_engine_id
       LEFT JOIN file_type_configs ft ON ft.id = t.file_type_config_id
       ORDER BY t.updated_at DESC, t.id DESC`
    );
    return { items: res.rows.map(rowToTemplate) };
  });

  app.get("/resources/project-templates/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid template id" });
    const res = await db.query<ProjectTemplateRow>(
      `SELECT t.*,
              te.name AS translation_engine_name,
              ft.name AS file_type_config_name
       FROM project_templates t
       LEFT JOIN translation_engines te ON te.id = t.translation_engine_id
       LEFT JOIN file_type_configs ft ON ft.id = t.file_type_config_id
       WHERE t.id = $1
       LIMIT 1`,
      [id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found" });
    return { item: rowToTemplate(row) };
  });

  app.post("/resources/project-templates", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const scope = String(body.scope || "").trim();
    const srcLang = normalizeLang(body?.languages?.src ?? body.srcLang);
    const targets = uniqueStrings(body?.languages?.targets ?? body.targetLangs);

    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!srcLang) return reply.code(400).send({ error: "source language is required" });
    if (targets.length === 0) return reply.code(400).send({ error: "at least one target language is required" });

    const translationEngineId = parseOptionalInt(body.translationEngineId);
    const fileTypeConfigId = parseOptionalInt(body.fileTypeConfigId);
    const disabled = normalizeBool(body.disabled, false);
    const defaultTmxId = parseOptionalInt(body.defaultTmxId ?? body.default_tmx_id ?? body.defaultTmId ?? body.default_tm_id);
    const defaultRulesetId = parseOptionalInt(
      body.defaultRulesetId ?? body.default_ruleset_id ?? body.defaultRuleSetId ?? body.default_rule_set_id
    );
    const defaultGlossaryId = parseOptionalInt(
      body.defaultGlossaryId ??
        body.default_glossary_id ??
        body.defaultTermbaseId ??
        body.default_termbase_id ??
        body.defaultTermBaseId ??
        body.default_term_base_id
    );
    const tmxOverridesRaw = body.tmxByTargetLang ?? body.tmx_by_target_lang ?? body.tmxByTarget ?? {};
    const rulesetOverridesRaw =
      body.rulesetByTargetLang ??
      body.ruleset_by_target_lang ??
      body.rulesByTargetLang ??
      body.ruleSetByTargetLang ??
      body.rulesByTarget ??
      {};
    const glossaryOverridesRaw =
      body.glossaryByTargetLang ??
      body.glossary_by_target_lang ??
      body.termBaseByTargetLang ??
      body.termbaseByTargetLang ??
      body.termBaseByTarget ??
      body.termbaseByTarget ??
      {};
    if (hasInvalidOverrideKeys(tmxOverridesRaw, targets)) {
      return reply.code(400).send({ error: "TMX overrides must target allowed languages." });
    }
    if (hasInvalidOverrideKeys(rulesetOverridesRaw, targets)) {
      return reply.code(400).send({ error: "Ruleset overrides must target allowed languages." });
    }
    if (hasInvalidOverrideKeys(glossaryOverridesRaw, targets)) {
      return reply.code(400).send({ error: "Termbase overrides must target allowed languages." });
    }
    const tmxByTargetLang = normalizeTemplateOverrides(tmxOverridesRaw, targets);
    const rulesetByTargetLang = normalizeTemplateOverrides(rulesetOverridesRaw, targets);
    const glossaryByTargetLang = normalizeTemplateOverrides(glossaryOverridesRaw, targets);
    const settings = normalizeTemplateSettings(body.settings);

    try {
      const insertRes = await db.query<ProjectTemplateRow>(
        `INSERT INTO project_templates(
           name,
           description,
           scope,
           disabled,
           src_lang,
           target_langs,
           translation_engine_id,
           file_type_config_id,
           default_tmx_id,
           default_ruleset_id,
           default_glossary_id,
           tmx_by_target_lang,
           ruleset_by_target_lang,
           glossary_by_target_lang,
           settings,
           created_by,
           updated_by,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $16, NOW(), NOW())
         RETURNING *`,
        [
          name,
          description || null,
          scope || null,
          disabled,
          srcLang,
          JSON.stringify(targets),
          translationEngineId,
          fileTypeConfigId,
          defaultTmxId,
          defaultRulesetId,
          defaultGlossaryId,
          JSON.stringify(tmxByTargetLang),
          JSON.stringify(rulesetByTargetLang),
          JSON.stringify(glossaryByTargetLang),
          JSON.stringify(settings),
          userId
        ]
      );
      const row = insertRes.rows[0];
      return { item: row ? rowToTemplate(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A project template with this name already exists." });
      }
      throw err;
    }
  });

  app.patch("/resources/project-templates/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid template id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<ProjectTemplateRow>("SELECT * FROM project_templates WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = (req.body as any) || {};
    const name = body.name != null ? String(body.name || "").trim() : String(existing.name || "");
    const description = body.description != null ? String(body.description || "").trim() : String(existing.description || "");
    const scope = body.scope != null ? String(body.scope || "").trim() : String(existing.scope || "");
    const srcLang = body?.languages?.src != null || body.srcLang != null
      ? normalizeLang(body?.languages?.src ?? body.srcLang)
      : String(existing.src_lang || "");
    const targets = body?.languages?.targets != null || body.targetLangs != null
      ? uniqueStrings(body?.languages?.targets ?? body.targetLangs)
      : Array.isArray(existing.target_langs) ? existing.target_langs : [];

    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!srcLang) return reply.code(400).send({ error: "source language is required" });
    if (targets.length === 0) return reply.code(400).send({ error: "at least one target language is required" });

    const translationEngineId =
      body.translationEngineId !== undefined ? parseOptionalInt(body.translationEngineId) : existing.translation_engine_id;
    const fileTypeConfigId =
      body.fileTypeConfigId !== undefined ? parseOptionalInt(body.fileTypeConfigId) : existing.file_type_config_id;
    const disabled = body.disabled !== undefined ? normalizeBool(body.disabled, Boolean(existing.disabled)) : Boolean(existing.disabled);
    const defaultTmxId =
      body.defaultTmxId !== undefined || body.default_tmx_id !== undefined || body.defaultTmId !== undefined || body.default_tm_id !== undefined
        ? parseOptionalInt(body.defaultTmxId ?? body.default_tmx_id ?? body.defaultTmId ?? body.default_tm_id)
        : existing.default_tmx_id ?? null;
    const defaultRulesetId =
      body.defaultRulesetId !== undefined || body.default_ruleset_id !== undefined || body.defaultRuleSetId !== undefined || body.default_rule_set_id !== undefined
        ? parseOptionalInt(body.defaultRulesetId ?? body.default_ruleset_id ?? body.defaultRuleSetId ?? body.default_rule_set_id)
        : existing.default_ruleset_id ?? null;
    const defaultGlossaryId =
      body.defaultGlossaryId !== undefined ||
      body.default_glossary_id !== undefined ||
      body.defaultTermbaseId !== undefined ||
      body.default_termbase_id !== undefined ||
      body.defaultTermBaseId !== undefined ||
      body.default_term_base_id !== undefined
        ? parseOptionalInt(
            body.defaultGlossaryId ??
              body.default_glossary_id ??
              body.defaultTermbaseId ??
              body.default_termbase_id ??
              body.defaultTermBaseId ??
              body.default_term_base_id
          )
        : existing.default_glossary_id ?? null;
    const tmxOverridesProvided =
      body.tmxByTargetLang !== undefined || body.tmx_by_target_lang !== undefined || body.tmxByTarget !== undefined;
    const rulesetOverridesProvided =
      body.rulesetByTargetLang !== undefined ||
      body.ruleset_by_target_lang !== undefined ||
      body.rulesByTargetLang !== undefined ||
      body.ruleSetByTargetLang !== undefined ||
      body.rulesByTarget !== undefined;
    const glossaryOverridesProvided =
      body.glossaryByTargetLang !== undefined ||
      body.glossary_by_target_lang !== undefined ||
      body.termBaseByTargetLang !== undefined ||
      body.termbaseByTargetLang !== undefined ||
      body.termBaseByTarget !== undefined ||
      body.termbaseByTarget !== undefined;
    const tmxOverridesRaw = tmxOverridesProvided
      ? body.tmxByTargetLang ?? body.tmx_by_target_lang ?? body.tmxByTarget ?? {}
      : existing.tmx_by_target_lang ?? {};
    const rulesetOverridesRaw = rulesetOverridesProvided
      ? body.rulesetByTargetLang ??
        body.ruleset_by_target_lang ??
        body.rulesByTargetLang ??
        body.ruleSetByTargetLang ??
        body.rulesByTarget ??
        {}
      : existing.ruleset_by_target_lang ?? {};
    const glossaryOverridesRaw = glossaryOverridesProvided
      ? body.glossaryByTargetLang ??
        body.glossary_by_target_lang ??
        body.termBaseByTargetLang ??
        body.termbaseByTargetLang ??
        body.termBaseByTarget ??
        body.termbaseByTarget ??
        {}
      : existing.glossary_by_target_lang ?? {};
    if (tmxOverridesProvided && hasInvalidOverrideKeys(tmxOverridesRaw, targets)) {
      return reply.code(400).send({ error: "TMX overrides must target allowed languages." });
    }
    if (rulesetOverridesProvided && hasInvalidOverrideKeys(rulesetOverridesRaw, targets)) {
      return reply.code(400).send({ error: "Ruleset overrides must target allowed languages." });
    }
    if (glossaryOverridesProvided && hasInvalidOverrideKeys(glossaryOverridesRaw, targets)) {
      return reply.code(400).send({ error: "Termbase overrides must target allowed languages." });
    }
    const tmxByTargetLang = normalizeTemplateOverrides(tmxOverridesRaw, targets);
    const rulesetByTargetLang = normalizeTemplateOverrides(rulesetOverridesRaw, targets);
    const glossaryByTargetLang = normalizeTemplateOverrides(glossaryOverridesRaw, targets);
    const settings =
      body.settings !== undefined ? normalizeTemplateSettings(body.settings) : (existing.settings || {});

    try {
      const updateRes = await db.query<ProjectTemplateRow>(
        `UPDATE project_templates
         SET name = $1,
             description = $2,
             scope = $3,
             disabled = $4,
             src_lang = $5,
             target_langs = $6::jsonb,
             translation_engine_id = $7,
             file_type_config_id = $8,
             default_tmx_id = $9,
             default_ruleset_id = $10,
             default_glossary_id = $11,
             tmx_by_target_lang = $12::jsonb,
             ruleset_by_target_lang = $13::jsonb,
             glossary_by_target_lang = $14::jsonb,
             settings = $15::jsonb,
             updated_by = $16,
             updated_at = NOW()
         WHERE id = $17
         RETURNING *`,
        [
          name,
          description || null,
          scope || null,
          disabled,
          srcLang,
          JSON.stringify(targets),
          translationEngineId,
          fileTypeConfigId,
          defaultTmxId,
          defaultRulesetId,
          defaultGlossaryId,
          JSON.stringify(tmxByTargetLang),
          JSON.stringify(rulesetByTargetLang),
          JSON.stringify(glossaryByTargetLang),
          JSON.stringify(settings),
          userId,
          id
        ]
      );
      const row = updateRes.rows[0];
      return { item: row ? rowToTemplate(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A project template with this name already exists." });
      }
      throw err;
    }
  });

  app.delete("/resources/project-templates/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid template id" });
    const res = await db.query("DELETE FROM project_templates WHERE id = $1 RETURNING id", [id]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/resources/project-templates/:id/copy", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid template id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<ProjectTemplateRow>("SELECT * FROM project_templates WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const copyName = await uniqueCopyName({ table: "project_templates", base: existing.name });
    const insertRes = await db.query<ProjectTemplateRow>(
      `INSERT INTO project_templates(
         name,
         description,
         scope,
         disabled,
         src_lang,
         target_langs,
         translation_engine_id,
         file_type_config_id,
         default_tmx_id,
         default_ruleset_id,
         default_glossary_id,
         tmx_by_target_lang,
         ruleset_by_target_lang,
         glossary_by_target_lang,
         settings,
         created_by,
         updated_by,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $16, NOW(), NOW())
       RETURNING *`,
      [
        copyName,
        existing.description ?? null,
        existing.scope ?? null,
        Boolean(existing.disabled),
        existing.src_lang,
        JSON.stringify(Array.isArray(existing.target_langs) ? existing.target_langs : []),
        existing.translation_engine_id ?? null,
        existing.file_type_config_id ?? null,
        existing.default_tmx_id ?? null,
        existing.default_ruleset_id ?? null,
        existing.default_glossary_id ?? null,
        JSON.stringify(existing.tmx_by_target_lang || {}),
        JSON.stringify(existing.ruleset_by_target_lang || {}),
        JSON.stringify(existing.glossary_by_target_lang || {}),
        JSON.stringify(existing.settings || {}),
        userId
      ]
    );
    const row = insertRes.rows[0];
    return { item: row ? rowToTemplate(row) : null };
  });

  // --- TRANSLATION ENGINES ---
  app.get("/resources/translation-engines", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<TranslationEngineRow>(
      `SELECT * FROM translation_engines ORDER BY updated_at DESC, id DESC`
    );
    return { items: res.rows.map(rowToTranslationEngine) };
  });

  app.post("/resources/translation-engines", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const config = normalizeJsonObject(body.config);
    const disabled = normalizeBool(body.disabled, false);
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const insertRes = await db.query<TranslationEngineRow>(
        `INSERT INTO translation_engines(name, description, config, disabled, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $5, NOW(), NOW())
         RETURNING *`,
        [name, description || null, JSON.stringify(config), disabled, userId]
      );
      const row = insertRes.rows[0];
      return { item: row ? rowToTranslationEngine(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A translation engine with this name already exists." });
      }
      throw err;
    }
  });

  app.patch("/resources/translation-engines/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid engine id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<TranslationEngineRow>("SELECT * FROM translation_engines WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = (req.body as any) || {};
    const name = body.name != null ? String(body.name || "").trim() : String(existing.name || "");
    const description = body.description != null ? String(body.description || "").trim() : String(existing.description || "");
    const config = body.config !== undefined ? normalizeJsonObject(body.config) : normalizeJsonObject(existing.config);
    const disabled = body.disabled !== undefined ? normalizeBool(body.disabled, Boolean(existing.disabled)) : Boolean(existing.disabled);
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const updateRes = await db.query<TranslationEngineRow>(
        `UPDATE translation_engines
         SET name = $1,
             description = $2,
             config = $3::jsonb,
             disabled = $4,
             updated_by = $5,
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [name, description || null, JSON.stringify(config), disabled, userId, id]
      );
      const row = updateRes.rows[0];
      return { item: row ? rowToTranslationEngine(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A translation engine with this name already exists." });
      }
      throw err;
    }
  });

  app.delete("/resources/translation-engines/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid engine id" });
    const res = await db.query("DELETE FROM translation_engines WHERE id = $1 RETURNING id", [id]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/resources/translation-engines/:id/copy", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid engine id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<TranslationEngineRow>("SELECT * FROM translation_engines WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const copyName = await uniqueCopyName({ table: "translation_engines", base: existing.name });
    const insertRes = await db.query<TranslationEngineRow>(
      `INSERT INTO translation_engines(name, description, config, disabled, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $5, NOW(), NOW())
       RETURNING *`,
      [copyName, existing.description ?? null, JSON.stringify(normalizeJsonObject(existing.config)), true, userId]
    );
    const row = insertRes.rows[0];
    return { item: row ? rowToTranslationEngine(row) : null };
  });
  registerFileTypeConfigRoutes(app);

  // --- LANGUAGE PROCESSING RULES ---
  app.get("/rules/check-name", { preHandler: [requireManagerOrAdmin] }, async (req) => {
    const query = (req.query as any) || {};
    const name = String(query.name || "").trim();
    const excludeId = parseOptionalInt(query.excludeId ?? query.exclude_id ?? null);
    if (!name) return { available: true };
    const params: Array<string | number> = [name];
    let where = "LOWER(name) = LOWER($1)";
    if (excludeId != null) {
      where += " AND id <> $2";
      params.push(excludeId);
    }
    const res = await db.query(`SELECT 1 FROM language_processing_rulesets WHERE ${where} LIMIT 1`, params);
    return { available: (res.rowCount ?? 0) === 0 };
  });

  app.get("/resources/language-processing-rules", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<RulesetRow>(
      `SELECT * FROM language_processing_rulesets ORDER BY updated_at DESC, id DESC`
    );
    return { items: res.rows.map(rowToRuleset) };
  });

  app.get("/resources/language-processing-rules/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid ruleset id" });
    const res = await db.query<RulesetRow>("SELECT * FROM language_processing_rulesets WHERE id = $1", [id]);
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found" });
    const historyRes = await db.query<RulesetVersionRow>(
      `SELECT * FROM language_processing_ruleset_versions WHERE ruleset_id = $1 ORDER BY version DESC`,
      [id]
    );
    return { item: rowToRuleset(row), history: historyRes.rows.map(rowToRulesetVersion) };
  });

  app.post("/resources/language-processing-rules", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const disabled = normalizeBool(body.disabled, false);
    const summaryRaw = body.summary ?? body.changeSummary ?? body.change_summary ?? null;
    const summary = summaryRaw != null ? String(summaryRaw || "").trim() : null;
    if (!name) return reply.code(400).send({ error: "name is required" });
    const validationError = validateLanguageProcessingRules(rules);
    if (validationError) return reply.code(400).send({ error: validationError });

    try {
      const row = await withTransaction(async (client) => {
        const insertRes = await client.query<RulesetRow>(
          `INSERT INTO language_processing_rulesets(name, description, rules, disabled, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, $5, NOW(), NOW())
           RETURNING *`,
          [name, description || null, JSON.stringify(rules), disabled, userId]
        );
        const inserted = insertRes.rows[0];
        if (inserted) {
          await insertRulesetVersion(client, inserted, userId, summary || null);
        }
        return inserted;
      });
      return { item: row ? rowToRuleset(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A ruleset with this name already exists." });
      }
      throw err;
    }
  });

  app.patch("/resources/language-processing-rules/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid ruleset id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<RulesetRow>("SELECT * FROM language_processing_rulesets WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = (req.body as any) || {};
    const name = body.name != null ? String(body.name || "").trim() : String(existing.name || "");
    const description = body.description != null ? String(body.description || "").trim() : String(existing.description || "");
    const rules =
      body.rules !== undefined ? (Array.isArray(body.rules) ? body.rules : []) : (Array.isArray(existing.rules) ? existing.rules : []);
    const disabled = body.disabled !== undefined ? normalizeBool(body.disabled, Boolean(existing.disabled)) : Boolean(existing.disabled);
    const summaryRaw = body.summary ?? body.changeSummary ?? body.change_summary ?? null;
    const summary = summaryRaw != null ? String(summaryRaw || "").trim() : null;
    if (!name) return reply.code(400).send({ error: "name is required" });
    const validationError = validateLanguageProcessingRules(rules);
    if (validationError) return reply.code(400).send({ error: validationError });

    try {
      const row = await withTransaction(async (client) => {
        const updateRes = await client.query<RulesetRow>(
          `UPDATE language_processing_rulesets
           SET name = $1,
               description = $2,
               rules = $3::jsonb,
               disabled = $4,
               updated_by = $5,
               updated_at = NOW()
           WHERE id = $6
           RETURNING *`,
          [name, description || null, JSON.stringify(rules), disabled, userId, id]
        );
        const updated = updateRes.rows[0];
        if (updated) {
          await insertRulesetVersion(client, updated, userId, summary || null);
        }
        return updated;
      });
      return { item: row ? rowToRuleset(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A ruleset with this name already exists." });
      }
      throw err;
    }
  });

  app.delete("/resources/language-processing-rules/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid ruleset id" });
    const res = await db.query("DELETE FROM language_processing_rulesets WHERE id = $1 RETURNING id", [id]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/resources/language-processing-rules/:id/copy", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid ruleset id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<RulesetRow>("SELECT * FROM language_processing_rulesets WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const copyName = await uniqueCopyName({ table: "language_processing_rulesets", base: existing.name });
    const summary = "Copied from existing ruleset";
    const row = await withTransaction(async (client) => {
      const insertRes = await client.query<RulesetRow>(
        `INSERT INTO language_processing_rulesets(name, description, rules, disabled, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $5, NOW(), NOW())
         RETURNING *`,
        [copyName, existing.description ?? null, JSON.stringify(Array.isArray(existing.rules) ? existing.rules : []), true, userId]
      );
      const inserted = insertRes.rows[0];
      if (inserted) {
        await insertRulesetVersion(client, inserted, userId, summary);
      }
      return inserted;
    });
    return { item: row ? rowToRuleset(row) : null };
  });

  app.post("/resources/language-processing-rules/test", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const input = String(body.input ?? "");
    const rules = Array.isArray(body.rules) ? body.rules : null;
    const rulesetId = parseOptionalInt(body.rulesetId);

    let effectiveRules = rules ?? [];
    if (!rules && rulesetId != null) {
      const res = await db.query<RulesetRow>("SELECT * FROM language_processing_rulesets WHERE id = $1", [rulesetId]);
      effectiveRules = Array.isArray(res.rows[0]?.rules) ? res.rows[0]!.rules : [];
    }

    try {
      const result = applyLanguageProcessingRules(input, effectiveRules, { scope: "target" });
      return { output: result.output, applied: result.applied };
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Failed to apply rules." });
    }
  });

  // --- NMT MODELS (providers + models config) ---
  app.get("/resources/nmt-models", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<NmtProviderRow>(
      `SELECT * FROM nmt_providers ORDER BY updated_at DESC, id DESC`
    );
    return { items: res.rows.map(rowToNmtProvider) };
  });

  app.post("/resources/nmt-models", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    const provider = String(body.provider || "").trim().toLowerCase();
    const enabled = normalizeBool(body.enabled, true);
    const config = normalizeJsonObject(body.config);
    const secret = body.secret && typeof body.secret === "object" ? body.secret : null;
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!provider) return reply.code(400).send({ error: "provider is required" });

    // NOTE: baseUrl is treated as a credential and must be encrypted at rest.
    const configBaseUrl = String((config as any).baseUrl ?? (config as any).base_url ?? "").trim();
    if (configBaseUrl) {
      delete (config as any).baseUrl;
      delete (config as any).base_url;
    }

    const secretPayload: Record<string, any> = secret ? { ...secret } : {};
    if (configBaseUrl) secretPayload.baseUrl = configBaseUrl;
    const apiKey = String(secretPayload.apiKey ?? secretPayload.api_key ?? "").trim();

    const secretEnc = Object.keys(secretPayload).length ? encryptJson(secretPayload) : null;
    const baseUrlMasked = configBaseUrl ? maskBaseUrl(configBaseUrl) : null;
    const apiKeyMasked = apiKey ? maskApiKey(apiKey) : null;
    try {
      const insertRes = await db.query<NmtProviderRow>(
        `INSERT INTO nmt_providers(name, provider, enabled, config, secret_enc, base_url_masked, api_key_masked, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $8, NOW(), NOW())
         RETURNING *`,
        [name, provider, enabled, JSON.stringify(config), secretEnc, baseUrlMasked, apiKeyMasked, userId]
      );
      const row = insertRes.rows[0];
      return { item: row ? rowToNmtProvider(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "An NMT provider with this name already exists." });
      }
      throw err;
    }
  });

  app.patch("/resources/nmt-models/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid NMT provider id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<NmtProviderRow>("SELECT * FROM nmt_providers WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = (req.body as any) || {};
    const name = body.name != null ? String(body.name || "").trim() : String(existing.name || "");
    const provider = body.provider != null ? String(body.provider || "").trim().toLowerCase() : String(existing.provider || "");
    const enabled = body.enabled !== undefined ? normalizeBool(body.enabled, Boolean(existing.enabled)) : Boolean(existing.enabled);
    const config = body.config !== undefined ? normalizeJsonObject(body.config) : normalizeJsonObject(existing.config);

    // NOTE: baseUrl is treated as a credential and must be encrypted at rest.
    const configBaseUrl = String((config as any).baseUrl ?? (config as any).base_url ?? "").trim();
    if (configBaseUrl) {
      delete (config as any).baseUrl;
      delete (config as any).base_url;
    }

    const secretUpdate = body.secret !== undefined ? body.secret : undefined;

    const existingSecret = existing.secret_enc ? decryptJson(existing.secret_enc) : null;

    let secretEnc: string | null = existing.secret_enc ?? null;
    let baseUrlMasked: string | null = (existing as any).base_url_masked ?? null;
    let apiKeyMasked: string | null = (existing as any).api_key_masked ?? null;

    if (secretUpdate === null) {
      secretEnc = null;
      baseUrlMasked = null;
      apiKeyMasked = null;
    } else {
      const nextSecret: Record<string, any> =
        secretUpdate === undefined
          ? existingSecret && typeof existingSecret === "object"
            ? { ...existingSecret }
            : {}
          : secretUpdate && typeof secretUpdate === "object"
            ? { ...secretUpdate }
            : {};

      if (configBaseUrl) nextSecret.baseUrl = configBaseUrl;

      if (secretUpdate !== undefined || configBaseUrl) {
        secretEnc = Object.keys(nextSecret).length ? encryptJson(nextSecret) : null;
      }

      const nextBaseUrl = String(nextSecret.baseUrl ?? nextSecret.base_url ?? "").trim();
      const nextApiKey = String(nextSecret.apiKey ?? nextSecret.api_key ?? "").trim();
      baseUrlMasked = nextBaseUrl ? maskBaseUrl(nextBaseUrl) : baseUrlMasked;
      apiKeyMasked = nextApiKey ? maskApiKey(nextApiKey) : apiKeyMasked;
    }

    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!provider) return reply.code(400).send({ error: "provider is required" });

    try {
      const updateRes = await db.query<NmtProviderRow>(
        `UPDATE nmt_providers
         SET name = $1,
             provider = $2,
             enabled = $3,
             config = $4::jsonb,
             secret_enc = $5,
             base_url_masked = $6,
             api_key_masked = $7,
             updated_by = $8,
             updated_at = NOW()
         WHERE id = $9
         RETURNING *`,
        [name, provider, enabled, JSON.stringify(config), secretEnc, baseUrlMasked, apiKeyMasked, userId, id]
      );
      const row = updateRes.rows[0];
      return { item: row ? rowToNmtProvider(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "An NMT provider with this name already exists." });
      }
      throw err;
    }
  });

  app.delete("/resources/nmt-models/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid NMT provider id" });
    const res = await db.query("DELETE FROM nmt_providers WHERE id = $1 RETURNING id", [id]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/resources/nmt-models/:id/copy", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid NMT provider id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<NmtProviderRow>("SELECT * FROM nmt_providers WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const copyName = await uniqueCopyName({ table: "nmt_providers", base: existing.name });
    const copiedConfig = normalizeJsonObject(existing.config);
    delete (copiedConfig as any).baseUrl;
    delete (copiedConfig as any).base_url;
    const insertRes = await db.query<NmtProviderRow>(
      `INSERT INTO nmt_providers(name, provider, enabled, config, secret_enc, base_url_masked, api_key_masked, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NULL, NULL, $6, $6, NOW(), NOW())
       RETURNING *`,
      [copyName, existing.provider, false, JSON.stringify(copiedConfig), null, userId]
    );
    const row = insertRes.rows[0];
    return { item: row ? rowToNmtProvider(row) : null };
  });
}


