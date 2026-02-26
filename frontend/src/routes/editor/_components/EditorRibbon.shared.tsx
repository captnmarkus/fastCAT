import React from "react";
import { RIBBON_ICONS } from "../state/homeRibbonCommands";

export type TabKey = "home" | "view";

export type RibbonAction = {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  enabled: boolean;
  implemented: boolean;
  pressed?: boolean;
  toggle?: boolean;
  tooltip?: string;
};

type RibbonButtonProps = {
  action: RibbonAction;
  className?: string;
  size?: "normal" | "large";
  variant?: "ribbon" | "menu";
  showCaret?: boolean;
  hideLabel?: boolean;
};

const NOT_IMPLEMENTED = "Not implemented";

export const HOME_OVERFLOW_ORDER: Array<
  "insert" | "translation" | "formatting" | "history" | "clipboard"
> = ["insert", "translation", "formatting", "history", "clipboard"];
export const VIEW_OVERFLOW_ORDER: Array<
  | "layout"
  | "navigation"
  | "fonts"
  | "tags"
  | "lookups"
  | "theme"
  | "preview"
  | "settings"
> = ["settings", "preview", "theme", "lookups", "tags", "fonts", "navigation", "layout"];

export const TOKEN_SPLIT_RE = /(<\/?\d+>|<\/?(?:b|strong|i|em|u)>)/gi;
export const TOKEN_TEST_RE = /^<\/?\d+>$|^<\/?(?:b|strong|i|em|u)>$/i;

export type SymbolItem = {
  label: string;
  value: string;
  title?: string;
  kind?: "space";
};

export type SymbolCategory = {
  id: string;
  label: string;
  symbols: SymbolItem[];
};

export const BASE_SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    id: "typography",
    label: "Typography",
    symbols: [
      { label: "\u201c", value: "\u201c" },
      { label: "\u201d", value: "\u201d" },
      { label: "\u2018", value: "\u2018" },
      { label: "\u2019", value: "\u2019" },
      { label: "\u00ab", value: "\u00ab" },
      { label: "\u00bb", value: "\u00bb" },
      { label: "\u2026", value: "\u2026" },
      { label: "\u2013", value: "\u2013" },
      { label: "\u2014", value: "\u2014" },
      { label: "\u2022", value: "\u2022" },
      { label: "\u00b7", value: "\u00b7" }
    ]
  },
  {
    id: "math",
    label: "Math",
    symbols: [
      { label: "\u00b1", value: "\u00b1" },
      { label: "\u00d7", value: "\u00d7" },
      { label: "\u00f7", value: "\u00f7" },
      { label: "\u2260", value: "\u2260" },
      { label: "\u2264", value: "\u2264" },
      { label: "\u2265", value: "\u2265" },
      { label: "\u2248", value: "\u2248" },
      { label: "\u221e", value: "\u221e" },
      { label: "\u221a", value: "\u221a" }
    ]
  },
  {
    id: "arrows",
    label: "Arrows",
    symbols: [
      { label: "\u2190", value: "\u2190" },
      { label: "\u2192", value: "\u2192" },
      { label: "\u2194", value: "\u2194" },
      { label: "\u2191", value: "\u2191" },
      { label: "\u2193", value: "\u2193" }
    ]
  },
  {
    id: "currency",
    label: "Currency",
    symbols: [
      { label: "\u20ac", value: "\u20ac" },
      { label: "\u00a3", value: "\u00a3" },
      { label: "$", value: "$" },
      { label: "\u00a5", value: "\u00a5" }
    ]
  },
  {
    id: "units",
    label: "Units",
    symbols: [
      { label: "\u00b0", value: "\u00b0" },
      { label: "\u00b5", value: "\u00b5" },
      { label: "\u03a9", value: "\u03a9" }
    ]
  },
  {
    id: "legal",
    label: "Legal",
    symbols: [
      { label: "\u00a9", value: "\u00a9" },
      { label: "\u00ae", value: "\u00ae" },
      { label: "\u2122", value: "\u2122" }
    ]
  },
  {
    id: "spaces",
    label: "Spaces",
    symbols: [
      { label: "\u237d", value: "\u00a0", title: "Non-breaking space", kind: "space" },
      { label: "\u2009", value: "\u2009", title: "Thin space", kind: "space" }
    ]
  }
];

export function overflowCountForWidth(width: number): number {
  if (width < 860) return 5;
  if (width < 980) return 4;
  if (width < 1100) return 3;
  if (width < 1220) return 2;
  if (width < 1340) return 1;
  return 0;
}

export function tooltipFor(action: RibbonAction): string {
  if (!action.implemented) return NOT_IMPLEMENTED;
  return action.tooltip ?? action.label;
}

export function getTokenRanges(text: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  const rx = /(<\/?\d+>|<\/?(?:b|strong|i|em|u)>)/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

export function normalizeTokenAwareSelection(text: string, start: number, end: number) {
  let from = Math.min(start, end);
  let to = Math.max(start, end);
  const ranges = getTokenRanges(text);
  const isCollapsed = start === end;

  if (isCollapsed) {
    for (const range of ranges) {
      if (from > range.start && from < range.end) {
        return { start: range.end, end: range.end };
      }
    }
  }

  for (const range of ranges) {
    if (from > range.start && from < range.end) from = range.start;
    if (to > range.start && to < range.end) to = range.end;
  }

  return { start: from, end: to };
}

export function RibbonButton({
  action,
  className,
  size = "normal",
  variant = "ribbon",
  showCaret = false,
  hideLabel = false
}: RibbonButtonProps) {
  const classes = [
    "fc-ribbon-button",
    size === "large" ? "is-large" : "",
    variant === "menu" ? "is-menu" : "",
    action.pressed ? "is-pressed" : "",
    showCaret ? "has-caret" : "",
    className || ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      onClick={action.onClick}
      disabled={!action.enabled}
      aria-label={action.label}
      aria-pressed={action.toggle ? Boolean(action.pressed) : undefined}
      title={tooltipFor(action)}
    >
      <span className="fc-ribbon-icon">{action.icon}</span>
      <span className={hideLabel ? "visually-hidden" : "fc-ribbon-label"}>
        {action.label}
      </span>
      {showCaret ? (
        <span className="fc-ribbon-caret" aria-hidden="true">
          {RIBBON_ICONS.caret}
        </span>
      ) : null}
    </button>
  );
}

export function RibbonSplitButton({
  main,
  secondary,
  className
}: {
  main: RibbonAction;
  secondary: RibbonAction;
  className?: string;
}) {
  return (
    <div
      className={["fc-ribbon-split", className || ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={main.label}
    >
      <RibbonButton action={main} className="fc-ribbon-split-main" />
      <RibbonButton action={secondary} className="fc-ribbon-split-caret" hideLabel />
    </div>
  );
}
