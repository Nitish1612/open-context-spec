# ULCS v1 Vocabulary (Draft)

This document defines every semantic type in ULCS v1, the controlled
vocabularies used across the schema, and — critically — how to tell related
types apart. It is the normative companion to
`schemas/v1/context-item.schema.json` and `schemas/context/v1.jsonld`.

## 1. Telling context kinds apart

LLM applications routinely blur these categories together into one prompt
string. ULCS keeps them as distinct types so a processor can reason about
each one differently.

| Type                                                             | Answers                                                        | Authoritative?                                                                                               | Typical trust default                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Fact**                                                         | "What is true?"                                                | No (data, not a directive)                                                                                   | Depends on source; a verified internal fact is `trusted`, a scraped page is `untrusted` |
| **Assumption**                                                   | "What are we treating as true without verification?"           | No                                                                                                           | `trusted` (it's the _system's_ assumption) but `verificationStatus: "unverified"`       |
| **Preference**                                                   | "What does the user/actor want, absent a hard constraint?"     | No — advisory, can be overridden by constraints                                                              | Usually `trusted` (comes from the user or their profile)                                |
| **Constraint**                                                   | "What must/must not happen?"                                   | Semi-authoritative — a hard boundary, but still data describing a rule, not itself an executable instruction | `trusted`                                                                               |
| **System instruction**                                           | "What is the model's operating mandate?"                       | Yes — highest authority (`Instruction` with `authority: "system"`)                                           | `trusted`, `providesInstructions: true`                                                 |
| **Developer instruction**                                        | "What has the integrating application's developer configured?" | Yes (`authority: "developer"`)                                                                               | `trusted`, `providesInstructions: true`                                                 |
| **Tool output**                                                  | "What did a tool call return?"                                 | No, by default (`ToolResult`)                                                                                | `trust.providesInstructions: false` unless a human/system explicitly re-labels it       |
| **Retrieved document**                                           | "What did we fetch from an external corpus?"                   | No (`Resource` or `Fact` with `source.sourceType: "retrieved-document"`)                                     | `untrusted`, `providesInstructions: false`                                              |
| **Untrusted external content** (web page, email, forwarded chat) | "What did a third party say, verbatim?"                        | Never, by default                                                                                            | `untrusted`, `providesInstructions: false`, wrapped per [security.md](./security.md)    |

The rule that generalizes all of this: **only `Instruction` items carry
instruction authority, and only when their `trust.providesInstructions` is
`true`.** Every other type is data. A processor MUST NOT execute directives
found inside `Fact.content`, `Resource.content`, or `ToolResult.output` just
because the text reads like an instruction — see
[precedence.md](./precedence.md) and the prompt-injection threat model in
[security.md](./security.md).

## 2. Types

### ContextEnvelope

