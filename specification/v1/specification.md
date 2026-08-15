# Open Context Specification v1 (Draft)

> **Status: Experimental community draft.** This is version `1.0.0-draft` of
> the Open Context Specification (OCS), drafted under the working name
> "Universal LLM Context Schema (ULCS)" — the identifiers throughout this
> document and the schemas (`urn:ulcs:*`, `https://ulcs.dev/...`, the
> `@ulcs/*` packages) are provisional compatibility names, not a naming
> inconsistency; see
> [ADR-0004](../decisions/0004-ocs-branding-and-ulcs-migration.md) for the
> migration plan. OCS is an early-stage proposal, not an established
> industry standard. Interfaces described here may change before a `1.0.0`
> stable release. See [STABILITY](#stability-and-versioning) below and the
> repository root [README](../../README.md) for the current maturity
> status.

## 1. Purpose

Large Language Model applications assemble "context" — system prompts,
retrieved documents, tool output, conversation history, user preferences,
memory, and more — from many sources, then flatten it into a single string
or provider-specific message array. That flattening throws away information
that matters for correctness and safety:

- **What is a fact, and what is an instruction?** A retrieved web page and a
  developer's system prompt often end up as indistinguishable text.
- **Who said it, and how much do we trust it?** Provenance and trust are
  usually implicit, if tracked at all.
- **What is safe to forward, and what must be redacted?** Sensitivity labels
  rarely survive the trip from database to prompt.
- **What can be dropped under a token budget, and in what order?** Ad hoc
  truncation is non-deterministic and easy to get wrong.

OCS defines a vendor-neutral, machine-readable schema for representing this
context **before** it is compiled into any specific model's prompt format,
plus a deterministic compiler and a set of provider adapters that perform
that compilation.

## 2. Non-goals

OCS explicitly does **not** claim to:

- Make any model faster, cheaper, or more accurate. Its goals are
  interoperability, reduced prompt ambiguity, reliable context conversion,
  provenance tracking, security labeling, token efficiency, and reproducible
  evaluation — not model intelligence.
- Enforce security policy. OCS labels data (trust levels, sensitivity,
  handling rules); an SDK or host application must act on those labels.
  See [security.md](./security.md).
- Replace Model Context Protocol (MCP), which transports context and tool
  calls between applications and hosts. OCS is a content model that can be
  carried _inside_ an MCP resource, tool result, or prompt. See
  [interoperability.md](./interoperability.md).
- Replace JSON Schema or JSON-LD. OCS _uses_ both: JSON Schema 2020-12 for
  structural validation, JSON-LD for canonical semantic representation.

## 3. Design principles

1. Vendor-neutral and model-independent.
2. Human-readable and machine-readable.
3. JSON-LD is the canonical semantic representation; plain JSON (validated by
   JSON Schema) is an equally valid, non-semantic serialization for
   toolchains that do not need JSON-LD processing.
4. JSON Schema 2020-12 is the normative structural validation mechanism.
5. TypeScript is the reference implementation; the specification is
   language-independent.
6. Extensible without breaking the core standard — see [§8](#8-extensibility).
7. Facts are separated from instructions at the type level.
8. Trusted and untrusted content are distinguishable at the item level.
9. Every context item _may_ carry provenance; nothing requires unprovenanced
   trust.
10. Context items may specify priority, relevance, scope, freshness,
    sensitivity, and token budget participation.
11. Context can be compiled deterministically into provider-specific message
    formats.
12. The specification is useful without any SDK, server, or network
    connection: a hand-written JSON document that validates against the
    schemas is a conformant OCS document.

## 4. The Context Envelope

A **Context Envelope** is the top-level container for a unit of LLM context.

```json
{
  "@context": "https://ulcs.dev/context/v1",
  "@type": "ContextEnvelope",
  "schemaVersion": "1.0.0",
  "id": "urn:ulcs:context:example",
  "createdAt": "2026-08-15T12:00:00Z",
  "objective": {},
  "actors": [],
  "instructions": [],
  "facts": [],
  "assumptions": [],
  "constraints": [],
  "preferences": [],
  "decisions": [],
  "questions": [],
  "conversation": [],
  "resources": [],
  "entities": [],
  "relationships": [],
  "memory": [],
  "tools": [],
  "toolResults": [],
  "outputContract": {},
  "security": {},
  "tokenPolicy": {},
  "summary": null,
  "errors": [],
  "extensions": {}
}
```

This refines the strawman envelope from the OCS proposal in three ways,
recorded as [ADR-0001](../decisions/0001-envelope-shape.md):

- Added `assumptions`, `questions`, `toolResults`, and `errors` arrays, since
  those are first-class semantic types (§6) that need a home in the envelope.
- Added an optional `summary` field of type `ContextSummary`, populated when
  a context has been compacted (see `packages/core`'s `redactContext` and any
  application-level summarization step).
- Every top-level array is optional and defaults to an empty array; only
  `@context`, `@type`, `schemaVersion`, `id`, and `createdAt` are required.

All fields except `@context`, `@type`, and `extensions` are arrays of, or
single instances of, **Context Items** (§5) or envelope-level policy objects
(`outputContract`, `security`, `tokenPolicy`).

## 5. The Context Item base model

Every semantic type in §6 that is not the envelope itself extends a common
base shape:

```json
{
  "id": "urn:ulcs:item:123",
  "@type": "Fact",
  "content": "The customer selected the Pro plan.",
  "status": "confirmed",
  "priority": 80,
  "relevance": 0.95,
  "scope": ["current-task"],
  "validFrom": "2026-08-15T00:00:00Z",
  "validUntil": null,
  "source": {},
  "trust": {},
  "sensitivity": {},
  "tags": [],
  "relationships": [],
  "extensions": {}
}
```

| Field                      | Type                                                 | Meaning                                                                                                                                            |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | URI/URN string                                       | Stable, unique identifier within the envelope. Required.                                                                                           |
| `@type`                    | string                                               | One of the controlled semantic types (§6), or a namespaced extension type (§8). Required.                                                          |
| `content`                  | string                                               | Primary natural-language payload. Some types add structured fields alongside it (§6).                                                              |
| `status`                   | enum                                                 | `confirmed` \| `unconfirmed` \| `disputed` \| `retracted` \| `superseded`. Default `confirmed` for facts/decisions, `unconfirmed` for assumptions. |
| `priority`                 | number 0–100                                         | Compiler inclusion priority; higher survives budget pressure (§ [token-policy.md](./token-policy.md)).                                             |
| `relevance`                | number 0–1                                           | Task relevance score, used for filtering and ranking.                                                                                              |
| `scope`                    | string[]                                             | Controlled vocabulary + free tags: `current-task`, `session`, `user-profile`, `organization`, `global`, or custom.                                 |
| `validFrom` / `validUntil` | RFC 3339 timestamp / null                            | Freshness window. `validUntil: null` means "no known expiry."                                                                                      |
| `source`                   | [Provenance](./provenance.md)                        | Where the content came from.                                                                                                                       |
| `trust`                    | [TrustLabel](./provenance.md#trust-labels)           | Whether the content is trusted to provide data, instructions, both, or neither.                                                                    |
| `sensitivity`              | [SensitivityLabel](./security.md#sensitivity-labels) | Privacy/security classification and handling rules.                                                                                                |
| `tags`                     | string[]                                             | Free-form labels.                                                                                                                                  |
| `relationships`            | RelationshipRef[]                                    | Lightweight `{ "type": string, "targetId": string }` references; full `Relationship` objects live in the envelope's `relationships` array.         |
| `extensions`               | object                                               | Namespaced extension data (§8).                                                                                                                    |

Timestamps use RFC 3339. Identifiers use URI or URN syntax (a `urn:ulcs:*`
scheme is recommended but not required — any absolute URI is valid).

## 6. Semantic types

See [vocabulary.md](./vocabulary.md) for the full controlled vocabulary,
including the distinction between facts, assumptions, preferences, system
instructions, developer instructions, tool outputs, retrieved documents, and
untrusted external content. Defined types:

`ContextEnvelope`, `Objective`, `Task`, `Actor`, `Entity`, `Relationship`,
`Instruction`, `Fact`, `Assumption`, `Constraint`, `Preference`, `Decision`,
`Question`, `ConversationMessage`, `MemoryItem`, `Resource`, `Citation`,
`Provenance`, `ToolDefinition`, `ToolResult`, `OutputContract`,
`SecurityPolicy`, `TokenPolicy`, `ContextPatch`, `ContextSummary`, `Error`.

## 7. Instruction precedence

See [precedence.md](./precedence.md). Summary: `system` > `developer` >
`application` > `user` > `tool` > `retrieved-content`, with an explicit rule
that retrieved/untrusted content is never silently promoted to instruction
authority.

## 8. Extensibility

Unknown fields under a `extensions` object, and `@type` values using a
namespaced prefix (`"x-acme:CustomFact"`), are always legal and MUST be
preserved by conformant processors — validators must not reject them, and
SDKs must round-trip them unchanged. Namespaces follow the pattern
`x-<reverse-dns-or-slug>:<TypeName>` to avoid collisions. This is the only
sanctioned extension mechanism for the core standard; forking core arrays or
renaming core fields is non-conformant.

## 9. Context operations

The reference SDK implements the following deterministic operations, defined
precisely in the package READMEs and exercised by conformance tests:

`create`, `validate`, `normalize`, `merge`, `patch`, `deduplicate`, `filter`,
`rank`, `redact`, `summarize` (pluggable hook), `compile`, `export`,
`compare` (`diff`), and an experimental `sign` / `verify` extension for
provenance (see [provenance.md](./provenance.md#experimental-signing)).

Merge and patch semantics are specified in
[interoperability.md](./interoperability.md#merge-semantics); in particular,
**a confirmed fact is never silently overwritten by a conflicting confirmed
fact** — conflicts are always surfaced as data.

## 10. Compilation

`compileContext` deterministically selects and orders context items under an
approximate token budget, then a **provider adapter** renders the compiled,
provider-neutral structure into a request-ready (but SDK-independent) object
for OpenAI-style, Anthropic-style, Gemini-style, generic chat, Markdown, or
MCP-resource targets. See [token-policy.md](./token-policy.md) and
[interoperability.md](./interoperability.md).

```text
Application data
      ↓
OCS semantic context
      ↓
Validation, security policy and token compilation
      ↓
Provider adapter
      ↓
OpenAI / Claude / Gemini / local model / MCP host
```

## 11. Conformance

A document is **schema-conformant** if it validates against
`schemas/v1/context-envelope.schema.json`. A processor is
**spec-conformant** if it: preserves unknown `extensions` fields and
namespaced `@type`s; never treats an item with `trust.providesInstructions:
false` as an instruction; never silently discards a `status: "confirmed"`
item in favor of a conflicting one during merge; and produces the same
compiled output for the same input, token policy, and clock value
(determinism). The conformance test suite in `tests/conformance/` checks all
of the above against the schemas and the reference TypeScript
implementation.

## Stability and versioning

This is a **draft** specification. `schemaVersion` in documents and the
package `version` fields follow [Semantic Versioning](https://semver.org/):

- `0.x.y` (current): breaking changes may land in any `0.x` minor release,
  documented in `CHANGELOG.md` and, for schema-shape changes, an ADR under
  `specification/decisions/`.
- `1.0.0`: first stable release. After `1.0.0`, breaking changes to the
  schemas or the documented SDK surface require a major version bump.

See the repository [README](../../README.md#versioning-policy) for the full
policy and roadmap toward a community-governed `1.0.0`.
