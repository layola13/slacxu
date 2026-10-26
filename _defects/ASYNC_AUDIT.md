# ASYNC_AUDIT — `// DEFECT: async` 压平审计清单

> 背景：批量转换简报误判「SLA 不支持 async」，把 TS async 函数压平为
> 同步函数 + 状态码，全仓留下 `// DEFECT: async` 标记。SLA 实际原生
> 支持 async/await（证据与正确映射规则见 ASYNC_MODEL.md）。本清单
> 盘点全部标记点，并对 sdk-backend 做逐站点语义分类，为分域重译排期。
> 分类定义：**签名压平** = 仅签名/调用形态由 Promise 改为同步（状态码 /
> fn 指针 / 同步 extern），函数逻辑完整在位；**语义桩** = 函数逻辑被
> 丢弃（函数体缺失、恒返回、协调语义消失），行为与 TS 源不等价。

## 0. 计数口径与对账

生成方法：Python 脚本遍历 `/content/bulk` 全部 `.sla`/`.sax` 文件，
统计子串 `DEFECT: async` 的出现次数（`str.count`，含 `DEFECT: async/await`
等变体），逐文件汇总；脚本与口径可复现。

| 口径 | 文件数 | 处数 |
|---|---|---|
| 本审计（子串出现次数，全仓 .sla/.sax） | 189 | 1194 |
| 同上但逐行计（一行多处计 1） | 189 | 1192 |
| 排除 `mini-codex/test/`（4 文件 / 6 处） | 185 | 1188 |
| 转换简报原报数 | 185 | 1181 |

对账：文件数差异 4 = `mini-codex/test/` 下 4 个测试文件，简报未计、
本审计计入。处数在同一 185 文件口径下仍差 7 处，应为简报计数时的
模式/时点差异（如仅计 `// DEFECT: async` 行首形或后续提交增删），
无法完全复原；后续工作一律以本审计口径（189 文件 / 1194 处）为准。

## 1. sdk-backend 逐站点分类（6 文件 / 19 标记）

总览：**签名压平 18 标记；语义桩集中在 1 个文件（saVmWorkspaceSkill）
的 3 个函数**。四个「文件」其实是纯契约文件（TS 侧只有 interface、
没有任何函数体），其标记天然只能是签名压平——async 的实现体在各
backends / apps 的实现文件里（各自有自己的标记，见 §2）。

### 1.1 runtimeClient.sla（源 runtimeClient.ts，纯 interface）

标记 4，全部位于 `CodexRuntimeClient` 契约结构体的 fn 指针字段注释：

| .sla 行 | TS 成员 | 分类 | 说明 |
|---|---|---|---|
| L21 | `start(): Promise<EngineStatus>` | 签名压平 | 契约层异步性未以 future<EngineStatus> 表达，仅记 ptr |
| L25 | `restart(): Promise<EngineStatus>` | 签名压平 | 同上 |
| L27 | `request(...): Promise<JsonValue>` | 签名压平 | 同上 |
| L29 | `notify(...): Promise<void>` | 签名压平 | 同上 |

### 1.2 service.sla（源 service.ts，纯 interface/type）

标记 3：L12（文件头总注：Promise 方法 → fn 指针、由宿主泵或同步
完成）、L41 `ServicePlugin.start`、L43 `ServicePlugin.stop`，全部
**签名压平**。附注：`RelayConfigPlugin` 的 listRelays / upsertRelay /
removeRelay / resolveRelay（均 Promise-returning）在 .sla L70–83 无
单独标记、由 L12 总注覆盖，同为契约层签名压平。

### 1.3 server.sla（源 server.ts，纯 interface）

标记 4：L57 `EngineHandle.start`、L59 `EngineHandle.stop`、L64
`EngineHandle.handleRpc`、L124 `ServerPlugin.findInstallations`，
全部 **签名压平**（契约 fn 指针字段；handleRpc 的 throw → 状态码
约定记在实现侧）。

### 1.4 hostServices.sla（源 hostServices.ts：interface + 3 个平凡同步函数）

