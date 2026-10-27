import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ThreadAgentRosterStore } from "../../apps/server/src/threadAgentRosterStore";

const role = (overrides: Record<string, unknown> = {}) => ({
  id: "builder", name: "Builder", responsibility: "Implement the task", model: "primary-model", reasoningEffort: "high", enabled: true,
  fallbacks: [{ id: "backup", label: "Backup", model: "backup-model", providerId: "relay-b" }], ...overrides
});

test("creates dynamic members, preserves exited history, and replaces members", () => {
  const database = new Database(":memory:");
  const store = new ThreadAgentRosterStore({ connection: database });
  const created = store.putRoles("owner", "parent", [role({ instanceCount: 2 })]);
  expect(created.members).toHaveLength(2);
  const first = created.members[0];
  store.patchMember("owner", "parent", first.id, { threadId: "child-1", status: "active" });
  store.putRoles("owner", "parent", [role({ instanceCount: 1 })]);
  const reduced = store.get("owner", "parent")!;
  expect(reduced.members.filter((member) => member.status !== "exited")).toHaveLength(1);
  expect(reduced.members.some((member) => member.id === created.members[1].id && member.status === "exited")).toBe(true);
  const replacement = store.replaceMember("owner", "parent", first.id);
  expect(replacement.id).not.toBe(first.id);
  expect(store.get("owner", "parent")!.members.filter((member) => member.roleId === "builder")).toHaveLength(3);
  database.close();
});

test("records failure by child thread and restores health after recovery", () => {
  const database = new Database(":memory:");
  const store = new ThreadAgentRosterStore({ connection: database });
  const member = store.putRoles("owner", "parent", [role()]).members[0];
  store.patchMember("owner", "parent", member.id, { threadId: "child-1", status: "active" });
  const failed = store.recordFailureByThread("child-1", { status: 429, message: "rate limit" })!;
  expect(failed.status).toBe("failed");
  expect(failed.health?.kind).toBe("rateLimit");
  expect(store.markHealthyByThread("child-1")?.health?.availability).toBe("online");
  database.close();
});

test("keeps fallback configuration ordered in roster", () => {
  const database = new Database(":memory:");
  const store = new ThreadAgentRosterStore({ connection: database });
  const roster = store.putRoles("owner", "parent", [role({ fallbacks: [{ id: "first", label: "First", model: "m1" }, { id: "second", label: "Second", model: "m2" }] })]);
  expect(roster.roles[0].fallbacks?.map((entry) => entry.id)).toEqual(["first", "second"]);
  database.close();
});
