import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { nativeFindImplementations, runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

describe("find_implementations tool", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-test-find-impl-"));

    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    // Fixture 1: TypeScript implementations
    const tsContent = `import { UserStore } from './types';

// Implementation 1: Class implements interface
export class SqlUserStore implements UserStore {
  getUser(id: string) { return null; }
}

// Implementation 2: Class extends base and implements interface
export class MemoryUserStore extends BaseStore implements UserStore, Serializable {
  private cache = new Map();
}

// Implementation 3: Sub-interface extends interface
export interface CachedUserStore extends UserStore {
  ttl: number;
}

// Implementation 4: Object literal satisfying interface
export const mockStore: UserStore = {
  getUser: () => null
};

// Implementation 5: Type assertion
export const inlineStore = { name: "test" } as UserStore;

// Implementation 6: Satisfies
export const satisfiesStore = { name: "test2" } satisfies UserStore;

// Implementation 7: Function returning interface
export function createUserStore(): UserStore {
  return new SqlUserStore();
}

// Implementation 8: Arrow function assigned to interface
export const makeStore: UserStore = () => {
  return new SqlUserStore();
};

// Non-implementations that must NOT match:
function processUser(store: UserStore) {
  console.log(UserStore.VERSION);
}
// class CommentedStore implements UserStore {}
/*
class MultiLineCommented implements UserStore {}
*/
`;
    await writeFile(join(srcDir, "stores.ts"), tsContent, "utf8");

    // Fixture 2: Python implementations
    const pyDir = join(tempDir, "py");
    await mkdir(pyDir, { recursive: true });
    const pyContent = `# Python implementation
class PyUserStore(UserStore):
    def get_user(self, uid):
        pass

# Non-implementation
def helper(store: UserStore):
    pass
`;
    await writeFile(join(pyDir, "store.py"), pyContent, "utf8");

    // Fixture 3: Rust implementations
    const rsDir = join(tempDir, "rs");
    await mkdir(rsDir, { recursive: true });
    const rsContent = `// Rust implementation
impl UserStore for LocalStore {
    fn get_user(&self) {}
}
`;
    await writeFile(join(rsDir, "store.rs"), rsContent, "utf8");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("rejects when symbol parameter is missing", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const res = await nativeFindImplementations("", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("symbol parameter is required");
  });

  test("returns capability_denied when findReferences is disabled in policy", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: false };

    const res = await nativeFindImplementations("UserStore", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("findReferences");
  });

  test("returns empty array with exitCode: 0 when no implementations are found", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const res = await nativeFindImplementations("NonExistentInterface", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.symbol).toBe("NonExistentInterface");
    expect(parsed.total).toBe(0);
    expect(parsed.returned).toBe(0);
    expect(parsed.implementations).toEqual([]);
  });

  test("finds multiple implementations across files and languages (TS, Python, Rust)", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const res = await nativeFindImplementations("UserStore", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.symbol).toBe("UserStore");
    // 8 in TS + 1 in Python + 1 in Rust = 10 total
    expect(parsed.total).toBe(10);
    expect(parsed.returned).toBe(10);
    expect(Array.isArray(parsed.implementations)).toBe(true);

    // Compact format check: path:Lx:e3
    for (const item of parsed.implementations) {
      expect(item).toMatch(/^(?:src|py|rs)[/\\][^:]+:L\d+:e3$/);
    }

    // Verify non-implementations were excluded
    const matchedLines = parsed.implementations.map((i: string) => i.split(":")[1]);
    expect(parsed.implementations.some((i: string) => i.includes("stores.ts"))).toBe(true);
    expect(parsed.implementations.some((i: string) => i.includes("store.py"))).toBe(true);
    expect(parsed.implementations.some((i: string) => i.includes("store.rs"))).toBe(true);
  });

  test("deduplicates single-line matches with single-path single-key", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const res = await nativeFindImplementations("UserStore", { dir: "src" }, policy, tempDir, Date.now());
    const parsed = JSON.parse(res.stdout);

    const lineKeys = new Set(parsed.implementations);
    expect(lineKeys.size).toBe(parsed.implementations.length);
  });

  test("compact detail:false output size is less than 20% of detail:true output size", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const compactRes = await nativeFindImplementations("UserStore", { detail: false }, policy, tempDir, Date.now());
    const detailedRes = await nativeFindImplementations("UserStore", { detail: true, include_body: true }, policy, tempDir, Date.now());

    const compactSize = compactRes.stdout.length;
    const detailedSize = detailedRes.stdout.length;

    expect(compactSize).toBeLessThan(detailedSize * 0.20);
  });

  test("candidate_files filter only scans specified candidate files", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const res = await nativeFindImplementations("UserStore", { candidate_files: ["py/store.py"] }, policy, tempDir, Date.now());
    const parsed = JSON.parse(res.stdout);

    expect(parsed.total).toBe(1);
    expect(parsed.implementations.length).toBe(1);
    expect(parsed.implementations[0]).toContain("store.py");
  });

  test("pattern filter restricts search to matching file extension", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    const res = await nativeFindImplementations("UserStore", { pattern: "*.rs" }, policy, tempDir, Date.now());
    const parsed = JSON.parse(res.stdout);

    expect(parsed.total).toBe(1);
    expect(parsed.implementations.length).toBe(1);
    expect(parsed.implementations[0]).toContain("store.rs");
  });

  test("timeout_ms triggers graceful truncation and marks timed_out", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    // Simulate timeout by passing a startedAt in the past
    const pastStartedAt = Date.now() - 500;
    const res = await nativeFindImplementations("UserStore", { timeout_ms: 100 }, policy, tempDir, pastStartedAt);

    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.timed_out).toBe(true);
    expect(parsed.truncated).toBe(true);
  });

  test("runSaVmTool routes find_implementations and aliases correctly", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, findReferences: true };

    // Standard action name
    const res1 = await runSaVmTool({
      action: "find_implementations",
      symbol: "UserStore",
      dir: "src",
      policy,
      cwd: tempDir
    });
    expect(res1.ok).toBe(true);
    expect(res1.exitCode).toBe(0);
    expect(JSON.parse(res1.stdout).total).toBe(8);

    // Alias: find_impl
    const res2 = await runSaVmTool({
      action: "find_impl",
      symbol: "UserStore",
      dir: "py",
      policy,
      cwd: tempDir
    });
    expect(res2.ok).toBe(true);
    expect(JSON.parse(res2.stdout).total).toBe(1);

    // Alias: implementations
    const res3 = await runSaVmTool({
      action: "implementations",
      symbol: "UserStore",
      dir: "rs",
      policy,
      cwd: tempDir
    });
    expect(res3.ok).toBe(true);
    expect(JSON.parse(res3.stdout).total).toBe(1);
  });
});
