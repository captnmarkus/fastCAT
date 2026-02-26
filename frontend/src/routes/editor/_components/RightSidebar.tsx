import React, { useMemo } from "react";
import type { Match, Segment, TermbaseConcordanceEntry } from "../../../api";
import { formatDateTime } from "../../../utils/format";
import { findHighlightRange } from "../../../utils/concordance";
import { getFieldValue, statusLabel } from "../../../utils/termbase";

type PanelKey = "lookups" | "issues" | "comments" | "history";
type TermOccurrence = { segmentId: number; segmentNo: number };
type TermOccurrences = { source: TermOccurrence[]; target: TermOccurrence[] };
type ConcordanceMatch = NonNullable<TermbaseConcordanceEntry["matches"]>[number];
type IssueListItem = {
  segmentId: number;
  segmentNo: number;
  severity: "error" | "warning";
  code: string;
  message: string;
};

function stripInlineTags(value: string): string {
  return String(value ?? "")
    .replace(/<\/?\d+>/g, " ")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchReason(match?: ConcordanceMatch) {
  if (!match) return null;
  if (match.type === "exact") return "Exact match";
  if (match.type === "boundary") return "Word match";
  if (match.type === "prefix") return "Prefix match";
  if (match.type === "overlap") {
    const ratio = typeof match.ratio === "number" ? ` (${match.ratio.toFixed(2)})` : "";
    return `Token overlap${ratio}`;
  }
  if (match.type === "fuzzy") {
    const ratio = typeof match.ratio === "number" ? ` (${match.ratio.toFixed(2)})` : "";
    return `Fuzzy${ratio}`;
  }
  return "Match";
}

function pickPrimaryTarget(terms: TermbaseConcordanceEntry["targetTerms"]) {
  if (!terms || terms.length === 0) return null;
  return terms.find((term) => term.status === "preferred") ?? terms[0] ?? null;
}

function formatIssueCode(code: string) {
  return String(code || "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export default function RightSidebar(props: {
  panel: PanelKey;
  setPanel: (value: PanelKey) => void;
  active: Segment | undefined;
  termbaseId: number | null;
  sourceLang: string;
  targetLang: string;
  concordanceEntries: TermbaseConcordanceEntry[];
  concordanceLoading: boolean;
  concordanceMode: "auto" | "search";
  setConcordanceMode: (value: "auto" | "search") => void;
  concordanceQuery: string;
  setConcordanceQuery: (value: string) => void;
  concordanceFilters: {
    searchSource: boolean;
    searchTarget: boolean;
    includeDeprecated: boolean;
    includeForbidden: boolean;
    category: string;
  };
  setConcordanceFilters: React.Dispatch<
    React.SetStateAction<{
      searchSource: boolean;
      searchTarget: boolean;
      includeDeprecated: boolean;
      includeForbidden: boolean;
      category: string;
    }>
  >;
  getOccurrencesForTerm: (term: string) => TermOccurrences;
  onJumpToOccurrence: (segmentId: number, term: string, side: "source" | "target") => void;
  tmMatches: Match[];
  mtSuggestion: string;
  lookupsFilter: "all" | "terms" | "tm" | "mt";
  lookupsView: "detailed" | "compact";
  smartCasing: boolean;
  setSmartCasing: (value: boolean) => void;
  onGenerateMt: () => void | Promise<void>;
  onInsertTm: () => void | Promise<void>;
  onInsertGlossary: () => void | Promise<void>;
  onInsertGlossaryTerm: (
    termText: string,
    status?: "preferred" | "allowed" | "forbidden",
    sourceTerm?: string
  ) => void | Promise<void>;
  onInsertMt: () => void | Promise<void>;
  issues: IssueListItem[];
  issueFilter: "all" | "error" | "warning";
  setIssueFilter: (value: "all" | "error" | "warning") => void;
  onJumpToIssue: (segmentId: number) => void;
}) {
  const panel = props.panel;
  const setPanel = props.setPanel;
  const disabled = !props.active;
  const showTerms = props.lookupsFilter === "all" || props.lookupsFilter === "terms";
  const showTm = props.lookupsFilter === "all" || props.lookupsFilter === "tm";
  const showMt = props.lookupsFilter === "all" || props.lookupsFilter === "mt";
  const compact = props.lookupsView === "compact";
  const autoQuery = useMemo(
    () => stripInlineTags(props.active?.src ?? ""),
    [props.active?.src]
  );
  const displayQuery = props.concordanceMode === "auto" ? autoQuery : props.concordanceQuery;
  const termbaseMissing = props.termbaseId == null;
  const issueCount = props.issues.length;
  const filteredIssues = useMemo(() => {
    if (props.issueFilter === "all") return props.issues;
    return props.issues.filter((issue) => issue.severity === props.issueFilter);
  }, [props.issueFilter, props.issues]);

  return (
    <aside className="fc-editor-sidebar">
      <div className="fc-editor-sidebar-icons">
        <button
          type="button"
          className={`fc-editor-sidebar-icon ${panel === "lookups" ? "active" : ""}`}
          onClick={() => setPanel("lookups")}
          title="Lookups"
        >
          <i className="bi bi-search" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`fc-editor-sidebar-icon ${panel === "issues" ? "active" : ""}`}
          onClick={() => setPanel("issues")}
          title="Issues"
        >
          <i className="bi bi-exclamation-triangle" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`fc-editor-sidebar-icon ${panel === "comments" ? "active" : ""}`}
          onClick={() => setPanel("comments")}
          title="Comments"
        >
          <i className="bi bi-chat-left-text" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`fc-editor-sidebar-icon ${panel === "history" ? "active" : ""}`}
          onClick={() => setPanel("history")}
          title="History"
        >
          <i className="bi bi-clock-history" aria-hidden="true" />
        </button>
      </div>

      <div className="fc-editor-sidebar-panel">
        {panel === "lookups" ? (
          <div className={`p-3 ${compact ? "fc-lookups-compact" : ""}`}>
            <div className="d-flex align-items-center justify-content-between mb-2">
              <div className="fw-semibold">Lookups</div>
              <div className="text-muted small">Segment suggestions</div>
            </div>

            {showTerms ? (
              <div className="mb-3">
                <div className="d-flex align-items-center justify-content-between">
                  <div className="fw-semibold small text-uppercase text-muted">Termbase</div>
                </div>

                <div className="fc-lookups-controls mt-2">
                  <div className="btn-group btn-group-sm" role="group" aria-label="Lookup mode">
                    <button
                      type="button"
                      className={`btn btn-outline-secondary ${props.concordanceMode === "auto" ? "active" : ""}`}
                      onClick={() => props.setConcordanceMode("auto")}
                    >
                      Auto (segment)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-outline-secondary ${props.concordanceMode === "search" ? "active" : ""}`}
                      onClick={() => props.setConcordanceMode("search")}
                    >
                      Search termbase
                    </button>
                  </div>

                  {props.concordanceMode === "search" ? (
                    <input
                      type="search"
                      className="form-control form-control-sm mt-2"
                      placeholder="Search termbase"
                      value={props.concordanceQuery}
                      onChange={(event) => props.setConcordanceQuery(event.target.value)}
                    />
                  ) : (
                    <div className="text-muted small mt-2">
                      {autoQuery ? `Auto: ${autoQuery}` : "Select a segment to see matches."}
                    </div>
                  )}

                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <label className="form-check form-check-inline small mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={props.concordanceFilters.searchSource}
                        onChange={(event) =>
                          props.setConcordanceFilters((prev) => {
                            const next = { ...prev, searchSource: event.target.checked };
                            if (!next.searchSource && !next.searchTarget) {
                              next.searchTarget = true;
                            }
                            return next;
                          })
                        }
                      />
                      <span className="form-check-label">
                        Source {props.sourceLang ? `(${props.sourceLang})` : ""}
                      </span>
                    </label>
                    <label className="form-check form-check-inline small mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={props.concordanceFilters.searchTarget}
                        onChange={(event) =>
                          props.setConcordanceFilters((prev) => {
                            const next = { ...prev, searchTarget: event.target.checked };
                            if (!next.searchSource && !next.searchTarget) {
                              next.searchSource = true;
                            }
                            return next;
                          })
                        }
                      />
                      <span className="form-check-label">
                        Target {props.targetLang ? `(${props.targetLang})` : ""}
                      </span>
                    </label>
                  </div>

                  <div className="d-flex flex-wrap gap-2 mt-1">
                    <label className="form-check form-check-inline small mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={props.concordanceFilters.includeDeprecated}
                        onChange={(event) =>
                          props.setConcordanceFilters((prev) => ({
                            ...prev,
                            includeDeprecated: event.target.checked
                          }))
                        }
                      />
                      <span className="form-check-label">Include deprecated</span>
                    </label>
                    <label className="form-check form-check-inline small mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={props.concordanceFilters.includeForbidden}
                        onChange={(event) =>
                          props.setConcordanceFilters((prev) => ({
                            ...prev,
                            includeForbidden: event.target.checked
                          }))
                        }
                      />
                      <span className="form-check-label">Include forbidden</span>
                    </label>
                  </div>

                  <div className="mt-2">
                    <input
                      type="search"
                      className="form-control form-control-sm"
                      placeholder="Filter Kategorie"
                      value={props.concordanceFilters.category}
                      onChange={(event) =>
                        props.setConcordanceFilters((prev) => ({
                          ...prev,
                          category: event.target.value
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between mt-2">
                  <label className="form-check form-switch small mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={props.smartCasing}
                      onChange={(event) => props.setSmartCasing(event.target.checked)}
                    />
                    <span className="form-check-label">Smart casing</span>
                  </label>
                </div>

                {termbaseMissing ? (
                  <div className="text-muted small mt-2">No termbase assigned.</div>
                ) : props.concordanceLoading ? (
                  <div className="text-muted small mt-2">Searching termbase...</div>
                ) : props.concordanceEntries.length === 0 ? (
                  <div className="text-muted small mt-2">No term matches.</div>
                ) : compact ? (
                  <div className="mt-2 d-grid gap-2">
                    {props.concordanceEntries.slice(0, 12).map((entry) => {
                      const bestMatch = entry.matches?.[0] ?? null;
                      const sourceTerm =
                        bestMatch?.lang === "source" ? bestMatch.term : entry.sourceTerms[0]?.text ?? "";
                      const primaryTarget = pickPrimaryTarget(entry.targetTerms);
                      return (
                        <div key={entry.entryId} className="fc-lookups-compact-item">
                          <div className="fw-semibold">{sourceTerm || "Term"}</div>
                          <div className="text-muted small">{primaryTarget?.text ?? "-"}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 d-grid gap-3">
                    {props.concordanceEntries.slice(0, 10).map((entry) => {
                      const bestMatch = entry.matches?.[0] ?? null;
                      const matchLabel = matchReason(bestMatch);
                      const sourceTerm =
                        bestMatch?.lang === "source" ? bestMatch.term : entry.sourceTerms[0]?.text ?? "";
                      const highlight = sourceTerm
                        ? findHighlightRange(sourceTerm, displayQuery)
                        : null;
                      const matchedSources = (entry.matches ?? [])
                        .filter((match) => match.lang === "source")
                        .map((match) => match.term);
                      const uniqueMatchedSources = Array.from(new Set(matchedSources));
                      const extraMatches = uniqueMatchedSources.filter((term) => term !== sourceTerm);

                      const primaryTarget = pickPrimaryTarget(entry.targetTerms);
                      const preferredTargets = entry.targetTerms.filter((term) => term.status === "preferred");
                      const otherTargets = entry.targetTerms.filter((term) => term.status !== "preferred");

                      const entryFields = entry.entryFields ?? null;
                      const category = getFieldValue(entryFields, ["Kategorie", "Category", "Domain"]);
                      const productType = getFieldValue(entryFields, ["Produkttyp", "Product type", "ProductType"]);
                      const updatedAt = primaryTarget?.updatedAt ?? entry.updatedAt ?? null;
                      const updatedLabel = updatedAt ? formatDateTime(updatedAt) : null;

                      const occurrenceTerm = bestMatch?.term ?? sourceTerm;
                      const occurrences = occurrenceTerm
                        ? props.getOccurrencesForTerm(occurrenceTerm)
                        : { source: [], target: [] };
                      const sourceOccurrences = occurrences.source.slice(0, 8);
                      const targetOccurrences = occurrences.target.slice(0, 8);
                      const sourceOverflow = Math.max(0, occurrences.source.length - sourceOccurrences.length);
                      const targetOverflow = Math.max(0, occurrences.target.length - targetOccurrences.length);

                      const sourceNode = highlight ? (
                        <>
                          {sourceTerm.slice(0, highlight.start)}
                          <span className="fc-term-match">
                            {sourceTerm.slice(highlight.start, highlight.end)}
                          </span>
                          {sourceTerm.slice(highlight.end)}
                        </>
                      ) : (
                        sourceTerm || "Term"
                      );

                      return (
                        <div key={entry.entryId} className="card-enterprise p-2 fc-term-card">
                          <div className="d-flex align-items-start justify-content-between gap-2">
                            <div>
                              <div className="fw-semibold fc-term-source">{sourceNode}</div>
                              <div className="text-muted small">
                                {props.sourceLang || "Source"}
                              </div>
                            </div>
                            {matchLabel ? (
                              <span className="badge text-bg-light fc-term-match-badge">
                                {matchLabel}
                              </span>
                            ) : null}
                          </div>

                          {matchLabel ? (
                            <div className="text-muted small mt-1">
                              Why matched: {matchLabel}
                              {Number.isFinite(entry.score) ? ` \u00b7 Score ${entry.score.toFixed(2)}` : ""}
                            </div>
                          ) : null}

                          {extraMatches.length > 0 ? (
                            <div className="text-muted small mt-1">
                              Also matched: {extraMatches.join(", ")}
                            </div>
                          ) : null}

                          <div className="fc-term-targets mt-2 d-flex flex-wrap gap-2">
                            {preferredTargets.map((term) => {
                              const info = statusLabel(term.status);
                              return (
                                <button
                                  key={`pref-${term.text}`}
                                  type="button"
                                  className={`fc-term-chip is-${info.tone}`}
                                  onClick={() =>
                                    void props.onInsertGlossaryTerm(term.text, term.status, sourceTerm)
                                  }
                                >
                                  <span className="fc-term-chip-text">{term.text}</span>
                                  <span className={`badge text-bg-${info.tone} fc-term-chip-badge`}>
                                    {info.label}
                                  </span>
                                </button>
                              );
                            })}
                            {otherTargets.map((term) => {
                              const info = statusLabel(term.status);
                              return (
                                <button
                                  key={`alt-${term.text}`}
                                  type="button"
                                  className={`fc-term-chip is-${info.tone}`}
                                  onClick={() =>
                                    void props.onInsertGlossaryTerm(term.text, term.status, sourceTerm)
                                  }
                                  title={info.label}
                                >
                                  <span className="fc-term-chip-text">{term.text}</span>
                                  <span className={`badge text-bg-${info.tone} fc-term-chip-badge`}>
                                    {info.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {(category || productType) && (
                            <div className="mt-2 fc-term-meta">
                              {category && <div className="small text-muted">Kategorie: {category}</div>}
                              {productType && <div className="small text-muted">Produkttyp: {productType}</div>}
                            </div>
                          )}

                          {entry.illustration ? (
                            <div className="mt-2 d-flex align-items-center gap-2">
                              {entry.illustration.url &&
                              entry.illustration.filename &&
                              /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.illustration.filename) ? (
                                <img
                                  className="fc-term-illustration-thumb"
                                  src={entry.illustration.url}
                                  alt={entry.illustration.filename || "Illustration"}
                                  onClick={() =>
                                    entry.illustration?.url && window.open(entry.illustration.url, "_blank")
                                  }
                                />
                              ) : null}
                              {entry.illustration.url ? (
                                <a
                                  href={entry.illustration.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="small"
                                >
                                  View illustration
                                </a>
                              ) : (
                                <span className="small text-muted">
                                  {entry.illustration.filename || "Illustration"}
                                </span>
                              )}
                            </div>
                          ) : null}

                          {(sourceOccurrences.length > 0 || targetOccurrences.length > 0) && (
                            <div className="mt-2 fc-term-occurrences">
                              <div className="text-uppercase text-muted small">Occurrences in this file</div>
                              <div className="small">
                                <span className="text-muted me-2">Source:</span>
                                {sourceOccurrences.length === 0 ? (
                                  <span className="text-muted">-</span>
                                ) : (
                                  <>
                                    {sourceOccurrences.map((occ) => (
                                      <button
                                        key={`src-${entry.entryId}-${occ.segmentId}`}
                                        type="button"
                                        className="fc-term-occurrence"
                                        onClick={() =>
                                          props.onJumpToOccurrence(occ.segmentId, occurrenceTerm, "source")
                                        }
                                      >
                                        {occ.segmentNo}
                                      </button>
                                    ))}
                                    {sourceOverflow > 0 ? (
                                      <span className="text-muted ms-1">+{sourceOverflow}</span>
                                    ) : null}
                                  </>
                                )}
                              </div>
                              <div className="small">
                                <span className="text-muted me-2">Target:</span>
                                {targetOccurrences.length === 0 ? (
                                  <span className="text-muted">-</span>
                                ) : (
                                  <>
                                    {targetOccurrences.map((occ) => (
                                      <button
                                        key={`tgt-${entry.entryId}-${occ.segmentId}`}
                                        type="button"
                                        className="fc-term-occurrence"
                                        onClick={() =>
                                          props.onJumpToOccurrence(occ.segmentId, occurrenceTerm, "target")
                                        }
                                      >
                                        {occ.segmentNo}
                                      </button>
                                    ))}
                                    {targetOverflow > 0 ? (
                                      <span className="text-muted ms-1">+{targetOverflow}</span>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {updatedLabel ? (
                            <div className="mt-2 fc-term-updated small text-muted">
                              Updated: {updatedLabel}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {showTm ? (
              <div className="mb-3">
                <div className="d-flex align-items-center justify-content-between">
                  <div className="fw-semibold small text-uppercase text-muted">TM</div>
                </div>
                {props.tmMatches.length === 0 ? (
                  <div className="text-muted small mt-2">No TM matches loaded.</div>
                ) : compact ? (
                  <div className="mt-2 d-grid gap-2">
                    {props.tmMatches.slice(0, 8).map((m, idx) => {
                      const pct = Math.round(Math.max(0, Math.min(1, m.score)) * 100);
                      return (
                        <div key={`${idx}-${m.source}`} className="fc-lookups-compact-item">
                          <div className="d-flex align-items-center justify-content-between gap-2">
                            <div className="fw-semibold small">TM {pct}%</div>
                            <span className="badge text-bg-light">TM</span>
                          </div>
                          <div className="text-muted small">{m.target}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 d-grid gap-2">
                    {props.tmMatches.slice(0, 5).map((m, idx) => {
                      const pct = Math.round(Math.max(0, Math.min(1, m.score)) * 100);
                      return (
                        <div key={`${idx}-${m.source}`} className="card-enterprise p-2">
                          <div className="d-flex justify-content-between align-items-center gap-2">
                            <div className="fw-semibold small">TM {pct}%</div>
                            <span className="badge text-bg-light">TM</span>
                          </div>
                          <div className="text-muted small mt-1">{m.target}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {showMt ? (
              <div>
                <div className="d-flex align-items-center justify-content-between">
                  <div className="fw-semibold small text-uppercase text-muted">MT</div>
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      disabled={disabled}
                      onClick={() => void props.onGenerateMt()}
                    >
                      Generate
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      disabled={disabled || !props.mtSuggestion}
                      onClick={() => void props.onInsertMt()}
                    >
                      Insert
                    </button>
                  </div>
                </div>
                {props.mtSuggestion ? (
                  <div className={`${compact ? "fc-lookups-compact-item" : "card-enterprise p-2"} mt-2`}>
                    <div className="text-muted small">{props.mtSuggestion}</div>
                  </div>
                ) : (
                  <div className="text-muted small mt-2">No MT suggestion yet.</div>
                )}
              </div>
            ) : null}
          </div>
        ) : panel === "issues" ? (
          <div className="p-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <div className="fw-semibold">Issues</div>
              <div className="text-muted small">{issueCount} total</div>
            </div>

            <div className="btn-group btn-group-sm" role="group" aria-label="Issue filter">
              <button
                type="button"
                className={`btn btn-outline-secondary ${props.issueFilter === "all" ? "active" : ""}`}
                onClick={() => props.setIssueFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={`btn btn-outline-secondary ${props.issueFilter === "error" ? "active" : ""}`}
                onClick={() => props.setIssueFilter("error")}
              >
                Errors
              </button>
              <button
                type="button"
                className={`btn btn-outline-secondary ${props.issueFilter === "warning" ? "active" : ""}`}
                onClick={() => props.setIssueFilter("warning")}
              >
                Warnings
              </button>
            </div>

            {filteredIssues.length === 0 ? (
              <div className="text-muted small mt-3">No issues to review.</div>
            ) : (
              <div className="mt-3 d-grid gap-2">
                {filteredIssues.map((issue, idx) => (
                  <button
                    key={`${issue.segmentId}-${issue.code}-${idx}`}
                    type="button"
                    className="fc-issue-item"
                    onClick={() => props.onJumpToIssue(issue.segmentId)}
                  >
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <span
                        className={`badge text-bg-${issue.severity === "error" ? "danger" : "warning"} fc-issue-badge`}
                      >
                        {issue.severity === "error" ? "Error" : "Warning"}
                      </span>
                      <span className="text-muted small">#{issue.segmentNo}</span>
                    </div>
                    <div className="small fw-semibold mt-1">{formatIssueCode(issue.code) || "Issue"}</div>
                    <div className="small text-muted">{issue.message}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3">
            <div className="fw-semibold mb-2">{panel.toUpperCase()}</div>
            <div className="text-muted small">Coming soon.</div>
          </div>
        )}
      </div>
    </aside>
  );
}
