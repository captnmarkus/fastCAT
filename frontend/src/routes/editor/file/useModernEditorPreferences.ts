import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthUser } from "../../../types/app";
import { useEditorFile } from "../state/useEditorFile";
import {
  BOTTOM_PANEL_MAX_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_VIEW_PREFS,
  type PreviewLayout,
  type StatusFilter,
  filterPrefKey,
  fontPrefKey,
  hotkeyPrefKey,
  readEditorFontSize,
  readFilterPrefs,
  readHotkeyPrefs,
  readViewPrefs,
  viewPrefKey,
  writeEditorFontSize,
  writeFilterPrefs,
  writeHotkeyPrefs,
  writeViewPrefs
} from "./modernEditorPageUtils";

type EditorController = ReturnType<typeof useEditorFile>;

export function useModernEditorPreferences(params: {
  currentUser: AuthUser | null;
  editor: EditorController;
  taskId: number;
  nav: (to: string, options?: { replace?: boolean }) => void;
}) {
  const { currentUser, editor, taskId, nav } = params;
  const prefStorageKey = useMemo(() => viewPrefKey(currentUser), [currentUser]);
  const hotkeyPrefStorageKey = useMemo(() => hotkeyPrefKey(currentUser), [currentUser]);
  const filterPrefStorageKey = useMemo(() => filterPrefKey(currentUser), [currentUser]);
  const fontStorageKey = useMemo(() => fontPrefKey(currentUser), [currentUser]);

  const [rightSidebarOpen, setRightSidebarOpen] = useState(DEFAULT_VIEW_PREFS.rightSidebarOpen);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(DEFAULT_VIEW_PREFS.bottomPanelOpen);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_VIEW_PREFS.bottomPanelHeight);
  const [previewEnabled, setPreviewEnabled] = useState(DEFAULT_VIEW_PREFS.previewEnabled);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout>(DEFAULT_VIEW_PREFS.previewLayout);
  const [showWhitespace, setShowWhitespace] = useState(DEFAULT_VIEW_PREFS.showWhitespace);
  const [showTags, setShowTags] = useState(DEFAULT_VIEW_PREFS.showTags);

  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [untranslatedOnly, setUntranslatedOnly] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [withQaOnly, setWithQaOnly] = useState(false);
  const [lockedOnly, setLockedOnly] = useState(false);
  const [termHitsOnly, setTermHitsOnly] = useState(false);
  const [ntmDraftOnly, setNtmDraftOnly] = useState(false);
  const [tmxOnly, setTmxOnly] = useState(false);

  const [editorFontSize, setEditorFontSize] = useState(DEFAULT_EDITOR_FONT_SIZE);
  const [enableConcordanceCtrlK, setEnableConcordanceCtrlK] = useState(true);
  const bottomPanelResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const prefs = readViewPrefs(prefStorageKey);
    setRightSidebarOpen(prefs.rightSidebarOpen);
    setBottomPanelOpen(prefs.bottomPanelOpen);
    setBottomPanelHeight(prefs.bottomPanelHeight);
    setPreviewEnabled(prefs.previewEnabled);
    setPreviewLayout(prefs.previewLayout);
    setShowWhitespace(prefs.showWhitespace);
    setShowTags(prefs.showTags);
  }, [prefStorageKey]);

  useEffect(() => {
    writeViewPrefs(prefStorageKey, {
      rightSidebarOpen,
      bottomPanelOpen,
      bottomPanelHeight,
      previewEnabled,
      previewLayout,
      showWhitespace,
      showTags
    });
  }, [
    bottomPanelHeight,
    bottomPanelOpen,
    prefStorageKey,
    previewEnabled,
    previewLayout,
    rightSidebarOpen,
    showTags,
    showWhitespace
  ]);

  useEffect(() => {
    setEditorFontSize(readEditorFontSize(fontStorageKey));
  }, [fontStorageKey]);

  useEffect(() => {
    const prefs = readHotkeyPrefs(hotkeyPrefStorageKey);
    setEnableConcordanceCtrlK(prefs.enableConcordanceCtrlK);
  }, [hotkeyPrefStorageKey]);

  useEffect(() => {
    writeEditorFontSize(fontStorageKey, editorFontSize);
  }, [editorFontSize, fontStorageKey]);

  useEffect(() => {
    writeHotkeyPrefs(hotkeyPrefStorageKey, {
      enableConcordanceCtrlK
    });
  }, [enableConcordanceCtrlK, hotkeyPrefStorageKey]);

  useEffect(() => {
    const prefs = readFilterPrefs(filterPrefStorageKey);
    setStatusFilter(prefs.statusFilter);
    setUntranslatedOnly(prefs.untranslatedOnly);
    setDraftOnly(prefs.draftOnly);
    setReviewedOnly(prefs.reviewedOnly);
    setWithQaOnly(prefs.withQaOnly);
    setLockedOnly(prefs.lockedOnly);
    setTermHitsOnly(prefs.termHitsOnly);
    setNtmDraftOnly(prefs.ntmDraftOnly);
    setTmxOnly(prefs.tmxOnly);
  }, [filterPrefStorageKey]);

  useEffect(() => {
    writeFilterPrefs(filterPrefStorageKey, {
      statusFilter,
      untranslatedOnly,
      draftOnly,
      reviewedOnly,
      withQaOnly,
      lockedOnly,
      termHitsOnly,
      ntmDraftOnly,
      tmxOnly
    });
  }, [
    draftOnly,
    filterPrefStorageKey,
    lockedOnly,
    ntmDraftOnly,
    reviewedOnly,
    statusFilter,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly
  ]);

  useEffect(() => {
    editor.setShowWhitespace(showWhitespace);
  }, [editor.setShowWhitespace, showWhitespace]);

  useEffect(() => {
    editor.setShowTags(showTags);
  }, [editor.setShowTags, showTags]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const resizeState = bottomPanelResizeStateRef.current;
      if (!resizeState) return;
      const delta = resizeState.startY - event.clientY;
      const nextHeight = resizeState.startHeight + delta;
      const clamped = Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(BOTTOM_PANEL_MAX_HEIGHT, Math.round(nextHeight)));
      setBottomPanelHeight(clamped);
    };
    const endResize = () => {
      if (!bottomPanelResizeStateRef.current) return;
      bottomPanelResizeStateRef.current = null;
      document.body.classList.remove("fc-modern-editor-resizing");
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endResize);
    window.addEventListener("mouseleave", endResize);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endResize);
      window.removeEventListener("mouseleave", endResize);
      document.body.classList.remove("fc-modern-editor-resizing");
    };
  }, []);

  useEffect(() => {
    const isPreparingError =
      editor.errorCode === "PROJECT_PREPARING" ||
      (editor.errorStatus === 423 && (!editor.errorCode || editor.errorCode === "PROJECT_PREPARING"));
    if (!isPreparingError) return;
    const projectId = editor.errorProjectId;
    if (!projectId) return;
    nav(`/projects/${projectId}/provisioning`, { replace: true });
  }, [editor.errorCode, editor.errorProjectId, editor.errorStatus, nav]);
  const startBottomPanelResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!bottomPanelOpen) return;
      event.preventDefault();
      bottomPanelResizeStateRef.current = {
        startY: event.clientY,
        startHeight: bottomPanelHeight
      };
      document.body.classList.add("fc-modern-editor-resizing");
    },
    [bottomPanelHeight, bottomPanelOpen]
  );

  return {
    bottomPanelHeight,
    bottomPanelOpen,
    editorFontSize,
    enableConcordanceCtrlK,
    draftOnly,
    lockedOnly,
    ntmDraftOnly,
    previewEnabled,
    previewLayout,
    reviewedOnly,
    rightSidebarOpen,
    showFilters,
    showTags,
    showWhitespace,
    sourceSearch,
    startBottomPanelResize,
    statusFilter,
    targetSearch,
    termHitsOnly,
    tmxOnly,
    untranslatedOnly,
    withQaOnly,
    setBottomPanelHeight,
    setBottomPanelOpen,
    setDraftOnly,
    setEditorFontSize,
    setEnableConcordanceCtrlK,
    setLockedOnly,
    setNtmDraftOnly,
    setPreviewEnabled,
    setPreviewLayout,
    setReviewedOnly,
    setRightSidebarOpen,
    setShowFilters,
    setShowTags,
    setShowWhitespace,
    setSourceSearch,
    setStatusFilter,
    setTargetSearch,
    setTermHitsOnly,
    setTmxOnly,
    setUntranslatedOnly,
    setWithQaOnly
  };
}
