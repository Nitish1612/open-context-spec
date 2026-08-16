import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchUrlSafely,
  resolveLimits,
  SecurityRejectionError,
  safeJoin,
  assertNoSymlinkEscape,
  SymlinkLoopGuard,
} from "../src/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello world");
      return;
    }
    if (url === "/redirect-once") {
      res.writeHead(302, { location: "/ok" });
      res.end();
      return;
    }
    if (url === "/redirect-loop") {
      res.writeHead(302, { location: "/redirect-loop" });
      res.end();
      return;
    }
    if (url === "/big-content-length") {
      res.writeHead(200, { "content-type": "text/plain", "content-length": "999999999" });
      res.end("small body");
      return;
    }
    if (url === "/no-location-redirect") {
      res.writeHead(302, {});
      res.end();
      return;
    }
    if (url === "/bad-encoding") {
      res.writeHead(200, { "content-encoding": "bogus-encoding" });
      res.end("x");
      return;
    }
    if (url === "/actually-big") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(2000));
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

describe("fetchUrlSafely against a local server (opt-in private-network allowance)", () => {
  it("fetches a simple 200 response when private networks are explicitly allowed", async () => {
    const result = await fetchUrlSafely(`${baseUrl}/ok`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(new TextDecoder().decode(result.data)).toBe("hello world");
    expect(result.status).toBe(200);
  });

  it("still rejects a local-server URL when private networks are NOT allowed (the default)", async () => {
    await expect(fetchUrlSafely(`${baseUrl}/ok`, { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("follows a redirect and re-validates the destination", async () => {
    const result = await fetchUrlSafely(`${baseUrl}/redirect-once`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(new TextDecoder().decode(result.data)).toBe("hello world");
  });

  it("rejects a redirect loop once the redirect cap is exceeded", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/redirect-loop`, {
        limits: resolveLimits({ maxRedirects: 3 }),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects a redirect response with no Location header", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/no-location-redirect`, {
        limits: resolveLimits(),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects a response whose declared Content-Length exceeds the limit", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/big-content-length`, {
        limits: resolveLimits({ maxUrlResponseBytes: 1000 }),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects an unsupported content-encoding", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/bad-encoding`, {
        limits: resolveLimits(),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("enforces the response-size cap while streaming a body without a Content-Length header", async () => {
    await expect(
      fetchUrlSafely(`${baseUrl}/actually-big`, {
        limits: resolveLimits({ maxUrlResponseBytes: 100 }),
        allowPrivateNetworkUrls: true,
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects a URL whose hostname fails to resolve", async () => {
    await expect(
      fetchUrlSafely("http://this-host-does-not-exist.invalid.example/", {
        limits: resolveLimits(),
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("symlink safety helpers", () => {
  it("safeJoin accepts a nested-but-contained relative path", () => {
    expect(safeJoin("/base/dir", "a/b/c.txt")).toContain("c.txt");
  });

  it("assertNoSymlinkEscape does not throw for a non-existent path", () => {
    expect(() => assertNoSymlinkEscape("/does/not/exist", "/base")).not.toThrow();
  });

  it("SymlinkLoopGuard does not throw for distinct, non-existent paths", () => {
    const guard = new SymlinkLoopGuard();
    expect(() => {
      guard.check("/does/not/exist/a");
      guard.check("/does/not/exist/b");
    }).not.toThrow();
  });
});
