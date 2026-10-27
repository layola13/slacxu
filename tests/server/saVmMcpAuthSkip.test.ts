import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Regression tests for the CUX-AUTH-001 lock-in: the bridge must never latch
// onto a 401 responder. A node --import fetch shim scripts canned responses by
// call order, so no real ports are touched and the tests are hermetic.
function spawnBridge(shimResponses: string): { proc: any; responses: any[]; send: (msg: any) => void } {
  const root = process.cwd();
  const proc = spawn("node", [
    "--import",
    pathToFileURL(join(root, "tests", "server", "helpers", "saVmFetchShim.mjs")).href,
    join(root, "scripts", "sa-vm-mcp.mjs")
  ], {
    stdio: ["pipe", "pipe", "inherit"],
    // Force DEFAULT_PORTS probing (no pinned URL) and a clean token state.
    env: { ...process.env, SHIM_RESPONSES: shimResponses, CODEX_UI_API_URL: "", CODEX_UI_TOKEN: "" }
  });
  const responses: any[] = [];
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    try {
      responses.push(JSON.parse(line));
    } catch {}
  });
  return { proc, responses, send: (msg: any) => proc.stdin.write(JSON.stringify(msg) + "\n") };
}

function waitFor(responses: any[], id: number, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for response ${id}`)), timeoutMs);
    const poll = () => {
      const hit = responses.find((r) => r.id === id);
      if (hit) {
        clearTimeout(timer);
        resolve(hit);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

test("bridge skips a 401 responder and succeeds on the next candidate", async () => {
  const { proc, responses, send } = spawnBridge("401,200");
  send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sa_vm_run", arguments: { action: "count_lines", path: "package.json" } } });
  const res = await waitFor(responses, 1).finally(() => proc.kill());
  expect(res.result.isError).toBe(false);
  const text: string = res.result.content[0].text;
  expect(text).toContain("SHIM-OK tried=");
  const tried = text.split("tried=")[1].split("|");
  expect(tried.length).toBeGreaterThanOrEqual(2);
  expect(new Set(tried).size).toBe(tried.length);
}, 30000);

test("bridge reports a readable auth error when every candidate 401s", async () => {
  const { proc, responses, send } = spawnBridge("401");
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sa_vm_run", arguments: { action: "jev_thinking", question: "probe", options: { a: "x" } } } });
  const res = await waitFor(responses, 2).finally(() => proc.kill());
  expect(res.result.isError).toBe(true);
  const text: string = res.result.content[0].text;
  expect(text).toContain("rejected the sa-vm credential");
  expect(text).toContain("401");
  expect(text).toContain("CODEX_UI_TOKEN");
}, 30000);
