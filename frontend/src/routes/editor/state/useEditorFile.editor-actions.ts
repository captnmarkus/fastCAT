import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Segment, TermbaseConcordanceEntry } from "../../../api";
import { extractPlaceholders } from "../../../utils/qa";
import { buildIssueJumpHandler } from "../../../utils/reviewQueue";
import { insertAtSelection } from "../../../utils/insert";
import {
  type GlossaryHighlightMatch,
  pickPreferredTerm
} from "../../../utils/termbase";
import type { SegmentHistory } from "./useEditorFile.helpers";

type OccurrenceHighlight = {
  segmentId: number;
  term: string;
  side: "source" | "target";
} | null;

type UpdateTargetOptions = {
  skipHistory?: boolean;
};

type UseEditorFileEditorActionsParams = {
  active: Segment | undefined;
  activeId: number | null;
  getCurrentTargetValue: (segmentId: number) => string;
  historyRef: MutableRefObject<Record<number, SegmentHistory>>;
  segmentSrcRef: MutableRefObject<Record<number, string>>;
  segmentsRef: MutableRefObject<Segment[]>;
  setActiveId: Dispatch<SetStateAction<number | null>>;
  setOccurrenceHighlight: Dispatch<SetStateAction<OccurrenceHighlight>>;
  smartCasing: boolean;
  updateTarget: (segmentId: number, value: string, opts?: UpdateTargetOptions) => void;
};

