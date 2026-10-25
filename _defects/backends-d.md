# backends-d 缺陷日志（合并）

范围：backends/free-mode、backends/jev、backends/relay-config、backends/vmtool-security（18 个 .ts → .sla，源 14677 行）。分片：part-mine（free-mode+vmtool-security，23 条）、part-jev（42 条）、part-relay-small（71 条）、part-omni（67 条）、part-gateway（676 条）。合计 879 条。

----- part-mine -----
# backends-d 缺陷日志（part: free-mode + vmtool-security，转换者 parent 单元）

backends/free-mode/src/manifest.ts:1-5 | JSON import assertion `import json with {type:"json"}` + PluginManifest 类型断言 | SLA 无 JSON 模块导入 | manifest 存为 plugin.json 文本缓冲（JsonBuf 式 struct），按需 sa_json_* 解析
backends/vmtool-security/src/manifest.ts:1-5 | 同上 | 同上 | 同上
backends/free-mode/src/server.ts:14-22 | class implements ServicePlugin 接口 + async start/stop + 模块级单例 `new FreeModeService()` | SLA 无类/接口/模块级可变单例 | struct + &Struct 函数族；start/stop 同步返回 i32 状态码；单例改 init 函数
backends/vmtool-security/src/server.ts:17-25 | 同上 | 同上 | 同上
backends/free-mode/src/free/compactionRelayRequest.ts:3-5 | asRecord(unknown) / Record<string, unknown> 动态对象 | SLA 无动态对象 | sa_json_parse 文档句柄（u64）+ sa_json_object_get_* 探针
backends/free-mode/src/free/compactionRelayRequest.ts:9-33 | JSON.parse try/catch、Object.keys().length、trim 语义 | sa_std 无 JSON 键枚举 API；异常机制不同 | parse 失败 doc==0 近似 catch；compaction 成员存在性以 object_get 代替键计数；trim 近似为非空检查
backends/free-mode/src/free/compactionRelayRequest.ts:38-73,75-77 | async + Web Fetch `Request`（headers.get/clone().json()/url） | sa_std 无 Fetch Request/Headers/URL 对象 | 调用方预读 header 值/body JSON/URL 为独立缓冲参数，函数同步化
backends/free-mode/src/free/compactionRelayRequest.ts:78-87,151-170 | new Headers / new Request / JSON.stringify({...body, model}) 对象展开 | sa_json 无 object-set/展开 API | 输出改为重写后 body JSON 文本缓冲；Request 构造留宿主侧（DEFECT 行内）
backends/free-mode/src/free/compactionRelayRequest.ts:89-127,129-147 | Set<string> 字面量集合 + 正则 /(?:^|[._:/-])(bash|shell|…)(?:$|[._:/-])/i | SLA 无 Set、无正则引擎 | 集合改字面量表 + 线性成员判定（表物化留修复期）；正则一半近似为 false 并登记
backends/free-mode/src/free/compactionRelayRequest.ts:180-211 | class + Map<string, State> + 默认参数 `now = Date.now()` | 无 Map、无壁钟默认参数 | 定容 64 项表 + 字节键查找；now 由调用方显式传入
backends/free-mode/src/free/compactionRelayRequest.ts:218-230 | ThreadRuntimeMetadata（shared 动态类型）+ 可选链 + trim/toLowerCase | 动态成员探针 | JSON 文档句柄 + object_get_string 探针（修复期）
backends/vmtool-security/src/security/saVmPolicy.ts:1-6 | node:path(isAbsolute/join/relative/resolve/sep)、node:fs statSync、node:os tmpdir、@cxu/sdk-backend codexUiDataDir | sa_std 无 node:path 对应；Windows 路径语义（盘符/sep）仅部分可表 | 本地位路径助函数（POSIX 式 + 小写 + 正斜杠的策略空间）；statSync→sa_std_fs 元数据；tmpdir/process.env→sa_env_get
backends/vmtool-security/src/security/saVmPolicy.ts:76-166 | SaVmPolicyConfig 动态配置 + `(config as any)` 强制转换 + 可选链深探 | 无 any/动态对象 | 配置改 JSON 文档句柄 + object_get 链，探针顺序保留
backends/vmtool-security/src/security/saVmPolicy.ts:229,385-387,538,560-567 | 正则：WINDOWS_DEVICE_NAMES、脚本名三式、env 名校验、${PROJECT} 替换 | 无正则引擎 | 字符类别可直扫者（env 名）注明可实现；其余 stub 返回 false 并逐一登记
backends/vmtool-security/src/security/saVmPolicy.ts:575-601 | globMatches 动态构造 RegExp（** → .*、* → [^/]*、转义元字符） | 无 RegExp 构造 | 语义可用直扫 glob 匹配器等价实现（修复期）；批量期返回 false
backends/vmtool-security/src/security/saVmPolicy.ts:251-262 | try/catch statSync 做只读放行 | 异常机制不同 | 状态码探针近似
backends/vmtool-security/src/security/saVmPolicy.ts:300-314 | new URL() 解析 + username/password/protocol/hostname/pathname | sa_std 无 URL 解析 extern | 修复期对字节缓冲手写解析；批量期 deny 骨架
backends/vmtool-security/src/security/saVmPolicy.ts:625-643, passim | Set 解构 [...new Set()]、Array.prototype.at(-1)、flatMap、展开运算符 | 无对应集合/高阶 API | 顺序保序去重/索引访问/显式循环改写（骨架已转）
backends/vmtool-security/src/security/saVmInterception.ts:17-23,28-30 | 正则三式判定 python/bun/node 可执行名 + replace/toLowerCase/split 链 | 无正则、无字符串链式 API | re_test(id) 统一 stub + 模式编号；basename 提取留修复期
backends/vmtool-security/src/security/saVmInterception.ts:122-210 | detectPowerShellAntiPattern 约 24 条正则分支链（每条返回固定指引文） | 无正则引擎 | 分支顺序保留、逐条 re_test(100+n) stub；指引文字面量表留修复期物化（源行号已注）
backends/vmtool-security/src/security/saVmInterception.ts:3,246 | @cxu/sdk-backend 的 isSystemWebSearchPermissionRequest | 跨单元 SDK 谓词未在本单元定义 | 声明为外部谓词（sdk-backend 单元转换）
backends/vmtool-security/src/security/saVmInterception.ts:47-101,219-289 | params: unknown 动态探查（多拼写优先级链 command/cmd/argv、tool/toolName/name/item.*、path/source/destination/oldPath/newPath/to/url/method/roots）+ Array.find 类型谓词 | 无动态对象/类型谓词 | JSON 文档句柄 + object_get 按源优先级探针；方法分发表以字符串等值链保留（顺序已注全）
backends/vmtool-security/src/security/saVmInterception.ts:238-245 | 数组 join(" ") 拼 fullCmd、String() 强转 | 动态值强转无对应 | 修复期以 args 缓冲拼接近似

----- part-jev -----
# backends-d / jev 子单元缺陷日志（批量转换第一波，只记录不修复）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

