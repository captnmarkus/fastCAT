import fs from "fs";
import path from "path";
import { db, withTransaction } from "../db.js";
import { decodeGlossaryBuffer, parseGlossaryContent } from "../lib/glossary-utils.js";
import { mapXmlDescripsToCustomFields } from "../lib/termbase-import.js";

type CustomFields = Record<string, any>;
type LanguageFieldsMap = Record<string, CustomFields>;
type TermFieldsMap = Record<string, Record<string, CustomFields>>;

function parseArgs(argv: string[]) {
  const args = [...argv];
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };
  const termbaseId = Number(get("--termbase-id") ?? get("--termbase") ?? get("--id"));
  const file = get("--file") ?? get("-f");
  const actor = get("--actor") ?? "backfill";
  const dryRun = args.includes("--dry-run");
  return { termbaseId, file, actor, dryRun };
}

function mergeFieldMap(target: CustomFields, patch: CustomFields) {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    target[key] = value;
  });
}

function mergeLanguageFields(target: LanguageFieldsMap, patch: LanguageFieldsMap) {
  Object.entries(patch).forEach(([lang, fields]) => {
    const current = target[lang] ?? {};
    mergeFieldMap(current, fields);
    target[lang] = current;
  });
}

function mergeTermFields(target: TermFieldsMap, patch: TermFieldsMap) {
  Object.entries(patch).forEach(([lang, terms]) => {
    const currentLang = target[lang] ?? {};
    Object.entries(terms).forEach(([term, fields]) => {
      const currentTerm = currentLang[term] ?? {};
      mergeFieldMap(currentTerm, fields);
      currentLang[term] = currentTerm;
    });
    target[lang] = currentLang;
  });
}

function ensureObject(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

async function main() {
  const { termbaseId, file, actor, dryRun } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(termbaseId) || termbaseId <= 0 || !file) {
    console.error("Usage: npx tsx src/scripts/backfill-termbase-xml.ts --termbase-id <id> --file <path> [--dry-run] [--actor <name>]");
    process.exit(1);
  }

  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const glossaryRes = await db.query<{ id: number; structure_json?: any }>(
    "SELECT id, structure_json FROM glossaries WHERE id = $1",
    [termbaseId]
  );
  const glossary = glossaryRes.rows[0];
  if (!glossary) {
    console.error(`Termbase ${termbaseId} not found.`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const xmlText = decodeGlossaryBuffer(buffer);
  const parsed = parseGlossaryContent({ filename: filePath, data: xmlText });

  const byConcept = new Map<
    string,
    ReturnType<typeof mapXmlDescripsToCustomFields>
  >();
  parsed.forEach((row) => {
    const conceptId = String(row.conceptId ?? "").trim();
    if (!conceptId || byConcept.has(conceptId)) return;
    const mapped = mapXmlDescripsToCustomFields({
      entryDescrips: row.entryDescrips ?? null,
      languageDescrips: row.languageDescrips ?? null,
      termDescrips: row.termDescrips ?? null,
      structure: glossary.structure_json
    });
    const hasEntry = Object.keys(mapped.entryFields).length > 0;
    const hasLang = Object.keys(mapped.languageFields).length > 0;
    const hasTerm = Object.keys(mapped.termFields).length > 0;
    if (hasEntry || hasLang || hasTerm) {
      byConcept.set(conceptId, mapped);
    }
  });

  if (byConcept.size === 0) {
    console.log("No descrip data found in XML; nothing to backfill.");
    await db.end();
    return;
  }

  let updatedRows = 0;
  await withTransaction(async (client) => {
    for (const [conceptId, mapped] of byConcept.entries()) {
      const rowsRes = await client.query<{ id: number; meta_json: any }>(
        `SELECT id, meta_json
         FROM glossary_entries
         WHERE glossary_id = $1
           AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))`,
        [termbaseId, conceptId]
      );
      if (rowsRes.rows.length === 0) continue;

      for (const row of rowsRes.rows) {
        const meta = ensureObject(row.meta_json);
        const nextMeta = { ...meta };

        if (Object.keys(mapped.entryFields).length > 0) {
          const current = ensureObject(nextMeta.entry_fields);
          mergeFieldMap(current, mapped.entryFields);
          nextMeta.entry_fields = current;
        }

        if (Object.keys(mapped.languageFields).length > 0) {
          const current = ensureObject(nextMeta.language_fields) as LanguageFieldsMap;
          mergeLanguageFields(current, mapped.languageFields);
          nextMeta.language_fields = current;
        }

        if (Object.keys(mapped.termFields).length > 0) {
          const current = ensureObject(nextMeta.term_fields) as TermFieldsMap;
          mergeTermFields(current, mapped.termFields);
          nextMeta.term_fields = current;
        }

        const rawEntry = mapped.rawDescrips.entry ?? null;
        const rawLanguage = mapped.rawDescrips.language ?? null;
        const rawTerm = mapped.rawDescrips.term ?? null;
        if (rawEntry || rawLanguage || rawTerm) {
          const existingRaw = ensureObject(nextMeta._raw_descrip);
          if (rawEntry) {
            const current = ensureObject(existingRaw.entry);
            mergeFieldMap(current, rawEntry);
            existingRaw.entry = current;
          }
          if (rawLanguage) {
            const current = ensureObject(existingRaw.language) as LanguageFieldsMap;
            mergeLanguageFields(current, rawLanguage);
            existingRaw.language = current;
          }
          if (rawTerm) {
            const current = ensureObject(existingRaw.term) as TermFieldsMap;
            mergeTermFields(current, rawTerm);
            existingRaw.term = current;
          }
          nextMeta._raw_descrip = existingRaw;
        }

        if (dryRun) {
          updatedRows += 1;
          continue;
        }

        await client.query(
          `UPDATE glossary_entries
           SET meta_json = $1,
               updated_by = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(nextMeta), actor, row.id]
        );
        updatedRows += 1;
      }
    }

    if (!dryRun && updatedRows > 0) {
      await client.query(
        "UPDATE glossaries SET updated_by = $1, updated_at = NOW() WHERE id = $2",
        [actor, termbaseId]
      );
    }
  });

  console.log(
    `${dryRun ? "Dry run" : "Backfill"} complete. Updated rows: ${updatedRows}. Concepts processed: ${byConcept.size}.`
  );
  await db.end();
}

main().catch((err) => {
  console.error(err);
  db.end().catch(() => undefined);
  process.exit(1);
});
