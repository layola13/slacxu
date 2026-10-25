import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChannelGroupConfig, JsonValue } from "@codex-ui/shared";
import { codexUiDataDir } from "./localDatabase.js";

export type CommandBlacklistMatch = {
  ruleId: string;
  rule: string;
  category: "file-delete" | "git-destructive" | "disk-destructive" | "database-destructive" | "network-external" | "restricted-read" | "restricted-probe" | "custom";
};

export type CommandBlacklistEvidence = {
  method: string;
  command: string;
  cwd?: string;
  threadId?: string;
  providerId?: string;
  groupId?: string;
  providerName?: string;
  groupName?: string;
  model?: string;
  workspaceMode?: string;
  match: CommandBlacklistMatch;
};

type BuiltinRule = CommandBlacklistMatch & { pattern: RegExp; identityAware?: boolean };

// SSH credential material. Key file names are matched wherever they appear
// because a copied key is still a key, and `.ssh` is matched as a path so a
// directory listing cannot enumerate the names inside it. `.pub` is included:
// a public key identifies the user's accounts and hosts and must not leave the
// machine either.
const SSH_KEY_NAMES = String.raw`\bid_(?:rsa|dsa|ecdsa|ed25519|ed448|xmss)(?:_sk)?\b|\bauthorized_keys2?\b|\bknown_hosts2?\b|\bssh_host_[a-z0-9_]*key\b|\.(?:pub|pem|ppk)\b(?!\/)|-----begin[a-z ]*private key`;
// Path form: `~/.ssh`, `/home/u/.ssh`, `c:\users\u\.ssh`, `$home/.ssh` or a
// relative `.ssh/...`. A bare `.ssh` word without a separator is deliberately
// excluded here so ordinary prose and file content stay executable; the probe
// rule below still catches it next to an enumeration verb.
const SSH_SECRET_PATH = String.raw`(?:[\\/]\.ssh\b|\.ssh[\\/]|${SSH_KEY_NAMES})`;
const SSH_SECRET_LOOSE = String.raw`(?:\.ssh\b|${SSH_KEY_NAMES})`;
// A file/directory RPC carries a path, not prose, so a bare `.ssh` segment is
// unambiguous there — including a relative `.ssh` request made from the home
// directory.
const SSH_SECRET_RAW_PATH = new RegExp(SSH_SECRET_LOOSE, "i");
// Enumeration, existence and metadata verbs across POSIX, PowerShell and cmd.
const PROBE_VERBS = String.raw`ls|dir|vdir|ll|stat|file|wc|du|tree|find|fd|locate|readlink|realpath|test|attrib|icacls|takeown|get-childitem|gci|get-item|gi|get-itemproperty|test-path|resolve-path|get-acl|select-string|sls|findstr|where|whereis|which|compgen`;

