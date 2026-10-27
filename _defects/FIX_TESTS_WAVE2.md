# FIX_TESTS_WAVE2 — tests/ 第二波转换（Agent AF，2026-10-27）

基点：bulk-convert `f95c84b`，worktree `/content/bulk-tests2`（盒上）。范围：`tests/` + 本文件 + `_defects/probes/t2_*.sla`。未推送、未建分支。

## 0. 头条

- **bulk 树里原本没有 `tests/`**：第一波镜像（cxu-sla-mirror）未带顶层 tests/。本波先把 CXU 源测试树 1:1 镜像进来（提交 `45bd9c8`）：源 = 盒上 codex-react-ui 克隆 @ `e113825e`（工作树干净；比产品镜像的 f2cb649d 多 3 个提交：66ac1f78/6e1228cf/e113825e，均为 cline/web 修复）。
- 普查：tests/ 共 **452 文件**，其中 .ts/.tsx **436 文件 / 91,938 行 / 3,818 个 test() 用例**（bun:test 占 432/436，框架高度统一）。
- 分类：**(i) 服务端向可转 199、(ii) 前端/DOM 向 167、(iii) 产品面阻塞 70**。
- 已转换 6 文件并逐个跑 `sa test`：**全绿 2 文件**（tokenUsage 6/6、workspacePermissions 1/1）；产品分歧/桩暴露 2 文件（remoteBunCodexBridge 2/4、staticAssetContentType 1/2）；check 绿但运行被编译器路径阻塞 2 文件（anthropicBudgetEffort — PhiStateConflict 陷阱；threadHistoryPaging — SAB 直降 UnsupportedSabDirectFeature）。详见 §3。
- 树内既有 15 个散列测试文件（apps/duck2api/test 6、apps/free-key-server/src 4、mini-codex/test 5）第一波已转，本波未动；其运行口径以各域交付为准（mini-codex loop.test.sla 已知「编译绿、运行未绿」）。

## 1. 普查（tests/ 源树，@ e113825e）

| 目录 | 文件数 | .ts/.tsx | 说明 |
|---|---|---|---|
| server/ | 279 | 277 | 服务端套件主体，63,090 行 |
| web/ | 144 | 144 | Web 前端套件 |
| desktop/ | 10 | 10 | 桌面壳套件 |
| e2e/ | 5 | 1 | 浏览器端到端（余为数据/脚本） |
| fixtures/ | 8 | 1 | 黄金数据（relayProtocolGolden.json 等）+ 1 个 fixtures.ts |
| shared/ | 3 | 3 | @codex-ui/shared 套件 |
| cases/ | 3 | 0 | 回归用例数据（regression/） |

非 TS 文件（16 个：.json 黄金数据、cases 数据等）随树原样镜像，不转换。非 .test 的 TS 文件仅 2 个：`server/saVmSimApp.fixture.tsx`（fixture 组件，归 (ii)）、`fixtures/claude-compatible/fixtures.ts`（夹具数据生成，归 (i) 前沿）。
包导入面（全树统计）：node:fs 160、node:path 153、node:os 102、@codex-ui/shared 63（多为 import type）、bun:sqlite 23、node:events 15、node:child_process 14、react 24、react-dom 19、@mui 14。

## 2. 分类方法与结果

- (ii) 判定：位于 web/、desktop/、e2e/，或导入 react/react-dom/@mui/happy-dom/jsdom，或含 DOM 标记（document./window./localStorage 等）。共 **167 files / 31347 lines / 1129 test() cases**。归阶段 2（前端 wasm/SAX+DOM 桥），本波只登记。
- (iii) 判定（两层）：(a) 导入的产品模块在 bulk 树无 .sla、或属 AB 登记的骨架族（存储族 6、launch/install 族、index B 区、password E 类）；(b) **函数体骨架精化**：对每个具名导入的 lowercase 函数，在产品 .sla（跟随一层 barrel @import）里提取函数体，剥注释后为空/仅预设 return/仅自赋值 → 骨架。精化把 47 个文件从 (i) 移入 (iii)，每条带逐函数证据（§5 表中 reason）。偏差声明：精化只会把骨架误判为真实（注释含花括号曾导致提取溢出，已用剥注释修复并复跑），不会反向误杀；(i) 中仍可能有漏检骨架，转换运行时以实测为准。共 **70 files / 11651 lines / 561 test() cases**。
- (i)：其余服务端向。共 **199 files / 48940 lines / 2128 test() cases**，其中 32 个文件为「部分骨架」（个别导入函数是桩，其余真实），转换后按断言逐条落名登记。

### 2.1 源头发现：4 个测试文件导入已被搬走的模块（stale import）

CXU 源仓提交 `b3fb4d7e`（refactor(sdk): move ClaudeSkillInventory and the Codex virtual-config store into sdk-backend）把模块搬进 sdk-backend，但 4 个测试仍指向旧路径 `backends/codex/src/runtime/virtualCodexConfig.ts` / `backends/claude/src/runtime/claudeSkillInventory.ts`（源树与 bulk 树均不存在该路径，git log --all 已核）：`server/virtualCodexConfig.test.ts`、`server/providerRoutingIsolation.test.ts`、`server/daemonCodexBridge.test.ts`、`server/claudeSkillInventory.test.ts`。活对应物在 `sdk-backend/src/codexVirtualConfig.sla` 等。本波按原文登记为 (iii)，**未擅自改指向**——是否改测试导入属产品侧测试维护决定。

### 2.2 与并行线的关系

(iii) 中 9 个文件阻塞在存储族 6 文件（providerStore/authStore/imageProtocols/providerModels/saVmAccountabilityLedger/auditLogStore）：AC 线已重译并集成至 bulk-convert `49d5bb0`（本波基点 f95c84b 之后）。本波不 rebase；集成后这 9 个文件自动转入 (i) 候选（见 §5 表中标 * 的行）。

## 3. 已转换文件与 sa test 结果（逐文件，名字集）

统一口径：`sa test <file>`（worktree 根 cwd，SA_PLUGIN_DEV=1、SLA_NO_FRESHNESS_CACHE=1、SA_STD_DIR=sci/sa_std、timeout 120；重闭包个案另注）。转换形态：每个 test() → 一个 @test（原名保留）；expect → 显式比较 + panic(码)；TS 对象字面量入参 → 等价 JSON 文本经 sa_json_parse 或产品 JsonBuf 载体；文件头带 DEFECT 登记（test framework 近似）。

### 3.1 tests/shared/tokenUsage.test.sla — ✅ 6/6 PASS（1.07s）

PASS 名字集：{normalizes Anthropic cache fields without inventing reasoning; normalizes OpenAI cache and reasoning fields; treats OpenAI Responses usage (input_tokens + *_details) as inclusive, not Anthropic; ring payload flagged reasoningIncludedInOutput does not double-count reasoning; normalizes Gemini usage metadata; normalizes opencode exclusive splits to inclusive standard}。FAIL：∅。

### 3.2 tests/shared/workspacePermissions.test.sla — ✅ 1/1 PASS

PASS：{maps additional workspace roots into writable sandbox roots}。FAIL：∅。（首轮曾 FAIL panic 12：测试侧以字段级赋值写 StrList 槽位未生效，改整槽 StrRef 赋值后绿——产品 list_push 本就用整槽赋值，属测试写法教训，见 §6。）

### 3.3 tests/server/remoteBunCodexBridge.test.sla — 2/4（产品分歧，非测试缺陷）

PASS：{bounds reconnect attempts during an outage; backs off to a stable low-frequency probe for long outages}。
FAIL：{retries only read RPCs — panic 13：产品 isRemoteRpcRetrySafe 是**长度分类近似**（其文件内自注），turn/start（len 10）被判 safe，与 TS 语义 false 分歧；thread/goal/set（len 15）同理被判 safe（该断言在其后，未及执行）}；{distinguishes transport failures from remote RPC errors — panic 21：产品 isRemoteTransportFailure 是预设桩 `return false;`（其文件内 DEFECT 自注 regex 扫描未做），首个断言即假}。测试按 TS 原文转换，未迁就实现。

### 3.4 tests/server/staticAssetContentType.test.sla — 1/2（产品空体；本文件在精化分类中属 (iii)，试点先行）

PASS：{does not guess unknown static asset content types}（注：产品体为空，该 PASS 是空体下的真空通过，不作产品证据）。FAIL：{serves SVG and common web assets with browser-compatible content types — panic 11：产品 apps/server/src/staticAssetContentType.sla 函数体为空骨架，out_found 永假}。

### 3.5 tests/server/anthropicBudgetEffort.test.sla — check PASS，sa test 被产品闭包 PhiStateConflict 陷阱阻断

