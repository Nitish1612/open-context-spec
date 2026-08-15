/**
 * Packed-package smoke test ("release readiness" check).
 *
 * Builds every publishable package, packs each with `pnpm pack`, installs
 * the resulting tarballs into a fresh consumer project created in the OS
 * temp directory (i.e. genuinely outside this monorepo's package
 * structure), and exercises the installed packages exactly as an external
 * consumer would: imports, TypeScript declarations, context
 * creation/validation/compilation, all six provider adapters, and every
 * documented `ulcs` CLI command. Deletes all temporary artifacts when
 * done.
 *
 * NOTE ON NETWORK ACCESS: unlike the rest of this repository's test suite,
 * this script requires network access. `@ulcs/validator`, `@ulcs/cli`, and
 * friends depend on real, externally-published npm packages (`ajv`,
 * `ajv-formats`, `commander`) that are not bundled — installing them into
 * a fresh consumer project via `npm install` fetches them from the npm
 * registry, the same as any real user installing these packages would
 * experience. This is intentional: it is what makes this check meaningful
 * as a release-readiness gate, distinct from the network-free unit test
 * suite (`pnpm run test`).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const PACKAGES = ["core", "validator", "compiler", "adapters", "cli"] as const;
type PackageName = (typeof PACKAGES)[number];

const NPM_NAME: Record<PackageName, string> = {
  core: "@ulcs/core",
  validator: "@ulcs/validator",
  compiler: "@ulcs/compiler",
  adapters: "@ulcs/adapters",
  cli: "@ulcs/cli",
};

function step(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function run(command: string, cwd: string): string {
  try {
    return execSync(command, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    console.error(`Command failed in ${cwd}: ${command}`);
    if (err.stdout) console.error(`--- stdout ---\n${err.stdout}`);
    if (err.stderr) console.error(`--- stderr ---\n${err.stderr}`);
    throw new Error(`Command failed: ${command}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main(): Promise<void> {
  let consumerDir: string | undefined;
  let tarballDir: string | undefined;

  try {
    step("1/12: Build every package");
    run("pnpm run build", repoRoot);

    step("2/12: pnpm pack every publishable package");
    tarballDir = mkdtempSync(path.join(os.tmpdir(), "ocs-tarballs-"));
    const tarballPaths: Record<PackageName, string> = {} as Record<PackageName, string>;
    for (const pkg of PACKAGES) {
      const pkgDir = path.join(repoRoot, "packages", pkg);
      const output = run(`pnpm pack --pack-destination "${tarballDir}"`, pkgDir);
      const lastLine = output.split("\n").filter(Boolean).pop() ?? "";
      const tarballPath = path.isAbsolute(lastLine) ? lastLine : path.join(tarballDir, lastLine);
      assert(existsSync(tarballPath), `expected tarball at ${tarballPath} for ${pkg}`);
      tarballPaths[pkg] = tarballPath;
      console.log(`  packed ${NPM_NAME[pkg]} -> ${path.basename(tarballPath)}`);
    }

    step("3/12: Create a consumer project outside the monorepo");
    consumerDir = mkdtempSync(path.join(os.tmpdir(), "ocs-packed-consumer-"));
    assert(!consumerDir.startsWith(repoRoot), "consumer directory must be outside the monorepo");
    writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify(
        { name: "ocs-packed-consumer", version: "0.0.0", private: true, type: "module" },
        null,
        2,
      ),
    );
    console.log(`  consumer project: ${consumerDir}`);

    step("4/12: Install the packed tarballs (requires network access for real transitive deps)");
    const installArgs = PACKAGES.map((pkg) => `"${tarballPaths[pkg]}"`).join(" ");
    run(`npm install ${installArgs} --no-audit --no-fund --loglevel=error`, consumerDir);
    for (const pkg of PACKAGES) {
      const installedDir = path.join(consumerDir, "node_modules", "@ulcs", pkg);
      assert(
        existsSync(installedDir),
        `${NPM_NAME[pkg]} was not installed into the consumer project`,
      );
    }

    step("5/12: Verify package imports (ESM, no monorepo path in reach)");
    const importsScript = `
import { createContext, normalizeContext, mergeContexts } from "@ulcs/core";
import { validateContext } from "@ulcs/validator";
import { compileContext } from "@ulcs/compiler";
import { toOpenAIMessages, toAnthropicMessages, toGeminiContents, toGenericChatMessages, toMarkdownPrompt, toMCPResource } from "@ulcs/adapters";

const REPO_ROOT = ${JSON.stringify(repoRoot)};

for (const [name, fn] of Object.entries({ createContext, normalizeContext, mergeContexts, validateContext, compileContext, toOpenAIMessages, toAnthropicMessages, toGeminiContents, toGenericChatMessages, toMarkdownPrompt, toMCPResource })) {
  if (typeof fn !== "function") throw new Error(\`\${name} did not import as a function\`);
}

const ctx = createContext({
  instructions: [
    { id: "urn:ulcs:instr:1", "@type": "Instruction", authority: "system", content: "Be concise.", trust: { level: "trusted", providesInstructions: true } },
  ],
  facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "The customer is on the Pro plan." }],
  tokenPolicy: { maxContextTokens: 2000, reservedOutputTokens: 200 },
});

const normalized = normalizeContext(ctx);
const validation = validateContext(normalized);
if (!validation.valid) throw new Error("expected a valid context: " + JSON.stringify(validation.errors));

const compiled = compileContext(normalized);
if (compiled.totalEstimatedTokens <= 0) throw new Error("expected a positive token estimate");

const targets = {
  openai: toOpenAIMessages(compiled),
  anthropic: toAnthropicMessages(compiled),
  gemini: toGeminiContents(compiled),
  generic: toGenericChatMessages(compiled),
  markdown: toMarkdownPrompt(compiled),
  mcp: toMCPResource(compiled),
};
for (const [name, output] of Object.entries(targets)) {
  if (!output) throw new Error(\`adapter \${name} produced no output\`);
}

// Confirm nothing resolved back into the monorepo source tree.
const paths = [
  import.meta.resolve("@ulcs/core"),
  import.meta.resolve("@ulcs/validator"),
  import.meta.resolve("@ulcs/compiler"),
  import.meta.resolve("@ulcs/adapters"),
];
for (const p of paths) {
  if (p.includes(REPO_ROOT)) throw new Error(\`resolved module path leaks into the monorepo: \${p}\`);
}

console.log("OK: imports, context creation/validation/compilation, and all six adapters work standalone.");
`;
    writeFileSync(path.join(consumerDir, "test-imports.mjs"), importsScript);
    console.log(run("node test-imports.mjs", consumerDir));

    step("6/12: Verify TypeScript declarations resolve correctly");
    const typesScript = `
import { createContext, ContextEnvelope, Fact } from "@ulcs/core";
import { validateContext, ValidationResult } from "@ulcs/validator";
import { compileContext, CompiledContext } from "@ulcs/compiler";
import { toOpenAIMessages, OpenAICompiledRequest } from "@ulcs/adapters";

const fact: Fact = { id: "urn:ulcs:fact:1", "@type": "Fact", content: "typed" };
const ctx: ContextEnvelope = createContext({ facts: [fact] });
const result: ValidationResult = validateContext(ctx);
const compiled: CompiledContext = compileContext(ctx);
const rendered: OpenAICompiledRequest = toOpenAIMessages(compiled);
console.log(result.valid, compiled.totalEstimatedTokens, rendered.messages.length);
`;
    writeFileSync(path.join(consumerDir, "test-types.ts"), typesScript);
    writeFileSync(
      path.join(consumerDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["test-types.ts"],
        },
        null,
        2,
      ),
    );
    const repoTsc = path.join(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsc.cmd" : "tsc",
    );
    assert(
      existsSync(repoTsc),
      `expected ${repoTsc} to exist (run pnpm install at the repo root first)`,
    );
    run(`"${repoTsc}" --project tsconfig.json`, consumerDir);
    console.log("OK: TypeScript declarations type-check against a standalone consumer.");

    step("7/12 & 8/12: create/validate a context and compile under a token budget (covered above)");
    console.log("OK: covered by step 5.");

    step(
      "9/12: Provider outputs already produced for OpenAI, Anthropic, Gemini, generic, Markdown, and MCP (covered above)",
    );

    step("10/12: Run the installed CLI (validate, normalize, compile, redact, diff)");
    const cliBin = path.join(consumerDir, "node_modules", "@ulcs", "cli", "dist", "bin.js");
    assert(existsSync(cliBin), `expected installed CLI at ${cliBin}`);

    const sampleContext = {
      "@context": "https://ulcs.dev/context/v1",
      "@type": "ContextEnvelope",
      schemaVersion: "1.0.0",
      id: "urn:ulcs:context:packed-smoke-test",
      createdAt: "2026-08-15T12:00:00Z",
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "Card on file: secret value.",
          sensitivity: { level: "secret" },
        },
      ],
    };
    const sampleContextPath = path.join(consumerDir, "sample.json");
    writeFileSync(sampleContextPath, JSON.stringify(sampleContext, null, 2));
    const sampleContextV2 = {
      ...sampleContext,
      facts: [{ ...sampleContext.facts[0], content: "changed" }],
    };
    const sampleContextV2Path = path.join(consumerDir, "sample-v2.json");
    writeFileSync(sampleContextV2Path, JSON.stringify(sampleContextV2, null, 2));

    const validateOut = run(`node "${cliBin}" validate sample.json`, consumerDir);
    assert(validateOut.includes("valid"), `unexpected validate output: ${validateOut}`);

    run(`node "${cliBin}" normalize sample.json -o normalized.json`, consumerDir);
    assert(
      existsSync(path.join(consumerDir, "normalized.json")),
      "normalize did not produce output",
    );

    run(`node "${cliBin}" compile sample.json --target openai -o compiled.json`, consumerDir);
    assert(existsSync(path.join(consumerDir, "compiled.json")), "compile did not produce output");

    run(`node "${cliBin}" redact sample.json -o redacted.json`, consumerDir);
    const redactedDoc = JSON.parse(readFileSync(path.join(consumerDir, "redacted.json"), "utf8"));
    assert(
      redactedDoc.facts.length === 0,
      "expected the secret-level fact to be excluded by redact",
    );

    try {
      run(`node "${cliBin}" diff sample.json sample-v2.json`, consumerDir);
      throw new Error("expected `diff` to exit non-zero for two differing documents");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("expected `diff`")) throw error;
      // `diff` exits 1 when differences are found — that is expected, not a failure.
    }

    console.log("OK: installed CLI validate/normalize/compile/redact/diff all work.");

    step("11/12: Confirm no runtime path depends on the source monorepo");
    const distFiles = [
      path.join(consumerDir, "node_modules", "@ulcs", "core", "dist", "index.js"),
      path.join(consumerDir, "node_modules", "@ulcs", "validator", "dist", "index.js"),
      path.join(consumerDir, "node_modules", "@ulcs", "compiler", "dist", "index.js"),
      path.join(consumerDir, "node_modules", "@ulcs", "adapters", "dist", "index.js"),
      path.join(consumerDir, "node_modules", "@ulcs", "cli", "dist", "bin.js"),
    ];
    for (const file of distFiles) {
      const content = readFileSync(file, "utf8");
      assert(
        !content.includes(repoRoot),
        `${file} contains a literal reference to the monorepo path`,
      );
    }
    const validatorSchemaFiles = readdirSync(
      path.join(consumerDir, "node_modules", "@ulcs", "validator", "schemas", "v1"),
    );
    assert(
      validatorSchemaFiles.length > 0,
      "expected bundled schemas inside the installed @ulcs/validator package",
    );
    console.log(
      "OK: no dist file references the monorepo's absolute path; validator schemas are bundled.",
    );

    console.log("\nAll packed-package smoke tests passed.");
  } finally {
    step("12/12: Clean up temporary artifacts");
    if (consumerDir && existsSync(consumerDir)) {
      rmSync(consumerDir, { recursive: true, force: true });
      console.log(`  removed ${consumerDir}`);
    }
    if (tarballDir && existsSync(tarballDir)) {
      rmSync(tarballDir, { recursive: true, force: true });
      console.log(`  removed ${tarballDir}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error("\nPacked-package smoke test FAILED:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
