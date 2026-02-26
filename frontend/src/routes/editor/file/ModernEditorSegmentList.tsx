import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Segment, SegmentRun } from "../../../api";
import type { SegmentIssue } from "../../../utils/qa";

export default function ModernEditorSegmentList(props: {
  segments: Segment[];
  activeId: number | null;
  selectedIds: Set<number>;
  draftById: Record<number, string>;
  draftRunsById: Record<number, SegmentRun[]>;
  showWhitespace: boolean;
  showTags: boolean;
  taskReadOnly: boolean;
  issuesById: Record<number, SegmentIssue[]>;
  occurrenceHighlight?: { segmentId: number; term: string; side: "source" | "target" } | null;
  mtGenerating: Set<number>;
  getGlossaryMatchesForText: (text: string) => Array<{ term: string }>;
  onRowSelect: (segmentId: number, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onToggleSelection: (segmentId: number) => void;
  onSetActive: (segmentId: number) => void;
  onUpdateTarget: (segmentId: number, value: string) => void;
  onEnsureTmHints: (items: Segment[]) => Promise<void>;
  onGenerateMt: (segmentId: number) => Promise<void>;
  onToggleReviewed: (segmentId: number, reviewed: boolean) => Promise<void>;
  onToggleLock: (segmentId: number, locked: boolean) => Promise<void>;
  onShowIssues: () => void;
  onCopyPlaceholders: (segmentId: number) => void;
  onFixPlaceholders: (segmentId: number) => void;
  onJumpRelative: (delta: number) => void;
  segmentState: (segment: Segment) => "draft" | "nmt_draft" | "under_review" | "reviewed";
  segmentStateLabel: Record<string, string>;
  isSegmentLocked: (segment: Segment) => boolean;
  stripInline: (value: string) => string;
  normalizeMatchScorePct: (value: { score?: number | null }) => number;
  renderWithTags: (value: string, glossary?: any, options?: { showWhitespace?: boolean }) => React.ReactNode;
  renderPlainText: (value: string, options?: { showWhitespace?: boolean; glossaryMatches?: any }) => React.ReactNode;
}) {
  const hasInlineTags = (value: string) => /<\/?\d+>|<\/?(?:b|strong|i|em|u)>/i.test(String(value ?? ""));
  const runToCss = (run: any): React.CSSProperties => {
    const style = run?.style ?? {};
    const css: React.CSSProperties = {};
    if (style.fontFamily) css.fontFamily = String(style.fontFamily);
    if (style.fontSizePt != null && Number.isFinite(Number(style.fontSizePt))) {
      css.fontSize = `${Number(style.fontSizePt)}pt`;
    }
    if (style.bold === true) css.fontWeight = 700;
    if (style.italic === true) css.fontStyle = "italic";
    if (style.underline === true) css.textDecoration = "underline";
    if (style.color) css.color = `#${String(style.color).replace(/^#/, "")}`;
    return css;
  };
  const dominantRunCss = (runs: any[] | undefined): React.CSSProperties => {
    if (!Array.isArray(runs) || runs.length === 0) return {};
    const scores = new Map<string, { css: React.CSSProperties; count: number }>();
    for (const run of runs) {
      const text = String(run?.text ?? "");
      if (!text) continue;
      const css = runToCss(run);
      const key = JSON.stringify({
        fontFamily: css.fontFamily ?? null,
        fontSize: css.fontSize ?? null,
        fontWeight: css.fontWeight ?? null,
        fontStyle: css.fontStyle ?? null,
        textDecoration: css.textDecoration ?? null,
        color: css.color ?? null
      });
      const prev = scores.get(key);
      if (prev) {
        prev.count += text.length;
      } else {
        scores.set(key, { css, count: text.length });
      }
    }
    let best: { css: React.CSSProperties; count: number } | null = null;
    for (const entry of scores.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    return best?.css ?? {};
  };
  const renderRuns = (runs: any[] | undefined, fallback: string, keyPrefix: string, glossaryMatches?: any) => {
    if (!Array.isArray(runs) || runs.length === 0) {
      return props.renderPlainText(fallback, { showWhitespace: props.showWhitespace, glossaryMatches });
    }
    return runs.map((run, index) => (
      <span key={`${keyPrefix}-${index}`} style={runToCss(run)}>
        {props.renderPlainText(String(run?.text ?? ""), { showWhitespace: props.showWhitespace, glossaryMatches })}
      </span>
    ));
  };

  const parentRef = useRef<HTMLDivElement | null>(null);
  const ensuredTmRef = useRef("");

  const rowVirtualizer = useVirtualizer({
    count: props.segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 10,
    getItemKey: (index) => props.segments[index]?.id ?? index
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  useEffect(() => {
    if (!props.activeId) return;
    const activeIdx = props.segments.findIndex((seg) => seg.id === props.activeId);
    if (activeIdx >= 0) rowVirtualizer.scrollToIndex(activeIdx, { align: "auto" });
  }, [props.activeId, props.segments, rowVirtualizer]);

  useEffect(() => {
    const visible = virtualItems.map((item) => props.segments[item.index]).filter(Boolean) as Segment[];
    const key = visible.map((seg) => seg.id).join(",");
    if (!key || key === ensuredTmRef.current) return;
    ensuredTmRef.current = key;
    void props.onEnsureTmHints(visible);
  }, [props.onEnsureTmHints, props.segments, virtualItems]);

  return (
    <div className="fc-modern-segment-list">
      <div className="fc-modern-segment-header">
        <div>#</div>
        <div>Source</div>
        <div>Target</div>
        <div className="text-end">Actions</div>
      </div>
      <div ref={parentRef} className="fc-modern-segment-scroll">
        <div style={{ height: `${totalSize}px`, position: "relative" }}>
          {virtualItems.map((v) => {
            const seg = props.segments[v.index];
            if (!seg) return null;
            const state = props.segmentState(seg);
            const locked = props.isSegmentLocked(seg);
            const issues = props.issuesById[seg.id] ?? seg.issues ?? [];
            const issueCount = issues.length;
            const hasError = issues.some((issue) => issue.severity === "error");
            const hasDraft = Object.prototype.hasOwnProperty.call(props.draftById, seg.id);
            const hasDraftRuns = Object.prototype.hasOwnProperty.call(props.draftRunsById, seg.id);
            const targetValue = hasDraft ? props.draftById[seg.id] ?? "" : seg.tgt ?? "";
            const targetRuns = hasDraftRuns ? props.draftRunsById[seg.id] : seg.tgtRuns;
            const targetInputStyle = dominantRunCss(
              Array.isArray(targetRuns) && targetRuns.length > 0 ? (targetRuns as any[]) : (seg.srcRuns as any[] | undefined)
            );
            const glossaryMatches = props.getGlossaryMatchesForText(props.stripInline(seg.src));
            const placeholderIssues = issues.filter((issue) => {
              const code = String(issue.code || "").toLowerCase();
              return code.includes("placeholder") || code.includes("tag");
            });
            const isActive = seg.id === props.activeId;
            const isSelected = props.selectedIds.has(seg.id);
            const sourceScore = seg.sourceType === "tmx" && seg.sourceScore != null ? props.normalizeMatchScorePct({ score: seg.sourceScore }) : null;
            const rowHasOccurrence = props.occurrenceHighlight?.segmentId === seg.id;

            return (
              <div
                key={seg.id}
                ref={rowVirtualizer.measureElement}
                data-index={v.index}
                tabIndex={0}
                className={`fc-modern-segment-row ${isActive ? "active" : ""} ${isSelected ? "selected" : ""} ${
                  rowHasOccurrence ? "has-occurrence" : ""
                }`}
                style={{ transform: `translateY(${v.start}px)` }}
                onMouseDown={(event) => {
                  if ((event.target as HTMLElement)?.closest("textarea,button,input")) return;
                  props.onRowSelect(seg.id, event);
                  try {
                    (event.currentTarget as HTMLDivElement).focus();
                  } catch {
                    // ignore focus errors
                  }
                }}
                onFocus={() => props.onSetActive(seg.id)}
              >
                <div className="fc-modern-segment-meta">
                  <label className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={isSelected}
                      onChange={() => props.onToggleSelection(seg.id)}
                      aria-label={`Select segment ${seg.index + 1}`}
                    />
                  </label>
                  <div className="fc-modern-segment-index">#{seg.index + 1}</div>
                  <span className={`fc-modern-state-dot is-${state}`} title={props.segmentStateLabel[state]} />
                  <span className={`fc-modern-state-pill is-${state}`}>{props.segmentStateLabel[state]}</span>
                </div>

                <div className="fc-modern-segment-source">
                  <div className="fc-modern-segment-source-text" tabIndex={-1} data-segment-id={seg.id}>
                    {hasInlineTags(seg.src) && props.showTags
                      ? props.renderWithTags(seg.src, glossaryMatches as any, {
                          showWhitespace: props.showWhitespace
                        })
                      : renderRuns(seg.srcRuns as any[] | undefined, seg.src, `src-${seg.id}`, glossaryMatches as any)}
                  </div>
                  <div className="fc-modern-segment-source-meta">
                    {seg.sourceType ? <span className="badge text-bg-light">{String(seg.sourceType).toUpperCase()}</span> : null}
                    {sourceScore != null ? <span className="small text-muted">{sourceScore}%</span> : null}
                    {issueCount > 0 ? (
                      <button
                        type="button"
                        className="fc-modern-issue-badge"
                        onClick={() => {
                          props.onSetActive(seg.id);
                          props.onShowIssues();
                        }}
                        title={issues.map((issue) => issue.message).join("\n")}
                      >
                        <i className={`bi ${hasError ? "bi-exclamation-triangle-fill" : "bi-exclamation-triangle"}`} />
                        <span>{issueCount}</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="fc-modern-segment-target">
                  {isActive && !locked && !props.taskReadOnly ? (
                    <>
                      <textarea
                        className="form-control form-control-sm fc-modern-target-input fc-editor-cell-input"
                        data-segment-id={seg.id}
                        value={targetValue}
                        rows={2}
                        style={targetInputStyle}
                        onFocus={() => props.onSetActive(seg.id)}
                        onChange={(event) => props.onUpdateTarget(seg.id, event.target.value)}
                      />
                      {placeholderIssues.length > 0 ? (
                        <div className="fc-modern-tag-actions">
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => props.onCopyPlaceholders(seg.id)}>
                            Copy tags
                          </button>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => props.onFixPlaceholders(seg.id)}>
                            Fix placeholders
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className={`fc-modern-target-preview ${locked ? "locked" : ""}`}>
                      {hasInlineTags(targetValue) && props.showTags
                        ? props.renderWithTags(targetValue, undefined, { showWhitespace: props.showWhitespace })
                        : renderRuns(targetRuns as any[] | undefined, targetValue, `tgt-${seg.id}`)}
                    </div>
                  )}
                </div>

                <div className="fc-modern-segment-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => void props.onGenerateMt(seg.id)}
                    title="Generate MT suggestion"
                    aria-label={`Generate suggestion for segment ${seg.index + 1}`}
                    disabled={props.mtGenerating.has(seg.id)}
                  >
                    {props.mtGenerating.has(seg.id) ? <i className="bi bi-arrow-repeat" /> : <i className="bi bi-lightning-charge" />}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm fc-modern-row-action-reviewed ${state === "reviewed" ? "is-reviewed" : "btn-outline-secondary"}`}
                    onClick={() => void props.onToggleReviewed(seg.id, state !== "reviewed")}
                    title={state === "reviewed" ? "Unreview" : "Mark reviewed"}
                    aria-label={`Toggle reviewed for segment ${seg.index + 1}`}
                    disabled={props.taskReadOnly}
                  >
                    <i className={`bi ${state === "reviewed" ? "bi-arrow-counterclockwise" : "bi-check2"}`} />
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm fc-modern-row-action-lock ${locked ? "is-locked" : "btn-outline-secondary"}`}
                    onClick={() => void props.onToggleLock(seg.id, !locked)}
                    title={locked ? "Unlock segment" : "Lock segment"}
                    aria-label={`Toggle lock for segment ${seg.index + 1}`}
                    disabled={props.taskReadOnly}
                  >
                    <i className={`bi ${locked ? "bi-lock-fill" : "bi-unlock"}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
