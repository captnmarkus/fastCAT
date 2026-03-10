import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createParsingTemplate,
  createFileTypeConfig,
  downloadParsingTemplateJson,
  deleteParsingTemplateUpload,
  getFileTypeConfig,
  listParsingTemplates,
  previewFileTypeConfigDraft,
  updateFileTypeConfig,
  updateParsingTemplate,
  uploadParsingTemplateJson,
  type ParsingTemplateKind,
  type FileTypeConfig,
  type FileTypePreviewResult,
  type ParsingTemplate,
  type ParsingTemplateConfig
} from "../../../api";
import Modal from "../../../components/Modal";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";
import { triggerFileDownload } from "../../../utils/download";
import { parsePositiveInt, resolveByNumericId } from "../../../utils/ids";
import {
  buildFileTypeConfigPayload,
  DEFAULT_DOCX,
  DEFAULT_HTML,
  DEFAULT_PDF,
  DEFAULT_PPTX,
  DEFAULT_XLSX,
  DEFAULT_XML,
  defaultRenderedPreviewMethodForFileType,
  deriveFileTypeFromConfig,
  getRenderedPreviewMethodOptions,
  normalizeFileTypeKind,
  parseBooleanFlag,
  normalizeParsingTemplateConfigForClient,
  normalizeTemplateRuleText,
  normalizeXmlParsingTemplateConfigForClient,
  STARTER_PARSING_TEMPLATE_CONFIG,
  STARTER_XML_PARSING_TEMPLATE_CONFIG,
  STEP_ORDER,
  stepIndexForKey,
  validateParsingTemplateJson,
  type DocxWizardConfig,
  type FileTypeKind,
  type HtmlWizardConfig,
  type PdfWizardConfig,
  type PptxWizardConfig,
  type RenderedPreviewMethod,
  type TemplateEditorMode,
  type WizardStepKey,
  type XlsxWizardConfig,
  type XmlWizardConfig
} from "./FileTypeConfigWizard.helpers";
import FileTypeConfigWizardConfigStep from "./FileTypeConfigWizardConfigStep";
import FileTypeConfigWizardBasicsStep from "./FileTypeConfigWizardBasicsStep";
import FileTypeConfigWizardPendingState from "./FileTypeConfigWizardPendingState";
import FileTypeConfigWizardPreviewStep from "./FileTypeConfigWizardPreviewStep";
import FileTypeConfigWizardReviewStep from "./FileTypeConfigWizardReviewStep";
import FileTypeConfigWizardTypeStep from "./FileTypeConfigWizardTypeStep";
export default function FileTypeConfigWizardPage() {
  const nav = useNavigate();
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const configId = parsePositiveInt(params.id);
  const isEdit = configId != null;
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<FileTypeConfig | null>(null);
  const [step, setStep] = useState<WizardStepKey>("type");
  const [fileType, setFileType] = useState<FileTypeKind | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [agentDefault, setAgentDefault] = useState(false);
  const [htmlCfg, setHtmlCfg] = useState<HtmlWizardConfig>({ ...DEFAULT_HTML });
  const [xmlCfg, setXmlCfg] = useState<XmlWizardConfig>({ ...DEFAULT_XML });
  const [pdfCfg, setPdfCfg] = useState<PdfWizardConfig>({ ...DEFAULT_PDF });
  const [docxCfg, setDocxCfg] = useState<DocxWizardConfig>({ ...DEFAULT_DOCX });
  const [pptxCfg, setPptxCfg] = useState<PptxWizardConfig>({ ...DEFAULT_PPTX });
  const [xlsxCfg, setXlsxCfg] = useState<XlsxWizardConfig>({ ...DEFAULT_XLSX });
  const [supportsRenderedPreview, setSupportsRenderedPreview] = useState(false);
  const [renderedPreviewMethod, setRenderedPreviewMethod] = useState<RenderedPreviewMethod>("html");
  const [renderedPreviewDefaultOn, setRenderedPreviewDefaultOn] = useState(false);
  const [xmlRenderedPreviewXsltTemplateId, setXmlRenderedPreviewXsltTemplateId] = useState("");
  const [xmlRenderedPreviewRendererProfileId, setXmlRenderedPreviewRendererProfileId] = useState("");
  const [templates, setTemplates] = useState<ParsingTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [viewTemplateJsonOpen, setViewTemplateJsonOpen] = useState(false);
  const [viewTemplateJsonLoading, setViewTemplateJsonLoading] = useState(false);
  const [viewTemplateJsonError, setViewTemplateJsonError] = useState<string | null>(null);
  const [viewTemplateJsonText, setViewTemplateJsonText] = useState("");
  const templateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [templateEditorMode, setTemplateEditorMode] = useState<TemplateEditorMode>("none");
  const [templateSourceUploadId, setTemplateSourceUploadId] = useState<number | null>(null);
  const [templateSourceUploadBusy, setTemplateSourceUploadBusy] = useState(false);
  const templateSourceUploadIdRef = useRef<number | null>(null);
  const [templateDraftName, setTemplateDraftName] = useState("");
  const [templateDraftDescription, setTemplateDraftDescription] = useState("");
  const [templateDraftJson, setTemplateDraftJson] = useState("");
  const [templateAdvancedJson, setTemplateAdvancedJson] = useState(false);
  const [templateRuleTab, setTemplateRuleTab] = useState<"block" | "inline" | "ignore">("block");
  const [templateRuleBlockText, setTemplateRuleBlockText] = useState("");
  const [templateRuleInlineText, setTemplateRuleInlineText] = useState("");
  const [templateRuleIgnoreText, setTemplateRuleIgnoreText] = useState("");
  const [templateXmlNamespaces, setTemplateXmlNamespaces] = useState<Array<{ prefix: string; uri: string }>>([]);
  const [templateXmlDefaultNamespacePrefix, setTemplateXmlDefaultNamespacePrefix] = useState("d");
  const [templateXmlTranslateAttributes, setTemplateXmlTranslateAttributes] = useState(false);
  const [templateXmlAttributeAllowlistText, setTemplateXmlAttributeAllowlistText] = useState("title\nalt\naria-label");
  const [templateXmlTreatCdataAsText, setTemplateXmlTreatCdataAsText] = useState(true);
  const [templateDraftOk, setTemplateDraftOk] = useState<boolean | null>(null);
  const [templateDraftError, setTemplateDraftError] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);

  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<FileTypePreviewResult | null>(null);
  const [previewShowTags, setPreviewShowTags] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const effectiveFileType = fileType;

  useEffect(() => {
    if (!effectiveFileType) return;
    setRenderedPreviewMethod((prev) => {
      if (effectiveFileType === "xml") {
        return prev === "xml_xslt" || prev === "xml_raw_pretty" ? prev : "xml_raw_pretty";
      }
      if (effectiveFileType === "html") return "html";
      if (effectiveFileType === "docx" || effectiveFileType === "pptx" || effectiveFileType === "xlsx") {
        return prev === "images" ? "images" : "pdf";
      }
      return defaultRenderedPreviewMethodForFileType(effectiveFileType);
    });
  }, [effectiveFileType]);

  useEffect(() => {
    if (isEdit) return;
    const hinted = normalizeFileTypeKind(searchParams.get("type"));
    if (!hinted) return;
    setFileType((prev) => prev ?? hinted);
    setStep((prev) => (prev === "type" ? "basics" : prev));
  }, [isEdit, searchParams]);

  useEffect(() => {
    templateSourceUploadIdRef.current = templateSourceUploadId;
  }, [templateSourceUploadId]);

  useEffect(() => {
    return () => {
      const id = templateSourceUploadIdRef.current;
      if (id != null) {
        void deleteParsingTemplateUpload(id).catch(() => {});
      }
    };
  }, []);

  const selectedTemplateId = useMemo(() => {
    if (!effectiveFileType) return "";
    if (effectiveFileType === "html") return htmlCfg.parsingTemplateId;
    if (effectiveFileType === "xml") return xmlCfg.parsingTemplateId;
    return "";
  }, [effectiveFileType, htmlCfg.parsingTemplateId, xmlCfg.parsingTemplateId]);

  const selectedTemplate = useMemo(() => {
    return resolveByNumericId(templates, selectedTemplateId);
  }, [selectedTemplateId, templates]);

  const lockFileType = useMemo(() => {
    if (!isEdit) return false;
    if (!initial) return false;
    const stored = deriveFileTypeFromConfig(initial.config);
    const storedTypes = Array.isArray((initial.config as any)?.fileTypes) ? ((initial.config as any).fileTypes as any[]) : [];
    return Boolean(stored && storedTypes.length <= 1 && (initial.config as any)?.fileType);
  }, [initial, isEdit]);

  const payloadConfig = useMemo(() => {
    if (!effectiveFileType) return null;
    return buildFileTypeConfigPayload({
      fileType: effectiveFileType,
      agentDefault,
      html: htmlCfg,
      xml: xmlCfg,
      pdf: pdfCfg,
      docx: docxCfg,
      pptx: pptxCfg,
      xlsx: xlsxCfg,
      renderedPreview: {
        supportsRenderedPreview,
        renderedPreviewMethod,
        renderedPreviewDefaultOn,
        xmlXsltTemplateId: xmlRenderedPreviewXsltTemplateId,
        xmlRendererProfileId: xmlRenderedPreviewRendererProfileId
      }
    });
  }, [
    agentDefault,
    docxCfg,
    effectiveFileType,
    htmlCfg,
    pdfCfg,
    pptxCfg,
    renderedPreviewDefaultOn,
    renderedPreviewMethod,
    supportsRenderedPreview,
    xlsxCfg,
    xmlCfg,
    xmlRenderedPreviewRendererProfileId,
    xmlRenderedPreviewXsltTemplateId
  ]);

  useEffect(() => {
    if (!isEdit || !configId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const cfg = await getFileTypeConfig(configId);
        if (cancelled) return;
        setInitial(cfg);
        setName(String(cfg.name || ""));
        setDescription(String(cfg.description || ""));
        setDisabled(Boolean(cfg.disabled));
        setFileType(deriveFileTypeFromConfig(cfg.config));

        const rawConfig = (cfg.config || {}) as any;
        setAgentDefault(parseBooleanFlag(rawConfig.agentDefault) || parseBooleanFlag(rawConfig.appAgentDefault));
        setSupportsRenderedPreview(parseBooleanFlag(rawConfig.supportsRenderedPreview));
        setRenderedPreviewDefaultOn(parseBooleanFlag(rawConfig.renderedPreviewDefaultOn));
        const typeFromConfig = deriveFileTypeFromConfig(rawConfig);
        const fallbackMethod = defaultRenderedPreviewMethodForFileType(typeFromConfig);
        const storedMethod = String(rawConfig.renderedPreviewMethod || "").trim().toLowerCase();
        if (typeFromConfig === "xml") {
          setRenderedPreviewMethod(storedMethod === "xml_xslt" || storedMethod === "xml_raw_pretty" ? storedMethod : "xml_raw_pretty");
        } else if (typeFromConfig === "docx" || typeFromConfig === "pptx" || typeFromConfig === "xlsx") {
          setRenderedPreviewMethod(storedMethod === "images" ? "images" : "pdf");
        } else if (typeFromConfig === "html") {
          setRenderedPreviewMethod("html");
        } else {
          setRenderedPreviewMethod(fallbackMethod);
        }
        const legacyParsingTemplateId =
          rawConfig.parsingTemplateId ?? rawConfig.htmlParsingTemplateId ?? rawConfig.parsing_template_id ?? null;
        const legacySegMode = String(rawConfig.segmentation?.mode || "").toLowerCase();

        const html = rawConfig.html || {};
        setHtmlCfg((prev) => ({
          ...prev,
          parsingTemplateId:
            html.parsingTemplateId != null
              ? String(html.parsingTemplateId)
              : legacyParsingTemplateId != null
                ? String(legacyParsingTemplateId)
                : prev.parsingTemplateId,
          segmenter: html.segmenter === "sentences" || legacySegMode === "sentences" ? "sentences" : "lines",
          preserveWhitespace: html.preserveWhitespace !== undefined ? Boolean(html.preserveWhitespace) : prev.preserveWhitespace,
          normalizeSpaces: html.normalizeSpaces !== undefined ? Boolean(html.normalizeSpaces) : prev.normalizeSpaces,
          inlineTagPlaceholders:
            html.inlineTagPlaceholders !== undefined ? Boolean(html.inlineTagPlaceholders) : prev.inlineTagPlaceholders
        }));

        const xml = rawConfig.xml || {};
        setXmlCfg((prev) => ({
          ...prev,
          parsingTemplateId:
            xml.parsingTemplateId != null
              ? String(xml.parsingTemplateId)
              : legacyParsingTemplateId != null
                ? String(legacyParsingTemplateId)
                : prev.parsingTemplateId,
          segmenter: xml.segmenter === "sentences" || legacySegMode === "sentences" ? "sentences" : "lines",
          preserveWhitespace: xml.preserveWhitespace !== undefined ? Boolean(xml.preserveWhitespace) : prev.preserveWhitespace
        }));
        setXmlRenderedPreviewXsltTemplateId(
          xml.renderedPreviewXsltTemplateId != null || rawConfig.renderedPreviewXsltTemplateId != null
            ? String(xml.renderedPreviewXsltTemplateId ?? rawConfig.renderedPreviewXsltTemplateId ?? "")
            : ""
        );
        setXmlRenderedPreviewRendererProfileId(
          String(xml.renderedPreviewRendererProfileId ?? rawConfig.renderedPreviewRendererProfileId ?? "")
        );

        const pdf = rawConfig.pdf || {};
        setPdfCfg((prev) => ({
          ...prev,
          layoutMode: pdf.layoutMode === "line" ? "line" : prev.layoutMode,
          segmenter: pdf.segmenter === "sentences" ? "sentences" : prev.segmenter,
          ocr: pdf.ocr !== undefined ? Boolean(pdf.ocr) : prev.ocr
        }));

        const docx = rawConfig.docx || {};
        setDocxCfg((prev) => ({
          ...prev,
          includeComments: docx.includeComments !== undefined ? Boolean(docx.includeComments) : prev.includeComments,
          includeFootnotes: docx.includeFootnotes !== undefined ? Boolean(docx.includeFootnotes) : prev.includeFootnotes,
          preserveFormattingTags:
            docx.preserveFormattingTags !== undefined ? Boolean(docx.preserveFormattingTags) : prev.preserveFormattingTags,
          segmenter: docx.segmenter === "sentences" ? "sentences" : prev.segmenter
        }));

        const pptx = rawConfig.pptx || {};
        setPptxCfg((prev) => ({
          ...prev,
          includeSpeakerNotes:
            pptx.includeSpeakerNotes !== undefined ? Boolean(pptx.includeSpeakerNotes) : prev.includeSpeakerNotes,
          preserveFormattingTags:
            pptx.preserveFormattingTags !== undefined ? Boolean(pptx.preserveFormattingTags) : prev.preserveFormattingTags,
          segmenter: pptx.segmenter === "sentences" ? "sentences" : prev.segmenter
        }));

        const xlsx = rawConfig.xlsx || {};
        setXlsxCfg((prev) => ({
          ...prev,
          includeCellComments:
            xlsx.includeCellComments !== undefined ? Boolean(xlsx.includeCellComments) : prev.includeCellComments,
          preserveFormattingTags:
            xlsx.preserveFormattingTags !== undefined ? Boolean(xlsx.preserveFormattingTags) : prev.preserveFormattingTags,
          segmenter: xlsx.segmenter === "sentences" ? "sentences" : prev.segmenter
        }));
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.userMessage || err?.message || "Failed to load file type configuration.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configId, isEdit]);

  useEffect(() => {
    if (!effectiveFileType) return;
    if (effectiveFileType !== "html" && effectiveFileType !== "xml") return;
    setTemplates([]);
    setTemplatesLoaded(false);
    setTemplatesError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFileType]);

  useEffect(() => {
    if (!effectiveFileType) return;
    if (effectiveFileType !== "html" && effectiveFileType !== "xml") return;
    if (templatesLoading || templatesLoaded) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    (async () => {
      try {
        const list = await listParsingTemplates({ kind: effectiveFileType });
        if (cancelled) return;
        setTemplates(list);
      } catch (err: any) {
        if (cancelled) return;
        setTemplatesError(err?.userMessage || err?.message || "Failed to load extraction templates.");
      } finally {
        if (!cancelled) {
          setTemplatesLoading(false);
          setTemplatesLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFileType, templatesLoaded, templatesLoading]);

  function resetTemplateDraft(args?: { kind?: ParsingTemplateKind; name?: string; description?: string; config?: ParsingTemplateConfig }) {
    const kind: ParsingTemplateKind =
      args?.kind ?? (effectiveFileType === "xml" ? "xml" : "html");
    const nameValue = String(args?.name ?? "").trim();
    const descriptionValue = String(args?.description ?? "");
    const cfg = args?.config ?? (kind === "xml" ? STARTER_XML_PARSING_TEMPLATE_CONFIG : STARTER_PARSING_TEMPLATE_CONFIG);
    setTemplateSourceUploadId(null);
    setTemplateSourceUploadBusy(false);
    setTemplateDraftName(nameValue);
    setTemplateDraftDescription(descriptionValue);
    setTemplateDraftJson(JSON.stringify(cfg, null, 2));
    setTemplateAdvancedJson(false);
    setTemplateRuleTab("block");
    if (kind === "xml") {
      const xmlCfg = cfg as any;
      setTemplateRuleBlockText((xmlCfg.block_xpath || []).join("\n"));
      setTemplateRuleInlineText((xmlCfg.inline_xpath || []).join("\n"));
      setTemplateRuleIgnoreText((xmlCfg.ignored_xpath || []).join("\n"));
      const nsObj = (xmlCfg.namespaces && typeof xmlCfg.namespaces === "object" ? xmlCfg.namespaces : {}) as Record<string, any>;
      setTemplateXmlNamespaces(
        Object.entries(nsObj).map(([prefix, uri]) => ({ prefix: String(prefix || "").trim(), uri: String(uri || "").trim() }))
      );
      setTemplateXmlDefaultNamespacePrefix(String(xmlCfg.default_namespace_prefix ?? "d"));
      setTemplateXmlTranslateAttributes(Boolean(xmlCfg.translate_attributes));
      setTemplateXmlAttributeAllowlistText((xmlCfg.attribute_allowlist || []).join("\n"));
      setTemplateXmlTreatCdataAsText(xmlCfg.treat_cdata_as_text !== undefined ? Boolean(xmlCfg.treat_cdata_as_text) : true);
    } else {
      const htmlCfg = cfg as any;
      setTemplateRuleBlockText((htmlCfg.block_tags || []).join("\n"));
      setTemplateRuleInlineText((htmlCfg.inline_tags || []).join("\n"));
      setTemplateRuleIgnoreText((htmlCfg.ignored_tags || []).join("\n"));
      setTemplateXmlNamespaces([]);
      setTemplateXmlDefaultNamespacePrefix("d");
      setTemplateXmlTranslateAttributes(false);
      setTemplateXmlAttributeAllowlistText("title\nalt\naria-label");
      setTemplateXmlTreatCdataAsText(true);
    }
    setTemplateDraftOk(null);
    setTemplateDraftError(null);
    setTemplateSaveError(null);
  }

  const canProceed = useMemo(() => {
    if (step === "type") return Boolean(effectiveFileType);
    if (step === "basics") return Boolean(name.trim());
    if (step === "config") {
      if (!effectiveFileType) return false;
      if (effectiveFileType === "html" || effectiveFileType === "xml") {
        return Boolean(selectedTemplateId) && selectedTemplate != null && templateEditorMode === "none";
      }
      return true;
    }
    return true;
  }, [effectiveFileType, name, selectedTemplate, selectedTemplateId, step, templateEditorMode]);

  const renderedPreviewMethodOptions = getRenderedPreviewMethodOptions(effectiveFileType);

  function goToStep(next: WizardStepKey) { setSaveError(null); setStep(next); }

  function goNext() {
    const next = STEP_ORDER[stepIndexForKey(step) + 1]?.key;
    if (next) goToStep(next);
  }

  function goBack() {
    const prev = STEP_ORDER[stepIndexForKey(step) - 1]?.key;
    if (prev) goToStep(prev);
  }

  async function handleRunPreview() {
    if (!payloadConfig) return;
    if (!previewFile) {
      setPreviewError("Select a file to preview.");
      return;
    }
    setPreviewError(null);
    setPreviewResult(null);
    setPreviewLoading(true);
    try {
      const res = await previewFileTypeConfigDraft(payloadConfig, previewFile);
      setPreviewResult(res);
    } catch (err: any) {
      setPreviewError(err?.userMessage || err?.message || "Failed to preview extraction.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function buildTemplateConfigFromRules(): ParsingTemplateConfig {
    if (effectiveFileType === "xml") {
      const namespaces: Record<string, string> = {};
      for (const row of templateXmlNamespaces) {
        const prefix = String(row.prefix || "").trim();
        const uri = String(row.uri || "").trim();
        if (!prefix || !uri) continue;
        namespaces[prefix] = uri;
      }
      const raw = {
        block_xpath: normalizeTemplateRuleText(templateRuleBlockText),
        inline_xpath: normalizeTemplateRuleText(templateRuleInlineText),
        ignored_xpath: normalizeTemplateRuleText(templateRuleIgnoreText),
        namespaces,
        default_namespace_prefix: templateXmlDefaultNamespacePrefix.trim() || null,
        translate_attributes: templateXmlTranslateAttributes,
        attribute_allowlist: normalizeTemplateRuleText(templateXmlAttributeAllowlistText),
        treat_cdata_as_text: templateXmlTreatCdataAsText
      };
      return normalizeXmlParsingTemplateConfigForClient(raw);
    }

    const raw = {
      block_tags: normalizeTemplateRuleText(templateRuleBlockText),
      inline_tags: normalizeTemplateRuleText(templateRuleInlineText),
      ignored_tags: normalizeTemplateRuleText(templateRuleIgnoreText),
      translatable_attributes: {}
    };
    return normalizeParsingTemplateConfigForClient(raw);
  }

  useEffect(() => {
    if (templateEditorMode === "none") return;
    if (templateAdvancedJson) return;
    try {
      const cfg = buildTemplateConfigFromRules();
      setTemplateDraftJson(JSON.stringify(cfg, null, 2));
    } catch {
    }
  }, [
    effectiveFileType,
    templateAdvancedJson,
    templateEditorMode,
    templateRuleBlockText,
    templateRuleIgnoreText,
    templateRuleInlineText,
    templateXmlAttributeAllowlistText,
    templateXmlDefaultNamespacePrefix,
    templateXmlNamespaces,
    templateXmlTranslateAttributes,
    templateXmlTreatCdataAsText
  ]);

  function openCreateTemplate() {
    const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";
    resetTemplateDraft({ kind, config: kind === "xml" ? STARTER_XML_PARSING_TEMPLATE_CONFIG : STARTER_PARSING_TEMPLATE_CONFIG });
    setTemplateEditorMode("create");
  }

  function openUploadTemplate() {
    const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";
    resetTemplateDraft({ kind, config: kind === "xml" ? STARTER_XML_PARSING_TEMPLATE_CONFIG : STARTER_PARSING_TEMPLATE_CONFIG });
    setTemplateEditorMode("upload");
  }

  function openEditTemplate() {
    if (!selectedTemplate) return;
    resetTemplateDraft({
      kind: (selectedTemplate.kind as ParsingTemplateKind | undefined) ?? (effectiveFileType === "xml" ? "xml" : "html"),
      name: selectedTemplate.name,
      description: selectedTemplate.description,
      config: selectedTemplate.config
    });
    setTemplateEditorMode("edit");
  }

  async function closeTemplateEditor() {
    if (templateSaving || templateSourceUploadBusy) return;
    const uploadId = templateSourceUploadId;
    setTemplateEditorMode("none");
    setTemplateSourceUploadId(null);
    setTemplateSourceUploadBusy(false);
    setTemplateDraftOk(null);
    setTemplateDraftError(null);
    setTemplateSaveError(null);
    if (uploadId != null) {
      try {
        await deleteParsingTemplateUpload(uploadId);
      } catch {
        /* ignore */
      }
    }
  }

  function validateTemplateDraft(): { config: ParsingTemplateConfig } | { error: string } {
    const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";
    if (templateAdvancedJson) {
      return validateParsingTemplateJson(templateDraftJson, kind);
    }
    try {
      const cfg = buildTemplateConfigFromRules();
      if (kind === "xml") {
        const block = (cfg as any).block_xpath;
        if (!Array.isArray(block) || block.length === 0) {
          return { error: "Block XPath rules must not be empty." };
        }
      } else {
        const block = (cfg as any).block_tags;
        if (!Array.isArray(block) || block.length === 0) {
          return { error: "Block rules must not be empty." };
        }
      }
      setTemplateDraftJson(JSON.stringify(cfg, null, 2));
      return { config: cfg };
    } catch (err: any) {
      return { error: err?.message || "Invalid template rules." };
    }
  }

  function handleValidateTemplate() {
    setTemplateSaveError(null);
    const validated = validateTemplateDraft();
    if ("error" in validated) {
      setTemplateDraftError(validated.error);
      setTemplateDraftOk(false);
      return;
    }
    setTemplateDraftError(null);
    setTemplateDraftOk(true);
  }

  async function handleImportTemplateFile(file: File) {
    setTemplateSaveError(null);
    setTemplateDraftError(null);
    setTemplateDraftOk(null);

    const previousUploadId = templateSourceUploadId;
    if (previousUploadId != null) {
      try {
        await deleteParsingTemplateUpload(previousUploadId);
      } catch {
        /* ignore */
      }
      setTemplateSourceUploadId(null);
    }

    setTemplateSourceUploadBusy(true);
    try {
      const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";
      const uploaded = await uploadParsingTemplateJson(file, { kind });
      resetTemplateDraft({
        kind: uploaded.template.kind,
        name: uploaded.template.name,
        description: uploaded.template.description,
        config: uploaded.template.config
      });
      setTemplateSourceUploadId(uploaded.uploadId);
      setTemplateDraftOk(true);
    } catch (err: any) {
      setTemplateDraftError(err?.userMessage || err?.message || "Failed to import template JSON.");
      setTemplateDraftOk(false);
    } finally {
      setTemplateSourceUploadBusy(false);
    }
  }

  async function handleSaveTemplate() {
    setTemplateSaveError(null);
    const trimmedName = templateDraftName.trim();
    if (!trimmedName) {
      setTemplateSaveError("Template name is required.");
      return;
    }

    const validated = validateTemplateDraft();
    if ("error" in validated) {
      setTemplateDraftError(validated.error);
      setTemplateDraftOk(false);
      return;
    }
    setTemplateDraftError(null);
    setTemplateDraftOk(true);

    setTemplateSaving(true);
    try {
      const payload = {
        name: trimmedName,
        description: templateDraftDescription.trim() || undefined,
        config: validated.config,
        sourceUploadId: templateSourceUploadId ?? undefined
      };
      const kind: ParsingTemplateKind = effectiveFileType === "xml" ? "xml" : "html";

      const next =
        templateEditorMode === "edit"
          ? selectedTemplate
            ? await updateParsingTemplate(selectedTemplate.id, payload)
            : null
          : await createParsingTemplate({ ...payload, kind });

      if (!next) {
        setTemplateSaveError("No template selected to edit.");
        return;
      }

      setTemplates((prev) => {
        const merged = [...prev.filter((tpl) => tpl.id !== next.id), next];
        merged.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return merged;
      });

      if (effectiveFileType === "html") setHtmlCfg((prev) => ({ ...prev, parsingTemplateId: String(next.id) }));
      if (effectiveFileType === "xml") setXmlCfg((prev) => ({ ...prev, parsingTemplateId: String(next.id) }));

      setTemplateEditorMode("none");
      setTemplateSourceUploadId(null);
      setTemplateSourceUploadBusy(false);
    } catch (err: any) {
      setTemplateSaveError(err?.userMessage || err?.message || "Failed to save template.");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function handleDownloadTemplate() {
    if (!selectedTemplate) return;
    setTemplateSaveError(null);
    try {
      const blob = await downloadParsingTemplateJson(selectedTemplate.id);
      const safeName = String(selectedTemplate.name || "template").replace(/[^a-zA-Z0-9._-]/g, "_");
      triggerFileDownload(blob, `${safeName || "template"}-${selectedTemplate.id}.json`);
    } catch (err: any) {
      setTemplateSaveError(err?.userMessage || err?.message || "Failed to download template JSON.");
    }
  }

  async function refreshTemplates() {
    if (!effectiveFileType) return;
    if (effectiveFileType !== "html" && effectiveFileType !== "xml") return;
    if (templatesLoading) return;

    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const list = await listParsingTemplates({ kind: effectiveFileType });
      setTemplates(list);
      setTemplatesLoaded(true);
    } catch (err: any) {
      setTemplatesError(err?.userMessage || err?.message || "Failed to load extraction templates.");
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function handleViewSelectedTemplateJson() {
    if (!selectedTemplate) return;
    setTemplateSaveError(null);
    setViewTemplateJsonError(null);
    setViewTemplateJsonText("");
    setViewTemplateJsonOpen(true);
    setViewTemplateJsonLoading(true);
    try {
      const blob = await downloadParsingTemplateJson(selectedTemplate.id);
      const text = await blob.text();
      setViewTemplateJsonText(text);
    } catch (err: any) {
      setViewTemplateJsonError(err?.userMessage || err?.message || "Failed to load template JSON.");
    } finally {
      setViewTemplateJsonLoading(false);
    }
  }

  async function handleSaveConfig() {
    if (!payloadConfig) return;
    setSaveError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: trimmed,
        description: description.trim() || undefined,
        disabled,
        config: payloadConfig
      };

      const saved = isEdit && configId
        ? await updateFileTypeConfig(configId, payload)
        : await createFileTypeConfig(payload);

      nav("/resources/file-types", { state: { highlightId: saved.id } });
    } catch (err: any) {
      setSaveError(err?.userMessage || err?.message || "Failed to save file type configuration.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || loadError) {
    return <FileTypeConfigWizardPendingState loading={loading} loadError={loadError} onBack={() => nav("/resources/file-types")} />;
  }

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Resources / File Type Configurations"
        title={isEdit ? "Edit File Type Configuration" : "New File Type Configuration"}
        onCancel={() => nav("/resources/file-types")}
        cancelDisabled={saving}
        topActions={
          step === "review" ? (
            <button
              type="button"
              className="btn btn-primary fw-semibold"
              onClick={handleSaveConfig}
              disabled={saving || !payloadConfig}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          ) : null
        }
        steps={STEP_ORDER}
        currentStep={step}
        onStepSelect={goToStep}
        canSelectStep={(_key, index, currentIndex) => index < currentIndex}
        alerts={saveError ? <WarningBanner tone="error" messages={[saveError]} /> : null}
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button type="button" className="btn btn-outline-secondary" onClick={goBack} disabled={step === "type"}>
              Back
            </button>
            <button type="button" className="btn btn-dark" onClick={goNext} disabled={step === "review" || !canProceed}>
              Next
            </button>
          </div>
        }
      >
        {step === "type" && (
          <FileTypeConfigWizardTypeStep
            effectiveFileType={effectiveFileType}
            lockFileType={lockFileType}
            onSelect={(nextFileType) => {
              if (lockFileType) return;
              setFileType(nextFileType);
            }}
          />
        )}

        {step === "basics" && (
          <FileTypeConfigWizardBasicsStep
            name={name}
            setName={setName}
            disabled={disabled}
            setDisabled={setDisabled}
            agentDefault={agentDefault}
            setAgentDefault={setAgentDefault}
            supportsRenderedPreview={supportsRenderedPreview}
            setSupportsRenderedPreview={setSupportsRenderedPreview}
            renderedPreviewMethod={renderedPreviewMethod}
            setRenderedPreviewMethod={setRenderedPreviewMethod}
            renderedPreviewMethodOptions={renderedPreviewMethodOptions}
            renderedPreviewDefaultOn={renderedPreviewDefaultOn}
            setRenderedPreviewDefaultOn={setRenderedPreviewDefaultOn}
            effectiveFileType={effectiveFileType}
            xmlRenderedPreviewXsltTemplateId={xmlRenderedPreviewXsltTemplateId}
            setXmlRenderedPreviewXsltTemplateId={setXmlRenderedPreviewXsltTemplateId}
            xmlRenderedPreviewRendererProfileId={xmlRenderedPreviewRendererProfileId}
            setXmlRenderedPreviewRendererProfileId={setXmlRenderedPreviewRendererProfileId}
            description={description}
            setDescription={setDescription}
          />
        )}
        {step === "config" && (
          <FileTypeConfigWizardConfigStep
            {...{
              buildTemplateConfigFromRules,
              closeTemplateEditor,
              disabled,
              docxCfg,
              effectiveFileType,
              handleDownloadTemplate,
              handleImportTemplateFile,
              handleSaveTemplate,
              handleValidateTemplate,
              handleViewSelectedTemplateJson,
              htmlCfg,
              name,
              openCreateTemplate,
              openEditTemplate,
              pdfCfg,
              pptxCfg,
              resetTemplateDraft,
              selectedTemplate,
              selectedTemplateId,
              setDocxCfg,
              setHtmlCfg,
              setPdfCfg,
              setPptxCfg,
              setTemplateAdvancedJson,
              setTemplateDraftDescription,
              setTemplateDraftError,
              setTemplateDraftJson,
              setTemplateDraftName,
              setTemplateDraftOk,
              setTemplateEditorMode,
              setTemplateRuleBlockText,
              setTemplateRuleIgnoreText,
              setTemplateRuleInlineText,
              setTemplateRuleTab,
              setTemplateSaveError,
              setTemplateXmlAttributeAllowlistText,
              setTemplateXmlDefaultNamespacePrefix,
              setTemplateXmlNamespaces,
              setTemplateXmlTranslateAttributes,
              setTemplateXmlTreatCdataAsText,
              setViewTemplateJsonOpen,
              setXlsxCfg,
              setXmlCfg,
              templateAdvancedJson,
              templateDraftDescription,
              templateDraftError,
              templateDraftJson,
              templateDraftName,
              templateDraftOk,
              templateEditorMode,
              templateRuleBlockText,
              templateRuleIgnoreText,
              templateRuleInlineText,
              templateRuleTab,
              templates,
              templateSaveError,
              templateSaving,
              templatesError,
              templatesLoaded,
              templatesLoading,
              templateSourceUploadBusy,
              templateUploadInputRef,
              templateXmlAttributeAllowlistText,
              templateXmlDefaultNamespacePrefix,
              templateXmlNamespaces,
              templateXmlTranslateAttributes,
              templateXmlTreatCdataAsText,
              viewTemplateJsonError,
              viewTemplateJsonLoading,
              viewTemplateJsonOpen,
              viewTemplateJsonText,
              xlsxCfg,
              xmlCfg,
              previewResult,
              previewShowTags,
              setPreviewShowTags,
            }}
          />
        )}

        {step === "preview" && (
          <FileTypeConfigWizardPreviewStep
            setPreviewFile={setPreviewFile}
            handleRunPreview={handleRunPreview}
            previewLoading={previewLoading}
            payloadConfig={payloadConfig}
            previewError={previewError}
            previewResult={previewResult}
            previewShowTags={previewShowTags}
            setPreviewShowTags={setPreviewShowTags}
          />
        )}
        {step === "review" && (
          <FileTypeConfigWizardReviewStep
            payloadConfig={payloadConfig}
            disabled={disabled}
            agentDefault={agentDefault}
            name={name}
            supportsRenderedPreview={supportsRenderedPreview}
            renderedPreviewMethod={renderedPreviewMethod}
            renderedPreviewDefaultOn={renderedPreviewDefaultOn}
            xmlRenderedPreviewXsltTemplateId={xmlRenderedPreviewXsltTemplateId}
            xmlRenderedPreviewRendererProfileId={xmlRenderedPreviewRendererProfileId}
            selectedTemplate={selectedTemplate}
            htmlCfg={htmlCfg}
            xmlCfg={xmlCfg}
            pdfCfg={pdfCfg}
            docxCfg={docxCfg}
            pptxCfg={pptxCfg}
            xlsxCfg={xlsxCfg}
            previewResult={previewResult}
          />
        )}
      </WizardShell>
    </div>
  );
}

