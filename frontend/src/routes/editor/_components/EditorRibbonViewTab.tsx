import React from "react";
import { RIBBON_ICONS } from "../state/homeRibbonCommands";
import { RibbonButton, type RibbonAction, tooltipFor } from "./EditorRibbon.shared";

type EditorRibbonViewTabProps = {
  hiddenViewGroups: Set<string>;
  viewActions: Record<string, RibbonAction>;
  closeDetails: (ref: React.RefObject<HTMLDetailsElement | null>) => void;
  lookupsMenuRef: React.RefObject<HTMLDetailsElement | null>;
  themeMenuRef: React.RefObject<HTMLDetailsElement | null>;
  previewMenuRef: React.RefObject<HTMLDetailsElement | null>;
  lookupsMenuOverflowRef: React.RefObject<HTMLDetailsElement | null>;
  themeMenuOverflowRef: React.RefObject<HTMLDetailsElement | null>;
  previewMenuOverflowRef: React.RefObject<HTMLDetailsElement | null>;
};

export default function EditorRibbonViewTab({
  hiddenViewGroups,
  viewActions,
  closeDetails,
  lookupsMenuRef,
  themeMenuRef,
  previewMenuRef,
  lookupsMenuOverflowRef,
  themeMenuOverflowRef,
  previewMenuOverflowRef
}: EditorRibbonViewTabProps) {
  return (
          <>
            {!hiddenViewGroups.has("layout") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={viewActions.layoutVertical} />
                  <RibbonButton action={viewActions.layoutHorizontal} />
                </div>
                <div className="fc-editor-ribbon-group-title">Layout</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("navigation") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={viewActions.showNavigation} />
                  <RibbonButton action={viewActions.showDocumentStructure} />
                </div>
                <div className="fc-editor-ribbon-group-title">Navigation</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("fonts") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={viewActions.enableTextZoom} size="large" />
                  <RibbonButton action={viewActions.zoomLarger} />
                  <RibbonButton action={viewActions.zoomSmaller} />
                </div>
                <div className="fc-editor-ribbon-group-title">Fonts</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("tags") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={viewActions.showFormattingTags} />
                  <RibbonButton action={viewActions.showTagDetails} />
                </div>
                <div className="fc-editor-ribbon-group-title">Tags</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("lookups") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  {viewActions.filterLookups.enabled ? (
                    <details className="fc-ribbon-dropdown" ref={lookupsMenuRef}>
                      <summary
                        className="fc-ribbon-button has-caret"
                        aria-label={viewActions.filterLookups.label}
                        title={tooltipFor(viewActions.filterLookups)}
                      >
                        <span className="fc-ribbon-icon">{viewActions.filterLookups.icon}</span>
                        <span className="fc-ribbon-label">{viewActions.filterLookups.label}</span>
                        <span className="fc-ribbon-caret" aria-hidden="true">
                          {RIBBON_ICONS.caret}
                        </span>
                      </summary>
                      <div className="fc-ribbon-dropdown-menu">
                        {[viewActions.filterLookupsAll, viewActions.filterLookupsTerms, viewActions.filterLookupsTm, viewActions.filterLookupsMt].map(
                          (action) => (
                            <button
                              key={action.label}
                              type="button"
                              className={`fc-ribbon-menu-button ${action.pressed ? "is-pressed" : ""}`}
                              onClick={() => {
                                action.onClick?.();
                                closeDetails(lookupsMenuRef);
                              }}
                              disabled={!action.enabled}
                              aria-pressed={action.pressed}
                              title={tooltipFor(action)}
                            >
                              <span className="fc-ribbon-icon">{action.icon}</span>
                              <span className="fc-ribbon-label">{action.label}</span>
                            </button>
                          )
                        )}
                      </div>
                    </details>
                  ) : (
                    <RibbonButton action={viewActions.filterLookups} showCaret />
                  )}
                  <RibbonButton action={viewActions.alternativeView} />
                </div>
                <div className="fc-editor-ribbon-group-title">Lookups</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("theme") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  {viewActions.theme.enabled ? (
                    <details className="fc-ribbon-dropdown" ref={themeMenuRef}>
                      <summary
                        className="fc-ribbon-button is-large has-caret"
                        aria-label={viewActions.theme.label}
                        title={tooltipFor(viewActions.theme)}
                      >
                        <span className="fc-ribbon-icon">{viewActions.theme.icon}</span>
                        <span className="fc-ribbon-label">{viewActions.theme.label}</span>
                        <span className="fc-ribbon-caret" aria-hidden="true">
                          {RIBBON_ICONS.caret}
                        </span>
                      </summary>
                      <div className="fc-ribbon-dropdown-menu">
                        {[viewActions.themeLight, viewActions.themeDark, viewActions.themeAuto].map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            className={`fc-ribbon-menu-button ${action.pressed ? "is-pressed" : ""}`}
                            onClick={() => {
                              action.onClick?.();
                              closeDetails(themeMenuRef);
                            }}
                            disabled={!action.enabled}
                            aria-pressed={action.pressed}
                            title={tooltipFor(action)}
                          >
                            <span className="fc-ribbon-icon">{action.icon}</span>
                            <span className="fc-ribbon-label">{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <RibbonButton action={viewActions.theme} size="large" showCaret />
                  )}
                </div>
                <div className="fc-editor-ribbon-group-title">Theme</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("preview") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  {viewActions.preview.enabled ? (
                    <details className="fc-ribbon-dropdown" ref={previewMenuRef}>
                      <summary
                        className="fc-ribbon-button is-large has-caret"
                        aria-label={viewActions.preview.label}
                        title={tooltipFor(viewActions.preview)}
                      >
                        <span className="fc-ribbon-icon">{viewActions.preview.icon}</span>
                        <span className="fc-ribbon-label">{viewActions.preview.label}</span>
                        <span className="fc-ribbon-caret" aria-hidden="true">
                          {RIBBON_ICONS.caret}
                        </span>
                      </summary>
                      <div className="fc-ribbon-dropdown-menu">
                        {[viewActions.previewOff, viewActions.previewSplit, viewActions.previewOn].map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            className={`fc-ribbon-menu-button ${action.pressed ? "is-pressed" : ""}`}
                            onClick={() => {
                              action.onClick?.();
                              closeDetails(previewMenuRef);
                            }}
                            disabled={!action.enabled}
                            aria-pressed={action.pressed}
                            title={tooltipFor(action)}
                          >
                            <span className="fc-ribbon-icon">{action.icon}</span>
                            <span className="fc-ribbon-label">{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <RibbonButton action={viewActions.preview} size="large" showCaret />
                  )}
                </div>
                <div className="fc-editor-ribbon-group-title">Preview</div>
              </div>
            ) : null}

            {!hiddenViewGroups.has("settings") ? (
              <div className="fc-editor-ribbon-group">
                <div className="fc-editor-ribbon-group-body">
                  <RibbonButton action={viewActions.options} size="large" />
                </div>
                <div className="fc-editor-ribbon-group-title">Settings</div>
              </div>
            ) : null}

            {hiddenViewGroups.size > 0 ? (
              <details className="fc-ribbon-overflow">
                <summary className="fc-ribbon-button fc-ribbon-overflow-button" aria-label="More">
                  <span className="fc-ribbon-icon">{RIBBON_ICONS.overflow}</span>
                  <span className="visually-hidden">More</span>
                </summary>
                <div className="fc-ribbon-dropdown-menu fc-ribbon-overflow-menu">
                  {hiddenViewGroups.has("layout") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Layout</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={viewActions.layoutVertical} variant="menu" />
                        <RibbonButton action={viewActions.layoutHorizontal} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("navigation") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Navigation</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={viewActions.showNavigation} variant="menu" />
                        <RibbonButton action={viewActions.showDocumentStructure} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("fonts") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Fonts</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={viewActions.enableTextZoom} variant="menu" />
                        <RibbonButton action={viewActions.zoomLarger} variant="menu" />
                        <RibbonButton action={viewActions.zoomSmaller} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("tags") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Tags</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={viewActions.showFormattingTags} variant="menu" />
                        <RibbonButton action={viewActions.showTagDetails} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("lookups") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Lookups</div>
                      <div className="fc-ribbon-overflow-items">
                        {viewActions.filterLookups.enabled ? (
                          <details className="fc-ribbon-dropdown" ref={lookupsMenuOverflowRef}>
                            <summary
                              className="fc-ribbon-menu-button has-caret"
                              aria-label={viewActions.filterLookups.label}
                              title={tooltipFor(viewActions.filterLookups)}
                            >
                              <span className="fc-ribbon-icon">{viewActions.filterLookups.icon}</span>
                              <span className="fc-ribbon-label">{viewActions.filterLookups.label}</span>
                              <span className="fc-ribbon-caret" aria-hidden="true">
                                {RIBBON_ICONS.caret}
                              </span>
                            </summary>
                            <div className="fc-ribbon-dropdown-menu">
                              {[viewActions.filterLookupsAll, viewActions.filterLookupsTerms, viewActions.filterLookupsTm, viewActions.filterLookupsMt].map(
                                (action) => (
                                  <button
                                    key={action.label}
                                    type="button"
                                    className={`fc-ribbon-menu-button ${action.pressed ? "is-pressed" : ""}`}
                                    onClick={() => {
                                      action.onClick?.();
                                      closeDetails(lookupsMenuOverflowRef);
                                    }}
                                    disabled={!action.enabled}
                                    aria-pressed={action.pressed}
                                    title={tooltipFor(action)}
                                  >
                                    <span className="fc-ribbon-icon">{action.icon}</span>
                                    <span className="fc-ribbon-label">{action.label}</span>
                                  </button>
                                )
                              )}
                            </div>
                          </details>
                        ) : (
                          <RibbonButton action={viewActions.filterLookups} variant="menu" showCaret />
                        )}
                        <RibbonButton action={viewActions.alternativeView} variant="menu" />
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("theme") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Theme</div>
                      <div className="fc-ribbon-overflow-items">
                        {viewActions.theme.enabled ? (
                          <details className="fc-ribbon-dropdown" ref={themeMenuOverflowRef}>
                            <summary
                              className="fc-ribbon-menu-button has-caret"
                              aria-label={viewActions.theme.label}
                              title={tooltipFor(viewActions.theme)}
                            >
                              <span className="fc-ribbon-icon">{viewActions.theme.icon}</span>
                              <span className="fc-ribbon-label">{viewActions.theme.label}</span>
                              <span className="fc-ribbon-caret" aria-hidden="true">
                                {RIBBON_ICONS.caret}
                              </span>
                            </summary>
                            <div className="fc-ribbon-dropdown-menu">
                              {[viewActions.themeLight, viewActions.themeDark, viewActions.themeAuto].map((action) => (
                                <button
                                  key={action.label}
                                  type="button"
                                  className={`fc-ribbon-menu-button ${action.pressed ? "is-pressed" : ""}`}
                                  onClick={() => {
                                    action.onClick?.();
                                    closeDetails(themeMenuOverflowRef);
                                  }}
                                  disabled={!action.enabled}
                                  aria-pressed={action.pressed}
                                  title={tooltipFor(action)}
                                >
                                  <span className="fc-ribbon-icon">{action.icon}</span>
                                  <span className="fc-ribbon-label">{action.label}</span>
                                </button>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <RibbonButton action={viewActions.theme} variant="menu" showCaret />
                        )}
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("preview") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Preview</div>
                      <div className="fc-ribbon-overflow-items">
                        {viewActions.preview.enabled ? (
                          <details className="fc-ribbon-dropdown" ref={previewMenuOverflowRef}>
                            <summary
                              className="fc-ribbon-menu-button has-caret"
                              aria-label={viewActions.preview.label}
                              title={tooltipFor(viewActions.preview)}
                            >
                              <span className="fc-ribbon-icon">{viewActions.preview.icon}</span>
                              <span className="fc-ribbon-label">{viewActions.preview.label}</span>
                              <span className="fc-ribbon-caret" aria-hidden="true">
                                {RIBBON_ICONS.caret}
                              </span>
                            </summary>
                            <div className="fc-ribbon-dropdown-menu">
                              {[viewActions.previewOff, viewActions.previewSplit, viewActions.previewOn].map((action) => (
                                <button
                                  key={action.label}
                                  type="button"
                                  className={`fc-ribbon-menu-button ${action.pressed ? "is-pressed" : ""}`}
                                  onClick={() => {
                                    action.onClick?.();
                                    closeDetails(previewMenuOverflowRef);
                                  }}
                                  disabled={!action.enabled}
                                  aria-pressed={action.pressed}
                                  title={tooltipFor(action)}
                                >
                                  <span className="fc-ribbon-icon">{action.icon}</span>
                                  <span className="fc-ribbon-label">{action.label}</span>
                                </button>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <RibbonButton action={viewActions.preview} variant="menu" showCaret />
                        )}
                      </div>
                    </div>
                  ) : null}

                  {hiddenViewGroups.has("settings") ? (
                    <div className="fc-ribbon-overflow-group">
                      <div className="fc-ribbon-overflow-title">Settings</div>
                      <div className="fc-ribbon-overflow-items">
                        <RibbonButton action={viewActions.options} variant="menu" />
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </>
  );
}
