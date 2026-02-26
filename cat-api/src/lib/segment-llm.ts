import fetch from "node-fetch";
import { db } from "../db.js";
import { CONFIG } from "../config.js";
import { applyLanguageProcessingRules } from "./language-processing.js";

export class SegmentLlmError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SegmentLlmPayload = any;

function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  const src = String(template ?? "");
  return src.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    return String(vars[key] ?? "");
  });
}

async function selectGlossaryMatches(
  srcText: string,
  srcLang?: string,
  tgtLang?: string
) {
  const srcLike = `${(srcLang || "").toLowerCase()}%`;
  const tgtLike = `${(tgtLang || "").toLowerCase()}%`;
  const baseText = srcText.toLowerCase();
  return db
    .query<{
      term: string;
      translation: string;
    }>(
      `SELECT term, translation
       FROM global_glossary_entries
       WHERE (source_lang IS NULL OR LOWER(source_lang) LIKE $1)
         AND (target_lang IS NULL OR LOWER(target_lang) LIKE $2)
         AND strpos($3, LOWER(term)) > 0
       ORDER BY LENGTH(term) DESC
       LIMIT 8`,
      [srcLike, tgtLike, baseText]
    )
    .then((res) => res.rows);
}

async function selectPreviousSegment(
  projectId: number,
  fileId: number,
  segIndex: number,
  taskId?: number | null
) {
  if (segIndex <= 0) return null;
  const res = await db.query<{ src: string | null; tgt: string | null }>(
    `SELECT src, tgt
     FROM segments
     WHERE project_id = $1
       AND file_id = $2
       AND seg_index = $3
       AND ($4::int IS NULL OR task_id = $4)
     LIMIT 1`,
    [projectId, fileId, segIndex - 1, taskId ?? null]
  );
  return res.rows[0] ?? null;
}

