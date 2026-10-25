# pkg-cxu-frag-mid 缺陷日志（追加文件，pkg-cxu.md 本体不动）

packages/cxu/src/vendor/saVmTypes.ts:9 | import type (type-only import) | SLA 无类型导入语义 | 保留为 @import 声明依赖 + 注释
packages/cxu/src/vendor/saVmTypes.ts:11 | 字符串字面量联合 op: "read"|... | SLA 无字符串联合类型 | u64 标签常量 FS_OP_*
packages/cxu/src/vendor/saVmTypes.ts:12 | methods?: string[] 可选数组 | SLA 无可选字段/变长数组 | 定长缓冲 + has 标志 + count（容量 16 估）
packages/cxu/src/vendor/saVmTypes.ts:14-200 | SaVmActionType 186 值字符串联合（含连字符别名） | SLA 无字符串联合/别名机制 | u64 标签 ACTION_*，连字符别名与下划线形式共用标签并注释
packages/cxu/src/vendor/saVmTypes.ts:202-422 | SaVmRunInput 约 220 个可选字段的动态对象 | SLA 无动态对象/可选字段 | 单一 JSON 文本缓冲 + 高频标量字段抽取为 struct 字段，全字段名清单保留在文件尾注释
packages/cxu/src/vendor/saVmTypes.ts:202-422 | Record<string,string> / string[] | string 字段（headers/env/options 等） | SLA 无 Map/Record | 全部留在 JSON 缓冲内
packages/cxu/src/vendor/saVmTypes.ts:405-412 | 嵌套对象 requested_caps/limits/policy 与递归 parallel: Array<Omit<SaVmRunInput,"parallel">> | SLA 无递归类型/Omit | 仅以 has 标志 + JSON 子串长度表示，内容留在 JSON 缓冲
packages/cxu/src/vendor/saVmTypes.ts:424-440 | SaVmRunResult 的 [key: string]: unknown 索引签名 + kind 字符串联合 | SLA 无索引签名 | extra_json 缓冲 + kind u64 标签（扩展 running=10）
packages/cxu/src/vendor/saVmTypes.ts:442 | NotePriorityLevel 字符串联合 | SLA 无字符串联合 | u64 常量 NOTE_*
packages/cxu/src/vendor/saVmTypes.ts:444-447 | class extends Error + instanceof 身份语义、readonly exitCode=228 | SLA 无类/继承/instanceof | struct + kind 标签 + 构造函数族，exitCode 由访问函数恒返回 228
packages/cxu/src/vendor/saVmPolicy.ts:1-6 | node:path/node:fs/node:os 导入（resolve/join/relative/statSync/tmpdir） | sa_std 无等价 SLA 声明面 | extern 近似（sa_std_fs_*/path）+ 注释登记
packages/cxu/src/vendor/saVmPolicy.ts:19-37 | Set<string> 常量 ENHANCED_TOOLS_READ_ONLY | SLA 无 Set | 名称表 + bytes_eq 线性扫描函数
packages/cxu/src/vendor/saVmPolicy.ts:38 | 判别联合 SaVmPolicyDecision {allowed:true}|{allowed:false} | SLA 无判别联合 | 单 struct + allowed/has_path/has_reason 标志
packages/cxu/src/vendor/saVmPolicy.ts:40-68 | NormalizedSaVmPolicy 嵌套对象 + 数组字段 | SLA 无变长数组字段 | 定长数组（128/64 上限）+ JSON 缓冲 + count
packages/cxu/src/vendor/saVmPolicy.ts:84-99 | (config as any)?.additionalRoots 等 any 探针 + 类型谓词 filter | SLA 无 any/类型谓词 | config 改 JSON 缓冲，字段以 sa_json_* 查找近似（修复期实现）
packages/cxu/src/vendor/saVmPolicy.ts:115-116 | process.env 读取（CODEX_UI_SA_VM_SALA_DIR/SA_STD_DIR 等） | SLA 无 process.env | 改为显式 (ptr,len) 参数经 env_json 传入
packages/cxu/src/vendor/saVmPolicy.ts:146-155 | 条件展开 ...(cond ? {bunProfiles} : {}) 与 ...(config?.contextSavings ? ...) | SLA 无对象展开/可选链 | has_* 标志字段表示存在性
packages/cxu/src/vendor/saVmPolicy.ts:210-212 | 正则 WINDOWS_DEVICE_NAMES /^(?:con|prn|...)(?:\..*)?$/i | SLA 无 RegExp | 手写字节匹配函数（批量期为骨架）
packages/cxu/src/vendor/saVmPolicy.ts:214-248 | statSync try/catch 只读放行探针 | SLA 无异常 | fs stat extern 状态码近似
packages/cxu/src/vendor/saVmPolicy.ts:277-287 | new URL() 解析 + URL 对象字段 | SLA 无 URL 类型 | URL 解析 extern 近似，字段以缓冲表示
packages/cxu/src/vendor/saVmPolicy.ts:328-338 | 可执行名分类三条 RegExp（python/node/bun） | SLA 无 RegExp | 手写后缀匹配（骨架 + 注释保留原正则语义）
packages/cxu/src/vendor/saVmPolicy.ts:468-480 | extractCommandArgv 的正则分词 /(?:[^\s"']+|"[^"]*"|'[^']*')+/g | SLA 无 RegExp | 引号感知字节扫描近似（骨架）
packages/cxu/src/vendor/saVmPolicy.ts:521-540 | globMatches 动态构造 RegExp（glob→正则） | SLA 无 RegExp/动态正则 | 直接 glob 匹配循环近似，批量期仅精确与 /** 前缀情形
packages/cxu/src/vendor/saVmPolicy.ts:482-570 | Set 去重、flatMap、.at(-1)、展开迭代等 JS 数组高阶操作 | SLA 无高阶数组 API | 定长数组 + 显式 for/while 循环近似，多处以 *_stub 占位待修复期展开
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:1-6 | node:crypto randomUUID、node:fs/promises 异步 fs | SLA 无对应 extern | id/时间戳改参数注入（now_ms/uuid8），fs 改同步 extern 近似
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:57 | LedgerEntry = PenaltyRecord | RewardRecord 联合 | SLA 无联合类型 | tagged struct（tag + 双子 struct + 原始 JSON 行）
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:92-99 | JevAuditFunction 函数类型返回 Promise | SLA 无一等函数/Promise | auditor_id 外部回调编号 + Context/Result struct
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:117-123 | deletePenalty/clearLedger(): never + throw Error | SLA 无异常/never | 返回错误状态码 1，消息保留在注释
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:138-162 | async readLedgerEntries + JSON.parse 动态解析 + try/catch 跳过坏行 | SLA 无 async/动态 JSON | 同步函数 + 状态码（DEFECT: async），行原文存 json_bytes、仅按 type 字段定 tag
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:167-174 | async appendLedgerEntry（mkdir recursive + writeFile flag a） | SLA 无 async fs | 同步 extern 追加近似（DEFECT: async）
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:186-248 | computeReputationStatus 中 Map/Set 与对象展开 {...entry} | SLA 无 Map/Set/展开 | 定长数组 + 线性扫描，status 字段就地改写
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:253-258 | async getReputationStatus | SLA 无 async | 同步 + 状态码（DEFECT: async）
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:263-297 | async recordPenalty + Date.now() + randomUUID().slice(0,8) 拼 id | SLA 无时钟/UUID extern | now_ms 与 uuid8 由调用方参数注入拼 id
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:303-375 | async submitRedemption + 可选 customJevAuditor 回调 | SLA 无 async/回调 | 同步 + auditor_id（DEFECT: async）
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:408-520 | async checkAccountabilityWriteGate + (policy as {...}) 类型断言读 accountability | SLA 无 async/类型断言 | 同步函数，policy 改 JSON 缓冲字段读取
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:525-600 | async runJevSupervisoryAudit + JSON.parse(redteam stdout) + try/catch fail-closed | SLA 无 async/动态 JSON/异常 | 同步 + JSON 缓冲字段读取，异常分支以状态码表示 fail-closed
packages/cxu/src/vendor/saVmAccountabilityLedger.ts:640-660 | extractForbiddenKeywordsFromRule 的全局 RegExp exec 循环 | SLA 无 RegExp | 触发词字节扫描近似（骨架）
packages/cxu/src/cli-doctor.ts:1-5 | node:child_process spawnSync / node:fs / node:os / node:path 导入 | sa_std 无等价 SLA 声明面 | process/fs extern 近似 + 注释登记
packages/cxu/src/cli-doctor.ts:7 | DoctorToolId 12 值字符串联合 | SLA 无字符串联合 | u64 标签 TOOL_*，文本形式存 ToolDef.id_text
packages/cxu/src/cli-doctor.ts:27-35 | ToolDef 的 string[] 字段（bins/envVars/extraDirs） | SLA 无变长数组 | JSON 缓冲 + count
packages/cxu/src/cli-doctor.ts:35-204 | TOOLS 表内平台条件展开 ...(process.platform==="win32" ? [...] : []) 与 env 依赖目录 | SLA 无模块级条件求值 | tools_init 在运行时按 DoctorState.platform/env 构建
packages/cxu/src/cli-doctor.ts:37 | 模块级 HOME = process.env.HOME || USERPROFILE || homedir() 与 npmPrefixDirCache 可变模块状态 | SLA 无模块可变状态/process.env | 收进 DoctorState struct 由 init 填充
packages/cxu/src/cli-doctor.ts:220-233 | pathDirs 中 Set 去重（win32 大小写不敏感键） | SLA 无 Set | JSON 列表 + 线性去重近似
packages/cxu/src/cli-doctor.ts:235-268 | isFile/isLaunchableFile 的 try/catch + statSync mode 位检查 | SLA 无异常 | fs stat extern 状态码近似
packages/cxu/src/cli-doctor.ts:270-293 | npmPrefixDir 中 spawnSync（两种调用形式含 shell:true） | SLA 无 spawnSync | 进程 extern（状态码 + stdout 缓冲）近似
packages/cxu/src/cli-doctor.ts:367-382 | fnmVersionBinDirs 的 readdirSync({withFileTypes}) Dirent | SLA 无 Dirent API | fs 目录 extern 近似（骨架）
packages/cxu/src/cli-doctor.ts:384-399 | whereBinary 的 spawnSync where.exe + 行扫描 | SLA 无 spawnSync | 进程 extern 近似（骨架）
packages/cxu/src/cli-doctor.ts:419-424 | parseVersionOutput 的 RegExp /(\d+\.\d+\.\d+)/ 与 slice 回退 | SLA 无 RegExp | 数字-点扫描近似（骨架）
packages/cxu/src/cli-doctor.ts:426-456 | probeVersion 的 spawnSync 多分支（pwsh/cmd.exe 调用约定、windowsVerbatimArguments） | SLA 无 spawnSync/平台选项对象 | 进程 extern 近似，分支逻辑以注释 1:1 保留
packages/cxu/src/cli-doctor.ts:551-560 | compareVersions 的 /\d+/g 提取 | SLA 无 RegExp | 数字段扫描近似（骨架）
packages/cxu/src/cli-doctor.ts:583-623 | printDoctor 的 console.log 模板串 + padEnd 对齐 + ANSI 常量插值 | SLA 无模板串/padEnd | print extern + 手工填充近似，正文在修复期逐行对齐
packages/cxu/src/cli-doctor.ts:636-739 | async promptDoctorInteractive：readline createInterface + Promise 化 rl.question + process.stdin/stdout.isTTY | SLA 无 async/readline/TTY API | 同步行读 extern 近似，TTY 标志入 DoctorState（DEFECT: async）
packages/cxu/src/cli-doctor.ts:745-748 | extractPowerShellScript 的整串 RegExp 匹配 | SLA 无 RegExp | 前缀/旗标手写扫描近似（骨架）
packages/cxu/src/cli-doctor.ts:750-817 | runInstall 的 spawnSync 安装执行 + 修改 process.env.PATH/PSModulePath | SLA 无 spawnSync/环境突变 | 进程 extern 近似，PATH 变更落 DoctorState/环境缓冲
packages/cxu/src/cli-doctor.ts:819-880 | commandExists 的 spawnSync where / command -v（shell:true） | SLA 无 spawnSync | 进程 extern 近似
packages/cxu/src/cli-doctor.ts:882-965 | installBunViaNpm 长超时 spawnSync(300000) 与 ensureUnzipAvailable 的 process.getuid + 包管理器探测链 | SLA 无 getuid/spawnSync | uid 改 extern 参数近似，其余以进程 extern 近似（骨架）
packages/cxu/src/vendor/saVmCodeGraph.ts:4 | import type { Node } from "web-tree-sitter"（AST 节点对象 API） | SLA 无 tree-sitter 节点类型 | 不透明句柄 struct TsNode + 访问函数族
packages/cxu/src/vendor/saVmCodeGraph.ts:10-64 | 接口中的数组/可选字段（Extracted*、CodeGraphOptions、CodeGraphNode） | SLA 无变长数组/可选字段 | 定长数组 + JSON 缓冲 + has 标志（容量按源码预算估）
packages/cxu/src/vendor/saVmCodeGraph.ts:69-85 | extractTypeIdentifiers 的递归闭包 walk 捕获 results 数组 | SLA 无闭包捕获可变状态 | 显式递归函数 + 输出缓冲参数近似
packages/cxu/src/vendor/saVmCodeGraph.ts:87-360 | extractTsClass/Interface/Imports、extractPython* 中 childForFieldName/child/text/startPosition 节点 API 与嵌套 walkCalls 闭包 | SLA 无该 API/闭包 | TsNode 访问函数族近似，walkCalls 逻辑以注释 1:1 保留（骨架）
packages/cxu/src/vendor/saVmCodeGraph.ts:67-68 | cleanSymbolName 的链式 RegExp replace | SLA 无 RegExp | 字节扫描近似（骨架）
packages/cxu/src/vendor/saVmCodeGraph.ts:362-460 | extractRegexFallback 的 4 条全局 RegExp + exec 循环 + 捕获组 | SLA 无 RegExp | 手写扫描器近似，批量期仅保留模式清单与结果形状（骨架）
packages/cxu/src/vendor/saVmCodeGraph.ts:462-660 | async extractFileInfo：动态 import("web-tree-sitter")、Parser.init wasm locateFile、try/catch 回退 | SLA 无动态导入/wasm 加载/async | tree-sitter extern 会话近似（DEFECT: async），回退路径保留
packages/cxu/src/vendor/saVmCodeGraph.ts:664-690 | resolveImportFilePath 的 existsSync 候选探测 + statSyncSafe 内 require("node:fs") | SLA 无 require/同步 fs 直调 | fs extern 近似
packages/cxu/src/vendor/saVmCodeGraph.ts:692-716 | findProjectSourceFiles 的 readdirSync Dirent + 递归闭包 walk | SLA 无 Dirent/闭包 | 显式栈遍历近似，错误静默跳过与源码一致
packages/cxu/src/vendor/saVmCodeGraph.ts:720-1090 | async buildScopedCodeGraph：Map/Set、队列闭包 addEdge/getFileAST 缓存闭包捕获 | SLA 无 Map/Set/闭包/async | 定长数组 + 索引队列 + 线性扫描（DEFECT: async），三模式分支逻辑以注释 1:1 保留
packages/cxu/src/vendor/saVmCodeGraph.ts:1094-1185 | formatAsDot 的 Map 分组 + 模板字符串拼接 | SLA 无 Map/模板串 | 缓冲追加近似（骨架）
packages/cxu/src/vendor/saVmCodeGraph.ts:1240-1344 | async nativeCodeGraph：Record<string, any> 入参、Date.now() 计时、writeFile 落盘、try/catch 结果对象 | SLA 无动态对象/async/异常 | rawInput 改 JSON 缓冲、now_ms 参数注入、状态码 + 结果 struct（DEFECT: async）
