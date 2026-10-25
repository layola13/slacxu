# web-ts-theme-waterfall 缺陷日志

格式：源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似

apps/web/src/theme/types.ts:1-19 | string 字面量联合类型 BuiltinThemeId | SLA 无联合类型 | 索引访问函数 builtin_theme_id_at + count
apps/web/src/theme/types.ts:21-22 | ThemeId = BuiltinThemeId \| (string & {})、ThemeMode | SLA 无开放字符串交叉类型 | (ptr,len) 字符串
apps/web/src/theme/types.ts:24-89 | 带可选字段的对象类型 ThemeBackgroundScene/ThemePlugin/Assets/Layout/ThemePalette | SLA 无可选字段/动态对象 | struct + 定长字节数组字段 + has_* 标志
apps/web/src/theme/index.ts:4-8 | export * barrel 再导出（含 .tsx 的 theme-provider） | SLA 无再导出语义 | @import 转发 + 注释说明
apps/web/src/theme/index.ts:10-12 | Array.filter/map 闭包链 installedThemePluginDefaults | SLA 无闭包/高阶函数 | for 顺序循环 + JSON 数组字面量
apps/web/src/theme/index.ts:14-28 | 类型谓词 value is ThemeId/BuiltinThemeId、Array.some 闭包 | SLA 无类型守卫 | 返回 bool + 逐字节比较循环；customPlugins.some 以 JSON 文本扫描占位
apps/web/src/theme/core/shadows.ts:1-34 | MUI Shadows 元组类型 import type + 25 元字符串数组 | 无 MUI 类型系统 | 索引访问函数 base_shadow_at（值逐字保留）
apps/web/src/theme/core/custom-shadows.ts:15-45 | 嵌套对象字面量常量 customShadows{light,dark} | 动态对象 | JSON 文本缓冲 + 键序访问函数
apps/web/src/theme/core/typography.ts:1-62 | MUI typography 对象字面量 + as const 字面量类型 | 动态对象/字面量类型 | TypographyVariant struct + 变体名/字重/行高访问函数，字段值注释保留
apps/web/src/theme/core/palette.ts:3-14 | 模板字符串、Array.map/join、闭包 mixChannel | 无模板字符串/高阶函数 | 缓冲区函数 mix + 独立 mix_channel 函数；十六进制格式化留修复期
apps/web/src/theme/core/palette.ts:16-35 | 元组返回 [number,number,number] \| null、parseInt、split/map、非空断言 ! | 无元组/联合 null/断言 | Rgb struct + ok 标志 + hex_digit_value/hex_pair_value
apps/web/src/theme/core/palette.ts:37-331 | Array.find 闭包、switch 返回对象字面量、themePaletteFromPlugin 动态拼装 | 动态对象 | 每 case 调色板逐字存为 JSON 文本 + 顺序 (ptr,len) 比较分发
apps/web/src/theme/core/components.ts:5-214 | MUI Components<Theme> CSS-in-JS 嵌套对象、alpha()、模板插值 ${}、& 选择器/伪元素 | 无 MUI/CSS-in-JS 对应物 | JSON 文本缓冲 + 13 个 section 名访问函数，全部样式事实以注释逐字保留
apps/web/src/theme/theme-config.ts:3-236 | ThemePlugin[] 对象数组字面量（19 个插件） | 动态对象数组 | 每插件一条 JSON 文本缓冲 + id/installedByDefault/dark 访问函数；重复 layout 以 L0 简写登记展开式
apps/web/src/theme/theme-config.ts:238-258 | 数字键对象 grey + as const | 无数字键对象/字面量类型 | grey_key_at/grey_value_at 索引访问函数
apps/web/src/theme/visual-tuning.ts:36-61 | 可选链 ?.、空值合并 ??、嵌套可选 layout/assets/preview | SLA 无 ?./?? | ThemePlugin 的 has_* 标志驱动分支
apps/web/src/theme/visual-tuning.ts:78-94 | unknown 类型、Number() 强转、Number.isFinite、isHexColor 正则 /^#([0-9a-fA-F]{3}\|{6})$/ | 无 unknown/强转/RegExp | (has_number,f64,is_finite) 见证参数 + 手工十六进制扫描
apps/web/src/theme/visual-tuning.ts:63-76 | Math.round（unitToPercent/clampThemePercent/clampThemeBlur） | f64 取整语义差异 | 返回未取整值并标 DEFECT，修复期 +0.5 截断
apps/web/src/theme/create-theme.ts:9-59 | MUI createTheme/alpha、Object.fromEntries、Array.from、as any、sdk-frontend 增强主题类型 import type {} | 无 MUI/高阶构造/类型断言 | JSON 组装 + for 循环 + info/success/warning/error/contrast/borderRadius 逐项访问函数
apps/web/src/waterfall/types.ts:1-2 | export * from "@cxu/sdk-frontend"（行契约在 SDK） | 外部 SDK 契约不在本单元内 | 按本单元全部调用点重建 ChatWaterfallRow/WorkbenchItem/Turn/TokenUsage 等 struct，payload/groupedRows 用 JSON 缓冲
apps/web/src/waterfall/chatRowEstimates.ts:4-36 | 可选参数 ?. 与 ?? 默认值、String.includes("```")、groupedRows?.length | 无可选链/includes | has_* 标志 + 调用方传入 has_code_fence；分组数用 grouped_rows_count
apps/web/src/waterfall/taskPlan.ts:18-51 | filter/map/filter 类型谓词闭包链、模板字符串 id/sourceKey、动态 payload.plan 遍历、orderWorkbench* 外部排序 | 无闭包/动态 JSON 遍历 | JSON 缓冲遍历（修复期），胜出规则（自尾扫描、首个 steps>0 的 plan）逐字保留于注释
apps/web/src/waterfall/taskPlan.ts:53-72 | RegExp replace(/[_-]+/g,"")、toLowerCase、unknown + String.trim（stringValue/normalizeTaskPlanStatus） | 无 RegExp/trim | 调用方预规整字符串 + 见证函数，按规整后长度分发状态
apps/web/src/waterfall/virtualRowMeasurements.ts:1-66 | DOM Element/ParentNode、querySelectorAll、dataset、getBoundingClientRect、offsetWidth/Height、isConnected、scrollTop、回调类型 VirtualRowResizer、forEach 闭包、模板选择器 | sa_std 无 DOM | 宿主提供的元素描述符 struct + 顺序循环；选择器/滚动由 SAX 宿主桥在修复期执行
apps/web/src/waterfall/waterfallRowRefreshQueue.ts:3-44 | class + private 字段、数组引用同一性 ===（applied/pending 比较） | SLA 无类/引用同一性 | struct + 函数族；引用同一性以 generation 计数器近似
apps/web/src/waterfall/agentPages.ts:34-52 | 泛型 <T extends AgentPageSession>、slice/spread 数组构造 selectAgentRailSessions | 无泛型 | 索引算术函数（limit/截断/追加 selected 的计数规则逐字保留）
apps/web/src/waterfall/agentPages.ts:59-102 | ReadonlyMap.get、Array.at(-1)、模板字符串、filter(Boolean).join("\n").toLowerCase()、对象字面量行构造 | 无 Map/动态对象 | JSON 缓冲 + 每 agent 一行计数函数，字段拼装规则逐字保留于注释
apps/web/src/waterfall/pendingRows.ts:24-53 | filter/map 闭包、satisfies、模板 key、toLowerCase、?? 默认值构造 payload | 无闭包/satisfies | JSON 缓冲 + mode 判定函数，行/条目字段规则逐字保留于注释
apps/web/src/waterfall/pendingRows.ts:55-125 | spread 拼接 [...a, ...b]、动态 payload Record 读取、String.trim/includes（pendingUserTextsMatch） | 无动态对象/trim/includes | 见证函数 + 相等比较已实现、includes 子串扫描留修复期；占位线程 pending-new-thread 规则保留
apps/web/src/waterfall/stableChatRows.ts:7-112 | 引用同一性记忆化（返回旧对象引用）、Map 按 key、对象 spread {...next}、索引访问类型 ChatWaterfallRow["item"]、every 闭包 | SLA 值语义无引用同一性 | generation 计数器 + rowsEqual/sameItem/sameFloor/sameStrings 相等函数族，判定规则逐项保留
apps/web/src/waterfall/chatRows.ts:1-8 | Record<string, T> 索引映射参数、函数类型 ChatRowFilter、默认闭包 () => true | 无 Record/函数类型 | JSON 文本缓冲 + 不透明 id
apps/web/src/waterfall/chatRows.ts:10-40 | Date.now() 默认参数、spread/slice/filter/map（selectTurnsForWaterfallMode post-compaction/recent-tools） | 无 Date.now/数组高阶操作 | now_ms 参数 + 计数/边界索引函数，筛选规则逐字保留于注释
apps/web/src/waterfall/chatRows.ts:56-243 | Map/Set 缓存 IncrementalChatRowsCache、forEach 闭包捕获可变 reasoningBuffer、join("\n\n")/trim、reverse().find() | 无 Map/Set/闭包捕获 | JSON 缓冲 + generation，推理缓冲拼接规则逐字保留于注释
apps/web/src/waterfall/chatRows.ts:245-460 | Map 按 key 复用、spread {...row}、Set（assistant header/compaction）、嵌套 flushRun 闭包的连续行折叠（tool/retry/plan/compaction 四组） | 无闭包/Map/Set | 计数函数 + 复用判定函数 reuseFinalizedRow/finalizedRowsEqual，折叠规则逐字保留于注释
apps/web/src/waterfall/chatRows.ts:461-576 | itemToRow 条件 spread ...(kind===... ? {...} : {})、?? 链 updatedAt、itemKind 的 toLowerCase().includes("error") | 无条件 spread/RegExp 式字符串操作 | itemKind/rowRole/rowWidth 按 (ptr,len) 全量分发已实现；contains_error 由调用方标志提供
apps/web/src/waterfall/chatRows.ts:578-754 | command/fileChange 分组行与 Set<string> 路径去重、reasoningText 的 payload.summary 联合（string\|array\|record）、summarizeReasoningEntry、safeJson 的 JSON.stringify try/catch | 无 Set/动态联合/JSON.stringify 动态值 | JSON 缓冲 + kind 计数函数，summary 分派与键序 [text,summary,content,message] 保留
apps/web/src/waterfall/chatRows.ts:756-1004 | RegExp 多处（normalizeReasoningMarkdown \*{4} 前瞻、compactLine \s+、cleanPreviewUrl 字符类含中文标点）、URL API new URL、matchAll 全局正则迭代（detectLocalPreviewUrl） | sa_std 无 RegExp/URL API | 分段字符串手术判定函数 cleanPreviewUrl 入参见证化；正则引擎与 URL 解析列为修复期前置能力