sa check PASS（1.3s）。sa test：SAB 执行约 450s 后陷阱退出 rc=1 — `PhiStateConflict: register sla__rpg_free_doc__param_0_doc, expected Active / actual Consumed`（test bundle SAB line 1322）。产品 fn anthropicBudgetToEffort 本体真实（P 线重译），但其调用的 rpg_free_doc（包装 sa_json_free(^doc) 的消耗型释放）在 SAB 路径上控制流合并不一致——与已登记的 spawnHostProcess PhiStateConflict 残余同族。PASS/FAIL 名字集：无（运行在出结果前陷阱）。测试未改。阻塞面：所有会调用到该释放路径的 gateway 闭包测试。

### 3.6 tests/server/threadHistoryPaging.test.sla — check PASS，sa test 被 SAB 直降 UnsupportedSabDirectFeature 阻断

sa check PASS。sa test 立即报 `SAB Error: direct SLA-to-SAB lowering failed: error.UnsupportedSabDirectFeature`。探针隔离（_defects/probes/t2_thp_probe.sla）：仅 @import 产品 + 空 @test 可绿；加入对 pageThreadHistory 的调用即触发——触发点在 sdk-backend/src/threadHistoryPaging.sla 的函数体构造上（SAB 直降未支持的特性），非测试写法（测试已按内联重写仍触发）。PASS/FAIL 名字集：无。编译器面残余，附探针待编译器线处置。

### 3.7 重闭包可跑性探针（决定 (i) 前沿的运行口径）

- miniBridge 闭包（backends/mini/src/runtime/miniBridge.sla，20,568 行）：空 @test 探针 **0.79s PASS**（_defects/probes/t2_mb_probe.sla）——该闭包在 sa test 下可编译可跑，miniBridge 导入型测试（全树导入计数 55 处）不被闭包本身阻塞（各自的断言结果待逐个转换后落名）。
- gateway 闭包：见 3.5（调用释放路径陷阱）。saVmTool 闭包：本波未探针（其 build-exe 闭包此前已证可跑，T 线记录）；sa test 口径待后续批次顺带验。

## 4. (ii) 登记清单（167 文件，归阶段 2，只登记不转）

按目录：desktop 10、e2e 1、server 12、web 144。其中 web/ 144 = 全部 web 套件；desktop/ 10；e2e/ 1（.ts 1 个，余为数据）；另有 server/ 内 12 个文件因 react/happy-dom/DOM 标记归入本类（产品面是前端/桌面行为层）。全名单：

- `desktop/claudeCli.test.ts` (65 行, 3 tests)
- `desktop/codexCli.test.ts` (210 行, 10 tests)
- `desktop/codexInstaller.test.ts` (40 行, 2 tests)
- `desktop/desktopRuntimeDependencies.test.ts` (58 行, 3 tests)
- `desktop/detachedTaskPerformance.test.ts` (165 行, 6 tests)
- `desktop/externalUrl.test.ts` (22 行, 2 tests)
- `desktop/logRotation.test.ts` (32 行, 2 tests)
- `desktop/openWith.test.ts` (66 行, 5 tests)
- `desktop/relayGatewayToken.test.ts` (82 行, 4 tests)
- `desktop/startupWindow.test.ts` (61 行, 3 tests)
- `e2e/workbench.spec.ts` (8461 行, 107 tests)
- `server/agyCompatibleProxy.test.ts` (623 行, 18 tests)
- `server/appSplitPlan.test.ts` (75 行, 5 tests)
- `server/claudeContextWindow.test.ts` (100 行, 5 tests)
- `server/clineHookAttribution.test.ts` (366 行, 5 tests)
- `server/codeWorkspace.test.ts` (49 行, 4 tests)
- `server/legalPolicyStore.test.ts` (28 行, 1 tests)
- `server/saVmExtractRaw.test.ts` (192 行, 6 tests)
- `server/saVmRefactorHardening.test.ts` (167 行, 9 tests)
- `server/saVmRefactorTools.test.ts` (288 行, 7 tests)
- `server/saVmSimApp.fixture.tsx` (177 行, 0 tests)
- `server/saVmSimAppSplit.test.ts` (161 行, 7 tests)
- `server/saVmTreeSitter.test.ts` (670 行, 15 tests)
- `web/advancedRelayDirectory.test.ts` (96 行, 5 tests)
- `web/agentPages.test.ts` (84 行, 5 tests)
- `web/agentReadiness.test.ts` (29 行, 1 tests)
- `web/agentRuntimeSelection.test.ts` (59 行, 5 tests)
- `web/appHookOrdering.test.ts` (37 行, 1 tests)
- `web/appReducer.test.ts` (120 行, 5 tests)
- `web/chatDiffView.test.tsx` (21 行, 1 tests)
- `web/chatPanelSuspended.test.tsx` (140 行, 3 tests)
- `web/chatRowAgyToolDetail.test.ts` (638 行, 17 tests)
- `web/chatRowMuseToolDetail.test.ts` (153 行, 6 tests)
- `web/chatRowSingleToolGroup.test.tsx` (75 行, 1 tests)
- `web/chatRowUsageFormatting.test.ts` (15 行, 2 tests)
- `web/chatRows.test.ts` (1389 行, 53 tests)
- `web/chatTypography.test.ts` (13 行, 2 tests)
- `web/claudeCapabilityGates.test.ts` (45 行, 7 tests)
- `web/claudeHistoryCatalog.test.ts` (69 行, 6 tests)
- `web/claudeStartupStage.test.ts` (78 行, 6 tests)
- `web/cliBackendBranding.test.ts` (112 行, 5 tests)
- `web/cliBackendClassification.test.ts` (73 行, 3 tests)
- `web/cliBackendResolution.test.ts` (71 行, 3 tests)
- `web/cliPrerequisiteGate.test.ts` (25 行, 1 tests)
- `web/cliTogglePolicy.test.ts` (61 行, 5 tests)
- `web/clientPlatform.test.ts` (50 行, 4 tests)
- `web/codexCliRecovery.test.ts` (45 行, 5 tests)
- `web/codexConfigSettings.test.ts` (61 行, 2 tests)
- `web/codexEngineStart.test.ts` (44 行, 2 tests)
- `web/compactModeCheapToggle.test.tsx` (60 行, 3 tests)
- `web/composerAttachments.test.ts` (74 行, 5 tests)
- `web/composerMenuShortcuts.test.ts` (12 行, 1 tests)
- `web/composerSlashCommands.test.ts` (35 行, 5 tests)
- `web/composerSubmission.test.ts` (15 行, 2 tests)
- `web/contextUsage.test.ts` (53 行, 8 tests)
- `web/conversationStatus.test.ts` (42 行, 6 tests)
- `web/dualConversationStreamingPerf.test.ts` (1283 行, 13 tests)
- `web/editConversation.test.ts` (49 行, 3 tests)
- `web/explorerPaths.test.ts` (21 行, 2 tests)
- `web/failedTurnRecovery.test.ts` (48 行, 3 tests)
- `web/freeCompactionReadiness.test.ts` (138 行, 6 tests)
- `web/freeCompactionTurnBinding.test.ts` (14 行, 1 tests)
- `web/freebuffModelSwitchDialog.test.ts` (44 行, 2 tests)
- `web/goalBudgetParse.test.ts` (48 行, 3 tests)
- `web/goalContinuation.test.ts` (62 行, 4 tests)
- `web/goalResumeDecision.test.ts` (38 行, 4 tests)
- `web/groupCollection.test.ts` (429 行, 24 tests)
- `web/history-lazy-loading.test.ts` (145 行, 6 tests)
- `web/historyExport.test.ts` (56 行, 3 tests)
- `web/historySearch.test.ts` (29 行, 3 tests)
- `web/i18n.test.ts` (60 行, 4 tests)
- `web/imageCommand.test.ts` (78 行, 5 tests)
- `web/imageRuntime.test.ts` (23 行, 3 tests)
- `web/imageThreadHistory.test.ts` (24 行, 2 tests)
- `web/jevCollabHooks.test.ts` (118 行, 8 tests)
- `web/jevDispatchOwnership.test.ts` (82 行, 3 tests)
- `web/jevI18n.test.ts` (177 行, 7 tests)
- `web/jevNudgeOwnership.test.ts` (59 行, 4 tests)
- `web/jevTurnSnapshotSource.test.ts` (52 行, 3 tests)
- `web/jevVerdict.test.ts` (228 行, 13 tests)
- `web/lowFpsDiagnostics.test.ts` (76 行, 6 tests)
- `web/markdownMessage.test.tsx` (61 行, 6 tests)
- `web/mobileTopBar.test.tsx` (76 行, 2 tests)
- `web/modelCapacityRetry.test.ts` (95 行, 5 tests)
- `web/modelReasoning.test.ts` (178 行, 11 tests)
- `web/newChatWorkspacePolicy.test.ts` (10 行, 1 tests)
- `web/onboardingSteps.test.ts` (36 行, 3 tests)
- `web/openFileTabs.test.ts` (46 行, 4 tests)
- `web/pendingRows.test.ts` (77 行, 6 tests)
- `web/pendingSendGate.test.ts` (19 行, 2 tests)
- `web/piHistoryRestoration.test.ts` (216 行, 8 tests)
- `web/planContinuation.test.ts` (31 行, 2 tests)
- `web/projectGroupChatRoute.test.ts` (82 行, 6 tests)
- `web/ptyTerminalRegistry.test.ts` (60 行, 2 tests)
- `web/quickRelayManualModels.test.ts` (28 行, 4 tests)
- `web/quickRelayProtocolOptions.test.ts` (18 行, 1 tests)
- `web/recentThreadTranscripts.test.ts` (45 行, 5 tests)
- `web/recentWorkspaces.test.ts` (100 行, 6 tests)
- `web/relayErrorSanitize.test.ts` (48 行, 5 tests)
- `web/relayListPagination.test.ts` (27 行, 2 tests)
- `web/relayNameValidation.test.ts` (20 行, 2 tests)
- `web/relayShare.test.ts` (65 行, 5 tests)
- `web/relayShareDialogFeedback.test.ts` (15 行, 1 tests)
- `web/remoteTurnErrors.test.ts` (27 行, 4 tests)
- `web/retrySettings.test.ts` (18 行, 1 tests)
- `web/retryStabilityAndWaterfall.test.ts` (402 行, 7 tests)
- `web/reviewTurn.test.ts` (21 行, 2 tests)
- `web/rightWorkspaceContext.test.ts` (49 行, 3 tests)
- `web/runtimeTurnProjection.test.ts` (146 行, 10 tests)
- `web/saVmChatActivity.test.ts` (273 行, 7 tests)
- `web/saVmMode.test.ts` (150 行, 8 tests)
- `web/sendReconcile.test.ts` (48 行, 5 tests)
- `web/serviceWorkerLifecycle.test.ts` (74 行, 4 tests)
- `web/sideChatDuckDefaults.test.ts` (94 行, 7 tests)
- `web/sideChatWaterfall.test.ts` (41 行, 2 tests)
- `web/skillScope.test.ts` (16 行, 2 tests)
- `web/steerStaleTurn.test.ts` (32 行, 3 tests)
- `web/storageNamespace.test.ts` (25 行, 1 tests)
- `web/tabSwitchPerf.test.ts` (134 行, 5 tests)
- `web/taskNotifications.test.ts` (70 行, 3 tests)
- `web/taskPlan.test.ts` (164 行, 4 tests)
- `web/taskTabs.test.ts` (87 行, 9 tests)
- `web/terminalConsole.test.tsx` (279 行, 13 tests)
- `web/terminalPreferences.test.ts` (55 行, 4 tests)
- `web/theme.test.ts` (103 行, 10 tests)
- `web/threadCatalog.test.ts` (192 行, 15 tests)
- `web/threadHistoryService.test.ts` (275 行, 15 tests)
- `web/threadLoadQueue.test.ts` (34 行, 1 tests)
- `web/threadRuntimePermission.test.ts` (45 行, 3 tests)
- `web/threadRuntimeSelectionIsolation.test.ts` (330 行, 13 tests)
- `web/threadSelection.test.ts` (64 行, 3 tests)
- `web/threadWriterConflict.test.ts` (14 行, 2 tests)
- `web/topicRuntimeIndex.test.ts` (49 行, 4 tests)
- `web/topicTranscriptRuntime.test.ts` (111 行, 7 tests)
- `web/topicTranscriptStore.test.ts` (898 行, 41 tests)
- `web/topicUsageStore.test.ts` (269 行, 14 tests)
- `web/transcriptStreamScheduler.test.ts` (110 行, 4 tests)
- `web/turnInterruptRetry.test.ts` (148 行, 10 tests)
- `web/turnRetryState.test.ts` (97 行, 4 tests)
- `web/turnTimestampProvenance.test.ts` (73 行, 4 tests)
- `web/uiChatWaterfall.test.tsx` (446 行, 16 tests)
- `web/uiComposer.test.tsx` (117 行, 5 tests)
- `web/uiDialogsAndPanels.test.tsx` (102 行, 4 tests)
- `web/uiDialogsInteractive.test.tsx` (623 行, 14 tests)
- `web/uiEnhanceTools.test.ts` (86 行, 4 tests)
- `web/uiFreeSavingsPopover.test.tsx` (429 行, 11 tests)
- `web/uiHistorySidebar.test.tsx` (157 行, 4 tests)
- `web/uiRightWorkspace.test.tsx` (170 行, 4 tests)
- `web/uiSettingsDrawer.test.tsx` (656 行, 17 tests)
- `web/uiTopBarAndControls.test.tsx` (101 行, 5 tests)
- `web/usagePricing.test.ts` (65 行, 6 tests)
- `web/vendorLogo.test.ts` (14 行, 1 tests)
- `web/waterfallPerf.test.ts` (225 行, 4 tests)
- `web/waterfallRowRefreshQueue.test.ts` (48 行, 2 tests)
- `web/websocketHeartbeat.test.ts` (33 行, 4 tests)
- `web/websocketReconnect.test.ts` (197 行, 7 tests)
- `web/workbenchAppAuthAndStartup.test.tsx` (81 行, 5 tests)
- `web/workbenchBehavior.test.ts` (124 行, 8 tests)
- `web/workbenchComposerContract.test.ts` (129 行, 5 tests)
- `web/workbenchDialogsAndSettings.test.ts` (81 行, 7 tests)
- `web/workbenchSendLifecycle.test.ts` (163 行, 10 tests)
- `web/workbenchSnapshotStatus.test.ts` (36 行, 4 tests)
- `web/workbenchSubscriptionLifecycle.test.ts` (78 行, 7 tests)
- `web/workbenchTimeline.test.ts` (1239 行, 69 tests)
- `web/workbenchWorkspaceContract.test.ts` (75 行, 6 tests)
- `web/workspacePaths.test.ts` (48 行, 5 tests)
- `web/workspaceSelectionVisibility.test.ts` (21 行, 2 tests)

