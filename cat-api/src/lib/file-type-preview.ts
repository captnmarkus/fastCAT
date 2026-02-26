import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { HtmlSegmentationResult, HtmlSegmentMapEntry } from "./html-segmentation.js";
import type { ParsingTemplateConfig } from "./parsing-templates.js";

export type PreviewSegmentLocation =
  | { kind: "html"; selector: string }
  | { kind: "attr"; selector: string; attribute: string };

export type PreviewSegment = {
  id: number;
  sourceText: string;
  taggedText: string;
  location?: PreviewSegmentLocation | null;
};

export type PreviewDebugSummary = {
  inlinePlaceholderCount: number;
  errors: string[];
  warnings: string[];
};

export type HtmlPreviewResult = {
  kind: "html";
  total: number;
  segments: PreviewSegment[];
  stats?: HtmlSegmentationResult["stats"] | null;
  debug: PreviewDebugSummary;
};

type RuleSet = { tags: Set<string>; selectors: string[] };

const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/i;
const TAG_TOKEN_RE_GLOBAL = /<\/?\d+>/g;

function splitRules(rules: string[] | undefined | null): RuleSet {
  const tags = new Set<string>();
  const selectors: string[] = [];
  for (const rawRule of Array.isArray(rules) ? rules : []) {
    const rule = String(rawRule ?? "").trim();
    if (!rule) continue;
    if (TAG_NAME_RE.test(rule)) tags.add(rule.toLowerCase());
    else selectors.push(rule);
  }
  return { tags, selectors };
}

function matchesAny($: ReturnType<typeof load>, el: Element, rules: RuleSet): boolean {
  const tag = (el.tagName || "").toLowerCase();
  if (tag && rules.tags.has(tag)) return true;
  if (rules.selectors.length === 0) return false;
  for (const selector of rules.selectors) {
    try {
      if ($(el).is(selector)) return true;
    } catch {
      // ignore invalid selector
    }
  }
  return false;
}

function stripTagTokens(text: string) {
  return String(text ?? "").replace(TAG_TOKEN_RE_GLOBAL, "");
}

function normalizePreviewText(
  input: string,
  opts: { preserveWhitespace: boolean; normalizeSpaces: boolean }
) {
  let out = String(input ?? "");

  if (opts.normalizeSpaces) {
    out = out.replace(/\u00a0/g, " ");
  }

  if (!opts.preserveWhitespace) {
    out = out.replace(/\s+/g, " ").trim();
    return out;
  }

  if (opts.normalizeSpaces) {
    // Keep newlines, normalize runs of horizontal whitespace.
    out = out.replace(/[ \t\f\v\u00a0]+/g, " ");
  }

  return out;
}

function segmentByMode(text: string, mode: "lines" | "sentences"): string[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];

  if (mode === "lines") {
    return raw.split(/\r?\n/).filter((s) => s.trim().length > 0);
  }

  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function htmlSnippetToTaggedText(args: {
  html: string;
  inlineRules: RuleSet;
  ignoredRules: RuleSet;
  xmlMode?: boolean;
  inlineTagPlaceholders: boolean;
  preserveWhitespace: boolean;
}): { taggedText: string; inlinePlaceholderCount: number } {
  const $ = load(`<root>${args.html}</root>`, args.xmlMode ? { xmlMode: true } : undefined);
  const root = $("root").get(0) as Element | undefined;

  let counter = 0;

  function walk(node: AnyNode): string {
    if (!node) return "";
    if (node.type === "text") {
      return String((node as any).data ?? "");
    }

    if (node.type === "tag") {
      const el = node as Element;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "br") return args.preserveWhitespace ? "\n" : " ";
      if (matchesAny($, el, args.ignoredRules)) return "";

      const inner = ((el.children || []) as AnyNode[]).map(walk).join("");
      if (args.inlineTagPlaceholders && matchesAny($, el, args.inlineRules)) {
        const idx = ++counter;
        const isSelfClosing = (el.children || []).length === 0;
        if (isSelfClosing) return `<${idx}>`;
        return `<${idx}>${inner}</${idx}>`;
      }

      return inner;
    }

    const anyNode = node as any;
    if (Array.isArray(anyNode.children)) {
      return (anyNode.children as AnyNode[]).map(walk).join("");
    }

    return "";
  }

  const baseChildren = (root?.children || []) as AnyNode[];
  const taggedText = baseChildren.map(walk).join("");
  return { taggedText, inlinePlaceholderCount: counter };
}

export function buildHtmlPreviewResult(args: {
  parsed: HtmlSegmentationResult;
  templateConfig: ParsingTemplateConfig;
  segmenter: "lines" | "sentences";
  preserveWhitespace: boolean;
  normalizeSpaces: boolean;
  inlineTagPlaceholders: boolean;
  xmlMode?: boolean;
}): HtmlPreviewResult {
  const inlineRules = splitRules(args.templateConfig.inline_tags || []);
  const ignoredRules = splitRules(args.templateConfig.ignored_tags || []);

  const out: PreviewSegment[] = [];
  let id = 1;
  let inlinePlaceholderCount = 0;

  for (let i = 0; i < args.parsed.segments.length; i++) {
    const rawSeg = String(args.parsed.segments[i] ?? "");
    const loc = (args.parsed.map?.[i] ?? null) as HtmlSegmentMapEntry | null;

    let taggedText = rawSeg;
    if (loc?.kind === "html") {
      const rendered = htmlSnippetToTaggedText({
        html: rawSeg,
        inlineRules,
        ignoredRules,
        xmlMode: args.xmlMode,
        inlineTagPlaceholders: args.inlineTagPlaceholders,
        preserveWhitespace: args.preserveWhitespace
      });
      taggedText = rendered.taggedText;
      inlinePlaceholderCount += rendered.inlinePlaceholderCount;
    }

    taggedText = normalizePreviewText(taggedText, {
      preserveWhitespace: args.preserveWhitespace,
      normalizeSpaces: args.normalizeSpaces
    });
    const sourceText = normalizePreviewText(stripTagTokens(taggedText), {
      preserveWhitespace: args.preserveWhitespace,
      normalizeSpaces: args.normalizeSpaces
    });

    const taggedParts = segmentByMode(taggedText, args.segmenter);
    const sourceParts = segmentByMode(sourceText, args.segmenter);
    const max = Math.max(taggedParts.length, sourceParts.length);
    for (let p = 0; p < max; p++) {
      const taggedPart = taggedParts[p] ?? "";
      const sourcePart = sourceParts[p] ?? stripTagTokens(taggedPart);
      if (!taggedPart.trim() && !sourcePart.trim()) continue;
      out.push({
        id: id++,
        sourceText: sourcePart,
        taggedText: taggedPart,
        location: loc
      });
    }
  }

  return {
    kind: "html",
    total: out.length,
    segments: out.slice(0, 500),
    stats: args.parsed.stats ?? null,
    debug: {
      inlinePlaceholderCount,
      errors: [],
      warnings: []
    }
  };
}
