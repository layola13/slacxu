#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distTargets = [join(pkgRoot, "dist", "index.js"), join(pkgRoot, "dist", "cli.js")];
// npm package obfuscation is disabled by default.
// Running javascript-obfuscator on npm packages triggers Windows Defender's
// Trojan:NPM/ObfusNpmJs.C heuristic, causing antivirus engines to quarantine or delete
// package files upon npm install/extraction.
// Standard minification (bun build / esbuild --minify) is clean, safe, fast, and provides
// production code compaction without triggering malware alerts.
// Opt in explicitly with CXU_OBFUSCATE=1 when required.
if (process.env.CXU_OBFUSCATE !== "1") {
  console.log("npm obfuscation is disabled by default (safe minified bundle). Set CXU_OBFUSCATE=1 to enable.");
  process.exit(0);
}

const serverBundleTarget = join(pkgRoot, "server-bundle", "index.js");
const obfuscateServerBundle = process.env.CXU_OBFUSCATE_SERVER === "1";
const targets = obfuscateServerBundle ? [...distTargets, serverBundleTarget] : distTargets;

const mod = await import("javascript-obfuscator");
const obfuscateFn = mod.obfuscate || (mod.default && mod.default.obfuscate);
if (typeof obfuscateFn !== "function") {
  throw new Error("Cannot find obfuscate() export in javascript-obfuscator. Got keys: " + Object.keys(mod).join(", "));
}

const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.5,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: false,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: "function",
  target: "node",
};

// Light profile for the large server bundle: string obfuscation only, no
// control-flow transforms, no global renames. Reserved names cover the
// esbuild banner shims and native/dynamic externals from
// apps/server/scripts/build.mjs so require("better-sqlite3"/"node-pty")
// and import.meta shims keep working after obfuscation.
const serverOptions = {
  ...options,
  stringArrayThreshold: 0.8,
  // NOTE: splitStrings and stringArrayCallsTransform intentionally OFF: on a
  // 12MB bundle splitStrings pushes the release build past 5 minutes at ~2GB
  // RAM, and callsTransform did the same. Threshold 0.8 alone is the
  // cost/benefit sweet spot (see docs/cxu-server-obfuscation.md).
  reservedNames: [
    "^__createRequire$",
    "^__fileURLToPath$",
    "^__dirnameFunction$",
    "^require$",
    "^__require$",
    "^exports$",
    "^__dirname$",
    "^__filename$",
    "^Buffer$",
    "^process$",
    "^global$",
    "^globalThis$",
    "^Bun$",
    "^better-sqlite3$",
    "^node-pty$",
    "^@napi-rs/keyring$",
    "^fetch-impersonate$",
  ],
};

for (const target of targets) {
  if (target === serverBundleTarget) {
    const { readFile: rf } = await import("node:fs/promises");
    let code;
    try {
      code = await rf(target, "utf8");
    } catch {
      console.warn("skip missing server bundle: " + target + " (run the cxu build first)");
      continue;
    }
    const before = code.length;
    const result = obfuscateFn(code, serverOptions);
    const out = typeof result.getObfuscatedCode === "function" ? result.getObfuscatedCode() : String(result);
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(target, out, "utf8");
    console.log("obfuscated " + target + "  " + before + "B -> " + out.length + "B (light server profile)");
    continue;
  }
  const code = await readFile(target, "utf8");
  const before = code.length;
  const isLarge = target.endsWith("index.js");
  const targetOptions = isLarge ? { ...options, stringArray: false } : options;
  const result = obfuscateFn(code, targetOptions);
  const out = typeof result.getObfuscatedCode === "function" ? result.getObfuscatedCode() : String(result);
  await writeFile(target, out, "utf8");
  console.log("obfuscated " + target + "  " + before + "B -> " + out.length + "B");
}
console.log("vm-tools obfuscation complete (types in dist/*.d.ts stay readable).");
if (!obfuscateServerBundle) {
  console.log("server-bundle left untouched (CXU_OBFUSCATE_SERVER=0).");
}
