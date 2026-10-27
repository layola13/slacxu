import { expect, test } from "bun:test";
import { localWorkspaceInfo } from "../../apps/server/src/workspaceRoots.ts";

test("exposes every available Windows drive to administrators", () => {
  const info = localWorkspaceInfo(null, {
    platform: "win32",
    home: "C:\\Users\\tester",
    cwd: "E:\\projects\\codex-react-ui",
    driveExists: (path) => ["A:\\", "C:\\", "D:\\", "E:\\", "F:\\"].includes(path)
  });
  expect(info.platform).toBe("win32");
  expect(info.home).toBe("C:\\Users\\tester");
  expect(info.roots.map((root) => root.path)).toEqual(["A:\\", "C:\\", "D:\\", "E:\\", "F:\\"]);
});

test("keeps Unix root behavior unchanged", () => {
  const info = localWorkspaceInfo(null, { platform: "linux", home: "/home/tester", cwd: "/srv/app" });
  expect(info).toMatchObject({
    platform: "linux",
    home: "/home/tester",
    cwd: "/srv/app",
    roots: [{ path: "/", label: "/" }]
  });
});

test("confines non-admin members to their assigned workspace root", () => {
  const info = localWorkspaceInfo({
    id: "member",
    email: "member@example.com",
    role: "user",
    status: "active",
    maxPermission: "workspaceAsk",
    allowWrite: true,
    allowNetwork: false,
    allowDangerBypass: false,
    concurrency: 1,
    balance: 0,
    allowedProviderIds: [],
    workspaceRoot: "D:\\members\\member"
  }, { platform: "win32", home: "C:\\Users\\tester", cwd: "E:\\projects" });
  expect(info.roots).toEqual([{ path: "D:\\members\\member", label: "D:\\members\\member" }]);
});
