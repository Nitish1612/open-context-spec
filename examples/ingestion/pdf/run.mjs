import { ingestBuffer } from "../../../packages/ingest/dist/index.js";
import { minimalPdfBytes } from "./make-pdf.mjs";

const bytes = minimalPdfBytes("Hello from a generated PDF");
const result = await ingestBuffer(bytes, {
  filename: "generated.pdf",
  mediaType: "application/pdf",
});

for (const section of result.documents[0].sections) {
  console.log(`page ${section.page}: ${section.content}`);
}
console.log(
  `Warnings: ${result.documents[0].warnings.map((w) => w.message).join(", ") || "(none)"}`,
);
