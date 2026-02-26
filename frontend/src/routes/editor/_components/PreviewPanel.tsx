import React, { useMemo } from "react";
import type { Segment } from "../../../api";

function stripTokens(value: string) {
  return value
    .replace(/<\/?\d+>/g, "")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function PreviewPanel(props: {
  segments: Segment[];
  draftById: Record<number, string>;
  activeId: number | null;
  onSelectSegment: (id: number) => void;
  mode: "split" | "on";
  loading: boolean;
}) {
  const rows = useMemo(
    () =>
      props.segments.map((seg) => {
        const hasDraft = Object.prototype.hasOwnProperty.call(props.draftById, seg.id);
        const value = hasDraft ? props.draftById[seg.id] : seg.tgt ?? seg.src ?? "";
        const clean = stripTokens(String(value || ""));
        return {
          id: seg.id,
          index: seg.index + 1,
          text: clean,
          isEmpty: !clean
        };
      }),
    [props.draftById, props.segments]
  );

  return (
    <aside className={`fc-editor-preview ${props.mode === "on" ? "is-full" : ""}`}>
      <div className="fc-editor-preview-header">Preview</div>
      <div className="fc-editor-preview-body">
        {props.loading ? (
          <div className="text-muted small">Loading preview...</div>
        ) : rows.length === 0 ? (
          <div className="text-muted small">No content to preview.</div>
        ) : (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`fc-editor-preview-row ${row.id === props.activeId ? "active" : ""} ${
                row.isEmpty ? "is-empty" : ""
              }`}
              onClick={() => props.onSelectSegment(row.id)}
            >
              <span className="fc-editor-preview-index">{row.index}</span>
              <span className="fc-editor-preview-text">
                {row.isEmpty ? "Empty segment" : row.text}
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
