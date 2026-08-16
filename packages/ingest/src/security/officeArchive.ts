import JSZip from "jszip";
import { ExtractionError, SecurityRejectionError } from "../errors.js";
import { assertSafeArchive } from "./limits.js";
import type { ResourceLimits } from "../types.js";

export interface OfficeArchiveEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  dir: boolean;
}

export interface OfficeArchiveInspection {
  zip: JSZip;
  entries: OfficeArchiveEntry[];
}

/**
 * Rejects archive entry names that look like a path-traversal or
 * absolute-path attempt. Current extractors never write archive entries to
 * disk (everything is decompressed to an in-memory string/buffer via
 * `JSZip#async()`), so "Zip Slip" — overwriting an attacker-chosen
 * filesystem path — cannot occur through this code path today. This check
 * exists anyway, as defense in depth and because a custom extractor (the
 * documented extension point) might legitimately materialize an entry to
 * disk and would want the same guarantee; see `safeJoin` in `paths.ts` for
 * the join-time half of that guarantee.
 */
function assertSafeEntryName(name: string): void {
  if (name.includes("\0")) {
    throw new SecurityRejectionError(
      `Rejected archive entry with an embedded NUL byte: "${name}".`,
      { name },
    );
  }
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    throw new SecurityRejectionError(`Rejected archive entry with an absolute path: "${name}".`, {
      name,
    });
  }
  if (/^[a-zA-Z]:/.test(name)) {
    throw new SecurityRejectionError(
      `Rejected archive entry with a Windows drive-letter path: "${name}".`,
      { name },
    );
  }
  if (name.startsWith("\\\\") || name.startsWith("//")) {
    throw new SecurityRejectionError(`Rejected archive entry with a UNC-style path: "${name}".`, {
      name,
    });
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new SecurityRejectionError(
      `Rejected archive entry with a path-traversal segment: "${name}".`,
      { name },
    );
  }
}

/**
 * Parses an OOXML (docx/pptx/xlsx) zip container's central directory and
 * validates it — entry count, total uncompressed size, per-entry
 * compression ratio, and entry-name safety — **before** any entry's
 * content is actually decompressed. `JSZip.loadAsync` itself only reads
 * zip structure (local file headers / central directory), not entry
 * content, so this inspection is cheap even for a maliciously large
 * archive; the expensive part (`entry.async(...)`, or handing the buffer
 * to a library like ExcelJS that decompresses eagerly) only happens after
 * this passes.
 */
export async function inspectOfficeArchive(
  data: Uint8Array,
  limits: ResourceLimits,
): Promise<OfficeArchiveInspection> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (error) {
    throw new ExtractionError(
      `Failed to open archive (malformed container): ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }

  const entries: OfficeArchiveEntry[] = Object.values(zip.files).map((f) => {
    const meta = (
      f as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } }
    )._data;
    return {
      name: f.name,
      compressedSize: meta?.compressedSize ?? 0,
      uncompressedSize: meta?.uncompressedSize ?? 0,
      dir: f.dir,
    };
  });

  for (const entry of entries) assertSafeEntryName(entry.name);

  const fileEntries = entries.filter((e) => !e.dir);
  assertSafeArchive(fileEntries, limits);

  if (!zip.file("[Content_Types].xml")) {
    throw new ExtractionError(
      "Not a valid OOXML package: missing required [Content_Types].xml entry.",
      undefined,
      { entryCount: entries.length },
    );
  }

  return { zip, entries: fileEntries };
}
