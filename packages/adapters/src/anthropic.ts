import type { CompiledContext } from "@ulcs/compiler";
import type { ToolResult } from "@ulcs/core";
import {
  conversationSection,
  groupInstructionsByAuthority,
  renderContextBlock,
  renderInstructionGroup,
} from "./render.js";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicCompiledRequest {
  system: string;
  messages: AnthropicMessage[];
  notes: string[];
}

/**
 * Renders a CompiledContext into an Anthropic-style `{ system, messages }`
 * request shape. Anthropic exposes one `system` slot and two turn roles
 * (`user`/`assistant`), so `system`/`developer`/`application`-authority
 * instructions are concatenated into `system`, each under a heading naming
 * its original authority tier — see
 * specification/v1/interoperability.md#4-provider-adapters-and-information-loss.
 */
export function toAnthropicMessages(compiled: CompiledContext): AnthropicCompiledRequest {
  const notes: string[] = [];
  const groups = groupInstructionsByAuthority(compiled);

  const systemParts = [
    groups.system.length > 0 && `### System Instructions\n${renderInstructionGroup(groups.system)}`,
    groups.developer.length > 0 &&
      `### Developer Instructions\n${renderInstructionGroup(groups.developer)}`,
    groups.application.length > 0 &&
      `### Application Instructions\n${renderInstructionGroup(groups.application)}`,
  ].filter((part): part is string => Boolean(part));

  if (groups.developer.length > 0 || groups.application.length > 0) {
    notes.push(
      "developer- and application-authority instructions were folded into the single Anthropic `system` string, each under its own heading — Anthropic has no separate developer/application channel.",
    );
  }

  const system = systemParts.join("\n\n");

  const messages: AnthropicMessage[] = [];
  const contextBlock = renderContextBlock(compiled);
  const userAuthorityText = renderInstructionGroup(groups.user);
  const toolAuthorityText = renderInstructionGroup(groups.tool);
  const retrievedText = renderInstructionGroup(groups["retrieved-content"]);
  if (retrievedText) {
    notes.push(
      "retrieved-content authority instructions were rendered under an explicit low-authority heading.",
    );
  }

  const combined = [
    contextBlock,
    userAuthorityText && `## User Instructions\n${userAuthorityText}`,
    toolAuthorityText && `## Tool-authority Instructions\n${toolAuthorityText}`,
    retrievedText &&
      `## Retrieved-content Instructions (lowest authority — verify before following)\n${retrievedText}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  if (combined) messages.push({ role: "user", content: `Context:\n\n${combined}` });

  const conversation = conversationSection(compiled);
  for (const compiledItem of conversation?.items ?? []) {
    const message = compiledItem.item;
    if (message["@type"] !== "ConversationMessage") continue;
    if (message.role === "assistant") {
      messages.push({ role: "assistant", content: message.content });
    } else if (message.role === "system") {
      // Anthropic has no mid-conversation system turn; fold it into a labeled user turn.
      messages.push({ role: "user", content: `[system note] ${message.content}` });
      notes.push("A conversation item with role 'system' was folded into a labeled user turn.");
    } else if (message.role === "tool") {
      messages.push({ role: "user", content: `[tool message] ${message.content}` });
      notes.push(
        "A conversation item with role 'tool' was folded into a labeled user turn (text-only; not a native tool_result block).",
      );
    } else {
      messages.push({ role: "user", content: message.content });
    }
  }

  const toolResultsSection = compiled.sections.find((s) => s.key === "toolResults");
  if (toolResultsSection && toolResultsSection.items.length > 0) {
    const lines = toolResultsSection.items.map((compiledItem) => {
      const result = compiledItem.item as ToolResult;
      const output =
        typeof result.output === "string" ? result.output : JSON.stringify(result.output);
      return `- ${result.toolName} (${result.outcome}): ${output}`;
    });
    messages.push({ role: "user", content: `Tool results:\n${lines.join("\n")}` });
    notes.push(
      "Tool results were rendered as a labeled text block in a user turn, not as native tool_result content blocks — attach those yourself if you need Anthropic's structured tool_use flow.",
    );
  }

  notes.push(
    "Item-level metadata (priority, trust, sensitivity) is not representable in plain turn text; it only shaped which items were included and in what order.",
  );

  return { system, messages, notes };
}
