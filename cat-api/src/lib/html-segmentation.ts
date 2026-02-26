import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { ParsingTemplateConfig } from "./parsing-templates.js";

export type HtmlSegmentMapEntry =
  | {
      kind: "html";
      selector: string;
    }
  | {
      kind: "attr";
      selector: string;
      attribute: string;
    };

export type HtmlSegmentationResult = {
  template: string;
  segments: string[];
  map: HtmlSegmentMapEntry[];
  stats?: {
    blockMatches: number;
    inlineMatches: number;
    ignoredMatches: number;
  };
};

function cssEscapeAttr(value: string): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function elementIndexInParent(node: Element): number {
  const parent = node.parent as any;
  const siblings = Array.isArray(parent?.children)
    ? (parent.children as AnyNode[]).filter((child) => child.type === "tag")
    : [];
  const idx = siblings.indexOf(node as any);
  return idx >= 0 ? idx + 1 : 1;
}

export function buildCssSelector(node: Element): string {
  const parts: string[] = [];
  let current: Element | null = node;

  while (current) {
    const tag = (current.tagName || "").toLowerCase();
    if (!tag) break;

    if (tag === "body" || tag === "html") {
      parts.unshift(tag);
      break;
    }

    const id = current.attribs?.id;
    if (id) {
      parts.unshift(`${tag}[id="${cssEscapeAttr(id)}"]`);
      break;
    }

    const parent = current.parent as any;
    if (!parent || parent.type !== "tag") {
      parts.unshift(tag);
      break;
    }

    const index = elementIndexInParent(current);
    parts.unshift(`${tag}:nth-child(${index})`);
    current = parent as Element;
  }

  return parts.join(" > ");
}

function isBlankText(value: string): boolean {
  return String(value ?? "").replace(/\u00A0/g, " ").trim().length === 0;
}

function isBlankHtmlSnippet(html: string): boolean {
  const $ = load(`<root>${html}</root>`);
  const text = $.root().text();
  return isBlankText(text);
}

