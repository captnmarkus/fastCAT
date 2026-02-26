import xpath from "xpath";
import { DOMParser } from "@xmldom/xmldom";
import type { XmlParsingTemplateConfig } from "./parsing-templates.js";

export type XmlPreviewSegment = {
  path: string;
  taggedText: string;
  sourceText: string;
};

export type XmlPreviewResult = {
  kind: "xml";
  total: number;
  segments: Array<{
    id: number;
    path: string;
    taggedText: string;
    sourceText: string;
  }>;
  stats: { blockMatches: number; inlineMatches: number; ignoredMatches: number; attributeMatches: number };
  debug: { errors: string[]; warnings: string[] };
};

export type XmlExtractionResult = {
  segments: XmlPreviewSegment[];
  stats: { blockMatches: number; inlineMatches: number; ignoredMatches: number; attributeMatches: number };
  debug: { errors: string[]; warnings: string[] };
};

const TAG_TOKEN_RE_GLOBAL = /<\/?\d+>/g;

function stripTagTokens(text: string) {
  return String(text ?? "").replace(TAG_TOKEN_RE_GLOBAL, "");
}

function normalizePreviewText(input: string, opts: { preserveWhitespace: boolean }) {
  let out = String(input ?? "").replace(/\u00a0/g, " ");
  if (!opts.preserveWhitespace) {
    out = out.replace(/\s+/g, " ").trim();
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

function isElement(node: Node): node is Element {
  return Boolean(node && (node as any).nodeType === 1);
}

function isText(node: Node): node is CharacterData {
  const t = (node as any)?.nodeType;
  return t === 3 || t === 4;
}

function elementSiblingIndex(el: Element): number {
  const parent = (el as any).parentNode as Element | null;
  if (!parent) return 1;
  const name = (el as any).nodeName;
  let idx = 0;
  for (const child of Array.from((parent as any).childNodes || [])) {
    if (!isElement(child as any)) continue;
    if ((child as any).nodeName !== name) continue;
    idx += 1;
    if (child === el) return idx;
  }
  return Math.max(1, idx);
}

function nodePath(node: Node): string {
  if (!node) return "";
  if (isElement(node)) {
    const parts: string[] = [];
    let cur: Node | null = node;
    while (cur && isElement(cur)) {
      const name = String((cur as any).nodeName || "");
      const idx = elementSiblingIndex(cur);
      parts.unshift(`${name}[${idx}]`);
      cur = (cur as any).parentNode as any;
      if (cur && (cur as any).nodeType === 9) break;
    }
    return `/${parts.join("/")}`;
  }
  return "";
}

function hasAncestorInSet(node: Node, set: Set<Node>): boolean {
  let cur = (node as any).parentNode as Node | null;
  while (cur) {
    if (set.has(cur)) return true;
    cur = (cur as any).parentNode as Node | null;
  }
  return false;
}

function buildNamespaces(doc: Document, cfg: XmlParsingTemplateConfig): Record<string, string> {
  const out: Record<string, string> = { ...(cfg.namespaces || {}) };
  const prefix = cfg.default_namespace_prefix ? String(cfg.default_namespace_prefix).trim() : "";
  if (prefix && !out[prefix]) {
    const root = (doc as any).documentElement as Element | null;
    const defaultNs = root ? String((root as any).getAttribute?.("xmlns") || "").trim() : "";
    if (defaultNs) out[prefix] = defaultNs;
  }
  return out;
}

export function previewXmlWithTemplate(args: {
  fileBuffer: Buffer;
  template: XmlParsingTemplateConfig;
  segmenter: "lines" | "sentences";
  preserveWhitespace: boolean;
}): XmlPreviewResult {
  const extracted = extractXmlSegmentsWithTemplate(args);
  const out = extracted.segments.slice(0, 500).map((seg, idx) => ({
    id: idx + 1,
    path: seg.path,
    taggedText: seg.taggedText,
    sourceText: seg.sourceText
  }));

  return {
    kind: "xml",
    total: extracted.segments.length,
    segments: out,
    stats: extracted.stats,
    debug: extracted.debug
  };
}

export function extractXmlSegmentsWithTemplate(args: {
  fileBuffer: Buffer;
  template: XmlParsingTemplateConfig;
  segmenter: "lines" | "sentences";
  preserveWhitespace: boolean;
}): XmlExtractionResult {
  const xmlText = args.fileBuffer.toString("utf8");
  const doc = new DOMParser({
    errorHandler: {
      warning() {},
      error(msg) {
        throw new Error(String(msg || "Invalid XML"));
      },
      fatalError(msg) {
        throw new Error(String(msg || "Invalid XML"));
      }
    }
  }).parseFromString(xmlText, "text/xml");

  const namespaces = buildNamespaces(doc as any, args.template);
  const select = Object.keys(namespaces).length > 0 ? xpath.useNamespaces(namespaces) : xpath.select;

  const blockNodes = new Set<Node>();
  const inlineNodes = new Set<Node>();
  const ignoredNodes = new Set<Node>();

  let blockMatches = 0;
  let inlineMatches = 0;
  let ignoredMatches = 0;

  function evalAll(exprs: string[], addTo: Set<Node>, counter: (n: number) => void) {
    for (const expr of exprs) {
      if (!expr) continue;
      let res: any;
      try {
        res = (select as any)(expr, doc);
      } catch (err: any) {
        throw new Error(`Invalid XPath "${expr}": ${err?.message || "failed to evaluate"}`);
      }
      const nodes: Node[] = Array.isArray(res) ? res : res ? [res] : [];
      counter(nodes.length);
      for (const node of nodes) {
        if (!node) continue;
        addTo.add(node);
      }
    }
  }

  evalAll(args.template.block_xpath || [], blockNodes, (n) => (blockMatches += n));
  evalAll(args.template.inline_xpath || [], inlineNodes, (n) => (inlineMatches += n));
  evalAll(args.template.ignored_xpath || [], ignoredNodes, (n) => (ignoredMatches += n));

  const topBlocks = Array.from(blockNodes).filter((n) => isElement(n) && !hasAncestorInSet(n, blockNodes) && !hasAncestorInSet(n, ignoredNodes));

  let inlinePlaceholderCounter = 0;
  function renderNode(node: Node): string {
    if (!node) return "";
    if (ignoredNodes.has(node) || hasAncestorInSet(node, ignoredNodes)) return "";

    if (isText(node)) {
      const type = (node as any).nodeType;
      if (type === 4 && !args.template.treat_cdata_as_text) return "";
      return String((node as any).data ?? "");
    }

    if (isElement(node)) {
      if (blockNodes.has(node) && !topBlocks.includes(node)) {
        return "";
      }

      const children = Array.from((node as any).childNodes || []) as Node[];
      const inner = children.map(renderNode).join("");

      if (inlineNodes.has(node)) {
        const idx = ++inlinePlaceholderCounter;
        const hasChildren = children.length > 0;
        if (!hasChildren) return `<${idx}>`;
        return `<${idx}>${inner}</${idx}>`;
      }

      return inner;
    }

    const anyNode = node as any;
    if (Array.isArray(anyNode.childNodes)) {
      return (anyNode.childNodes as Node[]).map(renderNode).join("");
    }

    return "";
  }

  const segments: XmlPreviewSegment[] = [];

  for (const block of topBlocks) {
    const text = renderNode(block);
    const taggedText = normalizePreviewText(text, { preserveWhitespace: args.preserveWhitespace });
    const sourceText = normalizePreviewText(stripTagTokens(taggedText), { preserveWhitespace: args.preserveWhitespace });

    const taggedParts = segmentByMode(taggedText, args.segmenter);
    const sourceParts = segmentByMode(sourceText, args.segmenter);
    const max = Math.max(taggedParts.length, sourceParts.length);
    for (let i = 0; i < max; i++) {
      const taggedPart = taggedParts[i] ?? "";
      const sourcePart = sourceParts[i] ?? stripTagTokens(taggedPart);
      if (!taggedPart.trim() && !sourcePart.trim()) continue;
      segments.push({
        path: nodePath(block),
        taggedText: taggedPart,
        sourceText: sourcePart
      });
    }
  }

  let attributeMatches = 0;
  if (args.template.translate_attributes && args.template.attribute_allowlist.length > 0) {
    function walkAttrs(node: Node) {
      if (!node) return;
      if (ignoredNodes.has(node)) return;
      if (isElement(node)) {
        if (hasAncestorInSet(node, ignoredNodes)) return;
        const el = node as any;
        for (const attr of args.template.attribute_allowlist) {
          const rawVal = el.getAttribute?.(attr);
          const val = rawVal != null ? String(rawVal) : "";
          if (!val.trim()) continue;
          attributeMatches += 1;
          const taggedText = normalizePreviewText(val, { preserveWhitespace: args.preserveWhitespace });
          const sourceText = normalizePreviewText(stripTagTokens(taggedText), { preserveWhitespace: args.preserveWhitespace });
          const taggedParts = segmentByMode(taggedText, args.segmenter);
          const sourceParts = segmentByMode(sourceText, args.segmenter);
          const max = Math.max(taggedParts.length, sourceParts.length);
          for (let i = 0; i < max; i++) {
            const taggedPart = taggedParts[i] ?? "";
            const sourcePart = sourceParts[i] ?? stripTagTokens(taggedPart);
            if (!taggedPart.trim() && !sourcePart.trim()) continue;
            segments.push({
              path: `${nodePath(node)}/@${attr}`,
              taggedText: taggedPart,
              sourceText: sourcePart
            });
          }
        }
      }
      const children = Array.from((node as any).childNodes || []) as Node[];
      for (const child of children) {
        walkAttrs(child);
      }
    }
    walkAttrs((doc as any).documentElement as any);
  }

  return {
    segments,
    stats: { blockMatches, inlineMatches, ignoredMatches, attributeMatches },
    debug: { errors: [], warnings: [] }
  };
}
