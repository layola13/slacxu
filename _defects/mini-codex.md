# mini-codex 单元缺陷日志（组 A–E 合并）

## 组 A（mini-codex-A.md）

mini-codex/src/loop.ts:1-15 | node:crypto/node:fs/node:path 导入 (randomUUID, existsSync, readFileSync, writeFileSync, basename, dirname, join) | Node/Bun/宿主API 无 sa_std 直接对应 | sa_std fs/env extern + 字节缓冲手工拼路径近似
mini-codex/src/loop.ts:17 | MiniConfig 可选字段 effort?/maxTurns?/protocol? 与 MiniProtocol 字符串字面量联合类型 | 联合/可选/泛型类型 SLA 无对应 | has_* 标志 + protocol 用 u64 代码近似
mini-codex/src/loop.ts:18 | UltraToolExecutor 函数类型 (toolName, args, cwd) => Promise<string> | async/Promise/回调 SLA 无函数类型别名与 Promise | 执行器 id (u64) + 状态码与输出缓冲近似
mini-codex/src/loop.ts:22-24 | join(cwd, ".mini-codex-thread.jsonl") | Node/Bun/宿主API path.join 分隔符语义无对应 | 字节缓冲追加 "/" + 字面量近似
mini-codex/src/loop.ts:27-50 | existsSync/readFileSync + try/catch | 异常 try/catch/throw SLA 无异常处理 | fs 状态码返回，1 表示 TS 的 null 近似
mini-codex/src/loop.ts:32-46 | readFileSync().split(/\r?\n/) + JSON.parse + ThreadItem 联合收窄 (typeof item.type) | 动态JSON 逐行解析与联合收窄无对应 | 非空行原样存入序列化缓冲、按含 "\"type\"" 计数近似
mini-codex/src/loop.ts:65 | throw new Error(`fork: no transcript at ...`) | 异常 try/catch/throw SLA 无 throw | 返回状态码 2、输出留空近似
mini-codex/src/loop.ts:59-84 | items.forEach/slice/filter/map/join + writeFileSync | 高阶数组/Map/Set/闭包/展开 方法链无对应 | 序列化缓冲扫描计数 + fs 写入近似
mini-codex/src/loop.ts:86-99 | rest.split(/\s+/).filter(Boolean) + /^\d+$/ + parseInt + Math.max/min | RegExp SLA 无正则 | 手工空白/数字字节扫描 + 手工钳制近似
mini-codex/src/loop.ts:101-110 | ChildState: status 字面量联合、ThreadItem[]、string[]、promise: Promise<void>|null | async/Promise/回调 与联合/动态数组无对应 | status u64 代码 + 序列化缓冲 + has_promise 标志近似
mini-codex/src/loop.ts:118-125 | OUTPUT_CONTRACT 多段字符串拼接常量 | 模板/字符串拼接 SLA 字面量仅 (ptr,len) | 合并为单个字面量、拼接顺序保留近似
mini-codex/src/loop.ts:127-133 | process.env[key] ?? "" + Number() + Number.isFinite + Math.floor/min/max | Node/Bun/宿主API 无 process.env 对象 | sa_env_get 缓冲 + 手工十进制解析与钳制近似
mini-codex/src/loop.ts:135-145 | buildBaseSystem 模板字面量插值 mcpHint/skillListPrompt/agentsMd?.trim()/longMemory?.trim() | 模板/字符串拼接 无插值与可选链 | 按原顺序逐段缓冲追加近似
mini-codex/src/loop.ts:148-150 | `${saveFile}.chain.json` 模板字面量 | 模板/字符串拼接 无插值 | 字节复制 + 字面量后缀追加近似
mini-codex/src/loop.ts:153-163 | JSON.parse(...) as Record<string,unknown> + typeof 检查 + {...EMPTY_MINI_RESPONSES_CHAIN} 展开 + try/catch | 动态JSON 与对象展开无对应 | 字段级拷贝 EMPTY 链为兜底 + 字段提取近似
mini-codex/src/loop.ts:174-176 | loadThreadAuto 解构 {thread} = loadThreadAutoWithDropped(...) 对象返回 | 高阶数组/Map/Set/闭包/展开 类的对象解构无对应 | 独立 out 参数近似
mini-codex/src/loop.ts:186-206 | initial?: ThreadItem[]|undefined、[...initial] 展开、prev?.length 可选链、{thread, dropped} 返回 | 联合/可选/泛型类型 与展开无对应 | has_initial 标志 + 字段级缓冲拷贝 + out 参数近似
mini-codex/src/loop.ts:209-211 | items.slice(len-keep) / items.slice(0, len-keep) 动态数组切片 | 高阶数组/Map/Set/闭包/展开 slice 无对应 | 序列化缓冲计数算术近似（单项字节偏移未跟踪）
mini-codex/src/loop.ts:220-230 | thread.some(t => ...) 闭包、[plan, ...thread] 展开、dropped.filter((_, i) => ...) | 高阶数组/Map/Set/闭包/展开 无闭包/展开 | 显式正/反向扫描 + 原地缓冲移除近似
mini-codex/src/loop.ts:241-255 | 默认参数 maxItems、ThreadItem 对象字面量 {type:"user", text:`[omitted ${...}]`}、[...head, mid, ...tail] | 模板/字符串拼接 与对象字面量/展开无对应 | head=20/tail 计数算术 + 序列化 user 项近似
mini-codex/src/loop.ts:258-268 | async summarizeDroppedPrefix + await createTurn({...}) + cfg.protocol ?? "responses" | async/Promise/回调 SLA 无 async/await | 同步调用 + 状态码、protocol 由 has_protocol 标志近似
mini-codex/src/loop.ts:270-275 | buildMemoryItem 返回 ThreadItem 字面量、文本模板 `[memory] Earlier history (${droppedCount} items)...${summary}` | 模板/字符串拼接 无插值 | 序列化 user 项 + 计数十进制字节渲染近似
mini-codex/src/loop.ts:287-307 | async withCompactedMemory + await + try/catch 静默 fall-through | async/Promise/回调 与异常无对应 | 同步调用、非零状态码走 fallback digest 分支近似
mini-codex/src/loop.ts:297-301 | process.stderr.write(`[mini] compacted ${...}...`) 包在 try/catch 中 | Node/Bun/宿主API 无 process.stderr | println 等价输出/丢弃诊断近似
mini-codex/src/loop.ts:323-338 | estimateThreadChars 按 ThreadItem 联合分支收窄、args?/name? 可选、images? 数组迭代 | 联合/可选/泛型类型 联合收窄无对应 | 按序列化项 kind 代码扫描、图片长度随项存储近似
mini-codex/src/loop.ts:341-343 | /^\[memory\]/ 与 /^\[compacted\]/ 正则 test | RegExp SLA 无正则 | "[memory]"/"[compacted]" 字面量前缀字节比较近似
mini-codex/src/loop.ts:345-405 | ensureThreadBudget 默认参数 = numEnv(...)、thread.filter(isMemoryMarker)、[...markers, ...(pinnedPlan ? [pinnedPlan] : []), mid, ...repaired] 展开返回、process.stderr.write | 高阶数组/Map/Set/闭包/展开 默认参数求值/展开/过滤无对应 | has_max 标志 + 显式扫描 + 顺序缓冲组装近似
mini-codex/src/loop.ts:371-390 | ensureThreadBudget 内 itemLen 闭包捕获 used/maxChars 可变状态 | 高阶数组/Map/Set/闭包/展开 闭包捕获可变状态无对应 | 独立 itemLen_thread 辅助函数 + 引用传计数器近似
mini-codex/src/loop.ts:391-405 | 配对修复 Map<string,ThreadItem> callsById + Set<string> keptCallIds | 高阶数组/Map/Set/闭包/展开 无 Map/Set | callId 并行定长数组 + 线性查找近似
mini-codex/src/loop.ts:415-419 | needsActionNudge 三处正则（含中文动词、英文词干、反引号代码段、文件扩展名的动作模式与 /^\s*\/(status|compact|...)/ 排除） | RegExp SLA 无正则 | 字面量前缀检查 + 各动词子串扫描近似（词边界/ alternation 不等价）
mini-codex/src/loop.ts:421-426 | buildActionNudge ThreadItem 字面量、模板文本嵌入 promptText.slice(0, 200) | 模板/字符串拼接 无插值/slice | 固定措辞 + prompt 前 200 字节序列化近似
mini-codex/src/loop.ts:435-438 | shouldWrapUp 中 lastText.trim() | 模板/字符串拼接 类的 Unicode trim 语义无对应 | 仅 ASCII 空白长度检查近似
mini-codex/src/loop.ts:440-447 | normEcho .toLowerCase().replace(/^[...]+/, "").replace(/[...]$/, "").replace(/\s+/g, " ").trim() 正则链 | RegExp SLA 无正则替换链/Unicode 小写 | ASCII 字节扫描剥离同字符集 + 折叠 ASCII 空白近似
mini-codex/src/loop.ts:455-471 | isEchoOfPrompt 正则剥离 /command 与 [skill:...]、Set<string> 词集、split(" ")、Jaccard inter/union >= 0.85 | 高阶数组/Map/Set/闭包/展开 无 Set | 前缀扫描 + 定长词缓冲数组线性成员检查近似
mini-codex/src/loop.ts:474-484 | async summarizeThread + await createTurn({tools: [], thread: ensureThreadBudget(sanitizeThread(thread)), ...}) | async/Promise/回调 无 async/await 与对象字面量参数 | 同步调用 + 状态码近似
mini-codex/src/loop.ts:490-584 | async runChildLoop + await loadMcpTools().catch(() => []) | async/Promise/回调 无 async 与 Promise.catch 兜底 | 同步执行、非零状态替代 [] 兜底近似
mini-codex/src/loop.ts:496-510 | childTools = [...TOOLS, ...mcpTools] 展开、childChain = {...EMPTY_MINI_RESPONSES_CHAIN}、await createChainedTurn({...}, toResponsesInput(...), childChain)/createTurn({...}) | 高阶数组/Map/Set/闭包/展开 展开与对象字面量无对应 | 定长工具缓冲 + 链字段级拷贝 + 同步调用近似
mini-codex/src/loop.ts:524-577 | 子循环逐调用分发：JSON.parse(c.args) as Record、skills.find(闭包)、...(viewed.images ? {images} : {}) 条件展开、runToolWithHooks 的 execNonMcp 回调对象、嵌套 try/catch 生成 `tool error: ${e instanceof Error ? ...}` | 动态JSON 与回调/异常无对应 | 序列化 args 缓冲 + 线性 skill 扫描 + 直接执行器调用 + 状态码错误文本近似
mini-codex/src/loop.ts:579-583 | child.pending.splice(0, len) 排空共享可变 ChildState、status/report 原地变更对 handleSubagent/wait_agent 可见、外层 for(;;) 重入 | 并发/共享可变状态 SLA 无共享可变对象语义 | 原地排空 pending 缓冲 + &ChildState 字段变更近似
mini-codex/src/loop.ts:587-589 | sleep(ms) = new Promise(resolve => setTimeout(resolve, ms)) | async/Promise/回调 无 Promise/setTimeout | 同步状态桩近似（无真实定时器，轮询语义仅结构保留）
mini-codex/src/loop.ts:592-597 | async runImageViewCall、返回类型 Pick<Extract<ThreadItem, {type:"function_call_output"}>, "output"|"images">、await viewLocalImage | 联合/可选/泛型类型 Pick/Extract 泛型与联合无对应 | 输出缓冲 + images 缓冲 + has_images 标志、同步近似
mini-codex/src/loop.ts:599-613 | coerceSpawnMessage 遍历 Record 动态键、Array.isArray、typeof 收窄、内嵌 pick(list, keys) 闭包、[...pick(todos), ...pick(steps)]、parts.map((part, idx) => `${idx+1}. ${part}`).join("\n") | 动态JSON Record<string,any> 动态键无对应 | 序列化 args 键扫描 + 顺序编号行追加近似
mini-codex/src/loop.ts:615-707 | handleSubagent async + Map<string,ChildState> get/set/delete、[...children.values()].filter/find | 高阶数组/Map/Set/闭包/展开 无 Map 与展开/过滤/查找 | 序列化 Children 缓冲 + id/taskName 线性扫描近似
mini-codex/src/loop.ts:624-633 | parseTaskName(...) ?? `task_${Math.random().toString(16).slice(2,10)}`、String(...).slice(0,120)、randomUUID() 子 id | Node/Bun/宿主API Math.random/crypto UUID 无对应 | 计数器派生 id 缓冲 + 截断字节拷贝近似（id 非随机/非 UUID 形）
mini-codex/src/loop.ts:640-648 | child.promise = runChildLoop(...).then(async () => {SubagentStop}, async (e) => {failed/report; SubagentStop}) + try/await fireLifecycleHook("SubagentStart") catch {} | async/Promise/回调 Promise.then 双回调与并发子执行无对应 | spawn 顺序同步运行子循环、Stop 钩子内联调用近似（并发语义改变）
mini-codex/src/loop.ts:668-687 | wait_agent：targets 归一化 (Array.isArray/typeof 三元)、timeout Math.min/max/floor 钳制、Date.now() deadline、for(;;) + await sleep(150) 轮询、ids.map 快照 + snapshot.every | Node/Bun/宿主API 时间/轮询与数组方法无对应 | 定长 target 缓冲 + 手工钳制 + 单次同步快照近似（无真实 deadline/轮询）
mini-codex/src/loop.ts:689-707 | close_agent/list_agents：children.delete、report.slice(0,2000)、[...children.values()].map(c => ({...})) + JSON.stringify 动态对象 | 动态JSON JSON.stringify 动态对象无对应 | 原地缓冲移除 + 截断拷贝 + 同键序手工 JSON 序列化近似
mini-codex/src/loop.ts:709-760 | async runPrompt + opts? 可选对象 + await scanSkills / await loadMcpTools().catch(() => []) | async/Promise/回调 无 async/可选参数对象 | 同步执行 + has_* 标志 + 状态码兜底空 MCP 列表近似
mini-codex/src/loop.ts:745-775 | 斜杠命令分发正则 /^\s*\/review\b([\s\S]*)$/、/status、/compact、/fork + system/thread 模板字面量改写 | RegExp SLA 无正则 exec | "/review"//"/goal" 等字面量前缀扫描 + 顺序缓冲追加近似
mini-codex/src/loop.ts:776-777 | children = new Map<string,ChildState>()、sessionId = randomUUID()、turnId = `${Date.now()}` | Node/Bun/宿主API Map/UUID/时间戳字符串无对应 | Children 缓冲 + 计数器派生 id 字节近似
mini-codex/src/loop.ts:782-797 | extraCtx.push(...await fireLifecycleHook("SessionStart"/"UserPromptSubmit", {...}))、extraCtx.map(c => String(c).slice(0,2000)).join("\n---\n").slice(0,6000) 模板项 | 高阶数组/Map/Set/闭包/展开 await 钩子数组与展开 push/map/join 无对应 | 顺序追加并按 2000/6000 同限截断近似
mini-codex/src/loop.ts:798-830 | /compact 与 finally 持久化：await Bun.write(saveFile, compacted.map(t => JSON.stringify(t)).join("\n"))、Bun.write(chainFile, JSON.stringify({...EMPTY...}))、try/finally 中 Stop/SessionEnd 钩子与 chain 保存 | Node/Bun/宿主API Bun 运行时与 finally 无对应 | 序列化缓冲经 sa_std fs 写入、finally 展平到各 return 点直线代码近似
mini-codex/src/loop.ts:855-934 | 主 try 体：await runGoalMode({对象字面量参数包})/await runAgentLoop({...})、nudge 第二段 runAgentLoop({..., startTurn: r.turnsUsed, chain}) try/catch、summarizeThread -> digestToolOutputs 兜底链、解构 g.chain/g.answer/r.* | async/Promise/回调 异步组合与对象字面量参数无对应 | 扁平参数列表 + 同步同序调用、结果用 out 参数近似
mini-codex/src/loop.ts:944-959 | digestToolOutputs：new Map<string,string>、逆序遍历、output.replace(/\s+/g, " ").trim().slice(0,300)、lines.reverse()、模板拼 `Actions taken (tool evidence):\n${lines.join("\n")}` | 高阶数组/Map/Set/闭包/展开 无 Map | callId/name 并行缓冲 + 逆序收集正序输出 + ASCII 空白折叠近似
mini-codex/src/loop.ts:962-977 | AgentLoopArgs/AgentLoopResult 接口含 cfg/thread/ToolDef[]/Map children/UltraToolExecutor 函数/SkillEntry[] 引用与可选 startTurn?/chain? | 联合/可选/泛型类型 接口引用/函数值/Map 无对应 | ptr 句柄 + 序列化缓冲 + has_* 标志的 struct 近似
mini-codex/src/loop.ts:979-1022 | async runAgentLoop：turnBase 对象字面量逐轮重建、chained ? await createChainedTurn(...) : await createTurn(...)、a.thread.push(...r.items)、sanitizeThread/ensureThreadBudget 原地改写 thread (length=0 + push) | async/Promise/回调 无 async/对象字面量 | 扁平字段同步调用 + thread_ptr 后序列化缓冲原地改写近似
mini-codex/src/loop.ts:992-1015 | runAgentLoop 逐调用：JSON.parse(c.args || "{}")、...(viewed.images ? {images} : {}) 条件展开、skills.find 闭包、list_mcp_resources 的 slice(0,100).map(嵌套模板).join("\n") 与长兜底文案 | 动态JSON 与条件展开/嵌套模板无对应 | 序列化 args + 线性查找 + 同形态顺序格式化追加近似
mini-codex/src/loop.ts:1016-1021 | else 分支 runToolWithHooks(..., {execNonMcp: (n, ax, w) => a.exec(n, ax, w)}) 回调对象 + autoRemember + 双层 try/catch `tool error: ${e instanceof Error ? e.message : String(e)}` | async/Promise/回调 类的回调对象/instanceof/异常无对应 | 直接执行器调用 + 内联 autoRemember + 状态派生错误文本近似
mini-codex/src/loop.ts:1027-1031 | parseGoalArgs：/^\s*\/goal\b([\s\S]*)$/.exec(prompt) 返回 match|null、(m[1] ?? "").trim() | RegExp SLA 无正则 exec 与可空返回 | "/goal" 词界前缀扫描 + out_is_goal 标志 + ASCII trim 近似
mini-codex/src/loop.ts:1033-1041 | isGoalDone/isGoalBlocked：text.trimEnd().split(/\r?\n/).at(-1) ?? "" + /^\s*GOAL_DONE\s*$/ | RegExp split/at(-1)/正则无对应 | 逆向扫描末行 + trim 后与标记字面量比较近似
mini-codex/src/loop.ts:1045-1052 | hasGoalToolEvidence：new Set<string>() calls、thread.slice(Math.max(0, startIndex)) | 高阶数组/Map/Set/闭包/展开 无 Set/slice | callId 定长缓冲数组 + 线性成员检查、从 startIndex 扫描近似
mini-codex/src/loop.ts:1055-1057 | cleanGoalMarker：split(/\r?\n/).filter(l => !/^\s*GOAL_(DONE|BLOCKED)\s*$/.test(l)).join("\n").trim() | RegExp 正则与 filter 闭包无对应 | 逐行扫描复制非标记行 + ASCII trim 近似
mini-codex/src/loop.ts:1065-1073 | goalSystemSuffix：`[goal mode] Objective: ${objective}\n` + 七条规则字面量拼接 | 模板/字符串拼接 无插值 | objective 字节插入固定前缀与规则字面量之间近似
mini-codex/src/loop.ts:1075-1081 | GoalModeArgs 接口：同 AgentLoopArgs 的 Map/函数/引用字段 + objective + 可选 chain? | 联合/可选/泛型类型 接口引用无对应 | ptr 句柄 + objective 缓冲 + has_chain 标志 struct 近似
mini-codex/src/loop.ts:1083-1139 | async runGoalMode：for(;;) 分段循环 await runAgentLoop({...}) 与 summarizeThread、解构返回 {answer, chain} | async/Promise/回调 无 async/await | while true 同步循环 + GoalModeArgs/GoalModeResult 扁平 struct 近似
mini-codex/src/loop.ts:1088-1130 | runGoalMode 内模板字面量：answer += `\n\n[goal] turn budget exhausted (${budget})...`、thread.push 的 `[goal] The terminal reply...Objective: ${a.objective}\n...` 与 `[goal] You stopped without...`（含 hasGoalToolEvidence 三元后缀） | 模板/字符串拼接 无插值 | budget/objective 字节插入固定措辞缓冲近似

