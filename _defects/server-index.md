# server-index 单元缺陷日志（apps/server/src/index.ts → index.sla）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## 运行时/语言机制类
- index.ts:1-296 | node:* 内置模块导入（path/url/crypto/fs/os/child_process/util） | sa_std 无对应面（仅 fs/json/http/process 子集） | @import 注释清单登记，未实际导入
- index.ts:1-296 | 跨包导入 @codex-ui/shared、@cxu/sdk-backend、backends/*、apps/duck2api | 依赖各单元转换产物，接口形状未定 | @import 注释 + 符号清单，待各单元落地后接线
- index.ts:3 | `declare const CXU_VERSION` 构建期注入常量 | SLA 无 bundle-time define | 运行时常量占位（"dev" 语义保留）
- index.ts:329-339 | class HttpApiError extends Error（类继承） | SLA 无类/继承 | struct + 构造 fn； instanceof 收窄改为显式 status/code 检查（近似登记）
- index.ts:341-385 | 泛型 createLazyBridge<T> + Proxy get 陷阱 + Reflect | 无泛型、无 Proxy/反射 | LazyBridge struct + factory_id 分发 + ensure 显式调用；延迟监听存 JSON 文本重放
- index.ts:386-392,610-660,778-886 等 | Map/Set 全文件贯穿（约 40+ 处） | SLA 无 Map/Set | JSON 文本注册表句柄近似，迭代顺序不保证
- index.ts:473-650 | process.env 读写（含回写 CODEX_UI_TOKEN） | sa_std env 只读子集，无 setenv | 注释登记；token 生成保留 randomBytes 语义标注
- index.ts:全文件 | async/await（约 120+ 个 async 函数 + 顶层 await 序列 1750-1962） | SLA 同步模型 | 同步 fn + 状态码/注释；启动序列改为顺序注释清单
- index.ts:全文件 | try/catch + console.log/warn/error/info 日志 | 无异常机制、无 console 面 | 注释登记错误路径；日志调用未落地
- index.ts:1750-1756,11828-11840 | Promise 链（providerActivationQueue 互斥、claudeConfigCleanup 值） | 无 Promise | 注释近似（串行队列语义说明）
- index.ts:1392-1384 区段（runEmbeddedOpencodeLocalTurn） | Promise executor + AbortSignal + setTimeout + EventEmitter.once | 无事件/信号/定时器面 | 语义注释完整保留（收集文本、超时、中断、finishEarly 分支）
- index.ts:2183-2241,12083-12097 | setInterval 心跳/会话清扫、setTimeout 防抖（远端游标持久化） | 无定时器 | 注释登记周期与参数，待 std 定时器面
- index.ts:1690-1720,2112-2130 | process.once("exit")/SIGINT/SIGTERM/beforeExit 信号钩子 | 无信号钩子 | 注释登记清理清单

## 动态 JSON / 类型系统类
- index.ts:7979-7981 | asRecord 动态对象收窄（全文件数百处调用） | 无动态对象/unknown | JSON 句柄（u64）传递，字段访问走 sa_json_* 约定（近似）
- index.ts:52-296 | 大量 type-only 导入（JsonValue、ProviderConfig、ThreadAgentRoster 等） | 共享类型在 packages/shared 单元 | 符号清单注释，类型以 JSON 句柄/struct 近似
- index.ts:316-327 | SocketData 中 AuthUser|null、number|null 联合类型 | 无联合/可空类型 | has_* 布尔旁位字段近似
- index.ts:6444-6457,8290-8315 | Record<string, unknown> 动态记录参数（workspace 输入、launch env） | 动态对象 | JSON 文本缓冲近似
- index.ts:13567-13616 | providerToCodexConfig 等 JsonValue 构造（对象字面量深嵌套） | 无对象字面量 | 注释描述目标形状，待 JSON 构建器约定
- index.ts:3642-3655,13907-13919 等 | 正则校验（cli slug、env 开关 /^(1|true|yes)$/i、standalone exe 名、RPC 方法名模式） | SLA 无 RegExp | 等值/前缀比较近似并逐处登记
- index.ts:全文件 | 模板字符串 URL/日志拼装（relay-gateway URL、catalog 警告等） | 字符串构建器未定 | (ptr,len) 拼接注释近似

## Node/Bun 平台 API 类
- index.ts:2192-2241 | Bun startRuntimeServer（fetch + websocket 处理器对象、server.upgrade、requestIP） | sa_std http server 面不同（无 WS upgrade 对象模型） | 处理器语义注释保留；WS open/message/close 三回调逐项登记
- index.ts:13648-13669,8316-8321 | fetch Request/Response/Headers 对象（jsonResponse、imageRequestErrorResponse 等） | 无 fetch 对象模型 | 状态码+JSON 文本近似
- index.ts:5648 区段（attachments/upload） | request.formData() + File/arrayBuffer | 无 multipart/File 面 | 注释登记 saveUploadedAttachment 契约
- index.ts:7890-7938 | Bun 文件响应 + br/gzip 预压缩静态资源、existsSync 探测 | sa_std fs 只有基础读写 | 语义注释（路径穿越防护、编码协商、缓存策略完整保留）
- index.ts:8051-8107,13961-14256 | node:os/process 指标（cpus/loadavg/cpuUsage/memoryUsage、PowerShell CIM 进程树采样） | 无 os 指标面 | 注释登记 SystemMetrics 形状
- index.ts:8815-8831,8532-8800 | child_process execFile/spawn（SSH 远程命令、浏览器打开、安装脚本） | process spawn 有 bidi 子集，无 execFile 便利层 | 注释登记命令与引用规则（quoteRemoteShell 等）
- index.ts:1963-1990 | import.meta.url / process.execPath 路径解析（resolveWebDist） | 无模块 URL/可执行路径面 | 候选路径顺序注释保留

## 闭包/回调密集区
- index.ts:564-776 | MiniBridge options 对象（8 个回调：resolveRelayTarget async、loadSnapshot/loadMetadata 同步回退链等） | 无闭包/选项对象 | 拆为命名 fn（miniBridge_*），回退链顺序逐条注释保留
- index.ts:888-1345 | grok/muse/pi/opencode 四个 lazy bridge 的 options 回调组（resolve*/onSnapshot/load*） | 同上 | 命名 fn 约定 + 每桥语义注释（默认值字符串逐一保留）
- index.ts:1390-1580 | AgyBridge resolveRelayEnv 返回 Record<string,string> env 记录 | 动态记录 + 闭包 | 注释登记三个 AGY_LLM_GATEWAY_* 键与免费分组 authType=none 分支
- index.ts:1582-1651 | wire*BridgeEvents 事件接线 fn（on notification/message/stderr） | EventEmitter | 注释登记路由前缀（auggie:/cline stderr 前缀等）
- index.ts:9123-9149 | terminalEventHandlers 返回闭包对 {onData, onExit} | 无闭包记录 | 注释登记发布契约
- index.ts:7030-7259 | 项目讨论引擎（waitForProjectTurn 轮询 + 回调续跑 continueProjectDiscussion） | async 轮询 + 定时器 | 轮询间隔/超时常量保留，驱动顺序注释
- index.ts:12254-12580 | createClaudeBridge 选项记录 + 桥事件 wiring（pending 路由表） | 闭包 + Map<Bridge, …> 以对象为键 | 注释登记；以桥句柄 u64 为键近似

