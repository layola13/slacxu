# FIX_SAVMTOOL — apps/server/src/saVmTool.sla 整文件重译规格与台账

单元: server-rest 收尾。基线 bulk-convert 505f22a。源: apps/server/src/saVmTool.ts
(12,040 行) → saVmTool.sla (11,483 行)。批量转换对此文件只做了签名层: 147 个顶层
fn, 函数体逐字 TS (TS-only 标记 2,151 代码行 / 430 区, 全文 SLA 成语计数 0),
66 处 `// DEFECT: async` (全仓最多)。本文件是重译规格 + 台账, pkg-cxu 阶段处理
packages/cxu/src/vendor/saVmTool.ts 拷贝时直接复用本文模型与映射表。

口径: sa check = `SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
SA_STD_DIR=/content/sa_all/sci/sa_std`, `timeout 60 sa check <file>`, 串行。
判定「不支持」先查四出处 (sala/content、sa_plugin_sla demos、sa_plugin_sla
tests、sci sa_std 清单), 结论以 CAPABILITY_MAP.md / ASYNC_MODEL.md 为准绳。

## 1. 共存性探针 (本单元新测, 补普查)

在 /tmp/probe_tool 以空 main 文件逐个/组合 @import 候选提供方, 结果:

| 组合 | 结果 |
|---|---|
| saVmTypes 单独 | PASS |
| types + TreeSitter + Policy | PASS |
| types + CodeGraph | FAIL Redeclaration: struct SaVmRunResult |
| Tool 本地 `struct StrBuf` + import TreeSitter | FAIL Redeclaration (同形亦拒, 按名判) |
| saVmJev 单独 | FAIL 展开 error.UnexpectedTypeToken |
| shared/index 单独 | FAIL 展开 error.SyntaxError |
| regressionRunner / Ledger / Request / ApplyPatch / SplitWorkflow / memoryFilePaths / CodeGraph / ResultKind 单独 | PASS |

jev 二分定位 (按顶层声明切分导入测展开): 61 个声明展开失败, 主因是 struct
字段类型位写了填充形 `[0u8; N]` (类型位须 `[u8; N]`) — 与 F1 批 A–E 在
CG/TS 修过的同一病 (帧感知分类器 fixfill), jev 属 backends 域尚未进修复期;
另 2 处 error.ExpectedDeclaration (:748/:755)。shared/index 同为未修复批量态。

传递性探针 (mid 文件 import CG, top 只 import mid 再声明同名 struct):
FAIL Redeclaration — 导入展开是传递闭包, 网关文件隔离无效。

三份同名线型全部异形 (按名判重, 无共存可能):
- SaVmRunInput: types {json[262144], json_len, node} vs jev {json_bytes,
  question_bytes, options_*, criteria_*, checks_*, context_* ...}
- SaVmRunResult: types (全量: session/pid/status/message/commit 等) vs CG
  (缩减: stdout[65536], stderr[8192], events_json[8192], violation_reason[1024])
  vs jev (kind_bytes[64], stdout_bytes[262144], violation flags+reason)
- SaVmPolicyConfig: CG {handle: u64, has_value: bool} vs jev {json_bytes[65536],
  json_len} vs shared (全量配置记录)

全仓当前无任何文件 import saVmCodeGraph.sla / saVmJev.sla (grep 实测),
Tool 是首个消费者 — 改名不影响既有调用方。

## 2. 接线裁决 (Path Y)

Tool 侧 canonical 线型取 sdk 的 saVmTypes (runSaVmTool 的 TS 契约即该文件)。
提供方冲突在「未通过/无消费者」一侧改名, 已通文件只做声明去重级改动:

| 文件 | 处置 | 校验 |
|---|---|---|
| backends/jev/src/jev/saVmJev.sla (未通过, backends 待修) | (a) 类型位 `[0u8;`→`[u8;` 机械修复 (填充位不动); (b) 自有线型改名 SaVmRunInput→JevRunInput、SaVmPolicyConfig→JevPolicyConfig、SaVmRunResult→JevRunResult (含文件内全部引用) | 改后独立 sa check: 展开须过; 本体类型错属 backends 域不阻塞导入方 (FIX_PHASE1 §9 到达性) |
| apps/server/src/saVmCodeGraph.sla (已通, res 单元) | 线型改名 SaVmRunResult→CgRunResult、SaVmPolicyConfig→CgPolicyConfig (含文件内全部引用与 nativeCodeGraph 签名) | 改后独立 sa check 须仍 PASS; diff 审计只许标识符改名行 |
| saVmPolicy.sla / saVmTypes.sla / TreeSitter / Request / ApplyPatch / Split / Regression / Ledger / memoryFilePaths | 不动 | — |
| shared/index.sla | 不 import (未修复批量态); bun 型与常量表在 Tool 内本地映射声明 (数据以 packages/shared TS 源为准) | — |

