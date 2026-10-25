# backends-c 单元缺陷汇总（grok / pi / muse / mini）

转换文件数：44（grok 10 + pi 9 + muse 9 + mini 16）；源总行数：25,531；缺陷日志条目：328（grok 93 + pi 51 + muse 85 + mini-bridge 30 合并条目（原始命中 3,202）+ mini-rest 69）；代码内 // DEFECT: 标记共 2,839 处（grep 核验）。只转换未修复未编译。

---

## 分片：backends-c-grok

# 缺陷日志 — 单元 backends-c-grok（backends/grok，CXU plugins @ f2cb649d）
# 格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似
# 源总行数 3806（10 个 .ts），转换产物 10 个 .sla 与源文件并排。

backends/grok/src/manifest.ts:5-6 | JSON import assertion `import ... with { type: "json" }` | SLA 无 JSON 模块导入 | plugin.json 作外部 JSON 文本缓冲运行时加载
backends/grok/src/manifest.ts:5-8 | PluginManifest 类型导入 + `as PluginManifest` 断言 | SDK 类型无 SLA struct、类型断言无等价物 | GrokManifest struct 持 JSON (ptr,len)，断言丢弃
backends/grok/src/server.ts:1-11 | SDK 接口类型导入 (EngineHandle/EngineStatus/PluginInstallation/ServerHost/ServerPlugin) | 接口类型无 SLA 对应 | 本地 struct + JSON 缓冲建模
backends/grok/src/server.ts:21-37 | class implements 接口 + `#status` 私有字段 | SLA 无类/私有字段/接口实现 | struct + &Struct 首参函数族，字段公开
backends/grok/src/server.ts:25-31 | async start/stop 返回 Promise | SLA 无 async/Promise | 同步函数 + 状态码 + out 参数
backends/grok/src/server.ts:35-37 | async handleRpc + throw Error + Promise<unknown> | 无异常、无 unknown 类型 | 返回错误码 1 + 错误文本缓冲
backends/grok/src/server.ts:39-58 | ServerPlugin 对象字面量（含嵌套 cliSettings/discovery） | 无对象字面量类型 | 扁平化为 GrokServerPlugin struct 常量字段 + 函数
backends/grok/src/server.ts:47 | 箭头函数属性 `matchesKind: () => true` | 闭包/函数值无等价物 | 独立普通函数
backends/grok/src/server.ts:52-54 | async findInstallations 返回 Promise<PluginInstallation[]> | 无 async、无动态数组 | 同步函数返回计数 0
backends/grok/src/runtime/grokCompatibleProtocol.ts:14-97 | 可选字段接口群（GrokUsage/各 Event 接口） | 可空字段无原生表达 | has_* 标志 + (ptr,len)/数值字段逐一建模
backends/grok/src/runtime/grokCompatibleProtocol.ts:22-97 | rawInput/content/locations/modelUsage: Record<string, unknown>/unknown[] | 动态 JSON | JSON 文本缓冲 (ptr,len)
backends/grok/src/runtime/grokCompatibleProtocol.ts:44-45 | tools/commands: string[] | 变长字符串数组无定长表达 | JSON 文本缓冲
backends/grok/src/runtime/grokCompatibleProtocol.ts:86-97 | 判别联合 GrokEvent + 索引签名 `{ type: string; [key: string]: unknown }` | SLA 无联合类型/索引签名 | kind 标签 struct + 原始 JSON 行缓冲
backends/grok/src/runtime/grokCompatibleProtocol.ts:104-113 | JSON.parse + try/catch + typeof/`in` 运行时检查 | 无异常流、无动态类型探查 | found 标志 + sa_json_has_key 探查近似
backends/grok/src/runtime/grokSessionStore.ts:1 | RuntimeDatabase 宿主注入类型 | SDK 数据库句柄无 SLA 类型 | 不透明句柄 u64 + extern 风格 SQL 调用
backends/grok/src/runtime/grokSessionStore.ts:38-55 | 类构造器副作用（CREATE TABLE）+ 模板字面量 SQL | 无构造器、模板字面量无插值（此式无插值但为多行模板） | GrokSessionStore_new 初始化函数执行字面 SQL
backends/grok/src/runtime/grokSessionStore.ts:57-91 | `??`/`?.` 链（input.x ?? existing?.x ?? null）+ 非空断言 `!` | 无空值合并/可选链/非空断言 | has_* 显式检查，末次 get 以 found 标志返回
backends/grok/src/runtime/grokSessionStore.ts:100-105 | Pick<GrokSessionRecord, ...> 映射类型 | 无映射类型 | 同 struct 仅填五字段近似
backends/grok/src/runtime/grokSessionStore.ts:121-126 | GrokSessionRecord[] 返回 + rows.map(箭头闭包) | 动态数组 + 高阶函数闭包 | 定长数组容量 256 + 计数，映射改为显式循环（修复阶段）
backends/grok/src/runtime/grokCompatibleProbe.ts:1-3 | node:fs/path/child_process 导入 | Node API 无 sa_std 1:1 对应 | fs/env/process extern 风格调用逐处标注
backends/grok/src/runtime/grokCompatibleProbe.ts:11-16 | NodeJS.ProcessEnv 参数 + join + existsSync | env 映射类型与路径 API 缺失 | env 以句柄/JSON 缓冲传入，拼接后 exists 探查
backends/grok/src/runtime/grokCompatibleProbe.ts:25-63 | pluginHostServices() 服务定位（getPreferredCliBinary/getCachedLatestCliPath/enumerateCliCandidates） | 宿主服务定位无 SLA 等价物 | 具名 extern 探查返回 found 标志
backends/grok/src/runtime/grokCompatibleProbe.ts:25-63 | Array<string|undefined> fallbacks + spread `...nvmGrokBinDirs(...)` + `candidates[0]!` | 数组展开/空洞/非空断言无等价物 | 定长数组容量 32 + len 按源顺序显式探查
backends/grok/src/runtime/grokCompatibleProbe.ts:65-76 | readdirSync(withFileTypes) + filter/map 箭头闭包 + try/catch | 目录项对象与高阶函数缺失 | extern 目录迭代，失败以状态码归零
backends/grok/src/runtime/grokCompatibleProbe.ts:81-106 | spawnSync（encoding/timeout/windowsHide 选项） | 同步子进程 API 无对应 | spawn extern 返回 status/stdout/stderr 缓冲
backends/grok/src/runtime/grokCompatibleProbe.ts:81-106 | 正则版本提取 output.match(/(\d+\.\d+\.\d+)/) | SLA 无正则引擎 | 数字/点字节扫描（修复阶段落地）
backends/grok/src/runtime/grokCompatibleProbe.ts:90 | 对象展开合并 env `{ ...process.env, ...env }` | 动态对象展开无等价物 | 调用方构建合并后的 env 缓冲
backends/grok/src/runtime/grokCompatibleProbe.ts:100-105 | catch 中 `error instanceof Error` 收窄 | 无 instanceof | 直接取 extern 错误文本缓冲
backends/grok/src/runtime/grokCompatibleProbe.ts:111-142 | string[] 动态 push 构建 argv | 变长数组 | 定长数组容量 16 + argc（源最大用量核算）
backends/grok/src/runtime/grokCompatibleProbe.ts:147-157 | NodeJS.ProcessEnv 返回（动态字符串映射）+ 展开合并 | 动态对象 | env JSON 文本缓冲，CI/FORCE_COLOR 合并后强制写入
backends/grok/src/runtime/grokCompatibleProcessManager.ts:18-28 | class extends EventEmitter + ChildProcessWithoutNullStreams 句柄 | 无类继承/EventEmitter/子进程类型 | struct + 不透明句柄 u64 + emit 分发函数
backends/grok/src/runtime/grokCompatibleProcessManager.ts:30-70 | spawn stdio 管道 + readline createInterface 行切分 | readline 无 sa_std 对应 | stdout 字节流上行切分近似（spawn_bidi 风格 extern）
backends/grok/src/runtime/grokCompatibleProcessManager.ts:52-69 | rl.on/child.stderr.on/child.on 闭包订阅（line/data/error/close） | EventEmitter 闭包捕获 | 所有者驱动的 poll/分发函数，保持 rawLine→parse→event 次序
backends/grok/src/runtime/grokCompatibleProcessManager.ts:72-85 | waitForExit: Promise + setTimeout + once("exit") 一次性监听闭包 | 无 Promise/定时器/once | 同步截止轮询返回状态码（修复阶段有界等待循环）
backends/grok/src/runtime/grokCompatibleProcessManager.ts:87-121 | 嵌套 try/catch + 可选链 this.child?.kill + win32 taskkill 分支 | 无异常流/可选链 | 直接 kill extern，状态忽略（与源吞错语义一致）
backends/grok/src/runtime/grokCompatibleRuntime.ts:24-30 | class extends EventEmitter | 无类继承/EventEmitter | struct + 函数族，事件改显式分发
backends/grok/src/runtime/grokCompatibleRuntime.ts:36-38 | Record<string,string> 参数 setEnvOverrides | 动态对象 | JSON 文本缓冲
backends/grok/src/runtime/grokCompatibleRuntime.ts:40-42 | Partial<GrokRuntimeConfig> + Object.assign 动态赋值 | 无 Partial 映射类型/动态 assign | 全量 config + 字段在场掩码逐字段应用（修复阶段）
backends/grok/src/runtime/grokCompatibleRuntime.ts:44-46 | `this.ctx?.sessionId ?? this.config.sessionId` 可选链+空合并 | 无可选链/空合并 | has_* 显式分支
backends/grok/src/runtime/grokCompatibleRuntime.ts:48-115 | async executeTurn + await waitForExit | 无 async/await | 同步函数 + 同步 waitForExit 调用
backends/grok/src/runtime/grokCompatibleRuntime.ts:70-108 | proc.on("event"/"stderr"/"exit"/"error") 闭包群（含解构参数 {code, signal, stopping}、闭包捕获可变 stderrOutput） | 闭包捕获可变状态无等价物 | 分发函数 + runtime 上累加缓冲字段，解构拆为独立参数
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:13-22 | GrokProjectedEvent 判别联合（9 变体，item: Record<string, JsonValue>） | 无联合类型/动态 JSON | kind 标签 struct + item JSON 缓冲
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:24-51 | Map<string, Record<...>> activeToolItems + Set<string> emittedTaskStarts | 无 Map/Set | 定长键数组容量 64 + len，(ptr,len) 字节相等键
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:24-51 | JS 字符串累加字段（currentAssistantText 等 += data） | 无可增长字符串 | 定长字节缓冲容量 65536 + len
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:53-93 | 模板字面量 id 生成 `grok-msg-${turnId}-${seq}` | 无字符串插值 | 字节缓冲拼接（修复阶段）
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:98-121 | events.push(...) 输出数组参数 + item 对象字面量 | 动态数组/对象 | 调用方定长数组容量 32 + len out 参数，item 序列化为 JSON 缓冲
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:128-134 | isGrokTaskToolName: 正则 split /[/:._-]{1,2}/ + replace /[_-]+/g + pop()/?? | 无正则引擎 | 末段分隔符字节扫描 + '_'/'-' 字节过滤
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:142-188 | collectGrokSubagentIds: 对动态 JSON 的递归遍历（string/array/object 分派） | 动态 JSON 递归无类型化表达 | sa_json_* extern 遍历 JSON 缓冲递归近似
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:142-188 | 正则全局 exec 循环（subagent_ids?/task_ids? 两种模式 + lastIndex 状态）+ 锚定正则 /^[\w-]{4,128}$/ | 无正则引擎 | 字面键扫描 + [\w-]{4,128} 字节段捕获/校验
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:191-195 | Set 展开 `[...ids]` 返回 string[] | 无 Set/展开 | 定长数组容量 8（源同有 size>=8 上限）+ count
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:197-251 | buildGrokSubagentItem 返回 Record<string, JsonValue>，含条件展开 `{...(childThreadId ? {...} : {})}` 与计算键 `{ [childThreadId]: ... }` | 条件展开/计算属性键无等价物 | JSON 缓冲逐字段条件构建
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:197-251 | JSON.stringify(rawOutput) 包 try/catch + receiverThreadIds[0]! 非空断言 | 无异常流/非空断言 | 序列化状态检查 + length==1 守卫
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:285-560 | projectGrokEvent: switch 判别联合 + 逐 case `event as GrokXxxEvent` 强制转换 | 无联合/类型断言 | 按原始 JSON "type" 字符串字节比较分发，字段同缓冲提取
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:285-560 | 对象展开合并 resolvedInput `{ ...inputObj, ...tool_input }`、updated `{ ...existing, ... }` | 动态对象展开 | JSON 缓冲 merge（修复阶段）
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:470-520 | `[...activeToolItems.values()].some(闭包)` 展开+高阶谓词 | 无展开/some 闭包 | 显式循环判定 unsettledTools
backends/grok/src/runtime/grokCompatibleTurnProjector.ts:562-620 | toGrokNotification 返回 JsonRpcNotification | null + `as unknown as Record<...>` 双重断言 | 无可空返回/双重断言 | found 标志 + 直接构建通知 JSON 缓冲
backends/grok/src/runtime/grokBridge.ts:1-16 | class extends EventEmitter implements CodexRuntimeClient + SDK 宿主函数导入 (bootstrapProjectSaVmAssets/pageThreadHistory) | 无 EventEmitter/接口/宿主 SDK 函数面 | struct + 函数族，通知改显式分发，宿主函数作 extern 调用
backends/grok/src/runtime/grokBridge.ts:18-48 | buildGrokOfficialProvider 返回 ProviderConfig/ChannelGroupConfig 嵌套字面量 + Date.now() | 动态 JSON 字面量 | 1:1 序列化为 JSON 文本缓冲，时间戳由调用方时钟参数填入
backends/grok/src/runtime/grokBridge.ts:50-72 | GrokSessionSnapshot/GrokBridgeOptions：turns 结构体数组、messages: JsonValue[]、可选异步回调 (Promise 返回) 与同步回调字段 | 函数类型字段/动态 JSON/异步回调无等价物 | turns 定长数组容量 256，messages JSON 缓冲，回调改宿主注册回调 id (u64)
backends/grok/src/runtime/grokBridge.ts:74-93 | GrokSession 内部接口含 GrokProxyServer/GrokCompatibleRuntime 对象引用 | 对象引用字段无等价物 | has_* 标志 + 内嵌 struct
backends/grok/src/runtime/grokBridge.ts:95-115 | Map<string, GrokSession> sessions | 无 Map | 定长数组容量 64 + len，threadId 字节相等键
backends/grok/src/runtime/grokBridge.ts:117-133 | async start + 模板字面量版本消息 `Grok CLI v${...} ready` | 无 async/字符串插值 | 同步状态码函数，消息缓冲拼接（修复阶段）
backends/grok/src/runtime/grokBridge.ts:135-160 | stop/deleteSession：Map.values() 迭代 + 可选链 runtime?.interrupt() + proxyServer.stop().catch(() => {}) 即发即弃 Promise | 无 Map 迭代/可选链/Promise catch | 定长数组显式循环，stop 结果按源语义忽略
backends/grok/src/runtime/grokBridge.ts:162-200 | restoreSession：`snapshot.cwd ?? process.cwd()`、turns/messages `?? []` | process.cwd() Node API 与空合并缺失 | cwd extern 取工作目录，has_* 分支
backends/grok/src/runtime/grokBridge.ts:228-275 | wireRuntimeEvents：runtime.on("sessionId"/"notification") 闭包捕获 session 与 this | 闭包捕获无等价物 | runtime 以 session 下标回调 onRuntimeSessionId/onRuntimeNotification 分发函数
backends/grok/src/runtime/grokBridge.ts:240-258 | messages.findIndex(m => m && m.id === item.id) 谓词闭包 + (notif.params as any) 任意动态字段访问 | 高阶谓词/any 动态 JSON | 显式扫描比对 "id" 字段，params 以 JSON 缓冲字段提取
backends/grok/src/runtime/grokBridge.ts:277-325 | async configureSessionProxy 返回 Promise<Record<string,string>|undefined> + await stop + 模板字面量 `${proxyUrl}/v1` | 无 async/动态 env 映射/插值 | 同步函数写 env JSON 缓冲 + has 标志，URL 缓冲拼接
backends/grok/src/runtime/grokBridge.ts:327-690 | async request(method, params?: JsonValue): Promise<JsonValue> 巨型 switch | 无 async/动态 JSON 入出参 | 同步函数，params/result 皆 JSON 缓冲，逐 case 注释保留源逻辑
backends/grok/src/runtime/grokBridge.ts:327-690 | randomUUID() (node:crypto) 生成 threadId/turnId | 加密 UUID API 无对应 | uuid extern（同形字符串）
backends/grok/src/runtime/grokBridge.ts:380-420 | thread/read 返回对象展开 `{ ...metadata, ... }` + turns.map/messages.filter 闭包群 | 动态展开/高阶函数 | JSON 缓冲 merge + 显式循环构建
backends/grok/src/runtime/grokBridge.ts:430-445 | thread/list：Array.from(sessions.values()).map(闭包) + turns[0]?.createdAt ?? Date.now() | Array.from/高阶函数/可选链 | 显式循环 + has 守卫
backends/grok/src/runtime/grokBridge.ts:455-610 | turn/start：throw new Error(属主不符) ×2 + `void runtime.executeTurn(...).catch(闭包)` 后台执行 | 无异常、无后台 Promise 任务模型 | 属主错误以状态码 2 + 错误缓冲返回；后台轮次经 runtime 分发，错误半程独立为 onTurnError 函数
backends/grok/src/runtime/grokBridge.ts:520-560 | for (const item of record.input) 遍历动态 JSON 数组 + 字符串累加 promptText += | 动态 JSON 迭代/可增长字符串 | 下标循环 + 定长缓冲累加
backends/grok/src/runtime/grokCompatibleProxy.ts:1-4 | node:http 导入 + openCodeThreadHeaders SDK 导入 | HTTP 服务器 API 与 SDK 帮助函数无 SLA 对应 | 服务器句柄不透明 u64，帮助函数作 extern 返回 JSON 头缓冲
backends/grok/src/runtime/grokCompatibleProxy.ts:11-29 | GrokProxyConfig：apiKeys: string[]、provider/group 对象字段、wireApi 字面量联合 | 变长数组/动态对象/字面量联合 | apiKeys 定长容量 16，provider/group JSON 缓冲，wireApi 改标签 u64
backends/grok/src/runtime/grokCompatibleProxy.ts:37-46 | buildUpstreamUrl：正则 replace (/\/+$/、/^\/+/) + split("?") 解构 + 模板字面量 | 无正则/数组解构/插值 | '/' 段字节扫描 + '?' 切分 + 缓冲拼接
backends/grok/src/runtime/grokCompatibleProxy.ts:57-93 | normalizeGrokWireApi/resolve*Endpoint：String(value ?? "") 强转、group 可选链取 responseProtocol、`void model` | 动态值强转/可选链 | (ptr,len) + has_group 显式分支，未用参数保留签名
backends/grok/src/runtime/grokCompatibleProxy.ts:95-276 | responsesRequestToChat：全程 Record<string, any> 动态拼装（消息/工具调用/工具输出三类 item 分派、数组 push/unshift、JSON.stringify 参数） | 动态 JSON 拼装无类型化表达 | JSON 缓冲逐字段按源顺序重写（sa_json_* extern）
backends/grok/src/runtime/grokCompatibleProxy.ts:95-276 | randomUUID() 生成 call_id/resp id/tc id（多处） | UUID API 无对应 | uuid extern
backends/grok/src/runtime/grokCompatibleProxy.ts:278-460 | chatResponseToResponses / chatRequestToResponses / responsesResponseToChat：动态 JSON 互转 + `??` 回退链 + 展开 `{ ...payload, model }` 类构造 | 动态 JSON/空合并/展开 | JSON 缓冲重写 + has_* 回退分支
backends/grok/src/runtime/grokCompatibleProxy.ts:462-625 | Anthropic/Gemini 载荷与响应互转四函数：JSON.parse(arguments) 包 try/catch、动态 blocks/parts 拼装 | 无异常流/动态 JSON | 解析状态检查 + { _raw } 回退（与源 catch 一致），缓冲拼装
backends/grok/src/runtime/grokCompatibleProxy.ts:631-660 | class GrokProxyServer：http.Server 字段、url/boundPort getter、Partial 更新 + 展开合并 config | 无类/getter/Partial | struct + 函数族，updateConfig 逐字段按在场掩码应用
backends/grok/src/runtime/grokCompatibleProxy.ts:662-703 | async start/stop：http.createServer 回调 + listen(0) 端口发现 + Promise 化的 close 回调 + 回调 .catch 转 sendGrokError | 无 HTTP 服务器 API/Promise | extern 服务器调用 + handleRequest 分发返回状态码，错误同源路由 sendGrokError
backends/grok/src/runtime/grokCompatibleProxy.ts:705-745 | handleRequest：req/res 对象（method/url/headersSent 等） | Node req/res 类型无对应 | 请求缓冲 + res 不透明句柄，路由分支注释 1:1 保留
backends/grok/src/runtime/grokCompatibleProxy.ts:747-800 | async handleModels：fetch + AbortSignal.timeout(8000) + try/catch 回退 mock + 条件展开数组字面量 | 无 fetch/AbortSignal/异常流/条件展开 | extern 带截止的 GET，状态检查回退，mock 数组条件追加构建
backends/grok/src/runtime/grokCompatibleProxy.ts:802-900 | async handleResponses：readBody + JSON.parse 400 分支 + 多 key 轮换 fetch 循环（Response 对象 ok/status/text） | 无 fetch/Response/异常流 | extern 返回 status/body 缓冲，轮换规则（401/402/429/5xx 换 key）注释 1:1 保留
backends/grok/src/runtime/grokCompatibleProxy.ts:902-1090 | async streamChatToResponses：ReadableStream getReader + TextDecoder 流式解码 + Map<number, ...> toolCallsMap 累积 + try/catch 收尾 | 流读取器/文本解码器/Map 无对应 | chunk 回调 extern 喂同一行缓冲，toolCalls 定长数组容量 32 以 index 为键，状态码传播代替 catch
backends/grok/src/runtime/grokCompatibleProxy.ts:1092-1260 | forwardDirectResponses / forwardChatToChatUpstream：流式原始字节透传 reader 循环 + 空 catch {} | 流 API/吞错 catch | extern 透传循环，失败按源语义忽略
backends/grok/src/runtime/grokCompatibleProxy.ts:1262-1340 | postUpstreamJson/tryParseJson/upstreamErrorMessage：fetch 循环 + try/catch JSON 解析 + `?.error` 动态取字段拼消息 | 无 fetch/异常流/动态字段 | extern + 解析状态，{ _raw } 回退与源一致
backends/grok/src/runtime/grokCompatibleProxy.ts:1340-1560 | forwardChatToResponsesUpstream / forwardChatToBufferedUpstream / forwardResponsesToBufferedUpstream / fetchBufferedChatFromUpstream：缓冲式跨协议转发 + 结果对象上的 __upstreamError/__status 动态标记属性 + 解构剔除 | 动态标记属性/解构无等价物 | 标记拆为独立 out 字段（error 缓冲 + status）
backends/grok/src/runtime/grokCompatibleProxy.ts:1562-1643 | emitChatStreamFromComplete：forEach 闭包逐 tool_call 写 SSE 块 + 模板字面量 `data: ${JSON.stringify(...)}\n\n` 帧 | 高阶闭包/插值帧格式 | 显式循环 + 缓冲拼帧写 extern
backends/grok/src/runtime/grokCompatibleProxy.ts:1592-1643 | streamChatToResponsesFromComplete：声明 async 但无 await + 死变量 chatJson 构建后 void 丢弃 | 异步外壳/死代码 | 同步函数，死代码以注释保留 1:1 保真
backends/grok/src/runtime/grokCompatibleProxy.ts:1643-1643 | 文件尾 helper 群 sendJson/sendSseEvent/sendGrokError/readBody：Buffer.from/Buffer.concat、JSON.stringify(data, null, 2) 美化、for await...of 请求流异步迭代、res.headersSent 探查 + 空 catch | Buffer/异步迭代/异常流无对应 | JSON 缓冲构建（长度即 Content-Length），请求体由服务器 extern 累积为单缓冲，写失败按源语义忽略

