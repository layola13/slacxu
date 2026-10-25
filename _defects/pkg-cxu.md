# 单元 pkg-cxu 缺陷日志

源：`packages/cxu` 全部 .ts（CXU plugins @ f2cb649d），28 个文件 / 23,876 行。
产物：镜像同相对路径 .sla。本文件汇总本单元全部缺陷条目（行内 `// DEFECT:` 为第一通道，本文件为第二通道）。

格式：`文件:行 | TS 构造 | 缺失能力/问题 | 采用的近似`

---

## 主转换（21 文件）

### packages/cxu/src/index.ts（15 行）
- src/index.ts:1-15 | `export * as ns` / `export { x as y }` 别名再导出 | SLA 无命名空间对象与别名导出 | barrel 改 @import 转发；`resultKind as coreResultKind` 别名丢失（行内 DEFECT）

### packages/cxu/src/vendor/sdk-backend.ts（1 行）
- src/vendor/sdk-backend.ts:1 | `export * from "../../../../sdk-backend/src/index.js"` 包外相对再导出 | 镜像内无对应 sdk-backend 单元文件（sdk 单元负责） | @import 转发占位，无行内 DEFECT

### packages/cxu/src/postinstall.ts（15 行）
- src/postinstall.ts:6-15 | 顶层 try/catch + console.error 模板插值 `${error.message}` | 异常对象 message 不可得 | ensureServerBinary 返回 i32 状态码模拟 throw；catch 文案固定行
- src/postinstall.ts:10 | console.log(hint) 动态缓冲打印 | sa_print_bytes 传动态缓冲指针在部分 codegen 位置 CapabilityMismatch（已知坑） | 直调 extern，行内 DEFECT 标注待修复期核对

### packages/cxu/src/bun-runtime.ts（61 行）
- src/bun-runtime.ts:5-11 | `process.platform` switch | sa_std 无 platform 表面 | platform 改显式 tag 参数（0=win32/1=darwin/2=linux/3=other）
- src/bun-runtime.ts:47-61 | spawnSync("bun",["--version"]) 同步探测 | std 同步 spawn 捕获未接线 | bunVersionProbe 桩返回 -1（isBunAvailable 恒 false）
- src/bun-runtime.ts:13-44 | 安装提示 URL 字面量 | （工具层问题）提示串由片段拼装，字节与原文一致，无语义缺陷

### packages/cxu/src/serve.ts（413 行）
- src/serve.ts:1-60 | node:child_process spawn（stdio inherit/pipe、signal 转发、EFTYPE/ENOEXEC 回退） | std 无完整 spawn 选项表面 | spawnAndWait/spawnFallback 桩返回 -1；回退顺序保留
- src/serve.ts:90-140 | process.env 读取与默认值合并（PORT/HOST 等） | env 需逐键显式读取 | EnvEntry 表参数化
- src/serve.ts:150-260 | server-build 的 EnsureServerResult 联合类型 | 跨文件 struct 形状由 server-build.sla 定义，serve 侧字段类型为本地 SBuf | 形状对齐靠约定，行内 DEFECT 标注待统一
- src/serve.ts:300-360 | doctorCodexStatus 等外部调用 | cli-doctor 单元文件未定型 | 本地桩返回 false

