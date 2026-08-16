# @ulcs/adapters

> **Provisional package name.** Part of the
> [Open Context Specification (OCS)](https://github.com/Nitish1612/open-context-spec),
> drafted under the working name "Universal LLM Context Schema (ULCS)" — see
> [ADR-0004](https://github.com/Nitish1612/open-context-spec/blob/main/specification/decisions/0004-ocs-branding-and-ulcs-migration.md).
> Not yet published to npm; name availability is unverified.

Renders a `CompiledContext` (from
[`@ulcs/compiler`](https://github.com/Nitish1612/open-context-spec/tree/main/packages/compiler))
into six provider-neutral request shapes: `toOpenAIMessages`,
`toAnthropicMessages`, `toGeminiContents`, `toGenericChatMessages`,
`toMarkdownPrompt`, `toMCPResource`. Depends on none of the official
provider SDKs — every function returns a plain object you pass into
whichever SDK you use.

## Install

Not yet published. From within the monorepo:

```bash
pnpm install
pnpm --filter @ulcs/adapters run build
```

## Usage

```typescript
import { compileContext } from "@ulcs/compiler";
import { toOpenAIMessages, toAnthropicMessages } from "@ulcs/adapters";

const compiled = compileContext(normalizedContext);

const { messages } = toOpenAIMessages(compiled);
// await openai.chat.completions.create({ model: "gpt-4o", messages });

const { system, messages: turns } = toAnthropicMessages(compiled);
// await anthropic.messages.create({ model: "claude-...", system, messages: turns });
```

Every adapter's return value includes a `notes: string[]` array documenting
exactly what was collapsed or lost for that specific compilation — see
`specification/v1/interoperability.md#4` for the full loss table.

## Documentation

Full specification: see
[`specification/v1/interoperability.md`](https://github.com/Nitish1612/open-context-spec/blob/main/specification/v1/interoperability.md)
in the monorepo.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
