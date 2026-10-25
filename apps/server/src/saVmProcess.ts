import { spawnSync } from "node:child_process";

export function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } catch {}
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
}
