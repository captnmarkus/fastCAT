import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { LanguagePairLabel } from "../../../components/LanguageLabel";
import {
  addTermbaseLanguage,
  addTermbaseTerm,
  createTermbaseEntry,
  deleteTermbaseEntry,
  deleteTermbaseLanguage,
  deleteTermbaseTerm,
  getTermbaseEntry,
  getTermbaseStructure,
  listTermbaseEntries,
  updateTermbaseEntry,
  type TermbaseCustomFields,
  type TermbaseEntryDetail,
  type TermbaseEntryListItem,
  type TermbaseStructure,
  type TermbaseTerm
} from "../../../api";
import { formatDateTime } from "../../../utils/format";
import { clearTimeoutRef } from "../../../utils/timers";
import type { TermbaseShellContext } from "./TermbaseShellPage";
import {
  buildLangLabel,
  canonicalizeLangTag,
  type EntryPatch,
  isCoreTermField,
  isImageFilename,
  mergeEntryPatch,
  resolveAvailableLanguage,
  resolveTermLanguage,
  toFieldSchema,
  useDebouncedValue
} from "./TermbaseEditor.helpers";
import { computeHeaderModifiedAt } from "./termbase-utils";
import TermbaseNewEntryModal from "./TermbaseNewEntryModal";
import TermbaseEditorDetailPane from "./TermbaseEditorDetailPane";
const DEFAULT_NEW_TERM = { text: "", status: "preferred" as const, notes: "", partOfSpeech: "", customFields: {} as TermbaseCustomFields };
const ENTRY_PAGE_SIZE = 50;
export default function TermbaseEditorPage() {
  const { termbaseId, meta, setMeta, canEdit, registerEntryActions } = useOutletContext<TermbaseShellContext>();
  const [listItems, setListItems] = useState<TermbaseEntryListItem[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listHasMore, setListHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [sourceLang, setSourceLang] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const debouncedAuthor = useDebouncedValue(authorFilter, 400);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");
  const [hasIllustration, setHasIllustration] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [entryDetail, setEntryDetail] = useState<TermbaseEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [addingLanguage, setAddingLanguage] = useState(false);
  const [addingLanguageBusy, setAddingLanguageBusy] = useState(false);
  const [newLanguageValue, setNewLanguageValue] = useState("");
  const [newTermLang, setNewTermLang] = useState<string | null>(null);
  const [newTermDraft, setNewTermDraft] = useState({ ...DEFAULT_NEW_TERM });
  const [savingTermLang, setSavingTermLang] = useState<string | null>(null);
  const [deletingLanguage, setDeletingLanguage] = useState<string | null>(null);
  const [deletingTermId, setDeletingTermId] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [structure, setStructure] = useState<TermbaseStructure | null>(meta?.structure ?? null);

  const pendingUpdatesRef = useRef(new Map<string, Partial<TermbaseTerm & { updatedAt?: string | null }>>());
  const pendingRollbacksRef = useRef(new Map<string, TermbaseTerm>());
  const pendingEntryPatchRef = useRef<EntryPatch | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const listLoadingRef = useRef(false);
  const listPageRef = useRef(1);
  const listRefreshQueuedRef = useRef(false);
  const searchRef = useRef(debouncedSearch);
  const filtersRef = useRef({
    sourceLang: "",
    targetLang: "",
    displayLang: "",
    author: "",
    createdFrom: "",
    createdTo: "",
    updatedFrom: "",
    updatedTo: "",
    hasIllustration: false
  });

  useEffect(() => {
    setStructure(meta?.structure ?? null);
  }, [meta?.structure]);

  useEffect(() => {
    if (!Number.isFinite(termbaseId) || termbaseId <= 0) return;
    let active = true;
    (async () => {
      try {
        const schema = await getTermbaseStructure(termbaseId);
        if (active) setStructure(schema);
      } catch {
        if (active) setStructure(meta?.structure ?? null);
      }
    })();
    return () => {
      active = false;
    };
  }, [meta?.structure, termbaseId]);

  const availableLanguages = useMemo(() => {
    const langs = new Set<string>();
    meta?.languages?.forEach((lang) => langs.add(lang));
    entryDetail?.languages?.forEach((section) => langs.add(section.language));
    return Array.from(langs).filter(Boolean).sort();
  }, [entryDetail?.languages, meta?.languages]);

  const visibleLanguages = useMemo(() => {
    if (!entryDetail) return [];
    const selected: string[] = [];
    if (sourceLang) selected.push(sourceLang);
    if (targetLang && targetLang !== sourceLang) selected.push(targetLang);
    if (selected.length > 0) return selected;
    return entryDetail.languages.map((section) => section.language);
  }, [entryDetail, sourceLang, targetLang]);

  const visibleSections = useMemo(() => {
    if (!entryDetail) return [];
    const sectionMap = new Map(entryDetail.languages.map((section) => [section.language, section]));
    return visibleLanguages.map((lang) => sectionMap.get(lang) || { language: lang, terms: [] });
  }, [entryDetail, visibleLanguages]);

  const structureFields = structure ?? meta?.structure ?? null;
  const entryFields = useMemo(() => structureFields?.entry ?? [], [structureFields]);
  const languageFields = useMemo(() => structureFields?.language ?? [], [structureFields]);
  const termFields = useMemo(() => structureFields?.term ?? [], [structureFields]);
  const hasStructureConfig = entryFields.length + languageFields.length + termFields.length > 0;
  const termFieldMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string; values?: string[] }>();
    termFields.forEach((field) => {
      const key = String(field.name || "").trim().toLowerCase();
      if (key) map.set(key, field);
    });
    return map;
  }, [termFields]);
  const statusField = termFieldMap.get("status");
  const partOfSpeechField = termFieldMap.get("part of speech");
  const notesField = termFieldMap.get("note") ?? termFieldMap.get("notes");
  const showStatus = true;
  const showPartOfSpeech = !hasStructureConfig || Boolean(partOfSpeechField);
  const showNotes = !hasStructureConfig || Boolean(notesField);
  const entryAudit = entryDetail?.audit ?? null;
  const headerModifiedAt = useMemo(() => computeHeaderModifiedAt(entryDetail), [entryDetail]);
  const entryCreatedLabel = formatDateTime(entryAudit?.createdAt) || "-";
  const entryModifiedLabel = formatDateTime(headerModifiedAt ?? entryAudit?.modifiedAt) || "-";
  const entryCreatedBy = entryAudit?.createdBy || "-";
  const entryModifiedBy = entryAudit?.modifiedBy || "-";
  const dynamicTermFields = useMemo(
    () => termFields.filter((field) => !isCoreTermField(field)),
    [termFields]
  );
  const entryFieldSchemas = useMemo(
    () => entryFields.map((field) => toFieldSchema(field, "entry")),
    [entryFields]
  );
  const languageFieldSchemas = useMemo(
    () => languageFields.map((field) => toFieldSchema(field, "language")),
    [languageFields]
  );
  const termFieldSchemas = useMemo(
    () => dynamicTermFields.map((field) => toFieldSchema(field, "term")),
    [dynamicTermFields]
  );
  const statusOptions = useMemo(() => {
    const rawValues = statusField?.values?.length
      ? statusField.values
      : ["Preferred", "Allowed", "Forbidden"];
    const normalized = rawValues
      .map((value) => {
        const label = String(value || "").trim();
        const key = label.toLowerCase();
        if (key !== "preferred" && key !== "allowed" && key !== "forbidden") return null;
        return { value: key as TermbaseTerm["status"], label };
      })
      .filter(Boolean) as Array<{ value: TermbaseTerm["status"]; label: string }>;
    return normalized.length > 0
      ? normalized
      : [
          { value: "preferred", label: "Preferred" },
          { value: "allowed", label: "Allowed" },
          { value: "forbidden", label: "Forbidden" }
        ];
  }, [statusField]);

  useEffect(() => {
    if (newTermLang && !visibleLanguages.includes(newTermLang)) {
      setNewTermLang(null);
      setNewTermDraft({ ...DEFAULT_NEW_TERM });
    }
  }, [newTermLang, visibleLanguages]);

  useEffect(() => {
    if (availableLanguages.length === 0) return;
    const preferred = resolveAvailableLanguage(meta?.defaultSourceLang ?? "", availableLanguages);
    const german = resolveAvailableLanguage("de", availableLanguages);
    setSourceLang((prev) => {
      const resolved = resolveAvailableLanguage(prev, availableLanguages);
      if (resolved) return resolved;
      if (preferred) return preferred;
      if (german) return german;
      return availableLanguages[0];
    });
  }, [availableLanguages, meta?.defaultSourceLang]);

  useEffect(() => {
    if (availableLanguages.length === 0) return;
    const preferredTarget = resolveAvailableLanguage(meta?.defaultTargetLang ?? "", availableLanguages);
    const preferredSource = resolveAvailableLanguage(meta?.defaultSourceLang ?? "", availableLanguages);
    const fallbackSource =
      preferredSource || resolveAvailableLanguage("de", availableLanguages) || availableLanguages[0] || "";
    setTargetLang((prev) => {
      const resolved = resolveAvailableLanguage(prev, availableLanguages);
      const sourceResolved = resolveAvailableLanguage(sourceLang, availableLanguages) || fallbackSource;
      if (resolved && resolved !== sourceResolved) return resolved;
      if (preferredTarget && preferredTarget !== sourceResolved) return preferredTarget;
      const english = resolveAvailableLanguage("en", availableLanguages);
      if (english && english !== sourceResolved) return english;
      return availableLanguages.find((lang) => lang !== sourceResolved) || sourceResolved;
    });
  }, [availableLanguages, meta?.defaultSourceLang, meta?.defaultTargetLang, sourceLang]);

  useEffect(() => {
    searchRef.current = debouncedSearch;
  }, [debouncedSearch]);

  useEffect(() => {
    filtersRef.current = {
      sourceLang,
      targetLang,
      displayLang: sourceLang || targetLang,
      author: debouncedAuthor,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      hasIllustration
    };
  }, [sourceLang, targetLang, debouncedAuthor, createdFrom, createdTo, updatedFrom, updatedTo, hasIllustration]);

  const refreshList = useCallback(
    async (reset = false) => {
      if (!Number.isFinite(termbaseId) || termbaseId <= 0) return;
      if (listLoadingRef.current) {
        listRefreshQueuedRef.current = true;
        return;
      }
      listLoadingRef.current = true;
      setListLoading(true);
      setError(null);
      try {
        const page = reset ? 1 : listPageRef.current;
        const filters = filtersRef.current;
        const data = await listTermbaseEntries(termbaseId, {
          query: searchRef.current || undefined,
          sourceLang: filters.sourceLang || undefined,
          targetLang: filters.targetLang || undefined,
          displayLang: filters.displayLang || undefined,
          author: filters.author || undefined,
          createdFrom: filters.createdFrom || undefined,
          createdTo: filters.createdTo || undefined,
          updatedFrom: filters.updatedFrom || undefined,
          updatedTo: filters.updatedTo || undefined,
          hasIllustration: filters.hasIllustration,
          page,
          pageSize: ENTRY_PAGE_SIZE
        });
        const entries = data.entries || [];
        setListTotal(data.total || 0);
        const nextCount = (page - 1) * ENTRY_PAGE_SIZE + entries.length;
        setListHasMore(nextCount < (data.total || 0));
        if (reset) {
          setListItems(entries);
          listPageRef.current = 1;
        } else {
          setListItems((prev) => [...prev, ...entries]);
        }
        if (reset) {
          const nextSelection = entries[0]?.entryId || null;
          setSelectedEntryId((prev) => (prev && entries.some((e) => e.entryId === prev) ? prev : nextSelection));
        }
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to load entries.");
      } finally {
        listLoadingRef.current = false;
        setListLoading(false);
        if (listRefreshQueuedRef.current) {
          listRefreshQueuedRef.current = false;
          void refreshList(true);
        }
      }
    },
    [termbaseId]
  );

  useEffect(() => {
    void refreshList(true);
  }, [
    debouncedSearch,
    sourceLang,
    targetLang,
    debouncedAuthor,
    createdFrom,
    createdTo,
    updatedFrom,
    updatedTo,
    hasIllustration,
    refreshList
  ]);

  const loadMore = useCallback(async () => {
    if (listLoadingRef.current || !listHasMore) return;
    const nextPage = listPageRef.current + 1;
    listLoadingRef.current = true;
    setListLoading(true);
    setError(null);
    try {
        const filters = filtersRef.current;
        const data = await listTermbaseEntries(termbaseId, {
          query: searchRef.current || undefined,
          sourceLang: filters.sourceLang || undefined,
          targetLang: filters.targetLang || undefined,
          displayLang: filters.displayLang || undefined,
          author: filters.author || undefined,
          createdFrom: filters.createdFrom || undefined,
          createdTo: filters.createdTo || undefined,
          updatedFrom: filters.updatedFrom || undefined,
          updatedTo: filters.updatedTo || undefined,
          hasIllustration: filters.hasIllustration,
          page: nextPage,
          pageSize: ENTRY_PAGE_SIZE
        });
      const entries = data.entries || [];
      setListItems((prev) => [...prev, ...entries]);
      const nextCount = (nextPage - 1) * ENTRY_PAGE_SIZE + entries.length;
      setListHasMore(nextCount < (data.total || 0));
      listPageRef.current = nextPage;
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load entries.");
    } finally {
      listLoadingRef.current = false;
      setListLoading(false);
      if (listRefreshQueuedRef.current) {
        listRefreshQueuedRef.current = false;
        void refreshList(true);
      }
    }
  }, [listHasMore, refreshList, termbaseId]);

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (listLoading || !listHasMore) return;
      if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) {
        void loadMore();
      }
    },
    [listHasMore, listLoading, loadMore]
  );

  const loadEntryDetail = useCallback(
    async (entryId: string) => {
      if (!entryId) return;
      setDetailLoading(true);
      setError(null);
      try {
        const detail = await getTermbaseEntry(termbaseId, entryId);
        setEntryDetail(detail);
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to load entry.");
        setEntryDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [termbaseId]
  );

  useEffect(() => {
    if (!selectedEntryId) return;
    void loadEntryDetail(selectedEntryId);
  }, [loadEntryDetail, selectedEntryId]);

  const applyTermUpdate = useCallback(
    (oldTermId: string, term: TermbaseTerm) => {
      setEntryDetail((prev) => {
        if (!prev) return prev;
        const nextLanguages = prev.languages.map((section) => {
          const idx = section.terms.findIndex((t) => t.termId === oldTermId);
          if (idx === -1) return section;
          const nextTerms = [...section.terms];
          nextTerms[idx] = { ...nextTerms[idx], ...term };
          nextTerms.sort((a, b) => a.text.localeCompare(b.text));
          return { ...section, terms: nextTerms };
        });
        return { ...prev, languages: nextLanguages };
      });

      const decoded = decodeTermKey(term.termId);
      const termLang = decoded?.lang || null;
      if (selectedEntryId && sourceLang && termLang === sourceLang) {
        setListItems((prev) =>
          prev.map((item) =>
            item.entryId === selectedEntryId
              ? { ...item, displayTerm: term.text, displayLang: sourceLang }
              : item
          )
        );
      }
    },
    [selectedEntryId, sourceLang]
  );

  const flushPendingSaves = useCallback(async () => {
    if (saveInFlightRef.current) return;
    clearTimeoutRef(saveTimerRef);
    const pendingEntryPatch = pendingEntryPatchRef.current;
    const pendingEntries = Array.from(pendingUpdatesRef.current.entries());
    if (!pendingEntryPatch && pendingEntries.length === 0) return;

    if (pendingEntryPatch) pendingEntryPatchRef.current = null;
    if (pendingEntries.length > 0) pendingUpdatesRef.current.clear();

    saveInFlightRef.current = true;
    setSaveState("saving");
    setSaveError(null);
    let firstError: any = null;
    try {
      if (!selectedEntryId) {
        if (pendingEntryPatch) {
          pendingEntryPatchRef.current = mergeEntryPatch(pendingEntryPatchRef.current, pendingEntryPatch);
        }
        pendingEntries.forEach(([termId, patch]) => pendingUpdatesRef.current.set(termId, patch));
        return;
      }

      const languageMap = new Map<
        string,
        Array<{
          termId: string;
          text?: string;
          status?: TermbaseTerm["status"];
          notes?: string | null;
          partOfSpeech?: string | null;
          customFields?: TermbaseCustomFields | null;
          updatedAt?: string | null;
        }>
      >();

      for (const [termId, patch] of pendingEntries) {
        const lang = resolveTermLanguage(termId, entryDetail);
        if (!lang) throw new Error("Unable to resolve term language.");
        const payload: {
          termId: string;
          text?: string;
          status?: TermbaseTerm["status"];
          notes?: string | null;
          partOfSpeech?: string | null;
          customFields?: TermbaseCustomFields | null;
          updatedAt?: string | null;
        } = { termId };
        if (patch.text !== undefined) payload.text = patch.text;
        if (patch.status !== undefined) payload.status = patch.status;
        if (patch.notes !== undefined) payload.notes = patch.notes ?? null;
        if (patch.partOfSpeech !== undefined) payload.partOfSpeech = patch.partOfSpeech ?? null;
        if (patch.customFields !== undefined) payload.customFields = patch.customFields ?? null;
        if (patch.updatedAt !== undefined) payload.updatedAt = patch.updatedAt ?? null;
        const list = languageMap.get(lang) ?? [];
        list.push(payload);
        languageMap.set(lang, list);
      }

      const languagesPayload = Array.from(languageMap.entries()).map(([lang, terms]) => ({
        lang,
        terms
      }));

      const combinedPayload = {
        ...(pendingEntryPatch ?? {}),
        ...(languagesPayload.length > 0 ? { languages: languagesPayload } : {})
      };

      const res = await updateTermbaseEntry(termbaseId, selectedEntryId, combinedPayload);
      if (res?.entry) {
        setEntryDetail(res.entry);
        if (sourceLang) {
          const sourceSection =
            res.entry.languages.find((section) => section.language === sourceLang) ?? res.entry.languages[0];
          const displayTerm = sourceSection?.terms?.[0]?.text ?? null;
          if (displayTerm) {
            setListItems((prev) =>
              prev.map((item) =>
                item.entryId === selectedEntryId
                  ? { ...item, displayTerm, displayLang: sourceSection?.language ?? item.displayLang }
                  : item
              )
            );
          }
        }
      }

      pendingEntries.forEach(([termId]) => pendingRollbacksRef.current.delete(termId));
    } catch (err: any) {
      firstError = err;
      if (pendingEntryPatch) {
        pendingEntryPatchRef.current = mergeEntryPatch(pendingEntryPatchRef.current, pendingEntryPatch);
        void loadEntryDetail(selectedEntryId!);
      }
      pendingEntries.forEach(([termId, patch]) => pendingUpdatesRef.current.set(termId, patch));
      pendingEntries.forEach(([termId]) => {
        const rollback = pendingRollbacksRef.current.get(termId);
        if (rollback) {
          applyTermUpdate(termId, rollback);
        }
        pendingRollbacksRef.current.delete(termId);
      });
    } finally {
      saveInFlightRef.current = false;
      if (firstError) {
        setSaveState("error");
        setSaveError(firstError?.userMessage || firstError?.message || "Autosave failed.");
      } else {
        setSaveState("saved");
      }
      if (pendingEntryPatchRef.current || pendingUpdatesRef.current.size > 0) {
        saveTimerRef.current = window.setTimeout(() => {
          void flushPendingSaves();
        }, 500);
      }
    }
  }, [applyTermUpdate, entryDetail, loadEntryDetail, selectedEntryId, sourceLang, termbaseId]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const handle = window.setTimeout(() => setSaveState("idle"), 2000);
    return () => window.clearTimeout(handle);
  }, [saveState]);

  const queueTermUpdate = useCallback(
    (termId: string, patch: Partial<TermbaseTerm & { updatedAt?: string | null }>, snapshot?: TermbaseTerm) => {
      const pending = pendingUpdatesRef.current;
      const existing = pending.get(termId) || {};
      const merged: Partial<TermbaseTerm & { updatedAt?: string | null }> = { ...existing, ...patch };
      if (patch.customFields === null) {
        merged.customFields = null;
      } else if (patch.customFields) {
        merged.customFields = {
          ...(existing.customFields ?? {}),
          ...patch.customFields
        };
      }
      pending.set(termId, merged);
      if (snapshot && !pendingRollbacksRef.current.has(termId)) {
        pendingRollbacksRef.current.set(termId, { ...snapshot });
      }
      setSaveState("dirty");
      clearTimeoutRef(saveTimerRef);
      saveTimerRef.current = window.setTimeout(() => {
        void flushPendingSaves();
      }, 600);
    },
    [flushPendingSaves]
  );

  const queueEntryUpdate = useCallback(
    (patch: EntryPatch) => {
      if (!selectedEntryId) return;
      pendingEntryPatchRef.current = mergeEntryPatch(pendingEntryPatchRef.current, patch);
      setSaveState("dirty");
      clearTimeoutRef(saveTimerRef);
      saveTimerRef.current = window.setTimeout(() => {
        void flushPendingSaves();
      }, 600);
    },
    [flushPendingSaves, selectedEntryId]
  );

  const updateEntryCustomField = useCallback(
    (fieldName: string, value: string) => {
      setEntryDetail((prev) => {
        if (!prev) return prev;
        const nextFields = { ...(prev.customFields ?? {}), [fieldName]: value };
        return { ...prev, customFields: nextFields };
      });
      queueEntryUpdate({ entryFields: { [fieldName]: value } });
    },
    [queueEntryUpdate]
  );

  const updateLanguageCustomField = useCallback(
    (language: string, fieldName: string, value: string) => {
      setEntryDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          languages: prev.languages.map((section) =>
            section.language === language
              ? { ...section, customFields: { ...(section.customFields ?? {}), [fieldName]: value } }
              : section
          )
        };
      });
      queueEntryUpdate({ languageFields: { [language]: { [fieldName]: value } } });
    },
    [queueEntryUpdate]
  );

  const updateTermCustomField = useCallback(
    (term: TermbaseTerm, fieldName: string, value: string) => {
      setEntryDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          languages: prev.languages.map((section) => ({
            ...section,
            terms: section.terms.map((item) =>
              item.termId === term.termId
                ? { ...item, customFields: { ...(item.customFields ?? {}), [fieldName]: value } }
                : item
            )
          }))
        };
      });
      queueTermUpdate(term.termId, { customFields: { [fieldName]: value }, updatedAt: term.updatedAt }, term);
    },
    [queueTermUpdate]
  );

  const handleSelectEntry = useCallback(
    async (entryId: string) => {
      if (entryId === selectedEntryId) return;
      await flushPendingSaves();
      setSelectedEntryId(entryId);
    },
    [flushPendingSaves, selectedEntryId]
  );
  const handleCreateEntry = useCallback(
    async (payload: { sourceLang: string; targetLang: string; sourceTerm: string; targetTerm: string }) => {
      const created = await createTermbaseEntry(termbaseId, payload);
      setMeta((prev) => (prev ? { ...prev, entryCount: prev.entryCount + 1 } : prev));
      await refreshList(true);
      if (created.entryId) {
        setSelectedEntryId(created.entryId);
      }
    },
    [refreshList, setMeta, termbaseId]
  );

  const handleDeleteEntry = useCallback(async () => {
    if (!selectedEntryId) return;
    const ok = window.confirm("Delete this entry?");
    if (!ok) return;
    setError(null);
    setDeletingEntry(true);
    try {
      await deleteTermbaseEntry(termbaseId, selectedEntryId);
      setMeta((prev) => (prev ? { ...prev, entryCount: Math.max(0, prev.entryCount - 1) } : prev));
      setEntryDetail(null);
      setSelectedEntryId(null);
      await refreshList(true);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete entry.");
    } finally {
      setDeletingEntry(false);
    }
  }, [refreshList, selectedEntryId, setMeta, termbaseId]);

  const handleAddLanguage = useCallback(async () => {
    if (!selectedEntryId) return;
    const language = canonicalizeLangTag(newLanguageValue);
    if (!language) return;
    if (entryDetail?.languages?.some((section) => section.language === language)) {
      setAddingLanguage(false);
      setNewLanguageValue("");
      return;
    }
    setError(null);
    setAddingLanguageBusy(true);
    try {
      await addTermbaseLanguage(termbaseId, selectedEntryId, language);
      setEntryDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          languages: [...prev.languages, { language, terms: [], customFields: {} }]
        };
      });
      setMeta((prev) =>
        prev ? { ...prev, languages: Array.from(new Set([...(prev.languages || []), language])) } : prev
      );
      setAddingLanguage(false);
      setNewLanguageValue("");
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to add language.");
    } finally {
      setAddingLanguageBusy(false);
    }
    }, [entryDetail?.languages, newLanguageValue, selectedEntryId, setMeta, termbaseId]);

  const handleDeleteLanguage = useCallback(
    async (language: string) => {
      if (!selectedEntryId) return;
      const ok = window.confirm(`Delete all terms for ${language.toUpperCase()}?`);
      if (!ok) return;
      setError(null);
      setDeletingLanguage(language);
      try {
        await deleteTermbaseLanguage(termbaseId, selectedEntryId, language);
        setEntryDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            languages: prev.languages.filter((section) => section.language !== language)
          };
        });
        await refreshList(true);
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to delete language.");
      } finally {
        setDeletingLanguage(null);
      }
    },
    [refreshList, selectedEntryId, termbaseId]
  );

    const handleAddTerm = useCallback(
      async (language: string) => {
        if (!selectedEntryId) return;
      const payload: {
        language: string;
        text: string;
        status?: TermbaseTerm["status"];
        notes?: string | null;
        partOfSpeech?: string | null;
        customFields?: TermbaseCustomFields | null;
      } = {
        language,
        text: newTermDraft.text.trim()
      };
      if (showStatus) payload.status = newTermDraft.status;
      if (showNotes) payload.notes = newTermDraft.notes.trim() || null;
      if (showPartOfSpeech) payload.partOfSpeech = newTermDraft.partOfSpeech.trim() || null;
      if (newTermDraft.customFields && Object.keys(newTermDraft.customFields).length > 0) {
        const cleaned: TermbaseCustomFields = {};
        Object.entries(newTermDraft.customFields).forEach(([key, value]) => {
          const normalized = String(value ?? "");
          if (normalized.trim()) {
            cleaned[key] = normalized;
          }
        });
        if (Object.keys(cleaned).length > 0) {
          payload.customFields = cleaned;
        }
      }
      if (!payload.text) return;
      setError(null);
      setSavingTermLang(language);
      try {
        await addTermbaseTerm(termbaseId, selectedEntryId, payload);
        await loadEntryDetail(selectedEntryId);
        await refreshList(true);
        setNewTermLang(null);
        setNewTermDraft({ ...DEFAULT_NEW_TERM });
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to add term.");
      } finally {
        setSavingTermLang(null);
      }
    },
    [loadEntryDetail, newTermDraft, refreshList, selectedEntryId, showNotes, showPartOfSpeech, showStatus, termbaseId]
  );

  const handleDeleteTerm = useCallback(
    async (term: TermbaseTerm) => {
      const ok = window.confirm(`Delete term "${term.text}"?`);
      if (!ok) return;
      setError(null);
      setDeletingTermId(term.termId);
      try {
        await deleteTermbaseTerm(term.termId);
        setEntryDetail((prev) => {
          if (!prev) return prev;
          const nextLangs = prev.languages
            .map((section) => ({
              ...section,
              terms: section.terms.filter((t) => t.termId !== term.termId)
            }))
            .filter((section) => section.terms.length > 0);
          return { ...prev, languages: nextLangs };
        });
        await refreshList(true);
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to delete term.");
      } finally {
        setDeletingTermId(null);
      }
    },
    [refreshList]
  );

  useEffect(() => {
    registerEntryActions({
      onNewEntry: () => setNewEntryOpen(true),
      onDeleteEntry: handleDeleteEntry,
      canCreate: canEdit,
      canDelete: Boolean(selectedEntryId) && canEdit && !deletingEntry,
      deleting: deletingEntry,
      saveState,
      saveError
    });
    return () => registerEntryActions(null);
  }, [
    canEdit,
    deletingEntry,
    handleDeleteEntry,
    registerEntryActions,
    saveError,
    saveState,
    selectedEntryId
  ]);

  if (!Number.isFinite(termbaseId) || termbaseId <= 0) return <div className="alert alert-warning">Invalid termbase link.</div>;
  const visibleError = error;
  return (
    <>
      <datalist id="termbase-language-options">
        {availableLanguages.map((lang) => (
          <option key={lang} value={lang} />
        ))}
      </datalist>
      {visibleError && (
        <div className="alert alert-danger m-3 mb-0">
          {visibleError}
        </div>
      )}

      <div className="fc-termbase-body">
        <aside className={`fc-termbase-list${filtersCollapsed ? " is-collapsed" : ""}`}>
          <div className="fc-termbase-active-pair">
            <span className="text-muted small">Active pair</span>
            <LanguagePairLabel source={sourceLang} target={targetLang} />
          </div>
          <div className="fc-termbase-list-grid">
            <div className={`fc-termbase-filters${filtersCollapsed ? " collapsed" : ""}`}>
              <div className="fc-termbase-filters-header">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm fc-termbase-filters-toggle"
                  onClick={() => setFiltersCollapsed((prev) => !prev)}
                  title={filtersCollapsed ? "Expand filters" : "Collapse filters"}
                  aria-expanded={!filtersCollapsed}
                >
                  <i className={`bi ${filtersCollapsed ? "bi-chevron-right" : "bi-chevron-left"}`} aria-hidden="true" />
                </button>
                <span className="fc-termbase-filters-title">Filters</span>
              </div>
              {!filtersCollapsed && (
                <div className="fc-termbase-filters-body">
                  <div className="fc-termbase-filter-group">
                    <label className="form-label small text-muted">Source language</label>
                    <select
                      className="form-select form-select-sm"
                      value={sourceLang}
                      onChange={(e) => setSourceLang(e.target.value)}
                      disabled={availableLanguages.length === 0}
                    >
                      {availableLanguages.map((lang) => (
                        <option key={lang} value={lang}>
                          {buildLangLabel(lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="fc-termbase-filter-group">
                    <label className="form-label small text-muted">Target language</label>
                    <div className="fc-termbase-filter-row">
                      <select
                        className="form-select form-select-sm"
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        disabled={availableLanguages.length === 0}
                      >
                        {availableLanguages.map((lang) => (
                          <option key={lang} value={lang}>
                            {buildLangLabel(lang)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => {
                          if (!sourceLang || !targetLang) return;
                          setSourceLang(targetLang);
                          setTargetLang(sourceLang);
                        }}
                        disabled={!sourceLang || !targetLang || availableLanguages.length === 0}
                        title="Swap languages"
                      >
                        <i className="bi bi-arrow-left-right" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="fc-termbase-filter-group">
                    <label className="form-label small text-muted">Author</label>
                    <input
                      className="form-control form-control-sm"
                      placeholder="Created or modified by"
                      value={authorFilter}
                      onChange={(e) => setAuthorFilter(e.target.value)}
                    />
                  </div>
                  <div className="fc-termbase-filter-group">
                    <label className="form-label small text-muted">Created</label>
                    <div className="fc-termbase-filter-row">
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={createdFrom}
                        onChange={(e) => setCreatedFrom(e.target.value)}
                      />
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={createdTo}
                        onChange={(e) => setCreatedTo(e.target.value)}
                      />
                    </div>
                  </div>
                    <div className="fc-termbase-filter-group">
                      <label className="form-label small text-muted">Modified</label>
                      <div className="fc-termbase-filter-row">
                        <input
                          type="date"
                        className="form-control form-control-sm"
                        value={updatedFrom}
                        onChange={(e) => setUpdatedFrom(e.target.value)}
                      />
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          value={updatedTo}
                          onChange={(e) => setUpdatedTo(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="fc-termbase-filter-group">
                      <label className="form-label small text-muted">Has illustration</label>
                      <div className="form-check">
                        <input
                          id="termbase-has-illustration"
                          type="checkbox"
                          className="form-check-input"
                          checked={hasIllustration}
                          onChange={(e) => setHasIllustration(e.target.checked)}
                        />
                        <label className="form-check-label small" htmlFor="termbase-has-illustration">
                          Only entries with illustration
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            <div className="fc-termbase-list-panel">
              <div className="fc-termbase-list-search">
                <input
                  className="form-control form-control-sm"
                  placeholder="Search terms"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="fc-termbase-list-items" onScroll={handleListScroll}>
                {listItems.map((item) => {
                  const active = item.entryId === selectedEntryId;
                  return (
                    <button
                      type="button"
                      key={item.entryId}
                      className={`fc-termbase-list-item${active ? " active" : ""}`}
                      onClick={() => void handleSelectEntry(item.entryId)}
                    >
                        <div className="fc-termbase-list-term fw-semibold">
                          {item.displayTerm || "Untitled entry"}
                        </div>
                      <div className="text-muted small">
                        {item.displayLang ? item.displayLang.toUpperCase() : "Any language"}
                      </div>
                    </button>
                  );
                })}
                {listLoading && <div className="text-muted small px-3 py-2">Loading entries...</div>}
                {!listLoading && listItems.length === 0 && (
                  <div className="text-muted small px-3 py-2">No entries found.</div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <TermbaseEditorDetailPane
          {...{
            selectedEntryId, detailLoading, entryDetail, addingLanguage, newLanguageValue, setNewLanguageValue, handleAddLanguage, canEdit,
            addingLanguageBusy, setAddingLanguage, hasStructureConfig, entryFieldSchemas, updateEntryCustomField, isImageFilename,
            entryCreatedLabel, entryCreatedBy, entryModifiedLabel, entryModifiedBy, visibleSections, setNewTermLang, setNewTermDraft,
            savingTermLang, handleDeleteLanguage, deletingLanguage, languageFieldSchemas, updateLanguageCustomField, showStatus,
            statusOptions, showPartOfSpeech, showNotes, setEntryDetail, queueTermUpdate, handleDeleteTerm, deletingTermId, formatDateTime,
            termFieldSchemas, updateTermCustomField, newTermLang, newTermDraft, handleAddTerm, DEFAULT_NEW_TERM
          }}
        />
      </div>
      <TermbaseNewEntryModal
        open={newEntryOpen}
        languages={availableLanguages}
        defaultSourceLang={meta?.defaultSourceLang ?? null}
        defaultTargetLang={meta?.defaultTargetLang ?? null}
        onClose={() => setNewEntryOpen(false)}
        onCreate={handleCreateEntry}
      />
    </>
  );
}
