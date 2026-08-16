import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import { ExtractionError, SecurityRejectionError } from "../errors.js";
import { combineSignals } from "./limits.js";
import type { ResourceLimits } from "../types.js";

const USER_AGENT = "ulcs-ingest/0.1 (+https://github.com/Nitish1612/open-context-spec)";

export interface FetchUrlOptions {
  limits: ResourceLimits;
  /** Host-application opt-in to allow private/loopback network targets. Off by default. */
  allowPrivateNetworkUrls?: boolean;
  signal?: AbortSignal;
  /** When true, accept a non-2xx response instead of rejecting it (see `acceptErrorResponses`). Off by default. */
  acceptErrorResponses?: boolean;
}

export interface FetchUrlResult {
  data: Uint8Array;
  finalUrl: string;
  contentType?: string;
  status: number;
}

/** Rejects anything but http:/https:, and rejects embedded userinfo (`user:pass@host`). */
function assertSafeUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SecurityRejectionError(`"${raw}" is not a valid URL.`, { url: raw });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SecurityRejectionError(
      `URL protocol "${url.protocol}" is not allowed; only http: and https: are supported.`,
      { url: raw, protocol: url.protocol },
    );
  }
  if (url.username || url.password) {
    throw new SecurityRejectionError(`URL must not contain embedded credentials.`, { url: raw });
  }
  return url;
}

/**
 * Expands a (possibly compressed, `::`-containing) IPv6 address into 8
 * hex groups, resolving an embedded IPv4 dotted-quad tail (e.g.
 * `::ffff:127.0.0.1`) into two hex groups first so both the dotted and the
 * fully-hex (`::ffff:7f00:1`) spellings of an IPv4-mapped address expand
 * identically.
 */
function expandIPv6Groups(address: string): string[] | undefined {
  let addr = address.split("%")[0] ?? address; // strip zone id
  const dotMatch = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (dotMatch?.[1]) {
    const octets = dotMatch[1].split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return undefined;
    const hi = ((octets[0] as number) << 8) | (octets[1] as number);
    const lo = ((octets[2] as number) << 8) | (octets[3] as number);
    addr =
      addr.slice(0, addr.length - dotMatch[1].length) + hi.toString(16) + ":" + lo.toString(16);
  }

  const parts = addr.split("::");
  if (parts.length > 2) return undefined;
  const head = parts[0] ? parts[0].split(":").filter((s) => s.length > 0) : [];
  const tail =
    parts.length === 2 && parts[1] ? parts[1].split(":").filter((s) => s.length > 0) : [];

  if (parts.length === 1) {
    const groups = addr.split(":");
    if (groups.length !== 8 || groups.some((g) => g.length === 0)) return undefined;
    return groups;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 0) return undefined;
  return [...head, ...Array(missing).fill("0"), ...tail];
}

