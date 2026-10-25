# web-ts 单元缺陷日志（合并）

单元范围：apps/web 全部 .ts（不含 .tsx、排除 node_modules），源 CXU plugins @ f2cb649d。
转换结果：180/180 文件有同相对路径 .sla（覆盖率核对 missing=0）；源总行数 37,200。
日志条目合计：923 条（各批次原样附后；行内 // DEFECT: 另计，约 5,000+ 处）。
回绑扫尾（2026-10-26，SA_TS_INVENTORY）：175 个已转文件扫描，实际回绑 7 处（@ts_str_equals）；state 批次转换期内回绑 @ts_str_trim/@ts_str_compare/@ts_math_rounding 等；async/Promise 共 94+ 条改记为修复阶段参照 async.sla/future.sa/sync 面；Array/Math/Map-Set 多数候选因类型模型不合未硬绑，候选与理由见各批次日志末尾「回绑扫尾」节。

前 5 类缺陷（全单元综合）：
1. React hooks 语义（useState/useEffect/useRef/useMemo/useCallback 等）无 SLA 对应 -> State struct + 普通函数、调用方驱动重入。
2. 闭包/箭头回调捕获可变状态 -> 提升顶层 fn + 显式状态参数。
3. 动态对象/Record/unknown/JSON -> JSON 文本缓冲 + has 标志。
4. async/await/Promise -> 同步 + 状态码；修复阶段参照 sa_std async.sla/future.sa/sync。
5. 可选链/空值合并/展开 + 数组高阶方法 + Map/Set -> 显式分支、for 循环、定长表（部分已绑 ts_array/collections 候选待修复阶段定版）。


===== 批次 web-ts-wb-a（日志条目 113）=====

# web-ts-wb-a 单元缺陷日志

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

源根：apps/web/src/app/workbench/（CXU plugins @ f2cb649d）

## 通用（跨文件）

- workbench/*.ts | React hooks（useState/useEffect/useLayoutEffect/useCallback/useMemo/useRef、Dispatch/SetStateAction/MutableRefObject） | SLA 无 React 运行时与 hooks 语义（依赖数组、重渲染、effect 时序） | hook 转普通函数 + 显式 State struct；setter 记为字段写，Dispatch/SetStateAction/MutableRefObject 记为 handler handle / xxxRef_current 字段，并逐文件登记
- workbench/*.ts | async/await、Promise、try/catch/finally、throw Error | SLA 无 Promise/异常 | 同步函数 + 状态码，错误走 err 缓冲；finally 的 setter 写在每条路径重复；catch 分支按状态码分支
- workbench/*.ts | 动态 JSON（unknown、JsonValue、Record<string, *>、对象字面量拼装、spread、optional chaining） | SLA 无动态对象 | JSON 文本缓冲（JsonBuf）+ 占位字段 getter（sa_json_*），拼装/遍历推迟到修复阶段并在行内注释保留结构
- workbench/*.ts | Map/Set、泛型、ReturnType<typeof …>、Pick/Extract、索引访问类型（ClientState["turns"] 等） | SLA 无对应类型机制 | Map/Set 以 JSON 文本缓冲表示；ReturnType/Pick 摊平为字段或 opaque handle；索引访问类型以 JSON 缓冲表示
- workbench/*.ts | 闭包捕获可变状态（updater 函数、嵌套 closure、回调参数） | SLA 无闭包 | 显式 frame struct + 同级函数；functional updater 以 handle + 原值双路表示
- workbench/*.ts | 字符串模板字面量、Date.now()/Math.random()/crypto.randomUUID() | 无模板字面量与这些运行时 API 的 SLA 对应 | 缓冲拼接近似；时间/随机 id 以占位 0 表示

## appConstants.ts

- appConstants.ts:8-31 | const 对象 + `as const`（UI_STORAGE_KEYS） | 无字符串键 const record | 每键一个全局 string let，键名 1:1
- appConstants.ts:33-50 | 对象字面量数组 Array<ModelEntry & {…}> | 无对象数组字面量 | 平行字符串表（id/displayName 逐条）+ COUNT 常量
- appConstants.ts:66-71 | AppProps 回调字段（onThemeModeChange 等） | 无函数类型字段 | u64 handler handle；ThemePlugin[] 以 JSON 缓冲
- appConstants.ts:80-83 | DOM Event 交叉类型 + Promise 字段（BeforeInstallPromptEvent） | 无 DOM/Promise | struct + 状态码字段（prompt_status/userChoice_status）
- appConstants.ts:85-102 | StartCodexTurnOptions 可选字段 + onTurnStarted 回调 | 无可选字段/回调类型 | 每字段加 has_ 前缀 bool；回调为 handle
- appConstants.ts:118-124 | DetachedTaskSnapshot 索引访问类型 ClientState["threads"][number] | 无索引访问类型 | thread/turns/pageState 以 JSON 缓冲
- appConstants.ts:144-147 | SshPreflightResult.reasons: string[] | 无动态数组 | reasons_json JSON 缓冲 + count 字段
- appConstants.ts:157-162 | 共享空数组常量（EMPTY_*，靠 === 身份比较） | 无引用身份语义 | 零长度 count 全局量

## composerCoreContext.ts

- composerCoreContext.ts:24-28 | 联合类型 `| null`（FreebuffFallbackSuggestion） | 无联合类型 | present bool + 摊平字段
- composerCoreContext.ts:30-105 | ComposerCoreInput 巨型 props 类型：Dispatch/SetStateAction（约 20 个 setter）、MutableRefObject（约 14 个 ref）、函数字段（含 Promise 返回） | 无 React 类型体系 | setter/ref/函数一律 handler handle 或 xxxRef_current 字段；Promise 函数另注 async 缺陷
- composerCoreContext.ts:56-61 | refreshFreebuffSession/ensureRuntimeProviderActivated/refreshProviders/loadAuditEvents 返回 Promise | 无 Promise | handler handle + async 登记
- composerCoreContext.ts:77-83 | Map<string, number>、Set<string>、Record<string, number|null> ref | 无 Map/Set/Record | JSON 文本缓冲字段
- composerCoreContext.ts:107-119 | `& Pick<ThreadRuntimeSelectionsDomain, …>` 映射类型交叉 | 无 Pick/映射类型 | 11 个字段摊平为 handle 追加到 struct 尾
- composerCoreContext.ts:120 | `export type { JsonValue }` 再导出 | 无类型再导出 | 仅注释保留

## socketPipelineContext.ts

- socketPipelineContext.ts:23-35 | ModelCapacityRetryEntry.errorTurnIds: Set<string>、timer: number|null | 无 Set/可空 | JSON 缓冲 + has_ bool
- socketPipelineContext.ts:37-46 | FreeCompactionWaiter 的 resolve/reject/cancel Promise 回调三元组 | 无 Promise 回调 | 三个 handler handle
- socketPipelineContext.ts:54-97 | SocketPipelineInput：ReturnType<typeof useTopicTranscriptRuntime>、ReturnType<typeof createTaskNotificationTracker> 推断返回类型 | 无类型推断 | opaque handle
- socketPipelineContext.ts:68 | applyTurnRetryState 参数为值 | 更新函数 的联合 | 无函数联合 | handler handle，updater 形式另注
- socketPipelineContext.ts:73-76 | Map<string, ModelCapacityRetryEntry>、Map<string, FreeCompactionWaiter>、Set<string> refs | 无 Map/Set | JSON 文本缓冲字段
- socketPipelineContext.ts:77 | freeCompactAfterTurnRef 为可空异步函数 ref | 无可空函数类型 | handle + has_ bool

## modelSelectionUtils.ts

- modelSelectionUtils.ts:6-16 | 数组 filter/find 链式回退（7 级 ?? 回退）+ 数组下标 provider.groups?.[0] | 无高阶数组方法/可选链 | 多趟 for 扫描同一谓词，顺序与回退链 1:1 保留
- modelSelectionUtils.ts:18-57 | buildNewChatBackendPreview 返回动态对象 Record<string, JsonValue> | 无动态对象 | 序列化为 JSON 文本缓冲（结构以注释保留）
- modelSelectionUtils.ts:22-28 | permissionToTurnOverrides（@codex-ui/shared）+ Number()/Number.isFinite 解析 budgetLimit | 共享单元未链接；字符串转数未实现 | 占位函数返回空字段；budget 解析推迟
- modelSelectionUtils.ts:59-85 | providers.find(...) + resolveRelayTextRuntimeSelection（groupCollection 单元） | 跨单元未链接，.model/.groupId 语义在对方单元 | 占位实现回显 selectedModel/groupId
- modelSelectionUtils.ts:87-94 | isLikelyImageModelId 的 RegExp（含 \b 边界、/i） | 无正则引擎 | 小写化后子串扫描同一 token 集，词边界语义丢失
- modelSelectionUtils.ts:96-156 | trim().toLowerCase() === "openai" 等字符串链式操作 | 无字符串方法 | 近似为字面比较（在行内注明）

## preferenceUtils.ts

- preferenceUtils.ts:33-210 | localStorage / window.localStorage 读写与枚举（length/key/removeItem） | 无浏览器存储 | sa_local_storage_* 占位 extern（get/remove/length/key）
- preferenceUtils.ts:35-139 | JSON.parse + unknown 值 + 类型谓词 filter（entry is ThemeId 等） | 无 JSON 运行时/类型谓词 | 值以 JSON 文本传入；preferenceRecord 以首字节 '{' 近似对象判定；数组走查推迟
- preferenceUtils.ts:42 | 日期校验正则 /^\d{4}-\d{2}-\d{2}$/ | 无正则 | is_date_str 逐位数字/连字符检查（等价）
- preferenceUtils.ts:50-60 | Boolean(JSON.parse(raw)) 真值强制 | 无 JSON 值语义 | 仅 "true"/"false" 字面判定，其余回 fallback（近似）
- preferenceUtils.ts:86-91 | Object.entries/Object.fromEntries（Record<string, number>） | 无动态对象枚举 | JSON 缓冲出入，走查推迟
- preferenceUtils.ts:101-103 | localeOptions.some(...)（i18n 单元数据） | 跨单元数据未链接 | localeOptions 以 JSON 参数传入，.some 推迟，默认 null
- preferenceUtils.ts:109-117 | isThemeId（theme 单元） | 跨单元未链接 | 占位返回 false
- preferenceUtils.ts:141-160 | Object.values(UI_STORAGE_KEYS) + 正则 replace(/^codex-ultra\./) 批量删键 + 倒序索引遍历删除 | 无对象枚举/正则 | 仅 4 个字面键删除已写出；其余以注释保留全量逻辑，providers-cache 倒序扫描骨架保留

## sshUtils.ts

- sshUtils.ts:6-12 | trim + 正则 replace(/\/+$/, "") | 无字符串方法/正则 | 手写 trim_range + 尾斜杠剥离循环（等价）
- sshUtils.ts:18-38 | addWorkspaceRpcMetadata 就地变异 Record<string, JsonValue> + 条件 spread | 无动态对象变异 | 结果以 JSON 缓冲表示，结构注释保留
- sshUtils.ts:40-161 | 8 个 async fetch 函数（fetch/await response.json().catch、throw new Error、模板串错误消息） | 无 fetch/Promise/异常 | 同步 sa_http_fetch_json 占位 extern + 状态码 + err 缓冲；端点/方法/body 字段逐个保留
- sshUtils.ts:103-112 | preflightSshWorkspace 中 asRecord/stringValue 对响应 JSON 的字段提取（含 === true 判定） | JSON getter 未实现 | 字段映射以注释 1:1 保留，提取推迟
- sshUtils.ts:114-125 | flatMap 投影（缺 alias/hostname 的条目丢弃、port ?? 22 等默认值） | 无 flatMap/JSON 走查 | 映射规则注释保留，走查推迟
- sshUtils.ts:163-168 | sshCodexInstallCommand 的 toLowerCase/includes | 无字符串方法 | 字面比较近似（windows 子串分支注明推迟）

## appUtils.ts

- appUtils.ts:17-19 | navigator.userAgent + 正则 /\bElectron\/\d/i | 无 navigator/正则 | userAgent 作参数传入 + 子串近似
- appUtils.ts:21-35 | 泛型 withTimeout<T>（Promise.race/setTimeout/finally）与 waitForNextPaint（requestAnimationFrame + Promise 构造器） | 无泛型/Promise/定时器/rAF | 状态码 shell，明确标未实现
- appUtils.ts:41-58 | findLastTurnUsage/extractTurnIdFromRpcResult 对 Record/array JSON 的走查 | JSON getter 占位 | sa_json_get_* 占位 + 逆序查找逻辑注释
- appUtils.ts:60-83 | turns.find/filter/reduce + item 类型过滤（hasRealUserMessageForPending/countMatchingRealUserMessages） | 无高阶方法/JSON 走查 | 计数逻辑注释保留，实现推迟
- appUtils.ts:96-113 | parseReviewCommand 三处 RegExp exec（detached 前缀/branch/commit 捕获组） | 无正则 | 前缀扫描近似，分支推迟；结果以 JSON 缓冲
- appUtils.ts:164-184 | latestRunningPlanStep 嵌套逆序遍历 + plan.find 闭包 + 状态名正则 replace(/[_-]+/g,"") | 无闭包/正则/JSON 走查 | 算法注释保留，实现推迟
- appUtils.ts:194-202 | appendBoundedTerminalOutput 的 160000 字符切片（slice(-N)） | StrBuf 容量（8KB）远小于上限 | 头标记逻辑保留，精确切片推迟并注明
- appUtils.ts:218-263 | waterfallFileChangePaths 递归遍历 + 闭包 + Set<object> 循环访问守卫 + forEach | 无递归闭包/对象身份 Set | JSON 进出 shell，遍历规则注释保留
- appUtils.ts:269-347 | parseThreadTokenUsage/parseTokenBreakdown/parseTokenUsageBillingSnapshot 的字段别名链（camel ?? snake）+ 条件 spread 可选字段 + numberField 变参 | JSON getter 占位、无变参 | struct + has_ 标志；numberField 的 keys 改 JSON 数组参数；提取推迟
- appUtils.ts:333-347 | buildHistoryUsageByThread 的 Object.fromEntries/entries/map | 无动态对象枚举 | JSON 进出 shell
- appUtils.ts:391-427 | TranslateFn 带插值参数调用（t(key, {seconds, reason})） | i18n 未链接 | translate 占位回显 key，插值参数推迟
- appUtils.ts:453-482 | formatErrorText 的 instanceof Error、递归自调用、JSON.stringify、String(error) | 无 Error 类/反射 | 原文回显近似，递归规则注释保留
- appUtils.ts:484-494 | debugLog 的 localStorage 守卫 + console.debug + try/catch | 无浏览器 API | 占位空函数
- appUtils.ts:496-530 | syncWorkspaceFromThread 的 8 个可选 setter 回调（?. 调用） | 无可选回调 | handle + has_ 形式入参，分支结构注释保留
- appUtils.ts:532-565 | sanitizeDomId/sideChatTitle 正则（[^a-z0-9]+、\s+、^-+|-+$） | 无正则 | 单趟扫描折叠（等价近似）
- appUtils.ts:567-580 | decodeBase64Text/encodeBase64Text 的 window.atob/btoa、Uint8Array.from、TextDecoder/TextEncoder | 无浏览器编解码 API | sa_base64_* 占位 extern
- appUtils.ts:582-613 | buildRequestMonitorEntries 的 new Map(threads.map(...)) + filter/slice/map | 无 Map/高阶方法 | JSON 进出 shell，投影规则注释保留

## useAccessRuntime.ts

- useAccessRuntime.ts:48-213 | 聚合 hook：约 30 个 useState/useRef + 6 个子 hook 调用（useSessionState/useCliPrerequisites/useMembersAdmin/useWorkspacePicker/useSshWorkspace/useHistoryState） | 无 hooks/子 hook 链接 | UseAccessRuntimeState 大 struct + init 占位赋值；子 hook 字段按解构顺序入 struct
- useAccessRuntime.ts:130 | 渲染期赋值 turnRetryStateRef.current = turnRetryState | 无渲染周期 | 在 applyTurnRetryState 内显式同步 ref 字段
- useAccessRuntime.ts:131-138 | applyTurnRetryState 的 SetStateAction updater 函数 + resolveTurnRetryState | 无 updater 语义 | resolve 占位（返回 next），updater 以 handle 表示
- useAccessRuntime.ts:148-150 | 渲染期惰性构造 if (!usageStoreRef.current) usageStoreRef.current = new TopicUsageStore()（class 实例） | 无 class | handle 占位（=1）
- useAccessRuntime.ts:152-181 | flushThreadTokenUsage 的 startTransition + useLayoutEffect/useEffect 清理 + window.setTimeout/clearTimeout | 无 React 调度/定时器 | 显式函数 + timer has_ 标志；startTransition 以直接 move 近似
- useAccessRuntime.ts:139-147 | modelCapacityRetryRef: useRef(new Map(...))、useRef(new Set)（pendingAcceptedThreads 初值）等集合初值 | 无 Map/Set | JSON 缓冲字段

## useCodexConfig.ts

- useCodexConfig.ts:19-147 | hook（4 个 useState + 3 个 useCallback） | 无 hooks | State struct + 普通函数，setter 为字段写
- useCodexConfig.ts:43-129 | loadCodexConfig/writeCodexConfigField/writeCodexConfigValue 的 async + client.rpc await 链 + try/catch/finally | 无 Promise/异常 | sa_client_rpc 同步占位 + 状态分支；finally 的 setSaving(false) 每路径重复
- useCodexConfig.ts:60-62 | authSession?.user.role !== "admin" 的 JSON 字段判定 | JSON getter 占位 | 角色检查推迟并注明
- useCodexConfig.ts:68-71 | codexConfig[field] 动态键索引比较（no-op 跳过） | 无动态键 | 推迟并注明
- useCodexConfig.ts:75,107 | 函数式 setState（setCodexConfig(current => applyConfigWriteToView(...)) 乐观更新） | 无 updater | 乐观更新推迟，调用点以注释保留

## useFreebuffSession.ts

- useFreebuffSession.ts:25-123 | hook（7 个 useState + useEffect + 5 个 useCallback） | 无 hooks | State struct + init/普通函数；useEffect 持久化改为显式 sync 函数由调用方驱动
- useFreebuffSession.ts:30 | useState 惰性初始化 () => readStoredBoolean("codex_freebuff_auto_failover", true) | 无惰性初始化/localStorage | init 中以默认值 true 近似并注明
- useFreebuffSession.ts:42-96 | refresh*/handle* 的 async + 被导入的 fetch*/release* HTTP 函数 | 无 Promise/HTTP | 同步占位（fetchFreebuffSessionStatus 等）+ 状态码
- useFreebuffSession.ts:69-74 | setSlashNotice 对象中 `freebuff-slot-released-${Date.now()}` 模板 id | 无 Date.now/模板串 | id 构造推迟并注明

