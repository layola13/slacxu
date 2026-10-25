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
