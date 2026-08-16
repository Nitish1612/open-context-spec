# Ingestion (`@ulcs/ingest` / `ulcs ingest`)

Converts files, directories, URLs, and structured inputs into a valid ULCS
`ContextEnvelope`, deterministically and without calling an LLM. This
document covers architecture, security, limits, and operational detail; see
[`packages/ingest/README.md`](../packages/ingest/README.md) for a quick
start.

## Architecture

```text
Input
  ↓
Input resolver and type detector      (detect.ts, registry.ts)
  ↓
Format-specific extractor             (extractors/*.ts)
  ↓
Normalized extracted document         (ExtractedDocument)
  ↓
Chunker and deduplicator              (chunking/*.ts)
  ↓
Provenance, trust and sensitivity mapper (mapper.ts)
  ↓
ULCS ContextEnvelope
  ↓
Schema validator                      (@ulcs/validator)
  ↓
Optional provider compiler            (@ulcs/compiler + @ulcs/adapters)
  ↓
ULCS / OpenAI / Anthropic / Gemini / Generic / Markdown / MCP output
```

Every stage up to and including the mapper is deterministic and
network-free (except URL resolution itself, which is the input, not a side
effect of processing). Extractors return `ExtractedDocument` — normalized
content, never a provider-specific prompt.

## Supported inputs