/** Extracts the embedded IPv4 address from an IPv4-mapped (`::ffff:a.b.c.d` / `::ffff:7f00:1`) or IPv4-compatible (`::a.b.c.d`) IPv6 address, in either dotted or fully-hex form. */
function extractEmbeddedIPv4(address: string): string | undefined {
  const groups = expandIPv6Groups(address);
  if (!groups || groups.length !== 8) return undefined;
  const nums = groups.map((g) => parseInt(g, 16));
  if (nums.some((n) => Number.isNaN(n))) return undefined;

  const isMapped =
    nums[0] === 0 &&
    nums[1] === 0 &&
    nums[2] === 0 &&
    nums[3] === 0 &&
    nums[4] === 0 &&
    nums[5] === 0xffff;
  const isCompatible =
    nums[0] === 0 &&
    nums[1] === 0 &&
    nums[2] === 0 &&
    nums[3] === 0 &&
    nums[4] === 0 &&
    nums[5] === 0;
  if (!isMapped && !isCompatible) return undefined;

  const hi = nums[6] as number;
  const lo = nums[7] as number;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isDisallowedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return true; // malformed — fail closed
  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  if (first === 127) return true; // loopback
  if (first === 10) return true; // private
  if (first === 172 && second >= 16 && second <= 31) return true; // private
  if (first === 192 && second === 168) return true; // private
  if (first === 169 && second === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (first === 0) return true; // "this network" / unspecified
  if (first >= 224) return true; // multicast + reserved (224-255, incl. 255.255.255.255 broadcast)
  if (first === 100 && second >= 64 && second <= 127) return true; // carrier-grade NAT (100.64.0.0/10)
  if (first === 192 && second === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // IETF protocol assignments / documentation (TEST-NET-1 192.0.2.0/24 covered below too)
  if (first === 198 && (second === 18 || second === 19)) return true; // benchmarking (198.18.0.0/15)
  if (first === 198 && second === 51 && parts[2] === 100) return true; // documentation (TEST-NET-2)
  if (first === 203 && second === 0 && parts[2] === 113) return true; // documentation (TEST-NET-3)
  if (first === 255 && second === 255 && parts[2] === 255 && parts[3] === 255) return true; // limited broadcast
  return false;
}

/** IPv4/IPv6 range checks for loopback, private, link-local, multicast, and other reserved space. */
export function isDisallowedIp(address: string, family: number): boolean {
  if (family === 4) return isDisallowedIPv4(address);

  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true; // link-local fe80::/10
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local fc00::/7
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("2001:db8:")) return true; // documentation (2001:db8::/32)

  const embeddedV4 = extractEmbeddedIPv4(normalized);
  if (embeddedV4) return isDisallowedIPv4(embeddedV4);
  return false;
}

/** Validates a literal IP address string (used for direct-IP URLs, where no DNS lookup occurs at all). */
function assertLiteralIpAllowed(hostname: string, allowPrivate: boolean): void {
  if (allowPrivate) return;
  const family = isIP(hostname);
  if (!family) return; // not a literal IP — validated via the pinned DNS lookup instead
  if (isDisallowedIp(hostname, family)) {
    throw new SecurityRejectionError(
      `URL host "${hostname}" is a disallowed (private/loopback/reserved) IP address.`,
      { hostname },
    );
  }
}

/**
 * Builds a Node-`lookup`-compatible resolver that performs the *only* DNS
 * resolution the connection will ever see, validates every candidate
 * address, and hands back a single validated address — closing the
 * TOCTOU/DNS-rebinding window between "we checked the hostname" and "the
 * HTTP client re-resolved it and connected to something else". The
 * hostname itself is untouched, so the `Host` header, TLS SNI, and
 * certificate verification still target the original name.
 */
type LookupCallback = (err: NodeJS.ErrnoException | null, ...args: unknown[]) => void;

function createPinnedLookup(allowPrivate: boolean) {
  return function pinnedLookup(
    hostname: string,
    options: { all?: boolean } | LookupCallback,
    callback?: LookupCallback,
  ): void {
    const cb = typeof options === "function" ? options : callback!;
    const wantAll = typeof options === "function" ? false : Boolean(options?.all);

    dnsLookup(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        if (addresses.length === 0) {
          cb(Object.assign(new Error(`No DNS records for "${hostname}".`), { code: "ENOTFOUND" }));
          return;
        }
        if (!allowPrivate) {
          const disallowed = addresses.find((a) => isDisallowedIp(a.address, a.family));
          if (disallowed) {
            cb(
              Object.assign(
                new Error(
                  `Host "${hostname}" resolves to a disallowed (private/loopback/reserved) IP address (${disallowed.address}).`,
                ),
                { code: "EACCES" },
              ),
            );
            return;
          }
        }
        // Pin to exactly one validated address — the same address the
        // caller's own pre-flight validation already approved, so what we
        // actually connect to can never differ from what we checked.
        const pinned = addresses[0] as { address: string; family: number };
        if (wantAll) {
          cb(null, [{ address: pinned.address, family: pinned.family }]);
        } else {
          cb(null, pinned.address, pinned.family);
        }
      })
      .catch((error: unknown) => {
        cb(
          Object.assign(
            new Error(
              `DNS resolution failed for "${hostname}": ${error instanceof Error ? error.message : String(error)}`,
            ),
            {
              code: "ENOTFOUND",
            },
          ),
        );
      });
  };
}

const ALLOWED_CONTENT_ENCODINGS = new Set(["identity", "gzip", "br", "deflate", ""]);

/**
 * Fetches a URL with SSRF protections: protocol allowlist, credential
 * rejection, DNS-pinned resolution (every hostname lookup is validated and
 * the underlying HTTP transport is forced to connect to exactly the
 * validated address — see `createPinnedLookup`), a bounded redirect count
 * with re-validation on every hop, a single deadline covering DNS
 * resolution through the end of body streaming, a response-size cap, HTTP
 * error-status rejection by default, and a conservative static user agent.
 * No inbound authentication headers are ever forwarded.
 *
 * Residual limitation: TLS certificate verification and SNI still target
 * the original hostname (by design — the pinned address only changes which
 * IP the TCP socket connects to), so this does not protect against a
 * compromised-but-still-DNS-authoritative host presenting a *valid*
 * certificate for a private-network address; it protects against the
 * HTTP client being tricked into connecting to a different, unvalidated
 * address than the one that was checked.
 */
