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
