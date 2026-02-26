import { CAT_API_BASE, authHeaders, httpError } from "./core";
import type {
  TermbaseCustomFields,
  TermbaseEntryDetail,
  TermbaseEntryListResponse,
  TermbaseMeta,
  TermbaseStructure,
  TermbaseTerm,
  TmLibraryEntry,
  TmLibraryVersion
} from "./cat.termbase-types";

async function requireOk(action: string, response: Response): Promise<Response> {
  if (!response.ok) throw await httpError(action, response);
  return response;
}

async function parseJsonResponse<T>(action: string, response: Response): Promise<T> {
  await requireOk(action, response);
  return (await response.json()) as T;
}

async function parseBlobResponse(action: string, response: Response): Promise<Blob> {
  await requireOk(action, response);
  return response.blob();
}
export type GlossaryOption = {
  id: number;
  label: string;
  disabled: boolean;
  createdAt: string;
};

export type GlossaryListItem = {
  id: number;
  label: string;
  filename: string | null;
  description: string | null;
  languages: string[];
  visibility: string | null;
  disabled: boolean;
  uploadedBy: string | null;
  uploadedAt: string;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
  entryCount: number;
};

export type GlossaryEntry = {
  id: number;
  sourceLang: string;
  targetLang: string;
  sourceTerm: string;
  targetTerm: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type GlossaryImportMapping = Partial<{
  termId: string;
  sourceLang: string;
  targetLang: string;
  sourceTerm: string;
  targetTerm: string;
  definition: string;
  partOfSpeech: string;
  domain: string;
  context: string;
  usageNote: string;
  forbidden: string;
  preferred: string;
  status: string;
  synonyms: string;
  tags: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  notes: string;
  imageId: string;
  imageFilename: string;
}>;

export type GlossaryImportStats = {
  rowCount: number;
  skippedRows: number;
  missingTermIds: number;
};

export type GlossaryImportReport = {
  processed: number;
  imported: number;
  updated?: number;
  skipped: number;
  errors: string[];
  warnings: string[];
};

export type GlossaryImportSettings = {
  synonymSeparator?: string;
  multiValueSeparator?: string;
  multiLanguageDelimiter?: string;
  strictImport?: boolean;
};

export type GlossaryImportPreviewEntry = {
  termId: string;
  sourceLang: string;
  targetLang: string;
  sourceTerm: string;
  targetTerm: string;
  definition?: string | null;
  tags?: string[] | null;
  image?: { filename: string; url: string } | null;
};

export type GlossaryImportParseResult = {
  importId: number;
  importType: "csv" | "xlsx" | "tbx" | "mtf_xml" | "xml" | "empty";
  file: {
    filename: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    contentType: string | null;
  } | null;
  detectedLanguages: string[];
  columns: Array<{ name: string; normalized: string }>;
  sampleRows: Array<Record<string, string>>;
  mapping: GlossaryImportMapping;
  preview: { entries: GlossaryImportPreviewEntry[]; entryCount: number };
  images: {
    provided: boolean;
    total: number;
    matched: number;
    missing: string[];
    unused: string[];
  };
  stats: GlossaryImportStats;
  validation: { errors: string[]; warnings: string[] };
  requestId?: string;
};

export type GlossaryDetails = {
  glossary: GlossaryListItem;
  preview: GlossaryEntry[];
};

export type GlossaryEntryListResponse = {
  entries: GlossaryEntry[];
  total: number;
  page: number;
  limit: number;
};

export async function listGlossaries(): Promise<GlossaryOption[]> {
  const response = await fetch(`${CAT_API_BASE}/library/glossaries`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ glossaries?: GlossaryOption[] }>("list glossaries", response);
  return data.glossaries || [];
}

export async function adminListGlossaries(): Promise<GlossaryListItem[]> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ glossaries?: GlossaryListItem[] }>("admin glossaries", response);
  return data.glossaries || [];
}

