import React, { useMemo } from "react";
import {
  PRESET_LIBRARY,
  RULE_SCOPE_OPTIONS,
  createPresetRule,
  createRegexRule,
  validateRulesetRules,
  type PresetRuleConfig,
  type RegexRuleConfig,
  type RulesetRule
} from "./rulesetUtils";

type RulesetRuleBuilderProps = {
  rules: RulesetRule[];
  onChange: (next: RulesetRule[]) => void;
  showValidation?: boolean;
  disabled?: boolean;
};

export default function RulesetRuleBuilder(props: RulesetRuleBuilderProps) {
  const { rules, onChange, showValidation, disabled } = props;
  const errors = useMemo(() => validateRulesetRules(rules), [rules]);

  function updateRule(ruleId: string, patch: Partial<RulesetRule>) {
    onChange(rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)));
  }

  function updateRuleConfig(ruleId: string, patch: Partial<RegexRuleConfig | PresetRuleConfig>) {
    onChange(
      rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, config: { ...(rule.config as any), ...patch } }
          : rule
      )
    );
  }

  function removeRule(ruleId: string) {
    onChange(rules.filter((rule) => rule.id !== ruleId));
  }

  function moveRule(ruleId: string, delta: number) {
    const idx = rules.findIndex((rule) => rule.id === ruleId);
    if (idx < 0) return;
    const next = rules.slice();
    const target = idx + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="card-enterprise p-3">
        <div className="fw-semibold">Preset library</div>
        <div className="text-muted small">Click a preset to add it to the ruleset.</div>
        <div className="d-flex flex-wrap gap-2 mt-2">
          {PRESET_LIBRARY.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => onChange([...rules, createPresetRule(preset.id)])}
              disabled={disabled}
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card-enterprise p-3">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div className="fw-semibold">Rules</div>
            <div className="text-muted small">Add regex rules or presets and fine-tune their settings.</div>
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => onChange([...rules, createRegexRule()])}
            disabled={disabled}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            Add regex rule
          </button>
        </div>

        {rules.length === 0 ? (
          <div className="text-muted small mt-2">No rules yet. Add a preset or a regex rule.</div>
        ) : (
          <div className="d-flex flex-column gap-2 mt-3">
            {rules.map((rule, idx) => {
              const error = errors[rule.id];
              const isPreset = rule.type === "preset";
              const isRegex = rule.type === "regex";
              return (
                <div className="border rounded p-3" key={rule.id}>
                  <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap">
                    <div className="flex-grow-1">
                      <label className="form-label small text-muted">Rule name</label>
                      <input
                        className={`form-control form-control-sm${showValidation && error ? " is-invalid" : ""}`}
                        value={rule.name}
                        onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="badge text-bg-light text-dark">{isPreset ? "Preset" : "Regex"}</span>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`rule-enabled-${rule.id}`}
                          checked={rule.enabled}
                          onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                          disabled={disabled}
                        />
                        <label className="form-check-label small" htmlFor={`rule-enabled-${rule.id}`}>
                          Enabled
                        </label>
                      </div>
                      <div className="btn-group btn-group-sm" role="group" aria-label="Reorder rule">
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => moveRule(rule.id, -1)}
                          disabled={disabled || idx === 0}
                          title="Move up"
                        >
                          <i className="bi bi-arrow-up" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => moveRule(rule.id, 1)}
                          disabled={disabled || idx === rules.length - 1}
                          title="Move down"
                        >
                          <i className="bi bi-arrow-down" aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => removeRule(rule.id)}
                        disabled={disabled}
                        title="Remove rule"
                      >
                        <i className="bi bi-trash" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {isRegex ? (
                    <div className="row g-2 mt-2">
                      <div className="col-md-5">
                        <label className="form-label small text-muted">Pattern</label>
                        <input
                          className="form-control form-control-sm"
                          value={(rule.config as RegexRuleConfig).pattern}
                          onChange={(e) => updateRuleConfig(rule.id, { pattern: e.target.value })}
                          placeholder="e.g. \\s+"
                          disabled={disabled}
                        />
                      </div>
                      <div className="col-md-2">
                        <label className="form-label small text-muted">Flags</label>
                        <input
                          className="form-control form-control-sm"
                          value={(rule.config as RegexRuleConfig).flags}
                          onChange={(e) => updateRuleConfig(rule.id, { flags: e.target.value })}
                          placeholder="g"
                          disabled={disabled}
                        />
                      </div>
                      <div className="col-md-5">
                        <label className="form-label small text-muted">Replace</label>
                        <input
                          className="form-control form-control-sm"
                          value={(rule.config as RegexRuleConfig).replace}
                          onChange={(e) => updateRuleConfig(rule.id, { replace: e.target.value })}
                          placeholder="e.g. "
                          disabled={disabled}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label small text-muted">Apply scope</label>
                        <select
                          className="form-select form-select-sm"
                          value={(rule.config as RegexRuleConfig).scope}
                          onChange={(e) =>
                            updateRuleConfig(rule.id, { scope: e.target.value as RegexRuleConfig["scope"] })
                          }
                          disabled={disabled}
                        >
                          {RULE_SCOPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}

                  {isPreset ? (
                    <div className="row g-2 mt-2">
                      {(() => {
                        const config = rule.config as PresetRuleConfig;
                        switch (config.presetId) {
                          case "sentence-case":
                            return (
                              <div className="col-12">
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id={`sentence-space-${rule.id}`}
                                    checked={config.ensureSingleSpaceAfterPunctuation}
                                    onChange={(e) =>
                                      updateRuleConfig(rule.id, { ensureSingleSpaceAfterPunctuation: e.target.checked })
                                    }
                                    disabled={disabled}
                                  />
                                  <label className="form-check-label small" htmlFor={`sentence-space-${rule.id}`}>
                                    Ensure single space after .?!
                                  </label>
                                </div>
                              </div>
                            );
                          case "normalize-whitespace":
                            return (
                              <div className="col-12 d-flex flex-column gap-2">
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id={`collapse-${rule.id}`}
                                    checked={config.collapseSpaces}
                                    onChange={(e) => updateRuleConfig(rule.id, { collapseSpaces: e.target.checked })}
                                    disabled={disabled}
                                  />
                                  <label className="form-check-label small" htmlFor={`collapse-${rule.id}`}>
                                    Collapse multiple spaces into one
                                  </label>
                                </div>
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id={`trim-${rule.id}`}
                                    checked={config.trimEdges}
                                    onChange={(e) => updateRuleConfig(rule.id, { trimEdges: e.target.checked })}
                                    disabled={disabled}
                                  />
                                  <label className="form-check-label small" htmlFor={`trim-${rule.id}`}>
                                    Trim leading/trailing spaces per segment
                                  </label>
                                </div>
                              </div>
                            );
                          case "punctuation-spacing":
                            return (
                              <div className="col-12 d-flex flex-column gap-2">
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id={`punct-before-${rule.id}`}
                                    checked={config.removeSpaceBefore}
                                    onChange={(e) =>
                                      updateRuleConfig(rule.id, { removeSpaceBefore: e.target.checked })
                                    }
                                    disabled={disabled}
                                  />
                                  <label className="form-check-label small" htmlFor={`punct-before-${rule.id}`}>
                                    Remove space before , . ; : ! ?
                                  </label>
                                </div>
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id={`punct-after-${rule.id}`}
                                    checked={config.ensureSpaceAfter}
                                    onChange={(e) =>
                                      updateRuleConfig(rule.id, { ensureSpaceAfter: e.target.checked })
                                    }
                                    disabled={disabled}
                                  />
                                  <label className="form-check-label small" htmlFor={`punct-after-${rule.id}`}>
                                    Ensure space after punctuation
                                  </label>
                                </div>
                              </div>
                            );
                          case "smart-quotes":
                            return (
                              <div className="col-12">
                                <div className="text-muted small">Smart quotes are converted to straight quotes.</div>
                              </div>
                            );
                          case "number-format-guard":
                            return (
                              <div className="col-12">
                                <div className="text-muted small">
                                  Protects digit groups so other rules do not alter numbers.
                                </div>
                              </div>
                            );
                          default:
                            return (
                              <div className="col-12">
                                <div className="text-muted small">No configurable options for this preset.</div>
                              </div>
                            );
                        }
                      })()}
                    </div>
                  ) : null}

                  {showValidation && error ? (
                    <div className="text-danger small mt-2">{error}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
