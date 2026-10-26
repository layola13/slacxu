# FIX_INDEX — apps/server/src/index.sla 修复记录（F3）

- 范围：仅 `apps/server/src/index.sla` 本体 + 本文件。工作树 `/content/bulk-idx`（基点 `origin/bulk-convert` = 6080800）。
- 复检口径：`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std timeout 60 sa check apps/server/src/index.sla`，串行。
- 源文件：`apps/server/src/index.ts`（14,353 行）。文中 TS 行号均为本轮对 index.ts 的 grep 实测值；.sla 内段头锚点（`// ---- src/index.ts:…`）是批量转换时的标注，部分与实测行号不符（如 HttpApiError 段头标 329-339、实测类在 :298），未译普查按段头原样登记。

## 基线（修前）

- `sa check` **基线即通过**（exit 0）。有效性已用探针证伪过「假通过」：向副本追加引用未定义符号的函数后 check 以 `error.UndefinedVariable` 失败（exit 1）。
- 通过的原因是骨架化：原文件 1,608 行，其中非注释代码约 104 行；活动导入仅 2 条（print.sai、string.sa），其余 76 条同域/跨树导入全部被注释；定义函数 27 个，多数为空桩/假桩；`// DEFECT` 标记 78 处；其余约 13k 行 TS 仅以注释摘要存在。
- 因此 F3 的实际工作不是修语法错误，而是：**已定义函数的语义桩普查与忠实重译** + 未译区域登记 + 阻塞项登记，全程保持 `sa check` 绿。基线失败名字集合（check 层）= ∅；语义桩集合见处置表。

## 探针与验证方法

- 语义探针 `/tmp/probe_idx.sla`（36 条断言，build-exe 实跑 exit 0）：sa_json parse/set/get/remove/set_node/array push/count/get_bool/stringify 的状态码语义（缺键 → 非 0；对非字符串字段 get_string → 非 0；对数组节点 object_get → 非 0）、kind 码（STRING=5/ARRAY=6/OBJECT=7，出处 sci `src/runtime/sa_std.zig:619-627`）、env 缺失 → 0、current_exe/current_dir 句柄、fs exists 状态（0=存在）、math random ∈ [0,1)、本地数组填充字面量 + `&arr` 喂 extern、结构体字段数组经 &param 写入、&u64 写穿。
- 运行时验证：测试主程序 import 本文件的真实函数体逐条断言（见文末「运行时验证记录」），不以 check 通过代替语义验证。

## 批次账（失败名字集合口径）

check 层失败集合全程为 ∅（基线 ∅ → 终态 ∅）；变化发生在语义桩集合：

| 批次 | 内容 | 桩集合变化 |
|---|---|---|
| L1 导入/接线 | 新增导入 ptr.sa、encoding/json.sai、env.sai、time.sai、fs.sai、math.sai；新增 `idx_*` 辅助层 25 个（文本缓冲/JSON 字符串句柄/字节比较/strset 操作/路径 normalize/resolve/dirname/webdist 候选考察）；ServerGlobals 增 3 字段（cliPluginEnabledState、agySettingsSnapshotted、nextSshForwardPort） | — |
| L2 追踪族 | trackCodexChildStarted/Terminal、codexParentHasActiveChildren、trackCodexChildrenFromItem、flushDeferredCodexParent、activeTurnCount、trackTurnStart/End、releaseAllTurnsForUser、extractTurnKey 按 TS :370-450 忠实重译（JSON 注册表模型，CAPABILITY_MAP §16） | −10 桩 |
| L3 LazyBridge | LazyBridge_on 的延迟登记一半落地（{method:"on",args} 记录按序追加进 JSON 文本表）；stop/hasSession/deleteSession 的无实例分支按 TS 落实；构造/分发登记为 B2 | −4 桩（转部分阻塞） |
| L4 cli/ssh | cliPluginEnabledByDefault（:957 正则以 trim+ASCII 大小写折叠+精确字节比较实现，CAPABILITY_MAP §6）、setCliPluginEnabled（:979，缓存写）、isCliPluginEnabled 缓存读一半（miss 路径登记 B3）、allocateSshForwardPort（:1611-1615） | −3 桩，1 转部分阻塞 |
| L5 路径/字符串 | resolveWebDist（:1827，候选顺序+existsSync 探测+回退全实现）、projectClientId（:6346）、HttpApiError_new（:298，message/code/name 字节拷贝补齐） | −3 桩 |
| C1 修正 | resolveWebDist 中条件分支内的 `sa_env_buffer_free(^h)` 触发 SAB **PhiStateConflict**（合并点 Consumed vs Untracked）——build-exe 实测暴露，sa check 不报。按语料定式改为只读不释放：已修复的 sdk 单元（dataDir/cliSpawn/codexVirtualConfig 等）对 env 缓冲一律只读，env 缓冲为进程级生命周期值 | check 仍绿；build-exe 恢复 |
| C2 修正 | 两处把未引号的原始文本喂给 sa_json_parse 的误用（trackCodexChildTerminal 的结果构造、resolveWebDist 的 consider/回退交付）：parse 裸文本返回 0 句柄或令进程异常退出；统一改为先经 idx_json_string_handle/idx_tb_string_handle 做 JSON 字符串转义+引号包裹再 parse | 运行时断言 210/257 转绿 |

