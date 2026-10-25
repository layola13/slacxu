# frontends 单元缺陷日志（批量转换第一波，只记录不修复）

范围：`frontends/` 全部 46 个源文件（42 .ts → .sla，4 .tsx → .sax），源行数 4,047。
产物内 `DEFECT` 行内标记共 140 处；本日志按类归并为 42 条。
格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

## A. SDK/共享类型在 SLA 侧无对应物（最大类）

1. 全部 17 个 `*/src/manifest.ts` | `import manifest from "../plugin.json"` + `PluginManifest` 类型（@cxu/sdk-frontend） | SLA 无 JSON 模块导入、无 SDK 的 PluginManifest 类型 | manifest.sla 以原始 JSON 文本缓冲（[u8;8192]+len）承载，运行时经 sa_std fs 读 `../plugin.json`；字段级类型推迟到 SDK 单元落地后回填
2. 全部 17 个 `*/src/web.ts` | `WebPlugin` / `WebFeaturePlugin` 类型（@cxu/sdk-frontend / @codex-ui/shared） | 同上 | web.sla 内本地镜像扁平 struct（字符串一律 (ptr,len) 对、null 以 PTR_NULL()+has 标志表达）；SDK 类型落地后应改为 @import 引用
3. `jev/src/jev/jevConfig.ts`（本单元仅 shim） | JevConfig 等 21 个导出 | 实现属 sdk-frontend 单元 | jevConfig.sla 只做 @import 转发 + 名称清单注释；本单元 jevClient/jevAutoJudge 经 `loadJevConfig` 绑定 shim 链读取
4. `jev/src/jev/jevClient.ts:1-40` | `JevConfig`、`JevQuestionMap = Record<string, JevQuestionSpec>` | 动态 Record 无 SLA 对应 | 问题集以 JSON 文本缓冲承载；JevEvaluateParams/JevProxySuccess 以 struct + has 标志表达可选字段
5. `muse/src/saVmChatActivity.ts:1-30` | `ChatWaterfallRow`（@cxu/sdk-frontend）、`Record<string, unknown>` payload | 同上 | row 简化为 (item JSON 文本, title) 两字段；payload 全程 JSON 文本 + sa_json 访问器
6. `free-mode/src/free/freeCompactionReadiness.ts:1-30` | `ProviderConfig`（@codex-ui/shared） | 同上 | providers 以已解析的 sa_json 数组文档传入，字段以视图 (ptr,len) 读取
7. 4 个 .tsx 全部 | MUI 组件（Box/Stack/Switch/TextField/Dialog…）与 @mui/icons-material 图标、`@codex-ui/shared` 常量（SA_VM_BUN_PROFILE_GROUPS 等）、`TranslateFn` | SAX 无 MUI 部件对应物、无图标集 | 标签名/属性名逐字保留；常量与 t() 文案以 bind 注释承载（VmToolsSettingsTab.sax、JevSettingsDialog.sax、EnhanceToolsDialog.sax、VmContextSavingsTab.sax）

## B. 异步 / 事件 / DOM 模型无对应

8. `jev/src/jev/jevClient.ts`（evaluateJev/testJevConnection） | `async`/`fetch`/`throw Error` | SLA 同步模型；sa_std 无已知通用 HTTP POST JSON 面 | 同步函数 + 状态码（40 = 非 2xx 带错误文本，41 = 传输失败）；HTTP 经声明的占位 extern `cxu_http_post_json`
9. `jev/src/jev/jevAutoJudge.ts`（全文） | `window.dispatchEvent(new CustomEvent(...))`、`addEventListener`、模块级监听注册/注销 | 无 DOM 事件总线 | 事件以 `JevEmittedEvent` 出参记录（kind 0/1/2）替代 dispatch；dispatch* 函数改为直调 handler；start/stop 监听改为在状态 struct 上登记 scope getter id
10. `jev/src/jev/jevAutoJudge.ts` | `getActiveThreadScopeKey` 回调注入 | 无一等函数/闭包 | 声明占位 extern `cxu_jev_scope_active_thread`
11. `jev/src/jev/jevTurnSnapshotDispatch.ts`（全文） | `setTimeout(..., 400)` 延迟快照、宿主 store/index 状态读取 | 无定时器；无宿主 store 访问面 | 函数体立即执行（SETTLE_MS 仅以常量 accessor 保留）；快照源经占位 extern `cxu_snapshot_source_get` 以 source_id + which 选择器取 JSON 文本
12. 4 个 .tsx 全部 | React hooks（useState/useEffect）、事件处理器、async handleSave/handleTest | SAX 无行为层（既定方言边界） | 结构 1:1 保留，hooks/处理器/派生值全部降为 `<!-- bind: ... -->` / `<!-- if: ... -->` 注释；每文件头注 `SAX: no behavior counterpart`
13. 17 个 `web.ts` 中 5 个 feature 插件 | `render` 闭包贡献（composer/settingsPanel 槽位） | 无闭包 | render_id + 返回 90 的 stub 函数占位

