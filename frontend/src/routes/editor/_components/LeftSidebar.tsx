import React, { useEffect, useMemo, useState } from "react";
import type { Segment } from "../../../api";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState } from "../../../utils/segmentState";

export type OutlineItem = {
  id: string;
  label: string;
  level: number;
  segmentId: number;
};

type PanelKey = "navigation" | "structure";

function stripTokens(value: string) {
  return value
    .replace(/<\/?\d+>/g, "")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSnippet(value: string, max = 64) {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}...`;
}

export default function LeftSidebar(props: {
  segments: Segment[];
  activeId: number | null;
  setActiveId: (id: number) => void;
  showNavigation: boolean;
  showDocumentStructure: boolean;
  outlineItems: OutlineItem[];
}) {
  const navEnabled = props.showNavigation;
  const structureEnabled = props.showDocumentStructure;
  const [panel, setPanel] = useState<PanelKey>(() =>
    navEnabled ? "navigation" : "structure"
  );

  useEffect(() => {
    if (panel === "navigation" && !navEnabled && structureEnabled) {
      setPanel("structure");
    } else if (panel === "structure" && !structureEnabled && navEnabled) {
      setPanel("navigation");
    }
  }, [navEnabled, panel, structureEnabled]);

  const segmentSnippets = useMemo(
    () =>
      props.segments.map((seg) => {
        const clean = stripTokens(String(seg.src || ""));
        const status = normalizeSegmentStatus(seg.status);
        return {
          id: seg.id,
          index: seg.index + 1,
          state: coerceSegmentState(seg.state, status),
          label: clean,
          snippet: toSnippet(clean || "Empty segment")
        };
      }),
    [props.segments]
  );

  return (
    <aside className="fc-editor-leftbar">
      <div className="fc-editor-leftbar-tabs">
        {navEnabled ? (
          <button
            type="button"
            className={`fc-editor-leftbar-tab ${panel === "navigation" ? "active" : ""}`}
            onClick={() => setPanel("navigation")}
          >
            Navigation
          </button>
        ) : null}
        {structureEnabled ? (
          <button
            type="button"
            className={`fc-editor-leftbar-tab ${panel === "structure" ? "active" : ""}`}
            onClick={() => setPanel("structure")}
          >
            Structure
          </button>
        ) : null}
      </div>

      <div className="fc-editor-leftbar-panel">
        {panel === "navigation" ? (
          <div className="fc-editor-leftbar-section">
            <div className="fc-editor-leftbar-section-header">
              <div className="fw-semibold">Navigation</div>
              <div className="text-muted small">{props.segments.length} segments</div>
            </div>
            {segmentSnippets.length === 0 ? (
              <div className="text-muted small p-2">No segments available.</div>
            ) : (
              <ul className="fc-editor-leftbar-list">
                {segmentSnippets.map((seg) => (
                  <li key={seg.id}>
                    <button
                      type="button"
                      className={`fc-editor-leftbar-item ${seg.id === props.activeId ? "active" : ""}`}
                      onClick={() => props.setActiveId(seg.id)}
                      title={seg.label}
                    >
                      <span className="fc-editor-leftbar-index">{seg.index}</span>
                      <span className="fc-editor-leftbar-text">{seg.snippet}</span>
                      <span className={`fc-editor-leftbar-status state-${seg.state}`} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="fc-editor-leftbar-section">
            <div className="fc-editor-leftbar-section-header">
              <div className="fw-semibold">Document Structure</div>
              <div className="text-muted small">
                {props.outlineItems.length === 0
                  ? "No headings detected"
                  : `${props.outlineItems.length} items`}
              </div>
            </div>
            {props.outlineItems.length === 0 ? (
              <div className="text-muted small p-2">No structure items found.</div>
            ) : (
              <ul className="fc-editor-leftbar-list">
                {props.outlineItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`fc-editor-leftbar-item ${item.segmentId === props.activeId ? "active" : ""}`}
                      style={{ paddingLeft: `${Math.max(0, Math.min(item.level - 1, 5)) * 12 + 8}px` }}
                      onClick={() => props.setActiveId(item.segmentId)}
                      title={item.label}
                    >
                      <span className="fc-editor-leftbar-text">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