## useGoalRuntime.ts

- useGoalRuntime.ts:50-63 | input 中 4 个 ReturnType<typeof use*Runtime> 推断类型 | 无类型推断 | opaque handle，解构字段清单入缺陷日志正文（.sla 注释）
- useGoalRuntime.ts:293-297 | useMemo(() => new CodexSocketClient()) + clientRef.current 赋值（class 构造） | 无 class/useMemo | handle 占位
- useGoalRuntime.ts:298-316 | useGoalLifecycle 的 getTurns/startContinuation/reportError 闭包（含内联 options 对象） | 无闭包 | 子 hook 调用占位，闭包实参以注释 1:1 保留
- useGoalRuntime.ts:319-345 | conversationWorkspaceMetadata/resolveThreadWorkspace 派生值 + render 期 cwdForThreadRef.current = cwdForThread | 无渲染周期 | init 中计算（占位），派生公式注释保留
- useGoalRuntime.ts:350-420 | useMemo（activeWorkspaceDirectories、composerModels）与 5 个 useEffect | 无 memo/effect | compute 函数 + caller 驱动的 effect 函数；composerModels 的 Map 构建/变体展开推迟
- useGoalRuntime.ts:382-401 | composerModels 的 Map<string, ModelEntry> + expandModelContextVariants + 对象 spread 合并 metadata | 无 Map/动态对象 | JSON 缓冲，映射规则注释保留

## useComposerThreadStart.ts

- useComposerThreadStart.ts:78-262 | ensureActiveThread：async useCallback（约 185 行）含多级三元/provider 回退链、await refreshProviders/activateProvider/rpc/persist/sync | 无 Promise | 同步 + 状态码 + err 缓冲；回退链与字段清单以注释 1:1 保留，主体推迟
- useComposerThreadStart.ts:199-207 | void saveThreadAgentRoster(...).catch(dispatch) 的 fire-and-forget Promise | 无 Promise | 明确登记：修复阶段须改显式队列任务
- useComposerThreadStart.ts:232-261 | catalogThread 对象字面量（spread startedThread + 条件 spread ssh 字段 + ?? 回退） | 无动态对象/spread | 字段清单注释保留
- useComposerThreadStart.ts:264-307 | recordInterruptRetry 的对象字面量 item 构造（模板串 additionalDetails）；interruptTurn 的 interruptTurnGateRef.current.run(closure) + rpc 适配器闭包 | 无闭包/门控类 | InterruptRetryEvent struct；gate 互斥语义丢失，顺序近似

## useComposerSend.ts

- useComposerSend.ts:61-98 | input 交叉类型 ComposerCoreInput & {…}，含 ReturnType<typeof useComposerAssists>[…] 索引挑取与 GoalLifecycle[…] | 无交叉/索引类型 | UseComposerSendInputExtra struct，回调为 handle
- useComposerSend.ts:137-253 | handleComposerSlashCommand 的 switch 分发（16 个 case，含 command 联合类型的字段收窄） | 无判别联合收窄 | type_tag 字符串分支骨架，逐 case 动作以注释保留
- useComposerSend.ts:255-292 | sendPrompt 的 freeCompactBarrierRef/jevCompressDirectiveRef 可选调用 ?.() + try/catch 吞错 + 模板串拼接指令 | 无可选调用/异常 | has_ 标志 + 忽略状态近似，流程注释保留
- useComposerSend.ts:294-557 | sendSideChatPrompt：Set in-flight 守卫、setSideChatTabs 的 map updater 闭包（多处）、Date.now/Math.random id、async thread/turn start 链 | 无 Set/updater/闭包 | 流程注释 1:1 保留，主体推迟；duck 默认路由与 pureChat 分支规则完整记录

## useComposerRuntime.ts

- useComposerRuntime.ts:47-61 | input 含 6 个 ReturnType<typeof …> runtime 包 | 无类型推断 | opaque handle
- useComposerRuntime.ts:276 | composerCore 对象字面量组装（约 90 个字段的 bundle） | 无对象字面量 | 以 JSON 缓冲表示，字段清单注释 1:1 保留
- useComposerRuntime.ts:277-303 | 子 hook 串联（ThreadStart→Pipeline→ProviderTest→Assists→Send→FreeCompaction→GitFiles→WorkbenchOps→TurnOps）+ startCodexTurnRef.current 渲染期赋值 + 三个 ref 的 current 回填（freeCompactBarrier/freeCompactAfterTurn/jevCompressDirective） | 无 hooks/渲染周期 | init 中占位串联，实参清单注释保留；ref 回填为显式赋值点注明
- useComposerRuntime.ts:284-290 | useEffect 的 window.addEventListener("codex-ultra:workbench-activate", CustomEvent) + 清理函数 | 无 DOM 事件 | 空 effect 函数 + 说明
- useComposerRuntime.ts:358-407 | configured/displayed 两条 context window 派生链（providers.find、groups.find、modelCapabilities 索引、resolveModelContextWindow）+ useLayoutEffect 发布 | JSON 走查占位、无 layout effect | compute 函数占位，派生公式注释保留
- useComposerRuntime.ts:421-427 | useEffect 清理遍历 officialOAuthSessionsRef Map.values() 调 cancel(Error) | 无 Map/Error | 占位
- useComposerRuntime.ts:429-445 | exportHistoryThread 的 async + loadCompleteCodexHistory + downloadTextFile（DOM 下载） | 无 Promise/DOM | 状态码函数，流程注释保留
- useComposerRuntime.ts:478-494 | 主题派生（useMemo allThemePlugins 的 filter/some 去重、safeThemeAssetUrl/VideoUrl 链、windowsDesktop 平台判定） | JSON 走查占位 | compute 函数占位，派生规则注释保留
- useComposerRuntime.ts:527-552 | runningThreadIds 的 useMemo 两趟 Map/Set 算法 + useEffect 中 setTaskTabOrder updater 内 openTaskTab 折叠 | 无 Map/Set/updater | JSON 缓冲；两趟算法注释完整保留

## useComposerPipeline.ts

- useComposerPipeline.ts:103-682 | startCodexTurn 单个 async useCallback（约 580 行）：多段 await、嵌套 try/catch/finally、错误分类路由（writer conflict / Freebuff 锁定与配额 / 远端错误 kind） | 无 Promise/异常 | 同步 + 状态码；全流程按源行号段注释 1:1 保留，主体推迟
- useComposerPipeline.ts:132-161 | 同步去重 dedupeKey（模板串拼 key）+ 60s 在途窗口 + clearSendDedupe 闭包 | 无闭包/Date.now | StartCodexTurnFrame struct + 同级函数；时间占位
- useComposerPipeline.ts:389-454 | 嵌套闭包 startNewTurn/stopReviewAndStart（捕获 turnParams/options/refs）+ observeTurnStarted waiter 对象（waitFor/dispose） | 无闭包/waiter | frame struct + 同级函数占位，waiter 语义推迟
- useComposerPipeline.ts:162-183 | setPendingAppends/setPendingAcceptedThreads 的函数式 updater（Set 不可变更新） | 无 updater/Set | map/filter 规则注释保留
- useComposerPipeline.ts:455-517 | turn/steer 重试状态机（extractActualActiveTurnId、isTurnNoLongerActiveError、isCannotSteerReviewTurnError 分支） | 依赖 rpc 占位 | 分支逻辑注释完整保留
- useComposerPipeline.ts:524-560 | 超时歧义对账 isAmbiguousSendError/reconcileAmbiguousSend（() => turnsRef.current 闭包）+ committedTurnResult 提交后吞错 | 无闭包/Promise | 规则注释保留（源注释大意已转录）

## useComposerAssists.ts

- useComposerAssists.ts:60-96 | input 交叉类型，含 GoalLifecycle[…] 索引、MutableRefObject<Map<string, AbortController>>、Set refs | 无索引类型/AbortController | InputExtra struct，handle/JSON 近似
- useComposerAssists.ts:116-152 | schedulePlanContinuation 的 window.setTimeout 回调 + Set 守卫 + void … .finally(...) | 无定时器/Set/Promise | 守卫与回调体注释保留，定时器占位
- useComposerAssists.ts:154-182 | 3 个 useEffect（plan 完成监视、切换时禁用其他线程、卸载清定时器） | 无 effect | caller 驱动的 effect 函数占位
- useComposerAssists.ts:203-423 | setGoalForActiveThread/renameActiveThread/startReview/compactActiveThread/resumeThreadFromSlash 的 async + rpc + try/catch dispatch 模式 | 无 Promise/异常 | 同步状态码函数，逐函数的 gate/参数/notice 规则注释保留
- useComposerAssists.ts:425-580 | runImageCommand 的 Extract<ComposerSlashCommand, {type:"image"}> 收窄、crypto.randomUUID、imageJobsRef AbortController 图、withTimeout(saveImageHistory) 嵌套 try/catch、waitForNextPaint | 无收窄/UUID/AbortController | command 以 JSON 传入；流程注释保留
- useComposerAssists.ts:582-599 | answerRequest/respondToServerRequest 的 string | number 联合 id | 无联合类型 | (id_ptr, id_number, id_is_number) 三元组参数

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层，String）：appUtils / modelSelectionUtils / preferenceUtils / sshUtils / useComposerSend / useComposerThreadStart 六个文件中的手写字节扫描桩 `str_eq` / `str_eq_bytes`（(ptr,len) 逐字节相等扫描）已删除，改为文件头 `@import "sa_std/ts_string.sa"` + 函数体改绑 `@ts_str_equals`，原函数签名保留 1:1；modelSelectionUtils 的 `buf_eq_lit` 经 str_eq 委托一并回绑。本日志中涉及 (ptr,len) 字符串值相等近似的记述改记为「已绑 sa_std ts 面（@ts_str_equals）」。
- 未回绑注记（只标注、不硬绑，修复阶段按 SA_TS_INVENTORY 评估）：appUtils 的 `trim_range`——@ts_str_trim 返回 {ptr,len} 句柄，与现有 out 起止下标契约不合；appUtils/modelSelectionUtils 的 `buf_contains` 子串扫描与 sshUtils 的 windows 子串检查占位——候选 string.sai 的 sa_string_index_of，返回约定（下标/-1）待核对；preferenceUtils 的 `lower_trimmed`——trim+toLowerCase 复合操作，ts 面无 lowercase 对应。
- async 归类改记：本日志 async/Promise 条目共 17 条，修复阶段不再默认「无对应」，改记为参照 sa_std async 面评估（async.sla 的 sched_*/block_on_timeout、future.sa、sync/mpsc.sa、sync/mutex.sa、thread.sa）；代码层本轮不重构。
- 其余未回绑分类计数（条目可跨类重复计数）：String 10、Array 9、Math 2、RegExp 8、Map/Set 16——多为 JSON 文本缓冲/handle 近似，无独立扫描桩，或操作对象与 ts 面的 {ptr,len} 句柄 / word 数组模型不合，待修复阶段按 SA_TS_INVENTORY 逐条评估。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。

===== 批次 web-ts-wb-b（日志条目 87）=====

# web-ts-wb-b 缺陷日志（apps/web/src/app/workbench/，13 文件）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## useHistoryState.ts (49 行)
useHistoryState.ts:1-23 | React hooks useState/useRef | SLA 无 React/响应式状态，setter 触发重渲染无对应 | struct 字段 + setXxx 函数族，状态变更不触发任何渲染
useHistoryState.ts:10-12 | useState<T>(() => init) 泛型+惰性初始化闭包 | SLA 无泛型、无闭包 | 类型擦除为具体字段，readHistoryDateRange/readLegacyHistoryViewMode 改急切调用
useHistoryState.ts:16 | Record<string, ThreadHistoryPageState> 动态对象 | SLA 无动态对象/字符串键映射 | JSON 文本缓冲 (ptr,len)
useHistoryState.ts:17 | useRef<ClientState["threads"]> 索引访问类型+数组 | 无索引类型、无动态数组 | threads 整体作 JSON 文本缓冲
useHistoryState.ts:24-48 | 返回对象字面量汇集 state+setter | SetStateAction<T>（值|更新函数）无对应 | 返回 struct，setter 仅接受直接值，更新函数形态未复现

## useImmersiveComposer.ts (139 行)
useImmersiveComposer.ts:5-12 | useState 惰性初始化 readStoredBoolean | 无 hooks/闭包 | struct 字段急切赋默认值 false
useImmersiveComposer.ts:13-25 | useRef<HTMLDivElement|null> 与拖拽状态对象 ref | SLA 无 DOM 元素类型 | dock 以 present 标志+偏移字段近似，drag 对象展开为定长 struct
useImmersiveComposer.ts:26-31 | dock.style.setProperty + 模板字面量 `${x}px` | 无 DOM/CSS 自定义属性、无模板字面量 | 偏移值仅记录到字段，CSS 写入缺失
useImmersiveComposer.ts:32-45 | hasPointerCapture/releasePointerCapture、dataset | 无指针捕获 API | no-op，仅维护 dragging 标志
useImmersiveComposer.ts:46-74 | ReactPointerEvent、target.closest(选择器)、getBoundingClientRect、window.innerWidth/innerHeight | 无 DOM 事件/几何 API | PointerEventLike struct 由宿主填充，closest 结果以 target_is_interactive 布尔传入
useImmersiveComposer.ts:75-94 | Math.min/max 钳制 + Math.round | 基本可用但逐项展开 | 手工比较钳制，round 以整数坐标省略
useImmersiveComposer.ts:108-112 | setImmersiveHintSequence((current)=>current+1) 更新函数 | 无更新函数式 setter | 直接自增字段

## useLoadBasics.ts (206 行)
useLoadBasics.ts:58 | useRef<Promise<void>|null> 在途请求去重 | SLA 无 Promise | bool 在途标志，共享在途 Promise 的返回语义未复现
useLoadBasics.ts:59-76 | async loadBasics + Promise.all().then() | 无 async/await/Promise | 同步顺序调用 + 状态码，Promise.all 并发丢失
useLoadBasics.ts:78-206 | async IIFE + Promise.allSettled | 无 allSettled 结果联合 {status,value|reason} | 三分支顺序执行、各自状态码，failures 数组以 first_failure 近似
useLoadBasics.ts:88-120 | .then(async ...) 嵌套 Promise 链（detached 线程分页/legacy 文件判定） | 无 Promise 链 | 链展平为顺序分支，fileInfo 大小判定保留调用序
useLoadBasics.ts:110-118 | loadAllThreads 的 onProgress 回调闭包捕获 listedPages | 无闭包捕获可变状态 | listedPages 提为 input struct 字段，进度回调由宿主内联
useLoadBasics.ts:160-172 | startTransition、对象展开 {...current,[id]:pageState} 计算键 | 无 React transition、无展开/计算键 | dispatch 直接调用，页状态合并由宿主对 JSON 缓冲处理
useLoadBasics.ts:183-186 | window.setTimeout(320ms) 清 progress | 无定时器 | clearProgressDeadline_ms 字段，宿主负责到期清理
useLoadBasics.ts:196-204 | task.finally() 清理在途标志 | 无 finally/Promise.finally | 函数末尾内联清理

