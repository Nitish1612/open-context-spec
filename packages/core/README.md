# @ulcs/core

> **Provisional package name.** Part of the
> [Open Context Specification (OCS)](https://github.com/Nitish1612/open-context-spec),
> drafted under the working name "Universal LLM Context Schema (ULCS)" — see
> [ADR-0004](https://github.com/Nitish1612/open-context-spec/blob/main/specification/decisions/0004-ocs-branding-and-ulcs-migration.md).
> Not yet published to npm; name availability is unverified.

Canonical TypeScript types and deterministic algorithms for OCS context
documents: `createContext`, `normalizeContext`, `mergeContexts`,
`applyContextPatch`, `deduplicateContext`, `filterContext`, `rankContext`,
`redactContext`, `exportContext`, `compareContexts`. Strict TypeScript, no
`any`, no runtime dependency on a JSON Schema validator (see
[`@ulcs/validator`](https://github.com/Nitish1612/open-context-spec/tree/main/packages/validator)
for that).

## Install

Not yet published. From within the monorepo:

```bash
pnpm install
pnpm --filter @ulcs/core run build
```

## Usage

```typescript
import { createContext, normalizeContext, mergeContexts } from "@ulcs/core";

const ctx = createContext({
  facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "The customer is on the Pro plan." }],
});

const normalized = normalizeContext(ctx);
```

Every function is pure: none of them mutate their arguments, and (aside
from `createContext`'s ID generation) all are deterministic — the same
input always produces the same output.

## Documentation

Full specification and vocabulary: see the
[`specification/`](https://github.com/Nitish1612/open-context-spec/tree/main/specification)
directory in the monorepo, and the root
[README](https://github.com/Nitish1612/open-context-spec#readme).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
