import { shortHash } from "@ulcs/core";
import type {
  Chunk,
  ChunkStrategy,
  ChunkingOptions,
  ExtractedDocument,
  ExtractedSection,
} from "../types.js";
import { DEFAULT_CHUNKING } from "../types.js";
import { groupSections, packSectionsIntoWindows, splitOversizedContent } from "./structured.js";
import { packUnits, splitByCharacters, splitIntoParagraphs, splitIntoSentences } from "./text.js";

export interface PendingChunk {
  content: string;
  section: ExtractedSection | undefined;
  locator: Pick<
    ExtractedSection,
    "page" | "slide" | "sheet" | "rowStart" | "rowEnd" | "section" | "title"
  >;
}

function resolveAutoStrategy(sections: ExtractedSection[]): ChunkStrategy {
  if (sections.some((s) => s.page !== undefined)) return "pages";
  if (sections.some((s) => s.slide !== undefined)) return "slides";
  if (sections.some((s) => s.rowStart !== undefined)) return "rows";
  if (sections.filter((s) => s.section || s.title).length > 1) return "sections";
  return "paragraphs";
}

function chunkStructural(
  sections: ExtractedSection[],
  strategy: ChunkStrategy,
  opts: ChunkingOptions,
): PendingChunk[] {
  const groups = groupSections(sections, strategy);
  const pending: PendingChunk[] = [];

  for (const group of groups) {
    const windows = packSectionsIntoWindows(group.sections, opts.maxChars);
    for (const window of windows) {
      const first = window.sections[0];
      const last = window.sections[window.sections.length - 1];
      const locator = {
        page: first?.page,
        slide: first?.slide,
        sheet: first?.sheet,
        rowStart: first?.rowStart,
        rowEnd: last?.rowEnd ?? last?.rowStart,
        section: first?.section,
        title: first?.title,
      };

      // "rows" must never split an individual section, even if it alone
      // overflows maxChars — every other structural strategy may
      // sub-split an oversized single-section window.
      if (
        window.sections.length === 1 &&
        window.content.length > opts.maxChars &&
        strategy !== "rows"
      ) {
        for (const piece of splitOversizedContent(window.content, opts.maxChars, opts.overlap)) {
          pending.push({ content: piece, section: first, locator });
        }
      } else {
        pending.push({ content: window.content, section: first, locator });
      }
    }
  }
  return pending;
}

function chunkTextStrategy(
  sections: ExtractedSection[],
  strategy: "paragraphs" | "sentences",
  opts: ChunkingOptions,
): PendingChunk[] {
  const pending: PendingChunk[] = [];
  for (const section of sections) {
    const units =
      strategy === "paragraphs"
        ? splitIntoParagraphs(section.content)
        : splitIntoSentences(section.content);
    const effectiveUnits = units.length > 0 ? units : [section.content];
    const packed = packUnits(
      effectiveUnits,
      opts.maxChars,
      strategy === "paragraphs" ? "\n\n" : " ",
    );
    const locator = {
      page: section.page,
      slide: section.slide,
      sheet: section.sheet,
      rowStart: section.rowStart,
      rowEnd: section.rowEnd,
      section: section.section,
      title: section.title,
    };
    for (const piece of packed) {
      if (piece.length <= opts.maxChars) {
        pending.push({ content: piece, section, locator });
      } else {
        for (const sub of splitByCharacters(piece, opts.maxChars, opts.overlap)) {
          pending.push({ content: sub, section, locator });
        }
      }
    }
  }
  return pending;
}

function chunkCharacters(sections: ExtractedSection[], opts: ChunkingOptions): PendingChunk[] {
  const combined = sections.map((s) => s.content).join("\n\n");
  const pieces = splitByCharacters(combined, opts.maxChars, opts.overlap);
  return pieces.map((content) => ({ content, section: sections[0], locator: {} }));
}

/**
 * Merges any chunk shorter than `minChunkSize` into an adjacent chunk
 * rather than discarding it — `minChunkSize` is a packing hint, never a
 * reason to silently drop extracted content. A merge that would exceed
 * `maxChars` is skipped: the hard size budget always wins over the soft
 * minimum-size hint, so an undersized chunk is occasionally left as-is
 * rather than pushed over budget.
 */
