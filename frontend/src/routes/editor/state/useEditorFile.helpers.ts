import type { Segment, SegmentSourceType, TermbaseMatchEntry } from "../../../api";
import { computeQaWarnings, type SegmentIssue } from "../../../utils/qa";
import type { SegmentState } from "../../../types/app";
import type { GlossaryCardEntry, GlossaryHighlightMatch } from "../../../utils/termbase";

export type DirtyReason = "tgt" | "state" | "source" | "format";

export type DirtyEntry = {
  reason: DirtyReason;
  updatedAtMs: number;
};

export type SaveFailure = {
  segmentId: number;
  message: string;
  kind: "conflict" | "offline" | "error";
};

export type InFlightSave = {
  saveId: number;
  tgt: string;
  state: SegmentState;
  localRevision: number;
  serverRevision: number;
};

export type SegmentHistory = {
  past: string[];
  future: string[];
};

export type IssueListItem = {
  segmentId: number;
  segmentNo: number;
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type SourceMeta = {
  type: SegmentSourceType;
  score: number | null;
  matchId?: string | null;
};

export function isNetworkError(err: any): boolean {
  const msg = String(err?.message || "");
  return err?.name === "TypeError" || msg.includes("NetworkError") || msg.includes("Failed to fetch");
}

export function stripInlineTags(value: string): string {
  return String(value ?? "")
    .replace(/<\/?\d+>/g, " ")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildIssuesList(segments: Segment[], issuesById: Record<number, SegmentIssue[]>): IssueListItem[] {
  const list: IssueListItem[] = [];
  for (const seg of segments) {
    const issues = issuesById[seg.id] ?? seg.issues ?? [];
    if (!issues || issues.length === 0) continue;
    const segmentNo = (seg.index ?? 0) + 1;
    for (const issue of issues) {
      list.push({
        segmentId: seg.id,
        segmentNo,
        severity: issue.severity,
        code: issue.code,
        message: issue.message
      });
    }
  }
  return list.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    if (a.segmentNo !== b.segmentNo) return a.segmentNo - b.segmentNo;
    return a.code.localeCompare(b.code);
  });
}

function computeTerminologyWarnings(
  src: string,
  tgt: string | null | undefined,
  getGlossaryMatchesForText: (value: string) => GlossaryHighlightMatch[]
): SegmentIssue[] {
  const warnings: SegmentIssue[] = [];
  const target = String(tgt ?? "");
  if (!target.trim()) return warnings;
  const matches = getGlossaryMatchesForText(src);
  if (matches.length === 0) return warnings;
  const targetLower = target.toLowerCase();
  const seen = new Set<string>();
  for (const match of matches) {
    const matchLower = match.term.toLowerCase();
    for (const entry of match.entries) {
      const sourceTerm =
        entry.source?.terms.find((term) => term.text.toLowerCase() === matchLower) ?? null;
      if (!sourceTerm || sourceTerm.status !== "forbidden") continue;
      const preferredTargets = (entry.target?.terms ?? []).filter((term) => term.status === "preferred");
      const hasPreferred = preferredTargets.some((term) => targetLower.includes(term.text.toLowerCase()));
      const key = `${entry.entryId}:${sourceTerm.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hasPreferred) continue;
      if (preferredTargets.length > 0) {
        warnings.push({
          code: "forbidden-term",
          message: `Forbidden term "${sourceTerm.text}". Use: ${preferredTargets.map((t) => t.text).join(", ")}`,
          severity: "warning"
        });
      } else {
        warnings.push({
          code: "forbidden-term",
          message: `Forbidden term "${sourceTerm.text}" has no preferred replacement.`,
          severity: "warning"
        });
      }
    }
  }
  return warnings;
}

export function computeSegmentIssues(
  src: string,
  tgt: string | null | undefined,
  getGlossaryMatchesForText: (value: string) => GlossaryHighlightMatch[]
): SegmentIssue[] {
  const warnings = computeQaWarnings(src, tgt);
  const termWarnings = computeTerminologyWarnings(src, tgt, getGlossaryMatchesForText);
  if (termWarnings.length === 0) return warnings;
  return [...warnings, ...termWarnings];
}

export function resolveSegmentIssues(
  seg: Segment,
  getGlossaryMatchesForText: (value: string) => GlossaryHighlightMatch[],
  tgtOverride?: string | null
): SegmentIssue[] {
  if (tgtOverride !== undefined) {
    return computeSegmentIssues(seg.src, tgtOverride, getGlossaryMatchesForText);
  }
  if (Array.isArray(seg.issues)) return seg.issues;
  return computeSegmentIssues(seg.src, seg.tgt, getGlossaryMatchesForText);
}

export function buildGlossaryTermIndex(termbaseEntries: TermbaseMatchEntry[]): Map<string, GlossaryHighlightMatch> {
  const map = new Map<string, GlossaryHighlightMatch>();
  for (const entry of termbaseEntries) {
    const terms = entry.source?.terms ?? [];
    for (const term of terms) {
      const text = String(term.text ?? "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { term: text, entries: [entry] });
      } else if (!existing.entries.some((item) => item.entryId === entry.entryId)) {
        existing.entries.push(entry);
      }
    }
  }
  return map;
}

export function getGlossaryMatchesForTextFromIndex(params: {
  text: string;
  termIndex: Map<string, GlossaryHighlightMatch>;
  cache: Map<string, GlossaryHighlightMatch[]>;
}): GlossaryHighlightMatch[] {
  const raw = String(params.text ?? "");
  if (!raw || params.termIndex.size === 0) return [];
  const cleaned = raw.replace(/<\/?\d+>/g, "").replace(/<\/?(?:b|strong|i|em|u)>/gi, "");
  const key = cleaned.toLowerCase();
  const cached = params.cache.get(key);
  if (cached) return cached;
  const matches: GlossaryHighlightMatch[] = [];
  for (const [termKey, match] of params.termIndex.entries()) {
    if (key.includes(termKey)) matches.push(match);
  }
  params.cache.set(key, matches);
  return matches;
}

export function buildGlossaryEntries(matches: GlossaryHighlightMatch[]): GlossaryCardEntry[] {
  if (matches.length === 0) return [];
  const map = new Map<string, GlossaryCardEntry>();
  for (const match of matches) {
    for (const entry of match.entries) {
      const existing = map.get(entry.entryId) ?? { ...entry, matchedSourceTerms: [] };
      existing.matchedSourceTerms.push(match.term);
      map.set(entry.entryId, existing);
    }
  }
  return Array.from(map.values()).map((entry) => ({
    ...entry,
    matchedSourceTerms: Array.from(new Set(entry.matchedSourceTerms))
  }));
}
