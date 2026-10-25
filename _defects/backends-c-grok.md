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
