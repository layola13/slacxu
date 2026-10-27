import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENHANCE_TOOLS_KEYS } from "../../packages/shared/src/index.ts";
import { ENHANCE_TOOLS_KEYS as CXU_ENHANCE_KEYS } from "../../packages/cxu/src/shared-types.ts";
import { runSaVmTool } from "../../apps/server/src/saVmTool.ts";
import { resolveJevMethodFlags } from "../../apps/server/src/saVmWorkspaceSkill.ts";

/**
 * JEV harden_first 回归（jev_compress 能力层）：
 *  1. dispatch 门禁：jevCompress=false 拒；clearToolHistory=false 拒并指去 §6。
 *  2. 参数硬化：mode 白名单（非法回 auto）；keep 非法/过小回落 >=2。
 *  3. vendor 镜像同步：主副本与 packages/cxu 镜像的 jev_compress 块必须一致。
 *  4. flags-touched 语义锁定：只开 jevCompress 时其它 JEV 方法保持隐藏（既有模式）。
 *  5. ENHANCE_TOOLS_KEYS 下限：含 jevCompress 且总数 >= 30（防误删键）。
 */

describe("jev_compress dispatch gates", () => {
  test("default policy returns 4-step plan with keep>=2", async () => {
    const res = await runSaVmTool({ action: "jev_compress", mode: "subscription" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(true);
    const plan = JSON.parse(res.stdout) as any;
    expect(plan.action).toBe("jev_compress");
    expect(plan.mode).toBe("subscription");
    expect(plan.steps).toHaveLength(4);
    expect(plan.keep_last_n_turns).toBeGreaterThanOrEqual(2);
    expect(plan.filter_tools).toContain("read_file");
    expect(plan.threshold).toBe(85);
  });

  test("jevCompress=false is capability_denied", async () => {
    const res = await runSaVmTool({ action: "jev_compress" } as any, {
      cwd: process.cwd(),
      policy: { tools: { jevCompress: false } },
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain("jevCompress");
  });

  test("clearToolHistory=false is capability_denied with §6 pointer", async () => {
    const res = await runSaVmTool({ action: "jev_compress" } as any, {
      cwd: process.cwd(),
      policy: { tools: { jevCompress: true, clearToolHistory: false } },
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain("clearToolHistory");
  });

  test("mode whitelist falls back to auto", async () => {
    for (const mode of ["token", "subscription", "auto"]) {
      const res = await runSaVmTool({ action: "jev_compress", mode } as any, {
        cwd: process.cwd(),
      } as any);
      expect(JSON.parse(res.stdout).mode).toBe(mode);
    }
    const junk = await runSaVmTool({ action: "jev_compress", mode: "turbo!!" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(JSON.parse(junk.stdout).mode).toBe("auto");
  });

  test("keep_last_n_turns clamps illegal values to >=2", async () => {
    const bad = await runSaVmTool({ action: "jev_compress", keep_last_n_turns: "abc" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(JSON.parse(bad.stdout).keep_last_n_turns).toBe(2);
    const small = await runSaVmTool({ action: "jev_compress", keep_last_n_turns: 1 } as any, {
      cwd: process.cwd(),
    } as any);
    expect(JSON.parse(small.stdout).keep_last_n_turns).toBe(2);
    const five = await runSaVmTool({ action: "jev_compress", keep_last_n_turns: 5 } as any, {
      cwd: process.cwd(),
    } as any);
    expect(JSON.parse(five.stdout).keep_last_n_turns).toBe(5);
  });
});

describe("jev_compress vendor mirror sync", () => {
  test("server copy and cxu vendor copy carry identical dispatch block", () => {
    const server = readFileSync(join(import.meta.dir, "../../apps/server/src/saVmTool.ts"), "utf8");
    const vendor = readFileSync(join(import.meta.dir, "../../packages/cxu/src/vendor/saVmTool.ts"), "utf8");
    const slice = (src: string) => {
      const start = src.indexOf('if (effectiveAction === "jev_compress")');
      const end = src.indexOf('effectiveAction === "find_references"');
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end).trim();
    };
    expect(slice(vendor)).toBe(slice(server));
    expect(server).toContain('"jevChoose" | "jevChecklist"');
    expect(server).toContain('| "jevCompress"');
    expect(vendor).toContain('| "jevCompress"');
  });
});

describe("jev_compress flags semantics", () => {
  test("only jevCompress on keeps sibling JEV methods hidden (touched pattern)", () => {
    const flags = resolveJevMethodFlags({ jevCompress: true } as any, false);
    expect(flags.showJevCompress).toBe(true);
    expect(flags.showJevChoose).toBe(false);
    expect(flags.showJevChecklist).toBe(false);
  });

  test("ENHANCE_TOOLS_KEYS contains jevCompress with floor >= 30", () => {
    expect(ENHANCE_TOOLS_KEYS).toContain("jevCompress");
    expect(ENHANCE_TOOLS_KEYS.length).toBeGreaterThanOrEqual(30);
    expect(CXU_ENHANCE_KEYS).toContain("jevCompress");
    expect(CXU_ENHANCE_KEYS.length).toBeGreaterThanOrEqual(30);
  });
});
