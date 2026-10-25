# sdk 单元缺陷日志（sdk-backend + sdk-frontend）

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## 通用（跨文件）

- sdk-backend/src/*.ts, sdk-frontend/src/*.ts | TS module exports (export const/function) | SLA 无模块导出命名空间概念，文件级符号直接平铺 | 标识符原样保留为全局 fn/let；同名 helper（如 PathBuf/path_append）在多文件重复出现，分阶段修复时需去重
- sdk-backend/src/*.ts | exported string const | SLA 无字符串型导出常量惯例 | 全局 string let 变量，消费者用 STR_PTR/STR_LEN
- sdk-backend/src/*.ts | string 返回值 | SLA fn 返回字符串不自然 | caller 提供 ByteBuf/PathBuf out 参数 + 返回状态码
- sdk-backend/src/*.ts | Node.js API (fs/os/path/crypto/process.env) | sa_std 无一一对应 extern | 按 std 命名风格声明 extern + 行内 DEFECT，路径拼接以字节拼接近似（无 normalize）

## sdk-backend

- runtimeDetect.ts:1-3 | typeof globalThis.Bun 运行时探测 | sa_std 无 Bun/Node 运行时探测 | 编译期常量 isBunRuntime=false / isNodeRuntime=true
- systemWebSearch.ts:2-4 | RegExp /\b(?:web\s+search|search|browser|bing|google|duckduckgo)\b/i | sa_std 无正则引擎；\b 词边界语义丢失 | 大小写不敏感子串扫描（contains_word_ci helper，原文无此 helper）
- remoteThreadRoute.ts:9-20 | type 对象 + CliBackend 交叉引用 @codex-ui/shared | 跨包类型引用无解析 | struct + 定长字节数组字段；cliBackend 存字符串缓冲
- runtimeClient.ts:14-22 | interface extends EventEmitter + Promise 方法 + JsonValue 动态类型 | SLA 无 interface/继承/EventEmitter/Promise | 函数指针表 struct CodexRuntimeClient + DEFECT 注释；JSON 值以 JSON 文本缓冲表示
- dataDir.ts:13-34 | existsSync/renameSync/homedir/join/resolve、默认参数、try/catch、env.CODEX_UI_DATA_DIR?.trim() | sa_std 无 fs rename/exists、path normalize、异常 | fs_len 成功当存在性；sa_fs_rename_file 占位 extern；try/catch 以状态码分支近似；trim 略去
- memoryFilePaths.ts:13-30 | createHash("sha256")、resolve/sep、unknown 参数、字符串联合类型 MemoryScope | sha256 调用形状未定；resolve 不规范化 | sa_sha256_hex 占位；toLowerCase 逐字节；MemoryScope 以 u64 标签（0=workspace,1=global）表示
- codexFallbackInstructions.ts:2 | 21KB 字符串字面量常量 | 无（字面量逐字保留，含 \r\n 转义） | 全局 string let
- saVmPaths.ts:1-57 | join/resolve homedir 路径族 + getSaVmToolHomeDir/getSaVmGlobalDataDir 等纯路径函数 | resolve 规范化、homedir、env 读取无对应 extern | PathBuf 拼接 + sa_env_get；分隔符固定 "/"，normalize 略去
- threadHistoryPaging.ts:1-38 | 泛型分页 + 对象展开 {...record} 记录序列化 | 无泛型；JSON 对象键枚举/展开不可得 | turn-id arena 偏移记账为占位（turn_ids_len 返回 0）；展开序列化可能产生重复键，待修复期以真实 JSON 对象模型重做
- bridgeEventLog.ts:1-89 | appendFileSync 日志追加 + MAX_ENTRY_BYTES 64KiB 截断 + ISO 时间戳 + 省略号 "…" | sa_std 无时钟 extern、无 append-file extern | 行缓冲 PathBuf 4096（小于 64KiB 上限）；时间戳以 epoch 字面量占位；省略号以 "..." 代替；sa_fs_mkdir_p/sa_fs_append_file 为占位 extern 名
- regressionCases.ts:1-98 | 用例记录的组件/标签匹配 + 排序 | 匹配谓词依赖动态记录结构 | component_matches/tags_match 为恒真桩；sort 循环体为空操作，待修复期补真实谓词
- runtimeDatabase.ts:1-63 | 动态 import() 加载 node:sqlite/bun:sqlite/better-sqlite3 驱动 | SLA 无动态加载、无 sqlite 驱动绑定 | loadNodeSqlite() 在批量期硬编码 false；驱动以 u64 标签表示（1=bun:sqlite, 2=node:sqlite, 3=better-sqlite3）；throw → 状态码 3
- service.ts:1-51 | 服务描述符对象 + 工厂函数 | 动态对象形态 | struct + JSON 文本表示，字段按源顺序保留
- server.ts:1-119 | 后端服务描述/能力对象 + PluginManifest 交叉引用 | 同上 | struct + 注释保留字段清单
- hostServices.ts:1-109 | 模块级单例 PluginHostServices 表的 set/get + 缺失时 throw | SLA 无模块单例语义对应物 | setPluginHostServices 只记录存在标志（表拷贝未实现）；tryPluginHostServices/pluginHostServices 不回拷表；throw → 状态码 4 + 错误文本常量
- goalContinuation.ts:1-120 | 自然语言「已完成」类正则匹配（中英双语）+ 否定结构 | sa_std 无正则；正则的有序否定结构丢失 | 子串共现近似：空模式回退可误报（如仅「已完成」二字、「all completed」无名词亦命中，TS 要求带名词）；否定以共现判定而非有序结构
- cliSpawn.ts:1-136 | child_process spawn 选项构造（Windows cmd.exe 包装、.ps1 → powershell -File）+ 引号转义 | 进程 argv 帧格式未定 | argv 以换行拼接近似传入 sa_std_process_spawn_bidi 占位形状；平台分支以常量近似
- openCodeSessionProtocol.ts:1-124 | randomUUID + Math.random + sha256 会话协议消息 | 无真随机源 extern | 以 splitmix64 近似（明确非随机）；sha256 走 sa_sha256_hex 占位形状
- imagePersistence.ts:1-137 | JSON 对象键删除（解构剔除）+ 递归持久化 + 128MiB 上限 | JSON 键枚举不可得，无法实现解构剔除 | strip_json_keys 当前逐字拷贝（剔除未真正执行）；persistImageApiResult 丢弃非 data 顶层字段（TS 为 ...rest 保留）；ByteBuf 上限 40960 远小于 128MiB；object 分支递归因键枚举缺失跳过
- index.ts(backend):1-169 | barrel 再导出 + PluginCapabilities/PluginManifest 类型 + ServerPluginRegistry 类（Map） | 无再导出命名空间；Map 无对应物 | barrel 以 @import 转发 + 注释；注册表以定长表（cap 64）近似，重复注册 → 状态码 5
- saVmTypes.ts:1-477 | SaVmRunInput 动作联合类型（数十个 action 变体）+ 大量 interface | 联合类型/接口无 SLA 对应物 | 动作联合成员以注释块逐项保留；SaVmRunInput 以 JSON 文本 struct 表示，字段清单延后到修复期逐 action 落地
- claudeSkillInventory.ts:1-375 | frontmatter 扫描 + 目录遍历列举 skill + SKILL.md 读取展开 | readdir 递归语义、符号链接、大小写规则无对应 | 以 sa_std_fs_read_dir_json 列举近似；作用域以 u64 标签（0=project, 1=user, 2=extra）；expandInvocation 的字符串替换逐字实现
- codexVirtualConfig.ts:1-634 | smol-toml parse/stringify + 可变 TomlTable 全键枚举 + 互斥文件锁 + Promise 写队列 | sa_std TOML 只读（点路径 getter），无枚举/变更/序列化；无 create-exclusive open/mtime/时钟/sleep extern | TomlTable 以 JSON 文本表示；valueAtPath 可经 sa_json 链读，setAtPath/deleteAtPath/merge/flatten/stringify 均为结构占位（明确标注）；parseKeyPath 以手写点路径解析近似（引号段经 JSON 反转义）；写队列 → 顺序调用 + done 标志；锁循环结构保留、原语为占位 extern
- codexVirtualConfig.ts:382-470 | VirtualConfigCodexRuntimeClient extends EventEmitter implements CodexRuntimeClient | 无类继承/EventEmitter | struct 包裹 inner client 句柄；三事件（status/message/stderr）转发仅记录未接线；config/* 方法分发逐字转换
- saVmWorkspaceSkill.ts:29-73 | 工具名映射正则（含 lookbehind (?<![\w.]) 与 (?:functions|default\.)+ 前缀链） | sa_std 无正则、无 lookbehind | 手写词边界扫描器近似：识别 mcp__sa_vm__sa_vm_run / sa_vm_run 词元并替换；前缀链消费规则近似
- saVmWorkspaceSkill.ts:102-172 | resolveJevMethodFlags：policy.tools 18 个 jev* 可选旗标 + 总开关回退 | 可选字段语义需 has/value 双表示 | JevToolsIn struct 以 18 组 has/val 字段表示；showJevEvaluate 不走回退规则的源语义已保留并注释
- saVmWorkspaceSkill.ts:239-382 | BUN_TS_VERIFIED_RECIPES 数据表（12 条，含多行源码字符串） | 大字符串数据表逐条转常量工作量与出错面大 | 结构体 BunTsVerifiedRecipe 已定义；数据表全文以注释块逐字保存在 .sla 末尾，待修复期提升为常量
- saVmWorkspaceSkill.ts:383-1704 | buildSaVmWorkspaceSkillMarkdown：约 1300 行模板文本 + ${} 插值 + 按旗标分节 | 模板分段/插值求值未做 | 旗标推导（policy → 24 个 allow*）与 enabledToolNames 组装顺序逐字转换；文档正文全文以注释块逐字保留，插值点待修复期分段
- saVmWorkspaceSkill.ts:1705-1955 | buildSaVmBunTsCheatsheetMarkdown / buildJevWorkspaceSkillMarkdown 模板 | 同上 | 骨架 + null 判定逻辑（JEV 无启用方法 → null）已转换；正文注释块逐字保留
- saVmWorkspaceSkill.ts:2086-2200 | 模块级 Map/Set 状态（skillSyncInflight/Failures、explicitSkillPolicyRoots、bootstrapInflight/LastOk）+ Promise 链串行化 + fire-and-forget bootstrap | 无 Promise/模块状态对应物 | 全部顺序同步执行；inflight/冷却去重坍缩为存在性检查 + SA_VM_BOOTSTRAP_DISABLED 开关；失败表以单槽标志近似
- saVmWorkspaceSkill.ts:1972-2080 | cleanup/forceUpdate 的 rm -rf、mkdir -p、writeFile 异步 fs 组合 | rm 递归/mkdir -p 无 extern | sa_fs_remove_dir_recursive / sa_fs_mkdir_p_ws 占位 extern；错误按源语义全部吞没

## sdk-frontend

- index.ts(frontend):1-85 | barrel 再导出 + PluginManifest 接口 + WebPluginRegistry 类（Map + #私有字段） | 同 backend index | @import 转发；注册表定长表 cap 64；重复注册 → 状态码 5；插件值以 JSON 文本存取
- web.ts:1-69 | WebPlugin/WebPluginDescriptor/ProviderLinkage/WaterfallMapping 接口族（readonly + 可选嵌套对象） | 接口无对应物 | 形状以注释 1:1 记录；字段经 JSON 文本 + sa_json getter 读取
- feature.ts:1-60 | SlotRenderer 函数类型 + 贡献接口 + WebShellPlugin extends 接口 | 函数值/接口继承无对应物 | 贡献以数据（JSON 文本）+ renderer fn-id 表示；渲染本身属宿主（SAX/web）职责，超出 SLA 表面
- workbenchTypes.ts:1-78 | WorkbenchItem/Turn/Image/File + ProjectRelay* 纯类型 | 动态 JSON 表示 | 字段清单注释 1:1 保留；payload: JsonValue 以 JSON 文本表示
- waterfallTypes.ts:1-110 | ChatWaterfallRow 递归类型（groupedRows 自引用）+ f64 金额字段 + 字符串联合 | 递归类型无 struct 对应物 | 仅 JSON 文本表示；联合以字符串缓冲 + 取值集注释表示
- jevConfig.ts:1-181 | localStorage 读写 + fetch POST 同步 + URL 解析 + unknown 输入 String() 强转 | 浏览器宿主 API 无 SLA 对应物 | load/save 改为调用方提供存储文本的契约，校验逻辑（enabled/apiKey/providerId 回读比对）逐字转换；POST 同步丢弃并标注；jevBaseHost 以手工 scheme/authority 扫描近似 URL 解析；normalizeMaxJevNudges 的 f64 取整以近似函数占位（f64_to_u64_approx 返回 0，明确标注）
- desktop.d.ts:1-42 | Window.codexUltraDesktop Electron 桥声明（Promise 方法族 + 事件监听） | DOM/Electron 宿主表面 | 接口清单以注释 1:1 记录，无行为可转换
- extend-theme-types.d.ts:1-11 | @mui/material/styles 模块增广（Theme.customShadows） | TS 模块增广无对应物 | 仅注释记录
