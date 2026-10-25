import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function hasBun() {
  try {
    const res = spawnSync("bun", ["--version"], { stdio: "ignore", timeout: 5000, windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

describe("cli-doctor windows PATH probing", () => {
  it("finds a CLI behind a quoted PATH entry", { skip: process.platform !== "win32" || !hasBun() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "cxu-doc-test-"));
    try {
      writeFileSync(join(dir, "pi.cmd"), "@echo off\r\necho 9.9.9\r\n");
      const script = [
        'const m = await import("./src/cli-doctor.ts");',
        'const pi = m.doctor().statuses.find((s) => s.id === "pi");',
        "console.log(JSON.stringify({ found: pi.found, path: pi.path ?? null, version: pi.version ?? null }));",
      ].join("\n");
      const res = spawnSync("bun", ["-e", script], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, PATH: `"${dir}"${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
      const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.found, true, `pi.cmd behind quoted PATH entry was not detected: ${lastLine}`);
      assert.equal(parsed.path, join(dir, "pi.cmd"));
      assert.equal(parsed.version, "9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags an outdated bun as missing with an upgrade note", { skip: process.platform !== "win32" || !hasBun() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "cxu-doc-bun-"));
    try {
      writeFileSync(join(dir, "bun.cmd"), "@echo off\r\necho 1.0.0\r\n");
      const script = [
        'const m = await import("./src/cli-doctor.ts");',
        'const bun = m.doctor().statuses.find((s) => s.id === "bun");',
        "console.log(JSON.stringify({ found: bun.found, version: bun.version ?? null, note: bun.note ?? null }));",
      ].join("\n");
      const res = spawnSync("bun", ["-e", script], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, PATH: `"${dir}"${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
      const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.found, false, `outdated bun should be flagged: ${lastLine}`);
      assert.equal(parsed.version, "1.0.0");
      assert.match(parsed.note ?? "", />= .*1\.4\.0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a bun newer than the minimum version", { skip: process.platform !== "win32" || !hasBun() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "cxu-doc-bun-"));
    try {
      writeFileSync(join(dir, "bun.cmd"), "@echo off\r\necho 9.9.9\r\n");
      const script = [
        'const m = await import("./src/cli-doctor.ts");',
        'const bun = m.doctor().statuses.find((s) => s.id === "bun");',
        "console.log(JSON.stringify({ found: bun.found, version: bun.version ?? null }));",
      ].join("\n");
      const res = spawnSync("bun", ["-e", script], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, PATH: `"${dir}"${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
      const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.found, true, `new bun should pass: ${lastLine}`);
      assert.equal(parsed.version, "9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("compareVersions orders dotted versions numerically", { skip: !hasBun() }, () => {
    const script = [
      'const m = await import("./src/cli-doctor.ts");',
      "console.log(JSON.stringify({ low: m.compareVersions(\"1.0.0\", \"1.2.0\"), high: m.compareVersions(\"9.9.9\", \"1.2.0\"), same: m.compareVersions(\"1.2.0\", \"1.2.0\") }));",
    ].join("\n");
    const res = spawnSync("bun", ["-e", script], { cwd: pkgRoot, encoding: "utf8", timeout: 60000, windowsHide: true });
    assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
    const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    assert.deepEqual(JSON.parse(lastLine), { low: -1, high: 1, same: 0 });
  });

  it("detects the grok alias binary (agent)", { skip: !hasBun() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "cxu-doc-alias-"));
    try {
      if (process.platform === "win32") {
        writeFileSync(join(dir, "agent.cmd"), "@echo off\r\necho 9.9.9\r\n");
      } else {
        writeFileSync(join(dir, "agent"), "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 });
      }
      const script = [
        'const m = await import("./src/cli-doctor.ts");',
        'const grok = m.doctor().statuses.find((s) => s.id === "grok");',
        "console.log(JSON.stringify({ found: grok.found, path: grok.path ?? null }));",
      ].join("\n");
      const res = spawnSync("bun", ["-e", script], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
      const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.found, true, `agent alias for grok was not detected: ${lastLine}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects the claude alias binary (claudecode)", { skip: !hasBun() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "cxu-doc-alias-"));
    try {
      if (process.platform === "win32") {
        writeFileSync(join(dir, "claudecode.cmd"), "@echo off\r\necho 9.9.9\r\n");
      } else {
        writeFileSync(join(dir, "claudecode"), "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 });
      }
      const script = [
        'const m = await import("./src/cli-doctor.ts");',
        'const claude = m.doctor().statuses.find((s) => s.id === "claude");',
        "console.log(JSON.stringify({ found: claude.found, path: claude.path ?? null }));",
      ].join("\n");
      const res = spawnSync("bun", ["-e", script], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
      const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.found, true, `claudecode alias for claude was not detected: ${lastLine}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("platformGlobalBinDirs covers package-manager and toolchain dirs", { skip: !hasBun() }, () => {
    const script = [
      'const m = await import("./src/cli-doctor.ts");',
      "console.log(JSON.stringify(m.platformGlobalBinDirs()));",
    ].join("\n");
    const res = spawnSync("bun", ["-e", script], { cwd: pkgRoot, encoding: "utf8", timeout: 60000, windowsHide: true });
    assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
    const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    const dirs = JSON.parse(lastLine).map(String);
    if (process.platform === "win32") {
      for (const needle of ["WinGet", "chocolatey", "scoop", "mise", "Volta", "pnpm", "nodejs"]) {
        assert.ok(dirs.some((d) => d.includes(needle)), `missing ${needle} in ${JSON.stringify(dirs)}`);
      }
    } else {
      for (const needle of ["flatpak", "nix", "volta", "snap"]) {
        assert.ok(dirs.some((d) => d.toLowerCase().includes(needle)), `missing ${needle} in ${JSON.stringify(dirs)}`);
      }
    }
  });

  it("probes muse CLI on Windows and provides dev.meta.ai install command", { skip: !hasBun() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "cxu-doc-muse-"));
    try {
      if (process.platform === "win32") {
        writeFileSync(join(dir, "muse.cmd"), "@echo off\r\necho 1.0.0\r\n");
      } else {
        writeFileSync(join(dir, "muse"), "#!/bin/sh\necho 1.0.0\n", { mode: 0o755 });
      }
      const script = [
        'const m = await import("./src/cli-doctor.ts");',
        'const muse = m.doctor().statuses.find((s) => s.id === "muse");',
        "console.log(JSON.stringify({ found: muse?.found, path: muse?.path ?? null, installHint: muse?.installHint }));",
      ].join("\n");
      const res = spawnSync("bun", ["-e", script], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
      const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
      const parsed = JSON.parse(lastLine);
      assert.equal(parsed.found, true, `muse CLI was not detected: ${lastLine}`);
      if (process.platform === "win32") {
        assert.match(parsed.installHint ?? "", /https:\/\/dev\.meta\.ai\/install\.ps1/);
      } else {
        assert.match(parsed.installHint ?? "", /https:\/\/dev\.meta\.ai\/install\.sh/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extractPowerShellScript correctly parses nested commands", { skip: !hasBun() }, () => {
    const script = [
      'const m = await import("./src/cli-doctor.ts");',
      'const muse = m.extractPowerShellScript(\'powershell -ExecutionPolicy ByPass -c "irm https://dev.meta.ai/install.ps1 | iex"\');',
      'const bun = m.extractPowerShellScript(\'powershell -c "irm bun.sh/install.ps1 | iex"\');',
      'const pwsh = m.extractPowerShellScript(\'pwsh.exe -Command "irm https://example.com/install.ps1 | iex"\');',
      'const npm = m.extractPowerShellScript(\'npm i -g opencode-ai@latest\');',
      "console.log(JSON.stringify({ muse, bun, pwsh, npm }));",
    ].join("\n");
    const res = spawnSync("bun", ["-e", script], { cwd: pkgRoot, encoding: "utf8", timeout: 60000, windowsHide: true });
    assert.equal(res.status, 0, `bun probe failed: ${res.stderr ?? ""}`);
    const lastLine = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    const parsed = JSON.parse(lastLine);
    assert.equal(parsed.muse, "irm https://dev.meta.ai/install.ps1 | iex");
    assert.equal(parsed.bun, "irm bun.sh/install.ps1 | iex");
    assert.equal(parsed.pwsh, "irm https://example.com/install.ps1 | iex");
    assert.equal(parsed.npm, null);
  });
});

