import { shortHash } from "@ulcs/core";
import { UsageError } from "../errors.js";
import type {
  Chunk,
  ChunkLocator,
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
  /** Set only when this chunk was packed across more than one distinct structural locator (`preserveStructuralBoundary: false`). */
  sourceLocators?: ChunkLocator[];
  /** Set when this chunk is a single indivisible structured record (a "rows" section) that alone exceeds `maxTokens` and could not be split further. */
  maxTokensExceeded?: boolean;
  /** Set when this pending chunk is one atomic, never-split unit (a single "rows" record) — `enforceMaxTokens` must flag rather than split it if it's over budget. */
  indivisible?: boolean;
}

function locatorOf(section: ExtractedSection | undefined): ChunkLocator {
  return {
    page: section?.page,
    slide: section?.slide,
    sheet: section?.sheet,
    rowStart: section?.rowStart,
    rowEnd: section?.rowEnd,
    section: section?.section,
  };
}

function locatorsDiffer(a: ChunkLocator, b: ChunkLocator): boolean {
  return (
    a.page !== b.page ||
    a.slide !== b.slide ||
    a.sheet !== b.sheet ||
    a.rowStart !== b.rowStart ||
    a.section !== b.section
  );
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
  // `preserveStructuralBoundary: true` (the default) groups sections by
  // their structural locator first, so a window never mixes pages/slides/
  // sheets/sections. Setting it to `false` packs across those boundaries
  // instead — the only thing that never changes either way is that an
  // individual section (one row, one slide's content, ...) is still never
  // split across two windows; see `packSectionsIntoWindows`.
  const groups = opts.preserveStructuralBoundary
    ? groupSections(sections, strategy)
    : [{ key: "__all__", sections }];
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

      const distinctLocators: ChunkLocator[] = [];
      if (!opts.preserveStructuralBoundary && window.sections.length > 1) {
        for (const s of window.sections) {
          const loc = locatorOf(s);
          const prev = distinctLocators[distinctLocators.length - 1];
          if (!prev || locatorsDiffer(prev, loc)) distinctLocators.push(loc);
        }
      }

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
        pending.push({
          content: window.content,
          section: first,
          locator,
          sourceLocators: distinctLocators.length > 1 ? distinctLocators : undefined,
          indivisible: strategy === "rows" && window.sections.length === 1,
        });
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

function sameLocator(a: PendingChunk["locator"], b: PendingChunk["locator"]): boolean {
  return (
    a.page === b.page &&
    a.slide === b.slide &&
    a.sheet === b.sheet &&
    a.rowStart === b.rowStart &&
    a.section === b.section
  );
}

/** Unions two chunks' `sourceLocators` (or synthesizes one from their own locator when they didn't have one yet), deduping consecutive duplicates, for use when a merge crosses a structural boundary. */
function mergeSourceLocators(a: PendingChunk, b: PendingChunk): ChunkLocator[] | undefined {
  const aLocs = a.sourceLocators ?? [locatorOf(a.section)];
  const bLocs = b.sourceLocators ?? [locatorOf(b.section)];
  const combined = [...aLocs, ...bLocs];
  const deduped: ChunkLocator[] = [];
  for (const loc of combined) {
    const prev = deduped[deduped.length - 1];
    if (!prev || locatorsDiffer(prev, loc)) deduped.push(loc);
  }
  return deduped.length > 1 ? deduped : undefined;
}

/**
 * Merges any chunk shorter than `minChunkSize` into an adjacent chunk
 * rather than discarding it — `minChunkSize` is a packing hint, never a
 * reason to silently drop extracted content. A merge that would exceed
 * `maxChars` is skipped: the hard size budget always wins over the soft
 * minimum-size hint, so an undersized chunk is occasionally left as-is
 * rather than pushed over budget. When `preserveStructuralBoundary` is
 * true, a merge is additionally skipped whenever it would mix two
 * different structural locators (pages/slides/sheets/sections) — the same
 * guarantee `chunkStructural` provides is upheld here too, since this pass
 * runs after it.
 */
function mergeUndersizedChunks(
  pending: PendingChunk[],
  minChunkSize: number,
  maxChars: number,
  preserveStructuralBoundary: boolean,
): PendingChunk[] {
  if (pending.length <= 1) return pending;
  const fits = (a: string, b: string) => a.length + 2 + b.length <= maxChars;
  const canMerge = (a: PendingChunk, b: PendingChunk) =>
    fits(a.content, b.content) &&
    (!preserveStructuralBoundary || sameLocator(a.locator, b.locator));

  const merged: PendingChunk[] = [];
  for (const p of pending) {
    const prev = merged[merged.length - 1];
    if (prev && prev.content.length < minChunkSize && canMerge(prev, p)) {
      merged[merged.length - 1] = {
        ...p,
        content: `${prev.content}\n\n${p.content}`,
        sourceLocators: preserveStructuralBoundary ? undefined : mergeSourceLocators(prev, p),
      };
    } else {
      merged.push(p);
    }
  }
  // If the final chunk is still undersized, fold it into its predecessor when it fits.
  if (merged.length > 1) {
    const last = merged[merged.length - 1] as PendingChunk;
    const prev = merged[merged.length - 2] as PendingChunk;
    if (last.content.length < minChunkSize && canMerge(prev, last)) {
      merged[merged.length - 2] = {
        ...prev,
        content: `${prev.content}\n\n${last.content}`,
        sourceLocators: preserveStructuralBoundary ? undefined : mergeSourceLocators(prev, last),
      };
      merged.pop();
    }
  }
  return merged;
}

const MAX_TOKEN_SPLIT_RETRIES = 4;

/**
 * Ensures no pending chunk's estimated token count exceeds `maxTokens`,
 * splitting oversized ones using a tokenizer-calibrated character budget
 * (derived from one token measurement of the whole chunk, not repeated
 * re-tokenization of ever-smaller slices) with a small bounded number of
 * corrective retries if the first split undershoots. An indivisible
 * structured record (a single "rows" section) is flagged via
 * `maxTokensExceeded` instead of being split, since splitting it would
 * violate "never split a row".
 */
function enforceMaxTokens(
  pending: PendingChunk[],
  maxTokens: number,
  overlap: number,
  tokenizer: (text: string) => number,
): PendingChunk[] {
  const result: PendingChunk[] = [];
  for (const p of pending) {
    const tokens = tokenizer(p.content);
    if (tokens <= maxTokens) {
      result.push(p);
      continue;
    }
    if (p.indivisible) {
      result.push({ ...p, maxTokensExceeded: true });
      continue;
    }

    const charsPerToken = p.content.length / Math.max(tokens, 1);
    let targetChars = Math.max(20, Math.floor(maxTokens * charsPerToken * 0.9));
    let pieces = splitByCharacters(p.content, targetChars, overlap);

    // The tokenizer may not scale linearly with character count (e.g. for
    // dense non-ASCII text); if a piece still overshoots, shrink just that
    // piece's target and re-split it — a small bounded number of times,
    // never re-measuring the whole original chunk again.
    for (let attempt = 0; attempt < MAX_TOKEN_SPLIT_RETRIES; attempt++) {
      const stillOversized = pieces.some((piece) => tokenizer(piece) > maxTokens);
      if (!stillOversized) break;
      targetChars = Math.max(10, Math.floor(targetChars * 0.7));
      pieces = pieces.flatMap((piece) =>
        tokenizer(piece) > maxTokens ? splitByCharacters(piece, targetChars, overlap) : [piece],
      );
    }

    for (const piece of pieces) {
      result.push({ ...p, content: piece });
    }
  }
  return result;
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
  if (opts.maxTokens !== undefined && (!Number.isInteger(opts.maxTokens) || opts.maxTokens <= 0)) {
    throw new UsageError(`chunking maxTokens must be a positive integer, got ${opts.maxTokens}.`);
  }
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

  pending = mergeUndersizedChunks(
    pending,
    opts.minChunkSize,
    opts.maxChars,
    opts.preserveStructuralBoundary,
  );

  const tokenizer = opts.tokenizer ?? ((text: string) => Math.ceil(text.length / 4));

  if (opts.maxTokens !== undefined) {
    pending = enforceMaxTokens(pending, opts.maxTokens, opts.overlap, tokenizer);
  }

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
      sourceLocators: p.sourceLocators,
      metadata: p.maxTokensExceeded
        ? { maxTokensExceeded: true, reason: "indivisible structured record exceeds --max-tokens" }
        : undefined,
    };
    return chunk;
  });
}

export * from "./text.js";
export * from "./structured.js";
