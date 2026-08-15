/**
 * EXPERIMENTAL. Not part of the stable v1 API surface — see
 * specification/v1/provenance.md#5-experimental-signing-and-verification.
 * May change without a major version bump.
 */
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { deepClone } from "../clone.js";
import { stableStringify } from "../hash.js";
import type { ContextItem } from "../types.js";

export interface KeyPairPem {
  publicKey: string;
  privateKey: string;
}

/** Generates an RSA-2048 key pair (PEM) for use with signItemProvenance/verifyItemProvenance. */
export function generateSigningKeyPair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function payloadFor(item: ContextItem): string {
  const clone = deepClone(item);
  if (clone.source) {
    const { signature: _signature, ...rest } = clone.source;
    if (Object.keys(rest).length > 0) {
      clone.source = rest;
    } else {
      delete clone.source;
    }
  }
  return stableStringify(clone);
}

/** Signs an item's canonical payload (its `source.signature` excluded) and attaches `source.signature`. */
export function signItemProvenance(
  item: ContextItem,
  privateKeyPem: string,
  publicKeyId?: string,
): ContextItem {
  const payload = payloadFor(item);
  const signature = createSign("RSA-SHA256").update(payload).sign(privateKeyPem, "base64");
  const next = deepClone(item);
  next.source = {
    ...(next.source ?? {}),
    signature: { alg: "rsa-sha256", publicKeyId, signature },
  };
  return next;
}

/** Verifies an item's `source.signature` against its canonical payload. Returns false if unsigned. */
export function verifyItemProvenance(item: ContextItem, publicKeyPem: string): boolean {
  const signature = item.source?.signature;
  if (!signature) return false;
  const payload = payloadFor(item);
  return createVerify("RSA-SHA256")
    .update(payload)
    .verify(publicKeyPem, signature.signature, "base64");
}
