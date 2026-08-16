import { describe, expect, it, vi } from "vitest";
import type * as UnpdfModule from "unpdf";

const renderPageAsImageMock = vi.fn();
vi.mock("unpdf", async () => {
  const actual = await vi.importActual<typeof UnpdfModule>("unpdf");
  return {
    ...actual,
    renderPageAsImage: (...args: unknown[]) => renderPageAsImageMock(...args),
  };
});

// Imported after the mock so `pdfExtractor` picks up the mocked `renderPageAsImage`.
const { pdfExtractor } = await import("../src/index.js");
const { minimalPdfBytes } = await import("./fixtures.js");
import type { OcrProvider, ResolvedInput } from "../src/index.js";

function blankScannedPdf(): Uint8Array {
  // A page with only a non-text drawing operator (no Tj text-show) is treated as image-only.
  return new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 10 >>\nstream\n0 0 0 rg\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF",
  );
}

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}

describe("Defect 1: real OCR provider integration", () => {
  it("renders the scanned page as an image and calls OcrProvider.recognize with the rendered bytes", async () => {
    renderPageAsImageMock.mockReset();
    const fakeImageBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    renderPageAsImageMock.mockResolvedValue(fakeImageBytes);

    const recognizeCalls: Array<{ image: Uint8Array; language: string | undefined }> = [];
    const provider: OcrProvider = {
      id: "fake-ocr",
      recognize: async (image, opts) => {
        recognizeCalls.push({ image, language: opts?.language });
        return "Recognized page text";
      },
    };

    const doc = await pdfExtractor.extract(bufInput(blankScannedPdf(), "scanned.pdf"), {
      ocr: true,
      ocrProvider: provider,
      ocrLanguage: "en",
    });

    expect(renderPageAsImageMock).toHaveBeenCalledTimes(1);
    expect(recognizeCalls).toHaveLength(1);
    expect(recognizeCalls[0]?.image).toEqual(new Uint8Array(fakeImageBytes));
    expect(recognizeCalls[0]?.language).toBe("en");

    const ocrSection = doc.sections.find((s) => s.metadata?.ocr === true);
    expect(ocrSection?.content).toBe("Recognized page text");
    expect(ocrSection?.metadata?.ocrProviderId).toBe("fake-ocr");
    expect(doc.warnings.some((w) => w.code === "unsupported-feature")).toBe(false);
  });

  it("merges OCR-recovered pages with normally-extracted pages in page order", async () => {
    renderPageAsImageMock.mockReset();
    renderPageAsImageMock.mockResolvedValue(new Uint8Array([9]).buffer);
    const provider: OcrProvider = { id: "p", recognize: async () => "ocr text" };

    const { multiPagePdfMixedScanned } = await import("./fixtures.js");
    const bytes = multiPagePdfMixedScanned();
    const doc = await pdfExtractor.extract(bufInput(bytes, "mixed.pdf"), {
      ocr: true,
      ocrProvider: provider,
    });

    const pages = doc.sections.map((s) => s.page);
    const sorted = [...pages].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(pages).toEqual(sorted);
  });

  it("warns (does not throw) when the OCR provider itself throws, and continues", async () => {
    renderPageAsImageMock.mockReset();
    renderPageAsImageMock.mockResolvedValue(new Uint8Array([1]).buffer);
    const provider: OcrProvider = {
      id: "broken",
      recognize: async () => {
        throw new Error("provider exploded");
      },
    };

    const doc = await pdfExtractor.extract(bufInput(blankScannedPdf(), "scanned.pdf"), {
      ocr: true,
      ocrProvider: provider,
    });

    expect(
      doc.warnings.some((w) => w.code === "ocr-unavailable" && w.message.includes("broken")),
    ).toBe(true);
    expect(doc.sections.some((s) => s.metadata?.ocr === true)).toBe(false);
  });

  it("warns (does not throw) when OCR produces empty text", async () => {
    renderPageAsImageMock.mockReset();
    renderPageAsImageMock.mockResolvedValue(new Uint8Array([1]).buffer);
    const provider: OcrProvider = { id: "empty", recognize: async () => "   " };

    const doc = await pdfExtractor.extract(bufInput(blankScannedPdf(), "scanned.pdf"), {
      ocr: true,
      ocrProvider: provider,
    });

    expect(
      doc.warnings.some((w) => w.code === "ocr-unavailable" && w.message.includes("no text")),
    ).toBe(true);
  });

  it("warns with an actionable message (without crashing) when rendering the page fails", async () => {
    renderPageAsImageMock.mockReset();
    renderPageAsImageMock.mockRejectedValue(new Error("Cannot find module '@napi-rs/canvas'"));
    const provider: OcrProvider = { id: "p", recognize: async () => "unreachable" };

    const doc = await pdfExtractor.extract(bufInput(blankScannedPdf(), "scanned.pdf"), {
      ocr: true,
      ocrProvider: provider,
    });

    const renderWarning = doc.warnings.find((w) => w.code === "unsupported-feature");
    expect(renderWarning?.message).toContain("@napi-rs/canvas");
    expect(doc.sections.some((s) => s.metadata?.ocr === true)).toBe(false);
  });

  it("still throws CapabilityUnavailableError when --ocr is set with no provider (no regression)", async () => {
    const { CapabilityUnavailableError } = await import("../src/index.js");
    await expect(
      pdfExtractor.extract(bufInput(blankScannedPdf(), "scanned.pdf"), { ocr: true }),
    ).rejects.toThrow(CapabilityUnavailableError);
    void minimalPdfBytes;
  });
});
