import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  requireAuth,
  getRequestUser,
  requestUserId,
  requestUserDepartmentId,
  ensureProjectAccess,
  ensureProjectReady,
  isAdminUser,
  isManagerUser,
  canAssignProjects,
  requireManagerOrAdmin
} from "../middleware/auth.js";
import type { JwtPayload } from "../middleware/auth.js";
import { parseXliffSegments } from "../lib/xliff.js";
import { fillHtmlTemplate } from "../lib/html.js";
import { segmentHtmlWithTemplate } from "../lib/html-segmentation.js";
import { normalizeParsingTemplateConfig, normalizeXmlParsingTemplateConfig } from "../lib/parsing-templates.js";
import { extractXmlSegmentsWithTemplate } from "../lib/xml-extraction.js";
import { segmentPlainText, toText } from "../utils.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import AdmZip from "adm-zip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  normalizeEngineDefaultsByTarget,
  normalizeEngineOverrides
} from "../lib/translation-engine-settings.js";
import { enqueuePretranslateJobs } from "../lib/pretranslate-queue.js";
import { retryProvisionJob } from "../lib/provision-worker.js";
import officeParser from "officeparser";
import { load as loadHtml } from "cheerio";
import path from "path";
import { getRedisClient } from "../redis.js";
import {
  deleteObject,
  getS3Bucket,
  getObjectBuffer,
  presignGetObject,
  presignPutObject,
  putObjectBuffer,
  sha256Hex
} from "../lib/s3.js";
import {
  keyProjectDerivedSegmentsXliff,
  keyProjectDerivedSegmentsXliffRun,
  keyProjectSourceOriginal,
  keyProjectTargetOutput,
  keyProjectTargetOutputRun
} from "../lib/storage-keys.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import {
  addFileToAssigned,
  addProjectToAssigned,
  addProjectToCreated,
  ensureUserBucketsInitialized,
  removeProjectFromAssigned,
  touchProjectForUsers,
  userFilesAssignedKey,
  userProjectsAssignedKey,
  userProjectsCreatedKey
} from "../lib/user-buckets.js";

import {
  aggregateCustomFields,
  aggregateEntryAudit,
  aggregateTermAudit,
  auditFromRow,
  buildDocxBuffer,
  buildOfficeParserConfig,
  buildPptxBuffer,
  buildTargetFilename,
  buildXlsxBuffer,
  buildXmlOutput,
  coerceSourceType,
  conceptKeyForRow,
  contentTypeForExtension,
  DOCX_CONTENT_TYPES_XML,
  DOCX_RELS_XML,
  encodeTermKey,
  escapeXml,
  formatOfficeParseError,
  getFileTypeConfigParsingTemplateId,
  getProjectRow,
  hasAudit,
  hasElementChildren,
  INLINE_TOKEN_RE,
  isRequestError,
  isTextLikeContentType,
  isUploadError,
  listProjectFiles,
  listProjectHtmlFiles,
  makeRequestError,
  makeUploadError,
  mergeAudit,
  mergeAuditAggregate,
  mergeFieldMap,
  normalizeAuditMeta,
  normalizeAuditValue,
  normalizeFieldMap,
  normalizeJsonObject,
  normalizeLang,
  normalizeLangList,
  normalizeLanguageFields,
  normalizeTermAuditMap,
  normalizeTermbaseLang,
  normalizeTermbaseMeta,
  normalizeTermFields,
  OFFICE_UPLOAD_TYPES,
  parseNodePath,
  parseOptionalBool,
  parseOptionalInt,
  parseSourceType,
  projectDepartmentId,
  ProjectFileListRow,
  ProjectRow,
  ProjectTaskRow,
  requesterMatchesUser,
  RequestError,
  resolveOutputExtension,
  resolveSegmentText,
  resolveUploadFileType,
  resolveUserDepartmentId,
  resolveUserRef,
  resolveUserRole,
  rowToProject,
  rowToSegment,
  safeDispositionFilename,
  sanitizeSegments,
  sanitizeTextForDb,
  SegmentRow,
  selectElementByPath,
  statusFromMeta,
  TermbaseAudit,
  TermbaseEntryRow,
  TermbaseFieldMap,
  TermbaseLanguageFields,
  TermbaseMatchEntry,
  TermbaseMatchSection,
  TermbaseMatchTerm,
  TermbaseTermAudit,
  TermbaseTermFields,
  toBase64Url,
  toIsoOrNull,
  truncateErrorMessage,
  uniqueTerms,
  UploadError,
  UploadType,
  withTimeout
} from './projects.helpers.js';
import {
  buildTranslationTasks,
  collectEngineIdsToValidate,
  GLOSSARY_SELECTION_KEYS,
  hasNumericOverrideValues,
  hasSelectionInPlan,
  mapEngineOverridesToFileIds,
  normalizeTemplateOverrideMap,
  normalizeTranslationPlan,
  parseOptionalNumericOverride,
  RULESET_SELECTION_KEYS
} from "./projects.routes.part2.helpers.js";