| Format             | Extractor id | Notes                                                                                 |
| ------------------ | ------------ | ------------------------------------------------------------------------------------- |
| `.txt`             | `text`       | Single section, UTF-8 strict-decoded with a warning on invalid sequences.             |
| `.md`              | `markdown`   | Sections split at ATX headings; fenced code blocks never mistaken for headings.       |
| `.json`            | `json`       | One section per top-level key/array element; rejects invalid JSON with line/column.   |
| `.jsonl`/`.ndjson` | `jsonl`      | One section per record; a malformed line is skipped with a warning, not fatal.        |
| `.csv`             | `csv`        | RFC-4180-ish (quoted fields, embedded newlines); one section per row, never split.    |
| `.tsv`             | `tsv`        | Same as CSV with a tab delimiter; `--delimiter` overrides either.                     |
| `.html`/`.htm`     | `html`       | Visible text only; scripts/styles/nav stripped; headings/lists/tables preserved.      |
| `.xml`             | `xml`        | DTD/external-entity/XXE-safe by construction (see [Security model](#security-model)). |
| `.pdf`             | `pdf`        | Page-by-page text via `unpdf`/PDF.js; image-only pages flagged, not silently empty.   |
| `.docx`            | `docx`       | Headings/paragraphs/lists/tables via `mammoth`; macros and embedded objects ignored.  |
| `.pptx`            | `pptx`       | Slide title/body/notes/tables via direct DrawingML text-run extraction.               |
| `.xlsx`            | `xlsx`       | Sheet rows via `exceljs`; formula text + cached value; never evaluates formulas.      |

Also: individual files, stdin (`-`), in-memory text/buffers, directories
(optionally recursive), and `http(s)://` URLs.

### What's unsupported, and why that's not a lie about "universal"

"Universal" here means the **extractor/plugin architecture** is general —
not that every byte sequence on disk is understood. An unrecognized format
produces a typed `UnsupportedFormatError` (exit code `2`) that lists every
registered extractor, so failure is legible and scriptable, not silent or
mysterious. Extending coverage means registering a new `ContentExtractor`
(see [Custom extractors](#custom-extractors-and-plugins)), not modifying
this package.

Known partial-coverage areas, documented rather than faked:

- **OCR** is not built in. Image-only PDF pages produce a clear
  `ocr-unavailable` warning (or a `CapabilityUnavailableError` if `--ocr` was
  explicitly requested with no provider configured) instead of silently
  returning empty content. See [OCR configuration](#ocr-configuration).
- **PPTX charts/diagrams/images** — only their text labels (if any) are
  extracted; a `slide contains a chart or diagram` / `...an image` warning
  is attached per slide.
- **PPTX slide ordering** is inferred from `slideN.xml` filename numbering,
  the conventional (not schema-guaranteed) order most authoring tools use.
- **XLSX** extracts formula _text_ and any cached result value; it never
  evaluates a formula, follows an external link, or runs a macro.

## Security model

Every one of these is implemented in `packages/ingest/src/security/*.ts` and
exercised by `packages/ingest/tests/security.test.ts`.

- **Path traversal / Zip Slip**: `safeJoin` resolves every archive entry
  against its base directory and rejects any entry that would escape it
  (used for docx/pptx/xlsx zip containers).
- **Zip bombs / decompression bombs**: `assertSafeArchive` rejects an
  archive with too many entries, too much total uncompressed content, or any
  single entry whose compression ratio exceeds `maxCompressionRatio`
  (default 100×).
- **XXE / entity expansion**: the XML extractor uses `fast-xml-parser`,
  which never resolves `SYSTEM`/`PUBLIC` external entities (no DTD
  processing at all) — and, as defense in depth, explicitly rejects any
  DOCTYPE that declares an external subset or a custom `<!ENTITY>` before
  parsing even begins.
- **SSRF**: URL ingestion (`security/urls.ts`) allows only `http:`/`https:`,
  rejects embedded credentials (`user:pass@host`), resolves DNS and checks
  **every** resolved address against loopback/private/link-local
  (including the `169.254.169.254` cloud metadata endpoint)/multicast/
  reserved ranges, **re-validates every redirect hop** the same way, caps
  redirects (`maxRedirects`, default 5), enforces a request timeout and a
  response-size cap, rejects unsupported content encodings, and sends a
  static, conservative user agent. It never forwards inbound auth headers.
  Private-network targets can be allowed only via an explicit host-app
  opt-in (`allowPrivateNetworkUrls`), off by default.
- **Path/symlink safety**: directory ingestion never follows symlinks by
  default and detects symlink loops defensively (`SymlinkLoopGuard`).
- **Formula injection**: XLSX cell text starting with `=`, `+`, `-`, `@`,
  tab, or CR is prefixed with `'` before being emitted as extracted text, so
  round-tripping it back through a spreadsheet later can't execute it.
- **Binary-as-text guard**: text-based extractors strict-decode UTF-8 first
  and fall back to lossy decoding _with a warning_ rather than silently
  treating arbitrary bytes as text.
- **No macro/script/formula execution, anywhere.** `mammoth` and `exceljs`
  parse OOXML declaratively; cheerio parses HTML without a JS engine.
- **Temp-file-free**: every extractor operates on in-memory byte buffers;
  there is nothing to leak via a leftover temp file.

### Resource limits

All configurable via `ExtractionOptions.limits` (SDK) or CLI flags where
applicable; defaults live in `DEFAULT_LIMITS` (`types.ts`):

| Limit                                         | Default                                |
| --------------------------------------------- | -------------------------------------- |
| Max input file size                           | 100 MB                                 |
| Max extracted characters                      | 20,000,000                             |
| Max archive entries                           | 10,000                                 |
| Max archive uncompressed size                 | 500 MB                                 |
| Max archive compression ratio                 | 100×                                   |
| Max directory file count                      | 50,000                                 |
| Max directory total size                      | 2 GB                                   |
| Max URL response size                         | 25 MB                                  |
| Max redirects                                 | 5                                      |
| Extraction timeout                            | 60s                                    |
| Max sections / rows / sheets / slides / pages | 50,000 / 500,000 / 200 / 2,000 / 5,000 |

Exceeding any of these raises `SecurityRejectionError` (exit code `4`), not
a silent truncation.

## URL ingestion risks

Fetching a URL means the ingesting process makes an outbound HTTP(S)
request on the caller's behalf. Even with SSRF protections, review before
enabling `allowPrivateNetworkUrls`: it is intended only for host
applications that genuinely need to fetch from an internal service they
control, and doing so re-opens exactly the internal-network-access class of
risk the default configuration exists to close.

## Directory ingestion

Deterministic (lexically sorted) traversal; hidden files/dirs (`.`-prefixed)
and `.git`, `node_modules`, `dist`, `build`, `coverage` are skipped by
default; `--recursive` opts into subdirectories; `--include`/`--exclude`
take glob patterns (via `minimatch`); `--on-error stop|continue` controls
whether one bad file aborts the run or is recorded and skipped. The report's
`directorySummary` lists every file's outcome; the CLI exits `5` when any
file failed under `--on-error continue`.

## Chunking

Strategies: `none`, `characters`, `paragraphs`, `sentences`, `pages`,
`slides`, `rows`, `sections`, `auto` (default — picks a structural strategy
from the document's shape, falling back to `paragraphs`). `rows` never
splits an individual row across chunks; character-based splitting never
cuts a UTF-16 surrogate pair. `minChunkSize` is a soft packing hint — a
too-small chunk is merged into a neighbor rather than dropped, and never
merged past `maxChars`. Chunk ids are `{documentId}:chunk:{hashPrefix}:{index}`
— deterministic for the same document + options, and never collide under
overlap (which duplicates _text_, not ids).

## Provider compilation

Selecting `--target openai|anthropic|gemini|generic|markdown|mcp` still
builds and validates the canonical ULCS envelope first, then runs it through
`@ulcs/compiler` + the matching `@ulcs/adapters` renderer — the same path
`ulcs compile` uses. The ULCS envelope is always the intermediate
representation; `--target ulcs` (the default) skips compilation entirely.

## CLI usage

```bash
ulcs ingest document.pdf -o context.json
ulcs ingest report.docx -o context.json
ulcs ingest data.csv -o context.json
ulcs ingest ./documents --recursive -o knowledge-base.json
ulcs ingest https://example.com/article -o article-context.json
ulcs ingest - --type text -o stdin-context.json
```

Exit codes: `0` success · `1` validation failure · `2` usage/unsupported
format · `3` extraction failure · `4` security-policy rejection · `5`
partial directory-ingestion failure.

The human-readable progress report (or its `--json` form) is always written
to **stderr**; the generated document goes to the file given by `-o`, or to
stdout when neither `-o` nor `--stdout` narrows it — they are never mixed on
the same stream. `--quiet` suppresses everything but a fatal error.

## SDK usage

```typescript
import {
  ingestFile,
  ingestDirectory,
  ingestUrl,
  chunkDocument,
  mapDocumentsToContext,
} from "@ulcs/ingest";
```

See [`packages/ingest/README.md`](../packages/ingest/README.md#quick-start-sdk)
for the full exported surface and a runnable example.

## Custom extractors and plugins

```typescript
import { createExtractorRegistry } from "@ulcs/ingest";
const registry = createExtractorRegistry();
registry.register(customExtractor);
```

A `ContentExtractor` implements `supports(input)` and
`extract(input, options) => Promise<ExtractedDocument>` — nothing else. It
must return normalized content only, never a provider-specific prompt, and
extracted content is always mapped to `untrusted` resources downstream
regardless of what the extractor does.

Suggested extension points for future plugins, deliberately **not**
implemented in this deterministic core (they require model calls, external
services, or heavy native dependencies):

- **OCR** — implement `OcrProvider` (`recognize(image, options)`) and pass
  it via `ExtractionOptions.ocrProvider`; the PDF extractor calls it only
  when `--ocr` is set _and_ a provider is configured.
- **Images and vision models** — a `ContentExtractor` whose `extract` calls
  an external vision API, still returning normalized `ExtractedDocument`
  text.
- **Audio/video transcription** — same shape; the extractor owns the
  transcription call, this package only defines the extractor interface it
  plugs into.
- **Email archives (mbox/PST)**, **source-code-aware parsing**,
  **database exports**, **cloud storage connectors**, **application APIs**
  — all straightforward `ContentExtractor` implementations; none require
  changes to this package.

## Optional AI enrichment (not required, not enabled by default)

`ContextEnricher` (`enrich(document, options) => Promise<ContextItem[]>`) is
a defined-but-unimplemented interface for future optional enrichment (facts,
decisions, entities, relationships, summaries extracted by a model). The
core ingestion package has **no provider SDK dependency and requires no API
key**; `--no-llm` is a guarantee, not a toggle, because nothing in this
package ever calls a model. Any future enrichment implementation must:

- Attach provenance to every AI-generated item.
- Default AI-generated items to `status: "inferred"` where the schema
  supports it — inferred output must never be presented as `"confirmed"`.
  **Known schema gap**: `ContextItemBase.status` (see
  `packages/core/src/types.ts`) supports `"confirmed" | "unconfirmed" |
"disputed" | "retracted" | "superseded"` — there is no `"inferred"` value
  today. An enrichment implementation should use `"unconfirmed"` (the
  closest existing value) and say so in its own documentation rather than
  inventing a non-schema value; adding `"inferred"` to the schema is future
  spec work, not something this ingestion package can do unilaterally.

## OCR configuration

Not enabled by default and not a required dependency. To use `--ocr`:

1. Implement `OcrProvider` in your host application (any OCR engine of your
   choice — this package intentionally has no opinion and no mandatory
   native/binary dependency).
2. Pass it as `ExtractionOptions.ocrProvider` (SDK) — there is currently no
   CLI flag to load a provider by name, since providers are host-application
   code, not something this package can discover.
3. Without a configured provider, `--ocr` on a document with image-only
   pages raises `CapabilityUnavailableError` (exit `2`) with a clear
   message identifying the affected pages, rather than silently producing
   empty content.

## Troubleshooting

- **"No extractor found for ..."** — the file's magic bytes, declared MIME
  type, and extension all failed to match a registered extractor. Pass
  `--type <id>` to force one, or check `ulcs ingest --help` for the id list.
- **"Ambiguous format for ..."** — two extractors scored identically during
  detection (typically only possible with custom-registered extractors that
  overlap a built-in). Pass `--type` to disambiguate.
- **Empty resources array** — check `report.warnings`; `empty-content` means
  the source genuinely had no extractable text (e.g., an image-only PDF with
  no OCR configured).
- **Directory ingestion exits 5** — one or more files failed under the
  default `--on-error continue`; see `directorySummary.files` in the
  `--json` report for which ones and why.

## Performance considerations

Extraction is single-pass and in-memory per document; directory ingestion
processes files sequentially (deterministic ordering matters more than
throughput here). For very large corpora, shard the directory ingestion
across multiple `ulcs ingest` invocations rather than relying on one process
to walk everything — resource limits (`maxDirectoryFileCount`,
`maxDirectoryTotalBytes`) exist to fail loudly rather than degrade silently
if a directory is larger than expected.

## Privacy implications

Ingested content — including anything in file contents, filenames, and URLs
— is embedded directly into the output `ContextEnvelope` (as `resources`)
and is not sent anywhere by this package itself. URL ingestion does make an
outbound network request to the target URL. No content is sent to any AI
provider by ingestion itself; provider compilation (`--target openai`, etc.)
only _formats_ the already-local envelope for a provider's message shape —
it does not call the provider's API.
