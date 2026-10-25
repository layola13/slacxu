import { Box, Typography, Alert, Stack, Switch, FormControlLabel, Checkbox } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { SaVmPolicyConfig, SaVmBunProfile } from "@codex-ui/shared";
import { SA_VM_BUN_PROFILE_GROUPS, ALL_SA_VM_BUN_PROFILES } from "@codex-ui/shared";
import type { Dispatch, SetStateAction } from "react";
import { loadJevConfig } from "@cxu/sdk-frontend";

type Props = {
  vmDraft: SaVmPolicyConfig;
  setVmDraft: Dispatch<SetStateAction<SaVmPolicyConfig>>;
  onNavigateTab?: (tab: "filesystem" | "network" | "execution" | "preview") => void;
};

export function VmToolsSettingsTab({ vmDraft, setVmDraft }: Props) {
  const typecheckProfiles = SA_VM_BUN_PROFILE_GROUPS.typecheck;
  const buildProfiles = SA_VM_BUN_PROFILE_GROUPS.build;
  const testProfiles = SA_VM_BUN_PROFILE_GROUPS.test;
  const enabledBunProfiles = vmDraft.process?.bunProfiles ?? [];
  const setBunProfile = (profile: SaVmBunProfile, enabled: boolean) => {
    setVmDraft((current) => {
      const profiles = new Set(current.process?.bunProfiles ?? []);
      if (enabled) profiles.add(profile); else profiles.delete(profile);
      return { ...current, process: { ...current.process, bunProfiles: [...profiles] } };
    });
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
        命令拦截与执行沙箱 (Command Interception & Execution Sandbox)
      </Typography>
      <Alert severity="info" sx={{ mb: 0.5 }}>
        代码智能、防爆流读写检索与 AST 工具已独立至「代码增强」按钮，无需 VM 沙箱。此处专用于宿主沙箱安全隔离：开启策略后可一键拦截宿主命令行，或按需开放受控 Bun 与受限脚本沙箱。
      </Alert>
      <Stack spacing={1.25}>
        {/* VM 沙箱执行全选开关 */}
        {(() => {
          const replaceExec = vmDraft.tools?.replaceExec === true;
          const isBunEnabled = Boolean(
            vmDraft.process?.bun === true ||
            (typeof vmDraft.process?.bun === "object" && vmDraft.process.bun !== null && vmDraft.process.bun.enabled === true)
          );
          const isAllReplacementsChecked = Boolean(
            replaceExec &&
            isBunEnabled
          );
          return (
            <Box
              sx={{
                p: 1.5,
                border: "1.5px solid",
                borderColor: isAllReplacementsChecked ? "primary.main" : "divider",
                borderRadius: 2,
                bgcolor: isAllReplacementsChecked
                  ? (theme) => alpha(theme.palette.primary.main, 0.06)
                  : (theme) => alpha(theme.palette.action.hover, 0.03)
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box sx={{ pr: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 850 }}>
                    VM 沙箱执行全选 (Select All VM Execution Controls)
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    一键开启宿主命令行拦截与受控 Bun 执行沙箱；为确保宿主环境安全，默认不勾选任何 JavaScript 与 Python 脚本直接执行。
                  </Typography>
                </Box>
                <Switch
                  data-testid="composer-vm-toggle-all-replacements"
                  checked={isAllReplacementsChecked}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setVmDraft((curr) => ({
                      ...curr,
                      tools: {
                        ...curr.tools,
                        replaceExec: checked
                      },
                      process: {
                        ...curr.process,
                        bun: checked
                      }
                    }));
                  }}
                />
              </Stack>
            </Box>
          );
        })()}

        {/* 1. 替换系统命令行/Exec执行 */}
        <Box sx={{ p: 1.5, border: "1px solid", borderColor: vmDraft.tools?.replaceExec ? "primary.light" : "divider", borderRadius: 2, bgcolor: vmDraft.tools?.replaceExec ? (theme) => alpha(theme.palette.primary.main, 0.035) : "transparent" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box sx={{ pr: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 750 }}>
                替换系统命令行/Exec执行 (Replace System Command/Exec)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                默认关闭（允许常规系统命令）：开启后屏蔽宿主 Shell / Terminal，所有可执行计算、自动化与批处理必须走 sa_vm_run 沙箱。
              </Typography>
            </Box>
            <Switch
              data-testid="composer-vm-toggle-exec"
              checked={vmDraft.tools?.replaceExec === true}
              onChange={(e) => setVmDraft((curr) => ({
                ...curr,
                tools: { ...curr.tools, replaceExec: e.target.checked }
              }))}
            />
          </Stack>
        </Box>

        {/* 2. 允许 JavaScript / Node 脚本执行 */}
        <Box sx={{ p: 1.5, border: "1px solid", borderColor: vmDraft.execution?.javascript ? "primary.light" : "divider", borderRadius: 2, bgcolor: vmDraft.execution?.javascript ? (theme) => alpha(theme.palette.primary.main, 0.035) : "transparent" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box sx={{ pr: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 750 }}>
                允许 JavaScript / Node 脚本执行 (Allow JavaScript/Node)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                默认关闭（屏蔽 JS 执行）：开启后允许通过 VM 安全策略运行 Node / JS 脚本与自动化任务 (vm-js)；关闭时彻底阻断任何直接的 JS 调用。
              </Typography>
            </Box>
            <Switch
              data-testid="composer-vm-toggle-javascript"
              checked={vmDraft.execution?.javascript === true}
              onChange={(e) => setVmDraft((curr) => ({
                ...curr,
                execution: { ...curr.execution, javascript: e.target.checked }
              }))}
            />
          </Stack>
        </Box>

        {/* 3. 允许 Python 脚本执行 */}
        <Box sx={{ p: 1.5, border: "1px solid", borderColor: vmDraft.execution?.python ? "primary.light" : "divider", borderRadius: 2, bgcolor: vmDraft.execution?.python ? (theme) => alpha(theme.palette.primary.main, 0.035) : "transparent" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box sx={{ pr: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 750 }}>
                允许 Python 脚本执行 (Allow Python)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                默认关闭（屏蔽 Python 执行）：开启后允许通过 VM 安全策略运行 Python 脚本 (vm-py)；关闭时彻底阻断任何直接的 Python 调用。
              </Typography>
            </Box>
            <Switch
              data-testid="composer-vm-toggle-python"
              checked={vmDraft.execution?.python === true}
              onChange={(e) => setVmDraft((curr) => ({
                ...curr,
                execution: { ...curr.execution, python: e.target.checked }
              }))}
            />
          </Stack>
        </Box>

        {/* 4. 允许受控通用 Bun 执行 (Allow Safe Bun Runner) */}
        {(() => {
          const isBunEnabled = Boolean(vmDraft.process?.bun === true || (typeof vmDraft.process?.bun === "object" && vmDraft.process.bun !== null && vmDraft.process.bun.enabled === true));
          return (
            <Box sx={{ p: 1.5, border: "1px solid", borderColor: isBunEnabled ? "primary.light" : "divider", borderRadius: 2, bgcolor: isBunEnabled ? (theme) => alpha(theme.palette.primary.main, 0.035) : "transparent" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box sx={{ pr: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 750 }}>
                    允许受控 Bun 执行 (Allow Safe Bun Runner)
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    默认关闭：开启后允许模型在工作区沙盒中运行受约束的通用 Bun 命令（支持 test、build、run 直接跑文件、受限 --filter，严格离线且禁止任意 shell 脚本与 package.json scripts 逃逸）。
                  </Typography>
                </Box>
                <Switch
                  data-testid="composer-vm-toggle-bun"
                  checked={isBunEnabled}
                  onChange={(e) => setVmDraft((curr) => ({
                    ...curr,
                    process: { ...curr.process, bun: e.target.checked }
                  }))}
                />
              </Stack>
            </Box>
          );
        })()}

        {/* 代码智能与增强工具独立提示 */}
        <Box
          data-testid="composer-vm-decoupled-enhance-info"
          sx={{
            p: 2,
            border: "1px dashed",
            borderColor: "primary.main",
            borderRadius: 2,
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04)
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 850, color: "primary.main" }}>
                ✨ 代码智能与增强工具已独立拆分
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                防爆流大文件读取、极速 ripgrep 检索、精准局部代码编辑、统一补丁、AST 语法树重构（大纲提取、定义跳转、符号重命名、模块抽取、导入更新、即时诊断）已从安全沙箱中解耦，移至 Composer 输入框左侧的专属<strong>「代码增强」</strong>按钮。无需开启 VM 安全沙箱，不限终端命令，原生极速执行！
              </Typography>
            </Box>
          </Stack>
        </Box>

        {/* 固定工程验证 Profile (Fixed Project Check Profiles) */}
        {(() => {
          const allProfiles = ALL_SA_VM_BUN_PROFILES;
          const isAllProfilesChecked = allProfiles.length > 0 && allProfiles.every((p) => enabledBunProfiles.includes(p));

          return (
            <Box
              sx={{
                p: 1.5,
                border: "1px solid",
                borderColor: enabledBunProfiles.length ? "warning.light" : "divider",
                borderRadius: 2,
                bgcolor: enabledBunProfiles.length ? (theme) => alpha(theme.palette.warning.main, 0.04) : "transparent"
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Box sx={{ pr: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 750 }}>
                    固定工程验证 Profile (Fixed Project Check Profiles)
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    仅在沙箱保护下运行服务端预定义的类型检查、前端构建或白名单单测命令。绝不开放任意 bun 参数、随意启动脚本、路径越界或环境变量；源码目录仍受当前工作区限制。
                  </Typography>
                </Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: 750, color: "text.secondary" }}>
                    全选
                  </Typography>
                  <Switch
                    data-testid="composer-vm-toggle-all-bun-profiles"
                    checked={isAllProfilesChecked}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setVmDraft((current) => ({
                        ...current,
                        process: {
                          ...current.process,
                          bunProfiles: checked ? [...allProfiles] : []
                        }
                      }));
                    }}
                    inputProps={{ "aria-label": "固定工程验证 Profile 全选" }}
                  />
                </Stack>
              </Stack>
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 750, color: "text.secondary", display: "block", mb: 0.25 }}>类型检查 (Typecheck Profiles):</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} flexWrap="wrap">
                  {typecheckProfiles.map((profile) => (
                    <FormControlLabel
                      key={profile.id}
                      control={<Checkbox size="small" checked={enabledBunProfiles.includes(profile.id)} onChange={(event) => setBunProfile(profile.id, event.target.checked)} inputProps={{ "aria-label": profile.label }} />}
                      label={<Typography variant="caption">{profile.label}</Typography>}
                    />
                  ))}
                </Stack>
              </Box>
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 750, color: "text.secondary", display: "block", mb: 0.25 }}>受控构建 (Build Profiles):</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} flexWrap="wrap">
                  {buildProfiles.map((profile) => (
                    <FormControlLabel
                      key={profile.id}
                      control={<Checkbox size="small" checked={enabledBunProfiles.includes(profile.id)} onChange={(event) => setBunProfile(profile.id, event.target.checked)} inputProps={{ "aria-label": profile.label }} />}
                      label={<Typography variant="caption">{profile.label}</Typography>}
                    />
                  ))}
                </Stack>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 750, color: "text.secondary", display: "block", mb: 0.25 }}>指定单测文件运行 (Single Test File Profiles):</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} flexWrap="wrap">
                  {testProfiles.map((profile) => (
                    <FormControlLabel
                      key={profile.id}
                      control={<Checkbox size="small" checked={enabledBunProfiles.includes(profile.id)} onChange={(event) => setBunProfile(profile.id, event.target.checked)} inputProps={{ "aria-label": profile.label }} />}
                      label={<Typography variant="caption">{profile.label}</Typography>}
                    />
                  ))}
                </Stack>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                勾选仅修改草稿，需点保存才会写入当前线程；保存后发新一轮对话生效（工具定义与 skill 按 turn 构建）。策略按线程隔离，换对话需重新开启。
              </Typography>
            </Box>
          );
        })()}

        {/* 代码责任与错误惩罚机制 (Accountability Ledger) */}
        {(() => {
          const jevConfig = loadJevConfig();
          const hasJevKey = jevConfig.apiKey.trim().length > 0;
          const isAccountabilityEnabled = hasJevKey && vmDraft.accountability?.enabled === true;

          return (
            <Box
              sx={{
                p: 1.5,
                border: "1.5px solid",
                borderColor: isAccountabilityEnabled ? "primary.main" : "divider",
                borderRadius: 2,
                bgcolor: isAccountabilityEnabled
                  ? (theme) => alpha(theme.palette.primary.main, 0.04)
                  : (theme) => alpha(theme.palette.action.hover, 0.02)
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box sx={{ pr: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 850 }}>
                    代码责任与错误惩罚机制 (Accountability Ledger)
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                    {hasJevKey
                      ? "模型写错代码、出现回归或死循环时扣除信誉分并永久记账；进入 RED 梯队（< 50 分）由 JEV 全自动督导审查；修复后沉淀抗体规则永久免疫。"
                      : "未配置 JEV 密钥：高危红线阶段（RED 梯队）需依赖 JEV 进行全自动督导与红队审查。请先设置 JEV 密钥后方可开启本机制（默认关闭）。"}
                  </Typography>
                </Box>
                <Switch
                  size="small"
                  disabled={!hasJevKey}
                  checked={isAccountabilityEnabled}
                  onChange={(e) => {
                    if (!hasJevKey) return;
                    setVmDraft((current) => ({
                      ...current,
                      accountability: {
                        ...current.accountability,
                        enabled: e.target.checked,
                        autoPenalize: true,
                        reputationThresholdRed: 50,
                        reputationThresholdYellow: 80,
                      }
                    }));
                  }}
                  data-testid="composer-vm-accountability-toggle"
                />
              </Stack>
              {!hasJevKey && (
                <Alert severity="warning" sx={{ mt: 1, py: 0.5, px: 1.25, fontSize: "0.75rem", borderRadius: 1.5 }}>
                  请先设置 JEV 密钥：高危红线阶段需 JEV 裁判进行全自动红队审查以阻断风险。
                </Alert>
              )}
            </Box>
          );
        })()}
      </Stack>
    </Box>
  );
}
