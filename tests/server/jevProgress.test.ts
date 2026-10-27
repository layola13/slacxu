import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENHANCE_TOOLS_KEYS } from "../../packages/shared/src/index.ts";
import { ENHANCE_TOOLS_KEYS as CXU_ENHANCE_KEYS } from "../../packages/cxu/src/shared-types.ts";
import { runSaVmTool } from "../../apps/server/src/saVmTool.ts";
import {
  buildJevWorkspaceSkillMarkdown,
  listEnabledJevMethods,
  resolveJevMethodFlags,
} from "../../apps/server/src/saVmWorkspaceSkill.ts";

/**
 * jev_progress 回归（任务进度裁决）：
 *  1. dispatch 门禁：jevProgress=false 拒。
 *  2. 参数硬化：空任务直接 sa_error，不打 JEV 网络。
 *  3. 开关链路：KEYS/flags/skill/dialog 四处同生同灭。
 */

describe("jev_progress dispatch gates", () => {
  test("jevProgress=false is capability_denied", async () => {
    const res = await runSaVmTool({ action: "jev_progress", question: "做完重构" } as any, {
      cwd: process.cwd(),
      policy: { tools: { jevProgress: false } },
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain("jevProgress");
  });

  test("empty task is sa_error without network", async () => {
    const res = await runSaVmTool({ action: "jev_progress", question: "   " } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("jev_progress");
  });
});

describe("jev_progress switch wiring", () => {
  test("only jevProgress on keeps sibling JEV methods hidden (touched pattern)", () => {
    const flags = resolveJevMethodFlags({ jevProgress: true } as any, false);
    expect(flags.showJevProgress).toBe(true);
    expect(flags.showJevChoose).toBe(false);
    expect(flags.showJevNext).toBe(false);
    expect(flags.showJevCompress).toBe(false);
    expect(listEnabledJevMethods({ jevProgress: true } as any, false)).toEqual(["jev_progress"]);
  });

  test("ENHANCE_TOOLS_KEYS contains jevProgress in both copies", () => {
    expect(ENHANCE_TOOLS_KEYS).toContain("jevProgress");
    expect(CXU_ENHANCE_KEYS).toContain("jevProgress");
  });

  test("jev skill advertises bridge-safe jev_progress shape when enabled", () => {
    const md = buildJevWorkspaceSkillMarkdown({ policy: { tools: { jevProgress: true } } as any });
    expect(md).not.toBeNull();
    expect(md as string).toContain("jev_progress");
    expect(md as string).toContain('"action": "jev_progress"');
    expect(md as string).toContain("task -> question, phases -> options, completed -> content");
  });

  test("EnhanceToolsDialog carries the jev_progress toggle", () => {
    const dialog = readFileSync(
      join(import.meta.dir, "../../frontends/enhance/src/enhance/EnhanceToolsDialog.tsx"),
      "utf8"
    );
    expect(dialog).toContain("composer-enhance-toggle-jev-progress");
    expect(dialog).toContain("jevProgress");
  });
});
