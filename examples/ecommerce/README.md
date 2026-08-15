# Example: E-commerce support (combined, full-featured)

A realistic customer-support scenario that exercises nearly every ULCS
type in one document: `Objective`, `Actor`, `Instruction` (two authority
tiers), `Constraint`, `Preference`, `Fact`, `Entity`, `Relationship`,
`Decision`, `Question`, `ToolDefinition`/`ToolResult`, `Resource`,
`ConversationMessage`, `OutputContract`, `SecurityPolicy`, and
`TokenPolicy`.

Use this as a reference for how the pieces fit together in a document big
enough to be realistic, not just a schema-conformance smoke test.

```bash
ulcs validate examples/ecommerce/context.json
ulcs compile examples/ecommerce/context.json --target openai
```
