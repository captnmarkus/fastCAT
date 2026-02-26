export type RuleApplyScope = "source" | "target" | "both";

const PRESET_IDS = new Set([
  "sentence-case",
  "normalize-whitespace",
  "punctuation-spacing",
  "smart-quotes",
  "number-format-guard"
]);

function normalizeScope(value: any): RuleApplyScope {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "source" || raw === "src") return "source";
  if (raw === "both" || raw === "all") return "both";
  return "target";
}

function shouldApplyRule(ruleScope: RuleApplyScope, applyScope: RuleApplyScope) {
  if (applyScope === "both") return true;
  if (ruleScope === "both") return true;
  return ruleScope === applyScope;
}

function isRuleEnabled(rule: any) {
  if (!rule || typeof rule !== "object") return false;
  if (rule.enabled === false) return false;
  if (rule.disabled === true) return false;
  return true;
}

function resolveRuleType(rule: any): "regex" | "preset" | null {
  const raw = String(rule?.type ?? rule?.kind ?? rule?.ruleType ?? "").trim().toLowerCase();
  if (raw === "preset") return "preset";
  if (raw === "regex" || raw === "replace") return "regex";
  if (rule?.presetId || rule?.config?.presetId) return "preset";
  if (rule?.pattern || rule?.replacement || rule?.replace || rule?.config?.pattern) return "regex";
  return null;
}

function getRegexConfig(rule: any) {
  const cfg = rule?.config && typeof rule.config === "object" && !Array.isArray(rule.config) ? rule.config : {};
  const pattern = String(rule?.pattern ?? cfg.pattern ?? "");
  const replacement = String(rule?.replacement ?? rule?.replace ?? cfg.replacement ?? cfg.replace ?? "");
  const flags = String(rule?.flags ?? cfg.flags ?? "g");
  const scope = normalizeScope(rule?.scope ?? cfg.scope ?? rule?.applyScope ?? cfg.applyScope);
  return { pattern, replacement, flags, scope };
}

function getPresetConfig(rule: any) {
  const cfg = rule?.config && typeof rule.config === "object" && !Array.isArray(rule.config) ? rule.config : {};
  const presetId = String(rule?.presetId ?? cfg.presetId ?? cfg.id ?? rule?.id ?? "").trim().toLowerCase();
  const scope = normalizeScope(rule?.scope ?? cfg.scope ?? rule?.applyScope ?? cfg.applyScope);
  return { presetId, scope, config: cfg };
}

function applySentenceCase(input: string, cfg: any) {
  let out = input;
  const ensureSpace = cfg?.ensureSingleSpaceAfterPunctuation === true;
  if (ensureSpace) {
    out = out.replace(/([.!?])\s*(?=\S)/g, "$1 ");
  }
  let result = "";
  let capitalizeNext = true;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    const isLetter = ch.toLowerCase() !== ch.toUpperCase();
    if (capitalizeNext && isLetter) {
      result += ch.toUpperCase();
      capitalizeNext = false;
    } else {
      result += ch;
    }
    if (/[.!?]/.test(ch)) {
      capitalizeNext = true;
    }
  }
  return result;
}

function applyNormalizeWhitespace(input: string, cfg: any) {
  let out = input;
  const collapse = cfg?.collapseSpaces !== false;
  const trimEdges = cfg?.trimEdges !== false;
  if (collapse) {
    out = out.replace(/[ \t]+/g, " ");
  }
  if (trimEdges) out = out.trim();
  return out;
}

function applyPunctuationSpacing(input: string, cfg: any) {
  let out = input;
  const removeSpaceBefore = cfg?.removeSpaceBefore !== false;
  const ensureSpaceAfter = cfg?.ensureSpaceAfter !== false;
  if (removeSpaceBefore) {
    out = out.replace(/[ \t]+([,.;:!?])/g, "$1");
  }
  if (ensureSpaceAfter) {
    out = out.replace(/([,.;:!?])(?=\S)/g, "$1 ");
  }
  return out;
}