### packages/cxu/src/server-build.ts（458 行）
- src/server-build.ts:10 | 模块级 `const HOME = process.env.HOME || USERPROFILE || homedir()` | 无模块级环境求值 | HOME/distDir/cwd/execPath/pid/arch 全部显式参数化（贯穿全部函数签名）
- src/server-build.ts:14,141 | createRequire / require.resolve("node-pty/package.json") | 无模块解析 | getCxuVersion 改读 <pkgDir>/package.json；node-pty require.resolve 回退分支缺失（返回未找到）
- src/server-build.ts:25,68 | 正则 `/(\d+)\.(\d+)\.(\d+)/`、`match(/\d+/g)` | SLA 无 RegExp | 数字串扫描手写实现（parseVersionTuple/toWindowsVersion）
- src/server-build.ts:39,419 | spawnSync（bun --version / bun build --compile, stdio:"inherit", timeout） | 同步 spawn 未接线 | bunVersionText/spawnBunBuild 桩
- src/server-build.ts:88-209 | node:fs 同步面（cpSync 递归、renameSync、chmodSync、statSync.mtimeMs、readdirSync withFileTypes） | std fs 表面不全 | fs_* 包装桩；prebuilds 目录迭代改固定候选清单；mtime 比较恒 false（isStaleBundle 失效）
- src/server-build.ts:279-304 | openSync/readSync 定位读 PE 头 | std 无 seek/定位读 | 头部 8192 字节近似，peOffset 超界判无效
- src/server-build.ts:394,446 | `tmp-${pid}-${Date.now()}` / new Date().toISOString() | 无 pid/时钟表面 | pid 参数化、nowMsBuild 桩返回 0、builtAt 写空串
- src/server-build.ts:387 | `bun.hint.split(". ")[0]` | — | 整行打印近似（文案略异）
- src/server-build.ts:322-326 | EnsureServerResult 判别联合 | 无联合类型 | 单 struct + ok 标志 + has_* 可选标志（规范定义在本文件，serve/postinstall 的 1 参调用签名与本文件 11 参签名不一致，待修复期统一）

### packages/cxu/src/cli.ts（126 行）
- src/cli.ts:1-4 | shebang + 顶层语句 + 顶层 await + process.exit | 无顶层脚本形态 | cliMain(args, argc, tty 标志, 环境参数) 返回退出码
- src/cli.ts:61,89 | `await promptDoctorInteractive(...)` | async | 同步调用近似
- src/cli.ts:78-84,118-122 | for (const id of listToolIds()) 安装循环 | cli-doctor 的 listToolIds/doctor 视图形状未定型（frag-mid 单元） | 循环体以 DEFECT 桩占位，仅保留 isReady 退出码逻辑
- src/cli.ts:101,111 | `listToolIds().join(", ")` 插值打印 | 同上 | Tools:/Choices: 行仅打印前缀

### packages/cxu/src/shared-types.ts（397 行）
- src/shared-types.ts:全文 | interface/type 字面量联合、字符串字面量联合 | SLA 无 interface/字面量联合 | struct + u64 tag 常量
- src/shared-types.ts:工具表 | `readonly` const 数组（ENHANCE_TOOLS_KEYS 36 项） | 无 const 数组表面 | 管道拼接文本常量 + 线性扫描；toolsKeyEnabled 索引映射 0..33（34/35 顺序差异待修复期核对）
- src/shared-types.ts:多处 | string[] 字段（read/write/transfer/allow/args 等） | 动态数组 | JSON 文本跨度保存
- src/shared-types.ts:多处 | 可选字段 undefined 与 false 之别 | 塌缩为 has_* 标志，部分语义丢失

### packages/cxu/extensions/pi-relay/index.ts + server-bundle/extensions/pi-relay/index.ts（各 71 行，两份源字节相同）
- extensions/pi-relay/index.ts:全文 | pi 扩展 API（registerProvider、ProviderModelConfig、headers Record） | SLA 无扩展宿主 API | registerProvider 空桩；headers Record 塌缩为单固定槽；`input: ["text","image"]` 未建模
- extensions/pi-relay/index.ts:模型表 | 对象字面量数组（32 模型） | 数组元素 struct 字面量重复语法待核 | `[StrBuf {...}; 32]` 草稿形态，行内 DEFECT

### packages/cxu/src/vendor/dataDir.ts（75 行）
- src/vendor/dataDir.ts:全文 | node:path join/resolve、os.homedir、env 优先级链 | path 语义近似 | join 不折叠 `.`/`..` 段；resolve 相对路径未绝对化

