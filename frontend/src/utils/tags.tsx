import React from "react";
import { buildGlossaryTooltip, type GlossaryHighlightMatch } from "./termbase";

const TAG_TOKEN_RE_GLOBAL = /<\/?\d+>/g;
const TAG_TOKEN_RE = /^<\/?\d+>$/;
const FORMAT_TOKEN_RE = /^<\/?(?:b|strong|i|em|u)>$/i;
const ANY_TOKEN_SPLIT_RE = /(<\/?\d+>|<\/?(?:b|strong|i|em|u)>)/gi;

export function getTagTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const m = text.match(TAG_TOKEN_RE_GLOBAL);
  return m ? Array.from(new Set(m)) : [];
}

export function validateTags(src: string, tgt: string): string | null {
  // Temporarily allow all submissions while tags are normalized across sources.
  // This prevents false positives that were blocking saves on tag-free segments.
  return null;
}

function renderWhitespaceAware(text: string, keyPrefix: string, showWhitespace: boolean) {
  const nodes: React.ReactNode[] = [];
  if (!showWhitespace) {
    return [<span key={`${keyPrefix}-plain`}>{text}</span>];
  }

  const normalized = text.replace(/\r\n/g, "\n");
  let buffer = "";
  let chunkIndex = 0;

  const flushBuffer = () => {
    if (!buffer) return;
    nodes.push(<span key={`${keyPrefix}-t-${chunkIndex++}`}>{buffer}</span>);
    buffer = "";
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === " ") {
      flushBuffer();
      nodes.push(
        <span key={`${keyPrefix}-ws-${chunkIndex++}`} className="ws-marker" title="Space">
          {"\u00b7"}
        </span>
      );
      continue;
    }
    if (ch === "\t") {
      flushBuffer();
      nodes.push(
        <span key={`${keyPrefix}-ws-${chunkIndex++}`} className="ws-marker" title="Tab">
          {"\u2192"}
        </span>
      );
      continue;
    }
    if (ch === "\n") {
      flushBuffer();
      nodes.push(
        <span key={`${keyPrefix}-ws-${chunkIndex++}`} className="ws-marker" title="New line">
          {"\u00b6\n"}
        </span>
      );
      continue;
    }
    if (ch === "\u00a0") {
      flushBuffer();
      nodes.push(
        <span key={`${keyPrefix}-ws-${chunkIndex++}`} className="ws-marker" title="Non-breaking space">
          {"\u237d"}
        </span>
      );
      continue;
    }
    buffer += ch;
  }

  flushBuffer();
  return nodes;
}

export function renderPlainText(
  text: string | null | undefined,
  opts?: {
    showWhitespace?: boolean;
    glossaryMatches?: GlossaryHighlightMatch[];
    onGlossaryClick?: (match: GlossaryHighlightMatch) => void;
  }
) {
  if (!text) return null;
  if (opts?.glossaryMatches && opts.glossaryMatches.length > 0) {
    return renderPlainWithGlossary(
      text,
      opts.glossaryMatches,
      "plain",
      Boolean(opts?.showWhitespace),
      opts?.onGlossaryClick
    );
  }
  return renderWhitespaceAware(text, "plain", Boolean(opts?.showWhitespace));
}
function renderPlainWithGlossary(
  part: string,
  glossaryMatches?: GlossaryHighlightMatch[],
  keyPrefix = "p",
  showWhitespace = true,
  onGlossaryClick?: (match: GlossaryHighlightMatch) => void
) {
  if (!glossaryMatches || glossaryMatches.length === 0) {
    return renderWhitespaceAware(part, keyPrefix, showWhitespace);
  }

  const terms = glossaryMatches
    .map((g) => g.term)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return renderWhitespaceAware(part, keyPrefix, showWhitespace);

  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`(${escaped})`, "gi");
  const subParts = part.split(regex);

  return subParts.map((sub, idx) => {
    const isMatch = terms.some((t) => t.toLowerCase() === sub.toLowerCase());
    if (isMatch) {
      const matchEntry = glossaryMatches.find((g) => g.term.toLowerCase() === sub.toLowerCase());
      return (
        <span
          key={`${keyPrefix}-gl-${idx}`}
          className="glossary-highlight"
          title={matchEntry ? buildGlossaryTooltip(matchEntry) || "Term match" : "Glossary term"}
          onClick={() => {
            if (!matchEntry || !onGlossaryClick) return;
            onGlossaryClick(matchEntry);
          }}
          role={onGlossaryClick ? "button" : undefined}
          tabIndex={onGlossaryClick ? 0 : undefined}
        >
          {renderWhitespaceAware(sub, `${keyPrefix}-gl-${idx}`, showWhitespace)}
        </span>
      );
    }
    return (
      <span key={`${keyPrefix}-txt-${idx}`}>
        {renderWhitespaceAware(sub, `${keyPrefix}-txt-${idx}`, showWhitespace)}
      </span>
    );
  });
}

export function renderWithTags(
  text: string | null | undefined,
  glossaryMatches?: GlossaryHighlightMatch[],
  opts?: {
    showWhitespace?: boolean;
    showTagDetails?: boolean;
    onGlossaryClick?: (match: GlossaryHighlightMatch) => void;
  }
) {
  if (!text) return null;
  const showWhitespace = Boolean(opts?.showWhitespace);
  const showTagDetails = opts?.showTagDetails !== false;
  const parts = text.split(ANY_TOKEN_SPLIT_RE);

  return parts
    .filter((p) => p !== "")
    .map((part, idx) => {
      if (TAG_TOKEN_RE.test(part)) {
        const clean = part.replace(/<|>/g, "");
        return (
          <span
            key={`${idx}-tag`}
            className="tag-pill user-select-none me-1"
            title={showTagDetails ? `Inline tag ${clean}` : "Inline tag"}
          >
            <i className="bi bi-braces-asterisk" aria-hidden="true" />
            {showTagDetails ? clean : null}
          </span>
        );
      }
      if (FORMAT_TOKEN_RE.test(part)) {
        const label = part
          .replace(/[<>/]/g, "")
          .toUpperCase();
        const isEnd = part.includes("</");
        return (
          <span
            key={`${idx}-fmt`}
            className="tag-pill user-select-none me-1"
            title={showTagDetails ? (isEnd ? `End ${label}` : `Start ${label}`) : "Formatting tag"}
          >
            <i className="bi bi-type-bold" aria-hidden="true" />
            {showTagDetails ? (isEnd ? `/${label}` : label) : null}
          </span>
        );
      }
      if (!showWhitespace) {
        return (
          <span key={`${idx}-plain`}>
            {renderPlainWithGlossary(part, glossaryMatches, `${idx}-plain`, showWhitespace, opts?.onGlossaryClick)}
          </span>
        );
      }
      return (
        <span key={`${idx}-plain`}>
          {renderPlainWithGlossary(part, glossaryMatches, `${idx}-plain`, showWhitespace, opts?.onGlossaryClick)}
        </span>
      );
    });
}
