# Example: ingesting PDF

```bash
node run.mjs
```

Generates a tiny, valid PDF **in memory** (no binary fixture is committed to
the repo), then ingests it via `ingestBuffer`, showing page-numbered
sections and PDF metadata extraction. Equivalent CLI form:

```bash
ulcs ingest document.pdf -o context.json
```
