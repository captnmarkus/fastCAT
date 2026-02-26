import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCX,
  DEFAULT_HTML,
  DEFAULT_PDF,
  DEFAULT_PPTX,
  DEFAULT_XLSX,
  DEFAULT_XML,
  buildFileTypeConfigPayload,
  defaultRenderedPreviewMethodForFileType
} from "./FileTypeConfigWizard.helpers";

describe("defaultRenderedPreviewMethodForFileType", () => {
  it("returns expected defaults per file type", () => {
    expect(defaultRenderedPreviewMethodForFileType("docx")).toBe("pdf");
    expect(defaultRenderedPreviewMethodForFileType("pptx")).toBe("pdf");
    expect(defaultRenderedPreviewMethodForFileType("xlsx")).toBe("pdf");
    expect(defaultRenderedPreviewMethodForFileType("xml")).toBe("xml_raw_pretty");
    expect(defaultRenderedPreviewMethodForFileType("html")).toBe("html");
  });
});

describe("buildFileTypeConfigPayload", () => {
  it("persists rendered preview flags for html", () => {
    const payload = buildFileTypeConfigPayload({
      fileType: "html",
      agentDefault: false,
      html: { ...DEFAULT_HTML, parsingTemplateId: "11" },
      xml: DEFAULT_XML,
      pdf: DEFAULT_PDF,
      docx: DEFAULT_DOCX,
      pptx: DEFAULT_PPTX,
      xlsx: DEFAULT_XLSX,
      renderedPreview: {
        supportsRenderedPreview: true,
        renderedPreviewMethod: "html",
        renderedPreviewDefaultOn: true,
        xmlXsltTemplateId: "",
        xmlRendererProfileId: ""
      }
    });

    expect(payload.supportsRenderedPreview).toBe(true);
    expect(payload.renderedPreviewMethod).toBe("html");
    expect(payload.renderedPreviewDefaultOn).toBe(true);
    expect(payload.html.parsingTemplateId).toBe(11);
  });

  it("stores xml rendered preview xslt profile fields when configured", () => {
    const payload = buildFileTypeConfigPayload({
      fileType: "xml",
      agentDefault: false,
      html: DEFAULT_HTML,
      xml: { ...DEFAULT_XML, parsingTemplateId: "22" },
      pdf: DEFAULT_PDF,
      docx: DEFAULT_DOCX,
      pptx: DEFAULT_PPTX,
      xlsx: DEFAULT_XLSX,
      renderedPreview: {
        supportsRenderedPreview: true,
        renderedPreviewMethod: "xml_xslt",
        renderedPreviewDefaultOn: false,
        xmlXsltTemplateId: "77",
        xmlRendererProfileId: "renderer-alpha"
      }
    });

    expect(payload.renderedPreviewMethod).toBe("xml_xslt");
    expect(payload.xml.renderedPreviewMethod).toBe("xml_xslt");
    expect(payload.xml.renderedPreviewXsltTemplateId).toBe(77);
    expect(payload.xml.renderedPreviewRendererProfileId).toBe("renderer-alpha");
  });
});
