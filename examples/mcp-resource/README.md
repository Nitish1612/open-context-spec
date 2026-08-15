# Example: MCP resource representation

`resource.json` is the result of running the `minimal` example's context
through `toMCPResource` — the MCP-shaped `{ uri, mimeType, text }` content
block described in `specification/v1/interoperability.md#1`. `text` is the
full-fidelity `CompiledContext` JSON, unmodified; an MCP host reading this
resource gets everything ULCS knows about the context, with no information
loss at this layer (unlike the chat-message adapters).

Regenerate:

```bash
ulcs compile examples/minimal/context.json --target mcp \
  -o examples/mcp-resource/resource.json
```

To carry the _raw_, uncompiled `ContextEnvelope` instead (e.g. for an MCP
resource meant to be re-compiled by the receiving host under its own token
policy), call `toMCPResource` from `@ulcs/adapters` directly on a
`ContextEnvelope` rather than a `CompiledContext` — both are supported.
