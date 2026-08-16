import { describe, expect, it } from "vitest";
import { ingestText } from "../src/index.js";
import type { ContextEnricher, EnrichmentOptions } from "../src/index.js";

describe("Defect 13: ContextEnricher / EnrichmentOptions are actually defined", () => {
  it("a conforming implementation type-checks and is callable against a real ExtractedDocument", async () => {
    const calls: Array<{ id: string; hadSignal: boolean }> = [];

    const enricher: ContextEnricher = {
      id: "test-enricher",
      name: "Test Enricher",
      async enrich(document, options?: EnrichmentOptions) {
        calls.push({ id: document.id, hadSignal: options?.signal !== undefined });
        return [
          {
            "@type": "Fact",
            id: "fact:1",
            status: "unconfirmed",
            statement: "derived from the document",
            provenance: { source: "ai-enrichment" },
          } as unknown as Awaited<ReturnType<ContextEnricher["enrich"]>>[number],
        ];
      },
    };

    const { documents } = await ingestText("Some content to enrich.", { name: "e.txt" });
    const controller = new AbortController();
    const items = await enricher.enrich(documents[0]!, { signal: controller.signal });

    expect(items).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.hadSignal).toBe(true);
  });

  it("enrich() is callable with no options at all (options is optional)", async () => {
    const enricher: ContextEnricher = {
      id: "noop-enricher",
      name: "Noop Enricher",
      async enrich() {
        return [];
      },
    };
    const { documents } = await ingestText("More content.", { name: "e2.txt" });
    await expect(enricher.enrich(documents[0]!)).resolves.toEqual([]);
  });
});
