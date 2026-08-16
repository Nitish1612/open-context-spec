import { fileURLToPath } from "node:url";
import { ingestDirectory } from "../../../packages/ingest/dist/index.js";

const dir = fileURLToPath(new URL(".", import.meta.url));
const result = await ingestDirectory(dir, { recursive: true });

console.log(`Processed: ${result.report.directorySummary.processed}`);
console.log(`Failed: ${result.report.directorySummary.failed}`);
for (const doc of result.documents) {
  console.log(`- ${doc.filename} (${doc.mediaType}), sourceUri=${doc.sourceUri}`);
}