## useMembersAdmin.ts (110 行)
useMembersAdmin.ts:20-36 | async reloadMembers + try/catch/finally | 无 async、无异常 | 同步+状态码，finally 的 setMembersLoading(false) 内联
useMembersAdmin.ts:23 | authSession?.user?.role 可选链 | 无可选链 | 显式判空 + role 长度近似比较
useMembersAdmin.ts:38-97 | async handle* + throw new Error("Not authenticated") | 无 throw | 状态码 1 表示未认证
useMembersAdmin.ts:55 | Record<string, unknown> 更新入参 | 无动态对象 | JSON 文本缓冲
useMembersAdmin.ts:75-97 | handleAllocateMemberBalance 内嵌 try/catch 吞错刷新自身 session | 无异常吞噬语法 | 状态码判断，失败忽略（与源 catch{/*ignore*/} 语义一致）
useMembersAdmin.ts:15-19 | AuthUser[] / AuthSession 动态类型 | 无对应结构 | JSON 文本缓冲

## useNewSessionFlow.ts (676 行)
useNewSessionFlow.ts:32-66 | 入参 ComposerCoreInput & 多个 Pick<>/交叉类型、约 90 个解构字段 | SLA 无交叉/Pick 泛型类型 | 展平为一个 input struct，动态部分作 JSON 缓冲+具名字段
useNewSessionFlow.ts:114-141 | openExistingThread async + 多段 .then() 链（持久化选择、目标冻结） | 无 Promise 链/闭包 | 顺序调用近似，各 .then 的逐字段 setter 序列由宿主实现保留顺序
useNewSessionFlow.ts:126-135 | setTaskTabOrder(current=>openTaskTab(...))、filter 闭包 | 无更新函数/Array.filter 闭包 | 宿主应用标签更新
useNewSessionFlow.ts:209-244 | beginNewSession 内嵌套三元链构造 backendInit（8 种 cliBackend 字面量联合） | 无对象字面量联合/展开 ...backendInit | 抽为 backendInitForNewSession 输出 JSON 缓冲；字面量以 (ptr,len) 比较
useNewSessionFlow.ts:246-328 | requestNewSession 几乎整段复制 beginNewSession 的 backendInit 计算 | 源即重复（1:1 保留，不去重） | 两处均调用同一近似函数并注明源重复
useNewSessionFlow.ts:99-112 | fetchWorkspaceSaVmStatus().then().catch(()=>{}) | 无 Promise | 顺序调用，错误忽略与源 catch 一致
useNewSessionFlow.ts:383-405 | ensureWorkspaceAgents 使用浏览器 fetch/Response.json()/JSON.stringify | sa_std 无 fetch 对应（浏览器侧） | fetch_http extern 桩，状态码+JSON 缓冲
useNewSessionFlow.ts:391 | `AGENTS.md update failed: ${response.status}` 模板字面量报错 | 无模板字面量 | dispatch 通用 error action，文案拼接丢失
useNewSessionFlow.ts:407-449 | Number(trimmedBudget)/Number.isFinite 校验字符串预算 | 无 JS Number 语义 | 宿主辅助校验，分支顺序保留
useNewSessionFlow.ts:577-660 | selectProviderForCurrentThread 中 providers.find/filter 闭包、自由 buff 覆盖逻辑 | 无闭包谓词遍历动态 JSON | 宿主在 JSON 缓冲上解析，分支（agy-official/agy-launch/grok-official 先行）按源序保留
useNewSessionFlow.ts:611 | Promise.reject(new Error(`Provider not found: ${providerId}`)) | 无 Promise.reject/模板字面量 | 状态码 5
useNewSessionFlow.ts:330-347 | nextWorkspaceFilePath?: string|null 三态（undefined/null/值） | 无 undefined | nextFilePath_given 标志区分未传

## useOfficialLogin.ts (148 行)
useOfficialLogin.ts:20-29 | new Promise<void>(executor) + resolve/reject 捕获 | 无 Promise | completion_status 字段（0 pending/1 resolved/2 rejected）
useOfficialLogin.ts:18 | useRef(new Map<string,(reason?:Error)=>void>) 存回调 | 无 Map、无函数值 | 定长数组 16 槽存 loginId，回调改按 id 匹配路由到 cancel 路径
useOfficialLogin.ts:36-89 | finalizeLogin async + Promise.all([account/read, model/list]) | 无并发 Promise | 顺序两次 rpc
useOfficialLogin.ts:45-48 | [...new Set(models.map(...).filter(Boolean))] 提取 modelIds | 无 Set/map/filter 于动态 JSON | modelIds 整体作 JSON 缓冲由宿主提取，空数组判定以长度近似
useOfficialLogin.ts:53-83 | ProviderConfig 大对象字面量 + 展开 ...(existing ?? {}) | 无展开/动态对象 | 单个 JSON 缓冲由宿主构造
useOfficialLogin.ts:99-106 | client.addEventListener("server-message", onMessage) + CustomEvent detail | 无 EventTarget | host 须显式调用 onMessage 函数转发事件
useOfficialLogin.ts:107-110 | window.setTimeout 10 分钟超时 reject | 无定时器 | timer_deadline_ms 字段
useOfficialLogin.ts:112-130 | account/logout 的 .catch(()=>undefined) 吞错 | 无 Promise catch | 调用后忽略其状态码（与源一致）

## usePreferencesSync.ts (371 行)
usePreferencesSync.ts:160-169 | useEffect + window.setTimeout(500) 打开 setup guide | 无 hooks/定时器 | effect 函数 + setupGuideTimer_deadline_ms 字段，宿主驱动
usePreferencesSync.ts:171-262 | useEffect 一次性加载：fetchUserPreferences().then(长串 parse*/setter) + cancelled 闭包标志 | 无 Promise/闭包 | 同步函数 + cancelled 字段；约 30 个 parse/setter 步骤按源序注释保留，由宿主 parse 辅助执行
usePreferencesSync.ts:183-202 | parseWorkspacePreference 三分支（ssh/local/无）含 ?. 与 ?? | 无可选链/空合并 | presence 标志分支
usePreferencesSync.ts:264-313 | useEffect 拉 workspace roots，catch 中 instanceof LoginRequiredError/WorkspaceRootsError 分型 + reasonKey 三元嵌套链 | 无 instanceof/异常类型 | 状态码分型（1=LoginRequired,2=WorkspaceRoots），reasonKey 选择由宿主按 kind/code/status 复现
usePreferencesSync.ts:296-297 | setCwd(current=>current===DEFAULT?next:current) 更新函数 | 无更新函数式 setter | 宿主做条件替换
usePreferencesSync.ts:315-371 | useEffect 防抖保存：构造 UserPreferences 快照大对象 + setTimeout(300) + updateUserPreferences().then(clearLegacy).catch(warn) | 无动态对象/防抖定时器 | 快照作 JSON 缓冲（字段序按源），saveTimer_deadline_ms 字段，保存失败按源仅 warn 吞掉
usePreferencesSync.ts:55 | type LayoutState = Record<string, number> | undefined | 无 Record/undefined | JSON 缓冲

## useProviderTest.ts (92 行)
useProviderTest.ts:11 | StartCodexTurnFn 函数类型（含 import() 类型与 Promise 返回） | SLA 无函数类型/动态 import 类型 | 不透明句柄 + startCodexTurn 桩
useProviderTest.ts:47-66 | async testProviderWithCodex useCallback，依赖数组 | 无 async/hooks | 同步函数 + 状态码，依赖数组语义丢失
useProviderTest.ts:52 | updateNewConversationRuntimeSelection({ fastModeEnabled: true }) 对象补丁 | 无动态对象 | JSON 缓冲调用（文中注释标注）
useProviderTest.ts:68-91 | useEffect 多条件门禁（settingsOpen/pending/activeThreadId/activeProviderId/connected/engine.phase）后 void startCodexTurn | 无 effect 自动重跑 | 显式 effect 检查函数，宿主须在每次相关变化时调用；字符串等值以长度近似

## useProvidersRuntime.ts (545 行)
useProvidersRuntime.ts:93-110 | refreshProviders 返回 Promise + 1.5s 缓存 + 在途 Promise 共享 + .finally | 无 Promise | ref 字段模拟缓存/在途，共享在途 Promise 的等待语义未复现
useProvidersRuntime.ts:112-119 | ensureRuntimeProviderActivated 中模板字面量 activationKey | 无模板字面量 | 宿主拼接键缓冲比较
useProvidersRuntime.ts:139-169 | injectClaudeDesktop for(;;) + window.prompt 回退手动路径 | 无 window.prompt | while true 循环（后不加 ;）+ window_prompt 桩；instanceof 以状态码近似
useProvidersRuntime.ts:171-198 | injectCursorDesktop for(;;) + searchedPath.replace(/regex/) | 无正则 | 宿主提供已剥离 Cursor.exe 的默认路径
useProvidersRuntime.ts:234-266 | createRelayShare 的 AbortController + setTimeout(15s) + DOMException AbortError 判定 | 无 AbortController/DOMException | aborted 标志参数 + 状态码分型，中文错误文案保留为字面量
useProvidersRuntime.ts:268-276 | navigator.clipboard.writeText | 无剪贴板 API | 桩，成功/失败仅改 error 字段路径保留
useProvidersRuntime.ts:285-315 | importRelayShareDirectly 中对象展开、`${id}-shared-${Date.now().toString(36)}` | 无展开/模板/Date.now 进制转换 | 宿主构造 importedProvider JSON
useProvidersRuntime.ts:356-386 | downloadProfile/downloadRelayConfig/downloadRelayBackup 的 Blob+URL.createObjectURL+anchor.click 下载流 | 无 Blob/URL/DOM | downloadJsonFile 宿主桩收 JSON+文件名，文件名模板（含日期）由宿主生成
useProvidersRuntime.ts:388-512 | upload* 的 File.text()+JSON.parse | 无 File API | 调用方传入文件文本 (ptr,len)
useProvidersRuntime.ts:121-137 | saveProvider 中 [saved, ...state.providers.filter(...)] | 无展开/filter | 宿主合并 providers JSON 缓冲

## useSelectionRuntime.ts (426 行)
useSelectionRuntime.ts:22-95 | 组合约 7 个子 hooks（useThreadRuntimeSelections/useFreeCompactionSelection/useFreebuffSession/useCliInstallations/useSessionRecovery/useI18n/useIsMobile）+ MUI useMediaQuery | SLA 无 hooks 组合机制 | 各子 hook 按各自单元转换，本文件以展平字段 + init/effect 函数族近似
useSelectionRuntime.ts:117-123 | 渲染期 planModeEnabledRef.current = planModeEnabled、translateRef.current = t 赋值 | 无渲染周期概念 | init 时赋值一次
useSelectionRuntime.ts:125-131 | useEffect 按 cliBackend 切 mini | 无 effect | 显式 effect 函数
useSelectionRuntime.ts:132-136 | useEffect 中嵌套三元推导 history filter + setHistoryBackendFilter 更新函数 | 无三元链等价简洁式/更新函数 | 按标志顺序的宿主选择 + 注释保留三元链原文
useSelectionRuntime.ts:150-159 | useEffect 卸载清理：遍历 Map values 调 AbortController.abort、clearTimeout | 无 Map 迭代/AbortController | 宿主按计数排空
useSelectionRuntime.ts:171-183 | checkCodexCliUpdate 的 .then().catch(吞错) | 无 Promise | 同步调用，失败忽略（与源一致）
useSelectionRuntime.ts:199-207 | handleCliPluginToggleFromList 的 Promise.then 后续（切 mini/刷新/notice 文案 t() as string） | 无 Promise；t 返回类型断言无对应 | 顺序执行近似
useSelectionRuntime.ts:230-251 | useMemo allowedPermissions：permissionPresets.map/filter + rank Record 对象 | 无 useMemo/闭包过滤 | permissionRank 函数 + JSON 缓冲结果，rank 表以长度近似判定（dangerBypass 与 workspaceAsk 同长需宿主按内容区分，已在代码注释声明）
useSelectionRuntime.ts:270-282 | workspaceRoot.replace(/\/+$/,"") 正则 + startsWith(`${root}/`) | 无正则/模板字面量 | 宿主做去尾斜杠+前缀比较

## useSessionBootstrap.ts (293 行)
useSessionBootstrap.ts:40-155 | useEffect 内 async IIFE 引导（localStorage→fetchSessionToken→startCodexEngine→client.connect→refreshProviders→config/read→loadBasics）+ mounted 闭包 + cleanup | 无 hooks/闭包/IIFE | 单个 effect 函数顺序执行，mounted 提为 struct 字段，cleanup 独立函数
useSessionBootstrap.ts:45-155 | 多层 try/catch + withTimeout(...,8_000,...) 包裹每个 await | 无异常/withTimeout | 状态码分支，8s/握手+1s 超时值以常量保留在调用点
useSessionBootstrap.ts:118-148 | catch 内二次 recheck fetchSessionToken 的 .catch(()=>null) 与逐级判定 | 无 Promise catch | 展平注释保留判定顺序，宿主按序执行 recheck
useSessionBootstrap.ts:157-204 | completeLoginSession async + 内层 void IIFE 尽力而为后置设置 | 无 IIFE | 同步序贯执行，失败仅 warn 的语义以忽略状态码近似
useSessionBootstrap.ts:206-224 | acceptCurrentLegalPolicy 中 {...session, legalConsent} 展开 + 模板字面量 storage key + JSON.stringify | 无展开/模板/JSON.stringify | 宿主构造 JSON 缓冲与 key
useSessionBootstrap.ts:230-251 | handleLogin 返回联合 {requires_2fa,pendingToken}|undefined、"requires_2fa" in result 判定 | 无 in 运算符/联合返回 | out 参数 + 状态码区分 2FA 分支
useSessionBootstrap.ts:35 | window.localStorage 读写 token | 无 localStorage | extern 桩 get/set/removeItem

## useSessionRecovery.ts (89 行)
useSessionRecovery.ts:24-31 | useCallback handleSessionExpired + clientRef.current?.disconnect 可选链 | 无 hooks/可选链 | 普通函数 + 显式判空
useSessionRecovery.ts:33-64 | async recoverOrExpireSession + try/catch 中 instanceof LoginRequiredError | 无 async/instanceof | 同步 bool 返回 + 状态码 1 表示 LoginRequired
useSessionRecovery.ts:66-88 | useEffect keepalive：setInterval + document.addEventListener("visibilitychange") + Date.now 节流 + cleanup 清 interval/监听 | 无定时器/DOM 事件/Date | 显式 refresh 函数由宿主以 now_ms/document_hidden 参数驱动，SESSION_KEEPALIVE_* 间隔以常量近似（MIN 间隔取 60000 占位，宿主须以 appConstants 实际值替换）
useSessionRecovery.ts:15-22 | Dispatch<Parameters<typeof appReducer>[1]> 派发类型 | 无该泛型工具类型 | dispatch 句柄 + action JSON 缓冲

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次无与 ts 面签名确切对应的独立扫描桩。
- async 归类改记：本日志 async/Promise 条目共 24 条（含 useLoadBasics 的 Promise.all/allSettled、useHistoryState 等），修复阶段改记为参照 sa_std async 面评估（async.sla 的 sched_*/block_on_timeout、future.sa、sync/mpsc.sa、sync/mutex.sa、thread.sa）；代码层本轮不重构。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 4、Array 6、Math 1、RegExp 2、Map/Set 5 条（条目可跨类重复计数）。其中 useImmersiveComposer 的 Math.min/max/round 为 f64 钳制/取整，@ts_math_* 为整数面（iabs/imul/ipow/isqrt/minmax/rounding 等），类型不合不硬绑；余为 JSON 缓冲与 handle 近似，无独立扫描桩。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。

===== 批次 web-ts-wb-c（日志条目 191）=====

# web-ts-wb-c 单元缺陷日志

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