export async function adminGetGlossary(
  glossaryId: number
): Promise<GlossaryDetails> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}`, {
    headers: { ...authHeaders() }
  });
  return parseJsonResponse<GlossaryDetails>("admin glossary details", response);
}

export async function adminListGlossaryEntries(
  glossaryId: number,
  params: {
    q?: string;
    createdFrom?: string;
    createdTo?: string;
    updatedFrom?: string;
    updatedTo?: string;
    createdBy?: string;
    updatedBy?: string;
    sourceLang?: string;
    targetLang?: string;
    sourceTerm?: string;
    targetTerm?: string;
    notes?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    page?: number;
    limit?: number;
  } = {}
): Promise<GlossaryEntryListResponse> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const value = typeof v === "string" ? v.trim() : String(v);
    if (!value) return;
    qs.set(k, value);
  });
  const url = `${CAT_API_BASE}/admin/glossaries/${glossaryId}/entries${qs.toString() ? `?${qs}` : ""}`;
  const response = await fetch(url, { headers: { ...authHeaders() } });
  return parseJsonResponse<GlossaryEntryListResponse>("list glossary entries", response);
}

export async function adminCreateGlossaryEntry(
  glossaryId: number,
  entry: {
    sourceLang: string;
    targetLang: string;
    sourceTerm: string;
    targetTerm: string;
    notes?: string | null;
  }
): Promise<GlossaryEntry> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(entry)
  });
  const data = await parseJsonResponse<{ entry: GlossaryEntry }>("create glossary entry", response);
  return data.entry as GlossaryEntry;
}

export async function adminUpdateGlossaryEntry(
  glossaryId: number,
  entryId: number,
  updates: Partial<{
    sourceLang: string;
    targetLang: string;
    sourceTerm: string;
    targetTerm: string;
    notes: string | null;
  }>
): Promise<GlossaryEntry> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}/entries/${entryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  const data = await parseJsonResponse<{ entry: GlossaryEntry }>("update glossary entry", response);
  return data.entry as GlossaryEntry;
}

export async function adminDeleteGlossaryEntry(
  glossaryId: number,
  entryId: number
): Promise<void> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}/entries/${entryId}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  await requireOk("delete glossary entry", response);
}

export async function adminUploadGlossaryCsv(params: {
  file: File;
  label: string;
}): Promise<{ ok: true; glossaryId: number; entryCount: number }> {
  const fd = new FormData();
  fd.append("file", params.file);
  fd.append("label", params.label);
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/upload`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  return parseJsonResponse<{ ok: true; glossaryId: number; entryCount: number }>("upload glossary", response);
}

export async function adminStartGlossaryImport(payload: {
  importType: "csv" | "xlsx" | "tbx" | "mtf_xml" | "xml" | "empty";
  label?: string;
  description?: string;
  languages?: string[];
  visibility?: string;
  settings?: GlossaryImportSettings;
}): Promise<{ importId: number; requestId?: string }> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/import/start`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{ importId: number; requestId?: string }>("start glossary import", response);
}

export async function adminParseGlossaryImport(params: {
  importId: number;
  file?: File | null;
  images?: File[];
  mapping?: GlossaryImportMapping;
  languages?: string[];
  strictImages?: boolean;
  settings?: GlossaryImportSettings;
}): Promise<GlossaryImportParseResult> {
  const fd = new FormData();
  fd.append("importId", String(params.importId));
  if (params.file) fd.append("file", params.file);
  if (params.mapping) fd.append("mapping", JSON.stringify(params.mapping));
  if (params.languages && params.languages.length > 0) fd.append("languages", JSON.stringify(params.languages));
  if (params.strictImages) fd.append("strictImages", "true");
  if (params.settings) fd.append("settings", JSON.stringify(params.settings));
  if (params.images && params.images.length > 0) {
    params.images.forEach((img) => fd.append("images", img));
  }
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/import/parse`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  return parseJsonResponse<GlossaryImportParseResult>("parse glossary import", response);
}

