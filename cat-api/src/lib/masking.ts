export function maskApiKey(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : "";
  const prefix = trimmed.startsWith("sk-") ? "sk-" : "";
  return `${prefix}****${last4 || "****"}`;
}

export function maskBaseUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const host = url.host;
    if (!host) return "stored";
    return `${url.protocol}//${host}/...`;
  } catch {
    return "stored";
  }
}