apps/web/src/app/workbench/useSettingsAndInstall.ts:1-86 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x16) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useSettingsAndInstall.ts:31-91 | async/await + Promise (x4) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useSettingsAndInstall.ts:19-86 | 闭包/箭头回调捕获可变状态 (x16) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useSettingsAndInstall.ts:31-39 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x2) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useSettingsAndInstall.ts:25-58 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x8) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useSettingsAndInstall.ts:52-58 | WebSocket/事件订阅 (socket/subscribe/onMessage) (x4) | sa_std 无 React 侧 socket 订阅生命周期等价物 | 同步 poll/dispatch 函数族近似 + DEFECT
apps/web/src/app/workbench/useSettingsAndInstall.ts:37-68 | 可选链/空值合并/展开 (.../ ?./ ??) (x3) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useSettingsAndInstall.ts:31-31 | try/catch 异常 (x1) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useSettingsRuntime.ts:1-417 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x16) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useSettingsRuntime.ts:235-382 | async/await + Promise (x2) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useSettingsRuntime.ts:296-417 | 闭包/箭头回调捕获可变状态 (x17) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useSettingsRuntime.ts:38-38 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x1) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useSettingsRuntime.ts:320-323 | 定时器/动画帧 (x2) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useSettingsRuntime.ts:320-323 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x2) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useSettingsRuntime.ts:3-309 | WebSocket/事件订阅 (socket/subscribe/onMessage) (x2) | sa_std 无 React 侧 socket 订阅生命周期等价物 | 同步 poll/dispatch 函数族近似 + DEFECT
apps/web/src/app/workbench/useSettingsRuntime.ts:1-66 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x12) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useSettingsRuntime.ts:340-349 | 可选链/空值合并/展开 (.../ ?./ ??) (x9) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useSettingsRuntime.ts:344-367 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x5) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useSideChatTabs.ts:1-138 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x16) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useSideChatTabs.ts:99-152 | async/await + Promise (x5) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useSideChatTabs.ts:16-165 | 闭包/箭头回调捕获可变状态 (x37) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useSideChatTabs.ts:45-71 | Map/Set 集合 (x3) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useSideChatTabs.ts:1-18 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x5) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useSideChatTabs.ts:58-165 | 可选链/空值合并/展开 (.../ ?./ ??) (x32) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useSideChatTabs.ts:120-146 | try/catch 异常 (x2) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useSideChatTabs.ts:68-165 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x15) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useSocketPipeline.ts:304-336 | async/await + Promise (x2) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useSocketPipeline.ts:77-645 | 闭包/箭头回调捕获可变状态 (x33) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useSocketPipeline.ts:43-644 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x27) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useSocketPipeline.ts:136-615 | Map/Set 集合 (x9) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useSocketPipeline.ts:221-535 | 定时器/动画帧 (x8) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useSocketPipeline.ts:78-662 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x13) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useSocketPipeline.ts:1-1 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x2) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useSocketPipeline.ts:113-645 | 可选链/空值合并/展开 (.../ ?./ ??) (x75) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useSocketPipeline.ts:104-394 | Date/时间戳 (x6) | 无 JS Date 语义对等 | u64 毫秒时间戳近似
apps/web/src/app/workbench/useSocketPipeline.ts:119-645 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x16) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useSshWorkspace.ts:1-65 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x21) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useSshWorkspace.ts:65-77 | async/await + Promise (x2) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useSshWorkspace.ts:34-65 | 闭包/箭头回调捕获可变状态 (x7) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useSshWorkspace.ts:51-51 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x1) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useSshWorkspace.ts:1-16 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x3) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useSshWorkspace.ts:51-84 | try/catch 异常 (x3) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useSshWorkspaceLifecycle.ts:1-85 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x4) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useSshWorkspaceLifecycle.ts:35-90 | async/await + Promise (x7) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useSshWorkspaceLifecycle.ts:14-85 | 闭包/箭头回调捕获可变状态 (x4) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useSshWorkspaceLifecycle.ts:1-20 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x11) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useSshWorkspaceLifecycle.ts:36-36 | 可选链/空值合并/展开 (.../ ?./ ??) (x1) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useSshWorkspaceLifecycle.ts:49-98 | try/catch 异常 (x6) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:2-377 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x69) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useTaskTabsRuntime.ts:262-264 | async/await + Promise (x3) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:211-350 | 闭包/箭头回调捕获可变状态 (x25) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:217-350 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x12) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:219-256 | Map/Set 集合 (x6) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:326-336 | 定时器/动画帧 (x2) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useTaskTabsRuntime.ts:212-374 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x12) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useTaskTabsRuntime.ts:2-49 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x8) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useTaskTabsRuntime.ts:226-231 | 可选链/空值合并/展开 (.../ ?./ ??) (x7) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:298-298 | try/catch 异常 (x1) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useTaskTabsRuntime.ts:231-231 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x1) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:1-563 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x6) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useTaskTabsSplit.ts:38-526 | async/await + Promise (x21) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:38-574 | 闭包/箭头回调捕获可变状态 (x75) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:153-161 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x3) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:143-489 | Map/Set 集合 (x25) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:136-470 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x4) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useTaskTabsSplit.ts:1-524 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x81) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useTaskTabsSplit.ts:79-560 | 可选链/空值合并/展开 (.../ ?./ ??) (x55) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:391-485 | try/catch 异常 (x3) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useTaskTabsSplit.ts:78-565 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x28) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useTaskTabsState.ts:1-63 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x27) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useTaskTabsState.ts:53-58 | async/await + Promise (x4) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useTaskTabsState.ts:17-57 | 闭包/箭头回调捕获可变状态 (x12) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useTaskTabsState.ts:47-47 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x1) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useTaskTabsState.ts:50-50 | Map/Set 集合 (x2) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useTaskTabsState.ts:23-56 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x11) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useTaskTabsState.ts:44-45 | WebSocket/事件订阅 (socket/subscribe/onMessage) (x2) | sa_std 无 React 侧 socket 订阅生命周期等价物 | 同步 poll/dispatch 函数族近似 + DEFECT
apps/web/src/app/workbench/useTaskTabsState.ts:40-40 | 可选链/空值合并/展开 (.../ ?./ ??) (x1) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useTerminalSessions.ts:1-288 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x17) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useTerminalSessions.ts:36-282 | async/await + Promise (x24) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useTerminalSessions.ts:29-288 | 闭包/箭头回调捕获可变状态 (x33) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useTerminalSessions.ts:4-282 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x9) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useTerminalSessions.ts:127-289 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x3) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useTerminalSessions.ts:14-14 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x2) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useTerminalSessions.ts:31-289 | 可选链/空值合并/展开 (.../ ?./ ??) (x45) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useTerminalSessions.ts:37-273 | try/catch 异常 (x19) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useTerminalSessions.ts:56-56 | Date/时间戳 (x1) | 无 JS Date 语义对等 | u64 毫秒时间戳近似
apps/web/src/app/workbench/useTerminalSessions.ts:31-269 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x11) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useThemePluginActions.ts:1-47 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x7) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useThemePluginActions.ts:8-51 | 闭包/箭头回调捕获可变状态 (x15) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useThemePluginActions.ts:15-41 | 可选链/空值合并/展开 (.../ ?./ ??) (x3) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useThemePluginActions.ts:24-51 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x5) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useThreadOpening.ts:1-268 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x12) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useThreadOpening.ts:51-263 | async/await + Promise (x17) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useThreadOpening.ts:50-268 | 闭包/箭头回调捕获可变状态 (x33) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useThreadOpening.ts:29-193 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x11) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useThreadOpening.ts:34-115 | Map/Set 集合 (x2) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useThreadOpening.ts:194-229 | 定时器/动画帧 (x2) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useThreadOpening.ts:194-229 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x2) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useThreadOpening.ts:1-100 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x35) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useThreadOpening.ts:93-225 | 可选链/空值合并/展开 (.../ ?./ ??) (x22) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useThreadOpening.ts:102-271 | try/catch 异常 (x11) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useThreadOpening.ts:104-118 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x3) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:1-256 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x50) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:93-136 | async/await + Promise (x4) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:102-263 | 闭包/箭头回调捕获可变状态 (x26) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:126-231 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x6) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:87-241 | Map/Set 集合 (x11) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:240-262 | 定时器/动画帧 (x2) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:177-262 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x18) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:193-206 | WebSocket/事件订阅 (socket/subscribe/onMessage) (x4) | sa_std 无 React 侧 socket 订阅生命周期等价物 | 同步 poll/dispatch 函数族近似 + DEFECT
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:1-52 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x9) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useThreadWorkspaceRuntime.ts:164-263 | 可选链/空值合并/展开 (.../ ?./ ??) (x7) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useThreadsHistory.ts:1-402 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x33) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useThreadsHistory.ts:68-405 | async/await + Promise (x10) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useThreadsHistory.ts:31-406 | 闭包/箭头回调捕获可变状态 (x54) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useThreadsHistory.ts:169-337 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x8) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useThreadsHistory.ts:32-131 | Map/Set 集合 (x2) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useThreadsHistory.ts:138-345 | 定时器/动画帧 (x17) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useThreadsHistory.ts:138-345 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x17) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useThreadsHistory.ts:1-33 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x21) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useThreadsHistory.ts:99-360 | 可选链/空值合并/展开 (.../ ?./ ??) (x4) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useThreadsHistory.ts:78-415 | try/catch 异常 (x15) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useThreadsHistory.ts:166-342 | Date/时间戳 (x16) | 无 JS Date 语义对等 | u64 毫秒时间戳近似
apps/web/src/app/workbench/useThreadsHistory.ts:131-406 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x4) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useToolingPlugins.ts:1-356 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x26) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useToolingPlugins.ts:51-357 | async/await + Promise (x35) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useToolingPlugins.ts:51-357 | 闭包/箭头回调捕获可变状态 (x33) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useToolingPlugins.ts:24-345 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x18) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useToolingPlugins.ts:43-265 | Map/Set 集合 (x12) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useToolingPlugins.ts:332-332 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x1) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useToolingPlugins.ts:1-37 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x5) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useToolingPlugins.ts:53-346 | 可选链/空值合并/展开 (.../ ?./ ??) (x21) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useToolingPlugins.ts:140-349 | try/catch 异常 (x22) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useToolingPlugins.ts:55-211 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x9) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useTurnOps.ts:1-160 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x4) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useTurnOps.ts:19-138 | async/await + Promise (x10) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useTurnOps.ts:19-187 | 闭包/箭头回调捕获可变状态 (x17) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useTurnOps.ts:33-56 | Map/Set 集合 (x3) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useTurnOps.ts:79-79 | 定时器/动画帧 (x1) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useTurnOps.ts:79-79 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x1) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useTurnOps.ts:1-149 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x38) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useTurnOps.ts:86-128 | 可选链/空值合并/展开 (.../ ?./ ??) (x5) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useTurnOps.ts:75-99 | try/catch 异常 (x2) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useTurnOps.ts:88-88 | Date/时间戳 (x1) | 无 JS Date 语义对等 | u64 毫秒时间戳近似
apps/web/src/app/workbench/useTurnOps.ts:110-186 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x6) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useWebPreview.ts:1-19 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x5) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useWebPreview.ts:14-19 | 闭包/箭头回调捕获可变状态 (x2) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useWebPreview.ts:16-30 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x4) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useWebPreview.ts:1-10 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x7) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useWebPreview.ts:16-24 | 可选链/空值合并/展开 (.../ ?./ ??) (x4) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:1-528 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x15) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useWorkbenchEffects.ts:40-478 | async/await + Promise (x13) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:40-556 | 闭包/箭头回调捕获可变状态 (x72) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:57-361 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x6) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:60-561 | Map/Set 集合 (x9) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:131-255 | 定时器/动画帧 (x7) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useWorkbenchEffects.ts:50-508 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x36) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useWorkbenchEffects.ts:159-453 | WebSocket/事件订阅 (socket/subscribe/onMessage) (x12) | sa_std 无 React 侧 socket 订阅生命周期等价物 | 同步 poll/dispatch 函数族近似 + DEFECT
apps/web/src/app/workbench/useWorkbenchEffects.ts:1-140 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x62) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useWorkbenchEffects.ts:125-558 | 可选链/空值合并/展开 (.../ ?./ ??) (x38) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:146-467 | try/catch 异常 (x15) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:229-229 | Date/时间戳 (x1) | 无 JS Date 语义对等 | u64 毫秒时间戳近似
apps/web/src/app/workbench/useWorkbenchEffects.ts:492-555 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x9) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useWorkbenchOps.ts:1-292 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x9) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useWorkbenchOps.ts:61-348 | async/await + Promise (x20) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useWorkbenchOps.ts:57-377 | 闭包/箭头回调捕获可变状态 (x43) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useWorkbenchOps.ts:12-303 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x11) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useWorkbenchOps.ts:356-356 | Map/Set 集合 (x1) | sa_std 无 Map/Set 对应 | 定长数组+len 线性扫描近似
apps/web/src/app/workbench/useWorkbenchOps.ts:126-134 | 定时器/动画帧 (x2) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useWorkbenchOps.ts:126-247 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x7) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useWorkbenchOps.ts:1-87 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x38) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useWorkbenchOps.ts:105-382 | 可选链/空值合并/展开 (.../ ?./ ??) (x49) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useWorkbenchOps.ts:166-359 | try/catch 异常 (x11) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useWorkbenchOps.ts:107-377 | 数组高阶方法 (map/filter/reduce/find/some/every/flatMap) (x16) | SLA 无闭包式高阶数组方法 | for 计数循环展开近似
apps/web/src/app/workbench/useWorkspaceFiles.ts:1-112 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x9) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useWorkspaceFiles.ts:45-137 | async/await + Promise (x11) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useWorkspaceFiles.ts:45-112 | 闭包/箭头回调捕获可变状态 (x9) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useWorkspaceFiles.ts:12-88 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x5) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useWorkspaceFiles.ts:1-27 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x5) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useWorkspaceFiles.ts:56-130 | 可选链/空值合并/展开 (.../ ?./ ??) (x9) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useWorkspaceFiles.ts:49-139 | try/catch 异常 (x8) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:1-119 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x10) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:24-128 | async/await + Promise (x13) | SLA 无 async/Promise/微任务队列 | 同步函数+返回 i32 状态码顺序调用近似
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:24-148 | 闭包/箭头回调捕获可变状态 (x9) | SLA 无闭包捕获 | 内层箭头提升为顶层 fn + 状态 struct 首参近似
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:5-128 | 动态对象/JSON (Record/unknown/any/Object/JSON) (x6) | SLA 无动态对象/反射 | JSON 文本缓冲 (ptr,len) + DEFECT 近似
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:147-150 | 定时器/动画帧 (x2) | sa_std 无 JS 定时器/事件循环 | 调用方轮询/显式 tick 近似 + DEFECT
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:147-150 | DOM/浏览器 API (window/document/localStorage/CustomEvent) (x2) | SAX/SLA 无 DOM/浏览器存储 | 占位状态码 + DEFECT, 宿主层待补
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:1-22 | 泛型/索引访问类型 (Dispatch/SetStateAction/ReturnType/AppProps[...]/Parameters) (x5) | SLA 无泛型/索引访问/函数类型推导 | 擦除为 u64 句柄/JSON 缓冲 + DEFECT
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:37-105 | 可选链/空值合并/展开 (.../ ?./ ??) (x7) | SLA 无可选链/空值合并/对象展开 | 显式判空分支+逐字段拷贝近似
apps/web/src/app/workbench/useWorkspaceGitFiles.ts:41-127 | try/catch 异常 (x8) | SLA 无异常机制 | 状态码分支近似
apps/web/src/app/workbench/useWorkspacePicker.ts:1-7 | React hooks (useState/useEffect/useLayoutEffect/useRef/useMemo/useCallback/startTransition) (x4) | SLA 无 React hooks/重渲染/效应清理语义 | 按普通函数+显式 State struct 字段近似, 调用方驱动重入

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次无与 ts 面签名确切对应的独立扫描桩。
- async 归类改记：本日志 async/Promise 条目共 19 条，修复阶段改记为参照 sa_std async 面评估（async.sla 的 sched_*/block_on_timeout、future.sa、sync/mpsc.sa、sync/mutex.sa、thread.sa）；代码层本轮不重构。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 10、Array 25、Map/Set 25 条（条目可跨类重复计数）。Array 高阶方法（map/filter/reduce/find 等）以 for 循环展开、Map/Set 以定长数组+len 线性扫描近似，操作对象是 JSON 缓冲与对象数组，与 ts_array 的 word 数组模型、collections 的键类型均未确切对应，不硬绑；待数据结构在修复阶段定型后逐条评估 @ts_arr_* / btree_map / btree_set。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。

===== 批次 web-ts-app-rest（日志条目 341）=====

# web-ts-app-rest 单元缺陷日志

格式：源文件:行号 | TS 构造 | 缺失能力/问题 | 采用的近似

## 通用（跨文件）

- apps/web/src/app/**/*.ts | TS module exports | SLA 无模块导出命名空间 | 标识符原样平铺为文件级 fn/struct/let
- apps/web/src/app/**/*.ts | string 类型 | SLA 无托管 string | (ptr,len) 或定长字节数组 + len 字段
- apps/web/src/app/**/*.ts | 前端运行时（React/DOM/浏览器存储/事件） | sa_std 无前端运行时对应 | 结构保留 + DEFECT 注释，行为层待修复阶段

## 逐文件

