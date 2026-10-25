import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getBunInstallHint } from "./bun-runtime.js";

const MIN_BUN_VERSION = "1.1.0";
const HOME = process.env.HOME || process.env.USERPROFILE || homedir();

export function getCxuVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    if (pkg?.version) return pkg.version;
  } catch {
  }
  return "0.0.0-unknown";
}

type VersionTuple = [number, number, number];

function parseVersionTuple(value: string): VersionTuple | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTuples(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
}

export function getLocalBunVersion(): string | null {
  try {
    const res = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    if (res.status !== 0) return null;
    const text = String(res.stdout ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

export function checkBunForBuild(): { ok: true; version: string } | { ok: false; hint: string } {
  const version = getLocalBunVersion();
  if (!version) {
    return {
      ok: false,
      hint: `Bun is required to compile the codex-ultra server on first run but was not found. Install it first: ${getBunInstallHint()}`,
    };
  }
  const current = parseVersionTuple(version);
  const minimum = parseVersionTuple(MIN_BUN_VERSION);
  if (!current || !minimum || compareTuples(current, minimum) < 0) {
    return {
      ok: false,
      hint: `Bun ${version} detected, but cxu needs Bun >= ${MIN_BUN_VERSION} to compile the server. Upgrade: ${getBunInstallHint()}`,
    };
  }
  return { ok: true, version };
}

function toWindowsVersion(value: string): string {
  const numbers = (String(value).match(/\d+/g) ?? ["0"]).map(Number).slice(-4);
  while (numbers.length < 4) numbers.unshift(0);
  return numbers.join(".");
}

function resolveServerBundle(): string | null {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const candidate = join(distDir, "..", "server-bundle", "index.js");
  return existsSync(candidate) ? candidate : null;
}

function resolveBundledSaVmMcpScript(): string | null {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const candidate = join(distDir, "..", "server-bundle", "sa-vm-mcp.mjs");
  return existsSync(candidate) ? candidate : null;
}

// Best-effort, Linux/macOS only. Copies the MCP bridge staged by
// packages/cxu/scripts/build.mjs next to the cached standalone server binary.
// Runs on every ensureServerBinary() so already-cached installs get repaired too.
function seedSaVmMcpBesideCachedServer(version: string): void {
  try {
    const source = resolveBundledSaVmMcpScript();
    if (!source) return;
    const outDir = getServerCacheDir(version);
    const target = join(outDir, "sa-vm-mcp.mjs");
    try {
      // Repair stale installs: missing OR empty/corrupt target gets re-seeded.
      // (Linux/macOS only path; Windows desktop ships desktop-resources/sa-vm.)
      if (existsSync(target) && statSync(target).size > 0) return;
    } catch {
      // Stat failed -> fall through to (re-)copy.
    }
    mkdirSync(outDir, { recursive: true });
    copyFileSync(source, target);
    try {
      chmodSync(target, 0o644);
    } catch {
    }
  } catch {
    // Resolver falls back to repo/global copies; stay silent here.
  }
}

// Native/dynamic externals for `bun build --compile`. Mirrors
// apps/server/scripts/build.mjs plus the Bun single-file runtime: every entry
// must resolve from disk at runtime (never inlined into the exe virtual FS).
// node-pty is load-bearing here: its Windows conpty.node/pty.node natives
// cannot be dlopen'd from B:~BUN/root, so an inlined copy breaks
// terminal/create on win32 with "Failed to load native module: conpty.node"
// while Linux silently survives via the script(1) fallback.
const STANDALONE_EXTERNALS = [
  "better-sqlite3",
  "@napi-rs/keyring",
  "fetch-impersonate",
  "node-pty",
] as const;

function resolveBundledNodePtyDir(): string | null {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(distDir, "..", "server-bundle", "node-pty"),
    join(distDir, "..", "node_modules", "node-pty"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "lib", "index.js"))) return candidate;
    } catch {
    }
  }
  // Repo-dev fallback: the cxu package is built from this monorepo, so the
  // root node_modules copy (with win32-x64 prebuilds) is usable as a seed.
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("node-pty/package.json");
    const dir = dirname(pkgJson);
    if (existsSync(join(dir, "lib", "index.js"))) return dir;
  } catch {
  }
  return null;
}

