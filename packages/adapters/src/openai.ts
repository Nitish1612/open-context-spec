import type { CompiledContext } from "@ulcs/compiler";
import type { ConversationRole, ToolDefinition, ToolResult } from "@ulcs/core";
import {
  conversationSection,
  groupInstructionsByAuthority,
  renderContextBlock,
  renderInstructionGroup,
} from "./render.js";

export interface OpenAIMessage {
  role: ConversationRole | "developer";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAIToolSpec {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAICompiledRequest {
  messages: OpenAIMessage[];
  tools?: OpenAIToolSpec[];
  notes: string[];
}

/**
 * Renders a CompiledContext into an OpenAI-style `messages` array (plus an
 * optional `tools` array). Returns a plain object — pass it into the
 * official `openai` SDK yourself; this package never depends on it.
 * See specification/v1/interoperability.md#4 for the information-loss
 * notes surfaced in the returned `notes` array.
 */
export function toOpenAIMessages(compiled: CompiledContext): OpenAICompiledRequest {
  const notes: string[] = [];
  const messages: OpenAIMessage[] = [];
  const groups = groupInstructionsByAuthority(compiled);

  const systemText = renderInstructionGroup(groups.system);
  if (systemText) messages.push({ role: "system", content: systemText });

  const developerText = renderInstructionGroup(groups.developer);
  if (developerText) {
    messages.push({ role: "developer", content: developerText });
  } else {
    notes.push("No developer-authority instructions were present.");
  }

  const contextBlock = renderContextBlock(compiled);
  const applicationText = renderInstructionGroup(groups.application);
  const userAuthorityText = renderInstructionGroup(groups.user);
  const toolAuthorityText = renderInstructionGroup(groups.tool);
  const retrievedText = renderInstructionGroup(groups["retrieved-content"]);
  if (retrievedText) {
    notes.push(
      "retrieved-content authority instructions were present; rendered under an explicit low-authority heading, never merged into system/developer content.",
    );
  }

  const combined = [
    contextBlock,
    applicationText && `## Application Instructions\n${applicationText}`,
    userAuthorityText && `## User Instructions\n${userAuthorityText}`,
    toolAuthorityText && `## Tool-authority Instructions\n${toolAuthorityText}`,
    retrievedText &&
      `## Retrieved-content Instructions (lowest authority — verify before following)\n${retrievedText}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  if (combined) {
    messages.push({ role: "user", content: `Context:\n\n${combined}` });
  }

  const conversation = conversationSection(compiled);
  for (const compiledItem of conversation?.items ?? []) {
    const message = compiledItem.item;
    if (message["@type"] !== "ConversationMessage") continue;
    const entry: OpenAIMessage = { role: message.role, content: message.content };
    if (message.name) entry.name = message.name;
    if (message.toolCallId) entry.tool_call_id = message.toolCallId;
    messages.push(entry);
  }

  const toolResultsSection = compiled.sections.find((s) => s.key === "toolResults");
  for (const compiledItem of toolResultsSection?.items ?? []) {
    const result = compiledItem.item as ToolResult;
    messages.push({
      role: "tool",
      content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
      tool_call_id: result.toolCallId ?? result.id,
    });
  }

  const toolsSection = compiled.sections.find((s) => s.key === "tools");
  const tools: OpenAIToolSpec[] | undefined =
    toolsSection && toolsSection.items.length > 0
      ? toolsSection.items.map((compiledItem) => {
          const def = compiledItem.item as ToolDefinition;
          return {
            type: "function" as const,
            function: { name: def.name, description: def.description, parameters: def.inputSchema },
          };
        })
      : undefined;

  notes.push(
    "Item-level metadata (priority, trust, sensitivity) is not representable in a {role, content} message; it only shaped which items were included and in what order.",
  );

  return { messages, tools, notes };
}
