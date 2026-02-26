import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DynamicFieldsSection, type FieldSchema } from "./TermbaseFields";

function loadSampleFields() {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..", "..");
  const xmlPath = path.join(repoRoot, "kk_glossar.xml");
  const xml = fs.readFileSync(xmlPath, "utf16le");

  const extract = (pattern: RegExp, fallback: string) => {
    const match = xml.match(pattern);
    return match?.[1]?.trim() || fallback;
  };

  return {
    category: extract(/<descrip type="Kategorie">([^<]+)<\/descrip>/i, "Kategorie"),
    explanation: extract(/<descrip type="Erläuterung">([^<]+)<\/descrip>/i, "Erläuterung")
  };
}

describe("DynamicFieldsSection", () => {
  it("renders schema-driven fields with picklists and textareas", () => {
    const sample = loadSampleFields();
    const fields: FieldSchema[] = [
      {
        name: "Kategorie",
        level: "entry",
        type: "picklist",
        picklistValues: [sample.category, "Other"]
      },
      {
        name: "Erläuterung",
        level: "entry",
        type: "text"
      }
    ];

    const html = renderToStaticMarkup(
      <DynamicFieldsSection
        fields={fields}
        values={{ Kategorie: sample.category, "Erläuterung": sample.explanation }}
        onChange={() => {}}
      />
    );

    expect(html).toContain("Kategorie");
    expect(html).toContain(sample.category);
    expect(html).toContain("Erläuterung");
    expect(html).toContain("<select");
    expect(html).toContain("<textarea");
  });
});
