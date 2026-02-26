import { toText } from "../utils.js";
import type { ConcordanceMatchType, TermStatus } from "./termbases.helpers.js";

export function normalizeConcordanceText(value: any): string {
  const raw = toText(value).toLowerCase();
  if (!raw.trim()) return "";
  const umlauted = raw
    .replace(/Ã¤/g, "ae")
    .replace(/Ã¶/g, "oe")
    .replace(/Ã¼/g, "ue")
    .replace(/ÃŸ/g, "ss")
    .replace(/ÃƒÂ¤/g, "ae")
    .replace(/ÃƒÂ¶/g, "oe")
    .replace(/ÃƒÂ¼/g, "ue")
    .replace(/ÃƒÅ¸/g, "ss");
  return umlauted
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function concordanceTokens(value: any): string[] {
  const normalized = normalizeConcordanceText(value);
  if (!normalized) return [];
  return normalized.split(" ").map((t) => t.trim()).filter((t) => t.length > 1);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function boundaryMatch(query: string, term: string): boolean {
  if (!query || !term) return false;
  const rx = new RegExp(`(^|\\s)${escapeRegExp(term)}(\\s|$)`);
  return rx.test(query);
}

export function prefixMatch(queryTokens: string[], term: string): boolean {
  if (!term || term.length < 3) return false;
  return queryTokens.some((token) => token.startsWith(term) || term.startsWith(token));
}

export function tokenOverlap(termTokens: string[], queryTokens: string[]): number {
  if (termTokens.length === 0 || queryTokens.length === 0) return 0;
  const termSet = new Set(termTokens);
  const querySet = new Set(queryTokens);
  let intersection = 0;
  termSet.forEach((token) => {
    if (querySet.has(token)) intersection += 1;
  });
  const union = termSet.size + querySet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function bigramSimilarity(a: string, b: string): number {
  if (!a || !b || a.length < 2 || b.length < 2) return 0;
  const aBigrams: string[] = [];
  for (let i = 0; i < a.length - 1; i += 1) {
    aBigrams.push(a.slice(i, i + 2));
  }
  const bBigrams: string[] = [];
  for (let i = 0; i < b.length - 1; i += 1) {
    bBigrams.push(b.slice(i, i + 2));
  }
  const counts = new Map<string, number>();
  aBigrams.forEach((bg) => counts.set(bg, (counts.get(bg) ?? 0) + 1));
  let intersection = 0;
  bBigrams.forEach((bg) => {
    const count = counts.get(bg) ?? 0;
    if (count > 0) {
      intersection += 1;
      counts.set(bg, count - 1);
    }
  });
  return (2 * intersection) / (aBigrams.length + bBigrams.length);
}

export function matchConcordanceTerm(params: {
  termText: string;
  queryNorm: string;
  queryTokens: string[];
}): { type: ConcordanceMatchType; ratio?: number } | null {
  const termNorm = normalizeConcordanceText(params.termText);
  if (!termNorm || !params.queryNorm) return null;
  if (termNorm === params.queryNorm) return { type: "exact", ratio: 1 };
  if (boundaryMatch(params.queryNorm, termNorm)) return { type: "boundary" };
  if (prefixMatch(params.queryTokens, termNorm)) return { type: "prefix" };
  const termTokens = termNorm.split(" ").filter(Boolean);
  const overlap = tokenOverlap(termTokens, params.queryTokens);
  if (overlap >= 0.5) return { type: "overlap", ratio: overlap };
  const candidates = params.queryTokens.length > 0 ? params.queryTokens : [params.queryNorm];
  let best = 0;
  for (const token of candidates) {
    const ratio = bigramSimilarity(termNorm, token);
    if (ratio > best) best = ratio;
  }
  if (best >= 0.82) return { type: "fuzzy", ratio: best };
  return null;
}

export const MATCH_WEIGHTS: Record<ConcordanceMatchType, number> = {
  exact: 1,
  boundary: 0.9,
  prefix: 0.8,
  overlap: 0.65,
  fuzzy: 0.55
};

export function scoreMatch(match: { type: ConcordanceMatchType; ratio?: number }, status: TermStatus): number {
  let score = MATCH_WEIGHTS[match.type] ?? 0;
  if (match.type === "overlap" && match.ratio) score += Math.min(0.1, match.ratio * 0.1);
  if (match.type === "fuzzy" && match.ratio) score += Math.min(0.1, match.ratio * 0.1);
  if (status === "preferred") score += 0.15;
  if (status === "forbidden") score -= 0.2;
  return score;
}