export async function adminCommitGlossaryImport(payload: {
  importId: number;
  label: string;
  description?: string;
  languages?: string[];
  visibility?: string;
  mapping?: GlossaryImportMapping;
  duplicateStrategy?: "skip" | "fail";
  strictImages?: boolean;
  settings?: GlossaryImportSettings;
}): Promise<{ glossaryId: number; entryCount: number; report?: GlossaryImportReport }> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/import/commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{ glossaryId: number; entryCount: number; report?: GlossaryImportReport }>(
    "commit glossary import",
    response
  );
}

export async function startTermbaseImport(payload: {
  importType: "csv" | "xlsx" | "tbx" | "mtf_xml" | "xml";
  languages?: string[];
  settings?: GlossaryImportSettings;
}): Promise<{ importId: number; requestId?: string }> {
  return adminStartGlossaryImport(payload);
}

export async function parseTermbaseImport(params: {
  importId: number;
  file?: File | null;
  images?: File[];
  mapping?: GlossaryImportMapping;
  languages?: string[];
  strictImages?: boolean;
  settings?: GlossaryImportSettings;
}): Promise<GlossaryImportParseResult> {
  return adminParseGlossaryImport(params);
}

export async function commitTermbaseImport(
  termbaseId: number,
  payload: {
    importId: number;
    mapping?: GlossaryImportMapping;
    duplicateStrategy?: "skip" | "merge" | "overwrite";
    strictImages?: boolean;
    settings?: GlossaryImportSettings;
    languages?: string[];
  }
): Promise<{
  glossaryId: number;
  entryCount: number;
  updatedCount?: number;
  skippedCount?: number;
  report?: GlossaryImportReport;
}> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${termbaseId}/import/commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{
    glossaryId: number;
    entryCount: number;
    updatedCount?: number;
    skippedCount?: number;
    report?: GlossaryImportReport;
  }>("commit termbase import", response);
}

export async function adminUpdateGlossary(
  glossaryId: number,
  updates: { disabled?: boolean; label?: string }
): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update glossary", r);
}

export async function adminDeleteGlossary(glossaryId: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete glossary", r);
}

export async function adminExportGlossary(
  glossaryId: number
): Promise<Blob> {
  const response = await fetch(`${CAT_API_BASE}/admin/glossaries/${glossaryId}/export`, {
    headers: { ...authHeaders() }
  });
  return parseBlobResponse("export glossary", response);
}

export async function createTermbase(payload: {
  name: string;
  description?: string;
  languages: string[];
  defaultSourceLang?: string | null;
  defaultTargetLang?: string | null;
  structure?: TermbaseStructure;
  template?: "basic" | "advanced";
  visibility?: string;
  allowSingleLanguage?: boolean;
}): Promise<TermbaseMeta> {
  const response = await fetch(`${CAT_API_BASE}/termbases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  const data = await parseJsonResponse<{ termbase: TermbaseMeta }>("create termbase", response);
  return data.termbase as TermbaseMeta;
}

export async function getTermbase(glossaryId: number): Promise<TermbaseMeta> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ termbase: TermbaseMeta }>("termbase metadata", response);
  return data.termbase as TermbaseMeta;
}

export async function getTermbaseStructure(glossaryId: number): Promise<TermbaseStructure> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/structure`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ structure: TermbaseStructure }>("termbase structure", response);
  return data.structure as TermbaseStructure;
}

  export async function listTermbaseEntries(
    glossaryId: number,
    params: {
      query?: string;
      sourceLang?: string;
      targetLang?: string;
      displayLang?: string;
      createdFrom?: string;
      createdTo?: string;
      updatedFrom?: string;
      updatedTo?: string;
      author?: string;
      hasIllustration?: boolean;
      page?: number;
      pageSize?: number;
    }
  ): Promise<TermbaseEntryListResponse> {
  const qs = new URLSearchParams();
  if (params.query) qs.set("query", params.query);
  if (params.sourceLang) qs.set("sourceLang", params.sourceLang);
  if (params.targetLang) qs.set("targetLang", params.targetLang);
  if (params.displayLang) qs.set("displayLang", params.displayLang);
    if (params.createdFrom) qs.set("createdFrom", params.createdFrom);
    if (params.createdTo) qs.set("createdTo", params.createdTo);
    if (params.updatedFrom) qs.set("updatedFrom", params.updatedFrom);
    if (params.updatedTo) qs.set("updatedTo", params.updatedTo);
    if (params.author) qs.set("author", params.author);
    if (params.hasIllustration) qs.set("hasIllustration", "true");
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries${qs.toString() ? `?${qs}` : ""}`, {
    headers: { ...authHeaders() }
  });
  return parseJsonResponse<TermbaseEntryListResponse>("termbase entries", response);
}

export async function getTermbaseEntry(
  glossaryId: number,
  entryId: string
): Promise<TermbaseEntryDetail> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries/${encodeURIComponent(entryId)}`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ entry: TermbaseEntryDetail }>("termbase entry", response);
  return data.entry as TermbaseEntryDetail;
}

