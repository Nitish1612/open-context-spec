# Example: ingesting plain text / Markdown

```bash
node run.mjs
```

Ingests an inline Markdown string via the SDK (`ingestText`) and prints the
resulting `ContextEnvelope`'s resource count and the default trusted
instruction. Equivalent CLI form:

```bash
printf "# Notes\n\nSome content." | ulcs ingest - --type markdown --stdout
```
