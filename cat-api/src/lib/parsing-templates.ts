export type ParsingTemplateConfig = {
  block_tags: string[];
  inline_tags: string[];
  ignored_tags: string[];
  translatable_attributes: Record<string, string[]>;
};

export type ParsingTemplateKind = "html" | "xml";

export type XmlParsingTemplateConfig = {
  block_xpath: string[];
  inline_xpath: string[];
  ignored_xpath: string[];
  namespaces: Record<string, string>;
  default_namespace_prefix: string | null;
  translate_attributes: boolean;
  attribute_allowlist: string[];
  treat_cdata_as_text: boolean;
};

const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/i;
const ATTR_RE = /^[a-z][a-z0-9:_-]*$/i;
const NS_PREFIX_RE = /^[a-z_][a-z0-9._-]*$/i;

function normalizeRuleArray(value: unknown): string[] {
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

export function normalizeParsingTemplateConfig(
  raw: unknown
): ParsingTemplateConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;

  const rulesObj = obj.rules && typeof obj.rules === "object" ? (obj.rules as Record<string, any>) : {};

  const blockTags = normalizeRuleArray(obj.block_tags ?? obj.block ?? rulesObj.block ?? []);
  const inlineTags = normalizeRuleArray(obj.inline_tags ?? obj.inline ?? rulesObj.inline ?? []);
  const ignoredTags = normalizeRuleArray(
    obj.ignored_tags ?? obj.ignore ?? obj.ignored ?? rulesObj.ignore ?? rulesObj.ignored ?? []
  );

  const translatableAttributes: Record<string, string[]> = {};
  const attrsRaw = obj.translatable_attributes ?? obj.translatableAttributes;
  if (attrsRaw && typeof attrsRaw === "object" && !Array.isArray(attrsRaw)) {
    for (const [tagRaw, attrList] of Object.entries(attrsRaw as Record<string, any>)) {
      const tag = String(tagRaw ?? "").trim().toLowerCase();
      if (!tag) continue;
      if (!TAG_NAME_RE.test(tag)) {
        throw new Error(`Invalid translatable_attributes tag: "${tagRaw}"`);
      }
      if (!Array.isArray(attrList)) {
        throw new Error(`Invalid translatable_attributes for "${tagRaw}"`);
      }
      const attrs: string[] = [];
      const seen = new Set<string>();
      for (const attrItem of attrList) {
        if (typeof attrItem !== "string") continue;
        const attr = attrItem.trim();
        if (!attr) continue;
        if (!ATTR_RE.test(attr)) {
          throw new Error(
            `Invalid translatable attribute "${attrItem}" for tag "${tagRaw}"`
          );
        }
        const key = attr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        attrs.push(key);
      }
      if (attrs.length > 0) translatableAttributes[tag] = attrs;
    }
  }

  // Resolve overlaps: ignored wins.
  const ignored = new Set(ignoredTags.map((t) => t.toLowerCase()));
  const block = blockTags.filter((t) => !ignored.has(t.toLowerCase()));
  const inline = inlineTags.filter((t) => !ignored.has(t.toLowerCase()));

  return {
    block_tags: block,
    inline_tags: inline,
    ignored_tags: ignoredTags,
    translatable_attributes: translatableAttributes
  };
}

function normalizeXPathArray(value: unknown): string[] {
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

function normalizeNamespaceMap(value: unknown): Record<string, string> {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
  const out: Record<string, string> = {};
  for (const [prefixRaw, uriRaw] of Object.entries(obj)) {
    const prefix = String(prefixRaw ?? "").trim();
    if (!prefix) continue;
    if (!NS_PREFIX_RE.test(prefix) || prefix.includes(":")) {
      throw new Error(`Invalid namespace prefix "${prefixRaw}"`);
    }
    if (prefix.toLowerCase() === "xml" || prefix.toLowerCase() === "xmlns") {
      throw new Error(`Reserved namespace prefix "${prefixRaw}"`);
    }
    const uri = String(uriRaw ?? "").trim();
    if (!uri) continue;
    out[prefix] = uri;
  }
  return out;
}

function normalizeAttributeAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const attr = item.trim();
    if (!attr) continue;
    if (!ATTR_RE.test(attr)) {
      throw new Error(`Invalid attribute name "${item}"`);
    }
    const key = attr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(attr);
  }
  return out;
}

export function normalizeXmlParsingTemplateConfig(raw: unknown): XmlParsingTemplateConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const rulesObj = obj.rules && typeof obj.rules === "object" ? (obj.rules as Record<string, any>) : {};

  const blockXPath = normalizeXPathArray(obj.block_xpath ?? obj.blockXPath ?? obj.block ?? rulesObj.block ?? []);
  const inlineXPath = normalizeXPathArray(obj.inline_xpath ?? obj.inlineXPath ?? obj.inline ?? rulesObj.inline ?? []);
  const ignoredXPath = normalizeXPathArray(
    obj.ignored_xpath ?? obj.ignoredXPath ?? obj.ignore_xpath ?? obj.ignoreXPath ?? obj.ignore ?? rulesObj.ignore ?? rulesObj.ignored ?? []
  );

  const namespaces = normalizeNamespaceMap(obj.namespaces ?? obj.namespace_map ?? obj.namespaceMap ?? {});

  const defaultPrefixRaw =
    obj.default_namespace_prefix ?? obj.defaultNamespacePrefix ?? null;
  const defaultPrefix = String(defaultPrefixRaw ?? "").trim() || null;
  if (defaultPrefix && (!NS_PREFIX_RE.test(defaultPrefix) || defaultPrefix.includes(":"))) {
    throw new Error("Invalid default_namespace_prefix");
  }

  const translateAttributesRaw = obj.translate_attributes ?? obj.translateAttributes ?? false;
  const translateAttributes = Boolean(translateAttributesRaw);

  const allowlist = normalizeAttributeAllowlist(
    obj.attribute_allowlist ?? obj.attributeAllowlist ?? obj.translate_attribute_allowlist ?? []
  );

  const treatCdataAsTextRaw = obj.treat_cdata_as_text ?? obj.treatCdataAsText ?? true;
  const treatCdataAsText = treatCdataAsTextRaw !== undefined ? Boolean(treatCdataAsTextRaw) : true;

  return {
    block_xpath: blockXPath,
    inline_xpath: inlineXPath,
    ignored_xpath: ignoredXPath,
    namespaces,
    default_namespace_prefix: defaultPrefix,
    translate_attributes: translateAttributes,
    attribute_allowlist: allowlist,
    treat_cdata_as_text: treatCdataAsText
  };
}
