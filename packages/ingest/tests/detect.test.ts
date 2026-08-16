import { describe, expect, it } from "vitest";
import {
  createExtractorRegistry,
  listBuiltInExtractors,
  detectExtractor,
  AmbiguousFormatError,
  UnsupportedFormatError,
} from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";

function input(overrides: Partial<ResolvedInput>): ResolvedInput {
  return { source: { kind: "text", content: "" }, ...overrides };
}

describe("detection", () => {
  it("detects by file extension when no other signal is available", async () => {
    const result = await detectExtractor(
      input({ filename: "notes.md", data: new TextEncoder().encode("# hi") }),
    );
    expect(result.extractor.id).toBe("markdown");
  });

  it("detects by declared MIME type", async () => {
    const result = await detectExtractor(
      input({
        filename: "data",
        mediaType: "text/csv",
        data: new TextEncoder().encode("a,b\n1,2"),
      }),
    );
    expect(result.extractor.id).toBe("csv");
  });

  it("detects PDF by magic bytes even with a wrong extension", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\n...");
    const result = await detectExtractor(input({ filename: "document.txt", data: bytes }));
    expect(result.extractor.id).toBe("pdf");
  });

  it("prefers magic-byte detection over a mismatched extension (never trusts extension alone)", async () => {
    const jsonBytes = new TextEncoder().encode('{"a":1}');
    const result = await detectExtractor(input({ filename: "fake.txt", data: jsonBytes }));
    expect(result.extractor.id).toBe("json");
  });

  it("honors an explicit --type override even when it disagrees with detection", async () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    const result = await detectExtractor(input({ filename: "fake.json", data: bytes }), {
      type: "text",
    });
    expect(result.extractor.id).toBe("text");
  });

  it("throws UnsupportedFormatError, listing available extractors, for unknown formats", async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    await expect(detectExtractor(input({ filename: "file.bin", data: bytes }))).rejects.toThrow(
      UnsupportedFormatError,
    );
    try {
      await detectExtractor(input({ filename: "file.bin", data: bytes }));
    } catch (error) {
      expect((error as UnsupportedFormatError).message).toContain("text");
      expect((error as UnsupportedFormatError).exitCode).toBe(2);
    }
  });

  it("throws UnsupportedFormatError for an unknown explicit --type", async () => {
    await expect(
      detectExtractor(input({ filename: "x.txt", data: new Uint8Array() }), {
        type: "nonexistent",
      }),
    ).rejects.toThrow(UnsupportedFormatError);
  });

  it("registers all documented built-in extractors exactly once", () => {
    const ids = listBuiltInExtractors().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "text",
        "markdown",
        "json",
        "jsonl",
        "csv",
        "tsv",
        "html",
        "xml",
        "pdf",
        "docx",
        "pptx",
        "xlsx",
      ]),
    );
  });

  it("supports a custom registry independent of the default one", async () => {
    const registry = createExtractorRegistry();
    expect(registry.list()).toHaveLength(0);
    registry.register(listBuiltInExtractors().find((e) => e.id === "text")!);
    const result = await registry.detect(
      input({ filename: "a.txt", data: new TextEncoder().encode("hi") }),
    );
    expect(result.extractor.id).toBe("text");
  });

  it("flags ambiguous detection when two extractors score identically", async () => {
    const registry = createExtractorRegistry();
    const base = listBuiltInExtractors().find((e) => e.id === "csv")!;
    registry.register(base);
    registry.register({ ...base, id: "csv-clone", name: "CSV clone" });
    await expect(
      registry.detect(
        input({
          filename: "data.csv",
          mediaType: "text/csv",
          data: new TextEncoder().encode("a,b"),
        }),
      ),
    ).rejects.toThrow(AmbiguousFormatError);
  });
});
