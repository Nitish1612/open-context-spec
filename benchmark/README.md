# ULCS benchmark harness

Compares four representations of the _same_ underlying context for each
benchmark case (defined in `src/cases.ts`):

1. **unstructured** — a flattened prompt string, the way many apps assemble
   context today.
2. **basic-json** — an ad hoc JSON object with no standard schema, naively
   concatenated into a final prompt the way most such pipelines actually do
   it.
3. **ulcs-normalized** — a validated, `normalizeContext`-processed
   `ContextEnvelope`.
4. **ulcs-compiled** — the normalized context run through `compileContext`
   and the OpenAI adapter.

## What this measures (and what it does not)

This harness measures only what can be checked mechanically from the
artifacts themselves:

- **Validation success** — does the representation validate against a
  schema at all? (Only ULCS has one; the others honestly report
  `"n/a (no schema)"` rather than a fabricated pass/fail.)
- **Estimated token count** — via the same `approx-char4` fallback
  documented in `specification/v1/token-policy.md#2`.
- **Information preservation** — the fraction of ground-truth fact
  substrings that survive, verbatim, into the representation.
- **Citation preservation** — same, for citation URIs. Unstructured and
  basic-JSON representations score 0% here because neither has a
  standard place to put a citation — the source information exists only
  as prose the model may or may not repeat, and this case's raw prompt
  text doesn't happen to include the URI at all, which is realistic: most
  ad hoc pipelines don't carry citation URIs through at all.
- **Untrusted-content isolation** — whether the untrusted/retrieved
  content ends up in the same channel as the system instructions in the
  _final_ text sent to the model. This is the concrete, measurable form of
  the prompt-injection defense in `specification/v1/security.md`.
- **Required-fact retention** — whether `tokenPolicy.requiredItemIds`
  survive compilation (n/a for the non-ULCS representations, which have no
  such concept).
- **Deterministic ordering** — compiling the same input twice and
  comparing output byte-for-byte.
- **Per-adapter rendering loss** — for each of the six adapters, what
  fraction of each included item's text appears verbatim in that
  adapter's final output.
- **Construction latency** — wall-clock time on the machine running the
  benchmark, for this run only. Not a production performance claim.

**This harness does not measure, and never claims to measure, model
accuracy, answer quality, or "how much better the model performs."** That
would require running real completions against real models and grading the
outputs — see `live-eval.ts` below for an optional, opt-in way to do that
yourself, and `specification/v1/specification.md#2-non-goals`.

## Running it

```bash
pnpm run benchmark
# prints a per-case comparison table and writes benchmark/results/latest.json
```

No network access is required or attempted by `pnpm run benchmark`.

## Running against real models (optional, your own credentials)

`live-eval.ts` defines an `LLMRunner` interface and one example
implementation (`createOpenAICompatibleRunner`, using `fetch` against an
OpenAI-compatible `/chat/completions` endpoint — no SDK dependency). It:

- Does nothing unless `ULCS_BENCHMARK_LIVE=1` is set.
- Reads API keys only from environment variables you set yourself
  (e.g. `OPENAI_API_KEY`).
- Never reads, writes, or commits credentials to the repository.

```bash
ULCS_BENCHMARK_LIVE=1 OPENAI_API_KEY=sk-... pnpm run benchmark:live
```

Bring your own grading methodology for live responses — this harness
intentionally does not ship an "is this answer good" judge, since that
would require making — and defending — a claim about model quality that
ULCS itself does not make.
