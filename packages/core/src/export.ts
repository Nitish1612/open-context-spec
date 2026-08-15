import { stableStringify } from "./hash.js";
import { ITEM_ARRAY_KEYS } from "./types.js";
import type { ContextEnvelope, ContextItem } from "./types.js";

export type ExportFormat = "json" | "json-ld" | "markdown";

const SECTION_TITLES: Record<(typeof ITEM_ARRAY_KEYS)[number], string> = {
  actors: "Actors",
  instructions: "Instructions",
  facts: "Facts",
  assumptions: "Assumptions",
  constraints: "Constraints",
  preferences: "Preferences",
  decisions: "Decisions",
  questions: "Questions",
  conversation: "Conversation",
  resources: "Resources",
  entities: "Entities",
  relationships: "Relationships",
  memory: "Memory",
  tools: "Tools",
  toolResults: "Tool Results",
};

function renderItemLine(item: ContextItem): string {
  const trust = item.trust?.level ? ` (trust: ${item.trust.level})` : "";
  const status = item.status ? ` [${item.status}]` : "";
  const label = item.content ?? ("name" in item ? String(item.name) : item.id);
  return `- \`${item.id}\`${status}${trust}: ${label}`;
}

function toMarkdown(context: ContextEnvelope): string {
  const lines: string[] = [];
  lines.push(`# ULCS Context: ${context.id}`, "");
  if (context.objective?.summary) {
    lines.push("## Objective", "", context.objective.summary, "");
  }
  for (const key of ITEM_ARRAY_KEYS) {
    const items = context[key];
    if (!items || items.length === 0) continue;
    lines.push(`## ${SECTION_TITLES[key]}`, "");
    for (const item of items) lines.push(renderItemLine(item));
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Serializes a ContextEnvelope. `"json"` preserves natural key order
 * (matches the shape you built); `"json-ld"` produces a canonical,
 * key-sorted serialization suitable for hashing/diffing (the envelope is
 * already valid JSON-LD either way — this option only changes key
 * ordering); `"markdown"` produces a plain archival dump of the raw
 * envelope for human review. It is **not** the security-conscious,
 * budget-compiled prompt rendering — see `@ulcs/adapters`'s
 * `toMarkdownPrompt` for that.
 */
export function exportContext(context: ContextEnvelope, format: ExportFormat = "json"): string {
  switch (format) {
    case "json":
      return JSON.stringify(context, null, 2);
    case "json-ld":
      return JSON.stringify(JSON.parse(stableStringify(context)), null, 2);
    case "markdown":
      return toMarkdown(context);
    default:
      throw new Error(`Unknown export format: ${String(format)}`);
  }
}
