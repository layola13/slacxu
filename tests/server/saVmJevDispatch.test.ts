import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setSharedJevConfig } from "../../backends/jev/src/jev/saVmJev.ts";
import { runSaVmTool } from "../../apps/server/src/saVmTool.ts";

/**
 * 治本回归：JEV canonical 参数必须直达 handler，显式 action 永不被字段嗅探劫持。
 *
 * 背景：线上曾出现 jev_thinking/jev_scope/jev_consistency/jev_diagnose/
 * jev_edge_cases/jev_done 报 `requires non-empty '<field>'`（即使已传
 * goal/task/plan/error_summary/code/user_request），jev_rank 报 items 不足，
 * jev_blast_radius 被误路由到 apply_patch（`invalid patch boundaries`）。
 * 本文件在 dispatch 层（runSaVmTool，直调、无网络）锁定三条不变式：
 *  1. canonical 参数直传可达（validation 通过，进入无凭证 capability_denied）。
 *  2. 缺参仍严格报错（validation 未被绕过）。
 *  3. 显式 action 精确路由（patch/diff/content 字段永不劫持）。
 *
 * 全部用例离线：清空 JEV 凭证后 handler 在 validation 之后返回 401
 * `JEV is not configured`，不发起任何网络请求。
 */

const JEV_NOT_CONFIGURED = "JEV is not configured";

function clearJevCreds() {
  delete process.env.JEV_API_KEY;
  delete process.env.JEV_BASE_URL;
  delete process.env.JEV_MODEL;
  delete process.env.JEV_PROVIDER_ID;
  delete process.env.JEV_GROUP_ID;
  delete process.env.JEV_BRIDGE_PROTOCOL;
  setSharedJevConfig(null);
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    JEV_API_KEY: process.env.JEV_API_KEY,
    JEV_BASE_URL: process.env.JEV_BASE_URL,
    JEV_MODEL: process.env.JEV_MODEL,
    JEV_PROVIDER_ID: process.env.JEV_PROVIDER_ID,
    JEV_GROUP_ID: process.env.JEV_GROUP_ID,
    JEV_BRIDGE_PROTOCOL: process.env.JEV_BRIDGE_PROTOCOL,
  };
  clearJevCreds();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setSharedJevConfig(null);
});

describe("jev canonical params reach handlers through runSaVmTool dispatch", () => {
  test("jev_thinking accepts goal+thoughts (canonical, no aliases)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_thinking",
        goal: "Evaluate duck2api integration and TS rewrite strategy",
        thoughts: { t1: "Keep Go sidecar", t2: "Full TS rewrite", t3: "TS relay provider" },
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_rank accepts items+criterion (canonical, no aliases)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_rank",
        items: { chat: "chat completions SSE", image: "image gen/edit", audio: "audio trans/speech" },
        criterion: "ROI",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_scope accepts task+phases (canonical, no aliases)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_scope",
        task: "assess duck2api TS rewrite",
        phases: { p1: "assess parity", p2: "port audio routes" },
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_dispatch accepts question+options bridge-safe (subagent gate)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_dispatch",
        question: "assess duck2api TS rewrite",
        options: { a: "assess parity", b: "port audio routes" },
        context: "max_parallel=2",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_dispatch accepts question without options (single-vs-split verdict)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_dispatch",
        question: "fix login 500",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_allocate alias reaches dispatch handler", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_allocate",
        question: "assess duck2api TS rewrite",
        options: { a: "assess parity", b: "port audio routes" },
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_consistency accepts plan+constraints (canonical, no aliases)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_consistency",
        plan: "Rewrite duck2api as TS relay provider",
        constraints: { c1: "Must be TypeScript, no Go binary", c2: "Must reuse relay auth" },
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_done accepts user_request+actual_work+evidence (canonical)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_done",
        user_request: "Evaluate duck2api TS rewrite",
        actual_work: "Mapped routes and risks",
        evidence: "router.go 9 groups, duckgo.ts 553 lines",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_diagnose accepts error_summary+hypotheses+proposed_fix (canonical)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_diagnose",
        error_summary: "Duck.ai returns 418 repeatedly",
        hypotheses: { h1: "VQD hash stale", h2: "FE version expired" },
        proposed_fix: "Reset VQD token and refetch FE version on 418",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_edge_cases accepts code (canonical, no aliases)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_edge_cases",
        code: "async function streamChat(res, model, body) { const u = await postConversation(toDuckRequest(body)); }",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_blast_radius accepts diff+target_component (canonical, never apply_patch)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_blast_radius",
        diff: "Add duck.ai relay provider + remove Go sidecar",
        target_component: "relay registry",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
    expect(res.stderr).not.toContain("invalid patch boundaries");
  });
});

