# backends-b 缺陷日志（auggie / cline / command-code / agy）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## manifest.ts ×4
- backends/auggie/src/manifest.ts:1-8 | JSON 模块导入断言 `import json with {type:"json"}` + PluginManifest 结构类型 | SLA 无 JSON 模块导入、无结构类型 | manifest 存为 ../plugin.json 原始 JSON，运行时 sa_json_parse；类型留 sdk-backend 单元
- backends/cline/src/manifest.ts:1-8 | 同上 | 同上 | 同上
- backends/command-code/src/manifest.ts:1-8 | 同上 | 同上 | 同上
- backends/agy/src/manifest.ts:1-8 | 同上 | 同上 | 同上

## server.ts ×4
- backends/auggie/src/server.ts:19-35 | class + #私有字段 + implements EngineHandle 接口 | SLA 无类/接口/私有字段 | struct + &Struct 首参函数族，状态字符串用 (ptr,len)
- backends/auggie/src/server.ts:22-32 | async start/stop/handleRpc + throw Error | 无 Promise、无异常 | 同步函数 + i32 状态码；handleRpc 返回错误码 1
- backends/auggie/src/server.ts:37-57 | ServerPlugin 对象字面量含函数属性（createEngine/findInstallations/skillRoots/matchesKind 闭包） | struct 字面量不能放闭包 | 描述符字段进 struct，函数属性拆为同文件自由函数
- backends/cline/src/server.ts:19-57 | 同 auggie server 全部构造（transport 为 websocket） | 同上 | 同上
- backends/command-code/src/server.ts:18-57 | 同上 | 同上 | 同上
- backends/agy/src/server.ts:19-58 | 同上，另含 officialProviderId 跨文件常量引用 | 同上 | AGY_OFFICIAL_PROVIDER_ID 以 getter 函数对转发（agyBridge.sla）

## runtime 注册表（clineRuntime / commandCodeRuntime / auggieRuntime）
- backends/cline/src/runtime/clineRuntime.ts:11-54 | 模块级单例 + Set<string> + 可选回调 onCreate | SLA 无模块全局、无 Set、无闭包值 | 状态收进 Registry struct 按引用传递；Set 用定长 (ptr,len) 数组（上限 1024，源无上限）；onCreate 调用丢弃
- backends/command-code/src/runtime/commandCodeRuntime.ts:11-54 | 同上 | 同上 | 同上
- backends/auggie/src/runtime/auggieRuntime.ts:32-93 | Map<string, Bridge> + EnsureAuggieBridgeOptions{runtimeEnv?: () => ProcessEnv, onCreate?} + env 展开 {...process.env, AUGMENT_DISABLE_AUTO_UPDATE:"1"} | 无 Map、无函数值、无动态 env 对象 | 绑定表收进 Registry；所有线程绑定塌缩到唯一 shared bridge（源实际行为相同，但 bindAuggieThreadBridge 传入任意 bridge 对象的语义丢失）；env 改由调用方传快照缓冲
- 全部 runtime 文件 | node:path join | 无 path 模块 | '/' 字节拼接近似，无 Windows 分隔符/盘符语义

## 命令发现（auggieCommand / clineCommand / commandCodeCommand）
- backends/auggie/src/runtime/auggieCommand.ts:17-121 | NodeJS.ProcessEnv 动态映射 + 默认参数 process.env/process.platform | 无动态对象 | env 走 sa_env_get 真实进程环境（与默认参数语义一致）；注入式 env 对象（测试用）无对应；platform 塌缩为 is_win32 布尔
- 同上:26 | tryPluginHostServices()?.cli.getPreferredCliBinary（sdk-backend 服务定位） | 宿主服务定位在 SLA 侧未定形 | 以 extern 形 shim host_cli_getPreferredCliBinary 占位，归 sdk-backend 单元定形
- 同上:56-71 | spawnCliSync（spawnSync, utf8, timeout 10s）+ try/catch | std 无同步 spawn-capture 单函数 | spawn_bidi + 阻塞读 + process_wait 组合；无超时、无 utf8 校验、stdout/stderr 合并而非拼接
- 同上:62 | RegExp 版本号匹配 /(\d+\.\d+\.\d+...)/ | 无正则 | 手写扫描器（同文法）
- 同上:47,110-121 | Map<string, string|null> 版本缓存 + PATHEXT split/map/filter/Set 去重 | 无 Map/Set/高阶函数 | 定长数组缓存（64 条）；PATHEXT 处理只保留受支持集合的常量序，精确顺序待修复期对拍
- backends/cline/src/runtime/clineCommand.ts:15-110 | 与 auggieCommand 同模板（env 键 2 个） | 同上 | 同上（由 auggie 版转换变换生成，逐项核对过命名/键名）
- backends/command-code/src/runtime/commandCodeCommand.ts:15-110 | 同模板 | 同上 | 同上

