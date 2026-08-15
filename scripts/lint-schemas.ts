/**
 * Loads every ULCS v1 schema document through the same Ajv instance the
 * validator package builds, and compiles the three top-level schemas. This
 * catches broken $ref targets, duplicate $ids, and other structural schema
 * errors that a single-file JSON.parse check would miss.
 */
import {
  getAjv,
  CONTEXT_ENVELOPE_SCHEMA_ID,
  CONTEXT_ITEM_SCHEMA_ID,
  CONTEXT_PATCH_SCHEMA_ID,
} from "@ulcs/validator";

function main() {
  const ajv = getAjv();
  const ids = [CONTEXT_ENVELOPE_SCHEMA_ID, CONTEXT_ITEM_SCHEMA_ID, CONTEXT_PATCH_SCHEMA_ID];
  for (const id of ids) {
    const schema = ajv.getSchema(id);
    if (!schema) {
      throw new Error(`Schema "${id}" did not register/compile.`);
    }
    console.log(`OK  ${id}`);
  }
  console.log(`\n${ids.length} schema(s) compiled successfully.`);
}

main();