标记 5，全部在 `PluginHostServices` 分组接口的方法声明上：
L37 `saVm.ensureProjectBundleInstalled`、L39 `saVm.runTool`、
L50 `remoteBun.openTunnel`、L54 `remoteBun.request`、
L79 `relay.runChatRequestWithKeyFailover`。实现体在宿主
（apps/server），本文件只有契约，全部 **签名压平**。

⚠ 另案（非 async，不计入本审计语义桩数，但必须点名）：本文件
L97 起的模块单例访问器（setPluginHostServices /
tryPluginHostServices / pluginHostServices）被压成只记 presence
flag——函数体注释自认 "bulk pass records presence only"、
"table copy-out deferred to fix phase"。这是缺口 2（模块级可变
全局）造成的桩，与 async 无关，已有 sa_global_* 落地待回绑。

### 1.5 imagePersistence.sla（源 imagePersistence.ts，含 2 个真 async 函数）

标记 2：L14 文件头总注、L285（persistImageApiResult 上方总注）。
逐函数对照 TS 源核对：

| 函数 | .sla 位置 | 核对结果 | 分类 |
|---|---|---|---|
| `persistImageApiResult` | L294 | 函数体完整：mkdir(0o700) → 逐条目 imageBytes → null/超限抛错映射状态 3 → 128MiB 上限 → 文件名（时间 base36 + 随机 hex）→ writeFile(0o600) → 元数据剥 url/b64Json/b64_json、顶层剥 raw → 组装 data 返回 | 签名压平 |
| `imageBytes` | L388 | 函数体完整：b64Json/b64_json 解码、data: URL 解析、http(s) fetch（30s 超时、非 2xx 抛错、content-length 上限、content-type 切分 trim）俱在 | 签名压平 |

本文件与 async 无关的既存缺陷（文件内已自标 DEFECT，不在本审计
范围）：字节缓冲 40KiB vs 128MiB 上限（L321）、`{...rest}` 顶层
字段未携带（L288）、randomBytes 改 splitmix 确定性序列（L329）。
另：体内占位 extern `sa_base64_decode` / `sa_http_fetch_bytes`
的真实声明已由 sci 侧补齐（sa_b64dec_simd / sa_http_fetch_bytes），
属声明回绑问题，非 async 压平。

### 1.6 saVmWorkspaceSkill.sla（源 saVmWorkspaceSkill.ts，2200 行）

标记仅 1 处：L7 文件头总注（async fs → sync 调用；模块级
Map/Set 状态 → 顺序执行 + 单槽标志）。该总注覆盖的函数需分开看：

**签名压平**（函数体在位，await 点改顺序同步调用）：

| 函数 | .sla 行 | 说明 |
|---|---|---|
| `isGeneratedJevWorkspaceSkill` | L803 | 读文件 + marker 包含判断，完整 |
| `isGeneratedSaVmWorkspaceSkill` | L809 | 同上 |
| `cleanupAllWorkspaceSaVmSkills` | L840 | 候选目录枚举 + 逐个 remove_dir_all，错误吞掉（对应 TS `.catch(()=>{})`），完整 |
| `forceUpdateWorkspaceSkill` | L947 | mkdir/writeFile 等 await 步骤顺序执行，主体在位 |

**语义桩**（async 协调语义被丢弃；sdk-backend 全部 async 语义桩
共 3 处，都在本文件、且同根：模块级 `Map<string, Promise>` 在途
状态在 SLA 侧无处安放）：

| # | 函数 | .sla 位置 | 被丢弃的源逻辑 |
|---|---|---|---|
| 1 | `waitForWorkspaceSkillSyncs` | 约 L1105 | TS（源约 L2122）：`while (skillSyncInflight.has(root)) await skillSyncInflight.get(root);` 等全部在途 job 落定，随后 rethrow 记录的失败。SLA 函数体只剩 `return 0;`，注释自认 "No inflight state here -> always ok"——屏障与失败重抛整体丢失 |
| 2 | `syncSaVmWorkspaceSkillDirectory` | 约 L1099 | TS（源约 L2095–2115）：把新 job 链到同 root 上一个 inflight job 之后（同工作区串行化）、登记 explicitSkillPolicyRoots、记录失败供屏障重抛。SLA 直接顺序调用 `...Now` 本体——工作仍做，但链式串行化与失败记录丢失（部分语义桩） |
| 3 | `bootstrapProjectSaVmAssets` | 约 L1118 | TS（源约 L2157–2199）：fire-and-forget + `bootstrapInflight` 去重（同 root 在途则直接返回）。SLA 改同步执行、去重塌缩为环境开关 + 存在性检查——调度/去重语义丢失（部分语义桩） |