## 5. (iii) 登记清单（70 文件，产品面阻塞）

reason 中 `fn@file=SKELETON(...)` 为函数体精化证据；标 * 者阻塞点为存储族 6 文件，AC 集成（49d5bb0）后解冻。

- `server/agentReadiness.test.ts` (60 行, 6 tests) — product fn skeleton: diagnoseAgentReadiness@agentReadiness.sla=SKELETON(empty)
- `server/authSessionRenewal.test.ts` (88 行, 2 tests) * — product skeleton/blocked: apps/server/src/authStore.sla
- `server/claudeSkillInventory.test.ts` (111 行, 4 tests) — product .sla missing: backends/claude/src/runtime/claudeSkillInventory
- `server/cliVersions.test.ts` (467 行, 25 tests) — product fn skeleton: buildCliKindStatus@cliVersions.sla=SKELETON(empty); compareVersions@cliVersions.sla=SKELETON(preset-return); enumerateCliCandidates@cliVersions.sla=SKELETON(preset-return); installationMatchesKind@cliVersions.sla=SKELETON(preset-return)
- `server/codeCliBridgeIsolation.test.ts` (968 行, 27 tests) — product fn skeleton: codeCliNeedsManagedConfigDir@codeCliBridge.sla=SKELETON(preset-return); codeCliNeedsRunningProcess@codeCliBridge.sla=SKELETON(preset-return)
- `server/codexCliUpdate.test.ts` (25 行, 3 tests) — product skeleton/blocked: apps/server/src/codexCliUpdate.sla
- `server/codexCommand.test.ts` (155 行, 14 tests) — product fn skeleton: codexAppServerArgs@codexCommand.sla=SKELETON(preset-return); findBundledCodexAppServerBinary@codexCommand.sla=SKELETON(preset-return); findChatGptBundledCodexBinary@codexCommand.sla=SKELETON(preset-return); findCodexBinary@codexCommand.sla=SKELETON(preset-return)
- `server/codexConfigHealth.test.ts` (41 行, 1 tests) — product fn skeleton: ensureCodexConfigHealthy@codexConfigHealth.sla=SKELETON(empty)
- `server/codexModeApi.test.ts` (33 行, 3 tests) — product fn skeleton: goalContinuationTurnParams@codexModeApi.sla=SKELETON(preset-return); planAnswers@codexModeApi.sla=SKELETON(empty); planTurnParams@codexModeApi.sla=SKELETON(preset-return); runningTurnIds@codexModeApi.sla=SKELETON(empty)
- `server/codexModelCatalog.test.ts` (144 行, 7 tests) — product fn skeleton: buildCodexModelCatalog@codexModelCatalog.sla=SKELETON(empty); writeCodexModelCatalog@codexModelCatalog.sla=SKELETON(preset-return)
- `server/codexRuntimeEnv.test.ts` (55 行, 4 tests) — product fn skeleton: codexPlatformRuntimeEnv@codexRuntimeEnv.sla=SKELETON(empty)
- `server/codexStreamRetryMonitor.test.ts` (67 行, 4 tests) — product fn skeleton: isBenignCodexStderr@codexStreamRetryMonitor.sla=SKELETON(preset-return); parseCodexStderrLine@codexStreamRetryMonitor.sla=SKELETON(empty)
- `server/commandBlacklist.test.ts` (267 行, 14 tests) * — product skeleton/blocked: apps/server/src/providerStore.sla
- `server/cursorDesktopInjection.test.ts` (100 行, 7 tests) — product fn skeleton: resolveCursorInstallDir@cursorDesktopInjection.sla=SKELETON(preset-return); writeCursorRelayLauncher@cursorDesktopInjection.sla=SKELETON(preset-return)
- `server/daemonCodexBridge.test.ts` (22 行, 2 tests) — product .sla missing: backends/codex/src/runtime/virtualCodexConfig.ts
- `server/dynamicToolProtocol.test.ts` (23 行, 3 tests) — product fn skeleton: parseDynamicToolArguments@dynamicToolProtocol.sla=SKELETON(self-assign)
- `server/forwardApi.test.ts` (620 行, 26 tests) — product skeleton/blocked: apps/server/src/forwardApi.sla
- `server/forwardModel.test.ts` (127 行, 10 tests) — product fn skeleton: buildForwardModelIds@forwardModel.sla=SKELETON(empty); formatForwardModelId@forwardModel.sla=SKELETON(empty); parseForwardModelId@forwardModel.sla=SKELETON(empty); splitForwardModelPositional@forwardModel.sla=SKELETON(empty)
- `server/forwardTurn.test.ts` (114 行, 7 tests) — product fn skeleton: extractForwardItemText@forwardTurn.sla=SKELETON(preset-return); extractLastAssistantText@forwardTurn.sla=SKELETON(preset-return); runForwardTurn@forwardTurn.sla=SKELETON(preset-return)
- `server/freeModelAccess.test.ts` (50 行, 3 tests) — product skeleton/blocked: apps/server/src/freeModelAccess.sla
- `server/gatewayQuota.test.ts` (60 行, 3 tests) * — product skeleton/blocked: apps/server/src/providerStore.sla
- `server/globalCodexEnvironment.test.ts` (31 行, 2 tests) — product fn skeleton: setGlobalCodexEnvironment@globalCodexEnvironment.sla=SKELETON(preset-return)
- `server/imageProtocols.test.ts` (134 行, 4 tests) * — product skeleton/blocked: apps/server/src/imageProtocols.sla
- `server/legacyImageViewHistory.test.ts` (37 行, 3 tests) — product fn skeleton: restoreLegacyImageViews@legacyImageViewHistory.sla=SKELETON(preset-return)
- `server/miniNoCallNudge.test.ts` (30 行, 3 tests) — product fn skeleton: miniSummaryRequestSignal@miniBridge.sla=MISSING
- `server/miniPromptCache.test.ts` (93 行, 1 tests) — product fn skeleton: resolveRelayGatewayTarget@relayRuntimeSelection.sla=SKELETON(empty)
- `server/museCompatibleTurnProjector.test.ts` (732 行, 30 tests) — product skeleton/blocked: apps/server/src/saVmBundle.sla
- `server/opencodeSaVmMcp.test.ts` (367 行, 29 tests) — product skeleton/blocked: apps/server/src/saVmBundle.sla
- `server/performanceReport.test.ts` (81 行, 2 tests) — product fn skeleton: sanitizeLowFpsPerformanceReport@performanceReport.sla=SKELETON(empty)
- `server/piBridge.test.ts` (333 行, 10 tests) — product fn skeleton: createPiProjectorContext@piTurnProjector.sla=MISSING
- `server/piLaunchInstall.test.ts` (45 行, 4 tests) — product skeleton/blocked: apps/server/src/launchInstall.sla
- `server/piRpcProcessManager.test.ts` (135 行, 7 tests) — product fn skeleton: defaultPiCliPath@piRpcProcessManager.sla=MISSING; defaultPiRelayExtensionDir@piRpcProcessManager.sla=MISSING; defaultPiSessionDir@piRpcProcessManager.sla=MISSING; defaultPiSourceDir@piRpcProcessManager.sla=MISSING
- `server/piRpcProtocol.test.ts` (111 行, 13 tests) — product fn skeleton: formatPiExtensionUIResponse@piRpcProtocol.sla=MISSING; formatPiRpcCommand@piRpcProtocol.sla=MISSING; parsePiRpcLine@piRpcProtocol.sla=MISSING; sanitizePiRpcText@piRpcProtocol.sla=MISSING
- `server/piTurnProjector.test.ts` (541 行, 10 tests) — product fn skeleton: createPiProjectorContext@piTurnProjector.sla=MISSING; projectPiMessage@piTurnProjector.sla=MISSING; toPiNotification@piTurnProjector.sla=MISSING; forceTerminatePi@piTurnProjector.sla=MISSING
- `server/pluginInstallStore.test.ts` (80 行, 6 tests) — product fn skeleton: loadInstalledPluginIds@pluginInstallStore.sla=SKELETON(empty); pluginInstallStorePath@pluginInstallStore.sla=SKELETON(empty); saveInstalledPluginIds@pluginInstallStore.sla=SKELETON(empty); allPluginManifests@pluginHost.sla=SKELETON(empty)
- `server/projectDiscussion.test.ts` (131 行, 10 tests) — product fn skeleton: buildProjectDiscussionPlan@projectDiscussion.sla=SKELETON(empty); isForbiddenProjectModel@projectDiscussion.sla=SKELETON(preset-return); isTransientProjectTurnReadError@projectDiscussion.sla=SKELETON(preset-return); isUnsupportedProjectTurnListError@projectDiscussion.sla=SKELETON(preset-return)
- `server/providerModels.test.ts` (223 行, 10 tests) * — product skeleton/blocked: apps/server/src/providerModels.sla
- `server/providerRoutingIsolation.test.ts` (227 行, 6 tests) — product .sla missing: backends/codex/src/runtime/virtualCodexConfig.ts
- `server/providerStore.test.ts` (895 行, 24 tests) * — product skeleton/blocked: apps/server/src/providerStore.sla
- `server/regressionRunner.test.ts` (92 行, 7 tests) — product skeleton/blocked: apps/server/src/regressionRunner.sla
- `server/relayCatalog.test.ts` (263 行, 9 tests) * — product skeleton/blocked: apps/server/src/providerStore.sla
- `server/relayDirectory.test.ts` (96 行, 3 tests) — product fn skeleton: createRelayDirectory@relayDirectory.sla=SKELETON(empty); findRelayDirectoryProvider@relayDirectory.sla=SKELETON(empty)
- `server/relayRuntimeSelection.test.ts` (70 行, 5 tests) — product fn skeleton: resolveRelayGatewayTarget@relayRuntimeSelection.sla=SKELETON(empty); resolveRelayRuntimeOwnerId@relayRuntimeSelection.sla=SKELETON(empty)
- `server/relaySettings.test.ts` (191 行, 9 tests) — product fn skeleton: buildRelaySettingsProvider@relaySettings.sla=SKELETON(preset-return); relaySettingsListItem@relaySettings.sla=SKELETON(empty); relaySettingsView@relaySettings.sla=SKELETON(empty); selectFetchedRelayModels@relaySettings.sla=SKELETON(preset-return)
- `server/remoteBunNodeClaude.test.ts` (94 行, 10 tests) — product fn skeleton: remoteClaudeProbeFragment@sshCodeCliBridge.sla=SKELETON(empty); remoteClaudeProbeScript@sshCodeCliBridge.sla=SKELETON(empty); planRemoteClaudeInstall@remoteBunNode.sla=SKELETON(preset-return); remoteBunNodeProbeScript@remoteBunNode.sla=SKELETON(empty)
- `server/remoteBunServerRequests.test.ts` (213 行, 13 tests) — product fn skeleton: buildRemoteBunNodeEnv@remoteBunNode.sla=SKELETON(empty); isAllowedRemoteBunNodePath@remoteBunNode.sla=SKELETON(preset-return); syncRelayToRemoteEndpoint@remoteBunNode.sla=SKELETON(preset-return)
- `server/remoteThreadLifecycle.test.ts` (49 行, 3 tests) — product fn skeleton: transitionRemoteThreadLifecycle@remoteThreadLifecycle.sla=SKELETON(preset-return)
- `server/requestUsageAnalytics.test.ts` (191 行, 8 tests) — product fn skeleton: parseAnalyticsRange@requestUsageStore.sla=SKELETON(empty)
- `server/requestUsageStore.test.ts` (65 行, 2 tests) * — product skeleton/blocked: apps/server/src/authStore.sla
- `server/rightPanelCrossPlatform.test.ts` (85 行, 7 tests) — product fn skeleton: handleWorkspaceGitRpc@gitWorkspace.sla=SKELETON(preset-return); resolveRepoPath@gitWorkspace.sla=SKELETON(preset-return); chunkTerminalInput@terminalPty.sla=SKELETON(preset-return); defaultShell@terminalPty.sla=SKELETON(preset-return)
- `server/rpcErrorContext.test.ts` (55 行, 7 tests) — product fn skeleton: detailedRpcError@rpcErrorContext.sla=SKELETON(empty)
- `server/runtimeServer.test.ts` (100 行, 2 tests) — product fn skeleton: writeNodeResponse@server.sla=SKELETON(preset-return)
- `server/saVmAccountabilityLedger.test.ts` (391 行, 6 tests) * — product skeleton/blocked: apps/server/src/saVmAccountabilityLedger.sla
- `server/saVmApplyPatch.test.ts` (80 行, 11 tests) — product fn skeleton: parseAndCheckSaVmPatch@saVmApplyPatch.sla=SKELETON(empty)
- `server/saVmBundle.test.ts` (53 行, 4 tests) — product skeleton/blocked: apps/server/src/saVmBundle.sla
- `server/saVmMcpRegistration.test.ts` (88 行, 8 tests) — product skeleton/blocked: apps/server/src/saVmBundle.sla
- `server/saVmProjectBootstrap.test.ts` (138 行, 6 tests) — product skeleton/blocked: apps/server/src/saVmBundle.sla
- `server/saVmRequest.test.ts` (64 行, 7 tests) — product fn skeleton: validateSaVmRequestBody@saVmRequest.sla=SKELETON(empty)
- `server/sshCodeCliBridge.test.ts` (334 行, 27 tests) — product fn skeleton: buildRemoteClaudeCommand@sshCodeCliBridge.sla=SKELETON(empty); ensureRemoteClaudeCli@sshCodeCliBridge.sla=SKELETON(preset-return); forgetRemoteClaudeTarget@sshCodeCliBridge.sla=SKELETON(empty); forwardedRemoteEnv@sshCodeCliBridge.sla=SKELETON(empty)
- `server/sshHostDiscovery.test.ts` (41 行, 2 tests) — product fn skeleton: discoverSshConfigHosts@sshHostDiscovery.sla=SKELETON(preset-return); probeSshConfigHost@sshHostDiscovery.sla=SKELETON(preset-return)
- `server/sshSystemMetrics.test.ts` (19 行, 1 tests) — product fn skeleton: metricsFromValues@sshSystemMetrics.sla=SKELETON(empty); parseSshMetricsOutput@sshSystemMetrics.sla=SKELETON(empty)
- `server/staticAssetContentType.test.ts` (13 行, 2 tests) — product fn skeleton: staticAssetContentType@staticAssetContentType.sla=SKELETON(empty)
- `server/taskLiveness.test.ts` (115 行, 10 tests) — product fn skeleton: descendantsOf@taskLiveness.sla=SKELETON(empty); hasExtraDescendantProcesses@taskLiveness.sla=SKELETON(preset-return); parseWindowsProcesses@taskLiveness.sla=SKELETON(empty)
- `server/threadHistoryTail.test.ts` (46 行, 3 tests) — product fn skeleton: projectTailRecords@threadHistoryTail.sla=SKELETON(preset-return); readThreadHistoryTail@threadHistoryTail.sla=SKELETON(preset-return)
- `server/threadStartCompatibility.test.ts` (209 行, 9 tests) — product fn skeleton: isAgentLoopDiedBeforeTurnStart@threadStartCompatibility.sla=SKELETON(preset-return); isPaginatedThreadHistoryUnsupported@threadStartCompatibility.sla=SKELETON(preset-return); isThreadMissingBeforeTurnStart@threadStartCompatibility.sla=SKELETON(preset-return); requestWithLocalAgentLoopRecovery@threadStartCompatibility.sla=SKELETON(preset-return)
- `server/virtualCodexConfig.test.ts` (512 行, 19 tests) — product .sla missing: backends/codex/src/runtime/virtualCodexConfig.ts
- `server/webdevProbe.test.ts` (19 行, 3 tests) — product fn skeleton: normalizeLocalPreviewTarget@webdevProbe.sla=SKELETON(preset-return)
- `server/webdevServers.test.ts` (60 行, 2 tests) — product fn skeleton: listWebDevServers@webdevServers.sla=SKELETON(empty); startWebDevServer@webdevServers.sla=SKELETON(preset-return); stopWebDevServer@webdevServers.sla=SKELETON(preset-return)
- `server/workspaceAgents.test.ts` (39 行, 4 tests) — product fn skeleton: mergeWorkspaceAgentsContent@workspaceAgents.sla=SKELETON(empty)
- `server/workspaceRoots.test.ts` (43 行, 3 tests) — product fn skeleton: localWorkspaceInfo@workspaceRoots.sla=SKELETON(empty)

