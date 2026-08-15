# Example: Sensitive data requiring redaction

Five facts spanning every `sensitivity.level`/`handling.rule` combination
described in `specification/v1/security.md#1`:

| Fact                  | Level        | Rule                       | Effect of `redactContext`                                                      |
| --------------------- | ------------ | -------------------------- | ------------------------------------------------------------------------------ |
| `fact:name`           | personal     | redact (boundary `export`) | Content replaced with `[REDACTED]` when exporting                              |
| `fact:card`           | secret       | exclude                    | Removed entirely                                                               |
| `fact:consent-needed` | personal     | require-consent            | Kept, flagged, returned in `requiresConsent`                                   |
| `fact:internal-note`  | confidential | local-only                 | Kept, flagged, returned in `localOnly` — caller must not forward it externally |
| `fact:plan`           | public       | (none)                     | Passes through unchanged                                                       |

Try it:

```bash
# Universal rules only (no boundary) — fact:name's rule is boundary-scoped
# to "export" so it passes through here, but fact:card (universal exclude)
# is still removed:
ulcs redact examples/security/context.json

# Scoped to the "export" boundary — fact:name is now redacted too:
ulcs redact examples/security/context.json --policy export
```

This is the one operation in `@ulcs/core` that actually _enforces_ (not
just labels) the sensitivity policy present in the data — see the warning
in `specification/v1/security.md` about `SecurityPolicy` being declarative
metadata everywhere else.
