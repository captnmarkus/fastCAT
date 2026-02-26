export type LanguageCatalogEntry = {
  tag: string;
  englishName: string;
  nativeName: string;
  defaultRegionForFlag: string;
  aliases?: string[];
};

export const LANGUAGE_CATALOG: LanguageCatalogEntry[] = [
  { tag: "de", englishName: "German", nativeName: "Deutsch", defaultRegionForFlag: "DE", aliases: ["ger", "german"] },
  { tag: "de-DE", englishName: "German (Germany)", nativeName: "Deutsch (Deutschland)", defaultRegionForFlag: "DE" },
  { tag: "de-AT", englishName: "German (Austria)", nativeName: "Deutsch (Osterreich)", defaultRegionForFlag: "AT" },
  { tag: "de-CH", englishName: "German (Switzerland)", nativeName: "Deutsch (Schweiz)", defaultRegionForFlag: "CH" },
  { tag: "en", englishName: "English", nativeName: "English", defaultRegionForFlag: "GB", aliases: ["eng", "english"] },
  { tag: "en-GB", englishName: "English (UK)", nativeName: "English (UK)", defaultRegionForFlag: "GB" },
  { tag: "en-US", englishName: "English (US)", nativeName: "English (US)", defaultRegionForFlag: "US" },
  { tag: "fr", englishName: "French", nativeName: "Francais", defaultRegionForFlag: "FR", aliases: ["fre", "french"] },
  { tag: "fr-CA", englishName: "French (Canada)", nativeName: "Francais (Canada)", defaultRegionForFlag: "CA" },
  { tag: "es", englishName: "Spanish", nativeName: "Espanol", defaultRegionForFlag: "ES", aliases: ["spa", "spanish"] },
  { tag: "es-ES", englishName: "Spanish (Spain)", nativeName: "Espanol (Espana)", defaultRegionForFlag: "ES" },
  { tag: "it", englishName: "Italian", nativeName: "Italiano", defaultRegionForFlag: "IT", aliases: ["ita", "italian"] },
  { tag: "nl", englishName: "Dutch", nativeName: "Nederlands", defaultRegionForFlag: "NL", aliases: ["dut", "dutch"] },
  { tag: "pt", englishName: "Portuguese", nativeName: "Portugues", defaultRegionForFlag: "PT", aliases: ["por", "portuguese"] },
  { tag: "pt-PT", englishName: "Portuguese (Portugal)", nativeName: "Portugues (Portugal)", defaultRegionForFlag: "PT" },
  { tag: "pt-BR", englishName: "Portuguese (Brazil)", nativeName: "Portugues (Brasil)", defaultRegionForFlag: "BR" },
  { tag: "sv", englishName: "Swedish", nativeName: "Svenska", defaultRegionForFlag: "SE", aliases: ["swe", "swedish"] },
  { tag: "no", englishName: "Norwegian", nativeName: "Norsk", defaultRegionForFlag: "NO", aliases: ["nor", "norwegian", "nb", "nn"] },
  { tag: "da", englishName: "Danish", nativeName: "Dansk", defaultRegionForFlag: "DK", aliases: ["dan", "danish"] },
  { tag: "fi", englishName: "Finnish", nativeName: "Suomi", defaultRegionForFlag: "FI", aliases: ["fin", "finnish"] },
  { tag: "pl", englishName: "Polish", nativeName: "Polski", defaultRegionForFlag: "PL", aliases: ["pol", "polish"] },
  { tag: "cs", englishName: "Czech", nativeName: "Cestina", defaultRegionForFlag: "CZ", aliases: ["cze", "czech"] },
  { tag: "sk", englishName: "Slovak", nativeName: "Slovencina", defaultRegionForFlag: "SK", aliases: ["slo", "slovak"] },
  { tag: "sl", englishName: "Slovenian", nativeName: "Slovenscina", defaultRegionForFlag: "SI", aliases: ["slv", "slovenian"] },
  { tag: "hu", englishName: "Hungarian", nativeName: "Magyar", defaultRegionForFlag: "HU", aliases: ["hun", "hungarian"] },
  { tag: "ro", englishName: "Romanian", nativeName: "Romana", defaultRegionForFlag: "RO", aliases: ["rum", "romanian"] },
  { tag: "bg", englishName: "Bulgarian", nativeName: "Bulgarski", defaultRegionForFlag: "BG", aliases: ["bul", "bulgarian"] },
  { tag: "el", englishName: "Greek", nativeName: "Ellinika", defaultRegionForFlag: "GR", aliases: ["greek"] },
  { tag: "ru", englishName: "Russian", nativeName: "Russkiy", defaultRegionForFlag: "RU", aliases: ["rus", "russian"] },
  { tag: "uk", englishName: "Ukrainian", nativeName: "Ukrainska", defaultRegionForFlag: "UA", aliases: ["ukr", "ukrainian"] },
  { tag: "hr", englishName: "Croatian", nativeName: "Hrvatski", defaultRegionForFlag: "HR", aliases: ["croatian"] },
  { tag: "hr-HR", englishName: "Croatian (Croatia)", nativeName: "Hrvatski (Hrvatska)", defaultRegionForFlag: "HR" },
  { tag: "sh", englishName: "Serbo-Croatian", nativeName: "Srpskohrvatski", defaultRegionForFlag: "RS", aliases: ["serbo-croatian", "serbo croatian", "serbocroatian"] },
  { tag: "sr", englishName: "Serbian", nativeName: "Srpski", defaultRegionForFlag: "RS", aliases: ["serbian"] },
  { tag: "sr-RS", englishName: "Serbian (Serbia)", nativeName: "Srpski (Srbija)", defaultRegionForFlag: "RS", aliases: ["serbo-croatian", "serbo croatian", "serbocroatian", "sh"] },
  { tag: "sr-Latn", englishName: "Serbian (Latin)", nativeName: "Srpski (Latinica)", defaultRegionForFlag: "RS" },
  { tag: "bs", englishName: "Bosnian", nativeName: "Bosanski", defaultRegionForFlag: "BA", aliases: ["bosnian"] },
  { tag: "bs-BA", englishName: "Bosnian (Bosnia)", nativeName: "Bosanski (Bosna i Hercegovina)", defaultRegionForFlag: "BA" },
  { tag: "et", englishName: "Estonian", nativeName: "Eesti", defaultRegionForFlag: "EE", aliases: ["est", "estonian"] },
  { tag: "lv", englishName: "Latvian", nativeName: "Latviesu", defaultRegionForFlag: "LV", aliases: ["lav", "latvian"] },
  { tag: "lt", englishName: "Lithuanian", nativeName: "Lietuviu", defaultRegionForFlag: "LT", aliases: ["lit", "lithuanian"] },
  { tag: "ga", englishName: "Irish", nativeName: "Gaeilge", defaultRegionForFlag: "IE", aliases: ["irish"] },
  { tag: "is", englishName: "Icelandic", nativeName: "Islenska", defaultRegionForFlag: "IS", aliases: ["ice", "icelandic"] },
  { tag: "mt", englishName: "Maltese", nativeName: "Malti", defaultRegionForFlag: "MT", aliases: ["maltese"] },
  { tag: "sq", englishName: "Albanian", nativeName: "Shqip", defaultRegionForFlag: "AL", aliases: ["alb", "albanian"] },
  { tag: "mk", englishName: "Macedonian", nativeName: "Makedonski", defaultRegionForFlag: "MK", aliases: ["macedonian"] },
  { tag: "tr", englishName: "Turkish", nativeName: "Turkce", defaultRegionForFlag: "TR", aliases: ["tur", "turkish"] },
  { tag: "ja", englishName: "Japanese", nativeName: "Nihongo", defaultRegionForFlag: "JP", aliases: ["jpn", "japanese"] },
  { tag: "zh", englishName: "Chinese", nativeName: "Zhongwen", defaultRegionForFlag: "CN", aliases: ["chi", "chinese"] },
  { tag: "zh-CN", englishName: "Chinese (China)", nativeName: "Zhongwen (China)", defaultRegionForFlag: "CN" },
  { tag: "zh-TW", englishName: "Chinese (Taiwan)", nativeName: "Zhongwen (Taiwan)", defaultRegionForFlag: "TW" },
  { tag: "ko", englishName: "Korean", nativeName: "Hangugeo", defaultRegionForFlag: "KR", aliases: ["kor", "korean"] },
  { tag: "hi", englishName: "Hindi", nativeName: "Hindi", defaultRegionForFlag: "IN", aliases: ["hin"] },
  { tag: "bn", englishName: "Bengali", nativeName: "Bangla", defaultRegionForFlag: "BD", aliases: ["ben"] },
  { tag: "ta", englishName: "Tamil", nativeName: "Tamil", defaultRegionForFlag: "IN", aliases: ["tam"] },
  { tag: "mr", englishName: "Marathi", nativeName: "Marathi", defaultRegionForFlag: "IN", aliases: ["mar"] }
];

