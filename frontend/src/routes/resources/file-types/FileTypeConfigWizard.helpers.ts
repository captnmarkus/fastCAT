import type { ParsingTemplateConfig, ParsingTemplateKind } from "../../../api";

export type WizardStepKey = "type" | "basics" | "config" | "preview" | "review";
export type FileTypeKind = "html" | "xml" | "pdf" | "docx" | "pptx" | "xlsx";
export type TemplateEditorMode = "none" | "create" | "upload" | "edit";
export type RenderedPreviewMethod = "pdf" | "images" | "html" | "xml_xslt" | "xml_raw_pretty";

export const STEP_ORDER: { key: WizardStepKey; label: string }[] = [
  { key: "type", label: "Choose file type" },
  { key: "basics", label: "Basics" },
  { key: "config", label: "Configuration" },
  { key: "preview", label: "Preview/Test" },
  { key: "review", label: "Review & Save" }
];

export const FILE_TYPE_CARDS: Array<{
  value: FileTypeKind;
  label: string;
  icon: string;
  description: string;
}> = [
  { value: "html", label: "HTML", icon: "bi-filetype-html", description: "Template-based extraction, tags, segmentation." },
  { value: "xml", label: "XML", icon: "bi-filetype-xml", description: "XML extraction template + placeholder rules." },
  { value: "pdf", label: "PDF", icon: "bi-filetype-pdf", description: "Extraction mode + layout/segmentation strategy." },
  { value: "docx", label: "DOC/DOCX", icon: "bi-filetype-docx", description: "Text extraction + formatting/tag preservation." },
  { value: "pptx", label: "PPT/PPTX", icon: "bi-filetype-pptx", description: "Slides + speaker notes extraction settings." },
  { value: "xlsx", label: "XLS/XLSX", icon: "bi-filetype-xlsx", description: "Cell-based extraction settings and segmentation." }
];

export function normalizeFileTypeKind(value: any): FileTypeKind | null {
  const v = String(value || "").trim().toLowerCase();
  if (v === "html" || v === "xml" || v === "pdf" || v === "docx" || v === "pptx" || v === "xlsx") return v;
  return null;
}

export function deriveFileTypeFromConfig(config: any): FileTypeKind | null {
  const direct = normalizeFileTypeKind(config?.fileType);
  if (direct) return direct;
  const legacy = Array.isArray(config?.fileTypes) ? config.fileTypes.map((t: any) => normalizeFileTypeKind(t)).filter(Boolean) : [];
  return (legacy[0] as FileTypeKind | undefined) ?? null;
}

export function stepIndexForKey(key: WizardStepKey) {
  return Math.max(0, STEP_ORDER.findIndex((s) => s.key === key));
}

export function defaultRenderedPreviewMethodForFileType(fileType: FileTypeKind | null): RenderedPreviewMethod {
  if (fileType === "docx" || fileType === "pptx" || fileType === "xlsx") return "pdf";
  if (fileType === "xml") return "xml_raw_pretty";
  return "html";
}

export type HtmlWizardConfig = {
  parsingTemplateId: string;
  segmenter: "lines" | "sentences";
  preserveWhitespace: boolean;
  normalizeSpaces: boolean;
  inlineTagPlaceholders: boolean;
};

export type XmlWizardConfig = {
  parsingTemplateId: string;
  segmenter: "lines" | "sentences";
  preserveWhitespace: boolean;
};

export type PdfWizardConfig = {
  layoutMode: "paragraph" | "line";
  segmenter: "lines" | "sentences";
  ocr: boolean;
};

export type DocxWizardConfig = {
  includeComments: boolean;
  includeFootnotes: boolean;
  preserveFormattingTags: boolean;
  segmenter: "lines" | "sentences";
};

export type PptxWizardConfig = {
  includeSpeakerNotes: boolean;
  preserveFormattingTags: boolean;
  segmenter: "lines" | "sentences";
};

