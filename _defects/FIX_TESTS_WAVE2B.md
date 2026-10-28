# FIX_TESTS_WAVE2B — tests/ 第二波第二批（AH 续跑，Agent AH2）

- 基点：bulk-convert `66a50d1`；盒上 worktree `/content/bulk-tests2b`（detached，未推送、未建分支，集成归主会话）。
- 规范 env（每项门禁一致）：worktree 根 cwd、`PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:/opt/zig17:$PATH`、`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_SLA_FIXTURE_DIR=/content/sa_all/sa_plugin_sla/tests/import_fixtures/ SA_STD_DIR=/content/sa_all/sci/sa_std`；check `timeout 300`、test `timeout 900`，严格串行，全部 detached 落日志后回读。
- 范围：仅 `tests/**`、`_defects/probes/**`、本文件。已转换文件一字未改（只落盘、跑门禁、逐个检查点提交）。

## 1. 恢复与传输核对

AH 中期汇报保全的 11 个文件从本机 `~/workspace/t2b-backup/` 经 base64/stdin 管道传回盒上，逐个 sha256 与本机备份**逐字一致**（miniTurnCompletion `1b2c8968…`、miniDeepkeyChannel `2bcb2870…`、miniSecondTurnAnchoring `71d746a8…`、miniAnthropicThinking `eb9adc50…`、miniAgentInboxProgress `febb501e…`、miniSameFileGuard `1c1e100e…`、miniServerHooks `6bf2a54e…`、opencodeReview `6519e30b…`、effectiveGroupBaseUrl `85c76b98…`、agentRoster（tests/shared）`5e6d90e6…`、probe_mtc → `_defects/probes/t2b_mtc_probe.sla` `6e0eec14…`）。另按清单补写 effectiveGroupBaseUrl 的探针 `_defects/probes/t2b_egb_probe.sla`（§3.9）。

## 2. miniTurnCompletion 疑案裁定（探针 t2b_mtc_probe）

AH 留下两个互相矛盾的历史结果：(a) 一轮 1 passed / 6 failed、6 个多断言用例统一 trap code **57013**（该码在 miniBridge.sla 中 grep 无命中）；(b) 另一轮报第 61 行 `Undefined local variable: q8`（已证为被替换的草稿版产物，与现行 56 行文件无关）。

本批实测（现行文件、规范 env、清 `.sla-cache` 后）：

- 探针（2 个 @test：单次调用、三次调用）`sa test` 在约 593s 后以 **PhiStateConflict trap（trap_code 1015）** 终止，RC=1：寄存器 `sla__mb_free_doc__param_0_doc`，SAB line 656，路径 L_ELSE_EXIT_73 = Active vs L_MERGE_71 = Consumed。无任何 PROBE 输出存活。
- miniTurnCompletion.test.sla 本体：`sa check` **PASS**（3s）；`sa test` 以**同一 trap** 终止（同一寄存器、SAB line 648、RC=1、约 597s）。
- 根因定位：`miniDeclaresTurnComplete`（backends/mini/src/runtime/miniBridge.sla:5551）每次调用都走 `mb_parse(...)` → 末尾 `mb_free_doc(lines)`；`mb_free_doc`（miniBridge.sla:407）是一行函数 `if doc != 0 { sa_json_free(doc); }`——句柄只在条件分支内释放，SAB 合并点状态不一致（Consumed vs Active）即 PhiStateConflict。与 AF 登记的 anthropicBudgetEffort / `rpg_free_doc` trap 同族（编译器残余 6：条件分支内释放 ^ 句柄的 SAB 形态）。

**裁定**：(a) 的「57013 重复调用 trap」**不成立**（未复现 57013；trap 与调用次数无关，第一次到达 mb_free_doc 即触发，属产品 mb_free_doc 条件释放形态在 SAB 执行下的既有缺陷）；(b) 为草稿伪影，维持 AH 的自我否证。测试文件按 AF 先例原样交付（RUN 状态登记于此，未迁就、未改写）。

## 3. 逐文件门禁结果（失败名字集口径）