## 回绑扫尾（2026-10-26，sa_std TS 语义库）

参照清单：`_defects/SA_TS_INVENTORY.md`（ts_string.sa 的 @ts_str_*、ts_array.sa 的 @ts_arr_*、ts_math.sa 的 @ts_math_*、tree_sitter.sai 的 sa_ts_*、collections 的 btree_map/btree_set、async.sla/future.sa/sync 面）。
- 已回绑（代码层）：无。本批次候选均不确切，见下。
- 未回绑注记（修复阶段按 SA_TS_INVENTORY 评估）：String 15、Array 13、Math 1、RegExp 4、Map/Set 11 条（条目可跨类重复计数）。具体候选：theme/core/palette 的 parseHex 内 hex_digit_value/hex_pair_value 手工扫描——候选 @ts_str_hex_i0，但其入参形态（单字节 vs {ptr,len} 句柄）待核对，不硬绑；visual-tuning 的 isHexColor 手工十六进制扫描同候选；visual-tuning 的 Math.round 条目为 f64 取整，@ts_math_* 整数面不合；waterfall/taskPlan 的 String.trim/RegExp replace 条目现为调用方预规整，候选 @ts_str_trim（句柄模型）待评估；agentPages 的 slice 条目为计数算术函数，非数组本体操作。
- async：本日志无 async/Promise 条目，无归类改记。
- tree-sitter：本批次无命中（全部 175 个 web-ts .sla 扫描 0 处）。
