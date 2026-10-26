# FIX_BACKENDS.md — backends 域修复阶段一（编译打通 + 桩普查）

工作树：`/content/bulk-be`（基点 origin/bulk-convert = 2f1b4f8）。
口径：`SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，
`SA_PLUGIN_DEV=1`，逐文件串行 `sa check`，全程 timeout 包裹。
比对一律按失败**名字集合**。

## 1. 基线与终态（名字集合）

| 轮次 | PASS | FAIL |
|---|---|---|
| 基线（round 1） | 5 | 124 |
| round 8 | 62 | 67 |
| round 9 / 10 | 65 | 64（两轮同集） |
| **round 11（终态全量）** | **71** | **58** |

round 10 → round 11：新通过 6（jevOpenAiBridge、opencodeCompatibleProbe、
opencodeCompatibleProtocol、opencode/src/server、opencode-v2/src/server、
omniRouteFree），**回归 0**。
round 11 之后另有逐个复核通过（未再跑全量）：miniServerHooks
（`type:` 字段改名 type_ 后通过）；miniModelHistory、omniRouteFree
已在 round 11 内通过。

终态仍失败的 58 个文件及首错见 §7 表。

## 2. 桩普查三分类（a/b/c）

方法：启发式普查脚本（函数体空/常量返回 = b；未注释的逐字 TS 行 ≥3 = c；
其余 = a），全文存 `census` 结果（本轮口径：块注释已掩码）。
结果：**a = 55，b = 72，c = 2**（c 为 mini/src/server.sla 与
mini/src/runtime/miniBridge.sla，两者含整段未注释 TS）。
注意 b 类含一类**假阳性**：TS 顶层 const 被转成常量返回的访问函数
（如 `REMOTE_RECONNECT_MAX_ATTEMPTS()`），那是忠实转写而非桩；
真实 (b) 以各文件 DEFECT 注释与下述已核实清单为准。

已核实并处置的 (b) 类：
- **miniModelHistory**：get/set/delete 原为注释桩（恒未命中/恒 false/
  空操作）——已按 TS 语义全量重译（见 §5）。
- **relayCatalog**：sourceHash 原为桩——已绑真实
  `sa_std_net_sha256_hex`（net.sai）；asRecord/stringValue 仍为注释桩，
  已登记（该文件 check 通过，语义待补）。
- **各桥/探针的 host_cli_\* 桩**：见 §4 的 hostServices 阻塞说明——
  不是静默桩，是具名阻塞，桩体带 FIX 注释并按 TS 可选调用语义回退。
- **桥的 \*_uuid_new / \*_now_ms 说谎桩**（原返回零 UUID / 0 并称
  「无 std 面」）：绑定表已确立（sa_deno_random_uuid + fmt buffer /
  sa_time_unix_ms），auggieAgentBridge 的 aab_now_ms 等随声明块绑定
  一并处理；其余桥同名桩按同一表在各自声明块绑定时回绑（见 §6）。

(c) 类处置：miniBridge（10,286 行，2,210 TS 标记行）与 mini server
仅完成普查登记（miniBridge 首错在第 26 行的未注释 TS import 块），
未重译；relayProtocolGateway 见 §3 点名项 4。

## 3. 点名项处置

1. **saVmPolicy.sla**（vmtool-security）：本体单独 check 败于
   normalizeContextSavings 裸赋值——已**全量忠实重译**（526 行桩骨架
   → ~2,600 行），独立 `sa check` RC=0，消费方
   （saVmCodeGraph 在 bulk-tool 树、saVmInterception 在本域）可引用。
   重译时以 saVmPolicy.ts 原文逐条核对，纠正了多处二手摘要错误
   （reason 串用 RAW candidate/cwd 插值；checkSaVmPath 的 patterns
   分支无 transfer→write 回退；checkSaVmDelete 的 backupDir 判据是
   `matchesAny(backupDir, write)`；checkSaVmHttp 顺序为
   parse→method→credentials/scheme→rules；classify 为 presence-only
   简单版；Bun profile/subcommand 表按 @codex-ui/shared 真值物化）。
   同域 **saVmInterception.sla**（原 (b) 类：re_test 常假桩喂全文件）
   亦已全量重译（~1,510 行，27 条 PowerShell 反模式规则逐条手工
   匹配器 + 全部字面量 deny 理由），`sa check` RC=0。
2. **agentsMdInventory.sla**（mini）：findAgentsMdProjectRoot 按
   _defects/async_probe 探针（PROBE_PASS）模式重译——async fn +
   task::new/task::poll + 5s 截止的同步驱动，向上找 .git 祖先的
   循环完整恢复；全文件重译 ~1,560 行，`sa check` RC=0。形状限制
   已写入文件头（多字符串以换行拼接字节串表示、单文件
   raw/expanded 上限 32,768 字节且 truncated 标志精确、
   renderAgentsMdSystemBlock 按声明布局偏移读 (files, files_len)
   数组 ABI）。
3. **桥类与 ensure\*ForThread**（FIX_INDEX B2/B5 的 backends 侧）：
   - 桥文件尾部的**无体声明块**已确立完整绑定表并在两处落地：
     **auggieAgentBridge**（27 个声明全绑：aab_json_* → json.sai
     真实面，构造走 sa_json_parse("{}"/"[]")；aab_fs_exists →
     状态码 == 0；fs_read/write/mkdir → fs.sai；process_cwd/
     host_exec_path → env 句柄；process_kill/poll_exit →
     process.sai；host_is_windows → OS 环境探针；host_is_bun →
     false（宿主非 Bun，注明）；host_taskkill_tree → 进程组 kill；
     host_event_log_frame → sdk-backend 的 bridgeEventLog 单元
     （(backend, CODEX_UI_DATA_DIR) 纯推导、逐调用重建 logger）；
     正文 66 处伪造的 sa_json_object_set( 已改名真实 extern
     sa_json_object_set_node(）；**auggieRedirector**（22 个声明：
     json_node_* 同表；http_server_bind 按其 5 参调用点绑
     sa_http_server_new/start（临时端口不可见，注明近似）；
     host_stderr_line → io.sai；死的 sa_env_get 声明删除并注明；
     **host_relay_chat 是宿主提供的 relay 面、无 SLA 可调面**——
     显式错误处置并登记为阻塞，非静默桩）。
   - 同族声明块在 clineAgentBridge / commandCodeAgentBridge /
     agyCompatibleProxy 中尚未逐个绑定（绑定表相同，见 §6 剩余项）。
   - ensureAuggieBridgeForThread / ensureClineBridgeForThread /
     ensureCommandCodeBridgeForThread 本体在 index 侧（apps/server），
     其 backends 侧前置（桥类可编译）随上述绑定推进；agy 的 B4：
     agySettingsGuard 的 snapshotAgySettings 无导出共享实例——
     登记为 backends 侧缺口（需在 agySettingsGuard 增加共享实例
     访问器，未做）。
4. **relayProtocolGateway.sla**（7,110 行）：已完成普查登记——
   1,916 DEFECT 标记、84 async 标记、595 TS 标记代码行、25 个
   顶层可变 JsonBuf 全局（`let relayToolDiagnostics: JsonBuf = …`
   等，须按 cell 裁决回绑 sa_std 具名 cell）。首错
   `332:1 ExpectedDeclaration`（逐字 TS 区 + 顶层全局区）。
   本轮**未重译**，按区登记为下一批（先注释化逐字 TS 区达 parse，
   再分区重译 + 全局→cell）。
5. **fs_exists 语义反转全域扫**：实测全域仅 7 处直接
   sa_std_fs_exists 调用点 + 4 个本地包装。逐处按 TS 分支语义审计
   极性，**共 7 处反转已修正**（均加 FIX 注释）：museCompatibleProbe
   isLaunchable、opencodeCompatibleProbe:175 isLaunchable、
   opencodeCompatibleProcessManager:1231 cwd、opencode/src/server:439
   consider、opencode-v2/src/server:384 consider、
   claudeCompatibleProbe:437 existsSync、claudeDesktopInjection:307
   pathExists。另 aab_fs_exists（auggieAgentBridge 声明块）在绑定时
   以 == 0 极性落体（第 8 处）。三个命令文件包装
   （cline/auggie/commandCode Command）走 sa_std_fs_len(...) == 0，
   极性正确未动。教训已记：== 0 并非天然正确，须逐处对 TS 语义。
6. **altB 三处字段不匹配**（FIX_OTHER_APPS.md §C）：全树检索确认
   backends 域内**无对应文件级记录**（仅 FIX_OTHER_APPS.md:74 与
   PHASE_STATE.md:65 提及，均称不在该域、主线路由）。本域不处置，
   在此注明归属结论，不虚构文件。

## 4. 跨域阻塞（具名，非静默）

- **hostServices 不可调用**：sdk-backend/src/hostServices.sla 的
  PluginHostServices 是 fn-ptr 表；其 cli 表同步方法在 sdk 头注释中
  明言「stay untyped ptr fields… typing pass belongs to the
  host-implementation phase」——已注册实现目前**无法从 SLA 调用**。
  各桥/探针的 host_cli_getPreferredCliBinary /
  getCachedLatestCliPath / enumerateCliCandidates 垫片因此只查表
  （tryPluginHostServices + 字段 != PTR_NULL）后报告「无偏好/
  无缓存/空列表」，与 TS 可选调用的回退结果一致（调用方继续走
  env/PATH 解析）。每处垫片带 FIX 注释引此阻塞。
- **EventEmitter**：CAPABILITY_MAP 四出处复核确认不支持，本域
  相关桩维持登记（不变）。
- **host_relay_chat**（auggieRedirector）：宿主 relay 面，同
  hostServices 类，显式错误处置（out_err = -1）并注释登记。
- **SQLite 会话存储**：agySessionStore / museSessionStore /
  opencodeSessionStore 的 db 面须按 sa_std/plugin_sqlite.sa 的
  14 个 SA_SQLITE_* 宏门面（结果 JSON）重写各自 DB 层，本轮未做，
  三文件仍失败（首错为伪造的 sa_db_exec / sa_sqlite_column_is_null
  未定义）。

## 5. WeakMap → sa_idmap 回绑（sci 17323ae4，identity.sai）

普查确认 backends 域 WeakMap 全为身份键侧表、无 GC 回收依赖，
统一以 sa_idmap_*（强引用、u64 身份令牌、多条目）回绑：

- **omniRouteFree.sla**（relay-config）：四张表全部回绑——
  kernelIdentityByOrigin（KernelIdentityMemo 改为 idmap 句柄，
  值 = 144 字节 KernelIdentity blob）、opencodeForcedShape
  （sa_idmap_get_u64/set_u64）、opencodeInjectionContexts 与
  opencodeContractAttempts（OpencodeShapeState 三槽位改为三个
  idmap 句柄，值 = 紧凑 blob；remember/recall/forget/record/
  reset 全部改写）。转换期「单槽表、第二个 origin 逐出第一个」
  的退化已消除。该文件另修：41 处 `[0u8; N]` 类型位 let、
  21 处 `ptr + 变量` 中缀加法（omni_padd 表达式改写）、13 处
  if/else 分支尾类型不一致（值调用尾改 discard let）——
  **omniRouteFree 现已通过 check**。
- **miniModelHistory.sla**（mini）：WeakMap<object, CachedHistory>
  改为 idmap（session 对象 = 调用方给的 u64 身份令牌），值 =
  packed blob（1 MiB scratch 上限，注明）；同时 get/set/delete
  三个注释桩按 TS 语义真重译（messagesKey 绑真实
  sa_std_net_sha256_hex；get 命中需 compatKey 与 messagesKey
  双符，不符则 delete + 未命中，与 TS 控制流一致）。
  **该文件通过 check**（重译前即通过，但语义为空——普查的价值
  正在于此）。

## 6. 转换波次与剩余项

本轮机械波次（均双确认、按名字集合验收）：数组类型
`[N]Type → [Type; N]` 163、PTR_BYTE_SET → PTR_WRITE_U8 208、
结构体字段数组类型 255、缺失 @import 补全 246（后去重修 77）、
借用参数写穿 1,207、同名 helper 消歧 206、本地数组 capability
桥 3,169、解引用读括号化 39 + 写穿残余 236、`== false/true`
改写 115（该二式为语法错误）、`&path.field` 数组字段参数桥 133、
字面量中裸类型重复 → exemplar 15（wave 13 曾误伤单行 struct
声明、已修复并复核）、if/else 分支尾包裹（omni 13 处；全域扫描
其余文件无此形）。

async 恢复计数：基线 420 处 `// DEFECT: async` 标记（54 文件），
终态余 412 处。本轮完成 async 语义恢复的是 agentsMdInventory
（探针模式，见点名项 2）；saVmPolicy / saVmInterception /
miniModelHistory 的 TS async 在其语义中退化为阻塞调用（按
ASYNC_MODEL：阻塞 extern 可在 async fn 内直调、控制流 1:1），
以同步形忠实落地。其余 412 处随各文件重译逐个恢复，未恢复的
在各文件 DEFECT 注释中保留计数。

