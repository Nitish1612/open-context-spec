# ULCS examples

Every `context.json` here validates against `schemas/v1/context-envelope.schema.json`
(checked by `tests/conformance` and `scripts/validate-examples.ts`). Each
directory's README explains what it demonstrates and how to run it.

| Directory                                       | Demonstrates                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| [`minimal/`](./minimal)                         | Smallest useful ULCS document (1. minimal QA)                                  |
| [`rag/`](./rag)                                 | Citations + untrusted retrieved text, incl. a prompt-injection sample (2. RAG) |
| [`agent/`](./agent)                             | Tools and tool results (3. agent)                                              |
| [`conversation-memory/`](./conversation-memory) | Long-term memory recalled into a live conversation (4.)                        |
| [`conflicting-facts/`](./conflicting-facts)     | Two sources disagreeing; `mergeContexts` never picks a silent winner (5.)      |
| [`expired-info/`](./expired-info)               | `validUntil`-expired vs. still-valid facts (6.)                                |
| [`security/`](./security)                       | Every sensitivity level/handling rule, and `redactContext` (7.)                |
| [`token-budget/`](./token-budget)               | Tight `tokenPolicy`, priority/relevance-driven selection and truncation (8.)   |
| [`provider-adapters/`](./provider-adapters)     | Pre-generated output from every `@ulcs/adapters` target (9.)                   |
| [`mcp-resource/`](./mcp-resource)               | `toMCPResource` output (10.)                                                   |
| [`ecommerce/`](./ecommerce)                     | Combined, full-featured reference document using nearly every type             |

Quick start:

```bash
pnpm --filter @ulcs/cli build   # once, if you haven't already
ulcs validate examples/minimal/context.json
ulcs compile examples/minimal/context.json --target markdown
```

(Replace `ulcs` with `node packages/cli/dist/bin.js` if you haven't linked
the binary globally.)
