import type { Actor, Entity, Objective, Relationship, ToolResult } from "@ulcs/core";
import { describe, expect, it } from "vitest";
import { approxChar4Tokenizer, getItemText, getObjectiveText } from "../src/tokenizer.js";
import { truncateToTokens } from "../src/truncate.js";

describe("getItemText", () => {
  it("uses content when present", () => {
    expect(getItemText({ id: "1", "@type": "Fact", content: "hello" })).toBe("hello");
  });

  it("falls back to name for Task/Entity/ToolDefinition", () => {
    const entity: Entity = { id: "1", "@type": "Entity", name: "Widget", entityType: "Product" };
    expect(getItemText(entity)).toBe("Widget");
  });

  it("falls back to displayName, then role, for Actor", () => {
    const withDisplayName: Actor = {
      id: "1",
      "@type": "Actor",
      role: "user",
      displayName: "Jordan",
    };
    expect(getItemText(withDisplayName)).toBe("Jordan");
    const withoutDisplayName: Actor = { id: "2", "@type": "Actor", role: "user" };
    expect(getItemText(withoutDisplayName)).toBe("user");
  });

  it("stringifies output for ToolResult", () => {
    const result: ToolResult = {
      id: "1",
      "@type": "ToolResult",
      toolName: "t",
      outcome: "success",
      output: { a: 1 },
    };
    expect(getItemText(result)).toBe(JSON.stringify({ a: 1 }));
  });

  it("renders subject/predicate/object for Relationship", () => {
    const rel: Relationship = {
      id: "1",
      "@type": "Relationship",
      subjectId: "s",
      predicate: "p",
      objectId: "o",
    };
    expect(getItemText(rel)).toBe("s p o");
  });

  it("returns an empty string for types with no textual representation", () => {
    const question = { id: "1", "@type": "Question", resolved: false } as never;
    expect(getItemText(question)).toBe("");
  });
});

describe("getObjectiveText", () => {
  it("joins summary, successCriteria, and nonGoals, skipping empties", () => {
    const objective: Objective = {
      id: "1",
      "@type": "Objective",
      summary: "Do the thing",
      successCriteria: ["Criterion A", ""],
      nonGoals: ["Avoid B"],
    };
    expect(getObjectiveText(objective)).toBe("Do the thing Criterion A Avoid B");
  });

  it("handles an objective with only a summary", () => {
    expect(getObjectiveText({ id: "1", "@type": "Objective", summary: "Just this" })).toBe(
      "Just this",
    );
  });
});

describe("approxChar4Tokenizer", () => {
  it("estimates ~4 chars per token, rounding up", () => {
    expect(approxChar4Tokenizer("abcd")).toBe(1);
    expect(approxChar4Tokenizer("abcde")).toBe(2);
    expect(approxChar4Tokenizer("")).toBe(0);
  });
});

describe("truncateToTokens", () => {
  it("returns an empty string when maxTokens is 0 or negative", () => {
    expect(truncateToTokens("hello", 0, approxChar4Tokenizer)).toBe("");
    expect(truncateToTokens("hello", -5, approxChar4Tokenizer)).toBe("");
  });

  it("returns the original text unchanged when it already fits", () => {
    expect(truncateToTokens("hi", 100, approxChar4Tokenizer)).toBe("hi");
  });

  it("truncates and appends an ellipsis when the text doesn't fit", () => {
    const result = truncateToTokens("x".repeat(100), 5, approxChar4Tokenizer);
    expect(result.endsWith("…")).toBe(true);
    expect(approxChar4Tokenizer(result)).toBeLessThanOrEqual(5);
  });

  it("returns an empty string when not even one character fits", () => {
    const tinyBudgetTokenizer = () => 100; // any non-empty text "costs" 100 tokens
    expect(truncateToTokens("hello", 1, tinyBudgetTokenizer)).toBe("");
  });
});
