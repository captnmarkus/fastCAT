import { test } from "node:test";
import assert from "node:assert/strict";
import { getRenderedPreviewSettings, normalizeFileTypeConfigForWrite } from "../src/routes/resources.helpers.js";

test("getRenderedPreviewSettings returns xml renderer profile options", () => {
  const settings = getRenderedPreviewSettings(
    {
      supportsRenderedPreview: true,
      renderedPreviewDefaultOn: true,
      xml: {
        renderedPreviewMethod: "xml_xslt",
        renderedPreviewXsltTemplateId: "12",
        renderedPreviewRendererProfileId: "xml-profile-1"
      }
    },
    "xml"
  );

  assert.equal(settings.supportsRenderedPreview, true);
  assert.equal(settings.renderedPreviewDefaultOn, true);
  assert.equal(settings.renderedPreviewMethod, "xml_xslt");
  assert.equal(settings.xmlXsltTemplateId, 12);
  assert.equal(settings.xmlRendererProfileId, "xml-profile-1");
});

test("normalizeFileTypeConfigForWrite clamps rendered preview method for office file types", () => {
  const result = normalizeFileTypeConfigForWrite({
    fileType: "docx",
    supportsRenderedPreview: true,
    renderedPreviewMethod: "html",
    renderedPreviewDefaultOn: false,
    docx: { preserveFormattingTags: true }
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;

  assert.equal(result.fileType, "docx");
  assert.equal(result.config.supportsRenderedPreview, true);
  assert.equal(result.config.renderedPreviewMethod, "pdf");
  assert.equal(result.config.renderedPreviewDefaultOn, false);
});

test("normalizeFileTypeConfigForWrite stores xml rendered preview settings", () => {
  const result = normalizeFileTypeConfigForWrite({
    fileType: "xml",
    supportsRenderedPreview: true,
    renderedPreviewDefaultOn: true,
    renderedPreviewMethod: "xml_raw_pretty",
    xml: {
      parsingTemplateId: 42,
      renderedPreviewMethod: "xml_xslt",
      renderedPreviewXsltTemplateId: "33",
      renderedPreviewRendererProfileId: "profile-2"
    }
  });

  assert.ok(!("error" in result));
  if ("error" in result) return;

  assert.equal(result.fileType, "xml");
  assert.equal(result.config.supportsRenderedPreview, true);
  assert.equal(result.config.renderedPreviewMethod, "xml_xslt");
  assert.equal(result.config.renderedPreviewDefaultOn, true);
  assert.equal(result.config.xml.renderedPreviewMethod, "xml_xslt");
  assert.equal(result.config.xml.renderedPreviewXsltTemplateId, 33);
  assert.equal(result.config.xml.renderedPreviewRendererProfileId, "profile-2");
});
