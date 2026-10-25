# server-rest 单元缺陷日志（apps/server/src 除 index.ts 外全部 95 个 .ts → .sla）

批量转换阶段（只转换不修复）。每条格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`。由 10 个分组分片合并。

## 分组 A — saVmTool.ts（日志条目 0 条）

# server-rest 分组 A 缺陷日志（saVmTool.ts）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

- saVmTool.ts:1 | import / re-export | Node/@cxu/@codex-ui module system has no SLA equivalent | kept as // @import comment + DEFECT
- saVmTool.ts:48 | throw | exceptions have no SLA equivalent | early return status code approximation
- saVmTool.ts:67 | stream/event | EventEmitter/stream has no SLA equivalent | sequential read loop approximation
- saVmTool.ts:101 | JSON.parse/stringify | dynamic JSON | JsonBuf + sa_json_* extern approximation
- saVmTool.ts:264 | Set ALWAYS_EXCLUDED_DIRS | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:270 | interface GitIgnoreRule | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:287 | RegExp literal | RegExp has no sa_std equivalent | manual scan / RegexHandle placeholder
- saVmTool.ts:359 | dynamic param/return in clampInt | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:372 | interface SaVmPaginationInput | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:389 | interface ResolvedPagination | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:398 | dynamic param/return in resolvePagination | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:436 | dynamic param/return in resolveMaxFileBytes | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:480 | async function readSearchableText | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:517 | async function expandCandidateFileGlob | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:568 | class AsyncSemaphore | class + Promise waiters queue has no SLA equivalent | struct + fn family, synchronous approximation
- saVmTool.ts:622 | async function backupExistingFileBeforeWrite | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:658 | interface NativeReadFileOptions | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:670 | async function nativeReadFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:820 | arrow function / closure isMinified | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:966 | async function nativeReadLines | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:985 | async function nativeReadFileTail | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1279 | async function nativeFindFiles | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1317 | async function walk | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1426 | async function nativeWriteFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1513 | async function nativeEditFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1675 | async function nativeDeleteFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1729 | async function nativeSafeDelete | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1891 | Set uniqueFiles | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:1927 | async function nativeMoveFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:1991 | async function nativeEnsureDir | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:2043 | async function nativeListDir | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:2250 | async function nativeGrepSearch | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:2294 | arrow function / closure paginatedResult | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:2497 | async function nativeGrepSearchAsync | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:2594 | async function scanDir | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:2601 | arrow function / closure entries | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:2637 | async function worker | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:2755 | async function nativeFindReferences | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:3069 | async function nativeFindImplementations | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:3488 | async function collectWorkspaceSourceFiles | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:3587 | async function prefilterFilesInWorkers | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:3632 | async function nativeFileOutline | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:3783 | async function nativeWorkspaceOutline | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:3990 | arrow function / closure push | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:4042 | interface RepoMapCacheEntry | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:4053 | async function nativeRepoMap | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4115 | type alias object RepoSymbol | object type alias -> struct approximation | struct
- saVmTool.ts:4308 | async function nativeVerifyLoop | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4378 | type alias object VerifyError | object type alias -> struct approximation | struct
- saVmTool.ts:4465 | async function nativeReplayCase | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4465 | dynamic param/return in nativeReplayCase | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:4510 | async function nativeRecordCase | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4510 | dynamic param/return in nativeRecordCase | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:4574 | dynamic param/return in normalizeNoteLevel | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:4583 | type alias object WorkspaceNoteItem | object type alias -> struct approximation | struct
- saVmTool.ts:4590 | type alias object WorkspaceNotesDocument | object type alias -> struct approximation | struct
- saVmTool.ts:4604 | async function loadWorkspaceNotes | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4627 | async function atomicSaveWorkspaceNotes | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4635 | async function nativeSaveNote | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4635 | dynamic param/return in nativeSaveNote | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:4758 | async function nativeReadNotes | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4917 | async function nativeDeleteNote | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:4917 | dynamic param/return in nativeDeleteNote | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:5023 | async function nativeReadMany | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:5085 | async function nativeRenameSymbol | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:5270 | async function nativeMoveFileWithImports | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:5361 | arrow function / closure stripExt | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:5455 | async function nativeFindDefinition | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:5607 | Node process/spawn | Node child_process / process.env has partial sa_std counterpart only | sa_std_process_* extern approximation
- saVmTool.ts:5661 | async function nativeExtractToFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:5956 | async function nativeAddImport | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6059 | async function nativeGetDiagnostics | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6164 | async function nativeWorkspaceDiagnostics | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6475 | async function nativeOrganizeImports | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6578 | async function nativeAnalyzeScope | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6690 | async function nativeExtractComponent | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6737 | arrow function / closure semFilter | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:6738 | arrow function / closure isEnvModuleResolution | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:6739 | arrow function / closure isBlocking | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:6794 | async function nativeAutoFixMissingImports | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6814 | async function nativeAnalyzeCoupling | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6832 | async function nativeAtomicRefactor | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6874 | async function nativeApplyPatch | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:6945 | async function nativeCopyFile | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7009 | async function countFileLines | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7054 | async function nativeFileInfo | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7137 | async function nativeCountLines | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7259 | type alias object GitSpawnResult | object type alias -> struct approximation | struct
- saVmTool.ts:7306 | type alias object GitPorcelainEntry | object type alias -> struct approximation | struct
- saVmTool.ts:7331 | async function nativeGitStatus | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7453 | arrow function / closure totalCount | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:7454 | arrow function / closure trimToBudget | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:7464 | arrow function / closure build | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:7507 | async function nativeGitDiff | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7608 | arrow function / closure withBase | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:7728 | async function nativeGitLog | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7828 | async function nativeHttpFetch | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:7828 | dynamic param/return in nativeHttpFetch | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:7905 | Set ALLOWED_HOST_SHORT_NAMES | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:7916 | Set ALLOWED_CARGO_SUBCOMMANDS | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:7921 | Set ALLOWED_GO_SUBCOMMANDS | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:7926 | Set FORBIDDEN_HOST_SUBCOMMANDS | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:7927 | Set ALLOWED_HOST_ENV_KEYS | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:7941 | interface SaVmProcessSession | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:7960 | interface RunHostCacheEntry | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:8159 | interface SpawnHostProcessResult | TS interface / optional fields / index signatures have no SLA struct equivalent | struct with fixed buffers; optional -> present flag needed later
- saVmTool.ts:8170 | async function spawnHostProcess | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:8213 | timer | setTimeout/setInterval has no SLA equivalent | deadline polling approximation
- saVmTool.ts:8402 | async function nativeRunHost | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:9204 | arrow function / closure normalize | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:9456 | dynamic param/return in parseReadLineBound | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:9465 | dynamic param/return in pickLineBound | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:9473 | dynamic param/return in extractRawFilePath | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:9512 | async function runSaVmTool | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:9599 | arrow function / closure startLine | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:9603 | arrow function / closure endLine | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:9667 | arrow function / closure pickContent | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:9685 | arrow function / closure pickStr | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:9737 | arrow function / closure pickSrc | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:10486 | arrow function / closure numOrUndef | closure capturing mutable state has no SLA equivalent | plain fn, captures passed explicitly later
- saVmTool.ts:11036 | Set buildValueFlags | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:11503 | async function runParallelSaVmTool | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:11590 | Set uniqueIndices | Set has no SLA equivalent | fixed array + len
- saVmTool.ts:11606 | Map indexToUniquePos | Map has no SLA equivalent | fixed array + len + linear scan
- saVmTool.ts:11641 | async function spawnScriptRunner | async/await + Promise has no SLA equivalent | synchronous fn + status code / sequential calls
- saVmTool.ts:11767 | dynamic param/return in validateTestFilePath | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:11892 | type alias / union SaVmExecutableLanguage | union/literal type has no SLA equivalent | JsonBuf / status code approximation
- saVmTool.ts:11894 | dynamic param/return in normalizeSaVmRunInput | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:11968 | dynamic param/return in normalizeFsCaps | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:11999 | dynamic param/return in normalizeNetCaps | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:12018 | dynamic param/return in clampLimit | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer
- saVmTool.ts:12035 | dynamic param/return in isSaVmBlockedToolName | Record/unknown/any dynamic JSON has no typed SLA equivalent | JsonBuf text buffer

## 分组 B — codeCliBridge.ts（日志条目 39 条）

# server-rest 单元 B 缺陷日志 — codeCliBridge.ts

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`
输出文件：apps/server/src/codeCliBridge.sla（1360 行，行内 DEFECT 注释 108 处）

apps/server/src/codeCliBridge.ts:1-40 | import 跨模块（@codex-ui/shared、backends/claude runtime、@cxu/sdk-backend、兄弟 server 模块共 12 组） | SLA 无对应模块/包导入面 | 仅保留相对路径 @import 占位 + extern 风格注释，导入符号在调用点以 DEFECT 标注
apps/server/src/codeCliBridge.ts:41-78 | type CodeCliSession（含 Map/Set/Array 字段） | SLA 无 Map/Set/动态数组 | struct + 定长数组（turns 128 / messages 512 / conversation 512）+ len，Map/Set 字段降为 JSON 文本缓冲
apps/server/src/codeCliBridge.ts:80-111 | export type CodeCliSessionSnapshot（可选字段 + 条件展开） | 无可选字段/对象展开 | struct + present 标志位逐字段对应
apps/server/src/codeCliBridge.ts:113-125 | ClaudeTokenUsage / ClaudeStreamToolBlock（JsonValue 字段） | 动态 JSON | usage 改 u64 四字段；JsonValue 改 JsonText 文本缓冲
apps/server/src/codeCliBridge.ts:139-146 | Record<string, number|null> 努力预算表 | 无字符串键 Record | 改为按努力档位码查表的函数骨架 claudeEffortTokenBudget
apps/server/src/codeCliBridge.ts:148-169 | 字符串字面量联合类型（status 四态） | 无联合类型 | statusCode u64 编码（0=running 1=completed 2=failed 3=interrupted）
apps/server/src/codeCliBridge.ts:171-209 | Set<string> 方法集合 + has() 成员判断（两个导出函数） | 无 Set、无字符串集合 | 方法码（u64）区间判断 isTerminalMethodCode/isProcessFreeMethodCode + 线性扫描骨架
apps/server/src/codeCliBridge.ts:211-213 | String.replace(正则) + trim() | 无正则、无动态字符串 | JsonText 缓冲恒等近似，DEFECT 标注待修复阶段实现原地重写
apps/server/src/codeCliBridge.ts:215-259 | 字符串字面量比较/数组 find（任务终态、目标状态归一化） | (ptr,len) 逐字比较未展开 | 状态码出参 + found 标志骨架
apps/server/src/codeCliBridge.ts:226-236 | canonicalJson 递归 + Object.keys().sort() + JSON.stringify | 动态 JSON 递归序列化无对应 | 原始 JSON 文本直拷贝（键序不重排）
apps/server/src/codeCliBridge.ts:261-269 | unknown 输入 + Number() 强转 + Number.isFinite/Math.min/Math.floor | 无 unknown/动态强转 | kind 码 + f64 入参，字符串解析与取整推迟修复阶段
apps/server/src/codeCliBridge.ts:271-291 | claudeGoalState 返回动态对象 + Date.now() | 无动态对象、无墙钟 API | 拆为 out 参数（tokensUsed/timeUsedSeconds，后者暂 0）
apps/server/src/codeCliBridge.ts:302-336 | 数组逆序遍历 + unshift/join、Map<string,string> 流式对账（includes 子串） | 无动态数组/Map/子串搜索 | 预算扣减骨架保留，缓冲拼接与包含判断推迟
apps/server/src/codeCliBridge.ts:338-382 | normalizeTokenUsage 导入 + Record 返回（tokenBreakdown） | 导入归一化器与动态对象无对应 | parse 返回 found=false；breakdown 序列化推迟
apps/server/src/codeCliBridge.ts:394-412 | stripModelContextVariant/resolveModelContextWindow 导入 + modelUsage 动态遍历 | 导入 helper 与动态 JSON 遍历无对应 | 函数骨架返回未找到，逻辑以注释 1:1 保留四级回退顺序
apps/server/src/codeCliBridge.ts:414-435 | Array.findIndex 回调 + JSON.parse try/catch | 无闭包回调、无 JSON 解析状态面 | upsert 退化为追加（容量内），parse 回退原始文本
apps/server/src/codeCliBridge.ts:445-477 | unknown/Error instanceof、spawnErrnoDetails 动态挑字段、console[level] 日志 | 无异常对象模型/动态日志级别 | 调用方传消息 (ptr,len)；日志仅保留事件名骨架
apps/server/src/codeCliBridge.ts:449-454,505-511 | 正则替换 redactSecrets、三处正则匹配 asyncAgentTaskId | SLA 无正则引擎 | 恒等/未命中近似，模式扫描推迟修复阶段
apps/server/src/codeCliBridge.ts:479-503 | jsonRecord 类型守卫、动态键列表查找、toolResultText 递归展平 | 动态 JSON 遍历无对应 | sa_json_* 探针占位骨架（修复阶段接入）
apps/server/src/codeCliBridge.ts:513-541 | ChildProcess 句柄 + spawnSync taskkill + process.platform、NodeJS.ProcessEnv + findClaudeBin 导入 | 无进程句柄类型/平台 API | child 以 pid 表示；平台分支与终止走 sa_std process extern（推迟）
apps/server/src/codeCliBridge.ts:542-627 | class extends EventEmitter implements CodexRuntimeClient + 30 余个 Map/Set/timer/Promise 字段 | 无类继承/事件发射器/Map/Set/定时器句柄 | struct CodeCliBridge：Map/Set→JSON 缓冲+计数、timer→u64 槽、Promise→settled 标志、emit→单宿主回调 codeCliBridge_emit
apps/server/src/codeCliBridge.ts:628-640 | constructor 默认参数为函数/闭包（runtimeEnv/spawnCommand/terminateChild/onSessionSnapshot） | 无函数类型参数/闭包 | 宿主回调 id（u64）字段 + remoteHost bool
apps/server/src/codeCliBridge.ts:642-673 | 对象展开 {...status}、模板字符串 userAgent、Date.now() 事件对象 | 无展开/模板字面量/墙钟 | 字段级拷贝骨架 + JsonText 构建推迟
apps/server/src/codeCliBridge.ts:675-705 | node:fs/os/path（mkdirSync/writeFileSync/tmpdir/join）+ try/catch + JSON.stringify 写文件 | Node API 无 sa_std 对应（本阶段） | 返回未生成（false），sa_std_fs_* 接入推迟
apps/server/src/codeCliBridge.ts:713-767 | snapshot 条件展开 + Array.map 拷贝、buildClaudeTaskPlanItem 导入、可选回调 ?.() | 无展开/高阶函数/可选调用 | 字段拷贝 + present 门控骨架
apps/server/src/codeCliBridge.ts:777-798 | controlRequest 返回 Promise + setTimeout + resolve/reject 闭包捕获 | 无 Promise/定时器/闭包 | 同步登记返回槽位 id，control_response 在 handleLine 内同步交付；超时由宿主 tick 推迟实现
apps/server/src/codeCliBridge.ts:800-897 | async/await applyRuntimeConfig、ensureInitialThinkingBudget 的 Promise.then 链（fire-and-forget） | 无 async/await/Promise 链 | 顺序调用近似，完成日志改由响应路径补记（推迟）
apps/server/src/codeCliBridge.ts:899-1001 | restoreSession 的 ?? 链、new Map/Set 重建、claudeTranscriptExists 导入 + 会话 Map 迭代播种回放 | 无空值合并/迭代器协议 | present 标志 + 缓冲重置骨架，逐字段恢复推迟
apps/server/src/codeCliBridge.ts:1003-1266 | async start()：spawn 子进程、child.once/on 事件、readline 行流、stderr 尾环缓冲、闭包捕获 spawn 局部量、throw 多出口 | 无子进程事件流/readline/闭包/throw | 宿主轮询模型：handleLine/onChildExit/onChildError/onChildStderr 分立函数；throw 改 i32 负码（-2..-6）
apps/server/src/codeCliBridge.ts:1268-1374 | stop() 的 Promise reject 扇出 + clearTimeout 循环；applyStartConfig 的 typeof 动态探测链 | 无 Promise/定时器/动态探测 | 标志清零骨架；字段探测改 sa_json_*（推迟）
apps/server/src/codeCliBridge.ts:1301-1322 | waitForExit 的 Promise.race + restart 的 await 组合 | 无 Promise 竞速 | childExitSettled 轮询 + 顺序组合
apps/server/src/codeCliBridge.ts:1376-1470 | async request 路由、respond 的 JsonRpcId 联合 + buildControlResponse 导入、writeStdin 流写回调 + JSON.stringify | 无流回调/联合类型 | method_code 分发 + i32 状态；写走 sa_std process bidi extern（推迟）
apps/server/src/codeCliBridge.ts:1534-2123 | handleMethod 巨型 switch（字符串方法名）+ await extractTurnInput + randomUUID + 多处 throw + pageThreadHistory 等导入调用 | 无字符串 switch/UUID/异常 | method_code 分发骨架，22 个 case 的行为以注释 1:1 清单保留（行号已标注），逐 case 落地推迟修复阶段
apps/server/src/codeCliBridge.ts:2134-2330 | startAgentGroup/bindAgentTask/emitAgentGroupItem：randomUUID 子线程、Object.fromEntries、Array join/filter/map 类型守卫回调 | 无 UUID/高阶函数/动态对象构建 | 函数骨架 + 投影数组线性扫描，组项 JsonText 构建推迟
apps/server/src/codeCliBridge.ts:2371-2514 | 后台任务多重 Map/Set 索引（ByTurn/ByToolUse/unowned/terminal 双向映射） | 无 Map/Set | 全部降为 JSON 缓冲索引，查询函数保留签名与判定顺序注释
apps/server/src/codeCliBridge.ts:2516-2797 | compaction/父 turn 完成/目标续跑：setTimeout(1000/1500) 调度、Promise resolver 调用、字符串 includes 标记、buildGoalContinuationPrompt 导入 | 无定时器/Promise/导入 builder | 宿主 tick 调度占位 + finishPending 四重门控顺序以注释保留
apps/server/src/codeCliBridge.ts:2799-3459 | handleLine 660 行流事件分发：JSON.parse、message.type/subtype 字符串分发、嵌套 Record 遍历、流式去重对账 | 动态 JSON 分发无等价面 | 分发图以注释 1:1 完整保留（每分支源行号+行为），sa_json_* 探针落地推迟修复阶段
apps/server/src/codeCliBridge.ts:3461-3531 | findThreadBySession 的 Map 迭代回退、runCompaction 的 async/await + 注入 runner 闭包 + stop/start 重启序列 | 无迭代器/闭包 runner | 单会话回退已实作；compaction 改顺序宿主调用骨架
apps/server/src/codeCliBridge.ts:3533-3604 | invalidateChild 的子进程身份比较、reject 扇出、setStatus 的 emit 载荷构建 | 无进程对象身份/Promise | pid 比较 + 标志清零已实作，事件载荷构建推迟

## 分组 C — saVmTreeSitter.ts + saVmCodeGraph.ts（日志条目 62 条）

# server-rest 单元 · 分组 C 缺陷日志