describe("jev validation stays strict (missing canonical params still rejected)", () => {
  test("jev_thinking without goal is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_thinking", thoughts: { t1: "x" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'goal'");
  });

  test("jev_rank with fewer than 2 items is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_rank", items: { only: "one" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires at least 2 items");
  });

  test("jev_scope without task is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_scope", phases: { p1: "x" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'task'");
  });

  test("jev_dispatch without task is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_dispatch", options: { a: "x", b: "y" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'task'");
  });

  test("jev_dispatch with a single subtask is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_dispatch", question: "t", options: { only: "one" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires at least 2 subtasks");
  });

  test("jev_consistency without plan is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_consistency", constraints: { c1: "x" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'plan'");
  });

  test("jev_done without user_request is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_done", actual_work: "x" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'user_request'");
  });

  test("jev_diagnose without error_summary is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_diagnose", hypotheses: { h1: "x" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'error_summary'");
  });

  test("jev_edge_cases without code is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_edge_cases", context: "x" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'code'");
  });

  test("jev_blast_radius without diff is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_blast_radius", target_component: "x" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("sa_error");
    expect(res.stderr).toContain("requires a non-empty 'diff'");
  });
});

describe("explicit action always wins over field-sniffing (no misroute)", () => {
  test("jev_blast_radius carrying a patch field still reaches blast handler", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_blast_radius",
        patch: "*** Begin Patch\n*** End Patch",
        target_component: "relay registry",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    // `patch` is a valid diff alias for blast_radius; must NOT hit apply_patch.
    expect(res.stderr).not.toContain("invalid patch boundaries");
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("explicit apply_patch with garbage still hits apply_patch validation", async () => {
    const res = await runSaVmTool({ action: "apply_patch", patch: "not a patch" } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("invalid patch boundaries");
  });

  test("patch without action still infers apply_patch (back-compat)", async () => {
    const res = await runSaVmTool({ patch: "not a patch" } as any, { cwd: process.cwd() } as any);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("invalid patch boundaries");
  });

  test("jev_thinking carrying patch/content fields is not hijacked", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_thinking",
        goal: "Evaluate duck2api integration",
        thoughts: { t1: "keep Go", t2: "rewrite in TS" },
        patch: "unrelated text",
        content: "unrelated text",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
    expect(res.stderr).not.toContain("invalid patch boundaries");
  });
});

describe("jev_intent / jev_next dispatch", () => {
  test("jev_intent accepts question with candidate options", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_intent",
        question: "把登录接口的 500 修一下",
        options: { a: "修 Bug：定位 500 根因并修复", b: "重构登录接口" },
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_intent accepts question without options (taxonomy mode)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_intent",
        question: "解释一下这个函数的逻辑",
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_intent without question is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_intent", options: { a: "x", b: "y" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("requires a non-empty 'question'");
  });

  test("jev_intent with a single option is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_intent", question: "hi", options: { only: "one" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("requires at least 2 candidate interpretations");
  });

  test("jev_next accepts completed work with candidate next tasks", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_next",
        question: "登录 500 已修复，回归测试通过",
        options: { a: "补全接口文档", b: "继续修支付回调 502" },
        context: "dispatch regression",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_next accepts completed work without options (momentum mode)", async () => {
    const res = await runSaVmTool(
      {
        action: "jev_next",
        question: "登录 500 已修复，回归测试通过",
        context: "remaining: 支付回调 502 待修",
      } as any,
      { cwd: process.cwd() } as any,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.stderr).toContain(JEV_NOT_CONFIGURED);
  });

  test("jev_next without question is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_next", options: { a: "x", b: "y" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("requires a non-empty 'question'");
  });

  test("jev_next with a single option is rejected", async () => {
    const res = await runSaVmTool({ action: "jev_next", question: "done", options: { only: "one" } } as any, {
      cwd: process.cwd(),
    } as any);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("requires at least 2 candidate next tasks");
  });
});
