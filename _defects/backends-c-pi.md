# backends-c-pi 缺陷日志（源：backends/pi，CXU plugins @ f2cb649d）

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`

## manifest.ts → manifest.sla
backends/pi/src/manifest.ts:5-8 | JSON 模块导入 `import ... with { type: "json" }` + `as PluginManifest` 类型断言 | SLA 无 JSON 模块导入、无 SDK PluginManifest 类型 | plugin.json 字节存入定长缓冲，pi_manifest_load 逐字节拷贝

## server.ts → server.sla
backends/pi/src/server.ts:23-39 | class PiEngine + `#status` 私有字段 + implements 接口 | SLA 无类/私有字段/接口 | struct PiEngine + &PiEngine 首参函数族，状态内嵌 struct
backends/pi/src/server.ts:25-37 | async start/stop/handleRpc + throw new Error | 无 Promise/异常 | async→同步函数返回状态码，throw→返回 -1
backends/pi/src/server.ts:41-58 | ServerPlugin 对象字面量（嵌套 cliSettings/discovery）+ matchesKind 闭包 + 方法简写 | 无对象字面量/闭包 | 扁平化为 PiServerPlugin struct + pi_discovery_matches_kind 等独立函数
backends/pi/src/server.ts:50-52 | async findInstallations(): Promise<PluginInstallation[]> | async + 动态数组返回 | 同步函数返回计数（恒 0）

## runtime/piCompatibleProbe.ts → piCompatibleProbe.sla
backends/pi/src/runtime/piCompatibleProbe.ts:17-21 | NodeJS.ProcessEnv 动态 env map + existsSync(join(...)) | 无 env map、sa_std 无对应 fs 探测绑定 | env 以 (ptr,len) 传入，路径存在性走 extern 占位 pi_probe_path_exists
backends/pi/src/runtime/piCompatibleProbe.ts:30-37 | pluginHostServices().cli.getPreferredCliBinary/getCachedLatestCliPath/enumerateCliCandidates 宿主服务定位 | 无 PluginHostServices 对应 | pi_host_cli_lookup extern 占位（按 kind 区分）
backends/pi/src/runtime/piCompatibleProbe.ts:38-92 | 平台分支候选路径数组（win32/POSIX 两组字面量）+ existsSync 逐个探测 | 路径拼接与逐项探测未落地 | 候选清单以注释数据 1:1 保留，探测延后至修复期
backends/pi/src/runtime/piCompatibleProbe.ts:94-104 | readdirSync + filter/map 闭包 + try/catch | 无目录枚举/闭包/异常 | nvm_pi_bin_dirs 只返回计数 0
backends/pi/src/runtime/piCompatibleProbe.ts:110-137 | spawnSync（timeout/encoding/shell 选项）+ RegExp /(\d+\.\d+\.\d+)/ 版本匹配 + try/catch | 无同步子进程 API、无正则引擎 | pi_probe_spawn_version extern 占位，版本扫描近似未实现

## runtime/piRpcProtocol.ts → piRpcProtocol.sla
backends/pi/src/runtime/piRpcProtocol.ts:10-26 | PiRpcCommand 判别联合（15 变体）+ `[key: string]: unknown` 索引签名 | 无联合类型/索引签名 | 单 struct + type 标签字段，未知字段只存 raw_json
backends/pi/src/runtime/piRpcProtocol.ts:34-48 | PiRpcResponse 成功/错误联合 | 无联合类型 | 合并为单 struct，success 作判别字段
backends/pi/src/runtime/piRpcProtocol.ts:56-74 | PiRpcExtensionUIResponse 三变体联合 | 无联合类型 | 合并 struct + has_value/has_confirmed/cancelled 标志
backends/pi/src/runtime/piRpcProtocol.ts:82-166 | interface 集合（MessageContent/AssistantMessageEvent/Usage/SessionMessage/Event）含 unknown/索引签名 | 动态 JSON 无静态对应 | 已知标量字段旁置提取，其余整体存 JSON 文本缓冲
backends/pi/src/runtime/piRpcProtocol.ts:165-200 | class PiLineFramingBuffer（private 无界 string buffer）+ string[] 返回 | 无类、无界字符串、动态数组返回 | 定长 65536 字节缓冲 struct + 函数族，行提取只计数、调用方缓冲延后
backends/pi/src/runtime/piRpcProtocol.ts:207-221 | JSON.parse + typeof 检查 + try/catch | 无 JSON AST/异常 | 保留原文入 raw_json，kind 暂记 3（通用事件），真实解析延后 sa_json 层
backends/pi/src/runtime/piRpcProtocol.ts:224-233 | JSON.stringify(cmd) + "\n" | 无 JSON 序列化器 | 复制 raw_json 长度 + 1 近似
backends/pi/src/runtime/piRpcProtocol.ts:238-243 | 三个 RegExp replace（sk-/Bearer/api-key 脱敏） | 无正则引擎 | sanitize_pi_rpc_text 字节扫描桩，原样复制、未脱敏

