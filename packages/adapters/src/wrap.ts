import type { ContextItem } from "@ulcs/core";

/**
 * Wraps untrusted content in a labeled delimiter block, per
 * specification/v1/security.md#2-untrusted-content-wrapping. This is a
 * labeling convention for the model's benefit, not an enforced security
 * boundary — see the threat model in that document.
 */
export function wrapIfUntrusted(item: ContextItem, text: string): string {
  if (item.trust?.level !== "untrusted") return text;
  const source = item.source?.sourceType ?? "unknown";
  return `<untrusted-content source="${source}" id="${item.id}">\n${text}\n</untrusted-content>`;
}

export function isRetrievedContentInstruction(item: ContextItem): boolean {
  return (
    item["@type"] === "Instruction" && "authority" in item && item.authority === "retrieved-content"
  );
}
