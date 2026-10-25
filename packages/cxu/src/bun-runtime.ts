import { spawnSync } from "node:child_process";

export function isBunAvailable(): boolean {
  try {
    const res = spawnSync("bun", ["--version"], { stdio: "ignore", timeout: 2000, windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function getBunInstallHint(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return 'powershell -c "irm bun.sh/install.ps1 | iex"';
  }
  if (platform === "darwin" || platform === "linux") {
    return "curl -fsSL https://bun.sh/install | bash";
  }
  return "Please install bun via your system package manager (e.g. pkg install bun), or see https://bun.sh";
}

export function ensureBunOrHint(): { ok: true } | { ok: false; hint: string } {
  if (isBunAvailable()) return { ok: true };
  return {
    ok: false,
    hint: `Bun runtime not detected. To run TypeScript tracks (run_bun), install it first: ${getBunInstallHint()}. Single-step file tools (read_file, edit_file, grep_search, apply_patch, etc.) work without Bun.`,
  };
}
