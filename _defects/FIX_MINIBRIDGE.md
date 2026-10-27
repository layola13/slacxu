# FIX_MINIBRIDGE — backends/mini/src/runtime/miniBridge.sla 专批重译台账

目标：`backends/mini/src/runtime/miniBridge.sla`
真值：同目录 `miniBridge.ts`（10,282 行；336 个顶层声明；MiniBridge 类自 TS:4639 起、约 5,640 行类体）
基点：53815766（bulk-convert）。本机回退环境：sci 1ec669ad / sa_plugin_sla 3de91932。
口径：工作树根 cwd；`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，逐文件串行 `timeout 120 sa check`；开工前已删 `.sla-cache`。

## 0. 基线（2026-10-27 本批实测）

- miniBridge.sla：FAIL，首错 `26:1 error.ExpectedDeclaration`（多行 TS import 块）。
- 回归门：`apps/server/src/saVmTool.sla` PASS；`backends/mini/src/server.sla` PASS。
- backends 129 文件失败名字集基线：仅 { mini/src/runtime/miniBridge.sla }（Agent Z 终态，本批开工复核目标文件首错一致）。
- 骨架行内 DEFECT 标记共 2,224 处（按类别：JS Array/String method 606、runtime type test 392、exception 259、type assertion 207、template literal 199、optional chaining 186、arrow/closure 95、JS builtin 92、async/await 65、dynamic JSON 47、timer 41、Promise 15、process.* 12、async function 6、import/bulk 2）。与 `_defects/backends-c-mini-bridge.md` 的原始命中 3,375 处口径不同：彼为合并前原始命中、本表为当前 .sla 行内标记数，两者都在此登记，不混用。

## 1. 表示模型（按 FIX_SAVMTOOL / FIX_RELAY_GATEWAY 先例）

- 动态记录一律 JSON 文本承载：`MbJson`（262,144 B）为一般记录/数组，`MbBig`（1,048,576 B）为会话/messages/历史级大文本，`MbStr`（8,192 B）为标量字符串，`MbText`（65,536 B）为一般文本。会话、快照、请求、响应、工具调用、计划、用量均为 JSON doc 路径寻址（sa_json_*），不为每个 TS interface 造逐字段 struct。
- TS `string` → (ptr, len) 或 MbStr out；`number` → f64（计数/毫秒需整数语义处用 i64 并逐处注明）；`boolean` → bool；`undefined/null` → has 旗或 JSON kind 判别；联合字面量类型 → MbStr 文本 + 常量访问器。
- try/catch/throw → 状态码 + 错误文本 out（TS catch 分支逐处核对）；`?.`/`??` → has 支路；模板字符串 → MbBuf append 链；正则 → sa_regex POSIX-ERE 子集或手写扫描（超子集逐处登记，`\d` 等类按 ERE 规则改写）。
- 顶层可变状态（liveMiniExecProcs 等）→ sa_global_* 具名 cell（globals.sai），初始态与 TS 逐个核对；常量表 → 访问器或使用点内联。
- 类字段（sessions / pending* / execs / 队列 / 缓存）→ MiniBridge struct 内的 JSON 承载字段（映射表 = JSON 对象文本），身份键为 threadId/id 字符串；modelHistory 缓存按 threadId 键入桥内 JSON 缓存字段（其键控语义与 miniModelHistory 的 session 身份令牌在本文件的接缝处登记）。

## 2. EventEmitter 重构模型（核心定案的落点）

CAPABILITY_MAP 四出处定案 EventEmitter 不支持（本批不重新论证）。TS 中 MiniBridge 的事件面只有两个通道：`emit("notification", msg)` 与 `emit("message", serverReq)`，加宿主侧的 `.on("notification"|"message", cb)` 订阅（见 apps/server/src/index.sla:931-932 的既有登记）。SLA 落点：

- MiniBridge struct 持 `listeners_json`（订阅登记表：{event, listenerId} 数组）与 `events_json`（待投递事件队列：{event, payload} 数组）两个 JSON 字段。
- `MiniBridge_on(self, event_ptr/len, listener_id, out_registered)`：登记订阅（同 event+id 去重），返回状态码；这是宿主接线面，不造 JS 闭包。
- `MiniBridge_emit(self, event_ptr/len, payload_json)`：先走 notification 的时间戳盖章（stampTurnEventTimestamps 的 TS 语义在同一函数内落实），再把事件追加进 `events_json` 队列；有登记订阅时返回已排队计数。宿主通过 `MiniBridge_drain_events(self, out_json)` 取走并清空队列后按 listenerId 分发——投递语义由队列保序，同步直调语义差在此登记：TS 为同步 dispatch 到闭包，SLA 为保序队列 + 宿主 drain（无闭包面下的唯一忠实落点，与域内 codex 桥 emit_* 宿主接缝先例同族但本文件保留可观察的队列状态，不是 return 0 空转）。
- 类内全部 `self.emit(...)` 调用点改写为 `MiniBridge_emit(self, ...)`，payload 先物化为 JSON doc 再入队；`super.emit` 不复存在。
- process.on("exit") 的 exec 收尾钩子（ensureMiniExecShutdownHooks）：sa_std 无信号钩子面 → 显式 DEFECT 登记，收尾由 MiniBridge_stop 的同步清理承接（TS stop 本就做同一清理）。

## 3. async 落点（ASYNC_MODEL）

当前骨架 async 标记：`DEFECT: async/await` 65 + `async function` 6 + Promise 15（部分重叠计数）。处置分型（译时逐处填表）：
- 阻塞契约型：TS async 仅为 I/O 顺序（fetch 上游、MCP 工具、skills、saVm runTool、子代理等待）→ 同步形 + 阻塞 extern/接缝直调，控制流 1:1，登记保留。
- 真 future 型：契约面要求 future 的宿主服务调用（hsRunTool 等返回 future<i32>）→ 在产生处同函数内 task::new + poll 驱动（ASYNC_MODEL 1.5b 规范形），不跨函数传手写 poll 驱动。
- 定时器/等待型：waitForMiniChildNotify、sleepWithMiniAbort、goal 续跑定时 → 截止轮询（sa_time 单调钟 + 短睡），AbortSignal 以会话 JSON 中的 aborted/cancelledTurnIds 快照在轮询点检查；setTimeout 句柄 → 桥内 deadline 表（JSON），clearTimeout = 删表项。
- 禁忌形态（编译器残留）：不用 join2 组合 Loop 子 future；sync fn 不直接 .await Loop 计划 future；循环内 await 的子 async fn 不放 extern &out 调用（外部调用在父侧直读）。

## 4. fs_exists 逐点（sa_std_fs_exists 为状态码 0=存在/3=不存在）

TS 真值中 fs 存在性判断点（译时逐点核极性，落点一律 `== 0`）：
1. TS:49 formatMiniEnvBlock 的 existsSync(join(cwd, ".git"))。
2. TS:6259 request 的 fs/readFile 分支 statSync(target, {throwIfNoEntry:false})（ stat 面，非 exists；以 fs_len/stat 状态码承接，缺失走 TS 的 undefined 分支）。
3. 其余 fs 调用为 readFile/readFileSync/writeFileSync/mkdirSync（TS:6261-6274、9620、9900），以阻塞 fs 面承接，不涉 exists 极性。
当前骨架仅 TS:49 一处 existsSync 直译点；重译后在本节回填最终 `sa_std_fs_exists` 调用点清单与极性结论。

## 5. 分区计划（TS 行段 → 批次）

| 批 | TS 行段 | 内容 |
|---|---|---|
| B0 | — | 本台账、助手层（Mb* 缓冲 + JSON 助手 + 字符串/数字/路径/正则助手） |
| B1 | 1-340 | 常量、env 块、exec 进程收尾、轮次取消/steer 判定、goal 续跑标记与迁移 |
| B2 | 341-1130 | goal 状态/预算/指纹、effort、上下文窗、usage 归一、token 估算、历史预算与 head/tail |
| B3 | 1131-1960 | 历史摘要计划/分块/pin/组装、turn 输入预算、响应链、Anthropic 形状与 body 校验、chat→anthropic |
| B4 | 1961-2920 | 输出收缩、auto-compact、tilde 展开、工具表与子代理工具、参数校验/归一 |
| B5 | 2921-4115 | 计划步骤、echo 门、任务指纹/阶段、收尾规则常量、重试/退避、紧凑转录、评审目标、工具调用去重与 sanitize |
| B6 | 4116-4638 | SSE 读取、用户输入答案、web 搜索、AGENTS.md active 追踪 |
| B7 | 4639-5430 | 类状态/构造/emit 模型、respond/pending、会话恢复、resolveTarget、历史摘要请求、usage/retry 通知、fetch 上游、exec 会话族 |
| B8 | 5431-7630 | request 分发（RPC 全表）、子代理调用族、排队/等待/收尾 |
| B9 | 7631-10282 | runMiniTurn/Once 主循环（协议三线、工具回合、goal 结算） |

## 6. 批次台账（实时填充）

| 批 | TS 行段 | 内容 | check | 提交 |
|---|---|---|---|---|
| B0 | — | 助手层全量（Mb*/JSON/字符串/路径/正则/SHA-1 移植） | PASS | 902c26e |
| B1 | 40-655 | 常量、env 块、exec 收尾、取消/steer、goal 标记/迁移/状态/预算/指纹 | PASS | 91114f3 |
| B2 | 655-1344 | effort、上下文窗、usage、历史预算、摘要计划、turn 预算、响应链、协议探测 | PASS | 1e67cb7 |
| B3 | 1345-2404 | Anthropic 族、chat→anthropic、输出收缩、auto-compact、tilde、工具表 | PASS | 5cadf66 |
| B4 | 2405-2920 | 工具+MCP、子代理名、参数校验、normalizeSaVmArgs、steer 族 | PASS | 1acc1f9 |
| B5 | 3183-4638 | history 文本、图片剥离、计划族、echo 门、收件箱、紧凑/锚点、上游错误、评审族、patch 校验、去重/sanitize | PASS | de895c9 |
| B6 | 4560-4638 余 + 类前自由函数 | readSseStream、extractUserInputAnswer、runMiniWebSearch、AGENTS.md active 追踪 | PASS | 440df75 |
| B7 | 4639-5430 | 类状态/构造/emit 队列模型、respond/pending、会话恢复、resolveTarget、摘要请求、usage/retry 通知、fetch 上游、exec 会话族 | PASS | cdee17d |
| B8a | 5431-约6100 | 运行队列模型（pending_runs + mb_enqueue_run）、delta 族、子线程队列泵、finish_subagent、apply_goal_directive、fail/interrupt/complete 结算三件套骨架、request 第 1 部（thread/start、read/resume、list、turns/items list、compact/start、review/start、delete、archive、fork） | PASS | 67f1a60 |
| B8b | 约6100-5431 余 | request 第 2 部（capabilities/list、mcp reload/status/tool/resource、command/exec 族、goal set/get/clear、name/set、turn/steer、turn/interrupt、fs/readFile、fs/writeFile）+ schedule_goal_auto_continuation、fs 路径助手 | PASS | 130e0a8 |
| B8c | 5431-7630 余 | complete_turn/drain_queued_turn/settle_goal、start_goal_continuation_turn、fire_due_goal_timers、answer_status、compact_session、handle_request_user_input、request_approval、子代理状态/收件箱族、handle_subagent_call 全族（spawn/send/followup/read_report/wait/close/resume/interrupt/list）、request 的 turn/start case（含 goal 抢占、auto-compact 屏障、slash 路由、技能展开、目标替换） | PASS | 本笔 |
| B8c | 5431-7630 余 | complete_turn/drain_queued_turn/settle_goal、start_goal_continuation_turn、fire_due_goal_timers、answer_status、compact_session、handle_request_user_input、request_approval、子代理状态/收件箱族、handle_subagent_call 全族（spawn/send/followup/read_report/wait/close/resume/interrupt/list）、request 的 turn/start case（含 goal 抢占、auto-compact 屏障、slash 路由、技能展开、目标替换） | PASS | 980a24c |
| B9a–f | 7631-约9600 | MbTurnCtx + ctx 段/echo/usage 助手、run_mini_turn 包装 + dispatch_pending_runs、run_mini_turn_once 建置、turn_loop 头 + 回滚/内部推送/round headers、chat 线（mb_fetch_chat 含 catch 分类全序）、anthropic 线（build_body/switch/fetch/catch 全序含 max_tokens 续写与 prefill/adaptive/empty 分支）、responses 线（build_body/fetch 含链式 400 恢复与 SSE/JSON 双臂） | PASS | a023b1f |
| B9g–h | 约9600-10282 | 工具结果推送/计划进度（mb_push_tool_result/mb_plan_progress）、turn_loop_rest（update_plan 提取、空轮级联、文本轮 steer 级联全序）、H1 助手（mb_tool_item/mb_supports_parallel/mb_refused_read_out）、mb_exec_tool 分发全链（校验/子代理/用户输入/web/mcp/sa_vm/image_view/read_skill/capability/mcp-tool）、mb_exec_account 读停滞记账、mb_turn_exec_tools（分区预热 + 守卫观察 + 硬停滞）、mb_turn_finalize（摘要轮、reasoning 项提交、段收尾、历史缓存、会话结算/钩子/目标结算） | PASS | ba9ee80 |

## 7. 普查三账（终态，2026-10-27 实测）

**终态结论**：`sa check backends/mini/src/runtime/miniBridge.sla` **PASS**（20,568 行）；回归门 `apps/server/src/saVmTool.sla`、`backends/mini/src/server.sla` 均 PASS；**backends 全域 129/129 PASS，失败名字集 = ∅**（基线为 {miniBridge}，本批清零）。

### 7.1 a/b/c 普查
- **(a) 忠实重译**：全文件。TS 全部顶层函数与 MiniBridge 类方法均落为 SLA 函数，会话 = 快照形 JSON 文档、类 Map 字段 = 以 id 为键的 JSON 对象、动态记录 = MbJson/MbBig/MbStr 文本载体（§1 模型）。终文件 20,568 行 vs TS 10,282 行，膨胀来自显式 JSON 管线与状态码承接。
- **(b) 能力缺口显式登记**：共 19 处 `// DEFECT` 行（宿主接缝 12、std 缺口 7，清单见 7.4），全部走 TS 的 optional-call/失败语义，无静默桩、无假通过。
- **(c) 逐字 TS 残段**：**0**。骨架内未译 TS 段已在 B0–B9 全量替换；代码级扫描（`=>`、`const … =`、`await`、`undefined;` 于注释外）零命中。

