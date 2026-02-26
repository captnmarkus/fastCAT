export type IssueSeverity = "error" | "warning";

export type SegmentIssue = {
  code: string;
  severity: IssueSeverity;
  message: string;
};

export type IssueSummary = {
  error: number;
  warning: number;
  byType: Record<string, number>;
};

export type SegmentState = "draft" | "nmt_draft" | "reviewed";

export type TermbaseEntry = {
  source: string;
  preferredTargets: string[];
  forbiddenTargets: string[];
};

export type TermbaseIndex = {
  entries: TermbaseEntry[];
};

const NUMBER_RX = /\d+(?:[.,]\d+)?/g;
const PLACEHOLDER_RX = /<\/?\d+>|\{\d+\}/g;
const TAG_RX = /<\/?[a-z][^>]*>/gi;

function normalizeTagToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (PLACEHOLDER_RX.test(trimmed)) return trimmed;
  const isClosing = /^<\//.test(trimmed);
  const name = trimmed
    .replace(/^<\//, "")
    .replace(/^</, "")
    .replace(/>$/, "")
    .split(/\s+/)[0]
    ?.toLowerCase();
  if (!name) return trimmed;
  return `${isClosing ? "/" : ""}${name}`;
}

function extractTokens(text: string): string[] {
  const tokens: string[] = [];
  const placeholders = text.match(PLACEHOLDER_RX) ?? [];
  placeholders.forEach((token) => {
    tokens.push(token);
  });
  const tags = text.match(TAG_RX) ?? [];
  tags.forEach((token) => {
    const normalized = normalizeTagToken(token);
    if (normalized) tokens.push(normalized);
  });
  return tokens;
}

function countTokens(tokens: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const token of tokens) {
    map[token] = (map[token] ?? 0) + 1;
  }
  return map;
}

function diffTokenCounts(srcTokens: string[], tgtTokens: string[]) {
  const srcCounts = countTokens(srcTokens);
  const tgtCounts = countTokens(tgtTokens);
  const missing: string[] = [];
  const extra: string[] = [];
  Object.keys(srcCounts).forEach((token) => {
    const have = tgtCounts[token] ?? 0;
    if (have < srcCounts[token]!) missing.push(token);
  });
  Object.keys(tgtCounts).forEach((token) => {
    const have = srcCounts[token] ?? 0;
    if (have < tgtCounts[token]!) extra.push(token);
  });
  return { missing, extra };
}

function extractNumbers(text: string): string[] {
  const matches = text.match(NUMBER_RX);
  return matches ? matches.map((m) => m.replace(/[,]/g, ".").trim()) : [];
}

function stripTags(text: string): string {
  return text
    .replace(TAG_RX, " ")
    .replace(PLACEHOLDER_RX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSegmentState(input: any): SegmentState | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  if (value === "draft") return "draft";
  if (value === "nmt_draft" || value === "nmt draft" || value === "nmt-draft") return "nmt_draft";
  if (value === "llm_draft" || value === "llm draft" || value === "llm-draft") return "nmt_draft";
  if (value === "needs_review" || value === "needs review" || value === "needs-review") return "draft";
  if (value === "under_review" || value === "under review" || value === "under-review") return "draft";
  if (value === "reviewed" || value === "approved") return "reviewed";
  return null;
}

export function mapStateToStatus(state: SegmentState): "draft" | "under_review" | "reviewed" {
  if (state === "reviewed") return "reviewed";
  return "draft";
}

export function summarizeIssues(issues: SegmentIssue[]): IssueSummary {
  const summary: IssueSummary = { error: 0, warning: 0, byType: {} };
  for (const issue of issues) {
    if (issue.severity === "error") summary.error += 1;
    else summary.warning += 1;
    summary.byType[issue.code] = (summary.byType[issue.code] ?? 0) + 1;
  }
  return summary;
}

export function computeSegmentIssues(params: {
  src: string;
  tgt: string | null;
  termbase?: TermbaseIndex | null;
}): { issues: SegmentIssue[]; summary: IssueSummary } {
  const src = String(params.src ?? "");
  const target = String(params.tgt ?? "");
  const issues: SegmentIssue[] = [];

  if (!target.trim()) {
    issues.push({
      code: "EMPTY_TARGET",
      severity: "error",
      message: "Target is empty."
    });
    return { issues, summary: summarizeIssues(issues) };
  }

  const srcTokens = extractTokens(src);
  if (srcTokens.length > 0) {
    const tgtTokens = extractTokens(target);
    const { missing, extra } = diffTokenCounts(srcTokens, tgtTokens);
    if (missing.length > 0) {
      issues.push({
        code: "PLACEHOLDER_MISSING",
        severity: "error",
        message: `Missing placeholders: ${missing.join(", ")}`
      });
    }
    if (extra.length > 0) {
      issues.push({
        code: "PLACEHOLDER_MISMATCH",
        severity: "error",
        message: `Extra placeholders: ${extra.join(", ")}`
      });
    }
    if (missing.length === 0 && extra.length === 0 && srcTokens.join("|") !== tgtTokens.join("|")) {
      issues.push({
        code: "PLACEHOLDER_MISMATCH",
        severity: "error",
        message: "Placeholder order differs."
      });
    }
  }

  const srcNums = extractNumbers(src);
  const tgtNums = extractNumbers(target);
  const missingNums = srcNums.filter((n) => !tgtNums.includes(n));
  const extraNums = tgtNums.filter((n) => !srcNums.includes(n));
  if (missingNums.length > 0 || extraNums.length > 0) {
    issues.push({
      code: "NUMBER_MISMATCH",
      severity: "warning",
      message: "Numbers differ between source and target."
    });
  }

  const srcLen = stripTags(src).length;
  const tgtLen = stripTags(target).length;
  if (srcLen > 0 && tgtLen > 0) {
    const ratio = tgtLen / srcLen;
    if (ratio < 0.5 || ratio > 2.0) {
      issues.push({
        code: "LENGTH_ANOMALY",
        severity: "warning",
        message: `Length ratio ${ratio.toFixed(2)}.`
      });
    }
  }

  const termbase = params.termbase;
  if (termbase?.entries && termbase.entries.length > 0) {
    const srcLower = src.toLowerCase();
    const tgtLower = target.toLowerCase();
    const seen = new Set<string>();
    for (const entry of termbase.entries) {
      const sourceTerm = String(entry.source ?? "").trim();
      if (!sourceTerm) continue;
      if (!srcLower.includes(sourceTerm.toLowerCase())) continue;
      if (entry.forbiddenTargets.length > 0) {
        const forbiddenUsed = entry.forbiddenTargets.some((term) => tgtLower.includes(term.toLowerCase()));
        if (forbiddenUsed) {
          const key = `forbidden:${sourceTerm}`;
          if (!seen.has(key)) {
            seen.add(key);
            issues.push({
              code: "TERM_FORBIDDEN_USED",
              severity: "warning",
              message: `Forbidden term used for "${sourceTerm}".`
            });
          }
        }
      }
      if (entry.preferredTargets.length > 0) {
        const hasPreferred = entry.preferredTargets.some((term) => tgtLower.includes(term.toLowerCase()));
        if (!hasPreferred) {
          const key = `missing:${sourceTerm}`;
          if (!seen.has(key)) {
            seen.add(key);
            issues.push({
              code: "TERM_MISSING_PREFERRED",
              severity: "warning",
              message: `Missing preferred translation for "${sourceTerm}".`
            });
          }
        }
      }
    }
  }

  return { issues, summary: summarizeIssues(issues) };
}