## 分片：backends-c-pi

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

## 分片：backends-c-muse

# backends-c-muse 单元缺陷日志（backends/muse）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似
共 85 条独立缺陷（代码内 `// DEFECT:` 标记 87 处，其中 museSkillPreload 2 处为交叉引用同一缺陷，不重复计数）。

## src/manifest.ts

- backends/muse/src/manifest.ts:5-8 | JSON module import `import manifestJson from "../plugin.json" with { type: "json" }` + `as PluginManifest` 结构化 cast | SLA 无 JSON 模块导入与结构化类型 cast | manifest 保存为 ../plugin.json 原始 JSON 文本，运行时以 sa_json_parse 解析为 doc 句柄

## src/server.ts

- backends/muse/src/server.ts:20-36 | class MuseEngine implements EngineHandle + `#status` 私有字段 | SLA 无 class/interface/私有字段 | struct + 以 &Struct 为首参的函数族，字段平铺为 (ptr,len)
- backends/muse/src/server.ts:24-27 | async start(): Promise<EngineStatus> | SLA 无 Promise/async | 同步 fn 返回状态码，结果 EngineStatus 读 self.status_* 字段
- backends/muse/src/server.ts:28-31 | async stop(): Promise<void> | SLA 无 Promise/async | 同步 fn 返回状态码
- backends/muse/src/server.ts:33-35 | async handleRpc(): Promise<unknown> + throw Error | SLA 无异常、无 unknown 返回 | 返回错误码 1，out 参数未用
- backends/muse/src/server.ts:38-56 | ServerPlugin 对象字面量含函数属性（discovery.matchesKind 箭头函数、createEngine 等） | SLA struct 字面量不能持有闭包 | 描述数据作 struct 字段，每个函数属性拆为自由 fn
- backends/muse/src/server.ts:52-54 | async findInstallations(): Promise<PluginInstallation[]> | SLA 无 Promise/动态数组返回 | 同步 fn + out_count=0（源返回 []）

