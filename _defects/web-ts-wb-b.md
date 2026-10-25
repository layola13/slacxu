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