### packages/cxu/src/vendor/memoryFilePaths.ts（60 行）
- src/vendor/memoryFilePaths.ts:哈希 | crypto sha256 | 借用声明 extern `sa_std_sha256`（sa_std .sai 未核实该名） | 声明待修复期核对
- src/vendor/memoryFilePaths.ts:改名 | fs renameSync | 桩返回 0 | —

### packages/cxu/src/vendor/saVmProcess.ts（105 行）
- src/vendor/saVmProcess.ts:进程组终止 | process.kill(-pid)/taskkill /T /F | std 无 kill 表面 | killPidGroup/killPidSingle 桩返回 0；win32 分支空函数

### packages/cxu/src/vendor/saVmResultKind.ts（56 行，近完整）
- src/vendor/saVmResultKind.ts:kind 表 | 字符串 kind 联合 | tag 常量 0-9 | exit-code 映射（228/229/230/231/233/235、1+stderr→sa_error、<128→success、else crashed）逐项保留；3 条行内 DEFECT 为类型层说明

### packages/cxu/src/vendor/saVmRequest.ts（210 行）
- src/vendor/saVmRequest.ts:类型守卫 | `typeof x === "object"` / Array.isArray 等运行时类型判定 | 无反射 | sa_json 节点 kind 探针近似；json_array_len_probe 桩返回 0
- src/vendor/saVmRequest.ts:错误文案 | `parallel[${index}]` 数字插值 | — | 索引插值丢失，文案近似

### packages/cxu/src/vendor/saVmFindWorker.ts（151 行）
- src/vendor/saVmFindWorker.ts:全文 | Bun Worker 消息协议 | 无 Worker | 同步 handler over JSON 近似
- src/vendor/saVmFindWorker.ts:读文件 | 无界整文件读 | 固定上限 | 1 MiB 截断；外层 catch → {ok:false,error} 仅部分建模

### packages/cxu/src/vendor/regressionCases.ts（174 行）
- src/vendor/regressionCases.ts:筛选 | 正则去斜杠、basename 三路 includes、小写 tag some() | 未实现 | componentMatches/categoryEq/tagsMatch 桩恒 true；extractCaseFields 仅复制 title（结构近似，非真实转换）

### packages/cxu/src/vendor/regressionRunner.ts（749 行）
- src/vendor/regressionRunner.ts:筛选 | 与 regressionCases 不同的另一套筛选语义 | 本文件已按其自身语义实现主体 | anyTagMatch 未实现返回 false
- src/vendor/regressionRunner.ts:禁用模式 | forbiddenPatterns × rounds 的 stringify+includes 双循环 | 未实现 | evalForbiddenPatterns 空桩
- src/vendor/regressionRunner.ts:汇总 | 5 行中文汇总文案拼装 | 未实现 | buildSummary 空桩；assembleFullCase 默认值（"state_machine"/[]/{}）未应用
- src/vendor/regressionRunner.ts:时间/日志 | Date.now()、logs 数组 | nowMs 桩 0；logs 改换行拼接文本（非 JSON 数组结构）；fs_mkdir_recursive 空桩

