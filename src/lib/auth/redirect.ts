/** Return only a same-origin absolute path suitable for client navigation. */
export function safeNextPath(
  value: string | null,
  fallback = "/workspace",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  return value;
}
