# Example: Conflicting facts from two sources

`context-a.json` (from the billing database) says the customer is on the
**Pro** plan. `context-b.json` (from the CRM) says **Enterprise**. Both
facts share the id `urn:ulcs:fact:plan`, both are `status: "confirmed"`,
and their content disagrees.

`mergeContexts` (see `specification/v1/interoperability.md#2-merge-semantics`)
**never** silently picks a winner between two confirmed, disagreeing facts:
it keeps both (the second under `urn:ulcs:fact:plan#conflict:<hash>`) and
returns a `ConflictReport` so the application can resolve it explicitly —
e.g. by re-querying the source of truth, or presenting a `Question` to a
human.

Run it:

```bash
node examples/conflicting-facts/merge-example.mjs
```

Expected output: `Merged fact count: 2`, followed by a JSON conflict report
with `"reason": "content-mismatch"` and `"resolution": "kept-both"`.