### packages/cxu/src/vendor/saVmSplitWorkflow.ts（299 行）
- src/vendor/saVmSplitWorkflow.ts:全文 | async/await、throw/try-catch | 同步化 + WErr 错误通道（helpers 返回 i32 状态）
- src/vendor/saVmSplitWorkflow.ts:清单持久化 | manifest JSON 的 files Record 序列化/反序列化 | **sa_json 无键枚举 API** | files 序列化桩；loadManifest 仅恢复标量+stages，files 记录不可重建（已行内标注）
- src/vendor/saVmSplitWorkflow.ts:策略 | normalizeSaVmPolicy/check 族（saVmPolicy.ts） | frag-mid 单元文件未定型 | policyExtractToFileEnabled/checkAllowed 本地桩
- src/vendor/saVmSplitWorkflow.ts:大纲/耦合/诊断 | extractFileOutline/analyzeFileCoupling/getSyntaxDiagnostics（tree-sitter） | frag-jevts 单元形状待统一 | OutlineView/CouplingView/DiagView 本地视图 + 桩
- src/vendor/saVmSplitWorkflow.ts:split_repair | 五阶段（stage/rollback/diff/validate/commit）守卫链 | 本轮仅骨架 | repairAction 返回 exit 2 占位（行内 DEFECT 明示修复期接线）
- src/vendor/saVmSplitWorkflow.ts:随机/时间 | crypto.randomUUID、Date.now、toISOString | std 表面待核 | randomUuid/nowIso/nowMsW 桩
- src/vendor/saVmSplitWorkflow.ts:事件 | saVmEvents 动态对象数组 | 仅 type/sessionId 拼装 | 其余字段（paths/kind/counts）待修复期

### packages/cxu/src/vendor/saVmApplyPatch.ts（86 行）
- src/vendor/saVmApplyPatch.ts:4-8 | PatchOp 判别联合 | tag struct + arena 跨度（contents/old/new 存 (off,len)）
- src/vendor/saVmApplyPatch.ts:56 | finishEdit 闭包捕获可变数组 | 无闭包 | 顺序化为显式 finish 调用 + 双游标 scratch（old/new 共用 1 MiB 缓冲分段）
- src/vendor/saVmApplyPatch.ts:77-82 | normalizeSaVmPolicy/checkSaVmPath/checkSaVmDelete（saVmPolicy.ts） | frag-mid 单元未定型 | W 后缀包装桩（默认放行）；policy.fs.delete/backupDir 属性读近似
- src/vendor/saVmApplyPatch.ts:多处 | 模板文案 `${index}`/`${path}` 插值 | 已拼装 | 行号用 pl_append_u64 保留；个别 ptr 算术实参待修复期改临时变量

---

## 分片：frag-jevts（saVmJev.ts 2,987 行 + saVmTreeSitter.ts 2,699 行）

（明细见 `_defects/pkg-cxu-frag-jevts.md`，共 86 条；行内 DEFECT 83 处）

类别汇总（该分片自报）：
1. async/Promise ~24：全部同步化 + 状态码/out 参数
2. 动态 JSON / Record / unknown ~14：JSON 文本缓冲（JsonBuf/StrRecord）
3. RegExp ~13：字节/关键字扫描近似
4. 闭包捕获 ~11：拆参数化函数或内联
5. tree-sitter WASM Node API ~10：不透明 u64 句柄 + 桩；TS compiler/LanguageService API ~9、Node API/process.env/路径 ~8、Set/Map ~5

---

## 分片：frag-tool（saVmTool.ts 12,040 行 → saVmTool.sla 1,999 行）

（明细见 `_defects/pkg-cxu-frag-tool.md`，共 42 条；行内 `// DEFECT:` 141 处）

类别汇总（该分片自报）：
1. async/await → 同步化：58 处 `DEFECT: async`（另 Promise 12 处）——全部 native* 与 runSaVmTool 分发器改同步函数 + 状态码/结果结构
2. Map/Set 集合缺失（31+ 处）：gitIgnoreCache、moduleBoundaryCache、repoMapCache、saVmActiveSessions、runHostHelpCache 及各 allowlist Set → 定长表 + 线性扫描
3. RegExp（16 处）：gitignore glob、符号/引用分类器、分支头解析、模板源码刮取 → 手写扫描器/近似匹配
4. 动态 JSON / Record<string, unknown>（10 处显式，贯穿全文件）：SaVmRunInput/SaVmRunResult/options 一律 JSON 文本缓冲 + sa_json_* 探测
5. throw 与判别联合（throw 11、union 7）：→ 状态码 + err 缓冲、单结构体 + ok 标志
其余：闭包/递归 walk 闭包 6、Node/Bun API（fetch/AbortSignal、spawnSync 错误码、Bun.Glob、Bun Worker、EventEmitter 流、setTimeout）、泛型、函数别名赋值、localeCompare 排序。