Tool 最终导入集: sa_std {print.sai, fs.sai, string.sa, ptr.sa, encoding/
json.sai, text/regex.sai, time.sai, env.sai, process 面, http_client.sai,
globals.sai 等按簇补}, saVmTypes, memoryFilePaths (+dataDir 闭包),
saVmPolicy, saVmTreeSitter, saVmCodeGraph, saVmJev, saVmRequest,
saVmApplyPatch, saVmSplitWorkflow, regressionRunner, saVmAccountabilityLedger。

Tool 本地声明: JsonBuf (保留), ByteList (本地 StrList 改名 — Policy 的 StrList
是 [StrItem;128] 记录表, 异形真冲突, 普查既定), F64List, ListBuf, RegexHandle
(保留); PolicyCfg { handle: u64, has_value: bool } (原始策略配置 = JSON doc
句柄+在位旗, 与 CG 的 CgPolicyConfig 同构); BunProfile (shared SaVmBunProfile
同形本地映射) + bun 配置表本地常量 (见 §5)。
Tool 丢弃本地 `struct StrBuf`, 改用 TreeSitter 的 StrBuf + sb_* 助手
(CG 同例)。SaVmRunInput/SaVmRunResult/SaVmInputError/
SaVmCapabilityDeniedError/SaVmFsCapability/SaVmNetCapability 一律用 types 的,
不本地再声明。

适配器 (Tool 侧, cg* 先例): nativeCodeGraph 出参 CgRunResult →
字段拷贝转 SaVmRunResult (ok/kind/exitCode/stdout/stderr/events_json→
saVmEvents_json/violation_reason→saVmViolation_json 包 {"reason":...}/
durationMs); 入参 CgPolicyConfig{handle=策略 doc 句柄, has_value}。
jev 17 入口形如 nativeJevX(state, &JevRunInput, &JevPolicyConfig, cwd_ptr/len,
startedAt, &JevRunResult): Tool 侧适配器 toolJevXxx 由 SaVmRunInput 的 JSON
构造 JevRunInput (json_bytes 直拷; question/options/criteria/checks/context
由 jev 侧构造器/字段提取 — 按 jev 文件内既有构造路径接线), JevModuleState 由
Tool 以全局 cell 持有单例 (jev_module_state_init 初始化), 结果 JevRunResult
→ SaVmRunResult 同 CG 法转换。

## 3. 动态对象统一模型 (JsonBuf 模型, sdk 阶段已验)

- SaVmRunInput 的动态字段访问: 对 `node` (sa_json doc 句柄) 用
  sa_json_object_get_*/kind/has 路径寻址; 缺失 → has=false 支路。
- `{...input, k: v}` 展开改输入: 解析 input.json 为 doc → sa_json_object_set_*
  → stringify 回新 SaVmRunInput (json 字节更新、node 重解析)。SaVmRunInput 是
  256KB 值结构, 拷贝语义与全仓大值结构惯例一致。
- 其余动态记录 (options/tasks/config 等) 一律 JsonBuf (JSON 文本) 承载:
  构造 = 解析 "{}" 空 doc 后 object_set_* 再 stringify; 读取 = parse 后路径
  寻址; 枚举 = sa_json_value_count + sa_json_object_key_at (JSON 对象面已支持,
  CAPABILITY_MAP §JSON)。禁止虚构 node 构造器 (不存在 new_object 面)。
- `?.` / `??` → has 旗 + if 支路; 三元 → if/else 语句 (分支尾须 unit, 尾调用
  先绑变量); `typeof x === "string"` → sa_json kind 判别 (JsonBuf 值) 或静态
  类型 (StrBuf 值); `===`/`!==` 对字符串 → STR_CMP/字节比较。
