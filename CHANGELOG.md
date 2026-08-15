# Changelog

All notable changes to this project are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/)
(pre-1.0: breaking changes may land in any `0.x` minor release, always
called out below).

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
