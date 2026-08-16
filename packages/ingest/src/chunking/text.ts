/** Low-level text-splitting primitives shared by every chunking strategy. */

/** Splits on blank-line boundaries (one or more consecutive newlines), trimming empty results. */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Splits on sentence-ending punctuation followed by whitespace, with a
 * simple guard against common abbreviations. Not linguistically exhaustive
 * — good enough for chunk-boundary selection, not for NLP-grade sentence
 * segmentation.
 */
export function splitIntoSentences(text: string): string[] {
  const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|Inc|Ltd|Co)\.$/i;
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'([])/);
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && ABBREVIATIONS.test(prev)) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Moves a naive character cut point backward if it would land inside a UTF-16 surrogate pair. */
function adjustForSurrogatePair(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  const code = text.charCodeAt(index - 1);
  const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
  return isHighSurrogate ? index - 1 : index;
}

/**
 * Splits `text` into fixed-size (by character count) windows with overlap.
 * Cut points are adjusted to never split a UTF-16 surrogate pair. Prefers
 * breaking on whitespace near the boundary when `preferBoundary` is set, to
 * avoid slicing mid-word.
 */
export function splitByCharacters(
  text: string,
  maxChars: number,
  overlap: number,
  preferBoundary = true,
): string[] {
  if (text.length <= maxChars) return text.length > 0 ? [text] : [];
  const chunks: string[] = [];
  let start = 0;
  const step = Math.max(1, maxChars - overlap);

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    end = adjustForSurrogatePair(text, end);

    if (preferBoundary && end < text.length) {
      const window = text.slice(start, end);
      const lastBreak = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
      if (lastBreak > maxChars * 0.5) {
        end = start + lastBreak;
      }
    }

    const slice = text.slice(start, end).trim();
    if (slice.length > 0) chunks.push(slice);

    if (end >= text.length) break;
    const nextStart = end - overlap;
    start = nextStart > start ? adjustForSurrogatePair(text, nextStart) : start + step;
  }

  return chunks;
}

/**
 * Packs an ordered list of atomic units (paragraphs, sentences, rows, ...)
 * into windows of at most `maxChars`, never splitting an individual unit.
 * A single unit longer than `maxChars` becomes its own oversized window.
 */
export function packUnits(units: string[], maxChars: number, separator = "\n\n"): string[] {
  const windows: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const unit of units) {
    const addedLength = current.length > 0 ? separator.length + unit.length : unit.length;
    if (current.length > 0 && currentLength + addedLength > maxChars) {
      windows.push(current.join(separator));
      current = [];
      currentLength = 0;
    }
    current.push(unit);
    currentLength += current.length > 1 ? separator.length + unit.length : unit.length;
  }
  if (current.length > 0) windows.push(current.join(separator));
  return windows;
}