### 7.2 async 终账
- TS async 函数按 ASYNC_MODEL 阻塞契约 1:1 落为同步函数：文件头总登记（第 17 行）+ `ASYNC-REGISTER` 逐点 1 处（第 4077 行，miniToolsWithMcpForDepth）。无静默压平。
- 运行队列即 TS 的 fire-and-forget 语义载体：run 请求入 `b.pending_runs`，宿主经 `MiniBridge_dispatch_pending_runs` 排空并套 TS catch 映射（"interrupted" → interrupt_turn，其余 → fail_turn）；子运行以 opts{childRun:true} 回泵 child_in_flight。
- 空轮重试的 sleepWithMiniAbort 落为普通 sleep（中止在循环头观察），已在 fetch 函数头登记。
- **DEFECT(std) 停滞计时器 ×3**（第 16951/17409/18023 行，chat/anthropic/responses 三线函数头）：阻塞 fetch 不可被抢占，roundStalled 恒 false。四出处：sala 文档无抢占式计时面、sla demos/tests 无对应语料、sa_std 清单（.sai/.sla/.sa + sa_std.h）无 poll 型 fetch 变体。

### 7.3 fs_exists 逐点
- TS `existsSync` 真实调用恰 1 处（miniBridge.ts:49，`.git` 探针；另一命中为 import 行）。
- SLA 侧恰 1 个调用点（第 795 行），且全文件 `sa_std_fs_exists` 原始调用只出现在唯一咽喉 `mb_fs_exists`（第 581 行，`sa_std_fs_exists(...) == 0`，极性正确）；其余存在性探测走 mb_file_size / mb_read_file_b 的状态码。**无语义反转点。**

