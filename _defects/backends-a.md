# backends-a 缺陷日志（claude / codex / opencode / opencode-v2）

单元汇总：32 个 .ts → 32 个 .sla，源 13,142 行，缺陷 288 条（p1 claude-runtime 128 + p2 claude/codex 顶层 37 + p3 opencode 大文件 43 + p4 opencode 其余+v2 80）。行内 // DEFECT: 共 669 处（164+217+82+206）。

## 分部 p1：backends/claude/src/runtime（11 文件）

# backends-a-p1 缺陷日志（backends/claude/src/runtime）

## claudeCompatibleProtocol.ts
claudeCompatibleProtocol.ts:14-24 | interface + string[] 字段 (tools) | SLA 无 interface/动态数组 | struct + 定长字节缓冲（tools 以换行拼接缓冲近似）+ count 字段
claudeCompatibleProtocol.ts:26-39 | 可选字段 uuid? / error?、嵌套 message 对象 | 无 Option 类型 | has_* 布尔标志 + 展平字段；content 以原始 JSON 文本缓冲保存
claudeCompatibleProtocol.ts:41-51 | message.content: unknown | 动态 JSON 无对应类型 | content_json 原始 JSON 文本缓冲
claudeCompatibleProtocol.ts:64-77 | event.content_block.input / delta 宽松嵌套对象 | 动态对象 | 展平为字节缓冲字段，input 以 JSON 文本保存
claudeCompatibleProtocol.ts:86-103 | request.input: Record<string, unknown>；subtype 字面量联合 | 动态对象/字面量联合类型 | input_json 文本缓冲；subtype 以字节缓冲保存
claudeCompatibleProtocol.ts:120-134 | 判别联合类型 ClaudeMessage / ClaudeContentBlock（含索引签名 catch-all） | SLA 无 sum type / 索引签名 | kind 标签常量 + 全量原始 JSON 缓冲的单一 struct；内容块合并为带 type 标签的单 struct
claudeCompatibleProtocol.ts:141-149 | parseClaudeMessage 返回 ClaudeMessage | null、JSON.parse 类型断言 | 无可空 struct 返回、无反射式 JSON 映射 | 返回状态码（0 ok/1 空行/2 解析失败）+ out 参数；用 sa_json_* 探针读 type/session_id
claudeCompatibleProtocol.ts:155-159 | extractSessionId 返回 string | undefined | 无 Option | 返回长度（0 表示 undefined）+ 拷贝到 out 缓冲
claudeCompatibleProtocol.ts:166-189 | buildControlResponse / buildInterruptRequest 返回 JsonValue 对象字面量 | 动态对象构造 | 用 ByteBuf 拼接 JSON 文本，返回长度

## claudeSessionStore.ts
claudeSessionStore.ts:30-46 | class ClaudeSessionStore 持有 RuntimeDatabase（sdk-backend） | SLA 无 class/无 SQLite 绑定声明（sa_std 无 sqlite .sai） | struct + &Struct 首参函数族；db 句柄以 u64 不透明句柄近似，SQL 以字符串字面量保留在注释/常量中，实际执行记为 DEFECT
claudeSessionStore.ts:47-69 | 构造器内 CREATE TABLE / ALTER TABLE + try/catch 吞异常 | 无异常机制 | 状态码返回；ALTER 失败忽略以注释保留语义
claudeSessionStore.ts:71-113 | upsert 对象参数 + ?? / ?. 空值合并链 | 无对象参数/可选链 | 展平为 (ptr,len,has_*) 参数组；COALESCE 语义在 SQL 文本中保留
claudeSessionStore.ts:115-171 | prepare().get/all/run 的类型断言 (as Row) 与 .changes | 无 ORM/行映射 | 行以 ClaudeSessionRow struct 近似；changes 以 i64 返回值近似
claudeSessionStore.ts:43 | Date.now() | 无墙钟毫秒 API 假定 | now_ms() 占位 extern 风格调用，记 DEFECT

## claudeCompactionRunner.ts
claudeCompactionRunner.ts:1-2 | import type node:child_process 类型、JsonValue | Node 类型无对应 | SpawnCommand 函数签名以进程句柄 struct 近似
claudeCompactionRunner.ts:13 | ClaudeCompactionRunner = (input) => Promise<string> 函数类型 | 无一等函数/Promise | createClaudeCompactionRunner 返回状态码，运行结果写入 out 缓冲
claudeCompactionRunner.ts:15 | 默认参数 = spawnClaudeCommand / 默认箭头函数 (child) => child.kill("SIGTERM") | 无默认参数/闭包 | 调用方显式传函数指针式句柄；terminate 以 kill 信号常量近似
claudeCompactionRunner.ts:18-24 | 正则 .replace(/.../g) 三连脱敏 | SLA/sa_std 无正则引擎 | redactCompactionText 以手写扫描近似（sk-/Bearer/api_key 前缀匹配），模式语义不完全等价，记 DEFECT
claudeCompactionRunner.ts:26-33 | compactionErrnoDetails(error: unknown) + 动态 Record 拾取 | 动态对象/unknown | 展平为固定字段 struct（code/errno/syscall/path 各带 has_* 标志）
claudeCompactionRunner.ts:35-41 | console[level] 动态分发 + JSON.stringify + try/catch | 无动态方法分发/异常 | level 以枚举入参分支调用 print 类 extern；stringify 以 JSON 缓冲拼接近似
claudeCompactionRunner.ts:48-186 | async 箭头函数 + await new Promise + setTimeout + child.stdout.on("data") 事件流 + stdin.write | 无 async/Promise/定时器/事件回调 | 同步阻塞读循环近似：轮询 stdout 行缓冲、累计 assistantParts、超时以轮询计数近似，签名处注 DEFECT: async
claudeCompactionRunner.ts:56 | encodeURIComponent | 无 URI 编码 extern 假定 | uri_encode 占位近似，记 DEFECT
claudeCompactionRunner.ts:52-59 | 展开运算符合并 env 对象 {...(cond ? {} : {})} | 无对象展开 | 条件追加键值对到 env 构建缓冲近似
claudeCompactionRunner.ts:117-135 | JSON.parse(line) as Record + 嵌套可选链 message.message?.content | 动态 JSON | sa_json_* 探针近似，失败静默跳过（与源 catch { return; } 对应）

