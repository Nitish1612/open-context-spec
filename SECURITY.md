# Security Policy

## Scope

This policy covers the Open Context Specification (OCS), its JSON Schemas,
and the TypeScript reference implementation (`packages/*`, currently
published under the provisional `@ulcs/*` identifiers — see
[ADR-0004](./specification/decisions/0004-ocs-branding-and-ulcs-migration.md))
in this repository.

Please read `specification/v1/security.md` first: OCS is a **labeling and
data-modeling** standard. It documents a threat model (prompt injection,
instruction-authority confusion, data exfiltration, malicious tool output,
context poisoning, stale memory, forged provenance, oversized-context
denial of service) and gives applications the vocabulary to defend against
it, but it does not itself enforce security beyond what
`redactContext`/schema validation perform on data explicitly passed to
them. A report that OCS "doesn't prevent prompt injection" by itself is
expected behavior, not a vulnerability — see that document for what is and
isn't a security boundary here.

## What counts as a vulnerability report

- A bug in `@ulcs/validator` that lets a document violate a documented,
  schema-enforced invariant (e.g. an `untrusted` item passing validation
  with `providesInstructions: true`).
- A bug in `@ulcs/core`'s `redactContext` that fails to apply an explicit
  `exclude`/`redact`/`local-only` handling rule present in the input data.
- A bug in `@ulcs/compiler` or `@ulcs/adapters` that lets a
  `retrieved-content`-authority or `untrusted` item render into a
  high-authority instruction channel (`system`/`developer`) in any
  adapter's output.
- Supply-chain issues (compromised dependency, malicious code in a
  published package).
- Any other memory-safety, injection, or data-integrity issue in the
  reference implementation.

## Reporting

Please **do not** open a public GitHub issue for a suspected vulnerability.

Instead, use GitHub's private vulnerability reporting for this repository
(Security tab → "Report a vulnerability"), which reaches maintainers
privately. If that is not available to you, open a regular issue titled
"Security contact request" with no vulnerability details, and a maintainer
will follow up with a private channel.

Please include:

- The affected package/version or specification section.
- Steps to reproduce, or a minimal example document.
- Your assessment of impact.

## Response

We aim to acknowledge reports within 5 business days. As a young, draft
project without a formal security team, response and fix timelines are
best-effort; critical issues in the reference implementation will be
prioritized over specification-wording issues.

## Disclosure

We ask reporters to give us a reasonable window to publish a fix before
public disclosure. We will credit reporters (unless you prefer otherwise)
in the release notes for the fix.
