# CAPABILITY_MAP — 「SLA/sa_std 不支持」声称复核

复核日期：2026-10-26。触发：async 压平误判（用户指出）后，按用户定规矩对
批量转换声称的一批「不支持」逐项复核。规矩：判定不支持前必须查四处出处
并给引用——① sala 文档（/content/sa_all/sala/content/）② SLA demos
（/content/sa_all/sa_plugin_sla/demos/）③ SLA tests 语料
（/content/sa_all/sa_plugin_sla/tests/）④ sa_std 清单
（/content/sa_all/sci/sa_std/，含 .sai 与 sci/src/runtime 实现）。

统计方法：对 _defects/ 下 46 份单元缺陷日志做关键词子串计数
（`grep -h <kw> *.md | wc -l` 与涉及文件数）。子串计数是提及频次的
上限估计：如 "Set" 会命中 settings、"try" 会命中 entry 等无关词，
已在各节注明；频次只用于排优先级，裁决只看出处证据。

裁决汇总（16 个面）：**已支持 6**（闭包、泛型、SQLite 预处理、
fetch/WebSocket 客户端、fs 同步便捷面、JSON 动态对象）；
**部分支持 8**（类与继承、Map/Set/WeakMap、RegExp、crypto、
定时器/时钟、字符串字面量联合、try/catch 与错误模型、生成器/迭代器）；
**确认不支持 2**（EventEmitter、TOML 写入/序列化）。

---

## 0. 前提复核：FIX_PHASE1 缺口 3/4/5

另一个 agent 正在 sci 实现缺口 3/4（与缺口 2 的 cell），先核三条前提。

### 缺口 3「sa_std fs 无 mkdir -p」——前提为真（记录时点）
- 证据：`git log -S "sa_fs_mkdir_p"` 显示该导出首次出现于 2026-10-26
  的检查点提交 891350d4，即并行 agent 本日的实现；在 FIX_PHASE1 记录
  时点（10-26 凌晨），fs.sai:110-113 只有单层 sa_fs_make_dir /
  sa_fs_make_dir_mode / sa_fs_create_dir / sa_fs_create_dir_mode。
- 附带发现：SA 宏层 path.sa 的 FS_CREATE_DIR_ALL / PATH_CREATE_DIR_ALL
  自 2026-07-14（7e232a08）即存在，但那是 SA 宏，不是 SLA 可经
  @import 调用的 extern 面——产物调用点要的是 extern，前提不因此翻案。
- 现状：sa_fs_mkdir_p 已在 fs.sai:115 声明并实现（本日落地）。

### 缺口 4「mapError 无 PathAlreadyExists 独立码」——前提为真（记录时点）
- 证据：`git log -S "SA_STD_ERR_ALREADY_EXISTS"` 同样首次出现于
  2026-10-26 检查点 891350d4（并行 agent 本日实现）。此前
  sci/src/runtime/sa_std.zig 的 mapError 对 error.PathAlreadyExists
  落入通用码；现 2078 行已有
  `error.PathAlreadyExists => SA_STD_ERR_ALREADY_EXISTS`，
  且 fs.sai 已有 sa_std_fs_open_create_excl 导出。

### 缺口 5「词法器整数字面量上限 i64::MAX」——⚠ 前提部分为假
- 为真的一半：**无后缀**字面量确以 i64 解析
  （sa_plugin_sla/src/parser.zig:2994 的 else 分支
  `std.fmt.parseInt(i64, digits, base)`，溢出报 InvalidCharacter）。
- 为假的一半：**带 `u64`/`usize` 后缀的字面量可达 u64::MAX**，
  十进制与十六进制均可——parser.zig:2990-2993 的
  unsigned_wide_suffix 分支走 parseInt(u64) 再位存 i64；
  且有专门测试 tests/test_unit_u64_max_literal.sla
  （`18446744073709551615u64` 全套无符号行为断言）。
  该支持自 2026-09-26 合并 74508c13 起即在，**早于**原探针约一个月；
  原探针只试了无后缀形式就下了「十进制/十六进制均 InvalidCharacter」
  的全称结论，属误判。
- 影响：imagePersistence / openCodeSessionProtocol 的 7 处大字面量
  本可直接写 `11400714819323198485u64` 形式，无须 ((hi<<32)|lo)
  组合式转写（已转写的等价、无须回滚，但后续同类站点按后缀形式写）。

---

## 1. 闭包 / 捕获

