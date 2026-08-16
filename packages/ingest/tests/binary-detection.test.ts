import { describe, expect, it } from "vitest";
import { decodeTextSafely } from "../src/extractors/util.js";
import { ExtractionError } from "../src/errors.js";
import { textExtractor } from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}

describe("Defect 12: decodeTextSafely — accurate binary-vs-text detection", () => {
  it("accepts plain valid UTF-8 with no warning", () => {
    const result = decodeTextSafely(new TextEncoder().encode("hello, world"));
    expect(result.text).toBe("hello, world");
    expect(result.hadInvalidSequences).toBe(false);
    expect(result.encoding).toBe("utf-8");
  });

  it("accepts emoji and multilingual valid UTF-8 with no warning", () => {
    const source = "Héllo — こんにちは 🎉 Привет";
    const result = decodeTextSafely(new TextEncoder().encode(source));
    expect(result.text).toBe(source);
    expect(result.hadInvalidSequences).toBe(false);
  });

  it("recognizes and strips a UTF-8 BOM", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const payload = new TextEncoder().encode("hello");
    const data = new Uint8Array([...bom, ...payload]);
    const result = decodeTextSafely(data);
    expect(result.text).toBe("hello");
    expect(result.encoding).toBe("utf-8-bom");
    expect(result.hadInvalidSequences).toBe(false);
  });

  it("recognizes a UTF-16LE BOM and decodes correctly", () => {
    const data = new Uint8Array([0xff, 0xfe, ...Buffer.from("hi", "utf16le")]);
    const result = decodeTextSafely(data);
    expect(result.text).toBe("hi");
    expect(result.encoding).toBe("utf-16le");
    expect(result.hadInvalidSequences).toBe(false);
  });

  it("recognizes a UTF-16BE BOM and decodes correctly", () => {
    const le = Buffer.from("hi", "utf16le");
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1] as number;
      be[i + 1] = le[i] as number;
    }
    const data = new Uint8Array([0xfe, 0xff, ...be]);
    const result = decodeTextSafely(data);
    expect(result.text).toBe("hi");
    expect(result.encoding).toBe("utf-16be");
  });

  it("rejects random binary bytes by default", () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef, 0x80, 0x81]);
    expect(() => decodeTextSafely(data)).toThrow(ExtractionError);
  });

  it("rejects NUL-heavy input by default even when otherwise-valid UTF-8 surrounds it", () => {
    const data = new Uint8Array([
      ...new TextEncoder().encode("abc"),
      0x00,
      0x00,
      0x00,
      ...new TextEncoder().encode("def"),
    ]);
    expect(() => decodeTextSafely(data)).toThrow(ExtractionError);
  });

  it("rejects NUL bytes even in tolerant mode (NUL is not a bounded-corruption case)", () => {
    const data = new Uint8Array([
      ...new TextEncoder().encode("abc"),
      0x00,
      ...new TextEncoder().encode("def"),
    ]);
    expect(() => decodeTextSafely(data, { tolerant: true, maxInvalidSequenceRatio: 1 })).toThrow(
      ExtractionError,
    );
  });

  it("rejects malformed UTF-8 by default (no silent lossy replacement)", () => {
    const data = new Uint8Array([...new TextEncoder().encode("café"), 0xff, 0xfe]);
    expect(() => decodeTextSafely(data)).toThrow(ExtractionError);
  });

  it("allows a small bounded amount of malformed UTF-8 through in tolerant mode", () => {
    const data = new Uint8Array([...new TextEncoder().encode("a".repeat(100)), 0xff, 0xfe]);
    const result = decodeTextSafely(data, { tolerant: true });
    expect(result.hadInvalidSequences).toBe(true);
    expect(result.text).toContain("a".repeat(100));
  });

  it("still rejects in tolerant mode when corruption exceeds maxInvalidSequenceRatio", () => {
    const data = new Uint8Array([...new TextEncoder().encode("ab"), 0xff, 0xfe]);
    expect(() => decodeTextSafely(data, { tolerant: true })).toThrow(ExtractionError);
  });

  it("respects a caller-supplied maxInvalidSequenceRatio override", () => {
    const data = new Uint8Array([...new TextEncoder().encode("ab"), 0xff, 0xfe]);
    const result = decodeTextSafely(data, { tolerant: true, maxInvalidSequenceRatio: 1 });
    expect(result.hadInvalidSequences).toBe(true);
  });

  it("end to end: textExtractor rejects a binary buffer routed to it by mistake", async () => {
    const pngLikeHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    await expect(
      textExtractor.extract(bufInput(pngLikeHeader, "not-really.txt"), {}),
    ).rejects.toThrow(ExtractionError);
  });

  it("end to end: textExtractor accepts tolerant mode for mildly corrupted text", async () => {
    const data = new Uint8Array([
      ...new TextEncoder().encode("mostly fine text ".repeat(20)),
      0xff,
      0xfe,
    ]);
    const doc = await textExtractor.extract(bufInput(data, "ok.txt"), {
      tolerantTextDecoding: true,
    });
    expect(doc.warnings.some((w) => w.code === "malformed-content")).toBe(true);
  });
});