type AliasMap = Map<string, string>;

function buildAliasMap() {
  const aliasMap: AliasMap = new Map();
  for (const entry of LANGUAGE_CATALOG) {
    const tagLower = entry.tag.toLowerCase();
    aliasMap.set(tagLower, entry.tag);
    aliasMap.set(entry.englishName.toLowerCase(), entry.tag);
    aliasMap.set(entry.nativeName.toLowerCase(), entry.tag);
    (entry.aliases || []).forEach((alias) => aliasMap.set(alias.toLowerCase(), entry.tag));
  }
  return aliasMap;
}

const LANGUAGE_ALIAS_MAP = buildAliasMap();

export function canonicalizeLanguageTag(raw: string) {
  const cleaned = raw.replace(/_/g, "-").trim();
  if (!cleaned) return "";
  const cleanedLower = cleaned.toLowerCase();
  const aliasKey = cleanedLower.replace(/[^a-z]/g, "");
  if (cleanedLower === "sh" || aliasKey === "serbocroatian") {
    return "sr-RS";
  }
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      if (/^\d{3}$/.test(part) || part.length === 2) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

export function normalizeLanguageTag(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const rawLower = raw.toLowerCase();
  const aliasKey = rawLower.replace(/[^a-z]/g, "");
  if (rawLower === "sh" || aliasKey === "serbocroatian") {
    return "sr-RS";
  }
  const alias = LANGUAGE_ALIAS_MAP.get(rawLower);
  if (alias) return alias;
  return canonicalizeLanguageTag(raw);
}

export function normalizeLanguageTags(values: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const tag = normalizeLanguageTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

export function primarySubtag(tag: string) {
  const normalized = normalizeLanguageTag(tag);
  return normalized.split("-")[0] || "";
}

export function getCatalogByTag() {
  const map = new Map<string, LanguageCatalogEntry>();
  LANGUAGE_CATALOG.forEach((entry) => {
    map.set(entry.tag, entry);
  });
  return map;
}
