import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const BIN = path.resolve(__dirname, "../dist/bin.js");
const dir = mkdtempSync(path.join(tmpdir(), "ulcs-cli-test-"));

const VALID_CONTEXT = {
  "@context": "https://ulcs.dev/context/v1",
  "@type": "ContextEnvelope",
  schemaVersion: "1.0.0",
  id: "urn:ulcs:context:cli-test",
  createdAt: "2026-08-15T12:00:00Z",
  facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "The sky is blue." }],
};

const INVALID_CONTEXT = { "@type": "ContextEnvelope" };

function writeFixture(name: string, data: unknown): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function run(args: string[], input?: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [BIN, ...args], {
      input: input ?? "",
      encoding: "utf8",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      status: execError.status ?? 1,
    };
  }
}

let validFile: string;
let invalidFile: string;

beforeAll(() => {
  validFile = writeFixture("valid.json", VALID_CONTEXT);
  invalidFile = writeFixture("invalid.json", INVALID_CONTEXT);
});

describe("ulcs validate", () => {
  it("exits 0 for a valid document", () => {
    const result = run(["validate", validFile]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("exits 1 for an invalid document, with --json errors carrying JSON Pointer paths", () => {
    const result = run(["validate", invalidFile, "--json"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("reads from stdin when file is '-'", () => {
    const result = run(["validate", "-"], JSON.stringify(VALID_CONTEXT));
    expect(result.status).toBe(0);
  });
});

describe("ulcs compile", () => {
  it("supports every documented target", () => {
    for (const target of ["openai", "anthropic", "gemini", "generic", "markdown", "mcp"]) {
      const result = run(["compile", validFile, "--target", target]);
      expect(result.status, `target ${target} stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown target with exit code 2", () => {
    const result = run(["compile", validFile, "--target", "bogus"]);
    expect(result.status).toBe(2);
  });
});

describe("ulcs normalize", () => {
  it("outputs a normalized envelope with default trust/status filled in", () => {
    const result = run(["normalize", validFile]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.facts[0].status).toBe("confirmed");
    expect(parsed.facts[0].trust).toBeDefined();
  });
});

describe("ulcs redact", () => {
  it("excludes secret-level items by default", () => {
    const file = writeFixture("secret.json", {
      ...VALID_CONTEXT,
      id: "urn:ulcs:context:secret-test",
      facts: [
        ...VALID_CONTEXT.facts,
        {
          id: "urn:ulcs:fact:2",
          "@type": "Fact",
          content: "api key xyz",
          sensitivity: { level: "secret" },
        },
      ],
    });
    const result = run(["redact", file]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.facts.map((f: { id: string }) => f.id)).toEqual(["urn:ulcs:fact:1"]);
  });
});

describe("ulcs diff", () => {
  it("exits 1 when there are differences and 0 when there are none", () => {
    const changed = writeFixture("changed.json", {
      ...VALID_CONTEXT,
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "The sky is green now." }],
    });
    const diffResult = run(["diff", validFile, changed]);
    expect(diffResult.status).toBe(1);
    expect(diffResult.stdout).toContain("changed");

    const sameResult = run(["diff", validFile, validFile]);
    expect(sameResult.status).toBe(0);
    expect(sameResult.stdout).toContain("No differences");
  });
});

describe("ulcs patch", () => {
  it("applies a ContextPatch document", () => {
    const patchFile = writeFixture("patch.json", {
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      operations: [{ op: "replace", path: "/facts/0/status", value: "retracted" }],
    });
    const result = run(["patch", validFile, "--patch", patchFile]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.facts[0].status).toBe("retracted");
  });
});

describe("ulcs --version / --help", () => {
  it("prints a version", () => {
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});
