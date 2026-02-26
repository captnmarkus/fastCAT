import React, { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Segment } from "../../../api";
import type { SegmentIssue } from "../../../utils/qa";
import type { GlossaryHighlightMatch } from "../../../utils/termbase";
import { renderPlainText, renderWithTags } from "../../../utils/tags";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState, SEGMENT_STATE_LABEL } from "../../../utils/segmentState";

function normalizeSourceScore(score: number | null | undefined) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const normalized = score <= 1 ? score * 100 : score;
  return Math.round(Math.max(0, Math.min(100, normalized)));
}

export default function SegmentGrid(props: {
  segments: Segment[];
  activeId: number | null;
  setActiveId: (id: number) => void;
  showWhitespace: boolean;
  showTags: boolean;
  showTagDetails: boolean;
  textZoom: number;
  layoutMode: "horizontal" | "vertical";
  enterBehavior: "confirm" | "next";
  issuesById: Record<number, SegmentIssue[]>;
  draftById: Record<number, string>;
  taskReadOnly: boolean;
  ensureTmHints: (items: Segment[]) => Promise<void>;
  onUpdateTarget: (segmentId: number, value: string) => void;
  onMarkReviewed: (segmentId: number) => void | Promise<void>;
  onShowIssues?: () => void;
  matchIndices: Set<number>;
  occurrenceHighlight?: { segmentId: number; term: string; side: "source" | "target" } | null;
  getGlossaryMatchesForText?: (text: string) => GlossaryHighlightMatch[];
  onGlossaryInsert?: (segmentId: number, match: GlossaryHighlightMatch) => void;
  onCopyPlaceholders?: (segmentId: number) => void;
  onFixPlaceholders?: (segmentId: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const lastTmEnsureKeyRef = useRef<string>("");

  const rowVirtualizer = useVirtualizer({
    count: props.segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 12,
    getItemKey: (index) => {
      const seg = props.segments[index];
      return seg ? `${seg.id}:${seg.version}` : index;
    }
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  useEffect(() => {
    const activeIdx = props.activeId ? props.segments.findIndex((s) => s.id === props.activeId) : -1;
    if (activeIdx >= 0) {
      rowVirtualizer.scrollToIndex(activeIdx, { align: "auto" });
    }
  }, [props.activeId, props.segments, rowVirtualizer]);

  useEffect(() => {
    const items = virtualItems.map((v) => props.segments[v.index]).filter(Boolean) as Segment[];
    const key = items.map((s) => s.id).join(",");
    if (!key || key === lastTmEnsureKeyRef.current) return;
    lastTmEnsureKeyRef.current = key;
    void props.ensureTmHints(items);
  }, [props.ensureTmHints, props.segments, virtualItems]);

  useEffect(() => {
    if (!props.activeId) return;
    window.requestAnimationFrame(() => {
      const el = parentRef.current?.querySelector("textarea.fc-editor-cell-input") as HTMLTextAreaElement | null;
      el?.focus();
    });
  }, [props.activeId]);

  const whitespaceOpts = useMemo(
    () => ({ showWhitespace: props.showWhitespace, showTagDetails: props.showTagDetails }),
    [props.showTagDetails, props.showWhitespace]
  );
  const zoomStyle = useMemo(() => {
    if (!props.textZoom || props.textZoom === 100) return undefined;
    return { fontSize: `${props.textZoom}%` };
  }, [props.textZoom]);

  const setActiveByIndex = (idx: number) => {
    const seg = props.segments[idx];
    if (seg) props.setActiveId(seg.id);
  };

  const gridClassName = `fc-editor-grid ${props.layoutMode === "vertical" ? "is-vertical" : ""}`.trim();

  return (
    <div className={gridClassName} style={zoomStyle}>
      <div className="fc-editor-grid-header">
        <div className="fc-editor-cell fc-col-num">#</div>
        <div className="fc-editor-cell fc-col-src">Source</div>
        <div className="fc-editor-cell fc-col-tgt">Target</div>
        <div className="fc-editor-cell fc-col-icon fc-col-edited" title="Edited">
          <i className="bi bi-pencil" aria-hidden="true" />
        </div>
        <div className="fc-editor-cell fc-col-icon fc-col-confirmed" title="Confirmed">
          <i className="bi bi-check-lg" aria-hidden="true" />
        </div>
        <div className="fc-editor-cell fc-col-matchsrc">Src</div>
        <div className="fc-editor-cell fc-col-matchpct">%</div>
        <div className="fc-editor-cell fc-col-status">Review</div>
      </div>

      <div ref={parentRef} className="fc-editor-grid-scroll">
        <div style={{ height: `${totalSize}px`, width: "100%", position: "relative" }}>
            {virtualItems.map((v) => {
              const seg = props.segments[v.index]!;
              const status = normalizeSegmentStatus(seg.status);
              const state = coerceSegmentState(seg.state, status);
              const isActive = seg.id === props.activeId;
              const sourceType = seg.sourceType ?? "none";
              const sourceLabel = sourceType === "tmx" ? "TMX" : sourceType === "nmt" ? "NMT" : null;
              const sourceScore = normalizeSourceScore(seg.sourceScore ?? null);
              const showScore = sourceType === "tmx" && typeof sourceScore === "number";
              const rowHasFind = props.matchIndices.has(v.index);
              const isOccurrence = props.occurrenceHighlight?.segmentId === seg.id;

            const isLocked = seg.isLocked === undefined ? state === "reviewed" : Boolean(seg.isLocked);
            const editable = !isLocked && !props.taskReadOnly;
            const issues = props.issuesById[seg.id] ?? seg.issues ?? [];
            const errorCount = issues.filter((issue) => issue.severity === "error").length;
            const warningCount = issues.filter((issue) => issue.severity === "warning").length;
            const issueCount = errorCount + warningCount;
            const hasError = errorCount > 0;
            const hasWarn = !hasError && warningCount > 0;
            const placeholderIssues = issues.filter((issue) => {
              const code = issue.code.toLowerCase();
              return code.includes("placeholder") || code.includes("tag");
            });
            const warningTitle = issues.map((issue) => issue.message).join("\n");
            const hasDraft = Object.prototype.hasOwnProperty.call(props.draftById, seg.id);
            const tgtValue = hasDraft ? props.draftById[seg.id]! : seg.tgt ?? "";
            const glossaryMatches = props.getGlossaryMatchesForText ? props.getGlossaryMatchesForText(seg.src) : [];

            return (
              <div
                key={`${seg.id}:${seg.version}`}
                ref={rowVirtualizer.measureElement}
                data-index={v.index}
                className={`fc-editor-row ${isActive ? "active" : ""} ${rowHasFind ? "has-find" : ""} ${isOccurrence ? "has-occurrence" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`
                }}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement)?.closest?.("textarea,select,button,input")) return;
                  props.setActiveId(seg.id);
                }}
              >
                <div className="fc-editor-cell fc-col-num text-muted">{seg.index + 1}</div>

                <div className="fc-editor-cell fc-col-src">
                  {props.showTags
                    ? renderWithTags(seg.src, glossaryMatches, {
                        ...whitespaceOpts,
                        onGlossaryClick: (match) => props.onGlossaryInsert?.(seg.id, match)
                      })
                    : renderPlainText(seg.src, {
                        ...whitespaceOpts,
                        glossaryMatches,
                        onGlossaryClick: (match) => props.onGlossaryInsert?.(seg.id, match)
                      })}
                </div>

                <div className="fc-editor-cell fc-col-tgt" onClick={() => props.setActiveId(seg.id)}>
                  {isActive && editable ? (
                    <>
                      <textarea
                        className="fc-editor-cell-input"
                        value={tgtValue}
                        rows={1}
                        onChange={(e) => props.onUpdateTarget(seg.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Tab") {
                            e.preventDefault();
                            const next = e.shiftKey ? v.index - 1 : v.index + 1;
                            setActiveByIndex(next);
                            return;
                          }
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (e.ctrlKey) {
                              void props.onMarkReviewed(seg.id);
                              setActiveByIndex(v.index + 1);
                              return;
                            }
                            if (props.enterBehavior === "confirm") {
                              void props.onMarkReviewed(seg.id);
                            } else {
                              setActiveByIndex(v.index + 1);
                            }
                          }
                        }}
                        readOnly={!editable}
                      />
                      {placeholderIssues.length > 0 && (
                        <div className="fc-editor-placeholder-actions mt-2">
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onCopyPlaceholders?.(seg.id);
                            }}
                          >
                            Copy tags
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onFixPlaceholders?.(seg.id);
                            }}
                          >
                            Fix placeholders
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={`fc-editor-cell-preview ${isLocked ? "locked" : ""}`}>
                      {props.showTags
                        ? renderWithTags(tgtValue, undefined, whitespaceOpts)
                        : renderPlainText(tgtValue, whitespaceOpts)}
                    </div>
                  )}
                </div>

                <div className="fc-editor-cell fc-col-icon fc-col-edited text-muted" title={editable ? "Editable" : "Locked"}>
                  {editable && String(tgtValue ?? "").trim() ? <i className="bi bi-pencil" aria-hidden="true" /> : null}
                  {isLocked ? <i className="bi bi-lock-fill" aria-hidden="true" /> : null}
                </div>

                <div className="fc-editor-cell fc-col-icon fc-col-confirmed" title={state === "reviewed" ? "Reviewed" : "Mark reviewed"}>
                  {state === "reviewed" ? (
                    <i className="bi bi-check-circle-fill text-success" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void props.onMarkReviewed(seg.id);
                      }}
                      title="Mark reviewed"
                      disabled={props.taskReadOnly}
                    >
                      <i className="bi bi-check2" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="fc-editor-cell fc-col-matchsrc">
                  {sourceLabel ? <span className="badge text-bg-light">{sourceLabel}</span> : <span className="text-muted">-</span>}
                </div>

                <div className="fc-editor-cell fc-col-matchpct">
                  {showScore ? <span className="text-muted small">{sourceScore}%</span> : <span className="text-muted">-</span>}
                </div>

                <div className="fc-editor-cell fc-col-status">
                  {issueCount > 0 ? (
                    <button
                      type="button"
                      className="fc-segment-issue-chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.setActiveId(seg.id);
                        props.onShowIssues?.();
                      }}
                      title={warningTitle || "Issues"}
                    >
                      <i
                        className={`bi ${
                          hasError ? "bi-exclamation-triangle-fill text-danger" : "bi-exclamation-triangle text-warning"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="fc-segment-issue-count">{issueCount}</span>
                    </button>
                  ) : null}
                  <span className={`fc-segment-pill is-${state}`}>
                    {SEGMENT_STATE_LABEL[state]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