## claudeCompatibleProbe.ts
claudeCompatibleProbe.ts:1-5 | Node 内置模块导入 (child_process/fs/path) + @cxu/sdk-backend pluginHostServices/deriveOpenCodeSessionId | sa_std 无对应 .sai、无宿主服务定位面 | sa_std_fs_*/sa_std_process_* 与 host_* extern 占位；ProcessEnv 以 "KEY=VALUE\n" 文本缓冲近似
claudeCompatibleProbe.ts:8-13 | interface ClaudeCliProbeResult 可选字段 | 无 Option | has_* 标志 + 定长缓冲字段
claudeCompatibleProbe.ts:22-28 | 正则脱敏三连（同 compaction runner） | 无正则引擎 | 手写扫描近似，gi 标志与完整字符类未完全复现
claudeCompatibleProbe.ts:30-42 | errnoDetails(error: unknown) 动态拾取 | 动态对象 | ErrnoDetails 展平 struct + JSON 探针
claudeCompatibleProbe.ts:44-57 | console[level] 动态分发 + JSON.stringify + try/catch | 无动态分发/异常 | level 分支 + 预构建 JSON 缓冲，输出错误忽略
claudeCompatibleProbe.ts:65-94 | findClaudeBin 默认参数 = process.env、pluginHostServices().cli.* 宿主服务、非空断言 enumerated[0]! | 无进程全局/宿主服务 | 显式 env 缓冲入参；host_cli_* extern 占位；返回 bool+out（为与 compaction 的 if(!bin) 对齐）
claudeCompatibleProbe.ts:96-131 | wellKnownClaudeCandidates 中 join(home, ".claude", "bin", "claude.exe") 多段路径拼接、process.platform 分支 | node:path join 语义（分隔符/规范化）无对应 | path_join_push 以 "/" 拼接近似，多段 join 折叠为字面相对路径
claudeCompatibleProbe.ts:133-142 | compareClaudeVersions: split(".").map(parseInt) + Math.max 循环 | 动态数组 | 手写分段解析 version_segment/count_char 近似
claudeCompatibleProbe.ts:154-166 | buildClaudeRelayCustomHeaders 模板字符串数组 join("\n")、threadId?: string | undefined 返回 | 可选参数/undefined | has_threadId + bool 返回；deriveOpenCodeSessionId 以 extern 占位，OPENCODE_CLI_BACKEND_HEADER 常量值以字面 "x-cli-backend" 近似（原值待核）
claudeCompatibleProbe.ts:168-175 | interface ClaudeLaunchSpec { env: Record<string,string> } | 动态对象 | env 文本缓冲字段
claudeCompatibleProbe.ts:178-227 | Set 常量 JS_RUNTIME_BASENAMES / HOST_SHELL_BASENAMES、basename().toLowerCase().replace(/\.exe$/,"").replace(/[^a-z0-9]/g,"") | 无 Set/正则 | 成员函数比较链 + 手写归一化扫描
claudeCompatibleProbe.ts:229-246 | pathEnvCandidates: split(delimiter)、dir.trim().replace(/^"|"$/g,"") | 平台 delimiter/正则 | host_platform 分支选分隔符；引号剥离手写近似（函数内有一处冗余循环，批量转换痕迹）
claudeCompatibleProbe.ts:248-295 | wellKnownJavaScriptRuntimeCandidates: readdirSync(NVM_HOME, {withFileTypes}) + Dirent.isDirectory() + try/catch | 无 Dirent API | sa_std_fs_list_dir + is_dir 探针占位 extern
claudeCompatibleProbe.ts:308-345 | resolveJavaScriptRuntime 默认参数 process.env/process.execPath、展开数组 [...wellKnown, ...pathEnv] | 无进程全局/数组展开 | 显式入参 + host_exec_path 占位；候选列表顺序拼接
claudeCompatibleProbe.ts:348-360 | resolveClaudeLaunch: extname().toLowerCase()、[command, ...args] | path 语义近似 | path_extname 手写近似 + StrList 重建
claudeCompatibleProbe.ts:362-490 | spawnClaudeCommand: options 对象展开 {...options, cwd/env}、win32 ComSpec 注入、child.once("error"/"exit") 事件、throw new Error 包装 | 无对象展开/EventEmitter/异常 | ClaudeSpawnOptions struct 字段拷贝；事件日志以 spawn 后即时轮询近似（已在代码 DEFECT 注明）；throw 改状态码+err 缓冲
claudeCompatibleProbe.ts:498-545 | probeClaudeCliCommand: execFileSync 同步子进程（timeout/encoding）、output.match(/(\d+\.\d+\.\d+)/) 正则版本解析 | 无同步 exec 捕获 extern/正则 | process_exec_capture 占位 extern + find_version_in 手写扫描
claudeCompatibleProbe.ts:564-600 | BLOCKED_ENV_KEYS as const 数组 + buildSafeClaudeEnv 对象展开/delete/Object.entries(overrides) | 无对象语义 | is_blocked_env_key 比较链 + env_delete 逐键调用 + overrides 按行追加
claudeCompatibleProbe.ts:607-703 | validateClaudeWorkspace/ensureClaudeSpawnCwd/prepareClaudeThreadCwd: resolve()、statSync、mkdirSync recursive、NodeJS.ErrnoException.code、/not a directory/i 正则、throw | path/errno/正则/异常均近似 | resolve 以恒等拷贝；errno 以 sa_std_fs_last_errno()==2(ENOENT) 近似；正则以子串搜索近似；throw 改状态码
claudeCompatibleProbe.ts:715-717 | 模块级可变状态 effortSupportCache = new Map + Date.now() TTL | SLA 无模块级可变状态 | EffortSupportCache struct 由调用方穿参（签名多一个 cache 参数）
claudeCompatibleProbe.ts:719-789 | claudeCliSupportsEffort/warmClaudeEffortSupport: execFileSync/execFile(异步回调)、/(^|\s)--effort(\s|=|$)/m 正则 | 无异步回调 | warm 改为同步执行同一探针（时序语义丢失，代码内 DEFECT）；正则以 output_has_effort_flag 令牌扫描近似
claudeCompatibleProbe.ts:801-818 | resolveClaudeEffortForCli 的缓存/预热分支 | 同上 | 同步近似保留分支结构
claudeCompatibleProbe.ts:823-833 | mapPermissionMode: sandbox.replace(/[-_]/g,"").toLowerCase() | 正则替换 | 手写逐字节过滤+小写化
claudeCompatibleProbe.ts:843-850 | CLAUDE_CLI_EFFORT_LEVELS = new Set(...) 导出常量 | 无 Set | is_claude_cli_effort_level 成员函数
claudeCompatibleProbe.ts:852-858 | sanitizeClaudeCliEffort: value?.trim().toLowerCase() 可选链 | 无可选链 | has_value 标志 + 手写 trim/lower
claudeCompatibleProbe.ts:863-892 | buildClaudeSpawnArgs 可选参数四连 + args.push 条件累积 | 无可选参数 | has_* 标志组 + StrList 累积（与 compaction 文件中的 3 参调用形态不一致，待修复阶段统一）
claudeCompatibleProbe.ts:901-952 | claudeProjectDirName 正则 [^a-zA-Z0-9] 替换、claudeTranscriptExists: readdirSync().some(回调)、三值返回 boolean|undefined | 正则/高阶函数/三值 | 逐字节扫描；some 以显式循环；三值以 i32 -1/0/1 编码
claudeCompatibleProbe.ts:全文件 | ByteBuf/StrList 等共享辅助类型在本文件内定义、ClaudeChildProcess 与 compaction 文件重复定义 | 镜像内尚无共享 helpers 模块 | 本文件自带 StrList/辅助函数；重复定义待修复阶段抽公共 helpers.sla

## claudeCompatibleProcessManager.ts
claudeCompatibleProcessManager.ts:1-5 | node:events EventEmitter / node:readline createInterface / child_process 导入 | 无事件发射器/readline | 事件以管理器内队列近似（mgr_emit + drainEvent），行分帧以显式 _pump 轮询实现
claudeCompatibleProcessManager.ts:57-66 | class ClaudeCompatibleProcessManager extends EventEmitter（类继承）+ private 字段 | 无继承/访问修饰 | struct + 函数族，字段全部平铺（含 stop 升级状态机字段）
claudeCompatibleProcessManager.ts:74-215 | start(): ensure/find/map/build/spawn 调用链 + child.once("exit"/"error") + stdout.on("line") + stderr.on("data") 回调注册 | 事件驱动 | 注册改为 _pump 内轮询实现 exit/error/line/message/stderr；throw 改状态码+err
claudeCompatibleProcessManager.ts:97-102 | mapPermissionMode(this.config.sandbox ?? "default", approvalPolicy ?? "on-request") 空值默认 | 无 ?? | has_* 分支四组合展开
claudeCompatibleProcessManager.ts:36-47 | managerErrnoDetails / logManagerEvent（与 probe 同构重复） | 动态对象 | 复用 probe 的 ErrnoDetails/errnoDetails；log 以预构建 JSON 缓冲近似
claudeCompatibleProcessManager.ts:178-199 | stderr 处理: chunk.toString("utf8").trim()、/error|enoent|uv_spawn|fail/i 正则筛选、MAX_STDERR_LINES 截断 | 正则/Buffer | buf_contains_ci 子串近似；计数与截断分支保留
claudeCompatibleProcessManager.ts:207-218 | writeStdin(message: JsonValue)、child.stdin.writable、JSON.stringify | 动态 JSON/流状态 | 入参改预序列化 JSON 文本；writable 以 sa_std_process_stdin_writable 占位 extern
claudeCompatibleProcessManager.ts:224-266 | stop(): setTimeout 两级升级（SIGTERM→1s→SIGKILL）+ timer.unref() + win32 taskkill spawn("taskkill", ["/pid", pid, "/T", "/F"]) + killer.on("error") 回退 | 无定时器 | 截止时间记录 + _checkStopTimers 在 pump 中实现；taskkill 以 spawn_bidi 近似、error 回退以返回码近似
claudeCompatibleProcessManager.ts:271-275 | get pid(): number | null、child?.pid ?? null | 无 getter/可空 | 函数 + has_pid 出参，-1 占位 null

## claudePermissionRegistry.ts
claudePermissionRegistry.ts:36-37 | 两个 Map<string, *>（pending / byClaudeRequestId） | 无哈希表 | 定长条目数组（容量 256）线性查找；byClaudeRequestId 以按 claudeRequestId 扫描代替；swap-remove 不保持 Map 插入顺序
claudePermissionRegistry.ts:24-31 | timer: ReturnType<typeof setTimeout> | null + setTimeout/clearTimeout/unref | 无定时器 | expires_at_ms 截止时间 + ClaudePermissionRegistry_checkTimeouts 由所有者 pump 实现
claudePermissionRegistry.ts:33-35 | 联合类型 PermissionResponse（判别联合） | 无 sum type | allowed + has_denyReason 单 struct
claudePermissionRegistry.ts:195-204 | onTimeout 公有回调字段 ((entry) => void) | null + handleTimeout 内 this.onTimeout?.(entry) | 无一等函数字段 | has_onTimeout + target id 占位；超时条目存入 last_timeout 供所有者消费
claudePermissionRegistry.ts:57 | Date.now() | 同 session store | sa_time_now_ms 占位
claudePermissionRegistry.ts:全文件 | register/get/consume 返回条目对象引用语义（get 返回活引用） | 值语义 struct | 出参拷贝，调用方拿到的是副本（后续突变不共享）

## claudeCompatibleRuntime.ts
claudeCompatibleRuntime.ts:1-2 | node:events EventEmitter、node:crypto randomUUID | 无对应 | 运行时内 out 事件队列（drainEvent）近似；host_random_uuid 占位 extern
claudeCompatibleRuntime.ts:53-70 | class extends EventEmitter + private 字段 + Map pendingPermissions + readonly runtimeId | 无继承/Map | struct 平铺；pendingPermissions 定长数组（容量 128）
claudeCompatibleRuntime.ts:72-77 | constructor 默认参数 permissionRegistry = null、config.env ?? process.env | 无默认参/进程全局 | has_* 标志 + 显式 process_env 入参
claudeCompatibleRuntime.ts:82-113 | start(): process.on("message"/"stderr"/"exit"/"error") 回调注册 | 事件驱动 | _pump 拉取管理器队列后按 kind 分发（退出时 forceTerminate + process=null 语义保留）
claudeCompatibleRuntime.ts:122-140 | startTurn: request.turnId ?? randomUUID()、this.process!.writeStdin({...} as JsonValue) 非空断言与对象字面量 | 无 ??/断言/对象字面量 | has_turnId 分支；消息以手拼 JSON + json_escape_into 近似；process.start 的 throw 以 error 事件近似（start 内 DEFECT 注明）
claudeCompatibleRuntime.ts:146-160 | interrupt(): "interrupt-" + nextControlId++ 后缀自增、permissionRegistry?.cancelAllForThread 可选链 | 无后缀自增/可选链 | 显式加一 + has_permissionRegistry 分支
claudeCompatibleRuntime.ts:165-182 | respondToPermission: Map get/delete 与 registry.consume 的双路回退逻辑 | Map 近似 | rt_pending_find/remove 数组实现，分支结构保留
claudeCompatibleRuntime.ts:199-203 | isTurnActive: this.ctx.turn.status === "running" 字符串状态 | 投影器内部状态 | ctx.turn_status 枚举常量 TURN_STATUS_RUNNING（在 projector 文件定义）
claudeCompatibleRuntime.ts:208-212 | getExternalSessionId: Array.from(Map.entries()).find(([_, v]) => v === threadId)?.[0] ?? null 解构+高阶+可选链 | 无对应 | projector_session_for_thread 助手扫描近似（projector 文件提供）
claudeCompatibleRuntime.ts:214-275 | handleMessage: (message as {...}) 一系列类型断言读取 session_id/claude_code_version/model/cwd/permissionMode、events.find(...)、对 ev.requestId 的就地突变 | 无断言/高阶 | sa_json 探针读原始 JSON；find 以显式循环；requestId 改写 projector struct 字段（projector 的 ProjectedEvent 需带 requestId 字段）
claudeCompatibleRuntime.ts:277-280 | emitEvent: toNotification(event) as JsonRpcNotification | 动态通知对象 | toNotification 输出 JSON 文本缓冲

