# Example: ingesting JSON

```bash
node run.mjs
```

Ingests a small JSON document via the SDK, showing that a top-level object
becomes one section per key (never flattened to an unreadable single line).
Equivalent CLI form:

```bash
ulcs ingest data.json -o context.json
```
