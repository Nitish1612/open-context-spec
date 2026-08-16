import { readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";
import { validateContext } from "@ulcs/validator";
import { chunkDocument } from "./chunking/index.js";
import { walkDirectory, type SkipReason } from "./extractors/directory.js";
import {
  NotFoundError,
  SecurityRejectionError,
  UsageError,
  ValidationFailedError,
} from "./errors.js";
import { mapDocumentsToContext } from "./mapper.js";
import { getDefaultRegistry, type ExtractorRegistry } from "./registry.js";
import { assertWithinByteLimit, combineSignals, resolveLimits } from "./security/limits.js";
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
        acceptErrorResponses: options.acceptErrorResponses,
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
  const limits = resolveLimits(options.limits);

  // Every extractor — built-in or custom — runs under the same deadline,
  // combined with any caller-supplied AbortSignal, and both are exposed to
  // the extractor as one signal so an extractor that checks
  // `options.signal` reacts to either. Third-party libraries that can't
  // truly be cancelled mid-operation (e.g. a synchronous parse loop) will
  // keep running in the background, but the promise this function returns
  // still rejects promptly at the deadline either way; `withTimeout` also
  // ensures a late-settling extractor call can never surface as an
  // unhandled rejection or mutate an already-returned result.
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () =>
      timeoutController.abort(
        new SecurityRejectionError(
          `Extraction with "${detection.extractor.id}" exceeded the deadline of ${limits.extractionTimeoutMs}ms.`,
          {
            timeoutMs: limits.extractionTimeoutMs,
            extractorId: detection.extractor.id,
          },
        ),
      ),
    limits.extractionTimeoutMs,
  );
  const { signal: combined, dispose } = combineSignals([options.signal, timeoutController.signal]);

  // `withTimeout` alone only races against its own fixed timer — an
  // extractor that ignores the `signal` it's handed (most third-party
  // libraries do) would never actually be cut off by a caller's own
  // AbortSignal firing early. Racing directly against `combined`'s abort
  // event (which fires for *either* the deadline or the caller's signal)
  // is what actually makes cancellation work regardless of whether the
  // extractor itself cooperates.
  let settled = false;
  const abortRace = new Promise<never>((_, reject) => {
    const onAbort = () =>
      reject(
        combined.reason instanceof Error
          ? combined.reason
          : new SecurityRejectionError("Extraction was aborted.", {}),
      );
    if (combined.aborted) onAbort();
    else combined.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const extractPromise = detection.extractor
      .extract(input, { ...options, signal: combined })
      .then((doc) => {
        settled = true;
        return doc;
      })
      .catch((error: unknown) => {
        if (settled) return undefined as never; // already lost the race; swallow to avoid an unhandled rejection
        settled = true;
        throw error;
      });

    const document = await Promise.race([extractPromise, abortRace]);
    return {
      document,
      extractorId: detection.extractor.id,
      detectedMediaType: detection.detectedMediaType,
    };
  } finally {
    settled = true; // any later extractor settlement is now known-late and gets swallowed above
    clearTimeout(timer);
    dispose();
  }
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

const SKIP_REASON_MESSAGES: Record<SkipReason, string> = {
  hidden: "Hidden file or directory (dotfile), excluded by default.",
  "ignored-directory": "Directory is in the default-ignored set (e.g. node_modules, .git).",
  "excluded-by-pattern": "Matched an --exclude glob pattern.",
  "not-included-by-pattern": "Did not match any --include glob pattern.",
  symlink: "Symlinks are never followed.",
  unreadable: "Could not be stat'd (broken symlink or removed during the walk).",
  "not-a-regular-file": "Not a regular file (e.g. a socket, device, or FIFO).",
  "directory-not-recursed": "Subdirectory not descended into; pass --recursive to include it.",
};

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

  const { files, skipped } = walkDirectory(rootPath, {
    recursive: options.recursive,
    include: options.include,
    exclude: options.exclude,
    limits,
  });

  const documents: ExtractedDocument[] = [];
  const fileResults: DirectoryFileResult[] = [];
  const onError = options.onError ?? "continue";

  for (const entry of skipped) {
    fileResults.push({
      path: entry.relativePath,
      status: "skipped",
      reason: SKIP_REASON_MESSAGES[entry.reason],
    });
  }

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

  fileResults.sort((a, b) => a.path.localeCompare(b.path));

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
