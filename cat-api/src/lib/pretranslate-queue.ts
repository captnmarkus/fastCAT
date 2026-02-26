import { db } from "../db.js";
import {
  normalizeEngineDefaultsByTarget,
  normalizeEngineOverrides,
  type EngineDefaultsByTarget,
  type EngineOverridesByFile
} from "./translation-engine-settings.js";
import { normalizeLanguageTag } from "./language-catalog.js";

type LoggerLike = {
  info?: (obj: Record<string, any>, msg?: string) => void;
  warn?: (obj: Record<string, any>, msg?: string) => void;
  error?: (obj: Record<string, any>, msg?: string) => void;
  debug?: (obj: Record<string, any>, msg?: string) => void;
};

function logWith(
  logger: LoggerLike | undefined,
  level: "info" | "warn" | "error" | "debug",
  data: Record<string, any>,
  message: string
) {
  const fn = logger?.[level];
  if (typeof fn === "function") {
    fn.call(logger, data, message);
    return;
  }
  const prefix = `[pretranslate:${level}]`;
  console.log(`${prefix} ${message}`, data);
}

type EngineResolutionReason =
  | "task_engine"
  | "override"
  | "override_none"
  | "target_default"
  | "target_default_none"
  | "project_default"
  | "project_default_none"
  | "invalid_target";

function normalizeTargetKey(value: string) {
  const normalized = normalizeLanguageTag(String(value ?? "").trim());
  return normalized ? normalized.toLowerCase() : "";
}

function canonicalTarget(value: string) {
  const normalized = normalizeLanguageTag(String(value ?? "").trim());
  return normalized || String(value ?? "").trim();
}

function normalizeProjectTargets(values: any): string[] {
  const raw = Array.isArray(values) ? values : [];
  return raw.map((value) => normalizeTargetKey(String(value || ""))).filter(Boolean);
}

function normalizeProjectSettings(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
    } catch {
      return {};
    }
  }
  return {};
}

function parseOptionalInt(value: any): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseOptionalBool(value: any): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return null;
}

function extractEngineSettings(params: {
  projectDefaultId: number | null;
  projectSettings: Record<string, any>;
  targetLangs: string[];
}) {
  const targetSet = new Set(params.targetLangs);
  const defaultsRaw =
    params.projectSettings.translationEngineDefaultsByTarget ??
    params.projectSettings.translation_engine_defaults_by_target ??
    params.projectSettings.translationEngineByTargetLang ??
    params.projectSettings.translation_engine_by_target_lang ??
    {};
  const overridesRaw =
    params.projectSettings.translationEngineOverrides ??
    params.projectSettings.translation_engine_overrides ??
    {};
  const defaultsByTarget: EngineDefaultsByTarget = normalizeEngineDefaultsByTarget(defaultsRaw, targetSet);
  const overridesByFile: EngineOverridesByFile = normalizeEngineOverrides(overridesRaw, targetSet);
  return { defaultsByTarget, overridesByFile };
}

function resolveEngineForTask(params: {
  taskEngineId: number | null;
  projectDefaultId: number | null;
  defaultsByTarget: EngineDefaultsByTarget;
  overridesByFile: EngineOverridesByFile;
  fileId: number;
  targetLang: string;
}) {
  const targetKey = normalizeTargetKey(params.targetLang);
  if (!targetKey) {
    return {
      engineId: null,
      reason: "invalid_target" as EngineResolutionReason,
      targetKey
    };
  }

  if (params.taskEngineId != null) {
    return {
      engineId: Number(params.taskEngineId),
      reason: "task_engine" as EngineResolutionReason,
      targetKey
    };
  }

  const fileKey = String(params.fileId ?? "");
  const overrides = params.overridesByFile?.[fileKey];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, targetKey)) {
    const value = overrides[targetKey];
    if (value == null) {
      return {
        engineId: null,
        reason: "override_none" as EngineResolutionReason,
        targetKey
      };
    }
    return {
      engineId: Number(value),
      reason: "override" as EngineResolutionReason,
      targetKey
    };
  }

  if (params.defaultsByTarget && Object.prototype.hasOwnProperty.call(params.defaultsByTarget, targetKey)) {
    const value = params.defaultsByTarget[targetKey];
    if (value == null) {
      return {
        engineId: null,
        reason: "target_default_none" as EngineResolutionReason,
        targetKey
      };
    }
    return {
      engineId: Number(value),
      reason: "target_default" as EngineResolutionReason,
      targetKey
    };
  }

  if (params.projectDefaultId != null) {
    return {
      engineId: Number(params.projectDefaultId),
      reason: "project_default" as EngineResolutionReason,
      targetKey
    };
  }

  return {
    engineId: null,
    reason: "project_default_none" as EngineResolutionReason,
    targetKey
  };
}

