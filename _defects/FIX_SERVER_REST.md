# FIX_SERVER_REST — apps/server 主体（除 index.sla）修复阶段 1 第三步状态

- 工作树：`/content/bulk-srv`（slacxu bulk-convert，基点 **692d15a** `fix(sdk-frontend): phase1 compile-through`）
- 范围：`apps/server/` 下 96 个 .sla（排除 `apps/server/src/index.sla`，其为后续单独一步）
- 环境：`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_STD_DIR=/content/sa_all/sci/sa_std`，逐文件 `timeout 60 sa check`、串行
- **状态：语法层检查点（2026-10-26）。按战略转移定案，本步在本次提交后暂停；语义层（桩普查/async 重译/fs_exists 全域扫描）未完成，恢复点见文末。**
- **续（2026-10-26，用户选 B 回主战场后恢复执行）**：独立工作树 `/content/bulk-res`（基点 6080800）。saVmCodeGraph 已收口通过（95/96）；saVmTool 完成全量盘点，定性为整文件重译单元（见下）。

## 结果：基线 80/96 → 94/96 → 续步 95/96（saVmCodeGraph 收口；saVmTool 定性整文件重译，见下）

基线失败 16 个，本步修复 14 个：

- commandBlacklist、imageHistoryStore、pluginHostServices、threadHistoryTail、threadSubscriptionRegistry（批 A）
- forwardApi、projectRoomStore、providerModels、terminalPty（批 A/C：导入路径、STR_PTR 补 string.sa 导入）
- codeCliBridge、launchInstall、auggieRedirector、workbenchControlApi（批 D/D2：&出参写穿）
- saVmTreeSitter（批 C/E + 宿主层新写 + 写穿/借用/尺寸变体/移动语义迭代，见下）

forwardTurn.sla 的 `ForwardRoute`→`ForwardTurnRoute` 改名（批 B，与 forwardModel 的同名异形结构消歧）已包含在通过集内。

## 剩余失败（2 个，逐项分类）

1. **apps/server/src/saVmCodeGraph.sla — 已收口（2026-10-26 续步，sa check 通过）**。
   - policy 绑定：启用 `saVmPolicy.sla` 导入；删除 CG 本地同名结构体 `NormalizedSaVmPolicy { handle }`（与真实结构体撞名）；CG 侧包装改名 `cgCheckSaVmPath`/`cgNormalizeSaVmPolicy` 并绑真实 API——action 字符串映射 operation 标签（read=0/write=1）、决策 reason 字节拷回 reasonOut、normalize 传空 StrList additionalRoots；2901 行构造改为全零嵌套字面量（生成器按 saVmPolicy.sla 结构体定义机械生成，2473 字节；探针证 `let x: T;` 未初始化声明是语法错误，无替代形）。
   - ts 面：`cg_node_type_is` 改走 `ts_node_type_sb` 模式（与宿主层 node_type_is 同形）；`ts_node_is_named` 改走 sci 新绑定（见「已完成的层」sa_ts 补绑条，原 F1「层内不提供、走 named-child 迭代」的处置被本轮任务指令的 sci 补绑路线取代）。
   - extern 队列后方逐个浮现并修复（均 CG 本体）：`cg_copy_into`/`queue_front`/`json_get_number` 三处 &标量出参裸赋值改写穿（`*out = v`，解引用先落本地再运算）；949 行 `sb_trim(&line, …)` 双重借用改裸转发；971 行结构体字面量 `bytes: [u8; 65536]` 误写（缺 0 填充，检查器报 `UndefinedVariable: u8`）已正；`cg_field_to_sb`/`cg_buf_eq`/`cg_join_count_from`/`joined_segment_from` 四个 `&[u8; N]` 形参助手与调用点字段尺寸不一致（1024/16384/65536/512 混用），统一扁平为 (ptr, len) 形参、44 个调用点机械改写（PTR_BYTE_ADD 取址提升）；宿主层补 `fs_stat_is_file`（sa_std_fs_metadata + sa_fs_metadata_is_file，照 sdk-backend sa_fs_stat_mtime_ms 先例）、`fs_read_file`/`fs_write_file`/`fs_readdir`（sa_std_fs_read_dir_entries + 条目访问面，kind 2=目录、符号链接不算目录，与 Dirent 语义一致）、`path_join2`（拼接+path_normalize_sb）、`time_now_ms`（sa_time_unix_ms）。
   - saVmPolicy.sla 自身的 `normalizeContextSavings` 写穿错误按探针结论不阻塞 CG（已验）；该文件本体修复归 backends 域后续单元。