转换文件：apps/server/src/saVmTreeSitter.ts（2699 行）→ saVmTreeSitter.sla；
apps/server/src/saVmCodeGraph.ts（1344 行）→ saVmCodeGraph.sla。源总行数 4043。

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`

## saVmTreeSitter.ts

apps/server/src/saVmTreeSitter.ts:1-8 | import node:fs/node:module/node:path/node:url + web-tree-sitter + typescript 包 | sa_std 无 fs/path/module 系统面、无 tree-sitter WASM 运行时、无 TS 编译器包 | 路径/fs 以假定 extern（fs_exists、path_*、proc_cwd）表达，tree-sitter 以 ts_* 假定 extern + u64 Node 句柄表达，均在文件头注明非 sa_std
apps/server/src/saVmTreeSitter.ts:9-11 | createRequire(import.meta.url) + `const ts: any = tsModule` 动态类型 | 无 CJS require / any 动态类型 | ts 全局以不透明句柄代替，所有 ts.* 调用点逐一登记缺陷
apps/server/src/saVmTreeSitter.ts:13-27 | 字符串字面量联合类型 OutlineSymbolKind | SLA 无联合类型 | u64 标签常量 KIND_* + kind_name() 映射回字符串
apps/server/src/saVmTreeSitter.ts:29-36 | OutlineSymbol 递归可选字段 children?: OutlineSymbol[]、signature?: string | 无递归结构体/可选字段 | children 改为共享 OutlineSymbolList 池中的 (children_first, children_len) 索引区间；signature 定长缓冲 + has_signature 标志
apps/server/src/saVmTreeSitter.ts:46-62 | SymbolEdit/FileRenameResult 对象与数组 | 无动态数组对象 | 定长数组字段 + SymbolEditList 池
apps/server/src/saVmTreeSitter.ts:64-65 | 模块级 let parserInitPromise: Promise<void>|null、parserInstance | 无 Promise、无模块可变单例 | 折叠进 TreeSitterState 结构体（parserInitDone 标志 + u64 句柄）按引用传递
apps/server/src/saVmTreeSitter.ts:66 | Map<string, Language> languageCache | 无 Map | 键以 \n 拼接表 + 并行值数组线性扫描
apps/server/src/saVmTreeSitter.ts:68-87 | Map<string, {content, sf: any}> 源码文件缓存（LRU 淘汰最旧键） | TS SourceFile 编译器 AST 对象（any）不可表示 | 仅保留路径/长度身份的句柄令牌；淘汰近似为计数收缩，键表压缩未实现
apps/server/src/saVmTreeSitter.ts:89-171 | require.resolve / import.meta.url / process.cwd() / process.resourcesPath(Electron) 多源候选路径探测 | 无对应宿主 API | 候选顺序保留、以假定 extern 顺序探测近似；Electron resourcesPath 一般缺席
apps/server/src/saVmTreeSitter.ts:98-124 | try { } catch {} 空捕获多处 | SLA 无异常机制 | 以 extern 的 false 返回表达失败，catch 块语义合并
apps/server/src/saVmTreeSitter.ts:173-198 | async initTreeSitter + 共享 parserInitPromise 去重 + Parser.init({locateFile: () => wasmPath}) 回调闭包 | 无 async/Promise、无闭包回调 | 同步函数 + parserInitDone 标志；locateFile 闭包改为直接传路径
apps/server/src/saVmTreeSitter.ts:190-197 | console.warn 诊断副作用 | 无 console 面（本单元未建模诊断通道） | 省略 warn 调用，失败仅由返回值表达（已在代码 DEFECT 注明）
apps/server/src/saVmTreeSitter.ts:200-253 | switch(ext) 分组 case + extname().toLowerCase() | path extern 假定 | 逐 ext 字面量比较链，等价
apps/server/src/saVmTreeSitter.ts:255-278 | async loadLanguageForFile + Language.load(wasm) 异步 WASM 加载 + Map 缓存 | 无 async、无 WASM 语言加载 | 同步 + ts_language_load 假定 extern，缓存线性表
apps/server/src/saVmTreeSitter.ts:280-300 | Node 对象图（node.parent 链、node.type.includes 子串判断） | tree-sitter Node 非 SLA 原生对象 | u64 句柄 + ts_node_parent/ts_node_type_* 假定 extern；includes 改字节子串扫描
apps/server/src/saVmTreeSitter.ts:302-330 | 嵌套闭包 printSymbols 捕获可变 lines 数组递归 + 模板字面量拼行 | 无闭包捕获、无模板字面量 | 显式递归函数，输出缓冲与 prefix 逐参传递；lines 数组改为单一 StrBuf（join 尾随换行细节有微差）
apps/server/src/saVmTreeSitter.ts:332-336 | text.replace(/\s+/g, " ") + slice(0, maxLen-3) | 无正则引擎 | 手写空白折叠扫描
apps/server/src/saVmTreeSitter.ts:340-450 | collectRustSymbols：childForFieldName()?.text || "(anonymous)"、?. 可选链、?? 空合并 | 无可选链语法 | node_field() + 显式 0 句柄判空逐点展开
apps/server/src/saVmTreeSitter.ts:452-572 | collectTsSymbols 内嵌递归函数 visitDeclaration(d, exported = false)（默认参数 + 捕获 symbols 数组） | 无一等函数/闭包/默认参数 | 显式递归函数 tsVisitDeclaration，pool 与 exported/detail 逐参传递；export 前缀以 sym_prefix_export 原位改名实现
apps/server/src/saVmTreeSitter.ts:574-635 | collectPythonSymbols 递归自调用 + childForFieldName("definition") ?? lastNamedChild | 同上 | 显式递归 + 0 句柄回退
apps/server/src/saVmTreeSitter.ts:679-708 | collectZigSymbols：text.split("(")[0]?.trim()、text.match(/(?:pub\s+)?(?:const|var)\s+([A-Za-z0-9_]+)/) | 无正则、无 split 索引链 | zig_decl_name 手写关键字+标识符扫描
apps/server/src/saVmTreeSitter.ts:747-782 | extractRegexOutline 三条锚定正则（fn/type/impl 含捕获组、(?:\{|$)  alternation） | 无正则引擎 | regex_outline_fn/type 手写可选关键字消费 + impl 行扫描近似
apps/server/src/saVmTreeSitter.ts:784-868 | async extractFileOutline + options 对象 {detail?} 默认值 {} | 无 async、无可选字段对象 | 同步 + 显式 detail: bool 参数
apps/server/src/saVmTreeSitter.ts:870-944 | renameSymbolInContent：嵌套 walk 闭包捕获 edits/lines/oldName、[...edits].sort((a,b)=>b.start-a.start) 比较器、slice 拼接替换 | 无闭包、无比较器排序、无字符串 slice | RenameWalkState 状态结构体 + 插入排序 + applyEditsDescending 缓冲拼接
apps/server/src/saVmTreeSitter.ts:946-1000 | fallbackRegexRename：new RegExp(`\\b${escaped}\\b`, "g") + RegExpExecArray 循环、oldName 正则转义 replace | 无正则引擎 | 字面匹配 + is_word_byte 手写 \b 词边界扫描（转义步骤随之无意义化）
apps/server/src/saVmTreeSitter.ts:1019-1101 | findDefinitionInContent：嵌套 walk 闭包 + matchedNode 提前退出、parent 链提升（variable_declarator/export_statement） | 无闭包 | FindDefState + found 标志显式递归，parent 提升逻辑保留
apps/server/src/saVmTreeSitter.ts:1167-1217 | fallbackFindDefinition：插值构造 RegExp（含符号转义） | 无正则引擎 | line_declares_symbol 关键字+词边界扫描近似
apps/server/src/saVmTreeSitter.ts:1235-1252 | formatDiagnostics：errors.slice(0, 10)、模板拼装 | 无 slice | 计数截断 + sb_append_u64 数字渲染
apps/server/src/saVmTreeSitter.ts:1254-1409 | getSyntaxDiagnostics TS 路径：sf.parseDiagnostics、ts.getLineAndCharacterOfPosition、ts.flattenDiagnosticMessageText、diags.map((d: any) => …) | 无 TS 编译器 API | 控制流保留（ext 分流、try→回退 tree-sitter），TS 路径因编译器句柄不可用恒走源自身的回退分支
apps/server/src/saVmTreeSitter.ts:1307-1381 | .tsx/.jsx React Hook 规则检查：checkHookRulesInStatements/inspectNodeForHooks/walkComponentNodes 三层嵌套闭包 + ts.is* 类型守卫 + /^use[A-Z0-9]/ 正则 | 无 TS AST、无闭包、无正则 | 未实现，仅在代码内以 DEFECT 块完整登记（含三函数名与行号）；tree-sitter 诊断路径不受影响
apps/server/src/saVmTreeSitter.ts:1392-1408 | collectTreeErrors 闭包 + node.text.slice(0,30).replace(/\s+/g," ") | 无闭包/正则 | 显式递归函数 + truncateSignature 的空白折叠复用
apps/server/src/saVmTreeSitter.ts:1411-1525 | addImportToContent：三条正则（命名/默认 import 解析、模块 import 测试、/\{[^}]+\}/ replace）、lines.splice、[...existing, ...missing] 展开、Array.includes/filter | 无正则、无展开语法 | parse_import_statement/extract_braces_inner/csv_* 手写扫描套件；splice 改 lines_insert 移位
apps/server/src/saVmTreeSitter.ts:1527-1764 | organizeImportsInContent：sf.statements 编译器 AST（isImportDeclaration/importClause/namedBindings 元素对象）、collectUsedIdentifiers 的 ts.forEachChild + parent 种类排除、Set/Map、sort 比较器 + localeCompare、interface ParsedImport 嵌套定义 | 无 TS 编译器、无 Set/Map、无区域设置排序 | 文本级重建：单行 import 语句解析为 ParsedImport 记录、多行 import 不支持；已用标识符为非 import 文本的令牌扫描（属性键/方法名排除仅以「前导 .」近似）；localeCompare 改字节序比较
apps/server/src/saVmTreeSitter.ts:1779-1796 | JS_GLOBALS / TS_RESERVED 的 Set<string> 字面量 | 无 Set | csv 表格 + 线性成员测试
apps/server/src/saVmTreeSitter.ts:1798-2023 | analyzeBlockScope：getPositionOfLineAndCharacter、walkBlock/walkOuter 闭包、ArrayBindingPattern（useState 解构）类型推导、fnSigText 读 parameters[].type.getText(sf)、[...set].filter 链、JSX 标签处理 | 无 TS 编译器 AST、无闭包 | 行区间令牌扫描近似声明/使用集合；fnSigText 真实签名重建未实现（函数型捕获变量以 "() => void" 占位、useState setter 的 (value: T | ((prev: T) => T)) => void 形态未推导）；结果组装（props 接口/调用片段/summary 文案）逐字保留
apps/server/src/saVmTreeSitter.ts:2025-2093 | generateTargetImportsForBlock：ts.isJsxOpeningElement/isIdentifier 的 forEachChild 遍历、dirname(resolve())/relative 路径重写 + replace(/\\/g,"/") | 无 TS AST、路径 extern 假定 | 块文本令牌扫描 + path_* 假定 extern 重写（分隔符规范化依赖 extern 面）
apps/server/src/saVmTreeSitter.ts:2095-2186 | generatePropsTypeImports：共享全局 RegExp lastIndex 状态机、/\bNAME\b/ alreadyImported 测试、rewrite 闭包、Set 覆盖追踪 | 无正则、无闭包 | collect_type_ids 无状态令牌扫描 + find_word 词界查找 + csv 覆盖集
apps/server/src/saVmTreeSitter.ts:2188-2246 | generatePropsLocalTypes：AST 顶层声明 getText(sf)、needed 集合 3 轮增长、picked.join(疑似笔误的 "\r\n\r\n" 分隔) | 无 TS AST | find_local_decl 以行首关键字 + 花括号平衡提取声明原文；分隔按 "\n\n" 近似（源 "\r\n\r\n" 分支未复刻）
apps/server/src/saVmTreeSitter.ts:2248-2349 | splitEnvironmentalErrors：惰性 getDeclared 闭包缓存、逐节点 try/catch、/Cannot find name '([^']+)'/ 与 /Property '([^']+)'/ 消息正则、sourceContent.includes(`.${prop}`) | 无闭包、无异常、无正则 | 声明集一次性文本收集（collect_declared_names_textual）；extract_quoted_after 手写引号提取；判定规则（TS2304/TS2339 分流）保留
apps/server/src/saVmTreeSitter.ts:2375-2424 | createInMemoryLanguageService：LanguageServiceHost 对象字面量（约 12 个函数属性闭包 fs/path/ts.sys）+ ts.createDocumentRegistry/createLanguageService | 无 TS LanguageService、无对象字面量方法集 | 恒返回 0 句柄（等同源 catch 路径）；下游 getSemanticDiagnostics/autoFix 随之恒走空/不可用分支
apps/server/src/saVmTreeSitter.ts:2426-2464 | getSemanticDiagnosticsForContent：ls.getProgram/getSemanticDiagnostics 等、诊断去重 Set 键 `${line}:${column}:${code}:${message}`、slice(0, 80) | 依赖不可用的 LanguageService | 结构保留（cwd 默认 process.cwd()），结果恒空并登记缺陷
apps/server/src/saVmTreeSitter.ts:2466-2508 | autoFixMissingImportsInContent：getCodeFixesAtPosition 代码修复、fix.changes[].textChanges[] span 编辑、循环重建 LS（上限 20)、catch 中 err?.message | 依赖不可用的 LanguageService、无异常对象 | 恒走 "LanguageService unavailable" 早返回；成功/失败 summary 文案在代码注释中保留
apps/server/src/saVmTreeSitter.ts:2510-2562 | analyzeFileCoupling：sf.statements 顶层分类（isFunctionDeclaration/isVariableStatement/isClassDeclaration）、{...r} 对象展开、逐候选 try/catch 的 999 失败记录、sort+slice | 无 TS AST、无异常 | collect_top_level 以行首声明 + 花括号深度近似语句范围（结束行非 AST 精确值）；失败记录形态在无数据时产生
apps/server/src/saVmTreeSitter.ts:2564-2699 | buildExtractComponent：throw new Error 拒绝语句块、require("node:path") 函数内调用、JSX 容器花括号平衡扫描（含引号状态机）、String.replace(组件名) 首处替换、void propsDecl/hasJsx 丢弃局部量 | 无异常、无 require | throw 改为 outError 出参（调用方须检查）；平衡扫描手写保留；replace_first 以 find_word 近似（非词界首处语义略有差）

## saVmCodeGraph.ts

apps/server/src/saVmCodeGraph.ts:1-8 | import node:fs、node:fs/promises、node:path + 跨单元 saVmPolicy（backends/vmtool-security）与 saVmResultKind、@codex-ui/shared 类型 | sa_std 无 fs/promises/path 面；跨单元类型不在本单元 | 注释 @import 引用 + 假定 extern（fs_read_file/fs_write_file/fs_readdir 等）；policy/result 以不透明句柄/展平结构体引用
apps/server/src/saVmCodeGraph.ts:11-65 | CodeGraphEdgeKind/CodeGraphMode/direction/format 字符串联合 + CodeGraphOptions 可选字段（candidate_files?: string[] 等） | 无联合/可选字段 | u64 标签（mode 含 module_deps 别名 2）；可选字段改 has_* 标志，string[] 改 \n 拼接缓冲
apps/server/src/saVmCodeGraph.ts:13-49 | CodeGraphNode/Extracted* 接口的可选字段（file?/line?/type?/isDefault?/isNamespace?）与对象数组（fields/methods/symbols/functions） | 无可选字段/动态数组 | has_* 标志 + 定长列表结构体；string[] 改 ", " 拼接缓冲
apps/server/src/saVmCodeGraph.ts:69-94 | cleanSymbolName/extractTypeIdentifiers：链式正则 replace、嵌套 walk 闭包捕获 results、[...new Set()] 去重展开 | 无正则/闭包/Set | 手写剥离+空白折叠；显式递归 + cg_join_add 去重拼接
apps/server/src/saVmCodeGraph.ts:96-222 | extractTsClass/extractTsInterface：?. 可选链、childForFieldName、walkCalls 嵌套闭包（每方法一份）、callText 两段正则剥离 + /^[a-zA-Z0-9_$]+$/ 测试、typeAnn?.replace(/^:\s*/,"") | 无可选链/闭包/正则 | cg_walkCallsTs 显式递归；strip_call_prefix/is_ident_text/strip_colon_prefix 手写等价
apps/server/src/saVmCodeGraph.ts:224-379 | extractTsImports/extractPythonImports/extractPythonClass：递归 visit 闭包、specifier 引号剥离正则、lastNamedChild 回退 | 无闭包/正则 | 显式递归 Visit 函数 + strip_quote_pair
apps/server/src/saVmCodeGraph.ts:381-460 | extractRegexFallback：四条全局正则（含 class extends/implements、三种 import 形态、function、arrow 的捕获组）+ 内层 callRegex 循环 + content.slice(0, m.index).split("\n") 行号 | 无正则引擎 | regexFallbackLine 逐行扫描近似（多行构造与源正则同样不匹配者保持不匹配）；体捕获 [^}]* 以行余量近似
apps/server/src/saVmCodeGraph.ts:462-578 | extractFileInfo：async + await import("web-tree-sitter") 动态导入 + await import("./saVmTreeSitter.js")、每调用新建 Parser、整段 try/catch 回退、visit/walkCalls 闭包、namedChild 迭代 | 无 async/动态导入/异常 | 同步 + 共享 ts_parser_new 假定面；失败路径全部汇入同一 extractRegexFallback 调用；visitTsForInfo/visitPyForInfo 显式递归
apps/server/src/saVmCodeGraph.ts:582-619 | resolveImportFilePath 候选数组 + statSyncSafe 以 require("node:fs") 函数内加载（ESM 中 CJS require）+ try/catch | 无 require/异常 | try_candidate 顺序探测 fs_exists + fs_stat_is_file 假定 extern（失败即 false，等价净效果）
apps/server/src/saVmCodeGraph.ts:621-650 | findProjectSourceFiles：嵌套 walk 闭包捕获 results、readdirSync({withFileTypes:true}) 的 Dirent 对象（isDirectory/isFile/name） | 无闭包、无 Dirent | 显式递归 findFilesWalk + fs_readdir 假定 extern（名字表与目录表分离，本层文件先行——条目交错顺序与源 readdir 顺序有差）
apps/server/src/saVmCodeGraph.ts:652-1139 | buildScopedCodeGraph：async、Map<string, CodeGraphNode>、Set<string>（edgeKeys/visited）、addEdge/getFileAST 闭包捕获（nodes/edges/fileCache/policy/cwd）、BFS 队列 Array.shift()、Array.from(nodes.values()) | 无 async/Map/Set/闭包 | GraphState/FileCache 状态结构体；节点列表线性查找（保持 Map 插入序）；队列改数组+head 索引；edgeKeys 改 \n 拼接集合
apps/server/src/saVmCodeGraph.ts:660-668 | target.trim()、Math.max/min 钳制（depth 1..5、max_nodes 5..100）、?? 默认值链 | 无 ?? | 显式 has_* 标志 + 钳制代码逐项保留
apps/server/src/saVmCodeGraph.ts:915-1049 | call_flow 模式：allFunctions Map<string, {calls, fileRel}>、类方法以 `Cls.method` 与裸名双键登记、两份几乎相同的 BFS 循环（类根/函数根） | 无 Map | FnMap 列表 + fnmap_put/get；两份循环共用 runCallQueue（语义保留，源代码重复未逐字复刻）
apps/server/src/saVmCodeGraph.ts:1050-1139 | symbol_hierarchy 模式：同一搜索循环在源中逐字重复两遍、字段类型 replace(/<.*>$/, "")、/^[A-Z][a-zA-Z0-9_$]*$/ 类名测试、imports.find(i => i.symbols.some(...)) 高阶谓词 | 无正则/高阶函数 | 单遍搜索（getFileAST 有缓存，结果等价）；strip_generic_suffix + 首字母/标识符手写测试；import_has_local 显式循环
apps/server/src/saVmCodeGraph.ts:1143-1195 | formatAsDot：Map<string, string[]> 边分组、key.split("|") 解构、模板拼行 | 无 Map/解构 | 首见键顺序扫描分组 + build_edge_key（source/label 含 "|" 时与源同样脆弱，1:1 保留）
apps/server/src/saVmCodeGraph.ts:1197-1247 | formatAsPyStub：classBases/classFields 双 Map、lines.join("\n").trimEnd()、charAt(0).toLowerCase() | 无 Map | 按节点扫描边重建 bases/fields；尾部空白回退修剪
apps/server/src/saVmCodeGraph.ts:1284-1344 | nativeCodeGraph：Record<string, any> 动态入参、?? 链取值、typeof 运行时类型检查、(rawInput.x ?? "").toString()、Date.now()、saVmEvents 事件对象数组（含 "code_graph" as any 断言）、try/catch 包裹、writeFile 异步写盘 | 无动态 JSON 对象/typeof/异常 | 入参改 JSON 文本 + json_* 查询辅助（键序与 ?? 语义保留，标量 toString 近似）；Date.now 改假定 time_now_ms extern；events 展平为 events_json 文本；catch 分支以失败结果形态登记于代码注释
apps/server/src/saVmCodeGraph.ts:1292-1310 | normalizeSaVmPolicy / checkSaVmPath 跨单元调用 + 退出码 228 capability_denied 透传 | 属 vmtool-security 单元 | 以假定 extern 签名 cg_policy_* 引用，228 与 reason 透传逻辑保留

## 分组 D — providerStore.ts + authStore.ts（日志条目 49 条）

# server-rest 分组 D 缺陷日志（providerStore.ts / authStore.ts）

apps/server/src/providerStore.ts:95-490 | async/await 方法（initialize/list/get/save/delete/trash/restore/import*/export* 等 20+ 个） | SLA 无 Promise/async | 改同步函数 + i32 状态码返回，签名处标 // DEFECT: async
apps/server/src/providerStore.ts:1-20 | node:fs/promises、node:path、node:crypto 与 @codex-ui/shared、@napi-rs/keyring、relayCatalog 跨树导入 | 无 sa_std 对应面 | @import 注释保留符号清单，句柄以 u64 代替
apps/server/src/providerStore.ts:83-93 | class ProviderStore + private readonly 字段 + 默认参数构造 | SLA 无 class/私有/默认参 | struct + &ProviderStore 首参函数族，默认构造由调用方显式传句柄
apps/server/src/providerStore.ts:87-89 | Map<string,string> / Map<string,ProviderConfig> / Set<string> 成员 | SLA 无 Map/Set | JSON 注册表句柄 u64 近似，迭代顺序不保证
apps/server/src/providerStore.ts:26-81 | ProviderConfig/ChannelGroupConfig 等共享动态类型、RelayGroupRow 可选字段 | SLA 无动态对象/可选字段 | 结构化行字段用定长缓冲+has_* 标志，聚合配置走 JSON 文本缓冲
apps/server/src/providerStore.ts:109-151 | keyring await entry.getPassword()、try/catch 回退 apiKeyStorage | 无 OS keyring、无异常 | 状态码近似，keyringEntry 返回 bool，逻辑以注释保真
apps/server/src/providerStore.ts:154-326 | 数组 filter/map/spread（[...persisted, ...values()]）、闭包谓词 | 无闭包/展开 | 顺序调用近似 + DEFECT 注释，语义以注释逐行保留
apps/server/src/providerStore.ts:189-232 | throw new Error、模板字符串 `Provider not found: ${id}` | 无异常/模板字符串 | i32 状态码，消息以注释原文保留
apps/server/src/providerStore.ts:247-259 | NodeJS.ProcessEnv、Object.entries(process.env) 迭代 | 无 process.env 记录类型 | env 记录以 JSON 缓冲近似
apps/server/src/providerStore.ts:337-490 | unknown 入参（importProfile/importRelayConfig/preview/importCapabilityCatalog）+ asRecord 动态解析 | 无 unknown/动态 JSON 类型系统 | 入参改 JSON 句柄 u64，逐字段校验逻辑注释保真
apps/server/src/providerStore.ts:475 | 非空断言 store.providers[providerIndex]! 与 "merge"|"replace" 字面量联合 + 默认值 | 无非空断言/联合类型 | 索引有效性由前置检查注释保证，mode 改枚举码（0/1）
apps/server/src/providerStore.ts:499-556 | RuntimeDatabase.prepare().all/.get/.run、SQL 事务 BEGIN/COMMIT/ROLLBACK、try/catch 回滚重抛 | sa_std 无 SQLite prepared-statement 面 | SQL 文本逐字注释保留，db 以 u64 句柄，事务以注释顺序近似
apps/server/src/providerStore.ts:558-760 | 模板字符串拼 ALTER TABLE、[string,string] 元组数组、for-of 解构 | 无模板字符串/元组/解构 | 列名集合固定，循环以注释展开 18 对 (column,type)
apps/server/src/providerStore.ts:762-900 | Map 返回值 readRelayGroups、.entries() 解构迭代 insertRelayGroups、ReturnType<prepare> 参数类型 | 无 Map/条目迭代/类型运算 | 返回 JSON 对象句柄，prepared statement 以 u64 句柄传参
apps/server/src/providerStore.ts:920-1050 | Object.keys/Object.entries、flatMap、catalog.data 嵌套迭代、JSON.stringify | 无对象反射/flatMap | JSON 缓冲近似，迭代顺序以注释说明
apps/server/src/providerStore.ts:1052-1068 | await readFile(this.file,"utf8") + JSON.parse + 类型谓词 filter | 无 fs/promises 与谓词类型守卫 | 同步状态码近似，守卫改 bool 返回 fn
apps/server/src/providerStore.ts:1071-1090 | validateRelayGroupKeys 中 filter/some 嵌套闭包链 | 无闭包 | 以注释逐条件保留判定式
apps/server/src/providerStore.ts:1092-1250 | normalizeProvider 全字段 unknown 归一化、randomUUID()、对象字面量拼装 | 无动态对象构造 | out JSON 句柄 + bool 成功标志，字段清单注释 1:1 保留
apps/server/src/providerStore.ts:1252-1330 | omniroute-free 分支多层嵌套三元 defaultName、对象展开 {...provider, groups: map(...)} | 无展开/深嵌套三元可读等价式 | 注释逐分支保留映射表
apps/server/src/providerStore.ts:1332-1345 | new URL(value).hostname 解析、try/catch continue | sa_std 无 URL 解析器 | isDeepKeyProvider 以注释保留 deepkey.top 后缀规则，返回 false 占位
apps/server/src/providerStore.ts:1347-1420 | Set 驱动 uniqueGroupValue/mergeProviderGroups、reduce 计分 relayGroupCompletenessScore、every/some | 无 Set/reduce/闭包 | Set 改注册表句柄，reduce 改累加注释，while 后不加分号约定保留
apps/server/src/providerStore.ts:1422-1455 | ensureDefaultRelayGroup 对象展开 + 数组 map 条件改写首组 | 无展开 | JSON 近似 + 注释保留 default 组字面量全字段
apps/server/src/providerStore.ts:1330-1465 | require("@napi-rs/keyring") 动态加载 + 类值 SafeAsyncEntryClass、let 模块级可变绑定 | 无 require/类值 | bool 标志 + 工厂 fn keyringEntry 近似
apps/server/src/providerStore.ts:1467-1485 | 正则 replace 链 providerIdFromName/envKeyForProvider、slice | SLA 无 RegExp | 注释保留正则原文，逐字替换待修复阶段以字节循环实现
apps/server/src/providerStore.ts:1510-1951 | 数十个 *Value 归一化 helper：switch 字面量联合返回、Object.entries/fromEntries、flatMap、includes、条件展开 {...(cond?{...}:{})}、类型谓词 filter | 无联合类型/对象反射/条件展开 | 统一改 (ptr,len)+bool has 模式或 JSON 句柄，逐 fn 注释保留分支表
apps/server/src/providerStore.ts:1560-1660 | serviceProviderValue 中 data:image 正则 + 700_000 长度门、groupArray 大对象逐字段拼装 | 无 RegExp、无动态对象 | 正则原文注释保留，groupArray 以注释保留全字段顺序
apps/server/src/providerStore.ts:1750-1951 | modelCapabilitiesFromValue 的 Object.entries 动态记录迭代、源 source 三元归一、image* 系列小型数组 builder 的 push/includes | 无动态记录迭代 | JSON 句柄近似，push 改追加注释，includes 改注释说明去重
apps/server/src/authStore.ts:100-121 | class AuthStore + static fromEnv + 默认参数（= new LocalDatabase() / = process.env） | 无 class/static/默认参 | struct + AuthStore_fromEnv fn（bool 表示 null），默认由调用方显式传
apps/server/src/authStore.ts:107-121 | process.execPath 正则 /codex-standalone(\.exe)?$/i、try/catch{}、env 模式字符串归一 | 无 process/RegExp/异常 | 注释保留正则与模式表，占位返回 false
apps/server/src/authStore.ts:123-175 | db.exec 多表 DDL、ALTER TABLE try/catch 容错、async initialize/ensureDefaultAdmin | 无异常、无 async | DDL 文本注释保留全量，同步状态码近似
apps/server/src/authStore.ts:177-242 | async login/getUserByToken、await verifyPassword、randomBytes(8).toString("hex")、SELECT ... as UserRow 强转 | 无 async/强转/随机字节 hex 编码面 | bool+out 参数近似，SQL 与判定顺序注释保留
apps/server/src/authStore.ts:16-91 | interface LoginResult/CreateMemberInput/UpdateMemberInput/AuthConfig/UserRow/JwtPayload、可选字段与字符串联合（AuthUserRole 等） | 无 interface/可选/联合 | struct + has_* 标志，联合以定长字符串码保存（已登变形）
apps/server/src/authStore.ts:93-98 | Record<PermissionPresetId, number> PERMISSION_RANK | 无 Record | 改查表 fn PERMISSION_RANK 返回 i64（-1 未知）
apps/server/src/authStore.ts:244-357 | async createUser/updateUser、await hashPassword、email.split("@")[0]、Number()/Math.min/max/floor 数值强制 | 无 async/字符串 split 索引 | 状态码近似，分段规则注释保留（split 取 @ 前段）
apps/server/src/authStore.ts:382-505 | debitBalance/adjustBalance：事务 BEGIN IMMEDIATE + try/catch 回滚后幂等复查、"set"|"add"|"subtract" 联合、模板串 `admin ${operation}` | 无异常/联合 | operation 改枚举码 0/1/2（已登变形），事务与复查顺序注释保真
apps/server/src/authStore.ts:507-530 | Array<Record<string, unknown>> 台账行、JOIN 查询、Math 钳制 limit | 无动态记录数组 | 行集以 JSON 数组缓冲返回，SQL 注释保留
apps/server/src/authStore.ts:533-640 | getUsageSummary 匿名对象返回型、Date 对象 setHours/setDate/toISOString().slice、Map 按日分桶、.get(...paramsBase) 展开调用、模板串 ${whereUser} 拼 SQL | 无 Date 对象/Map/展开调用/SQL 插值 | UsageSummary struct + JSON 字段近似，日期分桶以纪元运算注释说明
apps/server/src/authStore.ts:642-720 | enforceMemberRpc/enforcePermissionParams/filterThreadsForUser 的 unknown params、Record 展开 {...record}、sandboxPolicy 条件赋值 | 无 unknown/展开 | JSON 句柄 + 注释逐条保留钳制规则，filter 的 TEMP 注释语义保留
apps/server/src/authStore.ts:722-760 | claimThread/ownsThread/threadOwnerId/listThreadIdsForUser 的 rows.map 闭包 | 无闭包 | map 以注释保留投影（row.thread_id）
apps/server/src/authStore.ts:800-870 | async changeOwnPassword/verifyPassword（方法名与导入的 verifyPassword 同名重载式共存） | SLA 同名 fn 冲突 | 方法改名 AuthStore_verifyPasswordByEmail（已登变形：加 ByEmail 后缀区分导入函数）
apps/server/src/authStore.ts:872-960 | renewIfExpiring try/catch 回退 null、issueSessionForUser、enableTotp/disableTotp/getTotpSecret 的 NULL 字段写入 | 无异常 | bool 返回近似，catch 分支以注释说明回退路径
apps/server/src/authStore.ts:975-1010 | configFromEnv：读 ~/.config .env 文件正则 match(/CODEX_UI_JWT_SECRET=(.+)/)、existsSync/readFileSync/writeFileSync/mkdirSync 同步 fs、randomBytes(32).toString("base64url") 落盘 jwt.secret | 无同步 fs 全面/RegExp/base64url 编码面 | 全流程注释 1:1 保留，正则原文登记，fs 以 sa_std_fs 待接
apps/server/src/authStore.ts:1012-1030 | Number(value) 字符串解析 positiveNumber、normalizePermission 的 unknown 值判定 | 无 Number() 强制转换语义 | positiveNumber 占位返回 fallback 并注释解析规则
apps/server/src/authStore.ts:1032-1090 | authUserFromRow 字段改名投影（max_permission→maxPermission 等）、inferRequestedPermission/clampPermission 对动态 record 的 stringValue 抽取 | 无动态对象 | UserRow struct 直读 + JSON out 近似，判定表注释保留
apps/server/src/authStore.ts:1092-1150 | permissionToSandbox switch 返回对象含嵌套 sandboxPolicy 动态对象、writableRoots:[cwd] 数组 | 无动态对象字面量 | SandboxOverrides struct，sandboxPolicy 走 JSON 缓冲
apps/server/src/authStore.ts:1152-1180 | coerceWorkspaceCwd 的 "~/" 前缀展开 join(homedir(), slice(2))、pathAllowed 以 join() 作路径规范化 + `${root}/` 前缀判定（硬编码正斜杠） | 无 homedir/slice、路径规范化语义差异 | 注释保留原式与斜杠约定，待修复阶段按平台复核
apps/server/src/authStore.ts:1182-1260 | 手写 JWT：Buffer.from(JSON.stringify).toString("base64url")、token.split(".") 解构、createHmac("sha256")、timingSafeEqual、Partial<JwtPayload> 强转与 typeof 逐字段校验 | sa_std 未暴露 HMAC/base64url/Buffer 面 | 字节缓冲 fn 签名近似，safeEqual 标注必须保持常时比较，校验清单注释全保留
apps/server/src/authStore.ts:1262-1285 | Set 字面量 ADMIN_ONLY_METHODS、startsWith 前缀规则、clampPathsForMember 嵌套 thread 对象展开与 cwds.map 闭包 | 无 Set/展开/闭包 | 成员判定改 fn isAdminOnlyMethodStatic，嵌套改写以注释保留
apps/server/src/authStore.ts:14 | export type { AuthUser, ... } 再导出共享类型 | SLA 无类型再导出 | 文件头注释登记再导出清单，类型由 shared 单元提供

## 分组 E — auggieRedirector.ts + launchInstall.ts + workbenchControlApi.ts（日志条目 0 条）

# server-rest 分组 E 缺陷日志（auggieRedirector / launchInstall / workbenchControlApi）

## auggieRedirector.ts (1275 行)
auggieRedirector.ts:全文件 | Record<string, JsonValue>/Loose/unknown 动态对象 | SLA 无动态 JSON 对象类型 | 全部以 JSON 文本缓冲 (ptr,len)/JsonBuf 近似
auggieRedirector.ts:22,147-175 | node:http Server/IncomingMessage/ServerResponse | sa_std 无 1:1 HTTP server 对象对应 | server 句柄以 opaque u64 表示，请求/响应以 (status, JSON 缓冲) 对传递
auggieRedirector.ts:76,141-142 | 模块级 let 可变状态 (redirectorConfig/Url/Server) | SLA 无模块级 let | 改为 RedirectorState struct 按引用传递
auggieRedirector.ts:130-139,197-203 | 函数字段 closure injectEnvFor 捕获 url/sessionAuthJson | SLA 无闭包 | 拆为独立函数 injectEnvFor(&handle, &state, envJson)
auggieRedirector.ts:147-166 | async/Promise + server.once("listening"/"error") 事件 | 无 Promise/事件机制 | 同步函数 + i32 状态码，listen 近似为同步 bind
auggieRedirector.ts:169-175 | async stopAuggieRedirector (await close) | 无 Promise | 同步近似 + 状态码
auggieRedirector.ts:211-220 | http.createServer(async (req,res)=>{...}) 回调 + try/catch | 无闭包回调/异常 | 返回 opaque 句柄，handleRequest 独立分发，catch 以状态码近似
auggieRedirector.ts:222-287 | async handleRequest + 流式 res | 无 async/流式响应 | body 预读为 JSON 缓冲，响应以 (status, JSON) 返回
auggieRedirector.ts:289-299 | new URL(...) 解析类 | sa_std 无 URL 类 | safeUrlPath 近似为恒等（调用方传已规范化 path）
auggieRedirector.ts:314-360 | 动态对象字面量 + JSON.stringify(registry) 嵌套序列化 | 无动态对象 | fakeModels 以 JSON 缓冲拼装近似
auggieRedirector.ts:362-392 | body.mem_object_names / body.blobs 动态 JSON 遍历 | 无动态字段访问 | 经 sa_json_* 于修复阶段实现，本阶段返回空集近似
auggieRedirector.ts:415-417 | randomUUID (node:crypto) checkpoint id | sa_std 无对应 extern 记录 | 生成延后至修复阶段
auggieRedirector.ts:445-465 | unknown 联合递归遍历 textFromValue | 无 unknown/递归联合类型 | 以 JSON 缓冲 + sa_json_* 近似
auggieRedirector.ts:467-478 | 递归 normalizeSchema + Object.entries 迭代 | 无动态对象条目迭代 | 缓冲透传近似
auggieRedirector.ts:480-497 | try/catch JSON.parse 回退 parseToolSchema | 无异常机制 | 失败回退对象以状态分支近似
auggieRedirector.ts:533-547 | randomUUID 生成 call_ id (nodeToolUse) | 无对应 extern | id 回退延后
auggieRedirector.ts:571-630 | Array.map/filter 闭包链 (history/nodes 文本提取) | 无闭包高阶函数 | 以循环在修复阶段展开，本阶段计数近似
auggieRedirector.ts:681-711 | 浮点 3.2 字符预算 + 对象展开 {...m, content: slice} truncate | 无对象展开；浮点预算近似 | 整数化预算 + 缓冲拷贝近似
auggieRedirector.ts:751-796 | Map<string, ToolCall> mergeStreamToolCalls + filter 闭包 | 无 Map | 以 JSON 缓冲键控合并近似
auggieRedirector.ts:817-830 | Number(...) unknown 强转 estimateUsage | 无动态强转 | 以 JSON 数值读取近似，默认 0
auggieRedirector.ts:944-972 | async callRelay: Promise<Response> + new Request/RequestInit (fetch Web API) | 无 fetch/Request/Response 对应 | 同步 (status, body 缓冲)，经 sa_http_client_* 于修复阶段实现
auggieRedirector.ts:944-972 | randomUUID request_id (无上游时 502 合成响应) | 无对应 extern | id 生成延后
auggieRedirector.ts:997-1033 | async forwardJson + Response.ok/status/text() | 无 Response 对象 | (status, body) 对近似，401/403→502 映射保留
auggieRedirector.ts:1053-1170 | 流式 chunked 响应 forwardStream (res.write 逐 delta) | 无流式写对应 | delta 累积为单一 JSON 缓冲，心跳/终结块时序丢失
auggieRedirector.ts:1053-1170 | writeChunk 闭包 + SSE 回调捕获 accumulated/toolCalls/usage 可变状态 | 无闭包捕获 | 顺序处理近似
auggieRedirector.ts:1176-1201 | async consumeResponsesSse: ReadableStream getReader + TextDecoder 流式解码 | 无流 API 对应 | 整缓冲扫描近似
auggieRedirector.ts:1203-1215 | 回调参数 onEvent (dispatchSseFrame) | 无函数参数/回调 | 分发内联至 consumeResponsesSse
auggieRedirector.ts:1221-1240 | async 迭代器 for-await (req) + Buffer.concat/utf-8 (readJson) | 无异步迭代/Buffer | 调用方提供 raw 缓冲近似
auggieRedirector.ts:1242-1252 | res.writeHead/end (sendJson) | 无 ServerResponse | (status, body) 对返回分发层

## launchInstall.ts (1037 行)
launchInstall.ts:1-6 | Node fs 同步 API 群 + os.homedir + path join/resolve/delimiter + process.env/platform | sa_std 仅部分对应 | 以 sa_std_fs_*/sa_env_* 近似
launchInstall.ts:283-303 等 | Record<string,string> 动态 env 映射 | 无动态对象 | JSON 文本缓冲近似
launchInstall.ts:8-9 | 回调类型 InstallSubLogger (函数类型别名) | 无函数类型 | 以 opaque ctxId + 独立 emit 函数近似
launchInstall.ts:25-144 | const 对象字面量数组 LAUNCH_SPECS (11 条) | 无静态对象表字面量 | launchSpecAt(index) 访问器，字面量表修复阶段物化
launchInstall.ts:223-254 | Set 去重 + 跨模块 toolchainDirCandidates 展开 (pathDirs) | 无 Set；跨模块导入 | 扫描去重近似，跨模块以 extern 调用保留
launchInstall.ts:256-276 | process.platform 分支 + statSync mode 可执行位 (findOnPath) | 平台/元数据近似 | 经 sa_std_fs_* 元数据于修复阶段实现
launchInstall.ts:339-341 | Array.find 闭包谓词 (getSpec) | 无闭包高阶函数 | 索引循环近似
launchInstall.ts:343-405 | try/catch 全失败回退状态 (detectAdapter) | 无异常机制 | 同一回退 struct 填充近似
launchInstall.ts:407-413 | Array.map 闭包 (detectAll) | 无闭包高阶函数 | 循环近似，结果 JSON 缓冲 + count
launchInstall.ts:415-443 | Object.entries/keys 迭代 updates (upsertEnvKeys) | 无动态对象条目迭代 | JSON 缓冲扫描近似
launchInstall.ts:483-505 | 闭包对象 createLineLogger {write, flush} 捕获 pending | 无闭包 | LineLogger struct + 独立 write/flush 函数
launchInstall.ts:507-526 | async readProcessOutput: ReadableStream getReader + TextDecoder | 无流 API | 整缓冲解码近似 + 状态码
launchInstall.ts:528-570 | async runCmd: Promise.all(stdout, stderr, exited) | 无 Promise | 同步近似
launchInstall.ts:528-570 | setTimeout/clearTimeout 超时 kill 定时器 | 无定时器对应 | 以 spawn 超时参数于修复阶段近似
launchInstall.ts:528-570 | env 动态对象展开 {...process.env, ...} (runCmd) | 无对象展开/进程 env 全量读取 | JSON 缓冲合并近似
launchInstall.ts:572-603 | async ensureCloned + throw Error 传播 | 无 async/异常 | outErr 标志 + 状态码
launchInstall.ts:605-631 | async runInstallSh + throw (含 slice(-2000) 尾截取) | 无 async/异常 | outErr 近似
launchInstall.ts:633-694 | async installOne + try/catch | 无 async/异常 | 状态码分支近似
launchInstall.ts:708-838 | async testOpenAiApi: fetch + AbortController 6s/10s 超时 | 无 fetch/AbortController 对应 | sa_http_client_* + 超时参数于修复阶段近似
launchInstall.ts:708-838 | Response/Headers Web API (headers.get, text()) | 无对应对象 | (status, body 缓冲) 近似
launchInstall.ts:840-865 | async validateEnvModeBeforeSave + Set<string> 去重键 | 无 async/Set | 缓冲扫描去重近似
launchInstall.ts:867-935 | async installLaunchAdapters: while(installLock) await Promise 互斥自旋 | 无 Promise 锁 | LaunchInstallState bool 锁标志近似
launchInstall.ts:867-935 | 延迟解析闭包 let release!: () => void | 无闭包 | 锁标志同步置/清近似
launchInstall.ts:937-965 | async writeEnvsOnly (校验错误刻意吞掉) | 无 async | 同步近似，吞错语义以注释保留
launchInstall.ts:983-1027 | randomUUID jobId (createInstallJob) | sa_std 无对应 extern 记录 | id 生成延后
launchInstall.ts:983-1027 | addLog 闭包捕获 logs 数组 + job 对象 (500 条上限) | 无闭包捕获 | state struct 日志追加于修复阶段近似
launchInstall.ts:983-1027 | 即时异步 IIFE fire-and-forget 后台执行 installLaunchAdapters | 无后台 async | 同步调用近似
launchInstall.ts:977,1029-1031 | Map<string, InstallJob> 模块注册表 installJobs | 无 Map | LaunchInstallState jobs JSON 缓冲近似

## workbenchControlApi.ts (963 行)
workbenchControlApi.ts:全文件 | JsonValue / SaVmPolicyConfig / Record<string, unknown> 动态对象 + policy?.tools?.x 深链可选访问 | 无动态对象/可选链类型 | 全部 JSON 文本缓冲 + 键查找近似
workbenchControlApi.ts:2 | @codex-ui/shared 跨模块导入 (5 个函数/类型) | 镜像内无对应 SLA 模块 | 以 extern 风格声明保留至修复阶段
workbenchControlApi.ts:21-199 | 模板字面量多段插值 saVmDeveloperInstructions (含 ${normSkill} 等) | 无字符串插值 | 顺序缓冲追加近似；源字面文本保真保留于 TS
workbenchControlApi.ts:60-118 | ${nextIdx++} 计数器在 push 闭包式调用中自增 | 无闭包；可变捕获近似 | 显式计数器变量近似
workbenchControlApi.ts:21-33 | node:path join 平台分隔符 + 反斜杠归一化 | path API 近似 | 以缓冲拼接 + "/" 归一化近似
workbenchControlApi.ts:201-395 | 动态对象字面量工具规格 saVmDynamicToolSpec (计算 enum 数组 + ~90 属性 schema) | 无动态对象 | 整规格 JSON 文本发射，逐属性描述不重打字
workbenchControlApi.ts:201-395 | (policy.process.bun as any).enabled 类型断言 | 无 any/断言 | JSON 键查找近似
workbenchControlApi.ts:397-560 | 动态对象字面量 enhanceDynamicToolSpec (~55 属性 schema) | 无动态对象 | JSON 文本近似（同上）
workbenchControlApi.ts:562-800 | string[] lines push/join("\n") 构建长指令文本 enhanceDeveloperInstructions | 无动态字符串数组 | 顺序缓冲追加近似；约 200 行字面文本修复阶段搬运
workbenchControlApi.ts:802-830 | throw new Error 必填校验 parseWorkbenchRuntime | 无异常机制 | outErr 标志近似
workbenchControlApi.ts:832-835 | 类型断言 value as SaVmPolicyConfig (parseVmPolicy) | 无断言 | JSON 缓冲透传
workbenchControlApi.ts:837-854 | 动态对象结果 + 跨模块 permissionToTurnOverrides/agentRuntimeThreadConfig (workbenchThreadStartParams) | 无动态对象；跨模块缺失 | JSON 缓冲 + extern 保留
workbenchControlApi.ts:856-859 | 动态对象 AgentRuntimeOverride + parseAgentRuntimeOverride 跨模块 | 无动态对象 | JSON 缓冲近似
workbenchControlApi.ts:861-880 | 嵌套数组字面量 input:[{type:"text",...}] (workbenchTurnStartParams) + throw | 无动态对象/异常 | JSON 缓冲 + outErr 近似
workbenchControlApi.ts:896-917 | 局部辅助闭包 pane/split 捕获 panes 数组 (createWorkbenchLayout) | 无闭包 | 内联 JSON 构造近似
workbenchControlApi.ts:896-917 | Set 唯一性校验 + 类型守卫 filter (value is string) | 无 Set/类型守卫 | JSON 缓冲扫描近似
workbenchControlApi.ts:919-949 | 对象展开 {...current, focusedPaneId} 等增量更新 (applyWorkbenchLayoutAction) | 无对象展开 | JSON 缓冲重建近似
workbenchControlApi.ts:919-949 | Date.now().toString(36) 生成 pane id | 无对应时间/进制 API 记录 | 修复阶段近似
workbenchControlApi.ts:951-961 | Set 校验 pane id/threadId 唯一 (validateWorkbenchLayout) | 无 Set | 扫描近似
workbenchControlApi.ts:963-968 | 递归 + Array.flatMap 闭包 collectPaneIds | 无闭包高阶函数 | 递归缓冲遍历近似
workbenchControlApi.ts:969-974 | 递归 + map/filter 闭包 removePane；sizes 浮点 1/n | 无闭包；浮点 JSON 数 | 递归近似，f64 除法保留
workbenchControlApi.ts:975-983 | 递归 + map 闭包 insertPane | 无闭包高阶函数 | 递归近似，direction 以 tag 表示
workbenchControlApi.ts:985-998 | 浮点百分比 Math.round/min/max (contextUsageView) | 浮点 JSON 数发射近似 | f64 近似
workbenchControlApi.ts:1000-1007 | 正则 /not materialized yet|.../i (isUnmaterializedThreadError) | sa_std 无正则 | 小写子串扫描近似
workbenchControlApi.ts:1000-1007 | instanceof Error 判别 | 无类/实例判别 | 调用方分类近似
workbenchControlApi.ts:1008-1015 | 正则 /rollout .* is empty|.../i (isTransientThreadMetadataError) | 无正则 | 有序子串扫描近似
workbenchControlApi.ts:文件末尾 helpers | unknown 类型守卫 text/number/record (typeof + Number.isFinite) | 无 unknown/守卫 | 调用方提供 isString/isNumber 分类标志近似

## 分组 F — forwardApi.ts + terminalPty.ts + projectRoomStore.ts + providerModels.ts（日志条目 51 条）

# server-rest 分组 F 缺陷日志（forwardApi / terminalPty / projectRoomStore / providerModels）

## forwardApi.ts
apps/server/src/forwardApi.ts:1-18 | import/export re-export + type imports (ForwardModelInventory/ForwardRoute/CliBackend) | SLA 无 TS 类型导入/重导出体系，跨文件类型未对齐 | @import 转发 + JSON 缓冲/不透明句柄近似，保留 FORWARD_RELAY_PROVIDER_ID 转发注释
apps/server/src/forwardApi.ts:27-30 | string[] 常量 + Array.includes | SLA 无动态字符串数组与 includes | 定长常量 + 顺序字节比较近似
apps/server/src/forwardApi.ts:38-40 | Record<string,unknown> + 可选链 ?. 属性访问 | 动态对象，无反射/可选链 | JSON 文本缓冲 + 扫描近似
apps/server/src/forwardApi.ts:52-86 | 嵌套对象字面量 interface ForwardRelayProvider（含 groups 数组字面量类型） | 无嵌套字面量类型与数组字面量 | 展平为 struct + 定长数组(容量1)字段
apps/server/src/forwardApi.ts:87-122 | Set 去重/spread/filter + Date.now() 默认参数 | 无 Set/spread，时钟需 extern | JSON 缓冲去重近似 + extern 时钟
apps/server/src/forwardApi.ts:124-149 | Web Fetch Headers/Request/Response + 模板字符串 Bearer 比较 + JSON.stringify/new Response | sa_std 无 Fetch API | Headers/Request/Response 不透明 struct + 缓冲拷贝近似
apps/server/src/forwardApi.ts:151-196 | async 函数 + Promise<ForwardModelInventory[]> 依赖注入 + await + try/catch + instanceof Error | 无 async/Promise/异常/instanceof | 同步函数 + 状态码 + 错误种类标志近似，签名留 DEFECT: async
apps/server/src/forwardApi.ts:198-220 | interface extends + 函数类型字段 () => Promise / (cli)=>Promise + 模块级可变 let forwardInFlight | 无高阶函数类型/闭包状态 | 函数指针 ID(u64) + ForwardSlotState struct 显式传状态
apps/server/src/forwardApi.ts:232-405 | unknown/Array.isArray/typeof/Record 强转 + 闭包 pushText 捕获 bucket 数组 + 多态 content 联合 | 动态 JSON 多态，无闭包捕获 | JSON 扫描 + bucket 追加内联近似
apps/server/src/forwardApi.ts:407-409 | Date.now().toString(36) + Math.random() 进制转换 | 无等价随机/进制格式化 | extern 时间/随机近似
apps/server/src/forwardApi.ts:423-461 | Record 返回对象 + in 运算符 + ??/?. + 对象 spread 条件展开 ...(cond?{}:{...}) | 无动态对象/in/spread | JSON 缓冲组装 + has_* 标志近似
apps/server/src/forwardApi.ts:463-499 | JSON.stringify 全量估算 token + Math.ceil/max | 动态序列化缺失 | 长度估算近似保留 /4 公式
apps/server/src/forwardApi.ts:501-570 | 判别联合返回 {ok:true,...}|{ok:false,response} + 闭包 fail + instanceof ForwardModelError 分支 | 无联合类型/闭包/异常类 | 状态码 + out 参数近似
apps/server/src/forwardApi.ts:572-942 | ReadableStream async start/cancel + TextEncoder + setInterval/clearInterval 心跳 + unref hack + onDelta 回调 + SSE enqueue/close | 无流/定时器/回调闭包运行时 | 顺序写入近似，releaseOnce/envelope/sawDelta 以显式状态近似，代码留 DEFECT

## terminalPty.ts
apps/server/src/terminalPty.ts:1-7 | Node 内置模块导入 (crypto/child_process/fs/events/module/path) + node-pty IPty 类型 | sa_std 无对应 Node API | 不透明句柄 + extern 近似，文件头统一登记
apps/server/src/terminalPty.ts:22-52 | 类型别名/可选字段 + typeof import("node-pty") 动态类型 | 无动态导入类型/可选字段 | PtyModule/IPty 句柄 struct + has_* 标志
apps/server/src/terminalPty.ts:65-112 | try/catch + process.execPath + createRequire().resolve + Set 去重 + existsSync 过滤链 | 无 require 解析/异常 | 顺序候选检查近似
apps/server/src/terminalPty.ts:114-143 | async defaultPtyLoader + 动态 import() + createRequire 回退链 + attempts 数组 join | 无 async/动态加载 | 同步 loader 近似
apps/server/src/terminalPty.ts:145-256 | class BunFdPipe extends EventEmitter（方法/私有字段/super）+ 猴补 net.Socket 构造器与 prototype + 类型谓词回调查找 | 无类继承/EventEmitter/运行时猴补 | patch 函数仅保留平台/bun/env 守卫，类体无等价实现并留 DEFECT
apps/server/src/terminalPty.ts:258-268 | 可注入函数参数 loader seam + process.env 读取 | 无一等函数赋值语义完整对应 | loader_fn: u64 函数指针 ID 近似
apps/server/src/terminalPty.ts:270-303 | 纯函数字符串 includes 转义序列检测 + 默认参数 process.platform/process.env + 对象返回类型 | env/platform 需 extern | 显式 bool 参数近似，检测逻辑保留
apps/server/src/terminalPty.ts:314-365 | Map/Set 风格 Session 扩展类型 (& 交叉类型) + Promise memoization probeInFlight + probe.onExit 回调 + setTimeout 竞速 | 无 Map/Promise/定时器竞速 | 定长数组 SessionStore(16) + 同步探针近似
apps/server/src/terminalPty.ts:367-372 | 正则 replace(/'/g) shell 引号转义 | 无正则 | 手工扫描近似
apps/server/src/terminalPty.ts:374-482 | child_process spawn + stdio pipe + Set<listener> + 多处 .on 闭包 + IPty 对象字面量 as unknown as 强转 | 无子进程事件/监听器集合 | extern spawn 顺序近似
apps/server/src/terminalPty.ts:484-580 | 注入谓词 exists:(p)=>boolean + String replace/split/pop/toLowerCase 链 + 平台 shell 解析 | 无函数谓词参数/字符串链式 API | extern fs 检查 + 手工 basename 扫描近似
apps/server/src/terminalPty.ts:582-625 | statSync/Number.isFinite/Math.* + throw Error + 正则校验 env key + Object.keys slice | 无异常/正则/反射枚举 | 状态码代替 throw，手工扫描/钳制近似
apps/server/src/terminalPty.ts:627-844 | async createTerminalPty + await 链 + onData/onExit 闭包捕获 session + 对象 spread 合并 env + 条件 spread toInfo + UTF-16 代理对切分 charCodeAt | 无 async/闭包/spread，SLA 字节串无 UTF-16 视图 | 同步 + 函数指针事件 + has_* 标志，chunk 按字节扫描近似并留 DEFECT


## projectRoomStore.ts
apps/server/src/projectRoomStore.ts:1-24 | shared 类型导入 + Pick/Omit/Partial 映射类型构造输入类型 | 无映射类型 | 显式输入 struct + has_* 标志展开
apps/server/src/projectRoomStore.ts:26-80 | 行类型别名 + Set<status> 字面量联合 + as const satisfies readonly 元组 | 无字面量联合/Set/satisfies | 字符串字段 + 有效性谓词函数近似
apps/server/src/projectRoomStore.ts:82-205 | class + private readonly + 构造器默认参数 new LocalDatabase() + db.exec 多表 DDL + 模板 SQL ${column} 插值 + 空 catch ALTER 迁移 + INSERT..SELECT 回填 | 无类/默认构造/SQL 运行时 | struct+init 函数，DDL 为文本常量，逐列固定 SQL 近似
apps/server/src/projectRoomStore.ts:207-268 | prepare().all/get + 类型断言 as Array<...> + flatMap/JSON.parse try/catch + JSON.stringify 入库 | 无 SQLite 绑定/动态 JSON | 不透明 RuntimeDatabase 句柄 + JSON 缓冲近似
apps/server/src/projectRoomStore.ts:270-330 | 对象 spread 条件展开 ...(cond?{...}:{}) + Set retainedAgentIds + 循环删绑定 | 无 spread/Set | 显式字段拷贝 + 线性查找循环近似
apps/server/src/projectRoomStore.ts:332-365 | Map 构建 runtimeById + map/get 变换 agents | 无 Map | 线性搜索近似
apps/server/src/projectRoomStore.ts:367-470 | throw Error + try/catch 唯一约束竞态重查 + isUniqueConstraint 正则判错 + ?? Date.now() | 无异常/正则 | 状态码 + 显式错误分支 + 子串扫描近似
apps/server/src/projectRoomStore.ts:472-560 | Omit & {delta} 交叉类型 + 模板字符串拼接 ${existing}${clip}（不 trim 流式语义）+ undefined 与既有值回退三元链 | 无交叉类型/模板字面量 | 缓冲拼接 + has_* 标志近似，保留不 trim 注释
apps/server/src/projectRoomStore.ts:562-575 | Number.isFinite/Math.floor/min/max 钳制 limit/afterSequence 默认参数 | 数值 API 差异 | 手工钳制近似
apps/server/src/projectRoomStore.ts:577-660 | find/map + "active" as const + INSERT ON CONFLICT DO UPDATE SET excluded.* + filter | 无高阶集合操作/SQL 方言保证 | 显式循环 + SQL 文本常量近似
apps/server/src/projectRoomStore.ts:662-720 | 非空断言 find(...)! + ON CONFLICT upsert vote + filter/some 统计 + 嵌套三元 decision 联合 | 无非空断言/字面量联合返回 | 受检 find（失败状态码）+ decision 以 i64 编码近似
apps/server/src/projectRoomStore.ts:722-800 | INSERT..RETURNING + randomBytes().toString("hex")/Date.now().toString(36) + flatMap/Set 去重 while 改 id + 类型谓词 filter (entry is string) + includes 强转 + 非空断言 phase! + 条件 spread | 无 RETURNING 保证/加密随机/类型谓词 | 两步序列近似 + extern 随机/时间 + 索引循环 + has_* 标志近似

## providerModels.ts
apps/server/src/providerModels.ts:1-33 | 类型导入 (ModelCapabilityDescriptor/RelayAuthType/RelayResponseProtocol) + 对象类型别名 + 常量数组 | 跨包类型未对齐 | 展平 struct + 枚举以字符串缓冲近似
apps/server/src/providerModels.ts:35-105 | async fetchProviderModels + AbortController/setTimeout/fetch().finally + Headers + instanceof Error/AbortError 判别 + Object.fromEntries/flatMap/条件 spread | 无 fetch/Abort/定时器/异常 | 同步 extern fetch + 错误种类标志 + JSON 缓冲近似
apps/server/src/providerModels.ts:107-145 | async testProvider 协议分发 + ?? 默认协议推断 + deprecated 别名转发 | 无 async | 同步分发保留，testProviderChat 直接转发
apps/server/src/providerModels.ts:147-360 | 四个 async test*Provider + await firstProviderModel 回退 + Math.random 选 prompt + replaceAll/encodeURIComponent + JSON.stringify 请求体 | 无 async/随机/URI API 完整对应 | 同步 + extern 随机 + 手工替换近似
apps/server/src/providerModels.ts:362-420 | 正则链 prepareModelsEndpoint（replace /\/+$/、$/i 后缀、版本段检测、bigmodel 特判）+ Headers.set | 无正则 | 手工后缀扫描近似（逐分支保留）
apps/server/src/providerModels.ts:422-475 | JSON.parse try/catch + 正则兜底提取 /\[[\s\S]*\]/ + Map 合并描述符 + entries 展开 | 动态 JSON/正则/Map | JSON 扫描 + 线性去重合并近似
apps/server/src/providerModels.ts:477-560 | 多别名字段探测（camel/snake 多源数组 + flatMap + find 类型谓词 + normalizeReasoningEfforts 外部函数） | 动态记录多态探测 | JSON 字段扫描近似，能力描述符以 JSON 缓冲保留
apps/server/src/providerModels.ts:562-575 | Set 去重 + sort localeCompare(sensitivity:base) 区域排序 | 无区域感知排序 | 字节序排序近似（排序语义差异已登记）
apps/server/src/providerModels.ts:577-660 | 正则 kindLooks*/端点 prepare*（/responses、/chat/completions 后缀与版本段） | 无正则 | 子串/后缀扫描近似
apps/server/src/providerModels.ts:662-695 | Headers 协议鉴权分支 + new URL/searchParams.set 查询鉴权 + protocolKind 映射 | 无 URL/URLSearchParams | 字符串查询拼接近似
apps/server/src/providerModels.ts:697-730 | async firstProviderModel + Number.isFinite 钳制 normalizeTimeout + Date.now() elapsed | 无 async/时钟 | 同步 + 标志参数 + extern 时钟近似
apps/server/src/providerModels.ts:732-764 | JSON.parse 嵌套遍历 extract*Content（map/filter 类型谓词/join）+ extractErrorMessage slice(0,240) 兜底 | 动态 JSON 深遍历 | JSON 扫描近似，保留 catch 回退原文语义注释

## 分组 G — saVmAccountabilityLedger/saVmBundle/gatewayRequestStore/threadRuntimeMetadataStore/imageProtocols/cliVersions（日志条目 0 条）

# server-rest G defects
saVmAccountabilityLedger.ts:1-6 | import node:crypto/fs/path + shared types + nativeJevRedteam | no sa_std equivalents for randomUUID/path/JEV | fs/env externs + JSON buffers
saVmAccountabilityLedger.ts:8-102 | string union types, Record<>, interface optional fields | no union/generic/optional | u64 enums + (ptr,len)+has_ flags + JSON buffer
saVmAccountabilityLedger.ts:103-110 | process.cwd(), resolve/isAbsolute | no process/path API | approximated resolveLedgerPath returning buffer len
saVmAccountabilityLedger.ts:116-122 | function(): never + throw Error | no exceptions/never | return -1 status code
saVmAccountabilityLedger.ts:139-160 | async readFile, JSON.parse per line, try/catch, split regex | no async/Promise/JSON/regex | sync fn + JSON text buffer, skip-line approximated
saVmAccountabilityLedger.ts:165-172 | async mkdir/writeFile flag a | no Promise fs | sync status-code fn
saVmAccountabilityLedger.ts:184-246 | Map/Set, spread, Array.from/filter | no Map/Set/spread/closure | fixed arrays [128] + len fields
saVmAccountabilityLedger.ts:253-256 | async getReputationStatus | no async | sync + status code
saVmAccountabilityLedger.ts:261-301 | async recordPenalty, Date.now(), randomUUID().slice, template id | no Date/UUID/template | sync stub preserving signature fields
saVmAccountabilityLedger.ts:308-390 | async submitRedemption, JevAuditFunction callback Promise, find() closures | no callback/Promise/closure capture | sync fn, auditor as function family placeholder
saVmAccountabilityLedger.ts:395-420 | string|null, filter closures, template literals, join | no nullable string/closure | return len 0=null approximation
saVmAccountabilityLedger.ts:434-545 | async gate, dynamic policy object, optional chaining | no dynamic object/async | sync fn + JSON buffer for policy
saVmAccountabilityLedger.ts:551-635 | async runJevSupervisoryAudit, await nativeJevRedteam, JSON.parse stdout, try/catch fail-closed | no async/JEV extern | sync placeholder, fail-closed noted
saVmAccountabilityLedger.ts:641-676 | async evaluateRedemptionWithJev, some/includes closures | no closure/async | loop approximation noted
saVmAccountabilityLedger.ts:682-712 | RegExp exec loop /(?:do not|never|avoid)/gi | no regex in sa_std | stub returning 0, DEFECT in code
saVmBundle.ts:1-9 | execFile+promisify, fs/promises, homedir, sdk-backend re-export barrel | no promisify/re-export/barrel | @import forwarding comment + fs externs
saVmBundle.ts:38-70 | async ensureSaVmProjectBundleInstalled, readFile/writeFile/cp, .catch(()=>{}) | no async/empty-arrow catch | sync status code
saVmBundle.ts:72-145 | async registerProjectMiniAgentConfig, Record<string,any>, TOML+JSON merges for 5 config files | dynamic object | JSON buffer passthrough
saVmBundle.ts:151-160 | async ensureSaVmGlobalBundleInstalled | no async | sync fn
saVmBundle.ts:183-200 | isSelfManagedMcpEntry: typeof/Array.isArray/spread parts | dynamic object | JSON buffer check stub
saVmBundle.ts:204-230 | stripSelfManagedTomlServer split lines loop | string array dynamic | buffer-length approximation
saVmBundle.ts:239-285 | mergeOpencodeMcpConfig spread/delete/dynamic mcp.servers | dynamic object/delete | JSON buffer fn
saVmBundle.ts:290-315 | mergeMcpServersJsonConfig dynamic object | dynamic object | JSON buffer fn
saVmBundle.ts:321-344 | mergeMiniAgentTomlMcpConfig template literal + JSON.stringify in TOML | no template literal | buffer fn
saVmBundle.ts:351-357 | parseJsonObjectConfig BOM regex + JSON.parse + throw | no regex/throw | status code stub
saVmBundle.ts:364-377 | async upsertSaVmMcpServerJsonFile | no async | sync fn
saVmBundle.ts:380-392 | isClaudeCodeSaVmRegistered regex/split/find closure | no regex/closure | stub bool
saVmBundle.ts:397-405 | runClaudeCli Promise promisify(execFile), win32 shell quoting | no Promise/process spawn bidi equivalent here | sync status stub
saVmBundle.ts:418-437 | async ensureClaudeCodeSaVmRegistered union return + err.code catch | no async/union/exception | u64 enum status
saVmBundle.ts:439-634 | async ensureSaVmMcpInstalled, homedir/platform branches, many try/catch client registrations | no async/platform API | sequential sync approximation
gatewayRequestStore.ts:1-2 | randomUUID, RuntimeDatabase SQLite | no SQLite in sa_std | SQL as string constants, db_handle u64
gatewayRequestStore.ts:11-17 | template literal type `direct/${string}` | no template literal type | endpoint as (ptr,len)
gatewayRequestStore.ts:28-160 | type objects with optional fields, readonly string[] | no optional/readonly | struct + has_ flags
gatewayRequestStore.ts:162-195 | class constructor, db.exec CREATE/ALTER in try/catch loops | no class/exception | *_new fn with db_handle
gatewayRequestStore.ts:197-232 | begin(): spread conditional props, Date.now(), INSERT prepare/run | dynamic spread/Date | struct input via JSON buffer
gatewayRequestStore.ts:235-285 | markFirstToken/finish/cancel prepare/get/run, console.warn, instanceof Error | no SQLite/console | void fns approximated
gatewayRequestStore.ts:287-330 | list/countByThreadSince/existsByTurn SQL queries + try/catch fallback values | no SQLite | status/count stubs preserving fallback semantics noted
gatewayRequestStore.ts:343-375 | recordDirect template endpoint, spread, begin reuse | dynamic object | JSON buffer input
gatewayRequestStore.ts:378-395 | dailyCounts Date/strftime SQL/Map/padStart | no Date/Map | buffer fn, date logic noted
gatewayRequestStore.ts:398-418 | overview Date arithmetic + SQL CASE binding order | no Date | struct out stub
gatewayRequestStore.ts:421-505 | byDimension/byStatus/health SQL template interpolation of column | dynamic SQL | dimension u64 enum stub
gatewayRequestStore.ts:509-560 | performanceByDimension Map grouping, sort closure, percentile ceil | no Map/closure | approximated percentile noted
gatewayRequestStore.ts:563-605 | listPage dynamic conditions array, Buffer base64url cursor, regex LIKE escape | no Buffer/regex/dynamic SQL | filter struct + cursor buffer
gatewayRequestStore.ts:618-627 | map() throw unknown endpoint, spread conditionals | no throw/spread | status code fn
threadRuntimeMetadataStore.ts:1-15 | shared imports, Omit/Pick generics, LocalDatabase/RuntimeDatabase | no generics/SQLite | JSON buffers + db_handle
threadRuntimeMetadataStore.ts:17-75 | ThreadRuntimeMetadataInput/Row with many optional/nullable fields | no optional | struct + has_ flags
threadRuntimeMetadataStore.ts:77-193 | class constructor default param new LocalDatabase(), CREATE + ~18 ALTER try/catch | no class/default arg/exception | *_new fn
threadRuntimeMetadataStore.ts:195-222 | get/getAny prepare/get + mapRow | no SQLite | JSON buffer out
threadRuntimeMetadataStore.ts:224-323 | put() ??/|| merge, ON CONFLICT upsert, get()! non-null assertion | no nullish/non-null/SQLite | sync fn preserving merge comments
threadRuntimeMetadataStore.ts:325-341 | updateWorkspace merge + UPDATE SQL | no SQLite | sync fn
threadRuntimeMetadataStore.ts:344-375 | mapRow chained ternary cliBackend union, hasEnhanceToolsEnabled | string union ternary chain | u64 enum approximation in JSON fn
threadRuntimeMetadataStore.ts:377-430 | normalize* functions: Number.isFinite, regex cwd drive/UNC, trim/slice caps | no regex/dynamic number | typed fns with defaults 80/85
threadRuntimeMetadataStore.ts:414-430 | normalizeAdditionalRoots Array.isArray/some dedupe closure, cap 128 | no closure/dynamic array | JSON buffer fn
threadRuntimeMetadataStore.ts:437-595 | normalizeVmPolicy deeply nested dynamic object, flatMap/filter type guards, spread conditionals for fs/http/env/process/tools/accountability/contextSavings | dynamic object, no flatMap/type guard | JSON passthrough + validation stub, DEFECT in code
imageProtocols.ts:1-14 | ProviderConfig/JsonValue, Record<string,string|number|boolean>, AbortSignal, async runImageGeneration | no fetch/AbortSignal/JsonValue/async | http_client extern + JSON buffers + aborted bool, sync
imageProtocols.ts:25-68 | selectImageGenerationProtocol type predicate + Exclude<> + includes | no type predicate/generic | u64 protocol enum fn
imageProtocols.ts:70-76 | regex isAsyncGeminiImageModel / isGeminiImagePreviewModel | no regex | bool stubs with DEFECT
imageProtocols.ts:78-230 | async runOpenAi/GeminiChat/GeminiGenerateContent/AsyncVideo fetch POST, JSON.stringify spread payload, encodeURIComponent | no fetch/Promise | sync http fns
imageProtocols.ts:232-255 | pollAsyncImageTask while Date.now deadline + sleep + throw | no async/timer/throw | sync stub, deadline noted
imageProtocols.ts:257-295 | async normalize*Response Response.text(), map/filter closures | no Response/async | buffer fns
imageProtocols.ts:297-360 | normalizedImageResult/normalizeImageData dynamic object construction | dynamic object | JSON buffer fns
imageProtocols.ts:362-410 | extractImagesFromUnknown recursive closure visit(unknown), Object.keys, for-of | no closure/unknown/recursion capture | buffer fn, recursion noted
imageProtocols.ts:412-422 | extractUrlValue regex matchAll https/data URLs | no regex/matchAll | buffer stub
imageProtocols.ts:424-437 | uniqueImageData Set<string> + filter closure | no Set/closure | buffer fn
imageProtocols.ts:445-554 | hydrate identity async, errorText/providerBaseUrl throw+regex, geminiNative regex /v1->/v1beta, generationProtocols filter predicate, readJson async, asRecord/asArray casts, sleep Promise+setTimeout+AbortSignal listener | no Promise/timer/regex/throw | sync stubs, DEFECT per fn
cliVersions.ts:1-17 | spawnSync, homedir, path, NodeJS.ProcessEnv/Platform, pluginHost/cliSelectionState imports | no Node env types | env JSON buffer + platform u64
cliVersions.ts:38-84 | module-level mutable npmPrefixProbeCache, spawnSync npm config get prefix cached probe | mutable module state/process spawn | globals approximation + reset fn
cliVersions.ts:86-103 | windowsExecutableExtensions Set/split/map/filter, PATHEXT | no Set/closure | buffer fn
cliVersions.ts:105-139 | nvm/fnm readdirSync via require(node:fs), withFileTypes, try/catch | no require/dynamic fs scan | buffer fns
cliVersions.ts:148-180 | toolchainDirCandidates array filter type predicate + spreads of scanned dirs | no predicate/spread | buffer fn listing toolchains in comment
cliVersions.ts:182-323 | candidateDirectories platform-branched large dir lists, includes dedupe | platform/env dynamic | buffer fn
cliVersions.ts:340-375 | enumerateCliCandidates Set, discovery.envBinVars map/find, win32 extension nested loops | no Set/discovery callback | buffer fn
cliVersions.ts:390-405 | parseRequestedCliKinds Set, split, includes on readonly array | no Set | kinds array buffer fn
cliVersions.ts:408-442 | probeCliVersion Promise + spawn child on(data/error/close) + setTimeout kill + regex version | no Promise/EventEmitter/timer/regex | sync status stub
cliVersions.ts:444-520 | compareVersions parseInt loop (kept), installationMatchesKind delegation, listCliInstallations async Promise.all/Map/sort localeCompare closure | no async/Map/sort closure | compare kept as fn, list as sync stub
cliVersions.ts:522-535 | ensureCliInstallationsCached inflight Promise dedupe then/catch/finally + buildCliKindStatus | no Promise chain | sync fns

## 分组 H — gitWorkspace/threadAgentRosterStore/sshCodeCliBridge/relaySettings/securityStore/remoteBunNode/requestUsageStore/dataGarbageCleaner/commandBlacklist（日志条目 0 条）

# server-rest 分组 H 缺陷日志（批量转换第一阶段，只记录不修复）

gitWorkspace.ts:33-183 | Async: async/await 函数返回 Promise<unknown> | SLA 无 async/Promise | 改同步函数 + 状态码出参，结果以 JSON handle 返回
gitWorkspace.ts:14-21 | Dynamic: Record<string,unknown> 参数与 unknown 返回 | 无动态对象类型 | JSON 文本缓冲/handle 近似，字段访问写为注释
gitWorkspace.ts:19-20 | Closure: GitRunner/PathRemover 函数类型别名与箭头闭包捕获 vmPolicy | 无一等函数/闭包 | runner-kind 枚举 + 分发函数，捕获变量改显式参数
gitWorkspace.ts:226-230,483-490 | Async: Promise.all 并发跑三个 git 命令/三路流读取 | 无并发 Promise | 顺序调用近似
gitWorkspace.ts:262,287,308,378,405,422 | RegExp: split/match/replace 的正则（\s+、stash@\{(\d+)\}、\\/g 等） | sa_std 无正则引擎 | 手写扫描近似，模式原文留在注释
gitWorkspace.ts:1-8 | NodeAPI: node:child_process execFile、fs/promises、path、util promisify | 无 sa_std 对应面 | extern 占位 + 逻辑注释保留
gitWorkspace.ts:183,335,357,410,434,495 | Misc: throw new Error / Error 对象 | 无异常机制 | 返回非零状态码，错误文本留在注释
gitWorkspace.ts:55,60,137,146,154 | Misc: 模板字符串拼接（${upstream}...HEAD、stash@{${index}}） | 无字符串插值 | 定长缓冲拼接近似
gitWorkspace.ts:368,481 | NodeAPI: Date.now() 与 process.env 全量记录构造（Object.fromEntries/flatMap） | 无 env 动态记录 | 时间/环境改为外部注入参数近似
gitWorkspace.ts:486-490 | NodeAPI: new Response(child.stdout).text() 流文本读取 | 无 Web Response/流文本 API | 按 spawn 输出缓冲近似
gitWorkspace.ts:455-466 | Dynamic: parseStatusEntries 中条件展开 ...(oldPath ? {oldPath} : {}) | 无对象展开 | has_oldPath 标志位字段近似
gitWorkspace.ts:437-452 | NodeAPI: resolve/relative/isAbsolute + process.platform 默认参的 Windows 盘符/大小写语义 | 无 node:path 语义层 | platform 改显式 bool 参数，路径逻辑注释保留

threadAgentRosterStore.ts:74-138 | ClassGeneric: class + 构造器默认参 new LocalDatabase() + this.db.exec 建表 | 无类/默认构造参 | struct + ThreadAgentRosterStore_new，默认参改 has_* 标志
threadAgentRosterStore.ts:85-326 | SQLite: RuntimeDatabase prepare/get/all/run 预处理语句 | sa_std 无 SQLite 面 | SQL 文本与绑参顺序注释保留，db 以 handle 表示
threadAgentRosterStore.ts:1,231,282 | NodeAPI: node:crypto randomUUID | 无 sa_std 对应 | handle/外部注入近似
threadAgentRosterStore.ts:42-57 | ClassGeneric: Partial<Pick<ThreadAgentMember, ...>> 映射类型 | 无映射类型/泛型 | patch struct + 每字段 has_* 标志
threadAgentRosterStore.ts:59-70,149 | Collection: Set<AgentMemberStatus> 与 Set<string> desiredKeys | 无 Set 集合 | 字符串等值链/键缓冲近似
threadAgentRosterStore.ts:141,407-431 | Dynamic: JSON.parse/stringify + @codex-ui/shared 的 parseAgentRuntimeOverride 等处理 unknown/动态角色 | 无动态 JSON 对象模型 | JSON 文本缓冲 + 共享包 handle 近似
threadAgentRosterStore.ts:133-137,407-431 | Misc: try/catch 吞错（ALTER TABLE、三个 parse* 回退） | 无异常机制 | 状态码/回退值近似，catch 语义注释保留
threadAgentRosterStore.ts:146,208,238 | Misc: Date.now() 多处取当前时间 | 无时钟面确认 | 时间戳参数近似
threadAgentRosterStore.ts:155-172,320 | Closure: Array.find/filter/map 的谓词闭包 | 无闭包迭代器 | 显式 for 循环近似
threadAgentRosterStore.ts:190-212,482-485 | ClassGeneric: 对象展开 {...current, ...patch}、非空断言 get(...)!、泛型 safeInteger<T extends number|null> | 无展开/断言/泛型 | 逐字段赋值 + has_* 回退近似

sshCodeCliBridge.ts:91-94,239,264 | Async: promisify(execFile) 与 async 探测/安装链 | 无 async/Promise | 同步 + 状态码近似
sshCodeCliBridge.ts:50-53 | Closure: RunRemoteCommand/DetectRemoteOs/SpawnProcess 函数类型别名 | 无一等函数类型 | fn-kind 枚举 + 分发近似
sshCodeCliBridge.ts:55-65 | Closure: options 回调 allocateRemotePort()/onProgress?() | 无回调字段 | 函数 id 字段近似
sshCodeCliBridge.ts:287-342 | Closure: class 实例箭头属性 spawn 捕获 this、Set<ChildProcess>、child.once("exit") 事件 | 无类属性闭包/Set/EventEmitter | struct 函数族 + handle 数组，exit 回调注释保留
sshCodeCliBridge.ts:358-375 | Async: Map<string, Promise<RemoteClaudeTarget>> 缓存 Promise | 无 Promise 值 Map | handle 注册表近似，失败删除语义注释保留
sshCodeCliBridge.ts:82,178,197,225-229 | RegExp: ENV_KEY_PATTERN、版本 \d+\.\d+\.\d+、CLAUDE_BIN 行匹配、Windows 盘符 | 无正则引擎 | 手写扫描近似
sshCodeCliBridge.ts:192-202 | Dynamic: new URL() 解析并改 protocol/hostname/port | 无 URL 对象 | 字符串切分近似
sshCodeCliBridge.ts:158-176 | Dynamic: Object.entries(env Record) filter/map + 展开拼 shell/PowerShell 脚本数组 join | 无动态记录遍历 | env 以 JSON 缓冲遍历近似，脚本原文注释保留
sshCodeCliBridge.ts:240-252,293,427-435 | Misc: try/catch + error as {code,stdout} 类型断言取字段 | 无异常/断言 | 状态码 + 错误字段提取注释近似
sshCodeCliBridge.ts:319,331,428 | NodeAPI: process.env / process.platform / process.cwd() 与 spawnSync taskkill | 无 process 面 | 平台/环境以参数近似
sshCodeCliBridge.ts:262,277,283 | Misc: 可选链 ?. 与空值合并 ?? 链式取值 | 无 ?. / ?? | has_* 标志逐级判断近似
sshCodeCliBridge.ts:96-156 | Misc: 字符串数组 join("; ") 生成远端 shell/PowerShell 探测与安装脚本 | 无可变字符串数组 | 定长缓冲拼接近似，脚本逐行注释保留

relaySettings.ts:108-245 | Dynamic: buildRelaySettingsProvider(input: unknown, existing) 全量动态记录读写 | 无动态对象 | Provider 以 JSON handle 表示，字段路径注释保留
relaySettings.ts:93,236,267,316,356 | Dynamic: 对象展开克隆 {...provider}、{...group}、cloneGroup 深浅拷贝 | 无对象展开 | 逐字段拷贝近似
relaySettings.ts:75,122,155,173,261 | Closure: map/filter/find/findIndex/flatMap/every/some 谓词闭包链 | 无闭包迭代器 | 显式循环近似
relaySettings.ts:261,274,431-437 | Collection: Set 去重 uniqueStrings、Object.entries/fromEntries 过滤 capabilities | 无 Set 与条目对象构造 | 数组线性去重 + JSON 缓冲近似
relaySettings.ts:388-419 | Misc: 字符串联合 kind/responseProtocol 的 switch + default throw | 无联合类型/异常 | 枚举码 + 状态码近似
relaySettings.ts:425-429 | RegExp: slugId 的 replace(/[^a-z0-9._:-]+/g) 正则链 | 无正则引擎 | 手写字符类扫描近似
relaySettings.ts:110,264,282 | Misc: Date.now() 写 updatedAt | 无时钟面确认 | 时间戳参数近似
relaySettings.ts:369-383,362 | Dynamic: firstString(...values) rest 参数 + `key in body` in 操作符探测 | 无 rest 参数/in 探测 | 参数数组 + 字段存在标志近似
relaySettings.ts:358-367 | ClassGeneric: 类型守卫过滤 (entry): entry is string | 无类型守卫谓词 | typeof 判断分支近似

securityStore.ts:39-106 | SQLite: class SecurityStore + RuntimeDatabase 建表/PRAGMA/预处理语句 | sa_std 无 SQLite 面 | struct 函数族，SQL 注释保留
securityStore.ts:1,180-181,195,314 | NodeAPI: node:crypto createHmac/randomBytes/randomInt/timingSafeEqual | SHA1-HMAC、CSPRNG、恒时比较无确认对应 | extern 占位近似
securityStore.ts:330-341 | NodeAPI: Buffer.alloc/writeBigUInt64BE + BigInt(counter) 做 HOTP 计数器 | 无 Buffer/BigInt | 定长 8 字节数组 + u64 BE 写近似
securityStore.ts:343-377 | Misc: base32 编解码的 >>> 无符号移位（u32 语义） | SLA 移位语义需核对 | 以 u32 运算注释近似
securityStore.ts:302,379,422 | RegExp: /^\d{6}$/、\s+ 清理、escapeXml 链式全局 replace | 无正则引擎 | 手写扫描近似
securityStore.ts:319-328 | Dynamic: URLSearchParams + encodeURIComponent 拼 otpauth URI | 无 URL 编码面 | 手写百分号编码近似，参数顺序注释保留
securityStore.ts:379-420 | Misc: 大模板字符串拼 SVG（含 ${} 插值与 animate 噪声） | 无字符串插值/无界字符串 | 8192 定长缓冲拼接近似
securityStore.ts:262-273 | Misc: try/catch + 模板拼 DDL 的 ensureUserColumn（PRAGMA 探测后 ALTER） | 无异常机制 | 状态码近似，DDL 拼接注释保留
securityStore.ts:152,215,255 | Misc: Date.now() 过期判断与时间戳 | 无时钟面确认 | 时间戳参数近似
securityStore.ts:128-155 | ClassGeneric: updateSettings(input: Partial<SystemSettings>) | 无 Partial 类型 | has_* 标志 struct 近似
securityStore.ts:234-242 | Collection: setAllowedProviders 的 Set 去重 + map/filter 链 | 无 Set | 数组线性去重近似

remoteBunNode.ts:88,118,255,306,396 | Async: promisify(execFile) async 安装/探测/健康等待链 | 无 async/Promise | 同步 + 状态码近似
remoteBunNode.ts:226-252,274 | NodeAPI: 全局 fetch 与可注入 fetchImpl 参数、response.json().catch | 无 fetch 面 | HTTP extern 占位，catch 改状态码近似
remoteBunNode.ts:11,196,206 | Collection: tunnels Map<string, {child,...}> 进程级注册表 | 无 Map/子进程句柄集合 | handle 注册表 struct 近似
remoteBunNode.ts:341-352,200 | Closure: completed() 的 Promise executor + child.once/on 事件、openTunnel 的 once("exit") 闭包 | 无 Promise 执行器/EventEmitter | 轮询/状态机近似，事件语义注释保留
remoteBunNode.ts:342,370,385,414 | Timer: setTimeout/delay 与 waitHealth/waitTunnel 轮询等待 | 无定时器 Promise | 计数循环近似，间隔注释保留
remoteBunNode.ts:328-338 | Stream: createReadStream(local).pipe(child.stdin) 上传 | 无流 pipe | 分块读/写循环近似
remoteBunNode.ts:380-382 | NodeAPI: node:net createServer 回调式 freePort | 无 net server 回调面 | extern 占位近似
remoteBunNode.ts:124,261,275 | RegExp: 架构 ^(x86_64|amd64|aarch64|arm64)$、REMOTE_REQUEST_PATH_PATTERN 大正则白名单、方法 ^(GET|POST|PUT|DELETE)$ | 无正则引擎 | 前缀/分段判断近似，正则原文注释保留
remoteBunNode.ts:291,415-416 | NodeAPI: process.env、platform()/arch()、import.meta.url 推 projectRoot | 无 process/import.meta | 参数注入近似
remoteBunNode.ts:321-325 | Dynamic: health 的 base64 解码 JSON.parse 为 Record + health.node.releaseId 动态取值 | 无动态 JSON/Buffer | JSON handle + 字段路径注释近似
remoteBunNode.ts:282-286 | Dynamic: requestRemoteBunNode 的条件展开 headers/body 对象 | 无对象展开 | has_body/has_apiSession 标志近似
remoteBunNode.ts:118-149 | ClassGeneric: installRemoteBunNode 的内联对象参数类型（多可选字段） | 无内联记录类型 | 具名 input struct + has_* 标志近似

requestUsageStore.ts:71-82 | SQLite: class 参数属性 private readonly db + exec 建表；全仓 SQL 用 json_extract 聚合 | sa_std 无 SQLite 面 | struct + db handle，SQL 全文注释保留
requestUsageStore.ts:84-104,386-395 | Dynamic: usage/billingSnapshot 的 JSON.stringify/parse、Omit<...> 输入类型 | 无动态 JSON/Omit | JSON 文本缓冲 + 完整 record struct 近似
requestUsageStore.ts:169-208 | Collection: sumForThreadTurns 返回 Map<string, bucket> 且键用 \u0000 拼接 | 无 Map 返回 | handle 注册表近似，键拼接注释保留
requestUsageStore.ts:33-58,209-214,312-340 | Misc: Date 本地时区解析/月初周初计算/analyticsDaily 的 Date 游标逐日回填 | 无 Date 对象/本地时区语义 | 毫秒戳参数 + 手写年月日近似
requestUsageStore.ts:40,296 | RegExp: parseAnalyticsRange 的 ^\d{4}-\d{2}-\d{2}$ 与 LIKE 转义 replace 正则回调 | 无正则引擎/替换回调 | 手写校验与转义循环近似
requestUsageStore.ts:169-207 | Misc: try/catch + console.warn 吞聚合错误返回空 Map | 无异常/console 面 | 状态码近似，warn 文本注释保留
requestUsageStore.ts:94,104,356,392 | Dynamic: {...existing, ...} 行合并与 map() 的条件展开可选字段 | 无对象展开 | has_* 标志逐字段近似
requestUsageStore.ts:106,187,233 | Misc: prepare(...).all(...args, ...turnArgs) 展开调用不定长绑参 | 无展开调用 | 定长参数数组（上限按源 slice 100）近似
requestUsageStore.ts:118-132,224-232 | Dynamic: TOKEN_SELECT / periodSelect 以字符串拼装动态 SQL 片段 | 无字符串数组 join 拼 SQL 的等价惯例 | SQL 片段全文注释保留，拼装近似
requestUsageStore.ts:108,190-191 | Misc: markDebited 默认参 at = Date.now()、sumForThreadTurns 的 k.threadId! 非空断言 | 无默认参/断言 | has_at 标志 + 显式判空近似

dataGarbageCleaner.ts:1-2,40-57 | NodeAPI: node:fs 同步 API 与 Dirent（withFileTypes）条目 | 无 sa_std fs 目录遍历面 | extern 占位，条目以名称缓冲近似
dataGarbageCleaner.ts:40-77,238-259 | Closure: getPathSize/scanRollouts/removeEmptyDirsSync 递归遍历 | 无递归闭包（scanRollouts 为函数内闭包） | 具名递归函数近似
dataGarbageCleaner.ts:118-139 | Closure: tryRemove 闭包捕获可变 result/options 并回调计数 | 无捕获可变的闭包 | result 改显式 & 参数、类别码分发近似
dataGarbageCleaner.ts:47-77 | Misc: 多层 try/catch 空吞（getPathSize/removeEmptyDirsSync/各分节） | 无异常机制 | 状态码/忽略错误注释近似
dataGarbageCleaner.ts:291 | NodeAPI: process.env.CODEX_UI_DEBUG_LOG 判断 | 无 env 面 | 参数注入近似
dataGarbageCleaner.ts:386-390 | Async: cleanDataGarbage 为 async 包装 sync 实现 | 无 Promise | 同步直调 + 状态码近似
dataGarbageCleaner.ts:82,95 | Misc: Date.now() 与 statSync mtimeMs 做年龄比较 | 无时钟/stat 面确认 | 时间戳与 mtime 改参数近似
dataGarbageCleaner.ts:352 | Misc: 源内写死的 Windows FileHistory 绝对路径字面量（盘符+用户目录） | 路径语义平台相关、无 node:path join | 原样保留为常量注释，join 改分隔拼接近似

commandBlacklist.ts:24-163 | RegExp: BUILTIN_RULES 全部 11 条规则均为大正则（含负向先行断言 (?!\s+--?(?:help|version)) 与 (?!\/)） | sa_std/SLA 无正则引擎（更无先行断言） | 模式全文注释保留，子串/前缀判断近似待修复阶段
commandBlacklist.ts:27-37,149-162 | RegExp: String.raw 拼装 SSH_KEY_NAMES/SSH_SECRET_PATH 等片段再 new RegExp 动态组规则 | 无动态正则构造 | 片段原文注释保留
commandBlacklist.ts:242-269 | Async: recordBlocked async + writeQueue Promise 链串行写日志 | 无 Promise 链 | 同步顺序写近似
commandBlacklist.ts:3-5,246-248 | NodeAPI: fs/promises appendFile/mkdir、randomUUID、new Date().toISOString() | 无对应面 | extern 占位近似
commandBlacklist.ts:242-258 | Dynamic: evidence 记录对象 satisfies Record<string, JsonValue|undefined> | 无 JsonValue/satisfies | JSON 缓冲拼装近似
commandBlacklist.ts:171-173 | NodeAPI: 构造器读 process.env.CODEX_UI_LOG_DIR | 无 env 面 | 参数注入近似
commandBlacklist.ts:323-341 | Dynamic: extractNetworkTargets 用 new URL 解析与 matchAll 迭代 scp 模式 | 无 URL 对象/matchAll | 手写解析近似
commandBlacklist.ts:182,224,228 | Closure: BUILTIN_RULES.find 与 targets.every/allowlist.some 嵌套闭包 | 无闭包迭代器 | 显式循环近似
commandBlacklist.ts:176-179 | Collection: logFiles 以 Set 去重构造 | 无 Set | 数组线性去重近似
commandBlacklist.ts:280-318 | RegExp: normalizeCommand/redactSensitiveCommand/maskConnectionIdentity 的链式 replace 与 split/join（均正则） | 无正则替换 | 手写扫描近似，替换规则注释保留

## 分组 I — 13 个中型文件（含 runtime/server.ts）（日志条目 0 条）

# server-rest 单元 分组 I 缺陷日志

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`
源根：apps/server/src/（plugins @ f2cb649d）

