import { ExtractionError } from "../errors.js";
import { assertWithinCharLimit, assertWithinCount, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, decodeUtf8Strict, warn } from "./util.js";

/**
 * RFC 4180-ish delimited-text parser: handles quoted fields (with escaped
 * `""`), embedded newlines inside quotes, and a configurable delimiter (so
 * this same parser backs both CSV and TSV). Returns rows of raw string
 * fields; the caller assigns header/data semantics.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) pushRow();

  // Drop a single trailing fully-empty row (common with a trailing newline).
  const last = rows[rows.length - 1];
  if (last && last.length === 1 && last[0] === "") rows.pop();

  return rows;
}

function makeCsvExtractor(
  id: string,
  name: string,
  extensions: string[],
  mediaTypes: string[],
  defaultDelimiter: string,
): ContentExtractor {
  return {
    id,
    name,
    extensions,
    mediaTypes,

    supports(input) {
      return (
        mediaTypes.includes(input.mediaType ?? "") ||
        extensions.some((ext) => (input.filename ?? "").toLowerCase().endsWith(ext))
      );
    },

    async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
      const limits = resolveLimits(options.limits);
      if (!input.data)
        throw new ExtractionError(`${name} extractor requires resolved byte content.`);

      const { text, hadInvalidSequences } = decodeUtf8Strict(input.data);
      assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");

      const delimiter = options.delimiter ?? defaultDelimiter;
      const rows = parseDelimited(text, delimiter);
      const warnings = [];

      if (rows.length === 0) {
        warnings.push(warn("empty-content", `${name} document is empty.`));
        return buildExtractedDocument({
          input,
          mediaType: mediaTypes[0] as string,
          data: input.data,
          sections: [],
          metadata: { headers: [], rowCount: 0, delimiter },
          warnings,
          extractedAt: new Date().toISOString(),
        });
      }

      const headers = rows[0] ?? [];
      const dataRows = rows.slice(1);
      assertWithinCount(dataRows.length, limits.maxRows, `${name} row count`);

      const sections: ExtractedSection[] = dataRows.map((rowFields, index) => {
        const rowNumber = index + 2; // 1-based, header is row 1
        const content = headers
          .map(
            (header, colIndex) => `${header || `col${colIndex + 1}`}: ${rowFields[colIndex] ?? ""}`,
          )
          .join("\n");
        return {
          id: `section:${index}`,
          rowStart: rowNumber,
          rowEnd: rowNumber,
          content,
          metadata: { row: rowFields },
        };
      });

      if (hadInvalidSequences) {
        warnings.push(
          warn(
            "malformed-content",
            "Input contained invalid UTF-8 byte sequences; they were replaced.",
          ),
        );
      }

      return buildExtractedDocument({
        input,
        mediaType: mediaTypes[0] as string,
        data: input.data,
        sections,
        metadata: { headers, rowCount: dataRows.length, delimiter },
        warnings,
        extractedAt: new Date().toISOString(),
      });
    },
  };
}

export const csvExtractor = makeCsvExtractor("csv", "CSV", [".csv"], ["text/csv"], ",");
export const tsvExtractor = makeCsvExtractor(
  "tsv",
  "TSV",
  [".tsv"],
  ["text/tab-separated-values"],
  "\t",
);