## runtime/piRpcProcessManager.ts → piRpcProcessManager.sla
backends/pi/src/runtime/piRpcProcessManager.ts:22-78 | JS 模板字面量内嵌扩展源码（含 `${id}` 插值） | 模板字面量不能直接作 SLA 字符串字面量 | JS 全文以注释 1:1 保留，常量改为定长字节缓冲 + 长度
backends/pi/src/runtime/piRpcProcessManager.ts:130-202 | import.meta.url/fileURLToPath/process.execPath/process.cwd 路径上溯候选搜索 + console.warn 模板串 | 无模块 URL/可执行路径 API | 搜索顺序以注释 1:1 保留，走查实现延后，返回 null 码
backends/pi/src/runtime/piRpcProcessManager.ts:205-236 | mkdirSync/writeFileSync + JSON.stringify(package.json 对象) | fs 写与序列化延后 | 控制流保留，写入延后至修复期
backends/pi/src/runtime/piRpcProcessManager.ts:247-640 | class extends EventEmitter + ChildProcessWithoutNullStreams 流事件（stdout/stderr data、exit、error、once） | 无 EventEmitter/流 | struct + _on_stdout/_on_stderr/_on_exit/_on_error 回调入口点，emit 改顺序调用注释
backends/pi/src/runtime/piRpcProcessManager.ts:287-295 | pendingCommands: Map<string, {resolve, reject, timer}> 存 Promise 续延 | 无 Map/Promise | 64 槽固定数组（ids/used/count）+ timer id
backends/pi/src/runtime/piRpcProcessManager.ts:300-430 | env 动态对象展开 {...baseEnv, ...overrides} + `??=` 空值赋值 + 字符串 split/trim/startsWith 拼 model 名 | 无动态对象/展开/空值赋值运算符 | env 改 JSON 文本，逐项语义以注释保留
backends/pi/src/runtime/piRpcProcessManager.ts:471-519 | async sendCommand 返回 new Promise（executor + setTimeout ack 超时 + stdin.write try/catch） | async/Promise/定时器 | 同步登记 pending 槽并返回，ack 定时器以 id 近似
backends/pi/src/runtime/piRpcProcessManager.ts:523-600 | stop() 嵌套 setTimeout 升级链（SIGTERM→SIGKILL）+ win32 spawn("taskkill" /T /F) + timer.unref() | 无定时器句柄/进程树杀 API | timer id 槽近似，升级语义以注释保留

## runtime/piRuntimeAdapter.ts → piRuntimeAdapter.sla
backends/pi/src/runtime/piRuntimeAdapter.ts:41-262 | class extends EventEmitter + proc.on(...) 闭包（捕获 proc 身份做过期判定） | 无类/闭包/EventEmitter | struct + pi_runtime_adapter_on_* 入口函数，身份令牌以注释说明
backends/pi/src/runtime/piRuntimeAdapter.ts:40-44 | settlementWaiter { resolve, promise } 手动决议 Promise | 无 Promise | bool 标志 settlement_waiter_active
backends/pi/src/runtime/piRuntimeAdapter.ts:50-52 | updateConfig(Partial<PiRuntimeConfig>) + Object.assign 浅合并 | 无 Partial/对象合并 | 按 updates 的 has_* 标志逐字段复制
backends/pi/src/runtime/piRuntimeAdapter.ts:158-182 | async executeTurn + await sendCommand + `this.process!` 非空断言 | async/非空断言 | 同步化，断言去除并登记
backends/pi/src/runtime/piRuntimeAdapter.ts:198-236 | async interrupt + Promise.race([settledPromise, setTimeout]) 竞争等待 | 无 Promise.race/定时器 | 顺序调用近似，有界轮询延后至修复期
backends/pi/src/runtime/piRuntimeAdapter.ts:238-252 | async getMessages + `(resp as any).messages` 动态响应 + Array.isArray | 动态 JSON 形状 | 返回状态码 + out_count 计数近似，字段提取延后

## runtime/piSessionStore.ts → piSessionStore.sla
backends/pi/src/runtime/piSessionStore.ts:38-156 | RuntimeDatabase（SQLite）exec/prepare().run/get/all 参数绑定 | sa_std 无 SQLite 对应 | db 改不透明 u64 句柄，SQL 原文以注释 1:1 保留，执行全部延后
backends/pi/src/runtime/piSessionStore.ts:60-90 | upsert 的 ON CONFLICT COALESCE + `?? existing ?? null` 合并 + `get(...)!` 非空断言 | SQL 语义/非空断言无对应 | 合并骨架保留（存在性查询 + created_at 沿用），执行延后
backends/pi/src/runtime/piSessionStore.ts:103-107 | getMetadata 返回 Pick<PiSessionRecord, ...> 投影类型 | 无 Pick 工具类型 | out 只承载五个投影字段，注释标明