| # | 文件 | check | sa test | 失败名字集 / 归因 |
|---|------|-------|---------|-------------------|
| 1 | server/miniTurnCompletion.test.sla (7 @test) | PASS (3s) | **BLOCKED** RC=1 ~597s | PhiStateConflict `mb_free_doc`（§2）；用例无一跑完，非断言失败 |
| 2 | server/miniDeepkeyChannel.test.sla (3) | PASS (3s) | **无裁定** RC=124 | 900s 超时零输出（§7 环境注）；retest owed |
| 3 | server/miniSecondTurnAnchoring.test.sla (3) | PASS (2s) | **无裁定** RC=137 | ~411s 被 SIGKILL（多线并行盒内存争用），零输出；retest owed |
| 4 | server/miniAnthropicThinking.test.sla (6) | PASS (3s) | **无裁定** RC=124 | 900s 超时零输出；retest owed |
| 5 | server/miniAgentInboxProgress.test.sla (6) | PASS (2s) | **无裁定** RC=124 | 900s 超时零输出；retest owed |
| 6 | server/miniSameFileGuard.test.sla (6) | PASS (<1s) | **3 passed / 3 failed** (105s) | FAIL: `overlapping re-reads still trip after the limit` (panic 22)、`metadata probes do not count as thrash` (panic 34)、`refused-read outputs are not re-counted` (panic 41)。归因：产品 miniTurnSafety.sla 骨架——observeRound 循环体全注释恒报 null、isMiniSameFileReadAction 预设 `return false`、extractMiniReadFileKeys 预设 0（AA 已登记的 sibling 桩）；通过的 3 个是否定型断言（恒不触发与骨架的恒 null 一致，不构成产品正确性证据）。与 AH 预期同向，测试未迁就 |
| 7 | server/miniServerHooks.test.sla (转换 1/2) | PASS (<1s) | **0 passed / 1 failed** (1s) | FAIL: `auto-remember triage mirrors mini-codex keywords and ignores noise` (panic 53)——shouldAutoRememberServerToolResult 预设 `*out_is_null = true` 的预期暴露。TS 第 1 个用例（fires Pre/PostToolUse…）维持文件头登记的**不可转换**（runWithServerMcpHooks 的 invoke_id 面 + fireServerHook 空体），不在本表计数内 |
| 8 | server/opencodeReview.test.sla (5) | PASS (1s) | **1 passed / 4 failed** (32s) | PASS: `review prompt is read-only and uses opencode-native tools`。FAIL: `slash regex captures the target text` (panic 12)、`parseOpencodeReviewTarget mirrors mini grammar` (panic 23)、`review prompt renders branch/commit targets` (panic 61)、`formatOpencodeReviewSlash round-trips through the parser` (panic 72)。归因：产品 opencodeReview.sla 的 parse/format 函数体真失败（非骨架预设、非框架伪影）；其中 slash regex 一例走文件头登记的手工规则近似面。测试未迁就 |
| 9a | _defects/probes/t2b_egb_probe.sla（本批补写） | — | **无裁定** RC=124 | 900s 超时零输出、无 trap：AF 登记的 `rpg_free_doc` PhiStateConflict 在本轮负载下**未能复现也未证伪**（rpg_free_doc@relayProtocolGateway.sla:300 与 mb_free_doc 同形一行条件释放；测试文件自身助手 egb_base_url 也调用它） |
| 9 | server/effectiveGroupBaseUrl.test.sla (4) | PASS (<1s) | **无裁定** RC=124 | 900s 超时零输出；探针门未过（上行）；retest owed |
| 10 | shared/agentRoster.test.sla (5) | PASS (<1s) | **BLOCKED** RC=1 (8s) | PhiStateConflict：寄存器 `tmp_25401`，expected Composite / actual Uninitialized，路径 L_FOR_CONTINUE_239 vs L_FOR_HEAD_237（for 循环携带的复合寄存器状态不一致），SAB line 76217（packages/shared index 闭包）。与残余 6 同族但构造不同（循环携带型，非 *_free_doc 型）。文件头登记的 parse 面字符串字段断言暂缓维持原登记，值字段断言亦因 trap 未能运行 |

汇总：check **10/10 PASS**。sa test 有裁定 5 文件：真失败名字集 = miniSameFileGuard 3 + miniServerHooks 1 + opencodeReview 4 = **8 个用例失败**（全部产品侧归因）；trap BLOCKED 2 文件（miniTurnCompletion、agentRoster）；环境无裁定 5 文件（deepkey/anthropic/inbox/egb 超时、anchoring 被杀）+ egb 探针 1。

## 4. (i)→(iii) 重分类表（AH 侦察纠正 AF 自动骨架筛漏检，逐文件证据）

