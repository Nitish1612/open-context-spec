# ADR-0003: Split the SDK into core / validator / compiler / adapters / cli

- Status: Accepted
- Date: 2026-08-15

## Context

The task calls for a TypeScript SDK covering creation, validation,
normalization, merge, patch, dedup, filter, rank, redact, compile, and
export, plus a CLI — and separately asks for `packages/core`,
`packages/validator`, `packages/compiler`, `packages/adapters`,
`packages/cli` as distinct packages.

## Decision

- `@ulcs/core`: pure data-transform algorithms with zero required
  dependency on a JSON Schema validator — `createContext`,
  `normalizeContext`, `mergeContexts`, `applyContextPatch`,
  `deduplicateContext`, `filterContext`, `rankContext`, `redactContext`,
  `exportContext`, plus the canonical TypeScript types.
- `@ulcs/validator`: Ajv-2020-based `validateContext`/`validateItem`,
  depending on `@ulcs/core` for types and on the root `schemas/` directory
  for schema documents.
- `@ulcs/compiler`: `compileContext`, depending on `@ulcs/core` (and
  optionally `@ulcs/validator` only in its own tests, not at runtime).
- `@ulcs/adapters`: provider-neutral renderers (`toOpenAIMessages`, etc.),
  depending on `@ulcs/core` and `@ulcs/compiler` types only.
- `@ulcs/cli`: composes all four into the `ulcs` binary; the only package
  allowed a "big" dependency footprint (an argument parser).

## Rationale

`@ulcs/core` staying Ajv-free means any consumer who trusts their own input
(e.g. output of `createContext`) never pays for a schema validator. Keeping
`@ulcs/compiler` and `@ulcs/adapters` separate means an application that
wants to reimplement compilation (a different budget algorithm) can still
reuse the adapters, and vice versa.

## Consequences

- `@ulcs/validator` reads schema JSON from the repository's top-level
  `schemas/` directory via a relative path from its own package directory
  (`packages/validator/src` → `../../../schemas`). This keeps `schemas/` as
  the single source of truth with zero duplication, at the cost of the
  validator package not yet being standalone-publishable to npm without a
  build step that inlines the schema files. This is recorded as a known
  limitation (see README "Known limitations") to fix before an actual `npm
publish` of `@ulcs/validator`.
