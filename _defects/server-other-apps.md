# 缺陷日志 — 单元 server-other-apps（apps/duck2api + apps/free-key-server）

源：codex-react-ui plugins @ f2cb649d；33 个 .ts → 33 个 .sla，源 5,142 行。
格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似。
行内另有 116 处 `// DEFECT:` 注释与本日志对应。

## A. 已绑 sa_std ts 面（2026-10-26 00:37 追加指令；签名实测自 Colab sci/sa_std）

- apps/duck2api/src/duckgo/upstream.ts:82-87 | Math.max/Math.min（backoff） | 已绑 sa_std ts 面 | @ts_math_minmax（ts_math.sa，i32 域，值域 ≤120000 天然合界）
- apps/duck2api/src/duckgo/upstream.ts:278-289,405-418 | Math.ceil + Math.max（cooldown/rateLimited 秒数） | 已绑 sa_std ts 面 | @ts_math_rounding（op 1=ceil）+ @ts_math_minmax；TS 负 delta 的 ceil 语义未覆盖（u64 路径仅正值可达，已注）
- apps/duck2api/src/duckgo/stream.ts:281,487 | Math.floor(Date.now()/1000)（created_at） | 已绑 sa_std ts 面 | @ts_math_rounding（op 0=floor）
- apps/duck2api/src/server.ts:317 | Math.floor(Date.now()/1000)（images created） | 已绑 sa_std ts 面 | @ts_math_rounding（op 0=floor）
- apps/duck2api/src/duckgo/convert.ts:56 | String.trim（capReasoningEffort） | 已绑 sa_std ts 面 | @ts_str_trim（ts_string.sa，mode 0，返 16 字节 {ptr@+0,len@+8} 柄；柄读取经 sa_handle_data/sa_handle_len 意图访问器，布局按 sa_std 源码）
- 全部 10 个 test 文件 | 字符串 toBe 相等断言 | 已绑 sa_std ts 面 | expect_str_eq 统一走 @ts_str_equals（ts_string.sa）
- apps/duck2api/test/vqd.test.ts:22,28-29；apps/free-key-server/src/adminTotp.test.ts:18；apps/free-key-server/src/adminCaptcha.test.ts:8；apps/duck2api/test/upstream-retry.test.ts:87；apps/duck2api/test/tool-stream.test.ts:63-64,137-138 | String.startsWith / includes / toContain | 已绑 sa_std ts 面 | sa_string_index_of（string.sai）== 0 / >= 0
- apps/free-key-server/src/licenseStore.test.ts:80 | String.slice(0, 12)（listLicenses 查询） | 已绑 sa_std ts 面 | @ts_str_slice（ts_string.sa）
- apps/duck2api/test/tool-stream.test.ts: passim | parts.push(...spread) / parts.map().join("") | 已绑 sa_std ts 面（句柄适配待修复阶段） | 对应 @ts_arr_append_slice / @ts_arr_join_strs（ts_array.sa，词/字符串柄数组）；parts 为结构体数组，harness 保留结构体表，join 过 text 字段执行

## B. 密码学原语（node:crypto）— sa_std 无对应导出

- apps/free-key-server/src/adminAuth.ts:全文 | scryptSync + timingSafeEqual + HMAC 签名会话 | sa_std crypto.sai 未见 scrypt/HMAC/timing-safe 导出 | 意图 extern sa_crypto_scrypt_hex / sa_crypto_hmac_* / sa_crypto_timing_safe_equal
- apps/free-key-server/src/adminTotp.ts:全文 | HMAC-SHA1 TOTP、AES-256-GCM 加密 totp secret、randomBytes | 同上（另需 base32 编解码，已在 adminTotp.sla 内手写） | 意图 extern sa_crypto_hmac_sha1 / sa_crypto_aes256gcm_* / sa_crypto_random_bytes
- apps/duck2api/src/duckgo/convert.ts:89-103 | generateKeyPairSync("rsa", 2048) + JWK export + randomUUID | sa_std 无 RSA 密钥对/JWK 导出 | 意图 extern sa_crypto_rsa2048_jwk / sa_crypto_random_uuid
- apps/duck2api/src/duckgo/vqd.ts:全文 | node:vm 沙箱执行挑战脚本 + sha256 base64 | vm 沙箱无对应面（sa_ts_* 是 tree-sitter，与 node:vm 无关） | 意图 extern sa_vqd_execute_challenge；sha256 走 sa_sha256_base64 / vqd.sla 内 go_sha256_base64
- apps/duck2api/src/duckgo/tokens.ts:全文 | js-tiktoken BPE 计数 + sha256 hex 提示哈希 | 无 BPE tokenizer 导出 | 意图 extern sa_token_count_bpe；哈希 sa_sha256_hex（tokens.sla 已按此写）
- apps/free-key-server/src/licenseStore.ts:passim | HMAC 键哈希、randomUUID、随机码生成 | 同 B 类 | 意图 extern sa_crypto_* 一族

