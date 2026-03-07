import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { parseOfficeRichSegments, rebuildOfficeFromRichSegments } from "../src/lib/office-rich.js";

function zipFromXmlEntries(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [entryName, xml] of Object.entries(entries)) {
    zip.addFile(entryName, Buffer.from(xml, "utf8"));
  }
  return zip.toBuffer();
}

function buildStyledDocxBuffer() {
  return zipFromXmlEntries({
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="24"/><w:b/></w:rPr>
        <w:t>Hallo</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/><w:u w:val="single"/></w:rPr>
        <w:t> Welt</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="20"/><w:i/></w:rPr>
        <w:t> jetzt</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`
  });
}

function assertStyledDocxTranslation(targetText: string) {
  const sourceBuffer = buildStyledDocxBuffer();
  const parsed = parseOfficeRichSegments({ buffer: sourceBuffer, fileType: "docx" });
  const first = parsed.segments[0]!;
  const rebuilt = rebuildOfficeFromRichSegments({
    sourceBuffer,
    fileType: "docx",
    segments: [{ ...first, tgt: targetText }]
  });

  assert.equal(rebuilt.warnings.length, 0);

  const reparsed = parseOfficeRichSegments({ buffer: rebuilt.buffer, fileType: "docx" });
  const runs = reparsed.segments[0]?.srcRuns ?? [];
  assert.equal(reparsed.segments[0]?.src, targetText);
  assert.ok(runs.some((run) => run.style?.bold === true), "bold formatting should survive");
  assert.ok(runs.some((run) => run.style?.underline === true), "underline formatting should survive");
  assert.ok(runs.some((run) => run.style?.italic === true), "italic formatting should survive");
  assert.ok(runs.some((run) => run.style?.fontFamily === "Calibri"), "font family should survive");
  assert.ok(runs.some((run) => run.style?.fontSizePt === 12), "font size should survive");
}

test("DOCX rich runs survive parse and rebuild", () => {
  const sourceBuffer = zipFromXmlEntries({
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="24"/><w:b/></w:rPr>
        <w:t>Hello</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="20"/><w:i/></w:rPr>
        <w:t> world</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`
  });

  const parsed = parseOfficeRichSegments({ buffer: sourceBuffer, fileType: "docx" });
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.segments.length, 1);
  const first = parsed.segments[0]!;
  assert.equal(first.src, "Hello world");
  assert.equal(first.srcRuns?.length, 2);
  assert.equal(first.srcRuns?.[0]?.style?.bold, true);
  assert.equal(first.srcRuns?.[1]?.style?.italic, true);

  const rebuilt = rebuildOfficeFromRichSegments({
    sourceBuffer,
    fileType: "docx",
    segments: [{ ...first, tgt: "Bonjour monde" }]
  });
  assert.equal(rebuilt.warnings.length, 0);

  const reparsed = parseOfficeRichSegments({ buffer: rebuilt.buffer, fileType: "docx" });
  assert.equal(reparsed.segments.length, 1);
  assert.equal(reparsed.segments[0]?.src, "Bonjour monde");
  assert.equal(reparsed.segments[0]?.srcRuns?.[0]?.style?.fontFamily, "Calibri");
});

test("DOCX French translation keeps inline formatting for LLM-style output", () => {
  assertStyledDocxTranslation("Bonjour le monde");
});

test("DOCX Danish translation keeps inline formatting for LLM-style output", () => {
  assertStyledDocxTranslation("Hej verden nu");
});

test("PPTX rich runs survive parse and rebuild", () => {
  const sourceBuffer = zipFromXmlEntries({
    "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="TextBox 1"/></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr sz="1800" b="1"><a:latin typeface="Arial"/></a:rPr><a:t>Hello</a:t></a:r>
            <a:r><a:rPr sz="1400" i="1"><a:latin typeface="Arial"/></a:rPr><a:t> slide</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
  });

  const parsed = parseOfficeRichSegments({ buffer: sourceBuffer, fileType: "pptx" });
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.segments.length, 1);
  const first = parsed.segments[0]!;
  assert.equal(first.src, "Hello slide");
  assert.equal(first.srcRuns?.length, 2);
  assert.equal(first.srcRuns?.[0]?.style?.bold, true);
  assert.equal(first.srcRuns?.[0]?.style?.fontFamily, "Arial");

  const rebuilt = rebuildOfficeFromRichSegments({
    sourceBuffer,
    fileType: "pptx",
    segments: [{ ...first, tgt: "Bonjour diapo" }]
  });
  assert.equal(rebuilt.warnings.length, 0);

  const reparsed = parseOfficeRichSegments({ buffer: rebuilt.buffer, fileType: "pptx" });
  assert.equal(reparsed.segments.length, 1);
  assert.equal(reparsed.segments[0]?.src, "Bonjour diapo");
  assert.equal(reparsed.segments[0]?.srcRuns?.[0]?.style?.fontFamily, "Arial");
});

test("XLSX rich inline runs survive parse and rebuild", () => {
  const sourceBuffer = zipFromXmlEntries({
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr">
        <is>
          <r><rPr><rFont val="Calibri"/><sz val="11"/><b/></rPr><t>Hello</t></r>
          <r><rPr><rFont val="Calibri"/><sz val="9"/><i/></rPr><t> cell</t></r>
        </is>
      </c>
    </row>
  </sheetData>
</worksheet>`
  });

  const parsed = parseOfficeRichSegments({ buffer: sourceBuffer, fileType: "xlsx" });
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.segments.length, 1);
  const first = parsed.segments[0]!;
  assert.equal(first.src, "Hello cell");
  assert.equal(first.srcRuns?.length, 2);
  assert.equal(first.srcRuns?.[0]?.style?.bold, true);
  assert.equal(first.srcRuns?.[1]?.style?.italic, true);
  assert.equal(first.segmentContext?.cellRef, "A1");

  const rebuilt = rebuildOfficeFromRichSegments({
    sourceBuffer,
    fileType: "xlsx",
    segments: [{ ...first, tgt: "Bonjour cellule" }]
  });
  assert.equal(rebuilt.warnings.length, 0);

  const reparsed = parseOfficeRichSegments({ buffer: rebuilt.buffer, fileType: "xlsx" });
  assert.equal(reparsed.segments.length, 1);
  assert.equal(reparsed.segments[0]?.src, "Bonjour cellule");
  assert.equal(reparsed.segments[0]?.srcRuns?.[0]?.style?.fontFamily, "Calibri");
});
