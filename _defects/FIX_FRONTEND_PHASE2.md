# FIX_FRONTEND_PHASE2 — 阶段 2（wasm 前端）开路交付（Agent AE）

日期：2026-10-27。场地：Colab 盒 `/content/bulk-fe2`（slacxu worktree，基点 bulk-convert `f95c84b`）+ `/content/sci-shim`（sci worktree，基点 main `ad25a2e8`，detached）。两仓均只本地提交、未推送、未建分支。

本线三件交付：① apps/web + frontends/ 全量普查（逐文件）；② ChatPanel.sax / Composer.sax 从同树 TSX 真值逐行重拉；③ frontends 余下 4 个失败 .sax 中最小的一个（VmContextSavingsTab）走通端到端 .sax→wasm 路径并裁决；④ sci emit_js/emit_c 补齐阶段 1 留账的 sa_json 13 + sa_regex 14 符号 shim。

先行结论（sala CXU 就绪度页 `content/01_overview/07_cxu_readiness.html` 对前端的原判「不具备」）在本线证据下**部分修正**：纯 sax 方言路径对 MUI 文件 indeed 关闭（设计如此，非缺陷）；但 react 组合路径（sa_plugin_react + sa_plugin_mui 的 material.sax）已能把真实 CXU 组件形态端到端打到 wasm（见 §3 探针）。原判中「airlock 桥在流式负载下未验」仍成立、未被本线推翻。

> 附带发现：在树的 `FIX_FRONTENDS.md`（frontends 域 N 的交付）在 §3 第 8 条中途被字面截断（文件内含 `[truncated 6185 chars]` 字样），§4–§6 已佚失。本交付的 frontends 普查以在树文件实测为准，不依赖该交付的佚失部分。

---

## 1. 普查（任务 1）

### 1.1 方法与分类口径

数据源：盒上脚本对每个文件计 lines / src_lines（同树 TSX/TS 真值行数）/ DEFECT 标记数 / 函数数 fns / 桩函数数 stub_fns / 代码行内逐字 TS 残段数 ts_rem（.sla）；.sax 计 bind / if / each 标记数。

.sla 机械分类（可由原始计数复现）：
- **(a) 真实现**：stub_fns = 0 且 DEFECT = 0 且 ts_rem = 0；
- **(c) 逐字 TS / 骨架残段**：ts_rem > 0；
- **(b) 显式登记接缝**：其余（有 DEFECT 登记或桩函数，但无逐字 TS）。

.sax 分类：ratio = lines / src_lines < 0.5 记 **skeleton**（骨架），否则 **structural**（结构镜像）。注意 .sax 的方言定位本身是界面镜像：文件头普遍带 `no behavior counterpart` 登记，行为（hooks/处理器/存储）以 DEFECT/bind 注释登记而非执行——这是 bulk 转换的既定约定，不是本线新发现的缺陷。真正的骨架化指标是 ratio 与 if/each 标记缺失（见 1.3）。

### 1.2 头条数字

**apps/web：180 .sla + 104 .sax = 284 文件**（自 bulk 转换 `5b76b75` 后未被阶段 1 触碰）。

- .sla 分类：**(a) 5 / (b) 158 / (c) 17**。全域 DEFECT 标记 3542，桩函数 529 / 1862 函数。
- (c) 名单（17）：逐字 TS 残段所在文件见附表（ts_rem 列 > 0）。最重：`useWorkbenchOps.sla`（ts_rem=7）、`topicTranscriptStore.sla`（ts_rem=1 但 DEFECT 230）。
- 最大文件：`codexClient.sla` 9839 行（src 5880，DEFECT 148）——(b)，是 web 域的逻辑中枢，阶段 2/后续修复的主要战场。

**frontends/：42 .sla + 4 .sax = 46 文件**（自 N 集成 `a32e810` 后未变，本线以 `git log a32e810..HEAD -- frontends/` 为空复核）。

- 机械口径下 42 个 .sla 全落 (b)：每文件都带至少一条文件头 DEFECT 登记（导入/行为面）。与 N 的人工普查对账：N 判 40 (a) + 2 (a)+已登记接缝（jevAutoJudge、jevTurnSnapshotDispatch）。两口径不矛盾：全域 ts_rem = 0、桩函数仅 9 / 214、DEFECT 130 多为文件头登记——语义上即 N 的「(a) + 登记接缝」。本表保留机械口径并在此注明对账结论。
- 4 个 .sax 全为 skeleton（ratio 0.31–0.46），即阶段 1 已知的 4 个 check 失败文件，§3 处置。

### 1.3 .sax 方言级普查发现

- apps/web 104 个 .sax 中 **每一个**的 `<!-- if:` 计数为 0、`<!-- each:` 计数也为 0（MonacoEditor.sax 的文件头例外与此无关）：条件与列表逻辑在 bulk .sax 里被统一压平（条件以 DEFECT 注释登记、元素无条件平铺、ternary 两支平铺为兄弟、.map 只出单实例且无标记）。这是方言级的结构缺失，不是个别文件问题——阶段 2 的 .sax 处置（无论走哪条编译路径）都必须先补结构标记或做真转换，不能直接拿 bulk .sax 喂编译器。
- skeleton 嫌疑（ratio 低）：ChatPanel 0.18、Composer 0.20、ChatRow 0.41（src 3706）、ChatWaterfall 0.23、ChatDiffView 0.17、PtyTerminalView 0.14、ThreeBackgroundScene 0.20。g3 已知骨架组 = ChatPanel + Composer（§2 重拉）；其余 5 个登记为阶段 2 同类工作。

### 1.4 逐文件普查表

见文末附表 A（apps/web 284 行 + frontends 46 行）。ChatPanel.sax / Composer.sax 两行为**重拉前**数值。

---

## 2. ChatPanel.sax / Composer.sax 逐行重拉（任务 1 后半）

### 2.1 方法

以同树 TSX 为唯一真值（ChatPanel.tsx 2960 行 / 88 顶层声明；Composer.tsx 3141 行 / 46 声明；声明清单由结构抽取脚本生成并逐名对账）。生成器（JSX 扫描器，盒上 /tmp/repull.py，本线留存）按 bulk .sax 既有约定输出：每组件 `<Component name="X">` 分节、`<state>` 槽（useState/useRef）、hooks/派生/处理器以 DEFECT/bind 注释登记（含 src 行号）、JSX 元素按源码顺序全量展开，属性字面量保留、表达式属性置空并 bind 登记。

相对 bulk 原稿的**结构修复**（本线重拉的核心增量）：
- 条件 `{cond && (<JSX/>)}`、`{cond ? A : B}` → `<!-- if: cond (src:L) -->` … `<!-- else -->` … `<!-- /if -->` 包裹，两支俱全；
- `.map(...)`（含块体 `=> { return … }` 与内三元体）→ `<!-- each: arr.map (src:L) -->` + 单实例 + `<!-- /each -->`；
- 字面文本节点恢复为元素内容（原稿普遍丢弃）；
- render-prop / 属性内 JSX（`startIcon={<…/>}`、`(v) => (<…/>)`）→ 元素后以 `<!-- attr-JSX: name (src:L) -->` 展开；
- 返回表达式型 return（`return xs.map(...)`）同样展开；
- IIFE 返回的 JSX 内联并 DEFECT 登记。

### 2.2 审计结果（脚本对账，TSX ↔ 旧 .sax ↔ 新 .sax）

| 指标 | ChatPanel 旧 | ChatPanel 新 | Composer 旧 | Composer 新 |
|---|---|---|---|---|
| 文件行数 | 542 | 1031 | 640 | 1434 |
| 标签实例覆盖（min 计数/TSX 总实例） | 0.923 | 0.907 | 0.841 | 0.885 |
| 缺失标签种类 | 17 | 17 | 33 | 22 |
| 条件/.map 行被标记 | 5 / 56 | 35 / 56 | 0 / 77 | 44 / 77 |
| 字面文本命中（去噪后） | 12 / 20 | 14 / 20 | 12 / 16 | 13 / 16 |
| 声明名缺失 | 0 | 0 | 0 | 0 |

诚实读法：ChatPanel 的标签**实例**覆盖微降（0.923→0.907）——旧稿把条件元素无条件平铺、部分分支重复计入，实例数虚高；新稿以结构标记换准确性（条件标记 5→35、文本 12→14、声明全覆盖），且缺失种类数持平。Composer 全面改善。两文件均已装回 bulk 树（checkpoint 提交，见 §6）。

### 2.3 残余未展开类（显式登记，不静默）

