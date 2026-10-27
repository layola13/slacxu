import { expect, test } from "bun:test";
import { classifyAgentFailure, healthyAgentMember, normalizeAgentRoleFallbacks, normalizeAgentRoleWorkspace, parseAgentRuntimeOverride } from "../../packages/shared/src/index";

test("normalizes flexible roles and ordered fallback routes", () => {
  const parsed = parseAgentRuntimeOverride({ mode: "enabled", roles: [{ id: "builder", name: "Builder", responsibility: "Implement", instanceCount: 99, startPolicy: "immediate", runtime: "independent", workspace: { mode: "private", workspaceMode: "ssh", cwd: "/srv/app", sshCommand: "ssh host", additionalRoots: ["/srv/shared"] }, fallbacks: [{ id: "backup-a", label: "Backup A", providerId: "relay-a", groupId: "fast", model: "model-a", reasoningEffort: "high" }, { id: "backup-b", label: "Backup B", model: "model-b" }] }] });
  expect(parsed.roles).toHaveLength(1);
  expect(parsed.roles[0]).toMatchObject({ instanceCount: 12, startPolicy: "immediate", runtime: "independent" });
  expect(parsed.roles[0].workspace).toMatchObject({ mode: "private", workspaceMode: "ssh", cwd: "/srv/app", sshCommand: "ssh host" });
  expect(parsed.roles[0].fallbacks?.map((entry) => entry.id)).toEqual(["backup-a", "backup-b"]);
});

test("limits fallback routes and drops empty entries", () => {
  const routes = normalizeAgentRoleFallbacks([{}, ...Array.from({ length: 10 }, (_, index) => ({ id: `f-${index}`, model: `m-${index}` }))]);
  expect(routes).toHaveLength(8);
  expect(routes[0].id).toBe("f-0");
});

test("classifies quota, auth, rate-limit and upstream failures", () => {
  const now = 1_000_000;
  expect(classifyAgentFailure({ status: 429, message: "too many requests" }, null, now)).toMatchObject({ kind: "rateLimit", availability: "degraded", retryable: true, code: 429 });
  expect(classifyAgentFailure({ status: 503, message: "service unavailable" }, null, now)).toMatchObject({ kind: "providerUnavailable", availability: "degraded", retryable: true, code: 503 });
  expect(classifyAgentFailure({ status: 402, message: "quota exceeded" }, null, now)).toMatchObject({ kind: "quota", availability: "offline", retryable: false, code: 402 });
  expect(classifyAgentFailure({ status: 401, message: "invalid api key" }, null, now)).toMatchObject({ kind: "auth", availability: "offline", retryable: false, code: 401 });
});

test("marks repeated failures offline and resets health online", () => {
  const now = 2_000_000;
  let health = classifyAgentFailure("503 upstream unavailable", null, now);
  health = classifyAgentFailure("503 upstream unavailable", health, now + 1);
  health = classifyAgentFailure("503 upstream unavailable", health, now + 2);
  expect(health.availability).toBe("offline");
  expect(healthyAgentMember(now + 3)).toMatchObject({ availability: "online", consecutiveFailures: 0, retryAt: null });
});

test("normalizes local and ssh workspace fields", () => {
  expect(normalizeAgentRoleWorkspace({ mode: "private", workspaceMode: "ssh", cwd: "/work", additionalRoots: [" /shared ", 4] })).toEqual({ mode: "private", cwd: "/work", workspaceMode: "ssh", additionalRoots: ["/shared"] });
});
