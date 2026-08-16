import {
  createExtractorRegistry,
  listBuiltInExtractors,
  resolveInput,
  extractDocument,
  chunkDocument,
  mapDocumentsToContext,
} from "../../../packages/ingest/dist/index.js";

/** A minimal custom extractor for a fictional "key = value" INI-like format. */
const iniExtractor = {
  id: "example-ini",
  name: "Example INI",
  extensions: [".ini"],
  mediaTypes: ["text/x-ini"],
  supports: (input) => (input.filename ?? "").endsWith(".ini"),
  async extract(input) {
    const text = new TextDecoder().decode(input.data);
    const sections = text
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line, index) => {
        const [key, ...rest] = line.split("=");
        return { id: `section:${index}`, title: key.trim(), content: rest.join("=").trim() };
      });
    const { createHash } = await import("node:crypto");
    return {
      id: `doc:ini:${createHash("sha256").update(input.data).digest("hex").slice(0, 16)}`,
      mediaType: "text/x-ini",
      sourceUri: input.sourceUri,
      filename: input.filename,
      contentHash: createHash("sha256").update(input.data).digest("hex"),
      byteLength: input.data.byteLength,
      extractedAt: new Date().toISOString(),
      sections,
      metadata: {},
      warnings: [],
    };
  },
};

const registry = createExtractorRegistry();
for (const extractor of listBuiltInExtractors()) registry.register(extractor);
registry.register(iniExtractor);

const content = "name = Widget Pro\nprice = 49.99\ncategory = Hardware\n";
const input = await resolveInput({
  kind: "text",
  content,
  name: "config.ini",
  mediaType: "text/x-ini",
});
const { document } = await extractDocument(input, {}, { registry });

const chunks = chunkDocument(document, { strategy: "sections" });
const { envelope } = mapDocumentsToContext({
  documents: [document],
  chunksByDocumentId: new Map([[document.id, chunks]]),
});

console.log(`Extractor used: ${iniExtractor.id}`);
console.log(`Sections: ${document.sections.map((s) => `${s.title}=${s.content}`).join(", ")}`);
console.log(`Resources in envelope: ${envelope.resources.length}`);