## claudeCompatibleTurnProjector.ts
claudeCompatibleTurnProjector.ts:17-28 | ProjectedEvent 判别联合（11 种对象形状） | 无 sum type | kind 标签 + 全字段单 struct + has_* 标志
claudeCompatibleTurnProjector.ts:34-45 | TurnState 内 Set<string> / Map<string,string> / Map<string,Record> / Map<number,{...}> | 无 Set/Map | StrList 作 set、StrMap 平行表、toolItems 以 JSON 文本表、streamToolBlocks 以 64 槽定长数组（按 blockIndex）；Map 值替换以 append-only + latest-wins 读取近似，values().join("") 会重复计入被替换值（代码内 DEFECT）
claudeCompatibleTurnProjector.ts:47-53 | ProjectorContext.sessionToThread: Map | 同上 | StrMap
claudeCompatibleTurnProjector.ts:86-88 | normalizeAssistantText: replace(/\r\n/g,"\n").trim() | 无正则 | 字节扫描 + trim 近似
claudeCompatibleTurnProjector.ts:90-122 | assistantResultAlreadyProjected / reconcileStreamedItem: map/filter/join/includes 高阶与字符串包含语义 | 无高阶函数 | 显式循环 + buf_contains 近似（normalize 后包含判断保留）
claudeCompatibleTurnProjector.ts:124-133 | streamedToolArguments: JSON.parse try/catch、失败返回原字符串 | 动态 JSON 值 | 输出 JSON 文本；解析失败时以 JSON 字符串字面量编码近似
claudeCompatibleTurnProjector.ts:139-206 | toNotification: switch + params Record 动态构建 + 嵌套 turn 对象字面量 | 动态对象 | 按 kind 分支手拼通知 JSON 文本
claudeCompatibleTurnProjector.ts:212-219 | resolveThread: Map has/get/set + 非空断言 get()! | Map 近似 | StrMap 探针 + set 副作用保留
claudeCompatibleTurnProjector.ts:237-623 | projectMessage: switch(message.type) + 大量 (message as X) 类型断言 + Array.isArray + content.entries() 解构迭代 + 模板字符串 itemId 拼接 | 无断言/解构/模板串 | 从 message.json 以 sa_json_* 嵌套/内容块探针（占位 extern，sa_std 无此面）逐字段读取；itemId 以缓冲拼接；各 case 拆为 project_* 子函数（assistant text/thinking、tool_result、stream_event start/delta、result）
claudeCompatibleTurnProjector.ts:288-296 | streamedAssistantItems.values() 展开 [...map.values()].join("") | Map 迭代顺序/展开 | strmap_join_values 按插入序拼接（见上 append-only 缺陷）
claudeCompatibleTurnProjector.ts:402-420 | user tool_result: {...(existing ?? {})} 对象展开合并 | 无对象展开 | 从 existing 的 JSON 文本探针重建 item，未知附加字段丢失（代码内 DEFECT）
claudeCompatibleTurnProjector.ts:440-441 | Number.isFinite(event.index) 数值检查 | JSON 数值探针近似 | sa_json_get_nested_number 占位 + 负值钳制
claudeCompatibleTurnProjector.ts:574-586 | result: msg.errors[0] 数组索引、展开条件属性 ...(cond ? {error} : {}) | 动态对象 | sa_json_errors_count/get 占位探针 + has_error 标志
claudeCompatibleTurnProjector.ts:613-623 | forceTerminate / markInterrupted 返回 ProjectedEvent | null | 无可空返回 | out 参数 + has_out 标志
claudeCompatibleTurnProjector.ts:全文件 | uuid 字段不在 ClaudeMessage 联合 struct 上（protocol 文件将其放在具体消息 struct） | 1:1 类型面不一致的连带缺陷 | message_uuid() 从原始 JSON 重探

