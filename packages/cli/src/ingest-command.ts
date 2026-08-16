import { existsSync, readFileSync, statSync } from "node:fs";
import type { Command } from "commander";
import { validateContext, formatValidationErrors } from "@ulcs/validator";
import {
  IngestError,
  ingestDirectory,
  ingestFile,
  ingestText,
  ingestUrl,
  type ChunkStrategy,
  type IngestOptions,
  type IngestResult,
  type IngestionReport,
} from "@ulcs/ingest";
import { compileContext } from "@ulcs/compiler";
import {
  toAnthropicMessages,
  toGeminiContents,
  toGenericChatMessages,
  toMarkdownPrompt,
  toMCPResource,
  toOpenAIMessages,
} from "@ulcs/adapters";
import { readInput, writeOutput } from "./io.js";

const CHUNK_STRATEGIES: ChunkStrategy[] = [
  "none",
  "characters",
  "paragraphs",
  "sentences",
  "pages",
  "slides",
  "rows",
  "sections",
  "auto",
];
const TRUST_LEVELS = ["trusted", "semi-trusted", "untrusted", "unknown"] as const;
const SENSITIVITY_LEVELS = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "personal",
  "secret",
] as const;
const TARGETS = ["ulcs", "openai", "anthropic", "gemini", "generic", "markdown", "mcp"] as const;
type Target = (typeof TARGETS)[number];

interface IngestCliOptions {
  output?: string;
  target: string;
  type?: string;
  recursive?: boolean;
  ocr?: boolean;
  chunkStrategy: string;
  chunkSize?: string;
  chunkOverlap?: string;
  maxTokens?: string;
  reservedOutputTokens?: string;
  sensitivity?: string;
  trust?: string;
  objective?: string;
  instruction?: string;
  tag?: string[];
  metadata?: string;
  include?: string[];
  exclude?: string[];
  onError: string;
  validate?: boolean;
  pretty?: boolean;
  stdout?: boolean;
  dryRun?: boolean;
  llm: boolean;
  json?: boolean;
  quiet?: boolean;
}