## threadSubscriptionRegistry.ts
threadSubscriptionRegistry.ts:1 | import { EventEmitter } from "node:events" | sa_std 无 EventEmitter | emit/on 以宿主回调桩近似，代码留 DEFECT
threadSubscriptionRegistry.ts:2 | CodexRuntimeClient（@cxu/sdk-backend）类型 | 无对应 extern 类型 | 不透明 u64 句柄
threadSubscriptionRegistry.ts:7-16 | Set<string>（watchers/activeTurnHolds） | SLA 无 Set | 定长数组+len（容量 64）
threadSubscriptionRegistry.ts:18 | class extends EventEmitter 类继承 | SLA 无类/继承 | struct + &Struct 函数族
threadSubscriptionRegistry.ts:19 | Map<string, ThreadEntry> | SLA 无 Map | 定长数组（容量 256）+ 线性扫描
threadSubscriptionRegistry.ts:20-26 | 构造注入闭包 getClient | 无一等函数/闭包捕获 | get_client_id 不透明 id，宿主分发
threadSubscriptionRegistry.ts:28-34 | client.on("status", 闭包) 事件订阅 | 无事件系统 | 宿主接线到 reAttachAll 的桩
threadSubscriptionRegistry.ts:36-330 | async/await + void 浮动 Promise（ensureSubscribed/close/evaluateUnsubscribe/reAttachAll） | 无 async/Promise | 同步函数+状态码，fire-and-forget 改顺序调用
threadSubscriptionRegistry.ts:16,122-288 | ReturnType<typeof setTimeout> / clearTimeout 定时器 | 无定时器 API | i64 句柄（-1=null）+ 宿主定时器登记，回调以 entry 索引传递
threadSubscriptionRegistry.ts:178-210 | diagnostics() 动态对象返回 + Array.map/reduce/filter | 无动态对象/高阶函数 | JSON 文本缓冲序列化 + 扫描计数
threadSubscriptionRegistry.ts:219-268 | try/catch + Error 对象 + emit("subscriptionError", {error}) | 无异常/Error 对象 | 状态码 + 错误码/消息缓冲 + 宿主回调桩
threadSubscriptionRegistry.ts:270-288 | 2 ** Math.min(attempt, 6) 指数退避 | 无 ** 语义差异风险（已等价改写） | 位移 1 << min(attempt,6) 后 min 封顶
threadSubscriptionRegistry.ts:333-346 | unknown 联合收窄（Error|string|object）+ RegExp.test | 无 unknown/正则 | (code,msg) 约定 + 两条字面量大小写不敏感子串扫描

