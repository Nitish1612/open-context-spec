import { readFileSync, writeFileSync } from "node:fs";

/** Reads a file, or stdin when `source` is "-". */
export function readInput(source: string): string {
  if (source === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(source, "utf8");
}

/** Writes to a file, or stdout when `destination` is omitted/"-". */
export function writeOutput(destination: string | undefined, content: string): void {
  const text = content.endsWith("\n") ? content : content + "\n";
  if (!destination || destination === "-") {
    process.stdout.write(text);
  } else {
    writeFileSync(destination, text, "utf8");
  }
}

export function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Failed to parse ${label} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
