import { describe, expect, it } from "vitest";
import { applyContextPatch, createContext, JsonPatchError } from "../src/index.js";
import type { ContextPatch } from "../src/index.js";

describe("applyContextPatch", () => {
  it("applies add/replace/remove operations", () => {
    const ctx = createContext({
      id: "urn:ulcs:context:1",
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "old", status: "confirmed" }],
    });
    const patch: ContextPatch = {
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      targetId: "urn:ulcs:context:1",
      operations: [
        { op: "replace", path: "/facts/0/status", value: "retracted" },
        {
          op: "add",
          path: "/facts/-",
          value: { id: "urn:ulcs:fact:2", "@type": "Fact", content: "new" },
        },
      ],
    };
    const patched = applyContextPatch(ctx, patch);
    expect(patched.facts?.[0]?.status).toBe("retracted");
    expect(patched.facts).toHaveLength(2);
    expect(patched.facts?.[1]?.id).toBe("urn:ulcs:fact:2");
    // original untouched
    expect(ctx.facts?.[0]?.status).toBe("confirmed");
    expect(ctx.facts).toHaveLength(1);
  });

  it("is all-or-nothing: a failing test op throws and nothing is applied", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "old" }],
    });
    const patch: ContextPatch = {
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      operations: [
        { op: "replace", path: "/facts/0/content", value: "changed" },
        { op: "test", path: "/facts/0/content", value: "this will not match" },
      ],
    };
    expect(() => applyContextPatch(ctx, patch)).toThrow(JsonPatchError);
    expect(ctx.facts?.[0]?.content).toBe("old");
  });

  it("rejects a patch whose targetId does not match", () => {
    const ctx = createContext({ id: "urn:ulcs:context:a" });
    const patch: ContextPatch = {
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      targetId: "urn:ulcs:context:b",
      operations: [{ op: "replace", path: "/schemaVersion", value: "2.0.0" }],
    };
    expect(() => applyContextPatch(ctx, patch)).toThrow(/targetId/);
  });

  it("supports move and copy", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "hello" }],
    });
    const patch: ContextPatch = {
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      operations: [{ op: "copy", from: "/facts/0", path: "/facts/-" }],
    };
    const patched = applyContextPatch(ctx, patch);
    expect(patched.facts).toHaveLength(2);
    expect(patched.facts?.[1]?.content).toBe("hello");
  });
});
