import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ALL_CLI_KINDS,
  buildCliKindStatus,
  compareVersions,
  enumerateCliCandidates,
  installationMatchesKind,
  listCliInstallations,
  parseRequestedCliKinds,
  probeCliVersion,
  resetNpmPrefixProbeCacheForTests,
  toolchainDirCandidates,
} from "../../apps/server/src/cliVersions.js";
import {
  getCachedLatestCli,
  setPreferredCliBinary,
  storeLatestCliCache,
} from "../../apps/server/src/cliSelectionState.js";
import { findCodexBinary } from "../../apps/server/src/codexCommand.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cli-versions-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  setPreferredCliBinary("codex", null);
  setPreferredCliBinary("claude", null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("compareVersions orders semver strings numerically", () => {
  expect(compareVersions("1.2.3", "1.2.10")).toBeLessThan(0);
  expect(compareVersions("0.50.0", "0.9.9")).toBeGreaterThan(0);
  expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
});

test.skipIf(process.platform !== "win32")("probeCliVersion handles a Windows command shim under a spaced path", async () => {
  const root = makeTempDir();
  const binDir = path.join(root, "Program Files", "Claude");
  const command = path.join(binDir, "claude.cmd");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(command, "@echo off\r\necho 2.1.222 (Claude Code)\r\n");

  expect(await probeCliVersion(command)).toBe("2.1.222");
});

test("enumerateCliCandidates finds executables across PATH directories", () => {  const dirA = makeTempDir();
  const dirB = makeTempDir();
  writeFileSync(path.join(dirA, "codex.exe"), "");
  writeFileSync(path.join(dirB, "codex.cmd"), "");

  const found = enumerateCliCandidates("codex", {
    PATH: `${dirA};${dirB}`,
    PATHEXT: ".COM;.EXE;.CMD;.BAT",
    APPDATA: "",
    LOCALAPPDATA: "",
  }, "win32");

  const normalized = found.map((entry) => entry.toLowerCase());
  expect(normalized.some((entry) => entry.startsWith(dirA.toLowerCase()) && entry.endsWith(".exe"))).toBe(true);
  expect(normalized.some((entry) => entry.startsWith(dirB.toLowerCase()) && entry.endsWith(".cmd"))).toBe(true);
});

test("enumerateCliCandidates includes the env-configured binary only when it exists", () => {
  const dir = makeTempDir();
  const realBin = path.join(dir, `codex${process.platform === "win32" ? ".exe" : ""}`);
  writeFileSync(realBin, "");
  if (process.platform !== "win32") {
    chmodSync(realBin, 0o755);
  }

  const missing = path.join(dir, "missing-codex");
  const found = enumerateCliCandidates("codex", {
    CODEX_BIN: missing,
    PATH: "",
  }, process.platform);
  expect(found).not.toContain(missing);

  const foundWithReal = enumerateCliCandidates("codex", {
    CODEX_BIN: realBin,
    PATH: "",
  }, process.platform);
  expect(foundWithReal).toContain(realBin);
});

test("findCodexBinary prefers the newest cached installation and explicit user pick", () => {
  const dir = makeTempDir();
  const suffix = process.platform === "win32" ? ".exe" : "";
  const older = path.join(dir, `codex-old${suffix}`);
  const newer = path.join(dir, `codex-new${suffix}`);
  const preferred = path.join(dir, `codex-picked${suffix}`);
  for (const file of [older, newer, preferred]) {
    writeFileSync(file, "");
    if (process.platform !== "win32") {
      chmodSync(file, 0o755);
    }
  }

  // Once enumeration warms up the newest installation wins by default.
  storeLatestCliCache("codex", [
    { path: newer, version: "1.99.0", source: dir },
    { path: older, version: "1.10.0", source: dir },
  ], newer);
  expect(findCodexBinary(undefined, process.platform, {})).toBe(newer);

  // An explicit user pick overrides the default.
  setPreferredCliBinary("codex", preferred);
  expect(findCodexBinary(undefined, process.platform, {})).toBe(preferred);
});

test("getCachedLatestCli expires with the cache TTL", () => {
  const dir = makeTempDir();
  storeLatestCliCache("claude", [{ path: path.join(dir, "claude"), version: "2.1.0", source: dir }], path.join(dir, "claude"));
  expect(getCachedLatestCli("claude")).toBeDefined();
  expect(getCachedLatestCli("claude", -1)).toBeUndefined();
});

test("parseRequestedCliKinds defaults to all kinds for lazy activation compat", () => {
  expect(parseRequestedCliKinds(null)).toEqual([...ALL_CLI_KINDS]);
  expect(parseRequestedCliKinds(undefined)).toEqual([...ALL_CLI_KINDS]);
  expect(parseRequestedCliKinds("")).toEqual([...ALL_CLI_KINDS]);
  expect(parseRequestedCliKinds("bogus-kind")).toEqual([...ALL_CLI_KINDS]);
});

test("parseRequestedCliKinds only returns the requested backends", () => {
  expect(parseRequestedCliKinds("opencode")).toEqual(["opencode"]);
  expect(parseRequestedCliKinds("codex, opencode")).toEqual(["codex", "opencode"]);
  expect(parseRequestedCliKinds("pi,pi,bogus,PI")).toEqual(["pi"]);
});

test("every selectable registry backend is probeable via the installations endpoint", async () => {
  // Regression guard: ALL_CLI_KINDS once omitted auggie/cline/command-code,
  // so GET /api/cli/installations silently never probed them and the CLI
  // switcher showed them as forever-loading "Not installed" even with the
  // binaries on disk. The selectable set is registry-derived (plugins that
  // declare discovery.preferredPathPrefKey, same rule as /api/cli/select);
  // adding a backend without extending ALL_CLI_KINDS must fail here.
  const { serverPluginRegistry } = await import("../../apps/server/src/pluginHost.js");
  const selectable = serverPluginRegistry
    .list()
    .filter((plugin) => plugin.discovery.preferredPathPrefKey)
    .map((plugin) => plugin.manifest.id);
  expect(selectable.length).toBeGreaterThanOrEqual(11);
  for (const id of selectable) {
    expect(ALL_CLI_KINDS).toContain(id as (typeof ALL_CLI_KINDS)[number]);
    expect(parseRequestedCliKinds(id)).toEqual([id]);
  }
});

test("enumerateCliCandidates discovers npm-global CLIs under npm_config_prefix", () => {
  const prefix = makeTempDir();
  const binDir = path.join(prefix, "bin");
  mkdirSync(binDir, { recursive: true });
  const piBin = path.join(binDir, "pi");
  makeExecutable(piBin);

  resetNpmPrefixProbeCacheForTests();
  const found = enumerateCliCandidates("pi", { HOME: makeTempDir(), PATH: "", npm_config_prefix: prefix }, "linux");
  expect(found).toContain(piBin);
});

test.skipIf(process.platform === "win32")("enumerateCliCandidates probes npm prefix like cxu doctor when the env var is absent", () => {
  const prefix = makeTempDir();
  const binDir = path.join(prefix, "bin");
  mkdirSync(binDir, { recursive: true });
  const piBin = path.join(binDir, "pi");
  makeExecutable(piBin);
  const fakeBin = makeTempDir();
  writeFileSync(
    path.join(fakeBin, "npm"),
    `#!/bin/sh\nif [ "$1 $2 $3" = "config get prefix" ]; then echo ${prefix}; exit 0; fi\nexit 1\n`,
  );
  chmodSync(path.join(fakeBin, "npm"), 0o755);

  const savedPath = process.env.PATH;
  resetNpmPrefixProbeCacheForTests();
  try {
    process.env.PATH = `${fakeBin}${path.delimiter}${savedPath ?? ""}`;
    const env: NodeJS.ProcessEnv = { HOME: makeTempDir(), PATH: "" };
    delete env.npm_config_prefix;
    const found = enumerateCliCandidates("pi", env, "linux");
    expect(found).toContain(piBin);
  } finally {
    process.env.PATH = savedPath;
    resetNpmPrefixProbeCacheForTests();
  }
});

test.skipIf(process.platform === "win32")("enumerateCliCandidates skips files without the executable bit (agrees with cxu doctor)", () => {
  const dir = makeTempDir();
  const grokBin = path.join(dir, "grok");
  writeFileSync(grokBin, "#!/bin/sh\necho 0.0.1\n");
  chmodSync(grokBin, 0o644);

  resetNpmPrefixProbeCacheForTests();
  const found = enumerateCliCandidates("grok", { HOME: makeTempDir(), PATH: dir }, "linux");
  expect(found).not.toContain(grokBin);
});

test.skipIf(process.platform === "win32")("enumerateCliCandidates tolerates quoted PATH entries", () => {
  const dir = makeTempDir();
  const codexBin = path.join(dir, "codex");
  makeExecutable(codexBin);

  resetNpmPrefixProbeCacheForTests();
  const found = enumerateCliCandidates("codex", { HOME: makeTempDir(), PATH: `"${dir}"` }, "linux");
  expect(found).toContain(codexBin);
});

function makeExecutable(filePath: string): void {
  writeFileSync(filePath, "#!/bin/sh\necho 1.2.3\n");
  if (process.platform !== "win32") {
    chmodSync(filePath, 0o755);
  }
}

test("enumerateCliCandidates discovers cargo-installed Rust CLIs under a minimal PATH", () => {
  const home = makeTempDir();
  const cargoBin = path.join(home, ".cargo", "bin");
  mkdirSync(cargoBin, { recursive: true });
  const grokBin = path.join(cargoBin, "grok");
  makeExecutable(grokBin);

  const found = enumerateCliCandidates("grok", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(grokBin);
});

test("enumerateCliCandidates discovers CLIs in ~/.codex-ultra/bin", () => {
  const home = makeTempDir();
  const ultraBin = path.join(home, ".codex-ultra", "bin");
  mkdirSync(ultraBin, { recursive: true });
  const piBin = path.join(ultraBin, "pi");
  makeExecutable(piBin);

  const found = enumerateCliCandidates("pi", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(piBin);
});

test("enumerateCliCandidates recognizes the claudecode fork binary for the claude kind", () => {
  const home = makeTempDir();
  const localBin = path.join(home, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const forkBin = path.join(localBin, "claudecode");
  makeExecutable(forkBin);

  const found = enumerateCliCandidates("claude", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(forkBin);
});

test("enumerateCliCandidates recognizes the agent binary for the grok kind", () => {
  const home = makeTempDir();
  const localBin = path.join(home, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const aliasBin = path.join(localBin, "agent");
  makeExecutable(aliasBin);

  const found = enumerateCliCandidates("grok", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(aliasBin);
});

test("enumerateCliCandidates discovers WinGet-linked CLIs on Windows", () => {
  const home = makeTempDir();
  const localApp = makeTempDir();
  const wingetDir = path.join(localApp, "Microsoft", "WinGet", "Links");
  mkdirSync(wingetDir, { recursive: true });
  writeFileSync(path.join(wingetDir, "opencode.exe"), "");

  const found = enumerateCliCandidates("opencode", {
    PATH: "",
    PATHEXT: ".COM;.EXE;.CMD;.BAT",
    USERPROFILE: home,
    LOCALAPPDATA: localApp,
    APPDATA: "",
  }, "win32");

  expect(found.some((entry) => entry.toLowerCase() === path.join(wingetDir, "opencode.exe").toLowerCase())).toBe(true);
});

test("enumerateCliCandidates discovers Chocolatey and global Scoop shims on Windows", () => {
  const home = makeTempDir();
  const programData = makeTempDir();
  const chocoDir = path.join(programData, "chocolatey", "bin");
  const scoopDir = path.join(programData, "scoop", "shims");
  mkdirSync(chocoDir, { recursive: true });
  mkdirSync(scoopDir, { recursive: true });
  writeFileSync(path.join(chocoDir, "pi.exe"), "");
  writeFileSync(path.join(scoopDir, "pi.exe"), "");

  const found = enumerateCliCandidates("pi", {
    PATH: "",
    PATHEXT: ".COM;.EXE;.CMD;.BAT",
    USERPROFILE: home,
    LOCALAPPDATA: "",
    APPDATA: "",
    ProgramData: programData,
  }, "win32");

  const normalized = found.map((entry) => entry.toLowerCase());
  expect(normalized).toContain(path.join(chocoDir, "pi.exe").toLowerCase());
  expect(normalized).toContain(path.join(scoopDir, "pi.exe").toLowerCase());
});

test("enumerateCliCandidates discovers Flatpak/Nix/Go CLIs on Linux", () => {
  const home = makeTempDir();
  const flatDir = path.join(home, ".local", "share", "flatpak", "exports", "bin");
  const nixDir = path.join(home, ".nix-profile", "bin");
  const goDir = path.join(home, "go", "bin");
  for (const dir of [flatDir, nixDir, goDir]) mkdirSync(dir, { recursive: true });
  const flatBin = path.join(flatDir, "pi");
  const nixBin = path.join(nixDir, "pi");
  const goBin = path.join(goDir, "pi");
  makeExecutable(flatBin);
  makeExecutable(nixBin);
  makeExecutable(goBin);

  const found = enumerateCliCandidates("pi", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(flatBin);
  expect(found).toContain(nixBin);
  expect(found).toContain(goBin);
});

test("toolchainDirCandidates scans fnm version bins and covers proto/rtx/yarn-classic", () => {
  const home = makeTempDir();
  const fnmBin = path.join(home, ".local", "share", "fnm", "node-versions", "v20.19.0", "installation", "bin");
  mkdirSync(fnmBin, { recursive: true });

  const dirs = toolchainDirCandidates(home, {});
  expect(dirs).toContain(fnmBin);
  expect(dirs).toContain(path.join(home, ".proto", "shims"));
  expect(dirs).toContain(path.join(home, ".local", "share", "rtx", "shims"));
  expect(dirs).toContain(path.join(home, ".config", "yarn", "global", "node_modules", ".bin"));
});

test("enumerateCliCandidates discovers fnm/proto/yarn-classic CLIs on Linux", () => {
  const home = makeTempDir();
  const fnmBinDir = path.join(home, ".local", "share", "fnm", "node-versions", "v20.19.0", "installation", "bin");
  const protoDir = path.join(home, ".proto", "shims");
  const yarnDir = path.join(home, ".config", "yarn", "global", "node_modules", ".bin");
  for (const dir of [fnmBinDir, protoDir, yarnDir]) mkdirSync(dir, { recursive: true });
  const fnmBin = path.join(fnmBinDir, "opencode");
  const protoBin = path.join(protoDir, "opencode");
  const yarnBin = path.join(yarnDir, "opencode");
  makeExecutable(fnmBin);
  makeExecutable(protoBin);
  makeExecutable(yarnBin);

  const found = enumerateCliCandidates("opencode", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(fnmBin);
  expect(found).toContain(protoBin);
  expect(found).toContain(yarnBin);
});

test("buildCliKindStatus never fabricates a bare-name row for missing CLIs", () => {
  // 枚举为空 = 没装：必须返回空列表让前端显示"未检测到其他版本"，
  // 而不是伪造 { path: "claude", version: undefined } 让 UI 显示
  // "未知版本 + 当前使用 ✓"（此前的"改了很多次都没改好"根因）。
  const status = buildCliKindStatus("claude", "claude", []);
  expect(status.installations).toEqual([]);
  expect(status.effectivePath).toBe("claude");
  expect(status.preferredPath).toBeNull();
});

test("buildCliKindStatus passes real installations through untouched", () => {
  const installations = [{ path: "/root/.local/bin/claude", version: "2.1.0", source: "/root/.local/bin" }];
  const status = buildCliKindStatus("claude", "/root/.local/bin/claude", installations);
  expect(status.installations).toEqual(installations);
});

test("enumerateCliCandidates skips non-executable files on posix", () => {
  // 与 cxu doctor 的差异点：doctor 用 isFile（无 +x 也算找到），
  // 服务端枚举要求可执行位。不可执行的安装必须保持不可见，
  // 否则会出现"cxu 说装好了，CLI 列表没有"的不一致。
  if (process.platform === "win32") return;
  const home = makeTempDir();
  const binDir = path.join(home, ".pi", "bin");
  mkdirSync(binDir, { recursive: true });
  const deadBin = path.join(binDir, "pi");
  writeFileSync(deadBin, "#!/bin/sh\necho 9.9.9\n");
  chmodSync(deadBin, 0o644);

  const emptyPrefix = makeTempDir();
  const found = enumerateCliCandidates(
    "pi",
    { HOME: home, PATH: "", npm_config_prefix: emptyPrefix },
    "linux",
  );
  expect(found).not.toContain(deadBin);
});

test("enumerateCliCandidates discovers the v2 launcher under ~/.opencode-v2/bin", () => {
  if (process.platform === "win32") return;
  const home = makeTempDir();
  const v2BinDir = path.join(home, ".opencode-v2", "bin");
  mkdirSync(v2BinDir, { recursive: true });
  const v2Bin = path.join(v2BinDir, "opencode2");
  makeExecutable(v2Bin);

  const found = enumerateCliCandidates("opencode-v2", { HOME: home, PATH: "" }, "linux");
  expect(found).toContain(v2Bin);
});

test("installationMatchesKind qualifies shared opencode names by launcher or major version", () => {
  expect(installationMatchesKind("opencode-v2", { path: "/h/.opencode-v2/bin/opencode2", version: "2.1.3" })).toBe(true);
  expect(installationMatchesKind("opencode-v2", { path: "/h/.opencode-v2/bin/opencode2" })).toBe(true);
  expect(installationMatchesKind("opencode-v2", { path: "/h/.opencode/bin/opencode", version: "2.1.3" })).toBe(true);
  expect(installationMatchesKind("opencode-v2", { path: "/h/.opencode/bin/opencode", version: "1.19.4" })).toBe(false);
  expect(installationMatchesKind("opencode-v2", { path: "/h/.opencode/bin/opencode" })).toBe(false);
  expect(installationMatchesKind("opencode", { path: "/h/.opencode/bin/opencode", version: "1.19.4" })).toBe(true);
  expect(installationMatchesKind("opencode", { path: "/h/.opencode/bin/opencode", version: "2.1.3" })).toBe(false);
  expect(installationMatchesKind("opencode", { path: "/h/.opencode-v2/bin/opencode2", version: "2.1.3" })).toBe(false);
  expect(installationMatchesKind("claude", { path: "/h/.local/bin/claude", version: "2.1.0" })).toBe(true);
});

test("listCliInstallations keeps v1 and v2 opencode installs in their own kinds", async () => {
  if (process.platform === "win32") return;
  const home = makeTempDir();
  const v1Dir = path.join(home, ".opencode", "bin");
  const v2Dir = path.join(home, ".opencode-v2", "bin");
  mkdirSync(v1Dir, { recursive: true });
  mkdirSync(v2Dir, { recursive: true });
  const v1Bin = path.join(v1Dir, "opencode");
  const v2Bin = path.join(v2Dir, "opencode2");
  writeFileSync(v1Bin, "#!/bin/sh\necho 1.19.4\n");
  writeFileSync(v2Bin, "#!/bin/sh\necho 2.1.3\n");
  chmodSync(v1Bin, 0o755);
  chmodSync(v2Bin, 0o755);

  const env = { HOME: home, PATH: "" };
  const v2List = (await listCliInstallations("opencode-v2", env, "linux")).filter((entry) => entry.path.startsWith(home));
  expect(v2List.map((entry) => entry.path)).toContain(v2Bin);
  expect(v2List.map((entry) => entry.path)).not.toContain(v1Bin);
  expect(v2List.find((entry) => entry.path === v2Bin)?.version).toBe("2.1.3");

  const v1List = (await listCliInstallations("opencode", env, "linux")).filter((entry) => entry.path.startsWith(home));
  expect(v1List.map((entry) => entry.path)).toContain(v1Bin);
  expect(v1List.map((entry) => entry.path)).not.toContain(v2Bin);
  expect(v1List.find((entry) => entry.path === v1Bin)?.version).toBe("1.19.4");
});

test("enumerateCliCandidates honors npm_config_prefix for npm -g installs", () => {
  // pi 等纯 npm 包的落点完全取决于 npm prefix；显式 prefix 必须被枚举覆盖。
  if (process.platform === "win32") return;
  const home = makeTempDir();
  const prefix = makeTempDir();
  const prefixBinDir = path.join(prefix, "bin");
  mkdirSync(prefixBinDir, { recursive: true });
  const prefixBin = path.join(prefixBinDir, "pi");
  makeExecutable(prefixBin);

  const found = enumerateCliCandidates(
    "pi",
    { HOME: home, PATH: "", npm_config_prefix: prefix },
    "linux",
  );
  expect(found).toContain(prefixBin);
});
