# @ulcs/ingest

> Provisional package name — drafted under the working name **Universal LLM
> Context Schema (ULCS)**. The project's human-facing name is **Open
> Context Specification (OCS)**; see
> [ADR-0004](../../specification/decisions/0004-ocs-branding-and-ulcs-migration.md).

Universal ingestion for the Open Context Specification: converts files,
directories, URLs, and structured inputs into a valid ULCS `ContextEnvelope`
document — **without requiring an LLM**.

```bash
ulcs ingest document.pdf -o context.json
```

## What "universal" means here

Not "every binary format is understood." It means an **extensible
extractor/plugin architecture** with a fixed, documented set of built-in
extractors and a clear, typed error for anything unsupported — see
[Supported inputs](#supported-inputs) below and
[`docs/ingestion.md`](../../docs/ingestion.md) for the full picture,
including format limitations, security model, and OCR configuration.

## Pipeline

```text
Input → resolve + detect → format-specific extractor → ExtractedDocument
      → chunker/deduplicator → provenance/trust/sensitivity mapper
      → ULCS ContextEnvelope → schema validator → (optional) provider compiler
```

Extraction is **deterministic and normalized-content-only** — extractors
never build provider-specific prompts, and extracted text is always mapped
to `resources` with `trust.level: "untrusted"` and
`providesInstructions: false`. It can never become an instruction without an
explicit, separate, trusted item — see
[specification/v1/security.md](../../specification/v1/security.md).

## Supported inputs

`.txt` `.md` `.json` `.jsonl` `.csv` `.tsv` `.html` `.xml` `.pdf` `.docx`
`.pptx` `.xlsx` — plus individual files, stdin, in-memory text/buffers,
directories (recursive optional), and `http(s)://` URLs (SSRF-hardened, see
below).

## Quick start (CLI)

```bash
ulcs ingest document.pdf -o context.json
ulcs ingest report.docx -o context.json
ulcs ingest data.csv -o context.json
ulcs ingest ./documents --recursive -o knowledge-base.json
ulcs ingest https://example.com/article -o article-context.json
printf "hello" | ulcs ingest - --type text --stdout
```

Run `ulcs ingest --help` for the full option list. See
[`docs/ingestion.md`](../../docs/ingestion.md#cli-usage) for exit codes and
the progress-report format.

## Quick start (SDK)

```typescript
import { ingestFile, ingestDirectory } from "@ulcs/ingest";
import { validateContext } from "@ulcs/validator";

const result = await ingestFile("report.docx", {
  strategy: "auto",
  mapping: { sensitivity: "internal" },
});

const { valid, errors } = validateContext(result.envelope);
console.log(result.report); // { sectionsExtracted, chunksCreated, estimatedTokens, warnings, ... }
```

Public SDK surface: `ingest`, `ingestFile`, `ingestDirectory`, `ingestUrl`,
`ingestText`, `ingestBuffer`, `detectExtractor`, `extractDocument`,
`chunkDocument`, `mapDocumentsToContext`, `createExtractorRegistry`,
`listBuiltInExtractors`, `createIngestionPipeline`. All results are typed —
no `any` in the public API.

## Custom extractors

```typescript
import { createExtractorRegistry, listBuiltInExtractors } from "@ulcs/ingest";
import type { ContentExtractor } from "@ulcs/ingest";

const myExtractor: ContentExtractor = {
  id: "my-format",
  name: "My Format",
  extensions: [".myf"],
  mediaTypes: ["application/x-my-format"],
  supports: (input) => (input.filename ?? "").endsWith(".myf"),
  extract: async (input, options) => {
    /* return an ExtractedDocument */
  },
};

const registry = createExtractorRegistry();
for (const extractor of listBuiltInExtractors()) registry.register(extractor);
registry.register(myExtractor);
```

See [`examples/ingestion/custom-extractor`](../../examples/ingestion/custom-extractor)
for a runnable example. OCR is wired in for scanned PDF pages when an
`OcrProvider` is configured (`--ocr-provider` on the CLI, or
`ExtractionOptions.ocrProvider` on the SDK) — see
[`docs/ingestion.md`](../../docs/ingestion.md#ocr-configuration). For
images/vision, audio/video transcription, email archives, source code,
database exports, and cloud storage/API sources, `docs/ingestion.md` has
guidance on building a `ContentExtractor` — those stay **outside** this
deterministic core.

## Security model (summary)

Path traversal / Zip Slip, zip bombs, XXE, SSRF (private/loopback/reserved
IP ranges blocked by default, redirects re-validated, size/redirect/timeout
limits enforced), formula-injection-safe spreadsheet text, no macro/script
execution, and configurable resource limits throughout. Full detail,
including what to review before enabling `--ocr` or private-network URL
ingestion, is in [`docs/ingestion.md`](../../docs/ingestion.md#security-model).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