## C. 动态对象 / JSON 语义缺口

14. `jev/src/jev/jevQuestions.ts`（全文，593 行） | 嵌套对象字面量、`Record` 问题集、模板字符串拼接 JSON | 无动态对象 | 全部问题集/状态以 StrBuf 手工拼 JSON 文本；字面量逐字转录
15. `jev/src/jev/jevQuestions.ts`（buildJevState） | 数组 slice/filter 构造消息窗口 | 定长缓冲近似 | 环形窗口近似（首条 user + 末 2 user、末 3 assistant、末 8 tool 以扁平缓冲+长度表表达），original_request 锚点规则保留
16. `muse/src/saVmChatActivity.ts`（unwrapToolArgs） | 对象展开合并 `{...base, ...nested}`、候选键链 | 无对象模型 | ArgsView 文档栈（base + nested 文档列表），读取按后→前搜索复现覆盖语义；枚举/恒等不复现
17. `muse/src/saVmChatActivity.ts`（jevActivityDetail "evaluate"） | `Object.keys(questions).length` | sa_json 无键枚举能力 | record 形 questions 计数未实现（落 undefined 分支）；数组形精确
18. `jev/src/jev/jevQuestions.ts`（extractJevCollabBrief/Report） | 对 item 的 agentsStates 动态遍历 | 同上（无键枚举） | 该回退路径未实现，仅主路径（字段直读）转换
19. `free-mode/src/free/freeCompactionReadiness.ts`（全文） | `ProviderConfig[]` 数组方法 find/filter/some | JSON 文档以探测循环代替（arr_len 逐个 array_get 试探） | 语义等价但 O(n) 探测；`Array.isArray` 以 node != 0 近似（全单元同）
20. `jev/src/jev/jevClient.ts`、`muse/src/saVmChatActivity.ts` | `sa_json_object_get_f64` 被假定存在 | 已知 sa_std JSON 面仅核实 get_string/get_i64/get_bool | 按假定签名调用，修复阶段须核对/补齐 std 面

## D. 模块状态 / 容量模型

21. `jev/src/jev/jevAutoJudge.ts` | 模块级 `Set`/`Map` 单例（去重集、plan 内容表、nudge 计数） | 无模块可变单例 | 显式 `JevAutoJudgeState` struct 承载；Set 以 512×128B 定长表 + FIFO 淘汰（仅源中淘汰处淘汰），Map 以 64 条 × 6144B 定长表；溢出丢弃插入（源为无界）
22. 全部 .sla | 模块级 `export const` 常量（阈值、毫秒数、上限等） | SLA 无模块常量导出形态（按简报方言） | 一律 accessor 函数返回字面量；`JEV_MAX_AUTO_NUDGES`、`JEV_DEFAULT_BASE_URL`、`JEV_DEFAULT_MODEL` 的真值属 SDK 单元，jevClient 载荷构造处留标记占位（MAX 返回 0）
23. 17 个 `web.ts` | `export default` 插件对象 | 无默认导出 | builder 函数 `build_<CONST>WebPlugin(out) -> i32`

## E. 字符串 / 数值语义差

24. 全单元多处 | TS 字符串按 UTF-16 code unit 切片/计数 | 本转换按字节切片 | 中文/emoji 文本的长度与 slice 结果可与源不一致（jevQuestions、saVmChatActivity、freeCompactionReadiness 均有）
25. `jev/src/jev/jevQuestions.ts`（格式化） | `toFixed(1)`、`Math.round(x*100)` 百分比 | 无对应格式化 | sb_append_f64_1dp（+0.5 取整近似）、sb_append_pct 近似；边界进位可能差一位
26. `muse/src/saVmChatActivity.ts`（scalar_str） | JS `String(number)` 格式化（指数形、0.30000000000000004 等） | 无 JS 数值格式化 | 整数值按整数打印、其余 6 位小数去尾零近似
27. `free-mode/src/free/freeCompactionReadiness.ts`（checkFreeCompactionReadiness 两处 detail） | 模板字面量插值 provider/model id | 拼接点视图失效风险 | 插值段被平坦化丢弃（行内已注），文案主体保留（含中文）
28. `jev/src/jev/jevQuestions.ts`（parseJevVerdict） | 归一化 choice 字符串的所有权 | 视图指向局部缓冲 | dangling-view 风险已行内标注，修复阶段需改为调用方缓冲
29. 多处 | 正则表达式（JEV 动作 `^jev[_-]...`、补丁路径三式、collab 实质行判定） | SLA 无 regex | 全部手写扫描等价实现（jevActionKey、extractPathFromPatch、collabReportIsSubstantive）；`String.replace` 链（cleanAction 的 ^run_/^exec_/_file$ 剥离 + `_`→`-`）同为手写

