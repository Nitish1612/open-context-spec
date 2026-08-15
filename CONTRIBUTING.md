# Contributing to ULCS

Thanks for considering a contribution. ULCS is a draft specification plus a
TypeScript reference implementation — contributions to either are welcome.

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
pnpm run typecheck        # tsc --noEmit across all packages
pnpm run lint              # eslint
pnpm run lint:schemas      # compiles every JSON Schema through Ajv
pnpm run format             # prettier --write
pnpm run test               # vitest (unit + conformance + interoperability)
pnpm run coverage            # vitest with coverage thresholds
pnpm run validate:examples   # validates every examples/**/context.json
pnpm run benchmark            # runs the evaluation harness
pnpm run verify                # everything above, in CI order
```

Run `pnpm run verify` before opening a PR — it's exactly what CI runs.

## Repository structure

See the README's [Architecture](./README.md#architecture) section. In
short: `specification/` is prose, `schemas/` is the normative JSON Schema,
`packages/*` is the TypeScript SDK/CLI, `examples/` and `tests/` back both.

## Making a specification change

Specification changes (new fields, new types, changed semantics) need:

1. An update to the relevant file(s) under `specification/v1/`.
2. A matching update to `schemas/v1/*.schema.json` and, if it's a
   TypeScript-surface change, `packages/core/src/types.ts`.
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
cut releases by:

1. Updating `CHANGELOG.md` (Keep a Changelog format) under a new version
   heading.
2. Bumping affected `package.json` versions.
3. Tagging `vX.Y.Z` and publishing via CI once package names are confirmed
   available (see README "Known limitations").

Pre-1.0, expect breaking changes in minor releases; they're always called
out in the changelog.
