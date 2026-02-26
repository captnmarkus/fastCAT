export function clearTimeoutRef(ref: { current: ReturnType<typeof window.setTimeout> | null }) {
  if (ref.current == null) return;
  window.clearTimeout(ref.current);
  ref.current = null;
}
