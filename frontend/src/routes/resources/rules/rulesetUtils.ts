export type RuleScope = "source" | "target" | "both";
export type RuleType = "preset" | "regex";

export type RegexRuleConfig = {
  pattern: string;
  replace: string;
  flags: string;
  scope: RuleScope;
};

export type SentenceCaseConfig = {
  presetId: "sentence-case";
  ensureSingleSpaceAfterPunctuation: boolean;
};

export type NormalizeWhitespaceConfig = {
  presetId: "normalize-whitespace";
  collapseSpaces: boolean;
  trimEdges: boolean;
};

export type PunctuationSpacingConfig = {
  presetId: "punctuation-spacing";
  removeSpaceBefore: boolean;
  ensureSpaceAfter: boolean;
};

export type SmartQuotesConfig = {
  presetId: "smart-quotes";
  style: "straight";
};

export type NumberGuardConfig = {
  presetId: "number-format-guard";
  protectDigitGroups: boolean;
};

export type PresetRuleConfig =
  | SentenceCaseConfig
  | NormalizeWhitespaceConfig
  | PunctuationSpacingConfig
  | SmartQuotesConfig
  | NumberGuardConfig;

export type RulesetRule = {
  id: string;
  name: string;
  type: RuleType;
  enabled: boolean;
  config: RegexRuleConfig | PresetRuleConfig;
};

export type PresetDefinition = {
  id: PresetRuleConfig["presetId"];
  name: string;
  description: string;
  defaults: PresetRuleConfig;
};

export const PRESET_LIBRARY: PresetDefinition[] = [
  {
    id: "sentence-case",
    name: "Sentence case",
    description: "Always capitalize the first letter of each sentence.",
    defaults: {
      presetId: "sentence-case",
      ensureSingleSpaceAfterPunctuation: false
    }
  },
  {
    id: "normalize-whitespace",
    name: "Normalize whitespace",
    description: "Collapse multiple spaces and trim leading/trailing spaces.",
    defaults: {
      presetId: "normalize-whitespace",
      collapseSpaces: true,
      trimEdges: true
    }
  },
  {
    id: "punctuation-spacing",
    name: "Punctuation spacing",
    description: "Remove space before punctuation and enforce spacing after punctuation.",
    defaults: {
      presetId: "punctuation-spacing",
      removeSpaceBefore: true,
      ensureSpaceAfter: true
    }
  },
  {
    id: "smart-quotes",
    name: "Smart quotes normalization",
    description: "Convert smart quotes to straight quotes.",
    defaults: {
      presetId: "smart-quotes",
      style: "straight"
    }
  },
  {
    id: "number-format-guard",
    name: "Number formatting guard",
    description: "Protect digit groups and avoid altering numbers.",
    defaults: {
      presetId: "number-format-guard",
      protectDigitGroups: true
    }
  }
];

export const RULE_SCOPE_OPTIONS: Array<{ value: RuleScope; label: string }> = [
  { value: "target", label: "Target only" },
  { value: "source", label: "Source only" },
  { value: "both", label: "Source + Target" }
];

export function createRuleId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createRegexRule(): RulesetRule {
  return {
    id: createRuleId(),
    name: "Regex rule",
    type: "regex",
    enabled: true,
    config: {
      pattern: "",
      replace: "",
      flags: "g",
      scope: "target"
    }
  };
}

export function createPresetRule(presetId: PresetRuleConfig["presetId"]): RulesetRule {
  const preset = PRESET_LIBRARY.find((entry) => entry.id === presetId);
  const defaults = preset?.defaults;
  return {
    id: createRuleId(),
    name: preset?.name || "Preset rule",
    type: "preset",
    enabled: true,
    config: defaults ? { ...defaults } : ({ presetId } as PresetRuleConfig)
  };
}

export function normalizePresetConfig(presetId: PresetRuleConfig["presetId"], raw?: any): PresetRuleConfig {
  const preset = PRESET_LIBRARY.find((entry) => entry.id === presetId);
  const defaults = preset?.defaults;
  const base = raw && typeof raw === "object" ? raw : {};
  if (!defaults) {
    return { presetId } as PresetRuleConfig;
  }
  return { ...defaults, ...base, presetId };
}

export function normalizeRulesFromApi(rawRules: any[]): RulesetRule[] {
  if (!Array.isArray(rawRules)) return [];
  return rawRules.map((rule, idx) => {
    const id = String(rule?.id || rule?.ruleId || rule?.rule_id || createRuleId());
    const enabled = rule?.enabled === false ? false : rule?.disabled === true ? false : true;
    const rawType = String(rule?.type || rule?.kind || "").trim().toLowerCase();
    const presetIdRaw =
      String(rule?.presetId || rule?.config?.presetId || rule?.config?.id || "")
        .trim()
        .toLowerCase();
    const isPreset = rawType === "preset" || Boolean(presetIdRaw);
    if (isPreset) {
      const presetId = (presetIdRaw || "sentence-case") as PresetRuleConfig["presetId"];
      const config = normalizePresetConfig(presetId, rule?.config ?? rule?.settings ?? rule);
      const name = String(rule?.name || rule?.label || PRESET_LIBRARY.find((p) => p.id === presetId)?.name || "Preset rule");
      return {
        id,
        name,
        type: "preset",
        enabled,
        config
      };
    }

    const pattern = String(rule?.pattern ?? rule?.config?.pattern ?? "");
    const replace = String(rule?.replacement ?? rule?.replace ?? rule?.config?.replacement ?? rule?.config?.replace ?? "");
    const flags = String(rule?.flags ?? rule?.config?.flags ?? "g");
    const scopeRaw = String(rule?.scope ?? rule?.config?.scope ?? "target").toLowerCase();
    const scope: RuleScope = scopeRaw === "source" || scopeRaw === "both" ? scopeRaw : "target";
    const name = String(rule?.name || rule?.label || `Regex rule ${idx + 1}`);
    return {
      id,
      name,
      type: "regex",
      enabled,
      config: {
        pattern,
        replace,
        flags,
        scope
      }
    };
  });
}

export function serializeRulesForApi(rules: RulesetRule[]) {
  return rules.map((rule) => {
    if (rule.type === "preset") {
      const config = rule.config as PresetRuleConfig;
      return {
        id: rule.id,
        name: rule.name,
        type: "preset",
        enabled: rule.enabled,
        presetId: config.presetId,
        config
      };
    }
    const config = rule.config as RegexRuleConfig;
    return {
      id: rule.id,
      name: rule.name,
      type: "regex",
      enabled: rule.enabled,
      pattern: config.pattern,
      replacement: config.replace,
      flags: config.flags,
      scope: config.scope
    };
  });
}

export function validateRulesetRules(rules: RulesetRule[]) {
  const errors: Record<string, string> = {};
  rules.forEach((rule) => {
    const name = String(rule.name || "").trim();
    if (!name) {
      errors[rule.id] = "Rule name is required.";
      return;
    }
    if (rule.type === "regex") {
      const config = rule.config as RegexRuleConfig;
      const pattern = String(config.pattern || "").trim();
      const replace = String(config.replace ?? "");
      if (!pattern) {
        errors[rule.id] = "Regex pattern is required.";
        return;
      }
      if (replace.trim() === "") {
        errors[rule.id] = "Regex replacement is required.";
        return;
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, config.flags || "g");
      } catch {
        errors[rule.id] = "Regex pattern is invalid.";
      }
    }
  });
  return errors;
}
