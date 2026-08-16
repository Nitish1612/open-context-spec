import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const BIN = path.resolve(__dirname, "../dist/bin.js");
let dir: string;
let dirIngestDir: string;

function run(args: string[], input?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("node", [BIN, ...args], { input: input ?? "", encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ulcs-cli-ingest-test-"));
  writeFileSync(
    path.join(dir, "note.md"),
    "# Notes\n\nSome useful body content long enough to survive minimum chunk size checks.",
  );
  writeFileSync(path.join(dir, "data.csv"), "name,role\nAlice,Engineer\nBob,Designer\n");
  writeFileSync(path.join(dir, "data.json"), JSON.stringify({ a: 1, b: { c: 2 } }));

  // A dedicated, isolated directory for directory-ingestion tests, so files
  // written by unrelated tests (or this suite's own JSON output files)
  // never pollute the file set being walked.
  dirIngestDir = mkdtempSync(path.join(tmpdir(), "ulcs-cli-ingest-dir-test-"));
  writeFileSync(
    path.join(dirIngestDir, "a.txt"),
    "File A content long enough to survive minimum chunk checks.",
  );
  writeFileSync(
    path.join(dirIngestDir, "b.txt"),
    "File B content long enough to survive minimum chunk checks.",
  );
  writeFileSync(
    path.join(dirIngestDir, "c.md"),
    "# C\n\nFile C content long enough to survive minimum checks.",
  );
  mkdirSync(path.join(dirIngestDir, "sub"));
  writeFileSync(
    path.join(dirIngestDir, "sub", "d.txt"),
    "Nested D content long enough to survive minimum checks.",
  );
  writeFileSync(
    path.join(dirIngestDir, "sub", "e.txt"),
    "Nested E content long enough to survive minimum checks.",
  );
});

describe("ulcs ingest: file input", () => {
  it("ingests a markdown file to a valid ULCS envelope and exits 0", () => {
    const out = path.join(dir, "note-context.json");
    const result = run(["ingest", path.join(dir, "note.md"), "-o", out, "--quiet"]);
    expect(result.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const envelope = JSON.parse(readFileSync(out, "utf8"));
    expect(envelope["@type"]).toBe("ContextEnvelope");
    expect(envelope.resources.length).toBeGreaterThan(0);
  });

  it("prints a human-readable progress report to stderr on success", () => {
    const out = path.join(dir, "note-context2.json");
    const result = run(["ingest", path.join(dir, "note.md"), "-o", out]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Detected type:");
    expect(result.stderr).toContain("Chunks created:");
    // stdout must contain no diagnostics when writing to a file, not stdout.
    expect(result.stdout).toBe("");
  });

  it("prints nothing but the document to stdout with --stdout", () => {
    const result = run(["ingest", path.join(dir, "note.md"), "--stdout", "--quiet"]);
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("supports --json machine-readable reporting on stderr", () => {
    const out = path.join(dir, "note-context3.json");
    const result = run(["ingest", path.join(dir, "note.md"), "-o", out, "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stderr);
    expect(report.chunksCreated).toBeGreaterThan(0);
  });

  it("exits 2 for a missing file", () => {
    const result = run(["ingest", path.join(dir, "does-not-exist.txt"), "--stdout"]);
    expect(result.status).toBe(2);
  });

  it("exits 2 for an unsupported format, listing available extractors", () => {
    const badFile = path.join(dir, "file.weirdext");
    writeFileSync(badFile, "some content");
    const result = run(["ingest", badFile, "--stdout"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Available extractors");
  });

  it("rejects --output combined with --stdout", () => {
    const result = run([
      "ingest",
      path.join(dir, "note.md"),
      "-o",
      path.join(dir, "x.json"),
      "--stdout",
    ]);
    expect(result.status).toBe(2);
  });

  it("--dry-run runs the pipeline without writing an output file", () => {
    const out = path.join(dir, "should-not-exist.json");
    const result = run(["ingest", path.join(dir, "note.md"), "-o", out, "--dry-run"]);
    expect(result.status).toBe(0);
    expect(existsSync(out)).toBe(false);
  });
});

describe("ulcs ingest: provider targets", () => {
  it("compiles to the openai target", () => {
    const out = path.join(dir, "data-openai.json");
    const result = run([
      "ingest",
      path.join(dir, "data.csv"),
      "--target",
      "openai",
      "-o",
      out,
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    const rendered = JSON.parse(readFileSync(out, "utf8"));
    expect(rendered.messages).toBeDefined();
  });

  it("compiles to the anthropic target", () => {
    const out = path.join(dir, "data-anthropic.json");
    const result = run([
      "ingest",
      path.join(dir, "data.json"),
      "--target",
      "anthropic",
      "-o",
      out,
      "--quiet",
    ]);
    expect(result.status).toBe(0);
    const rendered = JSON.parse(readFileSync(out, "utf8"));
    expect(rendered.messages).toBeDefined();
  });

  it("rejects an unknown target", () => {
    const result = run(["ingest", path.join(dir, "note.md"), "--target", "bogus", "--stdout"]);
    expect(result.status).toBe(2);
  });
});

describe("ulcs ingest: stdin", () => {
  it("ingests inline text from stdin with --type text", () => {
    const result = run(
      ["ingest", "-", "--type", "text", "--stdout", "--quiet"],
      "hello from stdin content here",
    );
    expect(result.status).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.resources[0]?.content).toContain("hello from stdin");
  });
});

describe("ulcs ingest: directory input", () => {
  it("ingests only top-level files by default (non-recursive)", () => {
    const out = path.join(dirIngestDir, "..", "dir-context.json");
    const result = run(["ingest", dirIngestDir, "-o", out, "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stderr);
    expect(report.directorySummary.processed).toBe(3);
    expect(report.directorySummary.failed).toBe(0);
  });

  it("ingests nested files with --recursive", () => {
    const out = path.join(dirIngestDir, "..", "dir-context-recursive.json");
    const result = run(["ingest", dirIngestDir, "--recursive", "-o", out, "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stderr);
    expect(report.directorySummary.processed).toBe(5);
  });
});

describe("ulcs ingest: validate", () => {
  it("the generated document round-trips through `ulcs validate`", () => {
    const out = path.join(dir, "roundtrip.json");
    run(["ingest", path.join(dir, "note.md"), "-o", out, "--quiet"]);
    const result = run(["validate", out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("valid");
  });
});