export async function updateTermbaseEntry(
  glossaryId: number,
  entryId: string,
  payload: {
    entryFields?: TermbaseCustomFields | null;
    languageFields?: Record<string, TermbaseCustomFields | null> | null;
    languages?: Array<{
      lang: string;
      languageFields?: TermbaseCustomFields | null;
      terms?: Array<{
        termId: string;
        text?: string;
        status?: "preferred" | "forbidden" | "allowed";
        notes?: string | null;
        partOfSpeech?: string | null;
        customFields?: TermbaseCustomFields | null;
        updatedAt?: string | null;
      }>;
    }>;
  }
): Promise<{ entry: TermbaseEntryDetail }> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{ entry: TermbaseEntryDetail }>("update termbase entry", response);
}

export async function createTermbaseEntry(
  glossaryId: number,
  payload: {
    sourceLang?: string;
    targetLang?: string;
    sourceTerm?: string;
    targetTerm?: string;
    notes?: string | null;
    status?: string;
    partOfSpeech?: string | null;
  }
): Promise<{ entryId: string; updatedAt: string | null }> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  const data = await parseJsonResponse<{ entry: { entryId: string; updatedAt: string | null } }>(
    "create termbase entry",
    response
  );
  return data.entry as { entryId: string; updatedAt: string | null };
}

export async function deleteTermbaseEntry(glossaryId: number, entryId: string): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete termbase entry", r);
}

export async function addTermbaseLanguage(
  glossaryId: number,
  entryId: string,
  language: string
): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries/${encodeURIComponent(entryId)}/languages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ language })
  });
  if (!r.ok) throw await httpError("add termbase language", r);
}

export async function deleteTermbaseLanguage(
  glossaryId: number,
  entryId: string,
  language: string
): Promise<void> {
  const r = await fetch(
    `${CAT_API_BASE}/termbases/${glossaryId}/entries/${encodeURIComponent(entryId)}/languages/${encodeURIComponent(language)}`,
    {
      method: "DELETE",
      headers: { ...authHeaders() }
    }
  );
  if (!r.ok) throw await httpError("delete termbase language", r);
}