- 声称来源与频次：缺陷日志「闭包」606 行 / 32 文件；"closure"
  208 行 / 12 文件。共识曾把闭包与 async 一并列为压平对象。
- 裁决：**已支持**（捕获语义有边界，见下）。
- 出处：
  - tests/test_unit_closures.sla（文件头自述 "Sla native closure
    smoke tests"）：`|x: int| x + offset` 闭包按值捕获外层变量，
    多参数闭包同测。
  - tests/test_unit_thread_closure_direct_call_merge_direct.sla：
    `thread::spawn(^|| batch(chunk))` —— `^||` 移动捕获非 Copy
    载荷（chunk 被 move 进闭包），与普通调用 move 并存。
  - sa_std/async.sla 头注释：`thread::spawn(^|| f(...))` 为
    执行器既定用法；fn 类型可作参数（`batch: fn(Vec<i32>) -> i32`）。
  - core/refcell.sa、core/cell.sa（sa_std）：内部可变容器。
- 边界与用法：捕获是按值拷贝（Copy）或 move（非 Copy），没有 JS 式
  按引用共享可变捕获。转换/修复阶段：纯读捕获直接用普通闭包；
  跨线程用 `^||`；需要共享可变状态时显式 Arc<Mutex<T>> 或
  RefCell，不要再把回调改写成全局函数 + 手工上下文结构体。

## 2. EventEmitter / 事件

- 声称来源与频次："EventEmitter" 65 行 / 15 文件；"emit" 619 行 /
  17 文件（含大量无关命中，上限估计）。
- 裁决：**确认不支持**（无此命名的标准面）。
- 查过的出处与关键词：
  - sa_std 全目录 grep `EventEmitter|event_emitter`：零命中
    （无 events 模块文件）。
  - tests、demos grep 同关键词：零命中。
  - sala 文档唯一命中在 content/05_plugins/12_node.html，且原文是
    反向证据——node 插件 worker 面「不构造 Worker/EventEmitter
    对象」，即兼容层亦明确不提供 EventEmitter 对象。
- 用法：事件订阅/广播在产物中以闭包 + fn 指针列表或 mpsc channel
  手工实现（属应用层模式，不是语言缺口）；不要再记为「等待 std
  EventEmitter」类缺陷。

## 3. 类与继承的等价物

- 声称来源与频次："class" 195 行 / 31 文件；「继承」54 行 /
  17 文件；"inherit" 25 行 / 8 文件。
- 裁决：**部分支持**。
- 出处：
  - tests/test_unit_impl_static_methods.sla、tests/
    test_unit_trait_static_dispatch.sla：impl 块 + 方法 +
    trait 静态派发。
  - tests/test_unit_rc_dyn_trait.sla：Rc + dyn trait 对象
    （动态派发）；sa_std/core/trait_object.sa、core/dispatch.sa。
  - sa_std/oop.sal 存在（SA 层 OOP 面）；sala 文档
    content/02_sla_lang/05_structs_enums.html（struct/enum 章）。
  - 编译器错误语料反证 trait 是一等声明：tests/
    test_error_redeclaration_trait.sla、test_error_trait_extra_method.sla。
- 边界与用法：struct + impl 方法 + trait + dyn trait 覆盖 TS 类的
  方法、接口、多态三件；没有 class 继承（extends/super/字段继承）。
  TS 类层次按「trait + 组合字段」重译；此前按「无类只能拆自由
  函数」处理的文件可在修复阶段回收为 impl 方法组织。

## 4. 泛型

- 声称来源与频次：「泛型」139 行 / 25 文件；"generics" 191 行 /
  5 文件。
- 裁决：**已支持**。
- 出处：
  - tests/test_unit_generics.sla、test_unit_nested_generic_close
    .sla、test_unit_generic_for_in_protocol.sla（`struct Query<T>`、
    `impl Query<T>`、`fn query_new<T>()`）。
  - 编译器有专门单态化器：sa_plugin_sla/src/monomorphizer.zig。
  - 语料中泛型容器为日常用法：Vec<T>、Result<T,E>、Arc<Mutex<T>>
    （见 closures/result/async 各测试）。
- 边界与用法：单态化泛型，无运行时类型擦除式的异质容器；
  TS 的 `Array<T>`/`Record<string, T>` 分别落 Vec<T> 与
  HashMap/BTreeMap（见第 5 节），不要再以「无泛型」为由把类型
  擦成 u64/裸指针。

