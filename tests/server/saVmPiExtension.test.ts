import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXTENSION_SOURCE = resolve(import.meta.dir, "../../scripts/sa-vm-pi-extension.ts");

// pi 运行时自带 typebox；测试里用最小桩替代，只为让扩展模块能被加载。
const TYPEBOX_STUB = `
export const Type = {
  Object: (properties) => ({ type: "object", properties }),
  String: () => ({ type: "string" }),
  Integer: () => ({ type: "integer" }),
  Optional: (schema) => schema,
};
`;

async function withExtensionTool(run: (tool: any) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "codex-test-pi-ext-"));
  try {
    await mkdir(join(dir, "node_modules", "typebox"), { recursive: true });
    await writeFile(join(dir, "node_modules", "typebox", "index.js"), TYPEBOX_STUB, "utf8");
    await copyFile(EXTENSION_SOURCE, join(dir, "index.ts"));
    const mod = await import(join(dir, "index.ts"));
    let registered: any = null;
    mod.default({ registerTool: (def: any) => (registered = def) });
    expect(registered).not.toBeNull();
    await run(registered);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withFakeServer(
  respond: (body: any) => Response,
  run: (ctx: { seen: any[]; baseUrl: string }) => Promise<void>
): Promise<void> {
  const seen: any[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      seen.push({
        path: new URL(req.url).pathname,
        auth: req.headers.get("authorization"),
        body: await req.json(),
      });
      return respond(seen[seen.length - 1].body);
    },
  });
  const prevUrl = process.env.CODEX_UI_API_URL;
  const prevToken = process.env.CODEX_UI_TOKEN;
  process.env.CODEX_UI_API_URL = `http://127.0.0.1:${server.port}`;
  process.env.CODEX_UI_TOKEN = "test-token";
  try {
    await run({ seen, baseUrl: process.env.CODEX_UI_API_URL });
  } finally {
    server.stop(true);
    if (prevUrl === undefined) delete process.env.CODEX_UI_API_URL;
    else process.env.CODEX_UI_API_URL = prevUrl;
    if (prevToken === undefined) delete process.env.CODEX_UI_TOKEN;
    else process.env.CODEX_UI_TOKEN = prevToken;
  }
}

test("pi extension registers sa_vm_run and forwards action, cwd, and auth to the server", async () => {
  await withFakeServer(
    () => Response.json({ ok: true, data: { stdout: "line 1\n" } }),
    ({ seen }) =>
      withExtensionTool(async (tool) => {
        expect(tool.name).toBe("sa_vm_run");
        const result = await tool.execute(
          "call-1",
          { action: "read_file", path: "a.ts" },
          undefined,
          undefined,
          { cwd: "D:\\workspace" }
        );
        expect(seen).toHaveLength(1);
        expect(seen[0].path).toBe("/api/tools/sa_vm_run");
        expect(seen[0].auth).toBe("Bearer test-token");
        expect(seen[0].body).toEqual({ action: "read_file", path: "a.ts", cwd: "D:\\workspace" });
        expect(result.content[0].text).toBe("line 1\n");
      })
  );
});

test("pi extension throws on sa_error results so pi marks the tool call as failed", async () => {
  await withFakeServer(
    () => Response.json({ ok: false, kind: "sa_error", data: { ok: false, kind: "sa_error", output: "path escapes workspace" } }),
    () =>
      withExtensionTool(async (tool) => {
        await expect(
          tool.execute("call-2", { action: "read_file", path: "../x" }, undefined, undefined, { cwd: "D:\\workspace" })
        ).rejects.toThrow("path escapes workspace");
      })
  );
});

test("pi extension throws when the server responds with a non-2xx status", async () => {
  await withFakeServer(
    () => Response.json({ error: "boom", code: "E_BOOM" }, { status: 500 }),
    () =>
      withExtensionTool(async (tool) => {
        await expect(
          tool.execute("call-3", { action: "run_bun" }, undefined, undefined, { cwd: "D:\\workspace" })
        ).rejects.toThrow("boom");
      })
  );
});