export function segmentHtmlWithTemplate(
  fileBuffer: Buffer,
  config: ParsingTemplateConfig,
  opts?: { xmlMode?: boolean }
): HtmlSegmentationResult {
  const raw = fileBuffer.toString();
  const $ = load(raw, opts?.xmlMode ? { xmlMode: true } : undefined);

  const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/i;

  function splitRules(rules: string[] | undefined | null): { tags: Set<string>; selectors: string[] } {
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

  const blockRules = splitRules(config.block_tags || []);
  const inlineRules = splitRules(config.inline_tags || []);
  const ignoredRules = splitRules(config.ignored_tags || []);

  function matchesAny(el: Element, rules: { tags: Set<string>; selectors: string[] }): boolean {
    const tag = (el.tagName || "").toLowerCase();
    if (tag && rules.tags.has(tag)) return true;
    if (rules.selectors.length === 0) return false;
    for (const selector of rules.selectors) {
      try {
        if ($(el).is(selector)) return true;
      } catch {
        // ignore invalid selectors
      }
    }
    return false;
  }

  const translatableAttributes = new Map<string, string[]>();
  const attrsRaw = config.translatable_attributes || {};
  for (const [tag, attrs] of Object.entries(attrsRaw)) {
    if (!Array.isArray(attrs) || attrs.length === 0) continue;
    translatableAttributes.set(
      String(tag).toLowerCase(),
      attrs.map((a) => String(a).toLowerCase()).filter(Boolean)
    );
  }

  const blockSelectorParts = [...Array.from(blockRules.tags), ...blockRules.selectors].filter(Boolean);
  const blockSelector = blockSelectorParts.join(",");

  function safeFindCount(el: Element, selector: string): number {
    if (!selector) return 0;
    try {
      return $(el).find(selector).length;
    } catch {
      return 0;
    }
  }

  function hasBlockDescendant(el: Element): boolean {
    if (!blockSelectorParts.length) return false;
    if (blockSelector) {
      const count = safeFindCount(el, blockSelector);
      if (count > 0) return true;
    }
    for (const selector of blockSelectorParts) {
      const count = safeFindCount(el, selector);
      if (count > 0) return true;
    }
    return false;
  }

  function wrapRuns(container: Element, wrapCounter: { value: number }) {
    const tag = (container.tagName || "").toLowerCase();
    if (tag && ignoredRules.tags.has(tag)) return;
    if (ignoredRules.selectors.length > 0) {
      try {
        if (matchesAny(container, ignoredRules)) return;
      } catch {
        // ignore
      }
    }

    const childrenSnapshot = [...((container.children || []) as AnyNode[])];
    let run: AnyNode[] = [];

    const flush = () => {
      if (run.length === 0) return;
      const html = run.map((node) => $.html(node)).join("");
      const inner = html.trim();
      if (!inner || isBlankHtmlSnippet(inner)) {
        run = [];
        return;
      }

      const id = `fastcat-seg-${wrapCounter.value++}`;
      $(run).wrapAll(`<span id="${id}" data-fastcat-seg="1"></span>`);
      run = [];
    };

    for (const child of childrenSnapshot) {
      if (child.type === "text") {
        run.push(child);
        continue;
      }

      if (child.type !== "tag") {
        flush();
        continue;
      }

      const el = child as Element;
      const childTag = (el.tagName || "").toLowerCase();

      if (childTag && ignoredRules.tags.has(childTag)) {
        flush();
        continue;
      }

      if (ignoredRules.selectors.length > 0 && matchesAny(el, ignoredRules)) {
        flush();
        continue;
      }

      const shouldRecurse = matchesAny(el, blockRules) || hasBlockDescendant(el) || !matchesAny(el, inlineRules);

      if (shouldRecurse) {
        flush();
        wrapRuns(el, wrapCounter);
        continue;
      }

      run.push(el);
    }

    flush();
  }

  const wrapCounter = { value: 0 };
  const htmlEl = $("html").get(0) as Element | undefined;
  if (htmlEl) {
    wrapRuns(htmlEl, wrapCounter);
  } else {
    const rootEl = $.root().get(0) as any;
    if (rootEl && Array.isArray(rootEl.children)) {
      for (const child of rootEl.children as AnyNode[]) {
        if (child.type === "tag") wrapRuns(child as Element, wrapCounter);
      }
    }
  }

  const segments: string[] = [];
  const map: HtmlSegmentMapEntry[] = [];

  function collect(node: AnyNode) {
    if (!node) return;

    if (node.type === "tag") {
      const el = node as Element;
      const tag = (el.tagName || "").toLowerCase();
      if (tag && ignoredRules.tags.has(tag)) return;
      if (ignoredRules.selectors.length > 0 && matchesAny(el, ignoredRules)) return;

      if (tag === "span" && String(el.attribs?.["data-fastcat-seg"] || "") === "1") {
        const rawHtml = $(el).html() ?? "";
        const inner = String(rawHtml).trim();
        if (inner && !isBlankHtmlSnippet(inner)) {
          segments.push(inner);
          map.push({ kind: "html", selector: buildCssSelector(el) });
        }
      }

      const attrs = translatableAttributes.get(tag);
      if (attrs && attrs.length > 0) {
        const selector = buildCssSelector(el);
        for (const attr of attrs) {
          const val = el.attribs?.[attr];
          if (!val) continue;
          if (isBlankText(val)) continue;
          segments.push(String(val));
          map.push({ kind: "attr", selector, attribute: attr });
        }
      }

      for (const child of (el.children || []) as AnyNode[]) {
        collect(child);
      }
      return;
    }

    const anyNode = node as any;
    if (Array.isArray(anyNode.children)) {
      for (const child of anyNode.children as AnyNode[]) {
        collect(child);
      }
    }
  }

  const traverseRoot = $("html").get(0) as AnyNode | undefined;
  if (traverseRoot) {
    collect(traverseRoot);
  } else {
    collect($.root().get(0) as AnyNode);
  }

  function safeSelectCount(selector: string): number {
    if (!selector) return 0;
    try {
      return $(selector).length;
    } catch {
      return 0;
    }
  }

  const stats = {
    blockMatches: blockSelectorParts.reduce((acc, selector) => acc + safeSelectCount(selector), 0),
    inlineMatches: [...Array.from(inlineRules.tags), ...inlineRules.selectors].reduce(
      (acc, selector) => acc + safeSelectCount(selector),
      0
    ),
    ignoredMatches: [...Array.from(ignoredRules.tags), ...ignoredRules.selectors].reduce(
      (acc, selector) => acc + safeSelectCount(selector),
      0
    )
  };

  return { template: $.html(), segments, map, stats };
}
