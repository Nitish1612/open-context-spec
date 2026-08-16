import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIngestionPipeline,
  registerExtractor,
  unregisterExtractor,
  getExtractor,
  listExtractors,
  ingestUrl,
  ingestBuffer,
  ingestDirectory,
  NotFoundError,
  UsageError,
  SecurityRejectionError,
} from "../src/index.js";
import type { ContentExtractor } from "../src/index.js";
import { withTimeout as directWithTimeout } from "../src/security/limits.js";

describe("createIngestionPipeline", () => {
  it("seeds a private registry with built-in extractors by default", () => {
    const pipeline = createIngestionPipeline();
    expect(pipeline.registry.list().length).toBeGreaterThan(5);
  });

  it("can start with an empty registry when seedWithBuiltIns is false", () => {
    const pipeline = createIngestionPipeline(false);
    expect(pipeline.registry.list()).toHaveLength(0);
  });

  it("resolves and extracts through the pipeline's own registry", async () => {
    const pipeline = createIngestionPipeline();
    const input = await pipeline.resolve({ kind: "text", content: "hello", name: "a.txt" });
    const { document } = await pipeline.extract(input, {});
    expect(document.sections[0]?.content).toBe("hello");
  });
});

describe("default-registry convenience functions", () => {
  it("registers, retrieves, lists, and unregisters a custom extractor on the shared default registry", () => {
    const custom: ContentExtractor = {
      id: "sdk-test-custom",
      name: "SDK Test Custom",
      extensions: [".sdktest"],
      mediaTypes: ["application/x-sdk-test"],
      supports: () => true,
      extract: async () => {
        throw new Error("not implemented");
      },
    };
    registerExtractor(custom);
    expect(getExtractor("sdk-test-custom")).toBe(custom);
    expect(listExtractors().some((e) => e.id === "sdk-test-custom")).toBe(true);
    expect(unregisterExtractor("sdk-test-custom")).toBe(true);
    expect(getExtractor("sdk-test-custom")).toBeUndefined();
    expect(unregisterExtractor("sdk-test-custom")).toBe(false);
  });
});

describe("resolveLimits-backed timeout helper", () => {
  it("resolves normally when the wrapped function finishes before the timeout", async () => {
    await expect(directWithTimeout(async () => "done", 1000, "test op")).resolves.toBe("done");
  });

  it("rejects with SecurityRejectionError when the wrapped function exceeds the timeout", async () => {
    await expect(
      directWithTimeout(() => new Promise((resolve) => setTimeout(resolve, 200)), 20, "slow op"),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("ingestBuffer input validation", () => {
  it("rejects a buffer larger than maxInputBytes", async () => {
    const bytes = new Uint8Array(1000);
    await expect(
      ingestBuffer(bytes, {
        filename: "big.txt",
        mediaType: "text/plain",
        limits: { maxInputBytes: 10 },
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("ingestDirectory error paths", () => {
  it("throws NotFoundError for a missing directory", async () => {
    await expect(ingestDirectory("/definitely/does/not/exist/anywhere")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws UsageError when the path is a file, not a directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ulcs-usage-test-"));
    const file = join(dir, "a.txt");
    writeFileSync(file, "content");
    try {
      await expect(ingestDirectory(file)).rejects.toThrow(UsageError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Fetched via ingestUrl for a coverage test.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/page.txt`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ingestUrl", () => {
  it("ingests a URL end to end when private networks are explicitly allowed", async () => {
    const result = await ingestUrl(baseUrl, { allowPrivateNetworkUrls: true });
    expect(result.documents[0]?.sections[0]?.content).toContain("Fetched via ingestUrl");
    expect(result.envelope.resources?.[0]?.source?.sourceType).toBe("web-page");
  });
});
