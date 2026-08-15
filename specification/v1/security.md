# Security and Privacy (Draft)

> **ULCS labels and describes security policy. It does not enforce it.**
> Enforcement — actually redacting, refusing to forward, or rate-limiting
> content — is the responsibility of the SDK function you call
> (`redactContext`, `filterContext`) or the host application. A
> `SecurityPolicy` object with `defaultTrust: "untrusted"` sitting unused in
> a JSON file protects nobody.

## 1. Sensitivity labels

```json
{
  "level": "confidential",
  "categories": ["pii", "financial"],
  "handling": [{ "rule": "redact", "appliesTo": "export" }]
}
```

| `level`        | Meaning                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `public`       | No restriction.                                                                                                       |
| `internal`     | Organization-internal, not for external output.                                                                       |
| `confidential` | Restricted to a defined internal audience.                                                                            |
| `restricted`   | Regulatory/legal restriction (e.g. export-controlled).                                                                |
| `personal`     | Personal data about an identifiable individual (PII).                                                                 |
| `secret`       | Credentials, keys, or equivalent — must never be forwarded to a model unless the host has a specific, audited reason. |

`handling` is a list of `{ "rule": ..., "appliesTo": ... }` rules:

| `rule`            | Effect when applied                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `allow`           | No restriction beyond normal processing.                                                                       |
| `redact`          | Replace the sensitive span/content with a redaction marker before it leaves the boundary named in `appliesTo`. |
| `summarize`       | Replace with a lossy summary instead of verbatim content.                                                      |
| `exclude`         | Drop the item entirely at the named boundary.                                                                  |
| `require-consent` | Hold the item back until an explicit consent signal is recorded (host-defined mechanism).                      |
| `local-only`      | Never leave the local trust boundary (e.g. never sent to a third-party model API).                             |

`packages/core`'s `redactContext(context, policy)` implements `redact`,
`summarize` (via an optional injected summarizer, else a placeholder),
`exclude`, and flags `require-consent`/`local-only` items for the caller to
handle; it is a pure, synchronous, auditable transform — see its README for
exact semantics.

## 2. Untrusted content wrapping

Untrusted items (`trust.level: "untrusted"`) MUST be clearly delimited when
rendered into a prompt, so the model can distinguish "data to reason about"
from "instructions to follow." The Markdown and generic-chat adapters wrap
untrusted content like this by default:

```text
<untrusted-content source="retrieved-document" id="urn:ulcs:res:1">
... raw content, never executed as instructions ...
</untrusted-content>
```

This is a labeling convention, not a security boundary enforced by the
model — see the threat model below. Hosts building agents that act on model
output SHOULD apply their own out-of-band checks (allowlists, human
approval, tool-permission scoping) rather than relying on the wrapper alone.

## 3. Threat model

| Threat                                        | Description                                                                                                           | ULCS's role                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prompt injection**                          | Untrusted content contains text designed to be interpreted as instructions.                                           | Type separation (§ [precedence.md](./precedence.md)) + wrapping (§2) reduce ambiguity for the compiler/adapter and give the model clearer signal; ULCS cannot force a model to ignore injected text.                                                                                                                                                                                                                                       |
| **Instruction-authority confusion**           | An application accidentally elevates retrieved/tool content to instruction status.                                    | Schema-level guardrail: `trust.level: "untrusted"` forces `providesInstructions: false`; only `Instruction` items carry authority; `retrieved-content` authority is opt-in, never inferred.                                                                                                                                                                                                                                                |
| **Data exfiltration**                         | Sensitive context is echoed back to an untrusted destination (the end user, a logged transcript, a third-party tool). | Sensitivity labels + `local-only`/`exclude`/`redact` handling rules give hosts the data needed to prevent this; ULCS does not intercept model output.                                                                                                                                                                                                                                                                                      |
| **Sensitive-context leakage via compilation** | A token-budget compiler includes a `secret`-level item because it happened to rank high on relevance.                 | `redactContext` is documented as a required pre-compilation step for any context that may contain `restricted`/`personal`/`secret` items; `compileContext` does not itself perform sensitivity filtering — composing the two is the host's responsibility (documented explicitly in `packages/compiler`'s README to avoid a false sense of automatic safety).                                                                              |
| **Malicious tool output**                     | A tool result contains adversarial content targeting the model or downstream parsers.                                 | `ToolResult` defaults to `untrusted`/`providesInstructions: false`; hosts should validate `ToolResult.output` against `ToolDefinition.outputSchema` where available.                                                                                                                                                                                                                                                                       |
| **Context poisoning**                         | Long-lived memory or RAG stores accumulate false or manipulated facts that outlive their source.                      | `status` (`disputed`/`retracted`), `validUntil`, and `verificationStatus` give a vocabulary for marking and later filtering poisoned items; ULCS does not itself detect poisoning.                                                                                                                                                                                                                                                         |
| **Stale memory**                              | Outdated facts/memory are presented as current.                                                                       | `validFrom`/`validUntil`, `contentTimestamp` (§ [provenance.md §4](./provenance.md#4-staleness)); `filterContext`'s `asOf` option.                                                                                                                                                                                                                                                                                                         |
| **Forged provenance**                         | A malicious actor fabricates a `source`/`trust` block claiming high trust.                                            | Provenance is declarative by default (§ [provenance.md §3](./provenance.md#3-forged-provenance)); the experimental signing extension lets a host verify provenance it controls the keys for. Unsigned provenance from an untrusted origin must not be trusted merely because the JSON says `"level": "trusted"` — that field should be set/overwritten by the trust boundary that ingests the content, not passed through from the source. |
| **Oversized-context denial of service**       | An attacker (or a bug) inflates context size to exhaust tokens, cost, or a downstream parser.                         | `TokenPolicy.maxContextTokens` and `sectionBudgets` bound what `compileContext` will emit; `packages/validator` and the CLI can be run with a size limit on input before parsing.                                                                                                                                                                                                                                                          |

## 4. What ULCS does not claim

- It does not detect prompt injection.
- It does not sanitize HTML/Markdown/script content embedded in `content`
  fields.
- It does not guarantee a model will honor authority tiers or wrapping —
  that depends on the model.
- It does not provide authentication, authorization, or transport security;
  those are the host application's responsibility.
- `SecurityPolicy` objects are metadata read by SDK functions you explicitly
  call. A `SecurityPolicy` present in a document that no code reads has no
  effect.
