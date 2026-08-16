import { describe, expect, it } from "vitest";
import {
  safeJoin,
  isDisallowedIp,
  fetchUrlSafely,
  assertSafeArchive,
  assertWithinByteLimit,
  assertWithinCharLimit,
  assertWithinCount,
  resolveLimits,
  SecurityRejectionError,
  DEFAULT_LIMITS,
} from "../src/index.js";
import { fakeZipBombEntries } from "./fixtures.js";

describe("path traversal protection", () => {
  it("allows a normal relative entry", () => {
    expect(() => safeJoin("/base", "sub/file.txt")).not.toThrow();
  });

  it("rejects a Zip-Slip-style entry escaping the base directory", () => {
    expect(() => safeJoin("/base", "../../etc/passwd")).toThrow(SecurityRejectionError);
  });

  it("rejects an absolute-path entry", () => {
    expect(() => safeJoin("/base", "/etc/passwd")).toThrow(SecurityRejectionError);
  });

  it("rejects an entry with an embedded NUL byte", () => {
    expect(() => safeJoin("/base", "file\0.txt")).toThrow(SecurityRejectionError);
  });
});

describe("archive safety (zip-bomb / decompression-bomb guard)", () => {
  it("rejects an entry with a suspiciously high compression ratio", async () => {
    const entries = await fakeZipBombEntries();
    expect(() => assertSafeArchive(entries, resolveLimits())).toThrow(SecurityRejectionError);
  });

  it("accepts a normal, modestly-compressed archive", () => {
    const entries = [{ name: "a.xml", compressedSize: 1000, uncompressedSize: 4000 }];
    expect(() => assertSafeArchive(entries, resolveLimits())).not.toThrow();
  });

  it("rejects an archive with too many entries", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      name: `f${i}`,
      compressedSize: 10,
      uncompressedSize: 10,
    }));
    expect(() => assertSafeArchive(entries, resolveLimits({ maxArchiveEntries: 5 }))).toThrow(
      SecurityRejectionError,
    );
  });
});

describe("resource limits", () => {
  it("rejects oversized input", () => {
    expect(() => assertWithinByteLimit(1000, 500, "Input")).toThrow(SecurityRejectionError);
  });
  it("rejects over-length extracted text", () => {
    expect(() => assertWithinCharLimit(1000, 500, "Text")).toThrow(SecurityRejectionError);
  });
  it("rejects over-count collections", () => {
    expect(() => assertWithinCount(10, 5, "Sections")).toThrow(SecurityRejectionError);
  });
  it("merges partial overrides over the defaults without losing unspecified fields", () => {
    const limits = resolveLimits({ maxPages: 10 });
    expect(limits.maxPages).toBe(10);
    expect(limits.maxRows).toBe(DEFAULT_LIMITS.maxRows);
  });
  it("falls back to the default for an explicit undefined override field", () => {
    const limits = resolveLimits({ maxPages: undefined, maxRows: 7 });
    expect(limits.maxPages).toBe(DEFAULT_LIMITS.maxPages);
    expect(limits.maxRows).toBe(7);
  });
});

describe("SSRF protection: IP range checks", () => {
  it("flags IPv4 loopback, private, and link-local ranges as disallowed", () => {
    expect(isDisallowedIp("127.0.0.1", 4)).toBe(true);
    expect(isDisallowedIp("10.0.0.5", 4)).toBe(true);
    expect(isDisallowedIp("172.16.0.1", 4)).toBe(true);
    expect(isDisallowedIp("192.168.1.1", 4)).toBe(true);
    expect(isDisallowedIp("169.254.169.254", 4)).toBe(true); // cloud metadata endpoint
  });

  it("allows ordinary public IPv4 addresses", () => {
    expect(isDisallowedIp("8.8.8.8", 4)).toBe(false);
    expect(isDisallowedIp("93.184.216.34", 4)).toBe(false);
  });

  it("flags IPv6 loopback and unique-local ranges as disallowed", () => {
    expect(isDisallowedIp("::1", 6)).toBe(true);
    expect(isDisallowedIp("fd00::1", 6)).toBe(true);
    expect(isDisallowedIp("fe80::1", 6)).toBe(true);
  });
});

describe("SSRF protection: fetchUrlSafely", () => {
  it("rejects a non-http(s) protocol", async () => {
    await expect(fetchUrlSafely("file:///etc/passwd", { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects a URL with embedded credentials", async () => {
    await expect(
      fetchUrlSafely("http://user:pass@example.com/", { limits: resolveLimits() }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects a direct loopback IP target", async () => {
    await expect(fetchUrlSafely("http://127.0.0.1/", { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects a direct private-network IP target", async () => {
    await expect(
      fetchUrlSafely("http://192.168.1.1/", { limits: resolveLimits() }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects localhost by hostname", async () => {
    await expect(fetchUrlSafely("http://localhost/", { limits: resolveLimits() })).rejects.toThrow(
      SecurityRejectionError,
    );
  });
});
