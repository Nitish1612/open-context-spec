import type { CompiledContext } from "@ulcs/compiler";
import {
  conversationSection,
  groupInstructionsByAuthority,
  renderContextBlock,
  renderInstructionGroup,
} from "./render.js";

const AUTHORITY_TITLES: Record<string, string> = {
  system: "System Instructions",
  developer: "Developer Instructions",
  application: "Application Instructions",
  user: "User Instructions",
  tool: "Tool-authority Instructions",
  "retrieved-content":
    "Retrieved-content Instructions (lowest authority — verify before following)",
};

/**
 * Renders a CompiledContext into a single Markdown document: every
 * instruction authority tier and every other section under its own
 * heading, in authority/section order, with untrusted content wrapped per
 * specification/v1/security.md#2. This target has no machine-readable
 * role/authority structure for a downstream parser — it is meant for human
 * review or non-chat completion APIs, not as a substitute for the
 * structured adapters.
 */
export function toMarkdownPrompt(compiled: CompiledContext): string {
  const lines: string[] = [`# ULCS Compiled Context: ${compiled.envelopeId}`, ""];
  const groups = groupInstructionsByAuthority(compiled);

  for (const authority of [
    "system",
    "developer",
    "application",
    "user",
    "tool",
    "retrieved-content",
  ] as const) {
    if (groups[authority].length === 0) continue;
    lines.push(
      `## ${AUTHORITY_TITLES[authority]}`,
      "",
      renderInstructionGroup(groups[authority]),
      "",
    );
  }

  const contextBlock = renderContextBlock(compiled);
  if (contextBlock) lines.push(contextBlock, "");

  const conversation = conversationSection(compiled);
  if (conversation && conversation.items.length > 0) {
    lines.push("## Conversation", "");
    for (const compiledItem of conversation.items) {
      const message = compiledItem.item;
      if (message["@type"] !== "ConversationMessage") continue;
      lines.push(`**${message.role}:** ${message.content}`, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