## 6. (i) 未转前沿（194 文件）与转换口径教训

本波已转 5 个 (i) 文件（§3.1/3.2/3.3/3.5/3.6）；余 194 个如下（按行数升序即建议续转顺序）。其中 32 个「部分骨架」文件在 reason 列标注——其桩函数对应的断言预期 FAIL 并逐条落名，真实函数对应的断言应绿。

- `server/claudeCompatibleCliFlag.test.ts` (19 行, 3 tests → index.sla)
- `server/codexApiRuntime.test.ts` (27 行, 2 tests → codexApiRuntime.sla)
- `server/remoteThreadRouteStore.test.ts` (33 行, 1 tests → remoteThreadRouteStore.sla, database.sla)
- `server/gitWorkspaceVm.test.ts` (35 行, 1 tests → gitWorkspace.sla, saVmPolicy.sla) — partial product skeleton: handleWorkspaceGitRpc=SKELETON(preset-return)
- `shared/agentRoster.test.ts` (38 行, 5 tests → index.sla)
- `server/effectiveGroupBaseUrl.test.ts` (39 行, 4 tests → omniRouteFree.sla, relayProtocolGateway.sla)
- `server/miniBridgeFs.test.ts` (43 行, 2 tests → miniBridge.sla)
- `server/sshWorkspaceStore.test.ts` (44 行, 3 tests → sshWorkspaceStore.sla)
- `server/threadAgentRosterStore.test.ts` (46 行, 3 tests → threadAgentRosterStore.sla)
- `server/miniServerHooks.test.ts` (48 行, 2 tests → miniServerHooks.sla) — partial product skeleton: runWithServerMcpHooks=SKELETON(preset-return)
- `server/sharedThreadBridgeRegistry.test.ts` (50 行, 3 tests → sharedThreadBridgeRegistry.sla)
- `server/userPreferencesStore.test.ts` (50 行, 1 tests → userPreferencesStore.sla)
- `server/museHistoryProjection.test.ts` (51 行, 2 tests → museHistoryProjection.sla) — partial product skeleton: readNativeMusePreview=SKELETON(preset-return)
- `server/miniTurnCompletion.test.ts` (53 行, 7 tests → miniBridge.sla)
- `server/auggieTurnSilence.test.ts` (54 行, 5 tests → auggieAgentBridge.sla)
- `server/miniDeepkeyChannel.test.ts` (55 行, 3 tests → miniBridge.sla)
- `server/miniHistoryContinue.test.ts` (55 行, 2 tests → miniBridge.sla)
- `server/opencodeHistoryContinue.test.ts` (55 行, 2 tests → opencodeBridge.sla)
- `server/miniSecondTurnAnchoring.test.ts` (58 行, 3 tests → miniBridge.sla)
- `server/freeOllama.test.ts` (59 行, 3 tests → freeOllama.sla)
- `server/relayRetryAbort.test.ts` (59 行, 1 tests → relayProtocolGateway.sla)
- `server/opencodeReview.test.ts` (60 行, 5 tests → opencodeReview.sla)
- `server/sshRemoteThreadStart.test.ts` (61 行, 8 tests → )
- `server/miniCapabilities.test.ts` (62 行, 2 tests → miniBridge.sla, miniCapabilities.sla)
- `server/saVmPagination.test.ts` (62 行, 5 tests → saVmTool.sla) — partial product skeleton: paginateItems=MISSING
- `server/grokCompatibleProbe.test.ts` (63 行, 4 tests → grokCompatibleProbe.sla) — partial product skeleton: isGrokLoggedIn=SKELETON(preset-return)
- `server/miniResponsesChainAmnesia.test.ts` (64 行, 2 tests → miniBridge.sla)
- `server/opencodeCompatibleProcessManager.test.ts` (64 行, 6 tests → opencodeCompatibleProcessManager.sla)
- `server/bridgeEventLog.test.ts` (65 行, 4 tests → bridgeEventLog.sla)
- `server/jevOpenAiBridge.test.ts` (66 行, 5 tests → jevOpenAiBridge.sla)
- `server/securityStoreCaptcha.test.ts` (67 行, 1 tests → securityStore.sla)
- `server/imagePersistence.test.ts` (69 行, 4 tests → imagePersistence.sla)
- `server/saVmMcpAuthSkip.test.ts` (69 行, 2 tests → )
- `server/miniTurnTimestamps.test.ts` (71 行, 1 tests → miniBridge.sla)
- `server/saVmTokenSavingM2.test.ts` (71 行, 5 tests → saVmTool.sla)
- `server/threadRpcRouting.test.ts` (71 行, 6 tests → threadRpcRouting.sla) — partial product skeleton: isRemoteThreadHistoryMethod=SKELETON(preset-return)
- `server/miniAgentInboxProgress.test.ts` (72 行, 6 tests → miniBridge.sla)
- `server/opencodeCompatibleProtocol.test.ts` (72 行, 5 tests → opencodeCompatibleProtocol.sla)
- `server/runtimeDatabaseNode.test.ts` (72 行, 3 tests → database.sla)
- `server/saVmGitDiffContext.test.ts` (72 行, 3 tests → saVmTool.sla)
- `server/jevProgress.test.ts` (73 行, 6 tests → saVmTool.sla, saVmWorkspaceSkill.sla)
- `server/miniReview.test.ts` (76 行, 9 tests → miniBridge.sla)
- `server/agyRawCapture.test.ts` (77 行, 7 tests → agyRawCapture.sla)
- `server/cliSpawn.test.ts` (77 行, 6 tests → cliSpawn.sla)
- `server/requestUsageTokenStats.test.ts` (77 行, 4 tests → requestUsageStore.sla, tokenUsage.sla) — partial product skeleton: extractRingTokenUsage=SKELETON(empty); nextDirectUsageRequestId=SKELETON(empty)
- `server/grokSessionStore.test.ts` (78 行, 3 tests → localDatabase.sla, grokSessionStore.sla)
- `server/opencodeRealCli.verify.test.ts` (80 行, 2 tests → opencodeCompatibleProcessManager.sla, opencodeCompatibleRuntime.sla)
- `server/sshCodexBridge.test.ts` (80 行, 3 tests → sshCodexBridge.sla)
- `server/historyRestoreIdentity.test.ts` (81 行, 5 tests → codexBridge.sla, miniBridge.sla)
- `server/miniSameFileGuard.test.ts` (81 行, 6 tests → miniTurnSafety.sla)
- `server/saVmComplexCommand.test.ts` (82 行, 5 tests → saVmTool.sla, saVmInterception.sla)
- `server/miniAnthropicThinking.test.ts` (83 行, 6 tests → miniBridge.sla)
- `server/piSessionStore.test.ts` (85 行, 4 tests → database.sla, piSessionStore.sla)
- `server/miniOrphanRestore.e2e.test.ts` (87 行, 1 tests → miniBridge.sla, miniFileHistory.sla)
- `server/codeCliBridgeStartupStages.test.ts` (88 行, 2 tests → codeCliBridge.sla)
- `server/pluginDependencyDirection.test.ts` (88 行, 4 tests → )
- `server/terminalPtyBunInput.test.ts` (89 行, 3 tests → terminalPty.sla) — partial product skeleton: createTerminalPty=SKELETON(preset-return); forgetTerminalPty=SKELETON(preset-return); listTerminalPtys=SKELETON(preset-return)
- `server/codeCliBridgeRelayHeader.test.ts` (90 行, 2 tests → codeCliBridge.sla)
- `server/miniAdaptiveThinking.test.ts` (90 行, 4 tests → miniBridge.sla)
- `server/saVmSplitWorkflow.test.ts` (90 行, 2 tests → saVmTool.sla, index.sla)
- `server/agySettingsGuard.test.ts` (91 行, 6 tests → agySettingsGuard.sla)
- `server/relayUpstreamTimeout.test.ts` (93 行, 4 tests → relayProtocolGateway.sla)
- `server/auggieImageLimits.test.ts` (95 行, 11 tests → auggieAgentBridge.sla)
- `server/agySessionStore.test.ts` (97 行, 5 tests → localDatabase.sla, agySessionStore.sla)
- `server/miniCodexStandalone.test.ts` (98 行, 6 tests → loop.sla, responses.sla)
- `server/agyCompatibleProbe.test.ts` (100 行, 6 tests → agyCompatibleProbe.sla)
- `server/threadWriterLeaseStore.test.ts` (106 行, 5 tests → database.sla, threadWriterLeaseStore.sla)
- `server/miniWriteIntent.test.ts` (107 行, 33 tests → goalContinuation.sla, miniBridge.sla)
- `server/opencodeV2.test.ts` (108 行, 11 tests → opencodeCompatibleProbe.sla, opencodeCompatibleProcessManager.sla)
- `server/agyRelayIsolation.test.ts` (109 行, 3 tests → agyBridge.sla, agyCompatibleProbe.sla)
- `server/opencodeCompatibleProbe.test.ts` (109 行, 7 tests → opencodeCompatibleProbe.sla)
- `server/saVmPiExtension.test.ts` (111 行, 3 tests → )
- `server/jevCompressHardening.test.ts` (115 行, 8 tests → saVmTool.sla, saVmWorkspaceSkill.sla)
- `server/cliPluginFallback.test.ts` (116 行, 6 tests → )
- `server/miniBudgetExcuse.test.ts` (117 行, 36 tests → miniBridge.sla)
- `server/imageHistoryStore.test.ts` (118 行, 5 tests → imageHistoryStore.sla)
- `server/saVmSlaTrackSnippets.test.ts` (118 行, 1 tests → saVmWorkspaceSkill.sla)
- `server/duck2apiEmbed.test.ts` (120 行, 9 tests → convert.sla, server.sla) — partial product skeleton: createApp=MISSING; apiRequestSchema=MISSING; listModels=MISSING
- `server/miniStuckTurnRecovery.test.ts` (121 行, 7 tests → miniBridge.sla, miniFileHistory.sla)
- `server/miniClaudeMessagesGateway.test.ts` (124 行, 4 tests → miniBridge.sla, relayProtocolGateway.sla)
- `server/terminalPtyScriptBackend.test.ts` (124 行, 0 tests → terminalPty.sla) — partial product skeleton: createTerminalPty=SKELETON(preset-return); forgetTerminalPty=SKELETON(preset-return); killTerminalPty=SKELETON(preset-return)
- `server/miniTaskIntent.test.ts` (130 行, 10 tests → miniBridge.sla, miniTaskIntent.sla) — partial product skeleton: miniHasDevelopmentContext=SKELETON(preset-return); miniIsAnalysisOnlyPrompt=SKELETON(preset-return); miniPlanStallCorrection=SKELETON(preset-return)
- `server/opencodeImageParts.test.ts` (132 行, 7 tests → opencodeBridge.sla, opencodeCompatibleRuntime.sla)
- `server/saVmRegressionTools.test.ts` (133 行, 5 tests → saVmTool.sla, saVmJev.sla)
- `server/saVmParallelInput.test.ts` (134 行, 12 tests → saVmRequest.sla, saVmTool.sla) — partial product skeleton: normalizeSaVmParallelTasks=SKELETON(empty); validateSaVmRequestBody=SKELETON(empty)
- `server/miniSubagentsOwnerHttp.test.ts` (135 行, 2 tests → miniBridge.sla)
- `server/miniModelHistory.test.ts` (137 行, 10 tests → miniModelHistory.sla)
- `server/miniSingleFinalAnswer.test.ts` (139 行, 4 tests → miniBridge.sla)
- `server/agyGeminiResponse.test.ts` (142 行, 6 tests → agyCompatibleProxy.sla, agyGeminiResponse.sla)
- `server/compactionRelayRequest.test.ts` (143 行, 9 tests → compactionRelayRequest.sla)
- `server/miniCodexReviewFork.test.ts` (143 行, 9 tests → loop.sla, review.sla)
- `server/claudeSessionStore.test.ts` (147 行, 11 tests → localDatabase.sla, claudeSessionStore.sla)
- `server/miniToolCallDedup.test.ts` (147 行, 11 tests → miniBridge.sla, responses.sla)
- `server/miniUnitGaps.test.ts` (147 行, 11 tests → database.sla, miniBridge.sla)
- `server/claudeCompatibleProcessManager.test.ts` (148 行, 4 tests → claudeCompatibleProcessManager.sla)
- `server/claudeCompatibleRuntime.test.ts` (148 行, 6 tests → localDatabase.sla, claudeCompatibleRuntime.sla)
- `server/saVmToolMasking.test.ts` (150 行, 7 tests → workbenchControlApi.sla, compactionRelayRequest.sla) — partial product skeleton: rewriteRelayRequestToolsForSaVm=SKELETON(preset-return)
- `server/saVmToolTail.test.ts` (151 行, 4 tests → saVmTool.sla)
- `server/opencodeQuestion.test.ts` (155 行, 7 tests → opencodeBridge.sla, opencodeCompatibleRuntime.sla)
- `server/miniNoRollbackSteer.test.ts` (156 行, 3 tests → miniBridge.sla)
- `server/claudePermissionRegistry.test.ts` (157 行, 13 tests → claudePermissionRegistry.sla)
- `server/clineChildSession.test.ts` (159 行, 6 tests → clineChildSession.sla)
- `server/quotaAndFailover.test.ts` (159 行, 6 tests → freebuffSession.sla, omniRouteFree.sla) — partial product skeleton: findBestFreebuffFallback=SKELETON(preset-return)
- `server/miniSandbox.test.ts` (160 行, 5 tests → miniBridge.sla, miniFileHistory.sla)
- `server/claudeCompatiblePermission.test.ts` (163 行, 5 tests → codeCliBridge.sla, localDatabase.sla)
- `server/opencodeSessionStore.test.ts` (163 行, 8 tests → database.sla, opencodeSessionStore.sla)
- `server/commandCodeBridge.test.ts` (164 行, 7 tests → commandCodeAgentBridge.sla, commandCodeCommand.sla)
- `server/saVmSafeDelete.test.ts` (170 行, 7 tests → saVmTool.sla, index.sla)
- `server/saVmSlaTrackM3.test.ts` (171 行, 0 tests → saVmTool.sla)
- `server/websocketRuntime.test.ts` (171 行, 8 tests → websocketRuntime.sla) — partial product skeleton: isWebSocketOriginAllowed=SKELETON(preset-return); resolveWebSocketRuntimeConfig=SKELETON(preset-return); trustedLocalDesktopAuthEnabled=SKELETON(preset-return)
- `server/codeCliBridgeResume.test.ts` (181 行, 5 tests → codeCliBridge.sla, claudeCompatibleProbe.sla)
- `server/claudeDesktopInjection.test.ts` (182 行, 13 tests → claudeDesktopInjection.sla)
- `server/miniForkPlan.test.ts` (185 行, 7 tests → miniBridge.sla)
- `server/saVmWorkspaceDiagnostics.test.ts` (185 行, 10 tests → saVmTool.sla, index.sla)
- `server/miniGitLogAndHostRecovery.test.ts` (192 行, 12 tests → miniBridge.sla, miniTaskIntent.sla)
- `server/miniGatewayCache.test.ts` (194 行, 5 tests → omniRouteFree.sla, relayProtocolGateway.sla)
- `server/miniCacheUsage.test.ts` (195 行, 9 tests → miniBridge.sla)
- `server/saVmGuardToggleSync.test.ts` (195 行, 4 tests → saVmWorkspaceSkill.sla)
- `server/saVmBunTsTrackSkill.test.ts` (199 行, 10 tests → saVmWorkspaceSkill.sla)
- `server/miniApproval.test.ts` (203 行, 14 tests → miniBridge.sla)
- `server/saVmTokenSavingM1.test.ts` (204 行, 18 tests → saVmTool.sla)
- `server/claudeTurnInput.test.ts` (206 行, 18 tests → claudeTurnInput.sla)
- `server/miniHistoryRolling.test.ts` (207 行, 16 tests → goalContinuation.sla, miniBridge.sla)
- `server/miniParallelFanout.test.ts` (209 行, 2 tests → miniBridge.sla)
- `server/miniPureChat.test.ts` (209 行, 5 tests → miniBridge.sla)
- `server/miniPromptCachePrefix.test.ts` (211 行, 5 tests → saVmTool.sla, miniBridge.sla)
- `server/miniRootCauseVerification.test.ts` (212 行, 19 tests → codexFallbackInstructions.sla, miniBridge.sla)
- `server/miniPlanAdvisoryCompletion.test.ts` (214 行, 12 tests → codexFallbackInstructions.sla, miniBridge.sla)
- `server/saVmSafeBunM2.test.ts` (214 行, 13 tests → saVmTool.sla, saVmWorkspaceSkill.sla)
- `server/codeCliBridgeTaskPlan.test.ts` (217 行, 3 tests → codeCliBridge.sla)
- `server/miniAgentsMd.test.ts` (217 行, 20 tests → agentsMdInventory.sla)
- `server/dataGarbageCleaner.test.ts` (220 行, 7 tests → dataGarbageCleaner.sla) — partial product skeleton: cleanDataGarbageSync=SKELETON(empty)
- `server/miniMcpResources.test.ts` (227 行, 6 tests → miniBridge.sla, miniMcp.sla)
- `server/opencodeLocalGateway.test.ts` (230 行, 9 tests → relayProtocolGateway.sla)
- `server/miniTurnFinishHooks.test.ts` (237 行, 6 tests → miniBridge.sla, miniServerHooks.sla) — partial product skeleton: fireMiniTurnFinishHook=SKELETON(preset-return)
- `server/miniExecArchive.test.ts` (240 行, 12 tests → miniBridge.sla, miniFileHistory.sla)
- `server/grokBridge.test.ts` (241 行, 7 tests → grokBridge.sla)
- `server/freebuffSessionOwnership.test.ts` (245 行, 8 tests → freebuffSession.sla) — partial product skeleton: getOrEnsureFreebuffSession=SKELETON(preset-return)
- `server/terminalPty.test.ts` (249 行, 8 tests → terminalPty.sla) — partial product skeleton: createTerminalPty=SKELETON(preset-return); detectScreenSeq=SKELETON(preset-return); forgetTerminalPty=SKELETON(preset-return)
- `server/cliHistorySelfHealingAndNoMiniFallback.test.ts` (259 行, 12 tests → agyBridge.sla, grokBridge.sla)
- `server/miniImageView.test.ts` (259 行, 14 tests → imageView.sla, miniBridge.sla) — partial product skeleton: isRemoteImageRef=SKELETON(preset-return); chooseMiniImageAnalysisProfile=SKELETON(preset-return)
- `server/miniTaskRecovery.test.ts` (259 行, 11 tests → miniBridge.sla)
- `server/saVmImplementations.test.ts` (260 行, 10 tests → saVmTool.sla, index.sla)
- `server/auggieRedirector.test.ts` (261 行, 7 tests → auggieRedirector.sla)
- `server/codexBridge.test.ts` (264 行, 11 tests → codexCommand.sla, codexBridge.sla) — partial product skeleton: spawnCodexCommand=SKELETON(preset-return); runtimeEnvMissingInProcessEnv=SKELETON(preset-return)
- `server/miniJevCompletion.test.ts` (270 行, 5 tests → saVmJev.sla, miniBridge.sla)
- `server/museCompatible.test.ts` (272 行, 20 tests → museBridge.sla, museCompatibleProbe.sla) — partial product skeleton: buildMuseSaVmSettingsDir=SKELETON(preset-return); isWithinDir=SKELETON(preset-return); resolveMuseScratchDirs=SKELETON(empty)
- `server/saVmP0.test.ts` (274 行, 6 tests → saVmTool.sla, index.sla)
- `server/miniImageUnsupported.test.ts` (276 行, 7 tests → miniBridge.sla)
- `server/clineToolCardReplay.test.ts` (277 行, 1 tests → codexClient.sla, ChatRow.sax) — partial product skeleton: activitySummary=MISSING
- `server/gatewayRequestStore.test.ts` (284 行, 15 tests → gatewayRequestStore.sla)
- `server/saVmPolicy.test.ts` (285 行, 21 tests → systemWebSearch.sla, saVmPolicy.sla)
- `server/workbenchControlApi.test.ts` (293 行, 16 tests → workbenchControlApi.sla) — partial product skeleton: isTransientThreadMetadataError=SKELETON(preset-return); isUnmaterializedThreadError=SKELETON(preset-return)
- `server/saVmSafeBunM3.test.ts` (296 行, 13 tests → saVmTool.sla, saVmPolicy.sla)
- `fixtures/claude-compatible/fixtures.ts` (300 行, 0 tests → claudeCompatibleProtocol.sla)
- `server/opencodeSharedPool.test.ts` (309 行, 12 tests → opencodeCompatibleProcessManager.sla, opencodeCompatibleRuntime.sla)
- `server/projectRoomStore.test.ts` (322 行, 7 tests → projectRoomStore.sla)
- `server/saVmSafeBunM1.test.ts` (326 行, 15 tests → saVmTool.sla, saVmPolicy.sla)
- `server/museSkillPreload.test.ts` (346 行, 16 tests → saVmWorkspaceSkill.sla, museBridge.sla) — partial product skeleton: resolveMuseScratchDirs=SKELETON(empty); buildMuseExecutionPrompt=SKELETON(empty)
- `server/saVmMcpServer.test.ts` (352 行, 4 tests → )
- `server/miniEchoGate.test.ts` (358 行, 21 tests → miniBridge.sla)
- `server/claudeCompatibleTurnProjector.test.ts` (373 行, 22 tests → claudeCompatibleProtocol.sla, claudeCompatibleTurnProjector.sla)
- `server/miniMcp.test.ts` (388 行, 18 tests → miniBridge.sla, miniMcp.sla) — partial product skeleton: qualifiedMcpToolName=SKELETON(preset-return); resolveMiniAgentHome=SKELETON(preset-return); setMiniMcpWorkspaceRoots=SKELETON(preset-return)
- `server/threadSubscriptionRegistry.test.ts` (406 行, 18 tests → threadSubscriptionRegistry.sla, threadWriterLeaseStore.sla)
- `server/enhanceToolsDecoupling.test.ts` (414 行, 8 tests → saVmWorkspaceSkill.sla, threadRuntimeMetadataStore.sla)
- `server/grokCompatibleProxy.test.ts` (433 行, 15 tests → grokCompatibleProxy.sla, omniRouteFree.sla)
- `server/saVmP0ToP2Roadmap.test.ts` (442 行, 13 tests → saVmTool.sla, miniBridge.sla) — partial product skeleton: resetRunHostCacheForTest=MISSING; saVmActiveSessions=MISSING
- `server/opencodeCompatibleRuntime.test.ts` (447 行, 10 tests → opencodeCompatibleRuntime.sla, opencodeCompatibleTurnProjector.sla)
- `server/miniTokenBudget.test.ts` (449 行, 43 tests → miniBridge.sla, miniTokenizer.sla)
- `server/saVmJevDispatch.test.ts` (454 行, 33 tests → saVmTool.sla, saVmJev.sla)
- `server/claudeCompatibleProbe.test.ts` (455 行, 41 tests → cliSelectionState.sla, cliVersions.sla) — partial product skeleton: setPreferredCliBinary=SKELETON(empty); storeLatestCliCache=SKELETON(empty); resetNpmPrefixProbeCacheForTests=SKELETON(empty)
- `server/miniFileHistory.test.ts` (456 行, 26 tests → miniBridge.sla, miniFileHistory.sla)
- `server/clineHubProtocol.test.ts` (457 行, 10 tests → clineAgentBridge.sla, clineCommand.sla)
- `server/saVmWorkspaceSkill.test.ts` (469 行, 17 tests → saVmWorkspaceSkill.sla)
- `server/threadRuntimeMetadataStore.test.ts` (471 行, 13 tests → threadRuntimeMetadataStore.sla, index.sla)
- `server/saVmRunHost.test.ts` (514 行, 30 tests → saVmTool.sla, saVmInterception.sla) — partial product skeleton: resetRunHostCacheForTest=MISSING; runHostProcessSpawnCount=MISSING; runHostCacheHitCount=MISSING
- `server/opencodeHistoryProjection.test.ts` (525 行, 19 tests → opencodeBridge.sla, opencodeHistoryProjection.sla) — partial product skeleton: isNativeOpencodeSessionId=SKELETON(preset-return)
- `server/grokCompatibleTurnProjector.test.ts` (554 行, 17 tests → grokCompatibleProtocol.sla, grokCompatibleTurnProjector.sla)
- `server/miniContext.test.ts` (556 行, 23 tests → miniBridge.sla)
- `server/saVmCodeGraph.test.ts` (572 行, 12 tests → saVmCodeGraph.sla, saVmPolicy.sla)
- `server/saVmInterception.test.ts` (591 行, 13 tests → saVmTool.sla, saVmInterception.sla)
- `server/opencodeBridge.test.ts` (643 行, 21 tests → opencodeBridge.sla, opencodeCompatibleProcessManager.sla)
- `server/agyBridge.test.ts` (712 行, 23 tests → agyBridge.sla, agyCompatibleRuntime.sla)
- `server/agyCompatibleTurnProjector.test.ts` (718 行, 32 tests → agyCompatibleProtocol.sla, agyCompatibleRuntime.sla)
- `server/miniGoal.test.ts` (740 行, 18 tests → miniBridge.sla)
- `server/miniRelayRetry.test.ts` (793 行, 33 tests → miniBridge.sla)
- `server/codeCliBridgeAgents.test.ts` (852 行, 16 tests → codeCliBridge.sla)
- `server/miniSubagents.test.ts` (863 行, 35 tests → miniBridge.sla)
- `server/omniRouteFree.test.ts` (1038 行, 56 tests → omniRouteFree.sla) — partial product skeleton: resolveLocalFreebuffCredentials=SKELETON(preset-return); generateOpenCodeUlid=MISSING; getOpenCodeProjectId=MISSING
- `server/miniProtocolFallback.test.ts` (1419 行, 60 tests → miniBridge.sla)
- `server/saVmJevActiveTools.test.ts` (1478 行, 53 tests → saVmTool.sla, saVmWorkspaceSkill.sla)
- `server/opencodeCompatibleTurnProjector.test.ts` (1521 行, 45 tests → opencodeCompatibleProcessManager.sla, opencodeCompatibleProtocol.sla)
- `server/saVmTool.test.ts` (2260 行, 82 tests → saVmTool.sla)
- `server/relayProtocolGateway.test.ts` (3270 行, 113 tests → freebuffSession.sla, omniRouteFree.sla)

