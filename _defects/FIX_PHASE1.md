# 修复阶段 1 记录

## 缺口 1：sa_json 键枚举 + 对象/数组变更面（2026-10-26 关闭）

仓：sci（Colab /content/sa_all/sci）。提交：源码+声明经检查点 cron 以
a43c6b14 落盘推送；重建的 libsa_std.a 与说明提交 6bc56b29（origin/main 已核对）。

### 事实修正
键枚举并非从零：`sa_json_value_count`（对象/数组计数）与
`sa_json_object_key_at`（按下标取键，出参 ptr/len）此前已在 Zig 实现、
json.sai 与 sa_std.h 三方齐备，只是批量转换的缺陷审计没有察觉。
对象顺序语义：std.json 的 ObjectMap 为 StringArrayHashMap，枚举序 =
插入序；覆盖已有键不改位置；remove 用 orderedRemove 保持其余键顺序。

### 新增导出（13）
- sa_json_object_set_string / set_i64 / set_f64 / set_bool / set_null /
  set_node（child 节点）
- sa_json_object_remove（缺键报 NOT_FOUND 状态）
- sa_json_array_push_string / push_i64 / push_f64 / push_bool /
  push_null / push_node
约定与既有面一致：u64 句柄、constBytes 键/值入参、i32 状态经
finish/finishErr；空键拒绝（同 get 系）；f64 非有限值拒绝（同 as_f64 读策略）。

### 表示层改造（关键）
原 JsonNodeHandle 在注册表里存 std.json.Value 的按值副本——若只在副本上
变更，祖先手柄 stringify 会读到旧树（静默陈旧，正是本项目明令禁止的兜底）。
改为路径寻址：手柄存「文档 + 自根路径（键/下标段）」，每次 acquire 按
路径对活树重解析；变更操作在注册表锁内解析到树内 *Value 原地修改
（ObjectMap 原地 put / Managed 数组 append，新键与字符串值复制入文档
arena）。set_node/push_node 先深拷贝（jsonValueClone）入目标文档 arena，
不别名源文档。语义边界：删除某键（或其祖先）会使指向它的既有手柄失效
（后续操作报 InvalidHandle、kind 报 INVALID），不再是旧快照语义。

### 验证
- sa-std-unit：149/149（基线 146 + 新增 3 测：object set/get/枚举序/
  remove 回读、array push 顺序与 stringify 精确匹配、跨手柄可见性 +
  set_node 深拷贝隔离 + 删键手柄失效）；构建步与直接跑二进制双路。
- sa-std-runtime：15/15（直接跑二进制核对）。
- runtime-abi-check --platform both：PASS（header 597→610，
  windows_unsupported 29→42，windows 618 不变）。
- nm zig-out/lib/libsa_std.a：13 个新符号均为 T 导出。

### 遗留
- Windows runtime（sa_std_windows.zig，自有 JsonDocument 实现）未移植
  变更面——已按仓库惯例登记 docs/runtime_abi_windows_unsupported.txt，
  后续 Windows 移植时成套补齐并从名单移除。
- emit_js/emit_c 的 sa_json 已知符号名单（emit_js.zig ~3126 起）未含
  新符号：js/c/wasm 后端暂不能调用变更面，阶段 2（wasm 前端）开工前补。
- 未做：节点构造器（new_object/new_array 等）——当前 set/push 的节点
  来源为 parse/get；若转换回绑时需要从空构建文档树，再按需增补。
- 构造新文档的既有路径仍是 sa_json_writer_*（产字符串缓冲，非节点）。

## sdk-backend 编译打通（阶段 1 第二步，进行中）

