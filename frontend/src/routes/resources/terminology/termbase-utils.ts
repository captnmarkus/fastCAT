import type { TermbaseEntryDetail } from "../../../api";

function compareIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
    return a >= b ? a : b;
  }
  return aTime >= bTime ? a : b;
}

export function computeHeaderModifiedAt(entry: TermbaseEntryDetail | null): string | null {
  if (!entry) return null;
  let latest: string | null = entry.audit?.modifiedAt ?? null;

  for (const section of entry.languages ?? []) {
    for (const term of section.terms ?? []) {
      const candidate = term.audit?.modifiedAt ?? term.updatedAt ?? null;
      latest = compareIso(latest, candidate);
    }
  }

  return latest;
}
