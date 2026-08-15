# Example: Provider adapter output

The same compiled context, rendered by every adapter in `@ulcs/adapters`.
Pre-generated outputs are checked in below so you can compare them without
running anything, and regenerate them any time with the commands shown.

- [`output.openai.json`](./output.openai.json) — `system`/`developer` roles
  stay distinct; tool results become a `role: "tool"` message.
- [`output.anthropic.json`](./output.anthropic.json) — `system` +
  `developer` + `application` instructions collapse into one `system`
  string, each under its own heading.
- [`output.gemini.json`](./output.gemini.json) — same collapse as
  Anthropic, into `systemInstruction`; `assistant` turns become `model`.
- [`output.generic.json`](./output.generic.json) — lowest common
  denominator: only `system`/`user`/`assistant`.
- [`output.markdown.md`](./output.markdown.md) — full section structure as
  Markdown headings, for human review or non-chat completion APIs.
- [`output.mcp.json`](./output.mcp.json) — full-fidelity `CompiledContext`
  JSON as an MCP resource content block.

Regenerate:

```bash
for target in openai anthropic gemini generic mcp; do
  ulcs compile examples/provider-adapters/context.json --target "$target" \
    -o "examples/provider-adapters/output.$target.json"
done
ulcs compile examples/provider-adapters/context.json --target markdown \
  -o examples/provider-adapters/output.markdown.md
```

See `specification/v1/interoperability.md#4-provider-adapters-and-information-loss`
for exactly what each adapter collapses and loses — every adapter's output
here also carries a `notes` array documenting the lossy decisions it made
for this specific input.
