import { XMLParser } from "fast-xml-parser";

export type GenericSegment = {
  id: string;
  text: string;
  path: string; // helpful to know where in the tree this was found
};

// Extended list to include common HTML tags often found in generic translation files
const INLINE_TAG_NAMES = new Set([
  // XLIFF standard
  "g", "x", "ph", "bpt", "ept", "bx", "ex", "it", "mrk", 
  // HTML / Generic Formatting
  "b", "i", "u", "strong", "em", "span", "a", "br", "sub", "sup", "var"
]);

const OPEN = "⟪";
const CLOSE = "⟫";

// FIXED: Correct spelling based on your XML ("Translatable" vs "Translateable")
const TARGET_TAG = "translatabletext"; 

type XmlObj = Record<string, any>;
function asObj(node: any): XmlObj {
  return node && typeof node === "object" ? (node as XmlObj) : {};
}

export function parseGenericXmlSegments(xml: string): GenericSegment[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    trimValues: false, // Important to keep whitespace in translation strings
    processEntities: true
  });

  const j = parser.parse(xml);
  if (!j) return [];

  const segments: GenericSegment[] = [];
  
  // Start recursive search from the root
  traverseAndCollect(j, segments, "", "");

  return segments;
}

/**
 * Recursively traverses the JSON object looking for the TARGET_TAG.
 */
function traverseAndCollect(
  node: any, 
  segments: GenericSegment[], 
  currentPath: string,
  parentId: string
) {
  if (!node || typeof node !== "object") return;

  // Handle Arrays (e.g. multiple <Value> tags)
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      traverseAndCollect(child, segments, `${currentPath}[${i}]`, parentId);
    });
    return;
  }

  // Handle Objects
  for (const [key, value] of Object.entries(node)) {
    // fast-xml-parser stores attributes in the same object with prefix '@'
    if (key.startsWith("@")) continue;

    const lowerKey = key.toLowerCase();

    // 1. Check if this node IS the TranslatableText
    if (lowerKey === TARGET_TAG) {
      const arr = toArray(value);
      arr.forEach((item, i) => {
        // Use the parentId calculated from the hierarchy (e.g. "S1029858_USP_S_01")
        let id = parentId;
        
        // Fallback: if we have multiple text nodes here, append index
        if (arr.length > 1) {
            id = `${id}_${i}`;
        }
        
        // Last resort fallback
        if (!id) id = `txt_${segments.length}`;

        const tagIndexByCodeId = new Map<string, number>();
        const counter = { value: 0 };

        const text = extractTextWithTags(item, tagIndexByCodeId, counter);

        // Only add if there is actual text content
        if (text && text.trim().length > 0) {
          segments.push({
            id: id,
            text,
            path: currentPath + "/" + key
          });
        }
      });
      continue; // Don't recurse *into* the text node looking for more text nodes
    }

    // 2. If not the target, calculate the ID for the *next* level
    const valObj = asObj(value);
    
    // STEP XML Logic:
    // 1. Look for specific ID attributes
    const specificId = valObj["@ID"] || valObj["@AttributeID"] || valObj["@id"];
    
    let nextParentId = parentId;

    if (specificId) {
      // If we found a specific ID (like Product ID or Value AttributeID), chain it.
      // e.g. ProductID_AttributeID
      nextParentId = parentId ? `${parentId}_${specificId}` : specificId;
    } else if (["name", "description", "shortdescription"].includes(lowerKey)) {
      // If it's a generic structural tag without an ID (like <Name>), append the tag name
      // e.g. ProductID_Name
      nextParentId = parentId ? `${parentId}_${key}` : key;
    }
    
    // Recurse
    traverseAndCollect(value, segments, currentPath + "/" + key, nextParentId);
  }
}

/**
 * Reuse of your specific XLIFF logic for inline tags
 */
function extractTextWithTags(
  node: any,
  tagIndexByCodeId: Map<string, number>,
  counter: { value: number }
): string {
  if (node == null) return "";

  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);

  if (Array.isArray(node)) {
    return node
      .map((n) => extractTextWithTags(n, tagIndexByCodeId, counter))
      .join("");
  }

  if (typeof node === "object") {
    let out = "";

    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@")) continue;

      const lower = key.toLowerCase();

      if (lower === "#text") {
        out += extractTextWithTags(value, tagIndexByCodeId, counter);
        continue;
      }

      if (INLINE_TAG_NAMES.has(lower)) {
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
          const inner = extractTextWithTags(value, tagIndexByCodeId, counter);
          out += openToken + inner + closeToken;
        }
        continue;
      }

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
  const obj = asObj(node);
  // Also check generic attributes often used for matching tags
  const codeId: string | undefined = obj["@id"] || obj["@rid"] || obj["@mid"] || obj["@i"];

  let index: number;
  if (codeId && tagIndexByCodeId.has(String(codeId))) {
    index = tagIndexByCodeId.get(String(codeId))!;
  } else {
    index = ++counter.value;
    if (codeId) tagIndexByCodeId.set(String(codeId), index);
  }

  let selfClosing = true;
  for (const key of Object.keys(obj)) {
    if (!key.startsWith("@")) {
      selfClosing = false;
      break;
    }
  }

  // Common self-closing tags in generic XML/HTML
  if (tagName === "x" || tagName === "br" || tagName === "img") {
    selfClosing = true;
  }

  return { index, selfClosing };
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}