以下构造在两文件中仍只登记不展开，是阶段 2 真转换（react 方言化）时必须处理的面：
1. 深层嵌套回调/对象字面量内的 JSX（如菜单配置对象、columns 定义内的 render 函数）——bind 登记含表达式摘要与 src 行；
2. 条件/.map 行标记覆盖 35/56、44/77：未覆盖行多为非 JSX 条件（`.map(` 用于数据变换、条件用于样式/类名计算），已逐行在 bind/DEFECT 中出现但未加 if/each 标记——标记口径只加在产生元素的构造上；
3. 文本命中未满：剩余文本位于第 1 类未展开构造内，或与表达式交错被拆分（如 `{n} items` 型）；
4. 属性表达式一律置空 + bind：sx 对象、事件处理器、受控值都是行为面，按 .sax 约定登记——真转换时按 §3 的 react 方言逐项落位。

---

## 3. .sax 端到端路径裁决（任务 2，试件 VmContextSavingsTab.sax）

试件：frontends 余下 4 个失败 .sax 中最小者 `frontends/free-mode/src/free/VmContextSavingsTab.sax`（93 行，src TSX 304 行）。用到的 MUI 组件仅 6 个：Box、Stack、Typography、Switch、TextField、Alert。

### 3.1 路线一：纯 sax 方言（`sa sax build`）——对 MUI 文件关闭（设计如此）

四出处核查：
- SAX 白名单（sa_plugin_sax `src/sax/parser.zig:130-190`）：标签 40 个（布局 div/section/article/header/footer/main/nav/aside；文本 h1–h6/p/span/label/strong/em；交互 button/input/textarea/select/option/form；列表 ul/ol/li；媒体 img/video/canvas；表格 table/thead/tbody/tr/th/td；保留 Router/Page/Slot），事件 10 个（onclick/oninput/onchange/onsubmit/onkeydown/onkeyup/onfocus/onblur/onmouseenter/onmouseleave），属性 9 个（class/style/value/placeholder/disabled/id/width/height/renderer）。
- 对照实验 PASS：`sa sax build demos/counter.sax`（盒上 sa_plugin_sax 自带 demo）→ app.sa + app.wasm（3653 B）+ airlock.js + index.html 全链路通。（环境注记：`sa sax` 子命令需 `SA_PLUGIN_DEV=1` 且插件已 dev-install，本线已装，libsax.so md5 `9ddfe53d7c51a699e4a1561e49546ef6` 与构建产物一致；sax 仓 HEAD `1a88bf4`。）
- 试件 FAIL（钉死）：`sa sax build` 与 `sa sax check` 均报 `error[SA-SAX-CHECK]: UnexpectedToken while parsing <path>`（不带行号）。逐层根因：
  1. 文件根是带类型 props 的组件**定义式**（`<Row title={string} …>` 第 12 行、`<VmContextSavingsTab vmDraft={…}>` 第 37 行），不是方言要求的 `<Component name="…">` 形；
  2. 全部标签为 MUI/自定义（Box、Stack、Typography、Switch、Alert、TextField、Row），无一在 40 标签白名单内；
  3. 属性（sx、variant、color、spacing、direction、alignItems、data-testid、字符串形 onChange、inputProps…）在 9 属性白名单外（全文仅 `value` 一属性在白名单内）。
- 已知接缝（任务书既述，本线复核）：sax 的 sap.json 无 `kind`/`language_extensions` 且 `"interfaces": {}`，故 `sa check` 不按扩展名分发 .sax——只能走 `sa sax *` 显式子命令。

结论：纯 sax 路径是 HTML 子集方言，MUI 组件树不在其表达面内，**不是把 MUI 树砍成 div 就能「通过」**——那正是任务书禁止的 mutilate。本线未做此事。

### 3.2 路线二：react 组合方言（`sa react build --include mui/material.sax`）——打通

四出处核查：
- `sa_plugin_mui/mui/material.sax`：153 个 MUI 组件 / 3138 行，试件用到的 6 个组件**全部在内**（盒上 grep 逐个复核：Box@1732、Stack@2609、Typography@3123、Switch@349、TextField@549、Alert@2064）。
- 消费方式（sa_plugin_react demos + README）：`sa react build|check <file> --include mui/material.sax`；用户组件以大写标签组合，props 降为同名子 `<state>` 槽赋值（数值/字符串/布尔/对象即 JSON），子内容经 `<Slot/>` 投影，处理器为组件内 Sla `fn`/SA 标签，合成事件桥提供 checked/current_value 一族读取器。产物同为 app.wasm + airlock.js + index.html + app.sa。
- 本线已在盒上构建并 dev-install 两插件（react libreact.so 25,226,456 B；mui libmui.so 17,696 B；installed 目录现含 http-client/http-server/mui/node/react/sax/sla）。
- 对照实验：react_counter.sax → 全链路 PASS（app.wasm + airlock.js + index.html + app.sa）。mui 全组件 demo（mui_all_components_from_library.sax，153 组件单文件）→ app.sa 完整生成（7,943,594 B）后在 FFI 包装阶段以 **trap UnknownRegister（trap_code 1007）** 终止：生成 app.sa 第 9070 行 `@ffi_wrapper sax_muiallcomponents_init_ffi()` 内 `node_282 = call @sax_searchicon_mount(slot_281)` 的 callee 未声明——mui 库在全组件规模下 SearchIcon 图标挂载符号缺失，属库侧符号声明完整性问题，不是规模/内存上限（本条为构建最终输出的更正，取代中途半成品 app.sa 得出的 SIGABRT 形态），不影响小文件路径成立。
- 试件原稿 FAIL（钉死）：`sa react check` 同报 UnexpectedToken——与路线一同因：定义式根节点不是 `<Component name="…">` 形，解析期即止步，尚未及 MUI 解析。

### 3.3 适配探针：同一文件的 react 形态重写（/tmp 留存，未动 bulk 原稿）

把 VmContextSavingsTab 按其 TSX 真值（304 行）适配为 react 方言：两个 `<Component>`（Row + VmContextSavingsTab）、props 落 state 槽、extra 经 Slot 承载（内含 TextField）、全选 Switch 在主组件内直用并以 SA 标签接线（load/xor/store + @render()）、阈值 TextField 以 `@sax_event_target_value` 模式接线。

结果：**`sa react check` PASS；`sa react build` PASS** → app.wasm 25,829 B + airlock.js 30,979 B + index.html + app.sa（232 KB），全程约 1.5 s。

适配中确认的方言纪律与缺口（均为实测）：
1. **处理器 prop 不能向嵌套元素转发**：Row 内写 `<Switch onChange={onChange}/>`（以入参处理器名作值）→ `error[SA-REACT-CHECK]: SaxEventEscape in component Row at line 1, source: onChange`。方言的事件转发只发生在组件根元素（见 react_component_events demo）。后果：包装组件（如 Row）无法把父级处理器递给内部控件——阶段 2 必须二选一：(a) 方言扩展「事件 prop 引用作内层元素处理器值」；(b) 逐组件重构（把控件提升为 Slot 内容由父级直接接线，但 TSX 中 Switch 位于 Row 的横向 Stack 内、Slot（extra）位于其下，提升会改变布局结构）。**这是桥面清单第 1 项。**
2. **state 释放纪律**：组件尾必须以 `!name` 行释放**全部** state 字段（多/少都报错：缺 → `SaxStateLeak`，误列非 state 临时量 → `InvalidRelease`）。转换器必须机械生成此行。
3. **sx 表面未建模**：material.sax 的 Box 无 sx 槽，系统属性是逐个建模的（color/mode/className/hidden…）。TSX 里无处不在的 `sx={{ p, border, bgcolor, flexDirection, gap }}` 必须分解为系统属性/className，或给 material.sax 补 sx→style 的降解——登记为桥面项。
4. **条件元素 / 列表元素无已演示形态**：react demos 与 README 详尽演示了 props 值层面的三元/展开（对象 props 的 JSON 模板），但**元素级**条件渲染（TSX 的 `{cond ? <A/> : null}`、`{cond && <A/>}`）与 `.map` 列表渲染在 demos 中无对应形。探针因此未覆盖 Row 的 badge 条件与 extra 的条件渲染（TSX 中 extra 本就是 `checked ? … : undefined`）。登记为桥面项（需查 react 插件 tests 语料或向其提需求）。
5. data-testid：探针中 `<Switch data-testid="…">` 通过 check/build（透传或映射成立），与 TSX 契约一致，此项无缺口。
6. 数据模型差：TSX 的真值是父持有的 `vmDraft` 配置对象 + `setSavings` 不可变补丁；探针以标量 state 槽近似（locate/grep/all 三个开关 + threshold 字符串）。对象级 state（JSON ptr 串）在 composition demo 中有形（object props），但「嵌套配置对象的补丁式更新」需要一层状态管理约定，属阶段 2 转换设计，不是探针范围。