## 5. Map / Set / WeakMap

- 声称来源与频次："Map" 516 行 / 42 文件；"Set" 5566 行 / 44 文件
  （子串含 settings 等，严重高估）；"WeakMap" 9 行 / 7 文件。
  共识曾记「Map/Set/WeakMap → 定长数组 + 线性扫描」。
- 裁决：**部分支持**——Map/Set 已支持，WeakMap 确认不支持。
- 出处：
  - sa_std：hashmap.sa / hashset.sa / btree_map.sa / btree_set.sa
    （另有 collections/ 下同名套件）。
  - tests/test_unit_map_get_chain.sla、test_unit_map_clear.sla、
    test_unit_btree_get_chain.sla：Map 实际用例。
  - sala 文档 content/06_stdlib/05_collections.html（集合章）。
  - WeakMap：四处出处 grep `weakmap|weak_map` 零命中；
    sa_std/core/weak.sa 只是 Rc/Arc 的 Weak<T> 弱引用
    （@import "weak.sal" + rc.sa），不是弱键映射。
- 边界与用法：Map/Set 一律回绑 HashMap/BTreeMap/HashSet/BTreeSet，
  禁止再用定长数组 + 线性扫描近似（容量上限类缺陷随之消解）。
  WeakMap 的弱键语义依赖 GC，SLA 无对应物：TS 侧 WeakMap 用例
  改为显式生命周期的普通 Map（在宿主对象释放点手动 remove），
  并在缺陷日志中按此口径改记，不再笼统记「Map 不支持」。

## 6. RegExp

- 声称来源与频次：「正则」390 行 / 34 文件；"RegExp" 228 行 /
  29 文件；"regex" 101 行 / 13 文件。共识曾记「sa_std 无正则
  引擎、各处手写扫描」。
- 裁决：**部分支持**——引擎真实存在，风味是 POSIX ERE 子集。
- 出处：
  - sa_std/text/regex.sai：8 个 extern——sa_regex_compile /
    sa_regex_match / sa_regex_group_ptr|len|start /
    sa_regex_group_count / sa_regex_free / sa_regex_match_free
    （u64 句柄模型，头注释明示）。
  - 实现：sci/src/runtime/sa_std.zig:477 起声明 libc
    `regexec`/`RegexC`，8450 行 `pub export fn sa_regex_compile`
    ——即 POSIX 正则（regcomp/regexec）。
  - sala 文档 content/06_stdlib/11_encoding.html 与 _manifest
    登记 regex；content/01_overview/07_cxu_readiness.html 亦提及。
  - tests/demos 无专门 regex 用例（该面由 sa-std-unit 侧覆盖，
    SLA 语料未见）——这是本节唯一证据弱点，如实记录。
- 边界与用法：普通匹配、分组捕获、区间可直接回绑 sa_regex_*，
  此前手写扫描的等价实现应回收。JS RegExp 的 lookahead/
  lookbehind、惰性量词、`\d \w \s` 简写类（POSIX 用 [[:digit:]]
  等）、replace/matchAll/split、全局迭代不在这 8 个 extern 内：
  含这些特性的模式仍是真缺口，但必须逐条注明用的是哪个 JS
  特性，不许再写「无正则引擎」。

## 7. crypto（HMAC、randomUUID、随机数）

- 声称来源与频次："crypto" 105 行 / 22 文件；"randomUUID"
  100 行 / 20 文件；"HMAC" 5 行 / 2 文件。
- 裁决：**部分支持**。
- 出处（std 内已有）：
  - sa_std/crypto.sai（6 extern）：bcrypt hash/verify +
    keyring get/set/remove——密码存储面。
  - sa_std/net.sai:8 `sa_std_net_sha256_hex`：SHA-256 一发
    十六进制摘要。
  - sa_std/math.sai `sa_math_random() -> f64`：Math.random 级别
    随机数（头注释标明是 Math.* 语义面，非密码学）。
- 出处（确认缺失）：
  - HMAC：sa_std 与 sci/src 全树 grep `hmac` 零命中；
    仅 sala content/05_plugins/12_node.html、19_bun.html 的插件
    兼容面清单里出现「HMAC-SHA256」（那是插件的 web-crypto 式
    extern 清单，不是 sa_std 导出）。且 std 只有 hex 摘要面、
    无原始字节摘要面，HMAC 无法用现有面忠实组合。
  - randomUUID：sa_std/tests/demos grep `uuid` 零命中；
    仅兼容文档提及（同上）。随机字节面（getrandom 类）
    在 sa_std .sai 与 sa_std.zig 导出中均无。
