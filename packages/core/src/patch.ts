import { applyJsonPatch } from "./json-patch.js";
import type { ContextEnvelope, ContextPatch } from "./types.js";

/**
 * Applies a ContextPatch (RFC 6902 operations) to a ContextEnvelope.
 * All-or-nothing: if any operation fails (including a failing `test`), the
 * original context is returned untouched and a `JsonPatchError` is thrown
 * naming the failing operation's index and JSON Pointer path.
 */
export function applyContextPatch(context: ContextEnvelope, patch: ContextPatch): ContextEnvelope {
  if (patch.targetId && patch.targetId !== context.id) {
    throw new Error(
      `ContextPatch targetId "${patch.targetId}" does not match context id "${context.id}"`,
    );
  }
  return applyJsonPatch(context, patch.operations);
}
