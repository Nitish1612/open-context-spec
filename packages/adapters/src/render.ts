import { getItemText } from "@ulcs/compiler";
import type { CompiledContext, CompiledItem, CompiledSection } from "@ulcs/compiler";
import type { ContextItem, Instruction, InstructionAuthority } from "@ulcs/core";
import { wrapIfUntrusted } from "./wrap.js";

const NON_INSTRUCTION_SECTION_ORDER = [
  "actors",
  "constraints",
  "facts",
  "assumptions",
  "decisions",
  "preferences",
  "entities",
  "relationships",
  "memory",
  "resources",
  "tools",
  "toolResults",
  "questions",
] as const;

export function renderItemLine(item: ContextItem): string {
  const text = getItemText(item);
  return wrapIfUntrusted(item, text);
}

export function groupInstructionsByAuthority(
  compiled: CompiledContext,
): Record<InstructionAuthority, CompiledItem[]> {
  const groups: Record<InstructionAuthority, CompiledItem[]> = {
    system: [],
    developer: [],
    application: [],
    user: [],
    tool: [],
    "retrieved-content": [],
  };
  const instructionsSection = compiled.sections.find((section) => section.key === "instructions");
  for (const compiledItem of instructionsSection?.items ?? []) {
    const instruction = compiledItem.item as Instruction;
    groups[instruction.authority].push(compiledItem);
  }
  return groups;
}

export function renderInstructionGroup(items: CompiledItem[]): string {
  return items.map((compiledItem) => renderItemLine(compiledItem.item)).join("\n");
}

/** Renders every non-instruction section as a single labeled text block, in SECTION_ORDER. */
export function renderContextBlock(
  compiled: CompiledContext,
  sectionFilter?: readonly string[],
): string {
  const parts: string[] = [];
  const objective = compiled.objective;
  if (objective?.summary) {
    parts.push(`## Objective\n${objective.summary}`);
  }
  const sectionsByKey = new Map<string, CompiledSection>(compiled.sections.map((s) => [s.key, s]));
  const keys = sectionFilter ?? NON_INSTRUCTION_SECTION_ORDER;
  for (const key of keys) {
    const section = sectionsByKey.get(key);
    if (!section || section.items.length === 0) continue;
    const lines = section.items.map((compiledItem) => `- ${renderItemLine(compiledItem.item)}`);
    parts.push(`## ${section.title}\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

export function conversationSection(compiled: CompiledContext): CompiledSection | undefined {
  return compiled.sections.find((section) => section.key === "conversation");
}
