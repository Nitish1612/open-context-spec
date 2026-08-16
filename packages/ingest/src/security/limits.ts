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

/**
 * Runs `fn` under a timeout, rejecting with a clear error rather than
 * hanging. If `fn`'s promise settles *after* the timeout has already
 * fired, its result/rejection is swallowed (attached with a no-op catch)
 * rather than left as an unhandled rejection — the caller only ever sees
 * the timeout outcome, and the late settlement can never mutate anything
 * the caller already moved on from.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const inner = fn();
    return await Promise.race([
      inner.catch((error: unknown) => {
        if (timedOut) return undefined as never; // already resolved via timeout path below; swallow
        throw error;
      }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          // Prevent an unhandled-rejection warning if `inner` later rejects.
          inner.catch(() => undefined);
          reject(
            new SecurityRejectionError(`${label} timed out after ${timeoutMs}ms.`, { timeoutMs }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Combines multiple `AbortSignal`s into one that fires when any of them
 * fires, preserving whichever signal's `reason` triggered it — without
 * requiring Node 20's `AbortSignal.any` (this package supports Node
 * 18.18+). Call `dispose()` once the combined signal is no longer needed
 * to remove the listeners it registered on the source signals.
 */
export function combineSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  const listeners: Array<[AbortSignal, () => void]> = [];
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    const handler = () => {
      if (!controller.signal.aborted) controller.abort(s.reason);
    };
    s.addEventListener("abort", handler, { once: true });
    listeners.push([s, handler]);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const [s, handler] of listeners) s.removeEventListener("abort", handler);
    },
  };
}
