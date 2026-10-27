import { describe, expect, test } from "bun:test";
import { CLAUDE_POSIX_CANDIDATES, remoteClaudeProbeFragment, remoteClaudeProbeScript } from "../../apps/server/src/sshCodeCliBridge";
import { planRemoteClaudeInstall, remoteBunNodeProbeScript } from "../../apps/server/src/remoteBunNode";

/**
 * Reports the parenthesis nesting depth at every `exit` in a POSIX script. The
 * batched probe only stays correct while each `exit` sits inside a subshell:
 * at depth 0 it would end the whole SSH round trip and silently truncate every
 * later key.
 */
function exitDepths(script: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (script.startsWith("exit", index) && /[\s;]/.test(script[index - 1] ?? " ")) depths.push(depth);
  }
  return depths;
}

describe("remote node Claude probe", () => {
  test("shares its candidate list with the SSH bridge probe", () => {
    const script = remoteBunNodeProbeScript(43130);
    for (const candidate of CLAUDE_POSIX_CANDIDATES.split(" \"").map((entry, index) => (index === 0 ? entry : "\"" + entry))) {
      expect(script).toContain(candidate);
      expect(remoteClaudeProbeScript("posix")).toContain(candidate);
    }
  });

  test("covers the locations the official installer and version managers use", () => {
    // A host that can launch a foreground SSH Claude thread must never be
    // reported as Claude-less by the remote node, so both probes look past
    // PATH: a non-interactive shell often skips the profile that exports it.
    for (const location of ["$HOME/.local/bin/claude", "$HOME/.claude/local/claude", "/opt/homebrew/bin/claude", "$HOME/.bun/bin/claude", "bash -lc 'command -v claude'"]) {
      expect(remoteBunNodeProbeScript(43130)).toContain(location);
    }
  });

  test("cannot truncate the batched probe when a candidate matches", () => {
    const fragment = remoteClaudeProbeFragment();
    expect(exitDepths(fragment).every((depth) => depth > 0)).toBe(true);

    const script = remoteBunNodeProbeScript(43130);
    expect(exitDepths(script).every((depth) => depth > 0)).toBe(true);
    // Keys emitted after the Claude fragment must still be reachable.
    const claudeIndex = script.indexOf("claudePath=");
    for (const key of ["systemdUser=", "installed=", "releaseId=", "serviceState=", "healthBase64="]) {
      expect(script.indexOf(key)).toBeGreaterThan(claudeIndex);
    }
  });

  test("reports an absent CLI as empty values rather than a missing key", () => {
    expect(remoteClaudeProbeFragment()).toContain("echo claudePath=");
    expect(remoteClaudeProbeFragment()).toContain("echo claudeVersion=");
  });
});

describe("remote node Claude install policy", () => {
  // The install itself shells out to ssh and is exercised by the remote-node
  // smoke scripts; the decision that precedes it is the part worth pinning.
  test("follows the host when the caller says nothing", () => {
    expect(planRemoteClaudeInstall({ claudePath: "/home/vscode/.local/bin/claude" })).toBe("enabled");
    expect(planRemoteClaudeInstall({ claudePath: "" })).toBe("disabled");
  });

  test("refuses to silently disable a backend the caller asked for", () => {
    // Asking for the backend is asking for the binary: the user-scope installer
    // needs no root, so the request is honoured instead of downgraded.
    expect(planRemoteClaudeInstall({ enableClaude: true, claudePath: "" })).toBe("install");
    expect(planRemoteClaudeInstall({ enableClaude: true, claudePath: "/usr/local/bin/claude" })).toBe("enabled");
  });

  test("installs only when Claude is actually wanted", () => {
    expect(planRemoteClaudeInstall({ enableClaude: true, installClaude: true, claudePath: "" })).toBe("install");
    // installClaude alone is request enough: nobody opts into an install and
    // then expects the backend to stay off.
    expect(planRemoteClaudeInstall({ installClaude: true, claudePath: "" })).toBe("install");
    // An existing binary is never reinstalled.
    expect(planRemoteClaudeInstall({ installClaude: true, claudePath: "/usr/local/bin/claude" })).toBe("enabled");
  });

  test("surfaces the gap when the caller opts out of installing", () => {
    expect(planRemoteClaudeInstall({ enableClaude: true, installClaude: false, claudePath: "" })).toBe("missing");
    expect(planRemoteClaudeInstall({ enableClaude: true, installClaude: false, claudePath: "/usr/local/bin/claude" })).toBe("enabled");
  });

  test("an explicit disable outranks an install request", () => {
    expect(planRemoteClaudeInstall({ enableClaude: false, installClaude: true, claudePath: "" })).toBe("disabled");
    expect(planRemoteClaudeInstall({ enableClaude: false, claudePath: "/usr/local/bin/claude" })).toBe("disabled");
  });
});
