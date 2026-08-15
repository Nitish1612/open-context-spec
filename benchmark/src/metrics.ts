import { approxChar4Tokenizer } from "@ulcs/compiler";

export function estimatedTokens(text: string): number {
  return approxChar4Tokenizer(text);
}

/** Fraction (0-1) of `expectedSubstrings` found verbatim in `text`. Honest, exact-substring matching — no fuzzy credit. */
export function substringCoverage(text: string, expectedSubstrings: string[]): number {
  if (expectedSubstrings.length === 0) return 1;
  const found = expectedSubstrings.filter((s) => text.includes(s));
  return found.length / expectedSubstrings.length;
}

export interface TimedResult<T> {
  value: T;
  elapsedMs: number;
}

/** Wall-clock timing on this machine, for this run — not a claim about production latency. */
export function timed<T>(fn: () => T): TimedResult<T> {
  const start = performance.now();
  const value = fn();
  const elapsedMs = performance.now() - start;
  return { value, elapsedMs };
}