// These rules intentionally favor blocking a suspicious command over guessing
// that a shell wrapper is harmless. They cover POSIX, PowerShell and cmd.exe
// names as well as destructive Git and disk operations.
const BUILTIN_RULES: BuiltinRule[] = [
  {
    ruleId: "file-delete",
    rule: "file or directory deletion",
    category: "file-delete",
    pattern: /(?:^|[\s;&|])(?:sudo\s+|doas\s+|command\s+|env(?:\s+[^\s=]+=[^\s]+)*\s+)*(?:rm|rmdir|unlink|shred|del|erase|rd|remove-item|ri)\b(?!\s+--?(?:help|version)\b)/i
  },
  {
    ruleId: "find-delete",
    rule: "find -delete",
    category: "file-delete",
    pattern: /\bfind\b[^\n;&|]*\s(?:-delete|--delete)\b/i
  },
  {
    ruleId: "git-branch-delete",
    rule: "git branch deletion",
    category: "git-destructive",
    pattern: /\bgit\s+branch\b[^\n;&|]*(?:^|\s)(?:-d|-D|--delete)\b/i
  },
  {
    ruleId: "git-remote-delete",
    rule: "git remote or remote-ref deletion",
    category: "git-destructive",
    pattern: /\bgit\s+(?:push\b[^\n;&|]*(?:--delete|-d\b|\s:[^\s;&|]+)|remote\s+(?:remove|rm|prune)\b|update-ref\b[^\n;&|]*\s-d\b|symbolic-ref\b[^\n;&|]*--delete\b)/i
  },
  {
    ruleId: "git-history-destructive",
    rule: "destructive Git history operation",
    category: "git-destructive",
    pattern: /\bgit\s+(?:reset\b[^\n;&|]*--hard\b|clean\b|checkout\b[^\n;&|]*(?:\s--\s|\s\.\s*$)|restore\b|rebase\b|filter-(?:branch|repo)\b|reflog\s+(?:delete|expire)\b|tag\b[^\n;&|]*(?:^|\s)-d\b|worktree\s+remove\b|gc\b[^\n;&|]*--prune\b|stash\s+(?:drop|clear)\b|prune\b|notes\s+remove\b|replace\s+-d\b)/i
  },
  {
    ruleId: "git-force-write",
    rule: "forced Git remote update",
    category: "git-destructive",
    pattern: /\bgit\s+push\b[^\n;&|]*(?:--force|-f\b|--mirror\b)\b/i
  },
  {
    ruleId: "disk-format",
    rule: "disk or volume formatting",
    category: "disk-destructive",
    pattern: /(?:^|[\s;&|])(?:format(?:\.com)?|mkfs(?:\.[\w-]+)?|diskpart|clear-disk|format-volume)\b|\bdd\b[^\n;&|]*\bif\s*=/i
  },
  {
    ruleId: "database-destructive",
    rule: "database or persistent-volume deletion",
    category: "database-destructive",
    pattern: /(?:\b(?:drop\s+(?:database|schema|table|index|view)|truncate\s+(?:table\b|\w)|delete\s+from\s+\w|alter\s+table\b[^\n;&|]*\bdrop\b)|\b(?:redis-cli\b[^\n;&|]*\bflush(?:all|db)\b|(?:mongosh|mongo)\b[^\n;&|]*\bdropdatabase\b|docker\s+(?:volume|system)\s+(?:rm|prune)\b|docker\s+system\s+prune\b|kubectl\s+delete\b|aws\s+s3\s+rm\b[^\n;&|]*--recursive\b|az\s+storage\s+.*\bdelete\b))/i
  },
  {
    ruleId: "external-http",
    rule: "non-search third-party HTTP request",
    category: "network-external",
    pattern: /(?:\b(?:curl|wget|http|httpie)\b[^\n;&|]*(?:https?:\/\/|\$\{?[a-z_][\w-]*\}?\b)|\b(?:invoke-webrequest|invoke-restmethod|start-bitstransfer)\b|\b(?:python|python3)\b[^\n;&|]*(?:requests?\.(?:get|post|put|patch|delete)|urllib(?:\.request)?)\b|\bnode\b[^\n;&|]*(?:fetch\s*\(|axios\.(?:get|post|put|patch|delete))|\bgit\s+clone\s+https?:\/\/|\b(?:scp|sftp|rsync)\b[^\n;&|]*\b(?:[\w.-]+@)?[a-z0-9.-]+:(?:\/|[^\s;&|]+)|\brclone\s+(?:copy|sync|move)\b)/i
  },
  {
    ruleId: "windows-special-read",
    rule: "reading a protected Windows system directory",
    category: "restricted-read",
    pattern: /(?:[a-z]:[\\/]+(?:windows|program[ _-]?files(?:\s*\(x86\))?|programdata|\$recycle\.bin|system\s+volume\s+information)(?:[\\/]|$)|[\\/]?(?:windows|program[ _-]?files|programdata|\$recycle\.bin|system\s+volume\s+information)(?:[\\/]|$)|[a-z]:[\\/]+users[\\/]+[^\\/\s]+[\\/]appdata(?:[\\/]|$))/i
  },
  {
    ruleId: "credential-probe",
    rule: "probing for SSH credentials or scanning hosts",
    category: "restricted-probe",
    identityAware: true,
    // Reconnaissance is blocked before a read is even attempted: existence and
    // metadata checks against key material, filesystem sweeps for key names,
    // content sweeps for PEM headers, remote host-key collection and port or
    // host scanners.
    pattern: new RegExp(
      String.raw`(?:\b(?:${PROBE_VERBS})\b|\[\s*-[a-z]{1,2}\s)[^\n;&|]*${SSH_SECRET_LOOSE}`
      + String.raw`|\bfind\b[^\n;&|]*\s-(?:i?name|i?path|i?regex|i?wholename)\s+["']?[^\n;&|]*(?:id_[a-z*?]|\.(?:pub|pem|ppk)|\.ssh)`
      + String.raw`|\b(?:grep|rg|ag|select-string|findstr)\b[^\n;&|]*(?:private key|begin openssh|begin rsa|ssh-rsa|ssh-ed25519)`
      + String.raw`|\bssh-keyscan\b|\bssh\b[^\n;&|]*\s-g\b`
      + String.raw`|\b(?:nmap|masscan|zmap|zgrab|rustscan|naabu|nping|hping3?|arp-scan|arping|netdiscover|fping|nbtscan|portqry|test-netconnection)\b`
      + String.raw`|\b(?:nc|ncat|netcat)\b[^\n;&|]*\s-[a-z]*z[a-z]*\b`,
      "i"
    )
  },
  {
    ruleId: "ssh-key-read",
    rule: "reading, copying or exporting SSH key material",
    category: "restricted-read",
    identityAware: true,
    // Any reference to key material is refused rather than trusting a reader
    // allowlist, because `cat`, `xxd`, `python -c`, an editor or an unknown
    // wrapper all disclose the same bytes. `ssh -i <key> user@host` uses a key
    // without printing it and is masked out before this rule runs, so ordinary
    // connections stay available. `ssh-add -l/-L` exports agent keys without
    // naming a path and is matched separately.
    pattern: new RegExp(String.raw`${SSH_SECRET_PATH}|\bssh-add\b[^\n;&|]*\s-[lLe]\b`, "i")
  }
];

export class CommandBlacklistPolicy {
  private readonly logFiles: string[];
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(options: { logDir?: string; logPath?: string } = {}) {
    const logDir = options.logDir
      ?? process.env.CODEX_UI_LOG_DIR?.trim()
      ?? join(codexUiDataDir(), "logs");
    // logs.txt is the explicit evidence file requested by the product. The
    // normal desktop log.txt receives the same line so operators can find it
    // in the existing Windows log location without special tooling.
    this.logFiles = [...new Set([
      options.logPath ?? join(logDir, "logs.txt"),
      join(logDir, "log.txt")
    ])];
  }

  public enabled(group?: ChannelGroupConfig | null): boolean {
    return group?.commandBlacklistEnabled !== false;
  }

  public inspect(command: string, group?: ChannelGroupConfig | null): CommandBlacklistMatch | null {
    if (!this.enabled(group)) return null;
    const normalized = normalizeCommand(command);
    if (!normalized) return null;
    let masked: string | null = null;
    for (const rule of BUILTIN_RULES) {
      const target = rule.identityAware ? (masked ??= maskConnectionIdentity(normalized)) : normalized;
      if (rule.pattern.test(target)) {
        if (rule.ruleId === "external-http" && this.networkCommandAllowed(normalized, group)) continue;
        return { ruleId: rule.ruleId, rule: rule.rule, category: rule.category };
      }
    }
    for (const custom of group?.commandBlacklist ?? []) {
      const fragment = typeof custom === "string" ? custom.trim().toLowerCase() : "";
      if (fragment && normalized.includes(fragment)) {
        return { ruleId: "custom", rule: custom.trim().slice(0, 256), category: "custom" };
      }
    }
    return null;
  }

  public inspectPath(path: string, group?: ChannelGroupConfig | null): CommandBlacklistMatch | null {
    if (!this.enabled(group)) return null;
    const normalized = normalizeCommand(path);
    if (!normalized) return null;
    // Directory/file RPCs can expose a secret even when no shell command is
    // involved, so the protected-directory and SSH credential rules are applied
    // to the raw path. The `.ssh` directory itself counts: listing it
    // enumerates the key names an attacker would read next.
    const windowsRule = BUILTIN_RULES.find((entry) => entry.ruleId === "windows-special-read");
    if (windowsRule?.pattern.test(normalized)) {
      return { ruleId: windowsRule.ruleId, rule: windowsRule.rule, category: windowsRule.category };
    }
    const sshRule = BUILTIN_RULES.find((entry) => entry.ruleId === "ssh-key-read");
    return sshRule && SSH_SECRET_RAW_PATH.test(normalized)
      ? { ruleId: sshRule.ruleId, rule: sshRule.rule, category: sshRule.category }
      : null;
  }

  /**
   * File and directory RPCs (`fs/readFile`, `fs/readDirectory`,
   * `fs/getMetadata`) carry a path, not a shell command. Both forms are
   * inspected: the command form catches the shell-style spellings the rules were
   * written against, and the raw path catches a bare relative request such as
   * `.ssh`, which the command form cannot tell apart from ordinary prose.
   */
  public inspectFileRpcPath(path: string, group?: ChannelGroupConfig | null): CommandBlacklistMatch | null {
    if (!path) return null;
    return this.inspect(`read ${path}`, group) ?? this.inspectPath(path, group);
  }

  public inspectNetworkPermission(group?: ChannelGroupConfig | null): CommandBlacklistMatch | null {
    if (!this.enabled(group)) return null;
    const rule = BUILTIN_RULES.find((entry) => entry.ruleId === "external-http");
    return rule ? { ruleId: rule.ruleId, rule: "non-search network permission", category: rule.category } : null;
  }

  public networkCommandAllowed(command: string, group?: ChannelGroupConfig | null): boolean {
    if (!this.enabled(group)) return true;
    const allowlist = normalizedAllowlist(group?.networkAllowlist ?? []);
    const targets = extractNetworkTargets(command);
    if (targets.length === 0) return false;
    return targets.length > 0 && targets.every((target) => {
      if (isPrivateNetworkHost(target.host)) return true;
      // Public traffic must use the default TLS endpoint. Plain HTTP and
      // explicit HTTPS ports are blocked before the user allowlist is checked.
      if ((target.protocol && target.protocol !== "https") || (target.protocol === "https" && target.port)) return false;
      return allowlist.some((entry) => networkTargetMatches(target, entry));
    });
  }

  public async recordBlocked(evidence: CommandBlacklistEvidence): Promise<void> {
    const record = {
      event: "command-blacklist-blocked",
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      method: evidence.method,
      command: redactSensitiveCommand(evidence.command).slice(0, 8_192),
      cwd: evidence.cwd,
      threadId: evidence.threadId,
      providerId: evidence.providerId,
      groupId: evidence.groupId,
      providerName: evidence.providerName,
      groupName: evidence.groupName,
      model: evidence.model,
      workspaceMode: evidence.workspaceMode,
      matchedRule: evidence.match
    } satisfies Record<string, JsonValue | undefined>;
    const line = JSON.stringify(record) + "\n";
    this.writeQueue = this.writeQueue.then(async () => {
      for (const file of this.logFiles) {
        try {
          await mkdir(dirname(file), { recursive: true });
          await appendFile(file, line, "utf8");
        } catch (error) {
          // Evidence logging must never turn a safety rejection into an
          // execution failure. The next configured log target can still work.
          console.warn("Unable to write command blacklist evidence", { file, error });
        }
      }
    });
    await this.writeQueue;
  }

  public rejection(method: string): JsonValue {
    if (method === "execCommandApproval") return { decision: "denied" };
    if (method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
    return { decision: "decline" };
  }
}

export function commandFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join(" ");
  return "";
}

function normalizeCommand(command: string): string {
  return command
    .replace(/[\u0000\r\n]+/g, " ")
    .replace(/\\([;&|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// `ssh-copy-id`, `ssh-keygen`, `ssh-add` and `ssh-keyscan` are not connection
// tools: they publish, derive or list key material, so the identity mask below
// must not apply to them.
const CONNECTION_TOOL = /^(?:sudo\s+|doas\s+|env(?:\s+[^\s=]+=[^\s]+)*\s+)*(?:ssh|scp|sftp|rsync|git)(?![-\w])/;

/**
 * `ssh -i ~/.ssh/id_ed25519 user@host` authenticates with a key without
 * disclosing it, so the identity argument of a connection command is removed
 * before the SSH rules run. The mask is scoped to connection tools on purpose:
 * `cp -i ~/.ssh/id_rsa /tmp` keeps its source path and stays blocked.
 */
function maskConnectionIdentity(command: string): string {
  return command
    .split(/&&|\|\||[;|&]/)
    .map((segment) => CONNECTION_TOOL.test(segment.trim())
      ? segment
        .replace(/(^|\s)-i\s+(?:"[^"]*"|'[^']*'|\S+)/g, "$1")
        .replace(/(^|["'\s])(?:-o\s+)?identityfile[\s=]+(?:"[^"]*"|'[^']*'|[^\s"']+)/g, "$1")
      : segment)
    .join(" ; ");
}

function redactSensitiveCommand(command: string): string {
  return command
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\s*[=:]\s*)([^\s'"`;&|]+)/gi, "$1<redacted>")
    .replace(/\b(sk-[a-z0-9_-]{8,})\b/gi, "<redacted-key>");
}

type NetworkTarget = { raw: string; protocol?: string; host: string; port?: string; path?: string };

function extractNetworkTargets(command: string): NetworkTarget[] {
  const targets: NetworkTarget[] = [];
  const urlPattern = /https?:\/\/[^\s'"`;&|)]+/gi;
  for (const raw of command.match(urlPattern) ?? []) {
    try {
      const parsed = new URL(raw);
      targets.push({ raw, protocol: parsed.protocol.slice(0, -1).toLowerCase(), host: parsed.hostname.toLowerCase(), port: parsed.port || undefined, path: parsed.pathname });
    } catch {
      // Ignore malformed URLs; the command remains blocked when no target can
      // be matched against the trusted list.
    }
  }
  const scpPattern = /(?:scp|sftp|rsync)\b[^\n;&|]*?(?:^|\s)(?:[\w.-]+@)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::|\/)/gi;
  for (const match of command.matchAll(scpPattern)) {
    const host = match[1]?.toLowerCase();
    if (host && !targets.some((target) => target.host === host)) targets.push({ raw: match[0], host });
  }
  return targets;
}

function normalizedAllowlist(values: string[]): string[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 256);
}

function networkTargetMatches(target: NetworkTarget, allowed: string): boolean {
  if (allowed === "*") return true;
  let candidate = allowed;
  let parsed: URL | null = null;
  try {
    parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  const hostMatches = hostname.startsWith("*.")
    ? target.host === hostname.slice(2) || target.host.endsWith(`.${hostname.slice(2)}`)
    : target.host === hostname;
  if (!hostMatches) return false;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (target.protocol && target.protocol !== parsed.protocol.slice(0, -1)) return false;
  if (parsed.port && target.port !== parsed.port) return false;
  const prefix = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : "";
  return !prefix || (target.path ?? "/") === prefix || (target.path ?? "/").startsWith(`${prefix}/`);
}

/** Loopback, RFC1918 and link-local targets stay inside the user's machine or LAN. */
function isPrivateNetworkHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "localhost.localdomain" || normalized === "::1") return true;
  const octets = normalized.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}