export function useEditorFileEditorActions(params: UseEditorFileEditorActionsParams) {
  const {
    active,
    activeId,
    getCurrentTargetValue,
    historyRef,
    segmentSrcRef,
    segmentsRef,
    setActiveId,
    setOccurrenceHighlight,
    smartCasing,
    updateTarget
  } = params;

  const insertTextAtCursor = useCallback(
    (segmentId: number, text: string) => {
      const value = String(text ?? "").trim();
      if (!value) return;
      if (segmentId !== activeId) setActiveId(segmentId);
      const currentValue = getCurrentTargetValue(segmentId);
      const activeTextarea = (
        document.querySelector(`textarea.fc-modern-target-input[data-segment-id="${segmentId}"]`) ??
        document.querySelector(".fc-editor-row.active textarea.fc-editor-cell-input") ??
        document.querySelector("textarea.fc-editor-cell-input")
      ) as HTMLTextAreaElement | null;
      if (segmentId === activeId && activeTextarea) {
        const { nextValue, nextCursor } = insertAtSelection(
          currentValue,
          value,
          activeTextarea.selectionStart,
          activeTextarea.selectionEnd
        );
        updateTarget(segmentId, nextValue);
        window.requestAnimationFrame(() => {
          try {
            activeTextarea.focus();
            activeTextarea.setSelectionRange(nextCursor, nextCursor);
          } catch {
            // ignore selection errors
          }
        });
        return;
      }
      const needsSpace = currentValue && !/\s$/.test(currentValue);
      const nextValue = currentValue ? `${currentValue}${needsSpace ? " " : ""}${value}` : value;
      updateTarget(segmentId, nextValue);
    },
    [activeId, getCurrentTargetValue, setActiveId, updateTarget]
  );

  const applySmartCasing = useCallback(
    (src: string, matchText: string, insertText: string) => {
      if (!smartCasing) return insertText;
      const safe = matchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      const found = src.match(rx);
      const sample = found?.[0] ?? matchText;
      if (!sample) return insertText;
      if (sample.toUpperCase() === sample && sample.toLowerCase() !== sample) {
        return insertText.toUpperCase();
      }
      if (sample[0] && sample[0] === sample[0].toUpperCase()) {
        return insertText[0]?.toUpperCase() + insertText.slice(1);
      }
      return insertText;
    },
    [smartCasing]
  );

  const resolvePreferredTarget = useCallback((match: GlossaryHighlightMatch) => {
    for (const entry of match.entries) {
      const preferred = pickPreferredTerm(entry.target?.terms ?? []);
      if (preferred?.text) return preferred;
    }
    return null;
  }, []);

  const insertGlossaryMatch = useCallback(
    (segmentId: number, match: GlossaryHighlightMatch) => {
      const preferred = resolvePreferredTarget(match);
      if (!preferred) return;
      if (preferred.status === "forbidden") {
        const ok = window.confirm(`"${preferred.text}" is marked Forbidden. Insert anyway?`);
        if (!ok) return;
      }
      const src = segmentSrcRef.current[segmentId] ?? "";
      const adjusted = applySmartCasing(src, match.term, preferred.text);
      insertTextAtCursor(segmentId, adjusted);
    },
    [applySmartCasing, insertTextAtCursor, resolvePreferredTarget, segmentSrcRef]
  );

  const insertGlossaryTerm = useCallback(
    (
      segmentId: number,
      termText: string,
      status?: "preferred" | "allowed" | "forbidden",
      sourceTerm?: string
    ) => {
      if (status === "forbidden") {
        const ok = window.confirm(`"${termText}" is marked Forbidden. Insert anyway?`);
        if (!ok) return;
      }
      const src = segmentSrcRef.current[segmentId] ?? "";
      const adjusted = sourceTerm ? applySmartCasing(src, sourceTerm, termText) : termText;
      insertTextAtCursor(segmentId, adjusted);
    },
    [applySmartCasing, insertTextAtCursor, segmentSrcRef]
  );

  const jumpToOccurrence = useCallback(
    (segmentId: number, term: string, side: "source" | "target") => {
      if (!segmentId) return;
      setActiveId(segmentId);
      setOccurrenceHighlight({ segmentId, term, side });
      if (side !== "target") return;
      window.setTimeout(() => {
        const textarea = (
          document.querySelector(`textarea.fc-modern-target-input[data-segment-id="${segmentId}"]`) ??
          document.querySelector(".fc-editor-row.active textarea.fc-editor-cell-input") ??
          document.querySelector("textarea.fc-editor-cell-input")
        ) as HTMLTextAreaElement | null;
        if (!textarea) return;
        const currentValue = getCurrentTargetValue(segmentId);
        const needle = String(term ?? "").trim();
        if (!needle) return;
        const idx = currentValue.toLowerCase().indexOf(needle.toLowerCase());
        if (idx < 0) return;
        try {
          textarea.focus();
          textarea.setSelectionRange(idx, idx + needle.length);
        } catch {
          // ignore selection errors
        }
      }, 0);
    },
    [getCurrentTargetValue, setActiveId, setOccurrenceHighlight]
  );

  const jumpToIssue = useMemo(
    () => buildIssueJumpHandler(setActiveId, setOccurrenceHighlight),
    [setActiveId, setOccurrenceHighlight]
  );

  const insertConcordanceEntry = useCallback(
    (segmentId: number, entry: TermbaseConcordanceEntry) => {
      const preferred =
        entry.targetTerms.find((term) => term.status === "preferred") ?? entry.targetTerms[0] ?? null;
      if (!preferred) return;
      const sourceMatch =
        entry.matches?.find((match) => match.lang === "source")?.term ?? entry.sourceTerms[0]?.text ?? undefined;
      insertGlossaryTerm(segmentId, preferred.text, preferred.status, sourceMatch);
    },
    [insertGlossaryTerm]
  );

  const copyPlaceholdersFromSource = useCallback(
    (segmentId: number) => {
      const seg = segmentsRef.current.find((segment) => segment.id === segmentId);
      if (!seg) return;
      const srcTokens = extractPlaceholders(seg.src);
      if (srcTokens.length === 0) return;
      const currentValue = getCurrentTargetValue(segmentId);
      const stripped = currentValue.replace(/<\/?\d+>|\{\d+\}/g, "").trimEnd();
      const spacer = stripped && !/\s$/.test(stripped) ? " " : "";
      const nextValue = stripped ? `${stripped}${spacer}${srcTokens.join("")}` : srcTokens.join("");
      updateTarget(segmentId, nextValue);
    },
    [getCurrentTargetValue, segmentsRef, updateTarget]
  );

  const appendMissingPlaceholders = useCallback(
    (segmentId: number) => {
      const seg = segmentsRef.current.find((segment) => segment.id === segmentId);
      if (!seg) return;
      const srcTokens = extractPlaceholders(seg.src);
      if (srcTokens.length === 0) return;
      const currentValue = getCurrentTargetValue(segmentId);
      const tgtTokens = extractPlaceholders(currentValue);
      const srcCounts = new Map<string, number>();
      const tgtCounts = new Map<string, number>();
      srcTokens.forEach((token) => srcCounts.set(token, (srcCounts.get(token) ?? 0) + 1));
      tgtTokens.forEach((token) => tgtCounts.set(token, (tgtCounts.get(token) ?? 0) + 1));
      const missing: string[] = [];
      srcCounts.forEach((count, token) => {
        const have = tgtCounts.get(token) ?? 0;
        for (let i = have; i < count; i += 1) missing.push(token);
      });
      if (missing.length === 0) return;
      const spacer = currentValue && !/\s$/.test(currentValue) ? " " : "";
      const nextValue = `${currentValue}${spacer}${missing.join("")}`;
      updateTarget(segmentId, nextValue);
    },
    [getCurrentTargetValue, segmentsRef, updateTarget]
  );

  const undoActive = useCallback(() => {
    if (!active) return;
    const entry = historyRef.current[active.id];
    if (!entry || entry.past.length === 0) return;
    const current = getCurrentTargetValue(active.id);
    const prevValue = entry.past.pop()!;
    entry.future.push(current);
    updateTarget(active.id, prevValue, { skipHistory: true });
  }, [active, getCurrentTargetValue, historyRef, updateTarget]);

  const redoActive = useCallback(() => {
    if (!active) return;
    const entry = historyRef.current[active.id];
    if (!entry || entry.future.length === 0) return;
    const current = getCurrentTargetValue(active.id);
    const nextValue = entry.future.pop()!;
    entry.past.push(current);
    updateTarget(active.id, nextValue, { skipHistory: true });
  }, [active, getCurrentTargetValue, historyRef, updateTarget]);

  return {
    insertTextAtCursor,
    insertGlossaryMatch,
    insertGlossaryTerm,
    jumpToOccurrence,
    jumpToIssue,
    insertConcordanceEntry,
    copyPlaceholdersFromSource,
    appendMissingPlaceholders,
    undoActive,
    redoActive
  };
}
