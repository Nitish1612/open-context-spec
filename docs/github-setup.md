# GitHub repository setup (manual steps)

This document is a checklist for whoever administers the
`Nitish1612/open-context-spec` GitHub repository. None of these steps are
performed automatically by CI, by any script in this repository, or by an
AI assistant working in this codebase — they require repository-admin
access to the GitHub UI (or the GitHub API with an authenticated,
appropriately-scoped token) and a human decision about timing. This file
only documents what to do and why; it does not do it.

Nothing here should be treated as blocking day-to-day development. It's a
reference for the repository owner to work through once, and to revisit
before the v0.1.0 draft release (see [RELEASING.md](../RELEASING.md)).

## Repository description

Set the repository's "About" description to:

```text
An experimental, vendor-neutral specification for representing context across LLMs, AI agents, RAG systems and MCP applications.
```

Leave the website field blank until a real project site exists — see
"Project website" below.

## Suggested topics

Add these as repository topics (Settings → General → Topics, or the gear
icon next to "About" on the repo home page):

```text
llm
context-engineering
ai-agents
rag
mcp
json-schema
json-ld
open-standard
typescript
interoperability
```

Add only the ones that are actually accurate as the project evolves;
don't add topics implying integrations or endorsements that don't exist
(e.g. don't add a specific vendor's name as a topic).

## Suggested labels

Create (or rename existing default labels to) this set, so issue/PR
triage has consistent vocabulary:

| Label              | Suggested color | Purpose                                                   |
| ------------------ | --------------- | --------------------------------------------------------- |
| `good first issue` | `#7057ff`       | Small, well-scoped, good entry point for new contributors |
| `help wanted`      | `#008672`       | Maintainers want outside help on this                     |
| `specification`    | `#0e8a16`       | Affects `specification/` prose or normative behavior      |
| `schema`           | `#0e8a16`       | Affects `schemas/v1/*.schema.json`                        |
| `sdk`              | `#1d76db`       | Affects `packages/core`, `packages/compiler`, etc.        |
| `adapter`          | `#1d76db`       | Affects a specific provider adapter                       |
| `security`         | `#d93f0b`       | Security- or privacy-relevant                             |
| `documentation`    | `#0075ca`       | README, guides, ADRs, docs-only changes                   |
| `breaking change`  | `#b60205`       | Requires a major/minor version bump per policy            |
| `discussion`       | `#cc317c`       | Open-ended question, not yet a concrete proposal          |
| `bug`              | `#d73a4a`       | Something doesn't work as specified/documented            |
| `enhancement`      | `#a2eeef`       | New capability, non-breaking                              |

Exact hex values are suggestions, not requirements — match whatever
palette the repository already uses if one exists.

## Enable GitHub Discussions

Settings → General → Features → check "Discussions". Once enabled,
update the placeholder/contact-link references in
`.github/ISSUE_TEMPLATE/config.yml` and `SUPPORT.md` if the category
structure differs from what's assumed there (a general Q&A category and
a specification-design category are enough to start).

## Protect the main branch

Settings → Branches → Add branch protection rule for `main`:

- Require a pull request before merging.
- Require status checks to pass before merging — select the CI workflow
  job(s) defined in `.github/workflows/ci.yml` once they've run at least
  once (GitHub only lists jobs that have executed on the repo).
- Require branches to be up to date before merging (optional but
  recommended given the schema/validator sync check in CI).
- Require at least one approving review before merging.
- Disable force pushes to `main`.
- Disable deletion of `main`.
- Consider requiring linear history once there's more than one
  maintainer, to keep `git bisect` and changelog generation simple.

## Require CI before merging

This depends on branch protection above — GitHub only offers a workflow
as a required status check after it has run. Push once, confirm the
`CI` workflow shows up as an available check, then add it as required.

## Require pull-request review

Covered above under branch protection ("require at least one approving
review"). For a single-maintainer repository this can be relaxed
temporarily, but should be enabled before accepting external
contributions at any volume.

## Disable force pushes

Covered above under branch protection. This applies to `main`; feature
branches (including contributors' own branches) are unaffected.

## Configure private vulnerability reporting

Settings → Security → Code security and analysis → enable "Private
vulnerability reporting". This is what makes the
`https://github.com/Nitish1612/open-context-spec/security/advisories/new`
link in `.github/ISSUE_TEMPLATE/config.yml` and `SECURITY.md` actually
work — without it, that link 404s or offers to file a public issue
instead.

## Project website

Do not add a website URL to the repository's "About" section (or to
any badge, README link, or JSON-LD `@context` URI) until a real,
project-controlled site exists at that URL. See
[ADR-0005](../specification/decisions/0005-uri-permanence.md) for why a
placeholder or aspirational domain is worse than no link at all —
schema/context identifiers that later need to change are a breaking
change for every consumer.

## Confirm npm scope and domain ownership before publishing

Before running any `npm publish` (including the first `@ulcs/*` 0.1.0
prerelease — see [RELEASING.md](../RELEASING.md)):

- Confirm the `@ulcs` npm organization/scope is actually owned by
  whoever is publishing, or reserve it first. This repository does not
  assume `@ulcs` is available and does not claim to have reserved it.
- Confirm any domain referenced in schema `$id`/JSON-LD `@context` URIs
  (currently the provisional `ulcs.dev`, see
  [ADR-0005](../specification/decisions/0005-uri-permanence.md)) is
  actually registered and controlled by the project before treating
  those URIs as stable, resolvable identifiers rather than provisional
  labels.
- If either the npm scope or the domain turns out to be unavailable,
  resolve the rename (see
  [ADR-0004](../specification/decisions/0004-ocs-branding-and-ulcs-migration.md))
  before the first non-prerelease publish, not after.

None of the above is performed by this repository's tooling. `pnpm run
check:uris` (see `scripts/check-uris.ts`) checks internal consistency of
identifiers already in the repo; it cannot and does not check domain
registration, DNS resolution, or npm registry availability.
