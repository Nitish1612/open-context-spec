# Example: ingesting a directory

```bash
node run.mjs
```

Ingests every supported file under this example directory (recursively)
into one combined `ContextEnvelope`, preserving separate provenance per
source file. `run.mjs` itself has an unsupported extension and is
correctly reported as one failed file — directory ingestion continues past
it by default (`--on-error continue`) rather than aborting the whole run.
Equivalent CLI form:

```bash
ulcs ingest ./examples/ingestion/directory -o knowledge-base.json
ulcs ingest ./examples/ingestion/directory --recursive -o knowledge-base.json
```
