import { describe, expect, it } from "vitest";
import { applyJsonPatch, JsonPatchError } from "../src/json-patch.js";
import { getByPointer } from "../src/json-pointer.js";
import { generateId } from "../src/ids.js";
import { shortHash, stableStringify } from "../src/hash.js";
import {
  generateSigningKeyPair,
  signItemProvenance,
  verifyItemProvenance,
} from "../src/experimental/provenance-signing.js";
import type { Fact } from "../src/types.js";

describe("applyJsonPatch", () => {
  it("throws JsonPatchError with operation index on an invalid path", () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "replace", path: "/b/c", value: 1 }])).toThrow(
      JsonPatchError,
    );
  });

  it("getByPointer resolves nested paths, including array '-'-adjacent indices", () => {
    const doc = { a: [{ b: 1 }, { b: 2 }] };
    expect(getByPointer(doc, "/a/1/b")).toBe(2);
    expect(getByPointer(doc, "")).toBe(doc);
  });
});

describe("hash utilities", () => {
  it("stableStringify is key-order independent", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("shortHash is deterministic for the same input", () => {
    expect(shortHash({ x: 1 })).toBe(shortHash({ x: 1 }));
    expect(shortHash({ x: 1 })).not.toBe(shortHash({ x: 2 }));
  });
});

describe("generateId", () => {
  it("produces unique urn:ulcs identifiers", () => {
    const a = generateId("fact");
    const b = generateId("fact");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^urn:ulcs:fact:/);
  });
});

describe("experimental provenance signing", () => {
  it("verifies a correctly signed item and rejects a tampered one", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const item: Fact = { id: "urn:ulcs:fact:1", "@type": "Fact", content: "The sky is blue." };
    const signed = signItemProvenance(item, privateKey, "urn:example:key:1");
    expect(verifyItemProvenance(signed, publicKey)).toBe(true);

    const tampered: Fact = { ...signed, content: "The sky is green." };
    expect(verifyItemProvenance(tampered, publicKey)).toBe(false);
  });

  it("returns false for an unsigned item", () => {
    const { publicKey } = generateSigningKeyPair();
    const item: Fact = { id: "urn:ulcs:fact:1", "@type": "Fact", content: "unsigned" };
    expect(verifyItemProvenance(item, publicKey)).toBe(false);
  });
});
