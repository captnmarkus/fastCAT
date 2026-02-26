export function parsePositiveInt(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveByNumericId<T extends { id: number }>(
  items: readonly T[],
  value: unknown
): T | null {
  const id = parsePositiveInt(value);
  if (id == null) return null;
  return items.find((item) => item.id === id) ?? null;
}
