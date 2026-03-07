import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseXlsxToCsv } from "../src/routes/glossaries.helpers.import-utils.js";
import { buildXlsxBuffer } from "../src/routes/projects.helpers.output.js";

test("parseXlsxToCsv reads the first worksheet without blank rows", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Glossary");
  sheet.addRow(["term", "translation"]);
  sheet.addRow(["Hallo", "Bonjour"]);
  sheet.addRow([]);
  sheet.addRow(["Zitat", 'Bonjour, "monde"']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const csv = await parseXlsxToCsv(buffer);

  assert.equal(csv, 'term,translation\nHallo,Bonjour\nZitat,"Bonjour, ""monde"""');
});

test("buildXlsxBuffer writes translations into the default worksheet", async () => {
  const buffer = await buildXlsxBuffer(["Bonjour", "Salut"]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Translations");

  assert.ok(sheet, "Translations worksheet should exist");
  assert.equal(sheet?.getCell("A1").text, "Bonjour");
  assert.equal(sheet?.getCell("A2").text, "Salut");
});
