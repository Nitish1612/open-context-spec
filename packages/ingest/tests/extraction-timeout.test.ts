import { describe, expect, it } from "vitest";
import { extractDocument, resolveInput, SecurityRejectionError } from "../src/index.js";
import type { ContentExtractor, ResolvedInput } from "../src/index.js";
import { createExtractorRegistry } from "../src/index.js";

/** Never resolves on its own — simulates a hung third-party library call. */
const hangingExtractor: ContentExtractor = {
  id: "hanging-test-extractor",
  name: "Hanging Test Extractor",
  extensions: [".hang"],
  mediaTypes: ["application/x-hang-test"],
  supports: () => true,
  extract: () => new Promise(() => undefined),
};

let mutatedAfterTimeout = false;
/** Resolves *after* its deadline, and would mutate shared state if allowed to run to completion unchecked. */
const lateSettlingExtractor: ContentExtractor = {
  id: "late-settling-test-extractor",
  name: "Late Settling Test Extractor",
  extensions: [".late"],
  mediaTypes: ["application/x-late-test"],
  supports: () => true,
  extract: async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    mutatedAfterTimeout = true;
    return {
      id: "doc:late",
      mediaType: "application/x-late-test",
      contentHash: "late",
      byteLength: 0,
      extractedAt: new Date(0).toISOString(),
      sections: [],
      metadata: {},
      warnings: [],
    };
  },
};

describe("Defect 7: extraction deadline applies to every extractor, including custom ones", () => {
  it("rejects promptly (well under the extractor's real hang time) when a custom extractor never resolves", async () => {
    const registry = createExtractorRegistry();
    registry.register(hangingExtractor);
    const input: ResolvedInput = await resolveInput(
      { kind: "text", content: "x", name: "a.hang" },
      {},
    );

    const start = Date.now();
    await expect(
      extractDocument(input, { limits: { extractionTimeoutMs: 200 } }, { registry }),
    ).rejects.toThrow(SecurityRejectionError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  }, 10000);

  it("does not let a late-settling extractor mutate state the caller can observe as a successful result, nor produce an unhandled rejection", async () => {
    mutatedAfterTimeout = false;
    const registry = createExtractorRegistry();
    registry.register(lateSettlingExtractor);
    const input: ResolvedInput = await resolveInput(
      { kind: "text", content: "x", name: "a.late" },
      {},
    );

    await expect(
      extractDocument(input, { limits: { extractionTimeoutMs: 50 } }, { registry }),
    ).rejects.toThrow(SecurityRejectionError);

    // The extractor's own background work continues (it wasn't literally
    // killed — there is no way to hard-kill in-flight JS), but by the time
    // it finishes, the caller has already received a rejection and moved
    // on; wait past its completion and confirm nothing surfaces as an
    // unhandled rejection (vitest fails the run on those) and that this
    // observation happens well after our call already settled.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mutatedAfterTimeout).toBe(true); // background work did finish...
    // ...but nothing in our public API surfaced it as a usable result.
  }, 10000);

  it("honors a caller-supplied AbortSignal for extraction, independent of the timeout", async () => {
    const registry = createExtractorRegistry();
    registry.register(hangingExtractor);
    const input: ResolvedInput = await resolveInput(
      { kind: "text", content: "x", name: "a.hang" },
      {},
    );
    const controller = new AbortController();
    const promise = extractDocument(
      input,
      { limits: { extractionTimeoutMs: 60_000 }, signal: controller.signal },
      { registry },
    );
    setTimeout(() => controller.abort(new Error("caller cancelled")), 50);
    await expect(promise).rejects.toThrow();
  }, 10000);
});
