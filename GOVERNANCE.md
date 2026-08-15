# Governance

## Current stage: maintainer-led draft

ULCS is presently in its initial drafting stage. Decisions about the
specification and reference implementation are made by the project's
maintainers, informed by public issue/PR discussion. This is a starting
point, not a permanent structure — see "Path to community governance"
below.

## Decision-making

- **Day-to-day code changes** (bug fixes, tests, docs, non-breaking
  additions): standard PR review by any maintainer.
- **Specification changes** (new/changed fields, types, vocabularies,
  precedence or security semantics): require an
  [ADR](./specification/decisions) documenting the decision and rationale,
  reviewed and merged like any other PR, but held to a higher bar for
  public comment period (at least 5 days open for discussion on
  non-trivial changes) before merging.
- **Breaking changes** to the schema or documented SDK surface: require an
  ADR plus an explicit versioning-policy note in `CHANGELOG.md` (see the
  README's versioning policy).

## Roles

- **Maintainers**: can merge PRs, cut releases, and triage issues. Current
  maintainers are listed via the repository's collaborator list (kept
  outside this document so it doesn't go stale here).
- **Contributors**: anyone who opens an issue or PR. See
  [CONTRIBUTING.md](./CONTRIBUTING.md).

## Path to community governance

As adoption grows, the intent is to move toward a structure similar to
other open specification projects (e.g. a steering committee with
representation from adopting organizations, a public RFC process for
specification changes, and a documented promotion path from
"contributor" → "maintainer"). Concretely, before declaring `1.0.0`:

1. Publish a public RFC process for specification changes (separate from
   ad hoc ADRs), with a defined comment period and explicit
   accept/reject/defer outcomes.
2. Establish a steering group once there are multiple independent
   adopters/implementers, not just the reference implementation's
   authors.
3. Document a trademark/branding policy for "ULCS" if the project reaches
   a scale where that matters.
4. Revisit this document and replace "maintainer-led draft" with the
   agreed structure.

Until then, if you want a say in where ULCS goes, the highest-leverage
thing you can do is open issues/PRs and participate in ADR discussions —
that record is what any future governance body will inherit.

## Code of Conduct

All project spaces are governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