## 组 B（mini-codex-B.md）

# 缺陷日志 — 单元 mini-codex-B（mcp.ts / mcpHooks.ts）

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`

## mini-codex/src/mcp.ts

mini-codex/src/mcp.ts:6-11 | Node 内置模块 import（child_process/fs/promises/os/path/crypto） | Node API 无 sa_std 对应 | extern 占位名 + 行内 DEFECT
mini-codex/src/mcp.ts:13-15 | 字符串模块常量 MCP_TOOL_PREFIX / DELIM | SLA 无字符串类型常量 | 字面量经 STR_PTR 在各使用点内联
mini-codex/src/mcp.ts:17-20 | interface McpToolEntry extends ToolDef | 无接口继承 | ToolDef 字段平铺进 struct
mini-codex/src/mcp.ts:22-37 | ServerCfg 可选字段 + Record<string,string> 字段 | 无 optional/undefined、无动态对象 | has_* 标志 + 定长缓冲；Record/数组字段存 JSON 文本
mini-codex/src/mcp.ts:38-45 | process.env 读取（envOff/mcpEnabled） | 无 process.env | sa_env_get extern + 手工 trim/小写
mini-codex/src/mcp.ts:47-53 | numEnv: Number(t) / Number.isFinite / Math.min/max/floor | 字符串→数解析（含浮点/指数）无 sa_std 对应 | 无符号整数扫描近似
mini-codex/src/mcp.ts:55 | 模块级可变状态 let workspaceRoots | SLA 无模块级可变全局 | McpGlobals struct 以 &McpGlobals 穿线
mini-codex/src/mcp.ts:58-69 | setMcpWorkspaceRoots: Set 去重 + filter/map 类型谓词闭包 (r): r is string | 无 Set、无闭包/类型谓词 | JSON 数组顺序扫描 + 线性查重，上限 8
mini-codex/src/mcp.ts:71-77 | workspaceRootEntries: 模板串 `file://${r}` + split(/[\\/]/) 正则 + 可选 name 字段 | 无模板串/正则 split/动态对象 | 手工扫描最后分隔符取 leaf + JSON 文本拼装
mini-codex/src/mcp.ts:79-83 | expandHome: homedir() / path.join() | Node os/path 无 sa_std 对应 | extern 占位 + '/' 拼接（无 Windows 分隔符归一化）
mini-codex/src/mcp.ts:85-87 | expandVars: String.replace(正则, 回调) | 无正则替换/回调函数 | 手工扫描 $NAME 与 ${NAME}
mini-codex/src/mcp.ts:89-93 | sanitizeMcpPart: for..of 码点迭代 + /[0-9A-Za-z_]/.test(ch) | 无 Unicode 码点迭代/正则 | 逐字节近似（非 ASCII 每字节变一个 _，与码点语义有差）
mini-codex/src/mcp.ts:95-97 | shortHash: createHash("sha1").digest("hex") | sa_std 无 sha1（net.sai 仅 sha256 注记） | extern 占位 sa_crypto_sha1_hex
mini-codex/src/mcp.ts:99-104 | qualifiedMcpName: 模板串 + base.slice 截断 | 不可变字符串切片语义无对应 | 定长缓冲拼装 + 显式长度截断
mini-codex/src/mcp.ts:110-154 | parseValue: 返回 unknown + 递归 + JSON.parse + 正则判定数字/引号 | 无 unknown/动态值类型 | 值一律 JSON 文本缓冲；递归保留；try/catch 用 extern 状态码代替
mini-codex/src/mcp.ts:156-200 | parseSubset: 嵌套 Record<string,Record<string,unknown>> + ??= + split(/\r?\n/) 与正则剥注释 + commit 闭包捕获可变状态 | 动态对象/闭包/正则 | JSON 文本 + sa_json_subset_commit extern；commit 内联到两处调用点；逐行字节扫描
mini-codex/src/mcp.ts:202-216 | strMap/strArr: Object.entries 遍历 + filter 类型谓词闭包 | 动态对象遍历/闭包 | sa_json_* extern 顺序扫描
mini-codex/src/mcp.ts:218-254 | toCfg: typeof 收窄 + ?? 回退链 + 对象展开 {...a, ...b} + console.warn 模板串 | 无展开/可选链等价物、无 console | 逐字段 extern 探测（源顺序）；展开→顺序 JSON 合并；warn→静态 println
mini-codex/src/mcp.ts:256-263 | resolveEnvHeaders: Object.entries 遍历 Record | 动态对象 | sa_json_* extern 扫描 + env_get_buf
mini-codex/src/mcp.ts:265-286 | loadServers: async/await + fs/promises readFile + try/catch | async/异常无对应 | 同步函数；fs extern 状态码充当 catch
mini-codex/src/mcp.ts:288-296 | withTimeout<T>: Promise.race + setTimeout/clearTimeout + .finally + 泛型 | Promise/定时器/泛型全无对应 | 不设函数体；超时折叠进 send/doRpc 各自的 timeout 参数
mini-codex/src/mcp.ts:298-318 | resultToText: 动态 content 数组遍历 + JSON.stringify + try/catch | 动态 JSON | sa_json_* extern；structuredContent 的 JSON 文本直用为 stringify 结果
mini-codex/src/mcp.ts:320-331 | McpCallResult.response + 索引访问类型 McpCallResult["response"] + ?? null | 动态对象/索引类型 | response 存 JSON 文本缓冲
mini-codex/src/mcp.ts:333-336 | RawTool/RawResource/McpResourceContent/McpResource 纯类型 + 可选字段 | 无 optional | has_* 标志 struct + 定长数组列表 struct
mini-codex/src/mcp.ts:338-343 | class StdioConn + private 字段 | 无类/私有字段 | struct + 以 &StdioConn 为首参的函数族
mini-codex/src/mcp.ts:341 | pending = Map<number|string, {resolve, reject}> 存 Promise 执行器 | 闭包存入 Map 无对应 | JSON id 集合 + last_* 结果槽，由 send 阻塞泵消费
mini-codex/src/mcp.ts:345-357 | constructor 参数属性 (private cfg) + spawn 选项对象 + {...process.env} 环境展开 | 无参数属性/选项对象/环境枚举 | spawn extern 占位；子进程继承父环境 + cfg.env 覆盖（JSON 文本）
mini-codex/src/mcp.ts:347-356 | ChildProcess 事件订阅 stdout.on("data") / .on("error") / .on("exit") | 无 EventEmitter/流事件 | StdioConn_send 内阻塞读泵替代事件回调
mini-codex/src/mcp.ts:359-397 | onData: JSON.parse try/catch + 服务器发起请求（roots/list、ping）应答 + stdin.write 模板串 | 动态 JSON/异常 | sa_json_* 状态判断；应答 JSON 缓冲拼装后写 stdin extern
mini-codex/src/mcp.ts:399-402 | failAll: 遍历 pending Map 逐个 reject(e) | Promise reject 无对应 | 错误锁存到 fail_err 字段，阻塞泵观察
mini-codex/src/mcp.ts:404-420 | send<T>: new Promise((resolve, reject) => …) 执行器闭包 + 泛型 + withTimeout().finally(删 pending) | Promise/闭包/泛型 | 同步阻塞泵；pending 删除折叠到每个出口路径
mini-codex/src/mcp.ts:422-470 | StdioConn async 方法群 init/list/listResources/readResource/call/callDetailed（含默认参数 timeoutMs = cfg.toolTimeoutMs） | async | 同步 + i32 状态码 + 出参；默认参数由调用方显式传 cfg 值
mini-codex/src/mcp.ts:472-476 | class HttpConn + private sessionId: string | null | 无类/可空类型 | struct + has_session_id 标志
mini-codex/src/mcp.ts:478-486 | headers(): Record<string,string> 动态拼装 + process.env 取 bearer token | 动态对象/env | JSON 文本拼装 + sa_env_get
mini-codex/src/mcp.ts:488-504 | rpc<T>: async + /HTTP 404/.test(e.message) 会话过期重试 + 泛型 | async/正则/泛型 | 同步；正则→子串匹配；重试逻辑 1:1 保留
mini-codex/src/mcp.ts:506-557 | doRpc: fetch + AbortController + setTimeout abort + Headers/Response.text() + SSE data: 行扫描 + try/catch/finally | 无通用 fetch 对应（sa_std HTTP 客户端是 SSE turn 专用 API） | 单次 POST extern 占位 sa_http_post_json（带 timeout）；AbortError 改名折叠为其超时状态
mini-codex/src/mcp.ts:559-582 | HttpConn.init: 通知 POST 的嵌套 try/finally + AbortController 定时器 | 定时器/异常 | extern 占位 + 结果一律忽略（与源 best-effort 一致）
mini-codex/src/mcp.ts:584-612 | HttpConn async 方法群 list/listResources/readResource/call/callDetailed | async | 同步 + 状态码 + 出参
mini-codex/src/mcp.ts:614-617 | 模块级 Map route/serverConns + let cachedTools/cachedAt + Map 值联合类型 StdioConn | HttpConn | 无 Map/联合类型/模块状态 | McpGlobals 内 JSON 表 + kind/idx 分发函数族 Conn_*
mini-codex/src/mcp.ts:619-624 | allows: Array.includes(enabledTools/disabledTools) | 字符串数组成员判定无直接对应 | sa_json_array_contains_string extern
mini-codex/src/mcp.ts:626-709 | loadMcpTools: async + 多层 try/catch + Map counts + Set used + staged.find 身份闭包 + [...nextRoute.values()].includes 身份比较 + Date.now 缓存 | async/异常/Map/Set/闭包/Date 全无对应 | 同步；counts 改二次扫描；used/route 用 JSON 文本集合；旧连接按构造恒为新槽位全部关闭；连接槽只追加不回收（16+16 上限）
mini-codex/src/mcp.ts:711-734 | runMcpTool / runMcpToolDetailed: async + args ?? {} | async | 同步；错误按源 catch 路径转成文本结果
mini-codex/src/mcp.ts:736-749 | callMcpByServerRaw: async + Date.now() deadline + 嵌套 withTimeout | async/时间 | 同步；deadline 折叠为单个 remaining-ms 传入 callDetailed
mini-codex/src/mcp.ts:751-758 | mcpStatusLine: Map 计数 + [...byServer].map(...).join(", ") 模板拼装 | Map/展开迭代/模板串 | 线性扫描逐 server 计数 + 缓冲拼装
mini-codex/src/mcp.ts:760-772 | resourceContentsToText: 嵌套模板串 + Math.floor(blob.len*3/4) | 模板串 | 缓冲拼装；整数除法等价 floor
mini-codex/src/mcp.ts:774-783 | serverConn: [...serverConns].find(([k]) => …) 展开+闭包 + toLowerCase 比较 | 可迭代展开/闭包/Unicode 大小写折叠 | 顺序键扫描 + ASCII 大小写不敏感比较近似
mini-codex/src/mcp.ts:785-819 | listMcpResources: async + Set<string> names + 可选参数 server?: string + withTimeout(15s) + 条件展开属性 ...(cond ? {mimeType} : {}) | async/Set/optional/展开 | 同步；JSON 数组充当 Set；has_server 标志；withTimeout 折叠进 listResources 自身超时
mini-codex/src/mcp.ts:821-836 | readMcpResource: async + try/catch 转错误文本 + withTimeout(60s) | async/异常 | 同步；状态路径生成同样的错误文本
mini-codex/src/mcp.ts:全文 | String 方法集 trim/toLowerCase/startsWith/includes/indexOf/slice/split/join 在各函数内反复使用 | sa_std 无完整对应 | 逐字节 helper（str_eq/starts_with/contains_sub 等）手工实现