## claudeTaskPlan.ts
claudeTaskPlan.ts:19-29 | ClaudeTaskPlanStatus 字面量联合 + ClaudeTaskPlanStep 可选 taskId | 无联合/Option | PLAN_STATUS_* 枚举 + plan_status_name；has_taskId 标志
claudeTaskPlan.ts:38 | PLAN_TOOL_NAMES = new Set([...]) | 无 Set | isClaudeTaskPlanTool 比较链
claudeTaskPlan.ts:52-62 | applyClaudeTaskPlanTool(state, toolUseId, toolName, input: JsonValue | undefined)、asRecord 运行时形状检查 | 动态 JSON | input 以 JSON 文本 + has_input 传入；成员访问以 sa_json_plan_* 占位探针（sa_std 无泛型嵌套 JSON 面）
claudeTaskPlan.ts:64-86 | applyTodoWrite: Array.isArray(args.todos ?? args.tasks)、todos.entries() 解构、展开条件属性 ...(id ? {taskId} : {})、stringValue ?? 链 | 无对应 | 数组探针 + 索引循环；?? 链以顺序 plan_entry_string 尝试；条件属性以 has_taskId 分支
claudeTaskPlan.ts:88-134 | applyTaskCreate/applyTaskUpdate: Array.find/findIndex、splice(index,1)、state.steps[index]! 非空断言、Boolean(rawStatus || subject) | 无高阶/断言 | 显式循环查找；splice 以左移实现；返回值以 has_* 或运算
claudeTaskPlan.ts:142-152 | bindClaudeTaskPlanResult: resultText.match(/Task\s+#(\d+)/i)?.[1] 正则捕获 | 无正则 | 大小写不敏感手写扫描（Task + 空白 + # + 数字串）
claudeTaskPlan.ts:159-177 | claudeTaskPlanStateFromItem 返回 State | null、record.plan 数组重建 | 可空返回 | bool + out 参数
claudeTaskPlan.ts:185-201 | buildClaudeTaskPlanItem 返回 Record<string, JsonValue> | null、steps.map 对象构建 | 动态对象 | 手拼 JSON 文本 + bool 返回
claudeTaskPlan.ts:203-213 | formatClaudeTaskPlanText map/join、claudeTaskPlanStatus some/every | 无高阶 | 显式循环
claudeTaskPlan.ts:215-220 | normalizeStatus: replace(/[_-]+/g,"").toLowerCase() | 正则 | 逐字节过滤+小写化
claudeTaskPlan.ts:222-229 | asRecord / stringValue 的 typeof + trim 运行时检查 | 动态类型 | 探针 has_string + plan_string_value(trim 后非空) 近似；stringValue 返回未 trim 原值这一点在 turnInput 中保留、在本文件探针以 trim 后值近似（语义差：step 文本首尾空白）

## claudeTurnInput.ts
claudeTurnInput.ts:1-3 | node:fs/promises readFile、@cxu/sdk-backend 的 pathOnlyHistoryPlaceholder/toPathOnlyImageBlock | 无对应 | sa_std_fs_read_file 同步近似；host_* 占位 extern 返回 JSON 文本
claudeTurnInput.ts:27-33 | SUPPORTED_IMAGE_MEDIA_TYPES = new Set | 无 Set | 成员函数比较链
claudeTurnInput.ts:35-44 | ClaudeImageSource / ClaudeContentBlockParam 判别联合 | 无 sum type | source_kind/block_kind 标签 struct；base64 数据定长 32MB 缓冲（超限未处理）
claudeTurnInput.ts:46-59 | ClaudeTurnInput.attachmentBlocks: JsonValue[] | 动态 JSON 数组 | StrList 存原始 JSON 文本
claudeTurnInput.ts:61-74 | blockRecord / stringField(record, keys[]) 的 Record 动态访问与 typeof 检查 | 动态对象 | sa_json_input_entry_* 占位探针；stringField 多键以顺序尝试（url→image_url→imageUrl→path 在调用点展开）
claudeTurnInput.ts:77-84 | detectImageMediaType: base64.slice(0,16).startsWith 前缀判断 | — | starts_with 字节前缀（与 TS 同为文本前缀语义）
claudeTurnInput.ts:86-96 | imageMediaTypeForPath: path.split(".").pop()?.toLowerCase() switch | 可选链 | 最后 '.' 分段 + 小写化 + 比较链
claudeTurnInput.ts:105-110 | normalizeImageMediaType: declared?.toLowerCase()、Set.has、?? 回退 | 可选链 | has_declared 标志 + 分支
claudeTurnInput.ts:112-126 | parseDataUrl: indexOf/slice、/;base64$/i 与 /\s+/g 正则、Buffer.from(decodeURIComponent(payload), "binary").toString("base64") | 正则/Buffer/URI 解码 | 后缀大小写不敏感扫描 + 空白扫描去除；非 base64 分支以 uri_decode_bytes + sa_base64_encode 占位近似；返回 null 以 bool 近似
claudeTurnInput.ts:128-130 | isRemoteUrl: /^https?:\/\//i 正则 | 正则 | 大小写不敏感前缀检查
claudeTurnInput.ts:132-143 | readImageFromDisk: await readFile、bytes.byteLength、Buffer.toString("base64")、Math.round MiB 错误消息、throw | async/异常 | 同步读 + 状态码；MiB 以 (len+524288)/1048576 近似 Math.round
claudeTurnInput.ts:150-157 | withPathRef: text.includes/indexOf/slice 拼接 | — | buf_contains/buf_index_of 手写近似（语义一致）
claudeTurnInput.ts:165-246 | extractTurnInput: async + for..of 遍历 input 数组 + await readImageFromDisk + try/catch 回退 @ref、模板字符串 warnings | async/异常/动态数组 | 同步函数（签名注 DEFECT: async 语义）；条目以索引探针循环；catch 回退以返回码分支；attachmentBlocks.push(entry) 以条目原始 JSON 探针
claudeTurnInput.ts:255-260 | buildClaudeUserContent 返回 JsonValue（string | block 数组）、[...images] 展开 | 动态 JSON | 输出 JSON 文本：无图时 JSON 字符串、有图时手拼块数组（文本块置尾保留）

## claudeDesktopInjection.ts
claudeDesktopInjection.ts:1-3 | node:crypto randomUUID、node:fs/promises、node:path | 无对应 | host_random_uuid / sa_std_fs_* / path_* 占位
claudeDesktopInjection.ts:5-7 | MODEL_CONTEXT_VARIANT_PATTERN / CLAUDE_MODEL_PATTERN 正则常量、JsonObject = Record<string, unknown> | 无正则/动态对象 | splitModelContextVariant / claude_model_pattern_test 手写扫描；JsonObject 以 JSON 文本缓冲
claudeDesktopInjection.ts:26-58 | buildClaudeDesktopRelayInjection: new Set(sourceModels.map(trim).filter(Boolean))、Map aliasTargets、modelMappings[a] ?? modelMappings[b] ?? "" 索引访问、throw、模板字符串、返回端 new Map 去重 | 无 Set/Map/异常 | seen StrList 去重；StrMap（借用 projector 文件定义，未在本文件 @import——跨文件辅助不一致待修复阶段处理）；?? 以 has 探针顺序尝试；throw 改状态码；去重在插入时近似
claudeDesktopInjection.ts:62 | CLAUDE_MSIX_PACKAGE_PATTERN = /^Claude_[A-Za-z0-9]+$/i | 正则 | msix_package_pattern_test 扫描
claudeDesktopInjection.ts:64-71 | pathExists: async + access try/catch | async/异常 | 同步 sa_std_fs_exists
claudeDesktopInjection.ts:73-99 | resolveClaudeConfigLibraryDir: async、options 默认 {}、process.platform / process.env.LOCALAPPDATA 默认、readdir withFileTypes + filter/map/sort 高阶链、await pathExists 顺序探 | async/进程全局/Dirent | 同步状态码形式；host_platform_name 占位；list_dir 顺序假定已排序（.sort() 未显式实现）；candidates.join(", ") 错误消息保留
claudeDesktopInjection.ts:101-111 | readClaudeActiveConfig: readFile、basename(id) !== id 检查、/^[A-Za-z0-9_-]+$/ 正则、对象返回 | async/正则 | 同步状态码；id 字符集扫描（basename 检查被字符集蕴含而省略，含分隔符必然不合格）
claudeDesktopInjection.ts:113-152 | writeClaudeDesktopInference: async 链、trim().replace(/\/+$/,"")、flatMap + Set、filter、{...active.config} 展开合并、delete 键、JSON.stringify(x, null, 2) 美化、writeFile mode 0o600、rename、桌面配置 catch 中 /ENOENT/.test(error.message) 分支 | async/正则/动态对象 | 同步状态码；尾斜杠扫描剥离；对象合并/删除/美化以 sa_json_obj_* / sa_json_stringify_pretty 占位；ENOENT 以 exists 探针近似；mode 0o600 以数值 384 传 write_file_mode 占位
claudeDesktopInjection.ts:154-163 | parseJsonObject: JSON.parse try/catch、typeof/Array.isArray 形状校验 | 动态 JSON | sa_json_parse + sa_json_is_object 占位探针；错误消息保留
claudeDesktopInjection.ts:165-177 | splitModelContextVariant: match(MODEL_CONTEXT_VARIANT_PATTERN)、match.index、match[0].replace(/\s+/g,"") | 正则 | 尾部括号扫描（数字/小数点/空白/单位 k|m 大小写不敏感）；match.index 以最后 '[' 位置近似（模式锚定 $，语义基本一致）

## 分部 p2：backends/claude/src 顶层 + backends/codex 全部（8 文件）

# backends-a-p2 defects log
# Format: source:lines | TS construct | missing capability/problem | approximation used

backends/claude/src/manifest.ts:1-8 | JSON import with `with { type: "json" }` + `as PluginManifest` cast | SLA has no JSON module import / type assertion | JSON text buffer global + copy fn claude_manifest()
backends/claude/src/manifest.ts:5 | import type PluginManifest from @cxu/sdk-backend | SDK types have no SLA counterpart | local struct PluginManifest { json buffer }
backends/codex/src/manifest.ts:1-8 | JSON import with `with { type: "json" }` + `as PluginManifest` cast | SLA has no JSON module import / type assertion | JSON text buffer global + copy fn codex_manifest()
backends/codex/src/manifest.ts:5 | import type PluginManifest from @cxu/sdk-backend | SDK types have no SLA counterpart | local struct PluginManifest { json buffer }
backends/claude/src/server.ts:6-12 | import type EngineHandle/EngineStatus/PluginInstallation/ServerHost/ServerPlugin | SDK interface types have no SLA counterpart | local structs with fixed buffers / JSON buffer / opaque id
backends/claude/src/server.ts:17-33 | class ClaudeEngine implements EngineHandle, #status private field | no class/interface/private fields in SLA | struct ClaudeEngine + &self function family; #status as plain field
backends/claude/src/server.ts:20-26 | async start()/stop(): Promise | no async/Promise | synchronous fns returning EngineStatus / i32 status code, // DEFECT: async at signatures
backends/claude/src/server.ts:30-32 | async handleRpc(): Promise<unknown> + throw new Error | no Promise/unknown/throw | sync fn returning -1 error code, message kept as STR literal
backends/claude/src/server.ts:35-56 | object literal ServerPlugin with arrow/method props (matchesKind: () => true, createEngine, findInstallations, skillRoots), string[] returns, export default | no object literals with methods / closures / dynamic arrays / default export | ServerPlugin struct + constructor fn + free fns; fixed arrays + len; default via *_default() fn
backends/codex/src/server.ts:6-12 | import type EngineHandle/EngineStatus/PluginInstallation/ServerHost/ServerPlugin | SDK interface types have no SLA counterpart | local structs with fixed buffers / JSON buffer / opaque id
backends/codex/src/server.ts:17-33 | class CodexEngine implements EngineHandle, #status private field | no class/interface/private fields in SLA | struct CodexEngine + &self function family; #status as plain field
backends/codex/src/server.ts:20-26 | async start()/stop(): Promise | no async/Promise | synchronous fns returning EngineStatus / i32 status code, // DEFECT: async at signatures
backends/codex/src/server.ts:30-32 | async handleRpc(): Promise<unknown> + throw new Error | no Promise/unknown/throw | sync fn returning -1 error code, message kept as STR literal
backends/codex/src/server.ts:35-57 | object literal ServerPlugin with arrow/method props (matchesKind: () => true, createEngine, findInstallations, skillRoots), string[] returns, export default | no object literals with methods / closures / dynamic arrays / default export | ServerPlugin struct + constructor fn + free fns; fixed arrays + len; default via *_default() fn
backends/codex/src/runtime/codexBridge.ts:1-31 | imports: node child_process/readline/events, @codex-ui/shared types, pluginHostServices DI defaults, PendingRequest with resolve/reject closures | no Node APIs/EventEmitter/closure values in SLA | opaque child handle id, PendingTable fixed array(256), host-service selector ids, emit_* fns
backends/codex/src/runtime/codexBridge.ts:33-145 | class CodexBridge extends EventEmitter implements CodexRuntimeClient; async start() with spawn/readline/stderr handlers, await initialize, floating readCodexVersion().then() | no class inheritance/async/streams | struct + &self fns, sync start returning rc + out status, sequential version read
backends/codex/src/runtime/codexBridge.ts:147-235 | stop/restart/request/requestOnChild (new Promise + setTimeout/clearTimeout)/notify/respond/send/ensureRunning (Promise.finally recovery) | no Promise/timers | pending entries carry timeout_ms, recovery as flag+stored status, rc propagation instead of throw
backends/codex/src/runtime/codexBridge.ts:237-328 | invalidateChild/handleLine (JSON.parse try/catch, `in` operator, Map get/delete)/setStatus/resolveCodexBin/readCodexVersion (Promise+setTimeout 3000+stdout accumulation) | no exceptions/Map/dynamic JSON parse surface | linear pending scan by id len, parsed-flag placeholder, sync version fn
backends/codex/src/runtime/codexBridge.ts:330-371 | Set<string> THREAD_SCOPED_HISTORY_METHODS, threadIdFromParams dynamic access, isThreadMissingError includes(), redactSecrets 3 regex replaces | no Set/regex/dynamic object | length-dispatch checks, substring-scan placeholders, copy-through redactSecrets
backends/codex/src/runtime/codexBridge.ts:373-526 | class AutoFallbackCodexRuntimeClient (EventEmitter, .on closures capturing mutable isFallback, console.warn, template literals) + createCodexRuntimeClient factory (process.env/platform, VirtualConfig wrapper, mode string branches) | no closures/polymorphism/env access | CodexRuntimeClientRef kind-tagged struct, guarded dispatch fns, mode as normalized (ptr,len)+is_windows, kind out tag
backends/codex/src/runtime/daemonCodexBridge.ts:1-40 | imports node:fs/os/path, ws WebSocket, constants via path.join, PendingRequest closures | no Node fs/path/ws in SLA | opaque ws handle id, literal relative paths, PendingTable fixed array
backends/codex/src/runtime/daemonCodexBridge.ts:42-58 | resolveCodexHome/resolveDefaultSocketPath using process.env, os.homedir(), path.join | no env/homedir/path.join | host-filled buffers + presence flags, len arithmetic
backends/codex/src/runtime/daemonCodexBridge.ts:60-199 | class DaemonCodexBridge: async start/stop/restart/request/notify/respond/sendPayload over WebSocket (readyState OPEN check, JSON.stringify) | no async/WebSocket class | sync fns, ws handle nonzero check, JSON buffer serialization deferred
backends/codex/src/runtime/daemonCodexBridge.ts:201-290 | ensureDaemonRunning (mkdirSync, polling loop with await setTimeout 250) + runDaemonLifecycle (new Promise, spawn, stream accumulation, lifecycle timeout, template-literal errors) + daemonNeedsRuntimeEnvRestart/hasUsableSocket (existsSync/statSync/rmSync) | no fs sync APIs/Promise/timers | sequential rc fns, fs externs deferred to fix phase, loop without sleep
backends/codex/src/runtime/daemonCodexBridge.ts:292-441 | connectWebSocket (new WebSocket ws+unix://, on open/message/error/close handlers, async open handler, reconnect setTimeout closure), handleMessageLine, readCodexVersion | no WebSocket events/async closures | split *_onOpen/_onMessage/_onError/_onClose + reconnectTimerFire fns driven by host pump
backends/codex/src/runtime/daemonCodexBridge.ts:443-508 | runtimeEnvMissingInProcessEnv/daemonRuntimeEnv (Object.entries, startsWith/endsWith filtering), readPidManagedDaemonEnv (readFileSync pid file + /proc/<pid>/environ, JSON.parse, split/indexOf/slice) | no dynamic env objects/fs reads in this pass | env JSON buffers, found-flag return, filtering deferred
backends/codex/src/runtime/remoteBunCodexBridge.ts:1-48 | RemoteBunTransport injectable async function object, Pick<>/intersection route type, defaultRemoteBunTransport, class fields incl. Promise fields starting/reconnecting | no async function values/generics/Promise | transport struct of selector ids + call fns, plain route struct, Promise as flag+status
backends/codex/src/runtime/remoteBunCodexBridge.ts:50-131 | start/startInternal (void pollEvents() floating loop), stop (void DELETE request .catch().finally(closeTunnel), encodeURIComponent, template path), interrupt, restart | no floating promises/Promise chains/URI encoding | poll step fn + driver loop, sequential DELETE-then-close, path prefix literal
backends/codex/src/runtime/remoteBunCodexBridge.ts:132-190 | request (transport try/catch, reconnect + retry-safe gate, asRecord, ?? fallbacks, non-null assertions), notify, respond (spread-conditional body, String(id) concat, .catch emit) | no exceptions/dynamic JSON navigation | reserved rc -2 for transport failure, buffer copy-out, sequential respond with stderr emit on rc
backends/codex/src/runtime/remoteBunCodexBridge.ts:191-233 | pollEvents long-poll while loop (URLSearchParams, template URL, Array.isArray, dynamic events, Math.max cursor, dual emit kinds), ensureConnected, reconnect (async IIFE, exponential attempts, await delay, throw lastError) | no async loop task/URLSearchParams/dynamic arrays | step+driver split, generation counter + attempt loop preserved, delay as host-sleep placeholder
backends/codex/src/runtime/remoteBunCodexBridge.ts:234-266 | connect (openTunnel, nested ternary cursor logic, session extraction text()/number()), releaseConnection, helpers asRecord/text/number/safeCursor (unknown narrowing, Number() coercion), delay (Promise+setTimeout) | no unknown coercion semantics | flag-based narrowing helpers, sequential cursor branches
backends/codex/src/runtime/remoteBunCodexBridge.ts:229-233 | remoteReconnectDelayMs (Math.min, ** exponent), isRemoteRpcRetrySafe + isRemoteTransportFailure (regex .test) | no regex/** operator | loop multiplication with min cap, length-dispatch safe set, substring scans deferred
backends/codex/src/runtime/sshCodexBridge.ts:1-26 | imports node child_process/readline/events/util promisify, types SshWorkspaceProfile/RemoteOs union/SshCodexBridgeOptions (optional fields, configEdits array, modelCatalog Record), Pending with timer, execFileAsync=promisify(execFile) | no Node APIs/union/Record/promisify | structs with presence flags, fixed ConfigEdit array(16), catalog JSON buffer, RemoteOs as u64 tag
backends/codex/src/runtime/sshCodexBridge.ts:28-90 | class SshCodexBridge start/startInternal: splitSshCommand validation, detectRemoteOs await, remote command built via template literals/arrays join (PowerShell + POSIX branches), spawn ssh with -R forward args spread, token stdin write, fail closure, once/on handlers, initialize + modelCatalog write + configEdits.map + config/batchWrite request, optional chaining | no string building/spread/map/closures/events in this pass | step-by-step fn with fragments preserved verbatim in comments, fail as named fn, sequential rc flow
backends/codex/src/runtime/sshCodexBridge.ts:92-110 | stop/restart/request (new Promise + setTimeout with turn/interrupt special-case calling stop(), child?.stdin.write JSON.stringify) / notify / respond (spread-conditional) / handleLine (JSON.parse, `in`, Map) | no Promise/timers/dynamic JSON | pending table + SshCodexBridge_requestTimeout fn, has_error branch serialization deferred, linear pending scan
backends/codex/src/runtime/sshCodexBridge.ts:111-144 | quote/quoteRemotePath/expandRemoteHome/quotePowerShell (String.replace regex, startsWith/slice ternaries), powershellEncodedCommand (Buffer utf16le + base64), detectRemoteOs (execFileAsync ssh probes, destructuring, options object), writeRemoteModelCatalog (Buffer base64 of JSON.stringify, template remote cmd), remoteCatalogPath (regex trailing-slash replace), splitSshCommand (for-of chars, /\s/ regex, dynamic push, throw on unclosed quote) | no regex/Buffer/string char iteration | manual scan-copy fns deferred to fix phase with signatures/semantics preserved, byte state machine noted, -1 for throw cases

## 分部 p3：backends/opencode 大文件（4 文件）

# backends-a-p3 缺陷日志（追加式）

## opencodeCompatibleTurnProjector.ts（1539 行）
opencodeCompatibleTurnProjector.ts:18-53 | TS discriminated union (OpencodeProjectedEvent) | SLA 无联合类型/可变字段 | kind 标签 u32 + 扁平 struct 承载全部变体字段
opencodeCompatibleTurnProjector.ts:55-97 | Map<string, Record>/Set<string> 上下文字段 | SLA 无 Map/Set | 定长键数组 + JSON 文本 arena + len 字段（tool 256 / part 1024 / plan 候选 256 上限估算）
opencodeCompatibleTurnProjector.ts:1-16 | JsonValue / Record<string, unknown> 动态 JSON | 无动态对象 | 全部改 JSON 文本缓冲 + sa_json_* extern 近似
opencodeCompatibleTurnProjector.ts:99-141 | 模板字符串 `opencode-msg-${turnId}-0` + Date.now() | 无字符串插值、无已绑定的墙钟 extern | 字节拼接近似；startedAtMs 由调用方传入 now
opencodeCompatibleTurnProjector.ts:154-190 | 对象展开 {...last} 构造 tokenUsage | 无对象展开 | 按字段名逐个序列化进 JSON 缓冲
opencodeCompatibleTurnProjector.ts:285-301 | Map 迭代 + 记录字段判断 hasOpenOpencodeTools | 无 Map 迭代语义 | 扫描 tool JSON arena 近似（本轮仅保留逻辑注释，扫描器留修复期）
opencodeCompatibleTurnProjector.ts:362-365,1276-1309,1355-1391 | 正则 replace/test（状态归一、429/5xx/重试耗尽分类） | sa_std 无正则引擎 | 字节子串扫描近似
opencodeCompatibleTurnProjector.ts:390-429 | JSON.parse try/catch + 动态数组遍历 extractOpencodePlanSteps | 无异常、无动态遍历 | parse 失败即 is_null 回退普通工具行；遍历走 sa_json extern（修复期）
opencodeCompatibleTurnProjector.ts:536-602 | flatMap/spread 条件字段 normalizeOpencodeQuestions / answers 映射 | 无高阶函数 | 条件序列化进 JSON 缓冲
opencodeCompatibleTurnProjector.ts:634-679 | 正则提取 ses_ 子会话 id（三种模式） | 无正则 | "ses_" 字节扫描 + <task id= 标记扫描近似
opencodeCompatibleTurnProjector.ts:830-1394 | switch(event.type) + 各事件类型的类型断言 cast | 无字符串 switch/类型收窄 | 按 type 字节逐一比对分发到 case_* 同名辅助函数，保留 1:1 case 结构
opencodeCompatibleTurnProjector.ts:1431-1539 | Date.now()/1000 时间戳进 notification | 墙钟 extern 未绑定 | 字段保留，值由运行时在修复期填入

## opencodeHistoryProjection.ts（1137 行）
opencodeHistoryProjection.ts:37-42,91-130 | bun:sqlite / Node SQLite 句柄 + query/prepare 闭包 | sa_std 无 SQLite 绑定 | NativeDb 不透明句柄 u64 + sa_sqlite_* extern 桩（修复期绑定）
opencodeHistoryProjection.ts:12,44-85 | createRequire/import.meta、process.env、homedir、readdirSync 目录枚举 | 无对应 std 面 | env/fs extern 近似，路径以 NUL 分隔缓冲传递
opencodeHistoryProjection.ts:141-161,564-581 | 正则（ses_ id、默认标题、模型/URL 解析） | 无正则引擎 | 字节前缀/子串扫描近似
opencodeHistoryProjection.ts:110-130,382-418 | 变参 SQL 绑定 + try/catch 降级 | 无异常、无变参 | 参数改 JSON 数组缓冲；失败以状态码/空结果近似
opencodeHistoryProjection.ts:211-306 | Map 按 id 合并多 DB + 按 recency 排序分页 | 无 Map/动态排序 | JSON arena + 提取键外排（修复期）
opencodeHistoryProjection.ts:320-372 | 模块级 Map 缓存 metaDbFileCache（30s TTL） | 无模块级可变 Map | 定长并行数组 struct（上限 512）
opencodeHistoryProjection.ts:529-533 | JS 字符串 length 为 UTF-16 码元，clipHistoryText 按其截断 | SLA 按字节 | 截断点对多字节文本与源语义不一致
opencodeHistoryProjection.ts:583-606 | Buffer base64 解码 + sha256 内容哈希落盘 | base64/sha256 extern 未在本轮绑定 | 以 std sha256 与 fs extern 名义保留（修复期）
opencodeHistoryProjection.ts:613-897 | 闭包捕获可变状态（current/itemCount/usedChildSessionIds） | 无闭包 | 显式 ProjectTurnsState struct 承载
opencodeHistoryProjection.ts:906-1137 | flatMap/展开/可选链拼装 thread 与 tail 结果 | 无动态对象 | JSON 文本缓冲拼装

## opencodeCompatibleRuntime.ts（1663 行）
opencodeCompatibleRuntime.ts:350-384 | class extends EventEmitter（emit/on 多事件） | SLA 无事件发射器/函数指针分发 | 回调槽近似，emit 调用记为直接辅助调用（修复期绑定）
opencodeCompatibleRuntime.ts:462-475,576-1663 | async/await + Promise（几乎全部公开方法） | SLA 同步模型 | 同步 fn + i32 状态码；Promise.race/等待改为宿主轮询标志
opencodeCompatibleRuntime.ts:501-675,1016-1465 | fetch/Response/ReadableStream/TextDecoder 流式 SSE 与 v2 feed | 无 Web fetch 流 API | sa_http_* / SSE extern 近似（修复期）；帧切分逻辑保留在 protocol 单元
opencodeCompatibleRuntime.ts:386-460 | Partial<Config> + Object.assign + 指纹对象拼装 | 无动态对象 | per-field has-flag 合并近似
opencodeCompatibleRuntime.ts:677-795 | setTimeout/clearTimeout 五组计时器（idle/stall/retry/question/v2 超时） | 无定时器 | deadline 字段 + 宿主循环轮询近似
opencodeCompatibleRuntime.ts:352-381 | Set/Map 状态（staleMessageIds、seenSseEventIds、pendingPermissions、pendingQuestions） | 无 Set/Map | 定长键数组 + JSON arena（pendingQuestions 上限以 arena 容量估算）
opencodeCompatibleRuntime.ts:191-330 | fs/promises stat/readFile + Buffer base64 + 闭包 pushImageFromDataUrl | 无 Promise fs/Buffer | fs/base64 extern 近似；闭包改显式累加 struct
opencodeCompatibleRuntime.ts:77-83,152-166 | Number/Date.parse、decodeURIComponent、Buffer.from(...,"binary") | 无 JS 数值/URI 语义 | 解析 extern 近似（修复期）
opencodeCompatibleRuntime.ts:1180-1402 | executeTurnV2 嵌套 async 闭包 readFeed/handleEvent + 联合类型 V2Outcome | 无闭包/联合 | 顺序 feed 循环 + outcome 字段 struct 近似
opencodeCompatibleRuntime.ts:495-499 | Buffer base64 生成 Basic authHeader | 无 Buffer | base64 extern 近似
opencodeCompatibleRuntime.ts:699-721 | AbortSignal.timeout + 429 指数退避重试循环中的 sleep | 无 AbortSignal/睡眠原语 | deadline + 宿主等待近似

## opencodeBridge.ts（1578 行）
opencodeBridge.ts:238-249 | class extends EventEmitter implements CodexRuntimeClient + 函数型 options 回调 | 无事件发射器/函数指针/接口实现 | emit 改直接分发辅助函数；options 以 presence flag + 宿主绑定 id 近似
opencodeBridge.ts:265-1577 | async/Promise（start/request/turn/start 等）+ void promise.catch 后台执行 | SLA 同步模型、无后台任务 | 同步 fn + 状态码；后台 turn/compaction 改顺序调用并保留终态处理语义
opencodeBridge.ts:239-244 | Map<string, OpencodeSession> / Map<string, Session> 双映射 | 无 Map | 定长 arena（sessions 256 / pendingOwners 1024 上限估算）+ JSON 序列化
opencodeBridge.ts:1-29 | JsonValue/JsonRpc* 动态 JSON 与 SDK 类型 | 无动态对象 | JSON 文本缓冲 + sa_json extern 近似
opencodeBridge.ts:553-636 | EventEmitter 闭包监听（sessionId/serverRequest/notification 捕获 session） | 无闭包 | 显式 session 索引参数的同名入口函数
opencodeBridge.ts:49-68,1317-1333 | 正则（分组 id、opencode-go 前缀、review slash 来自 opencodeReview） | 无正则引擎 | 前缀/字节扫描近似
opencodeBridge.ts:751-1577 | switch(method) 巨型分发 + 展开 {...record}、可选链、类型谓词 filter | 无动态对象/谓词 | method 字节比对分发至 case_* 辅助函数；字段逐个读取近似
opencodeBridge.ts:766-831 | randomUUID（node:crypto）+ Date.now 时间戳 | uuid/墙钟 extern 未绑定 | 字段保留，修复期绑定
opencodeBridge.ts:116-171 | Set 去重 + 动态 ProviderConfig 对象字面量 | 无 Set/动态对象 | 线性去重 + JSON arena 拼装
opencodeBridge.ts:1558-1577 | finally 计时埋点（慢读 >3000ms console.warn） | 无 finally/墙钟 | now 参数传入，收尾统一检查近似

## 分部 p4：backends/opencode 其余 + backends/opencode-v2（9 文件）

# backends-a-p4 缺陷日志（opencode / opencode-v2 后端）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## backends/opencode/src/manifest.ts
backends/opencode/src/manifest.ts:5-6 | JSON module import `import manifestJson from "../plugin.json" with { type: "json" }` | SLA 无 JSON 模块导入/导入属性 | manifest 近似为 JSON 文本缓冲 struct OpencodeManifest，由调用方从 ../plugin.json 填充
backends/opencode/src/manifest.ts:5,8 | `PluginManifest` SDK 类型 + `as` 类型断言 | SDK 类型无 SLA struct 对应 | 以 JSON 文本缓冲代替类型化清单，断言为空操作

## backends/opencode-v2/src/manifest.ts
backends/opencode-v2/src/manifest.ts:5-6 | JSON module import `import manifestJson from "../plugin.json" with { type: "json" }` | SLA 无 JSON 模块导入/导入属性 | manifest 近似为 JSON 文本缓冲 struct OpencodeV2Manifest，由调用方从 ../plugin.json 填充
backends/opencode-v2/src/manifest.ts:5,8 | `PluginManifest` SDK 类型 + `as` 类型断言 | SDK 类型无 SLA struct 对应 | 以 JSON 文本缓冲代替类型化清单，断言为空操作

## backends/opencode/src/server.ts
backends/opencode/src/server.ts:13-20 | Node API 导入 (execFileSync/existsSync/homedir/basename/join) + SDK 类型导入 | sa_std 无确认对应面 | intent extern sa_std_process_exec_file_sync / sa_std_fs_exists / sa_std_os_homedir / sa_std_env_get + 手写 basename/join
backends/opencode/src/server.ts:28-45 | try/catch + RegExp `/(\d+)\.(\d+)\.(\d+)/` | SLA 无异常、无正则 | 状态码 + 手写 scan_semver 数字-点扫描器
backends/opencode/src/server.ts:37-45 | probeVersion 返回拥有的 string（match[0]） | 切片指向本地 exec 缓冲，生命周期不符 | 返回 (ptr,len) span，缺陷注释标明修复期须拷贝
backends/opencode/src/server.ts:47-63 | class OpencodeEngine implements EngineHandle + `#status` 私有字段 | SLA 无类/接口/私有字段 | struct OpencodeEngine + &OpencodeEngine 首参函数族
backends/opencode/src/server.ts:50,54,60 | async start/stop/handleRpc (Promise) | 无 async/Promise | 同步函数 + i32 状态码，签名处 DEFECT: async 语义（handleRpc 的 throw -> 返回 1）
backends/opencode/src/server.ts:65-105 | ServerPlugin 对象字面量（嵌套 cliSettings/discovery 对象字面量） | 无对象字面量/动态对象 | OpencodeServerPlugin/CliSettings/Discovery 定长字段 struct + init 函数填字面量
backends/opencode/src/server.ts:74-78 | discovery.matchesKind 方法 + 正则 `/\.(exe|cmd|bat|com)$/` + Number.parseInt/NaN | 无正则/NaN 语义 | 手写后缀剥离 + (major, has_major) 对；parseInt 部分解析近似
backends/opencode/src/server.ts:84-102 | async findInstallations + 闭包 consider 捕获 seen(Set)/found + `??` + PATH split(":") | 无闭包/Set/async；env 为动态 Record | OpencodeFindState 显式状态 + opencode_consider 函数；Set 近似为定长 64 路径数组；split(":") 在 Windows 应为 ";"（源即硬编码 ":"，照源保留）
backends/opencode/src/server.ts:84 | NodeJS.ProcessEnv 动态记录 | 无动态对象 | sa_std_env_get 按名查询 intent extern
backends/opencode/src/server.ts:23,68 | OPENCODE_OFFICIAL_PROVIDER_ID 跨文件常量（opencodeBridge.ts） | 依赖文件不在本单元转换范围 | @import runtime/opencodeBridge.sla 占位引用，字面量值留待该文件所在单元/修复期

## backends/opencode-v2/src/server.ts
backends/opencode-v2/src/server.ts:16-21 | Node API 导入 (execFileSync/existsSync/homedir/basename/join) + SDK 类型导入 | sa_std 无确认对应面 | intent extern sa_std_process_exec_file_sync_into / sa_std_fs_exists / sa_std_os_homedir / sa_std_env_get + 手写 basename/join
backends/opencode-v2/src/server.ts:30-38 | probe() 返回对象 `{ version?, major? }` + try/catch + RegExp | 无异常/正则/可选字段对象 | (major,has_major,version span,has_version) 出参组 + scan_semver 扫描器；version span 指向调用方 scratch 缓冲
backends/opencode-v2/src/server.ts:40-56 | class OpencodeV2Engine implements EngineHandle + `#status` 私有字段 | 无类/接口/私有字段 | struct OpencodeV2Engine + 函数族
backends/opencode-v2/src/server.ts:43,47,53 | async start/stop/handleRpc | 无 async/Promise/throw | 同步 + i32 状态码（handleRpc throw -> 1）
backends/opencode-v2/src/server.ts:66-109 | ServerPlugin 对象字面量（cliSettings/discovery 嵌套对象 + matchesKind 方法） | 无对象字面量 | 定长字段 struct + opencodeV2ServerPlugin_init；matchesKind 正则替换/parseInt/NaN 手写近似
backends/opencode-v2/src/server.ts:84-105 | async findInstallations + 闭包 consider + Set + `??` | 无闭包/Set/async/动态 env Record | OpencodeV2FindState + opencode_v2_consider；Set 定长 64 数组；env 按名查询 extern

## backends/opencode/src/runtime/opencodeReview.ts
backends/opencode/src/runtime/opencodeReview.ts:14-18 | 判别联合类型 OpencodeReviewTarget（4 变体） | SLA 无联合类型 | kind 标签 u32 + 定长缓冲字段 struct（branch 512 / sha 128 / title 1024 / instructions 8192）
backends/opencode/src/runtime/opencodeReview.ts:20 | 正则常量 OPENCODE_REVIEW_SLASH_RE `/^\s*\/review\b([\s\S]*)$/` | SLA 无 RegExp 值 | 仅保留模式字面量文本，匹配由调用方手写
backends/opencode/src/runtime/opencodeReview.ts:22-29 | REVIEW_RUBRIC 数组 `.join("\n")` 多行字符串 | 无数组 join | 单个含 \n 的字面量
backends/opencode/src/runtime/opencodeReview.ts:31-70 | parseOpencodeReviewTarget(value: unknown) + Record<string, unknown> + String() 强转 + `??` 链 | 无动态对象/unknown/String() 强转 | 输入近似为 JSON 文本或纯文本，字段经 sa_json_* intent extern 读取；非字符串标量的 String() 强转未复现；JSON 解析失败回退 uncommittedChanges（源不可能发生）
backends/opencode/src/runtime/opencodeReview.ts:56-68 | 正则 `/^(?:branch|base|base-branch)\s+(.+)$/i` 与 `/^commit\s+([0-9a-fA-F]{6,64})(?:\s+(.+))?$/i` | 无正则 | 手写前缀/十六进制扫描近似
backends/opencode/src/runtime/opencodeReview.ts:72-97 | 模板字面量拼 prompt/slash 文本 + switch | 无模板字面量 | ByteBuf 追加拼接 + kind 分发

## backends/opencode/src/runtime/opencodeSessionStore.ts
backends/opencode/src/runtime/opencodeSessionStore.ts:1,35-52 | RuntimeDatabase (better-sqlite3 风格 prepare/exec/run/get/all) | sa_std 无 SQLite 面 | intent extern sa_sqlite_*（exec/prepare/bind_text/bind_int/bind_null/step/column_*/changes/finalize），与其它 store 单元同口径
backends/opencode/src/runtime/opencodeSessionStore.ts:12-25 | 可空字符串字段 (string | null) | 无可空类型 | (缓冲,len,has) 三元组；state_json 定长 1MB（源为无界字符串、注释提及数十 MB 快照，会截断）
backends/opencode/src/runtime/opencodeSessionStore.ts:34 | class + constructor 参数属性 `private readonly db` | 无类/参数属性/访问控制 | struct + OpencodeSessionStore_new 函数族；private mapRow 变普通函数
backends/opencode/src/runtime/opencodeSessionStore.ts:36,65 | 模板字面量 SQL（建表/INSERT ... ON CONFLICT ... COALESCE） | 无模板字面量 | 单行字面量 SQL，文本 1:1
backends/opencode/src/runtime/opencodeSessionStore.ts:54-101 | upsert 输入对象字面量类型 + `?? existing ?? null` 链 + 非空断言 `!` | 无对象字面量/可选链/断言 | OpencodeUpsertInput struct（has=false 同时覆盖 undefined 与 null，二者在 ?? 链下等价）；bind_coalesce 复刻合并；断言按假设成功处理并注释
backends/opencode/src/runtime/opencodeSessionStore.ts:65 | Date.now() | 无对应 extern 确认 | intent extern sa_time_now_ms
backends/opencode/src/runtime/opencodeSessionStore.ts:129,145,158 | Pick<OpencodeSessionRecord, ...> 映射类型（三个 metadata 读取） | 无映射类型 | 专用 OpencodeSessionMetadata struct
backends/opencode/src/runtime/opencodeSessionStore.ts:165-179 | listForOwner 展开合并 [...a, ...b] + Set 去重 + filter 闭包 | 无展开/Set/闭包 | 两次 listByOwner + 线性扫描去重；两个 256 条列表各含 1MB state_json 字段，内存近似已注释
backends/opencode/src/runtime/opencodeSessionStore.ts:103-190 | `.get()` 返回 row|undefined、`.all()` 数组、`.run()` 的 res.changes | 无 undefined/动态数组 | get 类返回 bool+out；list 定长 256 容量；changes 经 sa_sqlite_changes intent extern

## backends/opencode/src/runtime/opencodeCompatibleProtocol.ts
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:1-84 | 判别联合 OpencodeToolState / OpencodePart（含索引签名 catch-all 变体 `{[key: string]: unknown}`） | 无联合/索引签名 | kind 标签 + 扁平化字段 struct；catch-all 额外键入 extra_json 缓冲
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:5,43,97 等 | `input?: unknown` / `metadata?: Record<string, unknown>` / `data?: unknown` / `permission?: unknown` | 无动态对象 | 一律 JSON 文本缓冲（8KB/16KB 不等，已逐字段注释容量）
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:228-241 | OpencodeSseEvent 大联合（含 server.connected/heartbeat 与 catch-all） | 无联合类型 | OpencodeSseEvent 保留 type 字符串 + 整事件原始 JSON 缓冲；逐事件 struct 已 1:1 定义，类型化码留待修复期
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:104,267 等 | 字面量联合 `"once" | "always" | "reject"`、状态 `"idle"|"busy"|"retry"` | 无字面量联合 | u32 标签（reply）/ status_type 标签
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:139,195 | 数组字段 answers: string[][]、patterns/always: string[]、questions/todos/options 数组 | 无嵌套动态数组 | 定长数组 + len（options 16 / questions 16 / todos 64）；string[][] 近似为 NUL 分隔单缓冲 + 行数
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:273-312 | parseOpencodeSseChunk：try/catch + JSON.parse 动态对象 + `typeof parsed.type === "string"` | 无异常/动态 JSON | sa_json_* intent extern 状态码；空白行判定以 \r 剥离后空行近似（空格-only 行 TS 同样 flush，等价性已注释）；事件只抽 id/type + 原始 JSON
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:314-339 | splitOpencodeSseRecords：正则 `/\r?\n\r?\n/` exec 循环 + RegExpMatchArray | 无正则 | 手写四种边界形状扫描（\n\n / \n\r\n / \r\n\n / \r\n\r\n）；records 定长 64、单条 16KB 截断
backends/opencode/src/runtime/opencodeCompatibleProtocol.ts:28-269 | 全部 interface 的可选字段 `?` | 无可选字段语义 | has_* 布尔逐字段对应

## backends/opencode/src/runtime/opencodeCompatibleProbe.ts
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:1-4 | pluginHostServices() 服务定位器（cli.getPreferredCliBinary/getCachedLatestCliPath/enumerateCliCandidates、codex.spawnCodexCommand/resolveCodexSpawn） | SLA 无宿主服务定位面 | intent extern sa_host_cli_* / sa_host_spawn_*（MISSING），符合 R2 有状态宿主能力走 services 的规则
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:11-21 | isLaunchable try/catch + statSync mode 位 | 无异常 | sa_std_fs_stat 状态码近似；八进制 0o111 写为十进制 73 并注释
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:30-91 | findOpencodeBin：env 动态 Record、`||`/`??` 链、数组字面量 fallbacks + for-of、闭包 configuredDirOrBin | 无动态对象/闭包/数组字面量 | sa_std_env_get 按名查；fallbacks 按源顺序逐条展开为 probe_try_* 调用；闭包变普通函数
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:93-95,117 | parseOpencodeModelsOutput 的 `.map(m => m.id)` | 无数组 map/箭头函数 | 显式循环
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:99-109 | OpencodeModelDetail.detail?: Record<string, unknown> | 无动态对象 | JSON 文本缓冲 + 解析节点句柄 detail_node
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:111,130-178 | OPENCODE_MODEL_ID_RE 正则 + verbose 解析状态机（闭包 flushPending 捕获 pending/jsonLines/braceDepth/seen Set）+ JSON.parse try/catch + split(/\r?\n/) | 无正则/闭包/Set/异常 | 手写 ID 扫描器；ModelsParseState 显式状态 struct + models_flush_pending；Set 以已收模型线性扫描去重；JSON.parse 状态码
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:180-217 | runOpencodeModelsCommand：Promise + spawn 子进程 stdout/stderr 事件 + setTimeout 杀进程 + settle-once done 闭包 | 无 Promise/事件/定时器 | intent extern sa_host_spawn_collect 阻塞收集（超时杀进程语义保留）；事件到达顺序的交错拼接由 extern 近似
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:219-310 | list*Async 系列：async + `.then(parse/filter)` Promise 链 | 无 async/Promise | 同步顺序调用，签名处已注 DEFECT: async 语义
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:233-253 | isOpencodeFreeModel：detail.cost 的 unknown 嵌套读取 + Number() 强转 | 无动态对象/Number() | sa_json_object_get_number intent extern（缺失/非数值读 0，与 `?? 0` 结果对齐）
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:255-257 | filterOpencodeFreeModels 的 Array.filter 箭头闭包 | 无闭包 | 显式循环
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:280-310 | probeOpencodeCliCommand：resolveCodexSpawn + spawnSync 结果对象 + 正则版本匹配（\d+\.\d+\.\d+ 回退 \d+\.\d+）+ try/catch + instanceof Error | 无对应 Node 面/正则/异常 | intent extern sa_host_spawn_sync_ex（resolve+spawn 合一，verbatim 规则在内）；scan_version 双模式手写扫描；catch 变状态码分支
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:330-340 | compareOpencodeVersion：split(".").map(parseInt) + Number.isFinite/NaN | 无 NaN 语义 | 原地分段游走 + parse_int_prefix（has=false 等价 NaN->0）
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:356-397 | findOpencodeV2Bin：qualifies 闭包捕获 env、candidates 数组 push 序列、Set 去重 | 无闭包/Set | v2_qualifies 普通函数（env 经全局 extern 读）；候选定长 64 列表按源顺序 push；线性去重
backends/opencode/src/runtime/opencodeCompatibleProbe.ts:30,365 | process.platform / process.env 全局 | 无对应 | intent extern sa_std_platform_is_win32 / sa_std_env_get

## backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:1-12 | Node 导入群（child_process/EventEmitter/net/crypto/fs/os/path）+ pluginHostServices + @codex-ui/shared | sa_std 无确认对应面 | 全部 intent extern（sa_host_spawn_*/sa_host_child_*/sa_net_try_bind/sa_uuid_random/sa_std_fs_*_mode/sa_std_os_tmpdir/sa_shared_resolve_model_context_window）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:14-80 | 接口中的可选字段、字面量联合 `apiVersion?: 1 | 2`、`Record<string, string>` envOverrides、ModelCapabilityDescriptor | 无可选/联合/动态对象 | has_* 标志 + u32 标签；envOverrides 与 capability 均 JSON 文本缓冲
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:95-175 | throw new Error 校验（buildOpencodeSharedRelayUrl/Provider）+ encodeURIComponent + 模板字面量 URL | 无异常/模板字面量 | i32 状态码（错误文本留在注释）；pm_buf_uri_component 近似 encodeURIComponent（逐字节 %XX 表）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:105,129 | 正则 `/opencode\.ai/i` 与 String.includes/toLowerCase 组合 | 无正则 | pm_contains_ci 大小写不敏感子串扫描
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:133-135 | `[...new Set(models.map(...).filter(Boolean))]` 展开/Set/map/filter 链 | 无对应 | 显式循环 + 线性去重
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:177-229 | inferOpencodeModelLimits 的 resolveModelContextWindow 外部依赖 + Math.round | shared 包无 SLA 面 | intent extern + u64 取整近似（已注释）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:231-310 | buildOpencodeConfigContent：对象展开 `{...a, ...b}` 拼装 + JSON.stringify + Record 模型表 | 无动态对象/stringify | 按源键序手工拼 JSON 文本；JSON 字符串转义仅处理引号/反斜杠，控制字符未 \u 转义（已注释）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:330-352 | 模板字面量插件源码常量 + mkdirSync/writeFileSync 的 mode 选项 | 无模板字面量/Node fs 选项 | 字面量文本（\n 实际换行）；mode 以八进制值直传 intent extern（0o700=448、0o600=384）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:359-405 | buildOpencodeIsolationEnv 返回 Record<string,string> + try/catch best-effort mkdir + 条件展开 `...(platform === "win32" ? { APPDATA } : {})` | 无动态 Record | PmEnvList 条目数组；catch 变忽略返回码
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:411-436 | isPortAvailable/findAvailableOpencodePort：async + net.Server 事件 Promise（once error/listening + close 回调） | 无 Promise/事件 | intent extern sa_net_try_bind 单次尝试；await 循环变同步循环，throw 变 found=false
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:438-460 | class extends EventEmitter + private 字段 + getter（isRunning/url/password/info/pid） | 无类继承/事件/getter | struct + 函数族；emit 变 pm_emit_* 空桩；once("exit") 变显式 pm_pool_handle_manager_exit
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:466-485 | killTreeSync：spawnSync("taskkill"...) + child.kill("SIGKILL") + try/catch | 无对应 | intent extern sa_host_taskkill_tree_sync / sa_host_child_kill
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:487-660 | async start()：ready Promise（stdout data 行匹配正则 /listening on (...)/、exit/error 处理器、setTimeout 拒绝）+ env 动态 Record 组装 + console.warn | 无 Promise/事件/定时器/正则/动态 env | 同步状态码；intent extern sa_host_child_wait_ready 泵送至就绪行/退出/错误/超时，stderr 排入 tail；监听行手写扫描解析；env 以 PmEnvList + envOverrides JSON 传 extern；OPENCODE_CONFIG_CONTENT 条目值受 PmEnvEntry 1024 上限截断（extern 在修复期单独接收全文，已注释）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:570-578 | child.stderr.on("data") 累积 stderrTail（maxStderrLines=100，shift 丢最旧） | 无事件流 | wait extern 排空时填充；PmStringList 容量 32（源 100）为近似
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:662-705 | async stop()：Promise + once exit/close + taskkill 子进程 + 3000ms SIGKILL 定时器 | 无 Promise/定时器 | intent extern sa_host_child_stop 执行同序列，同步返回
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:708-715 | stableStringify 递归处理 unknown（对象键排序/数组/标量） | 无动态值递归 | intent extern sa_json_canonical_stringify 对 JSON 文本操作
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:725-753 | fingerprint 中 `[...models].sort()` 拷贝排序 + 对象字面量组装 | 无对象字面量 | 插入排序拷贝 + 手工 JSON 组装后 canonical 化
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:755-767 | 模块级可变状态 Map pooledServers/pooledInflight + PooledOpencodeServer.idleTimer (setTimeout 句柄) | SLA 无模块全局/定时器 | PmPoolState 显式传递；idleTimer 变截止时间戳 + pm_pool_reap_expired 需宿主循环调用
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:769-777 | opencodeSharedPoolIdleMs 的 Number(rawText) 全串解析 | 无 Number() | 数字扫描近似（小数截断、负数回默认，与源 >= 0 规则结果一致路径已注释）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:793-862 | acquireSharedOpencodeServer：async IIFE starter + pooledInflight Promise 竞争/递归重试 + manager.once("exit") | 无 Promise/事件 | 同步直启；inflight 键集仅保留形状（同步世界不可观察，竞态分支不可达已注释）；exit 回调变显式调用；manager 身份以 self_id 代对象同一性
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:864-908 | releaseSharedOpencodeServer：非池实例 `void manager.stop()`（manager 对象按引用传入） | 经理身份以 id 表示后无法从 id 反查对象 | 该分支仅复现返回值 0，直接 stop 需调用方对 manager 本体执行（已注释）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts:910-992 | 测试钩子 + shutdown 钩子：process.once(SIGINT/SIGTERM)/process.on("exit") + Promise.finally 链 + 1500ms 强退定时器 + process.exit(130/143) | 无信号注册面/Promise | intent extern sa_host_install_shutdown_hooks；graceful 变顺序调用 + sa_std_process_exit，1500ms 宽限语义丢失（已注释）
backends/opencode/src/runtime/opencodeCompatibleProcessManager.ts: passim | async 函数群（start/stop/isPortAvailable/findAvailableOpencodePort/acquire/reset/shutdown） | 无 async | 全部同步 + 状态码/出参，逐处 DEFECT: async 已注
