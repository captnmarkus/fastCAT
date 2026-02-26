import React, { useEffect, useMemo, useRef } from "react";
import type { Segment } from "../../../api";

export default function ModernEditorPreviewPane(props: {
  title: string;
  segments: Segment[];
  draftById: Record<number, string>;
  activeId: number | null;
  showTags: boolean;
  showWhitespace: boolean;
  onSelectSegment: (segmentId: number) => void;
  onAutoFocusSegment: (segmentId: number) => void;
  segmentTargetValue: (segment: Segment, draftById: Record<number, string>) => string;
  previewBlockMeta: (source: string) => { kind: "heading" | "paragraph"; level: number };
  renderWithTags: (value: string, glossary?: any, options?: { showWhitespace?: boolean }) => React.ReactNode;
  renderPlainText: (value: string, options?: { showWhitespace?: boolean }) => React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  const rows = useMemo(
    () =>
      props.segments.map((segment) => {
        const target = props.segmentTargetValue(segment, props.draftById) || segment.src || "";
        const meta = props.previewBlockMeta(segment.src);
        return {
          segmentId: segment.id,
          index: segment.index + 1,
          text: target,
          kind: meta.kind,
          level: meta.level
        };
      }),
    [props.draftById, props.previewBlockMeta, props.segmentTargetValue, props.segments]
  );

  useEffect(() => {
    if (!props.activeId) return;
    const node = rowRefs.current[props.activeId];
    if (!node) return;
    syncingRef.current = true;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => {
      syncingRef.current = false;
    }, 240);
    return () => window.clearTimeout(timer);
  }, [props.activeId]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const onScroll = () => {
      if (syncingRef.current) return;
      const now = Date.now();
      if (now - lastSyncAtRef.current < 120) return;
      lastSyncAtRef.current = now;

      const rootRect = root.getBoundingClientRect();
      const center = rootRect.top + rootRect.height * 0.33;
      let nearest: { id: number; distance: number } | null = null;

      for (const row of rows) {
        const node = rowRefs.current[row.segmentId];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (rect.bottom < rootRect.top || rect.top > rootRect.bottom) continue;
        const c = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(c - center);
        if (!nearest || distance < nearest.distance) nearest = { id: row.segmentId, distance };
      }

      if (nearest && nearest.id !== props.activeId) props.onAutoFocusSegment(nearest.id);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [props.activeId, props.onAutoFocusSegment, rows]);

  return (
    <div className="fc-modern-preview">
      <div className="fc-modern-preview-header">{props.title}</div>
      <div ref={containerRef} className="fc-modern-preview-scroll">
        {rows.map((row) => {
          const headingClass = row.kind === "heading" ? `is-heading h${row.level}` : "";
          return (
            <div
              key={row.segmentId}
              ref={(el) => {
                rowRefs.current[row.segmentId] = el;
              }}
              className={`fc-modern-preview-row ${headingClass} ${props.activeId === row.segmentId ? "active" : ""}`}
              onClick={() => props.onSelectSegment(row.segmentId)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onSelectSegment(row.segmentId);
                }
              }}
            >
              <span className="fc-modern-preview-index">{row.index}</span>
              <span className="fc-modern-preview-text">
                {props.showTags
                  ? props.renderWithTags(row.text, undefined, { showWhitespace: props.showWhitespace })
                  : props.renderPlainText(row.text, { showWhitespace: props.showWhitespace })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