工作地点：Colab 盒 `/content/bulk`（slacxu 的 bulk-convert 工作树，未动
slacxu main 手写区）。环境：sci 6bc56b29、sa_plugin_sla b228d0d2；
`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，
逐文件 `sa check`（先行确认 libsa_std.a 已含新 sa_json 13 符号、插件已装）。

### 已推送提交（bulk-convert）
- `149b36f` fix(sdk-backend): phase1 batch1-2（顶层 let→const、补 sa_std
  导入、while/for 尾分号、后缀字面量、if 表达式改写）。
- `b4af4ab` chore: 移除误提交的 .sla-cache 并加入 .gitignore
  （当前 HEAD，ls-remote 已核对；注意 `sa check` 会在 src 下生 .sla-cache）。

### 基线与进度
- 基线（5b76b75）：sa check 通过 4/26（remoteThreadRoute、runtimeClient、
  server、service）。
- 批次 1–2 + 自动补 import 循环后：全量复检通过 11/26，其后 cliSpawn、
  saVmPaths 再单独修通（待复跑确认合计 13）。
- 批次 3 已在盒上应用但**未提交**（盒子失联，见文末）：&标量出参写穿
  `*out = v`、超 i64 字面量组合式、sha256/toml/time/fs 回绑真实 std 面、
  codexVirtualConfig 删自造 @extern 块、dataDir rename 回绑、
  read_dir_json 补 max_entries、arena 类型标注、hex 指针惯用法。
  其中 deref 重写器有行首缩进漏改 bug，修正版已备，恢复后先重跑再复检。

### 主要错误类别分布（基线 22 个失败的首错）
- 顶层 `let` 全局（SLA 只认 `const`）15 文件：不可变者改 const；可变者见缺口 2。
- Undefined call（缺 @import 真实 .sai/.sa）多文件逐层下移：自动循环 + 人工回绑。
- while/for 块尾多余 `;` 约 30 处：括号追踪扫描器清除（探针证实 for 同罪、`&&` 无罪）。
- 后缀字面量 `0u8`×233 / `0u64`×10 / `0f64`×1：剥后缀 / 0.0。
- if 表达式作赋值右值 32 处（saVmWorkspaceSkill）：改写为语句形 if/else。
- 自造 extern 名/签名（sa_sha256_hex 等）3 文件：按真实签名回绑
  （sa_std_net_sha256_hex@net.sai；sa_toml_table_len 状态码+&out_len 形）。
- 本地 `@extern` 声明块 2 文件：整块删除（见事实清单），改 import + 组合 helper
  （sa_now_ms/sa_sleep_ms/sa_fs_close_quiet/sa_fs_stat_mtime_ms 已用
  time.sai/fs.sai 现有面组合实现，非占位）。
- &标量出参裸赋值（borrow tag 不符）：改写穿。
- 超 i64::MAX 整数字面量 7 处（splitmix 常量）：组合式等值转写，见缺口 5。

### 探针实测的 SLA/SA 事实（修复依据）
- 顶层只有 `const NAME[: type] = value;`；字符串 const 可无标注推断。
- while/for 块后不得跟 `;`（if 块可跟）。
- **SLA 源码没有 `@extern` 语法**（带/不带 `;` 均 SyntaxError@声明处）；
  extern 只能经 @import 的 .sai 引入。
- 未定义结构体作字面量 → parse 层 error.SyntaxError（结构体须先可见）。
- 整数字面上限 = i64::MAX（值而非位数）；`as` 转换、弃返回值语句、
  类型标注数组、`*out = v` 写穿、&Struct 字段直赋均可用。

### 缺口 2：SLA 无顶层可变全局声明【高】
- 复现：hostServices.sla:97 `let current: PluginHostServices;`（单例，
  current_set 于 :105 再赋值）；openCodeSessionProtocol.sla:226-231,302
  （模块缓存 StrBuf 对 + createdAt + uuid_counter）。
- 探针：顶层 `let`、`static` 均 error.ExpectedDeclaration。
- 下游阻塞：hostServices 本体、index.sla（聚合导入）、saVmWorkspaceSkill
  （PluginHostServices 字面量因导入失败 SyntaxError）。
- 需要：顶层可变全局（零初始化 + 读写语义）或官方 global-cell 机制。
- **裁决（用户 2026-10-26 08:33）：走 Rust 式 cell，否决顶层 `let mut`。**
  SLA 顶层保持只许不可变；sa_std 提供官方具名 global cell：注册表按名字
  索引、内部带锁，含 u64 与 bytes 两型、set_once（写一次）与原子 add
  语义；产物把模块状态回绑为 cell get/set。依据：Rust 的 static mut
  已被封存（2024 起取引用报错）、正道是 OnceLock/Mutex 式内部可变；
  且 SLA 无 unsafe 标记（语料+探针已核），cell 路线零新语法。

### 缺口 3：sa_std fs 缺 mkdir -p（递归建目录）【高】
- 复现：bridgeEventLog.sla 的 `sa_fs_mkdir_p` 调用（无声明、std 无导出）；
  codexVirtualConfig.sla `sa_fs_mkdir_p2`；saVmWorkspaceSkill.sla `sa_fs_mkdir_p_ws`。
- std 只有单层 sa_fs_make_dir/sa_fs_create_dir（fs.sai:110-113）；
  对照 remove 侧有 sa_fs_remove_dir_all。TS 语义 mkdirSync(recursive)。
- 按纪律未在产物写分段循环，留作复现。

### 缺口 4：fs open 的 EEXIST 不可区分（open_create_excl 错误面）【中】
- 复现：codexVirtualConfig.sla:882 锁协议 `sa_fs_open_create_excl`，
  依赖「已存在」可区分（转换器假设 status 17）。
- 实查 sci：sa_std_fs_open_options 可经 custom_flags 传 POSIX O_EXCL(128)
  实现原子建，但 sa_std.zig 的 mapError 未单列 error.PathAlreadyExists
  （落入通用码），SA_STD_ERR_* 无 EXISTS 码 → 锁竞争语义无法忠实回绑。
- 需要：mapError 给 PathAlreadyExists 独立状态码，或新增 open_create_excl 导出。

### 缺口 5：SLA 词法器整数文字上限 i64::MAX【低】
- 复现：imagePersistence.sla:569/571/572、openCodeSessionProtocol.sla:212/
  214/215/306（11400714819323198485 等，十进制/十六进制均 InvalidCharacter）。
- 产物已组合式等值转写；语言层支持 u64 字面量后可消除。

### 状态注记（2026-10-26 ~18:0x CST，盒子失联）
- Colab（875391f43139）SSH 失联：TCP 可达但握手被网关重置
  （kex_exchange_identification / 198.19.0.1:3128），多次间隔重试未恢复；
  失联前曾出现一次 host key 变化（同 hostname 重连成功过一次，随后再断）。
- 已推送安全点 = b4af4ab。批次 3 只在盒上工作树：若运行时已死，恢复后
  开新 /content/bulk 工作树并按本节清单重跑批次 3（含 deref 修正版），
  然后全量复检 → 审计 diff → 提交推送；若 26 文件仅剩缺口 2/3/4 阻塞，
  转 sdk-frontend（6+2 文件）同法打通。

## 批次 3 重跑（2026-10-26，盒子换运行时后）

工作树：新运行时（986a7d79e415）上 `git worktree add /content/bulk
origin/bulk-convert`，基点 644e0aa（fetch 已核）。旧运行时上的批次 3
随盒消亡，本节为按清单重跑的结果。

### 已落地（均双确认：脚本断言计数 + grep 复查）
- 写穿：&标量出参裸赋值 41 处（8 文件）改 `*out = v`；审计器逐站点
  列单核对，无 shadow 假阳性。
- 读解引用：&标量参的裸值读 29 行改 `*name`（借用转发站点经逐条审
  查排除：flush_key 转发、cliSpawn spawn 转发、pol_bool 转发、
  vcClient_getStatus 转发共 9 处保持裸名）；自增形 `*p = *p + 1`
  非法（解引用读在算术式中仍带 borrow 标签），8 处拆为
  `let p_v = *p; *p = p_v + 1;`；for 范围上界 1 处改 `0..*p`。
  探针定论：`*p` 可作索引与比较操作数，不可作算术操作数。
- 超 i64 字面量：恰 7 处（imagePersistence 3 + openCode 4），
  ((hi<<32)|lo) 等值转写，脚本内数值等价断言。
- 回绑真实面：sha256 → sa_std_net_sha256_hex（3 调用点）；toml
  table_len 改状态码+&out_len 形；sa_json_get_bool → sa_json_as_bool
  （4 处）、sa_json_array_len → sa_json_value_count（3 处）；
  sa_json_string_ptr/len 改直接返回形（5 站点）；rename →
  sa_fs_rename（3 处）；remove_dir_recursive → sa_fs_remove_dir_all
  （3 处）；read_dir_json 补 max_entries=65536（2 处）。
- 删 @extern 块：codexVirtualConfig（10 声明）+ saVmWorkspaceSkill
  （2 声明）。CVC 四个 lock helper（sa_now_ms / sa_sleep_ms /
  sa_fs_close_quiet / sa_fs_stat_mtime_ms）由 time.sai / fs.sai 真实
  面本地组合实现，非占位。
- hex/数组指针惯用法：&本地数组/字段直传 ptr 形参是 capability
  参数，共 5 处改 PTR_BYTE_ADD 物化（MFP hex、CVC hex、CVC single、
  CVC setAtPath vj、THP options.cursor）。
- arena 标注：THP turn_ids_len 改 &[u8; 65536]；CVC store_writeValue
  的 edits 改 [ConfigEdit; 32] 就地填充；CSI SkillError.message 统一
  4096；RC 新增 copy_str512 承接 component 字段。
- imports 补齐：CVC +string.sa（STR_PTR/STR_LEN 宏定义在此，非
  ptr.sa）/toml/net/time/env/fs/json；IP +json/fs/string；RC/CSI
  +json。RC 的 str_eq_lower 改本地复制（import memoryFilePaths.sla
  与 dataDir 的 PathBuf 重声明冲突）。

### 结果：19/26 通过（基线批次 1-2 后 11 已验 → 批次 3 后 19）
失败 7（名字集合）：bridgeEventLog、codexVirtualConfig、
hostServices、imagePersistence、index、openCodeSessionProtocol、
saVmWorkspaceSkill。分类：
- 缺口 2（顶层可变全局，用户已裁决走 cell、产物回绑待 cell 批次）：
  hostServices（let current:97）、openCodeSessionProtocol
  （let cachedOpenCodeProjectId:227 等）、index（导入级联）、
  saVmWorkspaceSkill（PluginHostServices 字面量经 hostServices 级联；
  其自身另有缺口 3 的 mkdir_p_ws 调用在后）。
- 缺口 3（mkdir -p）：bridgeEventLog（sa_fs_mkdir_p:206，其余调用
  已全部回绑真实面，此为唯一阻塞）、imagePersistence
  （sa_fs_mkdir_p:308）。
- codexVirtualConfig 首错为「其他」：vcClient_* 转发调用的
  codeCliBridgeClient_* 自由函数全树不存在，inner 字段类型
  CodeCliBridgeClient 亦无定义；runtimeClient 的 CodexRuntimeClient
  是 fn-ptr 表，而 SLA 不支持经 ptr 字段调用（探针：Undefined
  call）——派发面属语言/结构缺口。其后还排队缺口 3
  （sa_fs_mkdir_p2）与缺口 4（sa_fs_open_create_excl）。
- imagePersistence 另有两个「其他」阻塞：sa_base64_decode（lib 有
  sa_b64dec_simd 实现但无 .sai 声明，402）、sa_http_fetch_bytes
  （无 one-shot fetch 面；http_client.sai 是有状态 client API，
  组合实现非机械回绑，450）。

## 方法论修正：async 压平误判（2026-10-26，用户指出）

- 事实：SLA 原生支持 async/await——编译器测试族 test_unit_async_await /
  test_unit_async_block_on_direct / test_unit_async_defer_ready_*
  （async fn、.await、block_on、状态机 codegen）；sa_std 有 async.sla
  （多线程执行器 + future<T> 可跨函数/线程）与 future.sa。转换简报的
  「async→同步+状态码」规则系误判（且与简报自身列出的 async 面自相
  矛盾），已撤销改写。
- 影响面：`// DEFECT: async` 共 1181 处 / 185 文件（apps 100、backends 54、
  mini-codex 12、packages 11、sdk-backend 6、frontends 2；其中 apps/server
  单域 44 文件）。一部分是语义桩：如 backends/mini/src/runtime/
  agentsMdInventory.sla:47 findAgentsMdProjectRoot——向上逐级找 .git 的
  循环被整体丢弃、直接返回 cwd：能编译、行为错误，属明令禁止的静默降级。
- 处置：① 简报规则已改；② 专项审计产出 ASYNC_MODEL.md（映射规则 +
  探针实证）与 ASYNC_AUDIT.md（逐文件分类：签名压平 / 语义桩）；
  ③ sdk-backend 6 文件（runtimeClient、service、server、hostServices、
  imagePersistence、saVmWorkspaceSkill）随缺口回绑一并重译——其中
  runtimeClient/service/server 此前记为「通过」，async 审计过关前其
  通过状态带星号；④ 其余域按 server→backends→packages→mini-codex
  顺序在各自修复轮次处理。
