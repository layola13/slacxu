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
