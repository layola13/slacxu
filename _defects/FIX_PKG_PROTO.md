# FIX_PKG_PROTO — packages 第一单元（pkg-proto-shared）修复账

范围：`packages/codex-protocol`（610 个 .sla）+ `packages/shared`（10 个 .sla），共 620。
工作树：`/content/bulk-pkg`（基点 origin/bulk-convert = 505f22a）。
check 口径：`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，
逐文件 `timeout 30 sa check <relpath>`，串行。

## 基线与终态（名字集合口径）

- 基线：PASS 492 / FAIL 128（79.4%）。失败分布：codex-protocol 118、shared 10（shared 全灭）。
- 终态：**PASS 620 / FAIL 0**。失败名字集合 128 → ∅，无新增失败。
- 基线失败签名簇：76× Import SyntaxError 级联、38× 直解 `found 'type'`、5× Import
  FileNotFound、4× 直解 `found 'object'`、2× Import UnexpectedTypeToken 级联、1× `found '$'`、
  1× Unexpected prefix token: semicolon、1× 其他（mut）。
- 直解失败文件共 46 个，根因全部查明并逐一对应到下列批次；其余为导入级联
  （桶文件 + 兄弟导入者 + dist 转发桩）。

## 桩普查（a/b/c 分类）

方法：逐文件统计函数体形态（真实语句 / 桩标记 / TS 标记集），启发式分类后对
shared 五个源文件逐函数人工复核。

- **(a) 纯类型/声明文件：615**。含全部 610 个 codex-protocol 文件（ts-rs 生成的
  协议类型；纯类型在 SLA 擦除/声明化是正确形态，check 过即合格）+ shared/dist
  5 个转发桩（各 3 行，仅 @import 对应 src）。
- **(a 带真实函数)：2** — shared/src/tokenUsage.sla（6 fn 全真实）、
  shared/src/modelCapabilities.sla（40 fn 全真实，含本阶段新增 buf_append_buf）。
- **(b) 含启发式桩标记：3** — agentEngines（10 fn = 8 真实 + 2 标记）、
  index（31 fn = 30 真实 + 1 标记）、tokenPricing（8 fn = 7 真实 + 1 标记；
  原第 9 个 rate_copy 系虚构宏载体，已删除，见 R7）。
  5 个被标记函数逐个与同目录 .ts 原文核对，**全部为忠实实现、非桩**：
  `agent_engine_catalog_len`/`agent_runtime_bridge_plan_len` 返回 11
  （TS 两数组各 11 条、物化器 idx 0..10 全覆盖）、`permission_presets_len`
  返回 4（与 TS 及 permission_preset_at 物化器一致）、
  `default_token_usage_rates_len` 返回 3（TS 3 条、物化器 idx 0..2）；
  启发式误报 3 例（parseAgentRuntimeOverride / priceNormalizedTokenUsage /
  agentFailureMessage 仅因 DEFECT 注释含 "approximat" 被标记，函数体完整真实）。
- **(c) 函数体逐字 TS：0**。但 index.sla 顶层有 **7 个逐字 TS 常量表区块**
  （permissionPresets、ALL_SA_VM_BUN_PROFILES、SA_VM_BUN_PROFILE_GROUPS、
  ALL_SA_VM_BUN_SUBCOMMANDS、ALL_SA_VM_BUN_FILTER_SCRIPTS、
  SA_VM_BUN_DENIED_SUBCOMMANDS、ENHANCE_TOOLS_KEYS）——转换器只注释了首行，
  表体是活代码（基线 ExpectedDeclaration/ExternBlockRequiresExtern 之源）。
  处置：整体转为注释保留（数据在文件内另有物化器/枚举注释/展开式消费者：
  permission_preset_at、SaVmBunProfile 的 "one of" 枚举注释、
  hasEnhanceToolsEnabled 等按字段展开），与转换器自注的
  「value preserved verbatim; accessor functions are hand-written」口径一致。

## 修复批次账

- **R1 保留字标识符重命名**（代码段限定，注释/字符串字节不变）：42 文件。
  `type:` → `type_:` 150 处 / 39 文件（字段/参数/字面量位；另含 `.type` 访问位
  规则，实测 0 命中）；`async:` → `async_:` 1 处（ConfiguredHookHandler）；
  agentEngines 参数 `mut` → `mut_` 2 处（声明+使用）；`$schema` → `schema` 2 处
  （McpElicitationSchema）。依据：lexer.zig checkKeyword 保留字表 + FIX_PHASE1
  先例（后缀下划线，如 match_）。原名根本不通过词法，属不可避免的接口改名，
  映射表见下。
- **R2 导入路径修正**：`sa_std/json.sai` → `sa_std/encoding/json.sai` 2 文件
  （tokenUsage、modelCapabilities；实测磁盘上 json.sai 只在 encoding/ 下）。
  级联消除 tokenPricing FileNotFound + 3 个 dist 桩。
- **R3 循环块尾分号删除**：token 分类扫描器（for/while 块 `}` 后 `;` 删除，
  if/字面量不受影响），modelCapabilities 4 处 + index 2 处，共 6。依据
  FIX_PHASE1 语言事实（while/for 块后不得跟 `;`，if 块可跟）。
- **R5 shared 宏导入补齐**：agentEngines/tokenPricing/tokenUsage 补
  `sa_std/string.sa`（STR_PTR/STR_LEN）+ `sa_std/ptr.sa`（PTR_NULL）；
  modelCapabilities 补 ptr.sa。.sla 导入不传递导出（FIX_PHASE1 缺口 3 同因）。
- **R5b 解引用-转型优先级**：`*out as i64` → `(*out) as i64` 2 处
  （tokenUsage finite、modelCapabilities）——原写法被解析为对指针转型，
  触发「only numeric primitive casts」。
- **R6 index 常量表注释化**（见上 (c)）+ **str_eq 改名**：tokenPricing 本地
  `str_eq`（4 参）与检查器内建同名冲突（InvalidArgsCount，FIX_PHASE1 已知坑）
  → `price_str_eq`（定义+2 调用）。
- **R7 类型化切片表示修复**（虚构宏 PTR_ELEM_ADD/STRUCT_LOAD 的正解）：
  四出处核查——sa_std（.sai/.sa 宏清单）、SLA demos、SLA tests 语料均无
  「经无类型 ptr 装载结构体」能力，无 sizeof、无结构体 memcpy 面；
  转换日志本身即标注 "typed-slice access assumed"。按本域自有约定
  （列表结构体：StrList/AgentRoleList）改表示：
  tokenPricing 新增 `TokenUsageRateList { items: [TokenUsageRate; 64], len }`，
  find_rate/resolveTokenUsageRate/priceNormalizedTokenUsage 改收列表引用，
  元素拷贝走既有 rate_assign，删除 rate_copy；
  index 的 AgentRuntimeOverride 以嵌入 `roles: AgentRoleList` 取代
  roles_ptr/roles_len（注：原 roles_ptr 除初始化 NULL 外从未被赋值，
  消费者实际读空——本次修复同时补上该数据链：parseAgentRuntimeOverride
  末尾把 roles_out 镜像进 out.roles），role_at 改为类型化索引，
  agentRosterUsageHint 改收 &AgentRoleList。
  modelCapabilities 另修：`&base.bytes[0]` 作实参触发 capability 不匹配，
  且 `let p: ptr = &arr[i]` 为 borrow/primitive 标签冲突——新增
  `buf_append_buf(&StrBuf, &StrBuf)` 逐字节拷贝替代该调用点。
- **R8/R9/R10/R11 sa_json 虚构名回绑**（均以 sci `sa_std/encoding/json.sai`
  与 `src/runtime/sa_std.zig` 实测为准）：
  `sa_json_is_object(v)` → `sa_json_kind(v) != 7`（OBJECT=7，sa_std.zig:633；
  tokenUsage、index 各 1 处）；字符串判定 → `sa_json_kind(v) == 5`
  （STRING=5）配合值形 `sa_json_string_len(v)`（原假设的状态码+出参形
  不存在；modelCapabilities 2 处、index 3 处）；
  `sa_json_array_len` → `sa_json_value_count`（4 处）；
  tokenPricing 对 stripModelContextVariant 的 6 参调用改指转换器自备的
  (ptr,len) 适配器 `stripModelContextVariant2`（modelCapabilities:381）；
  index 补 `sa_std/encoding/json.sai` 导入；
  `sa_json_string_ptr`/`sa_json_buffer_data`（返回 &ptr）直传普通 ptr 形参
  3 处改为带类型局部变量转手（FIX_PHASE1 既定式）；`let sp =` 推断为 &ptr
  致 str_trim TypeMismatch 2 处改为显式 `ptr` 标注。
- **R12 四个交集/联合占位文件建模**（`part0: {object}` / `part1: union`，
  系转换器占位、无 SLA 对应物）：
  LocalShellAction → Part0 { type_: "exec" } + LocalShellExecAction；
  DynamicToolNamespaceTool → Part0 { type_: "function" } + DynamicToolFunctionSpec；
  McpServerElicitationRequestParams → 
...[truncated 3299 chars]