backends/jev/src/manifest.ts:1-5 | JSON 模块导入断言 `import manifestJson from "../plugin.json" with { type: "json" }` + PluginManifest 结构类型 | SLA 无 JSON module import、无结构化接口类型 | manifest 存为 plugin.json 原始 JSON 文本，sa_json_parse 成文档句柄 JevManifest.doc；PluginManifest struct 归 sdk-backend 单元
backends/jev/src/server.ts:12-25 | `class JevService implements ServicePlugin` + `async start/stop(): Promise<void>` | SLA 无 class/interface、无 async | struct JevService + &Struct 首参函数族 JevService_start/stop 同步返回 i32 状态码，签名处 `// DEFECT: async`
backends/jev/src/server.ts:15-17 | `export { JEV_MANIFEST }` 与 `export * from ...` barrel 转发 | SLA 无 re-export 语义 | 等价 @import 转发 manifest.sla / saVmJev.sla / jevOpenAiBridge.sla + 注释
backends/jev/src/server.ts:26 | 模块级单例 `export const jevServicePlugin = new JevService()` | SLA 无模块级实例 | jevServicePlugin_init(out, manifest_doc) 由宿主调用一次构造
backends/jev/src/jev/jevOpenAiBridge.ts:11 | 字符串联合类型 `JevBridgeProtocol = "openai-chat" | "openai-responses"` | SLA 无联合类型 | 保留字面量 (ptr,len) 值 + jev_bridge_protocol_is_responses 判定
backends/jev/src/jev/jevOpenAiBridge.ts:13-17,59-62,79-107,212-216 | `criteria?: unknown`、`Record<string, JevBridgeQuestion>`、返回 `Record<string, unknown>` | 动态对象/unknown 无 SLA 对应 | questions/criteria/返回体一律 JSON 文本缓冲，经 sa_json_* 节点句柄（意图 extern）读写；JevBridgeQuestion struct 的 criteria 存 JSON 文本 + kind 标签
backends/jev/src/jev/jevOpenAiBridge.ts:19-23 | `normalizeBridgeProtocol(raw: unknown)`，`String(raw ?? "")` 强制转换 | unknown 的 JS String() 强制转换语义无对应 | 入参按已字符串化的 (ptr,len) 传入，调用方负责 String() 近似
backends/jev/src/jev/jevOpenAiBridge.ts:30-42 | `stringifyCriteria`：Array.map/Object.entries + `String(c)` 任意值字符串化 | 闭包、动态条目枚举、String() 任意值语义 | sa_json 数组/对象节点顺序枚举成行；元素以其 JSON 文本/字符串值近似 String()
backends/jev/src/jev/jevOpenAiBridge.ts:109-130 | 正则 `/```(?:json)?\s*([\s\S]*?)\s*```/i` 剥代码围栏 + JSON.parse try/catch 回退最大 {...} 子串 | SLA 无正则、无异常 | 手写 ``` 围栏扫描（找首个开围栏与末个闭围栏、跳过语言标签）；JSON.parse 以 sa_json_parse 成败近似，失败回退首 { 到末 } 子串再解析
backends/jev/src/jev/jevOpenAiBridge.ts:132-138 | `clamp01(v: unknown)`：typeof/Number() 强制 + Number.isFinite | 动态类型判定与 NaN/Infinity 语义 | 调用方经 sa_json 节点 kind 预转换，has_num 标志代 isFinite，纯 f64 钳制
backends/jev/src/jev/jevOpenAiBridge.ts:145-163 | `criteriaKeys.find(k => k === rawChoice) ?? find(小写)` 闭包查找、`criteriaKeys[0]!` 非空断言 | 闭包/数组高阶函数 | 两轮顺序扫描内联（精确匹配轮 + 小写匹配轮），无命中回退首个 key
backends/jev/src/jev/jevOpenAiBridge.ts:165-209 | extractChatText/extractResponsesText 对 unknown payload 的结构探测（`as Record<...>` 层层断言、content 数组 map/join） | 动态对象结构断言、闭包 map | sa_json 节点句柄逐层探测 kind 后取字符串，map 内联为 for 循环拼接
backends/jev/src/jev/jevOpenAiBridge.ts:212-255 | bridgeTextToJevData：Object.entries 遍历 questions、criteria 数组 findIndex 闭包、score/noul 的 Number() 回退链 | 动态对象、闭包、JS 数字强制 | sa_json 顺序枚举 qid；findIndex 内联为循环；Number() 回退经 sa_json_node_number 成败近似；结果 Record 拼为 JSON 文本
backends/jev/src/jev/saVmJev.ts:1-4 | `basename` from node:path、`loadRegressionCases`/`SaVmInputError` from @cxu/sdk-backend、SaVm* 类型 from sdk/shared | Node API 与跨单元符号无本地对应 | basename 本地实现 jev_basename；loadRegressionCases 以意图 extern sa_load_regression_cases 占位（实现在 sdk-backend 单元）；类型在本文件按同形状重声明 struct
backends/jev/src/jev/saVmJev.ts:6-28,87,786-787 | 导出字符串/数字 const（JEV_DEFAULT_*、CLOUDFLARE_JEV_*、JEV_ACT_NOW_* 等） | SLA 无导出 const 值 | 每个 const 变同名访问函数（字符串经 out ByteBuf、数字直接返回 u64），名字 1:1 保留
backends/jev/src/jev/saVmJev.ts:74-85 | `unwrapJevUpstreamPayload(parsed: unknown)`：`root.data ?? root.result ?? root` + 对象性判定 | unknown/动态对象 | 入参改 sa_json doc 句柄，返回解包后的节点句柄
backends/jev/src/jev/saVmJev.ts:94-109 | `padCloudflareJevQuestions`：对象展开 `{...questions, [_cf_pad]: {...}}`、Object.keys | 动态对象展开 | JSON 文本手术：原样拷贝或剥尾部 } 后追加 pad 条目 JSON
backends/jev/src/jev/saVmJev.ts:111-127 | buildJevConnectivityQuestions 返回 Record 对象字面量 | 动态对象 | 按 TS 键序拼 JSON 文本缓冲
backends/jev/src/jev/saVmJev.ts:129-181 | 模块级可变状态：`let sharedJevConfig`、`let relayExecutor`、节流 `let jevSlotChain/jevLastStartAt/jevWaiting/*Override` | SLA 无模块全局 | 全部收进 JevModuleState struct，相关函数加首参 `state: &JevModuleState`（签名变形，已登记）；JevSharedConfig 可选字段以定长缓冲 + has_* 标志承载
backends/jev/src/jev/saVmJev.ts:154-162,164-168 | 函数类型 `JevRelayExecutor = (payload) => Promise<Response>` 回调 + AbortSignal | 回调/Promise/AbortSignal 无 SLA 对应 | 执行器以不透明 id 注册，意图 extern jev_relay_executor_call 调用；Response 降为 JevHttpResponse{ok,status,body,timed_out}；signal 丢弃、超时由调用 extern 的 timeoutMs 承载
backends/jev/src/jev/saVmJev.ts:183-193 | `setJevThrottle(config | null)` 可选字段对象 | 可选字段/undefined 区分 | 参数展开为各字段值 + has_* 标志，has_config=false 表 null 清 override
backends/jev/src/jev/saVmJev.ts:195-237 | `process.env.JEV_*` 读取 + `Number(raw)` 解析环境字符串 | Node process.env 无 sa_std 对应；JS Number() 接受浮点/十六进制 | sa_env_get/sa_env_buffer_* 近似；jev_parse_env_u64 仅接受十进制整数
backends/jev/src/jev/saVmJev.ts:240-276 | `acquireJevSlot`：Promise 链串行化（jevSlotChain）、release 闭包、setTimeout 等待、throw SaVmInputError | async/Promise 链、闭包、定时器、异常 | 同步近似：jevWaiting 仅计数、最小间隔等待变 sa_sleep_ms（意图 extern）；release 闭包变 jev_release_slot(state)；throw 变返回码 2，消息由 jev_overload_error 在调用方重建
backends/jev/src/jev/saVmJev.ts:278-325 | `normalizeChoiceOptions(raw: unknown)`：JSON.parse 递归、正 `/\r?\n/` 切行、行首正则 `/^[\d+*•-]\.?\s*/` 剥项目符、Object.entries/Array.forEach 闭包 | unknown、正则、闭包、动态对象 | raw 改 JSON 文本 + kind 标签；切行与项目符剥离手写扫描（• 按 UTF-8 三字节识别）；entries/forEach 内联为 sa_json 枚举循环；Record 结果变定长 StringMap（容量 64，TS 无界）
backends/jev/src/jev/saVmJev.ts:327-369 | `normalizeChecklistItems` 同上（键名 check_N、最小 1 行） | 同上 | 同上，key_mode=1
backends/jev/src/jev/saVmJev.ts:371-400 | `resolveJevCredentials(rawInput: Record<string, unknown>)`：typeof 字符串守卫链、env/shared 回退链、timeout 的 Math.min | 动态对象、JS 真值链 | 动态键经 input_dyn_str/input_dyn_num 读 JSON 文本（typeof 守卫以节点 kind 近似）；回退链抽 jev_cred_chain 顺序尝试；bridgeProtocol 的 shared 先于 env 且不 trim 的原样保留
backends/jev/src/jev/saVmJev.ts:402-416 | `truncateJevContext(contextRaw: unknown)`：JSON.stringify/String() 分支 | unknown 的序列化语义 | kind 标签分派；非字符串以其 JSON 文本代 JSON.stringify/String() 两分支；字符串分支（trim/8000 截断/后缀）原样
backends/jev/src/jev/saVmJev.ts:418-515 | `executeJevCall`：async、AbortController + setTimeout abort、fetch()、Response.text()、try/catch/finally、Date.now() | async、fetch/Response 流式对象、定时器、异常、系统时钟 | 同步函数 + 返回码（0 结果已填/2 slot 抛错上传）；fetch 与 relay 调用变意图 extern jev_http_post_json/jev_relay_executor_call（timeoutMs 入参、timed_out 标志代 AbortError）；finally 的 clearTimeout+releaseSlot 在每条出口显式执行；Date.now() 变 sa_time_now_ms（意图 extern）
backends/jev/src/jev/saVmJev.ts:517-2987 | 全部 18 个 `export async function nativeJev*`：async/Promise<SaVmRunResult>、throw new SaVmInputError(...)、参数别名链（`??`/`||` + Record 强制断言读动态键） | async、异常、动态对象 | 同步函数返回 i32（0=结果已填入 out，2=SaVmInputError，消息入 out.stderr），签名处逐个 `// DEFECT: async`；别名链按 ??（存在性，has_* 标志）与 ||（非空）语义逐条展开为 input_str_field/input_dyn_str/input_dyn_json 尝试链；SaVmRunResult 变 struct（saVmEvents/saVmViolation 降为 has_violation_event/has_violation + reason 字符串，即本模块实际发出的唯一形状）
backends/jev/src/jev/saVmJev.ts:517-2987 | 各 native 函数输出对象字面量 + `JSON.stringify(outputObject, null, 2)`，summary 数组 join("\n") 模板串 | 动态对象序列化 | 输出按 TS 键序拼 JSON 文本（buf_append_json_str 转义近似，非 JSON.stringify 的 2 空格缩进格式——文本格式差异已登记）；summary 以字面量 \n 分段拼 ByteBuf
backends/jev/src/jev/saVmJev.ts:619-735 | nativeJevChecklist：Object.entries 构造 questions、checkResults Record 累积 | 动态对象、闭包 | questions/checkResults 均边迭代 checks 的 StringMap 边拼 JSON 文本，保持条目顺序
backends/jev/src/jev/saVmJev.ts:1067-1178 | nativeJevRank：`new Set<string>()` picked、`itemKeys.filter(...)` 闭包 | Set、闭包 | picked 以 StringMap（值 "1"）代 Set；filter 内联为循环
backends/jev/src/jev/saVmJev.ts:1313-1468 | nativeJevDispatch：正则 `` `${slotHint}\n${context}`.match(/max_parallel\s*=\s*(\d+)/i) ``、dispatchPlan 数组对象、subtasks map/join 闭包 | 正则、动态数组对象、闭包 | 正则手写不敏感扫描（max_parallel + 空白 + = + 空白 + 数字，parseInt 后钳 1..8）；plan 数组边算 batch 边拼 JSON 文本
backends/jev/src/jev/saVmJev.ts:1609-1652 | `splitPackedDoneSections`：多组标记数组 firstIndexOf（对 toLowerCase 文本）、两处正则 replace 剥标记前缀（/^(\[actual work\]|实际工作)\s*[:：|]?\s*/i 等）、可选字段返回对象 | 正则、Unicode 小写折叠、可选字段 | jev_find_marker/jev_marker_at 以 ASCII 折叠做不敏感搜索（中文标记不受影响）；前缀剥离手写 jev_strip_section_prefix（含全角：三字节识别）；可选字段以 out 缓冲 + has_* 标志返回
backends/jev/src/jev/saVmJev.ts:1654-1790 | nativeJevDone：`loadRegressionCases(...).filter(c => ...)` 闭包 + basename(c.component) + toLowerCase().includes(...) | 闭包、node:path | filter 内联循环；basename 本地实现；includes 以小写化双方后 str_contains_ci 近似（本文件 str_contains_ci 对空针返回 true，与 includes("") 一致）
backends/jev/src/jev/saVmJev.ts:1943-2039 | nativeJevEdgeCases：函数内局部闭包 `const pick = (answerKey) => {...}` 捕获 answers | 闭包捕获 | pick 提升为自由函数 jev_edge_pick，捕获的 answers 变 data_doc 参数
backends/jev/src/jev/saVmJev.ts:2061-2179 | nativeJevBlastRadius：filter 闭包内 targetComponent/basename/includes 组合判定 | 闭包、动态案例对象 | 内联循环 + regression_case_field 经 JSON 文本读 id/title/component
backends/jev/src/jev/saVmJev.ts:2514-2655 | nativeJevProgress：`JEV_PROGRESS_BAND_PERCENT[band] ?? 12`、health==="done" 时 band 覆写 | Record<number> 索引 | 百分表变 JEV_PROGRESS_BAND_PERCENT(band) if 链，未知键返回 12（即 ?? 12 的结果）
backends/jev/src/jev/saVmJev.ts:2664-2760 | nativeJevMemory 本地回退：两组正则（/^(ok|done|好的|…)/i 前缀交替、/偏好|记住|always |…/i 子串交替）、key 的 `.replace(/\s+/g, "_")` | 正则、Unicode 空白 \s | 前缀交替逐字面量 str_starts_with_ci、子串交替逐字面量 str_contains_ci；\s+ 折叠手写扫描且仅认 ASCII 空白
backends/jev/src/jev/saVmJev.ts:2762-2987 | JEV_WHICH_EFFICIENCY_TIERS / JEV_DEFAULT_ENGINEERING_TOOLS 常量表、`generateToolUsageRecommendation` 的 switch + 参数对象字面量（含 run_js 的 TS 源码模板串）、nativeJevWhich 的 `Object.keys(candidates)[0]` 回退 | 动态对象、模板串 | switch 变工具名 if 链，suggested_params 按 TS 键序拼 JSON 文本；Object.keys 首键以 StringMap 顺序首项近似
backends/jev/src/jev/saVmJev.ts:全文 | 数字格式化：置信度等 f64 经 JSON.stringify / 模板串插值（JS Number#toString） | JS 数字到字符串的 shortest round-trip 语义无对应 | buf_append_f64 近似（整数部 + 至多 6 位小数去尾零）；百分比 Math.round 以 (x*100+0.5) 取整近似（仅正数域，与源用法一致）
backends/jev/src/jev/saVmJev.ts:全文 | 固定容量：ByteBuf 256KiB、StringMap 64 条、JevStr 8KiB、JevSharedConfig 各字段定长 | TS 字符串/Record 无界 | 按源语义估容量并在结构定义处注释；超限截断（与源行为差异，后续修复阶段处理）

