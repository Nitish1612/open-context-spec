# Releasing

This document is the release checklist for Open Context Specification
(OCS) / ULCS packages. It is a checklist and a set of commands, not an
automation script — releases are cut by a maintainer running these steps
by hand (or reviewing them in a PR) until governance formalizes further
(see [GOVERNANCE.md](./GOVERNANCE.md)).

No step in this document creates a git tag, a GitHub release, or an npm
publish. Those are called out explicitly below as manual, deliberate
actions a maintainer takes only after every prior step is green and every
blocker is resolved or consciously accepted.

## Before you start: release blockers

These must be resolved (or explicitly accepted as known limitations in
the release notes) before any non-prerelease publish:

- **Package naming.** All packages currently publish under the `@ulcs`
  npm scope (working-title identifiers — see
  [ADR-0004](./specification/decisions/0004-ocs-branding-and-ulcs-migration.md)).
  Confirm the `@ulcs` scope is actually owned by whoever is publishing,
  or complete the rename to a confirmed-available scope first. Do not
  publish under a scope you don't control.
- **Domain/URI ownership.** Schema `$id` values and the JSON-LD
  `@context` URI currently use the provisional `ulcs.dev` domain (see
  [ADR-0005](./specification/decisions/0005-uri-permanence.md)). Confirm
  the domain is registered and controlled by the project — or switch to
  a GitHub-hosted distribution URI per ADR-0005 — before treating those
  identifiers as stable/resolvable rather than provisional labels.
- See [docs/github-setup.md](./docs/github-setup.md) for the related
  repository-configuration checklist (branch protection, CI required
  checks, private vulnerability reporting) that should be in place
  before the repository is treated as a public release target.

## Release checklist

Run every step below from a clean clone or a clean working tree
(`git status` shows nothing to commit). Stop and fix at the first
failure — don't skip ahead.

### 1. Version selection

Decide the version per [Semantic Versioning](https://semver.org/) and
the README's versioning policy (pre-1.0: breaking changes are allowed in
minor releases, always called out in the changelog). Check
[CHANGELOG.md](./CHANGELOG.md)'s `[Unreleased]` section for what's
actually shipping.

### 2. Update the changelog

Move the `[Unreleased]` entries in `CHANGELOG.md` under a new
`## [X.Y.Z] - YYYY-MM-DD` heading (Keep a Changelog format). Don't
invent entries — every line should trace to an actual merged change.

### 3. Bump package versions

Update `version` in the root `package.json` and in each of
`packages/{core,validator,compiler,adapters,cli}/package.json` to the
new version. Keep them in lockstep for now (no independent per-package
versioning yet).

### 4. Clean dependency install

```bash
pnpm install --frozen-lockfile
```

Fails if `pnpm-lock.yaml` is out of sync with any `package.json` — fix
the lockfile (`pnpm install`, then commit the diff) before continuing.

### 5. Formatting

```bash
pnpm run format:check
```

### 6. Linting

```bash
pnpm run lint
```

### 7. Build

```bash
pnpm run build
```

### 8. Typecheck

```bash
pnpm run typecheck
```

### 9. Tests

```bash
pnpm run test
```

### 10. Coverage

```bash
pnpm run coverage
```

Confirm coverage has not regressed below the last recorded baseline
(tracked informally in CI output/PR descriptions — see
[CONTRIBUTING.md](./CONTRIBUTING.md)).

### 11. Schema compilation

```bash
pnpm run lint:schemas
```

Compiles every JSON Schema under `schemas/v1/` through Ajv2020 and
confirms `$id`/`$ref` resolution.

### 12. Example validation

```bash
pnpm run validate:examples
```

Validates every `examples/**/context.json` against the schemas.

### 13. URI consistency check

```bash
pnpm run check:uris
```

Confirms schema `$id`/JSON-LD `@context` identifiers are internally
consistent (see [ADR-0005](./specification/decisions/0005-uri-permanence.md)).
This does **not** check domain registration or resolvability — see
"Release blockers" above.

### 14. Validator schema bundle sync

```bash
pnpm run check:validator-schemas
```

Confirms the schemas bundled into `packages/validator/schemas/` (see
[ADR-0006](./specification/decisions/0006-validator-schema-bundling.md))
match `schemas/v1/`. If this fails, run
`pnpm run sync:validator-schemas` and re-run the build/test steps above.

### 15. Packed-package smoke tests

```bash
pnpm run test:packages
```

Packs every package with `pnpm pack`, installs the tarballs into a
throwaway consumer project outside the monorepo, and exercises imports,
TypeScript declarations, validation, compilation for every provider
adapter, and the installed CLI. Requires network access (npm registry).
This is the closest thing to a dry run of what a real `npm install
@ulcs/...` consumer would experience — do not skip it.

### 16. Security review

- Re-read [SECURITY.md](./SECURITY.md) and confirm nothing in this
  release changes trust/provenance/precedence semantics without a
  corresponding ADR and updated `specification/v1/security.md`.
- Confirm no secrets, tokens, or credentials are present in the diff
  (`git diff` against the previous tag/release).
