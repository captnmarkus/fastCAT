import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGlossaryBuffer, parseGlossaryContent } from "../src/lib/glossary-utils.ts";
import { mapXmlDescripsToCustomFields } from "../src/lib/termbase-import.ts";

function loadXmlText() {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const xmlPath = path.join(repoRoot, "kk_glossar.xml");
  const buffer = fs.readFileSync(xmlPath);
  return decodeGlossaryBuffer(buffer);
}

test("MTF descrips map into entry/term custom fields", () => {
  const xmlText = loadXmlText();
  const parsed = parseGlossaryContent({ filename: "kk_glossar.xml", data: xmlText });

  const steckEntry = parsed.find((row) => row.term === "Steckregal" || row.translation === "Steckregal");
  assert.ok(steckEntry, "Missing Steckregal entry in XML parse");
  assert.ok(steckEntry?.entryDescrips?.Kategorie, "Missing Kategorie descrip for Steckregal");
  assert.ok(steckEntry?.entryDescrips?.Produkttyp, "Missing Produkttyp descrip for Steckregal");
  assert.ok(steckEntry?.entryDescrips?.Graphic, "Missing Graphic descrip for Steckregal");
  assert.ok(steckEntry?.entryDescrips?.Erläuterung, "Missing Erläuterung descrip for Steckregal");

  const structure = {
    entry: [
      { name: "Kategorie" },
      { name: "Produkttyp" },
      { name: "Illustration" },
      { name: "Erläuterung" }
    ],
    language: [],
    term: [{ name: "Erläuterung" }, { name: "Typ" }, { name: "Grammatik" }, { name: "Status" }]
  };

  const steckMapped = mapXmlDescripsToCustomFields({
    entryDescrips: steckEntry?.entryDescrips ?? null,
    languageDescrips: steckEntry?.languageDescrips ?? null,
    termDescrips: steckEntry?.termDescrips ?? null,
    structure
  });

  assert.equal(
    steckMapped.entryFields.Illustration,
    steckEntry?.entryDescrips?.Graphic,
    "Graphic should map to Illustration"
  );
  assert.equal(
    steckMapped.entryFields.Erläuterung,
    steckEntry?.entryDescrips?.Erläuterung,
    "Erläuterung should map to entry fields"
  );

  const durchEntry = parsed.find((row) => row.term === "Durchlassbreite" || row.translation === "Durchlassbreite");
  assert.ok(durchEntry, "Missing Durchlassbreite entry in XML parse");
  const durchLang = durchEntry?.term === "Durchlassbreite" ? durchEntry.sourceLang : durchEntry?.targetLang;
  assert.ok(durchLang, "Missing language for Durchlassbreite");

  const durchMapped = mapXmlDescripsToCustomFields({
    entryDescrips: durchEntry?.entryDescrips ?? null,
    languageDescrips: durchEntry?.languageDescrips ?? null,
    termDescrips: durchEntry?.termDescrips ?? null,
    structure
  });

  const termFields = durchMapped.termFields?.[durchLang]?.["Durchlassbreite"];
  assert.ok(termFields?.Erläuterung, "Missing term-level Erläuterung for Durchlassbreite");
});
