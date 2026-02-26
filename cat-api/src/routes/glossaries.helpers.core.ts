import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { requireManagerOrAdmin, requireAuth, getRequestUser, requestUserId } from "../middleware/auth.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import { copyObject, getObjectBuffer, getS3Bucket, presignGetObject, putObjectBuffer, sha256Hex } from "../lib/s3.js";
import { keyTerminologyImage, keyTerminologyImportImage, keyTerminologyImportSource, keyTerminologyUpload } from "../lib/storage-keys.js";
import { insertAuditEvent } from "../lib/audit.js";
import { decodeGlossaryBuffer, parseGlossaryContent } from "../lib/glossary-utils.js";
import { canonicalizeLanguageTag, getCatalogByTag, normalizeLanguageTag, type LanguageCatalogEntry } from "../lib/language-catalog.js";
import {
  normalizeLanguageInput,
  normalizeLanguageListInput
} from "../lib/language-normalization.js";
import {
  mapXmlDescripsToCustomFields,
  normalizeFieldLabel
} from "../lib/termbase-import.js";
import {
  getOrgLanguageSettings,
  resolveLanguageMatch,
  type OrgLanguageSettings
} from "../lib/org-languages.js";
import { toIsoOrNull } from "../utils.js";
import crypto from "crypto";
import path from "path";
import AdmZip from "adm-zip";
import xpath from "xpath";
import { DOMParser } from "@xmldom/xmldom";
import XLSX from "xlsx";

export { LANGUAGE_NAME_MAP } from "../lib/language-normalization.js";

import {
  type GlossaryEntryRow,
  type GlossaryImportEntry,
  type GlossaryImportImage,
  type GlossaryListItem,
  type GlossaryRow,
  IMAGE_EXTENSIONS,
  normalizeGlossaryLanguages
} from "./glossaries.helpers.import-utils.js";

export * from "./glossaries.helpers.import-utils.js";
export { parseCsvImport } from "./glossaries.helpers.csv-import.js";

export function buildImageMap(images: GlossaryImportImage[]) {
  const byName = new Map<string, GlossaryImportImage>();
  const byStem = new Map<string, GlossaryImportImage>();
  for (const img of images) {
    const normalized = img.filename.toLowerCase();
    if (!byName.has(normalized)) byName.set(normalized, img);
    const stem = normalized.replace(/\.[^/.]+$/, "");
    if (stem && !byStem.has(stem)) byStem.set(stem, img);
  }
  return { byName, byStem };
}

export function matchImages(entries: GlossaryImportEntry[], images: GlossaryImportImage[]) {
  const { byName, byStem } = buildImageMap(images);
  const matches = new Map<string, GlossaryImportImage>();
  const missingRefs: string[] = [];

  for (const entry of entries) {
    if (!entry.imageRef) continue;
    const ref = entry.imageRef.trim();
    if (!ref) continue;
    const normalized = ref.toLowerCase();
    const match =
      normalized.includes(".") ? byName.get(normalized) : byStem.get(normalized) ?? byName.get(normalized);
    if (match) {
      matches.set(entry.termId, match);
    } else if (entry.explicitImageRef) {
      missingRefs.push(ref);
    }
  }

  const used = new Set(Array.from(matches.values()).map((img) => img.filename.toLowerCase()));
  const unused = images.filter((img) => !used.has(img.filename.toLowerCase()));

  return { matches, missingRefs, unused };
}

export async function buildImagePreview(
  entries: GlossaryImportEntry[],
  images: GlossaryImportImage[]
): Promise<{
  matched: Map<string, GlossaryImportImage>;
  missingRefs: string[];
  unused: GlossaryImportImage[];
  previewMap: Map<string, { filename: string; url: string }>;
}> {
  const { matches, missingRefs, unused } = matchImages(entries, images);
  const previewMap = new Map<string, { filename: string; url: string }>();
  for (const entry of entries.slice(0, 50)) {
    const match = matches.get(entry.termId);
    if (!match) continue;
    try {
      const presigned = await presignGetObject({ key: match.objectKey, downloadFilename: match.filename });
      previewMap.set(entry.termId, { filename: match.filename, url: presigned.url });
    } catch {
      /* ignore */
    }
  }

  return { matched: matches, missingRefs, unused, previewMap };
}

export function dedupeEntries(entries: GlossaryImportEntry[], strategy: "skip" | "fail") {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pairSeen = new Set<string>();
  const termIdSeen = new Set<string>();
  const unique: GlossaryImportEntry[] = [];
  let warned = false;

  for (const entry of entries) {
    const pairKey = `${entry.sourceLang}\u0000${entry.targetLang}\u0000${entry.term.toLowerCase()}\u0000${entry.translation.toLowerCase()}`;
    const termIdKey = entry.termId.toLowerCase();
    const dupPair = pairSeen.has(pairKey);
    const dupId = termIdSeen.has(termIdKey);
    if (dupPair || dupId) {
      if (strategy === "fail") {
        errors.push("Duplicate terms detected in the import file.");
        break;
      }
      if (!warned) {
        warnings.push("Duplicate terms detected; duplicates will be skipped.");
        warned = true;
      }
      continue;
    }
    pairSeen.add(pairKey);
    termIdSeen.add(termIdKey);
    unique.push(entry);
  }

  return { entries: unique, errors, warnings };
}

export function mapGlossary(row: GlossaryRow, entryCount: number): GlossaryListItem {
  return {
    id: Number(row.id),
    label: row.label,
    filename: row.filename ?? null,
    description: row.description ?? null,
    languages: normalizeGlossaryLanguages(row.languages),
    visibility: row.visibility ?? null,
    disabled: Boolean(row.disabled),
    uploadedBy: row.uploaded_by ?? null,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    updatedBy: row.updated_by ?? null,
    updatedAt: new Date(row.updated_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    entryCount: Number(entryCount ?? 0)
  };
}

export function rowToGlossaryEntry(row: GlossaryEntryRow) {
  return {
    id: Number(row.id),
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    sourceTerm: row.term,
    targetTerm: row.translation,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export type GlossaryImportRow = {
  id: number;
  import_type: string;
  status: string;
  label: string | null;
  description: string | null;
  languages: any;
  settings_json: any;
  visibility: string | null;
  source_filename: string | null;
  source_object_key: string | null;
  source_sha256: string | null;
  source_size_bytes: number | null;
  source_content_type: string | null;
  images_manifest: any;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeImageManifest(value: any): GlossaryImportImage[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        filename: String(item?.filename ?? ""),
        objectKey: String(item?.objectKey ?? ""),
        sizeBytes: Number(item?.sizeBytes ?? 0),
        sha256: String(item?.sha256 ?? "")
      }))
      .filter((item) => item.filename && item.objectKey);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeImageManifest(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function sanitizeUploadFilename(name: string) {
  const base = path.basename(String(name || ""));
  const trimmed = base.replace(/[/\\]+/g, "").trim();
  return trimmed || "file";
}

export function isAllowedImageFilename(name: string) {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}