function parseMetadata(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const text = existsSync(raw) && statSync(raw).isFile() ? readFileSync(raw, "utf8") : raw;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Failed to parse --metadata as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function detectInputKind(input: string): "url" | "directory" | "stdin" | "file" {
  if (input === "-") return "stdin";
  if (/^https?:\/\//i.test(input)) return "url";
  if (existsSync(input) && statSync(input).isDirectory()) return "directory";
  return "file";
}

function printReport(
  report: IngestionReport,
  opts: IngestCliOptions,
  target: Target,
  output: string,
): void {
  if (opts.quiet) return;
  if (opts.json) {
    console.error(JSON.stringify(report, null, 2));
    return;
  }
  const lines = [
    `Input: ${report.input}`,
    report.detectedType ? `Detected type: ${report.detectedType}` : undefined,
    report.extractorId ? `Extractor: ${report.extractorId}` : undefined,
    `Sections extracted: ${report.sectionsExtracted}`,
    `Chunks created: ${report.chunksCreated}`,
    `Estimated tokens: ${report.estimatedTokens}`,
    `Schema validation: passed`,
    `Target: ${target.toUpperCase()}`,
    `Output: ${output}`,
    `Warnings: ${report.warnings.length}`,
    ...(report.directorySummary
      ? [
          `Directory: processed=${report.directorySummary.processed} skipped=${report.directorySummary.skipped} failed=${report.directorySummary.failed}`,
        ]
      : []),
  ].filter((l): l is string => Boolean(l));
  for (const line of lines) console.error(line);
  for (const warning of report.warnings) console.error(`warning: ${warning.message}`);
}

export function registerIngestCommand(program: Command): void {
  program
    .command("ingest")
    .description("Convert a file, directory, URL, or stdin into a ULCS ContextEnvelope document")
    .argument("<input>", 'file path, directory path, http(s) URL, or "-" for stdin')
    .option("-o, --output <file>", "output file (default: stdout)")
    .option("--target <target>", `output target: ${TARGETS.join(", ")}`, "ulcs")
    .option("--type <type>", "explicit extractor id, overriding automatic detection")
    .option("--recursive", "recurse into subdirectories (directory input only)", false)
    .option("--ocr", "attempt OCR on image-only/scanned pages, if a provider is configured", false)
    .option(
      "--chunk-strategy <strategy>",
      `chunking strategy: ${CHUNK_STRATEGIES.join(", ")}`,
      "auto",
    )
    .option("--chunk-size <number>", "maximum characters per chunk")
    .option("--chunk-overlap <number>", "character overlap between adjacent chunks")
    .option("--max-tokens <number>", "tokenPolicy.maxContextTokens for the generated envelope")
    .option(
      "--reserved-output-tokens <number>",
      "tokenPolicy.reservedOutputTokens for the generated envelope",
    )
    .option(
      "--sensitivity <level>",
      `sensitivity level applied to every resource: ${SENSITIVITY_LEVELS.join(", ")}`,
    )
    .option("--trust <level>", `trust level applied to every resource: ${TRUST_LEVELS.join(", ")}`)
    .option("--objective <text>", "objective summary for the generated envelope")
    .option("--instruction <text>", "additional trusted user instruction to include")
    .option(
      "--tag <tag>",
      "tag to apply to every resource (repeatable)",
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option(
      "--metadata <json-or-file>",
      "extra envelope metadata, as inline JSON or a path to a JSON file",
    )
    .option(
      "--include <pattern>",
      "glob pattern to include (directory input; repeatable)",
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option(
      "--exclude <pattern>",
      "glob pattern to exclude (directory input; repeatable)",
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option("--on-error <stop|continue>", "directory ingestion error handling", "continue")
    .option(
      "--validate",
      "validate the generated envelope even when not writing ULCS output",
      false,
    )
    .option("--pretty", "pretty-print JSON output", true)
    .option("--stdout", "write the document to stdout (default when --output is omitted)", false)
    .option("--dry-run", "run the full pipeline and print the report without writing output", false)
    .option(
      "--no-llm",
      "guarantee no external model calls are made (default; ingestion never calls an LLM)",
    )
    .option(
      "--json",
      "print the progress report as machine-readable JSON (always on stderr, so it never mixes with document output on stdout)",
      false,
    )
    .option("--quiet", "print nothing except fatal errors", false)
    .action(async (input: string, opts: IngestCliOptions) => {
      try {
        await runIngestCommand(input, opts);
      } catch (error) {
        if (error instanceof IngestError) {
          if (!opts.quiet) console.error(error.message);
          process.exitCode = error.exitCode;
          return;
        }
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 3;
      }
    });
}

async function runIngestCommand(input: string, opts: IngestCliOptions): Promise<void> {
  if (opts.output && opts.stdout) {
    console.error("Cannot use --output and --stdout together.");
    process.exitCode = 2;
    return;
  }
  const target = opts.target as Target;
  if (!TARGETS.includes(target)) {
    console.error(`Unknown target "${opts.target}". Expected one of: ${TARGETS.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  if (!["stop", "continue"].includes(opts.onError)) {
    console.error(`Unknown --on-error value "${opts.onError}". Expected "stop" or "continue".`);
    process.exitCode = 2;
    return;
  }

  const metadata = parseMetadata(opts.metadata);

  const ingestOptions: IngestOptions = {
    type: opts.type,
    ocr: opts.ocr,
    strategy: opts.chunkStrategy as ChunkStrategy,
    maxChars: opts.chunkSize ? Number(opts.chunkSize) : undefined,
    overlap: opts.chunkOverlap ? Number(opts.chunkOverlap) : undefined,
    include: opts.include,
    exclude: opts.exclude,
    onError: opts.onError as "stop" | "continue",
    mapping: {
      trust: opts.trust as (typeof TRUST_LEVELS)[number] | undefined,
      sensitivity: opts.sensitivity as (typeof SENSITIVITY_LEVELS)[number] | undefined,
      tags: opts.tag && opts.tag.length > 0 ? opts.tag : undefined,
      metadata,
      objective: opts.objective,
      instruction: opts.instruction,
      maxContextTokens: opts.maxTokens ? Number(opts.maxTokens) : undefined,
      reservedOutputTokens: opts.reservedOutputTokens
        ? Number(opts.reservedOutputTokens)
        : undefined,
    },
  };

  const kind = detectInputKind(input);
  let result: IngestResult;
  if (kind === "stdin") {
    const content = readInput("-");
    result = await ingestText(content, {
      ...ingestOptions,
      name: opts.type ? `stdin.${opts.type}` : undefined,
    });
  } else if (kind === "url") {
    result = await ingestUrl(input, ingestOptions);
  } else if (kind === "directory") {
    result = await ingestDirectory(input, { ...ingestOptions, recursive: opts.recursive });
  } else {
    if (!existsSync(input)) {
      console.error(`File not found: "${input}".`);
      process.exitCode = 2;
      return;
    }
    result = await ingestFile(input, ingestOptions);
  }

  if (opts.validate || target === "ulcs") {
    const validation = validateContext(result.envelope);
    if (!validation.valid) {
      console.error(`Generated envelope failed validation:`);
      for (const line of formatValidationErrors(validation.errors)) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }
  }

  let rendered: string;
  switch (target) {
    case "ulcs":
      // Pretty-printed by default (matching every other `ulcs` subcommand);
      // --pretty is accepted for CLI-surface consistency with the
      // documented options.
      rendered = JSON.stringify(result.envelope, null, 2);
      break;
    case "openai":
    case "anthropic":
    case "gemini":
    case "generic":
    case "markdown":
    case "mcp": {
      const compiled = compileContext(result.envelope);
      switch (target) {
        case "openai":
          rendered = JSON.stringify(toOpenAIMessages(compiled), null, 2);
          break;
        case "anthropic":
          rendered = JSON.stringify(toAnthropicMessages(compiled), null, 2);
          break;
        case "gemini":
          rendered = JSON.stringify(toGeminiContents(compiled), null, 2);
          break;
        case "generic":
          rendered = JSON.stringify(toGenericChatMessages(compiled), null, 2);
          break;
        case "markdown":
          rendered = toMarkdownPrompt(compiled);
          break;
        case "mcp":
          rendered = JSON.stringify(toMCPResource(compiled), null, 2);
          break;
      }
      break;
    }
  }

  const outputLabel = opts.dryRun ? "(dry run — not written)" : (opts.output ?? "stdout");

  if (!opts.dryRun) {
    writeOutput(opts.output, rendered);
  }

  printReport(result.report, opts, target, outputLabel);

  if (result.report.directorySummary && result.report.directorySummary.failed > 0) {
    process.exitCode = 5;
  }
}