## mini-codex/src/mcpHooks.ts

mini-codex/src/mcpHooks.ts:4 | randomUUID（node:crypto） | 无 sa_std 对应 | extern 占位 sa_random_uuid
mini-codex/src/mcpHooks.ts:12 | HookedToolRunner 函数类型 (toolName, args, callId) => Promise<string> | 无函数类型/Promise | 不透明 u64 句柄 + 分发 extern sa_hook_exec_non_mcp；async 折叠为同步
mini-codex/src/mcpHooks.ts:14-22 | HookPipelineOpts: 可选字段 sessionId?/turnId? + sink?: HookEventSink | null 三态 + execNonMcp 回调字段 | 无 optional/三态 null/回调字段 | has_* 标志 + sink_kind（0 undefined/1 null/2 句柄）+ 句柄
mini-codex/src/mcpHooks.ts:24 | 模块级 let warnedNoSink | 无模块级可变状态 | HookGlobals struct 穿线
mini-codex/src/mcpHooks.ts:26-36 | resolveSink: process.env.MINI_HOOKS_LOG + defaultHookSink() 工厂 | env 无对应 | sa_env_get + hooks.sla 的 defaultHookSink
mini-codex/src/mcpHooks.ts:38-45 | runToolWithHooks: async + loadHookEvents(...).catch(() => ({})) | async/Promise catch | 同步；加载失败时 events 保持 "{}"（与源 catch 回退一致）
mini-codex/src/mcpHooks.ts:47-57 | hookCtxBase 对象字面量 + callMcpRaw 箭头闭包 (server, tool, input, timeoutMs) => callMcpByServerRaw(...) | 对象字面量/闭包不可存 | HookCtx struct + use_call_mcp_raw 标志；hooks.sla 回调 mcp.sla 的 callMcpByServerRaw
mini-codex/src/mcpHooks.ts:46,134 | sessionId/turnId 默认链 ?? process.env.MINI_SESSION_ID ?? randomUUID() 与 `${Date.now()}` | env/UUID/时间无对应 | extern 占位链 sa_env_get / sa_random_uuid / sa_time_now_ms + 十进制 extern
mini-codex/src/mcpHooks.ts:60-79 | PreToolUse 段: try/catch + process.stderr.write 模板串 | 异常/stderr 无 SLA 对应 | executeHooks 状态码充当 catch；stderr→静态 println（消息体丢失）
mini-codex/src/mcpHooks.ts:83-100 | 执行段: try/catch + response 动态对象拼装 + String(text).slice(0, 8000) | 动态 JSON/异常 | response 存 JSON 文本；状态路径生成 "tool error: …" 文本；内嵌 text 的 JSON 转义留待修复期（本轮逐字拷贝）
mini-codex/src/mcpHooks.ts:102-115 | PostToolUse 段: 对象展开 { ...hookCtxBase, toolInput, toolResponse } + extras.map(...).join("\n---\n") + slice 截断 | 无对象展开/高阶函数 | ctx 复制后覆写两字段；扫描拼装（每条 2000、总 6000 上限保留）
mini-codex/src/mcpHooks.ts:117-123 | shouldRememberToolResult: 正则字面量 /tool error:|Blocked by .* hook/i 与 hint 正则（含中文、/i 标志） | 无正则引擎 | 子串扫描表逐个 alternative 匹配；/i 以小写副本复扫近似；.* 以两子串共现近似
mini-codex/src/mcpHooks.ts:125-130 | LifecycleHookOpts & { prompt?: string; toolName?: string } 交叉类型 | 无交叉类型 | 字段合并进同一 struct + has_prompt/has_tool_name 参数
mini-codex/src/mcpHooks.ts:132-157 | fireLifecycleHook: async + events[eventName] 动态键访问 + 可选链 groups?.length + callMcpRaw ?? 默认箭头函数 | async/动态键/可选链/闭包 | 同步；JSON 键探测非空数组；默认回调以标志表示，调用方覆盖不可存
mini-codex/src/mcpHooks.ts:159-164 | autoRemember: try { … } catch { /* 吞掉 */ } | 异常无对应 | 忽略 appendMiniMemory 状态码（与源吞异常一致）

