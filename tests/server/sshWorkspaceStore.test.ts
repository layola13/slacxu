import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SshWorkspaceStore } from "../../apps/server/src/sshWorkspaceStore.ts";

test("persists SSH thread routing without storing credentials", () => {
  const database = new Database(":memory:");
  const store = new SshWorkspaceStore({ connection: database });
  store.put("thread-ssh", {
    command: "ssh vscode@example.test",
    cwd: "/home/vscode/project",
    providerId: "deepkey",
    groupId: "codex-team"
  });
  expect(store.get("thread-ssh")).toEqual({
    command: "ssh vscode@example.test",
    cwd: "/home/vscode/project",
    providerId: "deepkey",
    groupId: "codex-team"
  });
  expect(store.get("missing")).toBeNull();
  expect(store.list()).toHaveLength(1);
  database.close();
});

test("retains parent routing while keeping roots distinguishable for history", () => {
  const database = new Database(":memory:");
  const store = new SshWorkspaceStore({ connection: database });
  const profile = { command: "ssh vscode@example.test", cwd: "/project", providerId: "deepkey", groupId: "codex-team" };
  store.put("root", profile);
  store.put("child", profile, "root");
  expect(store.list().find((entry) => entry.threadId === "root")?.parentThreadId).toBeNull();
  expect(store.list().find((entry) => entry.threadId === "child")?.parentThreadId).toBe("root");
  database.close();
});

test("updates an SSH thread workspace after an explicit migration", () => {
  const database = new Database(":memory:");
  const store = new SshWorkspaceStore({ connection: database });
  store.put("thread-ssh", { command: "ssh old@example.test", cwd: "/old" });
  store.put("thread-ssh", { command: "ssh new@example.test", cwd: "/new", providerId: "jiji", groupId: "default" });
  expect(store.get("thread-ssh")).toMatchObject({ command: "ssh new@example.test", cwd: "/new", providerId: "jiji", groupId: "default" });
  database.close();
});
