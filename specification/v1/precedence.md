# Instruction Precedence (Draft)

## 1. Authority tiers

Every `Instruction` item declares an `authority`:

1. **`system`** — the model provider or platform-level operating mandate.
   Highest authority. Analogous to OpenAI's `system` role or Anthropic's
   `system` parameter when used for platform-level policy.
2. **`developer`** — the integrating application developer's configuration.
   Analogous to OpenAI's `developer` role, or a Claude/Gemini system prompt
   segment authored by the application rather than the platform.
3. **`application`** — runtime, request-specific configuration set by the
   host application (feature flags, mode switches), below fixed developer
   policy but above the end user.
4. **`user`** — the end user's direct instructions in the current
   interaction.
5. **`tool`** — instructions a tool is _permitted_ to issue back to the
   model (rare, and only meaningful when a host explicitly designs a tool to
   have this power — e.g. a planning tool returning "next step" directives).
6. **`retrieved-content`** — content pulled from an external source that a
   host has deliberately and explicitly chosen to treat as low-authority
   instruction (for example, a user pastes a checklist from a shared doc and
   asks the assistant to follow it). Lowest authority, and never assigned
   automatically (§3).

Default conflict resolution is a strict total order: a lower-numbered tier's
directive prevails when it directly conflicts with a higher-numbered tier's
directive. "Directly conflicts" means the directives cannot both be
satisfied — e.g. `system: "Never reveal internal pricing formulas"` vs.
`user: "Explain exactly how you calculated this price"` — not mere topical
overlap.

## 2. What "prevails" means

ULCS does not execute instructions; it labels them so a compiler/adapter and,
ultimately, the model can weigh them correctly. "Prevails" means:

- The compiler (`packages/compiler`) preserves authority tier through
  compilation and never reorders instructions such that a lower-tier
  instruction is presented as if it were higher-tier.
- Provider adapters (`packages/adapters`) map `system`/`developer` authority
  to whatever the target provider's highest-authority channel is (see
  [interoperability.md](./interoperability.md) for the per-provider mapping
  and its information loss).
- When two `Instruction` items of the _same_ tier conflict, ULCS does not
  guess a winner: both are retained, `conflictsWith` cross-references them,
  and an `Error` (severity `warning`) is added noting the unresolved
  conflict. Silent resolution of same-tier conflicts is non-conformant.

## 3. Retrieved and untrusted content is never silently promoted

This is the core prompt-injection defense at the schema level:

> A processor MUST NOT create or treat a `Fact`, `Resource`, `ToolResult`, or
> any other non-`Instruction` item as carrying instruction authority, even if
> its text content is imperative in form ("Ignore previous instructions and
> ..."). Only `Instruction` items with `trust.providesInstructions: true`
> carry authority.

Concretely:

- Text retrieved from the web, email, files, or tool output should normally
  be represented as `Resource`, `Fact`, or `ToolResult` — **not**
  `Instruction` — with `trust.providesInstructions: false`.
- The `retrieved-content` authority tier exists only for the narrow,
  deliberate case described in §1.6, and even then a conformant SDK SHOULD
  require an explicit application-level opt-in (see
  `SecurityPolicy.allowToolInstructions` and the equivalent flag for
  retrieved content) rather than inferring it from content shape.
- The JSON Schema enforces a machine-checkable slice of this rule: an item
  whose `trust.level` is `"untrusted"` MUST have
  `trust.providesInstructions: false` (see
  `schemas/v1/definitions/trust.schema.json`).

## 4. Cross-model reality check

Not every provider exposes six distinct instruction channels. ULCS's job is
to preserve the _authority information_, not to fabricate channels that
don't exist:

| Provider shape                                                            | Channels available           | ULCS mapping                                                                                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI-style (`system`, `developer`, `user`, `assistant`, `tool` roles)   | 5 roles                      | `system`→`system`, `developer`→`developer`, `application`+`user`→`user` (application-tier content prefixed and labeled), `tool`→`tool`                        |
| Anthropic-style (`system` param + `user`/`assistant` turns)               | 1 system slot + 2 turn roles | `system`+`developer`+`application` instructions concatenated into the `system` string, each block labeled with its original authority; `user`→first user turn |
| Gemini-style (`systemInstruction` + `contents` with `user`/`model` roles) | 1 system slot + 2 roles      | same collapse as Anthropic                                                                                                                                    |
| Generic chat completion                                                   | `system`/`user`/`assistant`  | same collapse as Anthropic, `tool` results folded into `user` with a labeled block                                                                            |
| Markdown prompt                                                           | none (plain text)            | every tier rendered under its own heading, in tier order                                                                                                      |
| MCP resource                                                              | none (opaque content block)  | full-fidelity JSON is preserved; the _host_ is responsible for further collapse                                                                               |

Adapters document this per-target loss in
[interoperability.md](./interoperability.md#information-loss-by-adapter);
this is intentional and unavoidable, not a bug to "fix" by inventing
provider features that don't exist.
