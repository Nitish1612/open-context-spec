# Example: RAG with citations and untrusted retrieved text

A retrieval-augmented generation context with two retrieved `Resource`
items:

1. A legitimate help-center article, with a `Citation` and full
   provenance (`sourceType`, `retrievedAt`, `contentTimestamp`).
2. A **prompt-injection attempt** from an unauthenticated forum post,
   whose content is an imperative sentence trying to get the model to
   promise a fraudulent refund.

Both resources have `trust.level: "untrusted"` and
`trust.providesInstructions: false` — the schema itself forces
`providesInstructions: false` whenever `trust.level` is `"untrusted"` (see
`schemas/v1/definitions/trust.schema.json`), so item #2 can never be
represented as an authoritative `Instruction` no matter what its text says.
This is the concrete, runnable version of the prompt-injection defense
described in `specification/v1/security.md` and
`specification/v1/precedence.md#3`.

Try it:

```bash
ulcs validate examples/rag/context.json
ulcs compile examples/rag/context.json --target markdown
# Note both resources are wrapped in <untrusted-content> in the output,
# and neither becomes part of the "Instructions" section.
```