## freeModelAccess.ts
freeModelAccess.ts:1,17-22 | @napi-rs/keyring AsyncEntry + createRequire 动态 require + 模块级 try/catch | 无原生 keyring/动态加载 | 可用性 bool + extern 桩
freeModelAccess.ts:2-7 | node:child_process/crypto/fs/promises/module/os + promisify | 无对应 Node API 集 | sa_std process/sha256/fs extern 近似
freeModelAccess.ts:11 | KEY_PATTERN 正则 /^cxu-[A-Za-z0-9]{48}$/ | 无正则 | 手写前缀+字符集校验 fn
freeModelAccess.ts:13-15 | Set<string> DEVELOPMENT_MACHINE_HASHES | 无 Set | 定长数组（1 条）
freeModelAccess.ts:34-65 | 字符串字面量联合（reason/storage）+ 交叉类型 &（FreeModelRefreshAuthorization） | 无联合/交叉类型 | u64 编码 + 字段扁平化
freeModelAccess.ts:67 | Omit<FreeModelAccessStatus, ...> 映射类型 | 无映射类型 | 同结构、被 omit 字段忽略
freeModelAccess.ts:79-89 | 构造 throw + 可选链 ?. + replace(/\/+$/, "") | 无异常/正则 | 状态码 -2 + 手工 trim/尾斜杠剥离
freeModelAccess.ts:91-303 | async/await（status/saveKey/request 等全类） | 无 async | 同步+状态码，结果走 mgr 输出 scratch
freeModelAccess.ts:111-114 | Promise.all 并行双请求 | 无并发 Promise | 顺序阻塞调用（并发丢失）
freeModelAccess.ts:136-267 | keyring getPassword/setPassword/deleteCredential 的 await | 无 keyring | extern 桩，失败按源码 catch 吞掉
freeModelAccess.ts:278-281 | machineHashPromise ??= 懒 Promise 记忆化 | 无 Promise | resolved 标志 + 缓存字段
freeModelAccess.ts:283-303 | 泛型 request<T> + fetch + AbortController + setTimeout(10_000) 中止 | 无泛型/fetch/AbortController | 阻塞 HTTP extern + 超时标量参数
freeModelAccess.ts:283-303 | Record<string, unknown> 请求体 + 模板字符串报错 `HTTP ${status}` | 无动态对象/模板字面量 | JSON 文本缓冲 + 格式化错误缓冲
freeModelAccess.ts:306-328 | execFileAsync("reg.exe") + stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i) 捕获组 + createHash 链式 update/digest | 无正则/捕获组 | "REG_SZ" 手工扫描取行尾 + sa_std sha256 extern
freeModelAccess.ts:122-134 | saveKey 中文错误消息 throw（密钥格式/未配置/许可证） | 无异常 | 状态码 -3/-4/-5，中文原文留 err 缓冲待修复期
freeModelAccess.ts:91-107 | 对象展开 {...unconfiguredStatus, configured: true, serviceError} | 无展开语法 | 字段逐个拷贝后覆写

