export function parseDateStart(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function parseDateEnd(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T23:59:59.999`);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function formatDateTimeShort(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}


export function formatRelativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

  if (absMs < 60 * 1000) {
    return rtf.format(Math.round(diffMs / 1000), "second");
  }
  if (absMs < 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (60 * 1000)), "minute");
  }
  if (absMs < 24 * 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (60 * 60 * 1000)), "hour");
  }
  if (absMs < 7 * 24 * 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (24 * 60 * 60 * 1000)), "day");
  }
  if (absMs < 30 * 24 * 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)), "week");
  }
  if (absMs < 365 * 24 * 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (30 * 24 * 60 * 60 * 1000)), "month");
  }
  return rtf.format(Math.round(diffMs / (365 * 24 * 60 * 60 * 1000)), "year");
}