剩余阻塞按族（58 个失败文件的首错全表见 §7）：
- claude 单元（11）：探针已深入类型层；剩余为 arity 漂移
  （path_join_push 4 参等）、个别 SyntaxError 定位
  （ProcessManager 310:55、Runtime 447:51、DesktopInjection
  91:91、SessionStore 119:39、TaskPlan 229:13）与 capability
  站点续扫。
- 命令文件 if_expr 三件（auggieCommand / clineCommand /
  commandCodeCommand）：`checkExpr failed at node tag if_expr`，
  本轮未定位（grep 无 `= if`；需逐 fn 二分，方法同 omni 二分）。
- 桥声明块未绑：clineAgentBridge、commandCodeAgentBridge、
  agyCompatibleProxy（fixture_text 需读其 TS 语义）、
  auggieAgentBridge/auggieRedirector 已绑声明块但各有下一层
  （capability 站点续扫）。
- arity 漂移族：daemonCodexBridge（3 参）、sshCodexBridge
  （4 参）、clineHookAttribution（map_find 5 参）、
  clineHubClient（split_version 4 参）、clineChildSession
  （slot capability 若干）。
- SQLite DB 层重写 ×3（见 §4）。
- 跨单元适配 ×2：opencodeCompatibleProcessManager 的
  resolveModelContextWindow（须按 packages/shared 的
  ModelCapabilityDescriptor 结构构造入参）、museSkillPreload 的
  workspaceSaVmSkillPath（sdk 的 8 参 WsBuf 形与本地 6 参形
  适配）。