2. **apps/server/src/saVmTool.sla — 全量盘点完成（2026-10-26 续步）：定性为整文件重译单元，本步未动其主体**。
   - **实测体量**：11,483 行（代码行 10,411）、147 个 fn。批量转换对此文件只做了签名层：全文 SLA 成语计数为 **0**（STR_PTR/sb_append/PTR_BYTE/`[0u8;` 填充/sa_std_/sa_json 调用均为 0 处；仅本地 struct 声明与 JsonBuf 动态值模型标记 124 处）。函数体为逐字 TS：动态对象字面量返回、`?.` 链、三元、`new RegExp`、模板串、try/catch、Set 字面量等遍布全文件。
   - **TS 标记普查**（剔除整行注释后的代码行）：2,151 行命中 TS-only 标记（=>、typeof、===/!==、模板串、.push(、Array.isArray、undefined、throw、instanceof、await、.match(、new X、展开、?.），聚类 **430 区**，覆盖 53–11479 行——即原文区不是岛屿而是主体，未标记行多为对象字面量字段行与普通语句行。此为下限口径。
   - **接线矩阵（已查实）**：无结构体名冲突、可直接 import 的：sdk 的 `saVmTypes.sla`（SaVmRunInput 在 :88，闭包 6 struct）、`memoryFilePaths.sla`、本域 saVmAccountabilityLedger/regressionRunner/saVmApplyPatch/saVmSplitWorkflow/saVmRequest、`backends/jev` 的 saVmJev。冲突项：saVmTreeSitter/CodeGraph 闭包带 `StrBuf`（与 Tool 本地同名**同形** `{ bytes: [u8; 65536], len }`，是否容忍同形重定义未探针，待重译单元定）；saVmPolicy 闭包带 `StrList`（Tool 本地为字节缓冲 `[u8; 4096]`、policy 为记录表 `[StrItem; 128]`，**异形真冲突**）；`packages/shared/src/index.sla` 闭包 177 struct 且含 StrBuf/StrList 冲突（SaVmBunProfile 在 :1202，宜单独取型或在本文件内声明映射）。
   - **调用形不匹配（重译时须逐面适配，同 CG 的 cg* 包装模式）**：Tool 内调用为 TS 动态形——`normalizeSaVmPolicy(policy, cwd)` 返回动态对象、`checkSaVmPath(policy, "read", root, cwd)` 返回决策对象、`nativeCodeGraph(rawInput, policy, cwd, startedAt)`（真实签名 `(tsh, rawInputJson, policyCfg, cwd, out)`）；policy 侧字段读为 `normalizedPolicy.tools?.findReferences` 等动态路径——重译单元须先定动态对象模型（文件头已自选 JsonBuf doc 句柄方向）再逐面落适配。
   - **处置分布**：430 区全部归「待重译」（含 RegExp 区：sa_std text/regex.sai POSIX ERE 子集为部分映射面，见 CAPABILITY_MAP；动态对象/try-catch/await 按既有 playbook 分别落 JsonBuf 句柄、状态码、ASYNC_MODEL 阻塞退化——均属可映射、唯体量）。不可映射项：无新增四出处结论。

## 已完成的层

- **语法/规范层（批 A–E playbook）**：`[0u8; N]` 填充字面量与 `[u8; N]` 类型形区分（帧感知分类器 fixfill 恢复 CG 269 处、TS 386 处字面量填充）；`[N]Type`→`[Type; N]` ×176；`sa_std/json.sai`→`sa_std/encoding/json.sai` ×3；保留字标识符改名（字段 `match`→`match_`、`type`→`type_`，参数 `impl`→`impl_ref`、局部 `impl`→`impl_sb`，TreeSitter 的 `mod`→`mod_sb` ×34）；代码位块注释 `{ /*…*/ }`→`{}` ×2；`return 0;`→`return 0.0;`（f64）×2；相对导入修正 ×1（codeCliBridge 的 goalContinuation）；while/for 块尾分号删除（感知字符串/字符字面量/注释的扫描器，共约 245 处；首版扫描器曾被字符字面量 `'"'` 致帧失同步，v2 已修）；`void x;` 丢弃语句删除 ×18 + `void call();`→裸调用 ×1（探针证实 `void` 在该位置被当类型名解析）。
- **写穿层**：&标量/&结构体出参的裸赋值逐站点改 `*out = v`、&结构体参数存入数组/字段改 `*e` 解引用拷贝（codeCliBridge 10、launchInstall 19、auggieRedirector 32、workbenchControlApi 21、saVmTreeSitter 33+，均带脚本审计打印）。
- **借用纪律层（saVmTreeSitter）**：探针定规——&参数裸转发合法、&参数再加 `&`（双重借用）非法、本地结构体值裸传非法、&本地合法。按此双向修复（borrowfix3；同行同名多次调用需按 occurrence 索引匹配，曾因此漏修 `&locallyDeclaredCsv` ×3）。
- **saVmTreeSitter 宿主层（新写，约 700 行，文件内）**：转换假定的 `ts_*`/`proc_*`/`path_*`/`fs_*` 表面全部落地为真实实现——web-tree-sitter 映射到 sa_std `tree_sitter.sai`（sa_ts_*）：语言以语法名注册（.wasm 路径归约，joined-name cell 表，id=行号）；解析上下文（源文本/树/根）存 sa_global cell（本模块每条 walk 都在查询前先 ts_tree_root 定根，单活跃上下文与调用流吻合）；`proc_cwd` 走 `sa_env_current_dir`（真实 getcwd 面）；`proc_resources_path` 在非 Electron 运行时如实返回 false；path_dirname/extname/resolve2/relative 按 Node POSIX 语义实现；`fs_exists` 建在 `sa_std_fs_exists` 状态码（0=存在）之上返回 bool。
  - **真缺口（四出处已核，2026-10-26：sala 文档、sa_plugin_sla demos/tests、sa_std tree_sitter.sai、sci sa_tree_sitter.zig）**：sa_ts 仅绑定 16 个 extern，C API 的 `ts_node_parent`、节点位置（row/col）、`ts_node_is_named`、`ts_node_is_missing`、`ts_node_has_error` 未绑定——属 sci 侧待补面。【2026-10-26 续步已关闭：sci 41b9f82d 补绑 6 个 extern，下述 SLA 层补偿已全部退役，见「sci sa_ts 补绑 + 宿主层升级」条】SLA 层补偿（历史）：位置由字节范围+注册源文本精确算出；parent 以最深匹配 DFS（同型同域包装链为已知近似）；has_error 用树自身 sexp 渲染中的 `(ERROR`/`(MISSING` 标记（精确）；is_missing 近似为空域叶子（已在定义处注明）；type 读取因 cell 不暴露内部指针、无法返回稳定 ptr，将 `ts_node_type_ptr/len` 在本文件 3 个消费点（node_type_is 本体、isInsideCommentOrString、renameWalk）重构为 `ts_node_type_sb(node, &StrBuf)`。
  - 尺寸变体：`buf_field_to_sb` 家族按字段实际尺寸补齐 256/1024/4096/64 变体并按字段名改路由全部调用（8192/512 原有）；`named_used` 的 sb2 误路由已正。
- **sci sa_ts 补绑 + 宿主层升级（2026-10-26 续步）**：四出处核查确认 parent/position/is_named/is_missing/has_error 属 sci 绑定缺口（sala 文档路线图缺口表有载、sla demos/tests 零用、sa_std 无绑定；钉版 `libtree-sitter.so` v0.25.10 导出全部六个 C 符号，ctypes 探针已验语义与测试夹具）。sci `41b9f82d` 落地 6 个 extern：`sa_ts_node_parent`、`sa_ts_node_is_named`、`sa_ts_node_is_missing`、`sa_ts_node_has_error`、`sa_ts_node_start_point`、`sa_ts_node_end_point`（sa_tree_sitter.zig + sa_std.zig 点名引用 + tree_sitter.sai 声明，照既有 16 extern 模式；sa_std.h 不含 sa_ts 族、按 .sai-only 惯例不动）。门禁：ReleaseFast 重编、sa-std-unit **160/160**（新增命名测试 `tree-sitter: parent, points, and node flags`）、runtime-abi-check --platform both PASS（linux 658→664、header 仍 618）、nm 核 6 符号在 libsa_std.a。宿主层据此退役四处补偿：位置改点 extern 直读（另补 `ts_node_end_col`）、parent 改直绑、has_error 改直绑、is_missing 改直绑，新增 `ts_node_is_named`；层头 TRUE GAP 注释已改注 GAP CLOSED。saVmTreeSitter 本体复检保持通过。
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
- 续步新增探针（2026-10-26）：`let x: T;` 未初始化声明是**语法错误**（expected equal），结构体出参必须由调用方提供已构造值（大结构体用全零嵌套字面量）；`-> &ptr` 型 extern 返回值必须先落**显式 `: ptr` 类型**本地变量再传给 ptr 形参，未类型化 `let` 直传报 TypeMismatch；`&[u8; N]` 形参尺寸精确匹配，混尺寸字段助手须扁平为 (ptr, len)；检查器按可达性验导入文件（CG 调用 policy 两函数未牵出其未调用函数的内部错误，与上条互证）。

## 工作产物（盒上）

脚本：/content/{baseline_srv,recheck,batchA,batchB,batchC,batchD,batchD2,batchE,fixfill,insert_layer,fixerv2,borrowfix3,bare3,diag_csv,move_scan,bisect*}.py；备份：/content/backup_srv_batch{A,B,B2,C,D}、backup_srv_layer、backup_srv_fixerv2、backup_srv_borrowfix{,2}。
