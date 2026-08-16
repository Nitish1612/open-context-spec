import { fileURLToPath } from "node:url";
import { ingestFile } from "../../../packages/ingest/dist/index.js";

const dataPath = fileURLToPath(new URL("./data.json", import.meta.url));
const result = await ingestFile(dataPath);

for (const section of result.documents[0].sections) {
  console.log(`${section.section}: ${section.content}`);
}
console.log(`Chunks: ${result.chunks.length}`);
