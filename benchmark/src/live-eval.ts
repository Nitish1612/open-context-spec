/**
 * OPTIONAL interface for running the benchmark cases against real LLM
 * APIs, using the caller's own credentials via environment variables.
 * Never commit credentials — this file reads keys from process.env only,
 * and does nothing (no network calls) unless ULCS_BENCHMARK_LIVE=1 is set
 * AND a runner's required env var is present.
 *
 * This module intentionally does NOT depend on any provider SDK — you
 * plug your own `LLMRunner` in. It exists to make "run these cases
 * against your own model" possible, not to claim ULCS improves model
 * accuracy (see benchmark/README.md).
 */
import { BENCHMARK_CASES } from "./cases.js";

export interface LLMRunner {
  name: string;
  /** Returns true if this runner has what it needs (e.g. an API key env var) to run. */
  isConfigured: () => boolean;
  /** Sends `prompt` to the model and returns its raw text response. */
  run: (prompt: string) => Promise<string>;
}

/**
 * Example runner stub for an OpenAI-compatible chat completions endpoint.
 * Reads OPENAI_API_KEY from the environment; does nothing if unset. Uses
 * the global `fetch` (Node 18+) rather than the `openai` SDK, to keep this
 * package dependency-free.
 */
export function createOpenAICompatibleRunner(options: {
  name: string;
  apiKeyEnvVar: string;
  baseUrl: string;
  model: string;
}): LLMRunner {
  return {
    name: options.name,
    isConfigured: () => Boolean(process.env[options.apiKeyEnvVar]),
    run: async (prompt: string) => {
      const apiKey = process.env[options.apiKeyEnvVar];
      if (!apiKey) throw new Error(`${options.apiKeyEnvVar} is not set`);
      const response = await fetch(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) {
        throw new Error(
          `${options.name} request failed: ${response.status} ${await response.text()}`,
        );
      }
      const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}

async function main() {
  if (process.env.ULCS_BENCHMARK_LIVE !== "1") {
    console.log(
      "Live evaluation is opt-in. Set ULCS_BENCHMARK_LIVE=1 and configure at least one runner's API key env var to run this.",
    );
    return;
  }

  const runners: LLMRunner[] = [
    createOpenAICompatibleRunner({
      name: "openai",
      apiKeyEnvVar: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    }),
  ];

  const configured = runners.filter((r) => r.isConfigured());
  if (configured.length === 0) {
    console.log(
      "ULCS_BENCHMARK_LIVE=1 was set, but no runner is configured (missing API key env vars). Nothing to do.",
    );
    return;
  }

  for (const runner of configured) {
    console.log(`\n=== Live run: ${runner.name} ===`);
    for (const benchmarkCase of BENCHMARK_CASES) {
      const response = await runner.run(benchmarkCase.unstructuredPrompt);
      console.log(`[${benchmarkCase.id}] response (first 200 chars): ${response.slice(0, 200)}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
