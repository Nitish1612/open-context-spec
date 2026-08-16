import ExcelJS from "exceljs";
import { ExtractionError } from "../errors.js";
import { assertWithinCount, resolveLimits } from "../security/limits.js";
import { inspectOfficeArchive } from "../security/officeArchive.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, warn } from "./util.js";

const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralizes leading characters (`=`, `+`, `-`, `@`, tab, CR) that
 * spreadsheet applications interpret as the start of a formula, so text
 * extracted here is safe to round-trip through a spreadsheet later without
 * becoming an executable formula ("CSV/formula injection").
 */
function neutralizeFormulaInjection(value: string): string {
  if (FORMULA_INJECTION_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return `'${value}`;
  }
  return value;
}

function cellText(cell: ExcelJS.Cell): { text: string; formula?: string } {
  const value = cell.value;
  if (value === null || value === undefined) return { text: "" };
  if (typeof value === "object" && value !== null && "formula" in value) {
    const formulaValue = value as ExcelJS.CellFormulaValue;
    const result = formulaValue.result;
    const resultText =
      result === undefined || result === null
        ? ""
        : typeof result === "object"
          ? JSON.stringify(result)
          : String(result);
    return { text: neutralizeFormulaInjection(resultText), formula: formulaValue.formula };
  }
  if (typeof value === "object" && value !== null && "richText" in value) {
    const rich = value as ExcelJS.CellRichTextValue;
    return { text: neutralizeFormulaInjection(rich.richText.map((r) => r.text).join("")) };
  }
  if (value instanceof Date) return { text: value.toISOString() };
  if (typeof value === "object") return { text: neutralizeFormulaInjection(JSON.stringify(value)) };
  return { text: neutralizeFormulaInjection(String(value)) };
}

const ROWS_PER_SECTION = 50;

export const xlsxExtractor: ContentExtractor = {
  id: "xlsx",
  name: "Excel workbook (XLSX)",
  extensions: [".xlsx"],
  mediaTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],

  supports(input) {
    return (
      input.mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      /\.xlsx$/i.test(input.filename ?? "")
    );
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("XLSX extractor requires resolved byte content.");

    // Preflight the archive's central directory (entry count, total
    // uncompressed size, per-entry compression ratio, entry-name safety)
    // BEFORE handing the bytes to ExcelJS, which otherwise decompresses
    // the entire workbook eagerly inside `.load()` with no size checks of
    // its own — this is what actually stops a compression-bomb XLSX from
    // being decompressed in the first place.
    await inspectOfficeArchive(input.data, limits);

    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs parses the OOXML package declaratively; it never evaluates
      // formulas, runs macros, or follows external workbook links/connections.
      // Two @types/node versions are reachable in this workspace's node_modules
      // (root vs. exceljs's own nested copy), which makes their ambient
      // `Buffer` types structurally incompatible in TS despite being
      // identical at runtime; deriving the parameter type from the function
      // itself (rather than naming `Buffer` ourselves) sidesteps that.
      await workbook.xlsx.load(
        Buffer.from(input.data) as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
    } catch (error) {
      throw new ExtractionError(
        `Failed to open XLSX (malformed container): ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    assertWithinCount(workbook.worksheets.length, limits.maxSheets, "XLSX sheet count");

    const warnings = [];
    const sections: ExtractedSection[] = [];
    let sectionIndex = 0;
    let totalRows = 0;

    for (const sheet of workbook.worksheets) {
      const rowCount = sheet.rowCount;
      totalRows += rowCount;
      if (totalRows > limits.maxRows) {
        warnings.push(
          warn(
            "truncated",
            `Row limit (${limits.maxRows}) reached; remaining sheets/rows were skipped.`,
            {
              sheet: sheet.name,
            },
          ),
        );
        break;
      }

      const headerRow = sheet.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = cellText(cell).text || `col${colNumber}`;
      });

      let batchStart = 2;
      let batchLines: string[] = [];
      const flushBatch = (endRow: number) => {
        if (batchLines.length === 0) return;
        sections.push({
          id: `section:${sectionIndex++}`,
          sheet: sheet.name,
          rowStart: batchStart,
          rowEnd: endRow,
          content: batchLines.join("\n\n"),
          metadata: { headers },
        });
        batchLines = [];
      };

      for (let rowNumber = 2; rowNumber <= rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber);
        const cellsText: string[] = [];
        let hasFormula = false;
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const { text, formula } = cellText(cell);
          if (formula) hasFormula = true;
          const header = headers[colNumber - 1] ?? `col${colNumber}`;
          if (text) cellsText.push(`${header}: ${text}${formula ? ` (formula: ${formula})` : ""}`);
        });
        if (cellsText.length > 0) batchLines.push(cellsText.join("\n"));
        void hasFormula;

        if (rowNumber - batchStart + 1 >= ROWS_PER_SECTION || rowNumber === rowCount) {
          flushBatch(rowNumber);
          batchStart = rowNumber + 1;
        }
      }

      if (rowCount <= 1) {
        warnings.push(
          warn("empty-content", `Sheet "${sheet.name}" has no data rows.`, { sheet: sheet.name }),
        );
      }
    }

    if (sections.length === 0) {
      warnings.push(warn("empty-content", "No extractable rows found in this workbook."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: input.data,
      sections,
      metadata: { sheetNames: workbook.worksheets.map((s) => s.name) },
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
