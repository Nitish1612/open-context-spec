import type { Tokenizer } from "./tokenizer.js";

/**
 * Shortens `text` (via binary search over slice length, assuming the
 * tokenizer is non-decreasing in text length — true for the default
 * heuristic and every real subword tokenizer) so it fits within
 * `maxTokens`, appending an ellipsis. Returns "" if even one character
 * doesn't fit.
 */
export function truncateToTokens(text: string, maxTokens: number, tokenizer: Tokenizer): string {
  if (maxTokens <= 0) return "";
  if (tokenizer(text) <= maxTokens) return text;

  const suffix = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + suffix;
    if (tokenizer(candidate) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo === 0 ? "" : text.slice(0, lo) + suffix;
}
