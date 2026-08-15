/** Minimal RFC 6901 JSON Pointer implementation used by the patch engine and validator error formatting. */

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer: "${pointer}" (must start with "/")`);
  }
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function tokenToArrayIndex(token: string, length: number): number {
  if (token === "-") return length;
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new Error(`Invalid JSON Pointer array index: "${token}"`);
  }
  return Number(token);
}

export function getByPointer(root: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = tokenToArrayIndex(token, current.length);
      current = current[index];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`Cannot resolve pointer segment "${token}" on non-object value`);
    }
  }
  return current;
}
