# Example: Token-budget compilation

A tight `tokenPolicy` (`maxContextTokens: 120`, `reservedOutputTokens: 20`,
a 60-token `facts` section budget) applied to three facts of decreasing
priority/relevance, one of which (`fact:3`, relevance `0.15`) falls below
`relevanceThreshold: 0.3` and is dropped before ranking even begins. The
system instruction is in `requiredItemIds`, so it's always included first
regardless of budget pressure.

```bash
ulcs compile examples/token-budget/context.json --target markdown
```

Expect: `fact:3` absent from `droppedItems` with reason
`"below-relevance-threshold"`; `fact:1` included in full (highest
priority); `fact:2` either included in full or truncated depending on how
much of the 60-token facts budget `fact:1` consumed — run it and inspect
`droppedItems`/the truncation marker (`…`) to see the deterministic
outcome. Re-running produces byte-identical output every time (see
`tests/conformance` for the determinism check).
