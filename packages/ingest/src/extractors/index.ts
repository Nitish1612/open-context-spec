import type { ContentExtractor } from "../types.js";
import { csvExtractor, tsvExtractor } from "./csv.js";
import { docxExtractor } from "./docx.js";
import { htmlExtractor } from "./html.js";
import { jsonExtractor } from "./json.js";
import { jsonlExtractor } from "./jsonl.js";
import { markdownExtractor } from "./markdown.js";
import { pdfExtractor } from "./pdf.js";
import { pptxExtractor } from "./pptx.js";
import { textExtractor } from "./text.js";
import { xlsxExtractor } from "./xlsx.js";
import { xmlExtractor } from "./xml.js";

export function builtInExtractors(): ContentExtractor[] {
  return [
    textExtractor,
    markdownExtractor,
    jsonExtractor,
    jsonlExtractor,
    csvExtractor,
    tsvExtractor,
    htmlExtractor,
    xmlExtractor,
    pdfExtractor,
    docxExtractor,
    pptxExtractor,
    xlsxExtractor,
  ];
}

export {
  textExtractor,
  markdownExtractor,
  jsonExtractor,
  jsonlExtractor,
  csvExtractor,
  tsvExtractor,
  htmlExtractor,
  xmlExtractor,
  pdfExtractor,
  docxExtractor,
  pptxExtractor,
  xlsxExtractor,
};
