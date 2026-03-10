import {
  CAT_API_BASE,
  authHeaders,
  httpError,
  type GlobalGlossaryEntry,
  type TermbaseConcordanceEntry,
  type TermbaseMatchEntry
} from "./shared";

export async function fetchProjectGlossary(projectId: number): Promise<GlobalGlossaryEntry[]> {
  const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/glossary`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw new Error(`glossary ${response.status}`);
  const data = await response.json();
  if (Array.isArray(data)) return data as GlobalGlossaryEntry[];
  return data.entries || [];
}

export type ProjectTermbaseEntriesResponse = {
  entries: TermbaseMatchEntry[];
  termbaseId: number | null;
};

export async function fetchProjectTermbaseEntries(params: {
  projectId: number;
  taskId?: number;
}): Promise<ProjectTermbaseEntriesResponse> {
  const query = new URLSearchParams();
  if (params.taskId != null && Number.isFinite(Number(params.taskId))) {
    query.set("taskId", String(params.taskId));
  }
  const response = await fetch(
    `${CAT_API_BASE}/projects/${params.projectId}/termbase/entries${query.toString() ? `?${query.toString()}` : ""}`,
    { headers: { ...authHeaders() } }
  );
  if (!response.ok) throw await httpError("termbase entries", response);
  const data = await response.json();
  if (Array.isArray(data)) {
    return { entries: data as TermbaseMatchEntry[], termbaseId: null };
  }
  return {
    entries: data.entries || [],
    termbaseId: data.termbaseId ?? data.glossaryId ?? null
  };
}

export async function fetchTermbaseConcordance(params: {
  termbaseId: number;
  q: string;
  sourceLang: string;
  targetLang: string;
  mode?: "auto" | "search";
  limit?: number;
  searchSource?: boolean;
  searchTarget?: boolean;
  includeDeprecated?: boolean;
  includeForbidden?: boolean;
  category?: string;
  signal?: AbortSignal;
}): Promise<TermbaseConcordanceEntry[]> {
  const query = new URLSearchParams();
  if (params.q.trim()) query.set("q", params.q.trim());
  if (params.sourceLang) query.set("sourceLang", params.sourceLang);
  if (params.targetLang) query.set("targetLang", params.targetLang);
  if (params.mode) query.set("mode", params.mode);
  if (params.limit != null && Number.isFinite(Number(params.limit))) {
    query.set("limit", String(params.limit));
  }
  if (params.searchSource != null) query.set("searchSource", params.searchSource ? "true" : "false");
  if (params.searchTarget != null) query.set("searchTarget", params.searchTarget ? "true" : "false");
  if (params.includeDeprecated != null) {
    query.set("includeDeprecated", params.includeDeprecated ? "true" : "false");
  }
  if (params.includeForbidden != null) {
    query.set("includeForbidden", params.includeForbidden ? "true" : "false");
  }
  if (params.category) query.set("category", params.category);

  const response = await fetch(
    `${CAT_API_BASE}/termbases/${params.termbaseId}/concordance${query.toString() ? `?${query.toString()}` : ""}`,
    { headers: { ...authHeaders() }, signal: params.signal }
  );
  if (!response.ok) throw await httpError("termbase concordance", response);
  const data = await response.json();
  return data.entries || [];
}

export type TermbaseLookupFilters = {
  includeDeprecated?: boolean;
  includeForbidden?: boolean;
  category?: string;
  searchSource?: boolean;
  searchTarget?: boolean;
  limit?: number;
  signal?: AbortSignal;
};

export async function getTermbaseSuggestions(params: {
  termbaseId: number;
  segmentId?: number;
  sourceText: string;
  srcLang: string;
  tgtLang: string;
  filters?: TermbaseLookupFilters;
}): Promise<TermbaseConcordanceEntry[]> {
  return fetchTermbaseConcordance({
    termbaseId: params.termbaseId,
    q: params.sourceText,
    sourceLang: params.srcLang,
    targetLang: params.tgtLang,
    mode: "auto",
    limit: params.filters?.limit ?? 12,
    searchSource: params.filters?.searchSource ?? true,
    searchTarget: params.filters?.searchTarget ?? false,
    includeDeprecated: params.filters?.includeDeprecated,
    includeForbidden: params.filters?.includeForbidden,
    category: params.filters?.category,
    signal: params.filters?.signal
  });
}

export async function searchTermbaseConcordance(params: {
  termbaseId: number;
  query: string;
  searchIn?: "source" | "target";
  srcLang: string;
  tgtLang: string;
  filters?: Omit<TermbaseLookupFilters, "searchSource" | "searchTarget">;
}): Promise<TermbaseConcordanceEntry[]> {
  const searchIn = params.searchIn ?? "source";
  return fetchTermbaseConcordance({
    termbaseId: params.termbaseId,
    q: params.query,
    sourceLang: params.srcLang,
    targetLang: params.tgtLang,
    mode: "search",
    limit: params.filters?.limit ?? 12,
    searchSource: searchIn === "source",
    searchTarget: searchIn === "target",
    includeDeprecated: params.filters?.includeDeprecated,
    includeForbidden: params.filters?.includeForbidden,
    category: params.filters?.category,
    signal: params.filters?.signal
  });
}

export async function searchProjectGlossary(params: {
  projectId: number;
  q: string;
}): Promise<GlobalGlossaryEntry[]> {
  const query = new URLSearchParams();
  if (params.q.trim()) query.set("q", params.q.trim());
  const response = await fetch(`${CAT_API_BASE}/projects/${params.projectId}/glossary/search?${query.toString()}`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw new Error(`glossary search ${response.status}`);
  const data = await response.json();
  return data.entries || [];
}

export async function getProjectAnalytics(projectId: number, opts?: { fileId?: number }) {
  const query = new URLSearchParams();
  if (opts?.fileId != null && Number.isFinite(Number(opts.fileId))) {
    query.set("fileId", String(opts.fileId));
  }
  const response = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/analytics${query.toString() ? `?${query.toString()}` : ""}`,
    { headers: { ...authHeaders() } }
  );
  if (!response.ok) throw new Error(`analytics ${response.status}`);
  return response.json();
}
