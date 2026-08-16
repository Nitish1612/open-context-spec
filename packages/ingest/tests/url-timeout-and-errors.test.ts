import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchUrlSafely,
  resolveLimits,
  SecurityRejectionError,
  ExtractionError,
} from "../src/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/slow-body") {
      // Send headers immediately, then stall the body indefinitely.
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial-");
      // Never call res.end() within the test's timeout window.
      return;
    }
    if (url === "/status/200") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (url === "/status/204") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url === "/status/301") {
      res.writeHead(301, { location: "/status/200" });
      res.end();
      return;
    }
    if (url === "/status/404") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (url === "/status/429") {
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("rate limited");
      return;
    }
    if (url === "/status/500") {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("server error");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Defect 2: full-deadline timeout covers body streaming, not just headers", () => {
  it("aborts and rejects promptly when the body stalls beyond the deadline, even though headers arrived immediately", async () => {
    const start = Date.now();
    await expect(
      fetchUrlSafely(`${baseUrl}/slow-body`, {
        limits: resolveLimits({ extractionTimeoutMs: 300 }),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(SecurityRejectionError);
    const elapsed = Date.now() - start;
    // Generous upper bound: the deadline is 300ms, so anything well under a
    // few seconds proves the body-read loop was actually aborted rather
    // than hanging until some unrelated outer timeout.
    expect(elapsed).toBeLessThan(5000);
  }, 10000);

  it("honors an externally-supplied AbortSignal distinct from the internal timeout", async () => {
    const controller = new AbortController();
    const promise = fetchUrlSafely(`${baseUrl}/slow-body`, {
      limits: resolveLimits({ extractionTimeoutMs: 60_000 }),
      allowPrivateNetworkUrls: true,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("caller cancelled")), 100);
    await expect(promise).rejects.toThrow();
  }, 10000);
});

describe("Defect 11: HTTP error responses", () => {
  it("accepts a 200 response", async () => {
    const result = await fetchUrlSafely(`${baseUrl}/status/200`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(new TextDecoder().decode(result.data)).toBe("ok");
    expect(result.status).toBe(200);
  });

  it("accepts a 204 with empty content", async () => {
    const result = await fetchUrlSafely(`${baseUrl}/status/204`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(result.data.byteLength).toBe(0);
    expect(result.status).toBe(204);
  });

  it("follows a 301 redirect to a successful response", async () => {
    const result = await fetchUrlSafely(`${baseUrl}/status/301`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(new TextDecoder().decode(result.data)).toBe("ok");
  });

  it("rejects a 404 by default with a typed ExtractionError", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/status/404`, {
        limits: resolveLimits(),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(ExtractionError);
  });

  it("rejects a 429 by default", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/status/429`, {
        limits: resolveLimits(),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(ExtractionError);
  });

  it("rejects a 500 by default", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/status/500`, {
        limits: resolveLimits(),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(ExtractionError);
  });

  it("accepts an error response when acceptErrorResponses is explicitly set", async () => {
    const result = await fetchUrlSafely(`${baseUrl}/status/404`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
      acceptErrorResponses: true,
    });
    expect(result.status).toBe(404);
    expect(new TextDecoder().decode(result.data)).toBe("not found");
  });
});
