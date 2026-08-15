import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateContext, validateContextPatch } from "@ulcs/validator";

const FIXTURES_ROOT = path.resolve(__dirname, "../fixtures");

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dir, name));
}

function loadJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

describe("positive fixtures validate against the ContextEnvelope schema", () => {
  const files = listJsonFiles(path.join(FIXTURES_ROOT, "positive"));
  it("has at least one positive fixture", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${path.basename(file)} is valid`, () => {
      const result = validateContext(loadJson(file));
      expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
    });
  }
});

describe("negative envelope fixtures are rejected, each with at least one error", () => {
  const files = listJsonFiles(path.join(FIXTURES_ROOT, "negative/envelope"));
  it("has at least one negative fixture", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${path.basename(file)} is invalid`, () => {
      const result = validateContext(loadJson(file));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});

describe("negative patch fixtures are rejected", () => {
  const files = listJsonFiles(path.join(FIXTURES_ROOT, "negative/patch"));
  it("has at least one negative patch fixture", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${path.basename(file)} is invalid`, () => {
      const result = validateContextPatch(loadJson(file));
      expect(result.valid).toBe(false);
    });
  }
});
