import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  RELAY_GATEWAY_ENV_KEY,
  ensureRelayGatewayToken,
  publishWindowsUserRelayGatewayToken
} = require("../../desktop/relay-gateway-token.cjs") as {
  RELAY_GATEWAY_ENV_KEY: string;
  ensureRelayGatewayToken: (options: {
    env: Record<string, string | undefined>;
    tokenPath: string;
    createToken?: () => string;
  }) => string;
  publishWindowsUserRelayGatewayToken: (
    token: string,
    options: {
      platform: string;
      spawnSyncFn?: (command: string, args: string[], options: Record<string, unknown>) => { status: number };
    }
  ) => { ok: boolean; skipped: boolean };
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryTokenPath() {
  const directory = mkdtempSync(join(tmpdir(), "codex-ultra-relay-token-"));
  temporaryDirectories.push(directory);
  return join(directory, "relay-gateway-token");
}

test("relay gateway token persists and is reused across desktop launches", () => {
  const tokenPath = temporaryTokenPath();
  const generated = "generated-relay-gateway-token-00000001";
  const first = ensureRelayGatewayToken({ env: {}, tokenPath, createToken: () => generated });
  const second = ensureRelayGatewayToken({ env: {}, tokenPath, createToken: () => "different-relay-gateway-token-000002" });

  expect(first).toBe(generated);
  expect(second).toBe(generated);
  expect(readFileSync(tokenPath, "utf8").trim()).toBe(generated);
});

test("an explicit environment token becomes the persisted gateway token", () => {
  const tokenPath = temporaryTokenPath();
  const token = "external-windows-relay-token-00000001";

  expect(ensureRelayGatewayToken({ env: { [RELAY_GATEWAY_ENV_KEY]: token }, tokenPath })).toBe(token);
  expect(readFileSync(tokenPath, "utf8").trim()).toBe(token);
});

test("Windows publishes the gateway token for independently launched Codex apps", () => {
  const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
  const token = "published-windows-relay-token-0000001";
  const result = publishWindowsUserRelayGatewayToken(token, {
    platform: "win32",
    spawnSyncFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  expect(result).toEqual({ ok: true, skipped: false });
  expect(calls).toEqual([{
    command: "setx.exe",
    args: [RELAY_GATEWAY_ENV_KEY, token],
    options: { windowsHide: true, stdio: "ignore" }
  }]);
});

test("non-Windows desktop launches do not publish a user environment variable", () => {
  const result = publishWindowsUserRelayGatewayToken("linux-relay-gateway-token-000000001", { platform: "linux" });
  expect(result).toEqual({ ok: true, skipped: true });
});