function isNodePtySeedHealthy(dir: string): boolean {
  try {
    if (!existsSync(join(dir, "package.json")) || !existsSync(join(dir, "lib", "index.js"))) return false;
    if (process.platform === "win32") {
      const prebuilt = join(dir, "prebuilds", "win32-x64");
      if (!existsSync(join(prebuilt, "conpty.node")) || !existsSync(join(prebuilt, "pty.node"))) return false;
    } else {
      if (!existsSync(join(dir, "build", "Release", "pty.node")) && !existsSync(join(dir, "prebuilds"))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Best-effort, all platforms: seeds node_modules/node-pty next to the cached
// standalone server binary so the Bun-compiled exe (node-pty external) finds
// its natives on disk. Runs on every ensureServerBinary() so already-cached
// installs get repaired too. Pruned to package.json + lib/ + prebuilds to
// keep the cache small; the win32-x64 prebuild (conpty.node, pty.node,
// conpty_console_list.node, winpty bits) is mandatory on Windows.
function seedNodePtyBesideCachedServer(version: string): void {
  try {
    const source = resolveBundledNodePtyDir();
    if (!source) return;
    const target = join(getServerCacheDir(version), "node_modules", "node-pty");
    try {
      if (isNodePtySeedHealthy(target)) return;
    } catch {
    }
    mkdirSync(target, { recursive: true });
    copyFileSync(join(source, "package.json"), join(target, "package.json"));
    rmSync(join(target, "lib"), { recursive: true, force: true });
    cpSync(join(source, "lib"), join(target, "lib"), { recursive: true, dereference: true });
    const prebuildsSource = join(source, "prebuilds");
    if (existsSync(prebuildsSource)) {
      rmSync(join(target, "prebuilds"), { recursive: true, force: true });
      mkdirSync(join(target, "prebuilds"), { recursive: true });
      const keep = new Set(["win32-x64", `${process.platform}-${process.arch}`]);
      for (const entry of readdirSync(prebuildsSource, { withFileTypes: true })) {
        if (!entry.isDirectory() || !keep.has(entry.name)) continue;
        cpSync(join(prebuildsSource, entry.name), join(target, "prebuilds", entry.name), { recursive: true, dereference: true });
      }
    }
    const releaseSource = join(source, "build", "Release");
    if (existsSync(join(releaseSource, "pty.node")) || existsSync(join(releaseSource, "conpty.node"))) {
      mkdirSync(join(target, "build", "Release"), { recursive: true });
      for (const file of ["pty.node", "conpty.node", "conpty_console_list.node"]) {
        const from = join(releaseSource, file);
        if (existsSync(from)) copyFileSync(from, join(target, "build", "Release", file));
      }
      const conptyDir = join(releaseSource, "conpty");
      if (existsSync(conptyDir)) {
        cpSync(conptyDir, join(target, "build", "Release", "conpty"), { recursive: true, dereference: true });
      }
    }
  } catch {
    // Terminal degrades to a guided error at spawn time; stay silent here.
  }
}

// Stale-cache detector: exes compiled before node-pty became external have
// its JS inlined (virtual FS) and can never load conpty.node from disk.
// .build-info.json records externals since this fix; anything older (or
// missing the marker) must be recompiled once per version.
function needsServerRecompileForPtyFix(version: string): boolean {
  try {
    const infoPath = join(getServerCacheDir(version), ".build-info.json");
    // No marker at all means predates the externals record: also stale.
    if (!existsSync(infoPath)) return true;
    const info = JSON.parse(readFileSync(infoPath, "utf8")) as { externals?: unknown };
    return !Array.isArray(info.externals) || !(info.externals as unknown[]).includes("node-pty");
  } catch {
    return false;
  }
}
// Best-effort, all platforms: copies extensions/pi-relay next to the cached
// standalone server binary so the server resolver finds it without a repo checkout.
function seedPiRelayBesideCachedServer(version: string): void {
  try {
    const distDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(distDir, "..", "server-bundle", "extensions", "pi-relay"),
      join(distDir, "..", "extensions", "pi-relay"),
    ];
    const source = candidates.find((c) => existsSync(join(c, "index.js")));
    if (!source) return;
    const outDir = join(getServerCacheDir(version), "extensions", "pi-relay");
    const target = join(outDir, "index.js");
    try {
      if (existsSync(target) && statSync(target).size > 0) return;
    } catch {
    }
    mkdirSync(outDir, { recursive: true });
    copyFileSync(join(source, "index.js"), target);
    const pkgSource = join(source, "package.json");
    if (existsSync(pkgSource)) {
      copyFileSync(pkgSource, join(outDir, "package.json"));
    }
  } catch {
  }
}

function seedCodexAppServerBesideCachedServer(version: string): void {
  if (process.platform !== "win32") return;
  try {
    const distDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(process.cwd(), "codex-app-server.exe"),
      join(process.cwd(), "codex_app_server.exe"),
      join(process.cwd(), "desktop-resources", "codex-app-server.exe"),
      join(process.cwd(), "desktop-resources", "codex_app_server.exe"),
      join(distDir, "..", "..", "..", "desktop-resources", "codex-app-server.exe"),
      join(HOME, ".cxu", "server", "v0.2.66", "codex-app-server.exe"),
    ];
    const source = candidates.find((c) => existsSync(c) && statSync(c).size > 0);
    if (!source) return;
    const outDir = getServerCacheDir(version);
    const target = join(outDir, "codex-app-server.exe");
    if (existsSync(target) && statSync(target).size > 0) return;
    mkdirSync(outDir, { recursive: true });
    copyFileSync(source, target);
  } catch {}
}

export function getServerCacheDir(version: string): string {
  return join(HOME, ".cxu", "server", `v${version}`);
}

export function isValidServerBinary(exePath: string): boolean {
  try {
    if (!existsSync(exePath)) return false;
    const stat = statSync(exePath);
    // A complete Bun-compiled server binary is at least 70 MB.
    if (stat.size < 70 * 1024 * 1024) return false;
    if (process.platform === "win32") {
      const fd = openSync(exePath, "r");
      try {
        const header = Buffer.alloc(0x40);
        readSync(fd, header, 0, 0x40, 0);
        if (header[0] !== 0x4d || header[1] !== 0x5a) return false; // "MZ"
        const peOffset = header.readUInt32LE(0x3c);
        if (peOffset < 0x40 || peOffset + 24 > stat.size) return false;
        const peSig = Buffer.alloc(4);
        readSync(fd, peSig, 0, 4, peOffset);
        if (peSig.toString("ascii") !== "PE\0\0") return false;
      } finally {
        closeSync(fd);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function getCachedServerBinary(version: string): string | null {
  const exe = join(getServerCacheDir(version), process.platform === "win32" ? "codex-standalone.exe" : "codex-standalone");
  try {
    if (!existsSync(exe)) return null;
    if (isValidServerBinary(exe)) return exe;
    console.warn(`cxu: detected corrupted or incomplete server binary (${exe}); removing...`);
    try {
      rmSync(exe, { force: true });
    } catch {
    }
    return null;
  } catch {
    return null;
  }
}

export type EnsureServerResult =
  | { ok: true; exePath: string; built: boolean; isNodeScript?: boolean; scriptPath?: string; bundlePath?: string }
  | { ok: false; hint: string };

export function ensureServerBinary(): EnsureServerResult {
  const version = getCxuVersion();
  // Linux/macOS only: seed sa-vm-mcp.mjs next to the cached standalone binary so
  // the server resolver (execPath sibling candidate) finds it without a repo
  // checkout. Windows desktop ships desktop-resources/sa-vm instead; untouched.
  if (process.platform !== "win32") {
    seedSaVmMcpBesideCachedServer(version);
  }
  seedPiRelayBesideCachedServer(version);
  seedNodePtyBesideCachedServer(version);
  seedCodexAppServerBesideCachedServer(version);
  const bundle = resolveServerBundle();
  if (!bundle) {
    return { ok: false, hint: "Server bundle missing from this cxu install (server-bundle/index.js). Reinstall with: npm install -g @codex-ultra/cxu" };
  }
  const cached = getCachedServerBinary(version);
  const bundleStat = (() => {
    try {
      return statSync(bundle);
    } catch {
      return null;
    }
  })();
  const isStaleBundle = cached && bundleStat ? (() => {
    try {
      const cachedStat = statSync(cached);
      return bundleStat.mtimeMs > cachedStat.mtimeMs;
    } catch {
      return false;
    }
  })() : false;
  const needsRebuild = cached && (needsServerRecompileForPtyFix(version) || isStaleBundle);
  // Rebuild if PTY fix is needed or if the installed server bundle is newer than the cache.
  if (cached && needsRebuild) {
    if (isStaleBundle) {
      console.log("cxu: server bundle is newer than cached binary; rebuilding server...");
    } else {
      console.log("cxu: rebuilding the server for the Windows terminal (node-pty) fix (one-time)...");
    }
    let gone = false;
    try {
      rmSync(cached, { force: true });
      gone = !existsSync(cached);
    } catch {
      try {
        gone = !existsSync(cached);
      } catch {
        gone = false;
      }
    }
    if (!gone) {
      // The old exe is still running (Windows locks it): keep serving it for
      // this launch; the rebuild happens on the next start after it exits.
      console.warn("cxu: server binary is in use; will rebuild on next start after process exits.");
      return { ok: true, exePath: cached, built: false, isNodeScript: false, bundlePath: bundle };
    }
  } else if (cached) {
    return { ok: true, exePath: cached, built: false, isNodeScript: false, bundlePath: bundle };
  }
  const bun = checkBunForBuild();
  if (!bun.ok) {
    console.log(`cxu: Bun not detected (${bun.hint.split(". ")[0]}); running server directly with Node.js ${process.version}...`);
    return { ok: true, exePath: process.execPath, built: false, isNodeScript: true, scriptPath: bundle, bundlePath: bundle };
  }
  const outDir = getServerCacheDir(version);
  mkdirSync(outDir, { recursive: true });
  const exeName = process.platform === "win32" ? "codex-standalone.exe" : "codex-standalone";
  const exePath = join(outDir, exeName);
  const tmpExePath = join(outDir, `tmp-${process.pid}-${Date.now()}-${exeName}`);
  const args = [
    "build",
    "--compile",
    bundle,
    "--outfile",
    tmpExePath,
    "--minify",
    "--define",
    `STANDALONE_BUILD_VERSION="${version}"`,
    ...STANDALONE_EXTERNALS.flatMap((name) => ["--external", name]),
  ];
  if (process.platform === "win32") {
    args.push(
      "--windows-title",
      "Codex Ultra Standalone",
      "--windows-publisher",
      "codex-ultra maintainers",
      "--windows-version",
      toWindowsVersion(version),
      "--windows-description",
      "Codex Ultra standalone server (Bun single-file)",
    );
  }
  console.log(`cxu: compiling the server for this machine with Bun ${bun.version} (one-time per version)...`);
  const res = spawnSync("bun", args, { stdio: "inherit", timeout: 300000, windowsHide: true });
  if (res.status !== 0 || !isValidServerBinary(tmpExePath)) {
    try {
      rmSync(tmpExePath, { force: true });
    } catch {
    }
    console.warn(`cxu: Bun compilation failed (exit ${res.status ?? "signal"}); falling back to Node.js ${process.version}...`);
    return { ok: true, exePath: process.execPath, built: false, isNodeScript: true, scriptPath: bundle, bundlePath: bundle };
  }
  try {
    renameSync(tmpExePath, exePath);
  } catch {
    try {
      copyFileSync(tmpExePath, exePath);
      rmSync(tmpExePath, { force: true });
    } catch {
    }
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(exePath, 0o755);
    } catch {
    }
  }
  try {
    writeFileSync(
      join(outDir, ".build-info.json"),
      JSON.stringify({ cxuVersion: version, bunVersion: bun.version, builtAt: new Date().toISOString(), externals: [...STANDALONE_EXTERNALS] }, null, 2),
    );
  } catch {
  }
  seedNodePtyBesideCachedServer(version);
  const ready = getCachedServerBinary(version);
  if (!ready) {
    console.warn("cxu: Compiled server binary not found; falling back to Node.js...");
    return { ok: true, exePath: process.execPath, built: false, isNodeScript: true, scriptPath: bundle, bundlePath: bundle };
  }
  console.log("cxu: server ready.");
  return { ok: true, exePath: ready, built: true, isNodeScript: false, bundlePath: bundle };
}