AF 的自动筛查只看顶层函数体，漏了类方法体与预设体。以下 11 条经 AH 侦察、本批逐条复核证据后成立：

| 条目（(i) 测试文件） | 产品文件 | 证据 |
|---|---|---|
| server/sharedThreadBridgeRegistry.test.ts (50 行, 3) | apps/server/src/sharedThreadBridgeRegistry.sla | 全文 45 行（TS 51 行）：6 个类方法（new/get/set/values/entries/release，L19–L44）均为约 4 行声明式空体；文件头自述 "Bulk conversion pass — defects logged, not yet fixed" + generics DEFECT |
| server/sshWorkspaceStore.test.ts (44, 3) | apps/server/src/sshWorkspaceStore.sla | 全文 40 行、仅 4 个 fn（TS 63 行类存储）；database/localDatabase 导入被注释掉，类方法体未物化 |
| server/userPreferencesStore.test.ts (50, 1) | apps/server/src/userPreferencesStore.sla | 同型：全文骨架，database 导入注释、JsonValue DEFECT 注释，方法体未物化 |
| server/remoteThreadRouteStore.test.ts (33, 1) | apps/server/src/remoteThreadRouteStore.sla | 全文骨架（database 导入注释、跨单元类型 handle DEFECT）；AF 已点名暂缓（SQLite 运行时数据库接线），AH 确认维持 (iii) |
| server/threadAgentRosterStore.test.ts (46, 3) | apps/server/src/threadAgentRosterStore.sla | 全文骨架：`@codex-ui/shared` 与 localDatabase 导入均注释，类体未物化 |
| server/codexApiRuntime.test.ts (27, 2) | apps/server/src/codexApiRuntime.sla | `CodexApiEventStore_wait`（L51–56 自注）："returning 1 unconditionally: neither the matches branch nor waiter registration is implemented" —— AB 登记的 D 类宿主泵等待预设体 |
| server/freeOllama.test.ts (59, 3) | backends/relay-config/src/relay/freeOllama.sla | 主体 JSON 函数预设 `return 0`：normalizeFreeOllamaServer (L84)、eligibleFreeOllamaModels (L141)、buildFreeOllamaGroups (L180)、eligibleFreeOllamaEntries (L212)；仅 contains_ci / model_size_match 等小助手为真体 |
| （产品条目）miniTurnSafety | backends/mini/src/runtime/miniTurnSafety.sla | observeRound 循环体全注释恒 null、isMiniSameFileReadAction 预设 false（L42 注释 DEFECT: dynamic JSON + regex 下 `return false`）、extra
...[truncated 4228 chars]

## 5. retest 补跑（2026-10-28）

- 场地：新运行时 `9fbc97515b9f`，盒上 worktree `/content/bulk-retest`（detached @ `ecf8635`，只读跑测）；工具链 restore 完成后开跑（`sa 0.1.8` + sla 插件已装）。规范 env 同文首口径（worktree 根 cwd、`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_SLA_FIXTURE_DIR=/content/sa_all/sa_plugin_sla/tests/import_fixtures/ SA_STD_DIR=/content/sa_all/sci/sa_std`），开跑前清 `.sla-cache`；每文件 `timeout 1200`、严格串行、detached 落日志后回读。盒规格 8 核 / 50 GB。时间为北京时间（盒日志为 UTC，差 8 小时）。
- 文件核对：5 个测试文件 sha256 与 §1 的 AH 备份逐一一致（miniDeepkeyChannel `2bcb2870…`、miniSecondTurnAnchoring `71d746a8…`、miniAnthropicThinking `eb9adc50…`、miniAgentInboxProgress `febb501e…`、effectiveGroupBaseUrl `85c76b98…`）；探针 `t2b_egb_probe.sla` 为 `8f0c3c85…`。
- 跑法：首轮 6 项串行全跑；超时/被杀项随后逐个单独重试一轮（同 env、同 timeout）。两轮合计 12 次运行，**全部零测试输出**（无任何 passed/failed 行、无 panic、无 trap 文本）。

