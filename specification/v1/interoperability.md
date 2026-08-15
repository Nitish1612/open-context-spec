# Interoperability (Draft)

## 1. Relationship to adjacent standards

| Standard                                                                               | What it does                                                                                                                               | How ULCS relates                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schema.org**                                                                         | Defines meaning for web entities (Person, Product, Event...) via RDFa/microdata/JSON-LD, for search engines and structured data consumers. | ULCS borrows the "shared vocabulary via JSON-LD" pattern, applied to LLM context instead of web pages. A ULCS `Entity` MAY itself carry `sameAs` links into Schema.org types when useful, but ULCS's core types (Fact, Instruction, Provenance, TrustLabel...) have no Schema.org equivalent — Schema.org has no concept of instruction authority or trust level.                                                 |
| **JSON Schema (2020-12)**                                                              | Validates JSON document structure.                                                                                                         | ULCS _uses_ JSON Schema as its normative validation mechanism (`schemas/v1/*.schema.json`). JSON Schema doesn't define what a "fact" _means_ — ULCS's vocabulary docs do.                                                                                                                                                                                                                                         |
| **JSON-LD**                                                                            | Gives JSON documents unambiguous, linkable semantics via `@context`/`@type`.                                                               | ULCS's canonical form is JSON-LD (`schemas/context/v1.jsonld`); the same document without `@context` processing still validates and is usable as plain JSON — JSON-LD is additive, not required to use the schema.                                                                                                                                                                                                |
| **MCP (Model Context Protocol)**                                                       | Transports context, resources, and tool calls between an AI application and external systems/tools over a client-server protocol.          | ULCS defines _what the content means_, not how it moves. A ULCS `ContextEnvelope` can be serialized as the `text` of an MCP resource (`packages/adapters`' `toMCPResource`), and an MCP `ToolResult` maps naturally onto ULCS's `ToolResult` type. MCP has no opinion on instruction precedence, trust, or token budgeting; ULCS has no opinion on transport, discovery, or capability negotiation. They compose. |
| **RAG frameworks** (LangChain, LlamaIndex, etc.)                                       | Retrieval pipelines that fetch and rank documents, then stuff them into a prompt.                                                          | ULCS gives a RAG pipeline's retrieved documents a standard shape (`Resource`/`Fact` + `Citation` + `trust.level: "untrusted"`) so different retrievers and different prompt-assembly code can interoperate without each inventing its own ad hoc "retrieved chunk" object.                                                                                                                                        |
| **Provider message APIs** (OpenAI `messages`, Anthropic `messages`, Gemini `contents`) | The wire format a specific model API accepts.                                                                                              | ULCS is upstream of these: a `ContextEnvelope` is compiled once, then rendered by a provider adapter into each of these formats. ULCS is not a replacement for any of them and depends on none of their SDKs in `packages/core`.                                                                                                                                                                                  |

## 2. Merge semantics

`mergeContexts(a, b, options)` combines two envelopes:

1. Envelope-level scalar fields (`objective`, `outputContract`, `security`,
   `tokenPolicy`) use `options.envelopeFieldStrategy` (`"prefer-a"` |
   `"prefer-b"` | `"prefer-newer"`, default `"prefer-newer"` by `createdAt`).
2. Item arrays are merged by `id`:
   - An `id` present in only one input is included as-is.
   - An `id` present in both, with **identical** `content` and `@type`, is
     merged (provenance/tags/relationships unioned; the higher `priority`
     wins for the merged item).
   - An `id` present in both with **different** `content` and both items'
     `status` is `"confirmed"` is a **conflict**: both versions are kept in
     the output (the second is retained as message
     `id + "#conflict:" + <hash>` — see the merge implementation for the
     exact rule), and a `ConflictReport` entry is returned alongside the
     merged envelope. **The merged envelope is never returned with one
     confirmed fact silently overwritten by another.** This is a hard
     guarantee, checked by conformance tests.
   - The same `id` used for two different `@type`s is always a conflict,
     regardless of `status`.
3. `mergeContexts` returns `{ merged: ContextEnvelope, conflicts:
ConflictReport[] }`; a conflict is never thrown as an exception, so
   callers can inspect and resolve it (e.g. by presenting both facts to the
   model as a `Question`, or by an explicit `options.conflictStrategy`
   override).

## 3. Context Patch

`ContextPatch` documents are RFC 6902 JSON Patch operations
(`add`/`remove`/`replace`/`move`/`copy`/`test`) with paths relative to the
target `ContextEnvelope`, wrapped with an `id` and optional `targetId`:

```json
{
  "@type": "ContextPatch",
  "id": "urn:ulcs:patch:1",
  "targetId": "urn:ulcs:context:example",
  "operations": [
    { "op": "replace", "path": "/facts/0/status", "value": "retracted" },
    {
      "op": "add",
      "path": "/facts/-",
      "value": { "id": "urn:ulcs:fact:2", "@type": "Fact", "content": "..." }
    }
  ]
}
```

`applyContextPatch(context, patch)` applies operations in order and throws a
descriptive error (with the failing operation's index and JSON Pointer) if
any `test` operation fails or a path is invalid — patches are all-or-nothing,
never partially applied.

## 4. Provider adapters and information loss

Every adapter in `packages/adapters` takes a `CompiledContext` (the output
of `packages/compiler`'s `compileContext`) and returns a plain,
provider-neutral object shaped like that provider's request format — never
an SDK client call. Callers pass the returned object into whichever
official SDK they use.

### Information loss by adapter

| Adapter                 | Collapses                                                                                                                                      | Preserves                                                                                                                       | Loses                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toOpenAIMessages`      | Nothing structurally (5 roles map closely to ULCS's tiers)                                                                                     | `system`/`developer` distinction, `tool` role with `tool_call_id`                                                               | Item-level metadata (priority, trust, sensitivity) is not representable in a `{role, content}` message — it only shaped _which_ items were included and in what order. |
| `toAnthropicMessages`   | `system` + `developer` + `application` instructions into one `system` string (each block labeled with a heading naming its original authority) | Turn structure, tool_use/tool_result blocks                                                                                     | Same per-item metadata loss as above; instruction-tier boundaries become text headings, not structured fields.                                                         |
| `toGeminiContents`      | Same collapse as Anthropic, into `systemInstruction`                                                                                           | `user`/`model` turn structure                                                                                                   | Same as above.                                                                                                                                                         |
| `toGenericChatMessages` | Same collapse as Anthropic (lowest common denominator: `system`/`user`/`assistant`)                                                            | Basic turn order                                                                                                                | Tool-call structure is folded into a labeled `user` block.                                                                                                             |
| `toMarkdownPrompt`      | No roles at all                                                                                                                                | Full section structure as headings, untrusted-content wrapping (§ [security.md §2](./security.md#2-untrusted-content-wrapping)) | No machine-readable role/authority distinction for a downstream parser — by design, this target is for human review or non-chat completion APIs.                       |
| `toMCPResource`         | Nothing                                                                                                                                        | Full-fidelity `ContextEnvelope` JSON (or the `CompiledContext`) as the resource's `text`, with `mimeType: "application/json"`   | Nothing lost at this layer; the MCP host performs whatever further collapse it needs.                                                                                  |

Every adapter's output includes a `notes: string[]` field enumerating the
specific lossy decisions made for that compilation, so callers (and tests)
can inspect exactly what happened rather than relying on this table alone.

## 5. Standards used, not reinvented

JSON; JSON-LD; JSON Schema 2020-12; RFC 3339 timestamps; URI/URN
identifiers; JSON Pointer (RFC 6901); JSON Patch (RFC 6902); SPDX license
identifiers (`Apache-2.0`); Semantic Versioning 2.0.0.
