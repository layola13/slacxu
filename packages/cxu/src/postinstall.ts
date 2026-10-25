import { ensureServerBinary } from "./server-build.js";

try {
  const result = ensureServerBinary();
  if (!result.ok) {
    console.log(`cxu postinstall: skipped local server build. ${result.hint}`);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.log(`cxu postinstall: skipped local server build (${detail}). It will compile on first \`cxu serve\`.`);
}
