import { SecurityRejectionError } from "../errors.js";
import type { ResourceLimits } from "../types.js";
import { DEFAULT_LIMITS } from "../types.js";

export function resolveLimits(overrides?: Partial<ResourceLimits>): ResourceLimits {
  if (!overrides) return DEFAULT_LIMITS;
  // Merge key-by-key so an explicit `undefined` in `overrides` (easy to
  // produce when a caller forwards optional CLI flags unconditionally)
  // falls back to the default instead of blanking it out via spread.
  const merged = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(overrides) as Array<keyof ResourceLimits>) {
    const value = overrides[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export function assertWithinByteLimit(byteLength: number, max: number, label: string): void {
  if (byteLength > max) {
    throw new SecurityRejectionError(
      `${label} (${byteLength} bytes) exceeds the maximum allowed size (${max} bytes).`,
      { byteLength, max, label },
    );
  }
}

export function assertWithinCharLimit(length: number, max: number, label: string): void {
  if (length > max) {
    throw new SecurityRejectionError(
      `${label} (${length} characters) exceeds the maximum allowed length (${max} characters).`,
      { length, max, label },
    );
  }
}

export function assertWithinCount(count: number, max: number, label: string): void {
  if (count > max) {
    throw new SecurityRejectionError(
      `${label} (${count}) exceeds the maximum allowed count (${max}).`,
      { count, max, label },
    );
  }
}

/**
 * Guards against zip-bomb / decompression-bomb archives (used for
 * docx/pptx/xlsx, which are zip containers): rejects archives with too many
 * entries, too much total uncompressed content, or a suspiciously high
 * compression ratio on any single entry.
 */
export function assertSafeArchive(
  entries: Array<{ name: string; compressedSize: number; uncompressedSize: number }>,
  limits: ResourceLimits,
): void {
  assertWithinCount(entries.length, limits.maxArchiveEntries, "Archive entry count");

  let totalUncompressed = 0;
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (entry.compressedSize > 0) {
      const ratio = entry.uncompressedSize / entry.compressedSize;
      if (ratio > limits.maxCompressionRatio) {
        throw new SecurityRejectionError(
          `Archive entry "${entry.name}" has a compression ratio of ${ratio.toFixed(1)}x, exceeding the maximum allowed ratio of ${limits.maxCompressionRatio}x (possible decompression bomb).`,
          { entry: entry.name, ratio, max: limits.maxCompressionRatio },
        );
      }
    }
  }
  assertWithinByteLimit(
    totalUncompressed,
    limits.maxArchiveUncompressedBytes,
    "Archive total uncompressed size",
  );
}

/** Runs `fn` under a timeout, rejecting with a clear error rather than hanging. */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SecurityRejectionError(`${label} timed out after ${timeoutMs}ms.`, { timeoutMs }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