function applySmartQuotes(input: string, cfg: any) {
  const style = String(cfg?.style ?? "straight").trim().toLowerCase();
  if (style !== "straight") return input;
  let out = input;
  out = out.replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, "\"");
  out = out.replace(/[\u2018\u2019\u201A\u2039\u203A]/g, "'");
  return out;
}

function protectNumbers(input: string) {
  const tokens: string[] = [];
  const tokenPrefix = "__FC_NUM_";
  const out = input.replace(/\d[\d.,\s]*\d|\d/g, (match) => {
    const token = `${tokenPrefix}${tokens.length}__`;
    tokens.push(match);
    return token;
  });
  return { output: out, tokens, tokenPrefix };
}

function restoreNumbers(input: string, tokens: string[], tokenPrefix: string) {
  let out = input;
  tokens.forEach((value, idx) => {
    const token = `${tokenPrefix}${idx}__`;
    out = out.split(token).join(value);
  });
  return out;
}

export function validateLanguageProcessingRules(rules: any[]): string | null {
  const list = Array.isArray(rules) ? rules : [];
  for (const rule of list) {
    if (!rule || typeof rule !== "object") continue;
    const type = resolveRuleType(rule);
    if (type !== "regex") continue;
    const { pattern, replacement, flags } = getRegexConfig(rule);
    if (!String(pattern || "").trim()) {
      return "Regex pattern is required.";
    }
    if (replacement == null) {
      return "Regex replacement is required.";
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern, flags || "g");
    } catch (err: any) {
      const label = String(rule?.name || "").trim();
      return label ? `Invalid regex in "${label}".` : "Invalid regex pattern.";
    }
  }
  return null;
}

export function applyLanguageProcessingRules(
  input: string,
  rules: any[],
  opts?: { scope?: RuleApplyScope }
): { output: string; applied: number } {
  let out = String(input ?? "");
  let applied = 0;
  const list = Array.isArray(rules) ? rules : [];
  const applyScope = normalizeScope(opts?.scope ?? "target");
  let protectedNumbers = false;
  let numberTokens: string[] = [];
  let numberPrefix = "__FC_NUM_";

  for (const rule of list) {
    if (!isRuleEnabled(rule)) continue;
    const type = resolveRuleType(rule);
    if (type === "preset") {
      const preset = getPresetConfig(rule);
      const presetId = preset.presetId;
      if (!presetId || !PRESET_IDS.has(presetId)) continue;
      if (presetId === "number-format-guard") {
        if (!protectedNumbers) {
          const protectedResult = protectNumbers(out);
          out = protectedResult.output;
          numberTokens = protectedResult.tokens;
          numberPrefix = protectedResult.tokenPrefix;
          protectedNumbers = true;
        }
        continue;
      }
      if (!shouldApplyRule(preset.scope, applyScope)) continue;
      const before = out;
      if (presetId === "sentence-case") {
        out = applySentenceCase(out, preset.config);
      } else if (presetId === "normalize-whitespace") {
        out = applyNormalizeWhitespace(out, preset.config);
      } else if (presetId === "punctuation-spacing") {
        out = applyPunctuationSpacing(out, preset.config);
      } else if (presetId === "smart-quotes") {
        out = applySmartQuotes(out, preset.config);
      }
      if (out !== before) applied += 1;
      continue;
    }
    if (type === "regex") {
      const { pattern, replacement, flags, scope } = getRegexConfig(rule);
      if (!String(pattern || "").trim()) continue;
      if (!shouldApplyRule(scope, applyScope)) continue;
      let rx: RegExp;
      try {
        rx = new RegExp(pattern, flags || "g");
      } catch (err: any) {
        throw new Error("Invalid regex pattern.");
      }
      const before = out;
      out = out.replace(rx, replacement);
      if (out !== before) applied += 1;
    }
  }

  if (protectedNumbers) {
    out = restoreNumbers(out, numberTokens, numberPrefix);
  }

  return { output: out, applied };
}