----- part-relay-small -----
# backends-d / relay-config 小文件组缺陷日志

单元：backends-d 的 relay-config 小文件组（manifest.ts、server.ts、relay/relayCatalog.ts、relay/freebuffSession.ts、relay/freeOllama.ts）
格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## manifest.ts（5 行）
backends/relay-config/src/manifest.ts:2 | `import manifestJson from "../plugin.json" with { type: "json" }` | SLA 无 JSON 模块导入 | manifest 改为运行时从 ../plugin.json 填入的 JSON 文本缓冲
backends/relay-config/src/manifest.ts:5 | `PluginManifest` 类型断言 `manifestJson as PluginManifest` | 动态对象无类型化 struct 对应 | RelayConfigManifest struct 只含 json_bytes/json_len

## server.ts（63 行）
backends/relay-config/src/server.ts:18-56 | `class RelayConfigService implements RelayConfigPlugin` + 接口实现 | SLA 无类/接口 | struct RelayConfigService + &Struct 首参函数族，方法名原样保留
backends/relay-config/src/server.ts:20-32 | rpcNamespaces 对象字面量 + async 箭头函数捕获 this | 无一等函数值/闭包捕获 | 普通函数 relay_config_rpc_relay(&service, method, paramsJson, out)
backends/relay-config/src/server.ts:22-30 | switch 分发 + `params.relay as RelayStation`、`String(params.id ?? "")` | 动态 JSON 字段访问/类型断言 | params 改 JSON 文本缓冲，字段提取未实现并标 DEFECT
backends/relay-config/src/server.ts:29 | `throw new Error(unknown relay method)` | SLA 无异常 | 返回状态码 -1，错误文案由调用方拼装
backends/relay-config/src/server.ts:33 | `#relays` 私有字段 `Map<string, RelayStation>` | 无 Map、无访问控制 | 定长并行数组（容量 256）+ 注释说明私有仅约定
backends/relay-config/src/server.ts:36-55 | async start/stop/listRelays/upsertRelay/removeRelay/resolveRelay | async/Promise | 同步函数 + 状态码；undefined 用 -1、boolean 直返
backends/relay-config/src/server.ts:40 | `[...this.#relays.values()]` Map 迭代展开 | 无 Map 迭代器 | 走并行数组线性扫描（未实现处标 DEFECT）
backends/relay-config/src/server.ts:58-64 | 单例导出 + `export * from` barrel 转发 | 无 export * 再导出语义 | @import 转发 + relay_config_plugin_init 初始化函数

## relay/relayCatalog.ts（632 行）
backends/relay-config/src/relay/relayCatalog.ts:2-12 | 从 "@codex-ui/shared" 导入 9 个动态类型 | 动态 JSON 类型无 struct 对应 | 统一 JsonBuf（字节数组+len）；RelayCatalogModel 另留标量视图 struct
backends/relay-config/src/relay/relayCatalog.ts:14-46 | MODEL/VENDOR/ENDPOINT/CATALOG_FIELDS 四个 `Set<string>` 常量 | 无 Set 类型 | 字面量清单写入注释 + 计数常量，成员判断线性扫描
backends/relay-config/src/relay/relayCatalog.ts:51-95 | async fetchRelayCapabilityCatalog + fetch/AbortController/setTimeout | async、定时器、中止信号、全局 fetch 均无 sa_std 对应 | 同步+状态码（1-6 对应各 throw 文案）；超时作客户端参数
backends/relay-config/src/relay/relayCatalog.ts:53-60 | `new URL()` 解析与 protocol 检查、try/catch throw | 无 URL 类、无异常 | 状态码 1/2；scheme 手工检查
backends/relay-config/src/relay/relayCatalog.ts:75-84 | `response.headers.get`、`response.text()`、TextEncoder 字节长、JSON.parse try/catch | 动态 JSON/响应对象 | 正文作 JsonBuf，字节长即缓冲长；JSON 解析未实现标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:97-110 | canonicalEndpointType switch + trim/toLowerCase 返回 string | string 需 (ptr,len) 出参 | 出参 out_len；调用方须先归一化并物化字面量指针
backends/relay-config/src/relay/relayCatalog.ts:112-168 | parseRelayCapabilityCatalog(unknown 入参) + throw 三处 | 动态 JSON + 异常 | JsonBuf 入参 + 状态码 1/2/3；目录 JSON 发射未实现标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:126-146 | Set 引用组集合、Record 索引读写、模板串警告 | 无 Set/Record/模板字面量 | 线性扫描 + JSON 文本合并；警告串拼接 pending 标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:147-152 | 对象展开合并 extensions `{...(existingExt ?? {}), ...extra}` | 无对象展开/动态合并 | JSON 对象文本合并（未实现标 DEFECT）
backends/relay-config/src/relay/relayCatalog.ts:155 | `Date.now()` 默认参数 + `??` 空值合并 | 无默认参数/空合并运算符 | now 由调用方传入；has 标志位替代
backends/relay-config/src/relay/relayCatalog.ts:159 | sourceHash: node:crypto createHash("sha256") 链式调用 | Node crypto 无直接对应 | sa_std sha256 extern 近似（未接线标 DEFECT）
backends/relay-config/src/relay/relayCatalog.ts:170-213 | deriveCatalogGroups: map/filter/flatMap/some 闭包链 + 模板串 id | 无闭包/高阶函数 | 循环展开写在注释流程里；分组 JSON 发射未实现标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:215-245 | buildCatalogImportPreview: Map 按名索引 + 计数对象 | 无 Map | 线性扫描近似（未实现标 DEFECT），预览走 JsonBuf
backends/relay-config/src/relay/relayCatalog.ts:247-262 | mergeCatalogGroups: Map + flatMap + 数组展开、`"merge"|"replace"` 联合类型 | 无 Map/展开/字符串联合 | mode_replace bool；有序合并扫描近似
backends/relay-config/src/relay/relayCatalog.ts:264-283 | REQUIRED_IMAGE_RUNTIME_GROUPS Set + filter 闭包 | 无 Set/闭包 | 3 字面量线性扫描
backends/relay-config/src/relay/relayCatalog.ts:285-299 | resolveModelProtocol/modelSupportsProtocol: 可选链 `model?.` | 无可选链/undefined 联合 | has_model 标志位；协议出参 len
backends/relay-config/src/relay/relayCatalog.ts:301-331 | mergeCatalogGroup: `{...imported, ...覆盖字段}` 大对象字面量 | 动态对象合并 | JSON 文本合并，字段优先级逐项写入注释
backends/relay-config/src/relay/relayCatalog.ts:333-385 | parseModels: entries() 迭代 + Set 去重 + 模板串警告 | 无迭代器协议/Set | for 循环 + 线性去重；JSON 逐项走查未实现标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:387-416 | parseVendors: Set<number> id 去重 | 无 Set | 线性扫描
backends/relay-config/src/relay/relayCatalog.ts:418-455 | parseEndpoints: Object.entries、嵌套 JSON.parse(path) try/catch、Record 返回 | 动态 JSON 多层 | JsonBuf 返回；嵌套解析作状态分支，未实现标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:457-465 | intersectEndpoints: Set 交集运算 | 无 Set 代数 | 嵌套扫描近似（未实现标 DEFECT）
backends/relay-config/src/relay/relayCatalog.ts:467-477 | preferredProtocols: 类型谓词过滤 `(e): e is RelayResponseProtocol` | 无泛型/类型谓词 | 字符串成员扫描，优先级分支保留
backends/relay-config/src/relay/relayCatalog.ts:479-486 | isImageGroup: 正则 /image|banana|video/i + every 闭包 | 无正则引擎 | 子串扫描近似（大小写不敏感缺失已注明）
backends/relay-config/src/relay/relayCatalog.ts:488-514 | catalogImageConfig: 索引访问类型 `ChannelGroupConfig["image"]`、条件嵌套对象、find 闭包 | 无索引访问类型/动态对象 | JSON 文本发射（未实现标 DEFECT），逻辑逐项注释保留（含中文 notice 原文）
backends/relay-config/src/relay/relayCatalog.ts:516-526 | catalogGroupChanged: JSON.stringify 相等比较 | 无 JSON.stringify 规范化 | 文本字节比较近似（键序敏感，已注明）
backends/relay-config/src/relay/relayCatalog.ts:528-563 | numberRecord/stringRecord: Record<string, number|string> 动态记录 | 动态对象 | JsonBuf 进出；逐键走查未实现标 DEFECT
backends/relay-config/src/relay/relayCatalog.ts:565-577 | unwrapExtensions: seen Set 循环引用防护 + while 解包 | 对象身份集合无对应 | 文本缓冲无指针身份；深度上限近似 pending
backends/relay-config/src/relay/relayCatalog.ts:579-596 | extraFields + isJsonValue 递归类型谓词 `.every(isJsonValue)` | 无类型谓词/递归闭包 | 递归 JSON 扫描（未实现标 DEFECT）
backends/relay-config/src/relay/relayCatalog.ts:602-625 | asRecord/stringValue/finiteNumber/booleanValue/stringArray/uniqueStrings 对 unknown 的运行时类型判断 | 动态 JSON 值模型 | JSON 文本片段 + has 标志/状态码表达 undefined；uniqueStrings 用 O(n^2) 去重

