import test from "node:test";
import assert from "node:assert/strict";
import { buildGlossaryTbx } from "../src/lib/glossary-utils.ts";
import { normalizeStructureFields } from "../src/lib/termbase-import.ts";
import { buildTermbaseCsvExport } from "../src/routes/termbases.ts";

function buildFixture() {
  const structure = normalizeStructureFields({
    entry: [
      { name: "Kategorie" },
      { name: "Illustration" },
      { name: "Erläuterung" }
    ],
    language: [{ name: "Definition" }],
    term: [
      { name: "Status" },
      { name: "Typ" },
      { name: "Grammatik" },
      { name: "Erläuterung" }
    ]
  });

  const entries = [
    {
      id: 1,
      glossary_id: 1,
      concept_id: "c-1",
      source_lang: "de",
      target_lang: "en",
      term: "Steckregal",
      translation: "slot rack",
      notes: null,
      meta_json: {
        entry_fields: {
          Kategorie: "Regale",
          Illustration: ["img1.png", "img2.png"],
          Erläuterung: "Entry note"
        },
        language_fields: {
          de: { Definition: "DE definition" },
          en: { Definition: "EN definition" }
        },
        term_fields: {
          de: {
            Steckregal: {
              Typ: "Langform",
              Grammatik: "Subst.",
              Erläuterung: "Term note"
            }
          }
        },
        audit: {
          createdAt: "2024-01-02T03:04:05.000Z",
          createdBy: "Entry Author",
          modifiedAt: "2024-01-03T04:05:06.000Z",
          modifiedBy: "Entry Editor"
        },
        term_audit: {
          de: {
            Steckregal: {
              createdAt: "2024-02-01T00:00:00.000Z",
              createdBy: "Term Author",
              modifiedAt: "2024-02-02T00:00:00.000Z",
              modifiedBy: "Term Editor"
            }
          },
          en: {
            "slot rack": {
              createdAt: "2024-02-05T00:00:00.000Z",
              createdBy: "EN Author"
            }
          }
        }
      },
      created_by: null,
      updated_by: null,
      updated_at: "2025-01-01T00:00:00.000Z",
      created_at: "2025-01-01T00:00:00.000Z"
    }
  ];

  return { structure, entries };
}

test("CSV export includes structure-driven columns and values", () => {
  const { structure, entries } = buildFixture();
  const csv = buildTermbaseCsvExport({ entries, structure });
  const header = csv.split(/\r?\n/)[0];

  assert.ok(header.includes("entry__Kategorie"));
  assert.ok(header.includes("entry__Illustration"));
  assert.ok(header.includes("entry__Erläuterung"));
  assert.ok(header.includes("lang__Definition"));
  assert.ok(header.includes("term__Typ"));
  assert.ok(header.includes("term__Grammatik"));
  assert.ok(header.includes("term__Erläuterung"));
  assert.ok(!header.includes("term__Status"));
  assert.ok(header.includes("entry_created_at"));
  assert.ok(header.includes("entry_created_by"));
  assert.ok(header.includes("entry_modified_at"));
  assert.ok(header.includes("entry_modified_by"));
  assert.ok(header.includes("term_created_at"));
  assert.ok(header.includes("term_created_by"));
  assert.ok(header.includes("term_modified_at"));
  assert.ok(header.includes("term_modified_by"));

  assert.ok(csv.includes("Regale"));
  assert.ok(csv.includes("img1.png | img2.png"));
  assert.ok(csv.includes("Langform"));
  assert.ok(csv.includes("Term note"));
  assert.ok(csv.includes("Entry Author"));
  assert.ok(csv.includes("2024-01-02T03:04:05.000Z"));
  assert.ok(csv.includes("Term Author"));
  assert.ok(csv.includes("2024-02-01T00:00:00.000Z"));
});

test("TBX export includes structure-driven descrips without throwing", () => {
  const { structure, entries } = buildFixture();
  const xml = buildGlossaryTbx(entries, { structure });

  assert.ok(xml.includes('<descrip type="Erläuterung">Entry note</descrip>'));
  assert.ok(xml.includes('<descrip type="Erläuterung">Term note</descrip>'));
  assert.ok(xml.includes("img1.png | img2.png"));
  assert.ok(xml.includes('<admin type="creationDate">2024-01-02T03:04:05.000Z</admin>'));
  assert.ok(xml.includes('<admin type="createdBy">Entry Author</admin>'));
  assert.ok(xml.includes('<admin type="modificationDate">2024-01-03T04:05:06.000Z</admin>'));
  assert.ok(xml.includes('<admin type="modifiedBy">Entry Editor</admin>'));
  assert.ok(xml.includes('<admin type="createdBy">Term Author</admin>'));
});

test("CSV/TBX export falls back term audit to entry audit when term audit is missing", () => {
  const { structure } = buildFixture();
  const entries = [
    {
      id: 2,
      glossary_id: 1,
      concept_id: "c-2",
      source_lang: "de",
      target_lang: "en",
      term: "Fach",
      translation: "compartment",
      notes: null,
      meta_json: {
        audit: {
          createdAt: "2022-01-02T03:04:05.000Z",
          createdBy: "Original Author",
          modifiedAt: "2022-02-03T04:05:06.000Z",
          modifiedBy: "Original Editor"
        }
      },
      created_by: "importer",
      updated_by: "importer",
      updated_at: "2025-01-01T00:00:00.000Z",
      created_at: "2025-01-01T00:00:00.000Z"
    }
  ];

  const csv = buildTermbaseCsvExport({ entries, structure });
  const [header, row] = csv.trim().split(/\r?\n/);
  const headers = header.split(",");
  const termCreatedByIdx = headers.indexOf("term_created_by");
  const termCreatedAtIdx = headers.indexOf("term_created_at");
  const values = row.split(",");
  assert.equal(values[termCreatedByIdx], "Original Author");
  assert.equal(values[termCreatedAtIdx], "2022-01-02T03:04:05.000Z");

  const xml = buildGlossaryTbx(entries, { structure });
  assert.ok(
    /<termGrp>[\s\S]*<admin type="createdBy">Original Author<\/admin>[\s\S]*<\/termGrp>/.test(xml)
  );
});
