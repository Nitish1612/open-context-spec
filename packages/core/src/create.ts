import { generateId } from "./ids.js";
import { deepClone } from "./clone.js";
import type { ContextEnvelope } from "./types.js";

export const ULCS_JSONLD_CONTEXT = "https://ulcs.dev/context/v1";
export const ULCS_SCHEMA_VERSION = "1.0.0";

export type CreateContextInput = Partial<Omit<ContextEnvelope, "@type">>;

export interface CreateContextOptions {
  /** Injectable clock for deterministic tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Creates a new, schema-shaped ContextEnvelope, filling in required
 * defaults (`@context`, `@type`, `schemaVersion`, `id`, `createdAt`) and
 * empty arrays for every item collection that wasn't supplied. Does not
 * mutate `input`.
 *
 * ID generation is the one non-deterministic part (see ids.ts); everything
 * else is a pure function of `input` and `options.now`.
 */
export function createContext(
  input: CreateContextInput = {},
  options: CreateContextOptions = {},
): ContextEnvelope {
  const now = options.now ?? (() => new Date());
  const clone = deepClone(input);

  const envelope: ContextEnvelope = {
    "@context": clone["@context"] ?? ULCS_JSONLD_CONTEXT,
    "@type": "ContextEnvelope",
    schemaVersion: clone.schemaVersion ?? ULCS_SCHEMA_VERSION,
    id: clone.id ?? generateId("context"),
    createdAt: clone.createdAt ?? now().toISOString(),
    ...(clone.updatedAt !== undefined ? { updatedAt: clone.updatedAt } : {}),
    ...(clone.objective !== undefined ? { objective: clone.objective } : {}),
    actors: clone.actors ?? [],
    instructions: clone.instructions ?? [],
    facts: clone.facts ?? [],
    assumptions: clone.assumptions ?? [],
    constraints: clone.constraints ?? [],
    preferences: clone.preferences ?? [],
    decisions: clone.decisions ?? [],
    questions: clone.questions ?? [],
    conversation: clone.conversation ?? [],
    resources: clone.resources ?? [],
    entities: clone.entities ?? [],
    relationships: clone.relationships ?? [],
    memory: clone.memory ?? [],
    tools: clone.tools ?? [],
    toolResults: clone.toolResults ?? [],
    ...(clone.outputContract !== undefined ? { outputContract: clone.outputContract } : {}),
    ...(clone.security !== undefined ? { security: clone.security } : {}),
    ...(clone.tokenPolicy !== undefined ? { tokenPolicy: clone.tokenPolicy } : {}),
    summary: clone.summary ?? null,
    errors: clone.errors ?? [],
    extensions: clone.extensions ?? {},
  };

  return envelope;
}