### 3.4 VmContextSavingsTab 逐标签差距表（对纯 sax 白名单）

| TSX 标签 | 出现 | sax 白名单 | react+material.sax |
|---|---|---|---|
| Box | 多处 | ✗ | ✓（无 sx 槽，见 3.3.3） |
| Stack | 多处 | ✗ | ✓（direction/spacing 有槽） |
| Typography | 多处 | ✗ | ✓（variant 有槽） |
| Switch | 10 | ✗ | ✓（checked 有槽；onChange 接线见 3.3.1） |
| Alert | 1 | ✗ | ✓（severity 有槽） |
| TextField | 5 | ✗ | ✓（label/value/type/size 有槽） |
| Row（本地组件） | 9 | ✗（自定义） | ✓（组合；处理器转发受限 3.3.1） |

属性面：sx、variant、color、spacing、direction、alignItems、justifyContent、data-testid、inputProps、label、type、size——纯 sax 仅 value 在册；react 路线下 variant/spacing/direction/label/type/size 有槽，sx/inputProps 无槽（桥面项）。

### 3.5 阶段 2 需要的 SAX/DOM 桥面最小清单

1. **事件 prop 向嵌套元素转发**（SaxEventEscape 解法）：允许组件内元素以入参处理器 prop 名作处理器值，或等价的显式转发语法。（react 方言扩展）
2. **元素级条件与列表渲染形态**：`{cond ? A : B}`、`{cond && A}`、`{xs.map(...)}` 在 react 方言中的正式形（或明确以组件拆分替代的规范）。
3. **sx 降解**：material.sax 主要容器组件补 sx（对象）→ 内联 style 的统一降解，或转换器侧的 sx 分解规则（布局类键 → 系统属性，其余 → style）。
4. **嵌套配置对象状态约定**：以 JSON 对象 state + 补丁函数的标准形承接 TSX 的 `useState(对象)` + 不可变更新（CXU 前端通式，非本文件独有）。
5. **state 释放行生成**：转换器机械 emit（纪律已实测，非桥面缺口，但工具必须做）。
6. **airlock 流式负载验证**：就绪度页原判保留——ChatPanel 级流式转录渲染在 wasm/airlock 下的吞吐与增量更新行为未验，阶段 2 早期必须做负载探针（本线未做）。
7. **mui 库图标挂载符号声明完整性排查**：mui_all_components 对照的最终失败形态为 app.sa 完整生成（7,943,594 B）后 FFI 包装阶段 trap UnknownRegister（1007）、`@sax_searchicon_mount` 未声明（生成 app.sa 第 9070 行，源出 demo 的 SearchIcon 用法）——需排查 mui 库图标挂载符号哪些有 mount 声明、哪些缺失。
8. （宿主侧，已知接缝）sax sap.json 补 kind/language_extensions 使 `sa check` 可按扩展名分发——属插件清单修订，非本线改动范围。

---

## 4. sci shim 前置（任务 3，sci-shim worktree，提交 a90f6f93）

### 4.1 同步清单（27 = 13 + 14）

sa_json 变更面 13（sci `6bc56b29` 引入，原生已有、便携发射器缺）：sa_json_object_set_string / _set_i64 / _set_f64 / _set_bool / _set_null / _set_node / sa_json_object_remove / sa_json_array_push_string / _push_i64 / _push_f64 / _push_bool / _push_null / _push_node。
sa_regex 扩展 14（W1 引入，原生 8→22）：sa_regex_match_all / _match_list_count / _match_list_at / _match_list_free / sa_regex_replace / _replace_all / sa_regex_buffer_data / _buffer_len / _buffer_free / sa_regex_split / _split_count / _split_ptr / _split_len / _split_free。

复核：27 个符号在改前 emit_js.zig / emit_c.zig 中**全部缺席**（无分类条目、无实现块，逐名 grep 计数 0）。

### 4.2 实现要点

- **emit_js**：isKnownShim +27；预置新增 match-list / replace-buffer / split-list 三张句柄表；collect/expand 辅助按 sa_std.zig 原生算法逐条镜像（空匹配进一字节、文末空匹配计入、`$n/$nn` 两位规则与越界字面保留、split 的 limit 含组计数且 0 = 不限——与 JS 的有意分歧照原生）；JSON 变更走既有句柄→JS 值模型，状态码与原生一致（空键 1、坏句柄/种类不符 2、remove 缺键 3、非有限 f64 1、set_node/push_node 深拷贝）。
- **emit_c**：分类表 + tag 枚举 +27（voids 掩码按「参数未用置位」的既有语义逐个核定，free 类照 regex_match_free 先例全置位）；目录新增 13 个 helper：JSON 子节点查找/追加/摘链/深克隆/子树退役（复用既有定长节点表），regex 的 REG_STARTEND 区间执行、匹配列表块（魔数 SALX）、替换缓冲块（SABX）、分割列表块（SAPX）——布局与既有 match 块（SAMX）同族。状态码同原生（注记：emit_c 既有 JSON **读取**面把坏句柄/未找到粗化为 1，与原生 2/3 有别——那是既有面，本线新面按原生 1/2/3 实现，分歧在此登记）。
- cflags 契约：原生把 cflags **原样**喂 regcomp（REG_EXTENDED=1 等 POSIX 位）；emit_c 照此；emit_js 既有映射（&2→i、&4→m）为 W1 既有近似（POSIX 的 4 实为 REG_NOSUB、8 才是 REG_NEWLINE），本线新增代码沿用家族记录形状，未改既有映射——在此登记为既有近似，待后续统一裁定。

### 4.3 门禁与验证（全实测）

| 项 | 结果 |
|---|---|
| `zig build`（emit_js 改后 / emit_c 改后各一次） | rc=0 / rc=0 |
| `zig build sa-std-unit` | rc=0 |
| `zig run tools/runtime_abi_check.zig -- --platform both` | PASS（652 public symbols） |
| nm libsa_std.a 逐符号 | 27/27 均为 T |
| 原生冒烟（SLA 程序用满 27 符号，build-exe） | **rc=0**（JSON 变更+回读、match_all 计数、$ 模板替换、split 组插入、状态码 3 等断言全过） |
| JS 实现直测（node，追加导出绕过 main 驱动生成模块的内部函数） | regex 14/14 数值精确；JSON 13/13 模型与状态码精确（含深拷贝快照语义：push_node 后的克隆不受源后续 remove 影响） |
| C 实现 | 发射产物含全部新面且可编译（rx 探针 C 编译成 4.2 MB 可执行）；端到端行为受 4.4 的既有缺陷阻塞，未取得独立行为证据——如实登记 |

### 4.4 顺带钉死的既有便携发射器缺陷（非本线引入、未在本线修，属阶段 2/编译器线）

两缺陷在**未打补丁的主树 host** 上以同一程序复现，排除与 shim 补丁的相关性：

1. **extern 结果 spill 误追踪**（emit_js 与 emit_c 同病）：SAB 中 `call r7 = @sa_regex_compile(...)` 后 `store r9, r7`（存结果，SAB 反汇编无误），但生成 JS 写成 `__sa_sp7 = BigInt(r5)`、生成 C 写成 `sa_store_u64(r7, r5)`——都存了陈旧的零寄存器而非调用结果（JS 中结果在 r3、C 中亦在 r3）。后果：任何「extern 结果需跨基本块 spill」的 SLA 程序在便携后端行为错误（原生 LLVM 后端正确）。最小复现：本线 /tmp/rx_smoke.sla（20 行）。
2. **out-param 产物消费触发 InvalidOperand**（双 host 同现）：二分结论——`sa_json_stringify(doc, &buf)` 单独可发射；一旦后续消费 &buf 产出的句柄（buffer_len/buffer_data）、或调用双 out-param 的 `sa_json_object_get_string(..., &v_ptr, &v_len)`，emit-js/emit-c 均报 `InvalidOperand in main`。与 1 同属便携发射器对 SAB 操作数形态的处理面。

另：解释器 `sa run` 对 sa_json_parse 等 extern 无 FFI 桥（`unsupported extern`），JSON/正则类程序的执行验证只能走 build-exe 原生路径——既有状态，登记备忘。

---

## 5. 阶段 2 剩余工作形状

