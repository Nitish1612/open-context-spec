import { fileURLToPath } from "node:url";
import { ingestFile } from "../../../packages/ingest/dist/index.js";

const csvPath = fileURLToPath(new URL("./employees.csv", import.meta.url));
const result = await ingestFile(csvPath, { strategy: "rows" });

console.log(`Rows extracted: ${result.documents[0].sections.length}`);
for (const chunk of result.chunks) {
  console.log(`chunk[${chunk.index}] rows ${chunk.rowStart}-${chunk.rowEnd}:\n${chunk.content}\n`);
}