export async function addTermbaseTerm(
  glossaryId: number,
  entryId: string,
  payload: {
    language: string;
    text: string;
    status?: "preferred" | "forbidden" | "allowed";
    notes?: string | null;
    partOfSpeech?: string | null;
    customFields?: TermbaseCustomFields | null;
  }
): Promise<{ terms: TermbaseTerm[] }> {
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/entries/${encodeURIComponent(entryId)}/terms`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{ terms: TermbaseTerm[] }>("add termbase term", response);
}

export async function updateTermbaseTerm(
  termId: string,
  payload: {
    text?: string;
    status?: "preferred" | "forbidden" | "allowed";
    notes?: string | null;
    partOfSpeech?: string | null;
    customFields?: TermbaseCustomFields | null;
    updatedAt?: string | null;
  }
): Promise<{ term: TermbaseTerm }> {
  const response = await fetch(`${CAT_API_BASE}/terms/${encodeURIComponent(termId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{ term: TermbaseTerm }>("update term", response);
}

export async function deleteTermbaseTerm(termId: string): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/terms/${encodeURIComponent(termId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete term", r);
}

export async function exportTermbase(glossaryId: number, format: "csv" | "tbx" = "csv"): Promise<Blob> {
  const qs = new URLSearchParams({ format });
  const response = await fetch(`${CAT_API_BASE}/termbases/${glossaryId}/export?${qs.toString()}`, {
    headers: { ...authHeaders() }
  });
  return parseBlobResponse("export termbase", response);
}

export async function fetchTmLibrary(): Promise<TmLibraryEntry[]> {
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ entries?: TmLibraryEntry[] }>("tm library", response);
  return data.entries || [];
}

export async function getTmLibraryEntry(id: number): Promise<TmLibraryEntry> {
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library/${id}`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ entry: TmLibraryEntry }>("tm entry", response);
  return data.entry as TmLibraryEntry;
}

export async function checkTmLibraryName(name: string, opts?: { excludeId?: number }): Promise<boolean> {
  const params = new URLSearchParams();
  if (name.trim()) params.set("name", name.trim());
  if (opts?.excludeId != null && Number.isFinite(opts.excludeId)) {
    params.set("excludeId", String(opts.excludeId));
  }
  const response = await fetch(
    `${CAT_API_BASE}/admin/tm-library/check-name${params.toString() ? `?${params.toString()}` : ""}`,
    {
      headers: { ...authHeaders() }
    }
  );
  const data = await parseJsonResponse<{ exists?: boolean }>("tm name check", response);
  return Boolean(data?.exists);
}

export async function deleteTmLibraryEntry(id: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/admin/tm-library/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete tm", r);
}

export async function downloadTmLibraryEntry(id: number): Promise<Blob> {
  const response = await fetch(
    `${CAT_API_BASE}/admin/tm-library/download/${id}`,
    { headers: { ...authHeaders() } }
  );
  return parseBlobResponse("download tm", response);
}

export async function fetchTmLibraryVersions(entryId: number): Promise<TmLibraryVersion[]> {
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library/${entryId}/versions`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ versions?: TmLibraryVersion[] }>("tm versions", response);
  return data.versions || [];
}

export async function downloadTmLibraryVersion(versionId: number): Promise<Blob> {
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library/versions/${versionId}/download`, {
    headers: { ...authHeaders() }
  });
  return parseBlobResponse("download tm version", response);
}

export async function rescanTmLibrary(): Promise<TmLibraryEntry[]> {
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library/rescan`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ entries?: TmLibraryEntry[] }>("rescan tm", response);
  return data.entries || [];
}

export async function uploadTmLibraryTmx(params: {
  file: File;
  label?: string;
  comment?: string;
}): Promise<{ ok: true; entry: TmLibraryEntry | null; import: any }> {
  const fd = new FormData();
  fd.append("file", params.file);
  if (params.label) fd.append("label", params.label);
  if (params.comment) fd.append("comment", params.comment);
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library/upload`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  return parseJsonResponse<{ ok: true; entry: TmLibraryEntry | null; import: any }>("upload TMX", response);
}

export async function replaceTmLibraryTmx(
  entryId: number,
  params: { file: File; comment?: string }
): Promise<{ ok: true; entry: TmLibraryEntry | null; import: any }> {
  const fd = new FormData();
  fd.append("file", params.file);
  if (params.comment) fd.append("historyComment", params.comment);
  const response = await fetch(`${CAT_API_BASE}/admin/tm-library/${entryId}/replace`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  return parseJsonResponse<{ ok: true; entry: TmLibraryEntry | null; import: any }>("replace TMX", response);
}

export async function updateTmLibraryEntry(
  entryId: number,
  updates: { label?: string; disabled?: boolean; comment?: string; historyComment?: string }
): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/admin/tm-library/${entryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update TM library", r);
}