export async function fetchUrlSafely(
  rawUrl: string,
  options: FetchUrlOptions,
): Promise<FetchUrlResult> {
  const {
    limits,
    allowPrivateNetworkUrls = false,
    signal: callerSignal,
    acceptErrorResponses = false,
  } = options;

  let currentUrl = assertSafeUrlShape(rawUrl);
  let redirectCount = 0;

  const deadline = Date.now() + limits.extractionTimeoutMs;
  const timeoutController = new AbortController();
  const remaining = () => Math.max(0, deadline - Date.now());
  const timer = setTimeout(
    () =>
      timeoutController.abort(
        new SecurityRejectionError(
          `URL fetch exceeded the overall deadline of ${limits.extractionTimeoutMs}ms.`,
          { timeoutMs: limits.extractionTimeoutMs },
        ),
      ),
    remaining(),
  );

  const { signal: combined, dispose } = combineSignals([timeoutController.signal, callerSignal]);
  const dispatcher = new Agent({
    // Two copies of undici's ambient types are reachable in this workspace
    // (the direct `undici` dependency vs. @types/node's bundled
    // `undici-types`), which makes their structurally-identical `connect`
    // option shapes nominally incompatible in TS despite being the same
    // shape at runtime; `unknown` sidesteps that without weakening the
    // actual lookup function's behavior.
    connect: {
      lookup: createPinnedLookup(allowPrivateNetworkUrls) as unknown,
    } as Agent.Options["connect"],
  });

  try {
    for (;;) {
      if (combined.aborted) {
        throw combined.reason instanceof Error
          ? combined.reason
          : new SecurityRejectionError("URL fetch was aborted.", {});
      }
      assertLiteralIpAllowed(currentUrl.hostname, allowPrivateNetworkUrls);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: combined,
          // `dispatcher` is a Node/undici-specific fetch extension not in
          // the standard RequestInit type; see the Agent construction
          // comment above for why the cast is `unknown`-mediated.
          dispatcher: dispatcher as unknown,
          headers: {
            "user-agent": USER_AGENT,
            accept:
              "text/html,application/xhtml+xml,application/xml,application/pdf,text/plain,*/*",
          },
        } as unknown as RequestInit);
      } catch (error) {
        if (combined.aborted) {
          throw combined.reason instanceof Error
            ? combined.reason
            : new SecurityRejectionError(
                `URL fetch was aborted while requesting "${currentUrl}".`,
                { url: currentUrl.toString() },
              );
        }
        const message = error instanceof Error ? error.message : String(error);
        // A pinned-lookup validation failure surfaces here as a generic
        // fetch failure; re-wrap it as the typed security error our
        // pre-flight check would have produced, rather than leaking a raw
        // "fetch failed" / DNS errno message.
        throw new SecurityRejectionError(`Failed to fetch "${currentUrl}": ${message}`, {
          url: currentUrl.toString(),
        });
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          throw new SecurityRejectionError(
            `Redirect response from "${currentUrl}" had no Location header.`,
            {
              url: currentUrl.toString(),
              status: response.status,
            },
          );
        }
        redirectCount++;
        if (redirectCount > limits.maxRedirects) {
          throw new SecurityRejectionError(
            `Exceeded the maximum allowed redirects (${limits.maxRedirects}) while fetching "${rawUrl}".`,
            { url: rawUrl, maxRedirects: limits.maxRedirects },
          );
        }
        currentUrl = assertSafeUrlShape(new URL(location, currentUrl).toString());
        continue;
      }

      if (!acceptErrorResponses && (response.status < 200 || response.status >= 300)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ExtractionError(
          `URL "${currentUrl}" returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}; only 2xx responses are ingested by default.`,
          undefined,
          { url: currentUrl.toString(), status: response.status },
        );
      }

      if (response.status === 204) {
        return finalize(new Uint8Array(0), currentUrl.toString(), response, limits);
      }

      const contentEncoding = (response.headers.get("content-encoding") ?? "").toLowerCase();
      if (contentEncoding && !ALLOWED_CONTENT_ENCODINGS.has(contentEncoding)) {
        throw new SecurityRejectionError(`Unsupported content-encoding "${contentEncoding}".`, {
          contentEncoding,
        });
      }

      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const declared = Number(contentLengthHeader);
        if (Number.isFinite(declared) && declared > limits.maxUrlResponseBytes) {
          await response.body?.cancel().catch(() => undefined);
          throw new SecurityRejectionError(
            `Response from "${currentUrl}" declares ${declared} bytes, exceeding the maximum allowed (${limits.maxUrlResponseBytes}).`,
            { url: currentUrl.toString(), declared, max: limits.maxUrlResponseBytes },
          );
        }
      }

      if (!response.body) {
        const buf = new Uint8Array(await response.arrayBuffer());
        return finalize(buf, currentUrl.toString(), response, limits);
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          if (combined.aborted) {
            throw combined.reason instanceof Error
              ? combined.reason
              : new SecurityRejectionError(
                  "URL fetch was aborted while reading the response body.",
                  {},
                );
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > limits.maxUrlResponseBytes) {
              throw new SecurityRejectionError(
                `Response from "${currentUrl}" exceeded the maximum allowed size (${limits.maxUrlResponseBytes} bytes).`,
                { url: currentUrl.toString(), max: limits.maxUrlResponseBytes },
              );
            }
            chunks.push(value);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return finalize(merged, currentUrl.toString(), response, limits);
    }
  } finally {
    clearTimeout(timer);
    dispose();
    await dispatcher.close().catch(() => undefined);
  }
}

function finalize(
  data: Uint8Array,
  finalUrl: string,
  response: Response,
  limits: ResourceLimits,
): FetchUrlResult {
  if (data.byteLength > limits.maxUrlResponseBytes) {
    throw new SecurityRejectionError(
      `Response body exceeded the maximum allowed size (${limits.maxUrlResponseBytes} bytes).`,
      {
        max: limits.maxUrlResponseBytes,
      },
    );
  }
  return {
    data,
    finalUrl,
    contentType: response.headers.get("content-type") ?? undefined,
    status: response.status,
  };
}