## C. 动态 JSON / zod 运行时校验

- apps/duck2api/src/types.ts:全文 | zod schema（apiRequestSchema / imageGenerationSchema）+ z.infer 动态形状 | SLA 无运行时 schema 校验器；types.sla 只落了结构体 | server.sla 以 api_request_shape_ok 做结构近似（object + string model + array messages），zod 默认值/未知键剥离/嵌套联合语义未复现
- apps/duck2api/src/duckgo/convert.ts:106-226 | ApiMessage content 联合（string | part[]）、Record<string, boolean> toolChoice、FileLookup 闭包类型 | 动态 JSON 形状 | 输入改走 sa_json 节点句柄分发；toolChoice 收敛为两个 bool 旗；FileLookup 改显式 FileStore 表 + 查找函数
- apps/duck2api/src/duckgo/tool-simulation.ts:202-217 | JSON.parse 信封 + JSON.stringify(args) | 动态对象 | sa_json 节点 API（sa_json_parse / sa_json_object_get / sa_json_stringify 意图 extern）
- apps/duck2api/src/duckgo/stream.ts:264-585 | Record<string, unknown> 响应对象 + 条件展开 {...(cond ? {k:v} : {})} | 动态键序对象 | JSON 文本 ByteBuf 逐字段拼装，键序按 TS 字面量顺序；条件键以 has_ 旗控制
- apps/free-key-server/src/licenseStore.ts:passim | settings/campaign 的 Record 形状、safeCampaign 归一化 | 动态 JSON | 节点句柄 + Campaign 结构体；URL 归一化（尾斜杠）保留

## D. async / Promise / 流 / 定时器

- apps/duck2api/src/duckgo/upstream.ts:36-70,240-258 | async fetch、动态 import("fetch-impersonate")、setTimeout sleep、Promise 链互斥（waitSlot queue） | 无 async 运行时面绑定（async.sla/future.sa 存在，但本阶段按同步函数 + 阻塞 sleep extern 近似；修复阶段优先按 async.sla 评估） | 同步 fn + sa_sleep_ms / sa_http_fetch_* 意图 extern；互斥退化为顺序调用，lastConversationEnd 簿记内联到每个 return 点
- apps/duck2api/src/duckgo/upstream.ts:15-34 | TLS 指纹 fetch（fetch-impersonate chrome146 预设） | sa_std 无 TLS 指纹客户端 | 意图 extern sa_http_fetch_impersonated / sa_http_impersonate_available；降级旗 fetch_degraded 保留
- apps/duck2api/src/duckgo/stream.ts:43-260,264-585 | ReadableStream reader 循环、TextDecoder 增量解码、await write 回调、闭包簇（emitPart/enc/emitResponse*） | 流与闭包 | body 改不透明句柄 + sa_body_read_chunk / sa_body_close 意图 extern（增量 UTF-8 在 extern 内）；write 改 sink 句柄 + sa_sink_write_line；闭包改显式状态结构体（ChatConsumeState / ResponsesConsumeState）
- apps/duck2api/src/server.ts:143-176,253-278 | Hono c.json/Response + ReadableStream start(controller) 回调产 SSE | 框架回调模型 | sa_http_begin_sse 取 sink 后直调 consume*，chat 路由在 server 侧补 data: [DONE]（与 TS 一致）
- apps/free-key-server/src/index.ts:全文（先期已转） | Bun serve / node:http 异步 handler | 同 D 类 | 同步分发 + 意图 extern

## E. SQLite（better-sqlite3）

- apps/free-key-server/src/licenseStore.ts:全文 | better-sqlite3 同步绑定、db.transaction(closure) | sa_std 无 sqlite 绑定面 | 意图 extern sa_sqlite_*（open/prepare/bind/step/finalize/begin/commit/rollback…）；transaction 闭包改显式 begin/commit/rollback 三段

## F. Node/Bun 运行时面

