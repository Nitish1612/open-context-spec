# Example: Agent context with tools and tool results

An agent scenario: a `ToolDefinition` describing an available tool, and a
`ToolResult` from a call already made. The tool result is marked
`trust.level: "untrusted"` (tool output defaults to untrusted data, never
instructions — see `specification/v1/vocabulary.md#1`) even though the tool
itself is one the system trusts to call; the _content returned_ is still
external data until validated.

Try it:

```bash
ulcs validate examples/agent/context.json
ulcs compile examples/agent/context.json --target openai
# tools[] becomes an OpenAI-style `tools` array; toolResults[] becomes a
# role:"tool" message keyed by tool_call_id.
```
