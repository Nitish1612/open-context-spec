import type { CompiledContext } from "@ulcs/compiler";
import type { ToolResult } from "@ulcs/core";
import {
  conversationSection,
  groupInstructionsByAuthority,
  renderContextBlock,
  renderInstructionGroup,
} from "./render.js";

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiCompiledRequest {
  systemInstruction: { parts: GeminiPart[] };
  contents: GeminiContent[];
  notes: string[];
}

/**
 * Renders a CompiledContext into a Gemini-style `{ systemInstruction,
 * contents }` request shape. Gemini, like Anthropic, exposes one system
 * slot and two turn roles (`user`/`model`) — see
 * specification/v1/interoperability.md#4.
 */
export function toGeminiContents(compiled: CompiledContext): GeminiCompiledRequest {
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
      "developer- and application-authority instructions were folded into the single Gemini systemInstruction, each under its own heading.",
    );
  }

  const contents: GeminiContent[] = [];
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

  if (combined) contents.push({ role: "user", parts: [{ text: `Context:\n\n${combined}` }] });

  const conversation = conversationSection(compiled);
  for (const compiledItem of conversation?.items ?? []) {
    const message = compiledItem.item;
    if (message["@type"] !== "ConversationMessage") continue;
    if (message.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: message.content }] });
    } else if (message.role === "system") {
      contents.push({ role: "user", parts: [{ text: `[system note] ${message.content}` }] });
      notes.push("A conversation item with role 'system' was folded into a labeled user turn.");
    } else if (message.role === "tool") {
      contents.push({ role: "user", parts: [{ text: `[tool message] ${message.content}` }] });
      notes.push("A conversation item with role 'tool' was folded into a labeled user turn.");
    } else {
      contents.push({ role: "user", parts: [{ text: message.content }] });
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
    contents.push({ role: "user", parts: [{ text: `Tool results:\n${lines.join("\n")}` }] });
    notes.push(
      "Tool results were rendered as a labeled text block, not native functionResponse parts.",
    );
  }

  notes.push(
    "Item-level metadata (priority, trust, sensitivity) is not representable in plain turn text; it only shaped which items were included and in what order.",
  );

  return { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] }, contents, notes };
}
