const CAT_API_BASE = String(process.env.CAT_API_URL || "http://cat-api:4000/api/cat")
  .replace(/\/+$/, "");

const SETUP_DEFAULT_LANGUAGES = [
  "de-DE",
  "en-GB",
  "fr-FR",
  "it-IT",
  "es-ES",
  "pt-PT",
  "nl-NL",
  "pl-PL",
  "sv-SE",
  "da-DK",
  "fi-FI",
  "no-NO",
  "is-IS",
  "cs-CZ",
  "sk-SK",
  "sl-SI",
  "hr-HR",
  "hu-HU",
  "ro-RO",
  "bg-BG",
  "el-GR",
  "et-EE",
  "lv-LV",
  "lt-LT",
  "ga-IE",
  "uk-UA",
  "tr-TR",
  "sq-AL",
  "mk-MK",
  "sr-RS",
  "bs-BA"
];
const SETUP_DEFAULT_SOURCE = "de-DE";
const SETUP_DEFAULT_TARGETS = ["en-GB"];
const SETUP_DEFAULT_DEPARTMENTS = ["General"];

type SetupDepartmentInput = {
  name: string;
  slug?: string;
};

function normalizeSetupDepartments(input: any): SetupDepartmentInput[] {
  const list = Array.isArray(input) ? input : [];
  const normalized: SetupDepartmentInput[] = [];
  list.forEach((entry) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) normalized.push({ name });
      return;
    }
    if (entry && typeof entry === "object") {
      const name = String((entry as any).name || "").trim();
      const slug = String((entry as any).slug || "").trim();
      if (name) normalized.push({ name, slug: slug || undefined });
    }
  });
  return normalized;
}

function normalizeSetupLanguages(input: any): string[] {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  raw.forEach((entry) => {
    const tag = String(entry || "").trim();
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(tag);
  });
  return normalized;
}

async function readErrorPayload(res: Response): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await res.json()) as any;
      if (payload && typeof payload.error === "string") return payload.error;
      return JSON.stringify(payload);
    }
    return (await res.text()).trim();
  } catch {
    return "";
  }
}

export async function applySetupDefaults(token: string, payload: any) {
  const languagesCandidate = normalizeSetupLanguages(payload?.languages);
  const languageTags =
    languagesCandidate.length > 0
      ? languagesCandidate
      : normalizeSetupLanguages(payload?.languageTags);
  const resolvedLanguages = languageTags.length > 0 ? languageTags : SETUP_DEFAULT_LANGUAGES;
  const defaultsInput =
    payload?.defaults && typeof payload.defaults === "object" ? payload.defaults : {};
  const defaultSource = String(
    defaultsInput.defaultSource || payload?.defaultSource || SETUP_DEFAULT_SOURCE
  ).trim();
  const defaultTargetsRaw =
    Array.isArray(defaultsInput.defaultTargets) && defaultsInput.defaultTargets.length > 0
      ? defaultsInput.defaultTargets
      : Array.isArray(payload?.defaultTargets)
        ? payload.defaultTargets
        : SETUP_DEFAULT_TARGETS;
  const defaultTargets = normalizeSetupLanguages(defaultTargetsRaw).filter(
    (tag) => tag && tag !== defaultSource
  );

  const languageEntries = resolvedLanguages.map((tag) => ({
    canonical: tag,
    active: true,
    allowedAsSource: true,
    allowedAsTarget: true
  }));

  const departmentsInput = normalizeSetupDepartments(payload?.departments);
  const departments =
    departmentsInput.length > 0
      ? departmentsInput
      : SETUP_DEFAULT_DEPARTMENTS.map((name) => ({ name }));

  const headers = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`
  };

  for (const dept of departments) {
    const res = await fetch(`${CAT_API_BASE}/admin/departments`, {
      method: "POST",
      headers,
      body: JSON.stringify(dept)
    });
    if (res.ok) continue;
    if (res.status === 409) continue;
    const detail = await readErrorPayload(res);
    throw new Error(detail || "Failed to create department");
  }

  const langRes = await fetch(`${CAT_API_BASE}/admin/org/languages`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      languages: languageEntries,
      defaults: {
        defaultSource: defaultSource || undefined,
        defaultTargets
      },
      allowSingleLanguage: false
    })
  });
  if (!langRes.ok) {
    const detail = await readErrorPayload(langRes);
    throw new Error(detail || "Failed to update language settings");
  }
}
