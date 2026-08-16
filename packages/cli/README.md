# @ulcs/cli

> **Provisional package and binary name.** Part of the
> [Open Context Specification (OCS)](https://github.com/Nitish1612/open-context-spec),
> drafted under the working name "Universal LLM Context Schema (ULCS)" — see
> [ADR-0004](https://github.com/Nitish1612/open-context-spec/blob/main/specification/decisions/0004-ocs-branding-and-ulcs-migration.md).
> Not yet published to npm; name availability is unverified.

The `ulcs` command-line tool: `validate`, `normalize`, `compile`, `redact`,
`diff`, `patch`. Reads from a file or stdin (`-`), writes to stdout or a
file (`-o`), and uses meaningful exit codes — built for automation
pipelines, not just interactive use.

## Install

Not yet published. From within the monorepo:

```bash
pnpm install
pnpm --filter @ulcs/cli run build
node packages/cli/dist/bin.js --help
```

Or link it globally for a bare `ulcs` command:

```bash
cd packages/cli && npm link
ulcs --help
```

## Usage

```bash
ulcs validate my-context.json
ulcs compile my-context.json --target openai
ulcs compile my-context.json --target anthropic
ulcs compile my-context.json --target gemini
ulcs compile my-context.json --target markdown
ulcs redact my-context.json --policy export
ulcs diff old-context.json new-context.json
ulcs patch my-context.json --patch my-patch.json

# stdin/stdout compose in pipelines:
cat my-context.json | ulcs compile - --target openai | jq .messages
```

Run any command with `--json` where supported for machine-readable output.

## Documentation

Full specification: see the root
[README](https://github.com/Nitish1612/open-context-spec#readme) and
[`specification/`](https://github.com/Nitish1612/open-context-spec/tree/main/specification)
directory in the monorepo.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
