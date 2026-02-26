export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter((item) => item.length > 0)
      .join(" | ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return toText(record.value);
    if ("label" in record) return toText(record.label);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function toIsoOrNull(value: unknown): string | null {
  const text = toText(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function xmlEscape(text: unknown): string {
  const raw = toText(text);
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function humanizeSampleLabel(filename: string) {
  const base = filename.replace(/\.[^/.]+$/, ""); // remove extension
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (s) => s.toUpperCase());
}

// Naive segmentation for plain text
export function segmentPlainText(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
