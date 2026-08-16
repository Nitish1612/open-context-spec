/**
 * Verifies that every schema/context identifier used across this
 * repository is *internally consistent* — no network access, no claim
 * that any URI is resolvable or owned (see ADR-0005). Specifically:
 *
 *   1. Every schema document's `$id` is unique and lives under the single
 *      canonical namespace (`https://ulcs.dev/schemas/v1/...`).
 *   2. Every relative `$ref` between schema files resolves, when combined
 *      with the referencing document's own `$id`, to a `$id` that is
 *      actually declared somewhere in the schema set (i.e. no dangling
 *      cross-file references, and no accidental typo'd host/path).
 *   3. `ULCS_JSONLD_CONTEXT` in `@ulcs/core` matches the conventional URI
 *      implied by `schemas/context/v1.jsonld`'s location.
 *   4. No file in the repository references a *different* host for the
 *      schema/context namespace than the single canonical one — catching
 *      accidental typos (`ulcs.io`, `ulcs.dev/schema/` singular, etc.)
 *      that would silently fragment the identifier space.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const CANONICAL_HOST = "ulcs.dev";
const CANONICAL_SCHEMA_PREFIX = `https://${CANONICAL_HOST}/schemas/v1/`;
const CANONICAL_CONTEXT_URI = `https://${CANONICAL_HOST}/context/v1`;

interface SchemaDoc {
  file: string;
  id: string | undefined;
  refs: string[];
}

function findFiles(dir: string, predicate: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage" || entry === ".git")
      continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...findFiles(full, predicate));
    } else if (predicate(entry)) {
      found.push(full);
    }
  }
  return found;
}

function collectRefs(value: unknown, refs: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === "$ref" && typeof val === "string") refs.push(val);
      else collectRefs(val, refs);
    }
  }
}

function loadSchemaDocs(): SchemaDoc[] {
  const schemaFiles = findFiles(path.join(repoRoot, "schemas"), (name) =>
    name.endsWith(".schema.json"),
  );
  return schemaFiles.map((file) => {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { $id?: string };
    const refs: string[] = [];
    collectRefs(parsed, refs);
    return { file, id: parsed.$id, refs };
  });
}

function resolveRef(fromId: string, ref: string): string {
  if (ref.startsWith("#")) return fromId + ref;
  const [target, fragment] = ref.split("#");
  const resolved = new URL(target!, fromId).toString();
  return fragment !== undefined ? `${resolved}#${fragment}` : resolved;
}

function main(): void {
  const errors: string[] = [];
  const relPath = (p: string) => path.relative(repoRoot, p);

  // 1 & 2: schema $id uniqueness and $ref resolution
  const docs = loadSchemaDocs();
  const idsSeen = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.id) {
      errors.push(`${relPath(doc.file)}: missing top-level "$id"`);
      continue;
    }
    if (!doc.id.startsWith(CANONICAL_SCHEMA_PREFIX)) {
      errors.push(
        `${relPath(doc.file)}: $id "${doc.id}" does not start with the canonical prefix "${CANONICAL_SCHEMA_PREFIX}"`,
      );
    }
    const existing = idsSeen.get(doc.id);
    if (existing) {
      errors.push(
        `Duplicate $id "${doc.id}" in both ${relPath(existing)} and ${relPath(doc.file)}`,
      );
    } else {
      idsSeen.set(doc.id, doc.file);
    }
  }

  const declaredIds = new Set(docs.map((d) => d.id).filter((id): id is string => Boolean(id)));
  for (const doc of docs) {
    if (!doc.id) continue;
    for (const ref of doc.refs) {
      if (ref.startsWith("#")) continue; // same-document fragment, not a cross-file reference
      const [targetPath] = ref.split("#");
      if (!targetPath) continue;
      const resolvedId = resolveRef(doc.id, targetPath);
      if (!declaredIds.has(resolvedId)) {
        errors.push(
          `${relPath(doc.file)}: $ref "${ref}" resolves to "${resolvedId}", which is not declared as any schema's $id`,
        );
      }
    }
  }

  // 3: JSON-LD context URI matches the core package's exported constant
  const createTsPath = path.join(repoRoot, "packages/core/src/create.ts");
  const createTsSource = readFileSync(createTsPath, "utf8");
  const contextConstMatch = /ULCS_JSONLD_CONTEXT\s*=\s*"([^"]+)"/.exec(createTsSource);
  if (!contextConstMatch) {
    errors.push(`${relPath(createTsPath)}: could not find 'ULCS_JSONLD_CONTEXT = "..."' to check`);
  } else if (contextConstMatch[1] !== CANONICAL_CONTEXT_URI) {
    errors.push(
      `${relPath(createTsPath)}: ULCS_JSONLD_CONTEXT is "${contextConstMatch[1]}", expected "${CANONICAL_CONTEXT_URI}" (matching schemas/context/v1.jsonld's conventional URI)`,
    );
  }

  // 4: no stray host/path variants of the schema/context namespace anywhere in the repo
  const strayPattern = /https?:\/\/([a-z0-9.-]+)\/(schemas?|context)\/v?\d*/gi;
  const textFiles = findFiles(repoRoot, (name) =>
    /\.(ts|tsx|md|json|jsonld|mjs|yml|yaml)$/.test(name),
  ).filter(
    (f) =>
      !f.includes(`${path.sep}dist${path.sep}`) && !f.includes(`${path.sep}coverage${path.sep}`),
  );

  for (const file of textFiles) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(strayPattern)) {
      const host = match[1];
      if (host !== CANONICAL_HOST) {
        errors.push(
          `${relPath(file)}: references host "${host}" in a schema/context-shaped URL — expected "${CANONICAL_HOST}" (match: "${match[0]}")`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error(`URI consistency check FAILED (${errors.length} issue(s)):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      `\nNote: this check verifies internal consistency only. It does not check, and never claims, that "${CANONICAL_HOST}" is owned or network-resolvable — see specification/decisions/0005-uri-permanence.md.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `URI consistency check passed: ${docs.length} schema document(s), all $ids unique and canonical.`,
  );
  console.log(`ULCS_JSONLD_CONTEXT matches the canonical context URI.`);
  console.log(`No stray host/path variants of the schema/context namespace found.`);
  console.log(
    `\nNote: this is an internal-consistency check only — it does not verify that "${CANONICAL_HOST}" is owned or resolvable. See specification/decisions/0005-uri-permanence.md.`,
  );
}

main();
