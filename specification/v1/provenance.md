# Provenance and Trust (Draft)

## 1. Provenance object

Any context item MAY carry a `source` object of type `Provenance`:

```json
{
  "sourceUri": "https://example.com/docs/refunds",
  "sourceId": "kb-article-42",
  "sourceType": "retrieved-document",
  "author": "support-kb@example.com",
  "retrievedAt": "2026-08-15T11:58:00Z",
  "contentTimestamp": "2026-06-01T00:00:00Z",
  "contentHash": "sha256:9f3c...",
  "citation": {
    "@type": "Citation",
    "uri": "https://example.com/docs/refunds#s3",
    "excerpt": "..."
  },
  "transformations": [
    {
      "operation": "html-to-text",
      "timestamp": "2026-08-15T11:58:01Z",
      "actor": "urn:ulcs:tool:extractor"
    }
  ],
  "confidence": 0.8,
  "verificationStatus": "unverified"
}
```

| Field                | Meaning                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sourceUri`          | Dereferenceable location of the source, if any.                                                                                 |
| `sourceId`           | Opaque identifier when no URI exists (a database row ID, a memory-store key).                                                   |
| `sourceType`         | See the controlled vocabulary in [vocabulary.md](./vocabulary.md#3-controlled-vocabularies).                                    |
| `author`             | Best-effort attribution string.                                                                                                 |
| `retrievedAt`        | When _this system_ fetched/observed the content (RFC 3339).                                                                     |
| `contentTimestamp`   | When the content itself was authored/last updated, if known — distinct from `retrievedAt` and central to staleness checks (§4). |
| `contentHash`        | Integrity hash of the content at retrieval time, e.g. `"sha256:<hex>"`.                                                         |
| `citation`           | A `Citation` item for user-facing attribution.                                                                                  |
| `transformations`    | Ordered history of transformations applied since retrieval (extraction, translation, summarization).                            |
| `confidence`         | 0–1 confidence that the content is accurate/relevant.                                                                           |
| `verificationStatus` | `unverified` \| `verified` \| `disputed` \| `failed`.                                                                           |

All fields are optional. An item with no `source` at all is valid but
carries no provenance — SDKs SHOULD treat unprovenanced items conservatively
(e.g. not eligible for `trust.level: "trusted"` by default).

## 2. Trust labels

```json
{
  "level": "untrusted",
  "providesData": true,
  "providesInstructions": false,
  "rationale": "Fetched from an external, unauthenticated web page."
}
```

| Field                  | Meaning                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`                | `trusted` \| `semi-trusted` \| `untrusted` \| `unknown`.                                                                                                                            |
| `providesData`         | May this item's content be treated as factual/informational input?                                                                                                                  |
| `providesInstructions` | May this item's content be treated as a directive? **Default `false`**, and schema-enforced `false` whenever `level: "untrusted"` (see `schemas/v1/definitions/trust.schema.json`). |
| `rationale`            | Free-text justification, useful in audits.                                                                                                                                          |

The `providesData` / `providesInstructions` split is deliberate and
independent: a trusted internal document can provide data without ever being
treated as an instruction (it's still a `Fact`/`Resource`, not an
`Instruction`); conversely nothing in ULCS lets untrusted content provide
instructions, full stop.

## 3. Forged provenance

ULCS provenance is **declarative metadata**, not cryptographic proof, unless
the experimental signing extension (§5) is used. A processor MUST NOT treat
an unsigned `source`/`trust` block as tamper-proof. Threats and mitigations
are catalogued in [security.md](./security.md#forged-provenance).

## 4. Staleness

`validFrom`/`validUntil` (on the item) and `contentTimestamp`/`retrievedAt`
(on `Provenance`) are distinct concepts:

- `validFrom`/`validUntil` describe **when the fact is true**, from the
  application's point of view (e.g., a promotional price valid this week).
- `contentTimestamp`/`retrievedAt` describe **when the content was produced
  and observed**, independent of whether it's still valid.

A conformant compiler filters out items whose `validUntil` has passed
relative to the compilation clock (`asOf`), and MAY down-rank items whose
`contentTimestamp` is old relative to a configured freshness expectation,
but does not delete stale items outright — see `filterContext` /
`deduplicateContext` in `packages/core` and `examples/expired-info`.

## 5. Experimental: signing and verification

As an **experimental extension**, a `Provenance` object MAY include a
`signature`:

```json
{ "signature": { "alg": "ed25519", "publicKeyId": "urn:example:key:1", "signature": "base64..." } }
```

The signed payload is the canonical JSON (RFC 8785-style key-sorted,
whitespace-free serialization) of the item with `source.signature` itself
removed. `packages/core` exposes `signProvenance`/`verifyProvenance` helpers
behind an explicit experimental export path; this is **not** part of the
stable v1 API surface and MAY change without a major version bump. It exists
to make forged-provenance mitigation possible for deployments that need it,
not to imply that all ULCS documents are signed.
