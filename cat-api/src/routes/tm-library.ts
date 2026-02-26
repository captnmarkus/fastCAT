import { FastifyInstance } from "fastify";
import path from "path";
import fetch from "node-fetch";
import { randomUUID } from "crypto";
import { db } from "../db.js";
import { CONFIG } from "../config.js";
import {
  getRequestUser,
  requestUserId,
  requireAdmin,
  requireManagerOrAdmin
} from "../middleware/auth.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import { deleteObject, getS3Bucket, presignGetObject, putObjectBuffer, sha256Hex } from "../lib/s3.js";
import { keyTmxUpload } from "../lib/storage-keys.js";
import { insertAuditEvent } from "../lib/audit.js";
import {
  actorUserIdInt,
  humanizeSampleLabel,
  insertLibraryVersion,
  looksLikeS3ObjectKey,
  requestActorLabel,
  rowToEntry,
  rowToVersion,
  tmLabelExists,
  type TmLibraryRow,
  type TmLibraryVersionRow
} from "./tm-library.helpers.js";

export async function tmLibraryRoutes(app: FastifyInstance) {
  app.get(
    "/admin/tm-library",
    { preHandler: [requireManagerOrAdmin] },
    async () => {
    const res = await db.query<TmLibraryRow>(
      "SELECT * FROM tm_library WHERE origin = 'upload' ORDER BY created_at DESC"
    );
    const rows = res.rows;
    return {
      entries: rows.map(rowToEntry),
      meta: { entryCount: rows.length }
    };
    }
  );

  app.get(
    "/admin/tm-library/check-name",
    { preHandler: [requireManagerOrAdmin] },
    async (req) => {
      const query = (req.query as any) || {};
      const rawName = String(query.name || "").trim();
      const excludeRaw = query.excludeId ?? query.exclude_id ?? null;
      const excludeId = Number(excludeRaw);
      if (!rawName) return { exists: false };
      const exists = await tmLabelExists(rawName, {
        excludeId: Number.isFinite(excludeId) ? excludeId : undefined
      });
      return { exists };
    }
  );

  app.get(
    "/admin/tm-library/:entryId",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const { entryId } = req.params as any;
      const id = Number(entryId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid TM entry id" });
      }
      const rowRes = await db.query<TmLibraryRow>(
        "SELECT * FROM tm_library WHERE id = $1 AND origin = 'upload'",
        [id]
      );
      const row = rowRes.rows[0];
      if (!row) {
        return reply.code(404).send({ error: "TM entry not found" });
      }
      return { entry: rowToEntry(row) };
    }
  );

  app.post(
    "/admin/tm-library/upload",
    { preHandler: [requireManagerOrAdmin] },
    async (req: any, reply) => {
      const traceId = typeof req.id === "string" ? req.id : undefined;
      const actorLabel =
        requestActorLabel(req, { fallback: requestUserId(getRequestUser(req)) ?? "system" }) ??
        "system";

      let filePart: any | null = null;
      let label: string | null = null;
      let comment: string | null = null;

      for await (const part of req.parts()) {
        if (part.type === "file") {
          filePart = part;
        } else if (part.type === "field" && part.fieldname === "label") {
          label = String(part.value || "").trim() || null;
        } else if (part.type === "field" && part.fieldname === "comment") {
          comment = String(part.value || "").trim() || null;
        }
      }

      if (!filePart) {
        return reply.code(400).send({ error: "No TMX file uploaded" });
      }

      const originalFilename = String(filePart.filename || "").trim();
      if (!originalFilename.toLowerCase().endsWith(".tmx")) {
        return reply.code(400).send({ error: "Only .tmx files are supported" });
      }

      const buf: Buffer = await filePart.toBuffer();
      if (!buf || buf.length === 0) {
        return reply.code(400).send({ error: "Uploaded TMX is empty" });
      }

      const safeOriginal = path
        .basename(originalFilename)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      const dbFilename = await ensureUniqueUploadFilename(safeOriginal);

      const entryLabel = label ? String(label).trim() : "";
      if (!entryLabel) {
        return reply.code(400).send({ error: "Name is required" });
      }
      if (await tmLabelExists(entryLabel)) {
        return reply.code(409).send({ error: "A translation memory with this name already exists." });
      }
      const entryComment = comment ? String(comment).trim() : null;
      const slug = slugify(entryLabel) || "tmx";
      const tmName = `library:${slug}:${randomUUID().slice(0, 8)}`;

      const token = (app as any).jwt.sign({
        sub: "cat-api",
        username: "cat-api",
        role: "admin"
      });

      let tmProxyId: number | null = null;
      let entryId: number | null = null;
      let storedKey: string | null = null;
      let artifactId: number | null = null;
      try {
        const created = await createProxyTm({
          tmName,
          token,
          traceId
        });
        tmProxyId = Number(created.id);

        const importResult = await importTmxIntoProxy({
          tmProxyId,
          token,
          traceId,
          filename: safeOriginal,
          buf
        });

        const insertRes = await db.query<{ id: number }>(
          `INSERT INTO tm_library(origin, label, comment, filename, stored_path, size_bytes, disabled, uploaded_by, uploaded_at, tm_name, tm_proxy_id, updated_at)
           VALUES ('upload', $1, $2, $3, $4, $5, false, $6, NOW(), $7, $8, NOW())
           RETURNING id`,
          [entryLabel, entryComment, dbFilename, "pending", buf.length, actorLabel, tmName, tmProxyId]
        );

        entryId = Number(insertRes.rows[0]?.id);
        if (!Number.isFinite(entryId) || entryId <= 0) {
          throw new Error("Failed to create TM library entry");
        }

        const versionTag = `upload-${randomUUID().slice(0, 12)}`;
        storedKey = keyTmxUpload({ tmxUploadId: entryId, versionTag });
        const put = await putObjectBuffer({
          key: storedKey,
          buf,
          contentType: "application/xml"
        });
        const sha256 = await sha256Hex(buf);

        const artifact = await insertFileArtifact(db, {
          kind: "tmx_upload" satisfies FileArtifactKind,
          bucket: getS3Bucket(),
          objectKey: storedKey,
          sha256,
          etag: put.etag,
          sizeBytes: buf.length,
          contentType: "application/xml",
          meta: {
            tmLibraryId: entryId,
            filename: dbFilename,
            label: entryLabel,
            originalFilename: safeOriginal,
            versionTag
          },
          createdBy: actorLabel
        });
        artifactId = artifact.id;

        await db.query(`UPDATE tm_library SET stored_path = $1, artifact_id = $2 WHERE id = $3`, [
          storedKey,
          artifactId,
          entryId
        ]);

        const rowRes = await db.query<TmLibraryRow>("SELECT * FROM tm_library WHERE id = $1", [entryId]);
        const row = rowRes.rows[0];
        if (row) {
          await insertLibraryVersion({
            entry: row,
            actor: actorLabel,
            comment: entryComment || "upload"
          });

          const user = getRequestUser(req) as any;
          await insertAuditEvent(db, {
            actorUserId: typeof user?.sub === "number" ? user.sub : null,
            actorLabel,
            action: "tmx.upload",
            objectType: "tm_library",
            objectId: String(row.id),
            details: {
              bucket: getS3Bucket(),
              objectKey: storedKey,
              sizeBytes: buf.length,
              tmProxyId: tmProxyId ?? null
            }
          });
        }

        return {
          ok: true,
          entry: row ? rowToEntry(row) : null,
          import: {
            imported: Number(importResult?.imported ?? 0),
            skipped: Number(importResult?.skipped ?? 0),
            total: Number(importResult?.total ?? 0)
          }
        };
      } catch (err: any) {
        const duplicateLabel =
          err?.code === "23505" &&
          String(err?.constraint || "").includes("tm_library_origin_label");
        if (tmProxyId) {
          try {
            await deleteProxyTm({ tmProxyId, token, traceId });
          } catch {
            /* ignore */
          }
        }

        if (entryId != null) {
          try {
            await db.query("DELETE FROM tm_library WHERE id = $1 AND origin = 'upload'", [entryId]);
          } catch {
            /* ignore */
          }
        }
        if (artifactId != null) {
          try {
            await db.query("DELETE FROM file_artifacts WHERE id = $1", [artifactId]);
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

        if (duplicateLabel) {
          return reply.code(409).send({ error: "A translation memory with this name already exists." });
        }
        return reply.code(502).send({ error: err?.message || "Failed to import TMX" });
      }
    }
  );

  app.post(
    "/admin/tm-library/:entryId/replace",
    { preHandler: [requireManagerOrAdmin] },
    async (req: any, reply) => {
      const { entryId } = req.params as any;
      const id = Number(entryId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid TM entry id" });
      }

      const existingRes = await db.query<TmLibraryRow>(
        "SELECT * FROM tm_library WHERE id = $1 AND origin = 'upload'",
        [id]
      );
      const existingRow = existingRes.rows[0];
      if (!existingRow) {
        return reply.code(404).send({ error: "TM entry not found" });
      }

      const traceId = typeof req.id === "string" ? req.id : undefined;
      const actorLabel =
        requestActorLabel(req, { fallback: requestUserId(getRequestUser(req)) ?? "system" }) ??
        "system";

      let filePart: any | null = null;
      let historyComment: string | null = null;

      for await (const part of req.parts()) {
        if (part.type === "file") {
          filePart = part;
        } else if (
          part.type === "field" &&
          (part.fieldname === "historyComment" ||
            part.fieldname === "history_comment" ||
            part.fieldname === "comment")
        ) {
          historyComment = String(part.value || "").trim() || historyComment;
        }
      }

      if (!filePart) {
        return reply.code(400).send({ error: "No TMX file uploaded" });
      }

      const originalFilename = String(filePart.filename || "").trim();
      if (!originalFilename.toLowerCase().endsWith(".tmx")) {
        return reply.code(400).send({ error: "Only .tmx files are supported" });
      }

      const buf: Buffer = await filePart.toBuffer();
      if (!buf || buf.length === 0) {
        return reply.code(400).send({ error: "Uploaded TMX is empty" });
      }

      const safeOriginal = path
        .basename(originalFilename)
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const dbFilename = await ensureUniqueUploadFilename(safeOriginal, { excludeEntryId: id });

      const slug = slugify(existingRow.label) || "tmx";
      const tmName = `library:${slug}:${randomUUID().slice(0, 8)}`;

      const token = (app as any).jwt.sign({
        sub: "cat-api",
        username: "cat-api",
        role: "admin"
      });

      let tmProxyId: number | null = null;
      let storedKey: string | null = null;
      let artifactId: number | null = null;

      try {
        const created = await createProxyTm({
          tmName,
          token,
          traceId
        });
        tmProxyId = Number(created.id);

        const importResult = await importTmxIntoProxy({
          tmProxyId,
          token,
          traceId,
          filename: safeOriginal,
          buf
        });

        const versionTag = `replace-${randomUUID().slice(0, 12)}`;
        storedKey = keyTmxUpload({ tmxUploadId: id, versionTag });
        const put = await putObjectBuffer({
          key: storedKey,
          buf,
          contentType: "application/xml"
        });
        const sha256 = await sha256Hex(buf);

        const artifact = await insertFileArtifact(db, {
          kind: "tmx_upload" satisfies FileArtifactKind,
          bucket: getS3Bucket(),
          objectKey: storedKey,
          sha256,
          etag: put.etag,
          sizeBytes: buf.length,
          contentType: "application/xml",
          meta: {
            tmLibraryId: id,
            filename: dbFilename,
            label: existingRow.label,
            originalFilename: safeOriginal,
            versionTag
          },
          createdBy: actorLabel
        });
        artifactId = artifact.id;

        await db.query(
          `
            UPDATE tm_library
            SET filename = $1,
                stored_path = $2,
                artifact_id = $3,
                size_bytes = $4,
                uploaded_by = $5,
                uploaded_at = NOW(),
                tm_name = $6,
                tm_proxy_id = $7,
                updated_at = NOW()
            WHERE id = $8 AND origin = 'upload'
          `,
          [dbFilename, storedKey, artifactId, buf.length, actorLabel, tmName, tmProxyId, id]
        );

        const rowRes = await db.query<TmLibraryRow>("SELECT * FROM tm_library WHERE id = $1", [id]);
        const row = rowRes.rows[0];
        if (row) {
          await insertLibraryVersion({
            entry: row,
            actor: actorLabel,
            comment: historyComment || "replaced file"
          });
        }

        return {
          ok: true,
          entry: row ? rowToEntry(row) : null,
          import: {
            imported: Number(importResult?.imported ?? 0),
            skipped: Number(importResult?.skipped ?? 0),
            total: Number(importResult?.total ?? 0)
          }
        };
      } catch (err: any) {
        if (tmProxyId) {
          try {
            await deleteProxyTm({ tmProxyId, token, traceId });
          } catch {
            /* ignore */
          }
        }
        if (artifactId != null) {
          try {
            await db.query("DELETE FROM file_artifacts WHERE id = $1", [artifactId]);
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
        return reply.code(502).send({ error: err?.message || "Failed to replace TMX" });
      }
    }
  );

  app.get(
    "/admin/tm-library/download/:entryId",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const { entryId } = req.params as any;
      const rowRes = await db.query<TmLibraryRow>(
        "SELECT * FROM tm_library WHERE id = $1 AND origin = 'upload'",
        [Number(entryId)]
      );
      const row = rowRes.rows[0];
      if (!row) {
        return reply.code(404).send({ error: "TM entry not found" });
      }
      const tmProxyId = row.tm_proxy_id ?? null;
      const traceId = typeof req.id === "string" ? req.id : undefined;

      if (tmProxyId) {
        try {
          const token = (app as any).jwt.sign({
            sub: "cat-api",
            username: "cat-api",
            role: "admin"
          });
          const headers: Record<string, string> = {
            authorization: `Bearer ${token}`
          };
          if (traceId) headers["x-request-id"] = traceId;
          const res = await fetch(
            `${CONFIG.TM_PROXY_URL}/api/tm/${tmProxyId}/export`,
            {
              headers
            }
          );
          if (!res.ok || !res.body) {
            throw new Error(`tm export failed with status ${res.status}`);
          }
          reply.header("Content-Type", "application/xml");
          reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
          reply.header("Pragma", "no-cache");
          reply.header(
            "Content-Disposition",
            `attachment; filename="${row.filename}"`
          );
          return reply.send(res.body);
        } catch (err) {
          app.log.error({ err, entryId: row.id }, "Failed to proxy TM export");
          return reply.code(502).send({ error: "Failed to generate TMX from database." });
        }
      }

      const objectKey = String(row.stored_path || "").trim();
      if (!looksLikeS3ObjectKey(objectKey)) {
        return reply.code(404).send({ error: "TM not found in storage" });
      }

      const signed = await presignGetObject({
        key: objectKey,
        downloadFilename: row.filename,
        contentType: "application/xml"
      });
      return reply.redirect(signed.url);
    }
  );

  app.get(
    "/admin/tm-library/:entryId/versions",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const { entryId } = req.params as any;
      const id = Number(entryId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid TM entry id" });
      }
      const entryRes = await db.query<{ id: number }>(
        "SELECT id FROM tm_library WHERE id = $1 AND origin = 'upload' LIMIT 1",
        [id]
      );
      if ((entryRes.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "TM entry not found" });
      }
      const versionsRes = await db.query<TmLibraryVersionRow>(
        `
          SELECT *
          FROM (
            SELECT
              version_id,
              tm_library_id,
              created_at,
              created_by,
              comment,
              label,
              filename,
              stored_path,
              artifact_id,
              size_bytes,
              disabled,
              tm_name,
              tm_proxy_id,
              ROW_NUMBER() OVER (
                PARTITION BY tm_library_id
                ORDER BY created_at ASC, version_id ASC
              ) AS version_number
            FROM tm_library_versions
            WHERE tm_library_id = $1
          ) v
          ORDER BY v.created_at DESC, v.version_id DESC
        `,
        [id]
      );
      return { versions: versionsRes.rows.map(rowToVersion) };
    }
  );

  app.get(
    "/admin/tm-library/versions/:versionId/download",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const { versionId } = req.params as any;
      const id = Number(versionId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid TM version id" });
      }
      const rowRes = await db.query<
        TmLibraryVersionRow & {
          current_tm_proxy_id: number | null;
          current_filename: string;
          latest_version_id: number | null;
        }
      >(
        `
          SELECT
            v.version_id,
            v.tm_library_id,
            v.created_at,
            v.created_by,
            v.comment,
            v.label,
            v.filename,
            v.stored_path,
            v.artifact_id,
            v.size_bytes,
            v.disabled,
            v.tm_name,
            v.tm_proxy_id,
            t.tm_proxy_id AS current_tm_proxy_id,
            t.filename AS current_filename,
            (
              SELECT vv.version_id
              FROM tm_library_versions vv
              WHERE vv.tm_library_id = v.tm_library_id
              ORDER BY vv.created_at DESC, vv.version_id DESC
              LIMIT 1
            ) AS latest_version_id
          FROM tm_library_versions v
          JOIN tm_library t ON t.id = v.tm_library_id
          WHERE v.version_id = $1
            AND t.origin = 'upload'
        `,
        [id]
      );
      const row = rowRes.rows[0];
      if (!row) {
        return reply.code(404).send({ error: "TM version not found" });
      }

      const latestVersionId =
        row.latest_version_id != null ? Number(row.latest_version_id) : null;
      const isCurrentVersion =
        latestVersionId != null && Number(row.version_id) === latestVersionId;
      const currentTmProxyId =
        row.current_tm_proxy_id != null ? Number(row.current_tm_proxy_id) : null;
      const downloadFilename = String(
        isCurrentVersion ? row.current_filename || row.filename : row.filename
      );

      // Latest version download must reflect the live TM database content.
      if (isCurrentVersion && currentTmProxyId) {
        const traceId = typeof req.id === "string" ? req.id : undefined;
        const token = (app as any).jwt.sign({
          sub: "cat-api",
          username: "cat-api",
          role: "admin"
        });
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`
        };
        if (traceId) headers["x-request-id"] = traceId;
        try {
          const res = await fetch(
            `${CONFIG.TM_PROXY_URL}/api/tm/${currentTmProxyId}/export`,
            { headers }
          );
          if (!res.ok || !res.body) {
            throw new Error(`tm export failed with status ${res.status}`);
          }
          reply.header("Content-Type", "application/xml");
          reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
          reply.header("Pragma", "no-cache");
          reply.header(
            "Content-Disposition",
            `attachment; filename="${downloadFilename}"`
          );
          return reply.send(res.body);
        } catch (err) {
          app.log.error(
            { err, versionId: row.version_id, currentTmProxyId },
            "Failed to proxy TM export for current version"
          );
          return reply
            .code(502)
            .send({ error: "Failed to generate latest TMX from database." });
        }
      }

      const objectKey = String(row.stored_path || "").trim();
      if (looksLikeS3ObjectKey(objectKey)) {
        const signed = await presignGetObject({
          key: objectKey,
          downloadFilename,
          contentType: "application/xml"
        });
        return reply.redirect(signed.url);
      }

      if (row.tm_proxy_id) {
        const traceId = typeof req.id === "string" ? req.id : undefined;
        const token = (app as any).jwt.sign({
          sub: "cat-api",
          username: "cat-api",
          role: "admin"
        });
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`
        };
        if (traceId) headers["x-request-id"] = traceId;
        try {
          const res = await fetch(
            `${CONFIG.TM_PROXY_URL}/api/tm/${row.tm_proxy_id}/export`,
            { headers }
          );
          if (!res.ok || !res.body) {
            throw new Error(`tm export failed with status ${res.status}`);
          }
          reply.header("Content-Type", "application/xml");
          reply.header(
            "Content-Disposition",
            `attachment; filename="${row.filename}"`
          );
          return reply.send(res.body);
        } catch (err) {
          app.log.error(
            { err, versionId: row.version_id },
            "Failed to proxy TM export for version"
          );
        }
      }

      return reply.code(404).send({ error: "TM version not found in storage" });
    }
  );

  app.patch(
    "/admin/tm-library/:entryId",
    { preHandler: [requireManagerOrAdmin] },
    async (req, reply) => {
      const { entryId } = req.params as any;
      const body = (req.body as any) || {};
      const id = Number(entryId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid TM entry id" });
      }
      const existingRes = await db.query<TmLibraryRow>(
        "SELECT * FROM tm_library WHERE id = $1 AND origin = 'upload'",
        [id]
      );
      const existingRow = existingRes.rows[0];
      if (!existingRow) {
        return reply.code(404).send({ error: "TM entry not found" });
      }
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (body.label !== undefined) {
        const nextLabel = String(body.label || "").trim();
        if (!nextLabel) {
          return reply.code(400).send({ error: "Name is required" });
        }
        if (await tmLabelExists(nextLabel, { excludeId: id })) {
          return reply.code(409).send({ error: "A translation memory with this name already exists." });
        }
        updates.push(`label = $${idx++}`);
        params.push(nextLabel);
      }
      if (body.comment !== undefined) {
        const nextComment = String(body.comment || "").trim();
        updates.push(`comment = $${idx++}`);
        params.push(nextComment || null);
      }
      if (body.disabled !== undefined) {
        updates.push(`disabled = $${idx++}`);
        params.push(Boolean(body.disabled));
      }
      if (updates.length === 0) {
        return reply.code(400).send({ error: "No updates provided" });
      }
      updates.push("updated_at = NOW()");
      params.push(id);
      const sql = `UPDATE tm_library SET ${updates.join(", ")} WHERE id = $${idx} AND origin = 'upload'`;
      try {
        await db.query(sql, params);
      } catch (err: any) {
        const duplicateLabel =
          err?.code === "23505" &&
          String(err?.constraint || "").includes("tm_library_origin_label");
        if (duplicateLabel) {
          return reply.code(409).send({ error: "A translation memory with this name already exists." });
        }
        throw err;
      }

      const updatedRes = await db.query<TmLibraryRow>(
        "SELECT * FROM tm_library WHERE id = $1 AND origin = 'upload'",
        [id]
      );
      const updatedRow = updatedRes.rows[0];
      if (updatedRow) {
        const actor =
          requestActorLabel(req, { fallback: requestUserId(getRequestUser(req)) ?? "system" }) ??
          "system";
        const historyRaw =
          body.historyComment ?? body.history_comment ?? null;
        const comment = historyRaw ? String(historyRaw).trim() : null;
        await insertLibraryVersion({
          entry: updatedRow,
          actor,
          comment: comment || "update"
        });
      }
      return { ok: true };
    }
  );

  app.delete(
    "/admin/tm-library/:entryId",
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { entryId } = req.params as any;
      const rowRes = await db.query<TmLibraryRow>(
        "SELECT * FROM tm_library WHERE id = $1 AND origin = 'upload'",
        [Number(entryId)]
      );
      const row = rowRes.rows[0];
      if (!row) {
        return reply.code(404).send({ error: "TM entry not found" });
      }
      await db.query("DELETE FROM tm_library WHERE id = $1 AND origin = 'upload'", [
        row.id
      ]);

      const traceId = typeof req.id === "string" ? req.id : undefined;
      const token = (app as any).jwt.sign({
        sub: "cat-api",
        username: "cat-api",
        role: "admin"
      });
      if (row.tm_proxy_id) {
        try {
          await deleteProxyTm({ tmProxyId: row.tm_proxy_id, token, traceId });
        } catch {
          /* ignore */
        }
      }

      const objectKey = String(row.stored_path || "").trim();
      if (looksLikeS3ObjectKey(objectKey)) {
        try {
          await deleteObject({ key: objectKey });
        } catch {
          /* ignore */
        }
      }

      try {
        const actorLabel =
          requestActorLabel(req, { fallback: requestUserId(getRequestUser(req)) ?? "system" }) ??
          "system";
        await insertAuditEvent(db, {
          actorUserId: actorUserIdInt(getRequestUser(req) as any),
          actorLabel,
          action: "tmx.delete",
          objectType: "tm_library",
          objectId: String(row.id),
          details: { bucket: getS3Bucket(), objectKey: looksLikeS3ObjectKey(objectKey) ? objectKey : null }
        });
      } catch {
        /* ignore */
      }
      return { ok: true };
    }
  );
}

