import test from "node:test";
import assert from "node:assert/strict";
import { parseGlossaryContent } from "../src/lib/glossary-utils.ts";
import { mapXmlDescripsToCustomFields } from "../src/lib/termbase-import.ts";

const SAMPLE_MTF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<martif>
  <text>
    <body>
      <conceptGrp>
        <concept id="concept-1" />
        <descrip type="Kategorie">Regaltechnik</descrip>
        <descrip type="Produkttyp">Steckregal</descrip>
        <descrip type="Graphic">img://steckregal.png</descrip>
        <descrip type="Erlaeuterung">Einfaches Regalsystem</descrip>
        <languageGrp>
          <language type="de" />
          <termGrp>
            <term>Steckregal</term>
            <descrip type="Typ">Bevorzugt</descrip>
          </termGrp>
          <termGrp>
            <term>Durchlassbreite</term>
            <descrip type="Erlaeuterung">Abstand zwischen den Rahmen</descrip>
          </termGrp>
        </languageGrp>
        <languageGrp>
          <language type="en" />
          <termGrp>
            <term>boltless shelf</term>
          </termGrp>
          <termGrp>
            <term>clear width</term>
          </termGrp>
        </languageGrp>
      </conceptGrp>
    </body>
  </text>
</martif>
`;

test("MTF descrips map into entry/term custom fields", () => {
  const parsed = parseGlossaryContent({ filename: "kk_glossar.xml", data: SAMPLE_MTF_XML });

  const steckEntry = parsed.find((row) => row.term === "Steckregal" || row.translation === "Steckregal");
  assert.ok(steckEntry, "Missing Steckregal entry in XML parse");
  assert.ok(steckEntry?.entryDescrips?.Kategorie, "Missing Kategorie descrip for Steckregal");
  assert.ok(steckEntry?.entryDescrips?.Produkttyp, "Missing Produkttyp descrip for Steckregal");
  assert.ok(steckEntry?.entryDescrips?.Graphic, "Missing Graphic descrip for Steckregal");
  assert.ok(steckEntry?.entryDescrips?.Erlaeuterung, "Missing Erlaeuterung descrip for Steckregal");

  const structure = {
    entry: [
      { name: "Kategorie" },
      { name: "Produkttyp" },
      { name: "Illustration" },
      { name: "Erlaeuterung" }
    ],
    language: [],
    term: [{ name: "Erlaeuterung" }, { name: "Typ" }, { name: "Grammatik" }, { name: "Status" }]
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
    steckMapped.entryFields.Erlaeuterung,
    steckEntry?.entryDescrips?.Erlaeuterung,
    "Erlaeuterung should map to entry fields"
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
  assert.ok(termFields?.Erlaeuterung, "Missing term-level Erlaeuterung for Durchlassbreite");
});
