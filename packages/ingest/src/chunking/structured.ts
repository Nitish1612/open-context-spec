import type { ChunkStrategy, ExtractedSection } from "../types.js";
import { splitIntoParagraphs, splitByCharacters } from "./text.js";

export interface StructuredGroup {
  key: string;
  sections: ExtractedSection[];
}

function groupKeyFor(strategy: ChunkStrategy, section: ExtractedSection): string {
  switch (strategy) {
    case "pages":
      return `page:${section.page ?? "none"}`;
    case "slides":
      return `slide:${section.slide ?? "none"}`;
    case "rows":
      return `sheet:${section.sheet ?? "default"}`;
    case "sections":
      return `section:${section.section ?? section.title ?? section.id}`;
    default:
      return "none";
  }
}

/** Groups sections that share a structural locator, preserving input order. */
export function groupSections(
  sections: ExtractedSection[],
  strategy: ChunkStrategy,
): StructuredGroup[] {
  const groups: StructuredGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const section of sections) {
    const key = groupKeyFor(strategy, section);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ key, sections: [section] });
    } else {
      groups[existingIndex]?.sections.push(section);
    }
  }
  return groups;
}

export interface StructuredWindow {
  content: string;
  sections: ExtractedSection[];
}

/**
 * Packs a group's sections into windows bounded by `maxChars`, without ever
 * splitting an individual section's content across two windows — the unit
 * of atomicity is the section (e.g. one CSV row, one table row). A single
 * section larger than `maxChars` becomes its own oversized window rather
 * than being torn apart.
 */
export function packSectionsIntoWindows(
  sections: ExtractedSection[],
  maxChars: number,
): StructuredWindow[] {
  const windows: StructuredWindow[] = [];
  let current: ExtractedSection[] = [];
  let currentLength = 0;

  for (const section of sections) {
    const addedLength = current.length > 0 ? 2 + section.content.length : section.content.length;
    if (current.length > 0 && currentLength + addedLength > maxChars) {
      windows.push({ content: current.map((s) => s.content).join("\n\n"), sections: current });
      current = [];
      currentLength = 0;
    }
    current.push(section);
    currentLength += current.length > 1 ? 2 + section.content.length : section.content.length;
  }
  if (current.length > 0) {
    windows.push({ content: current.map((s) => s.content).join("\n\n"), sections: current });
  }
  return windows;
}

/**
 * Splits a single oversized section's content on paragraph boundaries
 * (falling back to a raw character split) so it still respects `maxChars`
 * — used only when one section alone exceeds the budget for strategies
 * where sub-splitting a unit is acceptable (pages/slides/sections, not rows).
 */
export function splitOversizedContent(
  content: string,
  maxChars: number,
  overlap: number,
): string[] {
  if (content.length <= maxChars) return [content];
  const paragraphs = splitIntoParagraphs(content);
  if (paragraphs.length > 1) {
    const packed: string[] = [];
    let current = "";
    for (const p of paragraphs) {
      if (current && current.length + 2 + p.length > maxChars) {
        packed.push(current);
        current = "";
      }
      current = current ? `${current}\n\n${p}` : p;
    }
    if (current) packed.push(current);
    return packed.flatMap((chunk) =>
      chunk.length > maxChars ? splitByCharacters(chunk, maxChars, overlap) : [chunk],
    );
  }
  return splitByCharacters(content, maxChars, overlap);
}
