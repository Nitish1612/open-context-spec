# Changelog

All notable changes to this project are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/)
(pre-1.0: breaking changes may land in any `0.x` minor release, always
called out below).

## [Unreleased]

### Changed

- Project renamed (human-facing) from "Universal LLM Context Schema
  (ULCS)" to "**Open Context Specification (OCS)**." Code identifiers
  (`@ulcs/*` packages, the `ulcs` CLI, `urn:ulcs:*`, `https://ulcs.dev/...`)
  are unchanged in this release and are documented as provisional
  compatibility identifiers — see
  [ADR-0004](./specification/decisions/0004-ocs-branding-and-ulcs-migration.md).
  The `0.1.0` entry below is left as originally written to accurately
  describe what shipped under that name at the time.
- `ulcs.dev`-based schema `$id`/JSON-LD `@context` identifiers are now
  explicitly documented as provisional, with a temporary GitHub-hosted
  distribution alternative — see
  [ADR-0005](./specification/decisions/0005-uri-permanence.md) and the
  new `pnpm run check:uris` script (no network access required).
- `@ulcs/validator` now bundles its own copies of the JSON Schemas
  (`packages/validator/schemas/`) instead of reading them from the
  monorepo root at runtime, so it validates correctly when installed
  standalone outside this repository — see
  [ADR-0006](./specification/decisions/0006-validator-schema-bundling.md).
  Kept in sync via `pnpm run sync:validator-schemas` /
  `check:validator-schemas`.
- All five publishable packages (`@ulcs/core`, `@ulcs/validator`,
  `@ulcs/compiler`, `@ulcs/adapters`, `@ulcs/cli`) now declare
  `repository`, `bugs`, `homepage`, `keywords`, `engines`, an accurate
  `files` allowlist, and a per-package `README.md`/`LICENSE`.
- CI step ordering fixed so `build` runs before `typecheck` (packages
  that resolve workspace dependencies through `exports`/`types` need the
  `.d.ts` files to exist first), and both install steps now use
  `pnpm install --frozen-lockfile`.

### Added

- `pnpm run test:packages` (`scripts/test-packed-packages.ts`): packs
  every package with `pnpm pack`, installs the tarballs into a temporary
  consumer project outside the monorepo, and verifies imports, type
  declarations, validation, compilation for every provider adapter, and
  the installed CLI — confirming no runtime path depends on the source
  monorepo. Runs in CI after the main test suite.
- `docs/github-setup.md`: manual checklist for repository description,
  topics, labels, Discussions, branch protection, required CI checks,
  private vulnerability reporting, and npm-scope/domain confirmation —
  none of it performed automatically.
- `RELEASING.md`: full release checklist (version selection through
  npm publishing and rollback/deprecation), plus a proposed (not
  executed) `v0.1.0` prerelease plan.
- `SUPPORT.md` and a corrected `.github/ISSUE_TEMPLATE/config.yml`
  (real repository links instead of a generic placeholder).
- The **Specification change proposal** issue template now requires a
  problem statement, use cases, alternatives considered, compatibility/
  security/provider-adapter impact, migration path, test/conformance
  impact, and a proposed review period, and `CONTRIBUTING.md` documents
  the Editorial/Backward-compatible/Breaking/Security-sensitive/
  Experimental-extension classification that determines review depth.

## [0.1.0] - 2026-08-15

Initial draft release of the Universal LLM Context Schema (ULCS).

### Added

- **Specification** (`specification/v1/`): `specification.md`,
  `vocabulary.md`, `precedence.md`, `provenance.md`, `security.md`,
  `token-policy.md`, `interoperability.md`, plus initial ADRs under
  `specification/decisions/`.
- **JSON Schema 2020-12** (`schemas/v1/`): `context-envelope.schema.json`,
  `context-item.schema.json` (25 semantic types), `context-patch.schema.json`,
  and shared `definitions/` (common, provenance, trust, sensitivity).
  Schema-enforces that `trust.level: "untrusted"` implies
  `trust.providesInstructions: false`.
- **JSON-LD context** (`schemas/context/v1.jsonld`).
- **`@ulcs/core`**: canonical TypeScript types; `createContext`,
  `normalizeContext`, `mergeContexts` (never silently overwrites a
  conflicting confirmed fact), `applyContextPatch` (RFC 6902, all-or-
  nothing), `deduplicateContext`, `filterContext`, `rankContext`,
  `redactContext` (enforces `sensitivity.handling` rules), `exportContext`,
  `compareContexts`, and an experimental provenance-signing extension.
- **`@ulcs/validator`**: Ajv 2020-12 validation for envelopes, items, and
  patches, with JSON-Pointer error paths.
- **`@ulcs/compiler`**: deterministic, token-budget-aware `compileContext`
  with a documented section order, truncation/summarization hooks, and a
  pluggable tokenizer.
- **`@ulcs/adapters`**: `toOpenAIMessages`, `toAnthropicMessages`,
  `toGeminiContents`, `toGenericChatMessages`, `toMarkdownPrompt`,
  `toMCPResource` — each returns a provider-neutral object with a `notes`
  array documenting information loss.
- **`@ulcs/cli`** (`ulcs` binary): `validate`, `normalize`, `compile`,
  `redact`, `diff`, `patch` commands with JSON/human output, stdin/stdout
  support, and meaningful exit codes.
- **Examples** (`examples/`): minimal QA, RAG with a live prompt-injection
  sample, agent tools/results, conversation memory, conflicting facts,
  expired information, sensitivity/redaction, token-budget compilation,
  provider-adapter output, MCP resource representation, and a combined
  e-commerce reference document.
- **Tests**: unit tests across all five packages, schema conformance
  fixtures (positive/negative), cross-adapter interoperability checks, and
  example-document validation — all runnable without network access.
- **Benchmark harness** (`benchmark/`): honest, non-accuracy comparison of
  unstructured/basic-JSON/ULCS-normalized/ULCS-compiled representations,
  plus an opt-in, credential-free-by-default interface for live model
  evaluation.
- **Project governance/OSS files**: `LICENSE` (Apache-2.0),
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `GOVERNANCE.md`,
  GitHub issue templates, PR template, and CI workflow.