## codexCommand.ts
codexCommand.ts:1 | node:child_process execFileSync/spawn + ChildProcessWithoutNullStreams 类型 | 无对应 | sa_std process extern + 不透明进程句柄
codexCommand.ts:4-7 | export { resolveCliSpawn as resolveCodexSpawn, ... } SDK re-export | 无 re-export 语义 | @import 转发注释保留导入面
codexCommand.ts:11 | readonly 元组 BUNDLED_APP_SERVER_NAMES as const | 无只读元组 | 两个命名常量
codexCommand.ts:12 | 函数类型 ChatGptInstallLocationLookup = () => string|undefined | 无一等函数类型 | 函数 id 约定 + (out)->len
codexCommand.ts:14-27 | try/catch + fs Stats 对象（isFile/mode） | 无异常/Stats 对象 | 状态码 extern 输出 (is_file, mode)
codexCommand.ts:29-328 | NodeJS.ProcessEnv 动态对象 + string|undefined 返回（多函数） | 无动态对象/undefined | env_id + extern getter；len + has 标志约定
codexCommand.ts:115-162 | stdout.split(/\r?\n/).map().filter() + candidates.push(...found) 展开 | 无正则/展开/高阶函数 | 手工逐行扫描 + 定长候选数组（32）追加
codexCommand.ts:164-167 | 正则 /(?:^|[\\/])codex[-_]app[-_]server(?:\.exe)?$/i | 无正则 | 后缀手工扫描（大小写不敏感、可选 .exe）
codexCommand.ts:169-174 | string[] 返回（codexAppServerArgs） | 无动态数组返回 | argv scratch 写入 + 返回 argc
codexCommand.ts:193-217 | PowerShell 命令模板字面量（含 ${CHATGPT_APPX_PACKAGE_NAME}）+ execFileSync 选项对象 | 无模板字面量/选项对象 | 固定命令缓冲拼接常量 + 标量参数 spawn-capture extern
codexCommand.ts:243-265 | env.PATH ?? env.Path ?? env.path 空值合并链 | 无 ?? | 顺序 extern 读取回退
codexCommand.ts:267-274 | [...new Set([...supported, ...defaults])] 去重 | 无 Set/展开 | contains 检查后追加
codexCommand.ts:286-308 | 正则 /^(1|true|yes)$/i（环境开关解析） | 无正则 | 三字面量大小写不敏感比较
codexCommand.ts:310-328 | SpawnOptions 对象展开 {...options, stdio, windowsHide} + /\.ps1$/i 正则 | 无展开/正则 | 显式字段传递 spawn extern + 后缀检查