- 边界与用法：SHA-256、bcrypt、keyring 直接回绑；
  sa_math_random 只可用于非安全场景（采样、抖动），禁止冒充
  密码学随机。HMAC 与 randomUUID 记为真缺口：需要时按规矩
  在 sci 给 sa_std 补原始摘要 + HMAC + 随机字节三件，
  UUID 格式化在 SLA 侧完成；在此之前产物对应站点保留
  显式 UNSUPPORTED，不许用 math_random 拼 UUID 糊弄。

## 8. SQLite 预处理语句

- 声称来源与频次："SQLite" 28 行 / 7 文件；"sqlite" 9 行 /
  4 文件。部分日志称 SQLite 只有 exec 式调用、无预处理。
- 裁决：**已支持**。
- 出处：
  - sa_std/plugin_sqlite.sa：node 插件 SQLite 门面全套 14 个
    符号——open / close / exec / query_json / **prepare /
    bind_int / bind_text / bind_double / bind_blob / bind_null /
    clear_bindings / reset / step_json / finalize**
    （sa_node_plugin_sqlite_*）；plugin_sqlite.sla 为其 SLA
    @import 面（文件头自述 "synchronous Node SQLite facade"）。
  - demos/cxu/03_store_session/main.sla：真实用例（open/exec/
    query_json 建会话表）；该演示只用了 exec 路径，未展示
    prepare，但门面符号俱在。
  - sci/src/emit_c.zig:3047 起把 sqlite3_prepare 列为 C 互操作
    已知符号（FFI 路径亦通）。
- 边界与用法：预处理按 prepare→bind_*→step_json→reset/
  finalize 回绑；结果以 JSON 形式出（step_json），没有原生
  行游标逐列读取面——逐列强类型读取的 TS 代码需经 JSON
  中转，这一点按实际形态记缺陷，不再记「无预处理」。

## 9. 定时器 / 时钟（setTimeout / setInterval 对应物）

- 声称来源与频次："setTimeout" 120 行 / 28 文件；
  "setInterval" 25 行 / 12 文件；"timer" 91 行 / 15 文件。
- 裁决：**部分支持**。
- 出处：
  - sa_std/time.sai：sa_time_instant_ns、unix_s/ms/ns、
    utc_now、**sa_time_sleep_ns / sa_time_sleep_ms**、
    iso_from_unix_ms、parse_iso，以及 JS Date 风格分量读取
    get_full_year/month/date/hours/minutes/seconds；
    另有 time/instant.sa、duration.sa、time.sla。
  - sa_std/async.sla：执行器以 Instant + backoff 重入队实现
    延时调度（sched_backoff_ms），是 SLA 侧「定时回调」的
    既定形态；thread::sleep 在 async/thread 测试语料中常用。
  - 四处出处 grep `set_timeout|setTimeout`（sa_std/tests）：
    无此命名的注册式定时器面。
- 边界与用法：没有事件循环，也就没有 setTimeout/setInterval
  的注册-回调注册表。等价映射：一次性延时 = spawn 线程/async
  任务内 sleep 后执行；周期任务 = async backoff 循环或线程
  循环 + sleep；纯时间读取/计算直接回绑 time.sai。转换时按此
  口径改记，不再记「无定时器」。

## 10. fetch / WebSocket 客户端

- 声称来源与频次："fetch" 277 行 / 32 文件；"WebSocket"
  31 行 / 7 文件。共识曾记 fetch/WS 无 sa_std 对应。
- 裁决：**已支持**。
- 出处：
  - sa_std/http_client.sai：有状态客户端全套——client_new、
    req_new（+joined/v2 变体）、add_header、set_body、
    req_send、**req_send_async + async_poll + take_response**、
    resp_status / get_header / body_slice / 分块 reader；
    同文件还有 sa_http_client_websocket_connect +
    websocket_read/write/free。
  - sa_std/ws_client.sai：独立 WS 客户端面——connect /
    send_text / send_binary / ping / recv（带 opcode）/
    close / status_json；sala 文档专章
    content/06_stdlib/20_ws_client.html。
  - one-shot：`sa_http_fetch_bytes(url, &buf, cap, &out_len)`
    现已在 http_client.sai——注意来源：该导出由并行 sci 工作
    于 2026-10-26 补入（aa4b5e07），批量转换时点确实没有；
    但「无 fetch 对应面」的全称声称在当时也不成立（有状态
    客户端一直在）。据其签名，fetch_bytes 不回响应对象、
    HTTP 状态码不可见，需要状态码/响应头的站点用有状态面。
