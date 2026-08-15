/**
 * Validates every example ContextEnvelope document against the ULCS v1
 * schema and exits non-zero if any fail. Mirrors
 * tests/conformance/examples.test.ts but as a standalone CI-friendly
 * script with readable console output.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatValidationErrors, validateContext } from "@ulcs/validator";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(here, "../examples");

function findContextFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...findContextFiles(full));
    } else if (/^context(-[a-z]+)?\.json$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function main() {
  const files = findContextFiles(examplesRoot);
  if (files.length === 0) {
    console.error(`No example context.json files found under ${examplesRoot}`);
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const file of files) {
    const relative = path.relative(examplesRoot, file);
    const document = JSON.parse(readFileSync(file, "utf8"));
    const result = validateContext(document);
    if (result.valid) {
      console.log(`OK    examples/${relative}`);
    } else {
      failures++;
      console.error(`FAIL  examples/${relative}`);
      for (const line of formatValidationErrors(result.errors)) {
        console.error(`        ${line}`);
      }
    }
  }

  console.log(`\n${files.length - failures}/${files.length} example documents valid.`);
  if (failures > 0) process.exitCode = 1;
}

main();