1. **.sax 真转换线（主体）**：104 + 4 个 .sax 按 §3.5 桥面清单逐项落位到 react 方言；先决是桥面第 1、2、3 项（事件转发、元素级条件/列表、sx 降解）的方言裁定——建议先在 sa_plugin_react 侧查 tests 语料确认有无既有形，无则立方言扩展的小批实现+语料测试。ChatPanel/Composer 已完成结构重拉，可作转换输入；其余 skeleton 文件（ChatRow、ChatWaterfall、ChatDiffView、PtyTerminalView、ThreeBackgroundScene 等）需先同法重拉或直接转换时重建结构。
2. **apps/web .sla 逻辑面**：180 文件中 (b) 158 + (c) 17 是阶段 2 之后的修复阶段存量（与阶段 1 后端同法逐域推进）；WebSocket/流式转录（codexClient 9839 行）与 airlock 的配合是其中关键路径。
3. **不可移植表面登记**：Monaco/xterm/three/Web Workers 在就绪度页已判无对应面——阶段 2 需逐个裁定（宿主 JS 胶水嵌入 vs 功能替代），不在本线范围。
4. **便携发射器两缺陷**（§4.4）：属 sci 编译器线，建议按编译器缺陷纪律立项（最小复现已备：rx_smoke.sla / json_v2.sla），修复须带语料回归测试。这两缺陷不修，wasm/JS 产物对 extern 重的程序不可信——是阶段 2 的真实前置风险，优先级应高于新文件转换量。

## 6. 提交与工件

- sci-shim：`a90f6f93`（emit_js.zig +526、emit_c.zig +787；未推送）。门禁证据见 §4.3。
- bulk-fe2 checkpoint：ChatPanel.sax / Composer.sax 重拉（2 files, +2050/−767）；本文件随最终提交 `feat(frontend): phase-2 opening — census, g3 re-pull, sax path adjudication` 落入 `_defects/`。
- 盒上留存工件（/tmp，非交付物）：普查原始计数 census_out.json、重拉生成器 repull.py + audit_sax.py、react 适配探针 vmctx_probe2.sax 及其产物 /tmp/vmctx_out（app.wasm 等）、shim 冒烟族 shim_smoke/rx_smoke/rx_full/json_min/json_v1/v2/v3a（.sla/.sab/.js/.c）。

---

## 附表 A：逐文件普查（重拉前计数；分类口径见 §1.1）

### apps/web .sla（180）

