import { normalizeLocale } from "../../../lib/i18n/locale";
import { getFlagIcon } from "../../../utils/languages";

export function langToFlag(code: string): string | null {
  const normalized = normalizeLocale(code).canonical;
  if (!normalized) return null;
  return getFlagIcon(normalized);
}
