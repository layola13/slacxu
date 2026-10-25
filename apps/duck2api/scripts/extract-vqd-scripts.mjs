// Extracts the verbatim JS challenge-runner strings from the Go source so the
// TS port executes byte-identical browser mocks (no hand transcription).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BT = String.fromCharCode(96);
const src = readFileSync("E:/projects/duck2api/internal/duckgo/vqd.go", "utf8");

function extract(constName) {
  const startMarker = `const ${constName} = ${BT}`;
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`const ${constName} not found`);
  const bodyStart = start + startMarker.length;
  const end = src.indexOf(BT, bodyStart);
  if (end < 0) throw new Error(`unterminated const ${constName}`);
  return src.slice(bodyStart, end);
}

for (const name of ["vqdResultMutationScript", "vqdBrowserPrelude"]) {
  const body = extract(name);
  console.log(`${name}: ${body.length} chars`);
}

// Playgame tool-simulation prompt (conversion/requests/duckgo/convert.go).
function extractFrom(file, constName) {
  const fileSrc = readFileSync(file, "utf8");
  const startMarker = `const ${constName} = ${BT}`;
  const start = fileSrc.indexOf(startMarker);
  if (start < 0) throw new Error(`const ${constName} not found in ${file}`);
  const bodyStart = start + startMarker.length;
  const end = fileSrc.indexOf(BT, bodyStart);
  if (end < 0) throw new Error(`unterminated const ${constName}`);
  return fileSrc.slice(bodyStart, end);
}

// Escape for embedding inside a TS template literal so the cooked value is
// byte-identical to the Go raw string (backslash first, then backtick/${}).
function tsEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const outDir = "D:/projects/codex-ultra/apps/duck2api/src/duckgo";
mkdirSync(outDir, { recursive: true });
const out =
  `// AUTO-GENERATED from E:/projects/duck2api/internal/duckgo/vqd.go by scripts/extract-vqd-scripts.mjs.\n` +
  `// Do NOT hand-edit: re-run the extractor to refresh. Backslashes are\n` +
  `// escaped so the cooked template value is byte-identical to the Go raw string.\n` +
  `export const VQD_RESULT_MUTATION_SCRIPT: string = ${BT}${tsEscape(extract("vqdResultMutationScript"))}${BT};\n` +
  `export const VQD_BROWSER_PRELUDE: string = ${BT}${tsEscape(extract("vqdBrowserPrelude"))}${BT};\n`;
writeFileSync(join(outDir, "vqd-scripts.ts"), out, "utf8");
console.log("wrote vqd-scripts.ts");

const promptOut =
  `// AUTO-GENERATED from E:/projects/duck2api/conversion/requests/duckgo/convert.go by scripts/extract-vqd-scripts.mjs.\n` +
  `// Do NOT hand-edit: re-run the extractor to refresh.\n` +
  `export const TOOL_SIMULATION_PROMPT: string = ${BT}${tsEscape(extractFrom("E:/projects/duck2api/conversion/requests/duckgo/convert.go", "toolSimulationPrompt"))}${BT};\n`;
writeFileSync(join(outDir, "playgame-prompt.ts"), promptOut, "utf8");
console.log("wrote playgame-prompt.ts");
