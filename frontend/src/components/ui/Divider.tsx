import React from "react";

type DividerProps = {
  orientation?: "horizontal" | "vertical";
  className?: string;
};

export default function Divider({ orientation = "horizontal", className = "" }: DividerProps) {
  const orientationClass = orientation === "vertical" ? "is-vertical" : "is-horizontal";
  const composed = className ? `fc-divider ${orientationClass} ${className}` : `fc-divider ${orientationClass}`;
  return <span className={composed} role="separator" aria-orientation={orientation} />;
}
