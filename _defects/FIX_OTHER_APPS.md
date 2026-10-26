# FIX_OTHER_APPS — 修复阶段 1 第三步（duck2api + free-key-server）收尾状态

- 工作树：`/content/bulk-apps`（Colab 盒，独立 worktree，未碰 /content/bulk、/content/bulk-fe、/content/bulk-srv）
- 基点：`origin/bulk-convert` = `692d15a`（fetch 核对一致）
- 本地提交：`fix(server-other-apps): phase1 compile-through`（仅本地，未 push；哈希以提交后 git log 为准）
- 状态：**按用户 2026-10-26 战略转移指令暂停收尾**——SLA 修复阶段在本成果合入后暂停，主战场转 tsgosa 探坑；本文即恢复点。

## 结果总览

- 基线：**1/33 通过**（仅 types.d.sla）
- 最终：**5/33 通过**
- 通过集合（5）：`duckgo/playgame-prompt.sla`、`duckgo/vqd-scripts.sla`、`test/image.test.sla`（duck）、`adminPage.sla`、`types.d.sla`（fks）
- 失败集合（28）：见下方分类清单（按文件名字集合管理，后续比对以名字集合为准，不以计数为准）

## 已落地的基础设施与批量变换（本提交内）

1. **共享预置层（converter 从未落地的 ByteBuf 层已建成并探针通过）**：
   - duck 侧植入 `apps/duck2api/src/types.sla`，fks 侧植入 `apps/free-key-server/src/config.sla`，均位于 @import 块之后（结构体字面量要求定义先行于展开序）。
   - 内容：`ByteBuf { bytes: [u8; 40960], len: u64 }` + `buf_reset/buf_append_lit/buf_append_buf/buf_append_byte/buf_append_escaped/buf_append_u64/buf_append_hex_u64/buf_append_f64/buf_to_lower/buf_to_upper/buf_trim/buf_drop_front`、`bytes_eq`(4 参)、`bytes_eq3`(3 参→4 参回绑)、`bytes_eq_str`、`find_byte/find_sub_buf`（未找到返 len）、`starts_with`、`sa_handle_data/len`（16 字节 {ptr@+0,len@+8} 句柄直读）；duck 侧另有 `StrField { bytes: [u8; 512], len: u64 }` + `str_field_set`；两 hub 直引 fmt.sai/math.sai/encoding/json.sai。
   - `buf_append_f64` 经 `sa_fmt_f64` 句柄 + 剥尾零，保真近似已在代码注释注明。
2. **ts_\*/JSON 意图名本地实现（重大发现）**：`@ts_str_*`/`@ts_math_*` 是 SA 层函数（ts_string.sa/ts_math.sa 内 0 个 [MACRO]），**SLA 源码不可直调**（探针实证 Undefined）；转换日志 §A「已绑 sa_std ts 面」从未编译验证。已在两 hub 内以同名 SLA 本地函数复刻调用点语义：`ts_str_equals`（走 bytes_eq）、`ts_math_minmax`、`ts_math_rounding`（op 0=floor/1=ceil/2=round/3=trunc，经 math.sai），及 JSON 助手 `sa_json_object_has/sa_json_number_value/sa_json_bool_value/sa_json_object_len/sa_json_object_get_number`（真实面 encoding/json.sai）。
3. **JSON kind 编号翻译**：`sa_json_kind_of(x) ==/!= c` 全部改 `sa_json_kind` + 真实常量——意图编号 0=null、1=string、2=array、3=object、4=number；真实编号（sci sa_std.zig `SA_JSON_KIND_*`）0=null、1=bool、2=integer、3=float、4=number_string、5=string、6=array、7=object；4 号翻译为 `(==2||==3||==4)`（!= 对偶为 && 链）。
4. 批量变换（均先备份至盒上 `/tmp/bulk-apps-backup/`、脚本 OK 标记 + grep 双确认）：
   - `*x = *x + EXPR;` 拆分（解引用读不能作算术操作数）：**31 站点**
   - `sa_time_now_ms()` → `(sa_time_unix_ms() as u64)` + time.sai 直引：**55 站点 / 9 文件**
   - 虚构宏 `PTR_BYTE_SET` → PTR_BYTE_ADD + PTR_WRITE_U8 组合：**6 站点**
   - `sa_json_get_string(node,&p,&l)` → `p = sa_json_string_ptr(node); l = sa_json_string_len(node);`：**7 站点**
   - while/for 块尾 `;` 删除（括号追踪扫描器，if 块 `};` 保留）：**3 站点**
   - `bytes_eq` 3 参形 → `bytes_eq3`：**26 站点**
   - **数组实参物化 511 处 / 25 文件**：普通 fn 的 ptr 形参不能收 `&x.bytes`/裸数组实参（capability→plain 参数 TypeMismatch）；按签名表将数组实参提升为 `let __apN: ptr = PTR_NULL(); PTR_BYTE_ADD(__apN, <数组表达式>, 0);` 临时量。（注：变换器首版前缀行序写反，已全量定点修复并复验。）