- try/catch → 状态码支路 (sa_json/fs/process 状态码 + i32 约定); 异常类型:
  throw new SaVmInputError(msg) → 构造 kind="sa_error" 结果 (runSaVmTool 顶层
  捕获语义, 以 TS catch 块为准逐处核对); SaVmCapabilityDeniedError →
  kind="capability_denied", exitCode=228; 其余 throw → 错误结果/状态码上抛,
  禁静默吞。无 try/catch 语法 (CAPABILITY_MAP 已裁)。
- 模板字符串 → sb_append 链 / string.sa 拼接; String(x)/Number(x) 等强制
  转换 → 对应 parse/format 助手 (本地助手层 §6)。

## 4. async 模型 (ASYNC_MODEL 落点)

本文件 66 处 async 标记。逐簇按 ASYNC_MODEL 规则裁:
- 被 await 的 Node 异步 API (fs/process/http) 在 sa_std 均为阻塞 extern →
  R8: 函数体 1:1 阻塞直调, 控制流不变。契约面 (saVmTypes) 无 future 型字段,
  故本文件 fn 不引入 future<T>: TS `async fn -> Promise<T>` 落为同步
  `fn -> T` (T 为值或经 &out 写出), 与已转换签名层一致。此裁与 sdk 域
  hostServices 的 future 还原不冲突 (彼处契约本身含 fn 表 future 字段)。
- Promise.all → 顺序循环 (结果按索引槽保序); 并发语义差登记: runParallel
  的 worker 池与 grepAsync 的 AsyncSemaphore 并发扫描在 SLA 落为顺序执行 —
  结果集合/顺序等价, 仅并发度不同 (R5 顺序化注记, 非静默: 本台账登记 +
  代码注释)。真并发 (thread::spawn + Arc<Mutex>) 在本文件无必要: 任务间
  无共享可变状态外的交互, 保序要求使顺序执行成为忠实落点。
- setTimeout/定时器: CAPABILITY_MAP 裁为无注册面; TS 中的超时 (spawn 的
  timeoutMs、poll 间隔) 落为 sa_std process/time 的阻塞等待 + 截止检查
  (探针先行: 以 std 既有面为准, 逐处登记)。

## 5. Set/Map/RegExp/其余构造映射表

| TS 构造 | SLA 落点 |
|---|---|
| Set<string> (路径/名集合) | ByteList 打包表 (§6 打包协议) + list_contains 去重 |
| Map<string, string/number> | sa_json doc 对象 (键序不敏感处) 或 HashMap (hashmap.sa, 具体型处) — 逐处登记 |
| Map<string, Promise>/在途去重 | 本文件如有: 全局 cell + 显式状态 (R11), 禁压平为恒 ok |
| 数组字面量/展开 | 定长数组结构 (各 List 型) 或 JsonBuf JSON 数组 (动态处) |
| new RegExp(p, flags) | sa_regex_* (text/regex.sai, POSIX ERE 子集): \d\w\s → [[:digit:]]/[[:alpha:]_]/[[:space:]] 等类翻译属子集内机械映射; i 旗 → RE_ICASE; g 旗 → 循环 match 推进; 超子集 (lookahead/lookbehind/惰性量词/替换回调/matchAll/split-by-regex) 逐处登记: 能以手写扫描忠实实现者手写, 否则入阻塞登记 (见 §8) |
| gitignore glob | gitignoreGlobToRegex 产 RegexHandle{pattern,flags}: 保留模式文本, 使用点经 re 助手 compile (ERE 翻译在 glob→regex 阶段按 TS 语义产出等价 ERE) |
| 类 (AsyncSemaphore 等) | struct + 自由 fn (CAPABILITY_MAP: 无 extends 需求处) |
| EventEmitter | 四出处确认不支持; 本文件如有出现逐处登记阻塞 (§8) |
| crypto.randomUUID / HMAC | std 缺 (CAPABILITY_MAP); 本文件如有出现逐处登记, 禁以 sa_math_random 冒充 |
| NodeJS.ProcessEnv | JsonBuf JSON 对象 (env 映射); spawn 边界按 sa_std process 面 env 形参转换; minimalRunnerEnv 以 sa_env 枚举/读取构造 |
| Date.now() | sa_time_now_ms (time.sai) |
| JSON.parse/stringify | sa_json_parse / sa_json_stringify (doc 句柄) |

## 6. 本地助手层 (文件头, 先建先验)

