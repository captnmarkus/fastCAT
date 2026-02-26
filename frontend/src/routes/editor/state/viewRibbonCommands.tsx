import React from "react";
import { RIBBON_ICONS } from "./homeRibbonCommands";

export const TEXT_ZOOM_MIN = 80;
export const TEXT_ZOOM_MAX = 140;
export const TEXT_ZOOM_STEP = 10;

export type ViewRibbonCommandState = {
  hasSegments: boolean;
  layoutMode: "horizontal" | "vertical";
  showNavigation: boolean;
  showDocumentStructure: boolean;
  documentStructureSupported: boolean;
  textZoomEnabled: boolean;
  textZoom: number;
  showTags: boolean;
  showTagDetails: boolean;
  lookupsFilter: "all" | "terms" | "tm" | "mt";
  lookupsView: "detailed" | "compact";
  themeMode: "light" | "dark" | "auto";
  themeSupported: boolean;
  previewMode: "off" | "split" | "on";
  previewSupported: boolean;
  optionsSupported: boolean;
};

export type ViewRibbonCommandContext = {
  setLayoutMode: React.Dispatch<React.SetStateAction<"horizontal" | "vertical">>;
  setShowNavigation: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDocumentStructure: React.Dispatch<React.SetStateAction<boolean>>;
  setTextZoomEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setTextZoom: React.Dispatch<React.SetStateAction<number>>;
  setShowTags: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTagDetails: React.Dispatch<React.SetStateAction<boolean>>;
  setLookupsFilter: React.Dispatch<React.SetStateAction<"all" | "terms" | "tm" | "mt">>;
  setLookupsView: React.Dispatch<React.SetStateAction<"detailed" | "compact">>;
  setThemeMode: React.Dispatch<React.SetStateAction<"light" | "dark" | "auto">>;
  setPreviewMode: React.Dispatch<React.SetStateAction<"off" | "split" | "on">>;
  openOptions: () => void;
};

export type ViewRibbonCommand = {
  id: string;
  label: string | ((state: ViewRibbonCommandState) => string);
  icon: React.ReactNode;
  enabled: (state: ViewRibbonCommandState) => boolean;
  disabledReason?: (state: ViewRibbonCommandState) => string | undefined;
  run: (ctx: ViewRibbonCommandContext) => void;
  toggle?: boolean;
  pressed?: (state: ViewRibbonCommandState) => boolean;
};

