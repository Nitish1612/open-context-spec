import { createContext } from "@ulcs/core";
import { compileContext } from "@ulcs/compiler";
import { describe, expect, it } from "vitest";
import {
  isRetrievedContentInstruction,
  toAnthropicMessages,
  toGeminiContents,
  toGenericChatMessages,
  toOpenAIMessages,
  wrapIfUntrusted,
} from "../src/index.js";

describe("wrapIfUntrusted", () => {
  it("returns text unchanged when the item is not untrusted", () => {
    expect(
      wrapIfUntrusted(
        { id: "1", "@type": "Fact", content: "x", trust: { level: "trusted" } },
        "hello",
      ),
    ).toBe("hello");
    expect(wrapIfUntrusted({ id: "1", "@type": "Fact", content: "x" }, "hello")).toBe("hello");
  });
});

describe("isRetrievedContentInstruction", () => {
  it("identifies retrieved-content authority instructions", () => {
    expect(
      isRetrievedContentInstruction({
        id: "1",
        "@type": "Instruction",
        authority: "retrieved-content",
        content: "x",
      }),
    ).toBe(true);
  });

  it("returns false for other instruction authorities and other item types", () => {
    expect(
      isRetrievedContentInstruction({
        id: "1",
        "@type": "Instruction",
        authority: "system",
        content: "x",
      }),
    ).toBe(false);
    expect(isRetrievedContentInstruction({ id: "1", "@type": "Fact", content: "x" })).toBe(false);
  });
});

function fullSpectrumCompiled() {
  const ctx = createContext({
    instructions: [
      { id: "urn:ulcs:instr:sys", "@type": "Instruction", authority: "system", content: "SYS" },
      { id: "urn:ulcs:instr:dev", "@type": "Instruction", authority: "developer", content: "DEV" },
      {
        id: "urn:ulcs:instr:app",
        "@type": "Instruction",
        authority: "application",
        content: "APP",
      },
      { id: "urn:ulcs:instr:usr", "@type": "Instruction", authority: "user", content: "USR" },
      { id: "urn:ulcs:instr:tool", "@type": "Instruction", authority: "tool", content: "TOOL" },
      {
        id: "urn:ulcs:instr:retrieved",
        "@type": "Instruction",
        authority: "retrieved-content",
        content: "RETRIEVED",
        trust: { level: "untrusted", providesInstructions: false },
      },
    ],
    tools: [
      {
        id: "urn:ulcs:tool:1",
        "@type": "ToolDefinition",
        name: "do_thing",
        description: "does a thing",
      },
    ],
    toolResults: [
      {
        id: "urn:ulcs:tr:1",
        "@type": "ToolResult",
        toolCallId: "call_1",
        toolName: "do_thing",
        outcome: "success",
        output: "plain string output",
      },
    ],
    conversation: [
      { id: "urn:ulcs:msg:1", "@type": "ConversationMessage", role: "user", content: "hi" },
      { id: "urn:ulcs:msg:2", "@type": "ConversationMessage", role: "assistant", content: "hello" },
      {
        id: "urn:ulcs:msg:3",
        "@type": "ConversationMessage",
        role: "system",
        content: "mid-convo system note",
      },
      { id: "urn:ulcs:msg:4", "@type": "ConversationMessage", role: "tool", content: "tool turn" },
    ],
  });
  return compileContext(ctx);
}

describe("toOpenAIMessages full spectrum", () => {
  it("renders every instruction authority and a populated tools array", () => {
    const result = toOpenAIMessages(fullSpectrumCompiled());
    const userContextMessage = result.messages.find((m) => m.content.includes("APP"));
    expect(userContextMessage?.content).toContain("Application Instructions");
    expect(userContextMessage?.content).toContain("User Instructions");
    expect(userContextMessage?.content).toContain("Tool-authority Instructions");
    expect(userContextMessage?.content).toContain("Retrieved-content Instructions");
    expect(result.tools?.[0]?.function.name).toBe("do_thing");
    expect(
      result.messages.some((m) => m.role === "tool" && m.content === "plain string output"),
    ).toBe(true);
  });

  it("notes when no developer-authority instructions are present", () => {
    const ctx = createContext({
      instructions: [
        { id: "urn:ulcs:instr:sys", "@type": "Instruction", authority: "system", content: "SYS" },
      ],
    });
    const result = toOpenAIMessages(compileContext(ctx));
    expect(result.notes.some((n) => n.includes("No developer-authority instructions"))).toBe(true);
  });
});

describe("toAnthropicMessages full spectrum", () => {
  it("folds application instructions into system and user/tool into the context turn", () => {
    const result = toAnthropicMessages(fullSpectrumCompiled());
    expect(result.system).toContain("Application Instructions");
    const contextTurn = result.messages.find((m) => m.content.includes("Context:"));
    expect(contextTurn?.content).toContain("User Instructions");
    expect(contextTurn?.content).toContain("Tool-authority Instructions");
    expect(contextTurn?.content).toContain("Retrieved-content Instructions");
  });

  it("folds conversation role 'system' and 'tool' into labeled user turns", () => {
    const result = toAnthropicMessages(fullSpectrumCompiled());
    expect(
      result.messages.some((m) => m.content.includes("[system note] mid-convo system note")),
    ).toBe(true);
    expect(result.messages.some((m) => m.content.includes("[tool message] tool turn"))).toBe(true);
  });

  it("renders a tool results block", () => {
    const result = toAnthropicMessages(fullSpectrumCompiled());
    expect(result.messages.some((m) => m.content.startsWith("Tool results:"))).toBe(true);
  });
});

describe("toGeminiContents full spectrum", () => {
  it("folds application instructions into systemInstruction", () => {
    const result = toGeminiContents(fullSpectrumCompiled());
    const systemText = result.systemInstruction.parts.map((p) => p.text).join("\n");
    expect(systemText).toContain("Application Instructions");
  });

  it("folds conversation role 'system' and 'tool' into labeled user turns", () => {
    const result = toGeminiContents(fullSpectrumCompiled());
    const allText = result.contents.map((c) => c.parts.map((p) => p.text).join("")).join("\n");
    expect(allText).toContain("[system note] mid-convo system note");
    expect(allText).toContain("[tool message] tool turn");
  });

  it("renders a tool results block", () => {
    const result = toGeminiContents(fullSpectrumCompiled());
    const allText = result.contents.map((c) => c.parts.map((p) => p.text).join("")).join("\n");
    expect(allText).toContain("Tool results:");
  });
});

describe("toGenericChatMessages full spectrum", () => {
  it("folds every non-system/user/assistant role into a labeled user message", () => {
    const result = toGenericChatMessages(fullSpectrumCompiled());
    expect(result.messages.some((m) => m.content.includes("[system] mid-convo system note"))).toBe(
      true,
    );
    expect(result.messages.some((m) => m.content.includes("[tool] tool turn"))).toBe(true);
    expect(result.notes.some((n) => n.includes("folded into a labeled user message"))).toBe(true);
  });

  it("renders a tool results block", () => {
    const result = toGenericChatMessages(fullSpectrumCompiled());
    expect(result.messages.some((m) => m.content.startsWith("Tool results:"))).toBe(true);
  });
});
