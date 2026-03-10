import React from "react";
import ModernEditorSegmentList from "./ModernEditorSegmentList";
import ModernEditorPreviewPane from "./ModernEditorPreviewPane";
import ModernEditorBottomPanel from "./ModernEditorBottomPanel";
import ModernEditorFindModal from "./ModernEditorFindModal";
import ModernEditorTopBar from "./ModernEditorTopBar";

export default function ModernEditorFileLayout(props: any) {
  const {
    editorRootRef,
    active,
    activeEditable,
    activeFilteredIndex,
    activeFilters,
    activeSegment,
    changeFontSizeForActiveSelection,
    bottomPanelOpen,
    bottomPanelHeight,
    bottomTab,
    bulkBusy,
    bulkApproveBusy,
    bulkApproveJob,
    bulkClearTargets,
    bulkLock,
    bulkMarkReviewed,
    hasProblematicFilterData,
    hasSkippedFilterData,
    canGoFilteredNext,
    canGoFilteredPrev,
    concordanceInputRef,
    concordanceQuery,
    concordanceResults,
    concordanceSearchError,
    concordanceSearchIn,
    concordanceSearchLoading,
    copyToClipboard,
    doComplete,
    doDownload,
    downloadReady,
    draftOnly,
    editor,
    EDITOR_FONT_SIZE_STEP,
    editorFontSize,
    fileId,
    filteredIndexById,
    filteredSegments,
    findMatchCount,
    findReplaceMode,
    findReplaceOpen,
    generateMt,
    goNextFiltered,
    goPrevFiltered,
    highlightConcordanceMatch,
    historyEntries,
    historyError,
    historyLoading,
    insertSymbol,
    isDeprecatedTerm,
    isSegmentLocked,
    lockedOnly,
    mtGeneratingSet,
    nav,
    ntmDraftOnly,
    onDismissBulkApproveJob,
    onOpenBulkApproveDialog,
    openConcordanceShortcut,
    openFindModal,
    onBottomPanelResizeStart,
    onRenderedPreviewOpenNewTab,
    onRenderedPreviewRefresh,
    previewEnabled,
    previewLayout,
    projectId,
    enableConcordanceCtrlK,
    reviewedOnly,
    rightSidebarOpen,
    renderPlainText,
    renderWithTags,
    saveLabel,
    saveToneClass,
    renderedPreviewConfiguredMethod,
    renderedPreviewDetails,
    renderedPreviewError,
    renderedPreviewErrorDetails,
    renderedPreviewLoading,
    renderedPreviewLogs,
    renderedPreviewPreviewId,
    renderedPreviewRevisionId,
    renderedPreviewStatus,
    renderedPreviewSupported,
    renderedPreviewWarnings,
    segmentState,
    segmentTargetValue,
    selectedCount,
    selectedIds,
    selectedSet,
    setBottomPanelOpen,
    setBottomTab,
    setConcordanceQuery,
    setConcordanceSearchIn,
    setEnableConcordanceCtrlK,
    setDraftOnly,
    setFindReplaceOpen,
    setLockedOnly,
    setNtmDraftOnly,
    setProblematicOnly,
    setPreviewEnabled,
    setPreviewLayout,
    setReviewedOnly,
    setRightSidebarOpen,
    setSkippedOnly,
    setShowFilters,
    setShowTags,
    setShowWhitespace,
    setSourceSearch,
    setStatusFilter,
    setTargetSearch,
    setTermHitsOnly,
    setTmxOnly,
    setUntranslatedOnly,
    setWithQaOnly,
    showFilters,
    showTags,
    showWhitespace,
    sourceLang,
    sourceSearch,
    statusFilter,
    stripInline,
    SYMBOL_PICKER_ITEMS,
    symbolsMenuRef,
    targetLang,
    targetSearch,
    taskId,
    taskReadOnly,
    problematicOnly,
    shortcutHelpItems,
    TERMBASE_CONCORDANCE_MIN_QUERY,
    termbaseDisplaySource,
    termbaseEntryCategory,
    previewBlockMeta,
    richFormattingSupported,
    skippedOnly,
    termHitsOnly,
    tmxOnly,
    catResultIndex,
    insertCatSuggestionByIndex,
    toggleBoldForActiveSelection,
    toggleSelectionOnly,
    untranslatedOnly,
    updateSelectionFromEvent,
    withQaOnly,
  } = props;
  const segmentStateLabel: Record<string, string> = {
    draft: "Draft",
    nmt_draft: "NTM draft",
    under_review: "Under review",
    reviewed: "Reviewed"
  };
  const normalizeMatchScorePct = (value: { score?: number | null }) => {
    const raw = Number(value?.score ?? 0);
    const normalized = raw <= 1 ? raw * 100 : raw;
    return Math.round(Math.max(0, Math.min(100, normalized)));
  };
  const approveMenuDisabled = taskReadOnly || bulkApproveBusy || !projectId || !fileId;
  return (
    <div
      ref={editorRootRef}
      className="fc-modern-editor"
      style={
        {
          "--fc-modern-editor-font-size": `${editorFontSize}px`
        } as React.CSSProperties
      }
    >
      <ModernEditorTopBar {...props} />

      <div className="fc-modern-toolbar">
        <div className="fc-modern-searchbar">
          <label className="fc-modern-search-input">
            <i className="bi bi-search" aria-hidden="true" />
            <input
              type="search"
              className="form-control form-control-sm"
              placeholder="Search in source"
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              aria-label="Search in source"
            />
          </label>
          <label className="fc-modern-search-input">
            <i className="bi bi-search" aria-hidden="true" />
            <input
              type="search"
              className="form-control form-control-sm"
              placeholder="Search in target"
              value={targetSearch}
              onChange={(e) => setTargetSearch(e.target.value)}
              aria-label="Search in target"
            />
          </label>
        </div>

        <div className="fc-modern-nav">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
            onClick={goPrevFiltered}
            disabled={!canGoFilteredPrev}
            aria-label="Previous segment"
          >
            <i className="bi bi-chevron-up" />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
            onClick={goNextFiltered}
            disabled={!canGoFilteredNext}
            aria-label="Next segment"
          >
            <i className="bi bi-chevron-down" />
          </button>
          <span className="fc-modern-position">
            {activeFilteredIndex >= 0 ? `${activeFilteredIndex + 1}/${filteredSegments.length}` : "-"}
          </span>
          <div className="position-relative">
            <button
              type="button"
              className={`btn btn-sm btn-outline-secondary fc-modern-filter-button ${showFilters ? "active" : ""}`}
              onClick={() => setShowFilters((prev) => !prev)}
            >
              <i className="bi bi-funnel me-1" />
              Add filters
              {activeFilters > 0 ? <span className="badge text-bg-dark ms-1">{activeFilters}</span> : null}
            </button>
            {showFilters ? (
              <div className="fc-modern-filter-popover">
                <label className="form-label mb-1">Status</label>
                <select
                  className="form-select form-select-sm mb-2"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="under_review">Under review</option>
                  <option value="reviewed">Reviewed</option>
                </select>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={untranslatedOnly}
                    onChange={(e) => setUntranslatedOnly(e.target.checked)}
                  />
                  <span className="form-check-label">Untranslated</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={draftOnly}
                    onChange={(e) => setDraftOnly(e.target.checked)}
                  />
                  <span className="form-check-label">Draft only</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={reviewedOnly}
                    onChange={(e) => setReviewedOnly(e.target.checked)}
                  />
                  <span className="form-check-label">Reviewed only</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={withQaOnly}
                    onChange={(e) => setWithQaOnly(e.target.checked)}
                  />
                  <span className="form-check-label">Has QA issues</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={lockedOnly}
                    onChange={(e) => setLockedOnly(e.target.checked)}
                  />
                  <span className="form-check-label">Locked</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={termHitsOnly}
                    onChange={(e) => setTermHitsOnly(e.target.checked)}
                  />
                  <span className="form-check-label">Has term hits</span>
                </label>
                <label className="form-check" title="Show segments currently marked as NTM draft provenance.">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={ntmDraftOnly}
                    onChange={(e) => setNtmDraftOnly(e.target.checked)}
                  />
                  <span className="form-check-label">NTM draft</span>
                </label>
                <label className="form-check" title="Show only segments whose target provenance is TMX.">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={tmxOnly}
                    onChange={(e) => setTmxOnly(e.target.checked)}
                  />
                  <span className="form-check-label">TMX only</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={skippedOnly}
                    onChange={(e) => setSkippedOnly(e.target.checked)}
                    disabled={!hasSkippedFilterData}
                  />
                  <span className="form-check-label">Skipped from last bulk</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={problematicOnly}
                    onChange={(e) => setProblematicOnly(e.target.checked)}
                    disabled={!hasProblematicFilterData}
                  />
                  <span className="form-check-label">Problematic from last bulk</span>
                </label>
                <div className="d-flex justify-content-end mt-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => {
                      setStatusFilter("all");
                      setUntranslatedOnly(false);
                      setDraftOnly(false);
                      setReviewedOnly(false);
                      setWithQaOnly(false);
                      setLockedOnly(false);
                      setTermHitsOnly(false);
                      setNtmDraftOnly(false);
                      setTmxOnly(false);
                      setSkippedOnly(false);
                      setProblematicOnly(false);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <details className="fc-modern-approve-menu">
            <summary
              className={`btn btn-sm btn-success ${approveMenuDisabled ? "disabled" : ""}`}
              onClick={(event) => {
                if (approveMenuDisabled) event.preventDefault();
              }}
            >
              Approve
              <i className="bi bi-chevron-down ms-1" aria-hidden="true" />
            </summary>
            <div className="fc-modern-approve-menu-popover">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={approveMenuDisabled}
                onClick={(event) => {
                  onOpenBulkApproveDialog("all");
                  const details = event.currentTarget.closest("details");
                  if (details) (details as HTMLDetailsElement).open = false;
                }}
              >
                Approve all (file)
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={approveMenuDisabled}
                onClick={(event) => {
                  onOpenBulkApproveDialog("visible");
                  const details = event.currentTarget.closest("details");
                  if (details) (details as HTMLDetailsElement).open = false;
                }}
              >
                Approve visible
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={approveMenuDisabled}
                onClick={(event) => {
                  onOpenBulkApproveDialog("clean");
                  const details = event.currentTarget.closest("details");
                  if (details) (details as HTMLDetailsElement).open = false;
                }}
              >
                Approve clean translation
              </button>
            </div>
          </details>
        </div>
      </div>

      {editor.saveFailure && editor.saveFailure.kind !== "offline" ? (
        <div className="alert alert-warning mx-3 mt-2 mb-0 d-flex align-items-center justify-content-between gap-2">
          <div>{editor.saveFailure.message}</div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={editor.reload}>
            Reload
          </button>
        </div>
      ) : null}

      {bulkApproveJob ? (
        <div
          className={`mx-3 mt-2 mb-0 alert py-2 d-flex align-items-center justify-content-between gap-3 ${
            String(bulkApproveJob.status).toLowerCase() === "failed" ? "alert-danger" : "alert-info"
          }`}
        >
          <div className="w-100">
            <div className="d-flex align-items-center justify-content-between gap-2">
              <div className="fw-semibold small">
                {String(bulkApproveJob.status).toLowerCase() === "failed"
                  ? "Bulk approval failed"
                  : "Bulk approval in progress"}
              </div>
              <div className="small text-muted">
                {bulkApproveJob.progress.approved} approved, {bulkApproveJob.progress.skipped} skipped
              </div>
            </div>
            {String(bulkApproveJob.status).toLowerCase() !== "failed" ? (
              <div className="progress mt-1" role="progressbar" aria-valuenow={bulkApproveJob.progress.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-bar" style={{ width: `${bulkApproveJob.progress.percent}%` }} />
              </div>
            ) : (
              <div className="small mt-1">{bulkApproveJob.error || "The server reported an unexpected error."}</div>
            )}
          </div>
          {String(bulkApproveJob.status).toLowerCase() === "failed" ? (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onDismissBulkApproveJob}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedCount > 1 ? (
        <div className="fc-modern-bulkbar">
          <div className="fw-semibold">Bulk actions ({selectedCount})</div>
          <div className="fc-modern-bulkbar-actions">
            <button
              type="button"
              className="btn btn-sm btn-outline-success fc-modern-btn-reviewed"
              disabled={taskReadOnly || bulkBusy}
              onClick={() => void bulkMarkReviewed()}
            >
              Mark reviewed
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={taskReadOnly || bulkBusy}
              onClick={() => void bulkClearTargets()}
            >
              Clear target
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={taskReadOnly || bulkBusy}
              onClick={() => void bulkLock(true)}
            >
              Lock
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={taskReadOnly || bulkBusy}
              onClick={() => void bulkLock(false)}
            >
              Unlock
            </button>
          </div>
        </div>
      ) : null}

      <div className={`fc-modern-main ${previewEnabled && previewLayout === "side" ? "has-side-preview" : ""}`}>
        <section className="fc-modern-workbench">
          {editor.loading ? (
            <div className="p-3 text-muted">Loading segments...</div>
          ) : filteredSegments.length === 0 ? (
            <div className="p-4 text-muted">No segments match the current search/filter.</div>
          ) : (
            <ModernEditorSegmentList
              segments={filteredSegments}
              activeId={editor.active?.id ?? null}
              selectedIds={selectedSet}
              draftById={editor.draftById}
              draftRunsById={editor.draftRunsById}
              showWhitespace={showWhitespace}
              showTags={showTags}
              taskReadOnly={taskReadOnly}
              issuesById={editor.issuesById}
              occurrenceHighlight={editor.occurrenceHighlight}
              mtGenerating={mtGeneratingSet}
              getGlossaryMatchesForText={editor.getGlossaryMatchesForText}
              onRowSelect={updateSelectionFromEvent}
              onToggleSelection={toggleSelectionOnly}
              onSetActive={editor.setActiveId}
              onUpdateTarget={editor.updateTarget}
              onEnsureTmHints={editor.ensureTmHints}
              onGenerateMt={generateMt}
              onToggleReviewed={editor.setSegmentReviewedState}
              onToggleLock={editor.setSegmentLock}
              onShowIssues={() => {
                setBottomTab("qa");
                setBottomPanelOpen(true);
              }}
              onCopyPlaceholders={editor.copyPlaceholdersFromSource}
              onFixPlaceholders={editor.appendMissingPlaceholders}
              onJumpRelative={(delta) => {
                const active = editor.active;
                if (!active) return;
                const idx = filteredIndexById.get(active.id);
                if (idx == null) return;
                const next = filteredSegments[idx + delta];
                if (next) editor.setActiveId(next.id);
              }}
              segmentState={segmentState}
              segmentStateLabel={segmentStateLabel}
              isSegmentLocked={isSegmentLocked}
              stripInline={stripInline}
              normalizeMatchScorePct={normalizeMatchScorePct}
              renderWithTags={renderWithTags}
              renderPlainText={renderPlainText}
            />
          )}
          {editor.loadingMore ? <div className="fc-modern-loading text-muted small">Loading more...</div> : null}
        </section>

        {previewEnabled && previewLayout === "side" ? (
          <aside className="fc-modern-side-preview">
            <ModernEditorPreviewPane
              title="Preview"
              segments={editor.segments}
              draftById={editor.draftById}
              activeId={editor.active?.id ?? null}
              showTags={showTags}
              showWhitespace={showWhitespace}
              onSelectSegment={editor.setActiveId}
              onAutoFocusSegment={editor.setActiveId}
              segmentTargetValue={segmentTargetValue}
              previewBlockMeta={previewBlockMeta}
              renderWithTags={renderWithTags}
              renderPlainText={renderPlainText}
            />
          </aside>
        ) : null}

        {rightSidebarOpen ? (
          <aside className="fc-modern-inspector">
            <div className="fc-modern-inspector-tabs">
              <span className="fc-modern-tab active">CAT info</span>
            </div>

            <div className="fc-modern-inspector-body">
              <div className="fc-modern-inspector-section">
                <section className="fc-modern-card-list">
                  <div className="fc-modern-subtitle">Active segment</div>
                  <div className="fc-modern-card">
                    {activeSegment ? (
                      <>
                        <div className="fc-modern-active-segment-meta">
                          <span>#{activeSegment.index + 1}</span>
                          <span className="fc-modern-separator">|</span>
                          <span>{editor.sourceLang || "source"}</span>
                          <i className="bi bi-arrow-right" />
                          <span>{editor.targetLang || "target"}</span>
                        </div>
                        <div className="small">{stripInline(activeSegment.src)}</div>
                      </>
                    ) : (
                      <div className="text-muted small">Select a segment to view term context.</div>
                    )}
                  </div>
                </section>

                <section className="fc-modern-card-list">
                  <div className="fc-modern-subtitle">CAT results</div>
                  {!activeSegment ? (
                    <div className="text-muted small">Select a segment to view CAT matches.</div>
                  ) : editor.activeTmMatches.length === 0 ? (
                    <div className="text-muted small">No CAT matches for this segment.</div>
                  ) : (
                    editor.activeTmMatches.slice(0, 9).map((match: any, idx: number) => (
                      <div key={`cat-${activeSegment.id}-${idx}`} className="fc-modern-card">
                        <div className="fc-modern-card-header">
                          <div>
                            <div className="fw-semibold">#{idx + 1}</div>
                            <div className="small text-muted">{String(match?.target || "").trim() || "No target text"}</div>
                          </div>
                          <span className={`badge ${idx === catResultIndex ? "text-bg-primary" : "text-bg-light"}`}>
                            {Math.round(Number(match?.score ?? 0) <= 1 ? Number(match?.score ?? 0) * 100 : Number(match?.score ?? 0))}%
                          </span>
                        </div>
                        <div className="fc-modern-card-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => void insertCatSuggestionByIndex(idx + 1)}
                            disabled={!activeEditable || !match?.target}
                          >
                            Insert
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </section>

                <section className="fc-modern-card-list">
                  <div className="fc-modern-suggestion-header">
                    <div>
                      <div className="fw-semibold">Termbase suggestions</div>
                      <div className="text-muted small">Auto suggestions for the active segment.</div>
                    </div>
                  </div>

                  <div className="fc-modern-termbase-controls">
                    <label className="form-check form-check-inline">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={editor.concordanceFilters.includeDeprecated}
                        onChange={(e) =>
                          editor.setConcordanceFilters((prev) => ({
                            ...prev,
                            includeDeprecated: e.target.checked
                          }))
                        }
                      />
                      <span className="form-check-label">Include deprecated</span>
                    </label>
                    <label className="form-check form-check-inline">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={editor.concordanceFilters.includeForbidden}
                        onChange={(e) =>
                          editor.setConcordanceFilters((prev) => ({
                            ...prev,
                            includeForbidden: e.target.checked
                          }))
                        }
                      />
                      <span className="form-check-label">Include forbidden</span>
                    </label>
                    <label className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={editor.smartCasing}
                        onChange={(e) => editor.setSmartCasing(e.target.checked)}
                      />
                      <span className="form-check-label">Smart casing</span>
                    </label>
                    <input
                      type="search"
                      className="form-control form-control-sm"
                      placeholder="Category"
                      value={editor.concordanceFilters.category}
                      onChange={(e) =>
                        editor.setConcordanceFilters((prev) => ({
                          ...prev,
                          category: e.target.value
                        }))
                      }
                    />
                  </div>

                  {editor.concordanceLoading ? (
                    <div className="text-muted small">Loading termbase suggestions...</div>
                  ) : editor.concordanceEntries.length === 0 ? (
                    <div className="text-muted small">No termbase hits for this segment.</div>
                  ) : (
                    editor.concordanceEntries.slice(0, 12).map((entry) => {
                      const sourceTerm = termbaseDisplaySource(entry);
                      const preferredTarget = entry.targetTerms.find((term) => term.status === "preferred") ?? entry.targetTerms[0];
                      const category = termbaseEntryCategory(entry);
                      const showDeprecated = isDeprecatedTerm(preferredTarget, entry);
                      const showForbidden = preferredTarget?.status === "forbidden";
                      return (
                        <div key={`sugg-${entry.entryId}`} className="fc-modern-card">
                          <div className="fc-modern-card-header">
                            <div>
                              <div className="fw-semibold">{sourceTerm || "Term"}</div>
                              <div className="small text-muted">{preferredTarget?.text || "No target term"}</div>
                            </div>
                            <span className="badge text-bg-light">Score {entry.score.toFixed(2)}</span>
                          </div>
                          <div className="fc-modern-chip-row">
                            {showDeprecated ? <span className="fc-modern-meta-badge">Deprecated</span> : null}
                            {showForbidden ? <span className="fc-modern-meta-badge is-forbidden">Forbidden</span> : null}
                            {category ? <span className="fc-modern-meta-badge">{category}</span> : null}
                          </div>
                          <div className="fc-modern-card-actions">
                            {preferredTarget ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => {
                                  if (!activeSegment) return;
                                  void editor.insertGlossaryTerm(
                                    activeSegment.id,
                                    preferredTarget.text,
                                    preferredTarget.status,
                                    sourceTerm
                                  );
                                }}
                                disabled={!activeEditable}
                              >
                                Insert
                              </button>
                            ) : null}
                            {preferredTarget ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => void copyToClipboard(preferredTarget.text)}
                              >
                                Copy
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>

                <section className="fc-modern-card-list">
                  <div className="fc-modern-subtitle">Concordance search</div>
                  <div className="fc-modern-concordance-tools">
                    <input
                      ref={concordanceInputRef}
                      type="search"
                      className="form-control form-control-sm"
                      placeholder="Search in termbase..."
                      value={concordanceQuery}
                      onChange={(e) => setConcordanceQuery(e.target.value)}
                    />
                    <div className="btn-group btn-group-sm">
                      <button
                        type="button"
                        className={`btn btn-outline-secondary ${concordanceSearchIn === "source" ? "active" : ""}`}
                        onClick={() => setConcordanceSearchIn("source")}
                      >
                        Source
                      </button>
                      <button
                        type="button"
                        className={`btn btn-outline-secondary ${concordanceSearchIn === "target" ? "active" : ""}`}
                        onClick={() => setConcordanceSearchIn("target")}
                      >
                        Target
                      </button>
                    </div>
                    <div className="text-muted small">Searches termbase only. Uses the filters above.</div>
                  </div>

                  {concordanceQuery.trim() ? (
                    concordanceQuery.trim().length < TERMBASE_CONCORDANCE_MIN_QUERY ? (
                      <div className="text-muted small">
                        Type at least {TERMBASE_CONCORDANCE_MIN_QUERY} characters.
                      </div>
                    ) : concordanceSearchLoading ? (
                      <div className="text-muted small">Searching termbase...</div>
                    ) : concordanceSearchError ? (
                      <div className="text-danger small">{concordanceSearchError}</div>
                    ) : concordanceResults.length === 0 ? (
                      <div className="text-muted small">No termbase concordance matches.</div>
                    ) : (
                      concordanceResults.slice(0, 12).map((entry) => {
                        const sourceTerm = termbaseDisplaySource(entry);
                        const preferredTarget = entry.targetTerms.find((term) => term.status === "preferred") ?? entry.targetTerms[0];
                        const category = termbaseEntryCategory(entry);
                        const sourceNode =
                          concordanceSearchIn === "source" ? highlightConcordanceMatch(sourceTerm, concordanceQuery) : sourceTerm;
                        const targetNode =
                          concordanceSearchIn === "target" && preferredTarget
                            ? highlightConcordanceMatch(preferredTarget.text, concordanceQuery)
                            : preferredTarget?.text ?? "";
                        return (
                          <div key={`conc-${entry.entryId}`} className="fc-modern-card">
                            <div className="fc-modern-card-header">
                              <div className="fw-semibold">{sourceNode || "Term"}</div>
                              <span className="badge text-bg-light">Score {entry.score.toFixed(2)}</span>
                            </div>
                            <div className="small text-muted">{targetNode || "No target term"}</div>
                            <div className="fc-modern-chip-row">
                              {preferredTarget?.status === "forbidden" ? (
                                <span className="fc-modern-meta-badge is-forbidden">Forbidden</span>
                              ) : null}
                              {category ? <span className="fc-modern-meta-badge">{category}</span> : null}
                            </div>
                            <div className="fc-modern-card-actions">
                              {preferredTarget ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => {
                                    if (!activeSegment) return;
                                    void editor.insertGlossaryTerm(
                                      activeSegment.id,
                                      preferredTarget.text,
                                      preferredTarget.status,
                                      sourceTerm
                                    );
                                  }}
                                  disabled={!activeEditable}
                                >
                                  Insert
                                </button>
                              ) : null}
                              {preferredTarget ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => void copyToClipboard(preferredTarget.text)}
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )
                  ) : null}
                </section>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <ModernEditorBottomPanel
        bottomPanelOpen={bottomPanelOpen}
        bottomPanelHeight={bottomPanelHeight}
        bottomTab={bottomTab}
        setBottomTab={setBottomTab}
        setBottomPanelOpen={setBottomPanelOpen}
        onResizeStart={onBottomPanelResizeStart}
        historyLoading={historyLoading}
        historyError={historyError}
        historyEntries={historyEntries}
        editor={editor}
        previewEnabled={previewEnabled}
        previewLayout={previewLayout}
        renderedPreviewSupported={renderedPreviewSupported}
        renderedPreviewStatus={renderedPreviewStatus}
        renderedPreviewLoading={renderedPreviewLoading}
        renderedPreviewPreviewId={renderedPreviewPreviewId}
        renderedPreviewConfiguredMethod={renderedPreviewConfiguredMethod}
        renderedPreviewRevisionId={renderedPreviewRevisionId}
        renderedPreviewDetails={renderedPreviewDetails}
        renderedPreviewError={renderedPreviewError}
        renderedPreviewErrorDetails={renderedPreviewErrorDetails}
        renderedPreviewWarnings={renderedPreviewWarnings}
        renderedPreviewLogs={renderedPreviewLogs}
        onRenderedPreviewRefresh={onRenderedPreviewRefresh}
        onRenderedPreviewOpenNewTab={onRenderedPreviewOpenNewTab}
        showTags={showTags}
        showWhitespace={showWhitespace}
        segmentTargetValue={segmentTargetValue}
        previewBlockMeta={previewBlockMeta}
        renderWithTags={renderWithTags}
        renderPlainText={renderPlainText}
      />


      <ModernEditorFindModal
        open={findReplaceOpen}
        mode={findReplaceMode}
        onClose={() => setFindReplaceOpen(false)}
        editor={editor}
        findMatchCount={findMatchCount}
      />
    </div>
  );
}
