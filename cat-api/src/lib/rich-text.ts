export type RichTextStyle = {
  fontFamily?: string | null;
  fontSizePt?: number | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string | null;
};

export type RichTextRunMeta = {
  tagId?: string | null;
  nonTranslatable?: boolean;
  placeholderType?: string | null;
};

export type RichTextRun = {
  text: string;
  style?: RichTextStyle | null;
  meta?: RichTextRunMeta | null;
};

export type SegmentContainerContext = {
  fileType?: string | null;
  partPath?: string | null;
  slideIndex?: number | null;
  shapeIndex?: number | null;
  paragraphIndex?: number | null;
  sheetName?: string | null;
  cellRef?: string | null;
  styleId?: number | null;
  numberFormat?: string | null;
  wrapText?: boolean | null;
  alignment?: string | null;
  richText?: boolean | null;
  [key: string]: unknown;
};

export type SegmentOriginDetails = {
  engineId?: string | null;
  tmId?: string | null;
  matchScore?: number | null;
  [key: string]: unknown;
};

function normalizeColor(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const compact = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{8}$/.test(compact)) {
    return compact.slice(2).toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(compact)) {
    return compact.toUpperCase();
  }
  return null;
}

function normalizeFontFamily(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function normalizeFontSize(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function normalizeRichTextStyle(value: unknown): RichTextStyle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const style: RichTextStyle = {};

  const fontFamily = normalizeFontFamily(raw.fontFamily);
  if (fontFamily) style.fontFamily = fontFamily;

  const fontSizePt = normalizeFontSize(raw.fontSizePt);
  if (fontSizePt != null) style.fontSizePt = fontSizePt;

  if (raw.bold === true) style.bold = true;
  if (raw.italic === true) style.italic = true;
  if (raw.underline === true) style.underline = true;

  const color = normalizeColor(raw.color);
  if (color) style.color = color;

  return Object.keys(style).length > 0 ? style : undefined;
}

export function normalizeSegmentContext(value: unknown): SegmentContainerContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) } as SegmentContainerContext;
}

export function normalizeOriginDetails(value: unknown): SegmentOriginDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) } as SegmentOriginDetails;
}

function normalizeRunMeta(value: unknown): RichTextRunMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const meta: RichTextRunMeta = {};
  const tagId = String(raw.tagId ?? "").trim();
  if (tagId) meta.tagId = tagId;
  if (raw.nonTranslatable === true) meta.nonTranslatable = true;
  const placeholderType = String(raw.placeholderType ?? "").trim();
  if (placeholderType) meta.placeholderType = placeholderType;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

export function normalizeRichTextRuns(input: unknown, fallbackText = ""): RichTextRun[] {
  if (!Array.isArray(input)) {
    const text = String(fallbackText ?? "");
    if (!text) return [];
    return [{ text }];
  }

  const runs: RichTextRun[] = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const text = String(raw.text ?? "");
    if (text.length === 0) continue;
    const style = normalizeRichTextStyle(raw.style);
    const meta = normalizeRunMeta(raw.meta);
    runs.push({
      text,
      ...(style ? { style } : {}),
      ...(meta ? { meta } : {})
    });
  }

  if (runs.length === 0) {
    const text = String(fallbackText ?? "");
    if (!text) return [];
    return [{ text }];
  }

  return mergeAdjacentRuns(runs);
}

export function runsToPlainText(runs: RichTextRun[] | null | undefined): string {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  return runs.map((run) => String(run.text ?? "")).join("");
}

function styleKey(style: RichTextStyle | null | undefined) {
  if (!style) return "";
  const normalized = normalizeRichTextStyle(style);
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

export function mergeAdjacentRuns(runs: RichTextRun[]): RichTextRun[] {
  const merged: RichTextRun[] = [];
  for (const run of runs) {
    const text = String(run.text ?? "");
    if (!text) continue;
    const style = normalizeRichTextStyle(run.style);
    const meta = normalizeRunMeta(run.meta);
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({
        text,
        ...(style ? { style } : {}),
        ...(meta ? { meta } : {})
      });
      continue;
    }
    const sameStyle = styleKey(prev.style) === styleKey(style);
    const sameMeta = JSON.stringify(prev.meta ?? null) === JSON.stringify(meta ?? null);
    if (sameStyle && sameMeta) {
      prev.text = `${prev.text}${text}`;
      continue;
    }
    merged.push({
      text,
      ...(style ? { style } : {}),
      ...(meta ? { meta } : {})
    });
  }
  return merged;
}