## relay/freebuffSession.ts（627 行）
backends/relay-config/src/relay/freebuffSession.ts:1-4 | node:fs/os/path/crypto 导入（existsSync/readFileSync/homedir/join/randomUUID） | Node API 仅部分有 sa_std 对应，randomUUID 无对应 | fs 走 sa_std_fs_* 设想；join 改字符串拼接；UUID 改计数器近似
backends/relay-config/src/relay/freebuffSession.ts:7-10 | 模板字面量拼 URL 常量 | 无模板字面量 | 预拼接字面量常量
backends/relay-config/src/relay/freebuffSession.ts:14-21 | FREEBUFF_SIGNATURE_TOOL 对象字面量（含 `as const`） | 动态对象 | 逐字保留为 JSON 文本常量
backends/relay-config/src/relay/freebuffSession.ts:23-43 | FREEBUFF_MODEL_AGENT_MAP Record + DEFAULT_FREEBUFF_MODELS 数组常量 | Record 无对应 | 并行 (model, agentId) 对照写入注释 + 计数常量
backends/relay-config/src/relay/freebuffSession.ts:45-61 | getFreebuffAgentId: Object.entries 迭代 Record | 无对象迭代 | 按源插入顺序的 9 分支 fb_streq_ci 链 + 子串回退链（顺序与源一致）
backends/relay-config/src/relay/freebuffSession.ts:63-71 | resolveFreebuffCredentialsPath: process.env + homedir + path.join | 无 env 映射表 | env extern 近似；路径拼接（未实现标 DEFECT）
backends/relay-config/src/relay/freebuffSession.ts:78-106 | async resolveLocalFreebuffCredentials + 可选链 `parsed?.default?.authToken` + try/catch 吞错 | async/可选链/异常 | 同步+状态码（0 找到/1 null）；错误即 null 分支
backends/relay-config/src/relay/freebuffSession.ts:118-135 | 模块级 `Set<string>` ownedInstanceIds + 三个导出增删查函数 | 无模块全局可变状态、无 Set | FreebuffState struct 承载 + &State 首参函数族；线性扫描
backends/relay-config/src/relay/freebuffSession.ts:138-157 | 模块级 Map activeSessions + Map.values().next() 迭代器 | 无 Map/迭代器 | State 内定长展平存储；首项 = 索引 0，null 用状态码 1
backends/relay-config/src/relay/freebuffSession.ts:139 | 模块级 `Map<string, Promise<FreebuffSessionInfo>>` activeAdmissionPromises | Promise 值 Map 无对应 | 整表删除，准入改为顺序执行（并发去重丢失，已在 getOrEnsure 处登记）
backends/relay-config/src/relay/freebuffSession.ts:159-185 | FreebuffSessionStatus 嵌套类型（freebucks/rateLimitsByModel 记录） | 动态嵌套对象 | freebucks/限速表改 JSON 文本缓冲 + has_* 标志
backends/relay-config/src/relay/freebuffSession.ts:187-275 | async getFreebuffSessionStatus: fetchImpl 注入、AbortSignal.timeout、res.json().catch() | 函数注入/中止信号/Promise 链 | 同步+状态码；sa_std HTTP 近似；JSON 文本查找
backends/relay-config/src/relay/freebuffSession.ts:214-218 | `new Date(body.expiresAt).getTime()` ISO 解析 + Date.now 算剩余秒 | 无 Date 类 | epoch ms extern 近似；ISO 解析无对应标 DEFECT
backends/relay-config/src/relay/freebuffSession.ts:277-322 | findBestFreebuffFallback: 价格表展开合并 `{...literals, ...(status.freebucks?.prices || {})}` | 对象展开/动态记录 | 字面量价格表写入注释；freebucks 价格 JSON 查找未实现标 DEFECT
backends/relay-config/src/relay/freebuffSession.ts:324-353 | async releaseFreebuffSession: DELETE fetch + catch 中 `error instanceof Error ? error.message : String(error)` | async/异常对象内省 | 同步+结果 struct；错误消息留空标 DEFECT
backends/relay-config/src/relay/freebuffSession.ts:355-527 | async getOrEnsureFreebuffSession: Promise 去重（existingPromise + IIFE） | 无 Promise/IIFE 闭包 | 顺序执行准入流程；并发调用不再去重（显式登记）
backends/relay-config/src/relay/freebuffSession.ts:439-449 | Object.assign(error, {code: "FREEBUFF_MODEL_LOCKED", ...}) 给 Error 挂动态属性 | 动态对象错误 | 状态码 2 表达该分支，附加字段丢弃并登记
backends/relay-config/src/relay/freebuffSession.ts:419-424 | 靠 error.message.includes(...) 判别重抛 | 异常消息判别 | 状态码分支替代
backends/relay-config/src/relay/freebuffSession.ts:529-561 | async createFreebuffRunId: randomUUID 回退 + JSON body 拼装 | 无 UUID 生成 | 计数器近似回退 id；HTTP/JSON 未实现标 DEFECT
backends/relay-config/src/relay/freebuffSession.ts:563-603 | async fetchFreebuffFreeModels: Object.keys(prices) + Set 去重展开 | 动态 JSON 键枚举/Set | JSON 文本键走查 + O(n^2) 去重；未实现处标 DEFECT，默认模型回退计数保留

## relay/freeOllama.ts（203 行）
backends/relay-config/src/relay/freeOllama.ts:16-20 | FreeOllamaProbeOptions.fetchImpl?: typeof fetch | 函数类型值注入 | has_fetch_impl 标志占位，探测直用 sa_std HTTP
backends/relay-config/src/relay/freeOllama.ts:22-24 | normalizeFreeOllamaServer: trim + 正则 replace(/\/+$/) + toLowerCase | 无正则/字符串方法 | 字节循环（trim/去尾斜杠/ASCII 小写）
backends/relay-config/src/relay/freeOllama.ts:26-30 | 4 个 RegExp 常量（EMBEDDING/MODEL_SIZE/COMMON_CHAT/KNOWN_SMALL） | SLA 无正则引擎 | 子串/前缀扫描近似，锚点与边界字符类语义丢失并逐条登记
backends/relay-config/src/relay/freeOllama.ts:34-51 | eligibleFreeOllamaModels(unknown): Array.isArray + filter/map 链 + Set 去重 + 正则捕获组判尺寸 | 动态 JSON/闭包链/正则捕获 | JSON 文本管线（未实现标 DEFECT）；model_size_match 手工扫描占位
backends/relay-config/src/relay/freeOllama.ts:53-77 | buildFreeOllamaGroups: new URL().host try/catch、Object.fromEntries、模板串 toFixed(2) | 无 URL 类/异常/动态记录构建/数字格式化 | 组对象改 JSON 文本发射（未实现标 DEFECT）；toFixed 无对应
backends/relay-config/src/relay/freeOllama.ts:79-81 | freeOllamaModelSupportsThinking: 正则交替 (?:...|...|$) | 无正则 | contains_ci 子串链近似（qwen3 分支放宽已注明）
backends/relay-config/src/relay/freeOllama.ts:83-105 | eligibleFreeOllamaEntries(unknown): flatMap 闭包 + Set seen + URL protocol 校验 | 动态 JSON/闭包/Set | 逐项循环 + 线性去重（未实现标 DEFECT）
backends/relay-config/src/relay/freeOllama.ts:107-126 | async probeFreeOllamaEntries: Promise.all 并发 worker 池 + 共享 nextIndex 闭包 | async/并发/闭包共享可变状态 | 同步顺序循环，保序但失去并发；concurrency 仅钳制校验
backends/relay-config/src/relay/freeOllama.ts:128-175 | async probeFreeOllamaEntry: fetch 两段探测 + 可选链 choices?.[0]?.message | async/动态 JSON 深层可选链 | 同步 bool（保留/丢弃）；HTTP+JSON 走查未实现标 DEFECT
backends/relay-config/src/relay/freeOllama.ts:177-181 | selectFreeOllamaProbeModels: sort(比较器闭包) + slice | 无函数值比较器 | 按分数插入排序近似（未实现标 DEFECT），上限 5 保留
backends/relay-config/src/relay/freeOllama.ts:183-193 | freeOllamaProbeScore: 6 条锚定正则 /^.../ | 无正则 | 前缀/子串扫描近似，仅 :cloud/verif_sys 分支已落地，其余分支注释保留
backends/relay-config/src/relay/freeOllama.ts:195-197 | normalizeFreeOllamaModel 与 normalizeFreeOllamaServer 语义差异（前者不去尾斜杠） | 复用近似引入偏差 | 复用后者并显式登记该近似偏差

## 汇总
- 行内 `// DEFECT:` 标记总数：196（relayCatalog 84、freebuffSession 51、freeOllama 33、server 25、manifest 3）
- 前 5 类缺陷（按频次）：1) 动态 JSON/Record/unknown → JSON 文本缓冲；2) async/Promise → 同步+状态码（含 Promise 去重、Promise.all 并发丢失）；3) Set/Map → 定长数组+线性扫描；4) 闭包/高阶函数（map/filter/flatMap/比较器/fetch 注入）→ 循环展开或丢失；5) 正则 RegExp → 子串/前缀扫描近似。次级：throw/try-catch → 状态码、模板字面量 → 预拼接/拼接 pending、Node API（URL/Date/crypto/env）无 sa_std 对应、可选链/?? → has 标志位、类/接口 → struct+函数族。

----- part-omni -----
# backends-d / omniRouteFree 缺陷日志（批量转换第一遍，只记录不修复）

源文件: backends/relay-config/src/relay/omniRouteFree.ts（3452 行）
产物: backends/relay-config/src/relay/omniRouteFree.sla

