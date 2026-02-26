import type { Segment } from "../api";

export type ConcordanceMatchType = "exact" | "boundary" | "prefix" | "overlap" | "fuzzy";

export type Occurrence = {
  segmentId: number;
  segmentNo: number;
};

export type OccurrenceIndex = {
  tokenMap: Map<string, { source: Set<number>; target: Set<number> }>;
  sourceById: Map<number, string>;
  targetById: Map<number, string>;
  segmentNoById: Map<number, number>;
};

function tokensFromNormalized(normalized: string): string[] {
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function normalizeConcordanceText(value: string): string {
  const raw = String(value ?? "").toLowerCase();
  if (!raw.trim()) return "";
  const umlauted = raw
    .replace(/\u00e4/g, "ae")
    .replace(/\u00f6/g, "oe")
    .replace(/\u00fc/g, "ue")
    .replace(/\u00df/g, "ss")
    .replace(/\u00c3\u00a4/g, "ae")
    .replace(/\u00c3\u00b6/g, "oe")
    .replace(/\u00c3\u00bc/g, "ue")
    .replace(/\u00c3\u009f/g, "ss");
  return umlauted
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function concordanceTokens(value: string): string[] {
  return tokensFromNormalized(normalizeConcordanceText(value));
}

export function buildOccurrenceIndex(segments: Segment[]): OccurrenceIndex {
  const tokenMap = new Map<string, { source: Set<number>; target: Set<number> }>();
  const sourceById = new Map<number, string>();
  const targetById = new Map<number, string>();
  const segmentNoById = new Map<number, number>();

  const addToken = (token: string, segmentId: number, side: "source" | "target") => {
    if (!token) return;
    let entry = tokenMap.get(token);
    if (!entry) {
      entry = { source: new Set(), target: new Set() };
      tokenMap.set(token, entry);
    }
    entry[side].add(segmentId);
  };

  for (const seg of segments) {
    segmentNoById.set(seg.id, Number(seg.index) + 1);
    const srcNorm = normalizeConcordanceText(seg.src ?? "");
    sourceById.set(seg.id, srcNorm);
    tokensFromNormalized(srcNorm).forEach((token) => addToken(token, seg.id, "source"));

    const tgtNorm = normalizeConcordanceText(seg.tgt ?? "");
    targetById.set(seg.id, tgtNorm);
    tokensFromNormalized(tgtNorm).forEach((token) => addToken(token, seg.id, "target"));
  }

  return { tokenMap, sourceById, targetById, segmentNoById };
}

function candidateSegments(
  index: OccurrenceIndex,
  tokens: string[],
  side: "source" | "target"
): Set<number> {
  if (tokens.length === 0) {
    const all = new Set<number>();
    const map = side === "source" ? index.sourceById : index.targetById;
    map.forEach((_value, key) => all.add(key));
    return all;
  }

  let result: Set<number> | null = null;
  for (const token of tokens) {
    const entry = index.tokenMap.get(token);
    if (!entry) return new Set();
    const next = entry[side];
    if (!result) {
      result = new Set(next);
    } else {
      result = new Set(Array.from(result).filter((id) => next.has(id)));
    }
  }
  return result ?? new Set();
}

export function findOccurrences(
  index: OccurrenceIndex,
  term: string
): { source: Occurrence[]; target: Occurrence[] } {
  const normalizedTerm = normalizeConcordanceText(term);
  if (!normalizedTerm) return { source: [], target: [] };
  const tokens = tokensFromNormalized(normalizedTerm);

  const sourceCandidates = candidateSegments(index, tokens, "source");
  const targetCandidates = candidateSegments(index, tokens, "target");

  const source: Occurrence[] = [];
  const target: Occurrence[] = [];

  sourceCandidates.forEach((segmentId) => {
    const text = index.sourceById.get(segmentId) ?? "";
    if (!text || !text.includes(normalizedTerm)) return;
    source.push({
      segmentId,
      segmentNo: index.segmentNoById.get(segmentId) ?? 0
    });
  });

  targetCandidates.forEach((segmentId) => {
    const text = index.targetById.get(segmentId) ?? "";
    if (!text || !text.includes(normalizedTerm)) return;
    target.push({
      segmentId,
      segmentNo: index.segmentNoById.get(segmentId) ?? 0
    });
  });

  const sortByNo = (a: Occurrence, b: Occurrence) => a.segmentNo - b.segmentNo;
  source.sort(sortByNo);
  target.sort(sortByNo);

  return { source, target };
}

export function findHighlightRange(
  text: string,
  query: string
): { start: number; end: number } | null {
  const rawText = String(text ?? "");
  const rawQuery = String(query ?? "").trim();
  if (!rawText || !rawQuery) return null;

  const lowerText = rawText.toLowerCase();
  const rawTokens = rawQuery
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
  const normalizedTokens = concordanceTokens(rawQuery);
  const tokens = Array.from(new Set([...rawTokens, ...normalizedTokens])).sort(
    (a, b) => b.length - a.length
  );

  for (const token of tokens) {
    const idx = lowerText.indexOf(token.toLowerCase());
    if (idx >= 0) return { start: idx, end: idx + token.length };
  }

  const fallbackIdx = lowerText.indexOf(rawQuery.toLowerCase());
  if (fallbackIdx >= 0) {
    return { start: fallbackIdx, end: fallbackIdx + rawQuery.length };
  }

  return null;
}