## providers（clineProviders / commandCodeProviders）
- backends/cline/src/runtime/clineProviders.ts:21-99 | Record<string, unknown> 动态 JSON + 索引签名 + JSON.parse/stringify(2空格) | std JSON 已验证面只有 parse/get/stringify，无 object set | 文件以 doc 句柄 + 原始文本承载；providers[entryId] 写入只组装了 entry 文本，落盘待 JSON 变更面定形
- 同上:73 | new Date().toISOString() updatedAt | 无已验证 ISO 时钟面 | 写空串占位
- 同上:60,90 | mkdirSync recursive / writeFileSync / existsSync | mkdir 无已验证 std 对应 | fs 读写走 sa_std fs extern；mkdir 仅注释标记
- 同上:82 | JSON 字符串转义（JSON.stringify 负责） | 手工组装 JSON 文本未做转义 | 原样拼接 + 行内 DEFECT
- backends/command-code/src/runtime/commandCodeProviders.ts:14-91 | 同类构造，另含计算属性键 { [entry.model]: {} } 与模板字符串 `$${ENV}` | 无计算键 | entry 文本手工组装，apiKey 写为 "$"+ENV 名

## agy 小文件
- backends/agy/src/runtime/agyGeminiResponse.ts:3-49 | RegExp 路径匹配 + any 动态 JSON + ReadableStream reader + TextDecoder + http.ServerResponse.write + async/await + finally releaseLock | 无 fetch 流/解码器/HTTP 响应对象对应面 | 判定改手写前缀扫描；动态值走 doc 句柄（{response} 包装待 JSON 构建面）；流泵改为阻塞 io 句柄 + 事件缓冲切分，JSON.parse 失败由抛错改为跳过（已注明分歧）
- backends/agy/src/runtime/agyRawCapture.ts:4-74 | 工厂闭包对象 AgyLineCapture + fs/promises + os.tmpdir + RegExp sanitize | 无闭包对象、无 promises | struct + 函数族，行存 512KiB arena + 偏移表；tmpdir 用 TMPDIR 或 /tmp 近似（Windows TEMP 未处理）；dump 改同步 fs
- backends/agy/src/runtime/agySettingsGuard.ts:3-74 | 模块级可变状态 + 字符串联合返回类型 + console.warn | 无模块全局、无联合类型 | 状态 struct 按引用传递；结果改 u64 代码 + 名称查询；console.warn 仅注释
- backends/agy/src/runtime/agyCompatibleProtocol.ts:14-107 | 开放 JSON 接口族（可选字段/联合判别）+ JSON.parse try/catch | 无可选字段/联合类型 | 事件以 doc 句柄 + kind 代码承载，固定标量字段提升进 struct
- backends/agy/src/runtime/agyCompatibleProcessManager.ts:20-157 | class extends EventEmitter + child_process spawn + readline + Promise/setTimeout + child.kill/taskkill | 无继承/事件发射器/定时器/kill 面 | emit 改为结构体内事件队列（kind\tpayload 行）由运行时排空分发；waitForExit 改阻塞 process_wait（超时 stop 由调用方处理，返回码 2 表示仍在运行）；stop 仅关 stdin（SIGTERM/taskkill 未实现）
- 全单元通用 | PTR_BYTE_SET 宏 | 依据 slacxu 既有 ptr.sa 用法假设存在 | 若 std 无此宏，修复期统一改数组缓冲写