## 语义桩处置表（已定义函数 27 个）

全文重译 15 · 部分重译（可达部分忠实、余部有据阻塞）6 · 整体阻塞 5 · 原已真实 1。

| 函数 | TS 锚点 | 处置 |
|---|---|---|
| HttpApiError_new | :298-307 | 全译：status/has_code + message/code 字节拷贝（定长缓冲截断）+ name="HttpApiError" |
| createLazyBridge | :314 | 原已真实（初始化三字段），未动 |
| LazyBridge_ensure | :314-360 | 部分：已有实例早返回忠实；构造+延迟回放阻塞 **B2** |
| LazyBridge_on | :314-360 | 部分：无实例时延迟登记已实现（记录字节形经运行时断言）；有实例转发阻塞 **B2** |
| LazyBridge_stop | :314-360 | 部分：无实例 → 0（undefined）忠实；转发阻塞 **B2** |
| LazyBridge_hasSession | :314-360 | 部分：无实例 → false 忠实；转发阻塞 **B2** |
| LazyBridge_deleteSession | :314-360 | 部分：无实例 → no-op 忠实；转发阻塞 **B2** |
| trackCodexChildStarted | :370 | 全译：守卫（空/自指）+ 父映射 set + 子集 add（去重） |
| trackCodexChildTerminal | :378 | 全译：取父（结果在变更文档前物化，避 arena 失效）+ 删映射 + 子集删并剪枝 |
| codexParentHasActiveChildren | :389 | 全译：子集 size > 0 |
| trackCodexChildrenFromItem | :393 | 全译：type 校验 + receiverThreadIds 遍历（仅字符串项） |
| flushDeferredCodexParent | :401 | 部分：守卫/get/delete 状态转移忠实；末步 routeCodexNotification 调用阻塞 **B6** |
| activeTurnCount | :409 | 全译 |
| trackTurnStart | :413 | 全译（get-or-create + add 去重） |
| trackTurnEnd | :422 | 全译（delete + 空集删用户键） |
| releaseAllTurnsForUser | :431 | 全译 |
| extractTurnKey | :435 | 全译：asRecord/stringValue 经 idx_json_get_string 模拟；`??` 链「在场即止」（含空串）+ 分支真值（非空）判断均按 TS 细微语义实现并实测；Date.now 经 sa_time_unix_ms |
| cliPluginEnabledByDefault | :957 | 全译（见 L4；JS trim 的 Unicode 空白集与 ASCII  trim 的差异见模型注记） |
| isCliPluginEnabled | :969-977 | 部分：缓存命中路径忠实；miss 路径阻塞 **B3** |
| setCliPluginEnabled | :979-982 | 全译：缓存写（JSON object + set_bool） |
| ensureAgySettingsSnapshot | :1590 | 阻塞 **B4**：守卫可写，但 snapshot 调用无目标；**故意不置旗标**（置了即谎称快照已发生） |
| auggieBridgeFor | :1582-1651 段 | 阻塞 **B5** |
| clineBridgeFor | :1582-1651 段 | 阻塞 **B5** |
| commandCodeBridgeFor | :1582-1651 段 | 阻塞 **B5** |
| allocateSshForwardPort | :1611-1615 | 全译：懒播种 46120+floor(random*2840)（TS randomInt(46120,48960) 语义；仅本函数读计数器，懒播种与模块初始化不可区分）；递增与 >49000 回绕 |
| resolveWebDist | :1827-1853 | 全译：候选顺序（env→exeDir×3→模块相对）、index.html 探测、回退 candidates[0] 均实现且分阶段实测；模块锚点见模型注记 |
| projectClientId | :6346 | 全译：`project:${ownerId}:${projectId}`（原转换注释漏 "project:" 前缀，以 TS 为准） |

