/**
 * ULCS benchmark harness. Compares four representations of the same
 * underlying context:
 *
 *   1. unstructured  — a flattened prompt string (what many apps ship today)
 *   2. basic-json    — an ad hoc JSON object with no standard schema
 *   3. ulcs-normalized — a validated, normalized ContextEnvelope
 *   4. ulcs-compiled  — the ULCS-normalized context compiled and rendered
 *                        through the OpenAI adapter
 *
 * It measures only what can be measured honestly from the artifacts
 * themselves: schema validation, token-count estimates, substring-level
 * information/citation preservation, whether untrusted content stays
 * isolated from the instruction channel in the final rendered text,
 * deterministic ordering, required-item retention, per-adapter rendering
 * loss, and construction latency on this machine. It does NOT claim any
 * model-accuracy improvement — see benchmark/README.md and
 * specification/v1/specification.md#2-non-goals.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeContext } from "@ulcs/core";
import { compileContext, getItemText } from "@ulcs/compiler";
import {
  toAnthropicMessages,
  toGeminiContents,
  toGenericChatMessages,
  toMarkdownPrompt,
  toOpenAIMessages,
} from "@ulcs/adapters";
import { validateContext } from "@ulcs/validator";
import { BENCHMARK_CASES } from "./cases.js";
import { estimatedTokens, substringCoverage, timed } from "./metrics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASOF = new Date("2026-08-15T12:00:00Z");

interface RepresentationResult {
  representation: string;
  validation: "valid" | "invalid" | "n/a (no schema)";
  estimatedTokens: number;
  informationPreservation: number;
  citationPreservation: number;
  untrustedContentIsolatedFromInstructions: boolean | "n/a";
  requiredFactRetention: boolean | "n/a";
  constructionLatencyMs: number;
}

function naiveJsonAssembly(basicJson: Record<string, unknown>): string {
  const instructions = String(basicJson.instructions ?? "");
  const facts = Array.isArray(basicJson.facts) ? (basicJson.facts as string[]) : [];
  const retrieved = Array.isArray(basicJson.retrieved) ? (basicJson.retrieved as string[]) : [];
  const userMessage = String(basicJson.userMessage ?? "");
  return [instructions, ...facts, ...retrieved, `User: ${userMessage}`].join("\n\n");
}

function evaluateCase(benchmarkCase: (typeof BENCHMARK_CASES)[number]) {
  const results: RepresentationResult[] = [];

  // 1. Unstructured
  {
    const { value: text, elapsedMs } = timed(() => benchmarkCase.unstructuredPrompt);
    results.push({
      representation: "unstructured",
      validation: "n/a (no schema)",
      estimatedTokens: estimatedTokens(text),
      informationPreservation: substringCoverage(text, benchmarkCase.requiredFacts),
      citationPreservation: substringCoverage(text, benchmarkCase.citations),
      untrustedContentIsolatedFromInstructions: false,
      requiredFactRetention: "n/a",
      constructionLatencyMs: elapsedMs,
    });
  }

  // 2. Basic JSON (naively assembled into a final prompt, as most ad hoc pipelines do)
  {
    const { elapsedMs } = timed(() => naiveJsonAssembly(benchmarkCase.basicJson));
    const structuredText = JSON.stringify(benchmarkCase.basicJson);
    results.push({
      representation: "basic-json",
      validation: "n/a (no schema)",
      estimatedTokens: estimatedTokens(structuredText),
      informationPreservation: substringCoverage(structuredText, benchmarkCase.requiredFacts),
      citationPreservation: substringCoverage(structuredText, benchmarkCase.citations),
      untrustedContentIsolatedFromInstructions: false,
      requiredFactRetention: "n/a",
      constructionLatencyMs: elapsedMs,
    });
  }

  // 3. ULCS-normalized
  const { value: normalized, elapsedMs: normalizeMs } = timed(() =>
    normalizeContext(benchmarkCase.ulcsContext),
  );
  {
    const text = JSON.stringify(normalized);
    const validation = validateContext(normalized);
    results.push({
      representation: "ulcs-normalized",
      validation: validation.valid ? "valid" : "invalid",
      estimatedTokens: estimatedTokens(text),
      informationPreservation: substringCoverage(text, benchmarkCase.requiredFacts),
      citationPreservation: substringCoverage(text, benchmarkCase.citations),
      untrustedContentIsolatedFromInstructions: "n/a",
      requiredFactRetention: "n/a",
      constructionLatencyMs: normalizeMs,
    });
  }

  // 4. ULCS-compiled, rendered through the OpenAI adapter
  const { value: compiled, elapsedMs: compileMs } = timed(() =>
    compileContext(normalized, { asOf: ASOF }),
  );
  const compiledAgain = compileContext(normalized, { asOf: ASOF });
  const deterministicOrdering = JSON.stringify(compiled) === JSON.stringify(compiledAgain);

  {
    const { value: openaiResult, elapsedMs: renderMs } = timed(() => toOpenAIMessages(compiled));
    const text = JSON.stringify(openaiResult.messages);
    const systemLikeText = openaiResult.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content)
      .join("\n");
    const untrustedItemTexts = compiled.sections
      .flatMap((section) => section.items)
      .filter((i) => i.item.trust?.level === "untrusted")
      .map((i) => getItemText(i.item))
      .filter((text) => text.length > 0);
    const untrustedIsolated = untrustedItemTexts.every((text) => !systemLikeText.includes(text));
    const requiredFactRetention = benchmarkCase.requiredItemIds.every((id) =>
      compiled.sections.some((section) => section.items.some((item) => item.item.id === id)),
    );

    results.push({
      representation: "ulcs-compiled (openai adapter)",
      validation: "valid",
      estimatedTokens: estimatedTokens(text),
      informationPreservation: substringCoverage(text, benchmarkCase.requiredFacts),
      citationPreservation: substringCoverage(JSON.stringify(compiled), benchmarkCase.citations),
      untrustedContentIsolatedFromInstructions: untrustedIsolated,
      requiredFactRetention,
      constructionLatencyMs: normalizeMs + compileMs + renderMs,
    });
  }

  // Per-adapter rendering-loss check: what fraction of each included item's
  // text survives, verbatim, into each adapter's final rendered output?
  const includedItemTexts = compiled.sections.flatMap((section) =>
    section.items.map((i) => getItemText(i.item)),
  );
  const adapterOutputs: Record<string, string> = {
    openai: JSON.stringify(toOpenAIMessages(compiled)),
    anthropic: JSON.stringify(toAnthropicMessages(compiled)),
    gemini: JSON.stringify(toGeminiContents(compiled)),
    generic: JSON.stringify(toGenericChatMessages(compiled)),
    markdown: toMarkdownPrompt(compiled),
  };
  const adapterLoss: Record<string, number> = {};
  for (const [target, text] of Object.entries(adapterOutputs)) {
    const nonEmptyTexts = includedItemTexts.filter((t) => t.length > 0);
    const preserved = nonEmptyTexts.filter((t) => text.includes(t)).length;
    adapterLoss[target] = nonEmptyTexts.length === 0 ? 0 : 1 - preserved / nonEmptyTexts.length;
  }

  return {
    id: benchmarkCase.id,
    description: benchmarkCase.description,
    results,
    deterministicOrdering,
    adapterLoss,
  };
}

function formatRow(cells: (string | number | boolean)[]): string {
  return cells.map((c) => String(c)).join(" | ");
}

function main() {
  const allResults = BENCHMARK_CASES.map(evaluateCase);

  for (const caseResult of allResults) {
    console.log(`\n=== ${caseResult.id} ===`);
    console.log(caseResult.description);
    console.log(
      formatRow([
        "representation",
        "validation",
        "tokens~",
        "info%",
        "citation%",
        "untrustedIsolated",
        "requiredRetained",
        "ms",
      ]),
    );
    for (const r of caseResult.results) {
      console.log(
        formatRow([
          r.representation,
          r.validation,
          r.estimatedTokens,
          Math.round(r.informationPreservation * 100),
          Math.round(r.citationPreservation * 100),
          String(r.untrustedContentIsolatedFromInstructions),
          String(r.requiredFactRetention),
          r.constructionLatencyMs.toFixed(2),
        ]),
      );
    }
    console.log(`deterministic ordering (compile x2): ${caseResult.deterministicOrdering}`);
    console.log(
      `per-adapter item-text preservation loss: ${JSON.stringify(caseResult.adapterLoss)}`,
    );
  }

  const outDir = path.resolve(here, "../results");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest.json");
  writeFileSync(outFile, JSON.stringify(allResults, null, 2));
  console.log(`\nFull results written to ${path.relative(process.cwd(), outFile)}`);
}

main();