## src/runtime/museSkillPreload.ts

- backends/muse/src/runtime/museSkillPreload.ts:15 | async loadMuseSaVmSkill(...): Promise<MusePreloadedSkill> | SLA 无 Promise/async | 同步 fn 返回状态码，结果写入 out 参数
- backends/muse/src/runtime/museSkillPreload.ts:15-19 | 可选参数 threadId?: string + `threadId?.trim()` 真值判断 | SLA 无可选参数/可选链 | threadId 以 (ptr,len) 传入，len 0 表示缺省；trim 未执行
- backends/muse/src/runtime/museSkillPreload.ts:21-27 | node:fs/promises readFile + try/catch 以 ErrnoException.code === "ENOENT" 分支 | sa_std 无异步 fs、无异常 | sa_std_fs_read 状态码近似：1 约定为 not found（ENOENT），其余错误返回状态 2
- backends/muse/src/runtime/museSkillPreload.ts:29-30 | RegExp frontmatter 提取与 `name:` 行匹配 /^name:\s*["']?sa-vm["']?\s*$/m | sa_std 无正则引擎 | 手工字节扫描 "---" 围栏 + 逐行 name: 前缀检查（引号/空白容差不完整）
- backends/muse/src/runtime/museSkillPreload.ts:33 | Buffer.byteLength(content, "utf8") > 256 * 1024 | 无 Buffer API | 以读入缓冲的原始字节长度代替（与 UTF-8 字节长一致）
- backends/muse/src/runtime/museSkillPreload.ts:25-39 | throw Error（malformed / 超限 / missing 三处） | SLA 无异常 | 不同非零状态码区分：3=malformed、4=超 256 KiB、5=missing
- backends/muse/src/runtime/museSkillPreload.ts:19 | node:path join(cwd, ".agents", "skills", "sa-vm", "SKILL.md") | sa_std 无 path join/normalize | 字节拼接 + "/" 分隔符近似

## src/runtime/museSessionStore.ts

- backends/muse/src/runtime/museSessionStore.ts:39-56 | class + constructor(private readonly db: RuntimeDatabase) 构造注入并 exec 建表 | SLA 无 class/构造注入 | struct + MuseSessionStore_new 首参设 db 并执行 CREATE TABLE
- backends/muse/src/runtime/museSessionStore.ts:40-145 | 模板字符串 SQL + db.exec/prepare().run/get/all | sa_std 无 SQLite 预处理语句 API 面 | SQL 文本逐字保留经 STR_PTR/STR_LEN 传占位 extern sa_db_*
- backends/muse/src/runtime/museSessionStore.ts:94-103 | `input.x ?? existing?.x ?? null` 空值合并链 + `this.get(...)!` 非空断言 | SLA 无 ??/?. 运算符 | has_* 标志显式选择；最终 get 假定成功，缺行返回状态 1
- backends/muse/src/runtime/museSessionStore.ts:83 | Date.now() | sa_std 无同名 API | sa_std_time_now_ms extern 近似
- backends/muse/src/runtime/museSessionStore.ts:124-128 | Pick<MuseSessionRecord, ...> 映射类型 | SLA 无映射类型 | 填完整 MuseSessionRecord 的被 Pick 五字段
- backends/muse/src/runtime/museSessionStore.ts:141-146 | MuseSessionRecord[] 动态数组返回 + rows.map(mapRow) | SLA 无动态数组/高阶 map | 调用方提供定容数组（cap 1024 行）+ count out 参数
- backends/muse/src/runtime/museSessionStore.ts:148 | private mapRow 方法 | SLA 无可见性修饰 | 函数族内普通 fn

## src/runtime/museHistoryProjection.ts

- backends/muse/src/runtime/museHistoryProjection.ts:25 | type JsonRecord = Record<string, unknown> 动态对象 | SLA 无动态对象类型 | 解析后 JSON 以文本缓冲保存，经 sa_json_* 按键访问
- backends/muse/src/runtime/museHistoryProjection.ts:27-29 | interface NativeMuseThreadEntry extends JsonRecord | SLA 无 interface 继承 | struct 仅保留 id 的 (ptr,len)，其余字段在 json 缓冲中
- backends/muse/src/runtime/museHistoryProjection.ts:31-49 | process.env 多键读取 + homedir() + [...new Set(dirs)] 去重 | sa_std 无 env map 值类型 | sa_std_env_get extern + 线性去重
- backends/muse/src/runtime/museHistoryProjection.ts:57-69 | try/catch 包裹 existsSync | SLA 无异常 | 状态码分支代替
- backends/muse/src/runtime/museHistoryProjection.ts:80-113 | 动态 JSON 遍历（payload.record ?? record.record 等多层 ?? 链） | 无动态对象遍历语义 | 按源顺序的 sa_json 键路径查找近似
- backends/muse/src/runtime/museHistoryProjection.ts:126-153 | readFileSync + 字符串 slice/split + 逐行 JSON.parse（try/catch 跳过坏行） | 无同步整读+字符串语义；JS length 为 UTF-16 码元而非字节 | 定容字节读 + 逐行 sa_json_parse，失败跳过；字节上限代替码元上限
- backends/muse/src/runtime/museHistoryProjection.ts:148 | RegExp /start|prompt|user|session|init/ 测 payload_type | sa_std 无正则引擎 | 五个备选子串扫描近似
- backends/muse/src/runtime/museHistoryProjection.ts:159-191 | 对象队列 BFS + readdirSync({withFileTypes:true}) + Dirent.isDirectory() | sa_std 无 Dirent API | 定容队列数组（cap 3000，与 visited 上限一致）+ sa_std_fs_readdir 种类标志
- backends/muse/src/runtime/museHistoryProjection.ts:206-255 | Map<string, entry> 去重 + [...values()].sort().slice() | SLA 无 Map/展开/链式数组方法 | 定容数组（cap 500，与 limit clamp 一致）+ 显式排序
- backends/muse/src/runtime/museHistoryProjection.ts:204 | 默认参数 limit = NATIVE_MUSE_LIST_LIMIT | SLA 无默认参数 | 调用方传 0 表示默认 200

## src/runtime/museCompatibleProbe.ts

- backends/muse/src/runtime/museCompatibleProbe.ts:21 | NodeJS.ProcessEnv 参数对象 + 默认参数 env = process.env | SLA 无 env map 值类型 | env 参数丢弃，全部读真实进程环境
- backends/muse/src/runtime/museCompatibleProbe.ts:39-63 | process.platform 运行时判断 + RegExp /muse-bin-.*\.exe$/i + localeCompare 排序 + try/catch | 平台为运行期值、sa_std 无正则与本地化排序 | 平台取宿主 extern 值；正则以首尾字节扫描近似；排序退化为字节序降序（collation 丢失）
- backends/muse/src/runtime/museCompatibleProbe.ts:115-139 | spawnSync({env: {...process.env, ...env}, encoding, timeout: 8000, windowsHide}) + proc.error | sa_std 无 spawnSync 选项对象 | sa_std_process_spawn_sync extern + 8000ms 超时；env 合并不可表达，子进程继承进程环境
- backends/muse/src/runtime/museCompatibleProbe.ts:130-131 | RegExp 版本提取 /(\d+\.\d+\.\d+(?:-R\d+\.\d+)?)/ ?? /(\d+\.\d+)/ | sa_std 无正则引擎 | 数字/点字节扫描，-R 后缀存在时保留
- backends/muse/src/runtime/museCompatibleProbe.ts:141-146 | try/catch + `error instanceof Error ? error.message : String(error)` | SLA 无异常与 instanceof | 状态码 + 错误消息缓冲
- backends/muse/src/runtime/museCompatibleProbe.ts:178-181 | RegExp replace sanitizePathSegment（/[^a-zA-Z0-9._-]+/g、/^-+|-+$/g） | sa_std 无正则引擎 | 显式字节循环：非法字节段折叠为单个 "-" 并剥首尾 "-"
- backends/muse/src/runtime/museCompatibleProbe.ts:184-191 | node:path resolve/relative 归一化（isWithinDir） | sa_std 无 path 归一化 | 对未归一化原路径做前缀比较近似
- backends/muse/src/runtime/museCompatibleProbe.ts:224-272 | options 对象 + 动态 string[] args.push 构建 argv | SLA 无动态数组 | 调用方提供定容 argv 数组（cap 24）+ count out 参数；trim 检查以预 trim 长度近似
- backends/muse/src/runtime/museCompatibleProbe.ts:306-348 | settings.json 动态 JSON 构建/解析（prev 合并、mcpServers 展开） | 无动态对象构建 | JSON 文本缓冲拼装 + sa_json_* 查 prev.schema_version/mcpServers
- backends/muse/src/runtime/museCompatibleProbe.ts:327-346 | symlinkSync + 失败回退 copyFileSync + 嵌套 try/catch | sa_std 无 symlink extern | 仅 copy 近似
- backends/muse/src/runtime/museCompatibleProbe.ts:356-368 | env 对象展开合并 {...baseEnv, ...extraEnv, CI, FORCE_COLOR} | SLA 无 env map 值 | 子进程 env 以键值缓冲组装，CI=1/FORCE_COLOR=0 末尾追加覆盖

## src/runtime/museCompatibleRuntime.ts

- backends/muse/src/runtime/museCompatibleRuntime.ts:37 | 回调字段 onSpawn?: (child) => void | SLA 无闭包 | u64 回调 id，由宿主解析调用
- backends/muse/src/runtime/museCompatibleRuntime.ts:60-63 | interface MuseJsonlRecord { payload?: Record<string, any> } 动态对象 | 无动态对象类型 | 记录保存为 sa_json doc id
- backends/muse/src/runtime/museCompatibleRuntime.ts:72-77 | JSON.parse + try/catch（projectMuseJsonlLine 等多处） | SLA 无异常 | sa_json_parse 状态码代替
- backends/muse/src/runtime/museCompatibleRuntime.ts:118 | interface MuseExecTurnOptionsWithTurn extends MuseExecTurnOptions | SLA struct 不可继承 | turnId_* 字段合并入 MuseExecTurnOptions
- backends/muse/src/runtime/museCompatibleRuntime.ts:149 | class MuseCompatibleRuntime extends EventEmitter | SLA 无继承/EventEmitter | struct + 函数族；事件经 emit 回调 id 投递，"error" 按源规则改名 "runtimeError"
- backends/muse/src/runtime/museCompatibleRuntime.ts:161-175 | async runExecTurn + Promise.finally 清理 this.child | SLA 无 Promise/async | 同步调用，child 在返回前清除
- backends/muse/src/runtime/museCompatibleRuntime.ts:177-201 | ChildProcess 句柄 + Windows taskkill 整树杀进程 + stdin.end() | sa_std 进程 extern 仅按 pid 操作 | sa_std_process_kill(pid) 近似；POSIX 下进程树语义丢失（仅直杀子进程）
- backends/muse/src/runtime/museCompatibleRuntime.ts:213-240 | BFS 对象队列 + readdirSync withFileTypes（findMuseSessionLog / findMuseChildSessionLog） | 无 Dirent API | 定容队列数组 + sa_std_fs_readdir extern
- backends/muse/src/runtime/museCompatibleRuntime.ts:300-306 | Date.parse(ISO recorded_at) + 状态 RegExp /fail|error|cancel/ 等 | 无 Date.parse、无正则 | sa_std_time_parse_iso extern + 子串扫描
- backends/muse/src/runtime/museCompatibleRuntime.ts:289-320 | 动态 item 数组按 id upsert（findIndex + 原位替换/追加） | 消息为动态 JsonValue[] | items 以 JSON 数组文本缓冲保存，按 id 查找 upsert
- backends/muse/src/runtime/museCompatibleRuntime.ts:430-620 | Promise + readline 行流 + setInterval(150ms) 日志轮询 + setTimeout 超时 + child 事件（error/close/stderr data） | SLA 无流/定时器/Promise | 单个阻塞式 spawn extern 驱动轮询循环，日志轮询与超时折入循环；事件相对顺序仅近似
- backends/muse/src/runtime/museCompatibleRuntime.ts:352-620 | emit(event, data) 回调投递（delta/projected/error） | SLA 无回调值类型 | emit_cb id；payload 为 JSON 文本缓冲
- backends/muse/src/runtime/museCompatibleRuntime.ts:370-390 | randomUUID() + Date.now() 拼 prompt 文件名/会话 id | 无同名 API | sa_std extern 近似

## src/runtime/museBridge.ts

- backends/muse/src/runtime/museBridge.ts:24-56 | ProviderConfig/ChannelGroupConfig 对象字面量（buildMuseOfficialProvider） | 动态对象无对应 struct | 整体逐字保存为 JSON 文本，createdAt/updatedAt 构建时填入
- backends/muse/src/runtime/museBridge.ts:69-92 | MuseSessionSnapshot 的 turns 数组 + messages: JsonValue[] | 无定长数组形态 | turns/messages 以 JSON 文本缓冲保存（容量即缓冲容量）
- backends/muse/src/runtime/museBridge.ts:94-99 | MuseBridgeOptions 全回调成员（含 async resolveRelayTarget） | SLA 无闭包 | u64 回调 id + sa_host_callback_* extern
- backends/muse/src/runtime/museBridge.ts:128-132 | session.messages.findIndex(...) 动态数组搜索（upsertMuseSessionItem） | 无高阶数组方法 | JSON 数组缓冲线性扫描比对 "id"
- backends/muse/src/runtime/museBridge.ts:157-174 | applyMuseProjectedBatch 逐事件 try/catch + 动态事件对象 | SLA 无异常 | 逐事件状态检查 + JSON 缓冲
- backends/muse/src/runtime/museBridge.ts:216 | 模块加载期读 process.env.CODEX_MUSE_DISABLE_SA_VM | 无模块初始化语义 | 宿主启动时求值一次写入全局标志
- backends/muse/src/runtime/museBridge.ts:261-277 | class MuseBridge extends EventEmitter implements CodexRuntimeClient + Map 字段（sessions/childLogCache） | 无继承/接口/Map | struct + 函数族；两 Map 为宿主侧以字符串键的 opaque u64 句柄；emit 走 sa_host_emit_notification
- backends/muse/src/runtime/museBridge.ts:280-295 | async start(): Promise<EngineStatus> | 无 Promise/async | 同步 fn 返回状态码
- backends/muse/src/runtime/museBridge.ts:304-307 | async restart()（stop 后 start） | 无 Promise/async | 同步顺序调用
- backends/muse/src/runtime/museBridge.ts:309-311 | async notify(...): Promise<void> 空实现 + respond(...) | 无 Promise | 同步 no-op fn
- backends/muse/src/runtime/museBridge.ts:326 | childLogCache 以 Date.now() 做 5_000ms TTL 缓存 | 无同名 API | sa_std_time_now_ms extern
- backends/muse/src/runtime/museBridge.ts:337-361 | childThreadSnapshot 动态对象拼装（JsonValue cast） | 无动态对象构建 | JSON 文本缓冲输出
- backends/muse/src/runtime/museBridge.ts:390-400 | async resolveRelayTarget（私有异步方法 + ?? 回退链） | 无 Promise/async | 同步宿主回调调用，状态码表示 undefined
- backends/muse/src/runtime/museBridge.ts:402-919 | async request() 对动态 JSON params 的 switch 分发 + turn/start 内 throw Error（中转缺失/未登录） | 无异常、无动态 params 类型 | 状态码 + 错误缓冲；每 case 拆 helper fn 保持源顺序
- backends/muse/src/runtime/museBridge.ts:656-874 | await + 浮动 Promise .then/.catch + EventEmitter .on(runtimeError/delta/projected) 订阅 | 无 Promise/事件订阅 | runtime 同步驱动；then/catch 两分支在 runExecTurn 返回/失败后按源顺序内联执行；通知与调用方的微任务时序与源不同
- backends/muse/src/runtime/museBridge.ts:668 | console.warn 输出 runtimeError | 无 console API | println 到 stderr 近似

## src/runtime/museCompatibleTurnProjector.ts

- backends/muse/src/runtime/museCompatibleTurnProjector.ts:30-39 | MuseProjectedEvent 判别联合类型（8 个 kind 变体） | SLA 无联合类型 | 事件为带 "kind" 字符串字段的 JSON 文本缓冲，kind 以字节比较
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:89 | 模板字面量 `muse-msg-${turnId}-${index}` + 默认参数 index = 0 | 无模板字面量/默认参数 | 字节拼装；调用方显式传 index
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:107-109 | JS 字符串 slice(0, 2000) 按 UTF-16 码元截断（sliceOutputText） | SLA 字符串为字节 | 字节截断（可能在多字节字符中间切断）
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:124-127 | asRecord(value) 动态对象归一（非对象回 {}） | 无动态对象类型 | sa_json doc id，0 表示空对象
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:234 | RegExp replace normToolName（/[_-]+/g + toLowerCase） | sa_std 无正则引擎 | 显式字节循环（删 "_"、"-"，ASCII 小写化）
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:388-398 | RegExp 从 workflow script 提取 host.agent({input: "..."})（含转义处理） | sa_std 无正则引擎 | 字节扫描 "host.agent(" 与 input 键；转义仅处理 \n 与 \"（与源一致范围）
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:401-449 | buildSubagentItem 对象展开 + 计算键 {[childId]: ...} | 无展开/计算键 | item 以 JSON 文本缓冲拼装
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:535-551 | RegExp parseToolOutputRef（两条 call_id/工具名模式） | sa_std 无正则引擎 | 按 "-" 分词扫描 + stdout/stderr/output/result 标记检查近似
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:554-557 | RegExp parseUnknownToolName /unknown tool\s*[`'"]?(...).../i | sa_std 无正则引擎 | "unknown tool" 前缀（不分大小写）字节扫描 + 令牌字符集
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:621-638 | RegExp parseMuseSaVmTrailer /\n\[sa-vm-action (\{.*\})\]\s*$/s（dotAll） | sa_std 无正则引擎 | 后缀扫描最后一个 "\n[sa-vm-action " 标记与结尾 "]"
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:669-683 | RegExp inferMuseToolInput（反引号路径 token + skill 名两条模式） | sa_std 无正则引擎 | 字节扫描近似
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:686-700 | pickToolFields 动态 JSON 多键回退遍历（tool_name/call_id/input/output 等） | 无动态对象遍历语义 | 按源顺序的 sa_json 键查找
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:769-772 | RegExp callIdFromWorkflowRunId /model-tool-(.+)$/ | sa_std 无正则引擎 | "model-tool-" 前缀后缀扫描
- backends/muse/src/runtime/museCompatibleTurnProjector.ts:1027-1568 | projectMuseJsonlRecord 逐行 JSON.parse + 对动态字段的大 switch/分支链 | 无动态字段分发 | sa_json_parse + 键查找；分支顺序以注释逐条保留待修复阶段落码

## 缺陷分类计数（85 条，每条按主类别计一次）

- 动态 JSON / 动态对象 / 对象字面量与展开：17
- Node API 无 sa_std 对应（fs/path/env/process/spawn/symlink/SQL 等）：15
- async / Promise / await：13
- RegExp（sa_std 无正则引擎）：12
- class / interface / 继承 / EventEmitter / 可见性：6
- 字符串语义（UTF-16 切片、模板字面量、默认/可选参数、?? 链）：5
- try/catch / throw / instanceof（无异常机制）：5
- Date.now / Date.parse / randomUUID（时间与 id extern 近似）：4
- 回调 / 闭包（函数值、options 回调、onSpawn、emit）：3
- Map / Set / 动态数组与高阶方法：3
- 泛型/映射类型（Pick<>）：1
- Buffer API：1

## 分片：backends-c-mini-bridge

# 缺陷日志 — backends-c-mini-bridge（批量转换第一波，只记录不修复）

源：CXU plugins @ f2cb649d。范围：backends/mini/src/manifest.ts、backends/mini/src/server.ts、backends/mini/src/runtime/miniBridge.ts。
说明：行内 // DEFECT 与本日志双通道；同类缺陷按行号区间合并登记，条数按合并后计，原始命中数见文末分类计数。
附加结构性缺陷：MiniBridge 类继承 EventEmitter 且 implements CodexRuntimeClient（miniBridge.ts:4640 附近）——SLA 无继承/EventEmitter，近似为 struct + 事件回调字段；server.ts 的 miniServerPlugin 为对象字面量含方法简写——近似为 struct 字面量 + 同名 fn；泛型（如 Array<T>/Record<K,V>/Promise<T>）统一映射 JsonValue/JsonArray；Node API（fs/child_process/crypto/path/events）无 sa_std 逐一对应，保留 extern 形状近似。

backends/mini/src/manifest.ts:6 | JSON module import (import assertion) | SLA has no JSON module imports | manifest JSON kept as external data, loaded via sa_json extern approximation
backends/mini/src/manifest.ts:8 | type assertion (as) | no type assertions in SLA | value used with target struct type directly
backends/mini/src/runtime/miniBridge.ts:334,360,365,380,413,418,435,468,478,480-482,484,492,525,552,582-584,587,589,592,611,614,618,638,645,657,698,700-702,802,820-821,870,893,900,904,914,953,963-964,982-983,988,994,999,1008,1011,1018-1019,1023-1024,1034,1054,1102,1104,1130,1185-1186,1206,1211,1215,1241-1242,1247,1251,1276-1277,1295,1322,1334,1346,1436,1487,1500,1519,1538,1540-1541,1579,1587-1590,1592-1599,1618-1619,1623,1626,1629,1633,1638,1642,1649,1656,1693,1696,1703-1704,1713,1721,1724,1728,1737,1744,1752,1766,1778-1779,1801,1817,1820,1825,1832,1835,1838,1842,1846,1859,1867,1876,1880-1881,1887,1942,1944,1972,1977,1980,1990,1993,1995,2037,2040,2045,2126,2134,2174,2186,2216,2237,2272,2323,2339,2370,2373,2401,2403-2404,2413,2424,2430,2432,2435,2438,2444,2453,2460,2465,2467,2476-2477,2483,2485,2495-2496,2515,2527,2533,2537,2539,2543,2568,2576,2593,2595,2598-2599,2607,2625,2631,2646-2647,2652,2680,2682-2683,2687,2727,2753,2781,2806,2826,2879,2884,2895,2917,2926,2955,2963,2978,2987,3004-3005,3021,3052,3057,3063-3064,3067-3068,3070-3071,3081,3084,3089,3091,3095,3103,3111,3118,3122-3123,3125,3146-3148,3151,3173-3175,3191,3196,3199,3206,3219,3227-3229,3247,3259,3273,3278,3287,3292,3303,3328,3345,3350,3358,3371-3373,3375,3387,3394,3399,3403-3404,3417,3431,3435,3529,3531,3570,3613,3615,3634,3639,3646,3652,3655-3656,3664,3669,3690,3704,3760,3768-3769,3771,3780,3798,3801,3894,3905-3907,3909,4020,4023-4024,4034-4035,4090,4097,4106-4107,4124,4131,4146,4148,4150,4158,4169,4172,4194,4199,4204,4206,4211,4215-4217,4221,4223,4232,4236,4249,4273-4274,4289-4290,4292-4294,4298,4311,4313-4314,4318,4333,4378,4385,4388,4390,4417,4422,4426,4439,4446,4453,4456,4458,4479,4484-4486,4488,4492,4495-4497,4499,4515-4517,4519,4524,4535,4568,4584,4592,4597-4598,4611-4612,4614,4627-4629,4635-4636,4781,4906,4909,5004,5011,5038,5041,5044,5046,5059,5176,5251,5253,5279,5282-5284,5286,5312,5354,5356,5380,5383,5385,5411,5423,5435,5509,5512,5519,5521,5523-5524,5554,5567,5612-5613,5615,5735-5739,5747,5752,5754,5759,5769,5771,5788,5821,5827,5831,5840-5841,5847,5856-5857,5898,5918,5941,5982,5993,6007-6008,6010,6028,6045-6047,6073,6165,6173-6175,6187,6204,6206,6224,6229-6230,6246,6255,6257-6258,6264,6266-6267,6322,6324,6452,6483,6502,6551,6559,6608,6613-6614,6664,6668-6669,6672,6685,6715,6718,6724,6737,6768-6772,6780,6783,6786,6789,6795,6797,6826,6856-6857,6862,6867,6881,6917,6968,6992-6993,7023,7029,7035,7070,7076,7087,7119,7126-7127,7129,7184,7190,7202,7209,7223,7226,7229,7231,7257-7258,7261,7272,7321,7365,7388,7414-7417,7428,7436-7439,7446,7451,7461,7463,7470,7475,7496,7500,7511,7523,7531,7534,7556,7574,7580,7591,7602,7605,7612,7618,7658,7661,7697,7699-7701,7721,7731,7736,7747,7765,7785,7792,7797-7798,7801,7876-7878,7884-7885,7887-7889,7895,7899-7900,7905,7909-7910,7922-7923,7933,7998-7999,8084,8094,8133,8164-8165,8190,8238-8239,8255-8256,8265-8266,8271-8272,8305-8306,8326,8337,8373,8375,8414,8422,8441,8444,8502,8512,8539,8551,8601,8603,8658,8668,8676,8695,8702,8763,8804,8914,8925,8931,8949,9016,9029,9049,9056,9059,9061,9075,9083,9130,9138,9156,9165,9168,9175,9234,9243,9253,9264,9267,9273,9276-9277,9279,9295-9296,9304,9312-9313,9345-9346,9352,9366-9367,9376,9389,9404-9405,9416-9417,9435-9436,9449-9450,9460-9461,9473-9474,9478,9481-9482,9494-9495,9510,9518,9521-9522,9541-9542,9555,9595,9610,9618,9620,9624,9679,9685-9686,9689,9693,9697-9698,9753,9770,9779,9782-9785,9835,9852,9870,9872,9880,9890,9898,9900,9942,9951,9955,9958,9960,9966-9967,9979-9980,9988,9991-9992,10005-10006,10032,10037,10042,10045,10051-10052,10056-10057,10070-10071,10083-10084,10090-10091,10097-10098,10107,10117,10130,10140,10143,10148,10161,10172,10176,10178,10201,10204,10207-10208,10211,10214,10219,10221,10224,10227,10232,10240,10242,10249,10274,10277 | JS Array/String method | no 1:1 sa_std method | kept call shape as helper-fn approximation
backends/mini/src/runtime/miniBridge.ts:251,327-328,361,364,375,379,413,418,435,468,478,480-481,484,492,504,510,515-516,525,533-534,552,576,606,640,656,672,678,686,700,731,736,739,1253,1275,1277,1281-1282,1286,1290,1309,1346,1360,1375,1399,1411,1458,1465,1472,1487,1500,1535,1538,1551,1553,1565,1578,1583,1618-1619,1648,1656,1710,1721,1762,1778-1779,1807,1827,1875,1945-1946,1977,1980,1990-1991,1993,2024,2030,2043,2052,2060,2147-2148,2151,2174,2187,2308,2312,2322,2370,2412,2424,2444,2450,2453,2465,2494-2495,2505,2510,2514,2527,2533,2535,2537-2538,2597,2606,2641,2645,2751-2752,2780,2977,3022,3052,3057,3063-3066,3070-3071,3078,3081,3084,3091,3098,3101,3110,3117,3146-3148,3151,3170,3173-3175,3182,3239,3245,3250,3252,3254,3259,3265,3322,3327,3343,3358,3369,3371-3373,3396,3411,3415,3611,3619,3656,3691-3693,3808,3813,3894,3905,3924,3951,3973,3995,3997-3998,4010,4012,4021,4032,4074,4192,4273,4286,4311,4314-4315,4339,4410,4416,4507,4509,4526-4527,4619,4635,4678,4696,4702,4705,4731,4735,4739,4746,4889,4891-4894,4899-4907,4909,4951,5048,5060,5175,5279,5282-5283,5289,5295,5302,5307,5314,5350,5380,5386,5398,5411,5423,5431,5435,5437-5438,5440-5441,5459,5517,5530,5539-5541,5546,5593,5629,5684,5733,5736,5738,5759,5773,5782-5783,5840-5841,5843,5849,5851,5856-5857,5863-5864,5880,5898-5901,5915-5918,5961-5962,6070,6073-6074,6108,6134,6141,6161,6165,6174-6175,6183,6187,6219,6229,6255,6257,6264,6266,6269,6271,6273,6699,6847,7035,7258-7260,7363,7366,7412,7415,7417,7434,7437,7439,7458,7468-7469,7529,7555,7589,7602,7605,7887,7905,8019,8220,8358,8383,8387,8390,8395-8396,8403,8405,8407-8408,8429-8430,8432-8433,8501,8586,8618,8622-8623,8629,8631,8636,8642,8651,8683,8688,8751,8913,8976,9079,9083,9090,9097,9100,9110,9121,9152,9233,9253,9265,9585,9604-9605,9608,9614-9615,9740-9741,9750,9763-9764,9782,9936,9951,9955,9958,10019,10052,10136,10138,10167,10191,10203-10204 | runtime type test (typeof/instanceof/in) | no runtime reflection in SLA | tag-field check approximation
backends/mini/src/runtime/miniBridge.ts:53,328-329,584,587,589,611,614,821,952,982,991,1011,1018,1033-1034,1041,1050,1053,1070-1071,1295-1296,1522,1527,1531,1578,1592-1596,1598,1615,1623,1626,1633,1638,1642,1649,1972,2371,2375,2382,2385,2387,2430,2432,2460,2476-2477,2483,2491,2494,2496-2498,2500-2501,2504-2505,2515,2518,2521,2585,2595,2598-2599,2607,2625,2631,2647-2648,2652,2657,2659-2660,2680,2687,2696,3200,3207,3210,3217,3220,3222,3227,3229,3289,3322,3395-3397,3434,3444,3536,3590,3656,3658,3740,3769,3771,3773,3776,3811,3816,3851-3853,3914,3998,4019,4030,4074,4174,4177,4180,4230,4233,4255,4259-4260,4269,4426,4543,4561,4610,4612,4690,4834,4943,5005,5011,5021,5034,5048,5081,5092-5093,5120,5130-5131,5146,5148,5176,5196,5218,5286,5314,5354,5356,5372,5383,5385,5398,5475,5482,5487,5492,5536,5560,5602,5609,5611,5632,5735,5747,5831,5848,5886,5891,5912,5920,5947,5986,6006,6185,6189,6196,6260,6280,6337,6368,6374,6381,6496,6501,6505,6576,6581,6612,6617,6660,6690,6699,6702,6708-6716,6723,6772,6774,6780,6789,6791,6795,6818,6825,6834,6849,6851,6991,6995,7125,7226,7228,7231-7232,7258,7272,7297,7321,7365,7370,7414,7426,7436,7443,7461,7531,7574,7577,7580,7591,7643,7652,7736,7776,7801-7802,7846-7848,7866,7875,7878-7879,7917,8058-8059,8084,8091,8107,8191,8258,8267,8273,8289,8296,8307,8326,8330,8372-8373,8464,8488,8502,8549,8551,8558,8600-8601,8658,8662,8722,8772-8773,8791,8827,8874,8898,8914,8918,8931,8938,9001,9016,9018,9024,9029,9044,9049,9056,9058-9059,9075-9076,9089,9098,9201,9234,9264,9274,9347,9418,9437,9451,9462,9475,9483,9496,9523,9610,9649,9693,9698,9700,9753,9790,9811,9818-9819,9851-9852,9889,9899,9906,9908,9915,9921,9936,10024,10058,10069,10072,10085,10092,10117,10119,10148,10150,10191,10213,10220,10236,10252 | template literal interpolation | no template literals in SLA | string concatenation approximation
backends/mini/src/runtime/miniBridge.ts:59-60,66-67,69-73,75-76,272,301,308,312-313,334,360,481,584,587,611,614,700-702,738,900,904,914,982-983,1008,1024,1102,1247,1251,1274,1295,1538,1540,1579,1587-1590,1617,1619,1629,1656,1691,1777,1779,1782,1803,1817,1825,1832,1835,1859,1880-1881,1944,2040,2186,2272,2401,2403-2404,2446,2460,2465,2515,2527,2532,2537,2539,2543,2646,2753,2895,2917,3021,3027,3068,3146-3148,3151,3196,3199,3217,3227-3228,3273,3278,3345,3387,3394,3403-3404,3431,3435,3652,3656,3669,3690,3704,3768,3907,3909,4020,4031,4053,4058,4062,4314,4390,4439,4458,4463-4464,4545,4555,4592,4611,4635,4643,4656,4659,4666,4693,4699,4781,4909,4937,4940,5041,5044,5189,5215,5279,5326,5338,5342,5346-5347,5362,5375,5509,5512,5518-5519,5521,5523-5524,5584,5620,5685,5746,5754,5769,5771,5788,5807,5809,5827,5847,5852,5941,6015,6019,6030,6061,6173-6174,6224,6246,6321-6322,6324,6384,6452,6483,6559,6608,6614,6664,6676,6684-6685,6725,6758,6768-6769,6783,6797,6904,7106,7111,7155,7257,7286,7288,7296,7337,7339,7470,7474-7475,7511,7603,7637,7661-7662,7690,7692,7697,7721-7722,7736,7791-7792,7797-7798,7801,7849,7878,7884-7885,7887-7889,7905,7964,8018,8027,8083,8086,8100,8113,8126,8136,8151,8163,8175,8177,8194,8228,8276,8313,8328,8337,8359,8362,8364,8377,8411,8470,8503,8534,8539,8555,8587,8590,8592,8607,8661,8728,8745,8804,8816,8844,8854,8866,8889,8915,8936,8942,8949,8959,8977,8980,8982,9014,9028,9048,9064,9126,9156,9168,9207,9235,9264-9265,9273,9352,9389,9510,9553,9580,9609-9610,9618,9620,9624,9677,9685,9689,9692,9697,9753,9782-9785,9898,9934,9951,9954,9958,9979,10052,10131,10139,10162,10171,10176-10178,10203-10204,10227,10232,10249 | arrow function / closure | SLA has no closures capturing mutable state | kept as named-fn reference or inline approximation
backends/mini/src/runtime/miniBridge.ts:45-46,327,362,367,376,475,491,503,577,607,671,677,685,737,739,1040,1248,1251-1252,1256,1261,1280,1285,1491,1496-1497,1501,1537,1539-1540,1550,1565,1580,1585,1613,1619,1622-1623,1625-1626,1630,1637,1700,1719,1738,1740,1779,1789,1791,1793,1823,1857,1877,1946,1979,1992,2019,2022-2023,2036,2041,2049,2160,2188,2197,2200,2204,2312,2437,2442,2444,2451,2453,2460,2464,2493,2497,2508-2513,2521,2544,2562,2591,2639-2644,2656,2658,2664,2669,2728-2729,2875,2902,3021-3022,3060-3061,3065,3074,3133,3146-3148,3176,3183,3200,3205,3210,3217,3219,3222,3224,3240,3246,3255,3266,3328,3342,3344,3370,3410,3413-3414,3437,3470,3479,3610,3620,3797,3805,3925,3995,4012,4022,4033,4193,4243,4245,4314,4408,4415,4417,4426,4437,4439,4445-4446,4450,4458,4508,4740,4743-4744,4747,4924,5181,5301-5302,5360,5373,5407,5416,5419,5427,5431,5453,5474,5478,5486,5514,5525,5535,5542,5548,5567,5585,5589,5596,5607,5612,5621,5625,5657-5658,5679,5683,5718-5719,5728,5772,5775,5779,5785,5795,5799,5828,5837,5844,5853,5860,5961,5993,6000,6007,6015-6016,6020,6024,6031,6035,6041,6060,6062,6066,6072,6075,6130,6136-6137,6157,6163,6173,6179,6204,6215,6252,6261,6278,6321,6502,6613,6668,6677,6726,6737,6834-6835,6861,6992,7002,7107,7126,7167,7238,7280-7281,7334,7635,7656,7714,7799,7823,7828,7831,7846,7887,7899-7900,7906,7909-7910,8094,8387-8388,8406,8432-8433,8548,8614,8619,8630,8650,8657,9073,9095,9107,9117,9156,9168,9248,9265-9267,9274,9590,9594-9595,9601-9602,9665,9679-9681,9686,9688,9692,9696,9779-9780,9782,9838,9849,9890,9942,9949-9950,9970,9978,10037,10177,10203-10204,10206-10208,10221,10228,10230 | type assertion (as) | no type assertions in SLA | value used with target struct type directly
backends/mini/src/runtime/miniBridge.ts:268,273,278,283,289,291,307,309,311-313,1101,1103,1105,1109,1184,1188,1224,1226,1525,1528,1563,1566,1978,1982,2398,2406,2782,2785,3068,4103,4274,4471,4474,4502,4542,4585,4589,4615,4651,4730,4750,4768,4770,4778,4782,4800,4802,4807,4809-4810,4812,4937,4940,4943,5017,5034,5047,5165,5167,5169-5170,5172,5181,5183,5189,5215,5263,5265,5280-5281,5286,5311,5313-5314,5334,5336,5381,5383,5385,5388,5390-5391,5393,5395,5397-5398,5403,5405,5412,5424,5475,5482,5487,5492,5536,5551,5584,5602,5620,5632,5639,5664,5671,5691,5693,5713,5715,5732,5735,5742,5747,5750,5807,5842,5848,5858,5866,5886,5891,5912,5929,5947,5997,5999,6015,6019,6030,6037,6043,6061,6185-6186,6189,6192,6214,6236,6256,6260,6265,6276,6280,6676,6684,6688,6691,6700,6703,6760,6762,6780,6795,6799,6803-6805,6813,6941,6943,6950,6952,6983,6986,6999,7001,7089,7106,7164,7166,7497,7501,7512,7539,7597,7637,7657,7671,7681,7690,7694,7705,7720,7849,8212,8366,8370,8372-8373,8382,8412-8413,8415,8445,8450,8458,8461-8462,8464,8496,8551,8594,8598,8600-8601,8611,8662-8664,8666,8669,8685,8703,8708,8716,8719-8720,8722,8835,8892,8906,8908,8984,8988,9014,9028-9029,9048-9049,9056,9058-9059,9069,9127-9129,9131,9176,9187,9195,9198-9199,9201,9228,9247,9249,9590-9591,9599,9622,9634,9664,9666,9712,9819,9821,9848,9855,9867,9899,9906,9923,9936,9977,9981,9989,10000,10010,10017,10020,10101,10113,10134,10165,10190,10196 | exception (try/catch/throw) | SLA uses status codes, no exceptions | status-code approximation, throw -> return error
backends/mini/src/runtime/miniBridge.ts:295,329,394,424,428,449,1271-1272,1628,1634,1643,1652,1655,1804,2017,2168,2272,2275,2315,2344,2359,2401,2528-2529,2542,2968,3243,3298,3530,3615,3751,3849,3881,3897,3900,4053,4075,4288,4327,4370-4371,4433-4434,4544,4640,4643,4656,4670,4677-4678,4680,4683,4687,4692,4698,4704-4705,4707,4709,4943,5034,5078,5165,5170,5280-5281,5286,5314,5346,5381,5383,5385,5391,5393,5398,5412,5424,5475,5482,5487,5492,5521,5536,5551,5602,5632,5637,5662,5689,5732,5735,5742,5747,5750,5754,5808,5842,5848,5858,5866,5886,5891,5912,5927,5947,6185-6186,6189,6192,6234,6256,6260,6265,6276,6280,6371,6755,6780,6795,6804,6813,7016,7062,7286,7337,7536,7594,7608,7671,7681,7697,7720,7728,7789,7797,7875,7986,8001,8056-8057,8212,8312,8345,8354,8372-8373,8412-8413,8415,8445,8462,8464,8470,8503,8551,8577,8582,8600-8601,8662-8664,8666,8669,8685,8703,8720,8722,8728,8816,8844,8854,8866,8889,8915,8957-8958,8972,9029,9049,9056,9058-9059,9127-9129,9131,9176,9199,9201,9207,9235,9567,9571-9572,9579,9634,9692,9821,9867,9899,9906,9923,9989,10101,10110,10196 | JS builtin construction (Map/Set/Date/RegExp/AbortController/Error) | no equivalent sa_std type | JsonValue/buffer approximation
backends/mini/src/runtime/miniBridge.ts:317,504,587,614,1104,1249,1498,1587-1590,1613,1622-1623,1625-1626,1637,1728-1729,1740,1742,1752-1753,1784,1850,1856,1878,2023-2024,2037,2042,2430,2526,2852-2853,3227,3705,3709-3710,3712-3713,3724-3725,3798,3838,3906,4054,4059,4066,4090,4097,4221,4223,4314,4319,4330,4374,4381,4390,4437-4438,4440,4449-4450,4458,4473,4513,4580-4582,4663,4716,4769,4776,4779,4781,4881,4936,4940-4942,4949-4952,5038,5059,5331,5335,5338,5342,5466,5520,5585,5621,5634,5639,5652,5664,5671,5675,5692,5714,5772,5851,5866-5867,5888,5929,6000,6015,6020,6031,6045,6062,6136,6175,6185,6214,6231,6236,6321,6351,6381,6411,6551,6650,6656,6677,6786,6847,6856,6881,6917,6924,6944,6968,7002,7026,7042,7107,7156,7167,7523,7539,7567,7597,7615,7634,7638,7647,7656-7657,7662,7676,7710,7802,7812,7820-7821,7859,7879,7883,7933,8314,8383,8388,8428-8430,8432-8433,8436-8437,8439,8614,8688,8690,8820,8869,8895,9074,9076,9110,9113-9114,9311,9679-9680,9686,9782,9786,9788,9907,9942,9949,9951,9955,9958,10019,10135,10137,10143,10229,10231 | optional chaining ?. | no optional chaining in SLA | explicit null-check approximation
backends/mini/src/runtime/miniBridge.ts:2399,4474,4477,4547,4565,4780,4937,4940,4982,5028,5037,5040,5043,5168,5177,5189,5197,5215,5219,5786,5798,5805,5807,5846,5852,5859,5963,5998,6038,6191,6684,6689-6690,6701,6751,6772,6780,6782,6785,6789,6795-6796,7000,7525,7672,7695-7696,7698,7703,7719,7760,7784,7849,8371,8373,8377,8427,8470,8503,8599,8601,8607,8681,8728,8816,8844,8854,8866,8889,8915,8996,9002,9014,9025,9028,9045,9048,9059,9064,9151,9207,9235,9311,9731,9734,9738,9742,9747,9751,9759,9762,9808,9836,9838,9849,9863,9896,9900,9912,9926,9934,10002,10117,10131,10142,10148,10162,10174 | async/await | SLA has no async/await; converted to synchronous sequential call | await removed, order preserved
backends/mini/src/runtime/miniBridge.ts:1104,1185,1225,1564,1762,1979,2057,2065,2483,2496,2595,2625,2631,2783,3068,3668,3689,4274,4537,4558,4603,4616,5032,5770,6776,6793,7409,7431,7449,7455,7464,7512,7515,7552,7562,7586,7593,7599,7625,7857,8031,8277-8278,8332,8382,8567,8611,8693,8942,9069,9248,9590,9665,10018,10121,10134,10152,10165 | dynamic JSON (JSON.parse/stringify) | dynamic object handled as JSON text buffer | sa_json_* extern approximation
backends/mini/src/runtime/miniBridge.ts:251,4058,4063,4545,4555,4662,4667,4678,4696,4702,4705,4793,4797,4801,4808,4824,4831,4854,4861,5264,5326,6339,6384,6758,6807,6875,6904,7288,7339,8358,8360,8364,8470,8503,8586,8588,8592,8728,8816,8844,8854,8866,8889,8915,8976,8978,8982,9207,9235 | timer | no timer API mapped in this pass | call kept as extern approximation + DEFECT
backends/mini/src/runtime/miniBridge.ts:59-60,76,2396,4465,4534,4656,4788,4817-4818,4935,4976,5001,5346,7155,7251,7286,7320,7337,7690,7692,7714,7717,7719,7784,9567 | Promise | no Promise in SLA | sequential call approximation
backends/mini/src/runtime/miniBridge.ts:53,270,286,1130,2126,2134,2216,2237,4047,4310,4941-4942,4949,5301,5435,5597,5867,5898,6257,6266 | process.* Node API | no direct sa_std counterpart in this pass | extern approximation
backends/mini/src/runtime/miniBridge.ts:421-422,896,3236,3355,3559-3560,3698,3718,3829,4324,7867-7868 | type alias (union/literal) | SLA has no union types | alias mapped to closest SLA type
backends/mini/src/runtime/miniBridge.ts:2396,4461,4531,4788,4817-4818,4935,4970,4994,7247,7314,7692 | async function | SLA has no async; converted to sync fn returning status/value | async keyword dropped
backends/mini/src/runtime/miniBridge.ts:58,81,722,1138,1159,2073,2790,3681,3732 | interface | SLA has no interfaces; structural contract -> struct fields only, callable members become fn pointers approximated as JsonValue | struct declaration
backends/mini/src/runtime/miniBridge.ts:4775,5155,5430,6683,6722,6965,7349,7670 | async method | SLA has no async; converted to sync fn | async dropped
backends/mini/src/runtime/miniBridge.ts:1-6 | Node.js builtin import | no direct sa_std counterpart for node:path | kept as // @import comment + DEFECT
backends/mini/src/runtime/miniBridge.ts:4592 | JS #private field | no #private fields in SLA | field kept on struct, privacy by convention
backends/mini/src/runtime/miniBridge.ts:4639 | class | SLA has no classes/inheritance; class -> struct + fn family with &Struct first param | struct + method fns taking self
backends/mini/src/server.ts:22,25-26,30,34 | JS #private field | no #private fields in SLA | field kept on struct, privacy by convention
backends/mini/src/server.ts:24,29,37 | async method | SLA has no async; converted to sync fn | async dropped
backends/mini/src/server.ts:20 | class | SLA has no classes/inheritance; class -> struct + fn family with &Struct first param | struct + method fns taking self
backends/mini/src/server.ts:38 | JS builtin construction (Map/Set/Date/RegExp/AbortController/Error) | no equivalent sa_std type | JsonValue/buffer approximation
backends/mini/src/server.ts:38 | exception (try/catch/throw) | SLA uses status codes, no exceptions | status-code approximation, throw -> return error
backends/mini/src/server.ts:47 | arrow function / closure | SLA has no closures capturing mutable state | kept as named-fn reference or inline approximation
backends/mini/src/server.ts:52 | async function | SLA has no async; converted to sync fn returning status/value | async keyword dropped
backends/mini/src/server.ts:52 | Promise | no Promise in SLA | sequential call approximation

合并后缺陷条数：30
原始命中分类计数：
- JS Array/String method: 782
- runtime type test (typeof/instanceof/in): 392
- template literal interpolation: 352
- arrow function / closure: 336
- type assertion (as): 328
- exception (try/catch/throw): 276
- JS builtin construction (Map/Set/Date/RegExp/AbortController/Error): 208
- optional chaining ?.: 205
- async/await: 108
- dynamic JSON (JSON.parse/stringify): 58
- timer: 49
- Promise: 27
- process.* Node API: 20
- async function: 13
- type alias (union/literal): 13
- async method: 11
- interface: 9
- JS #private field: 6
- Node.js builtin import: 6
- class: 2
- JSON module import (import assertion): 1

## 分片：backends-c-mini-rest

# backends-c-mini-rest 缺陷日志（先转换不修复）

单元：backends/mini/src/runtime 下除 miniBridge.ts 外的 13 个 .ts → 同名 .sla
格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`

## miniInput.ts (30 行)
backends/mini/src/runtime/miniInput.ts:6 | async function / Promise<MiniResolvedUserInput> | async — SLA 无 async/Promise | 同步 fn 返回 i32 状态码，out 参数承接结果
backends/mini/src/runtime/miniInput.ts:6 | unknown 参数 + Record<string, unknown> 块解析 | dynamic JSON — 无 unknown/动态对象 | 输入改 JSON 文本缓冲，sa_json_* 留待修复期
backends/mini/src/runtime/miniInput.ts:6 | process.cwd() 默认参数 | Node API — 无 sa_std 对应 | cwd 改由调用方以 (ptr,len) 传入
backends/mini/src/runtime/miniInput.ts:22 | await runMiniImageView(...) | async — 顺序 await | 改顺序同步调用

## miniCapabilities.ts (47 行)
backends/mini/src/runtime/miniCapabilities.ts:13-20 | interface 中 invoke 函数字段 (args,context)=>Promise<...> | closure — SLA struct 无函数值/闭包 | invoke 改 invoke_id 索引宿主注册表
backends/mini/src/runtime/miniCapabilities.ts:18 | schema: Record<string, unknown> | dynamic JSON | schema_json 定长缓冲
backends/mini/src/runtime/miniCapabilities.ts:22-23 | MiniCapabilityResolver 函数类型 + Omit<...> + Promise 联合 | generic — 无 Omit/Promise/函数类型 | 仅登记，解析器以 id 表示
backends/mini/src/runtime/miniCapabilities.ts:25,29 | RegExp CAPABILITY_NAME + Set<string> seen | regex — 无 RegExp；Set 无对应 | 模式原文注释保留，前缀+字符集手检与线性扫描待修复期
backends/mini/src/runtime/miniCapabilities.ts:22 | import type JsonValue from @codex-ui/shared | dynamic JSON — JsonValue 任意值 | JSON 文本缓冲

## miniTokenizer.ts (54 行)
backends/mini/src/runtime/miniTokenizer.ts:1,17-27 | js-tiktoken getEncoding("o200k_base") | external library — 无 sa_std BPE 对应 | Encoder 不透明句柄 + encoderFailed 标志，失败路径回退启发式
backends/mini/src/runtime/miniTokenizer.ts:5,10 | DATA_URL_RE / CJK_RE 全局 RegExp + replace/match | regex | 模式原文注释保留，扫描待手写
backends/mini/src/runtime/miniTokenizer.ts:14-15 | 模块级可变状态 cachedEncoder/encoderFailed | closure — 模块单例状态 | 收进 MiniTokenizerState struct 显式穿线
backends/mini/src/runtime/miniTokenizer.ts:34-37 | Math.ceil / 浮点 cjk*1.2 | floating point — TS number 浮点语义 | 整数近似 (cjk + (rest+3)/4)，登记待精确化

## miniImageAnalysisPolicy.ts (55 行)
backends/mini/src/runtime/miniImageAnalysisPolicy.ts:3-5 | as const 数组推导联合类型 / 字符串字面量联合 | generic — 索引访问类型 (typeof X)[number] | 联合以 (ptr,len) 字符串值 + 字面量比较表示
backends/mini/src/runtime/miniImageAnalysisPolicy.ts:47-55 | infer* 内 6 组 RegExp（含 CJK 分支） | regex | 分支逻辑注释保留，子串/词界扫描待修复期

## miniModelHistory.ts (65 行)
backends/mini/src/runtime/miniModelHistory.ts:1,11-13 | node:crypto createHash sha256 + JSON.stringify | Node API + dynamic JSON | messages 改 JSON 缓冲，哈希走 sa_std extern 待接
backends/mini/src/runtime/miniModelHistory.ts:21,23 | class MiniModelHistoryCache + WeakMap<object, CachedHistory> | class + WeakMap — 无对象身份键/GC 语义 | struct + &self 函数族；固定表以 caller 提供的 session_id u64 为键
backends/mini/src/runtime/miniModelHistory.ts:25-37 | JSON.parse(JSON.stringify(items)) 深拷贝 | dynamic JSON | JSON 缓冲拷贝近似

## miniTaskIntent.ts (97 行)
backends/mini/src/runtime/miniTaskIntent.ts:3-8,57-58 | 8 个 RegExp 常量（含 CJK、\b、{0,60} 量词） | regex | 模式逐字保留在 .sla 注释，.test() 暂返回 false 待手写扫描
backends/mini/src/runtime/miniTaskIntent.ts:33-47 | messages: unknown[] filter 型谓词 + map/join/slice | dynamic JSON | JSON 缓冲扫描待修复期
backends/mini/src/runtime/miniTaskIntent.ts:60-93 | opts 对象字面量参数类型 | dynamic JSON — 结构化对象参数 | 展开为 MiniTaskEvasionOpts struct

## miniSessionStore.ts (115 行)
backends/mini/src/runtime/miniSessionStore.ts:1,23 | RuntimeDatabase (@cxu/sdk-backend) prepare/exec/run/get/all | Node API — SQLite 同步驱动无 sa_std 对应 | db 改不透明句柄，SQL 原文注释保留待宿主 extern
backends/mini/src/runtime/miniSessionStore.ts:23-38 | class + constructor 私有字段 + 模板字符串 SQL | class | struct + MiniSessionStore_new 等 &self 函数族
backends/mini/src/runtime/miniSessionStore.ts:48 | Date.now() | Node API | sa_std 时间 extern 待接

## miniTurnSafety.ts (221 行)
backends/mini/src/runtime/miniTurnSafety.ts:18-33 | stableValue/stableOutput 递归 + Object.entries 排序 + 解构 rest | dynamic JSON | JSON 缓冲直通近似，规范化待修复期
backends/mini/src/runtime/miniTurnSafety.ts:35-42,219-221 | JSON.parse + RegExp 失败判定/拒绝判定 | dynamic JSON + regex | 暂返回 false
backends/mini/src/runtime/miniTurnSafety.ts:44-60,153-217 | class MiniToolLoopGuard / MiniSameFileReadGuard + Map | class + Map | struct + 固定表（sha256 hex 键 / sa_vm:<key> 键）
backends/mini/src/runtime/miniTurnSafety.ts:62-95 | Set<string> 动作集合 ×2 | Set | 字面量比较链待修复期
backends/mini/src/runtime/miniTurnSafety.ts:97-140 | Record<string, unknown> args 多键探测 (path/file/target/...) | dynamic JSON | JSON 字段探测待 sa_json_*

## imageView.ts (243 行)
backends/mini/src/runtime/imageView.ts:1-4 | node:fs/promises stat/readFile + node:path + node:os homedir | Node API | 映射 sa_std_fs_*/path extern 待接
backends/mini/src/runtime/imageView.ts:24-56 | EXT_MIME Record + MINI_IMAGE_VIEW_TOOL schema 对象字面量 | dynamic JSON | 查表函数/JSON 常量缓冲待修复期
backends/mini/src/runtime/imageView.ts:108-116,190-242 | await import("sharp") + sharp 管线 (resize/grayscale/flatten/jpeg/png/metadata/toBuffer) | external library + async — 动态 import 与 sharp 均无对应 | 仅 degraded（原始字节）路径可转换，sharp 路径整段注释保留
backends/mini/src/runtime/imageView.ts:118-123 | formatBytes toFixed(1) 浮点格式化 | floating point | 整数近似待修复期
backends/mini/src/runtime/imageView.ts:131-133,73-86 | RegExp 远程引用判定 + JSON.stringify 错误消息拼接 | regex + dynamic JSON | 暂返回 false / null

## agentsMdInventory.ts (327 行)
backends/mini/src/runtime/agentsMdInventory.ts:1-2,23-28 | node:fs/promises + node:path + process.env.MINI_AGENTS_MD | Node API + async（全文 async 函数群） | 同步 fn + 状态码；env 走 extern 待接
backends/mini/src/runtime/agentsMdInventory.ts:88-115 | expandAgentsMdImports 递归 + Set<string> seen + 行 RegExp /^\s*@([^\s]+)\s*$/ | regex + Set + 递归异步 | 签名保留，展开逻辑注释化待修复期
backends/mini/src/runtime/agentsMdInventory.ts:141-240 | collect*/resolveScopes/findNested* 中 Set/Map + await stat/readFile | Set/Map + async | 线性扫描近似登记
backends/mini/src/runtime/agentsMdInventory.ts:288-296 | extractAgentsMdTouchedPaths(args: Record<string, any>) | dynamic JSON | JSON 缓冲待探测

## miniFileHistory.ts (852 行)
backends/mini/src/runtime/miniFileHistory.ts:1-5 | node:fs *Sync 全家 + node:crypto randomUUID + path | Node API | sa_std_fs_* extern 待接（源本身同步，无 async 缺陷）
backends/mini/src/runtime/miniFileHistory.ts:32-69 | MiniHistorySnapshot 大接口（messages: unknown[]、goal* 可空字段群） | dynamic JSON | 标量字段展开为定长字段 + messages_json/stateJson 缓冲
backends/mini/src/runtime/miniFileHistory.ts:91-93,125-176 | threadId RegExp + frontmatter/state JSON.parse/stringify | regex + dynamic JSON | 校验/解析以注释逻辑 + sa_json_* 待接
backends/mini/src/runtime/miniFileHistory.ts:184-287 | renderTranscript/renderMiniHistoryFile：Map(turnById)、Date.toISOString、模板拼接、replaceAll | Map + dynamic JSON + Node API(Date) | 渲染逻辑逐分支注释保留在 .sla
backends/mini/src/runtime/miniFileHistory.ts:300-762 | class MiniFileHistory 全部方法（upsert 原子 tmp+rename、getMetadata fd/Buffer.alloc/readSync、list* 文件名 RegExp、deleteTree Set/Map） | class + regex + Set/Map + Node API(Buffer/fd) | struct + &self 函数族；文件名模式与集合待手写
backends/mini/src/runtime/miniFileHistory.ts:428 | getMetadata 返回 Omit<MiniHistorySnapshot,"turns"|"messages"> | generic — Omit | 用完整 Snapshot struct 忽略 turns/messages 近似
backends/mini/src/runtime/miniFileHistory.ts:763-794 | MiniBackendRouteOptions 中 historyExists/hasSession 函数字段 | closure | 改 *_id 宿主注册表索引，结果由 caller 计算传入
backends/mini/src/runtime/miniFileHistory.ts:373-418,587-705 | throw assertSafeThreadId / try-catch 控制流 | exception — SLA 无 throw | 状态码返回近似，调用方 try/catch 语义登记

## miniServerHooks.ts (688 行)
backends/mini/src/runtime/miniServerHooks.ts:21-39 | HookHandler 函数类型 + Set<HookHandler> + Promise.allSettled(fireServerHook) | closure + Set + async/Promise | handler_id 注册表 + 顺序调用近似 allSettled
backends/mini/src/runtime/miniServerHooks.ts:6-11,49-112 | node:fs/promises + @cxu/sdk-backend memory 路径 + JSON.parse/stringify 记忆文档 | Node API + dynamic JSON + async | extern/JSON 缓冲待接
backends/mini/src/runtime/miniServerHooks.ts:41-47 | shouldAutoRemember 正则三连 | regex | 暂返回 null
backends/mini/src/runtime/miniServerHooks.ts:70-91 | runWithServerMcpHooks invoke 回调参数 + Omit<...> ctx | closure + generic | invoke_id + 完整 Context struct
backends/mini/src/runtime/miniServerHooks.ts:167-180,320-364 | MiniFinishHookHandlerConfig 判别联合 + Partial<Record<...>> 事件表 | generic + dynamic JSON | type 标签扁平 struct + JSON 缓冲
backends/mini/src/runtime/miniServerHooks.ts:189-330 | miniFinishTomlScalar/ParseToml/EnsurePath 递归 unknown 图操作 + 多处 RegExp | dynamic JSON + regex + 递归 | JSON 缓冲直通近似，解析器待修复期
backends/mini/src/runtime/miniServerHooks.ts:366-379 | new RegExp(matcher) 动态构造 | regex | 子串回退待修复期
backends/mini/src/runtime/miniServerHooks.ts:406-456 | ${} 模板渲染递归 + miniFinishRunShell: spawn + setTimeout + stdout data/close/error 事件 + Promise | async/Promise + timer + EventEmitter/stream + Node API(child_process/process.platform) | 阻塞式进程 extern 近似；超时由 extern 强制登记
backends/mini/src/runtime/miniServerHooks.ts:517-688 | fireMiniTurnFinishHook/fireMiniSessionEndHook：await 链、console.warn、mcp_tool 分支 RegExp | async + regex + Node API | 同步状态码近似，逐分支注释保留

## miniMcp.ts (1532 行)
backends/mini/src/runtime/miniMcp.ts:10-17,47-191 | node:child_process/fs/os/path/crypto 导入 + NodeJS.ProcessEnv 参数遍布 | Node API | sa_std extern 映射待接；env 改按 key 查 extern
backends/mini/src/runtime/miniMcp.ts:22-45 | MiniMcpServerConfig env/httpHeaders Record<string,string> + ToolDef schema Record | dynamic JSON | JSON 缓冲字段
backends/mini/src/runtime/miniMcp.ts:60-293 | 模块级可变状态 cachedAgentConfig/runtimeCodexHome/workspaceRoots + add 闭包捕获 paths + Set 去重 | closure + Set + 模块状态 | MiniMcpModuleState struct；add 闭包内联登记
backends/mini/src/runtime/miniMcp.ts:203-209,211-217,366-379 | expandEnvVars/sanitize 的 replace 正则回调与字符类、matcher 类正则 | regex + closure(replace 回调) | 逐字符手写扫描待修复期
backends/mini/src/runtime/miniMcp.ts:299-400 | stripJsonComments 状态机尾部 replace 正则；parseConfigFile/parseConfigToml 的 await import("smol-toml") | regex + async + external library（动态 import） | 状态机主体可直转（已保留规格）；smol-toml 回退到 parseMcpServersSubset
backends/mini/src/runtime/miniMcp.ts:401-610 | parseMcpServersSubset commit 闭包 + parseTomlValue 递归 unknown + toServerConfig 多别名探测/浮点秒→毫秒 | closure + dynamic JSON + floating point | commit 内联登记；JSON 缓冲；clamp/floor 整数化待精确
backends/mini/src/runtime/miniMcp.ts:610-705 | loadMiniMcpServers async + Map serverMap + registerTable 闭包 | async + Map + closure | 同步近似 + 固定表登记
backends/mini/src/runtime/miniMcp.ts:736-762 | McpConnection 接口（方法集）+ JsonRpcId 联合 + withTimeout<T> Promise.race/setTimeout | generic + async/Promise + timer + 接口分发 | 两具体 struct 同名函数族，调用点按 transport 分支；withTimeout 直通状态码近似
backends/mini/src/runtime/miniMcp.ts:763-790 | liveStdioMcpProcs Set<ChildProcess> + process.on/once("exit"/SIGINT/SIGTERM) killAllSync 闭包 | Set + EventEmitter + closure | 句柄 id 数组；信号钩子不可注册，改由 closeMiniMcpClients 显式调用登记
backends/mini/src/runtime/miniMcp.ts:791-948 | class StdioMcpConnection：spawn stdio 管道、stdout data 事件分行、pending Map<id,{resolve,reject}>、server 主动请求应答 | class + stream/EventEmitter + Map + closure(Promise 回调对) | struct + pending id 表 + 同步读循环填结果缓冲近似
backends/mini/src/runtime/miniMcp.ts:973-1112 | class StreamableHttpMcpConnection：fetch/AbortController/headers.get、404 正则重初始化重试、setTimeout | class + Node API(fetch/Abort) + timer + regex | struct + sa_http_client_* extern 待接
backends/mini/src/runtime/miniMcp.ts:1113-1136 | mcpResultToText content 块 unknown 遍历 | dynamic JSON | JSON 缓冲待解析
backends/mini/src/runtime/miniMcp.ts:1138-1304 | mcpCache Map + buildToolDefs 计数 Map/used Set + connectServer 类构造分发 + listMiniMcpTools async 缓存/陈旧/失败退避逻辑 | Map/Set + class + async | MiniMcpCacheState 固定表；逻辑逐分支注释保留
backends/mini/src/runtime/miniMcp.ts:1304-1532 | runMiniMcpTool/list/read resources/tryRead*/status/close/test hooks：async 链 + mcpResourcesUnsupported Set + Date.now | async + Set + Node API | 同步近似 + 状态字段清零近似
