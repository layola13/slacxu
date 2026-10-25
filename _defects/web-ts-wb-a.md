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
