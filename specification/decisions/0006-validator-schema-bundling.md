# ADR-0006: Bundle JSON Schemas into `@ulcs/validator` as committed, verified files

- Status: Accepted
- Date: 2026-08-15

## Context

ADR-0003 originally had `@ulcs/validator` read schema documents at runtime
from the repository's top-level `schemas/v1/` directory via a relative
path (`../../../schemas` from `packages/validator/src`). That works inside
this monorepo, but breaks the moment the package is installed standalone
from a published tarball: `node_modules/@ulcs/validator/dist/index.js` has
no `../../../schemas` to find, because the monorepo root it was built in
no longer exists on the consumer's machine. This was tracked as a known
limitation blocking real publication.

## Decision

1. **`schemas/v1/` remains the single source of truth** a human edits —
   unchanged from ADR-0003.
2. **`packages/validator/schemas/v1/` is a committed, generated mirror** of
   it, produced by `scripts/sync-validator-schemas.ts` (`pnpm run
sync:validator-schemas`) and verified for staleness by the same script
   in `--check` mode (`pnpm run check:validator-schemas`), which runs in
   `pnpm run verify` and in CI. A stale bundle fails CI loudly rather than
   shipping silently-outdated schemas.
3. **`packages/validator/src/schemas.ts` resolves schemas relative to its
   own package** (`../schemas` from `src/` or the built `dist/` — both are
   one level below the package root, so the same relative path works in
   development and in the built package alike), never from a
   repository-relative path.
4. **`package.json`'s `files` field includes `"schemas"`** alongside
   `"dist"`, so `npm pack`/`npm publish` includes the bundled schema
   documents in the published tarball.
5. **`$id`/`$ref` behavior is preserved exactly.** The bundled files are
   byte-identical copies of the canonical schemas — same `$id` values, same
   relative `$ref`s between them — so Ajv resolves cross-file references
   the same way whether it loaded them from `schemas/v1/` or
   `packages/validator/schemas/v1/`. This is verified directly: `pnpm
--filter @ulcs/validator run build` followed by importing the built
   `dist/index.js` and validating both a passing and a schema-violating
   document exercises the full `$ref` graph (envelope → item →
   definitions) end to end.
6. **No network access is introduced or required.** Schema resolution was
   already local-file-based; bundling only changes _which_ local files are
   read.

## Why a committed mirror instead of a build-time-only copy

A build step that copies `schemas/v1/` into `packages/validator/schemas/`
only when `pnpm run build` runs would work for CI (which now builds before
testing — see the Phase 2 ordering fix) but would silently break `pnpm run
test` on a fresh clone that hasn't been built yet, since
`packages/validator/tests/*.test.ts` import directly from `../src/index.js`
and would find no `packages/validator/schemas/` directory at all. Committing
the mirror, and catching drift with an explicit, CI-enforced check instead
of relying on build ordering, keeps `pnpm run test` (and any other entry
point) working from a clean checkout without an implicit build-first
requirement.

## Consequences

- Contributors who change a schema in `schemas/v1/` must run `pnpm run
sync:validator-schemas` (or let a pre-commit/CI failure remind them) —
  documented in `CONTRIBUTING.md`.
- The repository carries one intentional, verified duplication (7
  small JSON files) in exchange for `@ulcs/validator` being genuinely
  standalone-installable — validated by the packed-package smoke test
  (`pnpm run test:packages`, see `scripts/test-packed-packages.ts`), which
  installs the packed tarball into a directory outside the monorepo and
  validates a passing envelope, a schema-violating envelope, a context
  item, and a context patch, with no monorepo path in reach.
- The "standalone-publishable" limitation previously noted in the README
  is resolved for the validator package specifically; npm-registry
  publication itself is still gated on the separate, unrelated
  package-name-availability blocker (ADR-0004, `RELEASING.md`).
