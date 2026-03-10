import { FastifyInstance } from "fastify";
import { withTransaction } from "../db.js";
import {
  getRequestUser,
  isAdminUser,
  requireManagerOrAdmin,
  requestUserId
} from "../middleware/auth.js";
import {
  normalizeParsingTemplateConfig,
  normalizeXmlParsingTemplateConfig,
  type ParsingTemplateConfig,
  type XmlParsingTemplateConfig
} from "../lib/parsing-templates.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import {
  deleteObject,
  getS3Bucket,
  putObjectBuffer,
  sha256Hex
} from "../lib/s3.js";
import { keyFileIngestionTemplateUploadJson } from "../lib/storage-keys.js";
import { insertAuditEvent } from "../lib/audit.js";
import {
  actorUserIdInt,
  normalizeTemplateKind,
  resolveUploadRow,
  safeBasename,
  suggestTemplateDescriptionFromUpload,
  suggestTemplateNameFromUpload
} from "./parsing-templates.helpers.js";

export function registerParsingTemplateUploadRoutes(app: FastifyInstance) {
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
    } else if ((config as any).block_tags?.length === 0) {
      return reply.code(400).send({ error: "Block rules must not be empty." });
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

      return { uploadId, objectKey };
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
}
