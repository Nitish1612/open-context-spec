import { readFileSync } from "node:fs";
import path from "node:path";
import { createContext } from "@ulcs/core";
import { compileContext } from "@ulcs/compiler";
import { toMCPResource } from "@ulcs/adapters";
import { describe, expect, it } from "vitest";

describe("toMCPResource", () => {
  it("round-trips a CompiledContext as full-fidelity JSON with no item loss", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "A" },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "B" },
      ],
    });
    const compiled = compileContext(ctx);
    const resource = toMCPResource(compiled);
    expect(resource.mimeType).toBe("application/json");
    const roundTripped = JSON.parse(resource.text);
    const factsSection = roundTripped.sections.find((s: { key: string }) => s.key === "facts");
    expect(factsSection.items).toHaveLength(2);
  });

  it("also accepts a raw ContextEnvelope", () => {
    const ctx = createContext({ id: "urn:ulcs:context:mcp-raw" });
    const resource = toMCPResource(ctx);
    expect(JSON.parse(resource.text).id).toBe("urn:ulcs:context:mcp-raw");
  });
});

describe("JSON-LD context document", () => {
  const contextPath = path.resolve(__dirname, "../../schemas/context/v1.jsonld");
  const doc = JSON.parse(readFileSync(contextPath, "utf8"));

  it("declares an @context object with core type mappings", () => {
    expect(doc["@context"]).toBeTypeOf("object");
    for (const type of ["ContextEnvelope", "Fact", "Instruction", "Provenance", "ToolResult"]) {
      expect(doc["@context"][type]).toBeDefined();
    }
  });

  it("maps id/type to the JSON-LD keywords @id/@type", () => {
    expect(doc["@context"].id).toBe("@id");
    expect(doc["@context"].type).toBe("@type");
  });
});