export type XlsxWizardConfig = {
  includeCellComments: boolean;
  preserveFormattingTags: boolean;
  segmenter: "lines" | "sentences";
};

export const DEFAULT_HTML: HtmlWizardConfig = {
  parsingTemplateId: "",
  segmenter: "lines",
  preserveWhitespace: false,
  normalizeSpaces: true,
  inlineTagPlaceholders: true
};

export const DEFAULT_XML: XmlWizardConfig = {
  parsingTemplateId: "",
  segmenter: "lines",
  preserveWhitespace: true
};

export const DEFAULT_PDF: PdfWizardConfig = { layoutMode: "paragraph", segmenter: "lines", ocr: false };
export const DEFAULT_DOCX: DocxWizardConfig = {
  includeComments: false,
  includeFootnotes: true,
  preserveFormattingTags: true,
  segmenter: "lines"
};
export const DEFAULT_PPTX: PptxWizardConfig = { includeSpeakerNotes: true, preserveFormattingTags: true, segmenter: "lines" };
export const DEFAULT_XLSX: XlsxWizardConfig = { includeCellComments: false, preserveFormattingTags: true, segmenter: "lines" };

export const STARTER_PARSING_TEMPLATE_CONFIG: ParsingTemplateConfig = {
  block_tags: ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6"],
  inline_tags: ["span", "a", "strong", "em", "b", "i", "u"],
  ignored_tags: ["script", "style", "noscript"],
  translatable_attributes: {
    a: ["title"],
    img: ["alt"]
  }
};

export const STARTER_XML_PARSING_TEMPLATE_CONFIG: ParsingTemplateConfig = {
  block_xpath: ["//*[normalize-space(text())]"],
  inline_xpath: [],
  ignored_xpath: [],
  namespaces: {},
  default_namespace_prefix: "d",
  translate_attributes: false,
  attribute_allowlist: ["title", "alt", "aria-label"],
  treat_cdata_as_text: true
};

const TEMPLATE_ATTR_RE = /^[a-z][a-z0-9:_-]*$/i;
const TEMPLATE_NS_PREFIX_RE = /^[a-z_][a-z0-9._-]*$/i;

export function normalizeTemplateRuleArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const rule = item.trim();
    if (!rule) continue;
    const key = rule.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

export function normalizeTemplateRuleText(text: string): string[] {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return normalizeTemplateRuleArray(lines);
}

export function normalizeParsingTemplateConfigForClient(raw: unknown): ParsingTemplateConfig {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const obj = (input.config && typeof input.config === "object" ? input.config : input) as Record<string, any>;
  const rulesObj = obj.rules && typeof obj.rules === "object" ? (obj.rules as Record<string, any>) : {};

  const blockTags = normalizeTemplateRuleArray(obj.block_tags ?? obj.block ?? rulesObj.block ?? []);
  const inlineTags = normalizeTemplateRuleArray(obj.inline_tags ?? obj.inline ?? rulesObj.inline ?? []);
  const ignoredTags = normalizeTemplateRuleArray(obj.ignored_tags ?? obj.ignore ?? obj.ignored ?? rulesObj.ignore ?? rulesObj.ignored ?? []);

  const translatableAttributes: Record<string, string[]> = {};
  const attrsRaw = obj.translatable_attributes ?? obj.translatableAttributes;
  if (attrsRaw && typeof attrsRaw === "object" && !Array.isArray(attrsRaw)) {
    for (const [tagRaw, attrList] of Object.entries(attrsRaw as Record<string, any>)) {
      const tag = String(tagRaw ?? "").trim().toLowerCase();
      if (!tag) continue;
      if (!Array.isArray(attrList)) {
        throw new Error(`Invalid translatable_attributes for "${tagRaw}"`);
      }
      const attrs: string[] = [];
      const seen = new Set<string>();
      for (const attrItem of attrList) {
        if (typeof attrItem !== "string") continue;
        const attr = attrItem.trim();
        if (!attr) continue;
        if (!TEMPLATE_ATTR_RE.test(attr)) {
          throw new Error(`Invalid translatable attribute "${attrItem}" for tag "${tagRaw}"`);
        }
        const key = attr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        attrs.push(key);
      }
      if (attrs.length > 0) translatableAttributes[tag] = attrs;
    }
  }

  const ignored = new Set(ignoredTags.map((r) => r.toLowerCase()));
  const block = blockTags.filter((t) => !ignored.has(t.toLowerCase()));
  const inline = inlineTags.filter((t) => !ignored.has(t.toLowerCase()));

  return {
    block_tags: block,
    inline_tags: inline,
    ignored_tags: ignoredTags,
    translatable_attributes: translatableAttributes
  };
}

