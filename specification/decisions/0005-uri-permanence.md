# ADR-0005: `https://ulcs.dev/...` is a provisional, unowned identifier namespace

- Status: Accepted
- Date: 2026-08-15

## Context

Every schema `$id`, the JSON-LD `@context` IRI, and the fallback value used
by `createContext` reference the `https://ulcs.dev/...` namespace:

- `schemas/v1/context-envelope.schema.json` → `$id:
"https://ulcs.dev/schemas/v1/context-envelope.schema.json"` (and
  similarly for every other schema document and `definitions/` file)
- `schemas/context/v1.jsonld` is conceptually served at
  `https://ulcs.dev/context/v1`
- `packages/core/src/create.ts` exports `ULCS_JSONLD_CONTEXT =
"https://ulcs.dev/context/v1"` as the default `@context` value
- Every example, fixture, and test document uses this IRI

**This project does not control, own, or host the `ulcs.dev` domain.** No
DNS record, hosting arrangement, or registration has been made or claimed.
The URIs are used exactly the way JSON Schema and JSON-LD conventionally
use `$id`/`@context` values before a document ships: as a stable,
syntactically-valid IRI that identifies the document, whether or not
anything is actually resolvable at that address today.

## Why this can't be silently "fixed"

A `$id` in JSON Schema, and an `@context` IRI in JSON-LD, are not merely
labels — they are the document's identity within the ref-resolution graph.
Two documents with different `$id`s are, formally, different schemas, even
if their content is identical. Consequences of changing them casually:

- Every `$ref` inside `schemas/v1/context-item.schema.json` and
  `context-envelope.schema.json` resolves relative to its own `$id`;
  changing the `$id` scheme (e.g. to a different domain, or to a mutable
  `raw.githubusercontent.com` URL) changes what every relative `$ref`
  resolves to, and must be done consistently across every schema file in
  one atomic change, not incrementally.
- Every `urn:ulcs:*` example and fixture identifier would need to change in
  lockstep with any decision to rename the URN scheme itself (a separate,
  independent decision from the `$id`/`@context` domain — URNs don't
  require DNS ownership at all, unlike HTTPS `$id`s).
- A published, stable `$id` should never change again — clients that cache
  or pin against it would break. This project has not published anything
  yet, which is exactly why this ADR exists _before_ that happens, not
  after.

## Decision

1. `https://ulcs.dev/...` remains the placeholder namespace throughout the
   draft, explicitly labeled **provisional** wherever a reader would
   reasonably need to know it isn't resolvable or owned — the README
   ("Known limitations"), this ADR, and the front matter of
   `specification/v1/specification.md`.
2. **Release blocker for `1.0.0` stable:** this project must control and
   host its schema/context URIs — meaning either register and control a
   domain (`ulcs.dev` or another), or adopt a hosting mechanism it
   controls (see the interim option below) — before declaring a stable
   `1.0.0`. This blocker is tracked in `RELEASING.md`. A `1.0.0` release
   with unowned `$id`s in its schemas would misrepresent document identity
   to anyone who validates against them.
3. **Temporary GitHub-hosted distribution option (documented, not
   adopted):** once this repository is public, its schema files are
   incidentally fetchable via
   `https://raw.githubusercontent.com/Nitish1612/open-context-spec/<ref>/schemas/v1/...`.
   This is a _reference for interim manual fetching only_ — it is **not**
   adopted as the canonical `$id` namespace, because raw GitHub URLs are
   tied to a specific ref/branch (mutable unless pinned to a commit SHA,
   and even then tied to repository location rather than project
   identity) and are not a substitute for a controlled, stable domain.
   Switching `$id`s to it would trade one unowned-but-neutral placeholder
   for a technically-resolvable-but-fragile one, without resolving the
   actual requirement (a stable identity the project controls).
4. Local, network-free validation is unaffected either way: `@ulcs/validator`
   bundles every schema document and resolves `$ref`s from its own package
   contents (see ADR-0006) — it does not fetch `https://ulcs.dev/...` over
   the network, so the domain being unowned does not break validation
   today.

## Consequences

- No claim of ownership of `ulcs.dev`, `open-context-spec.dev`, or any
  other domain is made anywhere in this repository.
- A repository-owner action item exists (`RELEASING.md`) to resolve domain
  control before `1.0.0`.
- `scripts/check-uris.ts` (added alongside this ADR) verifies that every
  `$id`/`$ref`/`@context` value used across `schemas/`, `packages/`, and
  `examples/` is at least _internally consistent_ — the same namespace,
  correctly cross-referenced — without asserting or requiring that the
  namespace is network-resolvable. That is a different, narrower guarantee
  than "the domain is owned and hosted," and the script's own output says
  so explicitly.