- mini 族：manifest（manifestJson 未定义）、assign_stmt 三件
  （miniCapabilities/miniInput/miniTurnSafety）、struct 重复声明
  二件（imageView/miniImageAnalysisPolicy）、miniBridge 与
  mini server（(c) 类，见 §2）。
- grok 二件 binary_expr（疑 ptr+变量残余）、saVmJev（str_eq
  4 参 + ~2700 行起顶层语句区，属 (c) 尾段需包裹/注释手术）、
  muse 顶层 let 残余（museBridge/museCompatibleProbe 的
  MUSE_SA_VM_DISABLED / VALID_EFFORTS_count——须先核实无重赋值
  再转 const；museHistoryProjection 的 5 个已转 const 并深入到
  json_get_string_copy 5 参漂移）、opencodeCompatibleRuntime
  （OpencodeCompatibleRuntime 缺 has_relay 字段）、relay 网关
  （点名项 4）、agy 族（agyBridge 1080 行 struct 字面量截断、
  agySessionStore SQLite、TurnProjector 的 &ptr 返回直 return
  须提升、Runtime 的 createAgyLineCapture 2 参漂移、Probe 的
  伪造目录面 sa_std_fs_read_dir_json 5 参须按 fs.sai 真面绑）。

## 7. 终态失败名单（round 11，58 个，含首错）

