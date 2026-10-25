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
