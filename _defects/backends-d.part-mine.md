# backends-d 缺陷日志（part: free-mode + vmtool-security，转换者 parent 单元）

backends/free-mode/src/manifest.ts:1-5 | JSON import assertion `import json with {type:"json"}` + PluginManifest 类型断言 | SLA 无 JSON 模块导入 | manifest 存为 plugin.json 文本缓冲（JsonBuf 式 struct），按需 sa_json_* 解析
backends/vmtool-security/src/manifest.ts:1-5 | 同上 | 同上 | 同上
backends/free-mode/src/server.ts:14-22 | class implements ServicePlugin 接口 + async start/stop + 模块级单例 `new FreeModeService()` | SLA 无类/接口/模块级可变单例 | struct + &Struct 函数族；start/stop 同步返回 i32 状态码；单例改 init 函数
backends/vmtool-security/src/server.ts:17-25 | 同上 | 同上 | 同上
backends/free-mode/src/free/compactionRelayRequest.ts:3-5 | asRecord(unknown) / Record<string, unknown> 动态对象 | SLA 无动态对象 | sa_json_parse 文档句柄（u64）+ sa_json_object_get_* 探针
backends/free-mode/src/free/compactionRelayRequest.ts:9-33 | JSON.parse try/catch、Object.keys().length、trim 语义 | sa_std 无 JSON 键枚举 API；异常机制不同 | parse 失败 doc==0 近似 catch；compaction 成员存在性以 object_get 代替键计数；trim 近似为非空检查
backends/free-mode/src/free/compactionRelayRequest.ts:38-73,75-77 | async + Web Fetch `Request`（headers.get/clone().json()/url） | sa_std 无 Fetch Request/Headers/URL 对象 | 调用方预读 header 值/body JSON/URL 为独立缓冲参数，函数同步化
backends/free-mode/src/free/compactionRelayRequest.ts:78-87,151-170 | new Headers / new Request / JSON.stringify({...body, model}) 对象展开 | sa_json 无 object-set/展开 API | 输出改为重写后 body JSON 文本缓冲；Request 构造留宿主侧（DEFECT 行内）
backends/free-mode/src/free/compactionRelayRequest.ts:89-127,129-147 | Set<string> 字面量集合 + 正则 /(?:^|[._:/-])(bash|shell|…)(?:$|[._:/-])/i | SLA 无 Set、无正则引擎 | 集合改字面量表 + 线性成员判定（表物化留修复期）；正则一半近似为 false 并登记
backends/free-mode/src/free/compactionRelayRequest.ts:180-211 | class + Map<string, State> + 默认参数 `now = Date.now()` | 无 Map、无壁钟默认参数 | 定容 64 项表 + 字节键查找；now 由调用方显式传入
backends/free-mode/src/free/compactionRelayRequest.ts:218-230 | ThreadRuntimeMetadata（shared 动态类型）+ 可选链 + trim/toLowerCase | 动态成员探针 | JSON 文档句柄 + object_get_string 探针（修复期）
backends/vmtool-security/src/security/saVmPolicy.ts:1-6 | node:path(isAbsolute/join/relative/resolve/sep)、node:fs statSync、node:os tmpdir、@cxu/sdk-backend codexUiDataDir | sa_std 无 node:path 对应；Windows 路径语义（盘符/sep）仅部分可表 | 本地位路径助函数（POSIX 式 + 小写 + 正斜杠的策略空间）；statSync→sa_std_fs 元数据；tmpdir/process.env→sa_env_get
backends/vmtool-security/src/security/saVmPolicy.ts:76-166 | SaVmPolicyConfig 动态配置 + `(config as any)` 强制转换 + 可选链深探 | 无 any/动态对象 | 配置改 JSON 文档句柄 + object_get 链，探针顺序保留
backends/vmtool-security/src/security/saVmPolicy.ts:229,385-387,538,560-567 | 正则：WINDOWS_DEVICE_NAMES、脚本名三式、env 名校验、${PROJECT} 替换 | 无正则引擎 | 字符类别可直扫者（env 名）注明可实现；其余 stub 返回 false 并逐一登记
backends/vmtool-security/src/security/saVmPolicy.ts:575-601 | globMatches 动态构造 RegExp（** → .*、* → [^/]*、转义元字符） | 无 RegExp 构造 | 语义可用直扫 glob 匹配器等价实现（修复期）；批量期返回 false
backends/vmtool-security/src/security/saVmPolicy.ts:251-262 | try/catch statSync 做只读放行 | 异常机制不同 | 状态码探针近似
backends/vmtool-security/src/security/saVmPolicy.ts:300-314 | new URL() 解析 + username/password/protocol/hostname/pathname | sa_std 无 URL 解析 extern | 修复期对字节缓冲手写解析；批量期 deny 骨架
backends/vmtool-security/src/security/saVmPolicy.ts:625-643, passim | Set 解构 [...new Set()]、Array.prototype.at(-1)、flatMap、展开运算符 | 无对应集合/高阶 API | 顺序保序去重/索引访问/显式循环改写（骨架已转）
backends/vmtool-security/src/security/saVmInterception.ts:17-23,28-30 | 正则三式判定 python/bun/node 可执行名 + replace/toLowerCase/split 链 | 无正则、无字符串链式 API | re_test(id) 统一 stub + 模式编号；basename 提取留修复期
backends/vmtool-security/src/security/saVmInterception.ts:122-210 | detectPowerShellAntiPattern 约 24 条正则分支链（每条返回固定指引文） | 无正则引擎 | 分支顺序保留、逐条 re_test(100+n) stub；指引文字面量表留修复期物化（源行号已注）
backends/vmtool-security/src/security/saVmInterception.ts:3,246 | @cxu/sdk-backend 的 isSystemWebSearchPermissionRequest | 跨单元 SDK 谓词未在本单元定义 | 声明为外部谓词（sdk-backend 单元转换）
backends/vmtool-security/src/security/saVmInterception.ts:47-101,219-289 | params: unknown 动态探查（多拼写优先级链 command/cmd/argv、tool/toolName/name/item.*、path/source/destination/oldPath/newPath/to/url/method/roots）+ Array.find 类型谓词 | 无动态对象/类型谓词 | JSON 文档句柄 + object_get 按源优先级探针；方法分发表以字符串等值链保留（顺序已注全）
backends/vmtool-security/src/security/saVmInterception.ts:238-245 | 数组 join(" ") 拼 fullCmd、String() 强转 | 动态值强转无对应 | 修复期以 args 缓冲拼接近似