## 其它单项
- index.ts:2483-6345 | handleApiRequest 约 150 条路由分支（if 链 + switch(route)） | 路由表需 HTTP 框架面 | 路由清单 1:1 注释登记（路径/方法/处理语义全保留），待 server 框架单元对齐后逐条落地
- index.ts:9224-10240 | executeCodexRpc 巨型分发（后端判定、历史 RPC 矩阵、VM 策略、黑名单、turn 跟踪） | 同上 + 动态 params | 13 步管线顺序注释登记
- index.ts:11114-11286 | routeCodexNotification 扇入（子线程终态暂存、usage 去重窗口、项目投影、工作台控制） | Map 状态 + 事件对象 | 状态机顺序注释登记；directUsageSeqByTurn/directTurnStartedAt 语义保留
- index.ts:13336-13349 区段 | mergeSshWorkspaceThreads 对 thread/list 结果的深合并/去重 | 动态 JSON 数组变换 | 注释登记合并规则
- index.ts:3656-3657 | GET /api/health 等字面量响应对象 | 动态对象 | JSON 文本近似
- index.ts:全文件 | `?.`/`??` 链式回退（stores 的 owner 回退链出现数十处） | 无可选链 | 显式 if 链注释近似，回退顺序保留

统计：本日志共 38 条（按构造点位去重合并；同类构造在多处出现时以代表行号登记并注明约数）。