- apps/web/src/app/agents/agentReadiness.ts:7 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/agents/agentReadiness.ts:12 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/agents/agentReadiness.ts:12 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/appReducer.ts:45 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/appReducer.ts:62 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/appReducer.ts:75 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/appReducer.ts:75 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/appReducer.ts:91 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/appReducer.ts:107 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/claude/claudeStartupStage.ts:21 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/claude/claudeStartupStage.ts:27 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/claude/claudeStartupStage.ts:32 | Date/时间 API | sa_std 时间接口形状不同 | u64 毫秒时间戳参数/extern 近似
- apps/web/src/app/claude/claudeStartupStage.ts:34 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/claude/claudeStartupStage.ts:38 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/cli/cliBackendKind.ts:6 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/cliBackendLabels.ts:19 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/cliBackendLabels.ts:29 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/cli/cliBackendLabels.ts:47 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/cliPlugins.ts:22 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/cli/cliPlugins.ts:22 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/cli/cliPlugins.ts:27 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/cli/cliSkillGuides.ts:34 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/cli/cliSkillGuides.ts:59 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/cliTogglePolicy.ts:12 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/cli/cliTogglePolicy.ts:14 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/cli/cliTogglePolicy.ts:19 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/cliTogglePolicy.ts:29 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/cliTogglePolicy.ts:39 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/cli/cliTogglePolicy.ts:39 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/cli/pluginCatalog.ts:56 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/resolveCliBackendSelection.ts:24 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/resolveCliBackendSelection.ts:31 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/cli/resolveCliBackendSelection.ts:31 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/cli/resolveCliBackendSelection.ts:37 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/resolveEffectiveTurnCliBackend.ts:30 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/resolveEffectiveTurnCliBackend.ts:31 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/saVmExecutionSpec.ts:6 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/saVmExecutionSpec.ts:68 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/saVmExecutionSpec.ts:84 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/cli/saVmExecutionSpec.ts:121 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/cli/saVmExecutionSpec.ts:204 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/cli/saVmExecutionSpec.ts:248 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/saVmExecutionSpec.ts:529 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/cli/useCliBackendPlugins.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/cli/useCliBackendPlugins.ts:57 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/cli/useCliBackendPlugins.ts:57 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/cli/useCliBackendPlugins.ts:60 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/useCliBackendPlugins.ts:61 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/cli/useCliBackendPlugins.ts:62 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/cli/useCliBackendPlugins.ts:70 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/useCliBackendPlugins.ts:105 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/cli/useCliBackendPlugins.ts:184 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/cli/useCliInstallations.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/cli/useCliInstallations.ts:21 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/useCliInstallations.ts:22 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/cli/useCliInstallations.ts:25 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/cli/useCliInstallations.ts:63 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/useCliInstallations.ts:66 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/cli/useCliInstallations.ts:73 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/cli/useCliInstallations.ts:75 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/cli/useCliInstallations.ts:76 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/useCliInstallations.ts:76 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/cli/useCliInstallations.ts:77 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/cli/useCliInstallations.ts:167 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/cli/useCliPrerequisites.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/cli/useCliPrerequisites.ts:8 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/cli/useCliPrerequisites.ts:10 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/cli/useCliPrerequisites.ts:10 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/cli/useCliPrerequisites.ts:17 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/cli/useLazyCliBackendHistory.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/cli/useLazyCliBackendHistory.ts:24 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/cli/useLazyCliBackendHistory.ts:55 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/connection/stableEventProxy.ts:1 | 类/interface 继承 (extends) | SLA 无继承 | 字段平铺到子 struct，基类方法以函数族近似
- apps/web/src/app/connection/stableEventProxy.ts:2 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/connection/stableEventProxy.ts:6 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/connection/useStableSocketSubscription.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/connection/useStableSocketSubscription.ts:22 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/connection/useStableSocketSubscription.ts:23 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/connection/useStableSocketSubscription.ts:33 | fetch/WebSocket/事件监听 | 前端网络/事件 API 无 sa_std 对应 | extern 占位 + 回调改函数族近似
- apps/web/src/app/conversationStatus.ts:8 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/goals/goalResumeDecision.ts:1 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/goals/goalState.ts:3 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/goals/goalState.ts:3 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/goals/goalState.ts:11 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/goals/goalState.ts:70 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/goals/useGoalLifecycle.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/goals/useGoalLifecycle.ts:16 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/goals/useGoalLifecycle.ts:20 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/goals/useGoalLifecycle.ts:37 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/goals/useGoalLifecycle.ts:40 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/goals/useGoalLifecycle.ts:50 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/goals/useGoalLifecycle.ts:64 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/goals/useGoalLifecycle.ts:76 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/goals/useGoalLifecycle.ts:89 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/goals/useGoalLifecycle.ts:90 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/goals/useGoalLifecycle.ts:124 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/goals/useGoalLifecycle.ts:313 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/goals/useGoalLifecycle.ts:322 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/goals/useGoalLifecycle.ts:324 | JSON.parse/stringify 动态对象 | 动态对象无静态类型对应 | JSON 文本缓冲 (ptr,len) + sa_json_* extern 近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:17 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:19 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:19 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:23 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:54 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:69 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:89 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:119 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:120 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:123 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/jev/useJevAutoNudgeOwner.ts:123 | fetch/WebSocket/事件监听 | 前端网络/事件 API 无 sa_std 对应 | extern 占位 + 回调改函数族近似
- apps/web/src/app/modelCapacityRetry.ts:23 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/modelCapacityRetry.ts:23 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/modelCapacityRetry.ts:23 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/modelCapacityRetry.ts:37 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:2 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:5 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:5 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:21 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:24 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:25 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:36 | fetch/WebSocket/事件监听 | 前端网络/事件 API 无 sa_std 对应 | extern 占位 + 回调改函数族近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:37 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:56 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/pwa/serviceWorkerLifecycle.ts:57 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/relayShare.ts:6 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/relayShare.ts:25 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/relayShare.ts:25 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/relayShare.ts:29 | JSON.parse/stringify 动态对象 | 动态对象无静态类型对应 | JSON 文本缓冲 (ptr,len) + sa_json_* extern 近似
- apps/web/src/app/relayShare.ts:35 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/relayShare.ts:44 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/relayShare.ts:54 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/relayShare.ts:95 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/relayShare.ts:95 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/relayShare.ts:95 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/reviewTurn.ts:13 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/reviewTurn.ts:14 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/reviewTurn.ts:18 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/reviewTurn.ts:20 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/runtime/saVmWorkspaceSkill.ts:49 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/runtime/saVmWorkspaceSkill.ts:51 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:106 | 类/interface 继承 (extends) | SLA 无继承 | 字段平铺到子 struct，基类方法以函数族近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:113 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:121 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:122 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:134 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:160 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:163 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:169 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:186 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:232 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:267 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:291 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:505 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:505 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:750 | JSON.parse/stringify 动态对象 | 动态对象无静态类型对应 | JSON 文本缓冲 (ptr,len) + sa_json_* extern 近似
- apps/web/src/app/runtime/useThreadRuntimeSelections.ts:809 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/settings/relayListPagination.ts:3 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:40 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:40 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:40 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:53 | 类/interface 继承 (extends) | SLA 无继承 | 字段平铺到子 struct，基类方法以函数族近似
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:59 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:93 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/sidechat/sideChatDuckDefaults.ts:99 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/skills/skillScope.ts:3 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/skills/skillScope.ts:6 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/skills/skillScope.ts:13 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/skills/skillScope.ts:13 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/terminal/terminalPreferences.ts:28 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/terminal/terminalPreferences.ts:28 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/terminal/terminalPreferences.ts:28 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/terminal/terminalPreferences.ts:43 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/terminal/terminalPreferences.ts:47 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/terminal/terminalPreferences.ts:48 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/terminal/terminalPreferences.ts:56 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/terminal/terminalPreferences.ts:60 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/terminal/terminalPreferences.ts:60 | JSON.parse/stringify 动态对象 | 动态对象无静态类型对应 | JSON 文本缓冲 (ptr,len) + sa_json_* extern 近似
- apps/web/src/app/terminal/terminalPreferences.ts:86 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/terminal/terminalPreferences.ts:92 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/threadWriterConflict.ts:1 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/threadWriterConflict.ts:2 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/threadWriterConflict.ts:7 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/threadWriterConflict.ts:9 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/threads/ThreadLoadQueue.ts:7 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/threads/ThreadLoadQueue.ts:11 | class 声明 | SLA 无 class/方法多态 | struct + 以 &Struct 为首参的函数族
- apps/web/src/app/threads/ThreadLoadQueue.ts:12 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/threads/ThreadLoadQueue.ts:18 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/threads/ThreadLoadQueue.ts:26 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/threads/ThreadLoadQueue.ts:44 | 定时器 setTimeout/setInterval | sa_std 无事件循环定时器 | 同步近似/轮次计数近似 + DEFECT
- apps/web/src/app/threads/TranscriptRetention.ts:4 | class 声明 | SLA 无 class/方法多态 | struct + 以 &Struct 为首参的函数族
- apps/web/src/app/threads/TranscriptRetention.ts:7 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/threads/editConversation.ts:17 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/threads/threadCatalog.ts:10 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/threads/threadCatalog.ts:10 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/threads/threadCatalog.ts:11 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/threads/threadCatalog.ts:14 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/threads/threadCatalog.ts:15 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/threads/threadCatalog.ts:25 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/threads/threadCatalog.ts:36 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/threads/threadCatalog.ts:38 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/threads/threadCatalog.ts:52 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/threads/threadCatalog.ts:54 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/threads/threadCatalog.ts:81 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/threads/threadCatalog.ts:82 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/threads/threadCatalog.ts:165 | Date/时间 API | sa_std 时间接口形状不同 | u64 毫秒时间戳参数/extern 近似
- apps/web/src/app/threads/threadCatalog.ts:204 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/threads/threadCatalog.ts:215 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/threads/threadHistoryService.ts:17 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/threads/threadHistoryService.ts:19 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/threads/threadHistoryService.ts:23 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/threads/threadHistoryService.ts:23 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/threads/threadHistoryService.ts:23 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/threads/threadHistoryService.ts:49 | 定时器 setTimeout/setInterval | sa_std 无事件循环定时器 | 同步近似/轮次计数近似 + DEFECT
- apps/web/src/app/threads/threadHistoryService.ts:52 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/threads/threadHistoryService.ts:68 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/threads/threadHistoryService.ts:75 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/threads/threadHistoryService.ts:87 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/threads/threadHistoryService.ts:118 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/threads/threadHistoryService.ts:148 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/threads/threadHistoryService.ts:197 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/threads/threadHistoryService.ts:204 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/threads/threadHistoryService.ts:263 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/transcripts/failedTurnRecovery.ts:10 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/transcripts/failedTurnRecovery.ts:24 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/transcripts/failedTurnRecovery.ts:26 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/transcripts/failedTurnRecovery.ts:32 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/transcripts/failedTurnRecovery.ts:37 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/transcripts/failedTurnRecovery.ts:40 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/transcripts/failedTurnRecovery.ts:70 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:4 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:26 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:36 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:54 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:57 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:147 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/transcripts/runtimeTurnProjection.ts:147 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/transcripts/topicRuntimeIndex.ts:18 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/transcripts/topicRuntimeIndex.ts:33 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/transcripts/topicRuntimeIndex.ts:38 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/topicRuntimeIndex.ts:38 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/transcripts/topicRuntimeIndex.ts:44 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/transcripts/topicTranscriptStore.ts:17 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:28 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/topicTranscriptStore.ts:45 | class 声明 | SLA 无 class/方法多态 | struct + 以 &Struct 为首参的函数族
- apps/web/src/app/transcripts/topicTranscriptStore.ts:50 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/transcripts/topicTranscriptStore.ts:74 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:100 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:108 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:197 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:415 | Date/时间 API | sa_std 时间接口形状不同 | u64 毫秒时间戳参数/extern 近似
- apps/web/src/app/transcripts/topicTranscriptStore.ts:416 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/transcripts/topicTranscriptStore.ts:884 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/transcripts/topicTranscriptStore.ts:1082 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/transcripts/topicTranscriptStore.ts:1082 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/transcripts/transcriptProjection.ts:6 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/transcripts/transcriptProjection.ts:22 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/transcriptProjection.ts:22 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/transcripts/transcriptProjection.ts:51 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/transcripts/transcriptProjection.ts:90 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/transcripts/transcriptProjection.ts:95 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/transcripts/transcriptProjection.ts:95 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:26 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:27 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:33 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:38 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:38 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:44 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts:44 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:22 | class 声明 | SLA 无 class/方法多态 | struct + 以 &Struct 为首参的函数族
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:82 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:85 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:94 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:94 | 定时器 setTimeout/setInterval | sa_std 无事件循环定时器 | 同步近似/轮次计数近似 + DEFECT
- apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts:128 | fetch/WebSocket/事件监听 | 前端网络/事件 API 无 sa_std 对应 | extern 占位 + 回调改函数族近似
- apps/web/src/app/turnInterruptRetry.ts:7 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/turnInterruptRetry.ts:11 | class 声明 | SLA 无 class/方法多态 | struct + 以 &Struct 为首参的函数族
- apps/web/src/app/turnInterruptRetry.ts:12 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/turnInterruptRetry.ts:12 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/turnInterruptRetry.ts:14 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/turnInterruptRetry.ts:15 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/turnInterruptRetry.ts:33 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/turnInterruptRetry.ts:34 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/turnInterruptRetry.ts:44 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/turnInterruptRetry.ts:47 | 定时器 setTimeout/setInterval | sa_std 无事件循环定时器 | 同步近似/轮次计数近似 + DEFECT
- apps/web/src/app/turnInterruptRetry.ts:52 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/turnInterruptRetry.ts:58 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/turnInterruptRetry.ts:82 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/turnInterruptRetry.ts:106 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/turnRetryState.ts:11 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/usage/topicUsageStore.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/usage/topicUsageStore.ts:6 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/usage/topicUsageStore.ts:7 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/usage/topicUsageStore.ts:15 | class 声明 | SLA 无 class/方法多态 | struct + 以 &Struct 为首参的函数族
- apps/web/src/app/usage/topicUsageStore.ts:16 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/usage/topicUsageStore.ts:22 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/usage/topicUsageStore.ts:30 | 定时器 setTimeout/setInterval | sa_std 无事件循环定时器 | 同步近似/轮次计数近似 + DEFECT
- apps/web/src/app/usage/topicUsageStore.ts:46 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/usage/topicUsageStore.ts:83 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/usage/topicUsageStore.ts:89 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/usage/topicUsageStore.ts:147 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/usage/usagePricing.ts:4 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/usage/usagePricing.ts:4 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/usage/usagePricing.ts:4 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/usage/usagePricing.ts:4 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/usage/usagePricing.ts:31 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/workspace/rightWorkspaceContext.ts:19 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/workspace/rightWorkspaceContext.ts:19 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/workspace/rightWorkspaceContext.ts:22 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/workspace/rightWorkspaceContext.ts:38 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/workspace/rightWorkspaceContext.ts:41 | 泛型 <T> | SLA 无泛型 | 具体化为 JSON 文本缓冲/定长缓冲参数
- apps/web/src/app/workspace/rightWorkspaceContext.ts:42 | Record/动态对象索引签名 | SLA 无动态对象 | JSON 文本缓冲 + DEFECT: dynamic object
- apps/web/src/app/workspace/useOpenFileTabs.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/workspace/useOpenFileTabs.ts:20 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/workspace/useOpenFileTabs.ts:24 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/workspace/useOpenFileTabs.ts:24 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/workspace/useOpenFileTabs.ts:24 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似
- apps/web/src/app/workspace/useOpenFileTabs.ts:31 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/workspace/useOpenFileTabs.ts:76 | DOM/window/localStorage API | SLA 无 DOM 与浏览器存储 API | extern 占位 + DEFECT 注释，值以参数注入近似
- apps/web/src/app/workspace/useOpenFileTabs.ts:97 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:1 | React hooks | SLA/SAX 无 React 运行时与 hooks 行为层 | 函数签名与状态字段保留为 struct 字段，hooks 调用以 DEFECT 注释保留原行
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:24 | 闭包/箭头函数（含回调参数） | SLA 无一等闭包与捕获可变状态 | 回调改为命名函数/函数族近似，捕获状态改显式参数
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:25 | Promise 链 | SLA 无 Promise | 顺序调用近似，结果以状态码/输出参数回传
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:32 | RegExp 正则表达式 | sa_std 无正则引擎 | 子串/逐字节扫描近似，正则原文以注释保留
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:34 | 模板字符串插值 | SLA 无模板字符串 | STR_PTR/STR_LEN 分段拼接近似，原文以注释保留
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:49 | unknown/any 动态类型 | SLA 静态类型无 unknown/any | JSON 文本缓冲/标签联合近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:50 | instanceof 运行时类型判断 | SLA 无运行时类型系统 | 显式标签字段 (kind tag) 判断近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:59 | 解构赋值 | SLA 无解构 | 逐字段取值赋值近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:61 | async/await | SLA 无 async/await 与 Promise 运行时 | 同步函数 + 返回状态码，await 处顺序调用近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:64 | try/catch 异常 | SLA 无异常机制 | 状态码分支近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:66 | 可选链 ?./空值合并 ?? | SLA 无 ?. 与 ?? 运算符 | 显式 null/长度检查分支近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:92 | Map/Set 集合 | sa_std 无 Map/Set 对应类型 | 定长数组 + len 字段近似，has/add/delete 以线性扫描函数近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:92 | 展开运算符 ... | SLA 无 spread | 逐元素拷贝循环近似
- apps/web/src/app/workspace/useWorkspaceFileMutations.ts:92 | 数组高阶方法 map/filter/reduce 等 | SLA 无闭包式高阶数组方法 | 显式 for 循环近似

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次无与 ts 面签名确切对应的独立扫描桩（字符串相等均内嵌于领域函数，非独立桩）。
- async 归类改记：本日志 async/Promise 条目共 23 条，修复阶段改记为参照 sa_std async 面评估（async.sla 的 sched_*/block_on_timeout、future.sa、sync/mpsc.sa、sync/mutex.sa、thread.sa）；代码层本轮不重构。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 18、Array 50、RegExp 14、Map/Set 49 条（条目可跨类重复计数）。Map/Set 条目（如 appReducer 的定长数组+len 线性扫描 has/add/delete）键为字符串/对象，collections btree_map/btree_set 的键类型待核对，不硬绑；Array 高阶方法条目同 wb-c 注记（JSON 缓冲/对象数组 vs word 数组模型不合）。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。