| file | lines | src | fns | stub-fns | DEFECT | ts-rem | class |
|---|---|---|---|---|---|---|---|
| apps/web/scripts/build.sla | 68 | 104 | 5 | 5 | 11 | 0 | b |
| apps/web/scripts/preview.sla | 39 | 45 | 3 | 3 | 4 | 0 | b |
| apps/web/src/advancedRelayDirectory.sla | 48 | 53 | 2 | 0 | 5 | 0 | b |
| apps/web/src/app/agents/agentReadiness.sla | 30 | 13 | 1 | 0 | 4 | 0 | b |
| apps/web/src/app/appReducer.sla | 202 | 138 | 2 | 0 | 37 | 0 | b |
| apps/web/src/app/claude/claudeStartupStage.sla | 54 | 39 | 3 | 2 | 3 | 0 | b |
| apps/web/src/app/cli/cliBackendKind.sla | 104 | 99 | 15 | 13 | 1 | 0 | b |
| apps/web/src/app/cli/cliBackendLabels.sla | 118 | 88 | 3 | 1 | 17 | 0 | b |
| apps/web/src/app/cli/cliPlugins.sla | 52 | 48 | 3 | 1 | 2 | 0 | b |
| apps/web/src/app/cli/cliSkillGuides.sla | 100 | 72 | 2 | 0 | 12 | 0 | b |
| apps/web/src/app/cli/cliTogglePolicy.sla | 69 | 45 | 2 | 0 | 10 | 0 | b |
| apps/web/src/app/cli/pluginCatalog.sla | 73 | 62 | 3 | 1 | 5 | 0 | b |
| apps/web/src/app/cli/resolveCliBackendSelection.sla | 99 | 67 | 1 | 0 | 12 | 0 | b |
| apps/web/src/app/cli/resolveEffectiveTurnCliBackend.sla | 70 | 57 | 1 | 0 | 4 | 0 | b |
| apps/web/src/app/cli/saVmExecutionSpec.sla | 797 | 531 | 5 | 1 | 150 | 0 | b |
| apps/web/src/app/cli/useCliBackendPlugins.sla | 332 | 254 | 2 | 0 | 18 | 0 | b |
| apps/web/src/app/cli/useCliInstallations.sla | 240 | 189 | 3 | 0 | 17 | 0 | b |
| apps/web/src/app/cli/useCliPrerequisites.sla | 28 | 19 | 1 | 0 | 3 | 0 | b |
| apps/web/src/app/cli/useLazyCliBackendHistory.sla | 105 | 86 | 2 | 0 | 2 | 0 | b |
| apps/web/src/app/connection/stableEventProxy.sla | 17 | 8 | 1 | 1 | 2 | 0 | b |
| apps/web/src/app/connection/useStableSocketSubscription.sla | 59 | 42 | 1 | 0 | 7 | 0 | b |
| apps/web/src/app/conversationStatus.sla | 27 | 29 | 2 | 0 | 0 | 0 | a |
| apps/web/src/app/goals/goalResumeDecision.sla | 15 | 11 | 3 | 1 | 0 | 0 | b |
| apps/web/src/app/goals/goalState.sla | 106 | 91 | 7 | 2 | 8 | 0 | b |
| apps/web/src/app/goals/useGoalLifecycle.sla | 457 | 325 | 4 | 2 | 71 | 0 | b |
| apps/web/src/app/jev/useJevAutoNudgeOwner.sla | 168 | 133 | 1 | 1 | 14 | 0 | b |
| apps/web/src/app/modelCapacityRetry.sla | 65 | 59 | 3 | 1 | 7 | 0 | b |
| apps/web/src/app/pwa/serviceWorkerLifecycle.sla | 76 | 60 | 5 | 2 | 12 | 0 | b |
| apps/web/src/app/relayShare.sla | 201 | 150 | 9 | 0 | 26 | 1 | c |
| apps/web/src/app/reviewTurn.sla | 28 | 22 | 3 | 1 | 2 | 0 | b |
| apps/web/src/app/runtime/cliBackendKind.sla | 9 | 17 | 0 | 0 | 0 | 0 | a |
| apps/web/src/app/runtime/saVmWorkspaceSkill.sla | 47 | 69 | 1 | 0 | 8 | 0 | b |
| apps/web/src/app/runtime/useThreadRuntimeSelections.sla | 1064 | 843 | 22 | 3 | 129 | 0 | b |
| apps/web/src/app/settings/relayListPagination.sla | 31 | 28 | 1 | 0 | 1 | 0 | b |
| apps/web/src/app/sidechat/sideChatDuckDefaults.sla | 164 | 123 | 6 | 0 | 23 | 0 | b |
| apps/web/src/app/skills/skillScope.sla | 39 | 25 | 3 | 2 | 4 | 0 | b |
| apps/web/src/app/terminal/terminalPreferences.sla | 191 | 134 | 8 | 1 | 33 | 0 | b |
| apps/web/src/app/threadWriterConflict.sla | 16 | 10 | 1 | 0 | 1 | 0 | b |
| apps/web/src/app/threads/ThreadLoadQueue.sla | 76 | 48 | 4 | 2 | 9 | 0 | b |
| apps/web/src/app/threads/TranscriptRetention.sla | 23 | 16 | 2 | 1 | 2 | 0 | b |
| apps/web/src/app/threads/editConversation.sla | 46 | 35 | 3 | 1 | 5 | 0 | b |
| apps/web/src/app/threads/threadCatalog.sla | 385 | 276 | 23 | 8 | 61 | 0 | b |
| apps/web/src/app/threads/threadHistoryService.sla | 373 | 264 | 11 | 5 | 57 | 0 | b |
| apps/web/src/app/transcripts/failedTurnRecovery.sla | 124 | 98 | 7 | 1 | 13 | 0 | b |
| apps/web/src/app/transcripts/runtimeTurnProjection.sla | 397 | 301 | 18 | 3 | 47 | 0 | b |
| apps/web/src/app/transcripts/topicRuntimeIndex.sla | 96 | 73 | 7 | 1 | 8 | 0 | b |
| apps/web/src/app/transcripts/topicTranscriptStore.sla | 1635 | 1218 | 68 | 10 | 230 | 1 | c |
| apps/web/src/app/transcripts/transcriptProjection.sla | 131 | 101 | 6 | 2 | 24 | 1 | c |
| apps/web/src/app/transcripts/useTopicTranscriptRuntime.sla | 140 | 105 | 2 | 0 | 19 | 0 | b |
| apps/web/src/app/transcripts/useTranscriptStreamScheduler.sla | 152 | 143 | 8 | 3 | 6 | 0 | b |
| apps/web/src/app/turnInterruptRetry.sla | 144 | 110 | 8 | 2 | 21 | 0 | b |
| apps/web/src/app/turnRetryState.sla | 32 | 25 | 1 | 0 | 0 | 0 | a |
| apps/web/src/app/usage/topicUsageStore.sla | 655 | 427 | 22 | 3 | 106 | 0 | b |
| apps/web/src/app/usage/usagePricing.sla | 79 | 50 | 5 | 1 | 10 | 0 | b |
| apps/web/src/app/workbench/appConstants.sla | 234 | 162 | 1 | 0 | 8 | 3 | c |
| apps/web/src/app/workbench/appUtils.sla | 967 | 600 | 57 | 10 | 49 | 0 | b |
| apps/web/src/app/workbench/composerCoreContext.sla | 134 | 120 | 0 | 0 | 15 | 8 | c |
| apps/web/src/app/workbench/modelSelectionUtils.sla | 472 | 156 | 18 | 4 | 11 | 0 | b |
| apps/web/src/app/workbench/preferenceUtils.sla | 437 | 210 | 31 | 5 | 26 | 0 | b |
| apps/web/src/app/workbench/socketPipelineContext.sla | 104 | 98 | 0 | 0 | 17 | 14 | c |
| apps/web/src/app/workbench/sshUtils.sla | 349 | 168 | 15 | 1 | 19 | 0 | b |
| apps/web/src/app/workbench/useAccessRuntime.sla | 278 | 347 | 6 | 0 | 13 | 3 | c |
| apps/web/src/app/workbench/useCodexConfig.sla | 195 | 148 | 6 | 1 | 13 | 0 | b |
| apps/web/src/app/workbench/useComposerAssists.sla | 341 | 691 | 15 | 15 | 24 | 7 | c |
| apps/web/src/app/workbench/useComposerPipeline.sla | 261 | 682 | 4 | 3 | 10 | 2 | c |
| apps/web/src/app/workbench/useComposerRuntime.sla | 420 | 610 | 13 | 11 | 17 | 0 | b |
| apps/web/src/app/workbench/useComposerSend.sla | 256 | 557 | 5 | 4 | 14 | 7 | c |
| apps/web/src/app/workbench/useComposerThreadStart.sla | 219 | 343 | 8 | 4 | 15 | 0 | b |
| apps/web/src/app/workbench/useFreebuffSession.sla | 200 | 123 | 10 | 2 | 18 | 1 | c |
| apps/web/src/app/workbench/useGoalRuntime.sla | 303 | 550 | 8 | 5 | 12 | 1 | c |
| apps/web/src/app/workbench/useHistoryState.sla | 106 | 49 | 9 | 1 | 5 | 0 | b |
| apps/web/src/app/workbench/useImmersiveComposer.sla | 147 | 139 | 8 | 0 | 8 | 1 | c |
| apps/web/src/app/workbench/useLoadBasics.sla | 154 | 206 | 9 | 1 | 16 | 1 | c |
| apps/web/src/app/workbench/useMembersAdmin.sla | 103 | 110 | 13 | 0 | 10 | 0 | b |
| apps/web/src/app/workbench/useNewSessionFlow.sla | 319 | 676 | 32 | 4 | 23 | 0 | b |
| apps/web/src/app/workbench/useOfficialLogin.sla | 136 | 148 | 10 | 0 | 17 | 0 | b |
| apps/web/src/app/workbench/usePreferencesSync.sla | 152 | 371 | 11 | 1 | 10 | 1 | c |
| apps/web/src/app/workbench/useProviderTest.sla | 81 | 92 | 6 | 0 | 8 | 0 | b |
| apps/web/src/app/workbench/useProvidersRuntime.sla | 272 | 545 | 28 | 2 | 32 | 0 | b |
| apps/web/src/app/workbench/useSelectionRuntime.sla | 206 | 426 | 17 | 8 | 13 | 0 | b |
| apps/web/src/app/workbench/useSessionBootstrap.sla | 182 | 293 | 27 | 5 | 16 | 0 | b |
| apps/web/src/app/workbench/useSessionRecovery.sla | 122 | 89 | 14 | 3 | 11 | 0 | b |
| apps/web/src/app/workbench/useSessionState.sla | 46 | 23 | 5 | 0 | 3 | 0 | b |
| apps/web/src/app/workbench/useSettingsAndInstall.sla | 254 | 118 | 8 | 8 | 39 | 0 | b |
| apps/web/src/app/workbench/useSettingsRuntime.sla | 738 | 580 | 4 | 4 | 25 | 0 | b |
| apps/web/src/app/workbench/useSideChatTabs.sla | 442 | 186 | 12 | 12 | 73 | 0 | b |
| apps/web/src/app/workbench/useSocketPipeline.sla | 1956 | 673 | 7 | 7 | 53 | 0 | b |
| apps/web/src/app/workbench/useSshWorkspace.sla | 214 | 123 | 2 | 2 | 28 | 0 | b |
| apps/web/src/app/workbench/useSshWorkspaceLifecycle.sla | 203 | 105 | 4 | 4 | 24 | 0 | b |
| apps/web/src/app/workbench/useTaskTabsRuntime.sla | 880 | 564 | 5 | 5 | 87 | 0 | b |
| apps/web/src/app/workbench/useTaskTabsSplit.sla | 971 | 582 | 18 | 18 | 96 | 0 | b |
| apps/web/src/app/workbench/useTaskTabsState.sla | 200 | 105 | 2 | 2 | 37 | 0 | b |
| apps/web/src/app/workbench/useTerminalSessions.sla | 688 | 311 | 13 | 13 | 97 | 0 | b |
| apps/web/src/app/workbench/useThemePluginActions.sla | 155 | 68 | 5 | 5 | 25 | 0 | b |
| apps/web/src/app/workbench/useThreadOpening.sla | 594 | 290 | 12 | 12 | 72 | 0 | b |
| apps/web/src/app/workbench/useThreadWorkspaceRuntime.sla | 492 | 313 | 8 | 8 | 70 | 0 | b |
| apps/web/src/app/workbench/useThreadsHistory.sla | 840 | 440 | 17 | 17 | 117 | 0 | b |
| apps/web/src/app/workbench/useToolingPlugins.sla | 846 | 405 | 17 | 17 | 116 | 0 | b |
| apps/web/src/app/workbench/useTurnOps.sla | 338 | 193 | 6 | 6 | 42 | 0 | b |
| apps/web/src/app/workbench/useWebPreview.sla | 95 | 38 | 3 | 3 | 19 | 0 | b |
| apps/web/src/app/workbench/useWorkbenchEffects.sla | 659 | 574 | 9 | 9 | 49 | 0 | b |
| apps/web/src/app/workbench/useWorkbenchOps.sla | 779 | 388 | 15 | 15 | 94 | 7 | c |
| apps/web/src/app/workbench/useWorkspaceFiles.sla | 309 | 155 | 6 | 6 | 38 | 0 | b |
| apps/web/src/app/workbench/useWorkspaceGitFiles.sla | 334 | 164 | 6 | 6 | 43 | 0 | b |
| apps/web/src/app/workbench/useWorkspacePicker.sla | 45 | 16 | 1 | 1 | 7 | 0 | b |
| apps/web/src/app/workspace/rightWorkspaceContext.sla | 99 | 59 | 4 | 2 | 18 | 0 | b |
| apps/web/src/app/workspace/useOpenFileTabs.sla | 177 | 123 | 3 | 2 | 20 | 0 | b |
| apps/web/src/app/workspace/useWorkspaceFileMutations.sla | 248 | 159 | 4 | 1 | 50 | 0 | b |
| apps/web/src/chatTypography.sla | 41 | 23 | 5 | 0 | 4 | 0 | b |
| apps/web/src/clientPlatform.sla | 45 | 34 | 6 | 4 | 4 | 0 | b |
| apps/web/src/codexCliRecovery.sla | 26 | 25 | 2 | 0 | 3 | 0 | b |
| apps/web/src/components/chatgpt-shell/chatgpt-mui-theme.sla | 50 | 84 | 2 | 1 | 3 | 0 | b |
| apps/web/src/components/workspaceDrag.sla | 54 | 51 | 5 | 4 | 4 | 0 | b |
| apps/web/src/composer/PendingSendGate.sla | 53 | 29 | 8 | 4 | 4 | 0 | b |
| apps/web/src/composer/composerMenuShortcuts.sla | 9 | 3 | 1 | 1 | 1 | 0 | b |
| apps/web/src/composer/composerSlashCommands.sla | 102 | 121 | 7 | 6 | 9 | 0 | b |
| apps/web/src/composer/composerSubmission.sla | 21 | 9 | 1 | 0 | 3 | 0 | b |
| apps/web/src/composer/sendReconcile.sla | 67 | 118 | 6 | 5 | 7 | 0 | b |
| apps/web/src/contextUsage.sla | 54 | 67 | 4 | 0 | 2 | 0 | b |
| apps/web/src/free/useFreeCompaction.sla | 188 | 472 | 9 | 9 | 17 | 2 | c |
| apps/web/src/free/useFreeCompactionSelection.sla | 167 | 242 | 14 | 9 | 9 | 0 | b |
| apps/web/src/goalContinuation.sla | 58 | 112 | 10 | 4 | 8 | 0 | b |
| apps/web/src/groupCollection.sla | 158 | 427 | 26 | 15 | 10 | 0 | b |
| apps/web/src/historyExport.sla | 55 | 104 | 6 | 5 | 7 | 0 | b |
| apps/web/src/historySearch.sla | 125 | 304 | 12 | 4 | 8 | 0 | b |
| apps/web/src/i18n.sla | 45 | 100 | 6 | 2 | 5 | 0 | b |
| apps/web/src/imageCommand.sla | 26 | 44 | 1 | 1 | 4 | 0 | b |
| apps/web/src/imageRuntime.sla | 43 | 80 | 6 | 3 | 4 | 0 | b |
| apps/web/src/imageThreadHistory.sla | 43 | 109 | 5 | 5 | 5 | 0 | b |
| apps/web/src/launchAdapters.sla | 57 | 266 | 6 | 1 | 2 | 0 | b |
| apps/web/src/mobile/useIsMobile.sla | 16 | 16 | 1 | 0 | 1 | 0 | b |
| apps/web/src/modelReasoning.sla | 43 | 110 | 7 | 3 | 4 | 0 | b |
| apps/web/src/mui-icons-material.d.sla | 10 | 6 | 0 | 0 | 1 | 0 | b |
| apps/web/src/newChatWorkspacePolicy.sla | 10 | 5 | 1 | 0 | 1 | 0 | b |
| apps/web/src/onboarding/steps.sla | 67 | 103 | 4 | 2 | 5 | 0 | b |
| apps/web/src/performance/animationBudget.sla | 48 | 43 | 5 | 3 | 4 | 0 | b |
| apps/web/src/performance/lowFpsDiagnostics.sla | 114 | 216 | 5 | 3 | 5 | 0 | b |
| apps/web/src/performance/topicDiagnostics.sla | 76 | 62 | 4 | 3 | 2 | 0 | b |
| apps/web/src/permissionPresetDisplay.sla | 14 | 28 | 2 | 2 | 1 | 0 | b |
| apps/web/src/planContinuation.sla | 24 | 25 | 3 | 1 | 3 | 0 | b |
| apps/web/src/promptDisplay.sla | 21 | 32 | 2 | 2 | 1 | 0 | b |
| apps/web/src/ptyDataBus.sla | 29 | 52 | 4 | 1 | 2 | 0 | b |
| apps/web/src/ptyTerminalRegistry.sla | 46 | 90 | 8 | 2 | 4 | 0 | b |
| apps/web/src/relayNameValidation.sla | 19 | 15 | 3 | 2 | 2 | 0 | b |
| apps/web/src/remoteTurnErrors.sla | 15 | 38 | 1 | 1 | 2 | 0 | b |
| apps/web/src/serverRequests.sla | 40 | 64 | 5 | 3 | 3 | 0 | b |
| apps/web/src/setup-guide/setupGuideState.sla | 24 | 22 | 3 | 3 | 2 | 0 | b |
| apps/web/src/state/codexClient.sla | 9839 | 5880 | 408 | 11 | 148 | 0 | b |
| apps/web/src/state/codexConfigSettings.sla | 1582 | 629 | 70 | 1 | 19 | 0 | b |
| apps/web/src/state/recentThreadTranscripts.sla | 139 | 22 | 7 | 0 | 4 | 0 | b |
| apps/web/src/state/retrySettings.sla | 34 | 10 | 4 | 0 | 2 | 0 | b |
| apps/web/src/state/workbenchTimeline.sla | 1091 | 394 | 44 | 1 | 18 | 0 | b |
| apps/web/src/storageNamespace.sla | 15 | 20 | 1 | 0 | 2 | 0 | b |
| apps/web/src/taskNotifications.sla | 67 | 138 | 9 | 2 | 6 | 0 | b |
| apps/web/src/taskTabs.sla | 137 | 264 | 27 | 11 | 5 | 0 | b |
| apps/web/src/theme/core/components.sla | 56 | 214 | 4 | 0 | 2 | 0 | b |
| apps/web/src/theme/core/custom-shadows.sla | 46 | 45 | 3 | 0 | 1 | 0 | b |
| apps/web/src/theme/core/palette.sla | 148 | 331 | 11 | 0 | 6 | 0 | b |
| apps/web/src/theme/core/shadows.sla | 41 | 34 | 4 | 0 | 1 | 0 | b |
| apps/web/src/theme/core/typography.sla | 70 | 62 | 6 | 0 | 2 | 0 | b |
| apps/web/src/theme/create-theme.sla | 59 | 59 | 7 | 0 | 2 | 0 | b |
| apps/web/src/theme/index.sla | 57 | 28 | 3 | 0 | 4 | 0 | b |
| apps/web/src/theme/theme-config.sla | 82 | 258 | 7 | 0 | 2 | 0 | b |
| apps/web/src/theme/types.sla | 107 | 89 | 2 | 0 | 3 | 0 | b |
| apps/web/src/theme/visual-tuning.sla | 110 | 94 | 11 | 2 | 4 | 0 | b |
| apps/web/src/threadRuntimePermission.sla | 29 | 32 | 2 | 0 | 1 | 0 | b |
| apps/web/src/threadSelection.sla | 33 | 37 | 3 | 0 | 2 | 0 | b |
| apps/web/src/utils/recentWorkspaces.sla | 91 | 165 | 9 | 8 | 6 | 0 | b |
| apps/web/src/waterfall/agentPages.sla | 115 | 111 | 11 | 2 | 7 | 0 | b |
| apps/web/src/waterfall/chatRowEstimates.sla | 88 | 41 | 2 | 0 | 2 | 0 | b |
| apps/web/src/waterfall/chatRows.sla | 385 | 1004 | 47 | 4 | 21 | 0 | b |
| apps/web/src/waterfall/pendingRows.sla | 76 | 125 | 7 | 1 | 4 | 0 | b |
| apps/web/src/waterfall/stableChatRows.sla | 86 | 112 | 10 | 2 | 6 | 0 | b |
| apps/web/src/waterfall/taskPlan.sla | 70 | 72 | 4 | 1 | 6 | 0 | b |
| apps/web/src/waterfall/types.sla | 98 | 2 | 1 | 0 | 5 | 0 | b |
| apps/web/src/waterfall/virtualRowMeasurements.sla | 80 | 66 | 5 | 0 | 6 | 0 | b |
| apps/web/src/waterfall/waterfallRowRefreshQueue.sla | 46 | 44 | 6 | 1 | 1 | 0 | b |
| apps/web/src/webPreview.sla | 8 | 7 | 0 | 0 | 0 | 0 | a |
| apps/web/src/workspacePaths.sla | 50 | 106 | 8 | 6 | 3 | 0 | b |
| apps/web/src/workspaceSelectionVisibility.sla | 16 | 13 | 1 | 0 | 0 | 0 | a |