重译指引（ASYNC_MODEL R11）：这三处需以 sa_global_* 显式状态 +
async 链重建在途表与屏障，不得再以「无状态恒成功」形式带过。

### 1.7 sdk-backend 小结

| 文件 | 标记 | 签名压平 | 语义桩 |
|---|---|---|---|
| runtimeClient.sla | 4 | 4 | 0 |
| service.sla | 3 | 3 | 0 |
| server.sla | 4 | 4 | 0 |
| hostServices.sla | 5 | 5 | 0（另案全局桩见 1.4） |
| imagePersistence.sla | 2 | 2 | 0 |
| saVmWorkspaceSkill.sla | 1（总注） | 覆盖 4 函数 | 3 函数 |
| 合计 | 19 | 18 标记 | 3 函数 |

结论：sdk-backend 此前记为「通过」的 runtimeClient / service /
server 三文件确属纯契约，其通过状态不因 async 审计翻案；但所有
契约 fn 指针的 future 形态表达、以及 saVmWorkspaceSkill 的 3 处
协调语义，必须在修复阶段按 ASYNC_MODEL 重译/重建。

## 2. 其余文件计数表（183 文件）

口径同 §0（子串出现次数）；下表为脚本生成（生成方法见 §0），
按处数降序。sdk-backend 6 文件已在 §1 单列，本表为其余全部。

重点提示（非 sdk 范围、已由本轮第一手核验）：`backends/mini/src/
runtime/agentsMdInventory.sla`（8 处）的 `findAgentsMdProjectRoot`
（L47）是典型语义桩——函数体只剩 `out_len = cwd_len; return 0;`，
向上逐级找 `.git` 的循环仅存于注释；其忠实 async 重译形态已由
ASYNC_MODEL 附录 A 的探针证明可行。重域排期时应优先处理
apps/server（44 文件）与 backends/mini 的大文件（miniBridge 71 处、
saVmTool 66 处）。

