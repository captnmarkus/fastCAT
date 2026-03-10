import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  APP_AGENT_TOOL_ALLOWLIST,
  type AppAgentConfigUpdateInput,
  evaluateAppAgentAvailability,
  loadAppAgentConfig,
  normalizeUpdatedAppAgentConfig,
  updateAppAgentConfig
} from "../lib/app-agent-config.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import type { AgentService } from "../lib/agent-service.js";
import {
  getRequestUser,
  requireAdmin,
  requireAuth,
  requestUserId
} from "../middleware/auth.js";
import {
  addFileToAssigned,
  addProjectToAssigned,
  addProjectToCreated,
  touchProjectForUsers
} from "../lib/user-buckets.js";
import { copyObject, getObjectBuffer, getS3Bucket } from "../lib/s3.js";
import { keyProjectSourceOriginal } from "../lib/storage-keys.js";
import { insertFileArtifact } from "../lib/file-artifacts.js";
import { enqueueProvisionJobIfImportReady } from "../lib/provision-queue.js";
import { insertSegmentsForFile } from "./projects.segment-insert.js";
import { parseXliffSegments } from "../lib/xliff.js";
import { segmentHtmlWithTemplate } from "../lib/html-segmentation.js";
import { normalizeParsingTemplateConfig, normalizeXmlParsingTemplateConfig } from "../lib/parsing-templates.js";
import { extractXmlSegmentsWithTemplate } from "../lib/xml-extraction.js";
import officeParser from "officeparser";
import { parseOfficeRichSegments } from "../lib/office-rich.js";
import { segmentPlainText } from "../utils.js";
import {
  buildOfficeParserConfig,
  formatOfficeParseError,
  getFileTypeConfigParsingTemplateId,
  isTextLikeContentType,
  normalizeJsonObject as normalizeProjectJsonObject,
  resolveUploadFileType,
  sanitizeSegments,
  sanitizeTextForDb,
  withTimeout
} from "./projects.helpers.js";
import path from "path";
import type { PoolClient } from "pg";

import type { FastifyInstance } from "fastify";
import * as shared from "./app-agent.shared.js";

type InternalCreateProjectArgs = shared.InternalCreateProjectArgs;
type SourceFileRow = shared.SourceFileRow;
type FileProcessingStatus = shared.FileProcessingStatus;

