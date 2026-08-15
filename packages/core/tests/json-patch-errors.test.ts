import { describe, expect, it } from "vitest";
import { applyJsonPatch, applyOperation, JsonPatchError } from "../src/json-patch.js";
import { getByPointer, parsePointer, tokenToArrayIndex } from "../src/json-pointer.js";
import type { JsonPatchOperation } from "../src/types.js";

describe("json-pointer error paths", () => {
  it("parsePointer rejects a pointer that doesn't start with /", () => {
    expect(() => parsePointer("no-leading-slash")).toThrow(/Invalid JSON Pointer/);
  });

  it("tokenToArrayIndex rejects a non-numeric, non-'-' token", () => {
    expect(() => tokenToArrayIndex("abc", 3)).toThrow(/Invalid JSON Pointer array index/);
  });

  it("getByPointer throws when traversing into a primitive", () => {
    expect(() => getByPointer({ a: "just a string" }, "/a/b")).toThrow(/non-object value/);
  });
});

describe("json-patch structural error paths", () => {
  it("throws when a path segment resolves through a primitive", () => {
    expect(() =>
      applyJsonPatch({ a: "just a string" }, [{ op: "replace", path: "/a/b", value: 1 }]),
    ).toThrow(JsonPatchError);
  });

  it("add throws when the parent is not an object/array", () => {
    expect(() => applyJsonPatch({ a: "x" }, [{ op: "add", path: "/a/b", value: 1 }])).toThrow(
      JsonPatchError,
    );
  });

  it("replace throws on an out-of-bounds array index", () => {
    expect(() =>
      applyJsonPatch({ a: [1, 2] }, [{ op: "replace", path: "/a/5", value: 1 }]),
    ).toThrow(/out of bounds/);
  });

  it("replace throws when the parent is not an object/array", () => {
    expect(() => applyJsonPatch({ a: "x" }, [{ op: "replace", path: "/a/b", value: 1 }])).toThrow(
      JsonPatchError,
    );
  });

  it("remove throws on an out-of-bounds array index", () => {
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: "remove", path: "/a/5" }])).toThrow(
      /out of bounds/,
    );
  });

  it("remove throws when the property does not exist", () => {
    expect(() => applyJsonPatch({ a: {} }, [{ op: "remove", path: "/a/missing" }])).toThrow(
      /does not exist/,
    );
  });

  it("remove throws when the parent is not an object/array", () => {
    expect(() => applyJsonPatch({ a: "x" }, [{ op: "remove", path: "/a/b" }])).toThrow(
      JsonPatchError,
    );
  });

  it("move without a from path throws", () => {
    expect(() =>
      applyJsonPatch({ a: 1 }, [{ op: "move", path: "/b" } as JsonPatchOperation]),
    ).toThrow(/requires a "from" path/);
  });

  it("copy without a from path throws", () => {
    expect(() =>
      applyJsonPatch({ a: 1 }, [{ op: "copy", path: "/b" } as JsonPatchOperation]),
    ).toThrow(/requires a "from" path/);
  });

  it("copying a missing path copies `undefined`", () => {
    const result = applyOperation({ a: 1 }, { op: "copy", from: "/missing", path: "/b" });
    expect((result as { b: unknown }).b).toBeUndefined();
  });

  it("rejects an unknown operation name", () => {
    expect(() =>
      applyJsonPatch({ a: 1 }, [{ op: "delete", path: "/a" } as unknown as JsonPatchOperation]),
    ).toThrow(/Unknown operation/);
  });
});

describe("test operation deep-equality edge cases", () => {
  it("fails when types differ", () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "test", path: "/a", value: "1" }])).toThrow(
      /test failed/,
    );
  });

  it("fails when array lengths differ", () => {
    expect(() =>
      applyJsonPatch({ a: [1, 2] }, [{ op: "test", path: "/a", value: [1, 2, 3] }]),
    ).toThrow(/test failed/);
  });

  it("fails when one side is an array and the other is not", () => {
    expect(() =>
      applyJsonPatch({ a: [1, 2] }, [{ op: "test", path: "/a", value: { 0: 1, 1: 2 } }]),
    ).toThrow(/test failed/);
  });

  it("fails when object key counts differ", () => {
    expect(() =>
      applyJsonPatch({ a: { x: 1 } }, [{ op: "test", path: "/a", value: { x: 1, y: 2 } }]),
    ).toThrow(/test failed/);
  });

  it("fails when null is compared to an object", () => {
    expect(() => applyJsonPatch({ a: null }, [{ op: "test", path: "/a", value: {} }])).toThrow(
      /test failed/,
    );
  });

  it("succeeds for deeply equal nested structures regardless of key order", () => {
    const result = applyJsonPatch({ a: { x: 1, y: [1, 2, { z: true }] } }, [
      { op: "test", path: "/a", value: { y: [1, 2, { z: true }], x: 1 } },
    ]);
    expect(result).toEqual({ a: { x: 1, y: [1, 2, { z: true }] } });
  });
});