- 边界与用法：fetch 按有状态客户端回绑（或 fetch_bytes
  简化场景）；WS 按 ws_client.sai 回绑。此类站点此前的
  「无对应面」缺陷条目作废。

## 11. fs 同步便捷面（exists / readFile / writeFile 一步调用）

- 声称来源与频次：跨单元共识第 (3) 条称 Node/Bun fs 同步面
  无 sa_std 对应（未单独做关键词统计；server-rest 等日志
  多处以此为由手写多步组合）。
- 裁决：**已支持**。
- 出处：
  - sa_std/fs.sai 共 128 个 extern，含一步调用：
    `sa_fs_read_file(path, max) -> buffer 句柄`、
    `sa_fs_read_to_string`、`sa_fs_write_file(path, buf, len)`、
    `sa_std_fs_exists` / `sa_std_fs_try_exists`、
    `sa_std_fs_len`、`sa_std_fs_metadata(_json)`、
    `sa_std_fs_canonicalize`、`sa_fs_read_dir_entries`（结构化
    条目 + name/kind/ino 访问器）、base64 读写变体等；
    句柄式精细面（open/read_at/write_at/seek）同文件俱全。
  - sala 文档 content/06_stdlib/06_fs.html（fs 章）。
- 边界与用法：readFileSync/writeFileSync/existsSync/statSync/
  readdirSync 均有一步或两步对应，产物中手写的
  open+read+close 组合应回收为一步调用。真正缺过的只有
  mkdir -p（缺口 3，见第 0 节）与 EEXIST 区分（缺口 4），
  不要再以「fs 面缺失」笼统立项。

## 12. TOML 写入 / 序列化

- 声称来源与频次："TOML" 5 行 / 4 文件（频次低但结构性影响
  大：sdk 的 codexVirtualConfig 簇因此整体占位）。
- 裁决：**确认不支持**（写侧）；读侧已支持。
- 查过的出处与关键词：
  - sa_std/encoding/toml.sai 全 13 个 extern 均为读侧：
    parse / free / last_error / kind / get_string / get_i64 /
    get_f64 / get_bool / get_datetime / array_len / table_len /
    array_get_string / array_get_i64（点路径寻址，句柄模型）。
  - sci/src/runtime 实现导出清单（`pub export fn sa_toml*`）
    与 .sai 逐一对应，无 set / stringify / serialize。
  - 另注意：读侧也无键枚举（有 table_len 计数，无 key_at）——
    需要枚举键的 TS 代码在读侧同样对不齐，一并如实记录。
  - demos/tests 无 TOML 写用例；sala 文档无写侧记载。
- 用法：TOML 写/序列化记为真缺口，按规矩在 sci 补
  （set_* + stringify，照 sa_json 变更面先例）；补齐前
  codexVirtualConfig 簇保持显式占位并注明缺的是写面，
  不许手写拼接 TOML 文本冒充序列化。

## 13. 字符串字面量联合类型

- 声称来源与频次："union" 377 行 / 12 文件。TS 侧
  `type X = "a" | "b"` 在转换中多被压成 u64 标签或裸 string。
- 裁决：**部分支持**。
- 出处：
  - tests/test_unit_enum_match.sla：enum 带结构体式负载变体
    （`Move { x: int, y: int }`）+ match 解构；
    test_unit_enum_discriminants.sla：判别值；
    test_unit_borrowed_enum_field_arg_direct.sla：负载字段传参。
  - sala 文档 content/02_sla_lang/05_structs_enums.html、
    02_types.html（类型章）。
- 边界与用法：判别联合本身是一等支持（enum + match 穷尽
  检查）。缺的是「字符串值即类型」那一层：变体与字符串之间
  没有自动互转（无字符串_repr 派生），JSON/协议边界上需要
  手写 variant ↔ string 映射表。转换口径：内部一律 enum，
  只在序列化边界放映射函数；此前压成裸 string 的站点在
  修复阶段回收为 enum。此前以 u64 标签近似的，若标签与
  变体一一对应，语义等价、可保留但应改记为 enum 待回收。