## 组 C（mini-codex-C.md）

# mini-codex 组 C 缺陷日志（hooks.ts / tools.ts）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

类别口径：A=动态对象/unknown/Record；B=async/Promise/回调/闭包/函数类型；C=Node API 无 sa_std 对应；D=RegExp；E=联合/可选/nullable/断言等类型系统；F=异常 try/catch/throw；G=字符串方法/模板字面量/展开语法；I=容器/集合/高阶方法/模块全局状态。

## mini-codex/src/tools.ts

mini-codex/src/tools.ts:1-2 | import type { ToolDef } + import { IMAGE_VIEW_TOOL } 常量对象 | SLA @import 不能导入数据常量，`as ToolDef` 断言无对应（C） | @import ./types.sla 与 ./imageView.sla，IMAGE_VIEW_TOOL 经 image_view_tool_* 转发函数取用
mini-codex/src/tools.ts:4-62 | ToolDef[] 对象字面量数组，schema 为 Record<string, unknown> 嵌套对象 | SLA 无对象字面量与动态记录（A） | per-index 访问器 TOOLS_name_at/description_at/schema_at，schema 存为逐字 JSON 文本缓冲
mini-codex/src/tools.ts:41-49 | update_plan schema 内嵌 items:{type:"object",properties:{...}} | 嵌套动态对象无 struct 等价（A） | 保留在 schema JSON 文本内，待修复阶段由 JSON 层解释
mini-codex/src/tools.ts:50 | IMAGE_VIEW_TOOL as ToolDef 类型断言 | SLA 无类型断言（E） | 直接转发 imageView 单元的访问器，断言丢弃
mini-codex/src/tools.ts:64-95 | SUBAGENT_TOOLS 常量数组（ToolDef[]） | SLA 无一等结构体数组常量（I） | per-index 访问器 SUBAGENT_TOOLS_name_at/description_at/schema_at
mini-codex/src/tools.ts:97 | new Set(SUBAGENT_TOOLS.map((t) => t.name)) | 无 Set、无 Array.map 箭头闭包（I） | SUBAGENT_NAMES_has 对 6 个名字线性扫描 bytes_eq
mini-codex/src/tools.ts:100 | new Set(["send_input", "followup_task"]) | 无 Set 字面量（I） | SEND_MESSAGE_ALIASES_has 两次字面量比较
mini-codex/src/tools.ts:106-109 | [...TOOLS, ...SUBAGENT_TOOLS] 数组展开 + 返回新数组 | 无展开语法与堆数组身份（G） | toolsForDepth 写 (kind,index) 对列表并返回计数，depth>0 只含 TOOLS
mini-codex/src/tools.ts:106 | (depth | 0) 位或截断 float64→int32 | SLA 无 JS 数值语义（E） | depth 直接以 i32 传入比较（0.5→0 的截断差异丢失）
mini-codex/src/tools.ts:111-117 | parseTaskName(v: unknown) + typeof 运行时检查 | unknown 无 SLA 类型（A） | v 作 JSON node handle，sa_json_kind_of 判 kind==string
mini-codex/src/tools.ts:111-117 | /^[a-z0-9_]+$/ 正则 + trim + string|null 返回 | sa_std 无正则；nullable 返回无对应（D/E） | 字节循环校验字符类与长度 1..64，返回长度 0 表示 null

## mini-codex/src/hooks.ts

