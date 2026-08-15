# Example: Expired information

`urn:ulcs:fact:promo` expired on 2026-08-01 (`validUntil`); today (2026-08-15
in these examples) it should be filtered out of any compiled context, while
`urn:ulcs:fact:pricing` (`validUntil: null`, no known expiry) survives.

`compileContext` filters expired items automatically, as of its `asOf`
clock (default: "now"), and records why in `droppedItems`:

```bash
ulcs compile examples/expired-info/context.json --target markdown
# The "Facts" section only contains the pricing fact.
```

You can also use `filterContext` directly from `@ulcs/core` with an
explicit `asOf` for any other operation that needs freshness filtering —
see specification/v1/provenance.md#4-staleness.