## forwardTurn.ts
forwardTurn.ts:1,20-22 | EventEmitter + interface ForwardBridge extends EventEmitter + request(): Promise<unknown> | 无事件/Promise/接口继承 | 不透明 bridge 句柄 + 阻塞 request extern
forwardTurn.ts:24-53 | Record<string, any> / unknown 动态 JSON（params、路由、结果） | 无动态 JSON | JSON 文本缓冲 + sa_json extern 遍历
forwardTurn.ts:29-42 | 可选回调 onDelta?(text, source) + AbortSignal signal? | 无回调类型/AbortSignal | 回调 id 宿主分发 + 信号句柄轮询
forwardTurn.ts:55-77 | unknown 收窄 asRecord + rest 参数 ...keys（stringField） | 无 unknown/可变参数 | 节点种类检查 + 调用点展开（≤2 key 形态）
forwardTurn.ts:79-109 | 递归闭包 visit 捕获 texts 数组 + 正则 /tool|function|reasoning|.../i kind 过滤 | 无闭包捕获/正则 | 显式累加器参数递归 fn + 子串扫描集
forwardTurn.ts:111-120 | 模板字面量 `${type} ${kind}` + 正则过滤 | 无模板字面量/正则 | 拼接缓冲 + 子串扫描
forwardTurn.ts:130-290 | async runForwardTurn + throw Error（空 prompt/无 threadId） | 无 async/异常 | 同步+状态码（-1/-2），结果走 out struct
forwardTurn.ts:159-243 | 闭包 onNotification/onAbort 捕获 settled/chunks/buffered 等可变状态 | 无闭包 | ForwardTurnState struct + 命名函数显式传参
forwardTurn.ts:185-243 | bridge.on/off("notification") + signal.addEventListener("abort", {once:true}) | 无事件系统 | 宿主注册桩
forwardTurn.ts:245-268 | await new Promise + 50ms setTimeout 轮询 + timeoutMs 超时定时器 | 无 Promise/定时器 | 宿主等待循环近似（轮询 settled）
forwardTurn.ts:130-290 | try/finally（cleanup）+ .catch(() => undefined) 吞错 | 无 finally | 每出口显式 cleanup 调用 + 忽略状态码
forwardTurn.ts:292-312 | Object.values(record) 迭代 + 递归闭包 visit 捕获 last | 无 Object.values/闭包 | sa_json 键枚举 extern + 显式 out 参数
forwardTurn.ts:314-317 | resolveForwardRoute 透传 parseForwardModelId 的抛错语义 | 无异常 | 状态码 + err 缓冲