## async 处置

- 已定义 27 个函数在 TS 中**全部为同步函数**（逐个核对），不存在被压平的 async 签名，async 恢复处数 = 0。
- 文件内 `DEFECT: async` 标记 18 处，全部位于未译注释区域（如顶层 await 序列 :540 段、handleApiRequest、executeCodexRpc 等），随未译区域一并登记（下表），待对应区域重译时按 ASYNC_MODEL 处理。

## 未译区域普查（注释摘要区，共 42 个段头；其中 9 段含已定义代码，33 段为纯注释未译区）

纯注释未译区（按 .sla 段头锚点）：:473-650 常量与 store 接线、:652-776 miniBridge 构造、:778-886 runtime bridge 与后端注册表、:888-1029 grokBridge、:1031-1077 museBridge、:1105-1205 piBridge、:1208-1345 opencode 双桥、:1347-1400/:1346-1384 embedded opencode 网关、:1390-1580 agyBridge、:1653-1750 段内除 allocateSshForwardPort 外的 ssh 注册表/退出钩子/顶层 await、:1992-2110 bridge 事件接线、:2112-2190 清理与启动、:2243-2445 + :2446-2482 handleHttpRequest、:2483-6345 handleApiRequest、:6406-6767 线程 roster、:6683-7259 项目讨论引擎、:7260-7388 misc dispatch、:7389-7889 网关日志与 relay、:7890-8107 静态服务与 auth、:8108-8330 本地 fs RPC、:8331-8531 JEV、:8532-8832 SSH 命令与附件、:8833-9223 Claude skills/黑名单/terminal RPC、:9224-10240 executeCodexRpc、:10241-10436 WS 消息、:10440-11113 服务器请求/VM 策略/通知路由、:11390-11669 provider key/model 解析、:11670-12185 provider 激活与 SSH/远程桥、:12186-12678 Claude 配置、:12635-13349 per-backend 结果构建、:13350-13647 workbench、:13648-14353 send/health/metrics。
这些区域是**登记在案的未译存量**（原 server-index 转换单元已记 38 条缺陷），不属于 F3 的「已定义函数」范围；本文件 check 通过不得读作整文件已转换。

## 阻塞清单（精确阻塞符号）

- **B2 LazyBridge 构造/分发**：工厂是 index.ts:786/:896/:986/:1204/:1209/:1381 的未译闭包，构造 backends 域桥类（GrokBridge/MuseBridge/PiBridge/OpencodeBridge×2/AgyBridge），其 SLA 域未重译；实例方法协议（EventEmitter on/once/addListener + stop/hasSession/deleteSession 的动态分发）无应用层分发表可挂。EventEmitter 本身经 CAPABILITY_MAP §2 四出处核验为 std 不支持面（应用层以闭包+fn 表实现，需具体桥单元先行）。
- **B3 isCliPluginEnabled miss 路径**：依赖 `pluginHost.sla` 的 `cliSettingsEntries`（其函数体仍为纯注释桩）+ `process.env[entry.enabledEnvVar]`；pluginHost 自身又待其 sdk ServerPluginRegistry 接线（属该单元的修复步，不在 F3 范围）。当前 miss 返回 false，与 TS 的偏差仅限于「条目存在且 env 置位」一格，已在代码内 DEFECT(F3-B3) 标明。
- **B4 ensureAgySettingsSnapshot**：`backends/agy/src/runtime/agySettingsGuard.sla` 的 `snapshotAgySettings(self: &AgySettingsGuardState)` 仅为状态方法，未导出共享实例/访问器；backends 域未重译。
- **B5 auggie/cline/commandCodeBridgeFor**：依赖 backends 域 `auggieRuntime.ensureAuggieBridgeForThread` / `clineRuntime.ensureClineBridgeForThread` / `commandCodeRuntime.ensureCommandCodeBridgeForThread`（均未重译）+ 本单元未译区的 wire*Events 函数。
- **B6 flushDeferredCodexParent 末步**：`routeCodexNotification(deferred)` 的目标函数只存在于 index.ts 未译区（:10440-11113 段的通知路由），本单元无 SLA 对应物；get/delete 的状态转移已忠实实现，仅分发一步阻塞。

