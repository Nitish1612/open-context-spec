# Example: ingesting CSV

```bash
node run.mjs
```

Ingests a small CSV file, showing row-boundary-preserving chunking (each row
stays whole, never split across chunks). Equivalent CLI form:

```bash
ulcs ingest employees.csv -o context.json
```
