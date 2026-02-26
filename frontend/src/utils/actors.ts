export function isOpaqueIdentifier(value: string) {
  const raw = value.trim();
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    return true;
  }
  return false;
}

export function formatActorLabel(
  value: string | null | undefined,
  userLabelMap: Record<string, string>,
  options?: { unknownLabel?: string }
) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const mapped = userLabelMap[raw];
  if (mapped) return mapped;
  if (isOpaqueIdentifier(raw)) return options?.unknownLabel ?? "unknown user";
  return raw;
}

