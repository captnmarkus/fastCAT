export type NormalizedLocale = {
  inputRaw: string;
  language: string;
  region?: string;
  canonical: string;
  flagTag?: string;
};

const DEFAULT_REGION_BY_LANGUAGE: Record<string, string> = {
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
  pl: "PL",
  sv: "SE",
  da: "DK",
  fi: "FI",
  no: "NO",
  is: "IS",
  cs: "CZ",
  sk: "SK",
  sl: "SI",
  hr: "HR",
  hu: "HU",
  ro: "RO",
  bg: "BG",
  el: "GR",
  et: "EE",
  lv: "LV",
  lt: "LT",
  mt: "MT",
  ga: "IE",
  uk: "UA",
  tr: "TR",
  sq: "AL",
  mk: "MK",
  sr: "RS",
  bs: "BA",
  en: "GB",
  zh: "CN"
};

function cleanLocaleInput(input: string): string {
  return input
    .trim()
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeLocale(input: string): NormalizedLocale {
  const inputRaw = String(input ?? "");
  const cleaned = cleanLocaleInput(inputRaw);
  if (!cleaned) {
    return { inputRaw, language: "", canonical: "" };
  }

  const cleanedLower = cleaned.toLowerCase();
  const aliasKey = cleanedLower.replace(/[^a-z]/g, "");
  if (cleanedLower === "sh" || aliasKey === "serbocroatian") {
    return {
      inputRaw,
      language: "sr",
      region: "RS",
      canonical: "sr-RS",
      flagTag: "RS"
    };
  }

  const parts = cleaned.split("-").filter(Boolean);
  const language = (parts[0] || "").toLowerCase();
  let region: string | undefined;

  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\d{3}$/.test(part) || part.length === 2) {
      region = part.toUpperCase();
      break;
    }
  }

  if (!region) {
    const fallback = DEFAULT_REGION_BY_LANGUAGE[language];
    if (fallback) region = fallback;
  }

  const canonical = language ? (region ? `${language}-${region}` : language) : "";
  return {
    inputRaw,
    language,
    region,
    canonical,
    flagTag: region
  };
}