### 7.4 EventEmitter 重构模型（事件词表 → 接缝）
- TS 事件词表：约 90 处 `emit("notification", {method, params})` + 2 处 `emit("message", serverReq)`。四出处定案 EventEmitter 不支持（CAPABILITY_MAP），本批落法：
  - **发射**：状态持有监听注册表 + 有序 pending-event 队列挂在 MiniBridgeState 上；业务代码经 `MiniBridge_emit_*` 接缝族发射（item started/completed、agent/reasoning delta、retry notice、turn settled、goal updated 等），宿主排空队列对外分发。
  - **订阅**：宿主回调表 ServerHookHandlers（finish hook 等）显式传参，不经事件总线。
  - **禁止项已守**：无 EventEmitter 桩、无空函数体冒充。
- 宿主接缝阻塞落点（均在码内逐点登记）：
  1. `pluginHostServices().saVm.runTool`（第 15443 行登记）：宿主 fn 表返回 future<i32>，SLA 侧不可驱动 → `mb_savm_run_tool_blocked` 写出 TS 原文错误 `tool error: plugin host services are not registered (the host must call setPluginHostServices at boot)`；sa_vm 与 capability invoke（invoke_id 注册表，第 19657 行）共用此落点（第 19214 行 H2 头登记）。
  2. auto-verify 目标：按 TS 计算后丢弃（其 diagnostics 调用同属上述阻塞面且 TS 吞失败），码内注释登记（第 19438 行附近）。
  3. 兄弟文件登记桩（不在本批改动范围）：`runMiniImageView`（imageView.sla，sharp 不可用 → ok=false）、`extractMiniReadFileKeys`（miniTurnSafety.sla，返回 0 键）——本文件 `mb_refused_read_out` 的判定结构完整，但在这两个兄弟桩落地前不可触发。

### 7.5 开放项（如实登记，非阻塞）
- `mb_turn_exec_tools` 硬读停滞分支调 miniPromptWantsWrite 时 has_dev_ctx 传 false（once-setup 的开发语境判定为局部量，未穿入 ctx），可能少触发一次写意图 steer。
- read_skill 条目名按小写与已小写化的 want 比较（与 B9a 中 entries 的既有用法一致），条目原文大小写未逐字复核。
- once-setup 的 JevToolsIn 以全 false 零值起始后调 resolveJevMethodFlags；会话 jevTools 配置是否应先行填充 tools_in 未定案，留待宿主接线时核。
- 摘要轮 SSE/JSON 判定走 content-type（与 round 代码同一约定），未按响应体嗅探。