- apps/duck2api/src/server.ts:1-14,全文 | Hono + @hono/zod-validator 路由/中间件 | 无 Web 框架对应 | duck2api_handle_request 显式分发（路径/方法/鉴权/OPTIONS 顺序按 TS 注册序）；响应走 sa_http_respond_* / sa_http_set_header 意图 extern
- apps/free-key-server/src/adminPage.ts（先期已转） | 模板字面量整页 HTML + qrcode 库 | 无模板/QR 库 | 机械抽取为逐行 buf_append_lit（脚本生成）；QR 走意图 extern sa_qr_to_data_url
- apps/free-key-server/src/adminCaptcha.ts（先期已转） | pngjs PNG 编码、5x7 字形渲染 | 无 PNG 编码导出 | 意图 extern sa_png_encode_base64；RGBA 缓冲 48,720 字节超导入文件大数组舒适区（~40,960），已在文件内标注
- apps/duck2api/src/duckgo/image.ts（先期已转） | SSE data 行解析取图 | —（已转，结构体为 arena 切片模型 ExtractedImage{b64_off/b64_len, format, width, height}） | 与 TS {b64, format, width, height} 语义等价，偏移模型不同
- apps/duck2api/src/duckgo/upstream.ts:118-143 | Headers.getSetCookie()（Bun/undici） | 无对应头枚举面 | fetch extern 逐条交 Set-Cookie 行，collect_cookies 循环入罐
- apps/duck2api/test/upstream-retry.test.ts:9-53 | globalThis.fetch 打桩 + process.env 直写 | 无 fetch 打桩面 | 意图测试 extern sa_test_fetch_stub_install（脚本模式 1=400 后 200 / 2=恒 400）+ sa_test_fetch_stub_chat_count/chat_body；sa_env_set 写 DUCK_FETCH
- apps/duck2api/test/stream.test.ts / tool-stream.test.ts:fakeUpstream | ReadableStream 假体 + write 收集回调 | 无测试替身面 | 意图测试 extern sa_body_from_text + sa_test_sink_new/line/line_count
- apps/free-key-server/src/licenseStore.test.ts:85-105 | mkdtempSync / rmSync 临时目录 | 测试替身面缺失 | 意图测试 extern sa_test_mkdtemp / sa_test_rm_rf
- apps/duck2api/src/index.ts（先期已转）；apps/free-key-server/src/resetAdminTotp.ts（先期已转） | process.env / process.exit / 信号 | 进程面 | sa_env_get / 意图 extern

## G. 正则

- apps/free-key-server/src/licenseStore.ts / .test.ts:passim | 机器哈希 ^[a-f0-9]{64}$、键格式 ^cxu-[A-Za-z0-9]{48}$、LIKE 转义、cookie 解析 | ts 清单与 sa_std 均无 regex 面 | 全部手写扫描（字符类逐项判定）；断言侧同法（licenseStore.test.sla key_format_ok）
- apps/duck2api/src/duckgo/upstream.ts:209-210 | body.match(/data-version-tag="([^"]+)"/) 两处 | 同上 | find_sub_buf + 引号定界手写扫描（extract_html_attr）
- apps/free-key-server/src/adminTotp.test.ts:11,18；adminCaptcha.test.ts:8 | assert.match(/^\d{6}$/ 等) | 同上 | 数字逐位扫描；前缀类已改绑 sa_string_index_of（见 A 类）

## H. 类 / Map / 模块状态 / 闭包 / throw

- 全部源文件 | class（LicenseStore、AdminCaptchaStore、Jar、ToolSimulationStream）、Map/Set、模块级可变状态、闭包捕获（waitSlot/emit*） | SLA 无类与闭包 | struct + 首参 &Struct 函数族；Map 改定长表（保序）；模块状态收进显式状态结构体（UpstreamState / DuckApp）；throw 改 i32 状态码 + err ByteBuf（0=ok）
- apps/duck2api/src/duckgo/tool-simulation.ts:9-10,309-377 | pending 字符串可达 256KiB（MAX_PLAYGAME_PENDING） | 定长缓冲上限 | ToolSimPending 内联 262,144 字节，超限截断已注；TS 字符串为 UTF-16 码元，全文扫描按 UTF-8 字节，非 ASCII 下标不一致（原文 Go 字节语义优先，已注）
- apps/duck2api/src/duckgo/convert.ts:30-47 | DuckApiRequest.messages / parts 定长化 | 容量上限 | messages 128、parts 64 定长表，超限丢弃已注
- apps/free-key-server/src/config.ts（先期已转） | env 解析 + 校验 throw | 同 H 类 | 状态码 + err 缓冲；StrField {bytes:[512], len} + has_ 旗表达 nullable

