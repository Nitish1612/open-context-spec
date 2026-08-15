import { Command } from "commander";
import { applyContextPatch, compareContexts, normalizeContext, redactContext } from "@ulcs/core";
import type { ContextEnvelope, ContextPatch, TokenPolicy } from "@ulcs/core";
import { compileContext } from "@ulcs/compiler";
import {
  toAnthropicMessages,
  toGeminiContents,
  toGenericChatMessages,
  toMarkdownPrompt,
  toMCPResource,
  toOpenAIMessages,
} from "@ulcs/adapters";
import {
  formatValidationErrors,
  validateContext,
  validateContextItem,
  validateContextPatch,
} from "@ulcs/validator";
import { parseJson, readInput, writeOutput } from "./io.js";

export const CLI_VERSION = "0.1.0";

const TARGETS = ["openai", "anthropic", "gemini", "generic", "markdown", "mcp"] as const;
type Target = (typeof TARGETS)[number];

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("ulcs")
    .description("Universal LLM Context Schema (ULCS) command-line tool")
    .version(CLI_VERSION);

  program
    .command("validate")
    .description("Validate a document against the ULCS v1 schema")
    .argument("<file>", 'input file, or "-" for stdin')
    .option("--kind <kind>", "document kind: envelope|item|patch", "envelope")
    .option("--json", "print machine-readable JSON result", false)
    .action((file: string, opts: { kind: string; json: boolean }) => {
      let document: unknown;
      try {
        document = parseJson(readInput(file), file);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }

      const result =
        opts.kind === "item"
          ? validateContextItem(document)
          : opts.kind === "patch"
            ? validateContextPatch(document)
            : validateContext(document);

      if (opts.json) {
        writeOutput(undefined, JSON.stringify(result, null, 2));
      } else if (result.valid) {
        console.log(`✓ valid (${opts.kind})`);
      } else {
        console.error(`✗ invalid (${opts.kind})`);
        for (const line of formatValidationErrors(result.errors)) {
          console.error(`  ${line}`);
        }
      }
      process.exitCode = result.valid ? 0 : 1;
    });

  program
    .command("normalize")
    .description("Normalize a ContextEnvelope (fill defaults, canonicalize tags/scope)")
    .argument("<file>", 'input file, or "-" for stdin')
    .option("-o, --output <file>", "output file (default: stdout)")
    .action((file: string, opts: { output?: string }) => {
      const document = parseJson(readInput(file), file) as ContextEnvelope;
      const normalized = normalizeContext(document);
      writeOutput(opts.output, JSON.stringify(normalized, null, 2));
    });

  program
    .command("compile")
    .description(
      "Compile a ContextEnvelope under its token policy and render it for a provider target",
    )
    .argument("<file>", 'input file, or "-" for stdin')
    .requiredOption("--target <target>", `one of: ${TARGETS.join(", ")}`)
    .option("--max-tokens <n>", "override tokenPolicy.maxContextTokens", (v) => Number(v))
    .option("--reserved-output <n>", "override tokenPolicy.reservedOutputTokens", (v) => Number(v))
    .option("-o, --output <file>", "output file (default: stdout)")
    .action(
      (
        file: string,
        opts: { target: string; maxTokens?: number; reservedOutput?: number; output?: string },
      ) => {
        if (!TARGETS.includes(opts.target as Target)) {
          console.error(`Unknown target "${opts.target}". Expected one of: ${TARGETS.join(", ")}`);
          process.exitCode = 2;
          return;
        }
        const document = parseJson(readInput(file), file) as ContextEnvelope;
        const overrides: Partial<TokenPolicy> = {};
        if (opts.maxTokens !== undefined) overrides.maxContextTokens = opts.maxTokens;
        if (opts.reservedOutput !== undefined) overrides.reservedOutputTokens = opts.reservedOutput;

        const compiled = compileContext(document, { tokenPolicyOverrides: overrides });

        let rendered: string;
        switch (opts.target as Target) {
          case "openai":
            rendered = JSON.stringify(toOpenAIMessages(compiled), null, 2);
            break;
          case "anthropic":
            rendered = JSON.stringify(toAnthropicMessages(compiled), null, 2);
            break;
          case "gemini":
            rendered = JSON.stringify(toGeminiContents(compiled), null, 2);
            break;
          case "generic":
            rendered = JSON.stringify(toGenericChatMessages(compiled), null, 2);
            break;
          case "markdown":
            rendered = toMarkdownPrompt(compiled);
            break;
          case "mcp":
            rendered = JSON.stringify(toMCPResource(compiled), null, 2);
            break;
        }

        writeOutput(opts.output, rendered);
        for (const warning of compiled.warnings) {
          console.error(`warning: ${warning.message}`);
        }
        for (const error of compiled.errors) {
          console.error(`error: ${error.message}`);
        }
        if (compiled.errors.length > 0) process.exitCode = 1;
      },
    );

  program
    .command("redact")
    .description("Apply sensitivity.handling rules to a ContextEnvelope")
    .argument("<file>", 'input file, or "-" for stdin')
    .option(
      "--policy <boundary>",
      "boundary name to match against sensitivity handling[].appliesTo (see specification/v1/security.md); omit to apply only universal rules",
    )
    .option("-o, --output <file>", "output file (default: stdout)")
    .action((file: string, opts: { policy?: string; output?: string }) => {
      const document = parseJson(readInput(file), file) as ContextEnvelope;
      const result = redactContext(document, { boundary: opts.policy });
      writeOutput(opts.output, JSON.stringify(result.context, null, 2));
      if (result.requiresConsent.length > 0) {
        console.error(
          `note: ${result.requiresConsent.length} item(s) flagged require-consent, still present in output.`,
        );
      }
      if (result.localOnly.length > 0) {
        console.error(
          `note: ${result.localOnly.length} item(s) flagged local-only — do not forward these externally.`,
        );
      }
    });

  program
    .command("diff")
    .description("Show a deterministic, item-level diff between two ContextEnvelope documents")
    .argument("<old>", 'baseline file, or "-" for stdin')
    .argument("<new>", "updated file")
    .option("--json", "print machine-readable JSON result", false)
    .action((oldFile: string, newFile: string, opts: { json: boolean }) => {
      const before = parseJson(readInput(oldFile), oldFile) as ContextEnvelope;
      const after = parseJson(readInput(newFile), newFile) as ContextEnvelope;
      const diff = compareContexts(before, after);

      if (opts.json) {
        writeOutput(undefined, JSON.stringify(diff, null, 2));
      } else if (diff.entries.length === 0 && diff.envelopeFieldsChanged.length === 0) {
        console.log("No differences.");
      } else {
        for (const entry of diff.entries) {
          console.log(`${entry.kind}\t${entry.arrayKey}/${entry.id}`);
        }
        for (const field of diff.envelopeFieldsChanged) {
          console.log(`changed\tenvelope.${field}`);
        }
      }
      process.exitCode = diff.entries.length > 0 || diff.envelopeFieldsChanged.length > 0 ? 1 : 0;
    });

  program
    .command("patch")
    .description("Apply a ContextPatch (RFC 6902 operations) to a ContextEnvelope")
    .argument("<file>", 'context file, or "-" for stdin')
    .requiredOption("--patch <patchFile>", "ContextPatch document")
    .option("-o, --output <file>", "output file (default: stdout)")
    .action((file: string, opts: { patch: string; output?: string }) => {
      const document = parseJson(readInput(file), file) as ContextEnvelope;
      const patch = parseJson(readInput(opts.patch), opts.patch) as ContextPatch;
      try {
        const patched = applyContextPatch(document, patch);
        writeOutput(opts.output, JSON.stringify(patched, null, 2));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  return program;
}
