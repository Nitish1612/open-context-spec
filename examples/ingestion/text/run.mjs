import { ingestText } from "../../../packages/ingest/dist/index.js";

const result = await ingestText(
  "# Notes\n\nThis is an inline Markdown document with useful content for the example.\n\n## Section Two\n\nMore content here.",
  { name: "notes.md", mediaType: "text/markdown" },
);

console.log(`Resources: ${result.resources.length}`);
console.log(`Default instruction: ${result.envelope.instructions?.[0]?.content}`);
console.log(`First resource trust: ${JSON.stringify(result.envelope.resources?.[0]?.trust)}`);
