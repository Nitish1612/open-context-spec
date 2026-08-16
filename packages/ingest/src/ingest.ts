import { readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";
import { validateContext } from "@ulcs/validator";
import { chunkDocument } from "./chunking/index.js";
import { walkDirectory } from "./extractors/directory.js";
import {
  NotFoundError,
  SecurityRejectionError,
  UsageError,
  ValidationFailedError,
} from "./errors.js";
import { mapDocumentsToContext } from "./mapper.js";
import { getDefaultRegistry, type ExtractorRegistry } from "./registry.js";
import { assertWithinByteLimit, resolveLimits } from "./security/limits.js";
import { fetchUrlSafely } from "./security/urls.js";
import type {
  Chunk,
  DirectoryFileResult,
  ExtractedDocument,
  IngestOptions,
  IngestResult,
  IngestionReport,
  InputSource,
  ResolvedInput,
} from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";

export interface IngestPipelineDeps {
  registry?: ExtractorRegistry;
}

/** Resolves an `InputSource` to raw bytes (or, for directories, leaves resolution to the caller). */
export async function resolveInput(
  source: InputSource,
  options: IngestOptions = {},
): Promise<ResolvedInput> {
  const limits = resolveLimits(options.limits);

  switch (source.kind) {
    case "text": {
      const data = new TextEncoder().encode(source.content);
      return {
        source,
        data,
        filename: source.name,
        mediaType: source.mediaType ?? "text/plain",
        sourceUri: source.name ? `text:${source.name}` : "text:inline",
      };
    }
    case "buffer": {
      assertWithinByteLimit(source.data.byteLength, limits.maxInputBytes, "Input");
      return {
        source,
        data: source.data,
        filename: source.filename,
        mediaType: source.mediaType,
        sourceUri: source.filename ? `buffer:${source.filename}` : "buffer:inline",
      };
    }
    case "file": {
      const absolutePath = resolvePath(source.path);
      let stats;
      try {
        stats = await stat(absolutePath);
      } catch {
        throw new NotFoundError(`File not found: "${source.path}".`, { path: source.path });
      }
      if (!stats.isFile()) {
        throw new UsageError(`"${source.path}" is not a regular file.`, { path: source.path });
      }
      assertWithinByteLimit(stats.size, limits.maxInputBytes, `File "${source.path}"`);
      const data = await readFile(absolutePath);
      return {
        source,
        data: new Uint8Array(data),
        filename: basename(absolutePath),
        sourceUri: `file://${absolutePath.split("\\").join("/")}`,
      };
    }
    case "directory": {
      const absolutePath = resolvePath(source.path);
      let stats;
      try {
        stats = await stat(absolutePath);
      } catch {
        throw new NotFoundError(`Directory not found: "${source.path}".`, { path: source.path });
      }
      if (!stats.isDirectory()) {
        throw new UsageError(`"${source.path}" is not a directory.`, { path: source.path });
      }
      return { source, sourceUri: `file://${absolutePath.split("\\").join("/")}` };
    }
    case "url": {
      const result = await fetchUrlSafely(source.url, {
        limits,
        allowPrivateNetworkUrls: options.allowPrivateNetworkUrls,
        signal: options.signal,
      });
      return {
        source,
        data: result.data,
        mediaType: result.contentType?.split(";")[0]?.trim(),
        sourceUri: result.finalUrl,
        filename: new URL(result.finalUrl).pathname.split("/").pop() || undefined,
      };
    }
  }
}

/** Detects the right extractor and runs it on a resolved (non-directory) input. */
export async function extractDocument(
  input: ResolvedInput,
  options: IngestOptions = {},
  deps: IngestPipelineDeps = {},
): Promise<{ document: ExtractedDocument; extractorId: string; detectedMediaType?: string }> {
  const registry = deps.registry ?? getDefaultRegistry();
  const detection = await registry.detect(input, { type: options.type });
  const document = await detection.extractor.extract(input, options);
  return {
    document,
    extractorId: detection.extractor.id,
    detectedMediaType: detection.detectedMediaType,
  };
}

function buildReport(
  inputLabel: string,
  detectedType: string | undefined,
  extractorId: string | undefined,
  documents: ExtractedDocument[],
  chunks: Chunk[],
  directorySummary?: IngestionReport["directorySummary"],
): IngestionReport {
  return {
    input: inputLabel,
    detectedType,
    extractorId,
    sectionsExtracted: documents.reduce((sum, d) => sum + d.sections.length, 0),
    chunksCreated: chunks.length,
    estimatedTokens: chunks.reduce((sum, c) => sum + (c.tokenEstimate ?? 0), 0),
    warnings: documents.flatMap((d) => d.warnings),
    directorySummary,
  };
}

function finalizeResult(
  documents: ExtractedDocument[],
  inputLabel: string,
  detectedType: string | undefined,
  extractorId: string | undefined,
  options: IngestOptions,
  directorySummary?: IngestionReport["directorySummary"],
): IngestResult {
  const chunksByDocumentId = new Map<string, Chunk[]>();
  const allChunks: Chunk[] = [];
  for (const document of documents) {
    const chunks = chunkDocument(document, {
      strategy: options.chunkStrategy ?? options.strategy,
      maxChars: options.maxChars,
      maxTokens: options.maxTokens,
      overlap: options.overlap,
      minChunkSize: options.minChunkSize,
      preserveStructuralBoundary: options.preserveStructuralBoundary,
      deduplicate: options.deduplicate,
      removeEmpty: options.removeEmpty,
      tokenizer: options.tokenizer,
    });
    chunksByDocumentId.set(document.id, chunks);
    allChunks.push(...chunks);
  }

  const { envelope, resources } = mapDocumentsToContext(
    { documents, chunksByDocumentId },
    options.mapping,
  );

  const validation = validateContext(envelope);
  if (!validation.valid) {
    throw new ValidationFailedError(
      `Generated ContextEnvelope failed schema validation (this indicates an internal ingestion bug): ${validation.errors
        .map((e) => `${e.path || "(root)"}: ${e.message}`)
        .join("; ")}`,
      { errors: validation.errors },
    );
  }

  const report = buildReport(
    inputLabel,
    detectedType,
    extractorId,
    documents,
    allChunks,
    directorySummary,
  );

  return { envelope, documents, chunks: allChunks, resources, report };
}

export async function ingestFile(path: string, options: IngestOptions = {}): Promise<IngestResult> {
  const input = await resolveInput({ kind: "file", path }, options);
  const { document, extractorId, detectedMediaType } = await extractDocument(input, options);
  return finalizeResult([document], path, detectedMediaType, extractorId, options);
}

export async function ingestUrl(url: string, options: IngestOptions = {}): Promise<IngestResult> {
  const input = await resolveInput({ kind: "url", url }, options);
  const { document, extractorId, detectedMediaType } = await extractDocument(input, options);
  return finalizeResult([document], url, detectedMediaType, extractorId, options);
}

export async function ingestText(
  content: string,
  options: IngestOptions & { name?: string; mediaType?: string } = {},
): Promise<IngestResult> {
  const input = await resolveInput(
    { kind: "text", content, name: options.name, mediaType: options.mediaType },
    options,
  );
  const { document, extractorId, detectedMediaType } = await extractDocument(input, options);
  return finalizeResult(
    [document],
    options.name ?? "(stdin)",
    detectedMediaType,
    extractorId,
    options,
  );
}

export async function ingestBuffer(
  data: Uint8Array,
  options: IngestOptions & { filename?: string; mediaType?: string } = {},
): Promise<IngestResult> {
  const input = await resolveInput(
    { kind: "buffer", data, filename: options.filename, mediaType: options.mediaType },
    options,
  );
  const { document, extractorId, detectedMediaType } = await extractDocument(input, options);
  return finalizeResult(
    [document],
    options.filename ?? "(buffer)",
    detectedMediaType,
    extractorId,
    options,
  );
}

export async function ingestDirectory(
  path: string,
  options: IngestOptions & { recursive?: boolean } = {},
): Promise<IngestResult> {
  const limits = resolveLimits(options.limits);
  const dirInput = await resolveInput(
    { kind: "directory", path, recursive: options.recursive },
    options,
  );
  const rootPath = resolvePath(path);

  const files = walkDirectory(rootPath, {
    recursive: options.recursive,
    include: options.include,
    exclude: options.exclude,
    limits,
  });

  const documents: ExtractedDocument[] = [];
  const fileResults: DirectoryFileResult[] = [];
  const onError = options.onError ?? "continue";

  for (const file of files) {
    try {
      const fileInput = await resolveInput({ kind: "file", path: file.absolutePath }, options);
      const { document } = await extractDocument(fileInput, options);
      documents.push(document);
      fileResults.push({ path: file.relativePath, status: "processed", document });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fileResults.push({ path: file.relativePath, status: "failed", reason });
      if (onError === "stop") {
        throw error instanceof Error ? error : new Error(reason);
      }
    }
  }

  const directorySummary = {
    processed: fileResults.filter((f) => f.status === "processed").length,
    skipped: fileResults.filter((f) => f.status === "skipped").length,
    failed: fileResults.filter((f) => f.status === "failed").length,
    files: fileResults,
  };

  void dirInput;
  return finalizeResult(documents, path, "directory", "directory", options, directorySummary);
}

/** Generic dispatcher over any `InputSource`. */
export async function ingest(
  source: InputSource,
  options: IngestOptions = {},
): Promise<IngestResult> {
  switch (source.kind) {
    case "file":
      return ingestFile(source.path, options);
    case "directory":
      return ingestDirectory(source.path, { ...options, recursive: source.recursive });
    case "url":
      return ingestUrl(source.url, options);
    case "text":
      return ingestText(source.content, {
        ...options,
        name: source.name,
        mediaType: source.mediaType,
      });
    case "buffer":
      return ingestBuffer(source.data, {
        ...options,
        filename: source.filename,
        mediaType: source.mediaType,
      });
    default: {
      const exhaustive: never = source;
      throw new UsageError(`Unknown input source kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export { DEFAULT_LIMITS };
export { SecurityRejectionError };