- StrBuf/JsonBuf 通用: sb_clear/sb_append (TreeSitter 已供 StrBuf 版; JsonBuf
  同形本地版 jb_*), STR_PTR/STR_LEN (string.sa), 字节相等/前缀/包含, 数字
  parse/format (i64/u64/f64), 路径助手 (join/normalize/dirname/basename/
  extname — 对齐 TS path.posix/win32 语义, 本文件以 path.* 调用点为准)。
- ByteList 打包协议: 条目以 '\n' 分隔拼入 items 字节区, len=总字节数;
  list_push (去重可选)/list_count/list_at(idx, &StrBuf)/list_contains。
- sa_json 类型化 getter 集: jget_str/jget_i64/jget_f64/jget_bool/jget_arr_len/
  jget_at — 封装 kind 判别+缺失缺省, 供 430 区高频调用。
- re 助手: re_search(hay, pat, flags, &firstMatchSpan), re_test,
  re_replace_all (字面替换形), re_split (简单分隔形) — 基于 sa_regex_compile/
  regexec, 编译失败 → 状态码 (TS 中 new RegExp 抛错路径对应)。
- 结果构造器: result_ok/result_error(kind, msg)/result_from_stdout 等
  SaVmRunResult 填充助手 (与 types 结构对齐, 全零字面量构造 — 大 struct
  零值按 CG 的 2473 字节零字面量先例由脚本生成)。

## 7. 签名层修正 (批量签名中的非法形, 译时逐个重定义)

- `SaVmRunInput & Record<string, unknown>` (expandSaVmActionInput) →
  入参 &SaVmRunInput + 出参 &SaVmRunInput (展开产物为新值)。
- `NodeJS.ProcessEnv` → JsonBuf (env JSON 对象)。
- `ReturnType<typeof normalizeSaVmPolicy>` → &NormalizedSaVmPolicy (Policy 型)。
- `(content: string) => boolean` 谓词参 → fn 指针型参 (仅可逐字转发调用方
  fn 引用, helper-fn 派发模式, FIX_PHASE1 §9)。
- `Array<...>` / `{...}` 对象字面返回型 → JsonBuf 或具体 struct (逐 fn 定)。
- `input:: JsonBuf` 双冒号笔误 (runParallelSaVmTool)、`timeoutOpts?::` 同 —
  按 TS 源签名重定。
- 嵌套闭包同名 (转换器提升为顶层后重名): walk×4 → findFiles_walk /
  listDir_walk / grepSearch_walk / workspaceOutline_walk; paginatedResult×2 →
  grep_ / grepAsync_ 前缀; worker×2 → grepAsync_worker / parallel_worker;
  pickSrc×2、push、entries、build、normalize、totalCount、trimToBudget、
  withBase、semFilter、startLine、endLine、pickContent、pickStr、numOrUndef、
  killProcessTree 等箭头 fn 逐个以父 fn 名前缀改名 (译到该簇时定名并登记)。

## 8. 阻塞登记 (逐处, 译时填充)

(暂空 — 译时按 §3/§5 规则填充: 区号、构造、出处核验、处置。)

## 9. 批次台账 (译时填充)

格式: 批号 | 行段/区号范围 | 簇 (父 fn 群) | 首错变化 | 状态。
每批译完跑 sa check 记录首错; 纯函数助手簇另补断言探针实跑 (编译为可执行
探针文件后运行, 非仅 check), 结果记 §10。

## 10. 探针结果 (实时填充)

(暂空)


## 11. 开工探针与提供方修复 (2026-10-26 本单元实测)

- 块注释: SLA 解析器不支持 /* */ (微探针: 文件首行 /** */ 即
  error.ExpectedDeclaration)。全文件翻译禁用块注释。
- 全量 union 探针 PASS: std{io/print.sai, fs.sai, string.sa, ptr.sa,
  encoding/json.sai, text/regex.sai, env.sai} + types + memoryFilePaths +
  Policy + TreeSitter + CodeGraph + Jev + Request + ApplyPatch +
  SplitWorkflow + regressionRunner + Ledger + Tool 本地声明 (JsonBuf/
  ByteList/F64List/ListBuf/RegexHandle/PolicyCfg) 共存无冲突。