## agySessionStore / agyCompatibleProbe
- backends/agy/src/runtime/agySessionStore.ts:全文件 | node:sqlite DatabaseSync + SQL 模板 | std 无已验证 sqlite 面 | SQL 原文保留，db_* 以声明式 shim 占位，归修复期定形
- backends/agy/src/runtime/agyCompatibleProbe.ts:全文件 | pluginHostServices().cli.* 宿主服务定位 + base env 枚举 + spawnSync 探测 | 宿主服务定位在 SLA 侧未定形 | host_cli_* shim 占位；base-env 枚举缺失（buildSafeAgyEnv 该段近似）；spawnSync 以 spawn_bidi+排空+wait 组合
- 同上 | 已绑 sa_std ts 面 | String.trim 等 | trim_span 已回绑 @ts_str_trim（ts_string.sa）

## auggieAcpProtocol
- backends/auggie/src/runtime/auggieAcpProtocol.ts:全文件 | 开放 JSON 接口族 + 类型守卫（is/as 系列）+ id 任意 JSON 值 | 无联合/守卫 | 事件以 doc 句柄承载；buildAuggiePermissionResult 的 id 以原始 JSON 文本传递
- 同上 | JSON 构建时字符串转义（JSON.stringify 负责） | 手工组装 JSON 文本未做转义 | 原样拼接 + 行内 DEFECT
- 同上 | 已绑 sa_std ts 面 | String.trim | trim_span 已回绑 @ts_str_trim

## cline 子会话（clineHookAttribution / clineChildSession / clineHubClient）
- backends/cline/src/runtime/clineHookAttribution.ts:全文件 | node:sqlite 查询 teams/spawn 索引 + fs 尾读 2MiB 回退 + Map/LRU 淘汰 | std 无 sqlite 面 | sqlite 以 shim 返回不可用；尾读改整文件读+切片；映射表定长（toolOwners 上限 4000 FIFO、其余 1024）
- 同上 | Date.now 节流（10s） | 无已验证时钟面 | now_ms shim 返回 0，节流退化（修复期接时钟面后恢复）
- backends/cline/src/runtime/clineChildSession.ts:全文件 | fs.readdir 枚举 + stat 时间 + JSONL/JSON 混合解析 | 无已验证目录枚举/stat 时间面 | dir_next_name shim 返回空；stat_mtime_ms/stat_started_ms shim 返回 0（鲜度排序退化）；now_ms 返回 0（2s 节流退化）
- 同上 | 已绑 sa_std ts 面 | String.trim | trim_span 已回绑 @ts_str_trim
- backends/cline/src/runtime/clineHubClient.ts:全文件 | WebSocket 客户端 + Promise pending 表 + connectPromise 去重 | std 无已验证 WS 客户端面 | ws_* shim 中 connect 返回失败（DEFECT：hub 连接在本轮不可用）；pending 改定长表（256）+ deadline；connectPromise 去重塌缩
- 同上 | 已绑 sa_std ts 面 | String.trim/parseInt 前缀语义 | trim 已回绑 @ts_str_trim；parseInt 以手写前缀扫描（修复期对绑 @ts_str_parse_int）

