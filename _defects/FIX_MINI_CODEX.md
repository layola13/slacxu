# FIX_MINI_CODEX — mini-codex 域 phase1 修复记录（Agent M）

基点：slacxu `bulk-convert` @ `fd02646`，worktree `/content/bulk-mini`。
检查环境：`sa check`（sci + sa_plugin_sla 工具链），`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，cwd=worktree 根，逐个串行、timeout 包裹。
口径：通过率一律以**失败名字集合**为准，不以计数为准。check 通过 ≠ 已翻译，桩逐个登记（a/b/c 普查）。

## 0. 文件数勘误

简报称本域 21 个 `.sla`，实测 **20**：src 15（agentsMd, cli, hooks, imageView, loop, mcp, mcpHooks, memory, plan, responses, review, skills, tools, types, ultraAdapter）+ test 5（agentsMd.test, fourpiece.test, hooks.test, loop.test, soak.test）。共 16,369 行。

## 1. 基线 → 终态（失败名字集合）

基线（`/content/mini_baseline.log`）：**PASS 3/20**（imageView, review, types）。

基线 FAIL 名字集合（17）：
agentsMd, cli, hooks, loop, mcp, mcpHooks, memory, plan, responses, skills, tools, ultraAdapter, agentsMd.test, fourpiece.test, hooks.test, loop.test, soak.test

终态（2026-10-26 终扫）：**PASS 20/20，FAIL 名字集合 = ∅**。

注：ultraAdapter、review 两文件本阶段未改动即通过——其基线失败是导入链（loop/mcp 等）的级联错误，依赖修复后自行消除。

## 2. a/b/c 桩普查（a=真实实现/纯类型，b=注释/空体/桩体，c=逐字 TS 体）

| 文件 | 行数 | 类 | 处置 |
|---|---|---|---|
| agentsMd.sla | 315 | a | fs_exists 极性反转已修（见 §4）；伪造面 `sa_std_fs_is_file`/fs read 全量回绑真实 extern（metadata / open+read+close）；新增 md_is_file、mdPathCopy |
| cli.sla | 295 | a（本阶段重译） | 原 103 行骨架（对应 36 行 cli.ts 却缺主体）整文件按 TS 重译：argv 经 `sa_env_args_json` 跳过 [0..2]、`--resume` 语义、env 回退链、真实 12 参 runPrompt 调用、createUltraExecutor 接线。遗留登记：rest 数组定容 64 |
| hooks.sla | 3359 | a + b 接缝 2 处 | 整文件从伪造 JSON-文本面回绑真实句柄面（kind 码、env/UUID/stderr、runShell 真实进程面）。b 接缝：`hook_sink_dispatch` 宿主回调边界文档化 no-op；`call_mcp_raw_dispatch` 显式失败返回（非静默兜底） |
| imageView.sla | 202 | a + b 1 处 | IMAGE_VIEW_TOOL 与 TS 1:1 物化。b：`loadSharp` 的 dynamic import("sharp") 同步化为句柄 id（0 = TS 的 null/导入失败），见 §3 |
| loop.sla | 645 | b/c 混合 | 真实修复：非法 `export`、while/if 标点、6 处 write-through、chainFileFor 只拷后缀的真 bug、loop 自有 numEnv/sleep 绑定。**登记的 b/c 体**：buildBaseSystem 返回 0、runAgentLoop/runGoalMode 段机器、hasGoalToolEvidence 返回 false、cleanGoalMarker、goalSystemSuffix、forkThreadFile 部分体、runImageViewCall |
| mcp.sla | 4841 | a（运行时未验 1 处） | 伪造的文本 JSON 模型整体替换为真实句柄面上的 56 个 `mj_*` 助手；自带忠实 FIPS 180-1 SHA-1（`mj_sha1_hex`）。**mj_sha1_hex check 通过但合成运行时探针在函数内 segfault，运行时未验**，待 Agent T 的断言探针设施（导入展开语句上限）落地后复验，不得宣称运行时绿 |
| mcpHooks.sla | 1020 | a（经 mh_* 适配层）+ b 接缝 1 处 | 与 hooks.sla 的同名异形 `HookExecResult` 改名为本文件私有的 `McpHookExecResult`（hooks 的同名类型是承重件，未动）。新增 `mh_*` 适配层把本文件的文本模型桥到 hooks 的真实结构体面执行。b 接缝：`mh_exec_non_mcp` 宿主边界显式失败（返回 1 + 文案）。登记差异：每次 pipeline 调用新建 HookModuleState，hooks 缓存不跨调用保留（仅性能差异） |
| memory.sla | 266 | a | capped read 回绑 open/read/close、home 回绑 env 句柄面、mkdir 回绑 `sa_fs_mkdir_p`、append 回绑 open-options；fs_exists 反转已修（§4） |
| plan.sla | 509 | a | 修真语义桩：`extractPlanSteps` 原以 `titleOf(...)` 冒充 status 扫描；新增按 `"status"` 取值的 `statusOf` 并切换调用点（fourpiece.test 的断言正覆盖此语义） |
| responses.sla | 802 | a | 能力参数提升、println→`sa_print_bytes`、sleep 回绑 `sa_time_sleep_ms`；createTurn 族同步状态返回（§3 登记） |
| review.sla | 216 | a | 基线即通过，未动 |
| skills.sla | 611 | a | 以 read_dir_json/metadata/open-read-close 新增真实助手并回绑 4 个调用点；指针运算提升 |
| tools.sla | 268 | a | 删除与 loop 展开碰撞的本地 `ptr_u64_store`；伪造 JSON kind 比较回绑真实字符串 kind=5；补 JSON 导入 |
| types.sla | 180 | a | 全域共享 ByteBuf/buf/指针脚手架 |
| ultraAdapter.sla | 78 | b | 基线外通过（级联消除）。本体为占位：dynamic import(saVmTool) 同步化为一对 placeholder 函数 + executor id 分配；真实 saVmTool 桥属跨域，未在此接线 |
| agentsMd.test.sla | 267 | a | print/println 伪造面回绑 `sa_print_bytes`；测试本地包装 `sa_std_fs_write`/`sa_std_fs_mkdir` 回绑 `sa_fs_write_file`/`sa_fs_mkdir_p` |
| fourpiece.test.sla | 355 | a | PlanStepList 字面量修正（字段 items→steps、step 容量 512→1024）后通过；断言覆盖 plan 的 statusOf 语义 |
| hooks.test.sla | 505 | a（本阶段重写回绑） | 原文件按虚构的 JSON-文本 hooks API 整写（自带 HookCtx 与 mcpHooks 同名碰撞）。整文件改写回绑真实面：matcherMatches 参数序、parseHookFile 建 HookEvents、mh_tool_input、HookTemplateCtx 适配 renderMcpHookInput、ParsedHookOutput、mh_execute（status 码 1/2/3 回读 hook_events_json）、真实 runToolWithHooks/loadHookEvents。**丢弃（未伪造）的断言组**：sink 事件序列、callMcpRaw timeout 记录器（均为宿主回调，本移植中 sink 为文档化 no-op、callMcpRaw 为显式失败 dispatch）；mcp_tool 用例仅保留 not-blocked 断言；runToolWithHooks 的 output 断言保留但运行时被 execNonMcp 宿主接缝阻塞（见 §5） |
| loop.test.sla | 1459 | c → 编译打通 | 与 loop/responses/mcp 的真实签名逐个对账：新增夹具桥 threadItemsOf/threadVecOf/vecToItemArray/cfgToMini；buildBaseSystem 7 参虚构调用改真实 11 参；hasGoalToolEvidence 的第三参为批量虚构已删；loadThreadAuto 参数序纠正等。**登记**：runPrompt 集成用例原按虚构 mock-transport API 写，loop.sla 无此接缝，已按真实 12 参签名改形——本文件仅编译打通，**不得宣称运行时绿**；多处断言打在 loop 的 b 类桩上 |
| soak.test.sla | 176 | a | 随依赖修复通过 |

分布汇总：纯 a = 13（agentsMd, cli, memory, plan, responses, review, skills, tools, types, agentsMd.test, fourpiece.test, hooks.test, soak.test）；a + 登记 b 接缝 = 4（hooks, imageView, mcp, mcpHooks）；b/c 混合 = 3（loop, ultraAdapter, loop.test）。

分布外总登记：DEFECT 标记全域 535 处（逐文件：hooks 123, mcp 94, loop 65, responses 48, loop.test 24, mcpHooks 22, imageView 19, skills 18, fourpiece.test 18, soak.test 17, memory 14, plan 13, tools 12, agentsMd 11, ultraAdapter 11, hooks.test 8, review 7, agentsMd.test 6, types 3, cli 2）——均为已分类的能力/宿主边界登记，非未处置桩。

## 3. async 登记（`// DEFECT: async`，全域 54 处 / 12 文件）

无一处静默压平；全部为「阻塞 extern 在同步泵内直调、控制流 1:1」的已登记退化（ASYNC_MODEL 的阻塞式规范形），或测试侧同步化。逐文件：

| 文件 | 处数 | 处置 |
|---|---|---|
| mcp.sla | 22 | 传输层 Promise/事件面 → 同步状态码泵（StdioConn_send 泵读、HTTP 同步请求）；逐 fn 已在文件
...[truncated 3303 chars]