## 与残余两文件（saVmCodeGraph / saVmTool）的阻塞关系

**无。** 本文件活动导入只有 sa_std 八条；对 saVmTool 的唯一提及是文件头第 46 行被注释掉的导入行（`// @import "./saVmTool.sla"`），代码内无任何标识符引用；saVmCodeGraph 零提及。其内部错误不影响本文件（探针已证 import 方只验声明）。

## 运行时验证记录（盒上 build-exe 实跑，退出码断言）

- tmain（57 条断言，exit 0）：turn 追踪 add/去重/count/end/剪枝/release；child started/terminal/hasActive（含自指守卫、重复 terminal → false）；FromItem（42 非字符串项跳过、异 type 拒绝）；flush 在子活跃时保留、子终局后清除；extractTurnKey 全链（turn.id 优先、turnId、id、threadId、params.thread.id、turn.threadId、空串在场即止 + 非空才分支、无匹配 → false）；cliPluginEnabledByDefault（"1"/" TRUE "/"YeS" 真、"0"/"truex"/""/无值 假）；set/is 缓存对；SSH 端口 [46120,48960) 且连续递增；HttpApiError 字段拷贝；projectClientId 精确串；LazyBridge 延迟表字节形（"[rec1,rec2]" 长度与分隔位）；resolveWebDist 回退值。
- t11 分阶段（均 exit 0）：模块候选（二进制位于 apps/server/src 深度时 exeDir/../../web/dist 归一化命中 apps/web/dist)、exe 候选优先于模块候选、env CODEX_UI_WEB_DIST 覆盖且带空格 trim 生效。
- 注记：断言退出码 >255 会按 8 位回绕（257→1、258→2），本轮二分中段曾因此误判为「陷阱」，已在干净文件系统状态下复跑确认全绿——tmain 的 257 断言（resolveWebDist 回退）对候选目录存在性敏感，t11 阶段创建的候选目录会使其正确地改走命中路径。

## 模型注记（与本文件既有近似一致，非新增静默桩）

- 字符串结果以 JSON 字符串节点句柄交付（extractTurnKey/trackCodexChildTerminal/resolveWebDist/projectClientId），与本文件 JSON 注册表模型一致。
- 定长缓冲饱和截断：IdxTextBuf 8192、HttpApiError message 1024/code 128、LazyBridge 延迟表 8192（满时丢弃新记录，TS 为无界数组——容量即模型上限，已在代码注释标明）。
- env 缓冲只读不释放（C1）：进程级生命周期值，语料定式。
- cliPluginEnabledByDefault 的 trim 取 ASCII 空白集；JS trim 另含 Unicode 空白——env 标志值均为 ASCII，差异已登记。
- allocateSshForwardPort 播种熵源为 sa_math_random（TS 为 crypto randomInt）；该值仅为端口分配窗口种子，非安全材料（CAPABILITY_MAP §7：std 无 crypto 随机面）。
- resolveWebDist 模块候选锚点：本工具链 build-exe 将二进制置于源码旁，故 exeDir 即 TS 模块目录（apps/server/src），候选保持字面 ../../web/dist。
- JSON 文档句柄按既有模型不逐一 free（注册表为进程级状态）。

## 终态

- `sa check index.sla`：**通过**（exit 0）。
- check 层失败名字集合：∅ → ∅；语义桩：15 全译 + 6 部分（余部 B2/B3/B6）+ 5 阻塞（B2/B4/B5）+ 1 原已真实；未译注释区 33 段已普查登记。
- 改动面：仅 `apps/server/src/index.sla`（+849/−60）+ 本文件。
