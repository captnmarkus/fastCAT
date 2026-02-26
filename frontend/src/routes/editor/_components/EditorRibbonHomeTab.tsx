import React from "react";
import type { FindScope } from "../state/useEditorFile";
import {
  RibbonButton,
  RibbonSplitButton,
  RIBBON_ICONS,
  tooltipFor
} from "./EditorRibbon.shared";

export default function EditorRibbonHomeTab(props: any) {
  const {
    hiddenHomeGroups,
    actions,
    changeCaseMenuRef,
    closeDetails,
    symbolCategories,
    activeSymbolCategory,
    setSymbolCategory,
    insertSymbol,
    symbolsMenuRef,
    otherActionsRef,
    goTo,
    setGoTo,
    matchLabel,
    symbolsMenuOverflowRef
  } = props;
  return (
    <>
            {!hiddenHomeGroups.has("history") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={actions.undo} />
                  <RibbonButton action={actions.redo} />
                </div>
                <div className="fc-editor-ribbon-group-title">History</div>
              </div>
            ) : null}

            {!hiddenHomeGroups.has("clipboard") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={actions.paste} size="large" />
                  <RibbonButton action={actions.cut} />
                  <RibbonButton action={actions.copy} />
                </div>
                <div className="fc-editor-ribbon-group-title">Clipboard</div>
              </div>
            ) : null}

            {!hiddenHomeGroups.has("formatting") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={actions.bold} />
                  <RibbonButton action={actions.underline} />
                  <RibbonButton action={actions.fontSmaller} />
                  <RibbonButton action={actions.fontBigger} />
                  <RibbonButton action={actions.clearFormatting} />
                  <RibbonButton action={actions.showWhitespace} />
                  <RibbonButton action={actions.applyFormatting} />
                  {actions.changeCase.enabled ? (
                    <details className="fc-ribbon-dropdown" ref={changeCaseMenuRef}>
                      <summary
                        className="fc-ribbon-button has-caret"
                        aria-label={actions.changeCase.label}
                        title={tooltipFor(actions.changeCase)}
                      >
                        <span className="fc-ribbon-icon">{actions.changeCase.icon}</span>
                        <span className="fc-ribbon-label">{actions.changeCase.label}</span>
                        <span className="fc-ribbon-caret" aria-hidden="true">
                          {RIBBON_ICONS.caret}
                        </span>
                      </summary>
                      <div className="fc-ribbon-dropdown-menu">
                        <button
                          type="button"
                          className="fc-ribbon-menu-button"
                          onClick={() => {
                            actions.changeCaseUpper.onClick?.();
                            closeDetails(changeCaseMenuRef);
                          }}
                          disabled={!actions.changeCaseUpper.enabled}
                          aria-label={actions.changeCaseUpper.label}
                          title={tooltipFor(actions.changeCaseUpper)}
                        >
                          <span className="fc-ribbon-icon">{actions.changeCaseUpper.icon}</span>
                          <span className="fc-ribbon-label">{actions.changeCaseUpper.label}</span>
                        </button>
                        <button
                          type="button"
                          className="fc-ribbon-menu-button"
                          onClick={() => {
                            actions.changeCaseLower.onClick?.();
                            closeDetails(changeCaseMenuRef);
                          }}
                          disabled={!actions.changeCaseLower.enabled}
                          aria-label={actions.changeCaseLower.label}
                          title={tooltipFor(actions.changeCaseLower)}
                        >
                          <span className="fc-ribbon-icon">{actions.changeCaseLower.icon}</span>
                          <span className="fc-ribbon-label">{actions.changeCaseLower.label}</span>
                        </button>
                        <button
                          type="button"
                          className="fc-ribbon-menu-button"
                          onClick={() => {
                            actions.changeCaseTitle.onClick?.();
                            closeDetails(changeCaseMenuRef);
                          }}
                          disabled={!actions.changeCaseTitle.enabled}
                          aria-label={actions.changeCaseTitle.label}
                          title={tooltipFor(actions.changeCaseTitle)}
                        >
                          <span className="fc-ribbon-icon">{actions.changeCaseTitle.icon}</span>
                          <span className="fc-ribbon-label">{actions.changeCaseTitle.label}</span>
                        </button>
                      </div>
                    </details>
                  ) : (
                    <RibbonButton action={actions.changeCase} showCaret />
                  )}
                </div>
                <div className="fc-editor-ribbon-group-title">Formatting</div>
              </div>
            ) : null}

            {!hiddenHomeGroups.has("insert") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  {actions.insertSymbols.enabled ? (
                    <details className="fc-ribbon-dropdown" ref={symbolsMenuRef}>
                      <summary
                        className="fc-ribbon-button is-large has-caret"
                        aria-label={actions.insertSymbols.label}
                        title={tooltipFor(actions.insertSymbols)}
                      >
                        <span className="fc-ribbon-icon">{actions.insertSymbols.icon}</span>
                        <span className="fc-ribbon-label">{actions.insertSymbols.label}</span>
                        <span className="fc-ribbon-caret" aria-hidden="true">
                          {RIBBON_ICONS.caret}
                        </span>
                      </summary>
                      <div className="fc-ribbon-dropdown-menu fc-ribbon-panel fc-ribbon-symbols">
                        <div className="fc-ribbon-symbol-tabs">
                          {symbolCategories.map((category) => (
                            <button
                              key={category.id}
                              type="button"
                              className={`fc-ribbon-symbol-tab ${category.id === activeSymbolCategory?.id ? "active" : ""}`}
                              onClick={() => setSymbolCategory(category.id)}
                            >
                              {category.label}
                            </button>
                          ))}
                        </div>
                        <div className="fc-ribbon-symbol-grid">
                          {activeSymbolCategory?.symbols.map((symbol) => (
                            <button
                              key={`${activeSymbolCategory.id}-${symbol.value}`}
                              type="button"
                              className={`fc-ribbon-symbol-button ${symbol.kind === "space" ? "is-space" : ""}`}
                              onClick={() => insertSymbol(symbol, symbolsMenuRef)}
                              title={symbol.title || symbol.value}
                              aria-label={symbol.title || symbol.value}
                            >
                              {symbol.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </details>
                  ) : (
                    <RibbonButton action={actions.insertSymbols} size="large" showCaret />
                  )}
                </div>
                <div className="fc-editor-ribbon-group-title">Insert Characters</div>
              </div>
            ) : null}

            {!hiddenHomeGroups.has("translation") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={actions.applyTranslation} size="large" />
                </div>
                <div className="fc-editor-ribbon-group-title">Translation</div>
              </div>
            ) : null}


            <div className="fc-editor-ribbon-group">
              <div className="fc-editor-ribbon-group-body">
                <RibbonButton action={actions.confirm} />
                <RibbonSplitButton main={actions.copySource} secondary={actions.copySourceOptions} />
                <RibbonButton action={actions.clearTarget} />
                <RibbonSplitButton main={actions.lockUnlock} secondary={actions.lockUnlockOptions} />

                <button
                  type="button"
                  className={`fc-ribbon-button ${props.reviewQueueEnabled ? "is-pressed" : ""}`}
                  onClick={() => props.setReviewQueueEnabled(!props.reviewQueueEnabled)}
                  title="Review queue"
                >
                  <span className="fc-ribbon-icon">
                    <i className="bi bi-exclamation-triangle" aria-hidden="true" />
                  </span>
                  <span className="fc-ribbon-label">Review queue</span>
                  {props.issueCount > 0 ? (
                    <span className="fc-ribbon-badge">{props.issueCount}</span>
                  ) : null}
                </button>

                <button
                  type="button"
                  className="fc-ribbon-button"
                  onClick={() => void props.onAcceptCleanDrafts()}
                  disabled={!props.hasSegments}
                  title="Confirm all clean LLM drafts"
                >
                  <span className="fc-ribbon-icon">
                    <i className="bi bi-check2-square" aria-hidden="true" />
                  </span>
                  <span className="fc-ribbon-label">Accept clean drafts</span>
                </button>

                {props.onRecomputeIssues ? (
                  <button
                    type="button"
                    className="fc-ribbon-button"
                    onClick={() => void props.onRecomputeIssues?.()}
                    disabled={!props.hasSegments}
                    title="Recompute issues"
                  >
                    <span className="fc-ribbon-icon">
                      <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                    </span>
                    <span className="fc-ribbon-label">Recompute issues</span>
                  </button>
                ) : null}

                {actions.otherActions.enabled ? (
                  <details className="fc-ribbon-dropdown" ref={otherActionsRef}>
                    <summary
                      className="fc-ribbon-button has-caret"
                      aria-label={actions.otherActions.label}
                      title={tooltipFor(actions.otherActions)}
                    >
                      <span className="fc-ribbon-icon">{actions.otherActions.icon}</span>
                      <span className="fc-ribbon-label">{actions.otherActions.label}</span>
                      <span className="fc-ribbon-caret" aria-hidden="true">
                        {RIBBON_ICONS.caret}
                      </span>
                    </summary>
                    <div className="fc-ribbon-dropdown-menu">
                      <button
                        type="button"
                        className="fc-ribbon-menu-button"
                        onClick={() => {
                          void actions.confirmNext.onClick?.();
                          closeDetails(otherActionsRef);
                        }}
                        disabled={!actions.confirmNext.enabled}
                        aria-label={actions.confirmNext.label}
                        title={tooltipFor(actions.confirmNext)}
                      >
                        <span className="fc-ribbon-icon">{actions.confirmNext.icon}</span>
                        <span className="fc-ribbon-label">{actions.confirmNext.label}</span>
                      </button>
                    </div>
                  </details>
                ) : (
                  <RibbonButton action={actions.otherActions} showCaret />
                )}
              </div>
              <div className="fc-editor-ribbon-group-title">Segments</div>
            </div>


            <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <form
                    className="fc-ribbon-input"
                    aria-label="Go To"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!actions.goTo.enabled) return;
                      const n = Number(goTo);
                      if (Number.isFinite(n)) props.onGoTo(n);
                    }}
                  >
                  <div className="fc-ribbon-input-header">
                    <span className="fc-ribbon-icon">{actions.goTo.icon}</span>
                    <span className="fc-ribbon-label">{actions.goTo.label}</span>
                  </div>
                    <input
                      className="fc-ribbon-input-field"
                      inputMode="numeric"
                      placeholder="#"
                      value={goTo}
                      onChange={(e) => setGoTo(e.target.value)}
                      disabled={!actions.goTo.enabled}
                      aria-label="Go To segment number"
                    />
                </form>

                <RibbonButton action={actions.previous} />
                <RibbonButton action={actions.next} />

                <details className="fc-ribbon-dropdown">
                  <summary
                    className="fc-ribbon-button has-caret"
                    aria-label={actions.find.label}
                    aria-disabled={!actions.find.enabled}
                    title={tooltipFor(actions.find)}
                    onClick={(e) => {
                      if (!actions.find.enabled) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                  >
                    <span className="fc-ribbon-icon">{actions.find.icon}</span>
                    <span className="fc-ribbon-label">{actions.find.label}</span>
                    <span className="fc-ribbon-caret" aria-hidden="true">
                      {RIBBON_ICONS.caret}
                    </span>
                  </summary>
                  <div className="fc-ribbon-dropdown-menu fc-ribbon-panel">
                    <div className="fc-ribbon-panel-row">
                      <label className="fc-ribbon-panel-label" htmlFor="fc-editor-find">
                        Find
                      </label>
                      <input
                        id="fc-editor-find"
                        className="fc-ribbon-panel-input"
                        value={props.findQuery}
                        onChange={(e) => props.setFindQuery(e.target.value)}
                        placeholder="Find"
                      />
                    </div>
                    <div className="fc-ribbon-panel-row">
                      <select
                        className="fc-ribbon-panel-select"
                        value={props.findScope}
                        onChange={(e) => props.setFindScope(e.target.value as FindScope)}
                        aria-label="Find scope"
                      >
                        <option value="both">Source+Target</option>
                        <option value="source">Source</option>
                        <option value="target">Target</option>
                      </select>
                      <label className="fc-ribbon-panel-check">
                        <input
                          type="checkbox"
                          checked={props.findUseRegex}
                          onChange={(e) => props.setFindUseRegex(e.target.checked)}
                        />
                        Regex
                      </label>
                    </div>
                    <div className="fc-ribbon-panel-row fc-ribbon-panel-actions">
                      <button
                        type="button"
                        className="fc-ribbon-panel-button"
                        onClick={props.onFindPrev}
                        disabled={!props.findQuery.trim() || props.matchCount === 0}
                        title="Previous match"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="fc-ribbon-panel-button"
                        onClick={props.onFindNext}
                        disabled={!props.findQuery.trim() || props.matchCount === 0}
                        title="Next match"
                      >
                        Next
                      </button>
                      {matchLabel ? <span className="fc-ribbon-panel-meta">{matchLabel}</span> : null}
                    </div>
                  </div>
                </details>

                <details className="fc-ribbon-dropdown">
                  <summary
                    className="fc-ribbon-button has-caret"
                    aria-label={actions.replace.label}
                    aria-disabled={!actions.replace.enabled}
                    title={tooltipFor(actions.replace)}
                    onClick={(e) => {
                      if (!actions.replace.enabled) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                  >
                    <span className="fc-ribbon-icon">{actions.replace.icon}</span>
                    <span className="fc-ribbon-label">{actions.replace.label}</span>
                    <span className="fc-ribbon-caret" aria-hidden="true">
                      {RIBBON_ICONS.caret}
                    </span>
                  </summary>
                  <div className="fc-ribbon-dropdown-menu fc-ribbon-panel">
                    <div className="fc-ribbon-panel-row">
                      <label className="fc-ribbon-panel-label" htmlFor="fc-editor-replace-find">
                        Find
                      </label>
                      <input
                        id="fc-editor-replace-find"
                        className="fc-ribbon-panel-input"
                        value={props.findQuery}
                        onChange={(e) => props.setFindQuery(e.target.value)}
                        placeholder="Find"
                      />
                    </div>
                    <div className="fc-ribbon-panel-row">
                      <label className="fc-ribbon-panel-label" htmlFor="fc-editor-replace">
                        Replace
                      </label>
                      <input
                        id="fc-editor-replace"
                        className="fc-ribbon-panel-input"
                        value={props.replaceQuery}
                        onChange={(e) => props.setReplaceQuery(e.target.value)}
                        placeholder="Replace"
                      />
                    </div>
                    <div className="fc-ribbon-panel-row fc-ribbon-panel-actions">
                      <button
                        type="button"
                        className="fc-ribbon-panel-button"
                        onClick={() => void props.onReplaceAll()}
                        disabled={!props.findQuery.trim()}
                        title="Replace all matches in target"
                      >
                        Replace All
                      </button>
                      {matchLabel ? <span className="fc-ribbon-panel-meta">{matchLabel}</span> : null}
                    </div>
                  </div>
                </details>
              </div>
              <div className="fc-editor-ribbon-group-title">Navigation</div>
            </div>

            {hiddenHomeGroups.size > 0 ? (
              <details className="fc-ribbon-overflow">
                <summary className="fc-ribbon-button fc-ribbon-overflow-button" aria-label="More">
                  <span className="fc-ribbon-icon">{RIBBON_ICONS.overflow}</span>
                  <span className="visually-hidden">More</span>
                </summary>
                <div className="fc-ribbon-dropdown-menu fc-ribbon-overflow-menu">
                  {hiddenHomeGroups.has("history") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">History</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={actions.undo} variant="menu" />
                        <RibbonButton action={actions.redo} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenHomeGroups.has("clipboard") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Clipboard</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={actions.paste} variant="menu" />
                        <RibbonButton action={actions.cut} variant="menu" />
                        <RibbonButton action={actions.copy} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenHomeGroups.has("formatting") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Formatting</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={actions.bold} variant="menu" />
                        <RibbonButton action={actions.underline} variant="menu" />
                        <RibbonButton action={actions.fontSmaller} variant="menu" />
                        <RibbonButton action={actions.fontBigger} variant="menu" />
                        <RibbonButton action={actions.clearFormatting} variant="menu" />
                        <RibbonButton action={actions.applyFormatting} variant="menu" />
                        <RibbonButton action={actions.showWhitespace} variant="menu" />
                        <RibbonButton action={actions.changeCaseUpper} variant="menu" />
                        <RibbonButton action={actions.changeCaseLower} variant="menu" />
                        <RibbonButton action={actions.changeCaseTitle} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenHomeGroups.has("insert") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Insert Characters</div>
                      <div className="fc-ribbon-overflow-items">
                        {actions.insertSymbols.enabled ? (
                          <details className="fc-ribbon-dropdown" ref={symbolsMenuOverflowRef}>
                            <summary
                              className="fc-ribbon-menu-button has-caret"
                              aria-label={actions.insertSymbols.label}
                              title={tooltipFor(actions.insertSymbols)}
                            >
                              <span className="fc-ribbon-icon">{actions.insertSymbols.icon}</span>
                              <span className="fc-ribbon-label">{actions.insertSymbols.label}</span>
                              <span className="fc-ribbon-caret" aria-hidden="true">
                                {RIBBON_ICONS.caret}
                              </span>
                            </summary>
                            <div className="fc-ribbon-dropdown-menu fc-ribbon-panel fc-ribbon-symbols">
                              <div className="fc-ribbon-symbol-tabs">
                                {symbolCategories.map((category) => (
                                  <button
                                    key={category.id}
                                    type="button"
                                    className={`fc-ribbon-symbol-tab ${category.id === activeSymbolCategory?.id ? "active" : ""}`}
                                    onClick={() => setSymbolCategory(category.id)}
                                  >
                                    {category.label}
                                  </button>
                                ))}
                              </div>
                              <div className="fc-ribbon-symbol-grid">
                                {activeSymbolCategory?.symbols.map((symbol) => (
                                  <button
                                    key={`${activeSymbolCategory.id}-${symbol.value}`}
                                    type="button"
                                    className={`fc-ribbon-symbol-button ${symbol.kind === "space" ? "is-space" : ""}`}
                                    onClick={() => insertSymbol(symbol, symbolsMenuOverflowRef)}
                                    title={symbol.title || symbol.value}
                                    aria-label={symbol.title || symbol.value}
                                  >
                                    {symbol.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </details>
                        ) : (
                          <RibbonButton action={actions.insertSymbols} variant="menu" />
                        )}
                      </div>
                    </div>
                  ) : null}

                  {hiddenHomeGroups.has("translation") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Translation</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={actions.applyTranslation} variant="menu" />
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
    </>
  );
}