export function normalizeXmlParsingTemplateConfigForClient(raw: unknown): ParsingTemplateConfig {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const obj = (input.config && typeof input.config === "object" ? input.config : input) as Record<string, any>;
  const rulesObj = obj.rules && typeof obj.rules === "object" ? (obj.rules as Record<string, any>) : {};

  function normalizeXPathRules(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== "string") continue;
      const rule = item.trim();
      if (!rule) continue;
      if (seen.has(rule)) continue;
      seen.add(rule);
      out.push(rule);
    }
    return out;
  }

  const blockXPath = normalizeXPathRules(obj.block_xpath ?? obj.blockXPath ?? obj.block ?? rulesObj.block ?? []);
  const inlineXPath = normalizeXPathRules(obj.inline_xpath ?? obj.inlineXPath ?? obj.inline ?? rulesObj.inline ?? []);
  const ignoredXPath = normalizeXPathRules(
    obj.ignored_xpath ?? obj.ignore_xpath ?? obj.ignoredXPath ?? obj.ignoreXPath ?? obj.ignore ?? rulesObj.ignore ?? rulesObj.ignored ?? []
  );

  const namespaces: Record<string, string> = {};
  const nsRaw = obj.namespaces ?? obj.namespace_map ?? obj.namespaceMap ?? {};
  if (nsRaw && typeof nsRaw === "object" && !Array.isArray(nsRaw)) {
    for (const [prefixRaw, uriRaw] of Object.entries(nsRaw as Record<string, any>)) {
      const prefix = String(prefixRaw ?? "").trim();
      if (!prefix) continue;
      if (!TEMPLATE_NS_PREFIX_RE.test(prefix) || prefix.includes(":")) {
        throw new Error(`Invalid namespace prefix "${prefixRaw}"`);
      }
      const uri = String(uriRaw ?? "").trim();
      if (!uri) continue;
      namespaces[prefix] = uri;
    }
  }

  const defaultPrefixRaw = obj.default_namespace_prefix ?? obj.defaultNamespacePrefix ?? null;
  const defaultPrefix = String(defaultPrefixRaw ?? "").trim() || null;
  if (defaultPrefix && (!TEMPLATE_NS_PREFIX_RE.test(defaultPrefix) || defaultPrefix.includes(":"))) {
    throw new Error("Invalid default_namespace_prefix");
  }

  const translateAttributes = Boolean(obj.translate_attributes ?? obj.translateAttributes ?? false);

  const allowlistRaw = obj.attribute_allowlist ?? obj.attributeAllowlist ?? [];
  const attributeAllowlist: string[] = [];
  const allowSeen = new Set<string>();
  if (Array.isArray(allowlistRaw)) {
    for (const item of allowlistRaw) {
      if (typeof item !== "string") continue;
      const attr = item.trim();
      if (!attr) continue;
      if (!TEMPLATE_ATTR_RE.test(attr)) {
        throw new Error(`Invalid attribute name "${item}"`);
      }
      const key = attr.toLowerCase();
      if (allowSeen.has(key)) continue;
      allowSeen.add(key);
      attributeAllowlist.push(attr);
    }
  }

  const treatCdataAsText =
    obj.treat_cdata_as_text !== undefined
      ? Boolean(obj.treat_cdata_as_text)
      : obj.treatCdataAsText !== undefined
        ? Boolean(obj.treatCdataAsText)
        : true;

  return {
    block_xpath: blockXPath,
    inline_xpath: inlineXPath,
    ignored_xpath: ignoredXPath,
    namespaces,
    default_namespace_prefix: defaultPrefix,
    translate_attributes: translateAttributes,
    attribute_allowlist: attributeAllowlist,
    treat_cdata_as_text: treatCdataAsText
  };
}