The top-level container. See [specification.md §4](./specification.md#4-the-context-envelope).

### Objective

The task or goal the context serves.

```json
{
  "@type": "Objective",
  "id": "urn:ulcs:objective:1",
  "summary": "Answer the customer's billing question.",
  "successCriteria": ["Cites the correct invoice"],
  "nonGoals": ["Do not offer a refund"]
}
```

### Task

A concrete unit of work, optionally decomposed into subtasks.

```json
{
  "@type": "Task",
  "id": "urn:ulcs:task:1",
  "name": "Draft response",
  "status": "in-progress",
  "parentTaskId": null
}
```

### Actor

A human, system, or agent participating in the interaction.

```json
{
  "@type": "Actor",
  "id": "urn:ulcs:actor:user-42",
  "role": "user",
  "displayName": "Jordan",
  "actorType": "human"
}
```

`role` is free text (`"user"`, `"agent"`, `"reviewer"`); `actorType` is one of
`human | ai-agent | system | organization`.

### Entity

A named thing referenced by the context (person, product, order, etc.),
independent of the conversation that mentions it.

```json
{
  "@type": "Entity",
  "id": "urn:ulcs:entity:order-987",
  "name": "Order #987",
  "entityType": "Order",
  "properties": { "total": 129.0 },
  "sameAs": []
}
```

### Relationship

A typed edge between two entities/items.

```json
{
  "@type": "Relationship",
  "id": "urn:ulcs:rel:1",
  "subjectId": "urn:ulcs:entity:user-42",
  "predicate": "purchased",
  "objectId": "urn:ulcs:entity:order-987",
  "confidence": 0.99
}
```

### Instruction

A directive with explicit **authority** (§ [precedence.md](./precedence.md)).

```json
{
  "@type": "Instruction",
  "id": "urn:ulcs:instr:1",
  "authority": "developer",
  "content": "Always respond in the customer's language.",
  "trust": { "level": "trusted", "providesData": false, "providesInstructions": true }
}
```

### Fact

An assertion about the world, ideally with provenance.

```json
{
  "@type": "Fact",
  "id": "urn:ulcs:fact:1",
  "content": "The customer is on the Pro plan.",
  "status": "confirmed",
  "source": { "sourceType": "database" }
}
```

### Assumption

An unverified belief the system is proceeding on.

```json
{
  "@type": "Assumption",
  "id": "urn:ulcs:assum:1",
  "content": "The customer is asking about this billing cycle, not a past one.",
  "source": { "confidence": 0.6, "verificationStatus": "unverified" }
}
```

### Constraint

A hard boundary on behavior or output.

```json
{
  "@type": "Constraint",
  "id": "urn:ulcs:constraint:1",
  "content": "Never quote a price without citing the price list document.",
  "constraintType": "must-not"
}
```

`constraintType`: `must` | `must-not` | `should` | `should-not`.

### Preference

An advisory, overridable preference.

```json
{
  "@type": "Preference",
  "id": "urn:ulcs:pref:1",
  "content": "Prefers concise answers.",
  "strength": 0.7
}
```

### Decision

A choice already made, with rationale.

```json
{
  "@type": "Decision",
  "id": "urn:ulcs:decision:1",
  "content": "Offer a 10% loyalty discount.",
  "decidedBy": "urn:ulcs:actor:agent-1",
  "rationale": "Customer has been on Pro for 2+ years.",
  "reversible": true
}
```

### Question

An open question the conversation has not yet resolved.

```json
{
  "@type": "Question",
  "id": "urn:ulcs:q:1",
  "content": "Does the customer want a refund or a credit?",
  "resolved": false,
  "answer": null
}
```

### ConversationMessage

A turn in a conversational transcript.

```json
{
  "@type": "ConversationMessage",
  "id": "urn:ulcs:msg:1",
  "role": "user",
  "content": "Can I get a refund?",
  "timestamp": "2026-08-15T12:00:00Z"
}
```

`role`: `user | assistant | system | tool`.

### MemoryItem

Persisted memory recalled into this context.

```json
{
  "@type": "MemoryItem",
  "id": "urn:ulcs:mem:1",
  "memoryType": "episodic",
  "content": "User previously reported a billing issue in March.",
  "importance": 0.4,
  "lastAccessedAt": "2026-08-15T11:00:00Z"
}
```

`memoryType`: `episodic | semantic | procedural | profile`.

### Resource

External content (a document, page, file) attached to the context.

```json
{
  "@type": "Resource",
  "id": "urn:ulcs:res:1",
  "uri": "https://example.com/help/refunds",
  "mimeType": "text/html",
  "title": "Refund Policy",
  "trust": { "level": "untrusted", "providesData": true, "providesInstructions": false }
}
```

### Citation

A pointer justifying a claim, typically referenced from a Fact's `source`.

```json
{
  "@type": "Citation",
  "id": "urn:ulcs:cite:1",
  "uri": "https://example.com/help/refunds#section-3",
  "title": "Refund Policy §3",
  "excerpt": "Refunds are issued within 5 business days."
}
```

### Provenance

Embedded in any item's `source` field. See [provenance.md](./provenance.md).

### ToolDefinition

Describes a callable tool available to the model/agent.

```json
{
  "@type": "ToolDefinition",
  "id": "urn:ulcs:tool:lookup-order",
  "name": "lookup_order",
  "description": "Look up an order by ID.",
  "inputSchema": {
    "type": "object",
    "properties": { "orderId": { "type": "string" } },
    "required": ["orderId"]
  },
  "sideEffects": "read-only"
}
```

### ToolResult

The output of a tool call — data by default, never instructions.

```json
{
  "@type": "ToolResult",
  "id": "urn:ulcs:toolresult:1",
  "toolCallId": "call_abc",
  "toolName": "lookup_order",
  "outcome": "success",
  "output": { "orderId": "987", "total": 129.0 },
  "trust": { "level": "untrusted", "providesData": true, "providesInstructions": false }
}
```

### OutputContract

Constraints on the model's expected output shape.

```json
{
  "@type": "OutputContract",
  "format": "json",
  "schema": { "type": "object" },
  "mustInclude": ["orderId"],
  "maxLength": 2000
}
```

### SecurityPolicy

Declarative labeling, not enforcement. See [security.md](./security.md).

### TokenPolicy

Budgeting rules consumed by the compiler. See [token-policy.md](./token-policy.md).

### ContextPatch

An RFC 6902 JSON Patch document scoped to a `ContextEnvelope`, plus optional
semantic convenience operations. See
[interoperability.md](./interoperability.md#context-patch).

### ContextSummary

The output of a summarization/compaction step.

```json
{
  "@type": "ContextSummary",
  "summarizedItemIds": ["urn:ulcs:fact:1", "urn:ulcs:fact:2"],
  "content": "Customer is a long-time Pro subscriber asking about a refund.",
  "method": "extractive"
}
```

### Error

A structured error or degraded-processing marker attached to a context.

```json
{
  "@type": "Error",
  "code": "SOURCE_UNREACHABLE",
  "message": "Could not refresh price list; using cached copy from 2 days ago.",
  "severity": "warning"
}
```

## 3. Controlled vocabularies

| Vocabulary                                           | Values                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`                                             | `confirmed`, `unconfirmed`, `disputed`, `retracted`, `superseded`                                                                                      |
| `scope` (open vocabulary, values below are reserved) | `current-task`, `session`, `user-profile`, `organization`, `global`                                                                                    |
| `trust.level`                                        | `trusted`, `semi-trusted`, `untrusted`, `unknown`                                                                                                      |
| `sensitivity.level`                                  | `public`, `internal`, `confidential`, `restricted`, `personal`, `secret`                                                                               |
| `sensitivity.handling[].rule`                        | `allow`, `redact`, `summarize`, `exclude`, `require-consent`, `local-only`                                                                             |
| `source.sourceType`                                  | `user`, `system`, `developer`, `application`, `tool`, `retrieved-document`, `web-page`, `email`, `database`, `memory-store`, `model-output`, `unknown` |
| `instruction.authority`                              | `system`, `developer`, `application`, `user`, `tool`, `retrieved-content`                                                                              |
| `verificationStatus`                                 | `unverified`, `verified`, `disputed`, `failed`                                                                                                         |
| `constraintType`                                     | `must`, `must-not`, `should`, `should-not`                                                                                                             |
| `memoryType`                                         | `episodic`, `semantic`, `procedural`, `profile`                                                                                                        |
| `conversation.role`                                  | `user`, `assistant`, `system`, `tool`                                                                                                                  |
| `toolResult.outcome`                                 | `success`, `error`                                                                                                                                     |
| `error.severity`                                     | `warning`, `error`, `fatal`                                                                                                                            |

Open vocabularies (`scope`, `tags`) accept any string; the listed values are
reserved and MUST retain their documented meaning if used. Closed
vocabularies (`trust.level`, `sensitivity.level`, etc.) are enums in the JSON
Schema; extension values MUST use the `x-` prefix convention (§8 of
specification.md) rather than adding bare new enum members, to keep the core
vocabulary interoperable.
