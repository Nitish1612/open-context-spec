/**
 * Deep clone via structuredClone when available, falling back to
 * JSON round-tripping. Every core function uses this instead of mutating
 * caller-supplied data.
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
