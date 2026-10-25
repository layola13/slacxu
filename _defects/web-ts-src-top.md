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
