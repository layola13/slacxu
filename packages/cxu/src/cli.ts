#!/usr/bin/env node
import { createRequire } from "node:module";
import { doctor, listToolIds, printDoctor, promptDoctorInteractive, runInstall, type DoctorToolId } from "./cli-doctor.js";
import { runServe, serveHelp } from "./serve.js";

function getCxuVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    if (pkg?.version) return pkg.version;
  } catch {
    // ignore and fall through
  }
  return "0.0.0-unknown";
}

function printVersion(): void {
  console.log(`cxu v${getCxuVersion()}`);
}

const rawArgs = process.argv.slice(2);
const [cmd, arg, flag] = rawArgs;
const first = cmd;

if (first === "--help" || first === "-h" || first === "help") {
  serveHelp();
  process.exit(0);
}

if (first === "--version" || first === "-v" || first === "version") {
  printVersion();
  process.exit(0);
}

const isNumeric = (s?: string) => Boolean(s && /^\d+$/.test(s));
const isServeAction =
  !first ||
  first === "serve" ||
  first === "up" ||
  first === "start" ||
  isNumeric(first) ||
  first.startsWith("-");

if (isServeAction) {
  const serveArgs =
    first === "serve" || first === "up" || first === "start"
      ? rawArgs.slice(1)
      : rawArgs;

  if (serveArgs.includes("--help") || serveArgs.includes("-h")) {
    serveHelp();
    process.exit(0);
  }

  const noPrompt = rawArgs.includes("--no-prompt");

  // 1. Run Doctor inspection with color checkmarks & crosses
  printDoctor();

  // 2. If there are missing tools, ask user whether to auto-install, view manual hints, or skip.
  await promptDoctorInteractive({ noPrompt });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const after = doctor();
    const stillMissing = after.statuses.filter((s) => s.id !== "mini" && (!s.found || s.note));
    if (stillMissing.length > 0 && !noPrompt) {
      console.log(`Tip: run \`cxu install --all --yes\` to auto-install, or \`cxu install [tool]\` for one tool.`);
    }
  }

  // 3. Launch workbench server
  process.exit(await runServe(serveArgs));
}

if (cmd === "doctor") {
  const wantsYes = rawArgs.includes("--yes") || rawArgs.includes("--all");
  const noPrompt = rawArgs.includes("--no-prompt") || !process.stdin.isTTY;
  if (wantsYes) {
    const ids = listToolIds();
    for (const id of ids) {
      const before = doctor().statuses.find((s) => s.id === id);
      if (!before || (before.found && !before.note)) continue;
      const result = runInstall(id);
      console.log(result.note ?? (result.ran ? `${id} installed.` : `${id} skipped.`));
    }
    process.exit(doctor().isReady ? 0 : 2);
  }
  const ready = printDoctor();
  if (!ready && !noPrompt) {
    await promptDoctorInteractive();
    process.exit(doctor().isReady ? 0 : 2);
  }
  process.exit(ready ? 0 : 2);
}

if (cmd === "install") {
  if (arg === "--help" || flag === "--help" || (!arg && !flag)) {
    console.log("Usage:");
    console.log("  cxu install [tool]        Print install command only, changes nothing");
    console.log("  cxu install [tool] --yes  Run the official installer");
    console.log("  cxu install --all --yes   Install every missing tool");
    console.log(`  Tools: ${listToolIds().join(", ")}`);
    if (!arg && !flag) process.exit(0);
    process.exit(0);
  }
  const yes = arg === "--yes" || arg === "--all" || flag === "--yes";
  const wantsAll = arg === "--all" || flag === "--all";
  const target = arg && arg !== "--yes" && arg !== "--all" ? arg : undefined;
  if (!yes) {
    const statuses = doctor().statuses.filter((s) => (target ? s.id === target : !s.found));
    if (target && statuses.length === 0) {
      console.log(`Unknown tool: ${target}. Choices: ${listToolIds().join(", ")}`);
      process.exit(1);
    }
    for (const s of statuses) console.log(`${s.id}: ${s.installHint}`);
    console.log("Re-run with --yes to execute (e.g. `cxu install codex --yes`).");
    process.exit(0);
  }
  const ids: DoctorToolId[] = wantsAll || !target ? listToolIds() : [target as DoctorToolId];
  for (const id of ids) {
    const result = runInstall(id);
    console.log(result.note ?? (result.ran ? `${id} installed.` : `${id} skipped.`));
  }
  process.exit(doctor().isReady ? 0 : 2);
}

serveHelp();