===== 批次 web-ts-state（日志条目 39）=====

# web-ts-state 缺陷日志

单元：apps/web/src/state/（5 个 .ts → .sla，源总行数 6935）
行内 `// DEFECT:` 标记合计 187 处（codexClient 146、codexConfigSettings 19、workbenchTimeline 16、recentThreadTranscripts 4、retrySettings 2）。
本日志按「源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似」逐条记录；同类缺陷在多个位置重复出现的合并为一条并标注范围。

## retrySettings.ts → retrySettings.sla

- retrySettings.ts:1-10 | `Number(value)` + `Math.round`/`Math.min`/`Math.max` 对 unknown 入参 | SLA 无动态类型强转 | value 以 f64 + valueIsFinite 标志入参；取整/夹取已绑 sa_std ts 面（@ts_math_rounding / @ts_math_minmax，ts_math.sa 已 import，调用点修复阶段定版）

## recentThreadTranscripts.ts → recentThreadTranscripts.sla

- recentThreadTranscripts.ts:5-22 | `string[]` / `ReadonlySet<string>` / 返回对象 `{ recent, protected }` | 无动态数组与集合类型 | 定长 ThreadIdList（64×128B）+ 线性扫描；返回对象改 out 参数；数组 push/filter 语义已绑 sa_std ts 面（@ts_arr_push_word / @ts_arr_slice_copy / @ts_str_equals，ts_array.sa/ts_string.sa 已 import，调用点修复阶段定版）
- recentThreadTranscripts.ts:9-22 | 闭包式 filter/push/evict 组合 | 无闭包 | 显式循环转写，while 逐出循环语义等价

## workbenchTimeline.ts → workbenchTimeline.sla

- workbenchTimeline.ts:全文 | `WorkbenchItem[]`/`WorkbenchTurn[]` 动态数组、对象展开 `{...a, ...b}` 合并 | 无动态数组/展开语义 | 定长列表（128）+ mergeWorkbenchItem/Turn 逐字段合并；容量按语义估定，超限截断
- workbenchTimeline.ts:全文 | payload 为动态 JSON 对象（Record/JsonValue） | 无动态对象 | payload 存 JSON 文本缓冲（4096B），字段读写走假定 sa_json_* extern（见 codexClient 条目）
- workbenchTimeline.ts:normalizeMessageText | `String.prototype.trim`（Unicode 空白） | — | 已绑 sa_std ts 面：@ts_str_trim（ts_string.sa）；\r\n?→\n 替换逐字节转写
- workbenchTimeline.ts:orderFullyTimedTurnsInPlace | 泛型 + 回调比较器排序 | 无泛型/闭包 | 专用稳定冒泡排序；@ts_arr_sort 绑定留修复阶段（已绑 sa_std ts 面，待调用点定版）
- workbenchTimeline.ts:sameWorkbenchItem/sameTurnReferences 等 | 引用同一性（=== 对象 identity） | 值类型无引用语义 | 以 id 序列 + 序列化 JSON 文本相等近似
- workbenchTimeline.ts:localeCompare 排序 | `String.prototype.localeCompare`（locale 排序规则） | 无 locale 引擎 | 字节序比较近似（修复阶段可绑 @ts_str_compare）

## codexConfigSettings.ts → codexConfigSettings.sla

- codexConfigSettings.ts:全文 | 动态 JSON 配置对象、Schema 对象递归遍历 | 无动态对象/递归闭包 | JSON 文本缓冲（16KB）+ 假定 sa_json_* extern；flattenSchemaProperties/resolveSchema 递归函数转写，$ref/allOf/anyOf 合并走假定 extern（sa_json_object_merge_schema_copy 等）
- codexConfigSettings.ts:codexConfigSchema.json import | 编译期 JSON import | SLA 无 JSON 模块导入 | Schema 改为运行时传入缓冲（SchemaRoot），DEFECT 已行内标注
- codexConfigSettings.ts:parseDynamicConfigFieldValue 等 | `Number(text)`/`Boolean("false")===true` 等 JS 强转怪癖 | 无 JS 强转语义 | 逐条按 JS 语义手工转写（含 Boolean("false") 为 true 的怪癖保留）；数值解析为十进制扫描近似，Math/Number 语义已绑 sa_std ts 面（ts_math.sa 已 import）
- codexConfigSettings.ts:labelFromValue | 正则 `\b\w` 大写化 | 无正则 | 在原始字节上近似（词界按非字母数字判定）

## codexClient.ts → codexClient.sla（5880 行，单文件顺序转完）

- codexClient.ts:全文（约 90 处 fetch 函数） | `async`/`Promise` + `fetch` + `AbortController`/`AbortSignal` | SLA 无 Promise/Abort 语义 | 同步函数 + i32 状态码（0 ok / 1 error / 特殊码如 2=LoginRequired、超时）+ err out 参数；阻塞调用走假定 extern sa_http_client_fetch_json（超时版 sa_http_client_fetch_json_timed）；async 结构修复阶段优先按 sa_std async 面（async.sla/future.sa/sync）评估——已绑 sa_std ts 面（async 运行时面）
- codexClient.ts:全文 | 动态 JSON（unknown/Record/JsonValue）请求/响应体、`JSON.parse/stringify` | 无动态对象 | JSON 文本缓冲（JsonBufC 16KB / Small 2KB）+ 假定 sa_json_* extern 族（sa_json_object_get_string/get_number/get_bool/get_value_text/set_value_text/merge_copy/remove_key_copy、sa_json_array_len/at_value_text、sa_json_parse_scalar、sa_json_value_string、sa_json_object_key_count/key_at、sa_json_validate）；手写 JSON 拼装处字符串不转义（行内 DEFECT 标注）
- codexClient.ts:1-60 | 从 @codex-ui/shared / @cxu/sdk-frontend 导入的类型（AuthUser、UsageSummary、WorkbenchItem 等）与常量 DANGER_CONFIRMATION | 跨包类型/常量不在本文件 | 类型以 struct 或 raw_json 近似；DANGER_CONFIRMATION 字面值不在源文件内，dangerousConfirmationMatches 的比较目标暂为空（行内 DEFECT）
- codexClient.ts:52-876 | 大量 entry 类型（可选字段、字符串字面量联合、嵌套对象） | 无可选/联合类型系统 | struct + has_* 标志；联合类型以 SStr 文本或 kind 代码保留；嵌套动态对象存 JSON 文本
- codexClient.ts:877-1490 | `class CodexSocketClient extends EventTarget`、WebSocket、CustomEvent、setTimeout/setInterval 心跳与重连、Promise 挂起队列 | 无类继承/事件目标/WebSocket/定时器 | struct + 函数族；socket 为假定 extern 句柄（sa_ws_*）；事件为定长列表 + dispatch 函数；定时器改 deadline 字段 + codexSocketClientTick(now_ms) 驱动；Promise 改挂起列表 + outcome 队列；Date.now() 全部改 now_ms 入参
- codexClient.ts:1100-1490 | 浏览器全局（window/document/navigator/location、online/visibility 事件） | 无浏览器环境 | 主机以参数注入（location 的 protocol/host 以入参给出）；监听器只置标志（行内 DEFECT）
- codexClient.ts:rpcTimeoutMs 等 | 正则表达式匹配（方法名分组判定） | 无正则引擎 | containsCi 子串分组近似
- codexClient.ts:1490-1965 | URL/URLSearchParams 构造、encodeURIComponent | 无 URL 类 | BigStrC 手工拼装 + urlEncodeComponent 近似（gatewayParams 复用同一路径）；URLSearchParams 迭代顺序以 JSON 对象键序近似
- codexClient.ts:login 等 | 精确中文错误文案 | — | 原文照录；传输层错误文案以固定后缀近似（行内 DEFECT）
- codexClient.ts:editProviderImage | `FormData` multipart + File[] | 无 FormData | 本轮未发 multipart 请求，返回错误并行内记录字段顺序（DEFECT）
- codexClient.ts:2845-3196 | WorkspaceRootsError 等 `class X extends Error` + code/kind 分类 | 无异常类继承 | struct + kind/code 字段，分类逻辑逐条转写；fetchWorkspaceRoots 以返回码 2 表示 LoginRequiredError
- codexClient.ts:3189-3192 | 模块级可变 `Set<string>` serverStartedTurnIds | 无模块级可变全局 | 显式 ServerStartedTurnIds 参数贯穿 reducer；Set 语义修复阶段可绑 collections（btree_set.sa）——已绑 sa_std ts 面（collections 面）
- codexClient.ts:3196-3974 | applyNotification 巨型 reducer：对象展开、Map/Set、闭包 updater（updateTurnItem）、try/catch 包裹的 JEV 分发副作用 | 无展开/Map/闭包/异常 | 分发器 + 逐 method 分支函数（源序不变，行内 DEFECT 说明）；状态以 out 参数整体拷贝后原地修改；updateTurnItem 闭包逐调用点内联（含缺 turn 时建桩、reactivate 语义已对齐）；JEV 分发改为记录到 JevDispatchList 由宿主执行；extractJevCollabBrief/Report 属 jev 单元，本文件以常见字段近似读取（行内 DEFECT）；Map 语义修复阶段可绑 collections（btree_map.sa）
- codexClient.ts:3600-3974 | error 分支的重试正则 `/(selected model is at capacity|rate-?limiting requests|...)/i` | 无正则 | containsCi 子串组近似（rate-?limiting 两拼写都列）
- codexClient.ts:3976-4350 | applyNotificationsPreservingActiveThread / coalesceStreamingWorkbenchNotifications 的 `Map<string, number>` 目标索引、scoped 单 turn 状态 | 无 Map | 并行键列表 + 线性扫描；trim 判定已绑 sa_std ts 面（@ts_str_trim）；Map 修复阶段绑 btree_map.sa
- codexClient.ts:4303-4350 | composerInputToUserInput 返回 JsonValue[]、模板字符串、正则 `/^\s*data:/i` | 无动态数组 | JSON 数组文本拼装（不转义，行内 DEFECT）；data: 判定以 trim 后前缀大小写不敏感比较近似；trim 已绑 @ts_str_trim；size 数值以整数近似（小数截断）
- codexClient.ts:4351-4528 | parse* 系列：`Object.values`、数组 map/filter、localeCompare 排序（parseFsDirectory） | 无高阶函数 | 显式循环；Object.values 以 sa_json_object_key_at 键序迭代；排序比较已绑 sa_std ts 面（@ts_str_compare）
- codexClient.ts:4529-4565 | 泛型 upsertById<T>、updateTurnItem 闭包 | 无泛型/闭包 | 按类型专用化（ThreadEntry 版 upsertThreadById，前插语义已对齐 TS）；updateTurnItem 逐点内联
- codexClient.ts:4566-5353 | stringValue/numberValue 等值级辅助、itemText/itemImages/itemFiles 的内容块联合类型、agentItemMetadata 变参记录、summarizeJsonValue 的 `JSON.stringify(v, null, 2)` | 无联合类型/变参/美化打印 | 值以 JSON 文本 + kind 判定；images/files 序列化为 JSON 文本存入 item 字段（字符串不转义）；stringify 美化以原始文本近似；WorkbenchImage/WorkbenchFile 的 struct 字段集为本模块近似（与 sdk 定义的完整字段集差异行内标注）
- codexClient.ts:4951-5003 | sanitizeRelayErrorText 的正则（`\bchat (\d{3})\b`、`"status":\s*(\d{3})`）与嵌套 JSON 解包 | 无正则 | 手工扫描提取 3 位状态码；解包走 asRecordC + flatten 递归转写；中文文案原文照录
- codexClient.ts:4793-4930 | threadToEntry/turnToWorkbenchTurn/threadItemToWorkbenchItem 的可选链与默认值链 | 无可选链 | recStrNE/recNumAlt 逐级尝试转写；historyMode 的 includes 判定逐项展开
- codexClient.ts:5354-5880 | gateway/usage/analytics 类型（嵌套 tokens/costBreakdown 对象）与 fetch 家族 | 动态嵌套对象 | 顶层类型以 struct 定义，嵌套动态部分存 raw JSON；fetch 统一走 gatewayGet + gatewayParams
- codexClient.ts:installLaunchAdapters | `setTimeout` 轮询循环 + onProgress 回调 + 10 分钟墙钟超时 | 无定时器/回调 | 假定 sa_sleep_ms extern 累计等待时长作预算；onProgress 改为记录最后一次 logs 到 out 参数（行内 DEFECT）；async 结构修复阶段按 sa_std async 面评估——已绑 sa_std ts 面（async 运行时面）
- codexClient.ts:全文（多处） | 固定容量近似：SStr 512B、标题 256B、正文 8192B、payload 4096B、列表 32/64/128/256 | TS 字符串/数组无界 | 超限截断（各处行内 DEFECT 标注）；长 delta/长 brief 等以原始 JSON 字符串值直读大缓冲缓解
- codexClient.ts:全文（多处） | `stringValue` 要求非空字符串 | — | 记录级读取 recStr 未统一做非空判定（转换器层另有 recStrNE 对齐）；reducer 内的空字符串差异留修复阶段统一（行内 DEFECT 汇总于此）

## 跨文件汇总

- 前 5 类缺陷（按行内标记频次）：1) async/Promise→同步+状态码与 fetch/Abort 假定 extern；2) 动态 JSON/Record→文本缓冲 + 假定 sa_json_* extern（含不转义拼装）；3) 定长容量截断（字符串/数组/列表上限）；4) class/继承/事件/WebSocket/定时器→struct+函数族+tick 驱动；5) Map/Set/泛型/闭包→线性扫描/专用化/内联。
- 已绑 sa_std ts 面汇总：String.trim→@ts_str_trim（workbenchTimeline.normalizeMessageText 与 codexClient 多处判定已实际调用）、排序比较→@ts_str_compare（parseFsDirectory 已实际调用）、Math.floor→@ts_math_rounding（turn 建桩/终态时间戳已实际调用）、String/Array/Math 其余方法与 async/Map/Set 面已在各文件 import 并在本日志对应条目标注，调用点在修复阶段定版。

===== 批次 web-ts-src-top（日志条目 56）=====

# web-ts-src-top 缺陷日志（CXU plugins @ f2cb649d，批量转换阶段，只记录不修复）

