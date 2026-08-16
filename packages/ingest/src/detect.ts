import { extname } from "node:path";
import type { ResolvedInput } from "./types.js";

export interface DetectionCandidate {
  extractorId: string;
  confidence: number;
  reason: string;
}

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".ndjson": "application/x-ndjson",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function mediaTypeFromExtension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const ext = extname(filename).toLowerCase();
  return EXTENSION_MEDIA_TYPES[ext];
}

const textDecoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Inspects raw bytes ("magic bytes") to detect a media type independent of
 * file extension. A file extension is never trusted on its own — see
 * `detectExtractor` in registry.ts, which combines this with extension and
 * declared MIME type.
 */
export function sniffMediaType(data: Uint8Array): string | undefined {
  if (data.length === 0) return undefined;

  // PDF: "%PDF-"
  if (data.length >= 5 && bytesEqual(data.subarray(0, 5), [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }

  // ZIP-based OOXML containers (docx/pptx/xlsx): local file header "PK\x03\x04".
  if (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  ) {
    const officeType = sniffZipOfficeType(data);
    if (officeType) return officeType;
    return "application/zip";
  }

  // UTF-8 BOM.
  const hasBom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
  const head = textDecoder
    .decode(data.subarray(hasBom ? 3 : 0, Math.min(data.length, 4096)))
    .trimStart();

  if (head.startsWith("<?xml")) return "application/xml";
  if (/^<!doctype html/i.test(head) || /^<html[\s>]/i.test(head)) return "text/html";
  if (looksLikeJson(head)) return "application/json";

  return undefined;
}

function looksLikeJson(head: string): boolean {
  const trimmed = head.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function bytesEqual(a: Uint8Array, expected: number[]): boolean {
  for (let i = 0; i < expected.length; i++) {
    if (a[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Zip local-file-header filenames appear as plaintext near the start of a
 * well-formed OOXML zip (the first entries are always `[Content_Types].xml`
 * followed by package-specific paths), so a bounded plaintext scan safely
 * distinguishes docx/pptx/xlsx without a full archive parse.
 */
function sniffZipOfficeType(data: Uint8Array): string | undefined {
  const scanLength = Math.min(data.length, 65536);
  const head = latin1(data.subarray(0, scanLength));
  if (head.includes("word/document.xml")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (head.includes("ppt/presentation.xml")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (head.includes("xl/workbook.xml")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return undefined;
}

function latin1(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i++) out += String.fromCharCode(data[i] as number);
  return out;
}

/** True when `data` decodes as valid UTF-8 without replacement/invalid sequences, used to guard against treating binary data as text. */
export function isLikelyValidUtf8(data: Uint8Array): boolean {
  const strictDecoder = new TextDecoder("utf-8", { fatal: true });
  try {
    strictDecoder.decode(data);
    return true;
  } catch {
    return false;
  }
}

export function inferFilename(input: ResolvedInput): string | undefined {
  if (input.filename) return input.filename;
  if (input.source.kind === "file" || input.source.kind === "directory") {
    return input.source.path.split(/[\\/]/).pop();
  }
  if (input.source.kind === "buffer") return input.source.filename;
  if (input.source.kind === "text") return input.source.name;
  if (input.source.kind === "url") {
    try {
      const url = new URL(input.source.url);
      return url.pathname.split("/").pop() || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
