import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { requireAuth, requireManagerOrAdmin, getRequestUser, requestUserId } from "../middleware/auth.js";
import { normalizeParsingTemplateConfig, normalizeXmlParsingTemplateConfig } from "../lib/parsing-templates.js";
import { segmentHtmlWithTemplate } from "../lib/html-segmentation.js";
import { buildHtmlPreviewResult } from "../lib/file-type-preview.js";
import { previewXmlWithTemplate } from "../lib/xml-extraction.js";
import { deleteObject } from "../lib/s3.js";
import { segmentPlainText } from "../utils.js";
import officeParser from "officeparser";
import {
  fileTypeConfigTemplateWhere,
  getAttachedParsingTemplateIds,
  getFileTypeConfigParsingTemplateId,
  getPreviewParsingTemplateId,
  normalizeBool,
  normalizeFileTypeConfigForWrite,
  normalizeJsonObject,
  rowToFileTypeConfig,
  uniqueCopyName,
  type FileTypeConfigRow
} from "./resources.helpers.js";

export function registerFileTypeConfigRoutes(app: FastifyInstance) {
  app.get("/file-type-configs", { preHandler: [requireAuth] }, async () => {
    const res = await db.query<FileTypeConfigRow>(
      `SELECT * FROM file_type_configs WHERE disabled = FALSE ORDER BY updated_at DESC, id DESC`
    );
    return { items: res.rows.map(rowToFileTypeConfig) };
  });

  app.get("/resources/file-types", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<FileTypeConfigRow>(
      `SELECT * FROM file_type_configs ORDER BY updated_at DESC, id DESC`
    );
    return { items: res.rows.map(rowToFileTypeConfig) };
  });

  app.get("/resources/file-types/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid config id" });
    const res = await db.query<FileTypeConfigRow>("SELECT * FROM file_type_configs WHERE id = $1", [id]);
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found" });
    return { item: rowToFileTypeConfig(row) };
  });

  app.post("/resources/file-types", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const normalizedConfig = normalizeFileTypeConfigForWrite(body.config);
    if ("error" in normalizedConfig) return reply.code(400).send({ error: normalizedConfig.error });
    const config = normalizedConfig.config;
    const fileType = normalizedConfig.fileType;
    const disabled = normalizeBool(body.disabled, false);
    if (!name) return reply.code(400).send({ error: "name is required" });

    if (fileType === "html" || fileType === "xml") {
      const parsingTemplateId = getFileTypeConfigParsingTemplateId(config, fileType);
      if (!parsingTemplateId) {
        return reply.code(400).send({ error: "An extraction template is required for HTML/XML file types." });
      }
      const tplRes = await db.query<{ id: number; kind: string }>(
        "SELECT id, kind FROM parsing_templates WHERE id = $1",
        [parsingTemplateId]
      );
      const tplRow = tplRes.rows[0];
      if (!tplRow) {
        return reply.code(400).send({ error: "Invalid extraction template." });
      }
      const expectedKind = fileType === "xml" ? "xml" : "html";
      if (String(tplRow.kind || "html").toLowerCase() !== expectedKind) {
        return reply.code(400).send({ error: "Extraction template kind does not match file type." });
      }

      const templateIdText = String(parsingTemplateId);
      const usedByRes = await db.query<{ id: number; name: string }>(
        `SELECT id, name FROM file_type_configs WHERE ${fileTypeConfigTemplateWhere(1)} LIMIT 1`,
        [templateIdText]
      );
      const usedBy = usedByRes.rows[0];
      if (usedBy) {
        return reply.code(409).send({
          error: "Extraction template is already attached to another File Type Configuration.",
          code: "TEMPLATE_ALREADY_ATTACHED",
          inUseBy: { id: Number(usedBy.id), name: String(usedBy.name || "") }
        });
      }
    }

    try {
      const insertRes = await db.query<FileTypeConfigRow>(
        `INSERT INTO file_type_configs(name, description, config, disabled, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $5, NOW(), NOW())
         RETURNING *`,
        [name, description || null, JSON.stringify(config), disabled, userId]
      );
      const row = insertRes.rows[0];
      return { item: row ? rowToFileTypeConfig(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A file type configuration with this name already exists." });
      }
      throw err;
    }
  });

  app.patch("/resources/file-types/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid config id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<FileTypeConfigRow>("SELECT * FROM file_type_configs WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = (req.body as any) || {};
    const name = body.name != null ? String(body.name || "").trim() : String(existing.name || "");
    const description = body.description != null ? String(body.description || "").trim() : String(existing.description || "");
    let config = normalizeJsonObject(existing.config);
    let fileTypeForValidation: string | null = null;
    if (body.config !== undefined) {
      const normalizedConfig = normalizeFileTypeConfigForWrite(body.config);
      if ("error" in normalizedConfig) return reply.code(400).send({ error: normalizedConfig.error });
      config = normalizedConfig.config;
      fileTypeForValidation = normalizedConfig.fileType;
    }
    const disabled = body.disabled !== undefined ? normalizeBool(body.disabled, Boolean(existing.disabled)) : Boolean(existing.disabled);
    if (!name) return reply.code(400).send({ error: "name is required" });

    if (body.config !== undefined && fileTypeForValidation && (fileTypeForValidation === "html" || fileTypeForValidation === "xml")) {
      const parsingTemplateId = getFileTypeConfigParsingTemplateId(config, fileTypeForValidation);
      if (!parsingTemplateId) {
        return reply.code(400).send({ error: "An extraction template is required for HTML/XML file types." });
      }
      const tplRes = await db.query<{ id: number; kind: string }>(
        "SELECT id, kind FROM parsing_templates WHERE id = $1",
        [parsingTemplateId]
      );
      const tplRow = tplRes.rows[0];
      if (!tplRow) {
        return reply.code(400).send({ error: "Invalid extraction template." });
      }
      const expectedKind = fileTypeForValidation === "xml" ? "xml" : "html";
      if (String(tplRow.kind || "html").toLowerCase() !== expectedKind) {
        return reply.code(400).send({ error: "Extraction template kind does not match file type." });
      }

      const templateIdText = String(parsingTemplateId);
      const usedByRes = await db.query<{ id: number; name: string }>(
        `SELECT id, name FROM file_type_configs WHERE id <> $2 AND (${fileTypeConfigTemplateWhere(1)}) LIMIT 1`,
        [templateIdText, id]
      );
      const usedBy = usedByRes.rows[0];
      if (usedBy) {
        return reply.code(409).send({
          error: "Extraction template is already attached to another File Type Configuration.",
          code: "TEMPLATE_ALREADY_ATTACHED",
          inUseBy: { id: Number(usedBy.id), name: String(usedBy.name || "") }
        });
      }
    }

    try {
      const updateRes = await db.query<FileTypeConfigRow>(
        `UPDATE file_type_configs
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
      return { item: row ? rowToFileTypeConfig(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A file type configuration with this name already exists." });
      }
      throw err;
    }
  });

  app.delete("/resources/file-types/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid config id" });

    const deleted = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [id]);

      const cfgRes = await client.query<{ id: number; config: any }>(
        "SELECT id, config FROM file_type_configs WHERE id = $1",
        [id]
      );
      const cfgRow = cfgRes.rows[0];
      if (!cfgRow) return { ok: false as const, notFound: true as const };

      const templateIds = getAttachedParsingTemplateIds(cfgRow.config);

      const res = await client.query("DELETE FROM file_type_configs WHERE id = $1 RETURNING id", [id]);
      if ((res.rowCount ?? 0) === 0) return { ok: false as const, notFound: true as const };

      const objectKeys = new Set<string>();
      const deletedTemplateIds: number[] = [];

      for (const templateId of templateIds) {
        const templateIdText = String(templateId);

        const stillUsedRes = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM file_type_configs WHERE ${fileTypeConfigTemplateWhere(1)}`,
          [templateIdText]
        );
        const stillUsed = Number(stillUsedRes.rows[0]?.count ?? 0) || 0;
        if (stillUsed > 0) continue;

        // Detach historical project-file references so templates can be deleted safely.
        await client.query("UPDATE project_file_html_templates SET parsing_template_id = NULL WHERE parsing_template_id = $1", [
          templateId
        ]);

        const existsRes = await client.query<{ source_json_path: string | null }>(
          "SELECT source_json_path FROM parsing_templates WHERE id = $1",
          [templateId]
        );
        const existing = existsRes.rows[0];
        if (!existing) continue;

        const artifactsRes = await client.query<{ artifact_id: number; object_key: string }>(
          `
            SELECT v.artifact_id, a.object_key
            FROM template_versions v
            JOIN file_artifacts a ON a.id = v.artifact_id
            WHERE v.template_id = $1
          `,
          [templateId]
        );

        const artifactIds = artifactsRes.rows
          .map((r) => Number(r.artifact_id))
          .filter((n) => Number.isFinite(n) && n > 0);

        artifactsRes.rows
          .map((r) => String(r.object_key || "").trim())
          .filter(Boolean)
          .forEach((k) => objectKeys.add(k));

        const sourceKey = String(existing.source_json_path || "").trim();
        if (sourceKey) objectKeys.add(sourceKey);

        await client.query("DELETE FROM template_versions WHERE template_id = $1", [templateId]);
        await client.query("DELETE FROM parsing_templates WHERE id = $1", [templateId]);

        if (artifactIds.length > 0) {
          await client.query("DELETE FROM file_artifacts WHERE id = ANY($1::int[])", [artifactIds]);
        }

        deletedTemplateIds.push(templateId);
      }

      return { ok: true as const, deletedTemplateIds, objectKeys: Array.from(objectKeys) };
    });

    if (!deleted.ok) {
      if ("notFound" in deleted) return reply.code(404).send({ error: "Not found" });
      return reply.code(500).send({ error: "Failed to delete file type configuration" });
    }

    const storageDeleteFailures: string[] = [];
    for (const key of deleted.objectKeys) {
      try {
        await deleteObject({ key });
      } catch {
        storageDeleteFailures.push(key);
      }
    }

    return storageDeleteFailures.length > 0
      ? { ok: true, storageDeleted: false, failedKeys: storageDeleteFailures, deletedTemplateIds: deleted.deletedTemplateIds }
      : { ok: true, storageDeleted: true, deletedTemplateIds: deleted.deletedTemplateIds };
  });

  app.post("/resources/file-types/:id/copy", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid config id" });
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<FileTypeConfigRow>("SELECT * FROM file_type_configs WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const normalizedConfig = normalizeFileTypeConfigForWrite(existing.config);
    if ("error" in normalizedConfig) return reply.code(400).send({ error: normalizedConfig.error });

    if (normalizedConfig.fileType === "html" || normalizedConfig.fileType === "xml") {
      const parsingTemplateId = getFileTypeConfigParsingTemplateId(normalizedConfig.config, normalizedConfig.fileType);
      if (!parsingTemplateId) {
        return reply.code(400).send({ error: "An extraction template is required for HTML/XML file types." });
      }
      const tplRes = await db.query<{ id: number; kind: string }>(
        "SELECT id, kind FROM parsing_templates WHERE id = $1",
        [parsingTemplateId]
      );
      const tplRow = tplRes.rows[0];
      if (!tplRow) {
        return reply.code(400).send({ error: "Invalid extraction template." });
      }
      const expectedKind = normalizedConfig.fileType === "xml" ? "xml" : "html";
      if (String(tplRow.kind || "html").toLowerCase() !== expectedKind) {
        return reply.code(400).send({ error: "Extraction template kind does not match file type." });
      }

      return reply.code(409).send({
        error:
          "Copying this File Type Configuration would attach its extraction template to multiple configurations. Create a new extraction template first.",
        code: "TEMPLATE_ALREADY_ATTACHED"
      });
    }

    const copyName = await uniqueCopyName({ table: "file_type_configs", base: existing.name });
    const insertRes = await db.query<FileTypeConfigRow>(
      `INSERT INTO file_type_configs(name, description, config, disabled, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $5, NOW(), NOW())
       RETURNING *`,
      [copyName, existing.description ?? null, JSON.stringify(normalizeJsonObject(normalizedConfig.config)), true, userId]
    );
    const row = insertRes.rows[0];
    return { item: row ? rowToFileTypeConfig(row) : null };
  });

  app.post("/resources/file-types/preview", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });

    const fields = (file as any).fields || {};
    const rawCfg = fields.config && typeof fields.config === "object" && "value" in fields.config
      ? (fields.config as any).value
      : fields.config;
    if (!rawCfg) return reply.code(400).send({ error: "config is required" });

    let cfg: any = null;
    try {
      cfg = JSON.parse(String(rawCfg));
    } catch {
      return reply.code(400).send({ error: "Invalid config JSON" });
    }

    const normalizedConfig = normalizeFileTypeConfigForWrite(cfg);
    if ("error" in normalizedConfig) return reply.code(400).send({ error: normalizedConfig.error });

    const buf = await file.toBuffer();
    const filename = String(file.filename || "");
    const ext = filename.toLowerCase().split(".").pop() || "";
    const cfgNorm = normalizeJsonObject(normalizedConfig.config);

    try {
      if (normalizedConfig.fileType === "html") {
        if (!(ext === "html" || ext === "htm" || ext === "xhtml" || ext === "xtml")) {
          return reply.code(400).send({ error: "Sample file extension does not match HTML file type." });
        }

        const parsingTemplateId = getPreviewParsingTemplateId(cfgNorm);
        if (!parsingTemplateId) {
          return reply.code(400).send({ error: "An extraction template is required for HTML preview." });
        }
        const tplRes = await db.query<{ config: any }>("SELECT config FROM parsing_templates WHERE id = $1", [parsingTemplateId]);
        const tplRow = tplRes.rows[0];
        if (!tplRow) return reply.code(400).send({ error: "Invalid extraction template." });
        const tplCfg = normalizeParsingTemplateConfig(tplRow.config);

        const htmlCfg = normalizeJsonObject(cfgNorm.html);
        const segmenter = String(htmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
        const preserveWhitespace = Boolean(htmlCfg.preserveWhitespace);
        const normalizeSpaces = htmlCfg.normalizeSpaces !== undefined ? Boolean(htmlCfg.normalizeSpaces) : true;
        const inlineTagPlaceholders =
          htmlCfg.inlineTagPlaceholders !== undefined ? Boolean(htmlCfg.inlineTagPlaceholders) : true;

        const xmlMode = ext === "xhtml" || ext === "xtml";
        const parsed = segmentHtmlWithTemplate(buf, tplCfg, { xmlMode });
        return buildHtmlPreviewResult({
          parsed,
          templateConfig: tplCfg,
          segmenter,
          preserveWhitespace,
          normalizeSpaces,
          inlineTagPlaceholders,
          xmlMode
        });
      }

      if (normalizedConfig.fileType === "xml") {
        if (ext !== "xml") {
          return reply.code(400).send({ error: "Sample file extension does not match XML file type." });
        }

        const parsingTemplateId = getPreviewParsingTemplateId(cfgNorm);
        if (!parsingTemplateId) {
          return reply.code(400).send({ error: "An extraction template is required for XML preview." });
        }
        const tplRes = await db.query<{ config: any; kind: string }>(
          "SELECT config, kind FROM parsing_templates WHERE id = $1",
          [parsingTemplateId]
        );
        const tplRow = tplRes.rows[0];
        if (!tplRow) return reply.code(400).send({ error: "Invalid extraction template." });
        if (String(tplRow.kind || "html").toLowerCase() !== "xml") {
          return reply.code(400).send({ error: "Selected template is not an XML template." });
        }
        const tplCfg = normalizeXmlParsingTemplateConfig(tplRow.config);

        const xmlCfg = normalizeJsonObject(cfgNorm.xml);
        const segmenter = String(xmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
        const preserveWhitespace = xmlCfg.preserveWhitespace !== undefined ? Boolean(xmlCfg.preserveWhitespace) : true;

        return previewXmlWithTemplate({
          fileBuffer: buf,
          template: tplCfg,
          segmenter,
          preserveWhitespace
        });
      }

      const text = await officeParser.parseOfficeAsync(buf, { newlineDelimiter: "\n" });
      const segs = segmentPlainText(String(text || ""));
      const segments = segs.slice(0, 500).map((s, idx) => ({ id: idx + 1, sourceText: s, taggedText: s }));
      return { kind: "text", segments, total: segs.length, debug: { errors: [], warnings: [] } };
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Failed to parse file for preview." });
    }
  });

  app.post("/resources/file-types/:id/preview", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid config id" });

    const existingRes = await db.query<FileTypeConfigRow>("SELECT * FROM file_type_configs WHERE id = $1", [id]);
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });
    const buf = await file.toBuffer();

    const filename = String(file.filename || "");
    const ext = filename.toLowerCase().split(".").pop() || "";
    const cfg = normalizeJsonObject(existing.config);

    try {
      const normalizedExisting = normalizeFileTypeConfigForWrite(cfg);
      if ("error" in normalizedExisting) return reply.code(400).send({ error: normalizedExisting.error });

      const cfgNorm = normalizeJsonObject(normalizedExisting.config);

      if (normalizedExisting.fileType === "html") {
        if (!(ext === "html" || ext === "htm" || ext === "xhtml" || ext === "xtml")) {
          return reply.code(400).send({ error: "Sample file extension does not match HTML file type." });
        }

        const parsingTemplateId = getPreviewParsingTemplateId(cfgNorm);
        if (!parsingTemplateId) {
          return reply.code(400).send({ error: "An extraction template is required for HTML preview." });
        }
        const tplRes = await db.query<{ config: any }>("SELECT config FROM parsing_templates WHERE id = $1", [parsingTemplateId]);
        const tplRow = tplRes.rows[0];
        if (!tplRow) return reply.code(400).send({ error: "Invalid extraction template." });
        const tplCfg = normalizeParsingTemplateConfig(tplRow.config);

        const htmlCfg = normalizeJsonObject(cfgNorm.html);
        const segmenter = String(htmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
        const preserveWhitespace = Boolean(htmlCfg.preserveWhitespace);
        const normalizeSpaces = htmlCfg.normalizeSpaces !== undefined ? Boolean(htmlCfg.normalizeSpaces) : true;
        const inlineTagPlaceholders =
          htmlCfg.inlineTagPlaceholders !== undefined ? Boolean(htmlCfg.inlineTagPlaceholders) : true;

        const xmlMode = ext === "xhtml" || ext === "xtml";
        const parsed = segmentHtmlWithTemplate(buf, tplCfg, { xmlMode });
        return buildHtmlPreviewResult({
          parsed,
          templateConfig: tplCfg,
          segmenter,
          preserveWhitespace,
          normalizeSpaces,
          inlineTagPlaceholders,
          xmlMode
        });
      }

      if (normalizedExisting.fileType === "xml") {
        if (ext !== "xml") {
          return reply.code(400).send({ error: "Sample file extension does not match XML file type." });
        }

        const parsingTemplateId = getPreviewParsingTemplateId(cfgNorm);
        if (!parsingTemplateId) {
          return reply.code(400).send({ error: "An extraction template is required for XML preview." });
        }
        const tplRes = await db.query<{ config: any; kind: string }>(
          "SELECT config, kind FROM parsing_templates WHERE id = $1",
          [parsingTemplateId]
        );
        const tplRow = tplRes.rows[0];
        if (!tplRow) return reply.code(400).send({ error: "Invalid extraction template." });
        if (String(tplRow.kind || "html").toLowerCase() !== "xml") {
          return reply.code(400).send({ error: "Selected template is not an XML template." });
        }
        const tplCfg = normalizeXmlParsingTemplateConfig(tplRow.config);

        const xmlCfg = normalizeJsonObject(cfgNorm.xml);
        const segmenter = String(xmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
        const preserveWhitespace = xmlCfg.preserveWhitespace !== undefined ? Boolean(xmlCfg.preserveWhitespace) : true;

        return previewXmlWithTemplate({
          fileBuffer: buf,
          template: tplCfg,
          segmenter,
          preserveWhitespace
        });
      }

      const text = await officeParser.parseOfficeAsync(buf, { newlineDelimiter: "\n" });
      const segs = segmentPlainText(String(text || ""));
      const segments = segs.slice(0, 500).map((s, idx) => ({ id: idx + 1, sourceText: s, taggedText: s }));
      return { kind: "text", segments, total: segs.length, debug: { errors: [], warnings: [] } };
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Failed to parse file for preview." });
    }
  });
}

