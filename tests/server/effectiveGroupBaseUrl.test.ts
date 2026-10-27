import { expect, test } from "bun:test";
import { OPENCODE_BACKEND_USER_AGENTS } from "../../backends/relay-config/src/relay/omniRouteFree.ts";
import { resolveOpenCodeBackendUserAgent, resolveThreadStableSessionId, withEffectiveGroupBaseUrl } from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";

test("withEffectiveGroupBaseUrl fills a missing group baseUrl from the provider", () => {
  const group: any = { id: "go", baseUrl: null };
  const filled = withEffectiveGroupBaseUrl(group, "https://opencode.ai/zen/go/v1");
  expect(filled.baseUrl).toBe("https://opencode.ai/zen/go/v1");
  expect(filled).not.toBe(group);
  expect(group.baseUrl).toBeNull();
});

test("withEffectiveGroupBaseUrl keeps group override and empty fallbacks", () => {
  const group: any = { id: "default", baseUrl: "http://127.0.0.1:4096" };
  expect(withEffectiveGroupBaseUrl(group, "https://opencode.ai/zen/go/v1")).toBe(group);
  const bare: any = { id: "x" };
  expect(withEffectiveGroupBaseUrl(bare, null)).toBe(bare);
  expect(withEffectiveGroupBaseUrl(bare, "  ")).toBe(bare);
});

test("resolveThreadStableSessionId prefers session-id, then thread-id", () => {
  expect(resolveThreadStableSessionId(null)).toBeNull();
  expect(resolveThreadStableSessionId(new Headers())).toBeNull();
  expect(resolveThreadStableSessionId(new Headers({ "thread-id": "t-1" }))).toBe("t-1");
  expect(
    resolveThreadStableSessionId(new Headers({ "session-id": "s-9", "thread-id": "t-1" }))
  ).toBe("s-9");
});

test("resolveOpenCodeBackendUserAgent maps the bridge hint to a dedicated UA", () => {
  expect(resolveOpenCodeBackendUserAgent(null)).toBeNull();
  expect(resolveOpenCodeBackendUserAgent(new Headers())).toBeNull();
  expect(resolveOpenCodeBackendUserAgent(new Headers({ "x-codex-cli-backend": "codex" }))).toBeNull();
  expect(resolveOpenCodeBackendUserAgent(new Headers({ "x-codex-cli-backend": "claude" })))
    .toBe(OPENCODE_BACKEND_USER_AGENTS.claude);
  expect(resolveOpenCodeBackendUserAgent(new Headers({ "x-codex-cli-backend": "OpenClaude" })))
    .toBe(OPENCODE_BACKEND_USER_AGENTS.openclaude);
});
