import type { ContextItem, Objective } from "@ulcs/core";

/** A pluggable tokenizer. Given text, returns an estimated (or exact, for a real tokenizer) token count. */
export type Tokenizer = (text: string) => number;

/**
 * Default fallback estimate: ~4 characters per token, a common
 * order-of-magnitude heuristic for English text. NOT an accurate count for
 * any specific model's tokenizer — see specification/v1/token-policy.md#2.
 */
export const approxChar4Tokenizer: Tokenizer = (text) => Math.ceil(text.length / 4);

/** Extracts the primary textual content of an item, for token estimation and truncation purposes. */
export function getItemText(item: ContextItem): string {
  if (item.content) return item.content;
  switch (item["@type"]) {
    case "Task":
    case "Entity":
    case "ToolDefinition":
      return "name" in item ? String(item.name) : "";
    case "Actor":
      return "displayName" in item && item.displayName
        ? item.displayName
        : "role" in item
          ? item.role
          : "";
    case "ToolResult":
      return "output" in item ? JSON.stringify(item.output) : "";
    case "Relationship":
      return "predicate" in item ? `${item.subjectId} ${item.predicate} ${item.objectId}` : "";
    default:
      return "";
  }
}

export function getObjectiveText(objective: Objective): string {
  const parts = [
    objective.summary ?? "",
    ...(objective.successCriteria ?? []),
    ...(objective.nonGoals ?? []),
  ];
  return parts.filter(Boolean).join(" ");
}
