import type { TermbaseAudit, TermbaseMatchEntry, TermbaseMatchTerm } from "../api";

export type GlossaryHighlightMatch = {
  term: string;
  entries: TermbaseMatchEntry[];
};

export type GlossaryCardEntry = TermbaseMatchEntry & {
  matchedSourceTerms: string[];
};

function normalizeFieldLabel(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeFieldKey(value: string) {
  return normalizeFieldLabel(value).replace(/[^a-z0-9]/g, "");
}

export function toDisplayText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => toDisplayText(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    if ("value" in value) return toDisplayText((value as any).value);
    if ("label" in value) return toDisplayText((value as any).label);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function getFieldValue(
  fields: Record<string, any> | null | undefined,
  names: string[]
): string | null {
  if (!fields) return null;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      const text = toDisplayText(fields[name]);
      if (text) return text;
    }
  }
  const normalizedMap = new Map<string, string>();
  Object.keys(fields).forEach((key) => {
    const normalized = normalizeFieldKey(key);
    if (!normalized || normalizedMap.has(normalized)) return;
    normalizedMap.set(normalized, key);
  });
  for (const name of names) {
    const normalized = normalizeFieldKey(name);
    const key = normalizedMap.get(normalized);
    if (!key) continue;
    const text = toDisplayText(fields[key]);
    if (text) return text;
  }
  return null;
}

export function pickPreferredTerm(terms: TermbaseMatchTerm[] | null | undefined): TermbaseMatchTerm | null {
  if (!terms || terms.length === 0) return null;
  const preferred = terms.find((term) => term.status === "preferred");
  return preferred ?? terms[0] ?? null;
}

export function statusLabel(status: TermbaseMatchTerm["status"]): { label: string; tone: string } {
  if (status === "preferred") return { label: "Preferred", tone: "success" };
  if (status === "forbidden") return { label: "Forbidden", tone: "danger" };
  return { label: "Deprecated", tone: "secondary" };
}

export function resolveAuditLabel(audit?: TermbaseAudit | null): string | null {
  if (!audit) return null;
  const createdParts = [audit.createdAt, audit.createdBy].filter(Boolean).join(" · ");
  const modifiedParts = [audit.modifiedAt, audit.modifiedBy].filter(Boolean).join(" · ");
  if (!createdParts && !modifiedParts) return null;
  const lines = [];
  if (createdParts) lines.push(`Created: ${createdParts}`);
  if (modifiedParts) lines.push(`Modified: ${modifiedParts}`);
  return lines.join("\n");
}

export function buildGlossaryTooltip(match: GlossaryHighlightMatch): string {
  const targetTerms: Array<{ text: string; status: TermbaseMatchTerm["status"] }> = [];
  let termNote: string | null = null;
  let entryNote: string | null = null;
  let category: string | null = null;
  let productType: string | null = null;
  let domain: string | null = null;
  let auditLabel: string | null = null;

  for (const entry of match.entries) {
    const sourceMatch =
      entry.source?.terms.find((term) => term.text.toLowerCase() === match.term.toLowerCase()) ?? null;
    const entryFields = entry.entry?.fields ?? null;
    if (!entryNote) {
      entryNote =
        getFieldValue(entryFields, ["Erlaeuterung", "Definition", "Note", "Notes"]) ?? null;
    }
    if (!category) {
      category = getFieldValue(entryFields, ["Kategorie", "Category", "Domain"]) ?? null;
    }
    if (!productType) {
      productType = getFieldValue(entryFields, ["Produkttyp", "Product type", "ProductType"]) ?? null;
    }
    if (!domain) {
      domain = getFieldValue(entryFields, ["Domain", "Kategorie", "Category"]) ?? null;
    }
    if (!termNote) {
      const termFields = sourceMatch?.fields ?? null;
      termNote =
        getFieldValue(termFields, ["Erlaeuterung", "Note", "Notes"]) ??
        (sourceMatch?.notes ? toDisplayText(sourceMatch.notes) : null);
    }
    if (!auditLabel) {
      auditLabel = resolveAuditLabel(sourceMatch?.audit ?? entry.entry?.audit ?? null);
    }
    entry.target?.terms.forEach((term) => {
      if (!term?.text) return;
      targetTerms.push({ text: term.text, status: term.status });
    });
  }

  const uniqueTargets = new Map<string, TermbaseMatchTerm["status"]>();
  targetTerms.forEach((term) => {
    const key = term.text;
    if (!key) return;
    if (!uniqueTargets.has(key)) {
      uniqueTargets.set(key, term.status);
    } else {
      const existing = uniqueTargets.get(key);
      if (existing === "allowed" && term.status !== "allowed") {
        uniqueTargets.set(key, term.status);
      }
    }
  });

  const targetLines = Array.from(uniqueTargets.entries()).map(([text, status]) => {
    const label = statusLabel(status).label;
    return `${text} (${label})`;
  });

  const lines: string[] = [];
  if (targetLines.length > 0) lines.push(`Target: ${targetLines.join(", ")}`);
  if (termNote) lines.push(`Term note: ${termNote}`);
  if (entryNote) lines.push(`Entry note: ${entryNote}`);
  if (category) lines.push(`Kategorie: ${category}`);
  if (domain && !category) lines.push(`Domain: ${domain}`);
  if (productType) lines.push(`Produkttyp: ${productType}`);
  if (auditLabel) lines.push(auditLabel);
  return lines.join("\n");
}