## F. 结构性近似 / 待核语法（修复阶段首查）

30. 17 个 `manifest.ts`（fs 变体：free-mode/jev/relay-config/vmtool-security） | `readFileSync(new URL("../plugin.json", import.meta.url))` + `JSON.parse` 校验 | 无 import.meta.url | 字面相对路径；JSON.parse 校验省略（原文即 JSON 文本承载，与 A1 合并处理）
31. 全部 .sla | `@import "sa_std/fs.sai"` 等导入路径 | 路径按假定书写，未核实 std 实际布局 | 修复阶段统一核对
32. `jev/src/jev/jevTurnSnapshotDispatch.ts` | `[JevTurnSnapshotItem {...}; 256]` 数组重复字面量语法 | 语法为推测 | 待核实；另 else 分支的 console.warn 触发条件丢失了源中的 `else if (turnId)` 守卫（小分歧，行内已注）
33. `free-mode/src/free/freeCompactionReadiness.ts` | model 视图以 `p as u64`/`as ptr` 在 ptr 与 u64 间转换存入并行数组 | 转换合法性待核 | CompactionChannelOption 以 model_ptrs/models 双数组承载；另 checkFreeCompactionReadiness 的单 provider 分支以复制函数体 `list_options_for_single_provider` 代替源中 `[provider]` 单元素数组调用（源为单函数，此处结构重复）
34. `jev/src/jev/jevAutoJudge.ts` | `scope == 0` 空值比较、`loadJevConfig` 经 shim 链的绑定形态 | 待核 | 修复阶段核实
35. `muse/src/saVmChatActivity.ts`（candidate_from / parse_if_json） | `key in payload && payload[key] !== undefined`、isRecord 对数组的排除 | JSON null 亦计存在（与 TS 一致）；非对象候选（数组）被标 record | 读取行为等价，isRecord(array) 语义差已行内标注
36. `muse/src/saVmChatActivity.ts`（join_scalar_arr_sep） | `args.queries.join(", ")`、`args.args.map(String).join(" ")` 对非字符串元素 | 元素文本仅字符串可取 | 非字符串元素 String() 化未实现，修复阶段补
37. 4 个 .sax | 属性中的表达式 `{expr}` 形式未定 | 简报只定子节点表达式 → bind 注释 | 属性表达式逐字保留 `{...}`；sx 对象字面量空白规范化为单行（内容逐字）；FormControlLabel 的 control/label 元素型属性改为子元素 + 注释标记
38. `jev/src/jev/jevQuestions.ts` | SLA 结构文字量 `[Struct {...}; N]`、视图返回约定等多处方言细节 | 批量阶段按既有 SLA 样本书写，未编译验证 | 全部留待修复阶段首轮编译收敛

## G. 命名变形登记（简报允许、集中记录）

39. 全部 .sla | struct 字段名 camelCase → snake_case 并加 `_ptr/_len/_has` 后缀（如 jsonBytes → json_ptr/json_len） | SLA 命名习惯与 (ptr,len) 表达需要 | 函数名/常量名/标识符其余逐字保留
40. `muse/src/saVmChatActivity.ts`（first_string_value 等） | 键名数组参数 `keys: string[]` | 无字符串数组字面量确证 | 键表编码为单个 `\n` 连接字面量，调用点附键序注释
41. `jev/src/jev/jevAutoJudge.ts`、`jevQuestions.ts` | 文件内私有 helper 与源同名冲突规避（如本地 StrBuf/JsonBuf 多文件各自定义） | SLA 无模块私有命名空间确证 | 各文件本地定义同名 helper（内容按本文件需要裁剪），修复阶段可考虑抽公共
42. `free-mode/src/free/freeAutoCompactPreferences.ts` | `Math.round` 于 clamp 函数 | 无对应 | 以 +0.5 后取整拼写（f64 域），负值边界与 JS Math.round 语义差已行内注
