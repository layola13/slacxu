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
