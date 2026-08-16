import { describe, expect, it } from "vitest";
import {
  jsonExtractor,
  jsonlExtractor,
  csvExtractor,
  tsvExtractor,
  ExtractionError,
} from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";

function bufInput(content: string, filename: string): ResolvedInput {
  return { source: { kind: "text", content }, data: new TextEncoder().encode(content), filename };
}

describe("json extractor", () => {
  it("produces one section per top-level object key with a JSON Pointer-ish path", async () => {
    const doc = await jsonExtractor.extract(bufInput('{"a":1,"b":{"c":2}}', "d.json"), {});
    expect(doc.sections.map((s) => s.section)).toEqual(["$.a", "$.b"]);
  });

  it("produces one section per array element for a top-level array", async () => {
    const doc = await jsonExtractor.extract(bufInput("[10,20,30]", "d.json"), {});
    expect(doc.sections).toHaveLength(3);
    expect(doc.sections[1]?.content).toBe("20");
  });

  it("rejects invalid JSON with a line/column diagnostic", async () => {
    await expect(jsonExtractor.extract(bufInput('{"a": }', "bad.json"), {})).rejects.toThrow(
      ExtractionError,
    );
  });

  it("does not flatten a nested object into an unreadable single line", async () => {
    const doc = await jsonExtractor.extract(bufInput('{"nested":{"x":1,"y":2}}', "d.json"), {});
    expect(doc.sections[0]?.content).toContain("\n");
  });
});

describe("jsonl extractor", () => {
  it("produces one section per record and records line numbers", async () => {
    const jsonl = '{"a":1}\n{"a":2}\n{"a":3}\n';
    const doc = await jsonlExtractor.extract(bufInput(jsonl, "d.jsonl"), {});
    expect(doc.sections).toHaveLength(3);
    expect(doc.sections[1]?.metadata?.lineNumber).toBe(2);
  });

  it("skips an invalid line with a warning instead of failing the whole file", async () => {
    const jsonl = '{"a":1}\nnot json\n{"a":2}\n';
    const doc = await jsonlExtractor.extract(bufInput(jsonl, "d.jsonl"), {});
    expect(doc.sections).toHaveLength(2);
    expect(doc.warnings.some((w) => w.code === "malformed-content")).toBe(true);
  });
});

describe("csv extractor", () => {
  it("parses quoted fields containing the delimiter and embedded newlines", async () => {
    const csv = 'name,note\nAlice,"hello, world"\nBob,"multi\nline"\n';
    const doc = await csvExtractor.extract(bufInput(csv, "d.csv"), {});
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]?.content).toContain("hello, world");
    expect(doc.sections[1]?.content).toContain("multi\nline");
  });

  it("records row ranges and never merges two rows into one section", async () => {
    const csv = "a,b\n1,2\n3,4\n5,6\n";
    const doc = await csvExtractor.extract(bufInput(csv, "d.csv"), {});
    expect(doc.sections.map((s) => s.rowStart)).toEqual([2, 3, 4]);
    expect(doc.sections.every((s) => s.rowStart === s.rowEnd)).toBe(true);
  });

  it("preserves headers in document metadata", async () => {
    const doc = await csvExtractor.extract(bufInput("id,name\n1,a\n", "d.csv"), {});
    expect(doc.metadata.headers).toEqual(["id", "name"]);
  });
});

describe("tsv extractor", () => {
  it("parses tab-delimited data by default", async () => {
    const tsv = "a\tb\n1\t2\n";
    const doc = await tsvExtractor.extract(bufInput(tsv, "d.tsv"), {});
    expect(doc.metadata.headers).toEqual(["a", "b"]);
    expect(doc.sections[0]?.content).toContain("1");
  });
});

describe("csv extractor with delimiter override", () => {
  it("respects an explicit delimiter option", async () => {
    const semicolon = "a;b\n1;2\n";
    const doc = await csvExtractor.extract(bufInput(semicolon, "d.csv"), { delimiter: ";" });
    expect(doc.metadata.headers).toEqual(["a", "b"]);
  });
});
