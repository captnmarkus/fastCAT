import React from "react";
import type { ProjectCardMeta } from "../../../../types/app";
import BadgePill from "../../../../components/ui/BadgePill";

export default function StatusPill({ label, tone }: { label: string; tone: ProjectCardMeta["tone"] }) {
  const mappedTone = tone === "success" ? "success" : tone === "danger" ? "danger" : tone === "warning" ? "warning" : "ready";
  return <BadgePill tone={mappedTone}>{label}</BadgePill>;
}