点名登记（转换前已知阻塞点，避免续转时误判）：

- `shared/agentRoster.test.ts`（38 行 5 tests）：parseAgentRuntimeOverride 暂缓——J2 已登记的产品语义残余：解析结果中 role 的 (ptr,len) 字段指向**迭代局部 StrBuf**（index.sla 解析函数体内自注 DEFECT），返回后悬垂，断言字符串字段不可靠；另 fallbacks 的 (ptr,len) 切片 backing store 语义、healthyAgentMember 的 retryAt null 表示（f64 无 presence 旗）在产品面未定。normalizeAgentRoleFallbacks / normalizeAgentRoleWorkspace / classifyAgentFailure 三个面本身可转，续转时先行、parse 面待产品修复后补。
- `server/miniBridgeFs.test.ts`（43 行 2 tests）：集成形（MiniBridge request 分发 + 真实 fs + base64 + rejects 断言），依赖 AA 的宿主缝落点（fs 读/写经 MiniBridge_emit_* 接缝族的实际接线状态未在本波核），续转时先核接缝再转。
- `server/remoteThreadRouteStore.test.ts`（33 行）：SQLite 运行时数据库 + 类形态 store，可转但工作量在数据库接线（openRuntimeDatabase 的 SLA 落点），非纯函数批次。