5. 导入补充：.sai extern 与 .sa 宏**不经 .sla 传递导入**，用者必须直引（resetAdminTotp 的 STR_PTR 错误为证）——已给 response/vqd/playgame-prompt/vqd-scripts/adminAuth/adminCaptcha/adminTotp/adminPage 等补直引；image.sla 收尾时补 encoding/json.sai 直引（正确，后续错误见下）。

## 剩余失败 28 个 — 分类与恢复指引

### A. 机械续修（修法已定/已设计，未落地；无缺口争议）

| 文件 | 当前首错 | 定好的修法 |
|---|---|---|
| duckgo/convert.sla | `ts_str_trim` Undefined | 仅 1 真调用点（:92 句柄形）：改为 (ptr,len) 视图算术（前后空白跳过）+ 直用视图调 buf_append_lit；同形另 1 点在 licenseStore.test 的 `ts_str_slice(...,0,12,0)` |
| duckgo/image.sla | image_push 内 assign TypeMismatch（target user_defined / val borrow） | 逐站点看 image_push 赋值形，改写穿/借用形 |
| duckgo/response.sla | `tool_calls + i*8192` ptr 算术 | 改 PTR_BYTE_ADD 临时量；但下一错已探明：**普通 ptr 不能传 `&ToolCall` 形参**（探针实证 TypeMismatch），且 8192 步长系转换占位（ToolCall 布局推算 ≈4432，未经编译器核定）——需改 tool_call_to_json 调用约定（传 & 数组元素或改索引形），属设计点 |
| duckgo/types.sla | `sa_json_kind_of` 残 2 处（值形 `let kind = ...`） | 加 hub 助手 `sa_json_kind_intent`（真实→意图编号映射）后改名，对比点意图常量不动 |
| duckgo/tool-simulation.sla | `sa_json_parse` 3 参形 InvalidArgsCount | 真实声明 `sa_json_parse(ptr, len) -> u64`（返回 root，0=失败）：3 站点（本文件 2 + convert.test 1）改赋值形 |
| duck test/convert.test.sla | `sa_json_parse` Undefined | 补 encoding/json.sai 直引 + 上行改写 |
| duck test/{tool-stream}.sla、fks adminCaptcha.test、adminTotp.test | `sa_string_index_of` 4 参 InvalidArgsCount | 真实 extern 在 string.sai，**5 参**（hay,hlen,ndl,nlen,from）：站点尾加 `, 0` + 补 string.sai 直引 |
| fks config.sla | 自身 `str_field_set` 调用点 capability 实参 | hub 被物化变换器排除，需在本文件内手动 1 处物化 |
| fks resetAdminTotp.sla | `STR_PTR` Undefined | 补 ptr.sa + string.sa 直引（宏不传递导入） |
| fks licenseStore.test.sla | `sa_test_mkdtemp` Undefined | 测试本地实现（env temp dir + fs 面组合） |
| duck index.sla | :36 SyntaxError（`App` 未定义结构体字面量） | 按 server.sla 真实形改写：`DuckApp`（无 state_len 字段）+ `duck_app_new(&app)`；全字段零字面量由结构体定义生成 |
| duck server.sla | `sa_env_get_str` Undefined | env 读取助手未定义：按真实面 `sa_env_get(key,klen)->u64 handle` 写本地 `env_read_buf/env_read_field`（句柄经 sa_fmt_buffer_data/len/free 读）；另 `serve_app` 与 ambient sink 层（sa_http_respond_json/begin_sse/sink_write_line/end_sse/sink_null、req_header 的 sa_http_request_header）需按 http_server.sai 真实面（accept 循环 + resp_stream_*）在 server.sla 内新写——设计已定（当前请求指针经全局 cell 传递、sink id 索引 cell 注册表；ptr↔u64 用 PTR_ADDR/PTR_CAST 宏，`as` 互转已被探针否定） |
| fks index.sla | `sa_http_respond` Undefined | 同上 ambient respond 层，按 http_server.sai 在本文件内落地（fks 无 SSE 需求，较 duck 简单） |
| duck stream.sla / test/stream.test.sla | `sa_sink_write_line` / `sa_body_from_text` Undefined | body/sink 句柄层未落地：注册表设计已定（命名 cell 族 body.\<id\>/sink.\<id\>），或将 consume 签名改为 &BodyReader/&Sink 结构体直传（TS ReadableStream 形的 u64 句柄是转换发明）——二选一属设计点，未动工 |
| duck vqd.sla / upstream.sla / test/upstream-retry.test / test/vqd.test | `sa_base64_encode`、`sa_crypto_sha256_base64` Undefined | 组合可达（非缺口）：hub 内手写精确 base64 编/解码（sa_b64dec_simd 不吃填充、sa_deno_btoa 是字符串语义，故手写）；sha256_base64 = sa_std_net_sha256_hex → hex 解码 → base64 编码组合 |

