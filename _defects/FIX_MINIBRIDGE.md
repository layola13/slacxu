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

（待填）

## 7. 普查三账（终态填充）

（待填：a/b/c、async 终态计数、fs_exists 终点清单、EventEmitter 事件词表→接缝映射表、剩余阻塞四出处证据。）
