import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateContext } from "@ulcs/validator";

const EXAMPLES_ROOT = path.resolve(__dirname, "../../examples");

function findContextFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...findContextFiles(full));
    } else if (/^context(-[a-z]+)?\.json$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe("every example context document validates against the schema", () => {
  const files = findContextFiles(EXAMPLES_ROOT);

  it("found at least 10 example documents", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    it(`${path.relative(EXAMPLES_ROOT, file)} is valid`, () => {
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const result = validateContext(doc);
      expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
    });
  }
});
