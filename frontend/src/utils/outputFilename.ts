import { canonicalizeLanguageTag } from "./languages";

export function buildTargetOutputFilename(originalName: string, targetLang: string) {
  const safeName = String(originalName || "").trim() || "file";
  const dotIndex = safeName.lastIndexOf(".");
  const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  const normalizedLang = canonicalizeLanguageTag(String(targetLang || "").trim());
  const suffix = normalizedLang ? ` (${normalizedLang})` : "";
  return `${base}${suffix}${ext}`;
}
