# pkg-cxu fragment: saVmJev.ts + saVmTreeSitter.ts (bulk conversion defects)
packages/cxu/src/vendor/saVmJev.ts:1 | import node:path basename | sa_std 无 basename 调用点对应 | 本地 basename 字节扫描近似（交付/爆炸半径审计处）
packages/cxu/src/vendor/saVmJev.ts:31-34 | string toLowerCase/includes | SLA 无字符串方法 | (ptr,len) 子串字节扫描近似（大小写敏感）
packages/cxu/src/vendor/saVmJev.ts:41-50 | 模板字符串拼接 + replace(/\/+$/,"") 正则 | 无动态 string/regex | TextBuf 拼接 + 手工去尾斜杠近似
packages/cxu/src/vendor/saVmJev.ts:63-68 | split("/").pop() 可选链 | 无数组/可选链 | 扫描最后一个 '/' 取尾段近似
packages/cxu/src/vendor/saVmJev.ts:74-81 | unknown + Record<string,unknown> + ?? 链 | 动态对象无 SLA 等价物 | JSON 文本缓冲按 data/result 键查找近似
packages/cxu/src/vendor/saVmJev.ts:94-106 | 对象展开 {...questions,[id]:...} + Object.keys | 动态对象/计算键 | JSON 文本追加 _cf_pad 条目近似
packages/cxu/src/vendor/saVmJev.ts:111-127 | 对象字面量返回 Record | 动态对象 | 返回 JSON 文本缓冲
packages/cxu/src/vendor/saVmJev.ts:129-144 | interface 可选字段 + 模块级 let 可变全局 | SLA 无模块全局/可选字段 | JevGlobals struct + has_* 标志近似
packages/cxu/src/vendor/saVmJev.ts:154-166 | 函数类型 JevRelayExecutor = (payload)=>Promise<Response> + AbortSignal | 无函数类型/Promise/AbortSignal | has_relayExecutor 标志 + 宿主 extern 存根近似
packages/cxu/src/vendor/saVmJev.ts:176-181 | let jevSlotChain: Promise<void> 模块全局链 | 无 Promise/模块全局 | JevGlobals.je​vSlotChain_pending 标志近似
packages/cxu/src/vendor/saVmJev.ts:195-209 | process.env.JEV_MIN_INTERVAL_MS + Number/isFinite 解析 | Node env 无对应调用 | env extern 存根 + 回落 shared/default 近似
packages/cxu/src/vendor/saVmJev.ts:211-216 | process.env.JEV_THROTTLE_DISABLED | 同上 | 同上近似
packages/cxu/src/vendor/saVmJev.ts:222-236 | process.env.JEV_MAX_QUEUE + Math.floor/min | 同上 | 同上近似（整数钳制保留）
packages/cxu/src/vendor/saVmJev.ts:238-268 | async acquireJevSlot + Promise 链 + setTimeout + 返回闭包 ()=>void | async/定时器/闭包无等价物 | 同步状态码函数 + releaseJevSlot 显式调用近似
packages/cxu/src/vendor/saVmJev.ts:278-325 | normalizeChoiceOptions(unknown) 递归 + JSON.parse try/catch + 正则行首剥离 + Object.entries/forEach 闭包 | 动态对象/正则/闭包 | JSON 文本缓冲 -> StrRecord 近似
packages/cxu/src/vendor/saVmJev.ts:327-369 | normalizeChecklistItems 同上构造 | 同上 | 同上近似
packages/cxu/src/vendor/saVmJev.ts:371-400 | resolveJevCredentials 动态键探测 (typeof/别名键) + process.env 六项回退 | 动态对象/Node env | JSON 键查找 + 默认值近似
packages/cxu/src/vendor/saVmJev.ts:402-416 | truncateJevContext(unknown) + JSON.stringify/String() 强转 | 动态值强转 | JsonBuf + is_string 标志近似
packages/cxu/src/vendor/saVmJev.ts:418-515 | async executeJevCall + fetch/Response.text() + AbortController + setTimeout/clearTimeout + relayExecutor 闭包调用 | async/网络/定时器/闭包 | 同步状态码 + JevCallResult out 参数存根近似
packages/cxu/src/vendor/saVmJev.ts:418-515 | 联合返回类型 {ok:true;data}|{ok:false;error;status?} + throw/catch/finally | 无联合类型/异常 | ok 字段 + 状态码 + finally 改显式 release 近似
packages/cxu/src/vendor/saVmJev.ts:517-617 | async nativeJevChoose + throw SaVmInputError + JSON.stringify 输出对象 | async/throw/动态对象 | 同步 fn + rc=2 表校验失败 + JsonBuf 输出近似
packages/cxu/src/vendor/saVmJev.ts:619-735 | async nativeJevChecklist + 动态 questions 构建 (for Object.entries 闭包) | async/动态对象/闭包 | 同步 fn + JSON 文本组装近似
packages/cxu/src/vendor/saVmJev.ts:737-784 | async nativeJevEvaluate | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:790-807 | JEV_REDTEAM_RISKS/VERDICTS: Record<string,string> 常量 | 动态对象常量 | JSON 文本字面量保留原文 + 键查找近似
packages/cxu/src/vendor/saVmJev.ts:815-918 | async nativeJevRedteam | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:920-1045 | async nativeJevThinking + criteria 对象展开 {...thoughts,[key]:desc} | async/对象展开 | 同步 fn + JSON 合并近似
packages/cxu/src/vendor/saVmJev.ts:1067-1178 | async nativeJevRank + Set<string> 去重 + Array.map/filter 闭包 | async/Set/闭包 | 同步 fn + picked 数组扫描近似
packages/cxu/src/vendor/saVmJev.ts:1180-1297 | async nativeJevScope | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:1313-1468 | async nativeJevDispatch + 正则 /max_parallel\s*=\s*(\d+)/i + parseInt | async/正则 | 同步 fn + "max_parallel" 字节扫描近似
packages/cxu/src/vendor/saVmJev.ts:1470-1587 | async nativeJevConsistency | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:1609-1652 | splitPackedDoneSections 内部闭包 firstIndexOf + 正则标记剥离 /^...[:：|]?\s*/i | 闭包/正则 | 独立参数化函数 + 手工前缀剥离近似
packages/cxu/src/vendor/saVmJev.ts:1654-1790 | async nativeJevDone + loadRegressionCases 外部调用 + Array.filter 闭包 + basename | async/闭包/外部依赖 | 同步 fn + 审计列表 JSON 文本近似
packages/cxu/src/vendor/saVmJev.ts:1804-1927 | async nativeJevDiagnose | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:1943-2039 | async nativeJevEdgeCases + 内部 pick 闭包 | async/闭包 | 同步 fn + pick 逻辑内联两份近似
packages/cxu/src/vendor/saVmJev.ts:2061-2179 | async nativeJevBlastRadius + loadRegressionCases filter 闭包 | async/闭包 | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:2217-2338 | async nativeJevIntent | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:2353-2480 | async nativeJevNext | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:2498-2504 | JEV_PROGRESS_BAND_PERCENT: Record<string,number> | 动态对象常量 | JSON 文本字面量保留近似
packages/cxu/src/vendor/saVmJev.ts:2514-2655 | async nativeJevProgress | async | 同步 fn 近似
packages/cxu/src/vendor/saVmJev.ts:2664-2760 | async nativeJevMemory + 本地回退正则两组 (ephemeral/globalHint) | async/正则 | 同步 fn + 前缀/关键词字节扫描近似
packages/cxu/src/vendor/saVmJev.ts:2784-2857 | generateToolUsageRecommendation switch 返回 Record suggested_params | 动态对象 | 按 bestTool 选 JSON 文本近似
packages/cxu/src/vendor/saVmJev.ts:2859-2987 | async nativeJevWhich + {...JEV_DEFAULT_ENGINEERING_TOOLS} 对象复制 | async/对象展开 | 同步 fn + 目录 JSON 文本近似
packages/cxu/src/vendor/saVmJev.ts:全文件 | Date.now() 计时 (startedAt/latencyMs/durationMs) | SLA 无 Date.now 惯用法对应 | u64 毫秒参数透传近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1-9 | Node API: node:fs/module/path/url + createRequire(import.meta.url) + ts:any | sa_std 无对应物 | 路径 TextBuf + exists extern 存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:5 | web-tree-sitter Parser/Language/Node/Tree (WASM) | 无 sa_std 对应物 | 不透明 u64 句柄 + 存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:11-33 | OutlineSymbolKind 字符串联合类型 + OutlineSymbol 递归类型 (children?: OutlineSymbol[]) | 无联合/递归类型 | u64 kind 码 + 定长子索引数组近似
packages/cxu/src/vendor/saVmTreeSitter.ts:61-70 | Map<string,Language> languageCache + Map sourceFileCache (LRU 淘汰 keys().next()) | 无 Map | TsGlobals 定长键数组/计数近似
packages/cxu/src/vendor/saVmTreeSitter.ts:61-62 | let parserInitPromise: Promise<void> 单例 | async/Promise | parserInit_started 标志近似
packages/cxu/src/vendor/saVmTreeSitter.ts:71-81 | ts.createSourceFile (typescript 编译器 API, any) | 无 sa_std 对应物 | u64 SourceFile 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:83-119 | getTreeSitterWasmPath: require.resolve/process.cwd()/resourcesPath/existsSync | Node API | 候选路径文本组装 + exists 存根(false)近似
packages/cxu/src/vendor/saVmTreeSitter.ts:121-158 | getLanguageWasmPath 同上构造 | Node API | 同上近似
packages/cxu/src/vendor/saVmTreeSitter.ts:160-185 | async initTreeSitter + async IIFE + Parser.init({locateFile:()=>wasmPath}) 闭包 | async/WASM/闭包 | 同步 bool + 标志近似
packages/cxu/src/vendor/saVmTreeSitter.ts:187-236 | extname().toLowerCase() switch 取扩展名 | 无路径/字符串方法 | (ptr,len) 尾段扫描近似（函数存根）
packages/cxu/src/vendor/saVmTreeSitter.ts:238-261 | async loadLanguageForFile + Language.load(wasm) await + Map 缓存 | async/WASM/Map | 同步句柄函数近似
packages/cxu/src/vendor/saVmTreeSitter.ts:263-282 | tree-sitter Node parent 链遍历 + type.includes | WASM Node API | 句柄 extern 存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:284-309 | formatOutlineAsTree 递归内部闭包 printSymbols | 闭包/递归 | 独立 fn formatOutline_printSymbols 近似
packages/cxu/src/vendor/saVmTreeSitter.ts:311-317 | truncateSignature 正则 /\s+/g 折叠 | 正则 | 空白字节扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:319-444 | collectRustSymbols: Node child/childForFieldName/startPosition | WASM Node API | 句柄存根 + 逻辑注释 1:1 近似
packages/cxu/src/vendor/saVmTreeSitter.ts:446-549 | collectTsSymbols + 递归内部闭包 visitDeclaration | WASM Node API/闭包 | 独立 fn collectTsSymbols_visitDeclaration 近似
packages/cxu/src/vendor/saVmTreeSitter.ts:551-610 | collectPythonSymbols 递归自调用 + ?? lastNamedChild | WASM Node API | 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:612-654 | collectGoSymbols: Node API | WASM Node API | 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:656-686 | collectZigSymbols + 正则 /(?:pub\s+)?(?:const|var)\s+(\w+)/ + text.split | WASM/正则 | 关键词扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:688-731 | collectCppSymbols: Node API | WASM Node API | 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:733-768 | extractRegexOutline 三组 RegExp | 正则 | 前缀/关键词字节扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:770-855 | async extractFileOutline + parser.setLanguage/parse | async/WASM | 同步 + out 参数近似
packages/cxu/src/vendor/saVmTreeSitter.ts:857-929 | async renameSymbolInContent + 递归 walk 闭包 + Node startIndex/text | async/WASM/闭包 | 独立 walk fn + 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:931-978 | fallbackRegexRename 动态 new RegExp(\b...\b,"g") + exec 循环 | 动态正则 | 词边界字节扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:990-1124 | async findDefinitionInContent + walk 闭包 + Node 类型分发 | async/WASM/闭包 | 同步 bool + 独立 walk fn 近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1126-1157 | fallbackFindDefinition 动态 RegExp | 正则 | 关键词扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1192-1368 | async getSyntaxDiagnostics: TS parseDiagnostics + ts.getLineAndCharacterOfPosition/flattenDiagnosticMessageText (编译器 API) | async/TS 编译器 API | 同步 + out 参数存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1213-1300 | React Hook 规则检查: 嵌套闭包三层 + 正则 /^use[A-Z0-9]/、/^[A-Z]/、/^use[A-Z]/ + ts.is* 分发 | 闭包/正则/TS API | 独立 fn 三枚 + 前缀扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1330-1368 | collectTreeErrors 递归闭包 + Node isError/isMissing | 闭包/WASM | 独立 fn 近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1370-1474 | addImportToContent 两组 import 解析正则 + RegExp 动态构建 | 正则 | 文本解析近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1489-1770 | organizeImportsInContent: ts.isImportDeclaration/JSX 节点分发 + 内部接口 ParsedImport + collectUsedIdentifiers/getModulePriority 闭包 + localeCompare 排序 | TS 编译器 API/闭包 | SF 句柄 + 文本级 import 解析近似（修复阶段）
packages/cxu/src/vendor/saVmTreeSitter.ts:1785-1804 | JS_GLOBALS/TS_RESERVED: Set<string> 常量 | 无 Set | 常量文本列表 + 成员字节扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:1806-2067 | analyzeBlockScope: SF 位置映射 + ts.is* 分发 + walkBlock/fnSigText/walkOuter 三闭包 + useState 解构推断 + 正则 /^\d+$/、/[^A-Za-z0-9_$]/g | TS 编译器 API/闭包/正则 | SF 句柄 + 独立 fn 三枚近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2069-2174 | generateTargetImportsForBlock: TS API + node:path dirname/resolve/relative 路径重写 | TS API/Node path | 路径 extern 存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2176-2256 | generatePropsTypeImports: Set + 正则 idRe 全局扫描 + \b{name}\b | Set/正则 | 列表扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2258-2313 | generatePropsLocalTypes: Map decls + getText(sf) + 3 轮传递闭包 | TS API/Map | 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2323-2388 | splitEnvironmentalErrors: 懒缓存闭包 getDeclared + 正则 /Cannot find name '([^']+)'/、/Property '([^']+)'/ | 闭包/正则/TS API | 文本提取近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2411-2457 | createInMemoryLanguageService: ts.createLanguageService + LanguageServiceHost 对象字面量 (十余回调) + require node:fs/path | TS LanguageService 无对应物 | 不透明句柄存根 (返回 0/null) 近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2459-2496 | getSemanticDiagnosticsForContent: LS get*Diagnostics + Set 去重 + process.cwd() 默认参 | TS LanguageService/Node | 存根返回空集近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2498-2539 | autoFixMissingImportsInContent: LS getCodeFixesAtPosition + 正则 /import/i | TS LanguageService/正则 | 存根返回未应用近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2552-2590 | analyzeFileCoupling: TS 顶层语句分发 + 正则 /^[A-Z]/ | TS 编译器 API/正则 | SF 句柄存根近似
packages/cxu/src/vendor/saVmTreeSitter.ts:2592-2699 | buildExtractComponent: 组合四函数 + throw Error 拒绝语句块 + 正则多组 (JSX/声明名/扩展名) + node:path relative | throw/正则/Node path/TS API | rc + 消息缓冲 + 扫描近似
packages/cxu/src/vendor/saVmTreeSitter.ts:全文件 | console.warn 日志 (wasm 缺失/加载失败) | 无对应日志惯用法 | println 近似（存根中省略）
