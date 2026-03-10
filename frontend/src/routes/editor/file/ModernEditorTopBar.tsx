import React from "react";

export default function ModernEditorTopBar(props: any) {
  const {
    activeEditable,
    activeFilteredIndex,
    activeSegment,
    bottomPanelOpen,
    canGoFilteredNext,
    canGoFilteredPrev,
    changeFontSizeForActiveSelection,
    doComplete,
    doDownload,
    downloadReady,
    editor,
    EDITOR_FONT_SIZE_STEP,
    enableConcordanceCtrlK,
    fileId,
    filteredSegments,
    generateMt,
    goNextFiltered,
    goPrevFiltered,
    insertSymbol,
    isSegmentLocked,
    mtGeneratingSet,
    nav,
    openConcordanceShortcut,
    openFindModal,
    previewEnabled,
    previewLayout,
    renderPlainText,
    renderWithTags,
    rightSidebarOpen,
    richFormattingSupported,
    saveLabel,
    saveToneClass,
    segmentState,
    setBottomPanelOpen,
    setEnableConcordanceCtrlK,
    setPreviewEnabled,
    setPreviewLayout,
    setRightSidebarOpen,
    setShowTags,
    setShowWhitespace,
    shortcutHelpItems,
    showTags,
    showWhitespace,
    SYMBOL_PICKER_ITEMS,
    symbolsMenuRef,
    taskId,
    taskReadOnly,
    toggleBoldForActiveSelection
  } = props;

  return (
    <header className="fc-modern-topbar">
        <div className="fc-modern-topbar-left">
          <div className="fc-modern-icon-strip" aria-label="Editor quick actions">
            <div className="fc-modern-icon-group">
              <button
                type="button"
                className={`btn btn-sm btn-outline-secondary fc-modern-icon-btn ${
                  activeSegment && segmentState(activeSegment) === "reviewed" ? "is-reviewed-active" : ""
                }`}
                onClick={() =>
                  activeSegment && void editor.setSegmentReviewedState(activeSegment.id, segmentState(activeSegment) !== "reviewed")
                }
                disabled={!activeSegment || taskReadOnly}
                title={activeSegment && segmentState(activeSegment) === "reviewed" ? "Unmark reviewed" : "Mark reviewed"}
                aria-label="Toggle reviewed"
              >
                <i className="bi bi-check2-square" />
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-outline-secondary fc-modern-icon-btn ${
                  activeSegment && isSegmentLocked(activeSegment) ? "is-locked-active" : ""
                }`}
                onClick={() => activeSegment && void editor.setSegmentLock(activeSegment.id, !isSegmentLocked(activeSegment))}
                disabled={!activeSegment || taskReadOnly}
                title={activeSegment && isSegmentLocked(activeSegment) ? "Unlock segment" : "Lock segment"}
                aria-label="Toggle lock"
              >
                <i className={`bi ${activeSegment && isSegmentLocked(activeSegment) ? "bi-lock-fill" : "bi-unlock"}`} />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={() => activeSegment && editor.updateTarget(activeSegment.id, activeSegment.src ?? "")}
                disabled={!activeEditable}
                title="Copy source to target"
                aria-label="Copy source to target"
              >
                <i className="bi bi-arrow-left-right" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={() => activeSegment && editor.updateTarget(activeSegment.id, "")}
                disabled={!activeEditable}
                title="Clear target"
                aria-label="Clear target"
              >
                <i className="bi bi-x-circle" />
              </button>
            </div>

            <div className="fc-modern-icon-group">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={editor.undoActive}
                disabled={!editor.canUndo}
                title="Undo"
                aria-label="Undo"
              >
                <i className="bi bi-arrow-counterclockwise" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={editor.redoActive}
                disabled={!editor.canRedo}
                title="Redo"
                aria-label="Redo"
              >
                <i className="bi bi-arrow-clockwise" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={goPrevFiltered}
                disabled={!canGoFilteredPrev}
                title="Previous segment"
                aria-label="Previous segment"
              >
                <i className="bi bi-chevron-left" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={goNextFiltered}
                disabled={!canGoFilteredNext}
                title="Next segment"
                aria-label="Next segment"
              >
                <i className="bi bi-chevron-right" />
              </button>
            </div>

            <div className="fc-modern-icon-group">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={() => openFindModal("find")}
                title="Find (Ctrl+F)"
                aria-label="Find"
              >
                <i className="bi bi-search" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={() => openFindModal("replace")}
                title="Replace (Ctrl+H)"
                aria-label="Replace"
              >
                <i className="bi bi-pencil-square" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={openConcordanceShortcut}
                title="Concordance (Ctrl+Shift+C)"
                aria-label="Concordance"
              >
                <i className="bi bi-book" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                onClick={() => activeSegment && void generateMt(activeSegment.id)}
                disabled={!activeSegment || mtGeneratingSet.has(activeSegment.id)}
                title="Generate MT suggestion"
                aria-label="Generate MT suggestion"
              >
                <i className={`bi ${activeSegment && mtGeneratingSet.has(activeSegment.id) ? "bi-arrow-repeat" : "bi-lightning-charge"}`} />
              </button>
            </div>

            <div className="fc-modern-icon-group">
              {richFormattingSupported ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary fc-modern-text-btn"
                    onClick={() => changeFontSizeForActiveSelection(-EDITOR_FONT_SIZE_STEP)}
                    disabled={!activeEditable}
                    title="Decrease selected text font size"
                    aria-label="Decrease selected text font size"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary fc-modern-text-btn"
                    onClick={() => changeFontSizeForActiveSelection(EDITOR_FONT_SIZE_STEP)}
                    disabled={!activeEditable}
                    title="Increase selected text font size"
                    aria-label="Increase selected text font size"
                  >
                    A+
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                    onClick={toggleBoldForActiveSelection}
                    disabled={!activeEditable}
                    title="Toggle bold style"
                    aria-label="Toggle bold style"
                  >
                    <i className="bi bi-type-bold" />
                  </button>
                </>
              ) : null}
              <details className="fc-modern-symbols-menu" ref={symbolsMenuRef}>
                <summary
                  className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
                  title="Insert symbol"
                  aria-label="Insert symbol"
                >
                  <i className="bi bi-asterisk" />
                </summary>
                <div className="fc-modern-symbols-popover">
                  {SYMBOL_PICKER_ITEMS.map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      className="fc-modern-symbol-btn"
                      onClick={() => insertSymbol(symbol)}
                      disabled={!activeEditable}
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </details>
            </div>

            <div className={`fc-modern-save ${saveToneClass}`} title={saveLabel}>
              <i
                className={`bi ${
                  editor.saveState === "saved"
                    ? "bi-check-circle"
                    : editor.saveState === "saving"
                    ? "bi-cloud-arrow-up"
                    : editor.saveState === "offline"
                    ? "bi-wifi-off"
                    : "bi-exclamation-triangle"
                }`}
              />
              <span>{saveLabel}</span>
            </div>
          </div>
        </div>

        <div className="fc-modern-topbar-center">
          <div className="fc-modern-file-title">{editor.fileName || `File #${fileId ?? taskId}`}</div>
          <div className="fc-modern-file-meta">
            {editor.projectName ? <span className="fc-modern-project">{editor.projectName}</span> : null}
            <span className="fc-modern-separator">|</span>
            <span>{filteredSegments.length}/{editor.segments.length} segments</span>
            <span className="fc-modern-separator">|</span>
            <span>{activeFilteredIndex >= 0 ? `${activeFilteredIndex + 1}/${filteredSegments.length}` : "-"}</span>
          </div>
        </div>

        <div className="fc-modern-topbar-right">
          <details className="fc-modern-view-menu">
            <summary className="fc-modern-top-action fc-modern-top-action-outline">
              <i className="bi bi-layout-three-columns" />
              <span>View</span>
            </summary>
            <div className="fc-modern-view-popover">
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={rightSidebarOpen}
                  onChange={(e) => setRightSidebarOpen(e.target.checked)}
                />
                <span className="form-check-label">Right panel</span>
              </label>
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={bottomPanelOpen}
                  onChange={(e) => setBottomPanelOpen(e.target.checked)}
                />
                <span className="form-check-label">Bottom panel</span>
              </label>
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={previewEnabled}
                  onChange={(e) => setPreviewEnabled(e.target.checked)}
                />
                <span className="form-check-label">Preview</span>
              </label>
              <div className="fc-modern-view-group">
                <div className="fc-modern-view-group-label">Preview layout</div>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="modern-preview-layout"
                    checked={previewLayout === "split"}
                    onChange={() => setPreviewLayout("split")}
                  />
                  <span className="form-check-label">Split (segments top, preview bottom)</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="modern-preview-layout"
                    checked={previewLayout === "side"}
                    onChange={() => setPreviewLayout("side")}
                  />
                  <span className="form-check-label">Side-by-side</span>
                </label>
              </div>
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={showWhitespace}
                  onChange={(e) => setShowWhitespace(e.target.checked)}
                />
                <span className="form-check-label">Show whitespace</span>
              </label>
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={showTags}
                  onChange={(e) => setShowTags(e.target.checked)}
                />
                <span className="form-check-label">Show tags</span>
              </label>
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={enableConcordanceCtrlK}
                  onChange={(e) => setEnableConcordanceCtrlK(e.target.checked)}
                />
                <span className="form-check-label">Enable Ctrl/Cmd+K concordance shortcut</span>
              </label>
            </div>
          </details>

          <details className="fc-modern-view-menu">
            <summary className="fc-modern-top-action fc-modern-top-action-outline">
              <i className="bi bi-question-circle" />
              <span>Shortcuts</span>
            </summary>
            <div className="fc-modern-view-popover">
              <div className="fc-modern-view-group">
                <div className="fc-modern-view-group-label">Keyboard shortcuts</div>
                {(shortcutHelpItems || []).map((item: any) => (
                  <div key={item.id} className="d-flex align-items-start justify-content-between gap-2 mb-1">
                    <span className="small">{item.label}</span>
                    <span className="small text-muted text-end">
                      {Array.isArray(item.bindings) && item.bindings.length > 0
                        ? item.bindings.join(" / ")
                        : "-"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </details>

          <button
            type="button"
            className="fc-modern-top-action fc-modern-top-action-outline"
            onClick={doDownload}
            disabled={editor.loading || !editor.projectId || !downloadReady}
            title={downloadReady ? "Download translated source file" : "Download available after Done"}
          >
            <i className="bi bi-download" />
            <span>Download</span>
          </button>
          <button
            type="button"
            className="fc-modern-top-action fc-modern-top-action-solid"
            onClick={doComplete}
            disabled={taskReadOnly || editor.loadingMore || editor.segments.length === 0}
          >
            <i className="bi bi-check2" />
            <span>Done</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary fc-modern-icon-btn"
            onClick={() => nav("/inbox")}
            aria-label="Close editor"
            title="Close editor"
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
    </header>
  );
}
