import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENHANCE_TOOLS_KEYS,
  countActiveEnhanceTools,
  hasEnhanceToolsEnabled,
  createDefaultSaVmPolicyConfig,
  type SaVmPolicyConfig,
  type SaVmToolsConfig
} from "@codex-ui/shared";
import {
  enhanceDeveloperInstructions,
  enhanceDynamicToolSpec,
  saVmDeveloperInstructions
} from "../../apps/server/src/workbenchControlApi";
import { ThreadRuntimeMetadataStore } from "../../apps/server/src/threadRuntimeMetadataStore";
import {
  buildSaVmWorkspaceSkillMarkdown,
  syncSaVmWorkspaceSkillDirectory
} from "../../apps/server/src/saVmWorkspaceSkill";

describe("Enhance Tools Decoupling", () => {
  it("correctly identifies active enhance tools and counts them", () => {
    expect(hasEnhanceToolsEnabled(null)).toBe(false);
    expect(hasEnhanceToolsEnabled(undefined)).toBe(false);
    expect(hasEnhanceToolsEnabled({})).toBe(false);
    expect(countActiveEnhanceTools(null)).toBe(0);
    expect(countActiveEnhanceTools({})).toBe(0);

    // Non-enhance tools alone should not trigger hasEnhanceToolsEnabled
    const vmOnlyTools: SaVmToolsConfig = {
      replaceRead: true,
      replaceWrite: true,
      replaceApplyPatch: true,
      replaceExec: true
    };
    expect(hasEnhanceToolsEnabled(vmOnlyTools)).toBe(false);
    expect(countActiveEnhanceTools(vmOnlyTools)).toBe(0);

    // Single enhance tool
    const single: SaVmToolsConfig = {
      fileOutline: true
    };
    expect(hasEnhanceToolsEnabled(single)).toBe(true);
    expect(countActiveEnhanceTools(single)).toBe(1);

    // Multiple enhance tools
    const multiple: SaVmToolsConfig = {
      fileOutline: true,
      findDefinition: true,
      getDiagnostics: true
    };
    expect(hasEnhanceToolsEnabled(multiple)).toBe(true);
    expect(countActiveEnhanceTools(multiple)).toBe(3);

    // All enhance tools (length follows ENHANCE_TOOLS_KEYS)
    const allTools: SaVmToolsConfig = {};
    for (const key of ENHANCE_TOOLS_KEYS) {
      allTools[key] = true;
    }
    expect(hasEnhanceToolsEnabled(allTools)).toBe(true);
    expect(countActiveEnhanceTools(allTools)).toBe(ENHANCE_TOOLS_KEYS.length);
    expect(ENHANCE_TOOLS_KEYS.length).toBeGreaterThanOrEqual(28);
  });

  it("builds enhance dynamic tool spec with active AST actions", () => {
    const policy: SaVmPolicyConfig = {
      ...createDefaultSaVmPolicyConfig(),
      tools: {
        fileOutline: true,
        getDiagnostics: true,
        extractToFile: true
      }
    };

    const spec = enhanceDynamicToolSpec(policy) as any;
    expect(spec.type).toBe("function");
    expect(spec.name).toBe("sa_vm_run");
    expect(spec.inputSchema.properties.action.enum).toEqual([
      "git_status",
      "git_diff",
      "git_log",
      "file_outline",
      "workspace_outline",
      "repo_map",
      "extract_to_file",
      "extract_component",
      "extract_hook",
      "atomic_refactor",
      "split_plan",
      "split_stage",
      "split_refine",
      "split_repair",
      "split_status",
      "get_diagnostics",
      "workspace_diagnostics",
      "verify_loop",
      "verify_changed",
      "replay_case",
      "record_case",
      "auto_fix_missing_imports",
      "code_graph",
      "relation_graph",
      "symbol_graph"
    ]);

    // Forbidden / VM-only actions must NOT be in the enum
    expect(spec.inputSchema.properties.action.enum).not.toContain("run_js");
    expect(spec.inputSchema.properties.action.enum).not.toContain("run_py");
    expect(spec.inputSchema.properties.action.enum).not.toContain("run_bun");
    expect(spec.inputSchema.properties.action.enum).not.toContain("write_file");
  });

  it("builds enhance dynamic tool spec with readFiles, fastSearch, editFiles, and applyPatch", () => {
    const policy: SaVmPolicyConfig = {
      ...createDefaultSaVmPolicyConfig(),
      tools: {
        readFiles: true,
        fastSearch: true,
        editFiles: true,
        applyPatch: true
      }
    };

    const spec = enhanceDynamicToolSpec(policy) as any;
    expect(spec.type).toBe("function");
    expect(spec.name).toBe("sa_vm_run");
    const actions = spec.inputSchema.properties.action.enum;
    expect(actions).toContain("read_file");
    expect(actions).toContain("read_lines");
    expect(actions).toContain("read_many");
    expect(actions).toContain("read_file_tail");
    expect(actions).toContain("grep_search");
    expect(actions).toContain("grep_search_async");
    expect(actions).toContain("find_files");
    expect(actions).toContain("list_dir");
    expect(actions).toContain("file_info");
    expect(actions).toContain("edit_file");
    expect(actions).toContain("write_file");
    expect(actions).toContain("apply_patch");

    // Spec schemas must have proper parameters
    expect(spec.inputSchema.properties.queries).toBeDefined();
    expect(spec.inputSchema.properties.query).toBeDefined();
    expect(spec.inputSchema.properties.old_text).toBeDefined();
    expect(spec.inputSchema.properties.new_text).toBeDefined();
    expect(spec.inputSchema.properties.patch).toBeDefined();
    expect(spec.inputSchema.properties.content).toBeDefined();

    const instructions = enhanceDeveloperInstructions(policy);
    expect(instructions).toContain("read_file");
    expect(instructions).toContain("grep_search_async");
    expect(instructions).toContain("edit_file");
    expect(instructions).toContain("apply_patch");
    expect(instructions).toContain("Host shell commands");
    expect(instructions).toContain("CRITICAL OVERRIDE FOR FILE READING, LINE COUNT & RANGE SLICING");
    expect(instructions).toContain("count_lines");
    expect(instructions).toContain("read_lines");
    expect(instructions).toContain("PowerShell Get-Content");
    expect(instructions).not.toContain("CRITICAL: Host shell, terminal");
  });

  it("generates enhance instructions without forbidding shell commands or hand-written script code", () => {
    const policy: SaVmPolicyConfig = {
      ...createDefaultSaVmPolicyConfig(),
      tools: {
        fileOutline: true,
        renameSymbol: true,
        getDiagnostics: true
      }
    };

    const enhanceInstructions = enhanceDeveloperInstructions(policy);

    // Must announce code enhancement tools and clarify standard tools remain available
    expect(enhanceInstructions).toContain("CODE ENHANCEMENT TOOLS");
    expect(enhanceInstructions).toContain("Host shell commands (PowerShell, bash, terminal, npm, git) remain fully available");
    expect(enhanceInstructions).toContain("file_outline");
    expect(enhanceInstructions).toContain("rename_symbol");
    expect(enhanceInstructions).toContain("get_diagnostics");

    // Must NOT contain intimidating VM sandbox or terminal restrictions
    expect(enhanceInstructions).not.toContain("CRITICAL: Host shell, terminal, Python, Node, and Bun command execution is disabled");
    expect(enhanceInstructions).not.toContain("PRIMARY INSTRUCTION: DO NOT WRITE RAW SLA CODE");
    expect(enhanceInstructions).not.toContain("All filesystem, network, environment, and process operations must stay within this thread's policy");

    // In contrast, full saVmDeveloperInstructions DOES contain VM restrictions
    const vmInstructions = saVmDeveloperInstructions(policy);
    expect(vmInstructions).toContain("CRITICAL: Host shell, terminal");
    expect(vmInstructions).toContain("PRIMARY INSTRUCTION: DO NOT WRITE RAW INLINE SCRIPT CODE");
  });

  it("persists and reads back enhanceEnabled in ThreadRuntimeMetadataStore while vmEnabled is false", () => {
    const database = new Database(":memory:");
    const store = new ThreadRuntimeMetadataStore({ connection: database });

    const threadId = "thread-enhance-test-01";
    store.put("local", {
      threadId,
      permission: "dangerBypass",
      model: "gpt-5.6",
      reasoningEffort: "medium",
      vmEnabled: false,
      vmPolicy: {
        ...createDefaultSaVmPolicyConfig(),
        tools: {
          fileOutline: true,
          findDefinition: true,
          getDiagnostics: true
        }
      }
    });

    const runtime = store.get("local", threadId);
    expect(runtime).toBeDefined();
    expect(runtime?.vmEnabled).toBe(false);
    expect(runtime?.enhanceEnabled).toBe(true);
    expect(runtime?.vmPolicy?.tools?.fileOutline).toBe(true);
    expect(runtime?.vmPolicy?.tools?.findDefinition).toBe(true);
    expect(runtime?.vmPolicy?.tools?.getDiagnostics).toBe(true);
  });

  it("builds skill markdown for enhance-only mode with active status and priority instruction", () => {
    const policy: SaVmPolicyConfig = {
      ...createDefaultSaVmPolicyConfig(),
      tools: {
        readFiles: true,
        fastSearch: true,
        editFiles: true,
        applyPatch: true,
        fileOutline: true,
        getDiagnostics: true
      }
    };

    const markdown = buildSaVmWorkspaceSkillMarkdown({
      enabled: false,
      policy
    });

    // Header must indicate code enhancement tools are active
    expect(markdown).toContain("【代码增强工具状态：已开启】");
    expect(markdown).toContain("本工作区已激活高性能代码增强工具");
    expect(markdown).toContain("读行、行数统计与查代码强力覆盖 (CRITICAL OVERRIDE)");
    expect(markdown).toContain("必须优先使用封装工具");
    expect(markdown).toContain("避免使用低效终端命令");
    expect(markdown).toContain("终端完全自由");

    // Must include enabled tools
    expect(markdown).toContain("read_file");
    expect(markdown).toContain("read_lines");
    expect(markdown).toContain("edit_file");
    expect(markdown).toContain("write_file");
    expect(markdown).toContain("apply_patch");
    expect(markdown).toContain("grep_search");
    expect(markdown).toContain("grep_search_async");
    expect(markdown).toContain("file_outline");
    expect(markdown).toContain("get_diagnostics");

    // Must NOT include the bun+TS track or sandbox restrictions
    expect(markdown).not.toContain("双轨执行路由与 SLA 编程规范");
    expect(markdown).not.toContain("严禁直接调用宿主系统 Shell");
    expect(markdown).not.toContain("【安全守护状态：已开启】");
  });

  it("syncSaVmWorkspaceSkillDirectory keeps and updates skills when enhance tools are active even if enabled is false", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-enhance-skill-sync-"));
    try {
      const enhancePolicy: SaVmPolicyConfig = {
        ...createDefaultSaVmPolicyConfig(),
        tools: {
          readFiles: true,
          fastSearch: true,
          editFiles: true,
          applyPatch: true,
          fileOutline: true
        }
      };

      // 1. Sync with enabled: false BUT enhance tools active -> must create skills!
      const result = await syncSaVmWorkspaceSkillDirectory({
        cwd: root,
        threadId: "thread-enhance-sync",
        enabled: false,
        policy: enhancePolicy
      });

      expect(result.enabled).toBe(true);
      expect(result.path).toBeTruthy();

      const codexSkill = join(root, ".codex", "skills", "sa-vm", "SKILL.md");
      const agentsSkill = join(root, ".agents", "skills", "sa-vm", "SKILL.md");
      expect(existsSync(codexSkill)).toBe(true);
      expect(existsSync(agentsSkill)).toBe(true);

      const content = await readFile(codexSkill, "utf8");
      expect(content).toContain("【代码增强工具状态：已开启】");
      expect(content).toContain("read_file");
      expect(content).toContain("edit_file");
      expect(content).toContain("file_outline");

      // 2. Sync with enabled: false AND no enhance tools -> must delete skills!
      const cleanResult = await syncSaVmWorkspaceSkillDirectory({
        cwd: root,
        threadId: "thread-enhance-sync",
        enabled: false,
        policy: {
          ...createDefaultSaVmPolicyConfig(),
          tools: {}
        }
      });

      expect(cleanResult.enabled).toBe(false);
      expect(cleanResult.path).toBeNull();
      expect(existsSync(codexSkill)).toBe(false);
      expect(existsSync(agentsSkill)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes jev actions and params in enhance spec only when flags are on", () => {
    const propsOf = (policy?: SaVmPolicyConfig) => {
      const spec = enhanceDynamicToolSpec(policy) as any;
      return {
        actions: spec.inputSchema.properties.action.enum as string[],
        props: spec.inputSchema.properties as Record<string, unknown>
      };
    };

    // No flags -> jev actions absent
    const off = propsOf({ ...createDefaultSaVmPolicyConfig(), tools: { readFiles: true } });
    expect(off.actions).not.toContain("jev_choose");
    expect(off.actions).not.toContain("jev_checklist");
    expect(off.actions).not.toContain("jev_evaluate");
    expect(off.actions).not.toContain("jev_thinking");
    expect(off.actions).not.toContain("jev_redteam");
    expect(off.actions).not.toContain("jev_done");
    expect(off.actions).not.toContain("jev_diagnose");
    expect(off.actions).not.toContain("jev_edge_cases");
    expect(off.actions).not.toContain("jev_blast_radius");
    expect(off.actions).not.toContain("jev_done");
    expect(off.actions).not.toContain("jev_diagnose");
    expect(off.actions).not.toContain("jev_edge_cases");
    expect(off.actions).not.toContain("jev_blast_radius");

    // Flags on -> actions present with matching params
    const on = propsOf({
      ...createDefaultSaVmPolicyConfig(),
      tools: {
        jevChoose: true, jevChecklist: true, jevEvaluate: true, jevThinking: true,
        jevRedteam: true, jevRank: true, jevScope: true, jevDispatch: true, jevConsistency: true,
        jevDone: true, jevDiagnose: true, jevEdgeCases: true, jevBlastRadius: true,
      }
    });
    expect(on.actions).toContain("jev_choose");
    expect(on.actions).toContain("jev_checklist");
    expect(on.actions).toContain("jev_evaluate");
    expect(on.actions).toContain("jev_thinking");
    expect(on.actions).toContain("jev_redteam");
    expect(on.actions).toContain("jev_rank");
    expect(on.actions).toContain("jev_scope");
    expect(on.actions).toContain("jev_dispatch");
    expect(on.actions).toContain("jev_consistency");
    expect(on.actions).toContain("jev_done");
    expect(on.actions).toContain("jev_diagnose");
    expect(on.actions).toContain("jev_edge_cases");
    expect(on.actions).toContain("jev_blast_radius");
    for (const key of ["question", "options", "checks", "questions", "goal", "thoughts", "target", "context", "items", "criterion", "task", "phases", "plan", "constraints", "user_request", "actual_work", "evidence", "error_summary", "hypotheses", "proposed_fix", "code", "diff", "target_component"]) {
      expect(on.props[key]).toBeDefined();
    }

    // Instructions advertise only enabled jev methods
    const instructions = enhanceDeveloperInstructions({
      ...createDefaultSaVmPolicyConfig(),
      tools: { jevChoose: true, jevThinking: true }
    });
    expect(instructions).toContain("jev_choose");
    expect(instructions).toContain("jev_thinking");
    expect(instructions).not.toContain("jev_checklist");
    expect(instructions).not.toContain("jev_evaluate");
    expect(instructions).not.toContain("jev_redteam");

    const redInstructions = enhanceDeveloperInstructions({
      ...createDefaultSaVmPolicyConfig(),
      tools: { jevRedteam: true }
    });
    expect(redInstructions).toContain("jev_redteam");

    const rankInstructions = enhanceDeveloperInstructions({
      ...createDefaultSaVmPolicyConfig(),
      tools: { jevRank: true, jevScope: true, jevConsistency: true }
    });
    expect(rankInstructions).toContain("jev_rank");
    expect(rankInstructions).toContain("jev_scope");
    expect(rankInstructions).toContain("jev_consistency");
    expect(rankInstructions).not.toContain("jev_choose");

    const doneInstructions = enhanceDeveloperInstructions({
      ...createDefaultSaVmPolicyConfig(),
      tools: { jevDone: true, jevDiagnose: true, jevEdgeCases: true, jevBlastRadius: true }
    });
    expect(doneInstructions).toContain("jev_done");
    expect(doneInstructions).toContain("jev_diagnose");
    expect(doneInstructions).toContain("jev_edge_cases");
    expect(doneInstructions).toContain("jev_blast_radius");
    expect(doneInstructions).not.toContain("jev_rank");
  });
});
