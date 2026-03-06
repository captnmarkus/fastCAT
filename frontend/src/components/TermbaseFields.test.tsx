import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DynamicFieldsSection, type FieldSchema } from "./TermbaseFields";

const EXPLANATION_FIELD = "Erl\u00E4uterung";
const SAMPLE_FIELDS = {
  category: "Technik",
  explanation: "Ausf\u00FChrliche Beschreibung"
};

describe("DynamicFieldsSection", () => {
  it("renders schema-driven fields with picklists and textareas", () => {
    const fields: FieldSchema[] = [
      {
        name: "Kategorie",
        level: "entry",
        type: "picklist",
        picklistValues: [SAMPLE_FIELDS.category, "Other"]
      },
      {
        name: EXPLANATION_FIELD,
        level: "entry",
        type: "text"
      }
    ];

    const html = renderToStaticMarkup(
      <DynamicFieldsSection
        fields={fields}
        values={{ Kategorie: SAMPLE_FIELDS.category, [EXPLANATION_FIELD]: SAMPLE_FIELDS.explanation }}
        onChange={() => {}}
      />
    );

    expect(html).toContain("Kategorie");
    expect(html).toContain(SAMPLE_FIELDS.category);
    expect(html).toContain(EXPLANATION_FIELD);
    expect(html).toContain("<select");
    expect(html).toContain("<textarea");
  });
});
