import { parsePointer, tokenToArrayIndex, getByPointer } from "./json-pointer.js";
import type { JsonPatchOperation } from "./types.js";

export class JsonPatchError extends Error {
  constructor(
    message: string,
    public readonly operationIndex: number,
    public readonly operation: JsonPatchOperation,
  ) {
    super(
      `JSON Patch operation ${operationIndex} (${operation.op} ${operation.path}) failed: ${message}`,
    );
    this.name = "JsonPatchError";
  }
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => isDeepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key, i) =>
        key === bKeys[i] &&
        isDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/** Callers guarantee `tokens.length >= 1` (they handle the root-pointer case themselves). */
function navigateToParent(
  root: unknown,
  tokens: string[],
): { container: unknown; lastToken: string } {
  const parentTokens = tokens.slice(0, -1);
  let container: unknown = root;
  for (const token of parentTokens) {
    if (Array.isArray(container)) {
      container = container[tokenToArrayIndex(token, container.length)];
    } else if (container !== null && typeof container === "object") {
      container = (container as Record<string, unknown>)[token];
    } else {
      throw new Error(`Path segment "${token}" does not resolve to a container`);
    }
  }
  const lastToken = tokens[tokens.length - 1] as string;
  return { container, lastToken };
}

function setAtPointer(root: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value;
  const { container, lastToken } = navigateToParent(root, tokens);
  if (Array.isArray(container)) {
    const index = tokenToArrayIndex(lastToken, container.length);
    container.splice(index, 0, value);
  } else if (container !== null && typeof container === "object") {
    (container as Record<string, unknown>)[lastToken] = value;
  } else {
    throw new Error(`Cannot set property "${lastToken}" on a non-object`);
  }
  return root;
}

function replaceAtPointer(root: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value;
  const { container, lastToken } = navigateToParent(root, tokens);
  if (Array.isArray(container)) {
    const index = tokenToArrayIndex(lastToken, container.length);
    if (index >= container.length) throw new Error(`Array index ${index} out of bounds`);
    container[index] = value;
  } else if (container !== null && typeof container === "object") {
    (container as Record<string, unknown>)[lastToken] = value;
  } else {
    throw new Error(`Cannot replace property "${lastToken}" on a non-object`);
  }
  return root;
}

function removeAtPointer(root: unknown, pointer: string): { root: unknown; removed: unknown } {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) throw new Error("Cannot remove the document root");
  const { container, lastToken } = navigateToParent(root, tokens);
  if (Array.isArray(container)) {
    const index = tokenToArrayIndex(lastToken, container.length);
    if (index >= container.length) throw new Error(`Array index ${index} out of bounds`);
    const [removed] = container.splice(index, 1);
    return { root, removed };
  } else if (container !== null && typeof container === "object") {
    const record = container as Record<string, unknown>;
    if (!(lastToken in record)) throw new Error(`Property "${lastToken}" does not exist`);
    const removed = record[lastToken];
    delete record[lastToken];
    return { root, removed };
  }
  throw new Error(`Cannot remove property "${lastToken}" from a non-object`);
}

/**
 * Applies a single RFC 6902 operation to `root` **in place** and returns the
 * (possibly reassigned) root. Mutates `root` — callers must clone first.
 */
export function applyOperation(root: unknown, operation: JsonPatchOperation): unknown {
  switch (operation.op) {
    case "add":
      return setAtPointer(root, operation.path, structuredCloneValue(operation.value));
    case "replace":
      return replaceAtPointer(root, operation.path, structuredCloneValue(operation.value));
    case "remove":
      return removeAtPointer(root, operation.path).root;
    case "move": {
      if (!operation.from) throw new Error('"move" requires a "from" path');
      const { removed } = removeAtPointer(root, operation.from);
      return setAtPointer(root, operation.path, removed);
    }
    case "copy": {
      if (!operation.from) throw new Error('"copy" requires a "from" path');
      const value = getByPointer(root, operation.from);
      return setAtPointer(root, operation.path, structuredCloneValue(value));
    }
    case "test": {
      const actual = getByPointer(root, operation.path);
      if (!isDeepEqual(actual, operation.value)) {
        throw new Error(
          `test failed: expected ${JSON.stringify(operation.value)}, got ${JSON.stringify(actual)}`,
        );
      }
      return root;
    }
    default:
      throw new Error(`Unknown operation "${(operation as JsonPatchOperation).op}"`);
  }
}

function structuredCloneValue<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Applies an ordered list of RFC 6902 operations to `root`, all-or-nothing:
 * operates on an internal deep clone, and if any operation throws, the
 * original `root` is returned unmodified and the error is re-thrown as a
 * {@link JsonPatchError} carrying the failing operation's index and path.
 */
export function applyJsonPatch<T>(root: T, operations: JsonPatchOperation[]): T {
  const working = structuredCloneValue(root);
  let current: unknown = working;
  operations.forEach((operation, index) => {
    try {
      current = applyOperation(current, operation);
    } catch (error) {
      throw new JsonPatchError(
        error instanceof Error ? error.message : String(error),
        index,
        operation,
      );
    }
  });
  return current as T;
}