### B. 真缺口（四出处已核：sala 文档 / SLA demos / SLA tests 语料 / sa_std 清单；结论同 CAPABILITY_MAP）

| 文件 | 缺口 | 结论 |
|---|---|---|
| duckgo/tokens.sla | BPE tokenizer（`sa_token_count_bpe`） | 四出处零命中，确认不支持。处置预案（未落地）：计数函数改显式 UNSUPPORTED 状态（8）+ DEFECT 引裁决 |
| duckgo/vqd.sla | node:vm 挑战执行（`sa_vqd_execute_challenge`） | 确认不支持（JS 运行时不在 std 面内）；vqd 生成路径同上预案 |
| duckgo/upstream.sla | `sa_crypto_random_hex` | 待 TS 源判定：若源为 Math.random（如 FE 信号抖动）→ sa_math_random 回绑（忠实）；若密码学用途 → 缺口。**未定案，勿擅自拼随机数** |
| fks adminAuth.sla / adminAuth.test.sla | scrypt（`sa_crypto_scrypt[_hex]`） | crypto.sai 仅 bcrypt+keyring（6 extern），scrypt 四出处零命中；bcrypt 非替代（存储格式不同）。同文件 HMAC-SHA256 可由 sha256_hex→hex 解码精确组合（两遍 ipad/opad），属可达未落地 |
| fks adminTotp.sla | 密码学随机字节、HMAC-SHA1、AES-256-GCM | 三者均四出处零命中（std 仅 SHA-256，无 SHA-1）；totp_code/encrypt/decrypt/generate 路径受影响。base32/base64url/URI 编码为本地可达（未落地） |
| fks licenseStore.sla | 密码学随机字节（密钥生成） | 同上缺口。同文件其余：HMAC hex 可组合；SQLite 须改 plugin_sqlite 的 step_json 形（无逐列游标，读经 JSON 中转，CAPABILITY_MAP §8）；`sa_fs_mkdir_parent_of`、url normalize 为本地可达 |
| fks discord.sla | ed25519 verify（`sa_crypto_ed25519_verify_raw`） | 四出处零命中，确认不支持 |
| fks index.sla | QR data URL（`sa_qr_to_data_url`，在 sa_http_respond 之后） | 四出处零命中，确认不支持 |
| fks adminCaptcha.sla | PNG 编码（`sa_png_encode_base64`，在 sa_crypto_sha256 之后） | 四出处零命中；本文件 `sa_crypto_sha256` 本身可回绑 `sa_std_net_sha256_hex`（可达未落地） |
| （跨文件） | `sa_deno_random_uuid` | **运行时有实现但 sa_std 全域无 .sai 声明** → SLA 不可调，属 sci 侧声明缺口（非语义缺口），分类记录在此 |

### C. 其他计数（交付要求项）

- **fs_exists 改正数：0**——两棵树全文 grep `sa_std_fs_exists|fs_exists` 零命中，本域无该函数使用点，无需改正。
- **语义桩数：本轮新增 0、回绑消除 0**。两棵树现存 `// DEFECT` 注释行合计 119 行（转换期遗留，含源矛盾标记、近似标注与待回绑桩），逐条台账见 `_defects/server-other-apps.md`；本轮方针为先打通编译骨架，未对既有桩做回绑/UNSUPPORTED 化（预案均记于上方 A/B 类）。
- altB 的 3 个字段不匹配：**未在本工作树收口**——/content/bulk-apps 范围内无 altB 相关文件与缺陷条目，该项不在本域（duck2api/free-key-server）文件集合内，需主线另行路由；此处如实记录，不代为认领。

## 源自相矛盾再标记（转换按源 as-is，修复阶段未改语义）

- **convert.test.ts:76 期望折叠后 role 为 `"assistant"`，而 convert.ts 实际折叠结果为 `"user"`**——源测试与源实现自相矛盾。SLA 转换两侧均按源原样转写（实现侧 `convert.sla` 折为 `"user"`，测试侧期望 `"assistant"`），本轮未擅自改任何一侧语义；后续若跑通该测试，此条为预知失败点，须由用户/主线裁决改哪一侧。

## 恢复点

- 代码状态：本提交（基点 692d15a 之上）。
- 原件备份：盒上 `/tmp/bulk-apps-backup/`（每文件首改前副本；注意 /tmp 不跨 Colab 运行时存活，长期恢复以本提交 + 本文档为准）。
- 复验命令（盒上，串行）：`export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:/tools/node/bin:$PATH; export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std; timeout 60 sa check <file>`，工作目录 /content/bulk-apps。
- 续修顺序建议：A 类自上而下（多为单文件单点）→ stream/sink 与 serve_app 两个设计点 → B 类按主线在 sci/sa_std 补地基后的新面回绑（与 tsgosa 探坑三分类中的 sa_std 类对齐）。
