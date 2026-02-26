export type SegmentIssue = {
  code: string;
  message: string;
  severity: "warning" | "error";
};

export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g);
  return matches ? matches.map((m) => m.replace(/[,]/g, ".").trim()) : [];
}

export function extractPlaceholders(text: string): string[] {
  const matches = text.match(/<\/?\d+>|\{\d+\}/g);
  return matches ? matches : [];
}

function countTokens(tokens: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  tokens.forEach((token) => {
    map[token] = (map[token] ?? 0) + 1;
  });
  return map;
}

function tagImbalanceMessage(text: string): string | null {
  const tags = text.match(/<\/?\d+>/g) ?? [];
  const stack: string[] = [];
  for (const raw of tags) {
    const token = raw.replace(/[<>/]/g, "");
    if (raw.startsWith("</")) {
      const last = stack.pop();
      if (!last || last !== token) {
        return "Tag imbalance in target.";
      }
    } else {
      stack.push(token);
    }
  }
  if (stack.length > 0) return "Tag imbalance in target.";
  return null;
}

export function trailingPunctuation(text: string): string | null {
  const m = text.trim().match(/([.!?;:])$/);
  return m ? m[1] : null;
}

export function computeQaWarnings(src: string, tgt: string | null): SegmentIssue[] {
  const warnings: SegmentIssue[] = [];
  const target = tgt || "";

  if (!target.length) {
    warnings.push({
      code: "empty-target",
      message: "Target is empty",
      severity: "error"
    });
    return warnings;
  }

  const srcLeading = /^\s/.test(src);
  const tgtLeading = /^\s/.test(target);
  const srcTrailing = /\s$/.test(src);
  const tgtTrailing = /\s$/.test(target);
  if (srcLeading !== tgtLeading || srcTrailing !== tgtTrailing) {
    warnings.push({
      code: "space-mismatch",
      message: "Leading/trailing spaces differ",
      severity: "warning"
    });
  }
  if (/( {2,}|\u00a0{2,})/.test(target)) {
    warnings.push({
      code: "double-space",
      message: "Double spaces in target",
      severity: "warning"
    });
  }
  const srcPunct = trailingPunctuation(src);
  const tgtPunct = trailingPunctuation(target);
  if (srcPunct && tgtPunct && srcPunct !== tgtPunct) {
    warnings.push({
      code: "punctuation",
      message: "Ending punctuation differs",
      severity: "warning"
    });
  }
  const srcNums = extractNumbers(src);
  const tgtNums = extractNumbers(target);
  const missingNums = srcNums.filter((n) => !tgtNums.includes(n));
  const extraNums = tgtNums.filter((n) => !srcNums.includes(n));
  if (missingNums.length || extraNums.length) {
    warnings.push({
      code: "numbers",
      message: "Number mismatch",
      severity: "warning"
    });
  }
  const srcCapital = /^[A-ZÁÄÅÆÇÉÈÍÏÑÖØÜÝŽ]/i.test(src);
  const tgtCapital = /^[A-ZÁÄÅÆÇÉÈÍÏÑÖØÜÝŽ]/i.test(target);
  if (srcCapital && !tgtCapital) {
    warnings.push({
      code: "casing",
      message: "Target casing differs at start",
      severity: "warning"
    });
  }

  const srcPlaceholders = extractPlaceholders(src);
  if (srcPlaceholders.length > 0) {
    const tgtPlaceholders = extractPlaceholders(target);
    const srcCounts = countTokens(srcPlaceholders);
    const tgtCounts = countTokens(tgtPlaceholders);
    const missing = Object.keys(srcCounts).filter((token) => (tgtCounts[token] ?? 0) < srcCounts[token]!);
    const extra = Object.keys(tgtCounts).filter((token) => (srcCounts[token] ?? 0) < tgtCounts[token]!);
    if (missing.length > 0) {
      warnings.push({
        code: "placeholder-missing",
        message: `Missing placeholders: ${missing.join(", ")}`,
        severity: "error"
      });
    }
    if (extra.length > 0) {
      warnings.push({
        code: "placeholder-extra",
        message: `Extra placeholders: ${extra.join(", ")}`,
        severity: "warning"
      });
    }
    if (missing.length === 0 && extra.length === 0 && srcPlaceholders.join("|") !== tgtPlaceholders.join("|")) {
      warnings.push({
        code: "placeholder-order",
        message: "Placeholder order differs",
        severity: "warning"
      });
    }
  }

  const imbalance = tagImbalanceMessage(target);
  if (imbalance) {
    warnings.push({
      code: "tag-imbalance",
      message: imbalance,
      severity: "error"
    });
  }
  return warnings;
}