mini-codex/src/hooks.ts:18-22 | node:crypto/child_process/fs/promises/os/path 导入 | Node API 在 sa_std 无 1:1 对应（C） | sa_std env/fs/process/json extern + (ptr,len) 路径缓冲
mini-codex/src/hooks.ts:24-37 | HookEventName/HookHandlerType/HookRunStatus/HookSource 字符串字面量联合 | SLA 无字面量联合类型（E） | u64 枚举码 + HOOK_EVENT_NAMES_at/hook_handler_type_name/hook_run_status_name/hook_source_name 回取文本
mini-codex/src/hooks.ts:41-56 | HookRunSummary 的 string|null、number|null 字段与 entries: HookOutputEntry[] | nullable 与可变长数组无对应（E） | has_* 标志 + entries 定长 [HookOutputEntry; 32] + len
mini-codex/src/hooks.ts:58-60 | HookEvent 判别联合 {type:"hook_started"|"hook_completed"} | 无判别联合（E） | tagged struct HookEvent{type_code, started, completed}，非活动臂为填充
mini-codex/src/hooks.ts:61 | HookEventSink = (e: HookEvent) => void 函数类型 | SLA 无一等函数值（B） | sink 以 u64 id 表示，hook_sink_dispatch 按 id 分发，0/无 sink 以 has_sink 表示
mini-codex/src/hooks.ts:63-68 | HookHandlerConfig 四臂判别联合 + 可选字段 commandWindows?/timeout?/statusMessage? | 联合与可选字段无对应（E） | 扁平 tagged struct + has_* 标志，type_code 复用 HookHandlerType 码
mini-codex/src/hooks.ts:69-70 | MatcherGroup.hooks 数组 + HookEvents = Partial<Record<HookEventName, MatcherGroup[]>> | 动态键记录无对应（A） | HookEvents struct 每事件一个定长 [MatcherGroup; 32] + len，len==0 表示键缺失
mini-codex/src/hooks.ts:74-80 | HookCache 嵌套对象数组 + 模块级 let cache: HookCache | null | 无模块可变全局与 null（I） | HookModuleState{cache, has_cache} 由调用方持有并逐函数传递
mini-codex/src/hooks.ts:82-86 | codexHome: process.env.CODEX_HOME、homedir()、path join()、trim/startsWith/slice | Node API 与字符串方法无对应（C） | sa_env_get/sa_env_home + 字节扫描 trim 与手工路径拼接（join 的 ./.. 归一化丢失）
mini-codex/src/hooks.ts:88-115 | normalizeEvents(raw: unknown)：typeof/Array.isArray 派发、Record 强制转换、body[name] 动态键、{...(cond?{matcher}:{})} 条件展开 | unknown 与动态记录无对应（A） | raw 作 JSON node handle，sa_json_* 按 kind 派发、逐名查键，展开以 has_matcher 条件赋值近似
mini-codex/src/hooks.ts:117-147 | normalizeHandler(h: unknown) + 条件展开字段 + String(r.command_windows) 强制转换 | unknown 派发与任意值 String() 强制无对应（A） | JSON kind 派发 + has_* 标志；command_windows 仅接受字符串，非字符串的 String() 结果丢失
mini-codex/src/hooks.ts:149-155 | containsNull 递归 + v.some(containsNull) 回调 + Object.values | 高阶方法与函数引用传参无对应（I） | 对 JSON node kind 显式递归，.some 内联为循环
mini-codex/src/hooks.ts:157-163 | canonicalEventName: replace(/[_\-\s]/g,"") + toLowerCase 链 | sa_std 无正则与字符串管线（D） | 字节循环：小写化并剔除 _/-/空白后与 12 个规范名逐一比较
mini-codex/src/hooks.ts:165-205 | parseTomlScalar(text): unknown 递归返回（bool/string/number/array/object） | unknown 返回类型无对应（A） | 统一返回 JSON node handle
mini-codex/src/hooks.ts:165-205 | /^-?\d+$/、/^-?\d*\.\d+$/ 数字正则 + JSON.parse 再转义技巧的 try/catch | 无正则；异常回退路径（D） | toml_is_int/toml_is_float 字节扫描；sa_json_parse_quoted_inner 失败时取原始内文（对应 catch 分支）
mini-codex/src/hooks.ts:180-196 | 数组标量切分的状态机（inner[i]、inner[i-1] 索引访问、quote/depth 变量） | JS 字符串索引与闭包状态无直接对应（G） | (ptr,len) 字节循环复刻同一状态机，含前一字符反斜杠判断
mini-codex/src/hooks.ts:207-227 | ensurePath 对 Record<string, unknown> 的动态键树变异 + path[i]! 非空断言 | 动态记录变异无对应（A） | JSON object node 的 get/set_node 变异；断言以调用方下标契约替代
mini-codex/src/hooks.ts:229-256 | parseTomlHooks: split(/\r?\n/)、split(/(^|[^\\])#/)、match(/^\[\[.../) 头正则 + ?./?? + try/catch 跳过坏值 | 无正则与可选链（D） | 字节扫描切行/剥注释/判 [[ ]]/[ ] 头；parseTomlScalar 不抛异常，catch 分支不可表达而丢弃
mini-codex/src/hooks.ts:258-274 | normalizeEventsTolerant: Object.keys/Object.entries 遍历动态记录重映射键 | 动态记录反射无对应（A） | sa_json_object_len/entry_at 迭代 + canonicalEventName 重映射后重建 JSON 对象再 normalize
mini-codex/src/hooks.ts:276-290 | parseHookFile: try/catch 包 JSON.parse + {...parsed, ...maybeHooks, hooks} 展开合并 + path.endsWith | 无异常；展开合并无对应（F） | sa_json_parse 状态码分支；合并 doc 仅以 maybeHooks ?? parsed 近似，展开专有键丢失；endsWith 以字节后缀比较
mini-codex/src/hooks.ts:295-324 | loadHookEvents: async/await readFile + Promise<HookEvents> + Date.now() 30s 缓存窗 | SLA 无 async/Promise（B） | 同步函数返回状态码，sa_std_fs 同步读文件保序，sa_time_now_ms 做同一缓存比较
mini-codex/src/hooks.ts:295-324 | files 数组条件展开 ...(cwd?[...]:[])、ev[name]?.length、(merged[name] ??= []).push(...ev[name]!) | 展开/可选链/空值赋值组合无对应（G） | file_count 取 3 或 5，逐事件显式 len 检查 + hook_events_merge_groups 拷贝
mini-codex/src/hooks.ts:326-329 | hookFilesLoaded: cache?.files ?? [] 且返回内部数组引用 | 可选链与引用返回无对应（E） | has_cache 检查后把 (path,len,source) 拷入调用方数组返回计数
mini-codex/src/hooks.ts:331-338 | matcherMatches: new RegExp(matcher).test(toolName) + try/catch 回退 includes | sa_std 无正则引擎（D） | 直接采用 TS 的 catch 回退语义 bytes_contains 子串匹配；锚点/字符类/交替等正则专属匹配会发散
mini-codex/src/hooks.ts:340-350 | selectHookHandlers 返回 {group, handler, index} 匿名对象数组（持对象引用）+ events[eventName] 动态键 | 匿名对象与引用语义无对应（A） | 写 (gi,hi,index) 坐标三元组到调用方数组，按坐标回查 handler
mini-codex/src/hooks.ts:352-363 | mcpHookToolInput(args: unknown) + { _raw: args } 字面量 + JSON.parse try/catch | unknown 与对象字面量无对应（A） | JSON node handle 派发，{_raw} 以 sa_json_object_set_string 构造，parse 以状态码分支
mini-codex/src/hooks.ts:365-369 | HookTemplateCtx extends Record<string, unknown>（开放索引签名） | 接口继承动态记录无对应（A） | 已知字段 struct + tool_input node handle；额外键无处存放而丢弃，hook_template_ctx_to_node 按需物化记录视图
mini-codex/src/hooks.ts:371-379 | lookupPath 对 unknown 的逐段动态遍历，缺失返回 undefined | unknown 遍历无对应（A） | JSON node 逐段 get，node 0 表示 undefined
mini-codex/src/hooks.ts:381-388 | expandTemplateString: replace(/\$\{([^}]+)\}/g, replacer) | 无正则替换（D） | 手工扫描 "${"…"}" 段并逐段展开
mini-codex/src/hooks.ts:381-388 | replacer 箭头闭包 + JSON.stringify(v) ?? "" / String(v) 的 try/catch 回退 | 闭包与任意值字符串化无对应（B） | 抽出 expand_template_expr 函数；stringify 状态近似，非 JSON 值（函数/符号）的 String() 不复刻
mini-codex/src/hooks.ts:390-400 | renderValue: v.map((x)=>renderValue(x,ctx)) + Object.entries 循环递归 unknown | 高阶方法与闭包递归无对应（I） | 对 JSON kind 显式循环递归并构造新 node
mini-codex/src/hooks.ts:402-406 | renderMcpHookInput: throw new Error("MCP hook input must be representable as TOML…") | SLA 无异常（F） | 返回 node 0 哨兵，唯一调用方 execute_hooks_mcp 以固定文案生成 failed 条目
mini-codex/src/hooks.ts:408-423 | preToolUseStdin/postToolUseStdin: 匿名参数对象 + JSON.stringify(对象字面量) + toolInput ?? {} | 动态对象与 stringify 字面量无对应（A） | 以 JSON node 按 TS 字面量键序逐键构造后 sa_json_stringify_into，node 0 → 空对象
mini-codex/src/hooks.ts:425-433 | ParsedHookOutput 可选字段 + updatedInput?: unknown；asRecord 的 unknown 类型测试 | 可选/unknown 无对应（E） | has_* 标志 + updatedInput JSON node handle（0=缺失，JSON null 以 has_updatedInput 区分）
mini-codex/src/hooks.ts:435-475 | parseHookOutput: JSON.parse 的 try/catch、typeof 字段检查、trim/toLowerCase/slice(0,N) 截断链 | 无异常；动态字段读取无对应（F） | parse 状态码分支 + JSON kind 检查 + json_get_trimmed_string/bytes_eq_lower + len 截断视图
mini-codex/src/hooks.ts:477-505 | runShell: new Promise(executor) + child.stdout.on("data")/on("error")/on("close") 监听 + setTimeout 竞速 + resolve-once done 标志 | 无 Promise/事件/定时器（B） | 同步阻塞 sa_std_process_spawn_bidi extern 一次完成 spawn+写 stdin+读 stdout+超时杀进程，三条 resolve 路径以 124/127/子进程码归并
mini-codex/src/hooks.ts:477-505 | spawn 选项 stdio 管道/windowsHide/windowsVerbatimArguments + cmd.exe /d /s /c 与 sh -c 平台分支 + process.platform | Node child_process 选项无 sa_std 对应（C） | 平台标志传入 extern，verbatim 参数语义在 Windows 丢失；stdout 64_000 截断以 65536 缓冲近似
mini-codex/src/hooks.ts:507-515 | HookExecCtx.callMcpRaw 函数字段 (server,tool,input,timeoutMs)=>Promise<string> + sink?: HookEventSink | 函数字段与 Promise 返回无对应（B） | callMcpRaw_id/sink_id 不透明 id，call_mcp_raw_dispatch/hook_sink_dispatch 按 id 分发（修复阶段登记注册表）
mini-codex/src/hooks.ts:516-520 | HookExecResult: additionalContexts: string[]、hookEvents: HookCompletedEvent[] 可变长数组 | 可变长数组无对应（I） | 定长 [32] 上下文指针表 + [HookCompletedEvent; 64] + len
mini-codex/src/hooks.ts:522-530 | emitStarted/emitCompleted: sink?.({type, event:{run:{...run}}}) 回调调用 + 展开浅拷贝 + try/catch 吞错 | 回调与对象展开无对应（B） | sink id 分发，run 以 struct 按值拷贝（TS 浅拷贝共享 entries，本处深拷贝，sink 改 entries 时发散）；分发状态被忽略对应吞错
mini-codex/src/hooks.ts:532-541 | baseRun: randomUUID() (node:crypto) + Date.now() + 返回对象字面量 | Node API 无对应（C） | sa_uuid_v4 写调用方 scratch + sa_time_now_ms + struct 逐字段填充
mini-codex/src/hooks.ts:543-551 | finishRun: {...run, status, entries, …} 展开浅拷贝返回新对象 | 对象展开无对应（G） | 原地字段更新（全部调用点均为 run = finishRun(run,…) 重赋值，等价）；entries 以拷贝入定长数组替代引用共享
mini-codex/src/hooks.ts:553-699 | executeHooks: async + 循环内 await runShell/callMcpRaw + 读模块全局 cache?.perFile + matched 匿名对象数组 + files[0]?.path ?? join(codexHome(),"hooks.json") | 无 async 与模块全局（B） | 同步函数 + state 参数；matched 以定长 [64] 并行数组（handler 按值拷贝，TS 为引用，handler 从不变异故等价）；回退源路径显式构建
mini-codex/src/hooks.ts:553-699 | executeHooks 整段 try/catch + e instanceof Error ? e.message : String(e) + msg.slice(0,2000) | 无异常与 instanceof（F） | 各分支状态码替代可抛点，外层 catch 仅以 execute_hooks_*_fail 语义在注释中保留，动态值错误文案为近似
mini-codex/src/hooks.ts:553-699 | 模板字面量 `hook timed out after ${timeoutMs}ms`、`${eventName} hook blocked ${ctx.toolName}`、`Blocked by ${eventName} MCP hook (${h.server}/${h.tool}).` 等 | SLA 无模板字面量（G） | buf_append_lit/append_u64/append_slice 逐段拼接，文案逐字保留
mini-codex/src/hooks.ts:701-714 | defaultHookSink 返回箭头闭包 + process.stderr.write + 模板字面量 + run.id.slice(0,8) | 闭包与 Node 流无对应（B） | 固定 sink id 1 + default_hook_sink_handle 普通函数，sa_stderr_write 写组装好的行缓冲（4096 上限，TS 无上限）
mini-codex/src/hooks.ts:716-724 | describeHooks: g.reduce((a,x)=>a+x.hooks.length,0) + ["PreToolUse","PostToolUse"] as HookEventName[] 断言 + parts.join(" ") + 模板字面量 | 高阶归约与断言无对应（I） | 两事件码 0/2 展开循环计数，buf 组装 "Name:count" 并以空格连接，无则 "none"

## 汇总

- 转换文件：2（hooks.sla / tools.sla），源总行数 841（hooks.ts 724 + tools.ts 117）。
- 缺陷条数：58（hooks.ts 47 + tools.ts 11）；.sla 内另有 135 处 `// DEFECT:` 行内注释（含同一条目的多点标注）。
- 类别计数：A 动态对象/unknown/Record 14；B async/Promise/回调/闭包/函数类型 8；E 联合/可选/nullable/断言 8；I 容器/集合/高阶/全局状态 8；D RegExp 6；C Node API 5；G 字符串方法/模板/展开 5；F 异常 4。

## 组 D（mini-codex-D.md）

# 缺陷日志 — 单元 mini-codex-D（组 D）

