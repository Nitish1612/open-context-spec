# @ulcs/compiler

> **Provisional package name.** Part of the
> [Open Context Specification (OCS)](https://github.com/Nitish1612/open-context-spec),
> drafted under the working name "Universal LLM Context Schema (ULCS)" — see
> [ADR-0004](https://github.com/Nitish1612/open-context-spec/blob/main/specification/decisions/0004-ocs-branding-and-ulcs-migration.md).
> Not yet published to npm; name availability is unverified.

Deterministic, token-budget-aware compilation of an OCS `ContextEnvelope`
into a provider-neutral `CompiledContext`: filters expired/low-relevance
items, deduplicates, ranks by priority/relevance, then selects items under
a token budget (truncating or summarizing as configured), all with a
pluggable tokenizer.

## Install

Not yet published. From within the monorepo:

```bash
pnpm install
pnpm --filter @ulcs/compiler run build
```

## Usage

```typescript
import { compileContext } from "@ulcs/compiler";
import { normalizeContext } from "@ulcs/core";

const compiled = compileContext(normalizeContext(myContext), {
  tokenPolicyOverrides: { maxContextTokens: 4000, reservedOutputTokens: 500 },
});

console.log(compiled.totalEstimatedTokens, compiled.droppedItems);
```

`compileContext` never mutates its input and produces byte-identical output
for identical input, `asOf` clock, and token policy — see
`specification/v1/token-policy.md` for the exact algorithm.

## Documentation

Full specification: see
[`specification/v1/token-policy.md`](https://github.com/Nitish1612/open-context-spec/blob/main/specification/v1/token-policy.md)
in the monorepo.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