function mergeUndersizedChunks(
  pending: PendingChunk[],
  minChunkSize: number,
  maxChars: number,
): PendingChunk[] {
  if (pending.length <= 1) return pending;
  const fits = (a: string, b: string) => a.length + 2 + b.length <= maxChars;

  const merged: PendingChunk[] = [];
  for (const p of pending) {
    const prev = merged[merged.length - 1];
    if (prev && prev.content.length < minChunkSize && fits(prev.content, p.content)) {
      merged[merged.length - 1] = { ...p, content: `${prev.content}\n\n${p.content}` };
    } else {
      merged.push(p);
    }
  }
  // If the final chunk is still undersized, fold it into its predecessor when it fits.
  if (merged.length > 1) {
    const last = merged[merged.length - 1] as PendingChunk;
    const prev = merged[merged.length - 2] as PendingChunk;
    if (last.content.length < minChunkSize && fits(prev.content, last.content)) {
      merged[merged.length - 2] = { ...prev, content: `${prev.content}\n\n${last.content}` };
      merged.pop();
    }
  }
  return merged;
}

function chunkNone(sections: ExtractedSection[]): PendingChunk[] {
  return sections
    .filter((s) => s.content.trim().length > 0)
    .map((section) => ({
      content: section.content,
      section,
      locator: {
        page: section.page,
        slide: section.slide,
        sheet: section.sheet,
        rowStart: section.rowStart,
        rowEnd: section.rowEnd,
        section: section.section,
        title: section.title,
      },
    }));
}

/**
 * Chunks a single `ExtractedDocument` deterministically according to
 * `options.strategy`. Chunk ids are derived from the document's content
 * hash plus the chunk's sequential index, so overlap (which duplicates
 * text, not ids) can never collide, and re-chunking the same document with
 * the same options reproduces identical ids.
 */
export function chunkDocument(
  document: ExtractedDocument,
  options: Partial<ChunkingOptions> = {},
): Chunk[] {
  // A plain `{ ...DEFAULT_CHUNKING, ...options }` spread would let an
  // explicit `undefined` in a caller-supplied field (common when a CLI
  // forwards every flag unconditionally) silently blank out its default,
  // so each field falls back individually instead.
  const opts: ChunkingOptions = {
    strategy: options.strategy ?? DEFAULT_CHUNKING.strategy,
    maxChars: options.maxChars ?? DEFAULT_CHUNKING.maxChars,
    maxTokens: options.maxTokens ?? DEFAULT_CHUNKING.maxTokens,
    overlap: options.overlap ?? DEFAULT_CHUNKING.overlap,
    minChunkSize: options.minChunkSize ?? DEFAULT_CHUNKING.minChunkSize,
    preserveStructuralBoundary:
      options.preserveStructuralBoundary ?? DEFAULT_CHUNKING.preserveStructuralBoundary,
    deduplicate: options.deduplicate ?? DEFAULT_CHUNKING.deduplicate,
    removeEmpty: options.removeEmpty ?? DEFAULT_CHUNKING.removeEmpty,
    tokenizer: options.tokenizer ?? DEFAULT_CHUNKING.tokenizer,
  };
  const sections = document.sections.filter(
    (s) => !opts.removeEmpty || s.content.trim().length > 0,
  );
  if (sections.length === 0) return [];

  const strategy = opts.strategy === "auto" ? resolveAutoStrategy(sections) : opts.strategy;

  let pending: PendingChunk[];
  switch (strategy) {
    case "none":
      pending = chunkNone(sections);
      break;
    case "characters":
      pending = chunkCharacters(sections, opts);
      break;
    case "paragraphs":
      pending = chunkTextStrategy(sections, "paragraphs", opts);
      break;
    case "sentences":
      pending = chunkTextStrategy(sections, "sentences", opts);
      break;
    case "pages":
    case "slides":
    case "rows":
    case "sections":
      pending = chunkStructural(sections, strategy, opts);
      break;
    default:
      pending = chunkNone(sections);
  }

  if (opts.removeEmpty) pending = pending.filter((p) => p.content.trim().length > 0);

  if (opts.deduplicate) {
    const seen = new Set<string>();
    pending = pending.filter((p) => {
      const hash = shortHash(p.content);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }

  pending = mergeUndersizedChunks(pending, opts.minChunkSize, opts.maxChars);

  const tokenizer = opts.tokenizer ?? ((text: string) => Math.ceil(text.length / 4));
  const total = pending.length;
  const shortHashPrefix = document.contentHash.slice(0, 12);

  return pending.map((p, index) => {
    const chunk: Chunk = {
      id: `${document.id}:chunk:${shortHashPrefix}:${index}`,
      content: p.content,
      index,
      totalChunks: total,
      sectionId: p.section?.id,
      title: p.locator.title,
      page: p.locator.page,
      slide: p.locator.slide,
      sheet: p.locator.sheet,
      rowStart: p.locator.rowStart,
      rowEnd: p.locator.rowEnd,
      section: p.locator.section,
      tokenEstimate: tokenizer(p.content),
    };
    return chunk;
  });
}

export * from "./text.js";
export * from "./structured.js";
