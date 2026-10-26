# FIX_SERVER_REST — apps/server 主体（除 index.sla）修复阶段 1 第三步状态

- 工作树：`/content/bulk-srv`（slacxu bulk-convert，基点 **692d15a** `fix(sdk-frontend): phase1 compile-through`）
- 范围：`apps/server/` 下 96 个 .sla（排除 `apps/server/src/index.sla`，其为后续单独一步）
- 环境：`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，逐文件 `timeout 60 sa check`、串行
- **状态：语法层检查点（2026-10-26）。按战略转移定案，本步在本次提交后暂停；语义层（桩普查/async 重译/fs_exists 全域扫描）未完成，恢复点见文末。**

## 结果：基线 80/96 → 最终 94/96

基线失败 16 个，本步修复 14 个：

- commandBlacklist、imageHistoryStore、pluginHostServices、threadHistoryTail、threadSubscriptionRegistry（批 A）
- forwardApi、projectRoomStore、providerModels、terminalPty（批 A/C：导入路径、STR_PTR 补 string.sa 导入）
- codeCliBridge、launchInstall、auggieRedirector、workbenchControlApi（批 D/D2：&出参写穿）
- saVmTreeSitter（批 C/E + 宿主层新写 + 写穿/借用/尺寸变体/移动语义迭代，见下）

forwardTurn.sla 的 `ForwardRoute`→`ForwardTurnRoute` 改名（批 B，与 forwardModel 的同名异形结构消歧）已包含在通过集内。

## 剩余失败（2 个，逐项分类）

1. **apps/server/src/saVmCodeGraph.sla** — 首错 `Undefined call: cg_policy_check_extern`（文件内 37/42 行的适配层调用 `cg_policy_check_extern`/`cg_policy_normalize_extern`，全文无定义）。文件本身已过解析与前期类型检查（批 A/B/C/E 已修：填充字面量、`[N]Type`→`[Type; N]`、删除本地重复 `sb_eq_buf`、`is_word_byte` 改名避与 TreeSitter 冲突、while/for 尾分号、TreeSitter 导入已启用、string.sa 已补）。恢复点：把两个 extern 绑定到 `backends/vmtool-security/src/security/saVmPolicy.sla` 的 `normalizeSaVmPolicy`/`checkSaVmPath` 一族（签名需适配：CG 侧为 handle+action 字符串形）。注意：① saVmPolicy.sla 在其自身域内尚有独立失败（`normalizeContextSavings` 写穿），但经探针证实 import 方不受被导入文件内部错误影响（见「已验证的检查器语义」），绑定后 CG 可先行打通；② CG 还引用 `ts_node_type_ptr`/`ts_node_type_len`/`ts_node_is_named`——TreeSitter 宿主层**有意未提供**这三个（理由见 saVmTreeSitter 层头注释与下方真缺口条），CG 侧需改用 `ts_node_type_sb` 模式、is_named 改走 named-child 迭代。
2. **apps/server/src/saVmTool.sla** — 首错为解析期 `53:24 SaVmRunInput undefined`（类型定义在 `packages/sdk-backend/src/saVmTypes.sla`，从未接线 import）。本步仅做了无害整理（批 B 注释掉 40–44 行的裸 TS 续行、批 D2 一处 `void call()` 改裸调用、批 B/E 各删 1 处 while 尾分号），主体未动。恢复点：按依赖接线 import——sdk 的 saVmTypes/memoryFilePaths、本域 saVmTreeSitter/saVmCodeGraph/saVmAccountabilityLedger/regressionRunner/saVmApplyPatch/saVmSplitWorkflow/saVmRequest、跨域 `backends/jev` 的 saVmJev 与 `backends/vmtool-security` 的 saVmPolicy（import 容忍探针结论同上；`@codex-ui/shared` 的 SaVmBunProfile 在 `packages/shared/src/index.sla:1202`）。**另注意**：文件内存在成片逐字 TS 原文区（抽样见约 1690–1790、3780–3810、8835–8840 行：`let match = line.match(/…/)`、`await nativeFindReferences(...)` 等），不是注释也不是字符串——53 行解决后将逐片以解析错误暴露，全量清单未盘点；这是本域最大的未知工作量。

## 已完成的层

- **语法/规范层（批 A–E playbook）**：`[0u8; N]` 填充字面量与 `[u8; N]` 类型形区分（帧感知分类器 fixfill 恢复 CG 269 处、TS 386 处字面量填充）；`[N]Type`→`[Type; N]` ×176；`sa_std/json.sai`→`sa_std/encoding/json.sai` ×3；保留字标识符改名（字段 `match`→`match_`、`type`→`type_`，参数 `impl`→`impl_ref`、局部 `impl`→`impl_sb`，TreeSitter 的 `mod`→`mod_sb` ×34）；代码位块注释 `{ /*…*/ }`→`{}` ×2；`return 0;`→`return 0.0;`（f64）×2；相对导入修正 ×1（codeCliBridge 的 goalContinuation）；while/for 块尾分号删除（感知字符串/字符字面量/注释的扫描器，共约 245 处；首版扫描器曾被字符字面量 `'"'` 致帧失同步，v2 已修）；`void x;` 丢弃语句删除 ×18 + `void call();`→裸调用 ×1（探针证实 `void` 在该位置被当类型名解析）。
- **写穿层**：&标量/&结构体出参的裸赋值逐站点改 `*out = v`、&结构体参数存入数组/字段改 `*e` 解引用拷贝（codeCliBridge 10、launchInstall 19、auggieRedirector 32、workbenchControlApi 21、saVmTreeSitter 33+，均带脚本审计打印）。
- **借用纪律层（saVmTreeSitter）**：探针定规——&参数裸转发合法、&参数再加 `&`（双重借用）非法、本地结构体值裸传非法、&本地合法。按此双向修复（borrowfix3；同行同名多次调用需按 occurrence 索引匹配，曾因此漏修 `&locallyDeclaredCsv` ×3）。
- **saVmTreeSitter 宿主层（新写，约 700 行，文件内）**：转换假定的 `ts_*`/`proc_*`/`path_*`/`fs_*` 表面全部落地为真实实现——web-tree-sitter 映射到 sa_std `tree_sitter.sai`（sa_ts_*）：语言以语法名注册（.wasm 路径归约，joined-name cell 表，id=行号）；解析上下文（源文本/树/根）存 sa_global cell（本模块每条 walk 都在查询前先 ts_tree_root 定根，单活跃上下文与调用流吻合）；`proc_cwd` 走 `sa_env_current_dir`（真实 getcwd 面）；`proc_resources_path` 在非 Electron 运行时如实返回 false；path_dirname/extname/resolve2/relative 按 Node POSIX 语义实现；`fs_exists` 建在 `sa_std_fs_exists` 状态码（0=存在）之上返回 bool。
  - **真缺口（四出处已核，2026-10-26：sala 文档、sa_plugin_sla demos/tests、sa_std tree_sitter.sai、sci sa_tree_sitter.zig）**：sa_ts 仅绑定 16 个 extern，C API 的 `ts_node_parent`、节点位置（row/col）、`ts_node_is_named`、`ts_node_is_missing`、`ts_node_has_error` 未绑定——属 sci 侧待补面。SLA 层补偿：位置由字节范围+注册源文本精确算出；parent 以最深匹配 DFS（同型同域包装链为已知近似）；has_error 用树自身 sexp 渲染中的 `(ERROR`/`(MISSING` 标记（精确）；is_missing 近似为空域叶子（已在定义处注明）；type 读取因 cell 不暴露内部指针、无法返回稳定 ptr，将 `ts_node_type_ptr/len` 在本文件 3 个消费点（node_type_is 本体、isInsideCommentOrString、renameWalk）重构为 `ts_node_type_sb(node, &StrBuf)`。
  - 尺寸变体：`buf_field_to_sb` 家族按字段实际尺寸补齐 256/1024/4096/64 变体并按字段名改路由全部调用（8192/512 原有）；`named_used` 的 sb2 误路由已正。
  - 移动语义两例：`let keep = item;`（4491）与 `candidates.items[ci] = t;`（5109 区）改为从源数组元素再取拷贝，避免 UseAfterMove。
  - 进出游标 `skip_ws_and_kw` 的 `pos: &u64` 改本地镜像读改写回。

## 未完成的层（暂停，恢复时继续）

- **语义桩普查与重译：未做。** 仅有定性记录：workbenchControlApi 的 `parseWorkbenchRuntime` 是语义桩（函数体只有注释 + `*outErr = true`，TS 真值在同路径 .ts L802–830，含必填校验/默认值/解析链，待重译）；imageHistoryStore/threadHistoryTail 多个 DB 函数为注释桩（SQLite 逻辑只在注释里，回绑面为 plugin_sqlite 预处理面，见 CAPABILITY_MAP §8）——两文件当前「通过」仅指语法层。saVmTool 的逐字 TS 区（见上）是另一类未译残留。
- **async 重译：未做。** 本域 44 个文件带 `// DEFECT: async` 标记（计数见 ASYNC_AUDIT，saVmTool 66 处最多）；本步只按编译需要处理了签名层，未按 ASYNC_MODEL 逐文件恢复 async fn/.await/block_on。例外：saVmTreeSitter/CodeGraph 的阻塞式 extern 直调按 ASYNC_MODEL R8 属忠实退化。
- **fs_exists 全域扫描：未做。** 域内每个 `sa_std_fs_exists` 调用点的状态码语义（0=存在/3=不存在，非布尔）逐点核对未执行；已确认点：saVmTreeSitter 新写的 `fs_exists` 助手即按状态码实现；其余文件待扫（历史教训：sdk 域曾发现当布尔用致语义反转）。
- **回绑现成面：基本未做。** 手写正则扫描→text/regex.sai、SQLite exec 近似→plugin_sqlite 预处理面、闭包近似→原生闭包，除 saVmTreeSitter 宿主层外未系统处理。

## 已验证的检查器语义（探针，本步新增）

- `sa check` 只验目标文件本体 + 被导入文件的声明：被导入 .sla 内部类型错误**不阻塞**导入方（即使导入方调用出错函数）——跨域接线可先行，各域内部错误归各域步骤。
- 借用三规则（见上）；未使用局部变量合法；`void x;` 不是合法语句；结构体字面量要求类型声明在文本上先行可见（宿主层因此插在 StrBuf/sb_* 之后）；多行 `||` 条件、while 内 break、`as` 数值转换均可用。
- 本文件（saVmTreeSitter）的类型错误多无定位信息；逐调用方打桩定位法（bisect3 式）可靠，全函数二分会被错误掩盖误导（两度误指 compute_import_rel，教训记录）。

## 工作产物（盒上）

脚本：/content/{baseline_srv,recheck,batchA,batchB,batchC,batchD,batchD2,batchE,fixfill,insert_layer,fixerv2,borrowfix3,bare3,diag_csv,move_scan,bisect*}.py；备份：/content/backup_srv_batch{A,B,B2,C,D}、backup_srv_layer、backup_srv_fixerv2、backup_srv_borrowfix{,2}。
