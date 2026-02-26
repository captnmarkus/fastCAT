import type { SegmentRun, SegmentRunStyle } from "../api";

function normalizeStyle(style: SegmentRunStyle | null | undefined): SegmentRunStyle | undefined {
  if (!style || typeof style !== "object") return undefined;
  const out: SegmentRunStyle = {};
  if (style.fontFamily) out.fontFamily = String(style.fontFamily);
  if (style.fontSizePt != null && Number.isFinite(Number(style.fontSizePt))) {
    const size = Number(style.fontSizePt);
    if (size > 0) out.fontSizePt = Math.round(size * 100) / 100;
  }
  if (style.bold === true) out.bold = true;
  if (style.italic === true) out.italic = true;
  if (style.underline === true) out.underline = true;
  if (style.color) out.color = String(style.color).replace(/^#/, "").toUpperCase();
  return Object.keys(out).length > 0 ? out : undefined;
}

function styleKey(style: SegmentRunStyle | null | undefined) {
  const normalized = normalizeStyle(style);
  if (!normalized) return "";
  return JSON.stringify({
    fontFamily: normalized.fontFamily ?? null,
    fontSizePt: normalized.fontSizePt ?? null,
    bold: normalized.bold === true,
    italic: normalized.italic === true,
    underline: normalized.underline === true,
    color: normalized.color ?? null
  });
}

export function normalizeRuns(input: SegmentRun[] | null | undefined, fallbackText = ""): SegmentRun[] {
  if (!Array.isArray(input) || input.length === 0) {
    const text = String(fallbackText ?? "");
    return text ? [{ text }] : [];
  }
  const out: SegmentRun[] = [];
  for (const run of input) {
    const text = String(run?.text ?? "");
    if (!text) continue;
    const style = normalizeStyle(run?.style);
    const next: SegmentRun = { text };
    if (style) next.style = style;
    if (run?.meta) next.meta = run.meta;
    const prev = out[out.length - 1];
    if (prev && styleKey(prev.style) === styleKey(next.style)) {
      prev.text += next.text;
    } else {
      out.push(next);
    }
  }
  if (out.length === 0) {
    const text = String(fallbackText ?? "");
    return text ? [{ text }] : [];
  }
  return out;
}

export function runsToText(runs: SegmentRun[] | null | undefined): string {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  return runs.map((run) => String(run.text ?? "")).join("");
}

function allocateCounts(template: SegmentRun[], length: number): number[] {
  const weighted = template.map((run, index) => ({ index, len: String(run.text ?? "").length })).filter((item) => item.len > 0);
  if (length <= 0 || weighted.length === 0) return [];
  const total = weighted.reduce((sum, item) => sum + item.len, 0);
  if (total <= 0) return [];
  const counts = new Array<number>(template.length).fill(0);
  const fractions: Array<{ index: number; frac: number }> = [];
  for (const item of weighted) {
    const exact = (item.len / total) * length;
    const floor = Math.floor(exact);
    counts[item.index] = floor;
    fractions.push({ index: item.index, frac: exact - floor });
  }
  let remainder = length - counts.reduce((sum, value) => sum + value, 0);
  fractions.sort((a, b) => b.frac - a.frac);
  let cursor = 0;
  while (remainder > 0 && fractions.length > 0) {
    counts[fractions[cursor % fractions.length]!.index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return counts;
}

export function projectTextToRuns(text: string, templateRuns: SegmentRun[] | null | undefined, fallbackRuns?: SegmentRun[] | null | undefined): SegmentRun[] {
  const normalizedText = String(text ?? "");
  if (!normalizedText) return [];
  const primary = normalizeRuns(templateRuns, "");
  const fallback = normalizeRuns(fallbackRuns, "");
  const basis = primary.length > 0 ? primary : fallback;
  if (basis.length === 0) return [{ text: normalizedText }];
  if (basis.length === 1) {
    return [{ text: normalizedText, ...(basis[0]?.style ? { style: basis[0].style } : {}) }];
  }
  const counts = allocateCounts(basis, normalizedText.length);
  if (counts.length === 0) {
    return [{ text: normalizedText, ...(basis[0]?.style ? { style: basis[0].style } : {}) }];
  }
  const out: SegmentRun[] = [];
  let offset = 0;
  for (let i = 0; i < basis.length; i += 1) {
    const count = counts[i] ?? 0;
    if (count <= 0) continue;
    const part = normalizedText.slice(offset, offset + count);
    offset += count;
    if (!part) continue;
    out.push({ text: part, ...(basis[i]?.style ? { style: basis[i].style } : {}) });
  }
  if (offset < normalizedText.length) {
    const remainder = normalizedText.slice(offset);
    if (out.length > 0) out[out.length - 1]!.text += remainder;
    else out.push({ text: remainder, ...(basis[0]?.style ? { style: basis[0].style } : {}) });
  }
  return normalizeRuns(out, normalizedText);
}

function mergeStyles(base: SegmentRunStyle | undefined, patch: Partial<SegmentRunStyle>): SegmentRunStyle | undefined {
  const merged: SegmentRunStyle = { ...(base ?? {}) };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    (merged as any)[key] = value;
  });
  return normalizeStyle(merged);
}

export function applyStylePatchToRange(params: {
  runs: SegmentRun[];
  text: string;
  start: number;
  end: number;
  patch: Partial<SegmentRunStyle>;
}): SegmentRun[] {
  const normalizedText = String(params.text ?? "");
  const baseRuns = normalizeRuns(params.runs, normalizedText);
  const targetStart = Math.max(0, Math.min(normalizedText.length, Math.floor(params.start)));
  const targetEnd = Math.max(targetStart, Math.min(normalizedText.length, Math.floor(params.end)));
  if (targetStart === targetEnd && normalizedText.length > 0) {
    return baseRuns;
  }
  const out: SegmentRun[] = [];
  let cursor = 0;
  for (const run of baseRuns) {
    const text = String(run.text ?? "");
    if (!text) continue;
    const nextCursor = cursor + text.length;
    const overlapStart = Math.max(cursor, targetStart);
    const overlapEnd = Math.min(nextCursor, targetEnd);
    if (overlapStart >= overlapEnd) {
      out.push(run);
      cursor = nextCursor;
      continue;
    }

    const left = text.slice(0, overlapStart - cursor);
    const mid = text.slice(overlapStart - cursor, overlapEnd - cursor);
    const right = text.slice(overlapEnd - cursor);
    if (left) out.push({ text: left, ...(run.style ? { style: run.style } : {}) });
    if (mid) {
      const mergedStyle = mergeStyles(run.style ?? undefined, params.patch);
      out.push({ text: mid, ...(mergedStyle ? { style: mergedStyle } : {}) });
    }
    if (right) out.push({ text: right, ...(run.style ? { style: run.style } : {}) });
    cursor = nextCursor;
  }
  return normalizeRuns(out, normalizedText);
}

function dominantFontSizePt(runs: SegmentRun[], fallbackPt: number): number {
  const scores = new Map<number, number>();
  for (const run of runs) {
    const text = String(run.text ?? "");
    if (!text) continue;
    const size = Number(run.style?.fontSizePt);
    if (!Number.isFinite(size) || size <= 0) continue;
    scores.set(size, (scores.get(size) ?? 0) + text.length);
  }
  let selected = fallbackPt;
  let bestScore = -1;
  for (const [size, score] of scores.entries()) {
    if (score > bestScore) {
      selected = size;
      bestScore = score;
    }
  }
  return selected;
}

export function adjustFontSizeInRange(params: {
  runs: SegmentRun[];
  text: string;
  start: number;
  end: number;
  deltaPt: number;
  minPt?: number;
  maxPt?: number;
  fallbackPt?: number;
}): SegmentRun[] {
  const normalizedText = String(params.text ?? "");
  const baseRuns = normalizeRuns(params.runs, normalizedText);
  if (!normalizedText || !Number.isFinite(params.deltaPt) || params.deltaPt === 0) return baseRuns;
  const targetStart = Math.max(0, Math.min(normalizedText.length, Math.floor(params.start)));
  const targetEnd = Math.max(targetStart, Math.min(normalizedText.length, Math.floor(params.end)));
  if (targetStart === targetEnd) return baseRuns;

  const minPt = Number.isFinite(params.minPt) ? Math.max(1, Number(params.minPt)) : 6;
  const maxPt = Number.isFinite(params.maxPt) ? Math.max(minPt, Number(params.maxPt)) : 96;
  const fallbackPtRaw = Number(params.fallbackPt);
  const fallbackPt = Number.isFinite(fallbackPtRaw) && fallbackPtRaw > 0 ? fallbackPtRaw : 11;
  const dominantPt = dominantFontSizePt(baseRuns, fallbackPt);

  const out: SegmentRun[] = [];
  let cursor = 0;
  for (const run of baseRuns) {
    const text = String(run.text ?? "");
    if (!text) continue;
    const nextCursor = cursor + text.length;
    const overlapStart = Math.max(cursor, targetStart);
    const overlapEnd = Math.min(nextCursor, targetEnd);
    if (overlapStart >= overlapEnd) {
      out.push(run);
      cursor = nextCursor;
      continue;
    }

    const left = text.slice(0, overlapStart - cursor);
    const mid = text.slice(overlapStart - cursor, overlapEnd - cursor);
    const right = text.slice(overlapEnd - cursor);
    if (left) out.push({ text: left, ...(run.style ? { style: run.style } : {}) });
    if (mid) {
      const baseSizeRaw = Number(run.style?.fontSizePt);
      const baseSize = Number.isFinite(baseSizeRaw) && baseSizeRaw > 0 ? baseSizeRaw : dominantPt;
      const nextSize = Math.max(minPt, Math.min(maxPt, Math.round((baseSize + params.deltaPt) * 100) / 100));
      const mergedStyle = mergeStyles(run.style ?? undefined, { fontSizePt: nextSize });
      out.push({ text: mid, ...(mergedStyle ? { style: mergedStyle } : {}) });
    }
    if (right) out.push({ text: right, ...(run.style ? { style: run.style } : {}) });
    cursor = nextCursor;
  }
  return normalizeRuns(out, normalizedText);
}
