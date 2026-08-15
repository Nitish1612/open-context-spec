import { createContext } from "@ulcs/core";
import { compileContext } from "@ulcs/compiler";
import { describe, expect, it } from "vitest";
import {
  toAnthropicMessages,
  toGeminiContents,
  toGenericChatMessages,
  toMarkdownPrompt,
  toMCPResource,
  toOpenAIMessages,
} from "../src/index.js";

function sampleCompiled() {
  const ctx = createContext({
    id: "urn:ulcs:context:sample",
    objective: {
      id: "urn:ulcs:obj:1",
      "@type": "Objective",
      summary: "Help the customer with billing.",
    },
    instructions: [
      {
        id: "urn:ulcs:instr:sys",
        "@type": "Instruction",
        authority: "system",
        content: "Be concise.",
      },
      {
        id: "urn:ulcs:instr:dev",
        "@type": "Instruction",
        authority: "developer",
        content: "Always cite sources.",
      },
      {
        id: "urn:ulcs:instr:usr",
        "@type": "Instruction",
        authority: "user",
        content: "Answer in French.",
      },
    ],
    facts: [
      { id: "urn:ulcs:fact:1", "@type": "Fact", content: "The customer is on the Pro plan." },
    ],
    resources: [
      {
        id: "urn:ulcs:res:1",
        "@type": "Resource",
        uri: "https://example.com/kb/refunds",
        content: "Refunds are issued within 5 business days.",
        trust: { level: "untrusted", providesData: true, providesInstructions: false },
        source: { sourceType: "retrieved-document" },
      },
    ],
    conversation: [
      {
        id: "urn:ulcs:msg:1",
        "@type": "ConversationMessage",
        role: "user",
        content: "Can I get a refund?",
      },
    ],
    toolResults: [
      {
        id: "urn:ulcs:tr:1",
        "@type": "ToolResult",
        toolCallId: "call_1",
        toolName: "lookup_order",
        outcome: "success",
        output: { orderId: "987" },
      },
    ],
  });
  return compileContext(ctx, { asOf: new Date("2026-08-15T12:00:00Z") });
}

describe("toOpenAIMessages", () => {
  it("keeps system and developer distinct and renders tool results as role:tool", () => {
    const compiled = sampleCompiled();
    const result = toOpenAIMessages(compiled);
    expect(result.messages[0]).toEqual({ role: "system", content: "Be concise." });
    expect(result.messages[1]).toEqual({ role: "developer", content: "Always cite sources." });
    expect(result.messages.some((m) => m.role === "tool" && m.tool_call_id === "call_1")).toBe(
      true,
    );
  });

  it("wraps untrusted resource content", () => {
    const compiled = sampleCompiled();
    const result = toOpenAIMessages(compiled);
    const contextMessage = result.messages.find((m) => m.content.includes("Refunds are issued"));
    expect(contextMessage?.content).toContain('<untrusted-content source="retrieved-document"');
  });

  it("is deterministic", () => {
    const compiled = sampleCompiled();
    expect(toOpenAIMessages(compiled)).toEqual(toOpenAIMessages(compiled));
  });
});

describe("toAnthropicMessages", () => {
  it("collapses system+developer into one system string with headings", () => {
    const compiled = sampleCompiled();
    const result = toAnthropicMessages(compiled);
    expect(result.system).toContain("### System Instructions");
    expect(result.system).toContain("Be concise.");
    expect(result.system).toContain("### Developer Instructions");
    expect(result.system).toContain("Always cite sources.");
  });

  it("only uses user/assistant roles", () => {
    const compiled = sampleCompiled();
    const result = toAnthropicMessages(compiled);
    expect(result.messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
  });
});

describe("toGeminiContents", () => {
  it("uses model role for assistant turns", () => {
    const ctx = createContext({
      conversation: [
        { id: "urn:ulcs:msg:1", "@type": "ConversationMessage", role: "user", content: "hi" },
        {
          id: "urn:ulcs:msg:2",
          "@type": "ConversationMessage",
          role: "assistant",
          content: "hello",
        },
      ],
    });
    const compiled = compileContext(ctx);
    const result = toGeminiContents(compiled);
    expect(result.contents.some((c) => c.role === "model" && c.parts[0]?.text === "hello")).toBe(
      true,
    );
  });
});

describe("toGenericChatMessages", () => {
  it("only uses system/user/assistant roles", () => {
    const compiled = sampleCompiled();
    const result = toGenericChatMessages(compiled);
    expect(result.messages.every((m) => ["system", "user", "assistant"].includes(m.role))).toBe(
      true,
    );
  });
});

describe("toMarkdownPrompt", () => {
  it("renders authority-tiered headings and wraps untrusted content", () => {
    const compiled = sampleCompiled();
    const md = toMarkdownPrompt(compiled);
    expect(md).toContain("## System Instructions");
    expect(md).toContain("## Developer Instructions");
    expect(md).toContain("## User Instructions");
    expect(md).toContain("<untrusted-content");
  });
});

describe("toMCPResource", () => {
  it("serializes full-fidelity JSON", () => {
    const compiled = sampleCompiled();
    const resource = toMCPResource(compiled);
    expect(resource.mimeType).toBe("application/json");
    expect(JSON.parse(resource.text).envelopeId).toBe("urn:ulcs:context:sample");
  });
});
