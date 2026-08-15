# ADR-0002: License under Apache-2.0

- Status: Accepted
- Date: 2026-08-15

## Context

ULCS is a specification plus reference implementation intended for broad,
vendor-neutral adoption, potentially including commercial SDK
implementations and derivative specifications.

## Decision

License the entire repository (specification text, schemas, and code) under
Apache License 2.0, per the SPDX identifier `Apache-2.0`.

## Rationale

- Apache-2.0 includes an explicit patent grant and termination-on-litigation
  clause, which matters for a specification that vendors may implement
  independently — it reduces patent-troll risk for adopters in a way MIT/BSD
  do not address.
- It is OSI-approved, permissive, and widely accepted by corporate legal
  review processes, minimizing adoption friction.
- Precedent: comparable interoperability specifications and SDKs (e.g. many
  CNCF and OpenTelemetry projects) use Apache-2.0 for the same reasons.

## Alternatives considered

- **MIT**: simpler, but no explicit patent grant.
- **CC-BY-4.0 for the spec, Apache-2.0 for code**: rejected for this draft to
  keep licensing uniform and simple; may be revisited if the specification
  and reference implementation formally separate under a future governance
  model (see GOVERNANCE.md).