## I. 测试框架

- 全部 10 个 test 文件 | bun:test（describe/test/expect、toEqual/toContain/toHaveLength）与 node:test + assert/strict | SLA 无测试框架 | 每文件本地 expect_* 助手 + run_all_tests() 聚合失败计数；toEqual 改逐字段比对；async test 改同步直调
- apps/duck2api/test/stream.test.ts:22,42；tool-stream.test.ts:190,238 | 注入 countTokens: (s) => s.length | stream.sla 已将 countTokens 回调收敛为具体 count_token（BPE） | outputTokens === 11 等断言按注入计数器的值原样保留并行内标注，修复阶段需把计数器重新参数化才能通过
- apps/duck2api/test/upstream-retry.test.ts:56-92 | 两用例共享模块级限速状态（60s 超时源于 10s waitSlot 节拍） | 显式状态后每用例新状态 | 新 UpstreamState 起始无节拍等待，语义分歧已在文件头注

## J. 源自身不一致（转换时发现，按原文转换未改）

- apps/duck2api/test/convert.test.ts:76 | 期望折叠后 roles 为 ["user", "assistant"] | convert.ts 明确把 assistant 折为 "user" 并加 [assistant] 前缀——测试与源互相矛盾（TS 侧该断言按原文应失败） | 测试 .sla 按原文保留 "assistant" 期望并行内标注，待修复阶段与基线比对定案

## K. 跨文件约定分歧（本单元转换中发现/产生，修复阶段统一）

- apps/duck2api/src/duckgo/{tokens,response}.sla（先期） vs 本轮 stream/tool-simulation/convert.sla | PTR_BYTE_AT 两种形态并存：3 参出参宏（tokens.sla）与 2 参返回值式（本轮文件） | 同一镜像内宏约定不统一 | 本轮文件内部自洽；统一留修复阶段
- apps/duck2api/src/duckgo/response.sla:15-26 | ToolCall 为定长数组结构体 {id:[u8;128], fn_name, fn_arguments:[u8;4096]…} | 与本轮初稿 StrField/ByteBuf 形不一致 | 已对齐：tool-simulation/stream/server 改用 response.sla 的 ToolCall 本尊；列表包装 ToolCallList{calls:[ToolCall;64], len} 定义于 tool-simulation.sla（response.sla 的 builder 以 (ptr, len) 取表，边界处拆包传递）
- apps/duck2api/src/duckgo/response.sla:187-205 | UpstreamEvent 只有 has_*/len 旗标结构体，无解析/访问函数 | stream.ts 的事件字段读取无现成面 | stream.sla 以 sa_event_* 意图 extern 读取节点字段，与 UpstreamEvent 旗标结构体并行存在，修复阶段二选一
- apps/duck2api/src/types.sla | apiError 的 code 为字符串形参 | server.ts 中 code = String(status) | server.sla 已按十进制文本化后传入（respond_upstream_error）
- 多文件 | sa_handle_data / sa_handle_len（ts 柄 {ptr,len} 读取）为意图访问器 | sa_std 未以 SLA 名导出柄字段读取 | 按 ts_string.sa 源码布局（+0 ptr / +8 len）声明，修复阶段核对

## L. 其他单项

- apps/duck2api/src/duckgo/convert.ts:56-58 | String.toLowerCase | ts_string 清单无 toLowerCase 条目 | 保留手写 ASCII 折叠（buf_to_lower 假设助手），已在 convert.sla 注
- apps/free-key-server/src/licenseStore.test.ts:22,39,56,76 | String.repeat(64) | ts 清单无 repeat 条目 | 填充循环（repeated_hash）
- apps/duck2api/src/duckgo/upstream.ts:184-202 | Math.random 生成 FE 信号时序 | ts_math 清单无随机源 | 意图 extern sa_crypto_random_below
- apps/duck2api/src/duckgo/playgame-prompt.ts（先期已转） | 模板字面量逐字节复刻 | 手工转义易漂移 | 已在文件内标注字节精确性风险；vqd-scripts.ts / adminPage.ts 改走脚本机械抽取（字节忠实）
- apps/duck2api/src/index.ts（先期已转） | Bun export default { fetch } 入口 | 无对应入口面 | duck_app_new + duck2api_handle_request 分发形
