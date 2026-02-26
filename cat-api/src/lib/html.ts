import { parse, type HTMLElement, type Node } from "node-html-parser";

export type HtmlSegment = {
  index: number;
  text: string;
};

export type HtmlMarker = {
  marker: string;
  index: number;
};

export type HtmlParseResult = {
  segments: HtmlSegment[];
  template: string;
  markers: HtmlMarker[];
};

const MARKER_PREFIX = "{{SEG_";
const MARKER_SUFFIX = "}}";

export function isHtmlLike(filename: string): boolean {
  const ext = filename?.toLowerCase() || "";
  return (
    ext.endsWith(".html") ||
    ext.endsWith(".htm") ||
    ext.endsWith(".xhtml") ||
    ext.endsWith(".xtml") ||
    ext.endsWith(".xml") // Added XML since your header suggests XHTML
  );
}

export function parseHtmlDocument(html: string): HtmlParseResult {
  const root = parse(html || "", {
    comment: true,
    blockTextElements: {
      script: true,
      style: true
    }
  });

  const segments: HtmlSegment[] = [];
  const markers: HtmlMarker[] = [];
  let index = 0;

  function walk(node: Node) {
    if (node.nodeType === 1) { // Element Node
      const element = node as HTMLElement;
      const idAttr = element.getAttribute("id");

      // SPECIFIC LOGIC: Only translate content inside <div id="value">
      // This ensures we ignore metadata, styling, and the key names.
      if (idAttr === "value") {
        const rawHtml = element.innerHTML;
        
        // If there is content, turn it into a segment
        if (/\S/u.test(rawHtml)) {
          const trimmed = rawHtml.trim();
          
          // Create the marker
          const marker = `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
          
          // Add to segments list
          // Note: We use 'trimmed' which contains HTML tags (e.g., <var>)
          segments.push({ index, text: trimmed });
          markers.push({ marker, index });

          // Replace the content in the DOM with the marker so we can generate the template
          element.innerHTML = marker;
          
          index++;
        }
        // We do not recurse into children of a value div, 
        // because we treated the whole block as one segment.
        return;
      }
    }

    // Recursively walk children
    if (node.childNodes) {
      for (const child of node.childNodes) {
        walk(child);
      }
    }
  }

  walk(root);

  return {
    segments,
    template: root.toString(), // This now contains the markers inside the id="value" divs
    markers
  };
}

export function fillHtmlTemplate(
  template: string,
  markers: HtmlMarker[],
  resolveText: (index: number) => string
): string {
  let output = template;
  for (const marker of markers) {
    // IMPORTANT: We do NOT escapeHtml here anymore.
    // The segments contain HTML tags (like <var>, <b>) that must be preserved.
    // The translator/TM is responsible for returning valid HTML for these segments.
    const replacement = resolveText(marker.index) ?? "";
    
    // Simple string replacement
    output = output.split(marker.marker).join(replacement);
  }
  return output;
}

// Helper is kept in case you need it elsewhere, but not used in fillHtmlTemplate anymore
export function escapeHtml(value: string): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}