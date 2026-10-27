import { describe, expect, test } from "bun:test";
import { parseAndCheckSaVmPatch } from "../../apps/server/src/saVmApplyPatch";

const policy = { fs: { read: ["E:/workspace/**"], write: ["E:/workspace/**"], transfer: ["E:/workspace/**"], delete: "move", backupDir: "E:/workspace/.backup" } } as any;

describe("SA-VM apply_patch", () => {
  test("parses add and routes it to a native write operation", () => {
    const result = parseAndCheckSaVmPatch("*** Begin Patch\n*** Add File: new.txt\n+hello\n*** End Patch", "E:/workspace", policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.operations[0]).toMatchObject({ kind: "write", path: "new.txt" });
  });
  test("keeps official patch paths relative to the thread workspace", () => {
    const result = parseAndCheckSaVmPatch("*** Begin Patch\n*** Add File: src/new.ts\n+export const enabled = true\n*** End Patch", "E:/workspace", policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations[0]).toMatchObject({ kind: "write", path: "src/new.ts" });
    }
  });
  test("accepts update hunks as VM edits", () => {
    const result = parseAndCheckSaVmPatch("*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch", "E:/workspace", policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.operations[0]).toMatchObject({ kind: "edit", path: "a.txt" });
  });
  test("rejects paths outside the thread policy", () => {
    const result = parseAndCheckSaVmPatch("*** Begin Patch\n*** Add File: ../outside.txt\n+x\n*** End Patch", "E:/workspace", policy);
    expect(result).toMatchObject({ ok: false });
  });
  test("checks both sides of moves", () => {
    const result = parseAndCheckSaVmPatch("*** Begin Patch\n*** Update File: a.txt\n*** Move to: ../outside.txt\n*** End Patch", "E:/workspace", policy);
    expect(result).toMatchObject({ ok: false });
  });
  test("parses CRLF multi-file combinations", () => {
    const patch = ["*** Begin Patch", "*** Add File: nested/new.txt", "+one", "+two", "*** Update File: existing.txt", "@@ heading", " old line", "-removed", "+added", "*** End of File", "*** Update File: old-name.txt", "*** Move to: renamed.txt", "*** Delete File: doomed.txt", "*** End Patch"].join("\r\n");
    const result = parseAndCheckSaVmPatch(patch, "E:/workspace", policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations.map((operation) => operation.kind)).toEqual(["write", "edit", "rename", "delete"]);
      expect(result.operations[3]).toMatchObject({ kind: "delete" });
    }
  });

  test("uses backup rename for move delete policy", () => {
    const result = parseAndCheckSaVmPatch("*** Begin Patch\n*** Delete File: doomed.txt\n*** End Patch", "E:/workspace", policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations[0]).toMatchObject({ kind: "delete", backupPath: "e:/workspace/.backup/doomed.txt" });
    }
  });

  test("rejects malformed, empty, and oversized patches", () => {
    expect(parseAndCheckSaVmPatch("", "E:/workspace", policy)).toMatchObject({ ok: false });
    expect(parseAndCheckSaVmPatch("*** Begin Patch\n*** Add File: empty.txt\n*** End Patch", "E:/workspace", policy)).toMatchObject({ ok: false });
    expect(parseAndCheckSaVmPatch("*** Begin Patch\n*** Update File: a.txt\n@@\n?bad\n*** End Patch", "E:/workspace", policy)).toMatchObject({ ok: false });
    expect(parseAndCheckSaVmPatch(`*** Begin Patch\n*** Add File: huge.txt\n+${"x".repeat(2 * 1024 * 1024)}\n*** End Patch`, "E:/workspace", policy)).toMatchObject({ ok: false });
  });

  test("requires read and write access for updates", () => {
    const patch = "*** Begin Patch\n*** Update File: a.txt\n-old\n+new\n*** End Patch";
    expect(parseAndCheckSaVmPatch(patch, "E:/workspace", { fs: { write: ["E:/workspace/**"] } } as any)).toMatchObject({ ok: true });
    expect(parseAndCheckSaVmPatch(patch, "E:/workspace", { fs: { entries: [{ path: "E:/workspace/**", access: "read" }] } } as any)).toMatchObject({ ok: false });
  });

  test("checks backup directory and additional roots", () => {
    const badBackup = { fs: { read: ["E:/workspace/**"], write: ["E:/workspace/**"], transfer: ["E:/workspace/**"], delete: "move", backupDir: "E:/outside-backup" } } as any;
    expect(parseAndCheckSaVmPatch("*** Begin Patch\n*** Delete File: a.txt\n*** End Patch", "E:/workspace", badBackup)).toMatchObject({ ok: false });
    const extra = parseAndCheckSaVmPatch("*** Begin Patch\n*** Add File: E:/allowed/new.txt\n+x\n*** End Patch", "E:/workspace", policy, ["E:/allowed"]);
    expect(extra.ok).toBe(false);
  });

  test("exposes one native operation per patch hunk", () => {
    const patch = "*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch";
    const result = parseAndCheckSaVmPatch(patch, "E:/workspace", policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({ kind: "edit", path: "a.txt" });
    }
  });
});