export async function enqueuePretranslateJobs(params: {
  projectId: number;
  scope: "all" | "file" | "language";
  fileId?: number | null;
  targetLang?: string | null;
  overwriteExisting?: boolean;
  log?: LoggerLike;
}) {
  const projectRes = await db.query<{
    translation_engine_id: number | null;
    project_settings: any;
    target_langs: any;
    tgt_lang: string;
  }>(
    `SELECT translation_engine_id, project_settings, target_langs, tgt_lang
     FROM projects
     WHERE id = $1
     LIMIT 1`,
    [params.projectId]
  );
  const project = projectRes.rows[0];
  if (!project) throw new Error("Project not found");

  const settings = normalizeProjectSettings(project.project_settings);
  const projectDefaultId =
    parseOptionalInt(
      settings.translationEngineDefaultId ??
        settings.translation_engine_default_id ??
        settings.translationEngineId ??
        settings.translation_engine_id
    ) ?? (project.translation_engine_id != null ? Number(project.translation_engine_id) : null);

  const seedingEnabledFlag = parseOptionalBool(
    settings.mtSeedingEnabled ??
      settings.mt_seeding_enabled ??
      settings.translationEngineSeedingEnabled ??
      settings.translation_engine_seeding_enabled
  );
  const runAfterCreateFlag = parseOptionalBool(
    settings.mtRunAfterCreate ??
      settings.mt_run_after_create ??
      settings.translationEngineRunAfterCreate ??
      settings.translation_engine_run_after_create
  );

  const targetLangs = normalizeProjectTargets(project.target_langs).concat(
    project.tgt_lang ? [normalizeTargetKey(project.tgt_lang)] : []
  );
  const normalizedTargets = Array.from(new Set(targetLangs.filter(Boolean)));
  const { defaultsByTarget, overridesByFile } = extractEngineSettings({
    projectDefaultId,
    projectSettings: settings,
    targetLangs: normalizedTargets
  });

  logWith(
    params.log,
    "info",
    {
      projectId: params.projectId,
      scope: params.scope,
      fileId: params.fileId ?? null,
      targetLang: params.targetLang ?? null,
      mtSeedingEnabled: seedingEnabledFlag,
      mtRunAfterCreate: runAfterCreateFlag,
      projectDefaultId,
      targetLangCount: normalizedTargets.length
    },
    "Pretranslate enqueue requested"
  );

  if (seedingEnabledFlag === false) {
    logWith(
      params.log,
      "info",
      { projectId: params.projectId, reason: "seeding_disabled" },
      "Pretranslation seeding disabled; skipping enqueue"
    );
    return {
      queued: 0,
      skipped: 0,
      total: 0,
      resolvedPairCount: 0,
      createdJobs: 0,
      skippedPairs: 0,
      reason: "seeding_disabled"
    };
  }

  const tasksRes = await db.query<{
    file_id: number;
    target_lang: string;
    engine_id: number | null;
  }>(
    `SELECT file_id, target_lang, engine_id
     FROM translation_tasks
     WHERE project_id = $1`,
    [params.projectId]
  );

  const scopeTarget = params.targetLang ? normalizeTargetKey(params.targetLang) : null;

  const tasks = tasksRes.rows.filter((task) => {
    if (params.fileId && Number(task.file_id) !== Number(params.fileId)) return false;
    const taskTarget = normalizeTargetKey(task.target_lang);
    if (scopeTarget && taskTarget !== scopeTarget) return false;
    if (params.scope === "file" && !params.fileId) return false;
    if (params.scope === "language" && !scopeTarget) return false;
    return true;
  });

  if (tasks.length === 0) {
    logWith(
      params.log,
      "warn",
      {
        projectId: params.projectId,
        reason: "no_tasks",
        scope: params.scope,
        fileId: params.fileId ?? null,
        targetLang: params.targetLang ?? null
      },
      "Pretranslate enqueue skipped: no matching tasks"
    );
    return {
      queued: 0,
      skipped: 0,
      total: 0,
      resolvedPairCount: 0,
      createdJobs: 0,
      skippedPairs: 0,
      reason: "no_tasks"
    };
  }

  let queued = 0;
  let skipped = 0;
  let resolvedPairCount = 0;
  const skippedPairReasons: Array<{ fileId: number; targetLang: string; reason: EngineResolutionReason }> = [];

  for (const task of tasks) {
    const targetLangValue = String(task.target_lang || "").trim();
    const targetCanonical = canonicalTarget(targetLangValue);
    const targetKey = normalizeTargetKey(targetLangValue);
    if (!targetLangValue && !targetKey) {
      skipped += 1;
      if (skippedPairReasons.length < 50) {
        skippedPairReasons.push({
          fileId: Number(task.file_id),
          targetLang: targetLangValue || "",
          reason: "invalid_target"
        });
      }
      continue;
    }
    const resolution = resolveEngineForTask({
      taskEngineId: task.engine_id != null ? Number(task.engine_id) : null,
      projectDefaultId,
      defaultsByTarget,
      overridesByFile,
      fileId: Number(task.file_id),
      targetLang: targetLangValue || targetKey
    });
    const engineId = resolution.engineId;
    logWith(
      params.log,
      "debug",
      {
        projectId: params.projectId,
        fileId: Number(task.file_id),
        targetLang: targetLangValue || "",
        targetCanonical,
        targetKey: resolution.targetKey,
        engineId,
        reason: resolution.reason
      },
      "Pretranslate engine resolution"
    );

    if (!engineId) {
      logWith(
        params.log,
        "info",
        {
          projectId: params.projectId,
          fileId: task.file_id,
          targetLang: targetLangValue || targetKey,
          reason: resolution.reason
        },
        "Pretranslate skipped: no engine resolved"
      );
      skipped += 1;
      if (skippedPairReasons.length < 50) {
        skippedPairReasons.push({
          fileId: Number(task.file_id),
          targetLang: targetLangValue || targetKey,
          reason: resolution.reason
        });
      }
      continue;
    }
    resolvedPairCount += 1;
    const upsertRes = await db.query<{ id: number }>(
      `INSERT INTO project_pretranslate_jobs(
         project_id,
         file_id,
         target_lang,
         engine_id,
         status,
         overwrite_existing,
         retry_count,
         segments_total,
         segments_processed,
         segments_skipped,
         error_message,
         updated_at
       )
       VALUES ($1, $2, $3, $4, 'pending', $5, 0, 0, 0, 0, NULL, NOW())
       ON CONFLICT (project_id, file_id, target_lang)
       DO UPDATE SET engine_id = EXCLUDED.engine_id,
                     status = 'pending',
                     overwrite_existing = EXCLUDED.overwrite_existing,
                     retry_count = 0,
                     segments_total = 0,
                     segments_processed = 0,
                     segments_skipped = 0,
                     error_message = NULL,
                     updated_at = NOW(),
                     started_at = NULL,
                     completed_at = NULL
       RETURNING id`,
      [
        params.projectId,
        task.file_id,
        targetLangValue || targetKey,
        engineId,
        params.overwriteExisting === true
      ]
    );
    const jobId = upsertRes.rows[0]?.id ?? null;
    logWith(
      params.log,
      "info",
      {
        jobId,
        projectId: params.projectId,
        fileId: task.file_id,
        targetLang: targetLangValue || targetKey,
        engineId,
        overwriteExisting: params.overwriteExisting === true
      },
      "Pretranslate job enqueued"
    );
    queued += 1;
  }

  if (resolvedPairCount === 0) {
    logWith(
      params.log,
      "warn",
      {
        projectId: params.projectId,
        reason: "no_resolved_engines",
        totalPairs: tasks.length
      },
      "Pretranslate enqueue skipped: no resolved engines"
    );
  }

  logWith(
    params.log,
    "info",
    {
      projectId: params.projectId,
      totalPairs: tasks.length,
      resolvedPairCount,
      queued,
      skipped
    },
    "Pretranslate enqueue summary"
  );

  return {
    queued,
    skipped,
    total: tasks.length,
    resolvedPairCount,
    createdJobs: queued,
    skippedPairs: skipped,
    skippedPairReasons
  };
}
