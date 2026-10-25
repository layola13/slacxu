import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doctor } from "./cli-doctor.js";
import { ensureServerBinary } from "./server-build.js";

export function serveHelp(): void {
  console.log("cxu: start the codex-ultra workbench (server + web UI).");
  console.log("  cxu [PORT] [--no-prompt]  Start the server (e.g. `cxu 43110`)");
  console.log("  cxu serve [--port N] [--data-dir DIR]   Start with options");
  console.log("  cxu doctor [--yes|--all] [--no-prompt]  Check CLIs; prompt a/s/m when missing");
  console.log("  cxu install [tool] [--yes] Print or run official installers");
  console.log("  cxu --help, -h            Show this help");
  console.log("  cxu --version, -v         Print installed version");
  console.log("");
  console.log("Doctor tools: bun + codex/claude/agy/grok/pi/opencode [optional] + MiniAgent [BUILTIN].");
  console.log("Missing tools offer: [a]uto-install, [s]kip, [m]anual commands.");
  console.log("The server is compiled locally with Bun on first run (one-time per version).");
}

function parseServeArgs(rawArgs: string[]): { port?: string; host?: string; dataDir?: string; passthrough: string[] } {
  const passthrough: string[] = [];
  let port: string | undefined;
  let host: string | undefined;
  let dataDir: string | undefined;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]!;
    if ((arg === "--port" || arg === "-p") && index + 1 < rawArgs.length) {
      port = rawArgs[(index += 1)]!;
    } else if (arg.startsWith("--port=")) {
      port = arg.slice("--port=".length);
    } else if (arg === "--host" && index + 1 < rawArgs.length) {
      host = rawArgs[(index += 1)]!;
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg === "--data-dir" && index + 1 < rawArgs.length) {
      dataDir = rawArgs[(index += 1)]!;
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    } else if (arg === "--no-prompt") {
      // already handled in doctor check before runServe
    } else if (/^\d+$/.test(arg) && !port) {
      port = arg;
    } else {
      passthrough.push(arg);
    }
  }
  return { port, host, dataDir, passthrough };
}

export async function runServe(rawArgs: string[]): Promise<number> {
  const { port, host, dataDir, passthrough } = parseServeArgs(rawArgs);
  const server = ensureServerBinary();
  if (!server.ok) {
    console.error(server.hint);
    return 1;
  }
  const exePath = server.exePath;
  const isNode = Boolean(server.isNodeScript && server.scriptPath);
  const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const hostWebDist = join(pkgDir, "web-dist");
  const env = { ...process.env };
  if (!env.CODEX_UI_WEB_DIST) {
    if (existsSync(join(hostWebDist, "index.html"))) {
      env.CODEX_UI_WEB_DIST = hostWebDist;
    }
  }
  if (!env.CODEX_UI_PI_RELAY_EXTENSION) {
    const hostPiRelayCandidates = [
      join(pkgDir, "extensions", "pi-relay"),
      join(pkgDir, "server-bundle", "extensions", "pi-relay"),
      join(dirname(exePath), "extensions", "pi-relay"),
    ];
    const foundExt = hostPiRelayCandidates.find((c) => existsSync(join(c, "index.js")));
    if (foundExt) {
      env.CODEX_UI_PI_RELAY_EXTENSION = foundExt;
    }
  }
  if (!env.SA_VM_MCP_SOURCE_PATH) {
    const hostSaVmCandidates = [
      join(pkgDir, "server-bundle", "sa-vm-mcp.mjs"),
      join(pkgDir, "scripts", "sa-vm-mcp.mjs"),
      join(dirname(exePath), "sa-vm-mcp.mjs"),
    ];
    const foundMcp = hostSaVmCandidates.find((c) => existsSync(c));
    if (foundMcp) {
      env.SA_VM_MCP_SOURCE_PATH = foundMcp;
    }
  }
  if (!env.CODEX_UI_LEGAL_DIR) {
    const legalCandidates = [
      join(pkgDir, "legal"),
      pkgDir,
      join(dirname(exePath), "legal"),
      dirname(exePath),
    ];
    const foundLegal = legalCandidates.find((c) => existsSync(join(c, "PRIVACY.md")));
    if (foundLegal) {
      env.CODEX_UI_LEGAL_DIR = foundLegal;
    }
  }
  if (port && !env.CODEX_UI_PORT) env.CODEX_UI_PORT = port;
  if (host && !env.CODEX_UI_HOST) env.CODEX_UI_HOST = host;
  if (dataDir && !env.CODEX_UI_DATA_DIR) env.CODEX_UI_DATA_DIR = dataDir;
  if (!env.CODEX_BIN || !env.CODEX_UI_CODEX_AVAILABLE) {
    const doc = doctor();
    const codexStatus = doc.statuses.find((s) => s.id === "codex");
    if (!env.CODEX_BIN && codexStatus?.path && codexStatus.found) {
      env.CODEX_BIN = codexStatus.path;
    }
    if (!env.CODEX_UI_CODEX_AVAILABLE && codexStatus) {
      env.CODEX_UI_CODEX_AVAILABLE = (codexStatus.found && Boolean(codexStatus.version)) ? "1" : "0";
    }
  }
  const listenPort = env.CODEX_UI_PORT?.trim() || "43110";
  const listenHost = env.CODEX_UI_HOST?.trim() || "127.0.0.1";
  console.log(`codex-ultra workbench starting: http://${listenHost}:${listenPort}/`);
  const targetBinary = isNode ? process.execPath : exePath;
  const targetArgs = isNode ? [server.scriptPath!, ...passthrough] : passthrough;
  if (!isNode && process.platform !== "win32") {
    try {
      chmodSync(exePath, 0o755);
    } catch {
    }
  }
  const fallbackBundle = server.bundlePath || server.scriptPath;
  let child: ChildProcess;
  try {
    child = spawn(targetBinary, targetArgs, { stdio: "inherit", env, windowsHide: false });
  } catch (err: any) {
    if (!isNode && (err?.code === "EFTYPE" || err?.code === "ENOEXEC" || err?.errno === -4028) && fallbackBundle) {
      console.warn(`cxu: compiled server binary failed (${err.code || "corrupted"}); removing binary and falling back to Node.js...`);
      try { rmSync(exePath, { force: true }); } catch {}
      child = spawn(process.execPath, [fallbackBundle, ...passthrough], { stdio: "inherit", env, windowsHide: false });
    } else {
      throw err;
    }
  }
  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", (error: any) => {
      if (!isNode && (error?.code === "EFTYPE" || error?.code === "ENOEXEC" || error?.errno === -4028) && fallbackBundle) {
        console.warn(`cxu: compiled server binary failed (${error.code || "corrupted"}); removing binary and falling back to Node.js...`);
        try { rmSync(exePath, { force: true }); } catch {}
        try {
          const fallbackChild = spawn(process.execPath, [fallbackBundle, ...passthrough], { stdio: "inherit", env, windowsHide: false });
          fallbackChild.on("error", (fallbackErr) => {
            console.error(`Failed to start server: ${fallbackErr.message}`);
            resolve(1);
          });
          fallbackChild.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
          return;
        } catch {
        }
      }
      console.error(`Failed to start server: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  return exitCode;
}