backends/relay-config/src/relay/omniRouteFree.ts:1-18 | node:fs/os/path/crypto imports + freebuffSession re-export | SLA 无 Node 内置模块导入面、无 barrel re-export 语义 | @import freebuffSession.sla + 各调用点就地近似，re-export 仅注释登记
backends/relay-config/src/relay/omniRouteFree.ts:5 | type ChannelGroupConfig from "@codex-ui/shared" | 跨包动态对象类型无 SLA 对应 | 本文件内近似 struct（已知字段 + modelMapping/尾部 JSON 文本缓冲）
backends/relay-config/src/relay/omniRouteFree.ts:20-28 | export const string 常量（URL/UA/版本） | SLA 无模块级字符串常量导出形态 | 以 STR_PTR/STR_LEN 字面量在各使用点内联，名称在注释中登记
backends/relay-config/src/relay/omniRouteFree.ts:30-36 | RegExp 常量（SESSION/REQUEST pattern、UA version/generic 正则） | SLA 无正则引擎 | 模式文本保留为注释/字符串；匹配以长度+前缀+字符类手工近似（omni_id_pattern_test、UA 数字扫描、generic UA 前缀表）
backends/relay-config/src/relay/omniRouteFree.ts:37-48 | String(userAgent || "").match / .test + Number.parseInt | 正则捕获组与字符串方法缺失 | 扫描 "opencode/" 后手工解析十进制 major.minor
backends/relay-config/src/relay/omniRouteFree.ts:50-59 | Buffer + createHash("sha256")/randomBytes + Array.from/map/join | Node Buffer 与 crypto 无 sa_std 对应 extern（本遍未接） | 字节指针 + omni_hash_hex/omni_random_bytes 桩（摘要写零、随机填零，id 确定性退化）
backends/relay-config/src/relay/omniRouteFree.ts:62-67 | let 模块级可变缓存（cachedOpencodeCliVersion 等三变量） | SLA 方言无模块全局可变状态 | 调用方持有 OpencodeCliVersionCache struct 逐函数穿线
backends/relay-config/src/relay/omniRouteFree.ts:65-67 | 类型谓词 value is string + /^\d+\.\d+\.\d+$/ | 无类型谓词、无正则 | 调用方传 is_string 标志 + 三段数字手工扫描
backends/relay-config/src/relay/omniRouteFree.ts:72-96 | async IIFE + Promise<string> in-flight 去重 + .finally 注销 + globalThis.fetch + AbortSignal.timeout | 无 Promise/async/AbortSignal；fetch 未接 | 同步状态码函数；in_flight 退化为 bool 且立即清除；网络与 JSON 解析未实现，走 catch 等价路径（保留旧缓存/fallback）
backends/relay-config/src/relay/omniRouteFree.ts:103-125 | process.env 动态键 `${providerId...}_USER_AGENT` + 模板字符串键构造 + void 触发后台 refresh | 无 process.env、无动态键、无 fire-and-forget | omni_env_get 恒未设置 → configuredUA 恒空；refresh 改同步调用
backends/relay-config/src/relay/omniRouteFree.ts:132-139 | new Set([...]) OPENCODE_FREE_MODELS | 无 Set 类型 | 字面量成员函数（逐个字节比较）
backends/relay-config/src/relay/omniRouteFree.ts:140-153 | string.endsWith / .trim / ?? 默认参数 | 字符串方法与可选参数无直接对应 | omni_str_ends_with + has_ 标志参数；trim 仅以长度近似
backends/relay-config/src/relay/omniRouteFree.ts:156 | type OpencodeSurface = "zen" | "go" | "other" 字面量联合 | 无字面量联合类型 | (ptr,len) 字符串承载
backends/relay-config/src/relay/omniRouteFree.ts:166-191 | interface OpencodeSessionBody（unknown 字段+嵌套数组）与 projectOpencodeSessionBody 的字段投影 | 动态 JSON 对象字段提取未实现 | presence 标志 + 每字段 JsonText 原文；project 仅判 object 性，字段全留空
backends/relay-config/src/relay/omniRouteFree.ts:193-218 | createHash sha256 hex slice + messages.find + JSON.stringify(system/content) | 无 hash extern、无 JSON 数组遍历/stringify | extract* 返回 null 等价（-1）；仅 model/provider/conn 参与指纹（见下条）
backends/relay-config/src/relay/omniRouteFree.ts:220-238 | generateOpencodeSessionId 的 sys:/user0:/tools: 指纹分量（依赖上条提取器与 tools 名排序拼接） | 动态对象提取缺失导致指纹与 TS 不一致（有 system/首条 user/tools 时） | 只拼 model/provider/conn 分量并在函数头 DEFECT 注明分量缺失
backends/relay-config/src/relay/omniRouteFree.ts:240-326 | Headers | Record 二选一参数 + Map 归一化 + metadata/Claude user_id 的 JSON.parse 链 | HeaderMap 读写为 JSON 文本桩（get 恒缺失）；body JSON 键查找未实现 | resolveOpencodeSessionIdentity 仅表达 header 名顺序循环，实际恒返回 undefined 等价（-1）
backends/relay-config/src/relay/omniRouteFree.ts:330-337 | stripOpencodeModelPrefix(model: unknown): unknown | unknown 入出参 | is_string 标志 + 字节缓冲， 非字符串原样语义以空输出表示
backends/relay-config/src/relay/omniRouteFree.ts:349-356 | applyMuseSparkMinOutputTokens 就地改 Record 数值字段 | JSON 文本内字段读写未实现 | 模型前缀判断保留，body 修改为 no-op
backends/relay-config/src/relay/omniRouteFree.ts:358-385 | Set 别名表 + 正则族名/后缀 + split("/").pop() + parse 链 | 无 Set/正则 | 成员函数 + 前缀/后缀比较 + 末段扫描
backends/relay-config/src/relay/omniRouteFree.ts:387-396 | RegExp[] 词边界模式 /\bkimi\b/ 等 + Record 字段读 | 无正则、无 JSON 字段读 | 子串 contains 近似（大小写敏感，与 TS /i 不符已注明）；reasoning_content 由调用方传解码标志
backends/relay-config/src/relay/omniRouteFree.ts:398-422 | 泛型 <T> inject…ForThinkingModel + 对象展开 {...entry} + map | 无泛型、无对象展开 | JsonText 就地变异签名 + 状态码；实际注入未实现（no-op）
backends/relay-config/src/relay/omniRouteFree.ts:429-487 | opencodeTrimSchemaNode 递归 JSON 树变异 + Set<unknown> 恒等防环 + JSON.stringify 长度 | 无递归 JSON 树操作、无恒等集合 | 全节返回 0，触发/上限常量与算法以注释保留
backends/relay-config/src/relay/omniRouteFree.ts:489-596 | opencodeClientToolNamesOf / opencodeToolEntryName / applyOpencodeFreeTierRequestContract<T> 的 tools 数组遍历与新对象拼装（两种线格式） | 动态 JSON 数组/对象拼装未实现 | 决策逻辑注释保留；名称提取返回空/null，契约应用 no-op
backends/relay-config/src/relay/omniRouteFree.ts:605-621 | export const 内核常量 + Set 提供商表 + as const 参数对象 | 无常量导出/Set/对象字面量 | 字面量内联 + JSON 文本常量 + 成员函数
backends/relay-config/src/relay/omniRouteFree.ts:623-667 | OPENCODE_KERNEL_TITLE_TEMPLATE 多行模板字面量（含 ≤ 与 → 等非 ASCII） | SLA 字符串字面量对多行/转义支持未核 | 单行 \n 转义拼接，且仅保留模板前段（<task> 止）；全文未逐字复刻，此为本文件唯一非 1:1 文本常量，修复期须补齐 <rules>/<examples> 全文
backends/relay-config/src/relay/omniRouteFree.ts:669-702 | process.env 读取（kernel 默认 token 数、开关、baseUrl、UA、API key） | 无 process.env | 全部走未设置分支：128000 / true / 默认 URL / 默认 UA / "public"
backends/relay-config/src/relay/omniRouteFree.ts:704-738 | kernelSurfaceFor/Request/Url 与 shouldUseKernelSend 的 toLowerCase 集合判断 | 大小写折叠未做 | 大小写敏感比较（DEFECT 已注明）
backends/relay-config/src/relay/omniRouteFree.ts:740-762 | BigInt 算术（timestamp*0x1000n、~current、>>/& 掩码）+ randomBytes 后缀 | 无 BigInt | u64 算术（48 位提取窗口内等价）+ 随机桩
backends/relay-config/src/relay/omniRouteFree.ts:764-793 | Date.now() 默认参数 + WeakMap<object, KernelIdentity> 身份记忆 | 无墙钟 extern、无 WeakMap | omni_now_ms 恒 0；单槽 memo（origin 以 u64 句柄代替对象身份，多 origin 交替会抖动重建）
backends/relay-config/src/relay/omniRouteFree.ts:795-814 | buildKernelHeaders 返回 Record<string,string> + 删除含 "omniroute" 的键/值 | HeaderMap 写为桩 | 逐项 set 调用表达完整头集合与剥离规则，结果映射实际为空
backends/relay-config/src/relay/omniRouteFree.ts:816-899 | kernel* 记录助手群（isRecord/AsArray/FiniteNumber/TextOf/Normalize*Tool/HasReadTool/FreeTierReadTool/IsTitleShapedCall） | 全部是对 unknown JSON 的字段读， 未实现 | 调用方传解码标志/字段；归一化返回 null/空数组等价，read 工具以 JSON 文本常量发出
backends/relay-config/src/relay/omniRouteFree.ts:920-957 | repairHollowKernelTools 就地改 tools 参数对象 | JSON 数组内对象变异未实现 | 返回 0（未修复计数）
backends/relay-config/src/relay/omniRouteFree.ts:967-1045 | repairKernelChatToolPairing 的 Map<string,number> pending 配对算法 + 对象解构删字段 | 无 Map、无 JSON 消息数组重构 | 输入直通 + 三计数全 0
backends/relay-config/src/relay/omniRouteFree.ts:1047-1093 | kernelOutputKey 的 JSON.stringify + dedupeKernelResponsesItems 的双遍 Set 去重 | 无 stringify/Set | 字符串走 "s:" 形， 其余 "u:unknown"；dedupe 直通
backends/relay-config/src/relay/omniRouteFree.ts:1095-1233 | kernelNormalize* 消息/内容/Responses 输入全组变换（含 reasoning/encrypted_content 丢弃、instructions 提升） | JSON 结构变换未实现 | 直通或 "[]"；规则逐函数注释保留
backends/relay-config/src/relay/omniRouteFree.ts:1235-1343 | buildKernelChatBody/buildKernelResponsesBody/buildKernelBody 的新请求体拼装 + console.warn | JSON 对象拼装未实现、无 console.warn | out="{}"；字段规则（max_tokens 解析顺序、tool_choice、title 形等）逐条注释保留；分发逻辑（buildKernelBody）真实保留
backends/relay-config/src/relay/omniRouteFree.ts:1352-1381 | OPENCODE_EFFORT_TIERS Record<string, readonly string[]> + Object.entries 迭代序匹配 | 无字符串键 Record | 基名/等级查找函数；以「已知基名+其等级」全串匹配复现 entries 语义
backends/relay-config/src/relay/omniRouteFree.ts:1383-1611 | sanitize* 全组（id 前缀表 Record、图片 part 重塑、agent_message 改写、字段删除、BaseBody 克隆修复） | JSON 记录变换未实现 | 逐函数直通 + 规则注释；函数名合法性/净化（纯字符串）真实实现
backends/relay-config/src/relay/omniRouteFree.ts:1600-1611 | configuredOpencodePlaceholderToolNames 读 env 逗号名单 + 正则校验 + Set 去重 | 无 env | 返回空表；名称正则已手工实现（omni_observed_tool_name_valid）
backends/relay-config/src/relay/omniRouteFree.ts:1613-1753 | opencodeObservedTools/Refusals 双 Map + Object.freeze + LRU 逐出 + merge…WithObserved<T> 拼装 | 无 Map/冻结/泛型 | 调用方持有 64 容固定数组存储（插入序保留）；满容拒绝插入代替逐出；merge 仅走查链、body 不改
backends/relay-config/src/relay/omniRouteFree.ts:1755-1823 | 1010 指纹/regionerror 的 lookaround 正则 + toLowerCase().includes 信号表 | 无正则、无大小写折叠 | 子串 contains 近似（边界类未查、大小写敏感，已注明比 TS 更宽）
backends/relay-config/src/relay/omniRouteFree.ts:1825-1860 | isOpencodeFreeTierRefusalForProvider 的 trim/toLowerCase 族判断 + proxyKeyOf 模板串 | 同上 | 原始字节前缀/相等比较；端口号手工十进制渲染
backends/relay-config/src/relay/omniRouteFree.ts:1862-1877 | 别名转发函数 + let opencodeShapeNow: () => number 可替换时钟（闭包） | 无函数值/闭包 | 转发真实保留；时钟以 OpencodeShapeState 内的 override 值字段近似
backends/relay-config/src/relay/omniRouteFree.ts:1879-1942 | opencodeAddsNothingBeyondFirstDispatch 的 Set 并集判断 + replayShape/learnFromReplay 中 ctx.replayNote 闭包回调 | 无 Set/闭包存储 | 前者恒 true；replayNote 以 has_replayNote 标志登记，learnFromReplay 中仅执行 pause/remember/forget 的状态部分
backends/relay-config/src/relay/omniRouteFree.ts:1944-1996 | rebuildOpencodeJsonFromForcedStream 的 Response/ReadableStream(pull/cancel)/TextEncoder/Headers 复制 | 无 fetch 流 API | 句柄直通（状态码 0），惰性转换语义以注释保留
backends/relay-config/src/relay/omniRouteFree.ts:1998-2038 | OpencodeFreeTierOutcome/Attempt 接口 + noteOpencodeFreeTierOutcome 的 boolean|对象联合参数 | 无联合类型 | struct + outcome_is_bool 标志归一化；其余分支（教名/确认/三振）真实走存储函数
backends/relay-config/src/relay/omniRouteFree.ts:2040-2066 | K3/K2.7 authentic 正则 /(?:^|\/)(?:kimi-)?k3(?:$|-)/ | 无正则 | 路径段扫描近似（omni_segment_match）
backends/relay-config/src/relay/omniRouteFree.ts:2068-2079 | resolveOpencodePlaceholderNames 的 ?? 链 | 无可选链 | 显式分支链，语义保留
backends/relay-config/src/relay/omniRouteFree.ts:2081-2118 | applyOpencodeDeepSeekJsonSchemaFallback<T> 的 schema stringify 缩进 + system 消息改写 + response_format 替换 | JSON 变异未实现 | model/provider 门保留，body 不改
backends/relay-config/src/relay/omniRouteFree.ts:2120-2228 | shape 备忘：Set<string> 裸形类 + Map<string,number> 暂停表 + 三个 WeakMap（forced/injection/attempt）+ sha1 摘要 | 无 Set/Map/WeakMap/hash | 64 容固定数组（满容拒插代替逐出；删除以键长清零代替）+ 三个单槽 WeakMap 近似 + omni_hash_hex 桩（摘要为全 "0"）
backends/relay-config/src/relay/omniRouteFree.ts:2230-2273 | prepareOpencodeFreeTierRequest<T> + replayNote 闭包 ((verdict) => note…({ ...attempt, probe: false })) | 无泛型/闭包 | JsonText 就地 + PrepareFreeTierResult 出参；闭包以 has_replayNote 标志登记
backends/relay-config/src/relay/omniRouteFree.ts:2284-2324 | buildOpencodeBackgroundHeaders 返回 Record + env 读 + 正则校验请求/会话 id | HeaderMap 桩、无 env/正则 | 流程表达但映射为空；id 以 omni_id_pattern_test 近似校验
backends/relay-config/src/relay/omniRouteFree.ts:2326-2403 | buildOpencodeUpstreamBody<T> 九步管线中的字段级步骤（input 去重、tools 修复、删 client_metadata、改 model、stream_options 门、effort 拆分写 reasoning_effort） | JSON 字段操作未实现 | 整-body 步骤按序真实调用（sanitize/deepseek/prepare/注入），字段级步骤注释登记并跳过
backends/relay-config/src/relay/omniRouteFree.ts:2405-2428 | 从 "@cxu/sdk-backend" 导入再导出 9 个符号 + OpenCodeBackendKind 类型 | 无 re-export 语义 | 注释登记符号清单；本文件内对 getOpenCodeProjectId 的使用以 "global" 默认近似
backends/relay-config/src/relay/omniRouteFree.ts:2430-2658 | Headers 类全组（find/forEach/get/set/delete、大小写不敏感、fallback、cliDefaults 规范化、applyOpenCodeHeaders） | 无 Headers 类；HeaderMap 以 JSON 文本为存储且读写未实现 | 全部流程（顺序、键名、规范化分支、鉴权头选择）逐行表达但对映射无实际效果；randomUUID 以全零 UUID 桩近似
backends/relay-config/src/relay/omniRouteFree.ts:2660-2766 | eligible*FreeModels 三函数的 unknown 负载遍历（数组/.data、flatMap、Set 去重、toLowerCase） | JSON 负载遍历未实现 | 返回零模型；保留规则（前缀门、-free/:free 后缀、EXPLICIT 集、isFree）逐函数注释
backends/relay-config/src/relay/omniRouteFree.ts:2670-2674 | OmniRouteFreeFetchOptions.fetchImpl?: typeof fetch 函数类型字段 | 无函数类型 | has_fetchImpl 标志位占位
backends/relay-config/src/relay/omniRouteFree.ts:2768-2773 | resolveClineProvidersJsonPath 的 homedir()+join() | 无 os/path API | env 分支保留（恒未设）；默认路径以 "~" 字面占位
backends/relay-config/src/relay/omniRouteFree.ts:2781-2918 | resolveLocalClineToken async + 模块级 token 缓存 + fs 读/写 providers.json + JSON.parse + refresh 的 fetch POST + Date 解析 expiresAt | 无 async/fs/JSON/fetch/Date | 同步状态码；仅 env 与缓存新鲜分支可达，其余走 TS 的失败回退（旧缓存或 null）
backends/relay-config/src/relay/omniRouteFree.ts:2920-3067 | 六个 build*Group 的对象字面量 + [...new Set] 去重 + DEFAULT_FREEBUFF_MODELS/D2API 默认表 + luna 迁移 map | 无对象字面量/Set | 出参 struct 逐字段填充（omni_fill_group_common）；StrList 换行拼表 + 线性去重；迁移以条目变换函数实现（小写/trim 近似为精确比较）
backends/relay-config/src/relay/omniRouteFree.ts:3069-3097 | fetchD2ApiFreeModels async + fetch + throw new Error(HTTP/空） | 无 async/fetch/throw | 同步状态码：-2 对应 HTTP throw、-3 对应空结果 throw；实际恒 -3
backends/relay-config/src/relay/omniRouteFree.ts:3099-3263 | buildAllFreeGroups 的重载参数消歧（isOptions/isGroupConfigArray 运行时探测 + 数组展开 {...group} 覆盖序） | 无联合参数/对象展开 | 调用方 kind 标签（0 未传/1 模型表/2 组表/3 选项）+ 按 id 槽位表示组数组；合并覆盖序逐组按源码顺序以字段拷贝复现
backends/relay-config/src/relay/omniRouteFree.ts:3265-3277 | fetchLocalOpencodeFreeModels 的 await import() 动态导入 opencodeCompatibleProbe + NodeJS.ProcessEnv | 无动态导入/Env 类型 | 返回 -1 空结果，导入关系注释登记
backends/relay-config/src/relay/omniRouteFree.ts:3279-3331 | fetchOmniRouteFreeModels async 编排（本地尝试吞错 + 远端目录权威 + EXPLICIT 兜底 + throw remoteError） | 无 async/fetch/throw | 仅 EXPLICIT_FREE_MODELS 兜底路径可达并真实产出（9 个模型）；远端/本地路径注释登记
backends/relay-config/src/relay/omniRouteFree.ts:3333-3371 | fetchKiloCodeFreeModels / fetchClineFreeModels async + fetch + throw | 同上 | 同步状态码，恒 -3（空结果 throw 等价）
backends/relay-config/src/relay/omniRouteFree.ts:3373-3452 | fetchClineBalance async + 模块级 45s 缓存 + 两段 fetch + credits 浮点格式化 `$${credits.toFixed(2)}` | 无 async/fetch；缓存以 struct 穿线 | 缓存命中分支（标量+长度）与无 token 分支可达；字段字节拷贝留待修复期（函数内 DEFECT 已注）；余额请求未发出

----- part-gateway -----
# backends-d part-gateway — relayProtocolGateway.ts conversion defects

- relayProtocolGateway.ts:1-57 | import declarations (node:crypto, @codex-ui/shared, @cxu/sdk-backend, sibling modules) | SLA @import cannot import TS modules / Node builtins / SDK host-service objects | imports recorded as comments in .sla; imported types erased to JsonBuf / known structs, imported functions called by name as comments
- relayProtocolGateway.ts:59-60 | union/literal type CanonicalContentPart | no union/literal types | tag-less JsonBuf payload struct
- relayProtocolGateway.ts:59-60 | union type CanonicalContentPart | no union types | single struct merging all variant fields as JsonBuf+len
- relayProtocolGateway.ts:59-60 | type CanonicalContentPart field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:63-67 | type CanonicalToolCall field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:69-76 | union type CanonicalMessage | no union types | single struct merging all variant fields as JsonBuf+len
- relayProtocolGateway.ts:69-76 | type CanonicalMessage field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:78-86 | union type CanonicalTool | no union types | single struct merging all variant fields as JsonBuf+len
- relayProtocolGateway.ts:78-86 | type CanonicalTool field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:88-92 | type RelayToolIdentity field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:94-98 | type RelayToolCompatibility field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:100-103 | type PreparedResponsesRequest field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:105-133 | type CanonicalRequest field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:135-147 | type CanonicalResult field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:149-150 | union/literal type CanonicalStreamEvent | no union/literal types | tag-less JsonBuf payload struct
- relayProtocolGateway.ts:149-150 | union type CanonicalStreamEvent | no union types | single struct merging all variant fields as JsonBuf+len
- relayProtocolGateway.ts:149-150 | type CanonicalStreamEvent field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:157-164 | type RelayToolDiagnostic field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:168-168 | global relayKeyCursors: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:168-168 | global relayKeyCursors: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:175-177 | function fetchUpstreamWithHeadersTimeout: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:175-177 | function fetchUpstreamWithHeadersTimeout: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:180-182 | global timeoutMs: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:183-183 | global timer: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:183-183 | global timer: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:184-184 | global pending: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:198-203 | global DEFAULT_ENDPOINTS: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:198-203 | global DEFAULT_ENDPOINTS: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: process.env / Node runtime API | no Node process env / host-services object in SLA | env reads as comments; host services via JsonBuf placeholders
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:205-310 | function runRelayProtocolRequest: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:312-314 | function hasRemoteCompactionV2Trigger: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:312-314 | function hasRemoteCompactionV2Trigger: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:312-314 | function hasRemoteCompactionV2Trigger: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:312-314 | function hasRemoteCompactionV2Trigger: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:316-318 | function isFreebuffGroup: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:354-361 | function ignoredProxyPoolEnvKeys: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:354-361 | function ignoredProxyPoolEnvKeys: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:354-361 | function ignoredProxyPoolEnvKeys: process.env / Node runtime API | no Node process env / host-services object in SLA | env reads as comments; host services via JsonBuf placeholders
- relayProtocolGateway.ts:354-361 | function ignoredProxyPoolEnvKeys: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:354-361 | function ignoredProxyPoolEnvKeys: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:369-380 | function noteDirectEgressOnly: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:369-380 | function noteDirectEgressOnly: process.env / Node runtime API | no Node process env / host-services object in SLA | env reads as comments; host services via JsonBuf placeholders
- relayProtocolGateway.ts:369-380 | function noteDirectEgressOnly: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:387-405 | function isFreeChannelGroup: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:408-410 | function isEmbeddedD2ApiGroup: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:421-423 | function isEmbeddedOpencodeLocalGroup: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:425-433 | function type EmbeddedOpencodePromptInput | no first-class function/callback types | callback_id u64 + JsonBuf args struct
- relayProtocolGateway.ts:435-438 | type EmbeddedOpencodeTurnResult field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:440-442 | function type EmbeddedOpencodeRunner | no first-class function/callback types | callback_id u64 + JsonBuf args struct
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:454-503 | function extractJsonToolCall: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:521-525 | function embeddedOpencodeErrorStatus: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:528-552 | function runEmbeddedOpencodeLocalResult: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:559-584 | function runEmbeddedOpencodeLocalLive: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:586-594 | global EMBEDDED_OPENCODE_SSE_HEADERS: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:597-642 | function streamEmbeddedOpencodeChatTurn: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:645-722 | function streamEmbeddedOpencodeResponsesTurn: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:735-772 | function canonicalToPlainPrompt: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:735-772 | function canonicalToPlainPrompt: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:735-772 | function canonicalToPlainPrompt: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:735-772 | function canonicalToPlainPrompt: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:774-774 | indexed-access/ReturnType type Duck2ApiApp | no generics/indexed access/host services | JsonBuf holder struct
- relayProtocolGateway.ts:778-781 | function getDuck2ApiApp: process.env / Node runtime API | no Node process env / host-services object in SLA | env reads as comments; host services via JsonBuf placeholders
- relayProtocolGateway.ts:784-789 | function duck2apiCompletionsPath: process.env / Node runtime API | no Node process env / host-services object in SLA | env reads as comments; host services via JsonBuf placeholders
- relayProtocolGateway.ts:798-817 | function requestEmbeddedD2ApiCompletions: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:798-817 | function requestEmbeddedD2ApiCompletions: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:798-817 | function requestEmbeddedD2ApiCompletions: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:798-817 | function requestEmbeddedD2ApiCompletions: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:798-817 | function requestEmbeddedD2ApiCompletions: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:819-833 | function fetchEmbeddedD2ApiCompletions: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:819-833 | function fetchEmbeddedD2ApiCompletions: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:819-833 | function fetchEmbeddedD2ApiCompletions: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:819-833 | function fetchEmbeddedD2ApiCompletions: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:835-852 | function resolveFreeRetryDelayMs: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:858-872 | function sleepWithSignal: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:858-872 | function sleepWithSignal: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:858-872 | function sleepWithSignal: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:858-872 | function sleepWithSignal: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:858-872 | function sleepWithSignal: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:885-892 | function bufferRelayRequestForRetry: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:885-892 | function bufferRelayRequestForRetry: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:885-892 | function bufferRelayRequestForRetry: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:885-892 | function bufferRelayRequestForRetry: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:894-902 | function rebuildRelayRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:894-902 | function rebuildRelayRequest: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:894-902 | function rebuildRelayRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:904-946 | function executeWithFreeChannelRetry: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:948-1004 | function runRelayProtocolRequestWithKeyFailover: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1006-1072 | function runRelayChatRequest: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1074-1129 | function runRelayChatRequestWithKeyFailover: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1142-1205 | function runRelayJevRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1207-1247 | function runRelayJevRequestWithKeyFailover: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1249-1285 | function runNativeAnthropicRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1249-1285 | function runNativeAnthropicRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1249-1285 | function runNativeAnthropicRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1249-1285 | function runNativeAnthropicRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1249-1285 | function runNativeAnthropicRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:1288-1361 | function runRelayAnthropicRequest: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1363-1411 | function runRelayAnthropicWithKeyFailover: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1413-1425 | function orderedRelayKeys: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1413-1425 | function orderedRelayKeys: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:1413-1425 | function orderedRelayKeys: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1413-1425 | function orderedRelayKeys: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1427-1438 | function withoutInternalRelayHeaders: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1440-1445 | function finalizeRelayResponse: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1440-1445 | function finalizeRelayResponse: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1440-1445 | function finalizeRelayResponse: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1447-1452 | function markUpstreamFailure: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1462-1483 | function proxyResponsesCompactRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1462-1483 | function proxyResponsesCompactRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1462-1483 | function proxyResponsesCompactRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1462-1483 | function proxyResponsesCompactRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1462-1483 | function proxyResponsesCompactRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1462-1483 | function proxyResponsesCompactRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1485-1500 | function joinRelayEndpoint: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1485-1500 | function joinRelayEndpoint: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:1514-1525 | function shouldKernelSendFor: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1514-1525 | function shouldKernelSendFor: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1514-1525 | function shouldKernelSendFor: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1527-1536 | function kernelSessionHintFromHeaders: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1527-1536 | function kernelSessionHintFromHeaders: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1538-1555 | function resolveProtocolEndpoint: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1538-1555 | function resolveProtocolEndpoint: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:1557-1571 | function resolveProtocolStreamEndpoint: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1557-1571 | function resolveProtocolStreamEndpoint: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:1573-1608 | function sanitizeOpenCodePayload: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1573-1608 | function sanitizeOpenCodePayload: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1573-1608 | function sanitizeOpenCodePayload: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1573-1608 | function sanitizeOpenCodePayload: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1573-1608 | function sanitizeOpenCodePayload: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1611-1625 | function noteOpencodeUpstreamOutcome: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1611-1625 | function noteOpencodeUpstreamOutcome: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1611-1625 | function noteOpencodeUpstreamOutcome: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1632-1672 | function tryOpencodeObservedRetry: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1679-1715 | function tryOpencodeShapeRetry: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1679-1715 | function tryOpencodeShapeRetry: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1679-1715 | function tryOpencodeShapeRetry: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1679-1715 | function tryOpencodeShapeRetry: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1679-1715 | function tryOpencodeShapeRetry: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1679-1715 | function tryOpencodeShapeRetry: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1717-1796 | function proxyResponsesRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1798-1825 | function summarizeResponsesRequestImages: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1798-1825 | function summarizeResponsesRequestImages: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1798-1825 | function summarizeResponsesRequestImages: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1798-1825 | function summarizeResponsesRequestImages: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1798-1825 | function summarizeResponsesRequestImages: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1827-1845 | function upstreamRetryAfterSeconds: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1827-1845 | function upstreamRetryAfterSeconds: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1827-1845 | function upstreamRetryAfterSeconds: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1827-1845 | function upstreamRetryAfterSeconds: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:1847-1849 | function clampRetryAfterSeconds: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1851-1872 | function responsesRateLimitRetryStream: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:1874-1890 | function responsesFailureStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1874-1890 | function responsesFailureStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:1874-1890 | function responsesFailureStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1874-1890 | function responsesFailureStream: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:1874-1890 | function responsesFailureStream: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1896-1910 | function summarizeResponsesRequestTools: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1896-1910 | function summarizeResponsesRequestTools: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1896-1910 | function summarizeResponsesRequestTools: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1896-1910 | function summarizeResponsesRequestTools: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1896-1910 | function summarizeResponsesRequestTools: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1912-1917 | function listRelayToolDiagnostics: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1912-1917 | function listRelayToolDiagnostics: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:1919-1924 | function recordRelayToolDiagnostic: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1919-1924 | function recordRelayToolDiagnostic: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:1919-1924 | function recordRelayToolDiagnostic: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:1926-2069 | function normalizeResponsesProxyStream: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2071-2073 | function customToolStreamKey: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2071-2073 | function customToolStreamKey: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2075-2077 | function normalizedFunctionArguments: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:2079-2086 | function isCompleteFunctionArguments: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2079-2086 | function isCompleteFunctionArguments: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2088-2096 | function firstIncompleteFunctionArguments: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:2088-2096 | function firstIncompleteFunctionArguments: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2088-2096 | function firstIncompleteFunctionArguments: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2102-2118 | function normalizeCustomToolInputs: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2102-2118 | function normalizeCustomToolInputs: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2102-2118 | function normalizeCustomToolInputs: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2102-2118 | function normalizeCustomToolInputs: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2120-2137 | function unwrapCustomToolInput: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2120-2137 | function unwrapCustomToolInput: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2120-2137 | function unwrapCustomToolInput: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:2139-2299 | function runCanonicalUpstream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2301-2307 | function parseCanonicalChatResponse: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2301-2307 | function parseCanonicalChatResponse: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2301-2307 | function parseCanonicalChatResponse: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2309-2311 | function hasUnsupportedOllamaThinking: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2309-2311 | function hasUnsupportedOllamaThinking: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2309-2311 | function hasUnsupportedOllamaThinking: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:2313-2485 | function runCanonicalUpstreamStream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:2491-2603 | function runCanonicalUpstreamChatStream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:2623-2748 | function translateCanonicalEventsToChat: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2750-2796 | function chatEventStreamFromResult: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2750-2796 | function chatEventStreamFromResult: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2750-2796 | function chatEventStreamFromResult: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2750-2796 | function chatEventStreamFromResult: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2750-2796 | function chatEventStreamFromResult: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2750-2796 | function chatEventStreamFromResult: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2798-2843 | function translateNativeEventStream: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2845-2862 | function consumeSse: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2845-2862 | function consumeSse: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2845-2862 | function consumeSse: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2845-2862 | function consumeSse: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:2845-2862 | function consumeSse: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2845-2862 | function consumeSse: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:2864-2934 | function runAnthropicCanonicalStream: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2864-2934 | function runAnthropicCanonicalStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2864-2934 | function runAnthropicCanonicalStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2864-2934 | function runAnthropicCanonicalStream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2864-2934 | function runAnthropicCanonicalStream: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2864-2934 | function runAnthropicCanonicalStream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: async/await + Promise | SLA has no async/Promise; sequential blocking model only | sync fn + i32 status code, awaits become sequential calls
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: AbortController / AbortSignal / timers | no abort signal or timer API | timeout/abort params kept as u64/bool placeholders, checks dropped to comments
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:2936-3031 | function translateCanonicalEventsToAnthropic: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3033-3073 | function responsesChunkToCanonicalEvents: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3033-3073 | function responsesChunkToCanonicalEvents: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3033-3073 | function responsesChunkToCanonicalEvents: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3075-3078 | function nonEmptyStringValue: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3080-3085 | function responseFunctionCallName: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3080-3085 | function responseFunctionCallName: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3087-3091 | function anthropicStopReason: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3093-3101 | function dispatchSseFrame: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3093-3101 | function dispatchSseFrame: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3093-3101 | function dispatchSseFrame: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3103-3116 | function resolveCanonicalToolName: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3103-3116 | function resolveCanonicalToolName: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3103-3116 | function resolveCanonicalToolName: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3118-3156 | function chatChunkToCanonicalEvents: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3118-3156 | function chatChunkToCanonicalEvents: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3158-3203 | function anthropicChunkToCanonicalEvents: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3158-3203 | function anthropicChunkToCanonicalEvents: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3205-3236 | function geminiChunkToCanonicalEvents: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3205-3236 | function geminiChunkToCanonicalEvents: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3238-3251 | function prepareResponsesRequestForRelay: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3238-3251 | function prepareResponsesRequestForRelay: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3238-3251 | function prepareResponsesRequestForRelay: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3238-3251 | function prepareResponsesRequestForRelay: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3238-3251 | function prepareResponsesRequestForRelay: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3253-3304 | function buildRelayToolCompatibility: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3253-3304 | function buildRelayToolCompatibility: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:3253-3304 | function buildRelayToolCompatibility: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3253-3304 | function buildRelayToolCompatibility: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3306-3323 | function flattenResponsesTools: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3306-3323 | function flattenResponsesTools: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3325-3340 | function prepareResponsesInputItem: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3325-3340 | function prepareResponsesInputItem: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3342-3357 | function prepareResponsesToolChoice: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3342-3357 | function prepareResponsesToolChoice: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3359-3365 | function rewriteResponsesToolName: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3359-3365 | function rewriteResponsesToolName: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3367-3370 | function responsesToolName: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3387-3390 | function normalizeRelayResponsePayload: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3392-3424 | function restoreRelayToolNamespaces: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3392-3424 | function restoreRelayToolNamespaces: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3392-3424 | function restoreRelayToolNamespaces: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3392-3424 | function restoreRelayToolNamespaces: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3392-3424 | function restoreRelayToolNamespaces: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3426-3470 | function responsesRequestToCanonical: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3426-3470 | function responsesRequestToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3426-3470 | function responsesRequestToCanonical: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3426-3470 | function responsesRequestToCanonical: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3426-3470 | function responsesRequestToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3472-3499 | function appendResponsesInputItem: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3472-3499 | function appendResponsesInputItem: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:3472-3499 | function appendResponsesInputItem: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3472-3499 | function appendResponsesInputItem: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3501-3522 | function parseResponsesTool: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3501-3522 | function parseResponsesTool: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3524-3601 | function anthropicRequestToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3603-3693 | function chatRequestToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3702-3702 | global RESPONSES_EFFORT_LEVELS: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:3704-3709 | function sanitizeResponsesEffort: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3717-3725 | function anthropicBudgetToEffort: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3717-3725 | function anthropicBudgetToEffort: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3727-3792 | function canonicalToResponsesRequest: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3794-3812 | function responsesResponseToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3794-3812 | function responsesResponseToCanonical: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:3794-3812 | function responsesResponseToCanonical: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3794-3812 | function responsesResponseToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3814-3821 | function canonicalResultToAnthropic: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3814-3821 | function canonicalResultToAnthropic: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:3814-3821 | function canonicalResultToAnthropic: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3814-3821 | function canonicalResultToAnthropic: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3814-3821 | function canonicalResultToAnthropic: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:3814-3821 | function canonicalResultToAnthropic: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3823-3829 | function findCanonicalTool: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3823-3829 | function findCanonicalTool: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3831-3841 | function responsesRequestTools: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3831-3841 | function responsesRequestTools: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3831-3841 | function responsesRequestTools: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3831-3841 | function responsesRequestTools: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3843-3850 | function canonicalToChat: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3843-3850 | function canonicalToChat: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3858-3858 | global messages: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3862-3864 | global systemContent: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3870-3870 | global images: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3870-3870 | global images: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3876-3882 | global content: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3876-3882 | global content: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3876-3882 | global content: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3883-3883 | global safeContent: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3891-3891 | global entry: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3891-3891 | global entry: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3902-3902 | global firstMsg: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3902-3902 | global firstMsg: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3910-3910 | global firstBlock: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3910-3910 | global firstBlock: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3916-3916 | global body: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3916-3916 | global body: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3938-3938 | global seenChat: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:3938-3938 | global seenChat: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3939-3943 | global uniqueChat: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3939-3943 | global uniqueChat: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3952-3956 | global hasDecide: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3952-3956 | global hasDecide: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3952-3956 | global hasDecide: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:3978-4064 | function canonicalToAnthropic: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:3978-4064 | function canonicalToAnthropic: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:3978-4064 | function canonicalToAnthropic: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:3978-4064 | function canonicalToAnthropic: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:3978-4064 | function canonicalToAnthropic: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:3978-4064 | function canonicalToAnthropic: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4069-4108 | function applyAutomaticAnthropicMessageCacheBreakpoints: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4069-4108 | function applyAutomaticAnthropicMessageCacheBreakpoints: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4069-4108 | function applyAutomaticAnthropicMessageCacheBreakpoints: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:4069-4108 | function applyAutomaticAnthropicMessageCacheBreakpoints: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4069-4108 | function applyAutomaticAnthropicMessageCacheBreakpoints: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4110-4115 | function isAutomaticAnthropicCacheableBlock: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4110-4115 | function isAutomaticAnthropicCacheableBlock: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4110-4115 | function isAutomaticAnthropicCacheableBlock: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4117-4161 | function canonicalToGemini: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:4117-4161 | function canonicalToGemini: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4117-4161 | function canonicalToGemini: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4117-4161 | function canonicalToGemini: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4117-4161 | function canonicalToGemini: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4117-4161 | function canonicalToGemini: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4163-4191 | function chatResponseToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4163-4191 | function chatResponseToCanonical: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4163-4191 | function chatResponseToCanonical: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4163-4191 | function chatResponseToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4193-4217 | function anthropicResponseToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4193-4217 | function anthropicResponseToCanonical: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4193-4217 | function anthropicResponseToCanonical: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4193-4217 | function anthropicResponseToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4219-4246 | function geminiResponseToCanonical: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4219-4246 | function geminiResponseToCanonical: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4219-4246 | function geminiResponseToCanonical: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:4219-4246 | function geminiResponseToCanonical: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4219-4246 | function geminiResponseToCanonical: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:4219-4246 | function geminiResponseToCanonical: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4248-4256 | function geminiSafetyError: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4248-4256 | function geminiSafetyError: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4258-4328 | function canonicalResultToResponses: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4258-4328 | function canonicalResultToResponses: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4258-4328 | function canonicalResultToResponses: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:4258-4328 | function canonicalResultToResponses: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4258-4328 | function canonicalResultToResponses: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:4258-4328 | function canonicalResultToResponses: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:4330-4366 | function canonicalResultToChat: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4384-4392 | union type StreamOutputState | no union types | single struct merging all variant fields as JsonBuf+len
- relayProtocolGateway.ts:4384-4392 | type StreamOutputState field types (string/number/arrays/Record/JsonValue/optional) | exact field types not representable (dynamic JSON, optionals, arrays) | each field -> JsonBuf + len pair, names preserved
- relayProtocolGateway.ts:4394-4674 | class ResponsesStreamWriter (private fields, TextEncoder, ReadableStream controller, Map) | no classes, private fields, stream controller, or generic Map | struct + ResponsesStreamWriter_* function family with &Struct first param
- relayProtocolGateway.ts:4411-4417 | class method ResponsesStreamWriter.constructor: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:4425-4473 | class method ResponsesStreamWriter.accept: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:4475-4544 | class method ResponsesStreamWriter.complete: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4475-4544 | class method ResponsesStreamWriter.complete: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4546-4557 | class method ResponsesStreamWriter.fail: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4546-4557 | class method ResponsesStreamWriter.fail: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4559-4571 | class method ResponsesStreamWriter.ensureMessage: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4559-4571 | class method ResponsesStreamWriter.ensureMessage: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:4573-4585 | class method ResponsesStreamWriter.ensureReasoning: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4573-4585 | class method ResponsesStreamWriter.ensureReasoning: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:4587-4607 | class method ResponsesStreamWriter.ensureTool: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4587-4607 | class method ResponsesStreamWriter.ensureTool: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4587-4607 | class method ResponsesStreamWriter.ensureTool: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:4609-4613 | class method ResponsesStreamWriter.addOutput: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4615-4643 | class method ResponsesStreamWriter.outputItem: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4615-4643 | class method ResponsesStreamWriter.outputItem: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4615-4643 | class method ResponsesStreamWriter.outputItem: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4645-4664 | class method ResponsesStreamWriter.response: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4645-4664 | class method ResponsesStreamWriter.response: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4645-4664 | class method ResponsesStreamWriter.response: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4666-4669 | class method ResponsesStreamWriter.emit: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4666-4669 | class method ResponsesStreamWriter.emit: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4671-4673 | class method ResponsesStreamWriter.enqueue: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:4676-4719 | function responsesEventStream: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:4676-4719 | function responsesEventStream: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:4676-4719 | function responsesEventStream: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4676-4719 | function responsesEventStream: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4676-4719 | function responsesEventStream: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4676-4719 | function responsesEventStream: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4745-4758 | function resolveCanonicalPromptCacheKey: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:4745-4758 | function resolveCanonicalPromptCacheKey: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4745-4758 | function resolveCanonicalPromptCacheKey: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4745-4758 | function resolveCanonicalPromptCacheKey: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4769-4809 | function conversationPromptCacheAnchor: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:4769-4809 | function conversationPromptCacheAnchor: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:4769-4809 | function conversationPromptCacheAnchor: crypto / randomUUID / createHash | no node:crypto counterpart declared | id/hash generation left as DEFECT, counter/buffer placeholder
- relayProtocolGateway.ts:4769-4809 | function conversationPromptCacheAnchor: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:4814-4823 | function promptCacheHostAllowed: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:4814-4823 | function promptCacheHostAllowed: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:4814-4823 | function promptCacheHostAllowed: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4832-4839 | function promptCacheHostDenied: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:4832-4839 | function promptCacheHostDenied: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:4832-4839 | function promptCacheHostDenied: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4845-4847 | function promptCacheKindAllowed: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: ReadableStream / SSE streaming | no ReadableStream/SSE pull-stream counterpart | ordered emit/enqueue calls approximated sequentially into JsonBuf
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:4869-5014 | function upstreamHeaders: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5024-5027 | function withEffectiveGroupBaseUrl: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5035-5044 | function resolveThreadStableSessionId: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5053-5057 | function resolveOpenCodeBackendUserAgent: process.env / Node runtime API | no Node process env / host-services object in SLA | env reads as comments; host services via JsonBuf placeholders
- relayProtocolGateway.ts:5053-5057 | function resolveOpenCodeBackendUserAgent: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5058-5061 | function normalizedClaudeCodeVersion: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5058-5061 | function normalizedClaudeCodeVersion: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:5063-5068 | function withProtocolQueryAuth: URL / Date / Math host helpers | no URL/Date/Math host object parity | values approximated as u64/ i64 placeholders, original expr in comment
- relayProtocolGateway.ts:5063-5068 | function withProtocolQueryAuth: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5063-5068 | function withProtocolQueryAuth: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5070-5090 | function relayResponseHeaders: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5092-5113 | function parseContent: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5092-5113 | function parseContent: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5115-5120 | function anthropicImageBlock: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5122-5127 | function geminiImagePart: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5129-5132 | function dataUrlParts: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:5134-5139 | function chatToolChoice: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5141-5147 | function anthropicToolChoice: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5141-5147 | function anthropicToolChoice: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5149-5154 | function geminiToolConfig: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5156-5162 | function toolNameForCall: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:5156-5162 | function toolNameForCall: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5164-5166 | function contentText: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:5164-5166 | function contentText: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5168-5172 | function contentValueToText: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5168-5172 | function contentValueToText: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:5168-5172 | function contentValueToText: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5174-5191 | function resolveMappedModel: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:5174-5191 | function resolveMappedModel: Map / Set collections | no generic Map/Set | fixed arrays + len fields in JsonBuf/state structs (capacity noted)
- relayProtocolGateway.ts:5174-5191 | function resolveMappedModel: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5174-5191 | function resolveMappedModel: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5193-5201 | function messageRole: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5193-5201 | function messageRole: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5203-5210 | function parseArguments: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5203-5210 | function parseArguments: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:5203-5210 | function parseArguments: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5212-5219 | function upstreamErrorMessage: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5212-5219 | function upstreamErrorMessage: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:5221-5231 | function isContextWindowError: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5221-5231 | function isContextWindowError: try/catch/throw exception flow | no exceptions in SLA | early return of status code; catch blocks become sequential blocks
- relayProtocolGateway.ts:5221-5231 | function isContextWindowError: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5221-5231 | function isContextWindowError: regex / string methods | limited string/regex surface | original expression preserved as comment, result placeholder u64
- relayProtocolGateway.ts:5233-5239 | function jsonResponse: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:5233-5239 | function jsonResponse: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5233-5239 | function jsonResponse: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5233-5239 | function jsonResponse: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5241-5243 | function errorResponse: fetch / Web Request-Response API | no fetch/Request/Response in sa_std SLA surface used here | JsonBuf request/response buffers + status code
- relayProtocolGateway.ts:5241-5243 | function errorResponse: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5245-5247 | function asRecord: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5245-5247 | function asRecord: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5249-5251 | function stringValue: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5253-5255 | function finiteNumber: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5257-5273 | function jsonValue: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments
- relayProtocolGateway.ts:5257-5273 | function jsonValue: closure / arrow callback capturing mutable state | no closures capturing mutable locals | callback params as u64 ids, bodies inlined as sequential blocks/comments
- relayProtocolGateway.ts:5257-5273 | function jsonValue: union / literal / optional types | no union/literal types | tag field (u64) + merged optional fields in struct
- relayProtocolGateway.ts:5257-5273 | function jsonValue: generics / indexed access / Parameters<> | no generics or indexed access types | erased to JsonBuf / concrete struct
- relayProtocolGateway.ts:5257-5273 | function jsonValue: for-of / array higher-order methods | no iterators / higher-order array methods over dynamic arrays | counted for loops over len fields where shape known, else sequential comment
- relayProtocolGateway.ts:5275-5277 | function errorMessage: dynamic JSON / Record<string, unknown> | no dynamic object / reflection | JSON text buffer (JsonBuf) fields, parse/stringify as comments

