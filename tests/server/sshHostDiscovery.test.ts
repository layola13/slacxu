import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { discoverSshConfigHosts, probeSshConfigHost } from "../../apps/server/src/sshHostDiscovery";

test("discovers explicit SSH aliases through Include and omits wildcard hosts", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-ssh-config-"));
  const ssh = join(home, ".ssh");
  const included = join(ssh, "config.d");
  mkdirSync(included, { recursive: true });
  writeFileSync(join(ssh, "config"), `Include "${join(included, "*").replace(/\\/g, "/")}"\nHost direct-host\n  HostName direct.example\n  User alice\nHost *\n  ServerAliveInterval 30\n`);
  writeFileSync(join(included, "work"), "Host included-host\n  HostName included.example\n  User bob\n  Port 2222\n");
  const hosts = await discoverSshConfigHosts({ home, force: true });
  expect(hosts.map((entry) => entry.alias)).toEqual(["direct-host", "included-host"]);
  expect(hosts.find((entry) => entry.alias === "direct-host")).toMatchObject({ hostname: "direct.example", user: "alice", port: 22 });
  expect(hosts.find((entry) => entry.alias === "included-host")).toMatchObject({ hostname: "included.example", user: "bob", port: 2222 });
  expect(hosts.find((entry) => entry.alias === "included-host")?.configFile).toBe(join(included, "work"));
});

test("only probes the one SSH host explicitly selected by the user", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-ssh-probe-"));
  const ssh = join(home, ".ssh");
  mkdirSync(ssh, { recursive: true });
  writeFileSync(join(ssh, "config"), "Host alpha\n  HostName alpha.example\nHost beta\n  HostName beta.example\n");
  const calls: string[][] = [];

  const listed = await discoverSshConfigHosts({ home, force: true });
  expect(listed.map((entry) => entry.alias)).toEqual(["alpha", "beta"]);
  expect(calls).toEqual([]);

  const result = await probeSshConfigHost("beta", {
    home,
    execute: async (_file, args) => { calls.push(args); return { stdout: "home=/srv/vscode\nuser=vscode\nos=Linux\narch=x86_64\n" }; }
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.slice(0, 5)).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "beta"]);
  expect(result).toMatchObject({ command: "ssh beta", home: "/srv/vscode", user: "vscode" });
});