- Confirm the "security labels don't enforce security by themselves"
  caveat in the README still accurately describes the current
  implementation.

### 17. Package-name verification

For each package about to be published, confirm the name is actually
available (or already owned by this project) on the npm registry:

```bash
npm view @ulcs/core
npm view @ulcs/validator
npm view @ulcs/compiler
npm view @ulcs/adapters
npm view @ulcs/cli
```

A `404`/"not found" response means the name is unclaimed (available, not
already reserved by someone else) — it does not by itself mean you have
rights to it if it collides with an existing trademark. If any of these
already resolves to a package you do not control, stop and resolve the
naming conflict (see [ADR-0004](./specification/decisions/0004-ocs-branding-and-ulcs-migration.md))
before publishing.

### 18. Domain-control verification

Confirm control of any domain referenced in schema `$id`/JSON-LD
`@context` URIs (currently the provisional `ulcs.dev` — see
[ADR-0005](./specification/decisions/0005-uri-permanence.md)) via WHOIS
or your registrar dashboard, or confirm the release instead uses the
GitHub-hosted distribution URI documented in ADR-0005. Do not publish a
release whose schema identifiers point at a domain nobody on the project
controls.

### 19. Tag creation (manual, maintainer-only)

**This is not run as part of routine verification.** Once every step
above is green and every blocker is resolved or consciously accepted in
the release notes:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

### 20. GitHub prerelease creation (manual, maintainer-only)

Create a GitHub release from the pushed tag, marked **prerelease** for
any `0.x` version, with release notes copied from the corresponding
`CHANGELOG.md` section. Do this through the GitHub UI or `gh release
create vX.Y.Z --prerelease --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md)`
adjusted for the actual heading — do not automate this without a human
reviewing the generated notes first.

### 21. npm publishing (manual, maintainer-only)

From a clean tree, after the tag is pushed:

```bash
pnpm -r --filter=./packages/* publish --access public --no-git-checks
```

Publish only after step 17 (package-name verification) and step 18
(domain-control verification) have been explicitly confirmed for this
release. For a `0.x` prerelease, consider `--tag next` instead of the
default `latest` dist-tag so `npm install @ulcs/core` doesn't default
early adopters onto a pre-1.0 draft:

```bash
pnpm -r --filter=./packages/* publish --access public --no-git-checks --tag next
```

### 22. Rollback / deprecation procedure

If a published version turns out to be broken or was published in
error:

- **Do not delete/unpublish** if the package has been up for more than a
  few minutes and could already be depended on — npm's unpublish policy
  also restricts this after 72 hours. Prefer `npm deprecate`:

  ```bash
  npm deprecate @ulcs/core@X.Y.Z "Broken release, use X.Y.(Z+1) instead"
  ```

- Publish a fixed patch version immediately after deprecating.
- Mark the corresponding GitHub release as broken in its notes (edit the
  release, don't delete it) and note the deprecation in
  `CHANGELOG.md` under the affected version's entry.
- If the issue is security-relevant, follow
  [SECURITY.md](./SECURITY.md)'s advisory process in parallel.

## Automated equivalent of steps 4-16

For local verification without walking through each step by hand:

```bash
pnpm install --frozen-lockfile
pnpm run verify        # steps 5-14
pnpm run test:packages # step 15
```

`pnpm run verify` intentionally excludes `test:packages` (it requires
network access to the npm registry and is slower) — run it separately as
shown above before a release, and it also runs in CI after the main
`verify` job.

## Proposed first release: v0.1.0 — Initial Public Draft

This is a **proposal**, not an action taken by this document or any
tooling in this repository. **No tag or release has been created.** The
following is the recommended plan for whoever administers the repository
to execute once ready:

- **Version:** `v0.1.0` (already the version in every `package.json`;
  no bump needed for the very first release).
- **Type:** GitHub **prerelease**, npm published with `--tag next`
  (not `latest`) — see steps 20-21 above. This release marks OCS/ULCS as
  an experimental community draft, not a stable, adopt-in-production
  specification.
- **Prerequisites specific to this release:**
  - Resolve or explicitly accept the naming blocker (`@ulcs` scope
    ownership — [ADR-0004](./specification/decisions/0004-ocs-branding-and-ulcs-migration.md))
    and the URI blocker (`ulcs.dev` domain control —
    [ADR-0005](./specification/decisions/0005-uri-permanence.md)). If
    neither is resolved yet, the release notes must say so plainly under
    "Known limitations", matching the README.
  - Complete the manual GitHub repository setup in
    [docs/github-setup.md](./docs/github-setup.md) (branch protection,
    required CI check, private vulnerability reporting) so the
    repository is in a reviewable, protected state before external users
    arrive from the release announcement.
  - Run the full checklist above (steps 1-18) with zero skipped steps.
- **Release notes** should draw from `CHANGELOG.md`'s `[Unreleased]`
  section and explicitly restate the README's "Known limitations" and
  "Roadmap to 1.0" sections so GitHub release notifications carry the
  same caveats as the README, not just a feature list.
