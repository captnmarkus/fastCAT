import { XMLParser } from "fast-xml-parser";

export type XliffSegment = {
  id: string;
  src: string;
  tgt?: string;
  file?: string;    // original file name, e.g. HTML/XHTML
  groupId?: string;
};

const INLINE_TAG_NAMES = new Set([
  "g", "x", "ph", "bpt", "ept", "bx", "ex", "it",
  "mrk", "pc", "sc", "ec", "sm", "em"
]);

// we use special tokens like ⟪1⟫ ... ⟪/1⟫
const OPEN = "⟪";
const CLOSE = "⟫";

export function parseXliffSegments(xml: string): XliffSegment[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    trimValues: false,
    processEntities: true
  });

  const j = parser.parse(xml);

  const xliff = j?.xliff || j?.XLIFF || j;
  if (!xliff) return [];

  const segments: XliffSegment[] = [];

  // XLIFF can have 1 or many <file> elements
  const files = toArray(xliff.file || xliff.files || []);
  for (const file of files) {
    const original = file?.["@original"] as string | undefined;
    const fileId = file?.["@id"] as string | undefined;

    // XLIFF 1.2: <file><body><trans-unit>...</trans-unit></body></file>
    if (file?.body) {
      const body = file.body;
      const tus = toArray(body["trans-unit"] || body["trans_unit"] || []);
      for (const tu of tus) {
        const seg = parseTransUnit(tu, original, fileId);
        if (seg) segments.push(seg);
      }
    }

    // XLIFF 2.0: <file><unit><segment>...</segment></unit></file>
    const units = toArray(file.unit || file.units || []);
    for (const unit of units) {
      const uId = (unit?.["@id"] as string | undefined) || undefined;
      const segs = toArray(unit.segment || unit.segments || []);
      for (const seg of segs) {
        const tagIndexByCodeId = new Map<string, number>();
        const counter = { value: 0 };

        const src = extractTextWithTags(
          seg.source ?? seg.Source,
          tagIndexByCodeId,
          counter
        );
        if (!src) continue;

        const tgt = extractTextWithTags(
          seg.target ?? seg.Target,
          tagIndexByCodeId,
          counter
        );

        segments.push({
          id: seg["@id"] || uId || "",
          src,
          tgt,
          file: original,
          groupId: fileId
        });
      }
    }
  }

  return segments;
}

function parseTransUnit(
  tu: any,
  original?: string,
  fileId?: string
): XliffSegment | null {
  if (!tu) return null;

  const tagIndexByCodeId = new Map<string, number>();
  const counter = { value: 0 };

  const src = extractTextWithTags(
    tu.source ?? tu.Source,
    tagIndexByCodeId,
    counter
  );
  if (!src) return null;

  const tgt = extractTextWithTags(
    tu.target ?? tu.Target,
    tagIndexByCodeId,
    counter
  );

  const id = (tu["@id"] as string | undefined) || "";

  return {
    id,
    src,
    tgt,
    file: original,
    groupId: fileId
  };
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Extract text, preserving inline codes as placeholder tokens:
 *   <g id="1">foo</g>  →  ⟪1⟫foo⟪/1⟫
 *   <x id="2"/>        →  ⟪2⟫
 *
 * The same code id (id/rid/mid) in source and target gets the same number.
 */
function extractTextWithTags(
  node: any,
  tagIndexByCodeId: Map<string, number>,
  counter: { value: number }
): string {
  if (node == null) return "";

  // plain string
  if (typeof node === "string") return node;

  // list of nodes
  if (Array.isArray(node)) {
    return node
      .map((n) => extractTextWithTags(n, tagIndexByCodeId, counter))
      .join("");
  }

  // object with children/attributes
  if (typeof node === "object") {
    let out = "";

    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@")) {
        // attributes
        continue;
      }
      const lower = key.toLowerCase();

      if (lower === "#text") {
        out += extractTextWithTags(value, tagIndexByCodeId, counter);
        continue;
      }

      if (INLINE_TAG_NAMES.has(lower)) {
        // Inline code (g, x, ph, bpt, ept, etc.)
        const { index, selfClosing } = getOrCreateTagIndex(
          lower,
          value,
          tagIndexByCodeId,
          counter
        );
        const openToken = `${OPEN}${index}${CLOSE}`;
        const closeToken = `${OPEN}/${index}${CLOSE}`;

        if (selfClosing) {
          out += openToken;
        } else {
          const inner = extractTextWithTags(
            value,
            tagIndexByCodeId,
            counter
          );
          out += openToken + inner + closeToken;
        }
        continue;
      }

      // any other nested element → just recurse to its content
      out += extractTextWithTags(value, tagIndexByCodeId, counter);
    }

    return out;
  }

  return "";
}

function getOrCreateTagIndex(
  tagName: string,
  node: any,
  tagIndexByCodeId: Map<string, number>,
  counter: { value: number }
): { index: number; selfClosing: boolean } {
  let codeId: string | undefined;
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (!k.startsWith("@")) continue;
      const attrName = k.slice(1).toLowerCase();
      if (attrName === "id" || attrName === "rid" || attrName === "mid") {
        codeId = String(v);
        break;
      }
    }
  }

  let index: number;
  if (codeId && tagIndexByCodeId.has(codeId)) {
    index = tagIndexByCodeId.get(codeId)!;
  } else {
    index = ++counter.value;
    if (codeId) tagIndexByCodeId.set(codeId, index);
  }

  // self-closing if node has no non-attribute children
  let selfClosing = true;
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      if (!key.startsWith("@")) {
        selfClosing = false;
        break;
      }
    }
  }

  // treat <x> as self-closing even if weird content
  if (tagName === "x" || tagName === "bx" || tagName === "ex") {
    selfClosing = true;
  }

  return { index, selfClosing };
}