### apps/web .sax（104）

| file | lines | src | ratio | bind | DEFECT | if/each | class |
|---|---|---|---|---|---|---|---|
| apps/web/src/App.sax | 41 | 24 | 1.71 | 1 | 4 | 0/0 | structural |
| apps/web/src/StartupErrorBoundary.sax | 248 | 168 | 1.48 | 17 | 35 | 0/0 | structural |
| apps/web/src/app/transcripts/TopicConversationBoundary.sax | 29 | 30 | 0.97 | 0 | 3 | 0/0 | structural |
| apps/web/src/app/transcripts/TopicTranscriptBoundary.sax | 26 | 17 | 1.53 | 0 | 2 | 0/0 | structural |
| apps/web/src/app/workbench/useWorkbenchRuntime.sax | 630 | 675 | 0.93 | 189 | 33 | 0/0 | structural |
| apps/web/src/components/AgentRosterEditor.sax | 111 | 164 | 0.68 | 71 | 9 | 0/0 | structural |
| apps/web/src/components/AgentRosterManagerDialog.sax | 59 | 115 | 0.51 | 45 | 4 | 0/0 | structural |
| apps/web/src/components/AgentRosterSetupControl.sax | 52 | 66 | 0.79 | 25 | 5 | 0/0 | structural |
| apps/web/src/components/AuthScreens.sax | 466 | 338 | 1.38 | 92 | 2 | 0/0 | structural |
| apps/web/src/components/ChatPanel.sax | 542 | 2960 | 0.18 | 156 | 75 | 0/0 | skeleton |
| apps/web/src/components/CliBackendIcon.sax | 22 | 44 | 0.50 | 7 | 2 | 0/0 | structural |
| apps/web/src/components/CliBackendPicker.sax | 33 | 65 | 0.51 | 11 | 2 | 0/0 | structural |
| apps/web/src/components/CliBackendSettingsPanel.sax | 56 | 59 | 0.95 | 18 | 2 | 0/0 | structural |
| apps/web/src/components/CliBackendToggle.sax | 56 | 78 | 0.72 | 14 | 4 | 0/0 | structural |
| apps/web/src/components/CliPrerequisiteScreen.sax | 54 | 196 | 0.28 | 18 | 2 | 0/0 | skeleton |
| apps/web/src/components/CodexPluginSettingsPanel.sax | 1573 | 1109 | 1.42 | 329 | 54 | 0/0 | structural |
| apps/web/src/components/FreeModelAccessDialog.sax | 191 | 313 | 0.61 | 67 | 9 | 0/0 | structural |
| apps/web/src/components/FreebuffModelSwitchDialog.sax | 202 | 250 | 0.81 | 44 | 3 | 0/0 | structural |
| apps/web/src/components/GatewayCharts.sax | 455 | 235 | 1.94 | 292 | 44 | 0/0 | structural |
| apps/web/src/components/GatewayStatsPanel.sax | 1332 | 998 | 1.33 | 219 | 66 | 0/0 | structural |
| apps/web/src/components/GitReviewPanel.sax | 868 | 763 | 1.14 | 133 | 391 | 0/0 | structural |
| apps/web/src/components/LaunchAdaptersPanel.sax | 1557 | 1280 | 1.22 | 201 | 46 | 0/0 | structural |
| apps/web/src/components/LegalConsentScreen.sax | 88 | 148 | 0.59 | 40 | 3 | 0/0 | structural |
| apps/web/src/components/MarkdownMessage.sax | 870 | 761 | 1.14 | 70 | 391 | 0/0 | structural |
| apps/web/src/components/MembersPermissionsPanel.sax | 1021 | 956 | 1.07 | 288 | 281 | 0/0 | structural |
| apps/web/src/components/MonacoEditor.sax | 6 | 8 | 0.75 | 1 | 1 | 0/0 | structural |
| apps/web/src/components/NewChatButton.sax | 51 | 98 | 0.52 | 19 | 5 | 0/0 | structural |
| apps/web/src/components/OfficialOpenAiLoginDialog.sax | 56 | 127 | 0.44 | 22 | 4 | 0/0 | skeleton |
| apps/web/src/components/PetDock.sax | 28 | 30 | 0.93 | 3 | 2 | 0/0 | structural |
| apps/web/src/components/ProjectGroupChat.sax | 637 | 543 | 1.17 | 146 | 439 | 0/0 | structural |
| apps/web/src/components/PtyTerminalView.sax | 34 | 241 | 0.14 | 6 | 4 | 0/0 | skeleton |
| apps/web/src/components/RecentWorkspacesControl.sax | 218 | 226 | 0.96 | 58 | 9 | 0/0 | structural |
| apps/web/src/components/ResizeHandle.sax | 40 | 45 | 0.89 | 0 | 2 | 0/0 | structural |
| apps/web/src/components/RightInspector.sax | 2108 | 1592 | 1.32 | 368 | 64 | 0/0 | structural |
| apps/web/src/components/RightWorkspacePanel.sax | 278 | 378 | 0.74 | 65 | 8 | 0/0 | structural |
| apps/web/src/components/SecuritySettingsPanel.sax | 302 | 478 | 0.63 | 122 | 7 | 0/0 | structural |
| apps/web/src/components/SideChatPanel.sax | 636 | 596 | 1.07 | 87 | 130 | 0/0 | structural |
| apps/web/src/components/SystemMetricsTopBarBadge.sax | 803 | 721 | 1.11 | 113 | 413 | 0/0 | structural |
| apps/web/src/components/TerminalConsole.sax | 764 | 694 | 1.10 | 101 | 320 | 0/0 | structural |
| apps/web/src/components/ThemeBackgroundMedia.sax | 131 | 198 | 0.66 | 10 | 26 | 0/0 | structural |
| apps/web/src/components/ThemeQuickSwitcher.sax | 55 | 64 | 0.86 | 37 | 3 | 0/0 | structural |
| apps/web/src/components/ThreadStatusDot.sax | 36 | 41 | 0.88 | 5 | 2 | 0/0 | structural |
| apps/web/src/components/ThreeBackgroundScene.sax | 24 | 118 | 0.20 | 2 | 7 | 0/0 | skeleton |
| apps/web/src/components/ThreePetDockScene.sax | 18 | 104 | 0.17 | 2 | 5 | 0/0 | skeleton |
| apps/web/src/components/TopBarRelayTreeSelector.sax | 429 | 538 | 0.80 | 152 | 9 | 0/0 | structural |
| apps/web/src/components/UsageBillingPanel.sax | 382 | 468 | 0.82 | 178 | 6 | 0/0 | structural |
| apps/web/src/components/VendorLogo.sax | 19 | 55 | 0.35 | 5 | 2 | 0/0 | skeleton |
| apps/web/src/components/WindowsTerminalLauncher.sax | 84 | 105 | 0.80 | 19 | 4 | 0/0 | structural |
| apps/web/src/components/WorkspaceCodeEditor.sax | 75 | 103 | 0.73 | 20 | 4 | 0/0 | structural |
| apps/web/src/components/WorkspaceExplorerPanel.sax | 1077 | 887 | 1.21 | 88 | 52 | 0/0 | structural |
| apps/web/src/components/WorkspaceFilesSettingsPanel.sax | 108 | 225 | 0.48 | 44 | 4 | 0/0 | skeleton |
| apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.sax | 46 | 86 | 0.53 | 30 | 3 | 0/0 | structural |
| apps/web/src/components/chatgpt-shell/ChatGptShell.sax | 88 | 99 | 0.89 | 70 | 2 | 0/0 | structural |
| apps/web/src/components/dialogs/CliSwitchDialog.sax | 79 | 70 | 1.13 | 11 | 4 | 0/0 | structural |
| apps/web/src/components/dialogs/CodexCliUpdateDialog.sax | 111 | 98 | 1.13 | 11 | 6 | 0/0 | structural |
| apps/web/src/components/dialogs/DangerNewChatDialog.sax | 532 | 500 | 1.06 | 90 | 17 | 0/0 | structural |
| apps/web/src/components/dialogs/NewChatSetupDialog.sax | 337 | 329 | 1.02 | 65 | 14 | 0/0 | structural |
| apps/web/src/components/dialogs/RelayShareDialogs.sax | 104 | 88 | 1.18 | 28 | 13 | 0/0 | structural |
| apps/web/src/components/dialogs/SshCodexInstallDialog.sax | 130 | 97 | 1.34 | 35 | 7 | 0/0 | structural |
| apps/web/src/components/dialogs/WorkspacePickerDialog.sax | 376 | 327 | 1.15 | 60 | 23 | 0/0 | structural |
| apps/web/src/components/icons/DiscordIcon.sax | 11 | 9 | 1.22 | 1 | 2 | 0/0 | structural |
| apps/web/src/composer/Composer.sax | 640 | 3141 | 0.20 | 171 | 98 | 0/0 | skeleton |
| apps/web/src/composer/ComposerModelSelect.sax | 271 | 192 | 1.41 | 23 | 20 | 0/0 | structural |
| apps/web/src/composer/ComposerQuotaChip.sax | 462 | 381 | 1.21 | 51 | 25 | 0/0 | structural |
| apps/web/src/history/HistorySidebar.sax | 1030 | 877 | 1.17 | 152 | 82 | 0/0 | structural |
| apps/web/src/main.sax | 90 | 83 | 1.08 | 7 | 11 | 0/0 | structural |
| apps/web/src/mobile/MobileTopBar.sax | 250 | 247 | 1.01 | 22 | 8 | 0/0 | structural |
| apps/web/src/mobile/MobileTopBarDropdown.sax | 163 | 176 | 0.93 | 37 | 9 | 0/0 | structural |
| apps/web/src/onboarding/OnboardingTour.sax | 35 | 31 | 1.13 | 6 | 1 | 0/0 | structural |
| apps/web/src/onboarding/useOnboarding.sax | 195 | 206 | 0.95 | 0 | 34 | 0/0 | structural |
| apps/web/src/settings/PluginManagerPanel.sax | 132 | 138 | 0.96 | 14 | 11 | 0/0 | structural |
| apps/web/src/settings/SettingsDrawer.sax | 10200 | 9927 | 1.03 | 1390 | 176 | 0/0 | structural |
| apps/web/src/setup-guide/SetupGuideDialog.sax | 166 | 100 | 1.66 | 33 | 14 | 0/0 | structural |
| apps/web/src/shell/AppRoot.sax | 616 | 539 | 1.14 | 35 | 22 | 0/0 | structural |
| apps/web/src/shell/AuthenticatedWorkbench.sax | 921 | 699 | 1.32 | 161 | 50 | 0/0 | structural |
| apps/web/src/shell/CenterPanelView.sax | 440 | 319 | 1.38 | 77 | 36 | 0/0 | structural |
| apps/web/src/shell/CliVersionSwitcher.sax | 333 | 232 | 1.44 | 51 | 42 | 0/0 | structural |
| apps/web/src/shell/ComposerChromeActions.sax | 232 | 172 | 1.35 | 26 | 17 | 0/0 | structural |
| apps/web/src/shell/ComposerDockView.sax | 628 | 471 | 1.33 | 93 | 56 | 0/0 | structural |
| apps/web/src/shell/ConversationView.sax | 466 | 301 | 1.55 | 78 | 76 | 0/0 | structural |
| apps/web/src/shell/FreeSavingsAction.sax | 351 | 232 | 1.51 | 76 | 35 | 0/0 | structural |
| apps/web/src/shell/RightWorkspacePanelView.sax | 235 | 142 | 1.65 | 44 | 38 | 0/0 | structural |
| apps/web/src/shell/RuntimeControlSet.sax | 203 | 142 | 1.43 | 35 | 18 | 0/0 | structural |
| apps/web/src/shell/SettingsDrawerHost.sax | 440 | 207 | 2.13 | 139 | 83 | 0/0 | structural |
| apps/web/src/shell/SideChatPanelView.sax | 169 | 109 | 1.55 | 26 | 23 | 0/0 | structural |
| apps/web/src/shell/SplitPaneView.sax | 183 | 128 | 1.43 | 29 | 18 | 0/0 | structural |
| apps/web/src/shell/SshConfigHostControl.sax | 81 | 50 | 1.62 | 16 | 7 | 0/0 | structural |
| apps/web/src/shell/WorkbenchChatGptShell.sax | 74 | 40 | 1.85 | 20 | 6 | 0/0 | structural |
| apps/web/src/shell/WorkbenchMainArea.sax | 189 | 145 | 1.30 | 19 | 17 | 0/0 | structural |
| apps/web/src/shell/WorkbenchMenus.sax | 671 | 413 | 1.62 | 167 | 83 | 0/0 | structural |
| apps/web/src/shell/WorkbenchOverlays.sax | 497 | 372 | 1.34 | 78 | 39 | 0/0 | structural |
| apps/web/src/shell/WorkbenchRoot.sax | 1200 | 683 | 1.76 | 481 | 28 | 0/0 | structural |
| apps/web/src/shell/WorkbenchShellExtras.sax | 180 | 84 | 2.14 | 65 | 23 | 0/0 | structural |
| apps/web/src/shell/WorkbenchTaskTabs.sax | 1047 | 672 | 1.56 | 219 | 148 | 0/0 | structural |
| apps/web/src/shell/WorkbenchTopBar.sax | 669 | 480 | 1.39 | 118 | 63 | 0/0 | structural |
| apps/web/src/shell/WorkspaceNodeView.sax | 71 | 58 | 1.22 | 0 | 2 | 0/0 | structural |
| apps/web/src/theme/theme-provider.sax | 62 | 45 | 1.38 | 2 | 7 | 0/0 | structural |
| apps/web/src/waterfall/AgentOverviewGrid.sax | 92 | 231 | 0.40 | 16 | 30 | 0/0 | skeleton |
| apps/web/src/waterfall/ChatDiffView.sax | 54 | 311 | 0.17 | 10 | 16 | 0/0 | skeleton |
| apps/web/src/waterfall/ChatFloorRail.sax | 114 | 347 | 0.33 | 11 | 40 | 0/0 | skeleton |
| apps/web/src/waterfall/ChatRow.sax | 1507 | 3706 | 0.41 | 204 | 369 | 0/0 | skeleton |
| apps/web/src/waterfall/ChatSearchOverlay.sax | 89 | 225 | 0.40 | 7 | 17 | 0/0 | skeleton |
| apps/web/src/waterfall/ChatWaterfall.sax | 230 | 1020 | 0.23 | 42 | 79 | 0/0 | skeleton |
| apps/web/src/waterfall/TaskPlanPanel.sax | 123 | 306 | 0.40 | 12 | 33 | 0/0 | skeleton |