<!-- TABLE-START -->
| 处数 | 文件 |
|---:|---|
| 84 | `backends/relay-config/src/relay/relayProtocolGateway.sla` |
| 73 | `apps/web/src/state/codexClient.sla` |
| 71 | `backends/mini/src/runtime/miniBridge.sla` |
| 66 | `apps/server/src/saVmTool.sla` |
| 58 | `packages/cxu/src/vendor/saVmTool.sla` |
| 23 | `apps/server/src/providerStore.sla` |
| 22 | `mini-codex/src/mcp.sla` |
| 21 | `apps/web/src/app/workbench/useProvidersRuntime.sla` |
| 21 | `backends/jev/src/jev/saVmJev.sla` |
| 18 | `apps/server/src/index.sla` |
| 17 | `backends/opencode/src/runtime/opencodeCompatibleRuntime.sla` |
| 16 | `backends/grok/src/runtime/grokCompatibleProxy.sla` |
| 16 | `backends/mini/src/runtime/miniMcp.sla` |
| 15 | `apps/web/src/app/workbench/useTaskTabsSplit.sla` |
| 15 | `apps/web/src/app/workbench/useToolingPlugins.sla` |
| 13 | `backends/codex/src/runtime/remoteBunCodexBridge.sla` |
| 12 | `apps/server/src/authStore.sla` |
| 12 | `backends/codex/src/runtime/codexBridge.sla` |
| 12 | `backends/opencode/src/runtime/opencodeBridge.sla` |
| 11 | `apps/server/src/codeCliBridge.sla` |
| 11 | `apps/web/src/app/workbench/useComposerAssists.sla` |
| 11 | `apps/web/src/app/workbench/useTerminalSessions.sla` |
| 10 | `apps/server/src/launchInstall.sla` |
| 9 | `apps/server/src/imageProtocols.sla` |
| 9 | `backends/relay-config/src/relay/omniRouteFree.sla` |
| 9 | `mini-codex/src/loop.sla` |
| 9 | `packages/cxu/src/vendor/saVmAccountabilityLedger.sla` |
| 8 | `apps/server/src/auggieRedirector.sla` |
| 8 | `apps/server/src/codexCliUpdate.sla` |
| 8 | `apps/server/src/saVmAccountabilityLedger.sla` |
| 8 | `apps/web/src/app/workbench/sshUtils.sla` |
| 8 | `apps/web/src/app/workbench/useComposerSend.sla` |
| 8 | `apps/web/src/app/workbench/useSessionBootstrap.sla` |
| 8 | `apps/web/src/app/workbench/useThreadOpening.sla` |
| 8 | `apps/web/src/app/workbench/useWorkbenchOps.sla` |
| 8 | `backends/codex/src/runtime/daemonCodexBridge.sla` |
| 8 | `backends/mini/src/runtime/agentsMdInventory.sla` |
| 8 | `backends/mini/src/runtime/miniServerHooks.sla` |
| 7 | `apps/server/src/providerModels.sla` |
| 7 | `apps/web/src/app/workbench/useMembersAdmin.sla` |
| 7 | `apps/web/src/app/workbench/useNewSessionFlow.sla` |
| 7 | `backends/codex/src/runtime/sshCodexBridge.sla` |
| 7 | `backends/opencode/src/runtime/opencodeCompatibleProcessManager.sla` |
| 7 | `backends/relay-config/src/server.sla` |
| 7 | `packages/cxu/src/vendor/saVmTreeSitter.sla` |
| 6 | `apps/server/src/regressionRunner.sla` |
| 6 | `apps/server/src/saVmBundle.sla` |
| 6 | `apps/server/src/saVmTreeSitter.sla` |
| 6 | `apps/server/src/taskLiveness.sla` |
| 6 | `apps/web/src/app/workbench/useWorkspaceGitFiles.sla` |
| 6 | `backends/muse/src/runtime/museBridge.sla` |
| 6 | `backends/relay-config/src/relay/freebuffSession.sla` |
| 6 | `mini-codex/src/responses.sla` |
| 6 | `packages/cxu/src/vendor/saVmJev.sla` |
| 5 | `apps/server/src/auditLogStore.sla` |
| 5 | `apps/server/src/saVmSplitWorkflow.sla` |
| 5 | `apps/server/src/threadSubscriptionRegistry.sla` |
| 5 | `apps/web/src/app/relayShare.sla` |
| 5 | `apps/web/src/app/workbench/composerCoreContext.sla` |
| 5 | `apps/web/src/app/workbench/useComposerThreadStart.sla` |
| 5 | `apps/web/src/app/workbench/useFreebuffSession.sla` |
| 5 | `apps/web/src/app/workbench/useOfficialLogin.sla` |
| 5 | `apps/web/src/app/workbench/useSocketPipeline.sla` |
| 5 | `apps/web/src/app/workbench/useThreadsHistory.sla` |
| 5 | `apps/web/src/waterfall/ChatRow.sax` |
| 5 | `backends/grok/src/runtime/grokBridge.sla` |
| 4 | `apps/server/src/forwardApi.sla` |
| 4 | `apps/server/src/freeModelAccess.sla` |
| 4 | `apps/server/src/terminalPty.sla` |
| 4 | `apps/web/src/app/workbench/socketPipelineContext.sla` |
| 4 | `apps/web/src/app/workbench/useComposerPipeline.sla` |
| 4 | `apps/web/src/app/workbench/useSideChatTabs.sla` |
| 4 | `apps/web/src/app/workbench/useSshWorkspaceLifecycle.sla` |
| 4 | `apps/web/src/app/workbench/useWorkspaceFiles.sla` |
| 4 | `apps/web/src/free/useFreeCompaction.sla` |
| 4 | `backends/agy/src/server.sla` |
| 4 | `backends/auggie/src/server.sla` |
| 4 | `backends/claude/src/runtime/claudeDesktopInjection.sla` |
| 4 | `backends/claude/src/runtime/claudeTurnInput.sla` |
| 4 | `backends/claude/src/server.sla` |
| 4 | `backends/cline/src/server.sla` |
| 4 | `backends/codex/src/server.sla` |
| 4 | `backends/command-code/src/server.sla` |
| 4 | `backends/free-mode/src/free/compactionRelayRequest.sla` |
| 4 | `backends/grok/src/server.sla` |
| 4 | `backends/muse/src/server.sla` |
| 4 | `backends/opencode-v2/src/server.sla` |
| 4 | `backends/opencode/src/runtime/opencodeCompatibleProbe.sla` |
| 4 | `backends/opencode/src/server.sla` |
| 4 | `backends/pi/src/runtime/piBridge.sla` |
| 4 | `backends/pi/src/runtime/piRuntimeAdapter.sla` |
| 4 | `backends/pi/src/server.sla` |
| 4 | `mini-codex/src/hooks.sla` |
| 3 | `apps/server/src/runtime/password.sla` |
| 3 | `apps/server/src/runtime/server.sla` |
| 3 | `apps/server/src/saVmCodeGraph.sla` |
| 3 | `apps/server/src/sshCodeCliBridge.sla` |
| 3 | `apps/server/src/sshSystemMetrics.sla` |
| 3 | `apps/server/src/threadStartCompatibility.sla` |
| 3 | `apps/web/scripts/build.sla` |
| 3 | `apps/web/src/app/threads/threadHistoryService.sla` |
| 3 | `apps/web/src/app/workbench/useCodexConfig.sla` |
| 3 | `apps/web/src/app/workbench/useProviderTest.sla` |
| 3 | `apps/web/src/app/workbench/useSessionRecovery.sla` |
| 3 | `apps/web/src/app/workbench/useTurnOps.sla` |
| 3 | `apps/web/src/app/workbench/useWorkbenchEffects.sla` |
| 3 | `apps/web/src/waterfall/ChatWaterfall.sax` |
| 3 | `frontends/jev/src/jev/jevAutoJudge.sla` |
| 3 | `frontends/jev/src/jev/jevClient.sla` |
| 3 | `packages/cxu/src/vendor/saVmCodeGraph.sla` |
| 2 | `apps/server/src/agentReadiness.sla` |
| 2 | `apps/server/src/cliVersions.sla` |
| 2 | `apps/server/src/cursorDesktopInjection.sla` |
| 2 | `apps/server/src/gitWorkspace.sla` |
| 2 | `apps/server/src/legacyImageViewHistory.sla` |
| 2 | `apps/server/src/remoteBunNode.sla` |
| 2 | `apps/server/src/sshHostDiscovery.sla` |
| 2 | `apps/server/src/workspaceAgents.sla` |
| 2 | `apps/web/src/app/pwa/serviceWorkerLifecycle.sla` |
| 2 | `apps/web/src/app/threads/threadCatalog.sla` |
| 2 | `apps/web/src/app/workbench/useComposerRuntime.sla` |
| 2 | `apps/web/src/app/workbench/useLoadBasics.sla` |
| 2 | `apps/web/src/app/workbench/useSelectionRuntime.sla` |
| 2 | `apps/web/src/app/workbench/useSettingsAndInstall.sla` |
| 2 | `apps/web/src/app/workbench/useSshWorkspace.sla` |
| 2 | `apps/web/src/goalContinuation.sla` |
| 2 | `backends/free-mode/src/server.sla` |
| 2 | `backends/jev/src/server.sla` |
| 2 | `backends/mini/src/runtime/imageView.sla` |
| 2 | `backends/relay-config/src/relay/freeOllama.sla` |
| 2 | `backends/vmtool-security/src/server.sla` |
| 2 | `frontends/jev/src/jev/JevSettingsDialog.sax` |
| 2 | `mini-codex/src/imageView.sla` |
| 2 | `mini-codex/src/mcpHooks.sla` |
| 2 | `mini-codex/src/skills.sla` |
| 2 | `mini-codex/test/hooks.test.sla` |
| 2 | `mini-codex/test/loop.test.sla` |
| 2 | `packages/cxu/src/vendor/regressionRunner.sla` |
| 1 | `apps/duck2api/src/duckgo/stream.sla` |
| 1 | `apps/duck2api/src/duckgo/vqd.sla` |
| 1 | `apps/server/src/codexApiRuntime.sla` |
| 1 | `apps/server/src/commandBlacklist.sla` |
| 1 | `apps/server/src/dataGarbageCleaner.sla` |
| 1 | `apps/server/src/forwardTurn.sla` |
| 1 | `apps/server/src/remoteThreadLifecycle.sla` |
| 1 | `apps/server/src/saVmExecutor.sla` |
| 1 | `apps/server/src/saVmFindWorker.sla` |
| 1 | `apps/server/src/threadHistoryTail.sla` |
| 1 | `apps/server/src/webdevProbe.sla` |
| 1 | `apps/web/src/app/turnInterruptRetry.sla` |
| 1 | `apps/web/src/app/workbench/appUtils.sla` |
| 1 | `apps/web/src/app/workbench/usePreferencesSync.sla` |
| 1 | `apps/web/src/app/workbench/useSettingsRuntime.sla` |
| 1 | `apps/web/src/app/workbench/useTaskTabsRuntime.sla` |
| 1 | `apps/web/src/app/workbench/useTaskTabsState.sla` |
| 1 | `apps/web/src/app/workbench/useThreadWorkspaceRuntime.sla` |
| 1 | `apps/web/src/composer/composerSubmission.sla` |
| 1 | `apps/web/src/composer/sendReconcile.sla` |
| 1 | `apps/web/src/historyExport.sla` |
| 1 | `apps/web/src/imageCommand.sla` |
| 1 | `apps/web/src/imageThreadHistory.sla` |
| 1 | `backends/agy/src/runtime/agyCompatibleRuntime.sla` |
| 1 | `backends/agy/src/runtime/agyGeminiResponse.sla` |
| 1 | `backends/agy/src/runtime/agyRawCapture.sla` |
| 1 | `backends/claude/src/runtime/claudeCompactionRunner.sla` |
| 1 | `backends/claude/src/runtime/claudeCompatibleProbe.sla` |
| 1 | `backends/grok/src/runtime/grokCompatibleProcessManager.sla` |
| 1 | `backends/grok/src/runtime/grokCompatibleRuntime.sla` |
| 1 | `backends/mini/src/runtime/miniCapabilities.sla` |
| 1 | `backends/mini/src/runtime/miniInput.sla` |
| 1 | `backends/muse/src/runtime/museCompatibleRuntime.sla` |
| 1 | `backends/muse/src/runtime/museSkillPreload.sla` |
| 1 | `backends/pi/src/runtime/piRpcProcessManager.sla` |
| 1 | `backends/relay-config/src/relay/relayCatalog.sla` |
| 1 | `frontends/enhance/src/enhance/EnhanceToolsDialog.sax` |
| 1 | `mini-codex/src/ultraAdapter.sla` |
| 1 | `mini-codex/test/fourpiece.test.sla` |
| 1 | `mini-codex/test/soak.test.sla` |
| 1 | `packages/cxu/src/cli-doctor.sla` |
| 1 | `packages/cxu/src/cli.sla` |
| 1 | `packages/cxu/src/serve.sla` |
| 1 | `packages/cxu/src/vendor/saVmFindWorker.sla` |
| 1 | `packages/cxu/src/vendor/saVmSplitWorkflow.sla` |

其余文件合计：183 文件 / 1175 处（= 全仓 189 文件 / 1194 处，减去 sdk-backend 6 文件 / 19 处）。

<!-- TABLE-END -->

## 3. 排期建议（供修复阶段引用）

1. sdk-backend：契约四文件的 future 形态表达随各实现文件重译时统一处理；saVmWorkspaceSkill 的 3 处协调语义按 R11 重建，与缺口 2 的 sa_global_* 回绑同一轮做。
2. apps/server（44 文件）：标记最密集的大文件（saVmTool 66、providerStore 23、index 18）优先逐函数分类，预计语义桩占比显著高于 sdk-backend（该域多为真实实现体而非契约）。
3. backends/mini：miniBridge（71）与 agentsMdInventory （已证实语义桩）优先；mini 是手写版已验证域，重译可参照手写版的同步驱动结构。
4. apps/web / frontends（.sla/.sax）：前端最终走 wasm，async 形态（socket 流水线、hooks）与 SAX 行为层缺口交织，排在阶段 2 与 DOM 桥面一起处理，不在后端轮次内强行重译。
