import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SecurityRejectionError } from "../errors.js";
import type { ResourceLimits } from "../types.js";

const USER_AGENT = "ulcs-ingest/0.1 (+https://github.com/Nitish1612/open-context-spec)";

export interface FetchUrlOptions {
  limits: ResourceLimits;
  /** Host-application opt-in to allow private/loopback network targets. Off by default. */
  allowPrivateNetworkUrls?: boolean;
  signal?: AbortSignal;
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

/** IPv4/IPv6 range checks for loopback, private, link-local, multicast, and other reserved space. */
export function isDisallowedIp(address: string, family: number): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const first = parts[0] ?? 0;
    const second = parts[1] ?? 0;
    if (first === 127) return true; // loopback
    if (first === 10) return true; // private
    if (first === 172 && second >= 16 && second <= 31) return true; // private
    if (first === 192 && second === 168) return true; // private
    if (first === 169 && second === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (first === 0) return true; // "this network"
    if (first >= 224) return true; // multicast + reserved
    if (first === 100 && second >= 64 && second <= 127) return true; // carrier-grade NAT
    return false;
  }
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true;
  if (
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9")
  )
    return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (private)
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address — re-check the embedded IPv4.
    const v4 = normalized.slice("::ffff:".length);
    if (isIP(v4) === 4) return isDisallowedIp(v4, 4);
  }
  return false;
}

async function assertResolvesToPublicAddress(
  hostname: string,
  allowPrivate: boolean,
): Promise<void> {
  if (allowPrivate) return;
  const directFamily = isIP(hostname);
  if (directFamily) {
    if (isDisallowedIp(hostname, directFamily)) {
      throw new SecurityRejectionError(
        `URL host "${hostname}" resolves to a disallowed (private/loopback/reserved) IP address.`,
        { hostname },
      );
    }
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new SecurityRejectionError(`Failed to resolve DNS for host "${hostname}".`, {
      hostname,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (addresses.length === 0) {
    throw new SecurityRejectionError(`Host "${hostname}" did not resolve to any address.`, {
      hostname,
    });
  }
  for (const { address, family } of addresses) {
    if (isDisallowedIp(address, family)) {
      throw new SecurityRejectionError(
        `URL host "${hostname}" resolves to a disallowed (private/loopback/reserved) IP address (${address}).`,
        { hostname, address },
      );
    }
  }
}

const ALLOWED_CONTENT_ENCODINGS = new Set(["identity", "gzip", "br", "deflate", ""]);

/**
 * Fetches a URL with SSRF protections: protocol allowlist, credential
 * rejection, DNS resolution + address-range checks (re-validated on every
 * redirect hop), a bounded redirect count, request/response timeouts, a
 * response-size cap, and a conservative static user agent. No inbound
 * authentication headers are ever forwarded.
 */
export async function fetchUrlSafely(
  rawUrl: string,
  options: FetchUrlOptions,
): Promise<FetchUrlResult> {
  const { limits, allowPrivateNetworkUrls = false, signal } = options;

  let currentUrl = assertSafeUrlShape(rawUrl);
  let redirectCount = 0;

  for (;;) {
    await assertResolvesToPublicAddress(currentUrl.hostname, allowPrivateNetworkUrls);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    const timeout = setTimeout(() => controller.abort(), limits.extractionTimeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml,application/pdf,text/plain,*/*",
        },
      });
    } catch (error) {
      throw new SecurityRejectionError(
        `Failed to fetch "${currentUrl}": ${error instanceof Error ? error.message : String(error)}`,
        {
          url: currentUrl.toString(),
        },
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
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
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limits.maxUrlResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw new SecurityRejectionError(
            `Response from "${currentUrl}" exceeded the maximum allowed size (${limits.maxUrlResponseBytes} bytes).`,
            { url: currentUrl.toString(), max: limits.maxUrlResponseBytes },
          );
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return finalize(merged, currentUrl.toString(), response, limits);
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
      { max: limits.maxUrlResponseBytes },
    );
  }
  return {
    data,
    finalUrl,
    contentType: response.headers.get("content-type") ?? undefined,
    status: response.status,
  };
}
