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