- 提供方修复 (本单元内, 已逐项双确认):
  1. saVmJev.sla: 块注释 50 处→行注释; struct 类型位 [0u8;→[u8; 共 149 处
     (填充位不动); SaVmRunInput→JevRunInput (33)、SaVmPolicyConfig→
     JevPolicyConfig (23)、SaVmRunResult→JevRunResult (51)。独立 check:
     展开/解析已通, 推进到其本体类型错 (str_trim_range 写穿 & 参,
     backends 域存量, 按到达性不阻塞导入方)。全仓此前无 jev 导入方。
  2. saVmCodeGraph.sla: SaVmRunResult→CgRunResult (6)、SaVmPolicyConfig→
     CgPolicyConfig (5); 改名前后独立 check 均 PASS。全仓此前无 CG 导入方。
  3. sdk dataDir.sla: fs_exists→dd_fs_exists (3 处; 与 TreeSitter 的
     fs_exists 同名同签异实现 — TS 版 sa_std_fs_exists==0, DD 版
     sa_std_fs_len==0, 目录语义微差, 各自保留); 唯一外部调用方
     saVmPaths.sla 2 处调用点同步改名。dataDir/memoryFilePaths/saVmPaths/
     codexVirtualConfig/bridgeEventLog/claudeSkillInventory/
     regressionCases/cliSpawn 改后独立 check 均 PASS。
- TreeSitter StrBuf 与 Tool 本地 StrBuf 同形 ([u8; 65536]) — Tool 仍按计划
  弃本地声明用 TS 的 (按名判重, 同形亦冲突)。


## Progress addendum 3 (batches 4-11 landed, parse-clean)
- B4a: semaphore (global cells, handoff model), stale-temp cleanup (at/done
  cells), backupExistingFileBeforeWrite, estimateTokenCount (UTF-8 walk,
  UTF-16 unit weights), formatBytes (toFixed 1/2), res_capability2 /
  res_set_violation / gate helpers live here and in B7.
- B4b/B5: nativeReadFile (std-buffer ptr/len processing, OPT-1 gate,
  case1/case2), nativeReadLines (doc merge), nativeReadFileTail
  (in-memory simulation of the backward chunk walk).
- B6: SearchMatcher (ERE + REG_NEWLINE, \d translation), matchesFile
  Pattern, paginate_items, sort_listbuf, nativeFindFiles + walk ctx.
- B7/7b/7c: write/edit/delete/move/ensureDir/safeDelete. Gate calls
  saVmAccountabilityLedger.checkAccountabilityWriteGate (that file is
  still bulk-state: gate currently always allows - ledger unit debt,
  wiring here is faithful). safeDelete calls nativeFindReferences and
  parses its files/L<line>:<type>:<snippet> format.
- B8: nativeListDir + walk (parallel item arrays, 4096 scan cap).
- B9/B10: grep + grepAsync (GrepMatches parallel lists, circuit
  breaker, sequential worker landing, matchedQuery only when >1 query).
- B11: nativeFindReferences (word/def/imp ERE via glibc , BFS
  candidate collection, grouped files JSON, references_found event).
- POLICY SHAPE CORRECTION: the real NormalizedSaVmPolicy is
  {engine, fs{entries, read/write/transfer StrList, delete, backupDir},
  http_allow, env_allow, process{spawn, exec, bun*}, execution_*,
  tools{...findReferences...}, contextSavings} - the zero literal is
  extracted verbatim from saVmCodeGraph (norm_lit) and injected at each
  normalize site; normalizeSaVmPolicy(config_doc, cwd, additionalRoots,
  out) and checkSaVmPath(policy, op, cand, cwd, out) signatures as
  recorded in S11 are CORRECT.
- Process lessons: (1) the norm-literal injection must strip the frag
  fn tail (a stray  after the literal cost two cycles); clean literal
  is /tmp/norm_lit.txt (2472 chars). (2)  comments inside the
  untranslated signature lines are the recurring frontier error class.
  (3) while-block closes must never carry  - several hand slips fixed.
- Known pending type-phase items: durationMs is u64 in SaVmRunResult
  while res_* assign f64 (cast sweep needed); ListCtx.exclude_dirs is
  ListBuf but isExcludedRelPath wants ByteList; struct-by-value returns
  (gate_new, run_result_new) unvalidated until the type phase.

---

## Addendum 4 — batches 12–19 + type-phase campaign + probes (2026-10-26, unit close)

### Batch ledger (all 430 zones now genuine SLA; file parses AND type-checks)

- 12: findReferences/findImplementations natives (ERE word-boundary search, candidate files, pagination envelope).
- 13: detectModuleBoundary, workspace collection/prefilter (always unavailable in the
  native runtime — no Worker constructor; the TS itself falls back to the sequential
  loop, so ok=false here is the FAITHFUL landing), outlines, collectFileImports.
- 14: json_pretty_into (hand-rolled pretty printer; std has no pretty stringify),
  repoMap over a global-bytes cell cache ("savmtool.repomap.cache.v1"), verifyLoop,
  record/replay regression adapters.
- 15: notes/memory cores (F64List updated_at tracking aligned to 4096), nativeReadMany.
- 16a: renameSymbol/moveWithImports/findDefinition (+ import-follow scan).
- 16b: extractToFile/addImport/getDiagnostics.
- 16c: workspaceDiagnostics/organizeImports/analyzeScope/extractComponent/
  autoFixMissingImports/analyzeFileCoupling/atomicRefactor.
- 17: applyPatch over the provider parser (Tool-side op contract PATCH_OP_WRITE=1,
  EDIT=2, DELETE=3, RENAME=4 — §8), copyFile/countLines/fileInfo/stat.
- 18: git cluster — GitArgvArr {slots [u64;40]} + PROCESS_ARGV_SET_PTR (the struct-array
  argv form segfaults in exec_capture; flat u64 slots are the working form),
  execGitSync (run_cwd capture + try_wait poll + post-exit drain), git_status/diff/log.
- 19a: http_fetch (v2 client; method enum get/post/put/delete only — §8), host
  normalization, session store infra, spawnHostProcess, checkGitSafety.
- 19b: nativeRunHost (14-gate pipeline), session natives, checkpoints, sb_trim_ip.
- 19c1: task-dependency extraction, batch dependency violation, legacy template
  handler, line-bound picking, percent-decode, extractRawFilePath, denyJevActiveTool.
- 19c2: runSaVmTool dispatcher (all action branches incl. 17 Jev branches, ledger
  branches, fallback script path via bun/python runners).
- 19c3: helpers (coercions, bun profile gates, verifyBunProfileIntegrity),
  ledger bridges, jev_call (JK→Jev kind mapping), cg_call, split_call,
  killProcessTree, resolvePythonBinary/resolveBunBinary, minimalRunnerEnv,
  slim_output, spawnScriptRunner, normalizeFsCaps/normalizeNetCaps,
  normalizeSaVmRunInput, resultKind, isSaVmBlockedToolName (split on `.`/`:`/`/`/`-`,
  NOT `_`; python[0-9]* rule), runParallelSaVmTool (sequential canonical execution,
  results cached as JSON docs — no 32× struct stack blowup).

### Type-phase campaign (parse passed first; then one-error-at-a-time to zero)

Errors fixed, by class (each verified by the next `sa check` frontier):
- Redeclaration vs the 13-file import closure: 9 Tool helpers renamed `tool_*`
  (bytes_eq, decl_scan_line, is_ws_byte, path_dirname, path_extname, path_relative,
  sb_append_u64, sb_contains, sb_trim).
- `&ptr`-returning externs (sa_json_string_ptr, sa_fmt_buffer_data) passed inline as
  arguments do NOT coerce; assignment does. Wrappers jstr_ptr / fmt_data; 25 sites.
- Branch-final statement rule: both if/else branches must end void-typed; a branch
  ending in a value-returning bare call vs a branch ending in an if mismatches.
  29 branch-final calls bound to lets (analyzer: /tmp/branch_scan.py pattern).
- Pointer arithmetic is illegal in expressions (sb_ptr(x)+n, base+pos, rp+seg):
  31 sites hoisted to PTR_BYTE_ADD statement form.
- Address-of-array-field (`&s.field`) is a capability value, rejected by plain-ptr
  params: ~50 sites hoisted (sb_append/jset_str/fs_write_all/tool_bytes_eq/
  res_set_stdout), incl. the paired `&id.field, id.field_len` sweep.
- LoopConditionalConsume (a pre-loop binding consumed by an extern move inside a
  loop): restructured at 5 sites — flag+break+free-after-loop (verify_tc_target,
  findDefinition workspace scan, atomicRefactor write loop), swap-then-free-after
  (repomap cache_doc became loop-local load/free; spawnHostProcess session doc),
  single-pass rebuild (repomap nd trim). Free+reassign inside a conditional does
  NOT revive a binding (UseAfterMove) — swap via a temp, free the temp after.
- Struct VALUE assignment moves: ListBuf snapshots in expandSaVmActionInput became
  byte copies over the packed form.
- sa_global_u64_add is 4-arg (name, len, delta: i64, &out) -> i32: 4 sites fixed.
- Real-surface corrections vs bulk-conversion fantasy names: sa_json_node_* wrappers
  over the actual json.sai externs (64); regex group accessors are
  sa_regex_group_ptr/len/start(count on the REGEX handle); clampIntKey extracted for
  the (doc, key, …) 6-arg call family; parseExcludeDirsDoc extracted (doc-based);
  json_pretty_doc for doc-handle call sites; paginate_items 7-arg completion.
- sb_to_lower is the 2-arg TreeSitter helper; the 1-arg in-place assumption in
  batches 19a/b became sb_lower_ip (17 sites).
- F64List struct decl aligned 1024 → 4096 (all literals/guards already used 4096).

Tooling note (for reuse): the checker's first-error order is NOT source order and
shifts with stub sets; plain prefix bisection misattributes. Reliable localizers:
chunk isolation (40-fn real windows, everything else signature-stubbed) and
single-real reproduction. Both scripts were session-local (/tmp/chunk_check.py,
/tmp/bisect_range.py, /tmp/bisect_elim.py, /tmp/branch_scan.py).

### Providers repaired en route (ride along in this unit's commit, flagged)

- backends/jev/src/jev/saVmJev.sla: was unparseable (block comments, `[0u8;` type
  forms, SaVm* name collisions with sdk types) → Jev* renames; parses now, standalone
  check stops at its own body TypeMismatch in str_trim_range (provider debt).
- apps/server/src/saVmCodeGraph.sla: SaVmRunResult/SaVmPolicyConfig collisions →
  CgRunResult/CgPolicyConfig; checks PASS.
- sdk-backend/src/dataDir.sla: fs_exists collided with Tool's → dd_fs_exists;
  saVmPaths.sla call sites updated; sdk set re-checked PASS.
- NOT repaired (not mine, pre-existing): saVmPolicy.sla standalone check stops at a
  body TypeMismatch in normalizeContextSavings (same borrow-assign class as Jev's);
  importers are unaffected (check verifies imported DECLARATIONS only).

### §10 Probes (sa build-exe, exit-code asserts; run on the box)

HARNESS FINDING: `sa build-exe` on any file IMPORTING saVmTool.sla — or on
saVmTool.sla itself as root — fails in import expansion with error.SyntaxError,
while `sa check` passes. Isolation: every direct import compiles standalone
(zz_one × 11), all imports together compile (zz_all2), saVmTreeSitter.sla as root
compiles through expansion. Prefix bisection pins the expansion failure to
nativeFileOutline (span 232): its body carries the full NormalizedSaVmPolicy zero
literal — nested struct-repeat literals ([T {…}; 128] inside nested struct
literals). Statement-level bisection (2026-10-26) pins it exactly: the first
statement of nativeFileOutline that breaks expansion is the
`let norm = NormalizedSaVmPolicy { ... }` zero-literal statement itself
(2,529 chars, one line; splitting the line does NOT help — the statement's
nested struct-repeat mass is the trigger). This is the same family as the
documented expansion limits (AGENTS.md: big array locals in imported files). CONSEQUENCE: runtime/exe probes of Tool
helpers cannot be built in this tree today; this is a sci expansion limitation,
not a Tool defect (check-level verification is complete). The probe source
(zz_probe.sla: 17 assert groups — estimateTokenCount/formatBytes/isSafeGitRevision/
parseGitBranchHeader/stripGitQuotes/resolveGitMaxBytes/isSaVmBlockedToolName/
resultKind/json_pretty_into/expandSaVmActionInput/gitignore/execGitSync on a temp
repo/nativeGitStatus) is preserved in the session record and in §10 of the worktree
notes; it type-checks when concatenated after saVmTool.sla (zz_probe2.sla:
"Successfully parsed and verified"), so the assertions are known-good modulo
execution. Re-run them once the expansion limit is lifted.

### Final state

- apps/server/src/saVmTool.sla: 23,329 lines, 446 fns — `sa check` PASS
  ("Successfully parsed and verified syntax and types"), chunk scan (80-fn
  windows) fully clean.
- 430/430 TS zones retranslated; 0 remaining. Deviations/blockers: §8 register
  (unchanged items) + the build-exe expansion limitation above + Jev/Policy
  provider body TypeMismatch debt (theirs; does not block check).