## runtime/piTurnProjector.ts → piTurnProjector.sla
backends/pi/src/runtime/piTurnProjector.ts:17-27 | PiProjectedEvent 判别联合（9 变体） | 无联合类型 | 单 struct + kind u64 标签（1-9 与源 kind 字符串一一对应）
backends/pi/src/runtime/piTurnProjector.ts:29-64 | PiProjectorContext 四个 Map<string, ...> 字段（activeToolItems/toolContentIndexToId/toolIdAliases/toolRawArguments） | 无 Map | 四组 64 槽平行数组（键/值/长度），槽序保留插入序
backends/pi/src/runtime/piTurnProjector.ts:66-93 | 模板字面量拼 id（`pi-msg-${turnId}-${messageSeq}` 等） | 无字符串插值 | pi_make_item_id 格式化助手延后，id 形状以注释登记
backends/pi/src/runtime/piTurnProjector.ts:100-155 | item 对象字面量组装（reasoning/agentMessage 完成事件）+ `currentAssistantItemId!` 非空断言 | 动态 JSON 对象/非空断言 | 事件槽只记 kind，item JSON 组装延后至修复期
backends/pi/src/runtime/piTurnProjector.ts:157-727 | projectPiMessage switch + `(evt as {...})` 强转 + 动态 JSON 字段深挖（partial.content[contentIndex] 等）+ Map get/set + JSON.parse 增量解析 try/catch | 无 as 强转/动态 JSON/Map | 每个 case 的控制流以注释 1:1 记录，字段提取延后 sa_json 层，Map 操作映射到槽数组
backends/pi/src/runtime/piTurnProjector.ts:729-845 | toPiNotification 对象字面量通知组装（嵌套 turn 对象、usage 强转） | 动态 JSON | 返回 bool 表示 null/非 null，JSON 组装延后
backends/pi/src/runtime/piTurnProjector.ts:全文件 | Date.now() 时间戳（completedAt/startedAt） | 无直接时钟绑定 | pi_now_seconds extern 占位（暂返回 0）

## runtime/piBridge.ts → piBridge.sla
backends/pi/src/runtime/piBridge.ts:48-651 | class PiBridge extends EventEmitter implements CodexRuntimeClient + Map<string, PiSession> sessions | 无类/Map/EventEmitter/接口 | struct + 32 槽会话数组 + 线性扫描查找（键字节比较延后）
backends/pi/src/runtime/piBridge.ts:30-35 | PiBridgeOptions 函数类型字段（resolveRelayConfig 返回 Promise、loadSnapshot/onSnapshot/loadMetadata 回调） | 函数类型不能作 struct 字段 | 改为宿主回调 id（u64）+ has_* 标志
backends/pi/src/runtime/piBridge.ts:全文件 | JsonValue / Record<string, any> / `(x as any)` 动态 JSON 读写 | 无动态 JSON 类型 | 全部改 JSON 文本缓冲，已知字段旁置提取，字段访问延后 sa_json 层
backends/pi/src/runtime/piBridge.ts:212-650 | async request(method) 字符串 switch 分发九个 case + 动态 record 字段 typeof/trim 守卫 | 无字符串 switch/async | 每 case 拆为独立 pi_bridge_req_* 函数，分发以注释列明，request 本体只做分发说明
backends/pi/src/runtime/piBridge.ts:460-520 | turn/start 中 `void runtime.executeTurn(...).catch(闭包)` 后台 Promise + RegExp /spawn|ENOENT|.../ 错误分类 + 模板串拼 executionPrompt | 无 Promise/闭包/正则 | 后台轮改轮询近似（修复期），正则改子串扫描，拼串语义以注释保留
backends/pi/src/runtime/piBridge.ts:全文件 | randomUUID() / Date.now() / process.cwd() Node API | sa_std 无直接对应绑定 | host uuid/clock/cwd extern 占位并逐处登记
backends/pi/src/runtime/piBridge.ts:247-300 | thread/read 中对象展开 {...metadata} + turns.map/filter 闭包组装 | 动态 JSON/闭包 | JSON 文本组装近似，映射语义以注释 1:1 保留
backends/pi/src/runtime/piBridge.ts:164-196 | wireRuntimeEvents 中 runtime.on("notification", 闭包) 捕获可变 session 状态 + (params as any) 深挖 | 无闭包/动态 JSON | 改 pi_bridge_wire_runtime_events 入口函数按会话槽操作，分发延后 sa_json
backends/pi/src/runtime/piBridge.ts:310-322 | thread/turns/list 调 SDK pageThreadHistory + bootstrapProjectSaVmAssets（thread/start 内）宿主函数 | 无 SDK 宿主函数对应 | 经宿主回调在修复期接入，本期只登记调用点
