import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import {
  getRequestUser,
  isAdminUser,
  requireAuth,
  requireManagerOrAdmin,
  requestUserId
} from "../middleware/auth.js";
import {
  normalizeParsingTemplateConfig,
  normalizeXmlParsingTemplateConfig,
  type ParsingTemplateKind,
  type ParsingTemplateConfig,
  type XmlParsingTemplateConfig
} from "../lib/parsing-templates.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import {
  deleteObject,
  getObjectBuffer,
  getS3Bucket,
  presignGetObject,
  putObjectBuffer,
  sha256Hex
} from "../lib/s3.js";
import {
  keyFileIngestionTemplateJson,
  keyFileIngestionTemplateUploadJson
} from "../lib/storage-keys.js";
import { insertAuditEvent } from "../lib/audit.js";
import {
  actorUserIdInt,
  normalizeTemplateKind,
  readUploadConfig,
  resolveUploadRow,
  rowToTemplate,
  safeBasename,
  suggestTemplateDescriptionFromUpload,
  suggestTemplateNameFromUpload,
  type ParsingTemplateJsonUploadRow,
  type ParsingTemplateRow,
  writeTemplateVersion
} from "./parsing-templates.helpers.js";

export async function parsingTemplatesRoutes(app: FastifyInstance) {
  // --- Upload template JSON (temporary) ---
  app.post("/parsing-templates/uploads", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const kind = normalizeTemplateKind((req.query as any)?.kind);
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No JSON file uploaded" });

    const originalName = String(file.filename || "").trim() || "template.json";
    if (!originalName.toLowerCase().endsWith(".json")) {
      return reply.code(400).send({ error: "Only .json files are supported" });
    }

    const buf: Buffer = await file.toBuffer();
    if (!buf || buf.length === 0) {
      return reply.code(400).send({ error: "Uploaded JSON is empty" });
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      return reply.code(400).send({ error: "Template JSON is invalid." });
    }

    const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as any) : null;
    const rawConfig = obj?.config ?? parsed;

    let config: ParsingTemplateConfig | XmlParsingTemplateConfig;
    try {
      config = kind === "xml" ? normalizeXmlParsingTemplateConfig(rawConfig) : normalizeParsingTemplateConfig(rawConfig);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Invalid template config" });
    }

    if (kind === "xml") {
      if ((config as any).block_xpath?.length === 0) {
        return reply.code(400).send({ error: "Block XPath rules must not be empty." });
      }
    } else {
      if ((config as any).block_tags?.length === 0) {
        return reply.code(400).send({ error: "Block rules must not be empty." });
      }
    }

    const user = getRequestUser(req);
    const actor = requestUserId(user) || "system";

    const created = await withTransaction(async (client) => {
      const insertRes = await client.query<{ id: number }>(
        `
          INSERT INTO parsing_template_json_uploads(kind, original_name, stored_path, size_bytes, created_by, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          RETURNING id
        `,
        [kind, originalName, "pending", buf.length, actor]
      );
      const uploadId = Number(insertRes.rows[0]?.id);
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error("Failed to create upload record");

      const objectKey = keyFileIngestionTemplateUploadJson({
        kind,
        uploadId
      });

      const put = await putObjectBuffer({ key: objectKey, buf, contentType: "application/json" });
      const sha256 = await sha256Hex(buf);
      const artifact = await insertFileArtifact(client, {
        kind: "template_json" satisfies FileArtifactKind,
        bucket: getS3Bucket(),
        objectKey,
        sha256,
        etag: put.etag,
        sizeBytes: buf.length,
        contentType: "application/json",
        meta: { uploadId, kind, originalFilename: safeBasename(originalName), purpose: "parsing_template_upload" },
        createdBy: actor
      });

      await client.query(
        `UPDATE parsing_template_json_uploads
         SET stored_path = $1, artifact_id = $2
         WHERE id = $3`,
        [objectKey, artifact.id, uploadId]
      );

      await insertAuditEvent(client, {
        actorUserId: actorUserIdInt(user),
        actorLabel: actor,
        action: "template_upload.create",
        objectType: "parsing_template_upload",
        objectId: String(uploadId),
        details: { kind, originalName, sizeBytes: buf.length, bucket: getS3Bucket(), objectKey }
      });

      return { uploadId, objectKey, artifactId: artifact.id };
    });

    return reply.code(201).send({
      upload: { id: created.uploadId, kind, originalName, sizeBytes: buf.length },
      template: {
        kind,
        name: suggestTemplateNameFromUpload({ originalFilename: originalName, parsed }),
        description: suggestTemplateDescriptionFromUpload(parsed),
        config
      }
    });
  });

  // --- Delete temporary upload ---
  app.delete("/parsing-templates/uploads/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const uploadId = Number(req.params.id);
    if (!Number.isFinite(uploadId) || uploadId <= 0) return reply.code(400).send({ error: "Invalid upload id" });
    const user = getRequestUser(req);
    const actor = requestUserId(user);
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });

    const existing = await resolveUploadRow({ uploadId, actor, actorIsAdmin: isAdminUser(user) });
    if ("error" in existing) {
      return existing.error === "Forbidden"
        ? reply.code(403).send({ error: "Forbidden" })
        : reply.code(404).send({ error: "Upload not found" });
    }

    const storedKey = String(existing.row.stored_path || "").trim();
    const artifactId = existing.row.artifact_id != null ? Number(existing.row.artifact_id) : null;

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM parsing_template_json_uploads WHERE id = $1`, [uploadId]);
      await insertAuditEvent(client, {
        actorUserId: actorUserIdInt(user),
        actorLabel: actor,
        action: "template_upload.delete",
        objectType: "parsing_template_upload",
        objectId: String(uploadId),
        details: { storedKey: storedKey || null, artifactId }
      });
      if (artifactId != null && Number.isFinite(artifactId)) {
        await client.query(`DELETE FROM file_artifacts WHERE id = $1`, [artifactId]);
      }
    });

    if (storedKey) {
      try {
        await deleteObject({ key: storedKey });
      } catch {
        /* ignore */
      }
    }

    return { ok: true };
  });

  // --- List templates ---
  app.get("/parsing-templates", { preHandler: [requireAuth] }, async (req: any) => {
    const kind = (req.query as any)?.kind ? normalizeTemplateKind((req.query as any).kind) : null;
    const res = await db.query<ParsingTemplateRow>(
      `
        SELECT
          t.id,
          t.name,
          t.description,
          t.kind,
          t.config,
          t.source_json_path,
          t.source_json_original_name,
          t.source_json_size_bytes,
          t.source_json_uploaded_at,
          t.source_artifact_id,
          t.created_by,
          t.created_at,
          t.updated_at,
          COALESCE(v.max_version, 1)::int AS version
        FROM parsing_templates t
        LEFT JOIN (
          SELECT template_id, MAX(version)::int AS max_version
          FROM template_versions
          GROUP BY template_id
        ) v ON v.template_id = t.id
        ${
          kind
            ? kind === "xml"
              ? "WHERE LOWER(t.kind) = 'xml'"
              : "WHERE LOWER(t.kind) IN ('html', 'xhtml')"
            : ""
        }
        ORDER BY t.updated_at DESC, t.id DESC
      `,
      []
    );
    return { templates: res.rows.map(rowToTemplate) };
  });

  // --- Get template ---
  app.get("/parsing-templates/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: "Invalid template id" });
    }
    const res = await db.query<ParsingTemplateRow>(
      `
        SELECT
          t.id,
          t.name,
          t.description,
          t.kind,
          t.config,
          t.source_json_path,
          t.source_json_original_name,
          t.source_json_size_bytes,
          t.source_json_uploaded_at,
          t.source_artifact_id,
          t.created_by,
          t.created_at,
          t.updated_at,
          COALESCE(v.max_version, 1)::int AS version
        FROM parsing_templates t
        LEFT JOIN (
          SELECT template_id, MAX(version)::int AS max_version
          FROM template_versions
          GROUP BY template_id
        ) v ON v.template_id = t.id
        WHERE t.id = $1
      `,
      [id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Template not found" });
    return { template: rowToTemplate(row) };
  });

  // --- Download template JSON (latest version) ---
  app.get("/parsing-templates/:id/download", { preHandler: [requireAuth] }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: "Invalid template id" });
    }

    const res = await db.query<ParsingTemplateRow>(
      `
        SELECT
          t.id,
          t.name,
          t.description,
          t.kind,
          t.config,
          t.source_json_path,
          t.source_json_original_name,
          t.source_json_size_bytes,
          t.source_json_uploaded_at,
          t.source_artifact_id,
          t.created_by,
          t.created_at,
          t.updated_at,
          COALESCE(v.max_version, 1)::int AS version
        FROM parsing_templates t
        LEFT JOIN (
          SELECT template_id, MAX(version)::int AS max_version
          FROM template_versions
          GROUP BY template_id
        ) v ON v.template_id = t.id
        WHERE t.id = $1
      `,
      [id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Template not found" });

    const downloadName = safeBasename(row.source_json_original_name || `${row.name}.json`);
    const objectKey = String(row.source_json_path || "").trim();
    if (!objectKey) {
      return reply.code(404).send({ error: "Template JSON not found in storage." });
    }

    const signed = await presignGetObject({
      key: objectKey,
      downloadFilename: downloadName,
      contentType: "application/json"
    });
    return reply.redirect(signed.url);
  });

  // --- Create template (creates v1) ---
  app.post("/parsing-templates", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const rawKind = String(body.kind ?? "").trim().toLowerCase();
    const kind = normalizeTemplateKind(rawKind);
    if (rawKind && rawKind !== kind) {
      return reply.code(400).send({ error: "Invalid template kind" });
    }
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const sourceUploadIdRaw = body.sourceUploadId ?? body.source_upload_id;
    const sourceUploadId =
      sourceUploadIdRaw != null && String(sourceUploadIdRaw).trim()
        ? Number(sourceUploadIdRaw)
        : null;
    if (!name) return reply.code(400).send({ error: "name is required" });

    const user = getRequestUser(req);
    const actor = requestUserId(user);
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });

    let config: ParsingTemplateConfig | XmlParsingTemplateConfig;
    try {
      config =
        kind === "xml"
          ? normalizeXmlParsingTemplateConfig(body.config)
          : normalizeParsingTemplateConfig(body.config);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Invalid config" });
    }
    if (kind === "xml") {
      if ((config as any).block_xpath?.length === 0) {
        return reply.code(400).send({ error: "config.block_xpath must not be empty" });
      }
    } else {
      if ((config as any).block_tags?.length === 0) {
        return reply.code(400).send({ error: "config.block_tags must not be empty" });
      }
    }

    let uploadRow: ParsingTemplateJsonUploadRow | null = null;
    if (sourceUploadId != null && Number.isFinite(sourceUploadId) && sourceUploadId > 0) {
      const resolved = await resolveUploadRow({
        uploadId: sourceUploadId,
        actor,
        actorIsAdmin: isAdminUser(user)
      });
      if ("error" in resolved) {
        return resolved.error === "Forbidden"
          ? reply.code(403).send({ error: "Forbidden" })
          : reply.code(404).send({ error: "Upload not found" });
      }
      if (normalizeTemplateKind(resolved.row.kind) !== kind) {
        return reply.code(400).send({ error: "Upload kind does not match template kind." });
      }
      uploadRow = resolved.row;
    }

    try {
      const created = await withTransaction(async (client) => {
        const insertRes = await client.query<{ id: number }>(
          `
            INSERT INTO parsing_templates(name, description, kind, config, source_json_path, source_json_original_name, source_json_size_bytes, source_json_uploaded_at, source_artifact_id, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4::jsonb, NULL, NULL, NULL, NULL, NULL, $5, NOW(), NOW())
            RETURNING id
          `,
          [name, description || null, kind, JSON.stringify(config), actor]
        );
        const templateId = Number(insertRes.rows[0]?.id);
        if (!Number.isFinite(templateId) || templateId <= 0) throw new Error("Failed to create template");

        const written = await writeTemplateVersion({
          client,
          templateId,
          kind,
          name,
          description: description || null,
          config,
          createdBy: actor
        });

        await insertAuditEvent(client, {
          actorUserId: actorUserIdInt(user),
          actorLabel: actor,
          action: "template.create",
          objectType: "parsing_template",
          objectId: String(templateId),
          details: { kind, version: written.version, bucket: getS3Bucket(), objectKey: written.objectKey }
        });

        const rowRes = await client.query<ParsingTemplateRow>(
          `
            SELECT
              t.id,
              t.name,
              t.description,
              t.kind,
              t.config,
              t.source_json_path,
              t.source_json_original_name,
              t.source_json_size_bytes,
              t.source_json_uploaded_at,
              t.source_artifact_id,
              t.created_by,
              t.created_at,
              t.updated_at,
              COALESCE(v.max_version, 1)::int AS version
            FROM parsing_templates t
            LEFT JOIN (
              SELECT template_id, MAX(version)::int AS max_version
              FROM template_versions
              GROUP BY template_id
            ) v ON v.template_id = t.id
            WHERE t.id = $1
          `,
          [templateId]
        );
        const row = rowRes.rows[0];
        return { templateId, row };
      });

      if (uploadRow) {
        const storedKey = String(uploadRow.stored_path || "").trim();
        const artifactId = uploadRow.artifact_id != null ? Number(uploadRow.artifact_id) : null;
        try {
          await db.query(`DELETE FROM parsing_template_json_uploads WHERE id = $1`, [uploadRow.id]);
        } catch {
          /* ignore */
        }
        if (artifactId != null && Number.isFinite(artifactId)) {
          try {
            await db.query(`DELETE FROM file_artifacts WHERE id = $1`, [artifactId]);
          } catch {
            /* ignore */
          }
        }
        if (storedKey) {
          try {
            await deleteObject({ key: storedKey });
          } catch {
            /* ignore */
          }
        }
      }

      return reply.code(201).send({ template: created.row ? rowToTemplate(created.row) : null });
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A template with this name already exists." });
      }
      throw err;
    }
  });

  // --- Update template (creates a new version) ---
  app.patch("/parsing-templates/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: "Invalid template id" });
    }

    const user = getRequestUser(req);
    const actor = requestUserId(user);
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });

    const existingRes = await db.query<ParsingTemplateRow>(
      `
        SELECT
          t.id,
          t.name,
          t.description,
          t.kind,
          t.config,
          t.source_json_path,
          t.source_json_original_name,
          t.source_json_size_bytes,
          t.source_json_uploaded_at,
          t.source_artifact_id,
          t.created_by,
          t.created_at,
          t.updated_at,
          COALESCE(v.max_version, 1)::int AS version
        FROM parsing_templates t
        LEFT JOIN (
          SELECT template_id, MAX(version)::int AS max_version
          FROM template_versions
          GROUP BY template_id
        ) v ON v.template_id = t.id
        WHERE t.id = $1
      `,
      [id]
    );
    const existing = existingRes.rows[0];
    if (!existing) return reply.code(404).send({ error: "Template not found" });

    const body = (req.body as any) || {};
    const nextName = body.name !== undefined ? String(body.name ?? "").trim() : existing.name;
    const nextDescription = body.description !== undefined ? String(body.description ?? "").trim() : existing.description ?? "";
    const sourceUploadIdRaw = body.sourceUploadId ?? body.source_upload_id;
    const sourceUploadId =
      sourceUploadIdRaw != null && String(sourceUploadIdRaw).trim()
        ? Number(sourceUploadIdRaw)
        : null;

    if (!nextName) return reply.code(400).send({ error: "name is required" });

    let nextConfig: ParsingTemplateConfig | XmlParsingTemplateConfig = existing.config;
    if (body.config !== undefined) {
      try {
        nextConfig =
          existing.kind === "xml"
            ? normalizeXmlParsingTemplateConfig(body.config)
            : normalizeParsingTemplateConfig(body.config);
      } catch (err: any) {
        return reply.code(400).send({ error: err?.message || "Invalid config" });
      }
    } else if (sourceUploadId != null && Number.isFinite(sourceUploadId) && sourceUploadId > 0) {
      const resolved = await resolveUploadRow({ uploadId: sourceUploadId, actor, actorIsAdmin: isAdminUser(user) });
      if ("error" in resolved) {
        return resolved.error === "Forbidden"
          ? reply.code(403).send({ error: "Forbidden" })
          : reply.code(404).send({ error: "Upload not found" });
      }
      if (normalizeTemplateKind(resolved.row.kind) !== normalizeTemplateKind(existing.kind)) {
        return reply.code(400).send({ error: "Upload kind does not match template kind." });
      }
      const read = await readUploadConfig({ upload: resolved.row });
      if ("error" in read) {
        return reply.code(400).send({ error: read.error });
      }
      nextConfig = read.config;
    }

    if (existing.kind === "xml") {
      if ((nextConfig as any).block_xpath?.length === 0) {
        return reply.code(400).send({ error: "config.block_xpath must not be empty" });
      }
    } else {
      if ((nextConfig as any).block_tags?.length === 0) {
        return reply.code(400).send({ error: "config.block_tags must not be empty" });
      }
    }

    const changed =
      nextName !== existing.name ||
      (nextDescription || "") !== (existing.description || "") ||
      JSON.stringify(nextConfig) !== JSON.stringify(existing.config);
    if (!changed) {
      return { template: rowToTemplate(existing) };
    }

    let uploadRow: ParsingTemplateJsonUploadRow | null = null;
    if (sourceUploadId != null && Number.isFinite(sourceUploadId) && sourceUploadId > 0) {
      const resolved = await resolveUploadRow({ uploadId: sourceUploadId, actor, actorIsAdmin: isAdminUser(user) });
      if (!("error" in resolved)) uploadRow = resolved.row;
    }

    try {
      const updated = await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE parsing_templates
            SET name = $2,
                description = $3,
                config = $4::jsonb,
                updated_at = NOW()
            WHERE id = $1
          `,
          [id, nextName, nextDescription || null, JSON.stringify(nextConfig)]
        );

        const written = await writeTemplateVersion({
          client,
          templateId: id,
          kind: normalizeTemplateKind(existing.kind),
          name: nextName,
          description: nextDescription || null,
          config: nextConfig,
          createdBy: actor
        });

        await insertAuditEvent(client, {
          actorUserId: actorUserIdInt(user),
          actorLabel: actor,
          action: "template.update",
          objectType: "parsing_template",
          objectId: String(id),
          details: {
            kind: normalizeTemplateKind(existing.kind),
            version: written.version,
            bucket: getS3Bucket(),
            objectKey: written.objectKey
          }
        });

        const rowRes = await client.query<ParsingTemplateRow>(
          `
            SELECT
              t.id,
              t.name,
              t.description,
              t.kind,
              t.config,
              t.source_json_path,
              t.source_json_original_name,
              t.source_json_size_bytes,
              t.source_json_uploaded_at,
              t.source_artifact_id,
              t.created_by,
              t.created_at,
              t.updated_at,
              COALESCE(v.max_version, 1)::int AS version
            FROM parsing_templates t
            LEFT JOIN (
              SELECT template_id, MAX(version)::int AS max_version
              FROM template_versions
              GROUP BY template_id
            ) v ON v.template_id = t.id
            WHERE t.id = $1
          `,
          [id]
        );
        return rowRes.rows[0] ?? null;
      });

      if (uploadRow) {
        const storedKey = String(uploadRow.stored_path || "").trim();
        const artifactId = uploadRow.artifact_id != null ? Number(uploadRow.artifact_id) : null;
        try {
          await db.query(`DELETE FROM parsing_template_json_uploads WHERE id = $1`, [uploadRow.id]);
        } catch {
          /* ignore */
        }
        if (artifactId != null && Number.isFinite(artifactId)) {
          try {
            await db.query(`DELETE FROM file_artifacts WHERE id = $1`, [artifactId]);
          } catch {
            /* ignore */
          }
        }
        if (storedKey) {
          try {
            await deleteObject({ key: storedKey });
          } catch {
            /* ignore */
          }
        }
      }

      return { template: updated ? rowToTemplate(updated) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A template with this name already exists." });
      }
      throw err;
    }
  });

  // --- List template versions (immutable history) ---
  app.get("/parsing-templates/:id/versions", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.code(400).send({ error: "Invalid template id" });

    const existsRes = await db.query("SELECT 1 FROM parsing_templates WHERE id = $1 LIMIT 1", [id]);
    if ((existsRes.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Template not found" });

    const versionsRes = await db.query<{
      id: number;
      version: number;
      schema_version: number;
      created_by: string | null;
      created_at: string;
      artifact_id: number;
      bucket: string;
      object_key: string;
      sha256: string | null;
      etag: string | null;
      size_bytes: number | null;
      content_type: string | null;
    }>(
      `
        SELECT
          v.id,
          v.version,
          v.schema_version,
          v.created_by,
          v.created_at,
          v.artifact_id,
          a.bucket,
          a.object_key,
          a.sha256,
          a.etag,
          a.size_bytes,
          a.content_type
        FROM template_versions v
        JOIN file_artifacts a ON a.id = v.artifact_id
        WHERE v.template_id = $1
        ORDER BY v.version DESC, v.id DESC
      `,
      [id]
    );

    return {
      versions: versionsRes.rows.map((v) => ({
        id: Number(v.id),
        version: Number(v.version),
        schemaVersion: Number(v.schema_version),
        createdBy: v.created_by ?? null,
        createdAt: v.created_at ? new Date(v.created_at).toISOString() : null,
        artifact: {
          id: Number(v.artifact_id),
          bucket: String(v.bucket || ""),
          objectKey: String(v.object_key || ""),
          sha256: v.sha256 ? String(v.sha256) : null,
          etag: v.etag ? String(v.etag) : null,
          sizeBytes: v.size_bytes != null ? Number(v.size_bytes) : null,
          contentType: v.content_type ? String(v.content_type) : null
        }
      }))
    };
  });

  // --- Rollback (creates a new version from a previous one) ---
  app.post("/parsing-templates/:id/rollback", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.code(400).send({ error: "Invalid template id" });
    const body = (req.body as any) || {};
    const targetVersion = Number(body.version);
    if (!Number.isFinite(targetVersion) || targetVersion <= 0) {
      return reply.code(400).send({ error: "version is required" });
    }

    const user = getRequestUser(req);
    const actor = requestUserId(user);
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });

    const tplRes = await db.query<ParsingTemplateRow>(
      `
        SELECT
          t.id,
          t.name,
          t.description,
          t.kind,
          t.config,
          t.source_json_path,
          t.source_json_original_name,
          t.source_json_size_bytes,
          t.source_json_uploaded_at,
          t.source_artifact_id,
          t.created_by,
          t.created_at,
          t.updated_at,
          COALESCE(v.max_version, 1)::int AS version
        FROM parsing_templates t
        LEFT JOIN (
          SELECT template_id, MAX(version)::int AS max_version
          FROM template_versions
          GROUP BY template_id
        ) v ON v.template_id = t.id
        WHERE t.id = $1
      `,
      [id]
    );
    const tpl = tplRes.rows[0];
    if (!tpl) return reply.code(404).send({ error: "Template not found" });

    const verRes = await db.query<{ object_key: string }>(
      `
        SELECT a.object_key
        FROM template_versions v
        JOIN file_artifacts a ON a.id = v.artifact_id
        WHERE v.template_id = $1
          AND v.version = $2
        LIMIT 1
      `,
      [id, targetVersion]
    );
    const objectKey = String(verRes.rows[0]?.object_key || "").trim();
    if (!objectKey) return reply.code(404).send({ error: "Version not found" });

    let parsed: any;
    try {
      const { buf } = await getObjectBuffer({ key: objectKey });
      parsed = JSON.parse(buf.toString("utf8"));
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Failed to load version payload" });
    }

    const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as any) : null;
    const rawConfig = obj?.config ?? parsed;

    let nextConfig: ParsingTemplateConfig | XmlParsingTemplateConfig;
    try {
      nextConfig =
        tpl.kind === "xml"
          ? normalizeXmlParsingTemplateConfig(rawConfig)
          : normalizeParsingTemplateConfig(rawConfig);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Invalid config in selected version" });
    }

    const updated = await withTransaction(async (client) => {
      await client.query(
        `UPDATE parsing_templates
         SET config = $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [id, JSON.stringify(nextConfig)]
      );

      const written = await writeTemplateVersion({
        client,
        templateId: id,
        kind: normalizeTemplateKind(tpl.kind),
        name: tpl.name,
        description: tpl.description ?? null,
        config: nextConfig,
        createdBy: actor
      });

      await insertAuditEvent(client, {
        actorUserId: actorUserIdInt(user),
        actorLabel: actor,
        action: "template.rollback",
        objectType: "parsing_template",
        objectId: String(id),
        details: { fromVersion: targetVersion, toVersion: written.version, bucket: getS3Bucket(), objectKey: written.objectKey }
      });

      const rowRes = await client.query<ParsingTemplateRow>(
        `
          SELECT
            t.id,
            t.name,
            t.description,
            t.kind,
            t.config,
            t.source_json_path,
            t.source_json_original_name,
            t.source_json_size_bytes,
            t.source_json_uploaded_at,
            t.source_artifact_id,
            t.created_by,
            t.created_at,
            t.updated_at,
            COALESCE(v.max_version, 1)::int AS version
          FROM parsing_templates t
          LEFT JOIN (
            SELECT template_id, MAX(version)::int AS max_version
            FROM template_versions
            GROUP BY template_id
          ) v ON v.template_id = t.id
          WHERE t.id = $1
        `,
        [id]
      );
      return rowRes.rows[0] ?? null;
    });

    return { template: updated ? rowToTemplate(updated) : null };
  });

  // --- Delete template ---
  app.delete("/parsing-templates/:id", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: "Invalid template id" });
    }

    const templateIdText = String(id);

    const usedRes = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM project_file_html_templates WHERE parsing_template_id = $1`,
      [id]
    );
    const used = Number(usedRes.rows[0]?.count ?? 0);
    if (used > 0) {
      return reply.code(409).send({
        error: "Template is in use by existing project files and cannot be deleted.",
        code: "TEMPLATE_IN_USE"
      });
    }

    const fileTypeConfigWhere = `
      COALESCE(config #>> '{html,parsingTemplateId}', '') = $1
      OR COALESCE(config #>> '{xml,parsingTemplateId}', '') = $1
      OR COALESCE(config->>'parsingTemplateId', '') = $1
      OR COALESCE(config->>'htmlParsingTemplateId', '') = $1
      OR COALESCE(config->>'parsing_template_id', '') = $1
    `;

    const inUseRes = await db.query<{ file_type_configs: number; project_templates: number }>(
      `
        WITH ftc AS (
          SELECT id
          FROM file_type_configs
          WHERE ${fileTypeConfigWhere}
        )
        SELECT
          (SELECT COUNT(*)::int FROM ftc) AS file_type_configs,
          (SELECT COUNT(*)::int FROM project_templates pt WHERE pt.file_type_config_id IN (SELECT id FROM ftc)) AS project_templates
      `,
      [templateIdText]
    );

    const inUseFileTypeConfigs = Number(inUseRes.rows[0]?.file_type_configs ?? 0) || 0;
    const inUseProjectTemplates = Number(inUseRes.rows[0]?.project_templates ?? 0) || 0;

    if (inUseFileTypeConfigs > 0) {
      const sampleRes = await db.query<{ id: number; name: string }>(
        `
          SELECT id, name
          FROM file_type_configs
          WHERE ${fileTypeConfigWhere}
          ORDER BY updated_at DESC, id DESC
          LIMIT 5
        `,
        [templateIdText]
      );
      return reply.code(409).send({
        error: "Template is in use by existing File Type Configuration(s) and cannot be deleted.",
        code: "TEMPLATE_IN_USE",
        inUse: {
          fileTypeConfigCount: inUseFileTypeConfigs,
          projectTemplateCount: inUseProjectTemplates,
          fileTypeConfigs: sampleRes.rows.map((r) => ({ id: Number(r.id), name: String(r.name || "") }))
        }
      });
    }

    const user = getRequestUser(req);
    const actor = requestUserId(user) || "system";

    const deleted = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [id]);

      const existsRes = await client.query<{ source_json_path: string | null }>(
        `SELECT source_json_path FROM parsing_templates WHERE id = $1`,
        [id]
      );
      const existing = existsRes.rows[0];
      if (!existing) return { ok: false as const, notFound: true as const };

      const usedResTx = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM project_file_html_templates WHERE parsing_template_id = $1`,
        [id]
      );
      const usedTx = Number(usedResTx.rows[0]?.count ?? 0) || 0;
      if (usedTx > 0) {
        return { ok: false as const, inUse: true as const, reason: "project_files" as const };
      }

      const inUseCfgResTx = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM file_type_configs WHERE ${fileTypeConfigWhere}`,
        [templateIdText]
      );
      const inUseCfgTx = Number(inUseCfgResTx.rows[0]?.count ?? 0) || 0;
      if (inUseCfgTx > 0) {
        return { ok: false as const, inUse: true as const, reason: "file_type_configs" as const };
      }

      const artifactsRes = await client.query<{ artifact_id: number; object_key: string }>(
        `
          SELECT v.artifact_id, a.object_key
          FROM template_versions v
          JOIN file_artifacts a ON a.id = v.artifact_id
          WHERE v.template_id = $1
        `,
        [id]
      );

      const artifactIds = artifactsRes.rows
        .map((r) => Number(r.artifact_id))
        .filter((n) => Number.isFinite(n) && n > 0);

      const objectKeys = new Set<string>(
        artifactsRes.rows
          .map((r) => String(r.object_key || "").trim())
          .filter(Boolean)
      );
      const sourceKey = String(existing.source_json_path || "").trim();
      if (sourceKey) objectKeys.add(sourceKey);

      await client.query(`DELETE FROM template_versions WHERE template_id = $1`, [id]);
      await client.query(`DELETE FROM parsing_templates WHERE id = $1`, [id]);

      if (artifactIds.length > 0) {
        await client.query(`DELETE FROM file_artifacts WHERE id = ANY($1::int[])`, [artifactIds]);
      }

      await insertAuditEvent(client, {
        actorUserId: actorUserIdInt(user),
        actorLabel: actor,
        action: "template.delete",
        objectType: "parsing_template",
        objectId: String(id),
        details: { deletedArtifactCount: artifactIds.length, objectKeys: Array.from(objectKeys) }
      });

      return { ok: true as const, objectKeys: Array.from(objectKeys) };
    });

    if (!deleted.ok) {
      if ("notFound" in deleted) return reply.code(404).send({ error: "Template not found" });
      if ("inUse" in deleted) {
        return reply.code(409).send({
          error: "Template is in use and cannot be deleted.",
          code: "TEMPLATE_IN_USE"
        });
      }
      return reply.code(500).send({ error: "Failed to delete template" });
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
      ? { ok: true, storageDeleted: false, failedKeys: storageDeleteFailures }
      : { ok: true, storageDeleted: true };
  });
}