转换口径教训（本波实测）：

1. StrList/数组槽位必须**整槽赋值**（`items[i] = StrRef {...}`），字段级赋值（`items[i].ptr = ...`）编译可过但不生效（workspacePermissions 首轮实测）。
2. 大数组结构体（262144 字节 JsonBuf/PageResult）字面量构造在 SAB 路径上极慢（gateway 闭包 sa test 450s 才陷阱），续转重闭包文件时先用空 @test 探针测闭包可跑性再写断言。
3. `sa check` 绿 ≠ `sa test` 可跑：SAB 直降与 SAB 校验是独立关口（thp、gateway 两案）。每个转换文件必须实跑并落 PASS/FAIL 名字集，只报 check 的不算交付。
4. TS 的 toMatchObject = 子集匹配：只断言列出的字段；toEqual = 全等：按产品载体（结构体/JsonBuf 文本）逐字段比。type-only 的测试（如 claudeCompatibleCliFlag 的类型断言）在 SLA 无运行时对应物——该文件另因 CLAUDE_COMPATIBLE_CLI_FLAG 在 index.sla 仅注释未物化而归 (iii)。

## 7. 自相矛盾与未下结论项

- 本波转换集内**未遇到**源头自相矛盾的断言（已知的一例在树内既有集 apps/duck2api/test/convert.test.ts，Y 线已登记，本波未重报）。
- 本波**未新增**任何「SLA 不支持某能力」的结论：全部阻塞要么是产品面状态（骨架/桩，逐函数证据在 §5），要么是编译器路径残余（PhiStateConflict / UnsupportedSabDirectFeature，探针在 _defects/probes/），要么是阶段划分（(ii) 归阶段 2，依据是目标形态 A 的前后端分工与 sala 就绪度审核「前端不具备」的既有定性，非本波新判）。
- fixtures/claude-compatible/fixtures.ts 归 (i) 前沿（夹具生成器，非断言套件），续转时可降优先级。

