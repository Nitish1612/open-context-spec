import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ingestFile,
  ingestDirectory,
  ingestText,
  SecurityRejectionError,
  NotFoundError,
} from "../src/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ulcs-ingest-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ingestText", () => {
  it("produces a validated envelope end to end", async () => {
    const result = await ingestText("Hello world, this is some inline text content for the test.", {
      name: "inline.txt",
    });
    expect(result.envelope["@type"]).toBe("ContextEnvelope");
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.report.warnings).toEqual([]);
  });
});

describe("ingestFile", () => {
  it("reads a file from disk and reports the detected extractor", async () => {
    const file = join(dir, "note.md");
    writeFileSync(file, "# Title\n\nBody text long enough to form a chunk in this scenario.");
    const result = await ingestFile(file);
    expect(result.report.extractorId).toBe("markdown");
    expect(result.documents[0]?.filename).toBe("note.md");
  });

  it("throws NotFoundError for a missing file", async () => {
    await expect(ingestFile(join(dir, "missing.txt"))).rejects.toThrow(NotFoundError);
  });
});

describe("ingestDirectory", () => {
  it("processes every supported file deterministically and summarizes results", async () => {
    writeFileSync(
      join(dir, "a.txt"),
      "Alpha content long enough to survive minimum chunk size checks.",
    );
    writeFileSync(
      join(dir, "b.md"),
      "# Beta\n\nBeta content long enough to survive minimum chunk size checks.",
    );
    const result = await ingestDirectory(dir);
    expect(result.report.directorySummary?.processed).toBe(2);
    expect(result.report.directorySummary?.failed).toBe(0);
  });

  it("ignores hidden files and common generated directories by default", async () => {
    writeFileSync(join(dir, ".hidden.txt"), "should be ignored");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "pkg.txt"), "should be ignored too");
    writeFileSync(
      join(dir, "visible.txt"),
      "Visible content long enough to survive minimum chunk size checks.",
    );
    const result = await ingestDirectory(dir);
    expect(result.report.directorySummary?.processed).toBe(1);
    expect(result.documents[0]?.filename).toBe("visible.txt");
  });

  it("Defect 10: reports hidden files and ignored directories as skipped, not silently dropped", async () => {
    writeFileSync(join(dir, ".hidden.txt"), "should be ignored");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "pkg.txt"), "should be ignored too");
    writeFileSync(
      join(dir, "visible.txt"),
      "Visible content long enough to survive minimum chunk size checks.",
    );
    const result = await ingestDirectory(dir);
    const summary = result.report.directorySummary!;
    // node_modules itself is reported as one skipped entry (the directory),
    // not enumerated file-by-file — its contents are never even statted.
    expect(summary.skipped).toBe(2);
    const skippedFiles = summary.files.filter((f) => f.status === "skipped");
    expect(skippedFiles.map((f) => f.path).sort()).toEqual([".hidden.txt", "node_modules"]);
    for (const f of skippedFiles) {
      expect(f.reason).toBeTruthy();
    }
    // Total accounted-for entries (processed + skipped) must cover
    // everything that was actually present at the top level.
    expect(summary.processed + summary.skipped).toBe(3);
  });

  it("does not recurse into subdirectories unless --recursive is set", async () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(
      join(dir, "sub", "nested.txt"),
      "Nested content that would only be found when recursive.",
    );
    writeFileSync(
      join(dir, "top.txt"),
      "Top-level content long enough to survive minimum chunk size checks.",
    );
    const shallow = await ingestDirectory(dir);
    expect(shallow.report.directorySummary?.processed).toBe(1);

    const deep = await ingestDirectory(dir, { recursive: true });
    expect(deep.report.directorySummary?.processed).toBe(2);
  });

  it("Defect 10: reports a non-recursed subdirectory as skipped with an explanatory reason", async () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "nested.txt"), "Nested content, only found when recursive.");
    writeFileSync(
      join(dir, "top.txt"),
      "Top-level content long enough to survive minimum chunk size checks.",
    );
    const result = await ingestDirectory(dir);
    const summary = result.report.directorySummary!;
    expect(summary.skipped).toBe(1);
    const subEntry = summary.files.find((f) => f.path === "sub");
    expect(subEntry?.status).toBe("skipped");
    expect(subEntry?.reason).toMatch(/recursive/i);
  });

  it("respects include/exclude glob patterns", async () => {
    writeFileSync(
      join(dir, "keep.txt"),
      "Keep this content long enough to survive minimum chunk size checks.",
    );
    writeFileSync(
      join(dir, "skip.txt"),
      "Skip this content long enough to survive minimum chunk size checks.",
    );
    const result = await ingestDirectory(dir, { exclude: ["skip.txt"] });
    expect(result.documents.map((d) => d.filename)).toEqual(["keep.txt"]);
  });

  it("Defect 10: reports an excluded file as skipped, and a not-included file as skipped", async () => {
    writeFileSync(
      join(dir, "keep.txt"),
      "Keep this content long enough to survive minimum chunk size checks.",
    );
    writeFileSync(
      join(dir, "skip.txt"),
      "Skip this content long enough to survive minimum chunk size checks.",
    );
    const excluded = await ingestDirectory(dir, { exclude: ["skip.txt"] });
    const excludedEntry = excluded.report.directorySummary?.files.find(
      (f) => f.path === "skip.txt",
    );
    expect(excludedEntry?.status).toBe("skipped");
    expect(excludedEntry?.reason).toBeTruthy();

    const included = await ingestDirectory(dir, { include: ["keep.txt"] });
    const notIncludedEntry = included.report.directorySummary?.files.find(
      (f) => f.path === "skip.txt",
    );
    expect(notIncludedEntry?.status).toBe("skipped");
    expect(notIncludedEntry?.reason).toBeTruthy();
  });

  it("continues past a single failing file by default and records it as failed", async () => {
    writeFileSync(
      join(dir, "good.txt"),
      "Good content long enough to survive minimum chunk size checks.",
    );
    writeFileSync(join(dir, "bad.unsupportedext12345"), "unsupported format content");
    const result = await ingestDirectory(dir);
    expect(result.report.directorySummary?.processed).toBe(1);
    expect(result.report.directorySummary?.failed).toBe(1);
  });

  it("stops immediately on the first failure when onError is 'stop'", async () => {
    writeFileSync(join(dir, "bad.unsupportedext12345"), "unsupported format content");
    writeFileSync(
      join(dir, "good.txt"),
      "Good content long enough to survive minimum chunk size checks.",
    );
    await expect(ingestDirectory(dir, { onError: "stop" })).rejects.toThrow();
  });

  it("preserves separate provenance (sourceUri) per source document", async () => {
    writeFileSync(
      join(dir, "a.txt"),
      "Alpha content long enough to survive minimum chunk size checks.",
    );
    writeFileSync(
      join(dir, "b.txt"),
      "Beta content long enough to survive minimum chunk size checks yes.",
    );
    const result = await ingestDirectory(dir);
    const uris = result.resources.map((r) => r.source?.sourceUri);
    expect(new Set(uris).size).toBe(2);
  });

  it("enforces the directory file-count limit", async () => {
    for (let i = 0; i < 5; i++)
      writeFileSync(join(dir, `f${i}.txt`), `content ${i} long enough to matter here.`);
    await expect(ingestDirectory(dir, { limits: { maxDirectoryFileCount: 2 } })).rejects.toThrow(
      SecurityRejectionError,
    );
  });
});

