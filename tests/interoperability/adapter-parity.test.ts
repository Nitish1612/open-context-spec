/**
 * Cross-adapter interoperability checks: every adapter must agree on which
 * items were included (compileContext's job) and must never let an
 * untrusted or retrieved-content-authority item leak into a high-authority
 * channel, regardless of target shape.
 */
import { createContext } from "@ulcs/core";
import { compileContext } from "@ulcs/compiler";
import {
  toAnthropicMessages,
  toGeminiContents,
  toGenericChatMessages,
  toMarkdownPrompt,
  toOpenAIMessages,
} from "@ulcs/adapters";
import { describe, expect, it } from "vitest";

function buildCompiled() {
  const ctx = createContext({
    instructions: [
      {
        id: "urn:ulcs:instr:sys",
        "@type": "Instruction",
        authority: "system",
        content: "SYSTEM_MARKER",
        trust: { level: "trusted", providesInstructions: true },
      },
      {
        id: "urn:ulcs:instr:retrieved",
        "@type": "Instruction",
        authority: "retrieved-content",
        content: "RETRIEVED_MARKER",
        trust: { level: "untrusted", providesInstructions: false },
      },
    ],
  });
  return compileContext(ctx);
}

describe("retrieved-content authority never reaches a high-authority channel in any adapter", () => {
  it("OpenAI: RETRIEVED_MARKER is absent from system/developer messages", () => {
    const result = toOpenAIMessages(buildCompiled());
    const highAuthority = result.messages.filter(
      (m) => m.role === "system" || m.role === "developer",
    );
    expect(highAuthority.every((m) => !m.content.includes("RETRIEVED_MARKER"))).toBe(true);
    expect(highAuthority.some((m) => m.content.includes("SYSTEM_MARKER"))).toBe(true);
  });

  it("Anthropic: RETRIEVED_MARKER is absent from the system string", () => {
    const result = toAnthropicMessages(buildCompiled());
    expect(result.system).not.toContain("RETRIEVED_MARKER");
    expect(result.system).toContain("SYSTEM_MARKER");
  });

  it("Gemini: RETRIEVED_MARKER is absent from systemInstruction", () => {
    const result = toGeminiContents(buildCompiled());
    const systemText = result.systemInstruction.parts.map((p) => p.text).join("\n");
    expect(systemText).not.toContain("RETRIEVED_MARKER");
    expect(systemText).toContain("SYSTEM_MARKER");
  });

  it("Generic: RETRIEVED_MARKER is absent from the system message", () => {
    const result = toGenericChatMessages(buildCompiled());
    const systemMessage = result.messages.find((m) => m.role === "system");
    expect(systemMessage?.content).not.toContain("RETRIEVED_MARKER");
    expect(systemMessage?.content).toContain("SYSTEM_MARKER");
  });

  it("Markdown: RETRIEVED_MARKER appears only under its own low-authority heading", () => {
    const md = toMarkdownPrompt(buildCompiled());
    const systemHeadingIndex = md.indexOf("## System Instructions");
    const retrievedHeadingIndex = md.indexOf("## Retrieved-content Instructions");
    const retrievedMarkerIndex = md.indexOf("RETRIEVED_MARKER");
    expect(retrievedHeadingIndex).toBeGreaterThan(-1);
    expect(retrievedMarkerIndex).toBeGreaterThan(retrievedHeadingIndex);
    expect(md.slice(systemHeadingIndex, retrievedHeadingIndex)).not.toContain("RETRIEVED_MARKER");
  });
});