## saVmSplitWorkflow.ts
saVmSplitWorkflow.ts:1-6 | node:crypto/fs/promises/os/path + SaVmPolicyConfig（@codex-ui/shared 动态对象） | 无对应 Node 集/动态配置 | sha256/uuid/fs/path extern + 策略不透明句柄
saVmSplitWorkflow.ts:21-48 | Record<string, SplitFileState> + ops?: Array<{path, content?, patch?}> | 无动态 Record | 定长条目数组 + 序列化 scratch（ops 容量 20）
saVmSplitWorkflow.ts:50-53 | 箭头函数常量 hashContent/stagedDigest/splitRoot/manifestPath | 无箭头函数常量 | 命名 fn
saVmSplitWorkflow.ts:51 | Object.entries + sort(localeCompare) + `${path}\0${hash}` 模板拼 digest 输入 | 无 localeCompare/模板字面量 | 字节序排序近似 + 手工 NUL/换行拼接
saVmSplitWorkflow.ts:54-299 | async/await 全文 + throw Error（各校验点） | 无 async/异常 | 同步+状态码，顶层 catch-all 转 result(false, "", msg)
saVmSplitWorkflow.ts:58-64 | replace(/\\/g, "/") 正则 + resolve/relative/sep 路径规范化 | 无正则 | 手工反斜杠扫描 + path extern
saVmSplitWorkflow.ts:66-81 | JSON.stringify(manifest)/JSON.parse + as SplitManifest 断言 + randomUUID | 无类型断言 | 手工序列化/解析进 struct；uuid extern
saVmSplitWorkflow.ts:75 | 正则 /^[a-f0-9-]{36}$/i 校验 workflow id | 无正则 | 手工字符集+长度检查
saVmSplitWorkflow.ts:89-103 | manifest.files[path] 动态键读写 + await readFile | 无动态键对象 | 条目数组索引
saVmSplitWorkflow.ts:112-126 | split(/\r?\n/) + visible() 数组展开截断 + map(line => `-${line}`).join("\n") 拼 diff | 无正则/展开/高阶函数 | 逐行扫描 + 两段拷贝 + 格式化追加
saVmSplitWorkflow.ts:128-152 | Set<string> touched + [...touched].sort() 返回 | 无 Set/展开 | 定长数组去重 + 字节排序
saVmSplitWorkflow.ts:154-179 | Object.entries 迭代 + try/catch 回滚补偿 + manifest.files[path]! 非空断言 | 无异常/断言 | 状态码 + 补偿循环保留 + 索引检查
saVmSplitWorkflow.ts:181-299 | {...result(...), durationMs, saVmEvents: [{...}]} 展开与事件对象数组（各 action 返回） | 无展开/动态对象 | 字段显式赋值 + 事件 JSON 文本
saVmSplitWorkflow.ts:181-299 | 大段模板字面量拼 stdout（split_plan/status/stage/repair 各分支） | 无模板字面量 | 格式化追加进 out.stdout_buf，原文结构保留于注释
saVmSplitWorkflow.ts:83-87 | checkSaVmPath/normalizeSaVmPolicy 跨仓导入（backends/vmtool-security）返回决策对象 {allowed, reason} | 镜像外单元、无动态对象 | extern 决策码 + reason 缓冲

## regressionRunner.ts
regressionRunner.ts:14-16 | export { loadRegressionCases, resolveRegressionCasesDir } from "@cxu/sdk-backend" re-export | 无 re-export 语义 | @import 转发注释
regressionRunner.ts:44-78 | Partial<RegressionCase> + caseDef as RegressionCase 断言 + JSON.stringify(fullCase, null, 2) | 无 Partial/断言 | 全 struct 始终携带 + 序列化 scratch
regressionRunner.ts:53 | id.replace(/[^a-zA-Z0-9_-]/g, "-") 正则清洗 | 无正则 | 字符集扫描替换
regressionRunner.ts:80-107 | class RegressionFakeRuntimeClient extends EventEmitter implements CodexRuntimeClient + emit("status") | 无继承/接口实现/事件 | struct + fn 族，emit 桩
regressionRunner.ts:80-107 | JsonValue/JsonRpcId/JsonRpcFailure["error"] 动态 JSON 类型（@codex-ui/shared） | 无动态 JSON | JSON 文本缓冲
regressionRunner.ts:109-259 | async runRegressionCase + try/catch 包裹分发 | 无 async/异常 | 同步+状态码，错误转 violations.push("Execution error: ...")
regressionRunner.ts:113-256 | 模板字面量日志/违规消息（全分支） | 无模板字面量 | 格式化追加，字面量原文保留
regressionRunner.ts:128-185 | new ThreadSubscriptionRegistry(() => client) 闭包 + diagnostics() 动态对象读数 | 无闭包/动态对象 | client 句柄 id 作 get_client_id；诊断 JSON scratch 解析计数
regressionRunner.ts:166,181 | await new Promise((r) => setTimeout(r, 5)) 睡眠 | 无 Promise/定时器 | extern sleep 5ms
regressionRunner.ts:186-213 | caseDef.input?.prompt 可选链 + String() 强转 + new Error(...) 模拟拒绝错误 | 无可选链/Error 对象 | JSON 字段探针；消息 (ptr,len) 传谓詞 extern
regressionRunner.ts:230-247 | simulation?.rounds 动态迭代 + JSON.stringify(round).includes(pattern) 负向匹配 | 无动态对象迭代 | sa_json 数组枚举 + 子串检查
regressionRunner.ts:261-296 | results.filter(...).length 聚合 + 中文 summary 数组 join（🚨/✅ 行） | 无高阶函数 | 计数循环 + 格式化追加（中文/emoji 原文保留待修复期）

## localDatabase.ts
localDatabase.ts:5-6 | export { codexUiDataDir } from "@cxu/sdk-backend" re-export | 无 re-export 语义 | @import 转发注释
localDatabase.ts:9-25 | class + readonly 字段初始化 + get connection() getter | 无类/getter | struct + 构造 fn + 访问器 fn
localDatabase.ts:12-21 | mkdirSync 选项对象 + openRuntimeDatabase（SQLite）+ db.exec PRAGMA | sa_std 无 SQLite 封装 | 不透明 db 句柄 + exec extern 桩
localDatabase.ts:20 | void chmod(file, 0o600).catch(() => undefined) 浮动 Promise | 无 Promise | 调用后忽略结果（与源码一致）
localDatabase.ts:28-222 | 194 行 SQL 模板字面量批量 DDL（exec 一次执行） | 无多行模板字面量 | SQL 原文以 SQL-BEGIN/SQL-END 注释块逐字保留，修复期转 extern 字符串常量
localDatabase.ts:224-254 | Array<[string, string]> 元组数组 + for..of 解构 [column, type] + try/catch ALTER TABLE | 无元组解构/异常 | 平行数组 + 索引循环 + 忽略状态码（已存在列）

## imageHistoryStore.ts
imageHistoryStore.ts:5-13 | items: JsonValue[] 动态 JSON（@codex-ui/shared） | 无动态 JSON | items_json 文本缓冲
imageHistoryStore.ts:41 | Set INLINE_IMAGE_KEYS 成员判断 | 无 Set | 字面量列表成员检查 fn
imageHistoryStore.ts:43-71 | unknown 类型守卫 isRecord + 递归 hasInlineImageValue + Object.entries + Array.some 闭包 | 无 unknown/高阶函数 | sa_json 节点检查 + 显式递归 + 提前退出循环
imageHistoryStore.ts:49-50 | 正则 /data:image\//i + includes(";base64,") | 无正则 | 子串扫描（data:image 大小写不敏感）
imageHistoryStore.ts:77-90 | throw Error + typeof TextEncoder !== "undefined" 特性探测 + JSON.stringify 字节数 | 无异常/TextEncoder | 状态码；字节数以序列化缓冲 UTF-8 长度直算
imageHistoryStore.ts:106-122 | Pick<LocalDatabase, "connection"> + 默认参数 = new LocalDatabase() | 无 Pick/默认构造注入 | db 句柄参数（0 表示先构造 LocalDatabase）
imageHistoryStore.ts:143-172 | prepare(...).all(...) as ImageHistoryRow[] 断言 + page.flatMap + 行内 try/catch JSON.parse | 无断言/高阶函数 | extern 位置参数数组 + 循环跳过解析失败行
imageHistoryStore.ts:124-245 | SQL 模板字面量 prepare（LENGTH 过滤/LIMIT/OFFSET/changes()） | 无模板字面量 | 固定 SQL 常量（修复期）+ prepare extern
imageHistoryStore.ts:174-198 | omitted?.count ?? 0 等可选链/空合并（stats/get/put 多处） | 无可选链/?? | 空行分支填零/返回未找到码
imageHistoryStore.ts:226-245 | Omit<ImageHistoryEntry, "createdAt"|"updatedAt"> 输入 + Date.now() | 无 Omit/时钟 API | 同 struct 忽略时间字段 + 时钟 extern

## websocketRuntime.ts
websocketRuntime.ts:3-12 | WebSocketRuntimeConfig & {...} 交叉类型 + allowedOrigins: string[] | 无交叉类型 | 扁平 struct + 定长数组（容量 64）
websocketRuntime.ts:24-52 | Record<WebSocketRuntimeProfile, Omit<...>> 配置表 PROFILE_DEFAULTS | 无 Record/Omit | 三行常量表按 profile 码选择
websocketRuntime.ts:54-118 | NodeJS.ProcessEnv 动态对象 + options = {} 默认 + ?? process.env 回退 | 无动态对象/?? | env_id + extern getter + has 标志
websocketRuntime.ts:176-191 | resolveProfile throw new Error(模板消息) | 无异常/模板字面量 | 返回码 -1 + 格式化 err 缓冲
websocketRuntime.ts:152-201 | Fetch Request/Headers.get("origin") + new URL(request.url) 解析（origin/protocol/host） | 无 Fetch/URL API | (url 缓冲 + headers JSON 缓冲) 参数 + URL extern 桩
websocketRuntime.ts:203-205 | value?.split(",")[0]?.trim() ?? "" 可选链 | 无可选链 | has 标志 + 首逗号扫描
websocketRuntime.ts:217-220 | replace(/^\[|\]$/g, "") 正则剥方括号 | 无正则 | 手工首尾括号裁剪
websocketRuntime.ts:233-243 | normalizeWebSocketPath throw + replace(/\/{2,}/g, "/") | 无异常/正则 | 状态码 -1 + 斜杠连续段折叠扫描
websocketRuntime.ts:245-248 | Number(value) 强转 + Number.isFinite（undefined→NaN 路径） | 无 NaN 语义 | 手工数值解析，失败标志代替 NaN
websocketRuntime.ts:120-135 | 子集对象字面量返回（publicWebSocketRuntimeConfig） | 无对象字面量返回 | out struct 字段逐个拷贝

## threadHistoryTail.ts
threadHistoryTail.ts:1-2 | node:fs/promises open/stat + Buffer.allocUnsafe/subarray/toString("utf8") | 无 Buffer/Promise 句柄 | sa_std_fs 定点读 extern + 定长文本 scratch（6 MiB）
threadHistoryTail.ts:10-17 | Record<string, unknown> JsonRecord + 交叉类型 TailItem/TailTurn | 无动态 Record/交叉 | JSON 缓冲 + id/type 字段探针
threadHistoryTail.ts:24-84 | async readThreadHistoryTail + throw + try/finally 句柄关闭 | 无 async/异常/finally | 同步+状态码（-1/-2/-3）+ 各出口显式 close
threadHistoryTail.ts:40-59 | 探测回退循环 text.indexOf("\n")/slice + text.split(/\r?\n/) | 无正则分割 | 手工逐行扫描
threadHistoryTail.ts:61-71 | 每行 try/catch JSON.parse（尾行残缺容忍） | 无异常 | 解析状态分支跳过坏行
threadHistoryTail.ts:86-139 | Map<string, TailTurn> byId + 闭包 ensureTurn 捕获 turns/byId/current/sequence | 无 Map/闭包 | TailTurns struct + 命名 fn tailTurns_ensureTurn
threadHistoryTail.ts:93-104 | { ... } satisfies TailTurn 运算符 | 无 satisfies | 直接构造，运算符丢弃
threadHistoryTail.ts:141-171 | switch(type) 分发 + 对象字面量 item + ?? 链 + stringValue(...)! 非空断言 | 无动态对象字面量/断言 | if 链 + JSON 文本拼装（字段序同源码）+ 检查后取值
threadHistoryTail.ts:179-196 | 泛型 truncateTailItem<T extends TailItem> + 截断模板（含中文标记 …[历史过长已截断…]） | 无泛型/模板字面量 | 就地改 JSON 缓冲 + 格式化（中文保留）；slice 按字节近似字符截断（UTF-8 边界风险已注）
threadHistoryTail.ts:173-177 | turn.items.findIndex(闭包) + {...turn.items[i], ...item} 展开合并 upsert | 无高阶函数/展开 | id 扫描 + JSON 字段合并 extern
threadHistoryTail.ts:198-223 | JsonValue[] 构造 userMessageContent + value.map(String) + Number.isFinite 时间戳换算 | 无动态数组 | JSON 数组文本拼装 + 逐元素字符串化 extern

## saVmExecutor.ts
saVmExecutor.ts:58-68 | resolveSaVmPluginPath/resolveSaVmExecutable/vmProcessEnv 无条件 throw "bun branch: ..." | 无异常 | 状态码 -1 + 消息入 err（占位行为 1:1 保留，未修复）
saVmExecutor.ts:70-75 | 闭包工厂 collectChunks(chunks, max) 返回回调 + Buffer 累积 | 无闭包/Buffer | ChunkCollector struct + 命名 fn
saVmExecutor.ts:77-87 | 正则 line.match(/sa-vm-event:\s*(\{.*\})\s*$/) + flatMap + JSON.parse try/catch + match[1]! 断言 | 无正则/断言/高阶函数 | 逐行扫描提取尾部 JSON + 解析状态分支
saVmExecutor.ts:90-188 | async runChild + spawn 事件模型（stdout/stderr data、error、close）+ Promise executor/.finally/.catch | 无 async/事件/Promise | 阻塞 spawn-collect extern + 清理显式调用
saVmExecutor.ts:124-140 | setTimeout 超时回调 + AbortSignal addEventListener("abort") + try/catch killProcessTree/child.kill | 无定时器/信号对象 | 宿主定时器登记 + 忽略状态码
saVmExecutor.ts:190-207 | runScript env 对象展开 {...(env ?? process.env), ...(isPython ? {...} : {})} + .then(applySlimPolicy) | 无展开/Promise 链 | env 句柄克隆 + 条件 set 三键 + 顺序调用
saVmExecutor.ts:210-222 | compileSla 判别联合 Promise<{ok:true}|{ok:false,result}> + throw | 无判别联合/异常 | 状态码 -1
saVmExecutor.ts:225-237 | 正则 /pass|fail|error|warning|✓|✗|ok\b/i（含 unicode 标记与 \b） | 无正则 | 子串/字节扫描（✓/✗ 按 UTF-8 字节；ok\b 近似词界扫描）
saVmExecutor.ts:225-237 | {...result, stdout: `[slim] ...`} 展开返回 + 模板字面量 | 无展开/模板字面量 | 就地替换 result.stdout + 格式化缓冲

## legalPolicyStore.ts
legalPolicyStore.ts:18-36 | process.env.CODEX_UI_LEGAL_DIR + fileURLToPath(import.meta.url) + process.cwd() 候选目录探测 | 无 import.meta/URL API | 宿主 base dir extern + env extern，候选顺序不变
legalPolicyStore.ts:38-50 | DOCUMENTS 对象数组（含中文 titleCn） | 无对象数组字面量 | 平行常量表，中文原文保留于 .sla 注释
legalPolicyStore.ts:61 | Omit<LegalPolicyBundle, "minReadSeconds"|"reviewStartedAt"|"serverNow"> CurrentPolicy | 无 Omit | 去三字段 struct
legalPolicyStore.ts:63 | 模块级可变单例 policyCache | 无模块级可变状态约定 | PolicyCacheState struct 由宿主持有并传递
legalPolicyStore.ts:67-69 | Pick<LocalDatabase, "connection"> + 默认参数 | 无 Pick | db 句柄参数
legalPolicyStore.ts:71-155 | SQL 模板字面量 prepare/exec + as AcceptanceRow|undefined 断言 + ?. 可选链 | 无模板字面量/断言/可选链 | 固定 SQL 常量（SQL 文本注于 .sla）+ has 标志
legalPolicyStore.ts:127-155 | accept 三处 throw Error（含 `Please continue reading for ${...} seconds.` 模板） | 无异常/模板字面量 | 状态码 -1/-2/-3 + 格式化 err
legalPolicyStore.ts:166-221 | Map<string, {content, modifiedAt}> sources + Set 去重（文档文件/versionedFiles） | 无 Map/Set | 定长表（容量 10）+ visited 标志
legalPolicyStore.ts:181-190 | createHash("sha256") 流式 update 链（file/\0/content）+ digest("hex").slice(0, 20) | 增量哈希 extern 近似 | sa_std sha256 增量 extern 按原序 update
legalPolicyStore.ts:193 | Math.max(...Array.from(sources.values(), (s) => s.modifiedAt)) 展开调用 | 无展开/高阶函数 | max 循环
legalPolicyStore.ts:196-208 | 闭包 createPolicy(language) + DOCUMENTS.map(...) + satisfies LegalPolicyDocument | 无闭包/高阶/satisfies | 双语循环填充；satisfies 丢弃

## runtime/server.ts
runtime/server.ts:1-5 | node:http + node:stream + ws WebSocketServer + Fetch Request/Response/Headers + Bun.serve | sa_std 无 WebSocket upgrade/流 pipeline 面（仅 HTTP 核心 sa_http_server_* 部分对应） | 不透明句柄 + extern 桩，回调 id 表分发
runtime/server.ts:6-34 | 泛型 <T> 贯穿 RuntimeSocket/RuntimeServer/RuntimeServerOptions | 无泛型 | 类型擦除为句柄 + JSON 缓冲
runtime/server.ts:36-38 | async startRuntimeServer + isBunRuntime 三元分发 | 无 async | 同步工厂 + 状态码
runtime/server.ts:40-63 | (globalThis as {Bun}) 断言 + bun.serve<T> 选项对象 + 箭头包装函数 + as unknown as RuntimeSocket<T> 双重断言 | 无断言/对象字面量 | extern serve 调用 + 回调 id 表；断言丢弃
runtime/server.ts:65-66 | WeakMap<Request, string> requestAddresses + WeakMap<Request, pendingUpgrade> | 无 WeakMap（弱引用 GC 语义丢失） | 定长表按 request id（容量 1024）
runtime/server.ts:76-104 | 对象字面量方法集 + get port() getter（RuntimeServer 双分支实现） | 无对象方法/getter | struct + runtimeServer_* fn 族 + 访问器
runtime/server.ts:85-100 | webSockets.handleUpgrade 回调 + nativeSocket.on("message"/"close") + Buffer.concat(raw) 数组帧 + void Promise 消息处理 | 无事件/Buffer | 宿主 ws extern 接线 + 帧拼接 extern，结果忽略同源码
runtime/server.ts:107-121 | processRequest 闭包捕获 requestAddresses/pendingUpgrades/runtime/port + Promise.resolve(fetch).catch(→500 Response) | 无闭包/Promise | &RuntimeServer 命名 fn + 错误分支构造 500
runtime/server.ts:123-146 | server.on("upgrade") 事件 + await new Promise listen executor + server.address() 取实际端口 | 无事件/Promise | 阻塞 listen extern 返回绑定端口
runtime/server.ts:149-164 | nodeRequest: Object.entries(incoming.headers) + value.forEach 闭包 + Readable.toWeb(incoming) 流桥接 + RequestInit & {duplex} 断言 | 无 Web/Node 流桥接 | 头枚举 extern + body 保留原生流句柄
runtime/server.ts:166-201 | writeNodeResponse: response.headers.forEach + pipeline(source, target) + response.body.cancel().catch + try/catch 后 502 恢复写 | 无 stream pipeline | 阻塞写 extern + 状态分支复刻恢复逻辑（源码注释语义保留）
runtime/server.ts:203-208 | error: unknown + instanceof Error 收窄（finishFailedNodeRequest） | 无 unknown | (is_error, msg) 约定

## 分组 J — 54 个小文件（日志条目 120 条）