export const VIEW_RIBBON_COMMANDS: Record<string, ViewRibbonCommand> = {
  layoutVertical: {
    id: "layoutVertical",
    label: "Vertical",
    icon: RIBBON_ICONS.layoutVertical,
    enabled: () => true,
    run: (ctx) => ctx.setLayoutMode("vertical"),
    toggle: true,
    pressed: (state) => state.layoutMode === "vertical"
  },
  layoutHorizontal: {
    id: "layoutHorizontal",
    label: "Horizontal",
    icon: RIBBON_ICONS.layoutHorizontal,
    enabled: () => true,
    run: (ctx) => ctx.setLayoutMode("horizontal"),
    toggle: true,
    pressed: (state) => state.layoutMode === "horizontal"
  },
  showNavigation: {
    id: "showNavigation",
    label: "Show Navigation",
    icon: RIBBON_ICONS.navigationPane,
    enabled: (state) => state.hasSegments,
    disabledReason: (state) =>
      state.hasSegments ? undefined : "Navigation not available until segments are loaded.",
    run: (ctx) => ctx.setShowNavigation((prev) => !prev),
    toggle: true,
    pressed: (state) => state.showNavigation
  },
  showDocumentStructure: {
    id: "showDocumentStructure",
    label: "Show Document Structure",
    icon: RIBBON_ICONS.documentStructure,
    enabled: (state) => state.documentStructureSupported && state.hasSegments,
    disabledReason: (state) =>
      !state.documentStructureSupported
        ? "Document structure not available for this file type."
        : !state.hasSegments
        ? "Document structure not available until segments are loaded."
        : undefined,
    run: (ctx) => ctx.setShowDocumentStructure((prev) => !prev),
    toggle: true,
    pressed: (state) => state.showDocumentStructure && state.documentStructureSupported
  },
  enableTextZoom: {
    id: "enableTextZoom",
    label: "Enable Text Zoom",
    icon: RIBBON_ICONS.textZoom,
    enabled: () => true,
    run: (ctx) => ctx.setTextZoomEnabled((prev) => !prev),
    toggle: true,
    pressed: (state) => state.textZoomEnabled
  },
  zoomLarger: {
    id: "zoomLarger",
    label: "Larger",
    icon: RIBBON_ICONS.fontBigger,
    enabled: (state) => state.textZoomEnabled && state.textZoom < TEXT_ZOOM_MAX,
    disabledReason: (state) => {
      if (!state.textZoomEnabled) return "Enable text zoom to adjust.";
      if (state.textZoom >= TEXT_ZOOM_MAX) return "Maximum zoom reached.";
      return undefined;
    },
    run: (ctx) => ctx.setTextZoom((prev) => Math.min(TEXT_ZOOM_MAX, prev + TEXT_ZOOM_STEP))
  },
  zoomSmaller: {
    id: "zoomSmaller",
    label: "Smaller",
    icon: RIBBON_ICONS.fontSmaller,
    enabled: (state) => state.textZoomEnabled && state.textZoom > TEXT_ZOOM_MIN,
    disabledReason: (state) => {
      if (!state.textZoomEnabled) return "Enable text zoom to adjust.";
      if (state.textZoom <= TEXT_ZOOM_MIN) return "Minimum zoom reached.";
      return undefined;
    },
    run: (ctx) => ctx.setTextZoom((prev) => Math.max(TEXT_ZOOM_MIN, prev - TEXT_ZOOM_STEP))
  },
  showFormattingTags: {
    id: "showFormattingTags",
    label: "Show Formatting Tags",
    icon: RIBBON_ICONS.tags,
    enabled: () => true,
    run: (ctx) => ctx.setShowTags((prev) => !prev),
    toggle: true,
    pressed: (state) => state.showTags
  },
  showTagDetails: {
    id: "showTagDetails",
    label: "Show Tag Details",
    icon: RIBBON_ICONS.tagDetails,
    enabled: (state) => state.showTags,
    disabledReason: () => "Enable formatting tags to see details.",
    run: (ctx) => ctx.setShowTagDetails((prev) => !prev),
    toggle: true,
    pressed: (state) => state.showTags && state.showTagDetails
  },
  filterLookups: {
    id: "filterLookups",
    label: "Filter Lookups",
    icon: RIBBON_ICONS.filterLookups,
    enabled: () => true,
    run: () => {}
  },
  filterLookupsAll: {
    id: "filterLookupsAll",
    label: "All",
    icon: RIBBON_ICONS.filterLookups,
    enabled: () => true,
    run: (ctx) => ctx.setLookupsFilter("all"),
    pressed: (state) => state.lookupsFilter === "all"
  },
  filterLookupsTerms: {
    id: "filterLookupsTerms",
    label: "Terms only",
    icon: RIBBON_ICONS.filterLookups,
    enabled: () => true,
    run: (ctx) => ctx.setLookupsFilter("terms"),
    pressed: (state) => state.lookupsFilter === "terms"
  },
  filterLookupsTm: {
    id: "filterLookupsTm",
    label: "TM only",
    icon: RIBBON_ICONS.filterLookups,
    enabled: () => true,
    run: (ctx) => ctx.setLookupsFilter("tm"),
    pressed: (state) => state.lookupsFilter === "tm"
  },
  filterLookupsMt: {
    id: "filterLookupsMt",
    label: "MT only",
    icon: RIBBON_ICONS.filterLookups,
    enabled: () => true,
    run: (ctx) => ctx.setLookupsFilter("mt"),
    pressed: (state) => state.lookupsFilter === "mt"
  },
  alternativeView: {
    id: "alternativeView",
    label: "Alternative View",
    icon: RIBBON_ICONS.alternativeView,
    enabled: () => true,
    run: (ctx) =>
      ctx.setLookupsView((prev) => (prev === "compact" ? "detailed" : "compact")),
    toggle: true,
    pressed: (state) => state.lookupsView === "compact"
  },
  theme: {
    id: "theme",
    label: (state) => (state.themeMode === "dark" ? "Dark" : state.themeMode === "auto" ? "Auto" : "Light"),
    icon: RIBBON_ICONS.themeLight,
    enabled: (state) => state.themeSupported,
    disabledReason: () => "Theme switching not available.",
    run: () => {}
  },
  themeLight: {
    id: "themeLight",
    label: "Light",
    icon: RIBBON_ICONS.themeLight,
    enabled: (state) => state.themeSupported,
    disabledReason: () => "Theme switching not available.",
    run: (ctx) => ctx.setThemeMode("light"),
    pressed: (state) => state.themeMode === "light"
  },
  themeDark: {
    id: "themeDark",
    label: "Dark",
    icon: RIBBON_ICONS.themeLight,
    enabled: (state) => state.themeSupported,
    disabledReason: () => "Theme switching not available.",
    run: (ctx) => ctx.setThemeMode("dark"),
    pressed: (state) => state.themeMode === "dark"
  },
  themeAuto: {
    id: "themeAuto",
    label: "Auto",
    icon: RIBBON_ICONS.themeLight,
    enabled: (state) => state.themeSupported,
    disabledReason: () => "Theme switching not available.",
    run: (ctx) => ctx.setThemeMode("auto"),
    pressed: (state) => state.themeMode === "auto"
  },
  preview: {
    id: "preview",
    label: (state) =>
      state.previewMode === "split"
        ? "Preview Split"
        : state.previewMode === "on"
        ? "Preview On"
        : "Preview Off",
    icon: RIBBON_ICONS.preview,
    enabled: (state) => state.previewSupported,
    disabledReason: (state) =>
      state.previewSupported ? undefined : "Preview not available until segments are loaded.",
    run: () => {}
  },
  previewOff: {
    id: "previewOff",
    label: "Preview Off",
    icon: RIBBON_ICONS.preview,
    enabled: (state) => state.previewSupported,
    disabledReason: (state) =>
      state.previewSupported ? undefined : "Preview not available until segments are loaded.",
    run: (ctx) => ctx.setPreviewMode("off"),
    pressed: (state) => state.previewMode === "off"
  },
  previewSplit: {
    id: "previewSplit",
    label: "Preview Split",
    icon: RIBBON_ICONS.preview,
    enabled: (state) => state.previewSupported,
    disabledReason: (state) =>
      state.previewSupported ? undefined : "Preview not available until segments are loaded.",
    run: (ctx) => ctx.setPreviewMode("split"),
    pressed: (state) => state.previewMode === "split"
  },
  previewOn: {
    id: "previewOn",
    label: "Preview On",
    icon: RIBBON_ICONS.preview,
    enabled: (state) => state.previewSupported,
    disabledReason: (state) =>
      state.previewSupported ? undefined : "Preview not available until segments are loaded.",
    run: (ctx) => ctx.setPreviewMode("on"),
    pressed: (state) => state.previewMode === "on"
  },
  options: {
    id: "options",
    label: "Options",
    icon: RIBBON_ICONS.settings,
    enabled: (state) => state.optionsSupported,
    disabledReason: () => "Options panel not available.",
    run: (ctx) => ctx.openOptions()
  }
};