| # | 文件 | 首轮 | 单独重试 | 过程采样（RSS / CPU） |
|---|------|-------|---------|-------------------|
| 2 | server/miniDeepkeyChannel.test.sla (3) | RC=124, 1200s | RC=124, 1201s | SAB 子进程 336–386% CPU 自旋（首轮采样累计 CPU 57 分钟）；父进程 RSS ~10 GB |
| 3 | server/miniSecondTurnAnchoring.test.sla (3) | RC=137, 395s | RC=137, 161s | 两轮均被内核 OOM 杀死：dmesg `Out of memory: Killed process … (sa) anon-rss:52053884kB`（首轮）/ `51597312kB`（重试），total-vm 均 >100 GB |
| 4 | server/miniAnthropicThinking.test.sla (6) | RC=124, 1201s | RC=124, 1203s | 父进程 RSS 26–28 GB + SAB 子进程 RSS ~10.5 GB、220–531% CPU 自旋 |
| 5 | server/miniAgentInboxProgress.test.sla (6) | RC=124, 1201s | RC=124, 1202s | 父进程 RSS 17.7–19.2 GB；SAB 子进程 415–524% CPU 自旋（首轮采样累计 CPU 82 分钟） |
| 9a | _defects/probes/t2b_egb_probe.sla (2) | RC=124, 1201s | RC=124, 1201s | SAB 子进程 126–200% CPU 自旋，零输出 |
| 9 | server/effectiveGroupBaseUrl.test.sla (4) | RC=124, 1201s | RC=124, 1201s | 父进程 RSS ~12–13 GB；SAB 子进程 372% CPU 自旋（首轮采样） |

**裁定（6 项一致）**：仍无断言裁定——通过/失败计数均为 0/0、失败名字集为空，因为没有任何一个 @test 跑完过；但 §3 的「环境无裁定（多线争用）」归因**就此推翻**：本轮严格串行、单独重试轮启动时盒内存 used 仅 7 GB，病理仍逐项复现，且过程量级（数百 % CPU、数十 CPU-分钟、十 GB 级 RSS、OOM 实锤）不可能由争用制造。性质重分类为**编译器/运行时（SAB 执行层）缺陷候选**，两种签名：(A) 执行不终止——SAB 子进程多线程高 CPU 自旋、1200 秒零输出（deepkey / anthropic / inbox / egb 本体 / egb 探针）；(B) 内存无界膨胀——anchoring 两轮 OOM 实锤（anon-rss ≈ 52 GB / 51.6 GB），其余文件的父进程 RSS 12–28 GB 属同族倾向。AH2 轮 anchoring ~411s 的 SIGKILL 现可回溯定性为同一 OOM。

与既有登记的关系：

- §3 的 retest owed（5 文件 + 探针）销账为「已补跑两轮、仍无断言裁定、性质已定」；后续状态 = 待编译器线修复本节签名后重跑，不再属环境待办。
- egb 探针门：AF 登记的 `rpg_free_doc` PhiStateConflict **仍未复现、亦未证伪**——执行在自旋中耗尽 1200 秒，到不了 trap 触发点；与 §2 miniTurnCompletion 的 597s trap（RC=1）形态不同，不合并登记。
- 对照组（AH2 轮能终止的文件）：miniSameFileGuard 105s、opencodeReview 32s、miniServerHooks 1s、agentRoster 8s trap、miniTurnCompletion ~597s trap——终止性与导入图规模相关；本节 6 项的共同点是导入 miniBridge.sla（4 文件）或 relayProtocolGateway.sla（探针 + egb 本体）的大图。
- 产品侧无新证据：6 文件的断言从未执行，产品通过/真缺陷均无从判定；§3 的 8 个产品真失败名字集不受本轮影响。
- 诚实边界：签名 (A) 发生在解释器执行产品代码的过程中，本层证据不能 100% 排除产品侧死循环；但父进程（编译/lowering 阶段）RSS 膨胀与跨两张无关产品图同症，指向工具链层。建议编译器线以新条目登记本签名，最小入口 = `t2b_egb_probe.sla`（仅触 rpg_jb_assign / rpg_jb_doc / rpg_free_doc）与 anchoring（OOM 最快、单独重试 161s 即爆）。
- 环境注：同期 BA2 线在 sci 树间歇运行小作业（unit-framework 短测、RSS ≤ ~3.8 GB 级探针）；探针首轮开跑后最初数分钟盒上无其他重进程、其 SAB 子进程已呈 ~200% 自旋。dmesg 另见两笔与本批采样 RSS 不吻合的 sa OOM（47 GB / 37 GB 级，落在 deepkey 重试窗口内），不归因本批文件，仅存照。
- 文档注：本文件在集成时于 §4 表中途截断（§3 引用的 §7 环境注不在树内版本中），属既有状态、非本轮改动；本节编号顺延为 §5。