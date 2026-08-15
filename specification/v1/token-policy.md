# Token and Compression Policy (Draft)

## 1. `TokenPolicy` fields

```json
{
  "maxContextTokens": 8000,
  "reservedOutputTokens": 1000,
  "sectionBudgets": { "facts": 2000, "conversation": 3000, "resources": 1500 },
  "relevanceThreshold": 0.2,
  "deduplicate": true,
  "allowSummarization": false,
  "allowTruncation": true,
  "requiredItemIds": ["urn:ulcs:instr:system-1"],
  "tokenEstimationMethod": "approx-char4"
}
```

| Field                   | Meaning                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxContextTokens`      | Total budget for compiled _input_ context (excludes `reservedOutputTokens`).                                                                                                                                   |
| `reservedOutputTokens`  | Tokens reserved for the model's response; subtracted from the effective budget available to the compiler if the caller also supplies a model context window (see `packages/compiler`).                         |
| `sectionBudgets`        | Per-section caps, keyed by envelope array name (`"facts"`, `"conversation"`, ...). A section budget can only _tighten_, never loosen, the overall `maxContextTokens`.                                          |
| `relevanceThreshold`    | Items with `relevance` below this are dropped before ranking (not merely down-ranked). Items with no `relevance` set are treated as passing (relevance is opt-in).                                             |
| `deduplicate`           | Whether the compiler runs `deduplicateContext` before selection.                                                                                                                                               |
| `allowSummarization`    | Whether the compiler may substitute a shorter form for an item that doesn't fit (via an injected summarizer function; see §3).                                                                                 |
| `allowTruncation`       | Whether the compiler may hard-truncate an item's `content` to fit remaining budget.                                                                                                                            |
| `requiredItemIds`       | Item IDs that are never dropped, truncated, or summarized away — the compiler fails loudly (`Error`, severity `fatal`, in the compiled result) rather than silently dropping a required item that doesn't fit. |
| `tokenEstimationMethod` | `"approx-char4"` (default fallback, documented in §2) or `"custom"` (caller supplies a `tokenizer` function to `compileContext`).                                                                              |

## 2. Token estimation

Without a real tokenizer, ULCS's default fallback estimate is:

```
estimatedTokens(text) = ceil(text.length / 4)
```

This is the same rough heuristic ("~4 characters per token for English
text") commonly used for order-of-magnitude budgeting; it is **not** an
accurate token count for any specific tokenizer and MUST NOT be presented as
one. `compileContext` accepts an optional `tokenizer: (text: string) =>
number` so callers can plug in a real provider tokenizer (e.g. `tiktoken`
for OpenAI models) without ULCS depending on it. All token counts in
compiled output are labeled `estimated` unless a custom tokenizer was
supplied, in which case they're labeled with the tokenizer's declared name.

## 3. Summarization is a hook, not a feature

ULCS does not ship a summarization model. `allowSummarization: true` only
takes effect if the caller passes a `summarizer: (text: string, budget:
number) => string` function to `compileContext`/`redactContext`. Without one,
items that don't fit are either truncated (if `allowTruncation: true`) or
dropped with a recorded reason — never silently and invisibly shortened.

## 4. Deterministic compilation algorithm

`compileContext` is a pure function of `(envelope, tokenPolicy, options)`
(plus an explicit `asOf` clock and optional `tokenizer`/`summarizer`
functions) — same inputs always produce the same output, including item
order. The algorithm:

1. **Normalize** (`normalizeContext`) if not already normalized.
2. **Filter**: drop items expired as of `asOf`; drop items whose `relevance`
   is set and below `relevanceThreshold`; sensitivity `exclude`/`local-only`
   items are removed with the reason recorded (compilation does _not_
   perform full `redactContext` — see the explicit warning in
   [security.md §3](./security.md#3-threat-model) about composing the two).
3. **Deduplicate** (`deduplicateContext`) if `deduplicate: true`.
4. **Rank** (`rankContext`): within each section, sort by `priority` desc,
   then `relevance` desc, then `id` ascending (stable, deterministic
   tiebreak).
5. **Select under budget**, section by section in a fixed, documented
   section order (`objective` singleton first if present, then
   `instructions`, `actors`, `constraints`, `facts`, `assumptions`,
   `decisions`, `preferences`, `entities`, `relationships`, `memory`,
   `resources`, `conversation`, `tools`, `toolResults`, `questions`):
   `requiredItemIds` are placed first
   regardless of rank; remaining items are added greedily while running
   total ≤ effective budget (section budget and remaining global budget,
   whichever is tighter); an item that doesn't fit is truncated (if
   allowed), summarized (if allowed and a summarizer is supplied), or
   dropped, in that preference order, and every non-included item is
   recorded in `droppedItems` with a machine-readable `reason`
   (`"below-relevance-threshold"`, `"expired"`, `"excluded-by-sensitivity"`,
   `"over-budget"`, `"duplicate"`).
6. **Emit** a `CompiledContext`: ordered `sections[]` (each with its
   included items and a running token estimate), `totalEstimatedTokens`,
   `droppedItems[]`, and `warnings[]`/`errors[]` (e.g. a `requiredItemIds`
   entry that could not fit becomes a `fatal` error rather than a silent
   drop).

This algorithm is implemented once, in `packages/compiler`, and is what
every provider adapter consumes — adapters never re-implement selection
logic, only rendering.