export function dominantRunStyle(runs: RichTextRun[] | null | undefined): RichTextStyle | undefined {
  const map = new Map<string, { style: RichTextStyle | undefined; chars: number }>();
  for (const run of runs ?? []) {
    const text = String(run.text ?? "");
    if (!text) continue;
    const style = normalizeRichTextStyle(run.style);
    const key = styleKey(style);
    const entry = map.get(key) ?? { style, chars: 0 };
    entry.chars += text.length;
    map.set(key, entry);
  }

  let best: { style: RichTextStyle | undefined; chars: number } | null = null;
  for (const entry of map.values()) {
    if (!best || entry.chars > best.chars) best = entry;
  }
  return best?.style;
}

function allocateProportionalCounts(templateRuns: RichTextRun[], targetLength: number): number[] {
  if (targetLength <= 0) return [];
  const weighted = templateRuns
    .map((run) => String(run.text ?? "").length)
    .map((length, index) => ({ index, length }))
    .filter((entry) => entry.length > 0);
  if (weighted.length === 0) return [];
  const total = weighted.reduce((sum, entry) => sum + entry.length, 0);
  if (total <= 0) return [];

  const counts = new Array<number>(templateRuns.length).fill(0);
  const fractions: Array<{ index: number; remainder: number }> = [];

  for (const entry of weighted) {
    const exact = (entry.length / total) * targetLength;
    const floor = Math.floor(exact);
    counts[entry.index] = floor;
    fractions.push({ index: entry.index, remainder: exact - floor });
  }

  let remainder = targetLength - counts.reduce((sum, value) => sum + value, 0);
  fractions.sort((a, b) => b.remainder - a.remainder);
  let pointer = 0;
  while (remainder > 0 && fractions.length > 0) {
    const slot = fractions[pointer % fractions.length];
    counts[slot.index] += 1;
    remainder -= 1;
    pointer += 1;
  }
  return counts;
}

export function projectTextToTemplateRuns(params: {
  text: string;
  templateRuns: RichTextRun[] | null | undefined;
  fallbackRuns?: RichTextRun[] | null | undefined;
}): RichTextRun[] {
  const text = String(params.text ?? "");
  if (!text) return [];

  const primary = normalizeRichTextRuns(params.templateRuns, "");
  const fallback = normalizeRichTextRuns(params.fallbackRuns, "");
  const basis = primary.length > 0 ? primary : fallback;

  if (basis.length === 0) {
    return [{ text }];
  }

  if (basis.length === 1) {
    const only = basis[0]!;
    return [
      {
        text,
        ...(only.style ? { style: normalizeRichTextStyle(only.style) } : {}),
        ...(only.meta ? { meta: normalizeRunMeta(only.meta) } : {})
      }
    ];
  }

  const counts = allocateProportionalCounts(basis, text.length);
  if (counts.length === 0) {
    const style = dominantRunStyle(basis);
    return [{ text, ...(style ? { style } : {}) }];
  }

  const runs: RichTextRun[] = [];
  let offset = 0;
  for (let i = 0; i < basis.length; i += 1) {
    const count = counts[i] ?? 0;
    if (count <= 0) continue;
    const part = text.slice(offset, offset + count);
    offset += count;
    if (!part) continue;
    const template = basis[i]!;
    const style = normalizeRichTextStyle(template.style);
    const meta = normalizeRunMeta(template.meta);
    runs.push({
      text: part,
      ...(style ? { style } : {}),
      ...(meta ? { meta } : {})
    });
  }

  if (offset < text.length) {
    const remainder = text.slice(offset);
    if (runs.length > 0) {
      runs[runs.length - 1]!.text += remainder;
    } else {
      const style = dominantRunStyle(basis);
      runs.push({ text: remainder, ...(style ? { style } : {}) });
    }
  }

  return mergeAdjacentRuns(runs);
}

export function sanitizeRunsForText(text: string, runs: RichTextRun[] | null | undefined): RichTextRun[] {
  const normalizedText = String(text ?? "");
  const normalizedRuns = normalizeRichTextRuns(runs, normalizedText);
  const flattened = runsToPlainText(normalizedRuns);
  if (flattened === normalizedText) return normalizedRuns;
  return projectTextToTemplateRuns({ text: normalizedText, templateRuns: normalizedRuns });
}