export async function registerAppAgentCreateProjectRoute(app: FastifyInstance) {
  const {
    parsePositiveIntArray,
    parsePositiveInt,
    normalizeProjectAccessRole,
    isEligibleProjectAssigneeRole,
    canAssignProjectsByRole,
    resolveUserRef,
    parseDueAtIso,
    parseUserContext,
    requireInternalAgentSecret,
    normalizeTargetLanguages,
    resolveVerifiedToolUser,
    loadGlobalLanguageSettings,
    insertFileProcessingLog,
    buildDefaultProjectName,
    provisionAgentProjectShell,
    loadSourceArtifact,
    loadSeedSegmentsFromSourceFile,
    parseSegmentsFromSourceArtifact
  } = shared;

  app.post("/chat/internal/tools/create-project", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const verifiedUserContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!verifiedUserContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const userContext = verifiedUserContext;

    const args = (body.args as InternalCreateProjectArgs) || {};
    const fileIds = parsePositiveIntArray(args.file_ids ?? args.fileIds);
    if (fileIds.length === 0) {
      return reply.code(400).send({ error: "create_project requires at least one file_id." });
    }

    const ownerRef =
      args.owner_user_id ??
      args.ownerUserId ??
      args.assigned_user_id ??
      args.assignedUserId ??
      null;
    const requesterCanAssign = canAssignProjectsByRole(userContext.role);

    let assignedUser = {
      userId: userContext.userId,
      username: userContext.username,
      role: userContext.role,
      departmentId: userContext.departmentId
    };
    if (ownerRef != null && String(ownerRef).trim()) {
      const resolvedOwner = await resolveUserRef(ownerRef);
      if (!resolvedOwner) {
        return reply.code(400).send({ error: "Assigned user was not found." });
      }
      if (resolvedOwner.disabled) {
        return reply.code(400).send({ error: "Assigned user is disabled." });
      }
      const isSelf =
        String(resolvedOwner.username).trim().toLowerCase() ===
        String(userContext.username).trim().toLowerCase();
      const allowAdminSelf =
        isSelf &&
        normalizeProjectAccessRole(resolvedOwner.role) === "admin" &&
        normalizeProjectAccessRole(userContext.role) === "admin";
      if (!isEligibleProjectAssigneeRole(resolvedOwner.role, { allowAdminSelf })) {
        return reply.code(400).send({
          error: "Assigned user must be an eligible reviewer or manager. Admin assignment is only allowed to yourself."
        });
      }
      if (!requesterCanAssign && !isSelf) {
        return reply.code(403).send({
          error:
            "Only managers/admins can assign projects to other users. I'll create it for you, or ask a manager/admin to create/assign it."
        });
      }
      if (requesterCanAssign && normalizeProjectAccessRole(userContext.role) === "manager" && !isSelf) {
        if (
          userContext.departmentId == null ||
          resolvedOwner.departmentId == null ||
          Number(resolvedOwner.departmentId) !== Number(userContext.departmentId)
        ) {
          return reply.code(403).send({
            error: "Managers can assign projects only within their own department."
          });
        }
      }
      assignedUser = {
        userId: resolvedOwner.userId,
        username: resolvedOwner.username,
        role: resolvedOwner.role,
        departmentId: resolvedOwner.departmentId
      };
    }

    const globalLanguages = await loadGlobalLanguageSettings();
    const allowedLanguageSet = new Set(globalLanguages.enabledLanguages);

    const sourceLanguage =
      normalizeLanguageTag(String(args.source_lang ?? args.sourceLang ?? "")) ||
      globalLanguages.defaultSource;

    let targetLanguages = normalizeTargetLanguages(args.target_langs ?? args.targetLangs, sourceLanguage);
    if (targetLanguages.length === 0) {
      targetLanguages = globalLanguages.defaultTargets.filter((entry) => entry !== sourceLanguage);
    }
    if (targetLanguages.length === 0) {
      targetLanguages = globalLanguages.enabledLanguages.filter((entry) => entry !== sourceLanguage).slice(0, 1);
    }
    if (targetLanguages.length === 0) {
      return reply.code(400).send({ error: "At least one target language is required." });
    }

    if (allowedLanguageSet.size > 0) {
      if (!allowedLanguageSet.has(sourceLanguage)) {
        return reply.code(400).send({
          error: `Source language "${sourceLanguage}" is not enabled in global Language Settings.`
        });
      }
      const invalidTargets = targetLanguages.filter((entry) => !allowedLanguageSet.has(entry));
      if (invalidTargets.length > 0) {
        return reply.code(400).send({
          error: `Target language(s) not enabled in global Language Settings: ${invalidTargets.join(", ")}`
        });
      }
    }
    if (!globalLanguages.allowSingleLanguage && targetLanguages.every((entry) => entry === sourceLanguage)) {
      return reply.code(400).send({ error: "Target language must be different from source language." });
    }

    const dueAtIso = parseDueAtIso(args.due_at ?? args.dueAt);
    if (dueAtIso === "__invalid__") {
      return reply.code(400).send({ error: "Invalid due date/time." });
    }

    const engineRes = await db.query<{ id: number; name: string; config: any }>(
      `SELECT id, name, config
       FROM translation_engines
       WHERE disabled = FALSE
       ORDER BY
         CASE
           WHEN LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
             OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
           THEN 0
           ELSE 1
         END,
         updated_at DESC,
         id DESC`
    );
    const engineIds = new Set<number>(engineRes.rows.map((row) => Number(row.id)));
    const requestedEngineId = parsePositiveInt(
      args.translation_engine_id ?? args.translationEngineId
    );
    const selectedEngineId = requestedEngineId;
    if (selectedEngineId != null && !engineIds.has(selectedEngineId)) {
      return reply.code(400).send({ error: "Selected translation engine is not available." });
    }

    const rulesetRes = await db.query<{ id: number; name: string }>(
      `SELECT id, name
       FROM language_processing_rulesets
       WHERE disabled = FALSE
       ORDER BY updated_at DESC, id DESC`
    );
    const rulesetIds = new Set<number>(rulesetRes.rows.map((row) => Number(row.id)));
    const selectedRulesetId = parsePositiveInt(args.ruleset_id ?? args.rulesetId);
    if (selectedRulesetId != null && !rulesetIds.has(selectedRulesetId)) {
      return reply.code(400).send({ error: "Selected ruleset is not available." });
    }

    const tmxRes = await db.query<{ id: number; label: string }>(
      `SELECT id, label
       FROM tm_library
       WHERE disabled = FALSE
         AND origin = 'upload'
       ORDER BY updated_at DESC, id DESC`
    );
    const tmxIds = new Set<number>(tmxRes.rows.map((row) => Number(row.id)));
    const selectedTmxId = parsePositiveInt(args.tmx_id ?? args.tmxId);
    if (selectedTmxId != null && !tmxIds.has(selectedTmxId)) {
      return reply.code(400).send({ error: "Selected TMX is not available." });
    }

    const termbaseRes = await db.query<{ id: number; label: string }>(
      normalizeProjectAccessRole(userContext.role) === "admin"
        ? `SELECT id, label
           FROM glossaries
           WHERE disabled = FALSE
           ORDER BY updated_at DESC, id DESC`
        : `SELECT id, label
           FROM glossaries
           WHERE disabled = FALSE
             AND COALESCE(LOWER(visibility), 'managers') NOT IN ('admins', 'private')
           ORDER BY updated_at DESC, id DESC`
    );
    const termbaseIds = new Set<number>(termbaseRes.rows.map((row) => Number(row.id)));
    const selectedTermbaseId = parsePositiveInt(
      args.termbase_id ??
        args.termbaseId ??
        args.glossary_id ??
        args.glossaryId
    );
    if (selectedTermbaseId != null && !termbaseIds.has(selectedTermbaseId)) {
      return reply.code(400).send({ error: "Selected termbase is not available." });
    }

    const sourceFileRes = await db.query<SourceFileRow>(
      `SELECT
         pf.id,
         pf.original_name,
         pf.stored_path,
         pf.file_type,
         pf.file_type_config_id,
         pf.status::text AS status,
         p.id AS project_id,
         p.department_id,
         p.assigned_user,
         p.created_by
       FROM project_files pf
       JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = ANY($1::int[])`,
      [fileIds]
    );

    const sourceById = new Map<number, SourceFileRow>();
    sourceFileRes.rows.forEach((row) => {
      sourceById.set(Number(row.id), row);
    });
    if (sourceById.size !== fileIds.length) {
      return reply.code(400).send({ error: "One or more file_ids could not be found." });
    }

    let departmentId = userContext.departmentId;
    if (!departmentId) {
      const firstFile = sourceById.get(fileIds[0]!);
      const candidate = Number(firstFile?.department_id ?? 0);
      departmentId = Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : null;
    }
    if (!departmentId) {
      return reply.code(403).send({ error: "Department assignment is required to create projects." });
    }

    const assignedIsAdminSelf =
      assignedUser.userId === userContext.userId &&
      normalizeProjectAccessRole(assignedUser.role) === "admin" &&
      normalizeProjectAccessRole(userContext.role) === "admin";
    if (!assignedIsAdminSelf) {
      if (assignedUser.departmentId == null || Number(assignedUser.departmentId) !== Number(departmentId)) {
        return reply.code(403).send({ error: "Assigned user must belong to the project department." });
      }
    }

    for (const fileId of fileIds) {
      const row = sourceById.get(fileId);
      if (!row) continue;
      const owner = String(row.assigned_user ?? row.created_by ?? "").trim();
      if (!owner || owner !== userContext.username) {
        return reply.code(403).send({ error: `Access denied for file_id ${fileId}.` });
      }
      if (row.department_id != null && Number(row.department_id) !== Number(departmentId)) {
        return reply.code(403).send({ error: `Access denied for file_id ${fileId}.` });
      }
    }

    const firstSourceFile = sourceById.get(fileIds[0]!)!;
    const projectName = String(args.name || "").trim() || buildDefaultProjectName(firstSourceFile.original_name);

    const provisionFiles = fileIds.map((sourceFileId, index) => {
      const source = sourceById.get(sourceFileId)!;
      return {
        sourceFileId,
        tempKey: `agent-source-${sourceFileId}-${index + 1}`,
        filename: String(source.original_name || "").trim() || `file-${sourceFileId}`,
        fileTypeConfigId: source.file_type_config_id ?? null
      };
    });

    let provisionedShell: Awaited<ReturnType<typeof provisionAgentProjectShell>>;
    try {
      provisionedShell = await provisionAgentProjectShell({
        app,
        traceId: typeof req.id === "string" ? req.id : undefined,
        userContext,
        name: projectName,
        departmentId,
        sourceLanguage,
        targetLanguages,
        dueAtIso: dueAtIso && dueAtIso !== "__invalid__" ? dueAtIso : null,
        projectOwnerUsername: userContext.username,
        translationEngineId: selectedEngineId ?? null,
        rulesetId: selectedRulesetId ?? null,
        tmxId: selectedTmxId ?? null,
        termbaseId: selectedTermbaseId ?? null,
        assignedUsername: assignedUser.username,
        files: provisionFiles
      });
    } catch (err: any) {
      const statusCode = Number(err?.statusCode ?? 500);
      return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
        error: String(err?.message || "Failed to provision project shell.")
      });
    }

    const provisionedProject = await withTransaction(async (client) => {
      const createdFileIds: number[] = [];
      const fileStatuses: Array<{
        sourceFileId: number;
        fileId: number;
        filename: string;
        status: FileProcessingStatus;
        segmentCount: number;
        error: string | null;
      }> = [];
      const sourceFileMap: Record<string, number> = {};

      for (const filePlan of provisionFiles) {
        const source = sourceById.get(filePlan.sourceFileId);
        const newFileId = Number(provisionedShell.fileIdByTempKey.get(filePlan.tempKey) ?? 0);
        if (!source || !Number.isFinite(newFileId) || newFileId <= 0) {
          throw new Error(`Provisioned file is missing for source file ${filePlan.sourceFileId}.`);
        }
        createdFileIds.push(newFileId);
        sourceFileMap[String(newFileId)] = filePlan.sourceFileId;
        await insertFileProcessingLog(client, {
          projectId: provisionedShell.projectId,
          fileId: newFileId,
          stage: "IMPORT",
          status: "QUEUED",
          message: "Queued for agent import.",
          details: { sourceFileId: filePlan.sourceFileId }
        });

        try {
          const sourceArtifact = await loadSourceArtifact(client, filePlan.sourceFileId);
          const sourceObjectKey = String(sourceArtifact?.object_key || "").trim();
          if (!sourceArtifact || !sourceObjectKey) {
            throw new Error(`Source artifact is missing for file_id ${filePlan.sourceFileId}.`);
          }

          await client.query(
            `UPDATE project_files
             SET status = 'processing'
             WHERE id = $1`,
            [newFileId]
          );
          await insertFileProcessingLog(client, {
            projectId: provisionedShell.projectId,
            fileId: newFileId,
            stage: "IMPORT",
            status: "PROCESSING",
            message: "Importing and segmenting source file.",
            details: { sourceFileId: filePlan.sourceFileId }
          });

          const copiedObjectKey = keyProjectSourceOriginal({
            departmentId,
            projectId: provisionedShell.projectId,
            fileId: newFileId,
            originalFilename: source.original_name
          });
          const copyResult = await copyObject({
            sourceKey: sourceObjectKey,
            destinationKey: copiedObjectKey
          });

          await client.query(
            `UPDATE project_files
             SET stored_path = $1,
                 file_type = $2,
                 file_type_config_id = $3
             WHERE id = $4`,
            [copiedObjectKey, source.file_type, source.file_type_config_id, newFileId]
          );

          await insertFileArtifact(client, {
            projectId: provisionedShell.projectId,
            fileId: newFileId,
            kind: "source_original",
            bucket: String(sourceArtifact.bucket || getS3Bucket()),
            objectKey: copiedObjectKey,
            sha256: sourceArtifact.sha256 ?? null,
            etag: copyResult.etag ?? sourceArtifact.etag ?? null,
            sizeBytes: sourceArtifact.size_bytes ?? null,
            contentType: sourceArtifact.content_type ?? null,
            meta: sourceArtifact.meta_json ?? {},
            createdBy: userContext.username
          });

          let segments = await loadSeedSegmentsFromSourceFile(client, filePlan.sourceFileId);
          if (segments.length === 0) {
            await insertFileProcessingLog(client, {
              projectId: provisionedShell.projectId,
              fileId: newFileId,
              stage: "PARSE",
              status: "PROCESSING",
              message: "No existing segments found. Parsing source artifact."
            });
            try {
              segments = await parseSegmentsFromSourceArtifact({
                client,
                sourceFile: source,
                sourceArtifact
              });
            } catch (err: any) {
              const officeReason = formatOfficeParseError(err);
              throw new Error(officeReason || String(err?.message || "Failed to parse source artifact."));
            }
          }

          if (segments.length === 0) {
            throw new Error("No segments extracted from source file.");
          }

          await insertSegmentsForFile(client, provisionedShell.projectId, newFileId, segments);
          await client.query(
            `UPDATE project_files
             SET status = 'ready'
             WHERE id = $1`,
            [newFileId]
          );
          await insertFileProcessingLog(client, {
            projectId: provisionedShell.projectId,
            fileId: newFileId,
            stage: "SEGMENT",
            status: "READY",
            message: `Segments prepared (${segments.length}).`,
            details: { segmentCount: segments.length }
          });
          fileStatuses.push({
            sourceFileId: filePlan.sourceFileId,
            fileId: newFileId,
            filename: String(source.original_name || ""),
            status: "READY",
            segmentCount: segments.length,
            error: null
          });
        } catch (err: any) {
          const message = String(err?.message || "Import failed");
          await client.query(
            `UPDATE project_files
             SET status = 'failed'
             WHERE id = $1`,
            [newFileId]
          );
          await insertFileProcessingLog(client, {
            projectId: provisionedShell.projectId,
            fileId: newFileId,
            stage: "IMPORT",
            status: "FAILED",
            message,
            details: { sourceFileId: filePlan.sourceFileId }
          });
          fileStatuses.push({
            sourceFileId: filePlan.sourceFileId,
            fileId: newFileId,
            filename: String(source.original_name || ""),
            status: "FAILED",
            segmentCount: 0,
            error: message
          });
        }
      }

      await client.query(
        `UPDATE projects
         SET project_settings = COALESCE(project_settings, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          provisionedShell.projectId,
          JSON.stringify({
            createdByAgent: true,
            sourceFileIds: fileIds,
            appAgentSourceFileMap: sourceFileMap,
            ownerUserId: userContext.userId,
            owner_user_id: userContext.userId,
            assignedUserId: assignedUser.userId,
            assigned_user_id: assignedUser.userId
          })
        ]
      );

      const failed = fileStatuses.filter((entry) => entry.status === "FAILED");
      const ready = fileStatuses.filter((entry) => entry.status === "READY");
      if (failed.length > 0 || ready.length === 0) {
        const initError =
          failed.length > 0
            ? failed.map((entry) => `${entry.filename}: ${entry.error || "failed"}`).join(" | ").slice(0, 1200)
            : "No segments extracted from uploaded files.";
        await client.query(
          `UPDATE projects
           SET status = 'failed',
               init_error = $2,
               provisioning_updated_at = NOW(),
               provisioning_finished_at = NOW(),
               provisioning_progress = $3,
               provisioning_current_step = 'IMPORT_FILES'
           WHERE id = $1`,
          [
            provisionedShell.projectId,
            initError,
            Math.max(0, Math.min(99, Math.round((ready.length / Math.max(1, fileStatuses.length)) * 100)))
          ]
        );
      } else {
        await client.query(
          `UPDATE projects
           SET init_error = NULL,
               provisioning_updated_at = NOW(),
               provisioning_current_step = 'IMPORT_FILES'
           WHERE id = $1`,
          [provisionedShell.projectId]
        );
      }

      const statusRes = await client.query<{ status: string; init_error: string | null }>(
        `SELECT status::text AS status, init_error
         FROM projects
         WHERE id = $1
         LIMIT 1`,
        [provisionedShell.projectId]
      );

      return {
        projectId: provisionedShell.projectId,
        name: projectName,
        status: String(statusRes.rows[0]?.status || provisionedShell.status || "provisioning"),
        assignedUserId: assignedUser.userId,
        assignedUsername: assignedUser.username,
        translationEngineId: selectedEngineId ?? null,
        rulesetId: selectedRulesetId ?? null,
        tmxId: selectedTmxId ?? null,
        termbaseId: selectedTermbaseId ?? null,
        dueAt: dueAtIso && dueAtIso !== "__invalid__" ? dueAtIso : null,
        fileIds: createdFileIds,
        fileStatuses,
        initError: statusRes.rows[0]?.init_error ? String(statusRes.rows[0]?.init_error) : null
      };
    });

    if (provisionedProject.status !== "failed") {
      try {
        await enqueueProvisionJobIfImportReady({
          projectId: provisionedProject.projectId,
          step: "import",
          log: (req as any).log
        });
      } catch (err) {
        (req as any).log?.warn?.({ err, projectId: provisionedProject.projectId }, "Failed to queue provision job after agent import");
      }
    }

    const projectStatusRes = await db.query<{ status: string; init_error: string | null }>(
      `SELECT status::text AS status, init_error
       FROM projects
       WHERE id = $1
       LIMIT 1`,
      [provisionedProject.projectId]
    );
    const finalStatus = String(projectStatusRes.rows[0]?.status || provisionedProject.status || "provisioning");
    const finalInitError = projectStatusRes.rows[0]?.init_error
      ? String(projectStatusRes.rows[0]?.init_error)
      : provisionedProject.initError;

    return {
      ok: true,
      project: {
        id: provisionedProject.projectId,
        name: provisionedProject.name,
        status: finalStatus,
        sourceLang: sourceLanguage,
        targetLangs: targetLanguages,
        ownerUserId: userContext.userId,
        assignedUserId: provisionedProject.assignedUserId,
        assignedUsername: provisionedProject.assignedUsername,
        translationEngineId: provisionedProject.translationEngineId,
        rulesetId: provisionedProject.rulesetId,
        tmxId: provisionedProject.tmxId,
        termbaseId: provisionedProject.termbaseId,
        dueAt: provisionedProject.dueAt,
        initError: finalInitError
      },
      nextAction: finalStatus === "ready" ? "OPEN_EDITOR" : "SHOW_PROCESSING",
      statusUrl: provisionedShell.statusUrl,
      fileProcessing: provisionedProject.fileStatuses.map((entry) => ({
        sourceFileId: entry.sourceFileId,
        fileId: entry.fileId,
        filename: entry.filename,
        status: entry.status,
        segmentCount: entry.segmentCount,
        error: entry.error
      })),
      fileIds: provisionedProject.fileIds
    };

  });
}
