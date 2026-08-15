# ADR-0004: Adopt "Open Context Specification (OCS)" as the project name; migrate `ULCS` identifiers on a deliberate timeline

- Status: Accepted (migration itself is **not yet started** — see Consequences)
- Date: 2026-08-15

## Context

This project was originally drafted under the working name **Universal LLM
Context Schema (ULCS)**, and that name is baked into every layer of the
implementation:

- npm package scope: `@ulcs/core`, `@ulcs/validator`, `@ulcs/compiler`,
  `@ulcs/adapters`, `@ulcs/cli`
- CLI binary name: `ulcs`
- JSON-LD context IRI: `https://ulcs.dev/context/v1`
- JSON Schema `$id` namespace: `https://ulcs.dev/schemas/v1/...`
- URN identifier scheme used throughout every example and fixture:
  `urn:ulcs:context:...`, `urn:ulcs:fact:...`, etc.
- TypeScript exports: `ULCS_JSONLD_CONTEXT`, `ULCS_SCHEMA_VERSION`
- Every occurrence of the string `"ULCS"` across the specification prose,
  README, and ~30 other documents.

The repository has since moved to `Nitish1612/open-context-spec`, and the
project is being introduced publicly under the name **Open Context
Specification (OCS)**. The name and the identifiers now disagree, and that
disagreement needs to be resolved deliberately rather than either (a) left
silently inconsistent, or (b) fixed with a single mechanical find-and-replace
across the repository, which would:

- Break the JSON-LD `@context` and every schema `$id`/`$ref` (these are the
  literal identity of a JSON Schema/JSON-LD document — changing a `$id`
  changes what document it _is_, not just what it's called).
- Invalidate every existing `urn:ulcs:*` identifier in every example,
  fixture, and test.
- Change the public npm scope and CLI binary name before either has ever
  been published, while `@opencontext`/`open-context-spec` npm-scope
  availability has not been verified (see the "no availability claims"
  constraint below).
- Touch dozens of files in one pass with a high chance of corrupting a code
  fence, a URN, or a package specifier along with the prose around it.

## Decision

Adopt a two-tier naming state for this draft phase:

1. **Project identity (human-facing) = "Open Context Specification (OCS)".**
   The README, this specification's front matter, and the core policy
   documents (`CONTRIBUTING.md`, `GOVERNANCE.md`, `SECURITY.md`,
   `CODE_OF_CONDUCT.md`) refer to the project as Open Context Specification
   (OCS) and describe its purpose as a vendor-neutral context
   representation for LLMs, agents, RAG systems, and MCP applications.

2. **Technical identifiers (code-facing) = `ulcs` / `ULCS`, unchanged, and
   explicitly marked provisional.** The npm package scope (`@ulcs/*`), the
   `ulcs` CLI binary, the `urn:ulcs:*` identifier scheme, the
   `https://ulcs.dev/...` schema/context namespace, and TypeScript symbols
   like `ULCS_JSONLD_CONTEXT` are **not renamed in this pass**. They are
   labeled as provisional compatibility identifiers wherever a reader would
   reasonably ask "why does the code say ULCS when the project is called
   OCS?" — primarily the README and this ADR.

3. **Scope of this documentation pass.** The following were updated to the
   OCS name in this pass: `README.md`, this ADR, `CONTRIBUTING.md`,
   `GOVERNANCE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and the front
   matter of `specification/v1/specification.md`. The following
   **intentionally still say "ULCS"** and are a tracked follow-up, not an
   oversight: `specification/v1/vocabulary.md`, `precedence.md`,
   `provenance.md`, `security.md`, `token-policy.md`,
   `interoperability.md`, every file under `examples/`, and
   `benchmark/README.md`. These documents describe the _concrete current
   schema_, whose actual field values, URNs, and `$id`s are `ulcs`-namespaced
   — renaming their prose without renaming those literal values would make
   them _less_ accurate, not more. They will be revisited together with
   Phase 2 of the migration below.

## Migration plan (not yet executed)

A full rename must happen in coordinated phases, each independently
shippable and reversible:

| Phase        | Scope                                                                                                                                                                                                                                                                      | Trigger                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0 (this ADR) | Human-facing project name only                                                                                                                                                                                                                                             | Done                                                                                      |
| 1            | Update the six deep specification documents and all example READMEs to consistently describe the project as OCS while explaining the current `ulcs`-namespaced identifiers inline                                                                                          | Before any `1.0.0-draft` spec tag                                                         |
| 2            | Introduce parallel `@opencontext/*` npm packages (or whatever scope is confirmed available — see below) that re-export `@ulcs/*` unchanged, with `@ulcs/*` marked deprecated in its README/package description                                                             | After npm-scope availability is confirmed (see below) and before first real `npm publish` |
| 3            | Introduce a new JSON-LD context (`https://<confirmed-domain>/context/v1` or an interim GitHub-hosted equivalent — see ADR-0005) that is **additive**: documents may declare either the legacy `https://ulcs.dev/context/v1` or the new context; the validator accepts both | Once a controlled domain/hosting decision is made (ADR-0005)                              |
| 4            | Introduce an `ocs` CLI binary name as an alias, `ulcs` kept working and marked deprecated with a warning                                                                                                                                                                   | Alongside phase 2                                                                         |
| 5            | Flip defaults: new documents/examples generated by the CLI use `ocs`-namespaced identifiers by default; `ulcs`-namespaced identifiers remain valid indefinitely for backward compatibility (schemas must keep accepting both)                                              | At `1.0.0`                                                                                |
| 6            | Deprecation timer starts on the legacy identifiers (`@ulcs/*` packages, `ulcs` binary, `https://ulcs.dev/*` `$id`s) — minimum 12 months' notice before any removal, per semantic versioning discipline                                                                     | At `1.0.0` + announcement                                                                 |

**Every phase above is additive/aliasing, never a breaking replacement in
place** — this is the compatibility planning the "no risky mechanical
rename" constraint calls for. A schema `$id` is a permanent identity; once
published, it is not renamed, only superseded by a new one that the
validator also accepts.

## No availability claims

This ADR does **not** claim that `@opencontext`, `open-context-spec`, any
domain name, or any other identifier proposed above is available,
reserved, or owned by this project. Confirming availability is a release
blocker tracked in `RELEASING.md` and ADR-0005, and is a manual step for
the repository owner — not something this codebase or its automation
attempts to verify or claim.

## Consequences

- Readers encounter `ULCS` in code, package names, and URNs, and `OCS` (or
  "Open Context Specification") in the project's own description of
  itself, until the migration phases above land. This ADR exists
  specifically so that dual state is documented rather than silently
  inconsistent.
- No published artifact, npm package, or DNS record is created or claimed
  by this ADR — it is a naming and sequencing decision only.
- Future contributors must not rename `$id`/`@context`/`urn:ulcs:*` values
  in place; new identifiers are additive per the phase table above.
