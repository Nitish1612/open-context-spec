import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// See ADR-0006 (specification/decisions/0006-validator-schema-bundling.md):
// schema documents are bundled into this package at ./schemas (checked
// into git, kept in sync with the repository's top-level schemas/v1/ by
// scripts/sync-validator-schemas.ts and verified by `pnpm run
// check:validator-schemas` in CI) so that @ulcs/validator resolves them
// from its own package contents — no repository-relative path, and no
// network access — whether run inside this monorepo or installed
// standalone from a published tarball.
const here = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(here, "../schemas");

function readJson(relativePath: string): object {
  const full = path.join(schemasRoot, relativePath);
  return JSON.parse(readFileSync(full, "utf8")) as object;
}

export const CONTEXT_ENVELOPE_SCHEMA_ID =
  "https://ulcs.dev/schemas/v1/context-envelope.schema.json";
export const CONTEXT_ITEM_SCHEMA_ID = "https://ulcs.dev/schemas/v1/context-item.schema.json";
export const CONTEXT_PATCH_SCHEMA_ID = "https://ulcs.dev/schemas/v1/context-patch.schema.json";

export interface SchemaDocuments {
  common: object;
  provenance: object;
  trust: object;
  sensitivity: object;
  contextItem: object;
  contextEnvelope: object;
  contextPatch: object;
}

export function loadSchemaDocuments(): SchemaDocuments {
  return {
    common: readJson("v1/definitions/common.schema.json"),
    provenance: readJson("v1/definitions/provenance.schema.json"),
    trust: readJson("v1/definitions/trust.schema.json"),
    sensitivity: readJson("v1/definitions/sensitivity.schema.json"),
    contextItem: readJson("v1/context-item.schema.json"),
    contextEnvelope: readJson("v1/context-envelope.schema.json"),
    contextPatch: readJson("v1/context-patch.schema.json"),
  };
}
