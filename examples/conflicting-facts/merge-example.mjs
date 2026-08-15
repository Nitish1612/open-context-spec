import { readFileSync } from "node:fs";
import { mergeContexts } from "../../packages/core/dist/index.js";

function loadJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const a = loadJson("./context-a.json");
const b = loadJson("./context-b.json");

const { merged, conflicts } = mergeContexts(a, b);

console.log(`Merged fact count: ${merged.facts.length} (both versions retained)`);
console.log(JSON.stringify(conflicts, null, 2));