function parseRulesetId(value: any) {
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

async function loadRulesetRules(rulesetIdValue: number) {
  const res = await db.query<{ rules: any }>(
    "SELECT rules FROM language_processing_rulesets WHERE id = $1",
    [rulesetIdValue]
  );
  return Array.isArray(res.rows[0]?.rules) ? res.rows[0]!.rules : [];
}

function applyRulesToPayload(payload: any, rules: any[]) {
  if (!Array.isArray(rules) || rules.length === 0) return payload;
  if (!payload || !Array.isArray(payload.choices)) return payload;
  payload.choices = payload.choices.map((choice: any) => {
    const messageContent = choice?.message?.content;
    if (typeof messageContent === "string") {
      const result = applyLanguageProcessingRules(messageContent, rules, { scope: "target" });
      return { ...choice, message: { ...choice.message, content: result.output } };
    }
    const textContent = choice?.text;
    if (typeof textContent === "string") {
      const result = applyLanguageProcessingRules(textContent, rules, { scope: "target" });
      return { ...choice, text: result.output };
    }
    return choice;
  });
  return payload;
}

export async function requestSegmentLlmPayload(params: {
  segmentId: number;
  engineIdOverride?: number | null;
  traceId?: string | null;
}): Promise<{ payload: SegmentLlmPayload; status: number; engineId: number | null }> {
  const segRes = await db.query(
    `SELECT s.src,
            s.tgt,
            s.file_id,
            s.seg_index,
            s.project_id,
            s.task_id,
            p.src_lang,
            COALESCE(t.target_lang, p.tgt_lang) AS tgt_lang,
            COALESCE(t.engine_id, p.translation_engine_id) AS translation_engine_id,
            t.ruleset_id,
            p.project_settings,
            p.name AS project_name,
            pf.original_name AS file_name
     FROM segments s
     JOIN projects p ON s.project_id = p.id
     LEFT JOIN translation_tasks t ON s.task_id = t.id
     LEFT JOIN project_files pf ON pf.id = s.file_id
     WHERE s.id = $1
     LIMIT 1`,
    [params.segmentId]
  );
  const seg = segRes.rows[0] as any;
  if (!seg) throw new SegmentLlmError(404, "Segment not found");

  const translationEngineId =
    params.engineIdOverride ?? (seg.translation_engine_id != null ? Number(seg.translation_engine_id) : null);

  let projectSettings: Record<string, any> = {};
  if (seg.project_settings && typeof seg.project_settings === "object") {
    projectSettings = seg.project_settings as Record<string, any>;
  } else if (typeof seg.project_settings === "string") {
    try {
      projectSettings = JSON.parse(seg.project_settings);
    } catch {
      projectSettings = {};
    }
  }

  const taskRulesetId = parseRulesetId(seg.ruleset_id);
  const projectRulesetId = parseRulesetId(
      projectSettings.languageProcessingRulesetId ??
      projectSettings.language_processing_ruleset_id ??
      projectSettings.rulesetId ??
      projectSettings.defaultRulesetId ??
      projectSettings.default_ruleset_id
  );
  const rawEffectiveRulesetId = taskRulesetId ?? projectRulesetId ?? null;
  const rulesFlag = parseOptionalBool(projectSettings.rules_enabled ?? projectSettings.rulesEnabled ?? null);
  const rulesEnabled = rulesFlag != null ? rulesFlag : rawEffectiveRulesetId != null;
  const effectiveRulesetId = rulesEnabled ? rawEffectiveRulesetId : null;

  const termbaseFlag = parseOptionalBool(projectSettings.termbase_enabled ?? projectSettings.termbaseEnabled ?? null);
  const glossaryFlag = parseOptionalBool(projectSettings.glossary_enabled ?? projectSettings.glossaryEnabled ?? null);
  const terminologyEnabled =
    termbaseFlag === false || glossaryFlag === false
      ? false
      : termbaseFlag === true || glossaryFlag === true
        ? true
        : true;

  if (!translationEngineId) {
    const glossary = terminologyEnabled ? await selectGlossaryMatches(seg.src, seg.src_lang, seg.tgt_lang) : [];
    const prevSeg = await selectPreviousSegment(seg.project_id, seg.file_id, seg.seg_index, seg.task_id);

    const systemPrompt = [
      "You are a professional translator.",
      terminologyEnabled ? "Follow the glossary terms exactly and keep brand tone consistent." : "Keep brand tone consistent.",
      terminologyEnabled
        ? glossary.length
          ? `Glossary (source => target): ${glossary
              .map((entry) => `${entry.term} => ${entry.translation}`)
              .join("; ")}`
          : "No glossary matches for this sentence."
        : "Glossary is disabled for this project.",
      `Previous sentence context: "${prevSeg?.tgt || prevSeg?.src || ""}"`
    ].join("\n");

    const userPrompt = `Translate the following text from ${seg.src_lang} to ${seg.tgt_lang}.
Source: """${seg.src}"""`;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (params.traceId) headers["x-request-id"] = params.traceId;
      const res = await fetch(`${CONFIG.LLM_GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        })
      });
      const payload = await res.json();
      if (effectiveRulesetId != null) {
        const rules = await loadRulesetRules(effectiveRulesetId);
        return { payload: applyRulesToPayload(payload, rules), status: res.status, engineId: null };
      }
      return { payload, status: res.status, engineId: null };
    } catch {
      throw new SegmentLlmError(502, "LLM Error");
    }
  }

  const engineRes = await db.query<{
    id: number;
    disabled: boolean;
    llm_provider_id: number | null;
    system_prompt: string | null;
    user_prompt_template: string | null;
    temperature: number | null;
    max_tokens: number | null;
    top_p: number | null;
  }>(
    `SELECT id, disabled, llm_provider_id, system_prompt, user_prompt_template, temperature, max_tokens, top_p
     FROM translation_engines
     WHERE id = $1
     LIMIT 1`,
    [translationEngineId]
  );
  const engine = engineRes.rows[0];
  if (!engine) throw new SegmentLlmError(400, "Selected translation engine not found.");
  if (engine.disabled) throw new SegmentLlmError(400, "Selected translation engine is disabled.");
  if (!engine.llm_provider_id) throw new SegmentLlmError(400, "Selected translation engine has no LLM provider.");

  const providerRes = await db.query<{
    id: number;
    provider: string;
    model: string | null;
    enabled: boolean;
    secret_enc: string | null;
  }>(
    `SELECT id, provider, model, enabled, secret_enc
     FROM nmt_providers
     WHERE id = $1
     LIMIT 1`,
    [engine.llm_provider_id]
  );
  const provider = providerRes.rows[0];
  if (!provider) throw new SegmentLlmError(400, "Selected LLM provider not found.");
  if (!provider.enabled) throw new SegmentLlmError(400, "Selected LLM provider is disabled.");
  const vendor = String(provider.provider || "").trim().toLowerCase();
  const model = String(provider.model || "").trim();
  if (!model) throw new SegmentLlmError(400, "Selected LLM provider is missing a model.");
  if (!provider.secret_enc) throw new SegmentLlmError(400, "Selected LLM provider is missing credentials.");

  const variables: Record<string, string> = {
    source_language: String(seg.src_lang || "").trim(),
    target_language: String(seg.tgt_lang || "").trim(),
    source_text: String(seg.src ?? ""),
    file_name: String(seg.file_name || ""),
    project_name: String(seg.project_name || "")
  };

  const systemPrompt = renderPromptTemplate(String(engine.system_prompt || ""), variables);
  const userPrompt = renderPromptTemplate(String(engine.user_prompt_template || ""), variables);

  if (!systemPrompt.trim() || !userPrompt.trim()) {
    throw new SegmentLlmError(400, "Selected translation engine prompts are incomplete.");
  }

  if (vendor !== "openai-compatible") {
    throw new SegmentLlmError(400, `LLM vendor '${vendor || "unknown"}' not supported yet.`);
  }

  const temperature = engine.temperature != null ? Number(engine.temperature) : 0.2;
  const maxTokens = engine.max_tokens != null ? Number(engine.max_tokens) : 512;
  const topP = engine.top_p != null ? Number(engine.top_p) : undefined;

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-llm-provider-id": String(provider.id)
    };
    if (params.traceId) headers["x-request-id"] = params.traceId;

    const res = await fetch(`${CONFIG.LLM_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens,
        top_p: topP
      })
    });

    const text = await res.text();
    const contentType = String(res.headers.get("content-type") || "");
    if (contentType.includes("application/json")) {
      try {
        const payload = JSON.parse(text);
        if (effectiveRulesetId != null) {
          const rules = await loadRulesetRules(effectiveRulesetId);
          return { payload: applyRulesToPayload(payload, rules), status: res.status, engineId: translationEngineId };
        }
        return { payload, status: res.status, engineId: translationEngineId };
      } catch {
        return { payload: text, status: res.status, engineId: translationEngineId };
      }
    }
    return { payload: text, status: res.status, engineId: translationEngineId };
  } catch {
    throw new SegmentLlmError(502, "LLM Error");
  }
}

export function extractTranslationText(payload: SegmentLlmPayload): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed ? trimmed : null;
  }
  const content =
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text ??
    payload?.message?.content ??
    null;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed ? trimmed : null;
}
