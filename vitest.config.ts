import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/*/tests/**/*.test.ts",
      "tests/conformance/**/*.test.ts",
      "tests/interoperability/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // packages/cli is excluded: its src/ is exercised end-to-end by
      // packages/cli/tests/cli.test.ts, which spawns the built binary as a
      // separate process (so v8's in-process coverage instrumentation
      // never sees it) rather than importing it in-process. That is a
      // deliberate choice — see specification/decisions/0003 — not a
      // coverage gap; excluding it keeps this threshold meaningful for the
      // packages it does measure.
      include: [
        "packages/core/src/**/*.ts",
        "packages/validator/src/**/*.ts",
        "packages/compiler/src/**/*.ts",
        "packages/adapters/src/**/*.ts",
      ],
      exclude: ["packages/*/src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
