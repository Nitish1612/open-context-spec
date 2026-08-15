# ADR-0001: Extend the strawman ContextEnvelope shape

- Status: Accepted
- Date: 2026-08-15

## Context

The initial ULCS proposal sketched a `ContextEnvelope` with arrays for
`actors`, `instructions`, `facts`, `constraints`, `preferences`,
`decisions`, `conversation`, `resources`, `entities`, `relationships`,
`memory`, `tools`, plus `objective`, `outputContract`, `security`,
`tokenPolicy`, and `extensions`. The required semantic types list separately
requires `Assumption`, `Question`, `ToolResult`, `ContextSummary`, and
`Error` — types with no corresponding top-level array in the strawman.

## Decision

Add four arrays (`assumptions`, `questions`, `toolResults`, `errors`) and one
optional object (`summary: ContextSummary | null`) to the envelope. All new
fields are optional and default to empty/`null`, so this is additive and
does not break documents written against the strawman shape.

## Consequences

- The JSON Schema, TypeScript types, and every SDK function operate on the
  extended shape.
- `Task` items live inside `objective.tasks` or wherever an application
  chooses to nest them (see vocabulary.md); we did not add a top-level
  `tasks` array because tasks are usually scoped under a single objective,
  and adding it can be revisited without a breaking change if usage shows
  otherwise.
- Actor and Entity remain distinct top-level arrays (`actors`, `entities`)
  because actors are participants in the interaction while entities are
  things referenced by it; conflating them would lose that distinction.
