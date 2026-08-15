import { describe, expect, it } from "vitest";
import { createContext, mergeContexts } from "../src/index.js";
import type { Fact } from "../src/index.js";

function fact(id: string, content: string, status: Fact["status"] = "confirmed"): Fact {
  return { id, "@type": "Fact", content, status };
}

describe("mergeContexts", () => {
  it("unions disjoint items", () => {
    const a = createContext({ facts: [fact("urn:ulcs:fact:1", "A")] });
    const b = createContext({ facts: [fact("urn:ulcs:fact:2", "B")] });
    const { merged, conflicts } = mergeContexts(a, b);
    expect(merged.facts?.map((f) => f.id).sort()).toEqual(["urn:ulcs:fact:1", "urn:ulcs:fact:2"]);
    expect(conflicts).toEqual([]);
  });

  it("merges identical items, unioning tags", () => {
    const a = createContext({
      facts: [{ ...fact("urn:ulcs:fact:1", "A"), tags: ["x"], priority: 10 }],
    });
    const b = createContext({
      facts: [{ ...fact("urn:ulcs:fact:1", "A"), tags: ["y"], priority: 40 }],
    });
    const { merged, conflicts } = mergeContexts(a, b);
    expect(merged.facts).toHaveLength(1);
    expect(merged.facts?.[0]?.tags?.sort()).toEqual(["x", "y"]);
    expect(merged.facts?.[0]?.priority).toBe(40);
    expect(conflicts).toEqual([]);
  });

  it("never silently overwrites two confirmed facts that disagree — keeps both and reports a conflict", () => {
    const a = createContext({ facts: [fact("urn:ulcs:fact:1", "The plan is Pro.")] });
    const b = createContext({ facts: [fact("urn:ulcs:fact:1", "The plan is Enterprise.")] });
    const { merged, conflicts } = mergeContexts(a, b);
    expect(merged.facts).toHaveLength(2);
    expect(merged.facts?.some((f) => f.content === "The plan is Pro.")).toBe(true);
    expect(merged.facts?.some((f) => f.content === "The plan is Enterprise.")).toBe(true);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("content-mismatch");
    expect(conflicts[0]?.resolution).toBe("kept-both");
  });

  it("treats same id + different @type within the same array as always-conflict regardless of status", () => {
    const a = createContext({ facts: [fact("urn:ulcs:x:1", "A fact", "unconfirmed")] });
    const bFacts = createContext({
      facts: [
        { id: "urn:ulcs:x:1", "@type": "Assumption", content: "conflict" } as unknown as Fact,
      ],
    });
    const { conflicts } = mergeContexts(a, bFacts);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("type-mismatch");
  });

  it("resolves non-confirmed differing items via itemStrategy without flagging a conflict", () => {
    const a = createContext({ facts: [fact("urn:ulcs:fact:1", "Old guess", "unconfirmed")] });
    const b = createContext({ facts: [fact("urn:ulcs:fact:1", "New guess", "unconfirmed")] });
    const { merged, conflicts } = mergeContexts(a, b, { itemStrategy: "prefer-b" });
    expect(merged.facts).toHaveLength(1);
    expect(merged.facts?.[0]?.content).toBe("New guess");
    expect(conflicts).toEqual([]);
  });

  it("does not mutate either input", () => {
    const a = createContext({ facts: [fact("urn:ulcs:fact:1", "A")] });
    const b = createContext({ facts: [fact("urn:ulcs:fact:1", "B")] });
    const aBefore = JSON.stringify(a);
    const bBefore = JSON.stringify(b);
    mergeContexts(a, b);
    expect(JSON.stringify(a)).toBe(aBefore);
    expect(JSON.stringify(b)).toBe(bBefore);
  });
});