### frontends/ .sla（42）

| file | lines | src | fns | stub-fns | DEFECT | ts-rem | class |
|---|---|---|---|---|---|---|---|
| frontends/agy/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/agy/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/auggie/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/auggie/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/claude/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/claude/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/cline/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/cline/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/codex/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/codex/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/command-code/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/command-code/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/enhance/src/manifest.sla | 30 | 6 | 1 | 0 | 2 | 0 | b |
| frontends/enhance/src/web.sla | 63 | 28 | 2 | 1 | 2 | 0 | b |
| frontends/free-mode/src/free/freeAutoCompactPreferences.sla | 28 | 13 | 5 | 0 | 1 | 0 | b |
| frontends/free-mode/src/free/freeCompactionReadiness.sla | 641 | 184 | 26 | 0 | 8 | 0 | b |
| frontends/free-mode/src/manifest.sla | 31 | 7 | 1 | 0 | 2 | 0 | b |
| frontends/free-mode/src/web.sla | 56 | 30 | 2 | 1 | 2 | 0 | b |
| frontends/grok/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/grok/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/jev/src/jev/jevAutoJudge.sla | 849 | 370 | 33 | 0 | 18 | 0 | b |
| frontends/jev/src/jev/jevClient.sla | 371 | 74 | 9 | 0 | 8 | 0 | b |
| frontends/jev/src/jev/jevConfig.sla | 38 | 29 | 0 | 0 | 1 | 0 | b |
| frontends/jev/src/jev/jevQuestions.sla | 1387 | 593 | 54 | 0 | 14 | 0 | b |
| frontends/jev/src/jev/jevTurnSnapshotDispatch.sla | 126 | 52 | 3 | 0 | 6 | 0 | b |
| frontends/jev/src/manifest.sla | 31 | 7 | 1 | 0 | 2 | 0 | b |
| frontends/jev/src/web.sla | 58 | 30 | 2 | 1 | 2 | 0 | b |
| frontends/mini/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/mini/src/web.sla | 77 | 24 | 1 | 0 | 1 | 0 | b |
| frontends/muse/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/muse/src/saVmChatActivity.sla | 1984 | 472 | 45 | 4 | 18 | 0 | b |
| frontends/muse/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/opencode-v2/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/opencode-v2/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/opencode/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/opencode/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/pi/src/manifest.sla | 32 | 8 | 1 | 0 | 2 | 0 | b |
| frontends/pi/src/web.sla | 77 | 20 | 1 | 0 | 1 | 0 | b |
| frontends/relay-config/src/manifest.sla | 31 | 7 | 1 | 0 | 2 | 0 | b |
| frontends/relay-config/src/web.sla | 50 | 23 | 2 | 1 | 2 | 0 | b |
| frontends/vmtool-security/src/manifest.sla | 31 | 7 | 1 | 0 | 2 | 0 | b |
| frontends/vmtool-security/src/web.sla | 58 | 29 | 2 | 1 | 2 | 0 | b |

### frontends/ .sax（4）

| file | lines | src | ratio | bind | DEFECT | if/each | class |
|---|---|---|---|---|---|---|---|
| frontends/enhance/src/enhance/EnhanceToolsDialog.sax | 216 | 598 | 0.36 | 14 | 3 | 1/0 | skeleton |
| frontends/free-mode/src/free/VmContextSavingsTab.sax | 93 | 304 | 0.31 | 9 | 2 | 1/0 | skeleton |
| frontends/jev/src/jev/JevSettingsDialog.sax | 183 | 490 | 0.37 | 34 | 4 | 6/0 | skeleton |
| frontends/vmtool-security/src/security/VmToolsSettingsTab.sax | 162 | 354 | 0.46 | 13 | 2 | 1/0 | skeleton |