export async function registerProjectRoutesPart2(app: FastifyInstance) {
  // --- CREATE Project ---
  const handleCreateProject = async (req: any, reply: any) => {
    const user = getRequestUser(req);
    const creatorId = requestUserId(user);
    if (!creatorId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const requesterIsAdmin = isAdminUser(user);
    const requesterIsManager = isManagerUser(user);
    const requesterRole = String(user?.role || "").toLowerCase();
    const requesterIsReviewer = !requesterIsAdmin && !requesterIsManager && requesterRole === "reviewer";
    if (!requesterIsAdmin && !requesterIsManager && !requesterIsReviewer) {
      return reply.code(403).send({ error: "Reviewer, manager, or admin privileges required to create projects" });
    }
    const requesterDepartmentId = await requestUserDepartmentId(user);
    const body = (req.body as any) || {};
    const translationPlanRaw = Array.isArray(body.translationPlan) ? body.translationPlan : [];
    const name = String(body.name || "").trim();
    const descriptionRaw = body.description ?? body.projectDescription ?? null;
    const description = descriptionRaw != null ? String(descriptionRaw).trim() : "";
    const srcLang = normalizeLang(body.srcLang ?? body.sourceLang ?? body.source_lang);
    let projectTargetLangs = normalizeLangList(
      body.projectTargetLangs ?? body.project_target_langs ?? body.targetLangs ?? body.targets
    );
    if (projectTargetLangs.length === 0 && body.tgtLang != null) {
      projectTargetLangs = normalizeLangList([body.tgtLang]);
    }
    projectTargetLangs = projectTargetLangs.filter((lang) => lang && lang !== srcLang);
    let tgtLang = normalizeLang(body.tgtLang ?? body.targetLang ?? body.target_lang);
    if (!tgtLang || !projectTargetLangs.includes(tgtLang)) {
      tgtLang = projectTargetLangs[0] || "";
    }
    if (!name || !srcLang || projectTargetLangs.length === 0 || !tgtLang) {
      return reply.code(400).send({ error: "name, srcLang, targetLangs are required" });
    }
    const headerIdempotencyKey = req?.headers?.["x-idempotency-key"];
    const idempotencyKeyRaw =
      body.idempotencyKey ??
      body.idempotency_key ??
      (Array.isArray(headerIdempotencyKey) ? headerIdempotencyKey[0] : headerIdempotencyKey) ??
      null;
    const idempotencyKey = String(idempotencyKeyRaw ?? "").trim().slice(0, 128);

    if (idempotencyKey) {
      const existingRes = await db.query<{ id: number }>(
        `SELECT id
         FROM projects
         WHERE created_by = $1
           AND project_settings->>'createIdempotencyKey' = $2
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [creatorId, idempotencyKey]
      );
      const existingProjectId = Number(existingRes.rows[0]?.id ?? 0);
      if (Number.isFinite(existingProjectId) && existingProjectId > 0) {
        const existing = await getProjectRow(existingProjectId);
        if (existing) {
          const filesRes = await db.query<{ id: number; client_temp_key: string | null }>(
            `SELECT id, client_temp_key
             FROM project_files
             WHERE project_id = $1
             ORDER BY id ASC`,
            [existingProjectId]
          );
          const files = filesRes.rows
            .map((row) => ({
              tempKey: String(row.client_temp_key || "").trim(),
              fileId: Number(row.id)
            }))
            .filter((entry) => entry.tempKey && Number.isFinite(entry.fileId) && entry.fileId > 0);
          const statusUrl = `/api/cat/projects/${existingProjectId}/provisioning`;
          if ((req as any).provisionOnly) {
            return {
              projectId: existingProjectId,
              status: existing.status,
              statusUrl,
              files
            };
          }
          return {
            project: await rowToProject(existing),
            files,
            statusUrl
          };
        }
      }
    }

    const requestedDepartmentId = parseOptionalInt(body.departmentId ?? body.department_id);
    let departmentId = requestedDepartmentId ?? requesterDepartmentId ?? 1;
    if (!isAdminUser(user)) {
      if (!requesterDepartmentId) {
        return reply.code(403).send({ error: "Department assignment required" });
      }
      if (requestedDepartmentId && requestedDepartmentId !== requesterDepartmentId) {
        return reply.code(403).send({ error: "You can only create projects for your department" });
      }
      departmentId = requesterDepartmentId;
    }
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      return reply.code(400).send({ error: "departmentId must be a positive number" });
    }
    const deptRes = await db.query<{ id: number; disabled: boolean }>(
      `SELECT id, disabled FROM departments WHERE id = $1`,
      [departmentId]
    );
    const deptRow = deptRes.rows[0];
    if (!deptRow) {
      return reply.code(400).send({ error: "Selected department not found" });
    }
    if (deptRow.disabled) {
      return reply.code(400).send({ error: "Selected department is disabled" });
    }

    const projectTemplateIdRaw = body.projectTemplateId ?? body.project_template_id ?? body.templateId ?? null;
    const projectTemplateId =
      projectTemplateIdRaw != null && String(projectTemplateIdRaw).trim() !== ""
        ? Number(projectTemplateIdRaw)
        : null;

    const template =
      projectTemplateId != null && Number.isFinite(projectTemplateId) && projectTemplateId > 0
        ? (
            await db.query<{
              id: number;
              src_lang: string;
              target_langs: any;
              translation_engine_id: number | null;
              file_type_config_id: number | null;
              default_tmx_id: number | null;
              default_ruleset_id: number | null;
              default_glossary_id: number | null;
              tmx_by_target_lang: any;
              ruleset_by_target_lang: any;
              glossary_by_target_lang: any;
              settings: any;
              disabled?: boolean | null;
            }>(
              `SELECT id,
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
                      disabled
               FROM project_templates
               WHERE id = $1`,
              [projectTemplateId]
            )
          ).rows[0] ?? null
        : null;

    if (projectTemplateId != null && !template) {
      return reply.code(400).send({ error: "Selected project template not found.", code: "PROJECT_TEMPLATE_INVALID" });
    }

    if (template) {
      if (template.disabled) {
        return reply.code(400).send({ error: "Selected project template is disabled.", code: "PROJECT_TEMPLATE_DISABLED" });
      }
      const templateSrc = String(template.src_lang || "").trim().toLowerCase();
      const templateTargets = Array.isArray(template.target_langs)
        ? template.target_langs.map((t: any) => String(t || "").trim().toLowerCase()).filter(Boolean)
        : [];

      if (templateSrc && templateSrc !== srcLang) {
        return reply.code(400).send({
          error: "Source language must match the selected project template.",
          code: "PROJECT_TEMPLATE_LANG_MISMATCH"
        });
      }
      if (templateTargets.length > 0) {
        const invalidTargets = projectTargetLangs.filter((lang) => !templateTargets.includes(lang));
        if (invalidTargets.length > 0) {
          return reply.code(400).send({
            error: "Target language is not allowed for the selected project template.",
            code: "PROJECT_TEMPLATE_LANG_MISMATCH"
          });
        }
      }
    }

    const baseSettings = normalizeJsonObject(template?.settings);

    let assignedUser: string | null = null;
    const ownerRef =
      body.projectOwnerId ??
      body.project_owner_id ??
      body.ownerUserId ??
      body.owner_user_id ??
      body.assignedUserId ??
      body.assigned_user_id ??
      null;
    if (ownerRef !== undefined && ownerRef !== null && String(ownerRef).trim()) {
      const requested = await resolveUserRef(ownerRef);
      if (!requested) {
        return reply.code(400).send({ error: "projectOwnerId cannot be empty" });
      }
      assignedUser = requested;
    } else {
      assignedUser = creatorId;
    }
    if (requesterIsReviewer) {
      if (assignedUser !== creatorId) {
        return reply.code(403).send({ error: "Reviewer projects must be owned by the reviewer" });
      }
      const ownerRole = await resolveUserRole(assignedUser);
      if (!ownerRole || ownerRole !== "reviewer") {
        return reply.code(400).send({ error: "Project owner must be a reviewer" });
      }
    } else {
      if (requesterIsManager && assignedUser !== creatorId) {
        return reply.code(403).send({ error: "Managers can only own their own projects" });
      }
      if (!assignedUser) {
        return reply.code(400).send({ error: "projectOwnerId is required" });
      }
      const ownerRole = await resolveUserRole(assignedUser);
      if (!ownerRole || (ownerRole !== "admin" && ownerRole !== "manager")) {
        return reply.code(400).send({ error: "Project owner must be an admin or manager" });
      }
      if (ownerRole === "admin" && assignedUser !== creatorId) {
        return reply.code(403).send({ error: "Admins can only assign themselves as project owner" });
      }
      if (ownerRole === "manager") {
        const assignedDepartmentId = await resolveUserDepartmentId(assignedUser);
        if (assignedDepartmentId == null || assignedDepartmentId !== departmentId) {
          return reply.code(403).send({ error: "Project owner must belong to the project department" });
        }
      }
    }
    const tmSample = body.tmSample ? String(body.tmSample).trim() : null;
    const tmSampleTmId =
      body.tmSampleTmId !== undefined && body.tmSampleTmId !== null
        ? Number(body.tmSampleTmId)
        : null;

    const translationEngineDefaultIdRaw =
      body.translationEngineDefaultId ??
      body.translation_engine_default_id ??
      body.translationEngineId ??
      body.translation_engine_id ??
      null;
    const translationEngineDefaultId =
      translationEngineDefaultIdRaw !== undefined ? parseOptionalInt(translationEngineDefaultIdRaw) : null;
    const effectiveTranslationEngineId =
      translationEngineDefaultId != null ? translationEngineDefaultId : template?.translation_engine_id ?? null;

    const engineDefaultsRaw =
      body.translationEngineDefaultsByTarget ??
      body.translation_engine_defaults_by_target ??
      body.translationEngineByTargetLang ??
      body.translation_engine_by_target_lang ??
      null;
    const engineOverridesRaw =
      body.translationEngineOverrides ??
      body.translation_engine_overrides ??
      null;

    const mtSeedingEnabledRaw =
      body.mtSeedingEnabled ??
      body.mt_seeding_enabled ??
      body.translationEngineSeedingEnabled ??
      body.translation_engine_seeding_enabled ??
      null;
    const mtRunAfterCreateRaw =
      body.mtRunAfterCreate ??
      body.mt_run_after_create ??
      body.translationEngineRunAfterCreate ??
      body.translation_engine_run_after_create ??
      null;
    const mtSeedingEnabled = parseOptionalBool(mtSeedingEnabledRaw);
    const mtRunAfterCreate = parseOptionalBool(mtRunAfterCreateRaw);

    const engineDefaultsByTarget = normalizeEngineDefaultsByTarget(
      engineDefaultsRaw,
      new Set(projectTargetLangs)
    );
    const engineOverridesRawMap = normalizeEngineOverrides(
      engineOverridesRaw,
      new Set(projectTargetLangs)
    );

    const rulesetIdRaw =
      body.rulesetId ?? body.languageProcessingRulesetId ?? body.language_processing_ruleset_id ?? null;
    const rulesetId =
      rulesetIdRaw !== undefined ? parseOptionalInt(rulesetIdRaw) : null;
    const templateDefaultTmxId = template?.default_tmx_id != null ? parseOptionalInt(template.default_tmx_id) : null;
    const templateDefaultRulesetId = template?.default_ruleset_id != null ? parseOptionalInt(template.default_ruleset_id) : null;
    const templateDefaultGlossaryId = template?.default_glossary_id != null ? parseOptionalInt(template.default_glossary_id) : null;
    const settingsRulesetId = parseOptionalInt(
      baseSettings.languageProcessingRulesetId ??
        baseSettings.language_processing_ruleset_id ??
        baseSettings.rulesetId ??
        baseSettings.defaultRulesetId ??
        null
    );
    const settingsGlossaryId = parseOptionalInt(
      baseSettings.glossaryId ??
        baseSettings.glossary_id ??
        baseSettings.defaultGlossaryId ??
        baseSettings.default_glossary_id ??
        null
    );
    const rulesEnabledRaw = parseOptionalBool(
      body.rulesEnabled ?? body.rules_enabled ?? baseSettings.rulesEnabled ?? baseSettings.rules_enabled ?? null
    );
    const termbaseEnabledRaw = parseOptionalBool(
      body.termbaseEnabled ??
        body.termbase_enabled ??
        baseSettings.termbaseEnabled ??
        baseSettings.termbase_enabled ??
        null
    );
    const glossaryEnabledRaw = parseOptionalBool(
      body.glossaryEnabled ?? body.glossary_enabled ?? baseSettings.glossaryEnabled ?? baseSettings.glossary_enabled ?? null
    );

    const hasTemplateRulesetOverrides = hasNumericOverrideValues(
      template?.ruleset_by_target_lang,
      parseOptionalInt
    );
    const hasTemplateGlossaryOverrides = hasNumericOverrideValues(
      template?.glossary_by_target_lang,
      parseOptionalInt
    );

    const {
      value: projectGlossaryOverride,
      invalid: glossaryOverrideInvalid
    } = parseOptionalNumericOverride(body.glossaryId);

    const hasRulesSelection =
      rulesetId != null ||
      templateDefaultRulesetId != null ||
      settingsRulesetId != null ||
      hasTemplateRulesetOverrides ||
      hasSelectionInPlan(translationPlanRaw, RULESET_SELECTION_KEYS, normalizeJsonObject, parseOptionalInt);
    const hasGlossarySelection =
      projectGlossaryOverride != null ||
      glossaryOverrideInvalid ||
      templateDefaultGlossaryId != null ||
      settingsGlossaryId != null ||
      hasTemplateGlossaryOverrides ||
      hasSelectionInPlan(translationPlanRaw, GLOSSARY_SELECTION_KEYS, normalizeJsonObject, parseOptionalInt);

    const resolvedRulesEnabled = rulesEnabledRaw != null ? rulesEnabledRaw : hasRulesSelection;
    const resolvedTermbaseEnabled =
      termbaseEnabledRaw != null
        ? termbaseEnabledRaw
        : glossaryEnabledRaw != null
          ? glossaryEnabledRaw
          : hasGlossarySelection;
    const resolvedGlossaryEnabled =
      glossaryEnabledRaw != null
        ? glossaryEnabledRaw
        : termbaseEnabledRaw != null
          ? termbaseEnabledRaw
          : hasGlossarySelection;
    const terminologyEnabled = resolvedTermbaseEnabled && resolvedGlossaryEnabled;

    if (glossaryOverrideInvalid && terminologyEnabled) {
      return reply.code(400).send({ error: "glossaryId must be a number" });
    }

    const effectiveProjectRulesetId = resolvedRulesEnabled
      ? rulesetId ?? templateDefaultRulesetId ?? settingsRulesetId ?? null
      : null;
    const effectiveProjectGlossaryId = terminologyEnabled
      ? projectGlossaryOverride ?? templateDefaultGlossaryId ?? settingsGlossaryId ?? null
      : null;

    const engineIdsToValidate = collectEngineIdsToValidate(
      effectiveTranslationEngineId,
      engineDefaultsByTarget,
      engineOverridesRawMap
    );

    for (const engineId of engineIdsToValidate) {
      const res = await db.query<{ id: number; disabled: boolean }>(
        "SELECT id, disabled FROM translation_engines WHERE id = $1",
        [engineId]
      );
      const row = res.rows[0];
      if (!row) return reply.code(400).send({ error: "Selected translation engine not found." });
      if (row.disabled) return reply.code(400).send({ error: "Selected translation engine is disabled." });
    }

    if (resolvedRulesEnabled && effectiveProjectRulesetId != null) {
      const res = await db.query<{ id: number; disabled: boolean }>(
        "SELECT id, disabled FROM language_processing_rulesets WHERE id = $1",
        [effectiveProjectRulesetId]
      );
      const row = res.rows[0];
      if (!row) return reply.code(400).send({ error: "Selected ruleset not found." });
      if (row.disabled) return reply.code(400).send({ error: "Selected ruleset is disabled." });
    }

    if (terminologyEnabled && effectiveProjectGlossaryId != null) {
      const glossaryRes = await db.query<{ id: number; disabled: boolean }>(
        "SELECT id, disabled FROM glossaries WHERE id = $1",
        [effectiveProjectGlossaryId]
      );
      const glossary = glossaryRes.rows[0];
      if (!glossary) {
        return reply.code(400).send({ error: "Selected glossary not found" });
      }
      if (glossary.disabled) {
        return reply.code(400).send({ error: "Selected glossary is disabled" });
      }
    }

    try {
      const filesRaw = Array.isArray(body.files) ? body.files : [];
      if (filesRaw.length === 0) {
        throw makeRequestError(400, "At least one file is required to create a project.");
      }
      const fileTypeConfigCache = new Map<number, { id: number; disabled: boolean; config: any }>();
      const filePlans: Array<{
        filename: string;
        tempKey: string;
        uploadType: UploadType;
        fileTypeConfigId: number | null;
      }> = [];

      const getFileTypeConfig = async (id: number) => {
        if (fileTypeConfigCache.has(id)) return fileTypeConfigCache.get(id) ?? null;
        const cfgRes = await db.query<{ id: number; disabled: boolean; config: any }>(
          `SELECT id, disabled, config FROM file_type_configs WHERE id = $1 LIMIT 1`,
          [id]
        );
        const row = cfgRes.rows[0] ?? null;
        if (row) fileTypeConfigCache.set(id, row);
        return row;
      };

      for (const entry of filesRaw) {
        const filename = String(entry?.filename ?? entry?.name ?? entry?.originalName ?? "").trim();
        if (!filename) {
          throw makeRequestError(400, "files[].filename is required");
        }
        const tempKey = String(entry?.tempKey ?? entry?.temp_key ?? "").trim();
        if (!tempKey) {
          throw makeRequestError(400, "files[].tempKey is required");
        }
        const uploadType = resolveUploadFileType(filename);
        const requestedFileTypeConfigId = parseOptionalInt(entry?.fileTypeConfigId ?? entry?.file_type_config_id);
        let fileTypeConfigId: number | null = null;
        if (requestedFileTypeConfigId != null) {
          const row = await getFileTypeConfig(requestedFileTypeConfigId);
          if (!row) {
            throw makeRequestError(400, "Selected File Type Configuration not found.");
          }
          if (row.disabled) {
            throw makeRequestError(400, "Selected File Type Configuration is disabled.");
          }
          if (uploadType) {
            const cfgType = String(row.config?.fileType || "").trim().toLowerCase();
            if (cfgType && cfgType !== uploadType) {
              throw makeRequestError(400, "Selected File Type Configuration does not match this file type.");
            }
          }
          fileTypeConfigId = requestedFileTypeConfigId;
        }
        filePlans.push({
          filename,
          tempKey,
          uploadType,
          fileTypeConfigId
        });
      }
      if (filePlans.length === 0) {
        throw makeRequestError(400, "At least one file is required to create a project.");
      }

      const translationPlan = normalizeTranslationPlan(
        translationPlanRaw,
        parseOptionalInt,
        normalizeLangList,
        normalizeJsonObject
      );

      const templateTmxByTarget = normalizeTemplateOverrideMap(
        template?.tmx_by_target_lang,
        projectTargetLangs,
        normalizeLang,
        parseOptionalInt
      );
      const templateRulesetByTarget = normalizeTemplateOverrideMap(
        template?.ruleset_by_target_lang,
        projectTargetLangs,
        normalizeLang,
        parseOptionalInt
      );
      const templateGlossaryByTarget = normalizeTemplateOverrideMap(
        template?.glossary_by_target_lang,
        projectTargetLangs,
        normalizeLang,
        parseOptionalInt
      );

      const projectSettings = { ...baseSettings } as Record<string, any>;
      projectSettings.translationEngineDefaultId = effectiveTranslationEngineId ?? null;
      projectSettings.translation_engine_default_id = effectiveTranslationEngineId ?? null;
      projectSettings.translationEngineDefaultsByTarget = engineDefaultsByTarget;
      projectSettings.translation_engine_defaults_by_target = engineDefaultsByTarget;
      projectSettings.translationEngineOverrides = projectSettings.translationEngineOverrides ?? {};
      projectSettings.translation_engine_overrides = projectSettings.translation_engine_overrides ?? {};
      const hasEngineSelection =
        effectiveTranslationEngineId != null ||
        Object.keys(engineDefaultsByTarget).length > 0 ||
        Object.keys(engineOverridesRawMap).length > 0;
      const resolvedMtSeedingEnabled =
        mtSeedingEnabled != null ? mtSeedingEnabled : hasEngineSelection;
      projectSettings.mtSeedingEnabled = resolvedMtSeedingEnabled;
      projectSettings.mt_seeding_enabled = resolvedMtSeedingEnabled;
      projectSettings.translationEngineSeedingEnabled = resolvedMtSeedingEnabled;
      projectSettings.translation_engine_seeding_enabled = resolvedMtSeedingEnabled;
      if (mtRunAfterCreate != null) {
        projectSettings.mtRunAfterCreate = mtRunAfterCreate;
        projectSettings.mt_run_after_create = mtRunAfterCreate;
        projectSettings.translationEngineRunAfterCreate = mtRunAfterCreate;
        projectSettings.translation_engine_run_after_create = mtRunAfterCreate;
      }
      projectSettings.rulesEnabled = resolvedRulesEnabled;
      projectSettings.rules_enabled = resolvedRulesEnabled;
      projectSettings.termbaseEnabled = resolvedTermbaseEnabled;
      projectSettings.termbase_enabled = resolvedTermbaseEnabled;
      projectSettings.glossaryEnabled = resolvedGlossaryEnabled;
      projectSettings.glossary_enabled = resolvedGlossaryEnabled;
      projectSettings.languageProcessingRulesetId = effectiveProjectRulesetId;
      projectSettings.language_processing_ruleset_id = effectiveProjectRulesetId;
      projectSettings.rulesetId = effectiveProjectRulesetId;
      projectSettings.glossaryId = effectiveProjectGlossaryId;
      projectSettings.glossary_id = effectiveProjectGlossaryId;
      if (idempotencyKey) {
        projectSettings.createIdempotencyKey = idempotencyKey;
        projectSettings.create_idempotency_key = idempotencyKey;
      }
      const dueAtRaw = body.dueAt ?? body.dueDate ?? body.due_at ?? body.due_date ?? null;
      if (dueAtRaw != null && String(dueAtRaw).trim()) {
        const parsed = new Date(String(dueAtRaw));
        if (!Number.isNaN(parsed.valueOf())) {
          projectSettings.dueAt = parsed.toISOString();
        } else {
          return reply.code(400).send({ error: "Invalid due date" });
        }
      }

      const effectiveFileTypeConfigId = template?.file_type_config_id ?? null;

      const result = await withTransaction(async (client) => {
        const insertRes = await client.query<ProjectRow>(
          `INSERT INTO projects(
             name,
             description,
             src_lang,
             tgt_lang,
             target_langs,
             status,
             published_at,
             init_error,
             provisioning_started_at,
             provisioning_updated_at,
             provisioning_finished_at,
             provisioning_progress,
             provisioning_current_step,
             created_by,
             assigned_user,
             tm_sample,
             tm_sample_tm_id,
             glossary_id,
             project_template_id,
             translation_engine_id,
             file_type_config_id,
             project_settings,
             department_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL, 0, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           RETURNING id, name, description, src_lang, tgt_lang, target_langs, status, published_at, init_error,
                     provisioning_started_at, provisioning_updated_at, provisioning_finished_at, provisioning_progress,
                     provisioning_current_step,
                     created_by, assigned_user, tm_sample, tm_sample_tm_id, glossary_id, department_id, project_settings,
                     created_at`,
          [
            name,
            description || null,
            srcLang,
            tgtLang,
            JSON.stringify(projectTargetLangs),
            "provisioning",
            null,
            null,
            "IMPORT_FILES",
            creatorId,
            assignedUser,
            tmSample,
            tmSampleTmId,
            effectiveProjectGlossaryId,
            template?.id ?? null,
            effectiveTranslationEngineId,
            effectiveFileTypeConfigId,
            projectSettings,
            departmentId
          ]
        );
        const row = insertRes.rows[0];
        if (!row) {
          throw new Error("Create project failed");
        }

        const fileMap = new Map<string, number>();
        for (const plan of filePlans) {
          const fileRes = await client.query<{ id: number }>(
            `INSERT INTO project_files(project_id, original_name, stored_path, file_type, file_type_config_id, status, client_temp_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [row.id, plan.filename, "pending", plan.uploadType, plan.fileTypeConfigId, "created", plan.tempKey]
          );
          const fileId = Number(fileRes.rows[0]?.id);
          if (!Number.isFinite(fileId) || fileId <= 0) {
            throw new Error("Failed to create project file");
          }
          fileMap.set(plan.tempKey, fileId);
        }

        const engineOverridesByFileId = mapEngineOverridesToFileIds(
          engineOverridesRawMap,
          fileMap,
          parseOptionalInt
        );
        if (Object.keys(engineOverridesByFileId).length > 0) {
          projectSettings.translationEngineOverrides = engineOverridesByFileId;
          projectSettings.translation_engine_overrides = engineOverridesByFileId;
          await client.query(
            "UPDATE projects SET project_settings = $2 WHERE id = $1",
            [row.id, projectSettings]
          );
        }

        if (translationPlan.length > 0) {
          const canAssign = canAssignProjects(user);
          const tasks = await buildTranslationTasks({
            translationPlan,
            fileMap,
            projectTargetLangs,
            srcLang,
            departmentId,
            creatorId,
            canAssign,
            requesterIsAdmin,
            requesterMatchesUser: (assigned) => requesterMatchesUser(user, assigned),
            resolveUserRef,
            resolveUserDepartmentId,
            resolveUserRole,
            resolveEngineMeta: async (engineId) => {
              const res = await client.query<{ disabled: boolean }>(
                "SELECT disabled FROM translation_engines WHERE id = $1",
                [engineId]
              );
              return res.rows[0] ?? null;
            },
            resolveRulesetMeta: async (rulesetIdValue) => {
              const res = await client.query<{ disabled: boolean }>(
                "SELECT disabled FROM language_processing_rulesets WHERE id = $1",
                [rulesetIdValue]
              );
              return res.rows[0] ?? null;
            },
            resolveGlossaryMeta: async (glossaryIdValue) => {
              const res = await client.query<{ disabled: boolean }>(
                "SELECT disabled FROM glossaries WHERE id = $1",
                [glossaryIdValue]
              );
              return res.rows[0] ?? null;
            },
            makeRequestError,
            normalizeLang,
            normalizeLangList,
            normalizeJsonObject,
            parseOptionalInt,
            effectiveTranslationEngineId,
            engineDefaultsByTarget,
            engineOverridesByFileId,
            resolvedRulesEnabled,
            terminologyEnabled,
            rulesetId,
            projectGlossaryOverride,
            templateTmxByTarget,
            templateRulesetByTarget,
            templateGlossaryByTarget,
            templateDefaultTmxId,
            templateDefaultRulesetId,
            templateDefaultGlossaryId
          });

          for (const task of tasks) {
            await client.query(
              `INSERT INTO translation_tasks(
                 project_id,
                 file_id,
                 source_lang,
                 target_lang,
                 translator_user,
               reviewer_user,
               tmx_id,
               seed_source,
               engine_id,
               glossary_id,
               ruleset_id,
               status
             )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')`,
              [
                row.id,
                task.fileId,
                srcLang,
                task.targetLang,
                task.translator,
                task.reviewer,
                task.tmxId,
                task.seedSource,
                task.engineId,
                task.glossaryId,
                task.rulesetId
              ]
            );
          }
        }

        return { row, fileMap };
      });

      const row = result.row;
      if (row) {
        try {
          const now = Date.now();
          const createdBy = row.created_by ? String(row.created_by) : null;
          const assignedUser = row.assigned_user ? String(row.assigned_user) : createdBy;
          if (createdBy) {
            await addProjectToCreated(createdBy, row.id, now);
          }
          if (assignedUser) {
            await addProjectToAssigned(assignedUser, row.id, now);
          }
          await touchProjectForUsers({
            projectId: row.id,
            createdBy,
            assignedUser,
            updatedAtMs: now
          });
        } catch {
          /* ignore bucket update errors */
        }
      }

      const files = Array.from(result.fileMap.entries()).map(([tempKey, fileId]) => ({
        tempKey,
        fileId
      }));

      const statusUrl = row ? `/api/cat/projects/${row.id}/provisioning` : null;
      if ((req as any).provisionOnly) {
        return {
          projectId: row?.id ?? null,
          status: row?.status ?? "provisioning",
          statusUrl,
          files
        };
      }
      return { project: row ? await rowToProject(row) : null, files, statusUrl };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply
          .code(409)
          .send({ error: "A project with this name already exists." });
      }
      if (err?.code === "23514") {
        return reply.code(400).send({ error: "At least one file is required to create a project." });
      }
      if (isRequestError(err)) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  };

  app.post("/projects", { preHandler: [requireAuth] }, handleCreateProject);
  app.post("/projects/provision", { preHandler: [requireAuth] }, async (req, reply) => {
    (req as any).provisionOnly = true;
    return handleCreateProject(req, reply);
  });

}