## agy 运行时（agyCompatibleRuntime / agyCompatibleTurnProjector / agyBridge）
- backends/agy/src/runtime/agyCompatibleRuntime.ts:全文件 | setTimeout 看门狗 ×3（turn 480s/print-grace 60s/question 120s）+ EventEmitter | 无定时器/事件发射器 | 截止时间 + AgyCompatibleRuntime_pollTimers 由宿主泵驱动；事件改队列
- 同上 | answers 对象扁平化（Object.keys 枚举） | sa_json 已验证面无键枚举 | extractUserInputAnswer 该段未实现（decision/response 回退路径精确），行内 DEFECT
- 同上 | 已绑 sa_std ts 面 | String.trim | trim_span 已回绑 @ts_str_trim；model context-variant 剥离为本地近似（规范实现在共享单元）
- backends/agy/src/runtime/agyCompatibleTurnProjector.ts:全文件 | JSON 节点 kind 判别/子节点枚举（问题解析 build_question）+ 正则 /^A(\d+):\s*(.*)$/ | 节点 kind 面未定形 | json_node_items/json_node_string 以 shim 占位；问答解析改手写扫描，稀疏答案空洞丢失
- 同上 | 已绑 sa_std ts 面 | String.trim | trim_span 已回绑 @ts_str_trim
- backends/agy/src/runtime/agyBridge.ts:全文件 | 会话内嵌完整 AgyCompatibleRuntime + AgyProxyServer（每会话一份） | SLA struct 内嵌使单 bridge 内存占用巨大 | 按源内嵌（会话上限 16），修复期评估改句柄引用
- 同上 | randomUUID / Date.now / process.cwd | 无已验证对应面 | uuid 零值 shim（id 确定性重复，DEFECT）；now_ms 返回 0；cwd 走 PWD env
- 同上 | 已绑 sa_std ts 面 | String.trim | ts_trim_span 绑定 @ts_str_trim

## commandCodeAgentBridge
- backends/command-code/src/runtime/commandCodeAgentBridge.ts:全文件 | 映射表持久化（外部编辑感知）+ JSON object-set/pretty 落盘 | JSON 变更面未定形 | 映射改内存表（首次加载后外部修改不可见，DEFECT）；落盘 pretty 打印近似；json_object_keys 以 shim 占位
- 同上 | 子进程退出轮询（exit 事件） | 无已验证 poll 面 | process_poll_exit shim 恒报未退出（泵的退出路径惰性，DEFECT）；now_ms 返回 0；uuid 零值
- 同上 | request_list_threads / buildHistoryFromItems 简化 | —（转换期取舍） | 列表行未排序且 name/preview/cwd 恒为 null/""；历史构建的 timestamp/turn 分组变换近似，逐项已在行内注明
- 跨文件 | 构造签名不一致：clineRuntime/commandCodeRuntime 侧以 (dataDir/homeDir, env) 形态构造 bridge，本文件 _new 参数序需在修复期与 runtime 文件对齐 | 接口未对齐 | 行内注明，修复期统一
- 同上 | 已绑 sa_std ts 面 | String.trim/split 绑定点 | trim 绑定 @ts_str_trim；isCommandCodeTaskTool 内 split 已注明 @ts_str_split 绑定点

## agyCompatibleProxy
- backends/agy/src/runtime/agyCompatibleProxy.ts:全文件 | fetch 上游（流式 SSE 转发 + 中止）+ http server listen/readBody 泵 | std HTTP 客户端为缓冲式已验证面 | 上游改全缓冲获取后回放（无增量流、无断开中止）；请求泵归宿主侧，handleRequest 为纯核心
- 同上 | fixture JSON 导入（agy_*_fixture.json）+ 深克隆/对象构建 | 无 JSON 模块导入、无已验证深克隆面 | fixture 以 host shim 读同目录文件；json_object_new/json_deep_clone 等以声明式 shim 占位
- 同上 | json_node_string 等节点字符串读取 | 节点 kind 面未定形 | shim 返回空串（args/output 字符串路径退化，DEFECT）
- 同上 | 数字格式化（JS 最短往返） | 无对应面 | append_f64 定点 6 位小数近似
- 同上 | 已绑 sa_std ts 面 | String.trim | 绑定 @ts_str_trim（端点解析尾斜杠为手工修剪）

## clineAgentBridge
- backends/cline/src/runtime/clineAgentBridge.ts:全文件 | hub 事件类型 ClineHubEvent 定义在本文件、hub 客户端轮询面在 clineHubClient.ts | 跨文件规范形状未统一 | ClineHubClient_pump/pollEvent 以声明式 shim 占位，事件形状修复期在 clineHubClient.sla 统一
- 同上 | 构造签名：clineRuntime 侧调用形态与本文件 _new（dataDir + env 快照）需修复期对齐 | 接口未对齐 | 行内注明
- 同上 | build_turns_from_items 只保留 id/status 行 | —（转换期取舍） | 源 turn 记录的 items 数组未随行（items 仍在消息表），行内注明
- 同上 | 角色正则 /你是\s*(.{2,40}?)(专家|…)/ | 无正则 | 字节级手写扫描，码点计数以 ×3 字节近似
- 同上 | 已绑 sa_std ts 面 | String.trim | extract_turn_text 绑定 @ts_str_trim