## 分片：frag-mid（saVmCodeGraph 1,344 + cli-doctor 826 + saVmAccountabilityLedger 712 + saVmPolicy 582 + saVmTypes 477 = 3,941 行）

（明细见 `_defects/pkg-cxu-frag-mid.md`，共 68 条）

类别汇总（该分片自报）：
1. async/Promise → 同步 + 状态码（11 条）：账本 read/append/getStatus/record/submit/gate/audit、CodeGraph 抽取、cli-doctor readline 交互 prompt
2. RegExp → 手写字节扫描（10 条）：glob→RegExp、设备名/解释器分类/引号分词、版本解析、PowerShell 脚本提取、正则回退提取器（批量期多为骨架）
3. Node API → extern 近似（10 条）：node:path/fs/os/child_process、spawnSync 多处、process.env/platform/getuid、new URL()、require("node:fs")、动态 import web-tree-sitter
4. 字符串联合/联合类型 → u64 标签（7 条）：SaVmActionType（186 动作名全量落 ACTION_* 常量）、DoctorToolId、PenaltyLevel/Tier、SaVmPolicyDecision、LedgerEntry
5. Map/Set/闭包 → 定长数组 + 线性扫描/显式栈（7 条）
其余：动态 JSON/Record/any 8、可选字段/变长数组 5、class 继承/throw 语义 4、条件对象展开 2。saVmTypes 约 220 字段以 JSON 缓冲 + 高频标量承载，完整字段名清单保留在文件尾注释。

---

## 单元统计（全量）

- 转换文件：**28 / 28**（覆盖校验通过：源仓 packages/cxu 每个 .ts 均有镜像同路径 .sla）
- 源行数：**23,876 行**
- 缺陷条目：**240 条**（主转换 44 + frag-jevts 86 + frag-tool 42 + frag-mid 68）
- 行内 `// DEFECT:` 标记：主转换 142 处 + frag-tool 141 处 + frag-jevts 83 处（frag-mid 以日志条目为主）

## 全单元缺陷前 5 类

1. **async/await/Promise → 同步函数 + 状态码/out 参数**：saVmTool 58+12 处、jevts ~24、mid 11、主转换贯穿 serve/cli/split/patch/ledger 全部异步面——数量第一。
2. **动态 JSON / Record<string, unknown> / any → JSON 文本缓冲（JsonBuf）+ sa_json 句柄/跨度**：jevts 14、mid 8、tool 10+、主转换（shared-types 字段、split manifest、events）贯穿全单元；其中 manifest files Record 因 sa_json 无键枚举 API 不可重建，是最硬的一条。
3. **RegExp → 手写字节/关键字扫描**：tool 16、jevts 13、mid 10、主转换（版本元组、筛选器、路径匹配）多处；glob 语义与正则回退提取器在批量期多为近似/骨架。
4. **Map/Set/闭包捕获 → 定长表 + 线性扫描、闭包拆参数化函数或顺序化**：tool 31+、jevts 闭包 11 + Set/Map 5、mid 7、主转换（finishEdit 闭包、find worker）多处。
5. **Node/Bun 运行时 API 无 sa_std 对应 → extern 桩/参数化**：child_process spawn 同步面、fs 同步面（cpSync/renameSync/statSync/readSync 定位读）、path 语义、process.env/platform/pid/argv、Worker、fetch/AbortSignal、createRequire/require.resolve——mid 10、jevts ~8、主转换 server-build/serve/cli/process 集中。
（紧随其后：判别联合/字符串联合 → u64 tag 常量 + has_* 可选标志，mid 7 + tool 7 + 主转换 shared-types/split/patch/resultKind。）
