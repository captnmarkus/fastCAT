import React from "react";

export type BadgePillTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "ready"
  | "draft"
  | "reviewed"
  | "overdue";

type BadgePillProps = {
  children: React.ReactNode;
  tone?: BadgePillTone;
} & React.HTMLAttributes<HTMLSpanElement>;

const TONE_CLASS: Record<BadgePillTone, string> = {
  neutral: "is-neutral",
  info: "is-info",
  success: "is-success",
  warning: "is-warning",
  danger: "is-danger",
  ready: "is-ready",
  draft: "is-draft",
  reviewed: "is-reviewed",
  overdue: "is-overdue"
};

export default function BadgePill({ children, tone = "neutral", className = "", ...rest }: BadgePillProps) {
  const toneClass = TONE_CLASS[tone] || TONE_CLASS.neutral;
  const composed = className ? `fc-pill ${toneClass} ${className}` : `fc-pill ${toneClass}`;
  return (
    <span className={composed} {...rest}>
      {children}
    </span>
  );
}
