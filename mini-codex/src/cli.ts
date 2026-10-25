import { defaultThreadFile, loadThreadFile, runPrompt } from "./loop.ts";
import { createUltraExecutor } from "./ultraAdapter.ts";

// Flags (consumed before the prompt is joined): --resume [file] continues a
// persisted transcript in place (default .mini-codex-thread.jsonl).
const argv = process.argv.slice(2);
let resumeFile: string | undefined;
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--resume") {
    const next = argv[i + 1];
    resumeFile = next && !next.startsWith("--") ? argv[++i] as string : defaultThreadFile(process.cwd());
  } else {
    rest.push(argv[i] as string);
  }
}
const prompt = rest.join(" ") || "list files here";
const cfg = {
  baseUrl: process.env.MINI_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.MINI_API_KEY || process.env.OPENAI_API_KEY || "",
  model: process.env.MINI_MODEL || "gpt-5-mini",
  effort: process.env.MINI_EFFORT || "medium",
  cwd: process.cwd(),
};
if (!cfg.apiKey) {
  console.error("missing MINI_API_KEY (or OPENAI_API_KEY)");
  process.exit(1);
}
const exec = await createUltraExecutor();
const initialThread = resumeFile ? (loadThreadFile(resumeFile) ?? undefined) : undefined;
if (resumeFile && !initialThread) {
  console.error(`--resume: no transcript at ${resumeFile}`);
  process.exit(1);
}
const out = await runPrompt(cfg, prompt, exec, resumeFile ? { initialThread, threadFile: resumeFile } : undefined);
console.log(out);
