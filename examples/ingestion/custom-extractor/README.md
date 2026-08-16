# Example: writing a custom extractor

```bash
node run.mjs
```

Registers a custom `ContentExtractor` for a fictional `.ini`-like format
alongside the built-in extractors, using a private `ExtractorRegistry`
(`createExtractorRegistry`) rather than mutating the global default
registry — the recommended pattern for a host application that wants
isolated, composable extractor sets.