const canSymlink = (() => {
  try {
    const testDir = mkdtempSync(join(tmpdir(), "ulcs-symlink-check-"));
    const target = join(testDir, "target.txt");
    writeFileSync(target, "x");
    symlinkSync(target, join(testDir, "link.txt"));
    rmSync(testDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!canSymlink)("ingestDirectory symlink handling", () => {
  it("does not follow symlinks by default", async () => {
    writeFileSync(
      join(dir, "real.txt"),
      "Real content long enough to survive minimum chunk size checks yes.",
    );
    symlinkSync(join(dir, "real.txt"), join(dir, "link.txt"));
    const result = await ingestDirectory(dir);
    // Only the real file is processed — the symlink is skipped, not followed.
    expect(result.report.directorySummary?.processed).toBe(1);
    expect(result.documents[0]?.filename).toBe("real.txt");
  });

  it("Defect 10: reports the symlink itself as a skipped entry with a symlink reason", async () => {
    writeFileSync(
      join(dir, "real.txt"),
      "Real content long enough to survive minimum chunk size checks yes.",
    );
    symlinkSync(join(dir, "real.txt"), join(dir, "link.txt"));
    const result = await ingestDirectory(dir);
    const summary = result.report.directorySummary!;
    expect(summary.skipped).toBe(1);
    const linkEntry = summary.files.find((f) => f.path === "link.txt");
    expect(linkEntry?.status).toBe("skipped");
    expect(linkEntry?.reason).toMatch(/symlink/i);
  });
});