（下表由 baseline_results.json 生成；round 11 后 miniServerHooks
已单独复核通过，auggieRedirector / auggieAgentBridge /
museHistoryProjection 已推进到更深一层，首错以各文件当前
check 为准。）

| 文件 | 首错 |
|---|---|
| agy/src/runtime/agyBridge.sla | Syntax Error: failed to parse backends/agy/src/runtime/agyBridge.sla:1080:42: error.SyntaxError |
| agy/src/runtime/agyCompatibleProbe.sla | Type Check Error: failed to verify types: checkExpr failed at call sa_std_fs_read_dir_json with 5 ar |
| agy/src/runtime/agyCompatibleProcessManager.sla | Type Check Error: failed to verify types: Call to acpm_append_bytes passes capability argument to pl |
| agy/src/runtime/agyCompatibleProxy.sla | Syntax Error: failed to parse backends/agy/src/runtime/agyCompatibleProxy.sla:47:92: error.SyntaxErr |
| agy/src/runtime/agyCompatibleRuntime.sla | Type Check Error: failed to verify types: checkExpr failed at call createAgyLineCapture with 2 args |
| agy/src/runtime/agyCompatibleTurnProjector.sla | Type Check Error: failed to verify types: TypeMismatch in return: expected raw_ptr, actual borrow (e |
| agy/src/runtime/agySessionStore.sla | Type Check Error: failed to verify types: Undefined call: db_exec (error.UndefinedVariable) |
| agy/src/server.sla | Import Error: failed to expand @import SLA sources: error.SyntaxError |
| auggie/src/runtime/auggieAgentBridge.sla | Syntax Error: failed to parse backends/auggie/src/runtime/auggieAgentBridge.sla:1691:46: error.Synta |
| auggie/src/runtime/auggieCommand.sla | Type Check Error: failed to verify types: checkExpr failed at node tag if_expr (error.TypeMismatch) |
| auggie/src/runtime/auggieRedirector.sla | Syntax Error: failed to parse backends/auggie/src/runtime/auggieRedirector.sla:2824:88: error.Unexpe |
| auggie/src/runtime/auggieRuntime.sla | Import Error: failed to expand @import SLA sources: error.SyntaxError |
| claude/src/runtime/claudeCompactionRunner.sla | Type Check Error: failed to verify types: Call to sa_json_get_string_or_number passes capability arg |
| claude/src/runtime/claudeCompatibleProbe.sla | Type Check Error: failed to verify types: checkExpr failed at call path_join_push with 4 args (error |
| claude/src/runtime/claudeCompatibleProcessManager.sla | Syntax Error: failed to parse backends/claude/src/runtime/claudeCompatibleProcessManager.sla:310:55: |
| claude/src/runtime/claudeCompatibleProtocol.sla | Type Check Error: failed to verify types: Redeclaration: function `json_has` is already defined (err |
| claude/src/runtime/claudeCompatibleRuntime.sla | Syntax Error: failed to parse backends/claude/src/runtime/claudeCompatibleRuntime.sla:447:51: error. |
| claude/src/runtime/claudeCompatibleTurnProjector.sla | Type Check Error: failed to verify types: Redeclaration: function `json_has` is already defined (err |
| claude/src/runtime/claudeDesktopInjection.sla | Syntax Error: failed to parse backends/claude/src/runtime/claudeDesktopInjection.sla:91:91: error.Un |
| claude/src/runtime/claudePermissionRegistry.sla | Type Check Error: failed to verify types: Call to ClaudePermissionRegistry_cancel passes capability |
| claude/src/runtime/claudeSessionStore.sla | Syntax Error: failed to parse backends/claude/src/runtime/claudeSessionStore.sla:119:39: error.Synta |
| claude/src/runtime/claudeTaskPlan.sla | Syntax Error: failed to parse backends/claude/src/runtime/claudeTaskPlan.sla:229:13: error.SyntaxErr |
| claude/src/runtime/claudeTurnInput.sla | Type Check Error: failed to verify types: Call to is_supported_image_media_type passes capability ar |
| cline/src/runtime/clineAgentBridge.sla | Syntax Error: failed to parse backends/cline/src/runtime/clineAgentBridge.sla:3078:153: error.Unexpe |
| cline/src/runtime/clineChildSession.sla | Type Check Error: failed to verify types: Call to slot passes capability argument to plain parameter |
| cline/src/runtime/clineCommand.sla | Type Check Error: failed to verify types: checkExpr failed at node tag if_expr (error.TypeMismatch) |
| cline/src/runtime/clineHookAttribution.sla | Type Check Error: failed to verify types: checkExpr failed at call map_find with 5 args (error.TypeM |
| cline/src/runtime/clineHubClient.sla | Type Check Error: failed to verify types: checkExpr failed at call split_version with 4 args (error. |
| cline/src/runtime/clineRuntime.sla | Import Error: failed to expand @import SLA sources: error.SyntaxError |
| codex/src/runtime/daemonCodexBridge.sla | Type Check Error: failed to verify types: checkExpr failed at call readPidManagedDaemonEnv with 3 ar |
| codex/src/runtime/sshCodexBridge.sla | Type Check Error: failed to verify types: checkExpr failed at call splitSshCommand with 4 args (erro |
| command-code/src/runtime/commandCodeAgentBridge.sla | Syntax Error: failed to parse backends/command-code/src/runtime/commandCodeAgentBridge.sla:2101:19: |
| command-code/src/runtime/commandCodeCommand.sla | Type Check Error: failed to verify types: checkExpr failed at node tag if_expr (error.TypeMismatch) |
| command-code/src/runtime/commandCodeRuntime.sla | Import Error: failed to expand @import SLA sources: error.SyntaxError |
| grok/src/runtime/grokCompatibleProxy.sla | Type Check Error: failed to verify types: checkExpr failed at node tag binary_expr (error.TypeMismat |
| grok/src/runtime/grokCompatibleTurnProjector.sla | Type Check Error: failed to verify types: checkExpr failed at node tag binary_expr (error.TypeMismat |
| jev/src/jev/saVmJev.sla | Type Check Error: failed to verify types: checkExpr failed at call str_eq with 4 args (error.Invalid |
| mini/src/manifest.sla | Type Check Error: failed to verify types: UndefinedVariable: identifier `manifestJson` is not define |
| mini/src/runtime/imageView.sla | Type Check Error: failed to verify types: Redeclaration: struct `MiniImageViewTool` is already defin |
| mini/src/runtime/miniBridge.sla | Syntax Error: failed to parse backends/mini/src/runtime/miniBridge.sla:26:1: error.ExpectedDeclarati |
| mini/src/runtime/miniCapabilities.sla | Type Check Error: failed to verify types: checkStmt failed at node tag assign_stmt (error.CompileErr |
| mini/src/runtime/miniImageAnalysisPolicy.sla | Type Check Error: failed to verify types: Redeclaration: struct `MiniImageAnalysisProfile` is alread |
| mini/src/runtime/miniInput.sla | Type Check Error: failed to verify types: checkStmt failed at node tag assign_stmt (error.CompileErr |
| mini/src/runtime/miniServerHooks.sla | Syntax Error: failed to parse backends/mini/src/runtime/miniServerHooks.sla:117:5: error.SyntaxError |
| mini/src/runtime/miniTurnSafety.sla | Type Check Error: failed to verify types: checkStmt failed at node tag assign_stmt (error.CompileErr |
| mini/src/server.sla | Syntax Error: failed to parse backends/mini/src/server.sla:12:1: error.ExpectedDeclaration |
| muse/src/runtime/museBridge.sla | Syntax Error: failed to parse backends/muse/src/runtime/museBridge.sla:229:1: error.ExpectedDeclarat |
| muse/src/runtime/museCompatibleProbe.sla | Syntax Error: failed to parse backends/muse/src/runtime/museCompatibleProbe.sla:114:1: error.Expecte |
| muse/src/runtime/museCompatibleRuntime.sla | Import Error: failed to expand @import SLA sources: error.ExpectedDeclaration |
| muse/src/runtime/museCompatibleTurnProjector.sla | Type Check Error: failed to verify types: checkExpr failed at node tag binary_expr (error.TypeMismat |
| muse/src/runtime/museHistoryProjection.sla | Syntax Error: failed to parse backends/muse/src/runtime/museHistoryProjection.sla:48:1: error.Expect |
| muse/src/runtime/museSessionStore.sla | Type Check Error: failed to verify types: Undefined call: sa_db_exec (error.UndefinedVariable) |
| muse/src/runtime/museSkillPreload.sla | Type Check Error: failed to verify types: Undefined call: workspaceSaVmSkillPath (error.UndefinedVar |
| muse/src/server.sla | Import Error: failed to expand @import SLA sources: error.ExpectedDeclaration |
| opencode/src/runtime/opencodeCompatibleProcessManager.sla | Type Check Error: failed to verify types: Undefined call: sa_shared_resolve_model_context_window (er |
| opencode/src/runtime/opencodeCompatibleRuntime.sla | Type Check Error: failed to verify types: FieldNotFound: `OpencodeCompatibleRuntime` has no field `h |
| opencode/src/runtime/opencodeSessionStore.sla | Type Check Error: failed to verify types: Undefined call: sa_sqlite_column_is_null (error.UndefinedV |
| relay-config/src/relay/relayProtocolGateway.sla | Syntax Error: failed to parse backends/relay-config/src/relay/relayProtocolGateway.sla:332:1: error. |