格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`
源仓：~/workspace/projects/codex-react-ui/（plugins @ f2cb649d，只读）；输出：~/workspace/cxu-sla-mirror/ 同相对路径 .sla。

## mini-codex/src/responses.ts

mini-codex/src/responses.ts:5-24 | Set<string>（seenCall/seenOutput）+ Array.filter 闭包 | SLA 无 Set/闭包 | sanitizeThread 以已保留 items 的线性扫描代替 Set 成员判定，filter 改原地压实
mini-codex/src/responses.ts:26-56 | Array<Record<string, unknown>> 对象字面量 + it.images.map/spread 展开 input_image | 动态对象、无 map/spread | toResponsesInput 输出改为 JSON 文本缓冲 RecordArray（同序逐项追加），images 按 images_json 条目计数循环
mini-codex/src/responses.ts:58-84 | 同上（toChatMessages，含 image_url 块 map/spread） | 动态对象、无 map/spread | 同 toResponsesInput 的 RecordArray 近似
mini-codex/src/responses.ts:103-104 | EFFORT_LEVELS `as const` 元组 + (typeof EFFORT_LEVELS)[number] 联合类型 EffortLevel | 无 const 元组/字面量联合 | 改 EFFORT_LOW/MEDIUM/HIGH/MAX u64 标签，字面量文本顺序以注释保留
mini-codex/src/responses.ts:106-118 | RegExp：m.replace(/[._\s]+/g,"-") + /(?:^|[\/-])(opus|sonnet|haiku|fable|mythos)-5(?:[\/-]|$)/.test(norm) | SLA 无 RegExp | modelSupportsEffort 改大小写不敏感子串扫描（<family>-5/.5/_5 共 15 条），锚点语义不精确
mini-codex/src/responses.ts:124-129 | parseEffortValue(value: unknown) + String(value).trim().toLowerCase() 强转 | 无 unknown/动态强转 | 调用方传已字符串化的 (ptr,len)+presence 标志，结果用 OptStr（has+bytes）
mini-codex/src/responses.ts:131-137 | process.env.MINI_EFFORT ?? process.env.CLAUDE_CODE_EFFORT_LEVEL | 无 process.env 对象 | getEffortEnvOverride 改 sa_env_get 缓冲读取 + 三态结构 EffortEnvOverride（undefined/null/value）
mini-codex/src/responses.ts:148-165 | TurnOpts 可选字段 effort?/protocol?/responsesInput?/previousResponseId?: string\|null + ThreadItem[]/ToolDef[] | 无可选字段/联合 | TurnOpts struct 全部字段展开 + has_* 标志（previousResponseId 另加 is_null）
mini-codex/src/responses.ts:167-170 | async function createTurn(...): Promise<TurnResult> | 无 async/Promise | 同步 fn 返回 i32 状态码 + out:&TurnResult
mini-codex/src/responses.ts:174-180 | numEnvInt：process.env[key]、Number(t)、Number.isFinite、Math.floor/min/max | 无 env 对象/Number 语义 | sa_env 缓冲 + 手写十进制解析与钳制（本阶段返回 fallback 占位）
mini-codex/src/responses.ts:190-193 | isAbortError(e: unknown)：instanceof Error、模板串 `${e.name}: ${e.message}`、RegExp /aborterror\|aborted\|operation was aborted/i | 无 Error 对象/RegExp | 调用方传扁平化消息文本，三条字面量大小写不敏感子串扫描
mini-codex/src/responses.ts:202-224 | upstreamRetryAfterMs：Headers.get、Date.parse/Date.now、body 提示 RegExp exec 捕获组 | 无 Headers/日期 API/RegExp | headers 扁平文本 + 仅数值秒分支近似，日期分支落 undefined，body 正则改关键词+数字扫描（修复阶段）
mini-codex/src/responses.ts:226-228 | sleep：new Promise + setTimeout | 无 Promise/定时器 | 同步 host-delay 占位 fn sleep(ms)
mini-codex/src/responses.ts:230-268 | fetchMiniUpstream：async + 全局 fetch/RequestInit/Response、res.text()、throw/catch、process.stderr.write | sa_std 无 fetch API 形态、无异常、无 process.stderr | 同步状态码 + FetchResponse/err out 参数，throw 改非零返回，stderr 改 println，真正分发留修复阶段走 sa_http_client_*
mini-codex/src/responses.ts:272-281 | interface MiniResponsesChain（prevId: string\|null）+ const 对象字面量 EMPTY_MINI_RESPONSES_CHAIN | 无 null 字段/const struct 值 | struct + has_prevId 标志；EMPTY 改同名初始化函数 EMPTY_MINI_RESPONSES_CHAIN(out)
mini-codex/src/responses.ts:283-290 | hashMiniChainPrefix：Math.imul、h >>> 0、Number.toString(16)、s.charCodeAt | 无 32 位 imul/无符号移位/进制 toString | u64 运算每步 %2^32 取低位，十六进制手工逐位渲染
mini-codex/src/responses.ts:292-322 | 泛型 <T extends Record<string, any>> + JSON.stringify(full.slice(...)) + Array.slice 按项切分（resolve/advanceResponsesChain） | 无泛型/动态 JSON/项偏移跟踪 | T[] 统一 RecordArray（JSON 缓冲）；前缀 JSON 与前缀字节数由调用方另行传入
mini-codex/src/responses.ts:324-328 | isChainRejectedError(e: unknown) + RegExp 含 .* 交替模式 | 无 RegExp（.* 跨段匹配不可子串化） | 字面量交替子串扫描 + response/expired、response/not found、invalid+response 组合近似
mini-codex/src/responses.ts:330-356 | createChainedTurn：async、{ ...opts, ... } 对象展开、try/catch + throw e | 无 async/展开/异常 | 同步状态码 + opts 逐字段拷贝覆盖两字段；chained 失败时按拒绝判定走一次全量重试，否则透传状态码
mini-codex/src/responses.ts:358-390 | createResponsesTurn：JSON.stringify 嵌套体 + 条件展开 ...(effort?{...}:{})、tools.map 闭包、res.json() 动态解析、Set seenCallId、Math.random() 兜底 callId、String(o.call_id ?? o.id ?? ...) | 动态 JSON/闭包/Set/随机数均无对应 | 请求体同序逐段 JSON 追加；响应以 sa_json_* 导航（修复阶段）；seenCallId 线性扫描；Math.random 兜底留空
mini-codex/src/responses.ts:392-437 | createChatTurn：同上 + 可选链 data.choices?.[0]?.message、msg?.tool_calls ?? []、tc.function?.name | 无可选链/动态 JSON | sa_json_* 导航 + presence 标志（修复阶段），其余同 createResponsesTurn

## mini-codex/src/cli.ts

mini-codex/src/cli.ts:1-36 | 顶层模块脚本 + 两处 top-level await（createUltraExecutor/runPrompt） | SLA 无顶层代码/await | 全体移入 fn main() -> i32，await 改顺序同步调用
mini-codex/src/cli.ts:6-18 | process.argv.slice(2)、const rest: string[] 动态数组 push、rest.join(" ")、next.startsWith("--") | 无 process.argv/动态数组 | host argv extern（修复阶段）+ 定长 [CliStr; 64] 数组，join 改逐项空格拼接
mini-codex/src/cli.ts:19-27 | cfg 内联对象字面量 + process.env.* \|\| 回退链 + process.cwd() | 无 process.env/对象字面量类型 | 本地 CliCfg struct；env 改 sa_env_get 缓冲读（空即回退，与 \|\| 同序），cwd 走 sa_std cwd extern
mini-codex/src/cli.ts:28-36 | console.error/console.log、process.exit(1) | 无 console/process 对象 | println 近似输出，exit 改 main 返回 1
mini-codex/src/cli.ts:30-35 | 三元 + ?? undefined（loadThreadFile(...) ?? undefined）、选项对象 { initialThread, threadFile } \| undefined | 无 nullish/可选对象参数 | has_initialThread/has_options 标志 + 值分开传

## mini-codex/src/imageView.ts

mini-codex/src/imageView.ts:5-6 | Node 导入 node:fs/promises（readFile/stat）、node:path（isAbsolute/relative/resolve） | sa_std 无直接对应 | sa_std/fs.sai extern + 字节缓冲手工路径拼接（viewLocalImage 内）
mini-codex/src/imageView.ts:8-9 | 字符串字面量联合 ImageViewSize/ImageViewColor | 无字面量联合 | u64 标签常量 IMAGE_VIEW_SIZE_*/IMAGE_VIEW_COLOR_*
mini-codex/src/imageView.ts:17-25 | EXT_MIME: Record<string, string> 动态查表 | 无动态映射 | ext_mime 改 7 键同序 if 链
mini-codex/src/imageView.ts:27-41 | IMAGE_VIEW_TOOL 嵌套对象字面量（JSON Schema） | 动态对象 | struct + schema 存为逐字 JSON 文本缓冲，description 逐字保留于注释
mini-codex/src/imageView.ts:43-59 | normalize*(v: unknown)：typeof 守卫 + trim().toLowerCase() | 无 unknown/String 方法 | (ptr,len)+is_string 标志入参，OptTag（has+value）返回，比较大小写不敏感近似
mini-codex/src/imageView.ts:61-69 | imageViewArgError(a: Record<string, any>) + 模板串内 ${JSON.stringify(a.size)?.slice(0, 80)} | 动态对象/JSON.stringify/可选链 | args 传 JSON 文本、sa_json_* 取键（修复阶段）；错误文本改原始 JSON 截 80 字节追加
mini-codex/src/imageView.ts:71 | ImageViewResult.dataUrl?：base64 data URL 可达 ~13.9 MB | 无动态字符串 | 定长 1 MiB 缓冲 + has_dataUrl；超限 data URL 本阶段不可表示
mini-codex/src/imageView.ts:73-81 | loadSharp：async + await import("sharp") 可选依赖 + any/\?.default ?? | 无动态导入/可选依赖/any | 同步返回 handle id（0 = TS 的 null/导入失败）
mini-codex/src/imageView.ts:83-108 | viewLocalImage：async、await stat/readFile、Stats.isFile()、Buffer、相对路径、try/catch 分支返回 | 无 Promise/Buffer/异常 | 同步 + sa_std fs 状态码分支，同序保留每个 return 的 ok/text/displayPath
mini-codex/src/imageView.ts:109-124 | sharp 流式管线 sharp(input).resize().grayscale()/flatten().jpeg()/png().toBuffer({resolveWithObject:true}) | sa_std 无图像处理库 | 分支结构与 mime 选择保留为注释，执行推迟修复阶段（拟走宿主/SDK 图像服务）

## mini-codex/src/review.ts

mini-codex/src/review.ts:6-10 | 判别联合 ReviewTarget（4 变体，含 title?: string \| null） | 无联合类型 | kind 标签常量 REVIEW_TARGET_* + 全字段 struct，title 用 has_title/title_is_null
mini-codex/src/review.ts:12-35 | parseReviewTarget(value: unknown)：Record<string, unknown> 读键 + String(rec.* ?? ...) 强转链 | 无 unknown/动态对象 | 值以 JSON 文本 + value_is_object 入参，sa_json_* 取键（修复阶段），对象分支顺序与回退逐字保留注释
mini-codex/src/review.ts:37-45 | RegExp exec：/^(?:branch\|base\|base-branch)\s+(.+)$/i、/^commit\s+([0-9a-fA-F]{6,64})(?:\s+(.+))?$/i + branch?.[1]?. 可选链 | 无 RegExp/可选链 | 前缀大小写不敏感扫描 + sha 的 6..64 十六进制位扫描 + 余量作 title 近似
mini-codex/src/review.ts:48-61 | reviewTargetLabel 模板字面量 + sha.slice(0,7)/instructions.slice(0,120) | 无字符串插值 | ReviewStr 逐段追加（前缀+字段字节+后缀），同 7/120 截断
mini-codex/src/review.ts:63-70 | REVIEW_RUBRIC 字符串数组 .join("\n") | 无数组 join | 合并为单字面量（\n 分隔，6 行逐字保留）
mini-codex/src/review.ts:72-91 | buildReviewPrompt switch + 多处模板字面量（branch/sha/title 插值） | 无字符串插值 | targetPrompt 按同分支同序逐段追加，最后 RUBRIC + "\n\n" + targetPrompt

## mini-codex/src/ultraAdapter.ts

mini-codex/src/ultraAdapter.ts:3-6 | formatSaVmResult(v: unknown)：JSON.stringify/String(v) 强转 + try/catch + slice(0,8000) | 无 stringify/强转/异常 | 调用方传序列化文本（字符串传本体、其余传 JSON 文本）截 8000 字节拷贝，catch 分支不可区分
mini-codex/src/ultraAdapter.ts:8-9 | async createUltraExecutor + await import("../../apps/server/src/saVmTool.ts") 跨 ultra 边界动态导入 | 无动态导入/Promise；且插件只能调用 SDK，该模块无 SLA 声明 | 同步返回 executor id；expandSaVmActionInput/runSaVmTool 改 extern 风格占位 fn（状态码+JSON 缓冲）
mini-codex/src/ultraAdapter.ts:10-28 | 返回闭包 async (toolName, args, cwd) => {...} 捕获 mod（UltraToolExecutor 函数类型） | 无闭包/函数值 | 改命名 fn ultraExecutor_call(exec 首参 + toolName/args/cwd)，捕获的 mod 即占位 fn 对
mini-codex/src/ultraAdapter.ts:12-20 | 解构 const { action, ...rest } = args + { action: String(action ?? ""), ...rest } 展开重组 | 无解构/展开/强转 | 从 args JSON 文本取 action，整体 args 作 rest，base JSON 文本拼装（修复阶段）
mini-codex/src/ultraAdapter.ts:21-26 | try { expanded = mod.expandSaVmActionInput(base) as ... } catch { expanded = base } + runSaVmTool(..... as never) | 无异常/as 强转 | expander 非零状态即选回退 expanded=base；as never 忽略，合并 JSON 文本后同步调用

## extensions/pi-relay/index.ts

extensions/pi-relay/index.ts:1 | 从 @earendil-works/pi-coding-agent 导入 ExtensionAPI/ProviderModelConfig 宿主类型 | 无宿主对象/方法对应 | ExtensionAPI 改不透明 handle struct{id}，registerProvider 改 host-dispatch 占位 fn
extensions/pi-relay/index.ts:9-13 | process.env.PI_LAUNCH_* 读取 + \|\| 默认 + .trim()（×4） | 无 process.env 对象 | sa_env_get 缓冲读（空用默认，与源码同序同默认值）+ trim 留修复阶段
extensions/pi-relay/index.ts:20-22 | modelSpec.split(",").map(trim).filter(Boolean) 闭包链 | 无 split/map/filter/闭包 | 手工逗号扫描产生去空条目，定长数组 cap 32
extensions/pi-relay/index.ts:24-27 | headers: Record<string, string> 动态对象按 key 赋值 | 无动态对象 | headers 改 JSON 文本缓冲，kilo.ai 分支追加 {"User-Agent":"opencode-kilo-provider"}
extensions/pi-relay/index.ts:29-45 | modelIds.map((id) => ({...ProviderModelConfig})) 对象字面量数组 + 模板名 `${id} (Relay)` + 嵌套 cost/compat 对象 | 无 map/对象字面量/插值 | 计数循环逐字段填 ProviderModelConfig（cost_/compat_ 前缀展平），name = id 字节 + " (Relay)"，数值逐字保留（128000/32768 等）
extensions/pi-relay/index.ts:47-54 | pi.registerProvider("pi-relay", {...}) 配置对象 + api: apiType as any | 无宿主方法/any 强转 | extension_api_register_provider 占位（字段分开传 + models/headers JSON 文本），apiType 原样传

## mini-codex/test/fourpiece.test.ts

mini-codex/test/fourpiece.test.ts:3-20 | bun:test 框架 describe/test/expect + expect 匹配器（toEqual/toBeNull/toBe/toContain/toBeGreaterThan/toBeLessThan/toBeUndefined） | SLA 本阶段无测试框架/断言库 | describe 改章节注释，test 改同名 fn -> i32（0=通过），expect 改 expect_* helper 记失败计数；不被任何 runner 执行
mini-codex/test/fourpiece.test.ts:4-6 | 测试内 Node 同步 API：mkdtempSync/readFileSync/writeFileSync、tmpdir、join | 无直接对应 | sa_std fs extern + 手工路径拼接，临时目录名用固定后缀代随机后缀
mini-codex/test/fourpiece.test.ts:66-92 | 链式单元测试中的对象/数组字面量、[...full] 展开、new Error(...) 实参、EMPTY 常量对象比较 | 无字面量对象/展开/Error 对象 | RecordArray JSON 缓冲逐项追加；Error 传扁平消息文本+标志；EMPTY 以初始化 fn 生成后逐字段比
mini-codex/test/fourpiece.test.ts:93-132 | globalThis.fetch 桩赋值 + async 桩闭包捕获可变 bodies/calls + new Response/JSON.parse/stringify + try/finally 恢复 fetch | 无 globalThis/可赋值全局 fetch/Response/闭包/finally | 每测本地 stub fn（同序罐头响应），BodiesArray+计数器引用传参，恢复 fetch 为 no-op
mini-codex/test/fourpiece.test.ts:151-164 | runPrompt 内联 async 箭头执行器 async () => "tool out" + cfg/options 对象字面量（另见 168-201、204-241 同形站点） | 无函数值/对象字面量 | loop.sla 的 id 分发 stub executor 句柄；cfg 逐字段填 MiniConfig + has_threadFile 标志
mini-codex/test/fourpiece.test.ts:226-236 | readFileSync(...).split("\n").filter(Boolean).map(JSON.parse) + saved.some((t: any) => t.type === "plan") 闭包 | 无 split/map/some/闭包 | 对保存文件文本逐行扫描 "\"type\":\"plan\"" 出现

## mini-codex/test/soak.test.ts

mini-codex/test/soak.test.ts:5-9 | bun:test 框架 describe/test/expect（同 fourpiece） | 无测试框架 | 同 fourpiece 约定：describe 章节注释 + test 同名 fn -> i32 + expect_* helper
mini-codex/test/soak.test.ts:12-44 | 桩 fetch 闭包捕获 bodies/calls + 模板字面量 `resp-${calls}`/`ack ${calls}`/`soak note ${i}` + JSON.parse/stringify + 12 轮 for 循环 await runPrompt | 无闭包/插值/动态 JSON | 罐头 JSON 文本 + 计数器十进制字节渲染，BodiesArray 引用传参；轮循环保留 for i in 1..13
mini-codex/test/soak.test.ts:61-62 | 测试内动态导入 const { writeFileSync } = await import("node:fs")（另见 79、90 同形） | 无动态导入/解构 | 直接用 sa_std fs extern 写文件
mini-codex/test/soak.test.ts:78-97 | await import("../src/plan.ts")、seed: Array<Record<string, any>>、"x".repeat(50)、seed.map(JSON.stringify).join("\n")、thread/dropped.some((t: any) => ...) | 无动态导入/动态记录数组/repeat/map/some | plan.sla 顶部静态导入；seed 改序列化缓冲逐项追加（repeat 改固定字节 run），some 改线性 kind 扫描
mini-codex/test/soak.test.ts:100-114 | `x`.repeat(2000)、模板 callId `c${i}`/path `f${i}.ts`、JSON.stringify 对象字面量、squeezed.some(...) | 同上 | 序列化 JSON 文本逐项追加（计数器十进制渲染、2000 字节固定 x run），some 改线性扫描

## 组 E（mini-codex-E.md）

# mini-codex-E 缺陷日志（types / plan / memory / agentsMd / skills + agentsMd/hooks/loop 测试）

源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## mini-codex/src/types.ts
mini-codex/src/types.ts:1-7 | discriminated union（ThreadItem 六变体） | SLA 无联合类型 | kind 标签常量 + 单 struct 含全部变体字段
mini-codex/src/types.ts:6 | 可选动态数组 images?: string[] | 无动态数组/可选字段 | JSON 文本缓冲 + has_images 标志
mini-codex/src/types.ts:9-13 | Record<string, unknown>（ToolDef.schema） | 动态对象无对应 | JSON 文本缓冲 schema_json

## mini-codex/src/plan.ts
mini-codex/src/plan.ts:3 | 字符串字面量联合 PlanStatus | 无联合类型 | u64 标签常量 PLAN_STATUS_*
mini-codex/src/plan.ts:11-16 | unknown 参数（normalizePlanStatus） | 动态值无类型 | (ptr,len) 原始文本字节
mini-codex/src/plan.ts:11-16 | 正则 replace(/[\s-]+/g, "_") | 无正则引擎 | 字节循环折叠空白/'-' 为单个 '_'
mini-codex/src/plan.ts:11-16 | String.trim/toLowerCase | 字符串方法缺失（且 JS 为 UTF-16 语义） | ASCII 字节级近似
mini-codex/src/plan.ts:18-28 | Record<string, unknown>（titleOf 的 entry） | 动态对象无对应 | entry 保留为 JSON 文本 + 键子串扫描
mini-codex/src/plan.ts:18-28 | JSON 结构访问（typeof rec[key]） | 无 JSON 解析器 | 按 "key":" 模式扫描引号值
mini-codex/src/plan.ts:35-48 | Record<string, any>（extractPlanSteps 的 args） | 动态对象无对应 | args 保留为 JSON 文本缓冲
mini-codex/src/plan.ts:35-48 | Array.isArray + JSON 数组遍历 | 无 JSON 解析器 | 定位 todos/steps 后 '['…']' 跨度 + {...} 条目扫描
mini-codex/src/plan.ts:43-46 | entry.status 动态字段读取 | 无 JSON 解析器 | 复用键扫描近似提取 status 文本再 normalizePlanStatus
mini-codex/src/plan.ts:54-59 | string | null 返回（validatePlanSteps） | 可空返回无对应 | bool + err 输出缓冲
mini-codex/src/plan.ts:61-68 | 模板字面量 + Array.map/join（formatPlanText） | 字符串插值缺失 | 手工拼接 + u64 十进制渲染
mini-codex/src/plan.ts:75-83 | Record<string, any>（applyPlanUpdate 的 args） | 动态对象无对应 | JSON 文本缓冲（同 extractPlanSteps）
mini-codex/src/plan.ts:75-83 | thread.findIndex / 下标赋值 / push 就地变异 | 动态数组变异无对应 | 定长 ThreadList 上的显式查找/赋值/追加

## mini-codex/src/memory.ts
mini-codex/src/memory.ts:1-3 | node:fs / node:os / node:path 导入 | Node API 无直接 .sai 对应 | sa_std fs extern（exists/read/append/mkdir/env）近似
mini-codex/src/memory.ts:11-20 | try/catch（readCapped） | 无异常处理 | fs extern 状态码代替抛错
mini-codex/src/memory.ts:12 | existsSync | Node API | sa_std_fs_exists 状态
mini-codex/src/memory.ts:13 | readFileSync(path, "utf8") | Node API + 定长缓冲截断风险 | sa_std_fs_read 读入 16384 字节缓冲
mini-codex/src/memory.ts:15 | raw.slice(-cap) / trim / length | 字符串方法为 UTF-16 语义 | 字节级 sliceTail/isBlank 近似
mini-codex/src/memory.ts:27-44 | join() / homedir()（loadMiniMemory） | Node API | '/' 字节拼接 + HOME 环境变量近似 homedir
mini-codex/src/memory.ts:36-43 | 模板字面量拼装 block + parts.join | 字符串插值缺失 | 手工拼接 MemStr
mini-codex/src/memory.ts:28,36 | repo.trim()/home.trim() 注入 | 字符串方法 | 空白字节判定 isBlank 近似（未真裁剪内容）
mini-codex/src/memory.ts:50-61 | 正则 replace(/\r?\n/g, " ") | 无正则引擎 | 字节循环把 CR/LF 压成空格
mini-codex/src/memory.ts:56-58 | try/catch + e instanceof Error ? e.message | 无异常/反射 | 任一 fs 失败返回固定 "remember failed: fs error"
mini-codex/src/memory.ts:55-57 | mkdirSync(dirname(file), {recursive}) / appendFileSync | Node API | sa_std_fs_mkdir（以 cwd 代 dirname）/ sa_std_fs_append
mini-codex/src/memory.ts:51 | String(text ?? "").trim().slice(0, cap) | 空值合并 + 字符串方法 | 字节级 trim + 长度截断

## mini-codex/src/agentsMd.ts
mini-codex/src/agentsMd.ts:1-2 | node:fs / node:path 导入 | Node API 无直接对应 | sa_std fs extern + 字节级路径助手
mini-codex/src/agentsMd.ts:13 | 默认参数 maxLevels = AGENTS_MD_MAX_LEVELS | 无默认参数 | 调用方显式传参
mini-codex/src/agentsMd.ts:16-20 | resolve(cwd) + try/catch 返回 [] | Node API/异常 | resolve 近似为原样拷贝（不绝化/不解符号链）
mini-codex/src/agentsMd.ts:21-28 | existsSync + statSync().isFile() + 逐条 try/catch | Node API/异常 | sa_std_fs_exists / sa_std_fs_is_file 状态检查
mini-codex/src/agentsMd.ts:32 | found.reverse() 动态数组 | 动态数组无对应 | 定长列表原地反转
mini-codex/src/agentsMd.ts:39 | string | null 返回 + 两个默认参数 | 可空返回/默认参数 | bool（false=null）+ 输出缓冲，默认值由调用方传
mini-codex/src/agentsMd.ts:52 | body.trim() / chunk.slice(0, room) | 字符串方法（UTF-16 语义） | 字节级 trim 跨度 + 长度截断
mini-codex/src/agentsMd.ts:51,54 | 模板字面量（# Repo instructions (${file})、截断标记） | 字符串插值缺失 | 手工拼接 + maxBytes 十进制渲染
mini-codex/src/agentsMd.ts:17,24 | join(dir, "AGENTS.md") / dirname(dir) | Node API（平台分隔符） | '/' 字节拼接 + 字节级 dirnameInPlace

## mini-codex/src/skills.ts
mini-codex/src/skills.ts:6 | 字符串数组常量 ROOTS | 无字符串数组字面量 | skillRoot(idx) 索引助手函数
mini-codex/src/skills.ts:8-21 | 正则（frontmatter 分隔、行内键值、引号剥离） | 无正则引擎 | 逐行扫描 + 手工引号剥离
mini-codex/src/skills.ts:16 | toLowerCase() / replace(/_/g, "-") | 字符串方法 | ASCII 字节循环
mini-codex/src/skills.ts:23-42 | async/await + Promise<SkillEntry[]>（scanSkills） | 无 async/Promise | 同步函数 + 原地填充 SkillList
mini-codex/src/skills.ts:27 | readdir({withFileTypes:true}) Dirent | Node API | sa_std_fs_list_names 换行名列表 + 逐项 is_dir 检查
mini-codex/src/skills.ts:26,31,40 | try/catch / catch {} 吞错 | 无异常处理 | fs extern 状态检查代替
mini-codex/src/skills.ts:36 | 正则 /^[a-z0-9]+(?:-[a-z0-9]+)*$/ 校验名 | 无正则引擎 | validSkillName 字节循环
mini-codex/src/skills.ts:41 | found.slice(0, 50) / push | 动态数组无对应 | 定长 SkillList 容量 50 截断
mini-codex/src/skills.ts:44-50 | 正则 /^\s*\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/（expandSlash） | 无正则引擎 | 字节扫描解析命令名与余文
mini-codex/src/skills.ts:47 | skills.find(回调) 闭包 | 无闭包 | 显式循环 + toLowerCase 字节比较
mini-codex/src/skills.ts:49 | 模板字面量 + .trim() | 字符串插值/方法 | 手工拼接 + 尾部空白裁剪
mini-codex/src/skills.ts:52-59 | async readSkillBody + readFile | 无 async/Promise | 同步读 + 输出缓冲
mini-codex/src/skills.ts:55 | 模板字面量截断通知（含 ${md.length}） | 字符串插值缺失 | 手工拼接 + 十进制渲染
mini-codex/src/skills.ts:56 | split("\n").filter(startsWith).slice.join 链 | 字符串/数组高阶方法 | 逐行扫描收集 '#' 标题行（上限 30）
mini-codex/src/skills.ts:61-64 | map().join("\n") 模板渲染（skillListPrompt） | 高阶方法/插值 | 显式循环手工拼接
mini-codex/src/skills.ts:66-70 | throw new Error（resolveSkillPath） | 无异常 | bool 返回（false = 本应抛错）
mini-codex/src/skills.ts:67 | resolve(p) 路径规范化 | Node API | 原始字节比较（不绝化/不解符号链）
mini-codex/src/skills.ts:24,29 | join(cwd, root, name, "SKILL.md") | Node API（平台分隔符） | '/' 字节拼接 joinPath

## mini-codex/test/agentsMd.test.ts
mini-codex/test/agentsMd.test.ts:1 | bun:test describe/test/expect 测试框架 | SLA 无测试框架 | test* 函数 + expect* 助手 + main 返回失败数
mini-codex/test/agentsMd.test.ts:7-13 | mkdtempSync 随机临时目录 | Node API 无 mkdtemp | /tmp 下固定目录名近似
mini-codex/test/agentsMd.test.ts:10 | mkdirSync(sub, {recursive:true}) | Node API | 逐级 sa_std_fs_mkdir
mini-codex/test/agentsMd.test.ts:15,40 | expect(found).toEqual([路径数组]) | 深相等断言 | 长度 + 逐项字符串相等
mini-codex/test/agentsMd.test.ts:31-33 | expect(out!.indexOf).toBeLessThan + 非空断言 ! | 断言/TS 语法 | indexOfSub 结果比较
mini-codex/test/agentsMd.test.ts:38 | "y".repeat(n) + 模板字面量造数据 | 字符串方法 | 字节填充循环

## mini-codex/test/hooks.test.ts
mini-codex/test/hooks.test.ts:1-9 | bun:test 测试框架 + 跨单元导入 hooks/mcpHooks | 无测试框架；被测单元由他组转换 | test* 函数 + main；导入签名以 JSON 文本/struct 近似（待他组定稿对齐）
mini-codex/test/hooks.test.ts:11-124 | HookEvents/上下文/结果均为动态对象字面量 | 动态对象无对应 | JSON 文本 + 本地 struct（ParsedHook/HookResult/HookCtx）近似
mini-codex/test/hooks.test.ts:12 | matcherMatches(undefined, ...) 可选参数 | 无 undefined/可选参数 | has_matcher 标志位
mini-codex/test/hooks.test.ts:16-23 | 正则 matcher 语义（^mcp__、Write|Edit、非法正则回退子串） | 无正则引擎（在被测单元内） | 调用按原文转写，语义缺口记在 hooks 单元
mini-codex/test/hooks.test.ts:54,67,81,91 | expect(...).toEqual(对象) 深相等 | 断言无对应 | 规范 JSON 文本比较（键序敏感）
mini-codex/test/hooks.test.ts:53-110 | JSON.stringify 构造输入 | 动态对象 | 等价 JSON 字面量
mini-codex/test/hooks.test.ts:119-122 | process.cwd() / process.platform 全局 | Node 进程全局无对应 | cwd 用 "/tmp" 代替；平台分支以 IS_WIN32=false 近似（win32 分支保留转写）
mini-codex/test/hooks.test.ts:117-124 | 对象字面量 ctxBase + {...ctxBase, sink} 展开 | 对象展开无对应 | HookCtx struct 构造 + 字段覆写
mini-codex/test/hooks.test.ts:127-197 | async 测试 + await executeHooks | 无 async/Promise | 同步调用近似
mini-codex/test/hooks.test.ts:139 | sink: (e) => seen.push(e.type) 闭包回调 | 无闭包/回调 | 被调用方把事件类型序列写入 sink_types_json 缓冲
mini-codex/test/hooks.test.ts:172-184 | callMcpRaw: async (...) => { timeouts.push(...) } 闭包回调 | 无闭包/回调 | call_mcp_raw_mode 模式字段选本地桩，timeouts 记入 HookCtx 数组
mini-codex/test/hooks.test.ts:191-203 | runToolWithHooks 的 execNonMcp: async () => "ok-from-exec" 回调 | 无闭包/回调 | exec 模式字段近似
mini-codex/test/hooks.test.ts:146-164 | 模板/平台条件构造 shell 命令字符串（printf/echo JSON） | 平台差异 | 双分支字面量转写 + IS_WIN32 选择

## mini-codex/test/loop.test.ts
mini-codex/test/loop.test.ts:3-18 | bun:test 测试框架 + 跨单元导入 loop/responses | 无测试框架；被测单元由他组转换 | test* 函数 + main；导入签名以 (ptr,len)/struct 近似
mini-codex/test/loop.test.ts:29,225 | buildBaseSystem("", [], 0[, agentsMd]) 可选第 4 参 | 无可选参数 | has_agents 标志；skills 参恒为 [] 故省略（待 loop 单元定稿对齐）
mini-codex/test/loop.test.ts:45-50 | parseGoalArgs 返回 string | null | 可空返回 | bool + 输出缓冲
mini-codex/test/loop.test.ts:全文多处 | ThreadItem 对象字面量数组 | 动态对象/数组 | ThreadVec 定长数组 + make*Item 构造函数
mini-codex/test/loop.test.ts:180,197,253 | Array.from({length}, (_, i) => ...) 闭包造数据 | 无闭包 | 显式循环 + makeIndexedUser
mini-codex/test/loop.test.ts:185-190,262-277 | process.env.MINI_THREAD_KEEP 读写 + delete + try/finally | Node 进程全局/异常 | sa_std_env_set/unset + 顺序恢复
mini-codex/test/loop.test.ts:173 | `nope-${Date.now()}.jsonl` | Date 全局 | 固定文件名近似
mini-codex/test/loop.test.ts:167-205 | mkdtempSync/writeFileSync/readFileSync + JSON.stringify/parse 往返 | Node API + 动态 JSON | fs extern + itemToJson 规范渲染（不转义）
mini-codex/test/loop.test.ts:214,222 | JSON.stringify(input/msgs) 后 toContain 断言 | 动态对象序列化 | toResponsesInput/toChatMessages 返回 JSON 文本缓冲
mini-codex/test/loop.test.ts:300-318 | await withCompactedMemory（async） | 无 async/Promise | 同步调用近似
mini-codex/test/loop.test.ts:313,358 | expect(...).toBe(thread) 引用同一性 | 值 struct 无引用同一性 | 长度 + 逐项相等近似
mini-codex/test/loop.test.ts:380-385 | got.find((t) => ...) 闭包谓词 | 无闭包 | 显式扫描循环
mini-codex/test/loop.test.ts:410-421 | new Set(got.filter().map()) 集合运算 | 无 Set/高阶方法 | 线性扫描成员判定
mini-codex/test/loop.test.ts:423-448 | "A".repeat(5000) + plain.map(t => ...{...t, images}) 展开映射 | 字符串方法/对象展开 | 填充循环 + 显式拷贝循环设 images
mini-codex/test/loop.test.ts:435 | images: string[] 载荷计入字符预算 | 动态数组（见 types.ts:6） | images_json 存原始图片字节（JSON 框边字节不计入，与 TS 长度断言对齐的近似）
mini-codex/test/loop.test.ts:455-512 | async runPrompt 集成测试（3 个） | 无 async/Promise | 同步调用近似
mini-codex/test/loop.test.ts:458-512 | globalThis.fetch 打桩 + Response/JSON.stringify 桩 | fetch 全局/动态对象无对应 | runPrompt 以 fetch_mode 选择转写的桩（1 压缩+被动/2 goal/3 spawn），请求体收进 FetchBodies
mini-codex/test/loop.test.ts:461 | exec 回调 async () => "tool out" | 无闭包/回调 | exec_mode 模式字段近似
mini-codex/test/loop.test.ts:456-512 | try/finally 恢复 fetch 与 env | 无异常处理 | 顺序恢复调用
mini-codex/test/loop.test.ts:494-506 | setTimeout 轮询等待子代理第二轮 + Date.now 截止 | 定时器/事件循环无对应 | 同步转换下子轮已记录，直接断言 bodies
mini-codex/test/loop.test.ts:473-476 | readFileSync(saveFile).split("\n").filter().map(JSON.parse) 读回断言 | 字符串/数组高阶方法 + JSON 解析 | 整文件读入 + 首行切片子串断言