export function validateParsingTemplateJson(text: string, kind: ParsingTemplateKind): { config: ParsingTemplateConfig } | { error: string } {
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Template JSON is invalid." };
  }

  try {
    const normalized =
      kind === "xml" ? normalizeXmlParsingTemplateConfigForClient(parsed) : normalizeParsingTemplateConfigForClient(parsed);
    if (kind === "xml") {
      const cfg = normalized as any;
      if (!Array.isArray(cfg.block_xpath) || cfg.block_xpath.length === 0) {
        return { error: "Block XPath rules must not be empty." };
      }
    } else {
      const cfg = normalized as any;
      if (!Array.isArray(cfg.block_tags) || cfg.block_tags.length === 0) {
        return { error: "Block rules must not be empty." };
      }
    }
    return { config: normalized };
  } catch (err: any) {
    return { error: err?.message || "Invalid template config" };
  }
}

export function buildFileTypeConfigPayload(args: {
  fileType: FileTypeKind;
  agentDefault: boolean;
  html: HtmlWizardConfig;
  xml: XmlWizardConfig;
  pdf: PdfWizardConfig;
  docx: DocxWizardConfig;
  pptx: PptxWizardConfig;
  xlsx: XlsxWizardConfig;
  renderedPreview: {
    supportsRenderedPreview: boolean;
    renderedPreviewMethod: RenderedPreviewMethod;
    renderedPreviewDefaultOn: boolean;
    xmlXsltTemplateId: string;
    xmlRendererProfileId: string;
  };
}) {
  const cfg: any = { fileType: args.fileType, agentDefault: Boolean(args.agentDefault) };
  cfg.supportsRenderedPreview = Boolean(args.renderedPreview.supportsRenderedPreview);
  cfg.renderedPreviewDefaultOn = Boolean(args.renderedPreview.renderedPreviewDefaultOn);
  cfg.renderedPreviewMethod = args.renderedPreview.renderedPreviewMethod;

  if (args.fileType === "html") {
    cfg.html = {
      parsingTemplateId: args.html.parsingTemplateId ? Number(args.html.parsingTemplateId) : null,
      segmenter: args.html.segmenter,
      preserveWhitespace: args.html.preserveWhitespace,
      normalizeSpaces: args.html.normalizeSpaces,
      inlineTagPlaceholders: args.html.inlineTagPlaceholders
    };
  }

  if (args.fileType === "xml") {
    cfg.xml = {
      parsingTemplateId: args.xml.parsingTemplateId ? Number(args.xml.parsingTemplateId) : null,
      segmenter: args.xml.segmenter,
      preserveWhitespace: args.xml.preserveWhitespace,
      renderedPreviewMethod: args.renderedPreview.renderedPreviewMethod
    };
    if (args.renderedPreview.xmlXsltTemplateId.trim()) {
      cfg.xml.renderedPreviewXsltTemplateId = Number(args.renderedPreview.xmlXsltTemplateId.trim());
    }
    if (args.renderedPreview.xmlRendererProfileId.trim()) {
      cfg.xml.renderedPreviewRendererProfileId = args.renderedPreview.xmlRendererProfileId.trim();
    }
  }

  if (args.fileType === "pdf") cfg.pdf = { ...args.pdf };
  if (args.fileType === "docx") cfg.docx = { ...args.docx };
  if (args.fileType === "pptx") cfg.pptx = { ...args.pptx };
  if (args.fileType === "xlsx") cfg.xlsx = { ...args.xlsx };

  return cfg as Record<string, any>;
}
