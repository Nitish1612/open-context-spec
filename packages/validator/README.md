# @ulcs/validator

> **Provisional package name.** This package implements schema validation
> for the [Open Context Specification (OCS)](https://github.com/Nitish1612/open-context-spec),
> drafted under the working name "Universal LLM Context Schema (ULCS)" — see
> [ADR-0004](https://github.com/Nitish1612/open-context-spec/blob/main/specification/decisions/0004-ocs-branding-and-ulcs-migration.md).
> Not yet published to npm; name availability is unverified.

JSON Schema 2020-12 validation (via [Ajv](https://ajv.js.org/)) for OCS
`ContextEnvelope`, `ContextItem`, and `ContextPatch` documents, with
JSON-Pointer error paths.

Every schema document is bundled directly into this package (see
[ADR-0006](https://github.com/Nitish1612/open-context-spec/blob/main/specification/decisions/0006-validator-schema-bundling.md))
— validation works fully offline, with no dependency on the monorepo it was
built from and no network access.

## Install

Not yet published. From within the monorepo:

```bash
pnpm install
pnpm --filter @ulcs/validator run build
```

## Usage

```typescript
import { validateContext, validateContextItem, validateContextPatch } from "@ulcs/validator";

const result = validateContext({
  "@context": "https://ulcs.dev/context/v1",
  "@type": "ContextEnvelope",
  schemaVersion: "1.0.0",
  id: "urn:ulcs:context:example",
  createdAt: "2026-08-15T12:00:00Z",
});

if (!result.valid) {
  for (const error of result.errors) {
    console.error(`${error.path || "(root)"}: ${error.message}`);
  }
}
```

`validateContext`, `validateContextItem`, and `validateContextPatch` each
return `{ valid: boolean; errors: ValidationError[] }`, where every
`ValidationError.path` is a JSON Pointer (RFC 6901) into the document.

## API

- `validateContext(document: unknown): ValidationResult`
- `validateContextItem(document: unknown): ValidationResult`
- `validateContextPatch(document: unknown): ValidationResult`
- `formatValidationErrors(errors: ValidationError[]): string[]` — human-readable one-line-per-error formatting
- `getAjv(): Ajv2020` — the underlying, memoized Ajv instance, for advanced use
- `CONTEXT_ENVELOPE_SCHEMA_ID`, `CONTEXT_ITEM_SCHEMA_ID`, `CONTEXT_PATCH_SCHEMA_ID` — the registered schema `$id`s
- `loadSchemaDocuments(): SchemaDocuments` — the raw, parsed schema JSON documents bundled in this package

## Documentation

Full specification: see the
[`specification/`](https://github.com/Nitish1612/open-context-spec/tree/main/specification)
and [`schemas/`](https://github.com/Nitish1612/open-context-spec/tree/main/schemas)
directories in the monorepo.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
