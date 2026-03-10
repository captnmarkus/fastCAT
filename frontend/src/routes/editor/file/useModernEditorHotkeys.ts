import { useCallback, useEffect } from "react";
import {
  isEditorHotkeyAllowed,
  parseDigitFromAction,
  resolveEditorHotkeyAction,
  type EditorHotkeyMap
} from "../hotkeys/editorHotkeys";

export function useModernEditorHotkeys(params: {
  activeFilteredIndex: number;
  activeSegment: any;
  concordanceInputRef: React.RefObject<HTMLInputElement | null>;
  confirmAndAdvance: () => Promise<void>;
  copySourceToTarget: () => boolean;
  editorRootRef: React.RefObject<HTMLDivElement | null>;
  filteredSegments: Array<{ id: number }>;
  focusTargetForSegment: (segmentId: number | null | undefined) => void;
  goNextFiltered: () => void;
  goPrevFiltered: () => void;
  goToNextTerminologyIssue: () => void;
  goToNextUnconfirmed: () => void;
  hotkeyKeymap: EditorHotkeyMap;
  insertCatSuggestionByIndex: (indexOneBased: number) => Promise<void>;
  insertTagByIndex: (indexOneBased: number) => boolean;
  navigateCatResults: (delta: number) => Promise<void>;
  openFindModal: (mode: "find" | "replace") => void;
  openGoToSegmentDialog: () => void;
  revertActiveSegmentStage: () => Promise<void>;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSourceTargetFocus: () => boolean;
}) {
  const {
    activeFilteredIndex,
    activeSegment,
    concordanceInputRef,
    confirmAndAdvance,
    copySourceToTarget,
    editorRootRef,
    filteredSegments,
    focusTargetForSegment,
    goNextFiltered,
    goPrevFiltered,
    goToNextTerminologyIssue,
    goToNextUnconfirmed,
    hotkeyKeymap,
    insertCatSuggestionByIndex,
    insertTagByIndex,
    navigateCatResults,
    openFindModal,
    openGoToSegmentDialog,
    revertActiveSegmentStage,
    setRightSidebarOpen,
    toggleSourceTargetFocus
  } = params;

  const openConcordanceShortcut = useCallback(() => {
    setRightSidebarOpen(true);
    window.setTimeout(() => concordanceInputRef.current?.focus(), 0);
  }, [concordanceInputRef, setRightSidebarOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const root = editorRootRef.current;
      if (!target || !root || !root.contains(target)) return;

      const inModal = Boolean(target.closest(".fc-modern-modal, .modal, [role='dialog']"));
      if (inModal) return;

      const inTargetEditor = Boolean(target.closest("textarea.fc-modern-target-input, textarea.fc-editor-cell-input"));
      const inSegmentRow = Boolean(target.closest(".fc-modern-segment-row, .fc-editor-row"));
      const isSegmentRowElement = Boolean(target.matches(".fc-modern-segment-row, .fc-editor-row"));
      const inSourceCell = Boolean(
        target.closest(".fc-modern-segment-source, .fc-modern-segment-source-text, .fc-editor-cell.fc-col-src")
      );
      const inFormField = Boolean(target.closest("input, textarea, select")) || Boolean(target.isContentEditable);

      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrl && key === "f") {
        event.preventDefault();
        openFindModal("find");
        return;
      }
      if (ctrl && key === "h") {
        event.preventDefault();
        openFindModal("replace");
        return;
      }
      if (ctrl && event.shiftKey && key === "c") {
        event.preventDefault();
        openConcordanceShortcut();
        return;
      }

      const action = resolveEditorHotkeyAction(event, hotkeyKeymap);
      if (!action) return;
      const allowed = isEditorHotkeyAllowed(action, {
        withinEditor: true,
        hasActiveSegment: Boolean(activeSegment),
        inModal,
        inTargetEditor,
        inSegmentRow,
        inSourceCell,
        inFormField
      });
      if (!allowed) return;
      if (action === "NAV_NEXT" && key === "enter" && !inTargetEditor && !isSegmentRowElement) return;

      let handled = false;
      switch (action) {
        case "SEGMENT_CONFIRM":
          handled = true;
          void confirmAndAdvance();
          break;
        case "NAV_NEXT":
          handled = true;
          goNextFiltered();
          focusTargetForSegment(filteredSegments[activeFilteredIndex + 1]?.id ?? null);
          break;
        case "NAV_PREV":
          handled = true;
          goPrevFiltered();
          focusTargetForSegment(filteredSegments[activeFilteredIndex - 1]?.id ?? null);
          break;
        case "NAV_NEXT_UNCONFIRMED":
          handled = true;
          goToNextUnconfirmed();
          break;
        case "FOCUS_TOGGLE_SOURCE_TARGET":
          handled = toggleSourceTargetFocus();
          break;
        case "NAV_NEXT_TERM_ISSUE":
          handled = true;
          goToNextTerminologyIssue();
          break;
        case "COPY_SOURCE_TO_TARGET":
          handled = copySourceToTarget();
          break;
        case "GOTO_SEGMENT_DIALOG":
          handled = true;
          openGoToSegmentDialog();
          break;
        case "OPEN_CONCORDANCE":
          handled = true;
          openConcordanceShortcut();
          break;
        case "NAV_CAT_UP":
          handled = true;
          void navigateCatResults(-1);
          break;
        case "NAV_CAT_DOWN":
          handled = true;
          void navigateCatResults(1);
          break;
        case "REVERT_STAGE":
          handled = true;
          void revertActiveSegmentStage();
          break;
        default: {
          const catIndex = parseDigitFromAction(action, "INSERT_CAT_SUGGESTION_");
          if (catIndex != null) {
            handled = true;
            void insertCatSuggestionByIndex(catIndex);
            break;
          }
          const tagIndex = parseDigitFromAction(action, "INSERT_TAG_");
          if (tagIndex != null) {
            handled = insertTagByIndex(tagIndex);
            break;
          }
        }
      }

      if (handled) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeFilteredIndex,
    activeSegment,
    confirmAndAdvance,
    copySourceToTarget,
    editorRootRef,
    filteredSegments,
    focusTargetForSegment,
    goNextFiltered,
    goPrevFiltered,
    goToNextTerminologyIssue,
    goToNextUnconfirmed,
    hotkeyKeymap,
    insertCatSuggestionByIndex,
    insertTagByIndex,
    navigateCatResults,
    openConcordanceShortcut,
    openFindModal,
    openGoToSegmentDialog,
    revertActiveSegmentStage,
    toggleSourceTargetFocus
  ]);

  return {
    openConcordanceShortcut
  };
}
