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
