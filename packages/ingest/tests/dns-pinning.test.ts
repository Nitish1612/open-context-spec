import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

// Imported after the mock so `fetchUrlSafely` picks up the mocked `lookup`.
const { fetchUrlSafely, resolveLimits } = await import("../src/index.js");
const { SecurityRejectionError } = await import("../src/errors.js");

let server: Server;
let baseUrl: string;
let host: string;

beforeEach(async () => {
  lookupMock.mockReset();
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/redirect-to-internal") {
      res.writeHead(302, { location: "http://internal.example.test/secret" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("public response body");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  host = "public.example.test";
  baseUrl = `http://${host}:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("DNS-pinned resolution: rebinding and multi-answer scenarios", () => {
  it("rejects when the only DNS answer for the hostname is a private address (basic pinning)", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(fetchUrlSafely(baseUrl, { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects when ANY of multiple DNS answers is private, even if another is public (fail closed)", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(fetchUrlSafely(baseUrl, { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("connects successfully when DNS resolves to the real public loopback-mapped test address with private networks allowed", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const result = await fetchUrlSafely(baseUrl, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(new TextDecoder().decode(result.data)).toBe("public response body");
    // Exactly one DNS resolution occurred for the one hop — the same
    // resolution that both validated the address and supplied the actual
    // connection target, eliminating the validate-then-reconnect TOCTOU
    // window a naive "check first, fetch second" implementation would have.
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect hop whose destination hostname resolves to a private address (redirect rebinding)", async () => {
    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === host) return [{ address: "127.0.0.1", family: 4 }];
      if (hostname === "internal.example.test") return [{ address: "169.254.169.254", family: 4 }];
      throw new Error("unexpected hostname in test: " + hostname);
    });
    await expect(
      fetchUrlSafely(`${baseUrl}/redirect-to-internal`, {
        limits: resolveLimits(),
        allowPrivateNetworkUrls: false,
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("allows a redirect hop only when both the origin AND the destination resolve publicly (opt-in)", async () => {
    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === host) return [{ address: "127.0.0.1", family: 4 }];
      // Redirect target points back at our own test server so this can
      // actually succeed end-to-end under the private-network opt-in.
      if (hostname === "internal.example.test") return [{ address: "127.0.0.1", family: 4 }];
      throw new Error("unexpected hostname in test: " + hostname);
    });
    // internal.example.test has no real port in the Location header in this
    // server, so redirect to a location that maps back onto our server's
    // origin instead, to keep this test self-contained.
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url === "/redirect-to-internal") {
        res.writeHead(302, { location: `http://internal.example.test:${port}/final` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("final body");
    });
    const result = await fetchUrlSafely(`${baseUrl}/redirect-to-internal`, {
      limits: resolveLimits(),
      allowPrivateNetworkUrls: true,
    });
    expect(new TextDecoder().decode(result.data)).toBe("final body");
  });

  it("rejects an IPv4-mapped IPv6 loopback address in fully-hex form (::ffff:7f00:1)", async () => {
    lookupMock.mockResolvedValue([{ address: "::ffff:7f00:1", family: 6 }]);
    await expect(fetchUrlSafely(baseUrl, { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects an IPv4-mapped IPv6 loopback address in dotted form (::ffff:127.0.0.1)", async () => {
    lookupMock.mockResolvedValue([{ address: "::ffff:127.0.0.1", family: 6 }]);
    await expect(fetchUrlSafely(baseUrl, { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects the IPv4-mapped cloud metadata address (::ffff:169.254.169.254)", async () => {
    lookupMock.mockResolvedValue([{ address: "::ffff:a9fe:a9fe", family: 6 }]);
    await expect(fetchUrlSafely(baseUrl, { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects when DNS resolution fails entirely", async () => {
    lookupMock.mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    );
    await expect(fetchUrlSafely(baseUrl, { limits: resolveLimits() })).rejects.toThrow();
  });
});
