#!/usr/bin/env node
import { buildProgram } from "./program.js";

buildProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
