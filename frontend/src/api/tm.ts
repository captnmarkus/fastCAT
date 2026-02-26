import { authHeaders, type Match, tmUrl } from "./core";

export type TmConcordanceMode = "source" | "target" | "both";

export type TmConcordanceEntry = Match & {
  origin?: string | null;
  penalties?: string[];
};

// ---------- TM (existing tm-proxy) ----------

function normalizeTmLangTag(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/_/g, "-").toLowerCase();
  const primary = cleaned.split("-")[0] || cleaned;
  return primary;
}

export async function searchTM(
  sourceLang: string,
  targetLang: string,
  text: string,
  limit = 5,
  tmId?: number
): Promise<Match[]> {
  const normalizedSource = normalizeTmLangTag(sourceLang) || String(sourceLang);
  const normalizedTarget = normalizeTmLangTag(targetLang) || String(targetLang);
  const r = await fetch(tmUrl(tmId, "/search"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ sourceLang: normalizedSource, targetLang: normalizedTarget, text, limit })
  });
  if (!r.ok) throw new Error(`search ${r.status}`);
  const data = await r.json();
  return data.matches || [];
}

export async function searchTMConcordance(params: {
  sourceLang: string;
  targetLang: string;
  q: string;
  mode?: TmConcordanceMode;
  limit?: number;
  tmId?: number;
}): Promise<TmConcordanceEntry[]> {
  const normalizedSource = normalizeTmLangTag(params.sourceLang) || String(params.sourceLang);
  const normalizedTarget = normalizeTmLangTag(params.targetLang) || String(params.targetLang);
  const qs = new URLSearchParams();
  qs.set("sourceLang", normalizedSource);
  qs.set("targetLang", normalizedTarget);
  qs.set("q", String(params.q || "").trim());
  if (params.mode) qs.set("mode", params.mode);
  if (params.limit != null && Number.isFinite(Number(params.limit))) {
    qs.set("limit", String(params.limit));
  }
  const r = await fetch(`${tmUrl(params.tmId, "/concordance")}?${qs.toString()}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`tm concordance ${r.status}`);
  const data = await r.json();
  return Array.isArray(data?.entries) ? (data.entries as TmConcordanceEntry[]) : [];
}

export async function commitTM(
  payload: {
    sourceLang: string;
    targetLang: string;
    source: string;
    target: string;
  },
  opts?: { tmId?: number; mirrorFile?: string }
) {
  const normalizedPayload = {
    ...payload,
    sourceLang: normalizeTmLangTag(payload.sourceLang) || payload.sourceLang,
    targetLang: normalizeTmLangTag(payload.targetLang) || payload.targetLang
  };
  const r = await fetch(tmUrl(opts?.tmId, "/commit"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({
      ...normalizedPayload,
      mirrorFile: opts?.mirrorFile ?? (payload as any).mirrorFile
    })
  });
  if (!r.ok) throw new Error(`commit ${r.status}`);
  return r.json();
}

export async function checkTmDuplicate(params: {
  sourceLang: string;
  targetLang: string;
  source: string;
  target: string;
  tmId?: number;
}): Promise<boolean> {
  const normalizedSource = normalizeTmLangTag(params.sourceLang) || params.sourceLang;
  const normalizedTarget = normalizeTmLangTag(params.targetLang) || params.targetLang;
  const r = await fetch(tmUrl(params.tmId, "/check-duplicate"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      sourceLang: normalizedSource,
      targetLang: normalizedTarget,
      source: params.source,
      target: params.target
    })
  });
  if (!r.ok) throw new Error(`duplicate check ${r.status}`);
  const data = await r.json();
  return Boolean(data.exists);
}

export async function importTMX(file: File, tmId?: number) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(tmUrl(tmId, "/import"), {
    method: "POST",
    headers: {
      ...authHeaders()
    },
    body: fd
  });
  if (!r.ok) throw new Error(`import ${r.status}`);
  return r.json();
}