## 14. try/catch 与错误模型

- 声称来源与频次："try" 718 行 / 38 文件、"catch" 450 行 /
  33 文件（子串计数，"try" 含 entry 等词，显著高估）。
- 裁决：**部分支持**——错误模型完整但形态不同，无 try/catch。
- 出处：
  - sa_std/core/result.sa + tests/test_unit_result_direct.sla：
    `Result<T, E>`、Ok/Err、is_ok/is_err/unwrap/unwrap_or
    全套。
  - sa_std/error.sa、panic.sa：错误与 panic 面；
    extern 面普遍以 i32 状态码 + last_error 风格工作
    （如 sa_toml_last_error、sa_json 状态码）。
  - 反证：sa_plugin_sla/src/lexer.zig、parser.zig 关键词表
    grep `"try"` / `"catch"` 零命中——SLA 无 try/catch 语法，
    无异常展开。
- 边界与用法：TS 中「调用失败走 catch 分支」一律改
  Result/状态码显式分支，语义可等价；「任意深处 throw 被
  外层 catch 兜住」的非局部控制流没有对应物，这类站点必须
  逐个把错误通道显式化（返回值逐层上抛），并在缺陷日志中
  按此口径记，不许用「无 try/catch」笼统带过整个错误处理。

## 15. 生成器 / 迭代器

- 声称来源与频次："iterator" 138 行 / 2 文件；"yield"
  1 行 / 1 文件；"generator" 0 行。
- 裁决：**部分支持**——迭代器协议已支持，生成器语法确认
  不支持。
- 出处：
  - tests/test_unit_generic_for_in_protocol.sla：for..in 的
    协议是 `iter_len(&self)` + `iter_at(&self, index)` 两
    方法（索引式协议，泛型容器实测）。
  - sa_std/iter.sa（@import core/iter.sal + core/iter.sa）：
    迭代器面；for..in 0..n 与协议迭代在语料中普遍。
  - 生成器反证：sa_plugin_sla/src/lexer.zig grep `yield`
    零命中——无 function*/yield 语法。惰性状态机由 async
    （async fn 状态机 codegen，见 async 测试族）覆盖一部分
    场景，但那是异步语义，不是同步生成器。
- 边界与用法：TS 的 Iterable/迭代器按 iter_len/iter_at
  协议回绑；generator 函数改为显式状态结构体 +
  next() 方法（手写状态机），或在语义允许时改 async。
  按此口径改记缺陷，不许把整个迭代面记为不支持。

## 16. JSON 动态对象

- 声称来源与频次：跨单元共识第 (1) 条（动态 JSON /
  Record<string, unknown> 为最高频声称缺口）。
- 裁决：**已支持**（现状确认；此条曾两度被误报）。
- 出处：
  - sa_std/encoding/json.sai 共 64 个 extern：解析/读取全套
    + 枚举 `sa_json_value_count`、`sa_json_object_key_at`
    （按下标取键）+ 变更面 `sa_json_object_set_*` /
    `sa_json_object_remove` / `sa_json_array_push_*`。
  - 沿革（FIX_PHASE1 缺口 1）：枚举面此前即已存在，是转换
    审计漏检；变更面 2026-10-26 补齐（sci 6bc56b29），
    句柄改路径寻址，跨句柄修改可见，sa-std-unit 149/149
    含跨句柄可见性测试。
  - 边界：Windows runtime 的 JsonDocument 未移植变更面
    （已登记 windows_unsupported）；节点构造器
    （new_object 等）尚无，文档树从 parse 产生。
- 用法：Record<string, unknown> 一律落 JSON 句柄 +
  get/set/枚举，不再用「JSON 文本缓冲 + 手工扫描」近似；
  历史缺陷条目中「JSON 不可变/不可枚举」类表述全部作废。

---

## 附：本复核自身的证据弱点

- RegExp 在 SLA tests/demos 无专门用例，裁决依据为 .sai +
  sci 实现 + sala 文档三处；建议后续给 sa_plugin_sla/tests
  补一条 regex 用例把四处出处补满。
- 类/泛型/枚举的 sala 文档引用为章节级（05_structs_enums、
  02_types），未逐页摘录原文；编译器 tests 为一手证据，
  文档为旁证。
- 频次统计为关键词子串计数（上限估计），个别数字
  （Set、try）显著高估，已在各节注明，未用于裁决。