advancedRelayDirectory.ts:1-53 | import type from "@codex-ui/shared" + type-only types | SLA 无共享类型包对应，ChannelGroupConfig/ProviderConfig 为动态记录 | JSON 文本缓冲 (ptr,len) 承载 + struct 仅保留本文件自有类型
advancedRelayDirectory.ts:20-39 | Array.filter/map/find 闭包 + 可选链 + satisfies | 无闭包与可选链 | 顺序循环骨架 + 字段预提取注释
advancedRelayDirectory.ts:29 | 模板字面量 `template:${template.id}` | 无字符串插值 | 输出缓冲拼接近似
chatTypography.ts:5-22 | unknown / Record<string, unknown> 动态对象 + Number() 强转 | 无动态对象与 JS 数值强转语义 | JSON 缓冲 + f64 字段与 finite 标志近似
chatTypography.ts:13 | RegExp /^#[0-9a-f]{6}$/i | sa_std 无正则 | 长度+前缀检查占位
clientPlatform.ts:9-33 | navigator/window DOM 全局 + RegExp /linux/i、/win/i | 无浏览器全局与正则 | 调用方传入 platform 缓冲/布尔标志 + 大小写不敏感子串扫描
codexCliRecovery.ts:9-25 | 可选链 + RegExp 多分支 test(消息分类) | 无可选链与正则 | JSON 字段预提取 + 子串扫描占位
contextUsage.ts:57-67 | Math.round / Math.min / Math.max 的 f64 取整语义 | f64→u64 取整助手未定 | 逻辑直译，percentage 取整留待修复阶段
goalContinuation.ts:3-112 | Promise + 闭包捕获可变状态 + EventTarget.addEventListener + setTimeout/clearTimeout | 无 Promise/事件/定时器 | 状态 struct + 同步轮询式函数族 + 状态码（waitFor 返回 i32）
goalContinuation.ts:107-112 | unknown 转 Record<string, unknown> | 无动态对象 | JSON 缓冲 asRecord 近似
groupCollection.ts:1-427 | ChannelGroupConfig/ProviderConfig/RelayCapabilityCatalog 大型动态记录 + Map/Set + Object.keys/fromEntries | 无动态对象与集合类型 | 全量 JSON 缓冲 + 线性扫描近似
groupCollection.ts:35-68 | flatMap/filter 链 + RegExp /image|banana|video/i + 对象字面量构造 satisfies | 无闭包链与正则 | 循环骨架 + JSON 构建注释
groupCollection.ts:142-181 | Map 按名索引 + 对象展开合并 {...imported, ...} | 无展开运算 | 逐字段 JSON 合并近似
groupCollection.ts:368-377 | localeCompare(..., {numeric, sensitivity}) + toLocaleLowerCase | 无 locale 排序/Unicode 大小写 | 字节序比较占位
historyExport.ts:7-37 | async/await + client.rpc Promise 链 + throw Error | 无 async 与异常 | 同步函数 + 状态码（-1 元数据错误、-2 超限）
historyExport.ts:39-104 | Blob/URL.createObjectURL/document 锚点下载 + Date/toISOString | 无 DOM 与 Date | downloadTextFile 签名保留的空操作桩；时间戳格式化留空
historySearch.ts:86-100 | 泛型 <T extends HistoryThreadLike> + map/filter/sort 链 | SLA 无泛型 | 具体化为 HistoryThreadLike 数组
historySearch.ts:225-237 | Unicode NFKD 规范化 + \p{M}/\p{L}/\p{N} 正则 | 无 Unicode 规范化与属性正则 | 字节级近似占位
historySearch.ts:263-295 | 动态 number[] DP 行（boundedLevenshtein） | 无动态数组 | 定长行缓冲 [u64; 128] 近似
i18n.ts:1-100 | React hooks useState/useEffect/useCallback/useMemo + JSON 模块导入 + localStorage + document.documentElement | SAX/SLA 无 React 行为层与 Web Storage | I18nState struct + 普通函数；语言包 JSON 缓冲；readStoredLocale 默认 "en"
i18n.ts:78-92 | Object.entries + replaceAll 模板插值（TranslateFn） | 无动态对象遍历 | JSON 扫描近似
imageCommand.ts:22-44 | async + AbortController + setTimeout/DOMException + Map<string, AbortController> + Promise.all | 无 async/Abort/定时器 | 同步状态码 + jobs 表近似 + 顺序转换
imageRuntime.ts:25-44 | Array.sort 打分闭包 + /deepkey/i 正则 + find 链 | 无闭包排序与正则 | 打分规则注释保留，循环骨架近似
imageRuntime.ts:46-80 | Object.fromEntries/entries 动态对象 + reverse() 迭代动态 turn/item | 无动态对象 | JSON 缓冲 + 下标递减循环
imageThreadHistory.ts:14-87 | JsonValue 动态树构造 + Date.now()/Math.random() 生成 id | 无动态值树与随机/时钟源 | JSON 缓冲构建注释；id 生成留待修复阶段
imageThreadHistory.ts:100-109 | async fetch/Blob/File | 无 fetch 与 File API | 同步状态码桩（-1）
launchAdapters.ts:32-256 | 模板字面量 githubUrl + 大型字符串记录常量数组 | 无插值，常量表逐行展开成本高 | 12 行目录以注释表完整保留（id/product/repo/required/envPrefix/双语 summary 与 install）+ count/at 访问器
launchAdapters.ts:262-266 | Array.find 非空断言 !（CODE_LAUNCH） | 无断言语义差别 | 直接取第 0 项函数
modelReasoning.ts:17-110 | Record 动态索引 group.modelCapabilities?.[model] + Map + flatMap + 对象展开 | 无动态索引与展开 | JSON 缓冲 + 合并规则注释
mui-icons-material.d.ts:1-6 | declare module "@mui/icons-material/*" 环境模块声明（通配） | SLA @import 无通配模块声明 | 声明转发注释文件 + 占位 struct，无运行时代码
newChatWorkspacePolicy.ts:3-5 | PermissionPresetId 字符串联合相等判断 | (ptr,len) 字符串相等助手未定 | 长度先行判断近似
permissionPresetDisplay.ts:4-28 | TranslateFn 回调函数值参数 | 无一等函数值（以函数指针近似） | t_fn 函数指针参数 + key 分派注释
planContinuation.ts:3-5 | 模板字面量拼装长提示常量 | 无字符串插值 | 缓冲拼装函数桩，常量全文以注释保留
promptDisplay.ts:8-32 | trim/slice/lastIndexOf 字符串操作链 | (ptr,len) 字符串助手未定 | 逻辑注释直译 + 长度透传
ptyDataBus.ts:7-52 | Map<string, Set<回调>> + 返回退订闭包 + try/catch 包裹监听调用 | 无闭包/Map/Set 与异常 | 定长监听表（256）+ 函数指针 + 显式 unsubscribe 函数；错误忽略近似
ptyTerminalRegistry.ts:16-90 | Map<string, handle 对象> + xterm buffer 对象面（getLine/translateToString/select/scrollToLine） + 闭包游标状态 | 无 xterm 对应物与闭包 | 函数指针表 + BufferSearchState struct + 命名函数族
relayNameValidation.ts:5-7 | RegExp replace（含中文后缀 中转站? 与字符类） | 无正则，中文后缀需 UTF-8 扫描 | 字节扫描占位
relayNameValidation.ts:9-15 | 嵌套 some 闭包遍历 providers 动态字段 | 无闭包 | 规则注释 + 线性扫描骨架
remoteTurnErrors.ts:4-38 | RegExp /(?:^|\b)(?:401\s+)?unauthorized(?:\b|$)/i 词界匹配 | 无正则 | 该分支以注释标注，其余 includes 分支以子串扫描近似
serverRequests.ts:9-64 | Set<string> 方法集合 + JsonValue 动态对象构造/读取 | 无 Set 与动态对象 | 字面量顺序比较 + JSON 缓冲构建注释
storageNamespace.ts:4-20 | window.localStorage（Storage 长度/key/getItem/setItem） + try/catch | 无 Web Storage 与异常 | storage_id 句柄近似；计数循环保留，错误忽略
taskNotifications.ts:4-138 | 判别联合事件 + Set/Map tracker（插入序淘汰） + JSON.parse(Storage) + Object.values 遍历 + 正则提取 HTTP 状态 | 无联合类型/集合/Storage | tag+字段 struct、定长表、JSON 缓冲；正则分支占位
taskTabs.ts:15-264 | 递归联合类型 WorkspaceLayoutNode + 递归闭包（normalizeNode/visit/remove/parseNode） + splice/flatMap + Storage/JSON.parse + EventTarget.closest | 无递归闭包与 DOM | JSON 缓冲节点树 + 命名递归函数 + 重建缓冲近似 splice
threadRuntimePermission.ts:6-32 | unknown 字段的 typeof 运行时判别 | 无 unknown/typeof | tag + has 标志近似
threadSelection.ts:1-37 | 泛型 MutableValue<T> 引用单元 | 无泛型 | 具体化 number 与 string|null 两种 cell struct
webPreview.ts:1-7 | 纯类型文件（字符串联合 + 可空字段） | 无缺陷性问题，仅类型映射 | mode 编码 u64（0 side / 1 window），threadId 以 isNull 标志
workspacePaths.ts:1-106 | RegExp 盘符判定/尾分隔符处理 + replaceAll + Set 去重（大小写不敏感） | 无正则 | 字节扫描近似，规则逐函数注释保留
workspaceSelectionVisibility.ts:1-13 | 纯布尔组合逻辑 | 无能力缺口 | 1:1 直译为 if 链（activeThreadId 仅用其 null 性）
advancedRelayDirectory.ts:44-53 | directory.find ?? directory[0] 返回对象引用或 undefined | 无可空对象引用 | 返回下标 u64，undefined 以 18446744073709551615 近似
contextUsage.ts:17-51 | number|null 以 ?? 链与三元嵌套表达 | 无可空数值 | has 标志参数 + out_has 出参
groupCollection.ts:199-216 | provider.nativeModels 等跨文件 shared 结构字段 | 依赖 @codex-ui/shared 未转换单元 | JSON 字段名注释保留，待 shared 单元落地后对齐
historyExport.ts:5 | 跨文件导入 threadReadToTurns/mergeWorkbenchTurns 等（state/ 子目录单元） | 依赖其它转换单元 | @import 关系以注释登记，函数名原样引用
i18n.ts:27-28 | 从 "@cxu/sdk-frontend" 再导出 TranslateFn/TranslationKey 类型 | SDK 前端类型未转换 | 注释登记再导出关系，无运行时代码
imageCommand.ts:14 | timeoutMs 可选字段与 ?? 默认（edit 180_000 / generate 150_000） | 无可选字段 | has 标志 + 默认值规则注释
taskTabs.ts:248-251 | ThreadEntry 仅用 id 字段 | 依赖 state/codexClient 单元类型 | 以 id 的 (ptr,len) 数组近似
threadSelection.ts:30-37 | threadId === activeThreadId 字符串相等 | (ptr,len) 相等助手未定 | 长度相等先行判断近似

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次候选均不确切，见下。
- async 归类改记：本日志 async/Promise 条目共 4 条（goalContinuation、historyExport、imageCommand 等），修复阶段改记为参照 sa_std async 面评估（async.sla 的 sched_*/block_on_timeout、future.sa、sync/mpsc.sa、sync/mutex.sa、thread.sa）；代码层本轮不重构。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 9、Array 11、Math 2、RegExp 10、Map/Set 11 条（条目可跨类重复计数）。具体候选：chatTypography 的 RegExp 十六进制校验占位——候选 @ts_str_hex_i0，语义（单字节 vs 句柄下标）待核对；clientPlatform / codexCliRecovery 的子串扫描占位——候选 string.sai 的 sa_string_index_of（大小写不敏感变体无对应）；contextUsage 的 Math.round/min/max 为 f64 语义，@ts_math_* 整数面不合；groupCollection 的 localeCompare——@ts_str_compare 为字节序比较，与 locale 语义不合；historySearch 的 sort 链与 Levenshtein DP 行缓冲——对象数组/动态行，与 ts_array word 数组模型不合。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。

===== 批次 web-ts-theme-waterfall（日志条目 37）=====

# web-ts-theme-waterfall 缺陷日志

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

apps/web/src/theme/types.ts:1-19 | string 字面量联合类型 BuiltinThemeId | SLA 无联合类型 | 索引访问函数 builtin_theme_id_at + count
apps/web/src/theme/types.ts:21-22 | ThemeId = BuiltinThemeId \| (string & {})、ThemeMode | SLA 无开放字符串交叉类型 | (ptr,len) 字符串
apps/web/src/theme/types.ts:24-89 | 带可选字段的对象类型 ThemeBackgroundScene/ThemePlugin/Assets/Layout/ThemePalette | SLA 无可选字段/动态对象 | struct + 定长字节数组字段 + has_* 标志
apps/web/src/theme/index.ts:4-8 | export * barrel 再导出（含 .tsx 的 theme-provider） | SLA 无再导出语义 | @import 转发 + 注释说明
apps/web/src/theme/index.ts:10-12 | Array.filter/map 闭包链 installedThemePluginDefaults | SLA 无闭包/高阶函数 | for 顺序循环 + JSON 数组字面量
apps/web/src/theme/index.ts:14-28 | 类型谓词 value is ThemeId/BuiltinThemeId、Array.some 闭包 | SLA 无类型守卫 | 返回 bool + 逐字节比较循环；customPlugins.some 以 JSON 文本扫描占位
apps/web/src/theme/core/shadows.ts:1-34 | MUI Shadows 元组类型 import type + 25 元字符串数组 | 无 MUI 类型系统 | 索引访问函数 base_shadow_at（值逐字保留）
apps/web/src/theme/core/custom-shadows.ts:15-45 | 嵌套对象字面量常量 customShadows{light,dark} | 动态对象 | JSON 文本缓冲 + 键序访问函数
apps/web/src/theme/core/typography.ts:1-62 | MUI typography 对象字面量 + as const 字面量类型 | 动态对象/字面量类型 | TypographyVariant struct + 变体名/字重/行高访问函数，字段值注释保留
apps/web/src/theme/core/palette.ts:3-14 | 模板字符串、Array.map/join、闭包 mixChannel | 无模板字符串/高阶函数 | 缓冲区函数 mix + 独立 mix_channel 函数；十六进制格式化留修复期
apps/web/src/theme/core/palette.ts:16-35 | 元组返回 [number,number,number] \| null、parseInt、split/map、非空断言 ! | 无元组/联合 null/断言 | Rgb struct + ok 标志 + hex_digit_value/hex_pair_value
apps/web/src/theme/core/palette.ts:37-331 | Array.find 闭包、switch 返回对象字面量、themePaletteFromPlugin 动态拼装 | 动态对象 | 每 case 调色板逐字存为 JSON 文本 + 顺序 (ptr,len) 比较分发
apps/web/src/theme/core/components.ts:5-214 | MUI Components<Theme> CSS-in-JS 嵌套对象、alpha()、模板插值 ${}、& 选择器/伪元素 | 无 MUI/CSS-in-JS 对应物 | JSON 文本缓冲 + 13 个 section 名访问函数，全部样式事实以注释逐字保留
apps/web/src/theme/theme-config.ts:3-236 | ThemePlugin[] 对象数组字面量（19 个插件） | 动态对象数组 | 每插件一条 JSON 文本缓冲 + id/installedByDefault/dark 访问函数；重复 layout 以 L0 简写登记展开式
apps/web/src/theme/theme-config.ts:238-258 | 数字键对象 grey + as const | 无数字键对象/字面量类型 | grey_key_at/grey_value_at 索引访问函数
apps/web/src/theme/visual-tuning.ts:36-61 | 可选链 ?.、空值合并 ??、嵌套可选 layout/assets/preview | SLA 无 ?./?? | ThemePlugin 的 has_* 标志驱动分支
apps/web/src/theme/visual-tuning.ts:78-94 | unknown 类型、Number() 强转、Number.isFinite、isHexColor 正则 /^#([0-9a-fA-F]{3}\|{6})$/ | 无 unknown/强转/RegExp | (has_number,f64,is_finite) 见证参数 + 手工十六进制扫描
apps/web/src/theme/visual-tuning.ts:63-76 | Math.round（unitToPercent/clampThemePercent/clampThemeBlur） | f64 取整语义差异 | 返回未取整值并标 DEFECT，修复期 +0.5 截断
apps/web/src/theme/create-theme.ts:9-59 | MUI createTheme/alpha、Object.fromEntries、Array.from、as any、sdk-frontend 增强主题类型 import type {} | 无 MUI/高阶构造/类型断言 | JSON 组装 + for 循环 + info/success/warning/error/contrast/borderRadius 逐项访问函数
apps/web/src/waterfall/types.ts:1-2 | export * from "@cxu/sdk-frontend"（行契约在 SDK） | 外部 SDK 契约不在本单元内 | 按本单元全部调用点重建 ChatWaterfallRow/WorkbenchItem/Turn/TokenUsage 等 struct，payload/groupedRows 用 JSON 缓冲
apps/web/src/waterfall/chatRowEstimates.ts:4-36 | 可选参数 ?. 与 ?? 默认值、String.includes("```")、groupedRows?.length | 无可选链/includes | has_* 标志 + 调用方传入 has_code_fence；分组数用 grouped_rows_count
apps/web/src/waterfall/taskPlan.ts:18-51 | filter/map/filter 类型谓词闭包链、模板字符串 id/sourceKey、动态 payload.plan 遍历、orderWorkbench* 外部排序 | 无闭包/动态 JSON 遍历 | JSON 缓冲遍历（修复期），胜出规则（自尾扫描、首个 steps>0 的 plan）逐字保留于注释
apps/web/src/waterfall/taskPlan.ts:53-72 | RegExp replace(/[_-]+/g,"")、toLowerCase、unknown + String.trim（stringValue/normalizeTaskPlanStatus） | 无 RegExp/trim | 调用方预规整字符串 + 见证函数，按规整后长度分发状态
apps/web/src/waterfall/virtualRowMeasurements.ts:1-66 | DOM Element/ParentNode、querySelectorAll、dataset、getBoundingClientRect、offsetWidth/Height、isConnected、scrollTop、回调类型 VirtualRowResizer、forEach 闭包、模板选择器 | sa_std 无 DOM | 宿主提供的元素描述符 struct + 顺序循环；选择器/滚动由 SAX 宿主桥在修复期执行
apps/web/src/waterfall/waterfallRowRefreshQueue.ts:3-44 | class + private 字段、数组引用同一性 ===（applied/pending 比较） | SLA 无类/引用同一性 | struct + 函数族；引用同一性以 generation 计数器近似
apps/web/src/waterfall/agentPages.ts:34-52 | 泛型 <T extends AgentPageSession>、slice/spread 数组构造 selectAgentRailSessions | 无泛型 | 索引算术函数（limit/截断/追加 selected 的计数规则逐字保留）
apps/web/src/waterfall/agentPages.ts:59-102 | ReadonlyMap.get、Array.at(-1)、模板字符串、filter(Boolean).join("\n").toLowerCase()、对象字面量行构造 | 无 Map/动态对象 | JSON 缓冲 + 每 agent 一行计数函数，字段拼装规则逐字保留于注释
apps/web/src/waterfall/pendingRows.ts:24-53 | filter/map 闭包、satisfies、模板 key、toLowerCase、?? 默认值构造 payload | 无闭包/satisfies | JSON 缓冲 + mode 判定函数，行/条目字段规则逐字保留于注释
apps/web/src/waterfall/pendingRows.ts:55-125 | spread 拼接 [...a, ...b]、动态 payload Record 读取、String.trim/includes（pendingUserTextsMatch） | 无动态对象/trim/includes | 见证函数 + 相等比较已实现、includes 子串扫描留修复期；占位线程 pending-new-thread 规则保留
apps/web/src/waterfall/stableChatRows.ts:7-112 | 引用同一性记忆化（返回旧对象引用）、Map 按 key、对象 spread {...next}、索引访问类型 ChatWaterfallRow["item"]、every 闭包 | SLA 值语义无引用同一性 | generation 计数器 + rowsEqual/sameItem/sameFloor/sameStrings 相等函数族，判定规则逐项保留
apps/web/src/waterfall/chatRows.ts:1-8 | Record<string, T> 索引映射参数、函数类型 ChatRowFilter、默认闭包 () => true | 无 Record/函数类型 | JSON 文本缓冲 + 不透明 id
apps/web/src/waterfall/chatRows.ts:10-40 | Date.now() 默认参数、spread/slice/filter/map（selectTurnsForWaterfallMode post-compaction/recent-tools） | 无 Date.now/数组高阶操作 | now_ms 参数 + 计数/边界索引函数，筛选规则逐字保留于注释
apps/web/src/waterfall/chatRows.ts:56-243 | Map/Set 缓存 IncrementalChatRowsCache、forEach 闭包捕获可变 reasoningBuffer、join("\n\n")/trim、reverse().find() | 无 Map/Set/闭包捕获 | JSON 缓冲 + generation，推理缓冲拼接规则逐字保留于注释
apps/web/src/waterfall/chatRows.ts:245-460 | Map 按 key 复用、spread {...row}、Set（assistant header/compaction）、嵌套 flushRun 闭包的连续行折叠（tool/retry/plan/compaction 四组） | 无闭包/Map/Set | 计数函数 + 复用判定函数 reuseFinalizedRow/finalizedRowsEqual，折叠规则逐字保留于注释
apps/web/src/waterfall/chatRows.ts:461-576 | itemToRow 条件 spread ...(kind===... ? {...} : {})、?? 链 updatedAt、itemKind 的 toLowerCase().includes("error") | 无条件 spread/RegExp 式字符串操作 | itemKind/rowRole/rowWidth 按 (ptr,len) 全量分发已实现；contains_error 由调用方标志提供
apps/web/src/waterfall/chatRows.ts:578-754 | command/fileChange 分组行与 Set<string> 路径去重、reasoningText 的 payload.summary 联合（string\|array\|record）、summarizeReasoningEntry、safeJson 的 JSON.stringify try/catch | 无 Set/动态联合/JSON.stringify 动态值 | JSON 缓冲 + kind 计数函数，summary 分派与键序 [text,summary,content,message] 保留
apps/web/src/waterfall/chatRows.ts:756-1004 | RegExp 多处（normalizeReasoningMarkdown \*{4} 前瞻、compactLine \s+、cleanPreviewUrl 字符类含中文标点）、URL API new URL、matchAll 全局正则迭代（detectLocalPreviewUrl） | sa_std 无 RegExp/URL API | 分段字符串手术判定函数 cleanPreviewUrl 入参见证化；正则引擎与 URL 解析列为修复期前置能力

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次候选均不确切，见下。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 15、Array 13、Math 1、RegExp 4、Map/Set 11 条（条目可跨类重复计数）。具体候选：theme/core/palette 的 parseHex 内 hex_digit_value/hex_pair_value 手工扫描——候选 @ts_str_hex_i0，但其入参形态（单字节 vs {ptr,len} 句柄）待核对，不硬绑；visual-tuning 的 isHexColor 手工十六进制扫描同候选；visual-tuning 的 Math.round 条目为 f64 取整，@ts_math_* 整数面不合；waterfall/taskPlan 的 String.trim/RegExp replace 条目现为调用方预规整，候选 @ts_str_trim（句柄模型）待评估；agentPages 的 slice 条目为计数算术函数，非数组本体操作。
- async：本日志无 async/Promise 条目，无归类改记。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。

