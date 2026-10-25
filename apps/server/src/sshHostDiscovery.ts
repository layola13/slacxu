import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_MS = 30_000;

export type SshConfigHost = { alias: string; hostname: string; user: string; port: number; configFile: string };
let cached: { at: number; hosts: SshConfigHost[] } | null = null;

export async function discoverSshConfigHosts(options: { home?: string; force?: boolean } = {}): Promise<SshConfigHost[]> {
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) return cached.hosts;
  const home = resolve(options.home ?? homedir());
  const hosts = discoverAliases(join(home, ".ssh", "config"), home);
  hosts.sort((left, right) => left.alias.localeCompare(right.alias, undefined, { sensitivity: "base" }));
  cached = { at: Date.now(), hosts };
  return hosts;
}

export async function probeSshConfigHost(
  alias: string,
  options: {
    home?: string;
    execute?: (file: string, args: string[]) => Promise<{ stdout: string }>;
  } = {}
) {
  const normalized = alias.trim();
  const host = (await discoverSshConfigHosts({ home: options.home })).find((entry) => entry.alias === normalized);
  if (!host) throw new Error("SSH config host was not found");
  const execute = options.execute ?? (async (file, args) => {
    const result = await execFileAsync(file, args, { timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
    return { stdout: String(result.stdout) };
  });
  const script = "printf 'home=%s\n' \"$HOME\"; printf 'user=%s\n' \"$(id -un 2>/dev/null || whoami)\"; printf 'os=%s\n' \"$(uname -s 2>/dev/null || echo unknown)\"; printf 'arch=%s\n' \"$(uname -m 2>/dev/null || echo unknown)\"";
  const { stdout } = await execute("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", normalized, script]);
  const values = parseKeyValues(stdout);
  if (!values.home) throw new Error("SSH host connected, but its home directory could not be detected");
  return { command: "ssh " + normalized, home: values.home, user: values.user || host.user, os: values.os || "unknown", arch: values.arch || "unknown", host };
}

function discoverAliases(configPath: string, home: string): SshConfigHost[] {
  const visited = new Set<string>();
  const aliases = new Map<string, SshConfigHost>();
  const visit = (path: string) => {
    const absolute = resolve(path);
    if (visited.has(absolute) || !existsSync(absolute)) return;
    visited.add(absolute);
    let activeAliases: string[] = [];
    for (const rawLine of readFileSync(absolute, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.search(/\s/);
      const keyword = (separator < 0 ? line : line.slice(0, separator)).toLowerCase();
      const value = separator < 0 ? "" : line.slice(separator).trim();
      if (keyword === "include") {
        for (const pattern of splitConfigWords(value)) for (const included of expandInclude(pattern, dirname(absolute), home)) visit(included);
      } else if (keyword === "host") {
        activeAliases = splitConfigWords(value).filter((alias) => alias && !/[*?!]/.test(alias));
        for (const alias of activeAliases) if (!aliases.has(alias)) aliases.set(alias, { alias, hostname: alias, user: "", port: 22, configFile: absolute });
      } else if (activeAliases.length > 0) {
        for (const alias of activeAliases) {
          const host = aliases.get(alias);
          if (!host) continue;
          if (keyword === "hostname" && host.hostname === alias) host.hostname = value || alias;
          if (keyword === "user" && !host.user) host.user = value;
          if (keyword === "port" && host.port === 22) host.port = validPort(value);
        }
      }
    }
  };
  visit(configPath);
  return [...aliases.values()];
}

function expandInclude(pattern: string, configDir: string, home: string): string[] {
  const expanded = pattern.replace(/^~(?=$|[\/])/, home);
  const absolute = isAbsolute(expanded) ? expanded : resolve(configDir, expanded);
  if (!/[*?]/.test(absolute)) return [absolute];
  const directory = dirname(absolute);
  if (!existsSync(directory)) return [];
  const namePattern = absolute.slice(directory.length + 1);
  const expression = new RegExp("^" + namePattern.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return readdirSync(directory).filter((name) => expression.test(name)).map((name) => join(directory, name));
}

function splitConfigWords(value: string): string[] { return [...value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "").filter(Boolean); }
function parseKeyValues(output: string): Record<string, string> { const result: Record<string, string> = {}; for (const line of output.split(/\r?\n/)) { const index = line.indexOf("="); if (index > 0) result[line.slice(0, index)] = line.slice(index + 1).trim(); } return result; }
function validPort(value: string | undefined): number { const port = Number(value); return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22; }
