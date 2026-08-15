import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import {
  CONTEXT_ENVELOPE_SCHEMA_ID,
  CONTEXT_ITEM_SCHEMA_ID,
  CONTEXT_PATCH_SCHEMA_ID,
  loadSchemaDocuments,
} from "./schemas.js";

export interface ValidationError {
  /** JSON Pointer (RFC 6901) to the offending location; "" means the document root. */
  path: string;
  message: string;
  keyword: string;
  params: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

let ajvSingleton: Ajv2020 | undefined;

/**
 * Lazily builds and memoizes the Ajv 2020-12 instance with every ULCS v1
 * schema document registered. `strict: false` is intentional — this
 * schema set uses `unevaluatedProperties` over `allOf` compositions and
 * `if`/`then` conditionals extensively, which triggers several of Ajv's
 * "strict mode" advisory warnings that are not actual problems here; see
 * specification/decisions/0003-package-boundaries.md.
 */
export function getAjv(): Ajv2020 {
  if (ajvSingleton) return ajvSingleton;
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  const docs = loadSchemaDocuments();
  for (const doc of [
    docs.common,
    docs.provenance,
    docs.trust,
    docs.sensitivity,
    docs.contextItem,
    docs.contextEnvelope,
    docs.contextPatch,
  ]) {
    ajv.addSchema(doc);
  }
  ajvSingleton = ajv;
  return ajv;
}

function toValidationErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath,
    message: error.message ?? "invalid",
    keyword: error.keyword,
    params: error.params as Record<string, unknown>,
  }));
}

function runValidator(schemaId: string, document: unknown): ValidationResult {
  const ajv = getAjv();
  const validateFn = ajv.getSchema(schemaId) as ValidateFunction | undefined;
  /* v8 ignore start -- defensive: unreachable via the exported validateContext/Item/Patch functions, which only ever pass the three schema-id constants registered by getAjv() above. */
  if (!validateFn) {
    throw new Error(`No schema registered for id "${schemaId}"`);
  }
  /* v8 ignore stop */
  const valid = validateFn(document) === true;
  return { valid, errors: valid ? [] : toValidationErrors(validateFn.errors) };
}

/** Validates a document against the ContextEnvelope schema. */
export function validateContext(document: unknown): ValidationResult {
  return runValidator(CONTEXT_ENVELOPE_SCHEMA_ID, document);
}

/** Validates a single ContextItem (any of the semantic item types) against the schema. */
export function validateContextItem(document: unknown): ValidationResult {
  return runValidator(CONTEXT_ITEM_SCHEMA_ID, document);
}

/** Validates a ContextPatch document against the schema. */
export function validateContextPatch(document: unknown): ValidationResult {
  return runValidator(CONTEXT_PATCH_SCHEMA_ID, document);
}

/** Formats validation errors as human-readable lines, e.g. for CLI output. */
export function formatValidationErrors(errors: ValidationError[]): string[] {
  return errors.map((error) => `${error.path || "(root)"}: ${error.message} [${error.keyword}]`);
}