===== 批次 web-ts-misc（日志条目 59）=====

# web-ts-misc 缺陷日志（CXU plugins @ f2cb649d，批量转换阶段：只记录不修复）

apps/web/src/composer/PendingSendGate.ts:2-3 | class + Set<string> 字段 | SLA 无 Set 类型 | struct + 定长字符串表（容量 256）+ len 字段
apps/web/src/composer/PendingSendGate.ts:5-28 | Set.has/add/delete 按字符串值语义 | (ptr,len) 字节比较只是近似，delete 无等价实现 | has 用字节比较桩，release 暂作记账占位
apps/web/src/composer/composerMenuShortcuts.ts:1-3 | string === 值比较 | SLA 无字符串值相等原语 | 以 (ptr,len) 长度+字节近似（本例退化为 len 判断）
apps/web/src/composer/composerSlashCommands.ts:1-19 | 判别联合类型 + 可选字段 + 跨模块 type 导入 | SLA 无联合/可选/外部类型模块 | 单 struct + type 标签 + has_* 标志，外部类型降为字符串标签
apps/web/src/composer/composerSlashCommands.ts:23-40 | readonly 对象数组字面量 COMPOSER_SLASH_COMMANDS | 无动态对象数组 | 定长表 + 顺序注释保留 33 条定义
apps/web/src/composer/composerSlashCommands.ts:42-46 | Set<string> 字面量 | 无 Set | 线性扫描辅助函数桩
apps/web/src/composer/composerSlashCommands.ts:48-57 | RegExp exec + trim/startsWith + Array.some 闭包 | SLA 无正则引擎、无闭包 | 手工扫描留待修复阶段，some 改循环
apps/web/src/composer/composerSlashCommands.ts:58-99 | switch 返回对象字面量 + {...spread} | 无动态对象/展开 | out struct 字段填充
apps/web/src/composer/composerSlashCommands.ts:101-121 | 正则分词 /"[^"]*"|'[^']*'|\S+/g、Record 查表、嵌套三元链 | 无正则、无动态 Record | token 遍历近似，查表/三元链改标签判断
apps/web/src/composer/composerSubmission.ts:1-9 | async 函数 + () => boolean | Promise<boolean> 形参闭包 | 无 Promise、无函数值 | 同步函数 + 主机回调 id + bool 返回
apps/web/src/composer/sendReconcile.ts:10-21 | unknown + Record<string, unknown> + 属性访问 record.code | 无动态对象 | 错误值降为 JSON 文本缓冲 + 字段探测
apps/web/src/composer/sendReconcile.ts:23-51 | 递归 + instanceof Error + try/catch + JSON.stringify 兜底 | 无异常、无反射 stringify | 迭代 JSON 缓冲遍历近似
apps/web/src/composer/sendReconcile.ts:71-88 | Array.some 闭包 + readonly 数组逆序遍历 | 无闭包 | items_json 循环近似
apps/web/src/composer/sendReconcile.ts:97-118 | async + EventTarget 订阅 + setTimeout + .catch/?? + try/finally dispose | 无 Promise/事件/定时器/异常 | 同步状态码流程，等待窗口改主机轮询，dispose 各出口重复调用
apps/web/src/free/useFreeCompaction.ts:1-62 | React hooks（useCallback/useEffect/useRef/useState）+ 约 50 个跨模块导入 | hooks 语义（重渲染/依赖数组/清理）无 SLA 对应 | 普通 struct + 函数族，effect 改一次性函数由主机在输入变化时调用
apps/web/src/free/useFreeCompaction.ts:86-130 | 输入对象 ComposerCoreInput & refs（Map/Record/Set ref、函数 ref） | 无动态对象/泛型 ref | JSON 文本缓冲 + 命名 ref id 字段
apps/web/src/free/useFreeCompaction.ts:147-166 | Promise 去重（in-flight promise 身份比较）+ .then/.finally 链 | 无 Promise | 同步顺序调用 + 状态码
apps/web/src/free/useFreeCompaction.ts:168-180 | window.codexUltraDesktop?.notify 桌面桥 + 可选链 + .catch | 无桌面桥 API | 主机 notify 调用近似
apps/web/src/free/useFreeCompaction.ts:182-190 | async useCallback syncOmniRouteFree（await 链） | 无 async/await | 同步 + 状态码
apps/web/src/free/useFreeCompaction.ts:192-245 | 两个 useEffect（启动刷新；60s setInterval 许可检查 + cancelled 清理） | 无 effect 生命周期/定时器 | 主机定时注册，检查体保留为单独函数
apps/web/src/free/useFreeCompaction.ts:247-380 | async 发送前 barrier：Promise executor + setTimeout 5 分钟超时 + waiter 闭包捕获 + client.rpc await | 无 Promise/定时器/闭包捕获 | 同步状态码 + 主机 waiter 注册表
apps/web/src/free/useFreeCompaction.ts:330-345 | SetStateAction 更新器闭包 (current => {...current, [id]: ...}) + try/catch/finally + catch 中 rethrow | 无闭包/异常 | 主机状态补丁，各出口显式清理，错误以状态码传播
apps/web/src/free/useFreeCompactionSelection.ts:18-30 | hook 输入：Dispatch/SetStateAction/MutableRefObject + Pick<> 泛型 | 无 React 类型体系 | 主机回调 id + 状态快照 struct
apps/web/src/free/useFreeCompactionSelection.ts:32-50 | 对象展开 {...selectionForThread(...)} 构造 nextSelection | 无动态对象 | JSON 文本缓冲补丁经回调写回
apps/web/src/free/useFreeCompactionSelection.ts:52-65 | 模板字符串 routeLabel + Date.now() 生成 notice id + 中文文案插值 | 无模板字面量 | 主机 notice 缓冲拼装，文案留修复阶段
apps/web/src/free/useFreeCompactionSelection.ts:140-160 | Array.find/filter 闭包 + Array.from(new Map(...).values()) 按 providerId 去重 | 无闭包/Map | 线性扫描 + seen 集近似
apps/web/src/free/useFreeCompactionSelection.ts:163-242 | ThreadRuntimeSelection 动态字段读写 + 可选链 ?. 与 ?? | 无动态对象/可选链 | struct 访问器字段 + has_* 标志
apps/web/src/components/workspaceDrag.ts:9 | Set<string> IMAGE_EXTENSIONS | 无 Set | 线性扫描辅助函数
apps/web/src/components/workspaceDrag.ts:23-27 | DOM DataTransfer setData/effectAllowed | 无 DOM API | 拖拽数据降为 JSON 文本缓冲
apps/web/src/components/workspaceDrag.ts:29-45 | JSON.parse 动态对象 + 类型谓词校验 + try/catch | 无动态对象/异常 | JSON 缓冲字段探测近似
apps/web/src/components/chatgpt-shell/chatgpt-mui-theme.ts:41-83 | MUI createTheme 动态嵌套主题对象 + Theme 类型 | 无 MUI/动态对象 | 主题降为 JSON 文本缓冲 struct
apps/web/src/components/chatgpt-shell/chatgpt-mui-theme.ts:36-39,83 | MUI alpha(color, opacity) 颜色计算 | 无颜色库 | 预计算 rgba 字面量留修复阶段
apps/web/src/mobile/useIsMobile.ts:10-16 | React hook useMediaQuery（MUI）+ 模板字符串 media 查询 | hooks 响应式语义无对应 | 普通快照函数，读主机提供的视口/指针/方向标志
apps/web/src/onboarding/steps.ts:1,10-93 | driver.js DriveStep 动态对象 + 数组字面量 + splice(4,0,step) 插入 | 无动态对象 | 每步 JSON 文本缓冲 + 定长 7 槽数组
apps/web/src/onboarding/steps.ts:10 | t: (k: string) => string 函数形参（i18n 闭包） | 无函数值 | 主机回调 id
apps/web/src/onboarding/steps.ts:95-103 | 默认参数 = 函数值 isVisibleSelector；document.querySelector + getBoundingClientRect | 无 DOM API | 回调 id（0=默认）+ 主机可见性探测
apps/web/src/setup-guide/setupGuideState.ts:2 | 模板字面量拼接 storage key | 无模板字面量 | 固定字面量缓冲 "codex-ultra.setup-guide.v1"
apps/web/src/setup-guide/setupGuideState.ts:4-22 | localStorage get/set/removeItem + try/catch 吞错 | sa_std 无 localStorage | 主机 KV 存储 + 状态码（错误按源语义吞掉）
apps/web/src/performance/animationBudget.ts:6-7 | Map<string, boolean> 模块状态 | 无 Map | 定长源名表（容量 32）留修复阶段
apps/web/src/performance/animationBudget.ts:9-12 | window.matchMedia("(prefers-reduced-motion: reduce)") | 无浏览器 API | 主机提供的布尔标志
apps/web/src/performance/animationBudget.ts:14-38 | addEventListener/removeEventListener + CustomEvent + 返回取消订阅闭包；documentElement.dataset 写入 + dispatchEvent | 无 DOM 事件系统 | 监听器注册表 id 近似，事件分发改主机调用
apps/web/src/performance/lowFpsDiagnostics.ts:27 | Number.isFinite 对 fps 的 NaN/Inf 语义 | f64 NaN 语义不完全等价 | 主机 math 辅助留修复阶段
apps/web/src/performance/lowFpsDiagnostics.ts:88-216 | 返回 Record<string, unknown> 大型动态报告 + 全量 DOM 查询（querySelector(All)/dataset/getAnimations/performance.memory/navigator/Date.toISOString） | 无动态对象、无 DOM | JSON 文本缓冲输出，DOM 派生字段全部改主机探测
apps/web/src/performance/lowFpsDiagnostics.ts:218-226 | HTMLElement | null + getAttribute/dataset + Number() 转换 | 无 DOM 元素句柄语义 | 主机 DOM 探测，null 用 -1 哨兵近似
apps/web/src/performance/topicDiagnostics.ts:26-27 | 模块级存储的函数值 provider（() => Diagnostics）| null | 无函数值 | provider 回调 id，0 = null
apps/web/src/performance/topicDiagnostics.ts:37-57 | 对象展开合并 {...transcript, ...usage} + Partial<> 类型 | 无动态对象（本例形状静态） | struct 字段拷贝
apps/web/src/utils/recentWorkspaces.ts:13-21 | 正则 replace(/\\/g, "/") + toLowerCase + slice | 无正则、字符串为 UTF-16 语义 | 字节级 ASCII 遍历近似
apps/web/src/utils/recentWorkspaces.ts:23-105 | localStorage + JSON.parse/stringify 动态数组 + 类型谓词 filter + try/catch | 无 localStorage/动态对象/异常 | 主机存储 + JSON 文本缓冲探测，Date.now 改主机时钟
apps/web/src/utils/recentWorkspaces.ts:39-46,109-116 | window.dispatchEvent(new CustomEvent("codex-recent-workspaces-changed")) | 无 DOM 事件 | 主机事件分发近似
apps/web/src/utils/recentWorkspaces.ts:118-165 | SaVmPolicyConfig 动态对象 + createDefaultSaVmPolicyConfig 外部依赖 + {...base.tools} 展开覆盖 | 无动态对象 | JSON 文本缓冲补丁
apps/web/scripts/build.ts:1-14 | 顶层 await + node:fs/promises 异步 API | 无顶层 await/异步 fs | main() + 同步 sa_std fs + 状态码
apps/web/scripts/build.ts:9,14 | import.meta.url + Date.now/Math.random 生成 buildId（toString(36) 模板字面量） | 无 import.meta/等价 RNG 语义 | 主机提供脚本路径与时钟/RNG 缓冲
apps/web/scripts/build.ts:16-34 | Bun.build 打包器 API + result.logs/outputs 动态对象 | sa_std 无打包器对应 | 主机工具调用近似，结果降为 JSON 缓冲
apps/web/scripts/build.ts:56-61 | 模板字符串正则 replace 注入 script/meta 标签 | 无正则 replace | 字面量扫描替换近似
apps/web/scripts/build.ts:75-85 | esbuild transform 异步压缩 service worker | 无 esbuild 对应 | 主机工具调用近似
apps/web/scripts/build.ts:87-104 | toFixed(1/2) 浮点格式化 + Bun.Glob for-await 异步迭代 + throw Error | 无异步迭代/异常 | 定长缓冲格式化、递归目录遍历、状态码代替 throw
apps/web/scripts/preview.ts:8-9 | import.meta.url + process.env 读取（PORT/HOST ?? 默认值） | 无 import.meta | sa_env_get + 主机路径近似
apps/web/scripts/preview.ts:17-32 | Bun.serve + Fetch API（Request/Response/URL）fetch 处理器闭包 | 仅有部分 sa_std http-server 对应 | 原始缓冲请求分发函数近似，服务循环主机驱动
apps/web/scripts/preview.ts:34-45 | decodeURIComponent + Bun.file 文件响应 + SPA 回退 | 无 URL 解码/文件响应对象 | 字节遍历解码 + 缓冲写出近似

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次候选均不确切，见下。
- async 归类改记：本日志 async/Promise 条目共 7 条（composerSubmission、sendReconcile、useFreeCompaction 等），修复阶段改记为参照 sa_std async 面评估（async.sla 的 sched_*/block_on_timeout、future.sa、sync/mpsc.sa、sync/mutex.sa、thread.sa）；代码层本轮不重构。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 9、Array 7、Math 1、RegExp 4、Map/Set 8 条（条目可跨类重复计数）。具体候选：PendingSendGate / composerSlashCommands / workspaceDrag 的 Set<string> 定长表线性扫描——字符串键集合，collections btree_set 的键类型待核对，不硬绑；useFreeCompactionSelection 的 Map 去重线性扫描同注记；composerSlashCommands 的正则分词手工扫描——ts 面无分词对应，候选 @ts_str_split 仅在分词规则可化为定界符切分时成立，待评估。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。
