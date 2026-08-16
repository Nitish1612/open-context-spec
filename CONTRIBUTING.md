# Contributing to the Open Context Specification

Thanks for considering a contribution. Open Context Specification (OCS) is
an experimental draft specification plus a TypeScript reference
implementation — contributions to either are welcome. Source identifiers
(`@ulcs/*` packages, the `ulcs` CLI, `urn:ulcs:*`) are provisional
compatibility names inherited from the project's working title; see
[ADR-0004](./specification/decisions/0004-ocs-branding-and-ulcs-migration.md)
before renaming anything.

## Ground rules

- Be respectful; see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Open an issue before starting large or spec-affecting work, so we can
  agree on direction before you invest time.
- Security vulnerabilities: follow [SECURITY.md](./SECURITY.md), not a
  public issue.

## Development setup

Requires Node.js ≥ 18.18 and [pnpm](https://pnpm.io) ≥ 9.

```bash
pnpm install
pnpm run build
pnpm run test
```

Useful scripts (see `package.json`):

```bash
pnpm run typecheck             # tsc --noEmit across all packages
pnpm run lint                  # eslint
pnpm run lint:schemas          # compiles every JSON Schema through Ajv
pnpm run check:uris            # verifies schema/context identifiers are internally consistent
pnpm run check:validator-schemas  # verifies the bundled validator schemas match schemas/v1/
pnpm run sync:validator-schemas   # regenerates the bundled validator schemas
pnpm run format                 # prettier --write
pnpm run test                   # vitest (unit + conformance + interoperability)
pnpm run coverage                # vitest with coverage thresholds
pnpm run validate:examples       # validates every examples/**/context.json
pnpm run test:packages           # packs + installs every package outside the monorepo (requires network access)
pnpm run benchmark               # runs the evaluation harness
pnpm run verify                  # everything above except test:packages, in CI order
```

Run `pnpm run verify` before opening a PR — it's exactly what CI runs.

## Repository structure

See the README's [Architecture](./README.md#architecture) section. In
short: `specification/` is prose, `schemas/` is the normative JSON Schema,
`packages/*` is the TypeScript SDK/CLI, `examples/` and `tests/` back both.

## Making a specification change

Use the **Specification change proposal** issue template — it walks
through problem statement, proposed change, use cases, alternatives,
compatibility/security/adapter impact, migration path, test impact, and
a proposed review period. Fill in every section; an incomplete proposal
just means review starts later, not that it's rejected.

### Classifying a specification change

Every proposal gets classified as one of:

- **Editorial** — spec prose clarification, typo fix, or non-normative
  example change. No schema, type, or behavior change. Lightest review;
  no ADR required, no fixture changes expected.
- **Backward-compatible** — a new optional field, a new allowed
  vocabulary value, or a clarification that doesn't change how any
  existing valid document validates or is interpreted. Requires a
  matching schema/type update and new positive fixtures, but existing
  documents keep validating with the same meaning.
- **Breaking** — changes what an existing document validates as, or
  changes the meaning of an existing field/value. Requires a version
  bump per the README's versioning policy, an explicit migration path,
  and updated fixtures for both the old and new behavior where
  practical.
- **Security-sensitive** — touches trust levels, provenance, redaction/
  sensitivity handling, or instruction-following precedence (see
  `specification/v1/security.md` and `specification/v1/provenance.md`),
  regardless of whether it's otherwise additive or breaking. Gets the
  longest review period and explicit security-impact sign-off before
  merging, since these are the semantics that decide whether untrusted
  content can gain instruction-following weight it shouldn't have.
- **Experimental extension** — a namespaced extension field/value (not a
  core vocabulary addition) meant to be tried before it's proposed for
  the core spec. Lower bar to merge since it doesn't change core
  validation, but should still document what happens when a consumer
  that doesn't understand the extension encounters it.

The classification determines the required review period (suggested in
the template) and whether an ADR is required before merging — see below.

Specification changes (new fields, new types, changed semantics) need:

1. An update to the relevant file(s) under `specification/v1/`.
2. A matching update to `schemas/v1/*.schema.json` and, if it's a
   TypeScript-surface change, `packages/core/src/types.ts`. If you changed
   a schema file, also run `pnpm run sync:validator-schemas` — the bundled
   copy in `packages/validator/schemas/` (see ADR-0006) must stay in sync,
   and `pnpm run check:validator-schemas` in CI will fail otherwise.
3. **An ADR** under `specification/decisions/`, numbered sequentially
   (`NNNN-short-title.md`), following the format of the existing ones:
   Status, Context, Decision, Consequences (and Alternatives considered,
   where relevant). This is required for any change to the envelope
   shape, a controlled vocabulary, or precedence/security semantics — it's
   how we keep a record of _why_, not just _what_.
4. Test coverage: a positive/negative fixture under `tests/fixtures/` if
   it's a schema change, and unit tests in the affected package(s).

Non-breaking additions (new optional fields, new namespaced extension
examples) don't need a version bump; anything that changes existing
required behavior does — see the README's versioning policy.

## Making a code change

- TypeScript, strict mode, no `any` (see `eslint.config.js`).
- Pure functions in `@ulcs/core`/`@ulcs/compiler`: don't mutate arguments,
  return new objects (`deepClone` is available in `@ulcs/core`).
- Add unit tests. `packages/*/tests/` mirrors `packages/*/src/`.
- Keep `@ulcs/core` free of a JSON Schema validator dependency (see
  ADR-0003) — validation-specific logic belongs in `@ulcs/validator`.
- If you touch a provider adapter, update its `notes` output and the
  information-loss table in `specification/v1/interoperability.md` if the
  loss characteristics changed.

## Commit messages

This repository uses [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

`type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`,
`perf`, `build`, `ci`. `scope` is typically a package name (`core`,
`validator`, `compiler`, `adapters`, `cli`) or `spec`/`schema`/`examples`.
Example: `feat(compiler): add per-section relevance override`.

## Pull requests

- Fill in the PR template.
- Keep PRs focused — a spec change and an unrelated refactor should be two
  PRs.
- CI runs `pnpm run verify`; please make sure it's green locally first.

## Release process

Releases follow Semantic Versioning (see the README). Until governance
formally transitions (see [GOVERNANCE.md](./GOVERNANCE.md)), maintainers
cut releases by working through [RELEASING.md](./RELEASING.md)'s
checklist — changelog, version bumps, full verification, packed-package
smoke tests, and package-name/domain-ownership confirmation, in that
order, before any tag or publish.

Pre-1.0, expect breaking changes in minor releases; they're always called
out in the changelog.
