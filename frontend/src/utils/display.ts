export function humanizeSample(filename?: string | null) {
  if (!filename) return "";
  const base = filename.replace(/\.[^/.]+$/, "");
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