## auggieRedirector
- backends/auggie/src/runtime/auggieRedirector.ts:全文件 | pluginHostServices().relay.runChatRequestWithKeyFailover（流式 Response） | 宿主 relay 服务在 SLA 侧未定形 | host_relay_chat shim 返回缓冲 (status, body)；forwardStream 改缓冲回放（源为增量流），usage 仍只记一次
- 同上 | readJson 的请求体流式排空（64MiB 上限 + {_raw} 降级） | 请求泵归宿主侧 | parse_body_lenient 近似（解析失败回 {_raw} 文本）
- 同上 | mergeStreamToolCalls 的 Map 键序/重键语义 | 无 Map | 定长合并表（128）+ anon 计数；后到 id 覆盖先到（与源一致）；lastKey 回退仅在无名片时近似
- 同上 | augmentChatResponse/estimateUsage 的动态对象构建 | JSON 构建面未定形 | 以 json_object_new + sa_json_object_set_* 声明式 shim 组装；resolveRelayStation 的字符串节点以占位 doc 顶替（修复期补 json_string_new）
- 同上 | onUsage 回调 + Date.now 账本时间戳 | 无函数值、无时钟面 | 回调丢弃（源注释本身以账本为权威）；now_ms 返回 0（账本 completedAt 恒 0，take 的时间窗过滤退化）
- 同上 | 已绑 sa_std ts 面 | String.trim | ts_trim_span 绑定 @ts_str_trim

## auggieAgentBridge
- backends/auggie/src/runtime/auggieAgentBridge.ts:全文件 | Promise/await（handshake、session/new、set_model、restore）+ .then/.catch 延迟 prompt | 无 Promise | 同步 send_request_sync 泵至落定（迭代预算由 timeoutMs 折算）；session/prompt 改 pending-prompt 表由 handleLine 路由 result/error
- 同上 | setTimeout 静默/失速看门狗（10s / 5min）+ setInterval 式轮询 | 无定时器 | 截止时间 + AuggieAgentBridge_pump 内 poll_session_silence 驱动；now_ms 返回 0 使其在本轮退化
- 同上 | Map<string, …> 会话内多表（assistantTextByTurn 等 6 张）+ EventEmitter | 无 Map/事件发射器 | 定长槽表 + arena（上限见 struct）；事件改 event_queue（kind\tpayload 行）由宿主排空
- 同上 | RegExp ×5（redactSecrets ×3、索引文案 ×2、approvalMethodForTool 关键词组） | 无正则 | redact 改跨度手写扫描（字符类近似）；关键词组改子串扫描（源为词边界正则，误报面略宽，已行内注明）
- 同上 | spawn 的 Node/Bun 运行时判定（globalThis.Bun）+ process.execPath + taskkill 树杀 | 无对应面 | host_is_bun/host_exec_path/host_taskkill_tree shim 占位
- 同上 | redirector 模块单例（ensureAuggieRedirector 全局状态） | 无模块全局 | AuggieRedirectorState 内嵌 bridge（每 bridge 一份，与源单例语义有别，已行内注明）
- 同上 | 已绑 sa_std ts 面 | String.trim（fleet/onboarding/cacheDir 等） | 绑定 @ts_str_trim；splitAuggieSubagentTitle 的 indexOf 以 find_byte 手写（单字符情形等价）

## 全单元通用（补充）
- 全部 bridges | 构造器 env 闭包 () => ProcessEnv + {...process.env} 展开 | 无闭包/动态 env | 统一改调用方传 env 快照缓冲（newline 拼接 KEY=VALUE），env_get/env_set 本地实现
- 全部文件 | JSON.stringify 对 undefined 字段的省略语义 | 手工组装/文档构建以 has_ 标志近似 | 可选字段一律 has_ 门控，个别站点（如 goal/get 的 status:null）以原始文本拼装
