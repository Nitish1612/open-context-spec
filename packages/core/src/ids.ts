import { randomUUID } from "node:crypto";

/**
 * Generates a new ULCS identifier. Uses a random UUID by default, so this
 * is the one part of the SDK that is intentionally non-deterministic —
 * every other core operation is a pure function of its inputs. Callers who
 * need deterministic IDs (tests, reproducible fixtures) should pass their
 * own IDs explicitly rather than relying on generation.
 */
export function generateId(kind: string = "item"): string {
  return `urn:ulcs:${kind}:${randomUUID()}`;
}