function slugify(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function ensureUniqueUploadFilename(
  filename: string,
  opts: { excludeEntryId?: number } = {}
) {
  const safe = String(filename || "").trim() || `tmx-${randomUUID()}.tmx`;
  const parsed = path.parse(safe);
  const base = parsed.name || "tmx";
  const ext = parsed.ext && parsed.ext.length > 0 ? parsed.ext : ".tmx";

  let candidate = safe;
  for (let attempt = 0; attempt < 5; attempt++) {
    const params: any[] = [candidate];
    let sql =
      "SELECT 1 FROM tm_library WHERE origin = 'upload' AND filename = $1";
    if (opts.excludeEntryId != null && Number.isFinite(opts.excludeEntryId)) {
      sql += " AND id <> $2";
      params.push(opts.excludeEntryId);
    }
    sql += " LIMIT 1";
    const existsRes = await db.query(sql, params);
    if ((existsRes.rowCount ?? 0) === 0) return candidate;
    candidate = `${base}-${randomUUID().slice(0, 8)}${ext}`;
  }
  return `${base}-${randomUUID()}${ext}`;
}

async function createProxyTm(params: {
  tmName: string;
  token: string;
  traceId?: string;
}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${params.token}`
  };
  if (params.traceId) headers["x-request-id"] = params.traceId;

  const res = await fetch(`${CONFIG.TM_PROXY_URL}/api/tms`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: params.tmName })
  });
  if (!res.ok) {
    let message = `tm-proxy create TM failed (${res.status})`;
    try {
      const payload = (await res.json()) as any;
      if (payload?.error) message = String(payload.error);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const data = (await res.json()) as any;
  if (!data?.tm) {
    throw new Error("tm-proxy create TM did not return TM");
  }
  return data.tm as { id: number; name: string };
}

async function importTmxIntoProxy(params: {
  tmProxyId: number;
  token: string;
  traceId?: string;
  filename: string;
  buf: Buffer;
}) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.token}`
  };
  if (params.traceId) headers["x-request-id"] = params.traceId;

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(params.buf)], { type: "application/xml" }),
    params.filename
  );

  const res = await fetch(`${CONFIG.TM_PROXY_URL}/api/tm/${params.tmProxyId}/import`, {
    method: "POST",
    headers,
    body: form as any
  });
  if (!res.ok) {
    let message = `tm-proxy import failed (${res.status})`;
    try {
      const payload = (await res.json()) as any;
      if (payload?.error) message = String(payload.error);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as any;
}

async function deleteProxyTm(params: {
  tmProxyId: number;
  token: string;
  traceId?: string;
}) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.token}`
  };
  if (params.traceId) headers["x-request-id"] = params.traceId;

  await fetch(`${CONFIG.TM_PROXY_URL}/api/tms/${params.tmProxyId}`, {
    method: "DELETE",
    headers
  });
}

export async function listTmSamples() {
  const rowsRes = await db.query<{
    filename: string;
    label: string;
    tm_proxy_id: number | null;
    disabled?: boolean;
  }>(
    "SELECT filename, label, tm_proxy_id, disabled FROM tm_library WHERE origin = 'upload' AND disabled = FALSE ORDER BY created_at DESC"
  );
  const rows = rowsRes.rows;
  return rows.map((row) => {
    return {
      id: row.filename,
      filename: row.filename,
      label: row.label,
      tmId: row.tm_proxy_id ?? null,
      entryCount: 0,
      seeded: true
    };
  });
}
