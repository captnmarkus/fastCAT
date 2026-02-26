export type InsertResult = {
  nextValue: string;
  nextCursor: number;
};

export function insertAtSelection(
  value: string,
  insertText: string,
  selectionStart?: number | null,
  selectionEnd?: number | null
): InsertResult {
  const safeValue = String(value ?? "");
  const insertValue = String(insertText ?? "");
  if (!insertValue) {
    return { nextValue: safeValue, nextCursor: Math.max(0, safeValue.length) };
  }

  const len = safeValue.length;
  const startRaw = typeof selectionStart === "number" ? selectionStart : len;
  const endRaw = typeof selectionEnd === "number" ? selectionEnd : startRaw;
  const start = Math.min(Math.max(startRaw, 0), len);
  const end = Math.min(Math.max(endRaw, start), len);
  const nextValue = safeValue.slice(0, start) + insertValue + safeValue.slice(end);
  const nextCursor = start + insertValue.length;

  return { nextValue, nextCursor };
}