# server-rest 分组 J 缺陷日志（54 文件，源总行数 4317）

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`

- apps/server/src/codexConfigHealth.ts:22-23 | RegExp 字面量 (TABLE_HEADER_PATTERN / KEY_VALUE_PATTERN) | SLA 无正则引擎 | 手工字节扫描近似，fix 阶段实现
- apps/server/src/codexConfigHealth.ts:77-133 | Map<string, SectionBlock> / Set<number> 行号集合 | SLA 无 Map/Set | JSON registry handle + 结果结构体引用语义近似
- apps/server/src/codexConfigHealth.ts:176-178 | Date.toISOString 时间戳格式化 | sa_std 无 Date/ISO 表面 | 注释保留语义，fix 阶段补 extern
- apps/server/src/webdevServers.ts:60-95 | ChildProcess 事件流 (stdout/stderr "data", "exit", "error") | SLA 无 EventEmitter/流 | spawn-bidi handle + 宿主泵回调近似
- apps/server/src/webdevServers.ts:26 | Map<string, StoredSession> 模块级会话表 | SLA 无 Map | registry handle 近似
- apps/server/src/webdevServers.ts:66-95 | 闭包捕获可变 session 对象 | SLA 无闭包 | session 结构体指针传递近似
- apps/server/src/webdevServers.ts:176-179 | 对象 rest 解构剥离 process 字段 + randomUUID | SLA 无 rest/spread、无 randomUUID | 显式字段投影近似
- apps/server/src/agentReadiness.ts:25-52 | Record<string, unknown> 动态配置/目录树 | SLA 无动态对象 | JSON handle (u64) 近似
- apps/server/src/agentReadiness.ts:68-69 | 闭包 add/addWarning 捕获可变数组 | SLA 无闭包捕获 | 显式 append 调用近似
- apps/server/src/agentReadiness.ts:23,56-62 | 索引访问类型 typeof CODES[number] + async readFile/JSON.parse | SLA 无索引类型、无 async fs | u8 标签 + 同步状态码近似
- apps/server/src/forwardModel.ts:50-57 | class ForwardModelError extends Error (readonly code 联合) | SLA 无类继承 | struct + out_error/out_threw 约定近似
- apps/server/src/forwardModel.ts:144-171 | Set 去重 (new Set(ids)) 与 Map<string, Set<string>> 分组 | SLA 无 Set/Map | 线性去重/registry handle 近似
- apps/server/src/forwardModel.ts:79-130 | sort 比较器闭包 (longest-match 降序) + throw 类型化错误 | SLA 无比较器闭包 | 显式排序键 + 错误结构体近似
- apps/server/src/projectDiscussion.ts:11-20 | class ProjectDiscussionError extends Error | SLA 无类继承 | struct + 构造 fn 近似
- apps/server/src/projectDiscussion.ts:22-26 | 泛型 Pick<AgentProjectMember, ...> | SLA 无泛型 | 展开为具体 struct 字段近似
- apps/server/src/projectDiscussion.ts:47-86 | RegExp (含 CJK 字面量备选) 多处 .test | SLA 无正则引擎 | 字面子串扫描近似
- apps/server/src/projectDiscussion.ts:121-156 | localeCompare 排序 | SLA 无 locale 比较 | 字节序排序近似并注释
- apps/server/src/codexCliUpdate.ts:17-32 | async + Promise.all 并发 execFile | SLA 无 Promise/async | 顺序调用 + 状态码近似
- apps/server/src/codexCliUpdate.ts:51-90 | fetch + AbortController + setTimeout 超时 | sa_std 无 fetch/AbortController 等价面 | HTTP extern + 注释近似
- apps/server/src/codexCliUpdate.ts:28,37-41,163-164 | RegExp (版本解析、updateSupported 检测、密钥脱敏) | SLA 无正则引擎 | 手工扫描近似
- apps/server/src/codexCliUpdate.ts:158-162 | 正则分词 ssh 命令 (引号感知 match) | SLA 无正则分词 | 状态机分词近似并注释
- apps/server/src/pluginHost.ts:24-40 | ServerPluginRegistry 插件对象注册 (模块加载副作用) | SLA 无插件对象模型/导入副作用 | handle 注册表 + 显式 init fn 近似
- apps/server/src/pluginHost.ts:77 | Set<string> LOCKED_PLUGIN_IDS | SLA 无 Set | 字面量比较近似
- apps/server/src/pluginHost.ts:98-106 | 对象 spread 合并 cliSettings | SLA 无 spread | 显式字段拷贝近似
- apps/server/src/auditLogStore.ts:21,48,62 | async 方法 (record/list/migrate) | SLA 无 async | 同步 fn + 状态码近似
- apps/server/src/auditLogStore.ts:8-82 | RuntimeDatabase SQLite prepare/exec 表面 | sa_std 无 SQLite 表面 | db handle + SQL 文本注释保留近似
- apps/server/src/auditLogStore.ts:16 | void this.migrateLegacyEvents() 即发即忘 | SLA 无 async 任务 | 宿主显式调用迁移近似
- apps/server/src/auditLogStore.ts:132-140 | 类型谓词 value is DangerousPermissionAuditEvent | SLA 无类型谓词 | bool 校验 fn 近似
- apps/server/src/codexStreamRetryMonitor.ts:22-44 | RegExp 模式表 (STREAM_RETRY / GRACEFUL_TIMEOUT / BENIGN) | SLA 无正则引擎 | 前缀+字段扫描近似
- apps/server/src/codexStreamRetryMonitor.ts:72-150 | Map<string, TurnRetryState> 回合状态表 | SLA 无 Map | registry handle 近似
- apps/server/src/taskLiveness.ts:40-44 | Promise + setTimeout 实现 delay | SLA 无 Promise/定时器 | 宿主 sleep 近似
- apps/server/src/taskLiveness.ts:52-148 | async /proc 与 PowerShell 进程枚举 (fs/promises + execFile) | SLA 无 async fs/exec | 同步近似 + 状态码
- apps/server/src/taskLiveness.ts:52-148 | Set<number> / Map<number, number> 进程树 | SLA 无 Set/Map | 定长数组+len 近似 (fix 阶段)
- apps/server/src/codexApiRuntime.ts:82-100 | async wait + Promise + setTimeout waiter 机制 | SLA 无 Promise/定时器 | 立即返回或登记 waiter 返回 pending 状态近似
- apps/server/src/codexApiRuntime.ts:14-19,40-80 | 闭包 predicate + Map<number, EventWaiter> 迭代中删除 | SLA 无闭包/Map | fn id 派发 + registry handle 近似
- apps/server/src/codexApiRuntime.ts:104-146 | Map<string, CodexApiSession> 会话表 | SLA 无 Map | registry handle 近似
- apps/server/src/codexApiRuntime.ts:109-112 | randomUUID 默认 id 工厂 (可注入闭包) | sa_std 无 randomUUID、无闭包工厂 | fn id 派发近似
- apps/server/src/performanceReport.ts:1-131 | Record<string, unknown> 全树动态对象清洗 | SLA 无动态对象 | JSON handle + 字段投影注释近似
- apps/server/src/performanceReport.ts:125-131 | Object.fromEntries 构造记录 | SLA 无该 API | JSON buffer 构建近似
- apps/server/src/performanceReport.ts:1,50-55 | Set<string> GOAL_STATUSES + 条件 spread 字段 | SLA 无 Set/spread | 字面量比较 + 显式可选字段近似
- apps/server/src/codexModelCatalog.ts:20-70 | Record<string, JsonValue> 动态目录对象构造 (含条件 spread) | SLA 无动态对象/spread | JSON handle 构建近似
- apps/server/src/codexModelCatalog.ts:104-107 | console.warn 读旧目录失败告警 | SLA 无 console.* | 注释保留，fix 阶段接 print
- apps/server/src/codexModelCatalog.ts:123-125 | Set 去重 uniqueModels | SLA 无 Set | 线性去重近似
- apps/server/src/codeWorkspace.ts:8-11 | 索引签名类型 [key: string]: unknown + 可选 folders | SLA 无索引签名 | JSON handle 近似
- apps/server/src/codeWorkspace.ts:65-76 | Set 去重 uniquePaths + process.platform 分支键 | SLA 无 Set/进程 env | 线性去重 + 平台参数近似
- apps/server/src/codeWorkspace.ts:84-122 | normalizeJsonc 字符扫描含 /\s/ 正则类测试 | SLA 无正则字符类 | 显式空白字节集合近似并注释
- apps/server/src/sshSystemMetrics.ts:15-29 | async + pending Promise 去重共享请求 | SLA 无 Promise | 同步采样近似 (无在途共享)
- apps/server/src/sshSystemMetrics.ts:10-13 | Map 缓存三件套 (cpuSnapshots/cache/pending) | SLA 无 Map | registry handle 近似
- apps/server/src/sshSystemMetrics.ts:44-50 | Record<string, string> 指标解析结果 | SLA 无动态 Record | JSON handle 近似
- apps/server/src/threadWriterLeaseStore.ts:17,31 | setInterval 续租定时器 + timer.unref | SLA 无定时器 | 宿主驱动 renewAll 调用近似
- apps/server/src/threadWriterLeaseStore.ts:14 | Set<string> ownedThreadIds | SLA 无 Set | registry handle 近似
- apps/server/src/threadWriterLeaseStore.ts:19-29,108-116 | SQLite 建表 + process.kill(pid, 0) 存活探测 | sa_std 无 SQLite 表面/信号 0 探测 | db handle + 注释近似
- apps/server/src/saVmRequest.ts:1-112 | Record<string, unknown> 请求体动态对象 (含 Buffer.byteLength) | SLA 无动态对象 | JSON handle + sa_json 查询近似
- apps/server/src/webdevProbe.ts:22-40 | URL 构造器与 URL 对象语义 (protocol/hostname/credentials) | sa_std 无 URL 解析器 | 手工 URL 扫描近似
- apps/server/src/webdevProbe.ts:42-85 | fetch + AbortController + setTimeout/clearTimeout | sa_std 无 fetch/Abort 表面 | HTTP extern + 超时参数近似
- apps/server/src/webdevProbe.ts:24,88-92 | RegExp (scheme 检测、<title> 提取) | SLA 无正则引擎 | 字面扫描近似
- apps/server/src/threadStartCompatibility.ts:3 | 函数类型 ThreadStartRequest 返回 Promise<JsonValue> (async 回调) | SLA 无 async 函数类型 | fn id + 状态码约定近似
- apps/server/src/threadStartCompatibility.ts:47,90 | 对象 rest 解构剥离 historyMode / spread 合并 resumeParams | SLA 无 rest/spread | JSON 对象键删除/合并近似并注释
- apps/server/src/threadStartCompatibility.ts:5-20 | errorText 对 unknown 的递归动态遍历 | SLA 无 unknown 动态遍历 | JSON handle 递归近似
- apps/server/src/codexModeApi.ts:5-98 | Record<string, JsonValue> 嵌套参数对象构造 | SLA 无动态对象 | JSON buffer 构建近似
- apps/server/src/codexModeApi.ts:56-70 | Object.entries 迭代动态对象 (planAnswers) | SLA 无该 API | JSON 对象迭代 extern 近似
- apps/server/src/cursorDesktopInjection.ts:15-24 | class CursorInstallDirNotFoundError extends Error (readonly 字段) | SLA 无类继承 | struct + 构造 fn 近似
- apps/server/src/cursorDesktopInjection.ts:66-94 | async fs/promises (mkdir/writeFile/rename) 原子写启动器 | SLA 无 async fs | 同步 fs extern + 状态码近似
- apps/server/src/cursorDesktopInjection.ts:1,52 | randomUUID 临时文件名 + process.env.LOCALAPPDATA 读取 | sa_std 无 randomUUID/env 表面 | 注释近似，fix 阶段补 extern
- apps/server/src/legacyImageViewHistory.ts:14-50 | async + Map 缓存 historyCache | SLA 无 async/Map | 同步 fn + registry handle 近似
- apps/server/src/legacyImageViewHistory.ts:52-77 | createReadStream + readline for-await 流式逐行读 | sa_std 无流/readline | 整文件读入逐行扫描近似
- apps/server/src/legacyImageViewHistory.ts:14-92 | JsonValue/Record 动态 JSON 树改写 (spread 重组 turns) | SLA 无动态对象/spread | JSON handle 改写近似
- apps/server/src/sshHostDiscovery.ts:12-47 | async + promisify(execFile) | SLA 无 promisify/async | 同步 exec extern + 状态码近似
- apps/server/src/sshHostDiscovery.ts:59-83 | 递归闭包 visit 捕获 visited Set / aliases Map | SLA 无闭包捕获/Set/Map | 显式状态结构体 + registry 近似
- apps/server/src/sshHostDiscovery.ts:85-90,92 | RegExp (glob 转正则、matchAll 引号分词、通配检测) | SLA 无正则引擎 | 手工模式扫描近似
- apps/server/src/sshHostDiscovery.ts:19 | localeCompare 别名排序 (sensitivity base) | SLA 无 locale 比较 | 字节序排序近似并注释
- apps/server/src/globalCodexEnvironment.ts:29-38 | 可注入回调 spawnSyncFn 与 env/platform 默认参数 (process.*) | SLA 无回调注入/进程 env | fn id + 显式参数近似
- apps/server/src/globalCodexEnvironment.ts:1-90 | node:fs sync + spawnSync (setx/reg) + JSON 状态文件 | 部分无 sa_std 对应 | fs/process extern 近似 + JSON handle
- apps/server/src/saVmApplyPatch.ts:17-86 | 正则行尾归一 patch.replace(/\r\n?/g) 与大规模字符串/数组操作 | SLA 无正则、无动态字符串数组 | 定长缓冲 + 行扫描近似
- apps/server/src/saVmApplyPatch.ts:55-70 | 闭包 finishEdit 捕获可变 oldLines/newLines 数组 | SLA 无闭包捕获 | 显式状态参数近似
- apps/server/src/remoteThreadRouteStore.ts:10-85 | RuntimeDatabase SQLite 表面 (exec/prepare/run) | sa_std 无 SQLite 表面 | db handle + SQL 文本注释保留近似
- apps/server/src/remoteThreadRouteStore.ts:35 | 泛型 Omit<RemoteThreadRoute, ...> & 部分字段可选 输入类型 | SLA 无泛型 | JSON handle 输入近似
- apps/server/src/relayRuntimeSelection.ts:21-78 | Web Headers API (headers.get) | sa_std 无 Headers 表面 | JSON handle 头表近似
- apps/server/src/relayRuntimeSelection.ts:10-78 | 回调参数 threadOwnerId / runtimeSelectionForThread / resolveNativeThreadId | SLA 无一等函数参数 | fn id 派发近似
- apps/server/src/relayRuntimeSelection.ts:44-78 | JSON.parse 元数据头 + 对象 spread 回退 + /^ses_/ 正则 | SLA 无 spread/正则 | JSON handle + 字面前缀检查近似
- apps/server/src/cliSelectionState.ts:21-27 | Partial<Record<CliSelectionKind, ...>> 以联合为键的动态记录 | SLA 无 Record/Partial | kind 标签索引的定长数组近似
- apps/server/src/cliSelectionState.ts:27,61-71 | Promise<void> 在途刷新句柄存储 | SLA 无 Promise | u64 句柄占位近似
- apps/server/src/relayDirectory.ts:3-24 | @codex-ui/shared 动态配置类型 + 索引访问类型 ChannelGroupConfig["responseProtocolMode"] | SLA 无索引类型/动态对象 | JSON handle 近似
- apps/server/src/relayDirectory.ts:66-69 | Set 去重 uniqueStrings | SLA 无 Set | 线性去重近似
- apps/server/src/pluginHostServices.ts:25-66 | 嵌套选项对象字面量 (各域闭包箭头函数集合) 实现 PluginHostServices | SLA 无一等闭包/对象字面量服务表 | fn id 注册表 struct 近似
- apps/server/src/pluginHostServices.ts:68 | 模块加载即执行的 setPluginHostServices 注册副作用 | SLA 无导入副作用 | 显式 register fn 由宿主 boot 调用近似
- apps/server/src/sshWorkspaceStore.ts:18-63 | RuntimeDatabase SQLite 表面 | sa_std 无 SQLite 表面 | db handle + SQL 文本注释保留近似
- apps/server/src/workspaceRoots.ts:24-56 | node:path posix/win32 双 API 与 resolve/parse 语义 | sa_std 无 path API | 注释近似，fix 阶段补路径 extern
- apps/server/src/workspaceRoots.ts:44-50 | Set<string> 盘符候选 + /^[A-Za-z]:\\$/ 正则 | SLA 无 Set/正则 | 定长数组 + 手工盘符检查近似
- apps/server/src/workspaceRoots.ts:29-35 | 回调参数 driveExists?: (path) => boolean | SLA 无一等函数参数 | fn id 派发近似
- apps/server/src/userPreferencesStore.ts:12-46 | RuntimeDatabase SQLite 表面 | sa_std 无 SQLite 表面 | db handle + SQL 文本注释保留近似
- apps/server/src/userPreferencesStore.ts:29-32 | 对象 spread 合并偏好 { ...get, ...patch } + Buffer.byteLength | SLA 无 spread | JSON 对象合并 extern 近似
- apps/server/src/pluginInstallStore.ts:25-52 | Set<string> 已安装集合 (过滤类型谓词 + sort 序列化) | SLA 无 Set/类型谓词 | JSON 数组缓冲近似
- apps/server/src/pluginInstallStore.ts:18-23 | process.env / homedir / node:path 数据目录解析 | sa_std 无 env/path 表面 | 注释近似，fix 阶段补 extern
- apps/server/src/sharedThreadBridgeRegistry.ts:10 | 泛型类 SharedThreadBridgeRegistry<Bridge extends StoppableBridge> | SLA 无泛型 | u64 桥句柄特化近似
- apps/server/src/sharedThreadBridgeRegistry.ts:11,27-33 | Map<string, Bridge> + IterableIterator values/entries | SLA 无 Map/迭代器 | registry handle 近似
- apps/server/src/sharedThreadBridgeRegistry.ts:13 | 构造器回调 onLastRelease?: (bridge) => void | SLA 无一等回调 | fn id 派发近似
- apps/server/src/rpcErrorContext.ts:5-25 | unknown 错误值的动态遍历 (instanceof Error / Record 字段探测 / JSON.stringify) | SLA 无 unknown 动态遍历 | JSON handle 近似
- apps/server/src/rpcErrorContext.ts:33,46 | RegExp (auth 关键词检测、CUX-RPC 前缀匹配) | SLA 无正则引擎 | 字面子串扫描近似
- apps/server/src/rpcErrorContext.ts:36-40 | 模板字符串拼装 message + Record data 构造 | SLA 无模板字符串/动态对象 | 缓冲拼接 + JSON 构建近似
- apps/server/src/remoteThreadLifecycle.ts:19-47 | async + restore 回调返回 Promise<Connection | null> | SLA 无 async/一等回调 | 同步 fn id 调用 + 状态码近似
- apps/server/src/remoteThreadLifecycle.ts:21 | Map<string, RemoteThreadConnection> 桥表参数 | SLA 无 Map | registry handle 近似
- apps/server/src/remoteThreadLifecycle.ts:20 | 泛型 Pick<RemoteThreadRouteStore, "get" | "setLifecycleMode"> | SLA 无泛型 | store handle 方法派发近似
- apps/server/src/runtime/process.ts:5-46 | Promise<number> exited + kill 闭包 + ReadableStream 字段 | SLA 无 Promise/闭包/流 | 完成句柄 + fn id + 流句柄近似
- apps/server/src/runtime/process.ts:13-46 | Bun.spawn 与 node spawn 双运行时分支 + Readable.toWeb 转换 | sa_std 无对应运行时 API | spawn-bidi extern 近似并注释
- apps/server/src/runtime/process.ts:7-9 | Record<string, string | undefined> env 选项 | SLA 无动态 Record | JSON handle 近似
- apps/server/src/workspaceAgents.ts:14-36 | 全局 RegExp replace 清洗历史污染行 (contaminatedPattern 等) | SLA 无正则引擎 | 字面前缀扫描近似并注释
- apps/server/src/workspaceAgents.ts:38-46 | async fs/promises readFile/writeFile + ErrnoException code 判读 | SLA 无 async fs | 同步 fs extern + 状态码近似
- apps/server/src/saVmFindWorker.ts:9-36 | Bun.Worker self.onmessage/postMessage 消息协议 | SLA 无 Worker 模型 | 同步入口 fn 处理 JSON 消息近似
- apps/server/src/saVmFindWorker.ts:20-31 | async handler + await Bun.file(f).text() | SLA 无 async/Bun.file | 同步文件读 extern 近似
- apps/server/src/saVmFindWorker.ts:12-13 | 动态消息对象 { files?, symbol? } unknown 判读 | SLA 无动态对象 | JSON handle 近似
- apps/server/src/saVmResultKind.ts:1-12 | Array<Record<string, unknown>> 事件数组与 Record 违规对象字段 | SLA 无动态对象数组 | JSON handle 字段近似
- apps/server/src/codexRuntimeEnv.ts:5-21 | NodeJS.ProcessEnv 动态记录读写与可选链 env.X?.trim() | SLA 无动态对象/可选链 | JSON handle + 显式 has 标志近似
- apps/server/src/codexRuntimeEnv.ts:1-3 | node:fs mkdirSync / node:os homedir / node:path join+resolve | sa_std 无对应表面 | 注释近似，fix 阶段补 extern
- apps/server/src/staticAssetContentType.ts:3-27 | Readonly<Record<string, string>> 静态映射 + extname().toLowerCase() 查表 | SLA 无 Record/路径 API | 线性表扫描 + ASCII 小写化近似
- apps/server/src/runtime/password.ts:5-19 | async hashPassword/verifyPassword (Promise 返回) | SLA 无 async | 同步 fn + 输出缓冲 + 状态码近似
- apps/server/src/runtime/password.ts:1,5-19 | bcryptjs / Bun.password bcrypt 库 | sa_std 无 bcrypt | 注释保留算法与轮数 (10)，fix 阶段补 extern
- apps/server/src/dynamicToolProtocol.ts:1-16 | Record<string, unknown> 动态对象返回与 unknown 判读 | SLA 无动态对象 | JSON handle 近似
- apps/server/src/dynamicToolProtocol.ts:3-8 | JSON.parse + try/catch 回退空对象 | SLA 无异常机制 | sa_json 解析状态码近似
- apps/server/src/saVmProcess.ts:3-16 | node:child_process spawnSync (taskkill) + process.kill 进程树终止 + try/catch 嵌套 | sa_std 无对应表面 | 平台门控 extern 调用近似

无缺陷文件（7 个 barrel/re-export + 1 个纯逻辑小文件）：codexFallbackInstructions.ts、goalContinuation.ts、imagePersistence.ts、runtime/database.ts、saVmWorkspaceSkill.ts、systemWebSearch.ts、threadHistoryPaging.ts 均为单行 SDK 转发，已以等价 @import 转发文件 1:1 复刻；threadRpcRouting.ts 为纯字符串/布尔逻辑，联合类型以 u8 标签等价表达，未记缺陷。
