import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { exportProjectTargetFile, exportProjectXliff, retryProjectProvision, type Segment } from "../../../api";
import type { AuthUser } from "../../../types/app";
import { normalizeSegmentStatus } from "../../../utils/segmentStatus";
import { coerceSegmentState } from "../../../utils/segmentState";
import { buildTargetOutputFilename } from "../../../utils/outputFilename";
import EditorRibbon from "../_components/EditorRibbon";
import EditorTopBar from "../_components/EditorTopBar";
import LeftSidebar, { type OutlineItem } from "../_components/LeftSidebar";
import PreviewPanel from "../_components/PreviewPanel";
import RightSidebar from "../_components/RightSidebar";
import SegmentGrid from "../_components/SegmentGrid";
import { useEditorFile } from "../state/useEditorFile";

const STRUCTURE_EXTENSIONS = new Set(["docx", "html", "htm"]);

function getFileExtension(filename: string) {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1]!.toLowerCase();
}

function stripTokens(value: string) {
  return value
    .replace(/<\/?\d+>/g, "")
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOutlineItems(segments: Segment[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  let idx = 0;

  for (const seg of segments) {
    const src = String(seg.src || "");
    const htmlMatches = Array.from(src.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi));
    if (htmlMatches.length > 0) {
      for (const match of htmlMatches) {
        const level = Number(match[1] ?? 1);
        const label = stripTokens(String(match[2] ?? ""));
        if (!label) continue;
        items.push({
          id: `h-${seg.id}-${idx++}`,
          label,
          level: Number.isFinite(level) ? level : 1,
          segmentId: seg.id
        });
        if (items.length >= 200) return items;
      }
      continue;
    }

    const clean = stripTokens(src);
    if (!clean) continue;
    const numbered = clean.match(/^(\d+(?:\.\d+)*)\s+(.+)/);
    if (numbered) {
      const label = stripTokens(numbered[2] ?? "");
      if (!label) continue;
      const level = (numbered[1] ?? "").split(".").length;
      items.push({
        id: `n-${seg.id}-${idx++}`,
        label,
        level: Math.max(1, Math.min(level, 6)),
        segmentId: seg.id
      });
    } else if (clean.length <= 60 && !/[.!?]$/.test(clean)) {
      items.push({
        id: `t-${seg.id}-${idx++}`,
        label: clean,
        level: 1,
        segmentId: seg.id
      });
    }

    if (items.length >= 200) return items;
  }

  return items;
}

function normalizeReviewGateStatus(value: string | null | undefined): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

function canDownloadReviewedOutput(taskStatus: string | null | undefined) {
  return normalizeReviewGateStatus(taskStatus) === "reviewed";
}

export default function ClassicEditorFilePage(props: {
  currentUser: AuthUser | null;
  modernUiEnabled?: boolean;
  onToggleModernUi?: () => void;
}) {
  const { currentUser } = props;
  const params = useParams<{ taskId: string }>();
  const nav = useNavigate();
  const taskId = Number(params.taskId);
  const editor = useEditorFile({ taskId, currentUser });
  const fileId = editor.fileId ?? null;
  const [retryingImport, setRetryingImport] = useState(false);

  useEffect(() => {
    const isPreparingError =
      editor.errorCode === "PROJECT_PREPARING" ||
      (editor.errorStatus === 423 && (!editor.errorCode || editor.errorCode === "PROJECT_PREPARING"));
    if (!isPreparingError) return;
    const projectId = editor.errorProjectId;
    if (!projectId) return;
    nav(`/projects/${projectId}/provisioning`, { replace: true });
  }, [editor.errorCode, editor.errorProjectId, editor.errorStatus, nav]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [layoutMode, setLayoutMode] = useState<"horizontal" | "vertical">("horizontal");
  const [textZoomEnabled, setTextZoomEnabled] = useState(false);
  const [textZoom, setTextZoom] = useState(100);
  const [showTagDetails, setShowTagDetails] = useState(true);
  const [showNavigation, setShowNavigation] = useState(false);
  const [showDocumentStructure, setShowDocumentStructure] = useState(false);
  const [lookupsFilter, setLookupsFilter] = useState<"all" | "terms" | "tm" | "mt">("all");
  const [lookupsView, setLookupsView] = useState<"detailed" | "compact">("detailed");
  const [previewMode, setPreviewMode] = useState<"off" | "split" | "on">("off");
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "auto">("light");
  const [sidebarPanel, setSidebarPanel] = useState<"lookups" | "issues" | "comments" | "history">("lookups");

  const saveLabel = useMemo(() => {
    if (editor.saveState === "saving") return "Saving...";
    if (editor.saveState === "offline") return "Offline (queued)";
    if (editor.saveState === "error") return "Save issue";
    return "All changes saved";
  }, [editor.saveState]);

  const hasSegments = editor.segments.length > 0;
  const fileExtension = useMemo(
    () => getFileExtension(editor.fileName || ""),
    [editor.fileName]
  );
  const documentStructureSupported = useMemo(
    () => STRUCTURE_EXTENSIONS.has(fileExtension),
    [fileExtension]
  );
  const previewSupported = hasSegments;
  const outlineItems = useMemo(
    () => (documentStructureSupported ? buildOutlineItems(editor.segments) : []),
    [documentStructureSupported, editor.segments]
  );
  const leftSidebarOpen = showNavigation || showDocumentStructure;

  useEffect(() => {
    if (!documentStructureSupported && showDocumentStructure) {
      setShowDocumentStructure(false);
    }
  }, [documentStructureSupported, showDocumentStructure]);

  useEffect(() => {
    if (!previewSupported && previewMode !== "off") {
      setPreviewMode("off");
    }
  }, [previewMode, previewSupported]);

  if (!currentUser) {
    return <div className="text-muted p-3">Loading editor...</div>;
  }

  if (editor.error) {
    const projectId = editor.errorProjectId ?? editor.projectId;
    return (
      <div className="fc-editor-vnext">
        <div className="alert alert-danger m-3 d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div>
            <div>{editor.error}</div>
            {editor.errorCode === "PROJECT_FAILED" ? (
              <div className="small mt-1">Segment preparation failed. Check Logs/Status and retry import.</div>
            ) : null}
          </div>
          <div className="d-flex gap-2">
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={retryingImport}
                onClick={async () => {
                  try {
                    setRetryingImport(true);
                    await retryProjectProvision(projectId);
                    nav(`/projects/${projectId}/provisioning`, { replace: true });
                  } catch (err: any) {
                    window.alert(err?.userMessage || err?.message || "Retry import failed.");
                  } finally {
                    setRetryingImport(false);
                  }
                }}
              >
                {retryingImport ? "Retrying..." : "Retry import"}
              </button>
            ) : null}
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => nav(`/projects/${projectId}/provisioning`)}
              >
                Open Logs/Status
              </button>
            ) : null}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={editor.reload}>
              Retry
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/inbox")}>
              Back to inbox
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!editor.loading && editor.segments.length === 0) {
    const projectId = editor.projectId ?? editor.errorProjectId;
    return (
      <div className="fc-editor-vnext">
        <div className="alert alert-warning m-3 d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div>
            <div>No segments extracted for this file.</div>
            <div className="small mt-1">Check processing logs and retry import if needed.</div>
          </div>
          <div className="d-flex gap-2">
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={retryingImport}
                onClick={async () => {
                  try {
                    setRetryingImport(true);
                    await retryProjectProvision(projectId);
                    nav(`/projects/${projectId}/provisioning`, { replace: true });
                  } catch (err: any) {
                    window.alert(err?.userMessage || err?.message || "Retry import failed.");
                  } finally {
                    setRetryingImport(false);
                  }
                }}
              >
                {retryingImport ? "Retrying..." : "Retry import"}
              </button>
            ) : null}
            {projectId ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => nav(`/projects/${projectId}/provisioning`)}
              >
                Open Logs/Status
              </button>
            ) : null}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/inbox")}>
              Back to inbox
            </button>
          </div>
        </div>
      </div>
    );
  }

  const effectiveZoom = textZoomEnabled ? textZoom : 100;
  const showPreview = previewSupported && previewMode !== "off";
  const showGrid = !previewSupported || previewMode !== "on";
  const downloadReady = canDownloadReviewedOutput(editor.meta?.task?.status ?? null);
  const taskReadOnly = editor.taskReadOnly;

  return (
    <div className="fc-editor-vnext">
      <EditorTopBar
        projectName={editor.projectName}
        fileName={editor.fileName || `File #${fileId ?? taskId ?? ""}`}
        saveLabel={saveLabel}
        saveTone={editor.saveState}
        modernUiEnabled={props.modernUiEnabled}
        onToggleModernUi={props.onToggleModernUi}
        onClose={() => nav("/inbox")}
        onDownload={async () => {
          const projectId = editor.projectId;
          if (!projectId) return;
          if (!downloadReady) {
            window.alert("Download is available only after review is marked Done.");
            return;
          }
          try {
            const blob = await exportProjectTargetFile(projectId, { taskId, fileId, lang: editor.targetLang });
            const filename = buildTargetOutputFilename(
              editor.fileName || `file-${fileId ?? taskId ?? ""}`,
              editor.targetLang || ""
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (err: any) {
            window.alert(err?.userMessage || err?.message || "Failed to download file");
          }
        }}
        onDownloadXliff={async () => {
          const projectId = editor.projectId;
          if (!projectId) return;
          if (!downloadReady) {
            window.alert("Download is available only after review is marked Done.");
            return;
          }
          try {
            const blob = await exportProjectXliff(projectId, { taskId, fileId });
            const baseLabel = editor.fileName
              ? editor.fileName.replace(/\.[^/.]+$/, "")
              : `file-${fileId ?? taskId}`;
            const filename = `${baseLabel}.xlf`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (err: any) {
            window.alert(err?.userMessage || err?.message || "Failed to download XLIFF");
          }
        }}
        onComplete={async () => {
          if (taskReadOnly) return;
          const role = String(currentUser.role || "").toLowerCase();
          const mode = role === "reviewer" || role === "admin" || role === "manager" ? "reviewed" : "under_review";
          const effectiveTarget = (segmentId: number, fallback: string | null) => {
            const hasDraft = Object.prototype.hasOwnProperty.call(editor.draftById, segmentId);
            return hasDraft ? editor.draftById[segmentId] ?? "" : String(fallback ?? "");
          };
          const stateFor = (seg: Segment) => coerceSegmentState(seg.state, normalizeSegmentStatus(seg.status));

          if (mode === "reviewed") {
            const hasUnreviewed = editor.segments.some((s) => stateFor(s) !== "reviewed");
            if (hasUnreviewed) {
              window.alert("Cannot complete review: some segments are still not reviewed.");
              return;
            }

            const blocked = editor.segments.filter((s) => {
              const state = stateFor(s);
              if (state === "reviewed") return false;
              const tgt = effectiveTarget(s.id, s.tgt);
              if (!tgt.trim()) return true;
              const issues = editor.issuesById[s.id] ?? [];
              return issues.some((issue) => issue.severity === "error");
            });
            if (blocked.length > 0) {
              window.alert("Cannot complete review: resolve blocking QA errors (or empty targets) first.");
              return;
            }
          } else {
            const emptyDrafts = editor.segments.filter((s) => {
              const state = stateFor(s);
              if (state !== "draft" && state !== "nmt_draft") return false;
              const tgt = effectiveTarget(s.id, s.tgt);
              return !tgt.trim();
            }).length;
            if (emptyDrafts > 0) {
              const ok = window.confirm(
                `${emptyDrafts} draft segment${emptyDrafts === 1 ? "" : "s"} are empty and will remain Draft. Complete anyway?`
              );
              if (!ok) return;
            }
          }

          await editor.complete(mode);
          window.dispatchEvent(new CustomEvent("fc:inbox:refresh"));
          nav("/inbox");
        }}
        completeDisabled={taskReadOnly || editor.loadingMore || editor.segments.length === 0}
        downloadDisabled={editor.loading || !editor.projectId || !downloadReady}
        downloadXliffDisabled={editor.loading || !editor.projectId || !downloadReady}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        sidebarOpen={sidebarOpen}
      />

      <EditorRibbon
        active={editor.active}
        draftById={editor.draftById}
        findQuery={editor.findQuery}
        setFindQuery={editor.setFindQuery}
        replaceQuery={editor.replaceQuery}
        setReplaceQuery={editor.setReplaceQuery}
        findScope={editor.findScope}
        setFindScope={editor.setFindScope}
        findUseRegex={editor.findUseRegex}
        setFindUseRegex={editor.setFindUseRegex}
        matchCount={editor.findMatchIndices.length}
        onFindNext={() => editor.goToMatch(1)}
        onFindPrev={() => editor.goToMatch(-1)}
        onReplaceAll={() => editor.replaceAllInTarget()}
        onGoPrev={editor.goPrev}
        onGoNext={editor.goNext}
        canGoPrev={editor.canGoPrev}
        canGoNext={editor.canGoNext}
        onGoTo={editor.goToSegmentNumber}
        reviewQueueEnabled={editor.reviewQueueEnabled}
        setReviewQueueEnabled={editor.setReviewQueueEnabled}
        issueCount={editor.issuesList.length}
        onAcceptCleanDrafts={editor.acceptCleanDrafts}
        onRecomputeIssues={editor.recomputeIssues}
        showWhitespace={editor.showWhitespace}
        setShowWhitespace={editor.setShowWhitespace}
        showTags={editor.showTags}
        setShowTags={editor.setShowTags}
        showTagDetails={showTagDetails}
        setShowTagDetails={setShowTagDetails}
        textZoomEnabled={textZoomEnabled}
        setTextZoomEnabled={setTextZoomEnabled}
        textZoom={textZoom}
        setTextZoom={setTextZoom}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
        showNavigation={showNavigation}
        setShowNavigation={setShowNavigation}
        showDocumentStructure={showDocumentStructure}
        setShowDocumentStructure={setShowDocumentStructure}
        lookupsFilter={lookupsFilter}
        setLookupsFilter={setLookupsFilter}
        lookupsView={lookupsView}
        setLookupsView={setLookupsView}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        themeSupported={false}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        previewSupported={previewSupported}
        optionsSupported={false}
        onOpenOptions={() => {}}
        hasSegments={hasSegments}
        documentStructureSupported={documentStructureSupported}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        enterBehavior={editor.enterBehavior}
        setEnterBehavior={editor.setEnterBehavior}
        onCopySource={() => editor.active && editor.updateTarget(editor.active.id, editor.active.src)}
        onClearTarget={() => editor.active && editor.updateTarget(editor.active.id, "")}
        onConfirm={() => editor.confirmActive({ moveNext: false })}
        onConfirmNext={() => editor.confirmActive({ moveNext: true })}
        onToggleLock={editor.toggleLock}
        onUndo={editor.undoActive}
        onRedo={editor.redoActive}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUpdateTarget={editor.updateTarget}
        onApplySuggestion={(kind) => editor.applySuggestionToActive(kind)}
      />

      {editor.saveFailure && editor.saveFailure.kind !== "offline" ? (
        <div className="alert alert-warning mb-0 rounded-0 d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div>{editor.saveFailure.message}</div>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={editor.reload}>
            Reload
          </button>
        </div>
      ) : null}

      <div className="fc-editor-vnext-body">
        {leftSidebarOpen ? (
          <LeftSidebar
            segments={editor.visibleSegments}
            activeId={editor.activeId}
            setActiveId={editor.setActiveId}
            showNavigation={showNavigation}
            showDocumentStructure={showDocumentStructure}
            outlineItems={outlineItems}
          />
        ) : null}

        {showGrid ? (
          <div className="fc-editor-vnext-grid">
            {editor.loading ? (
              <div className="p-3 text-muted">Loading segments...</div>
            ) : editor.segments.length === 0 ? (
              <div className="p-4 text-muted">No segments found for this file.</div>
            ) : (
              <SegmentGrid
                segments={editor.visibleSegments}
                activeId={editor.activeId}
                setActiveId={editor.setActiveId}
                showWhitespace={editor.showWhitespace}
                showTags={editor.showTags}
                showTagDetails={showTagDetails}
                textZoom={effectiveZoom}
                layoutMode={layoutMode}
                enterBehavior={editor.enterBehavior}
                issuesById={editor.issuesById}
                draftById={editor.draftById}
                taskReadOnly={taskReadOnly}
                ensureTmHints={editor.ensureTmHints}
                getGlossaryMatchesForText={editor.getGlossaryMatchesForText}
                onGlossaryInsert={editor.insertGlossaryMatch}
                onCopyPlaceholders={editor.copyPlaceholdersFromSource}
                onFixPlaceholders={editor.appendMissingPlaceholders}
                onUpdateTarget={editor.updateTarget}
                onMarkReviewed={editor.markReviewed}
                onShowIssues={() => {
                  setSidebarOpen(true);
                  setSidebarPanel("issues");
                }}
                matchIndices={new Set(editor.findMatchIndices)}
                occurrenceHighlight={editor.occurrenceHighlight}
              />
            )}
            {editor.loadingMore && (
              <div className="fc-editor-vnext-loadingmore text-muted small">Loading more...</div>
            )}
          </div>
        ) : null}

        {showPreview ? (
          <PreviewPanel
            segments={editor.segments}
            draftById={editor.draftById}
            activeId={editor.activeId}
            onSelectSegment={editor.setActiveId}
            mode={previewMode === "split" ? "split" : "on"}
            loading={editor.loading}
          />
        ) : null}

        {sidebarOpen && (
          <RightSidebar
            panel={sidebarPanel}
            setPanel={setSidebarPanel}
            active={editor.active}
            termbaseId={editor.termbaseId}
            sourceLang={editor.sourceLang}
            targetLang={editor.targetLang}
            concordanceEntries={editor.concordanceEntries}
            concordanceLoading={editor.concordanceLoading}
            concordanceMode={editor.concordanceMode}
            setConcordanceMode={editor.setConcordanceMode}
            concordanceQuery={editor.concordanceQuery}
            setConcordanceQuery={editor.setConcordanceQuery}
            concordanceFilters={editor.concordanceFilters}
            setConcordanceFilters={editor.setConcordanceFilters}
            getOccurrencesForTerm={editor.getOccurrencesForTerm}
            onJumpToOccurrence={editor.jumpToOccurrence}
            tmMatches={editor.activeTmMatches}
            mtSuggestion={editor.mtSuggestion}
            lookupsFilter={lookupsFilter}
            lookupsView={lookupsView}
            smartCasing={editor.smartCasing}
            setSmartCasing={editor.setSmartCasing}
            onGenerateMt={() => editor.generateMtForActive()}
            onInsertTm={() => editor.applySuggestionToActive("tm")}
            onInsertGlossary={() => editor.applySuggestionToActive("glossary")}
            onInsertGlossaryTerm={(termText, status, sourceTerm) => {
              if (!editor.active) return;
              editor.insertGlossaryTerm(editor.active.id, termText, status, sourceTerm);
            }}
            onInsertMt={() => editor.applySuggestionToActive("mt")}
            issues={editor.issuesList}
            issueFilter={editor.issueFilter}
            setIssueFilter={editor.setIssueFilter}
            onJumpToIssue={editor.jumpToIssue}
          />
        )}
      </div>
    </div>
  );
}
