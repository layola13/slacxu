# FIX_FRONTEND_PHASE2B — 阶段 2 前端续批交付（Agent AI）

日期：2026-10-27。场地：Colab 盒 `/content/bulk-fe3`（slacxu worktree，基点 bulk-convert `66a50d1`，detached，只本地提交、未推送、未建分支）。范围：apps/web/** 五个骨架 .sax 结构重拉 + mui 图标挂载符号完整性排查（AE 交付 `_defects/FIX_FRONTEND_PHASE2.md` §3.5 第 7 项）。生成器 `/tmp/repull2.py`（JSX 扫描器，本线新写，AE 的 /tmp/repull.py 已随旧运行时佚失）+ 审计 `/tmp/audit2.py`，均盒上 /tmp 留存。

---

## 1. 五个骨架 .sax 逐行重拉（按 ChatPanel/Composer 范例）

方法与 AE §2.1 同：以同树 TSX 为唯一真值，组件按源码顺序分节、useState/useRef 落 `<state>` 槽、hooks/处理器/派生以 DEFECT/bind 注释登记（带 src 行号）、JSX 全量展开、字面量属性保留、表达式属性置空 + bind 登记、字面文本恢复为元素内容、属性内 JSX 在元素后以 `<!-- attr-JSX: -->` 展开。结构修复：`{cond && (<JSX/>)}` 与三元 → `<!-- if: cond (src:L) -->` … `<!-- else -->` … `<!-- /if -->`；`.map(...)` → `<!-- each: recv.map (src:L) -->` … `<!-- /each -->`；`return cond ? <A/> : <B/>` 与 switch 分发 return 同样展开（本线生成器相对 AE 稿的三处增量：return 三元展开、map 先于 JSX 时由 code_scan 驱动 each、字符串字面量分支落文本节点）。

### 1.1 审计结果（脚本对账，TSX ↔ 旧 .sax ↔ 新 .sax）

| 文件 | src 行 | 旧行 → 新行 | if 标记 旧→新 | each 旧→新 | else | 元素实例 旧→新 | 标签实例覆盖* 旧→新 |
|---|---|---|---|---|---|---|---|
| waterfall/ChatRow.sax | 3706 | 1507 → **2066** | 0 → 85 | 0 → 16 | 28 | 340 → 362（生成器实发 367） | 0.791 → 0.842 |
| waterfall/ChatWaterfall.sax | 1020 | 230 → **822** | 0 → 36 | 0 → 7 | 4 | 33 → 131（实发 129） | 0.647 → 0.686 |
| waterfall/ChatDiffView.sax | 311 | 54 → **72** | 0 → 2 | 0 → 1 | 2 | 6 → 6（实发 6） | 0.857 → 0.857 |
| components/PtyTerminalView.sax | 241 | 34 → **52** | 0 → 1 | 0 → 0 | 1 | 3 → 3（实发 3） | 0.500 → 0.500 |
| components/ThreeBackgroundScene.sax | 118 | 24 → **17** | 0 → 0 | 0 → 0 | 0 | 1 → 1（实发 1） | 0.500 → 0.500 |

\* 覆盖率分母为正则口径的 TSX 标签实例数，含泛型/类型位噪声（`Map<string>`、`Pick<FileChangeDetail>`、`ChatWaterfallRow["item"]` 等被计为「标签」），真实 JSX 覆盖高于此数：ChatRow 新稿「缺失种类」8 项经逐个核对全为类型位泛型（Blob、HTMLElement、ChatWaterfallRow、FileChangeDetail、GroupedFileSummary、number、object、string），无一为真 JSX；ChatWaterfall 缺失 7 项同理（ChatFloorEntry/ChatSearchScope 类型、HTMLDivElement、Map/Set、number、typeof），其唯一真图标 KeyboardDoubleArrowDownIcon 已由 attr-JSX 展开进入新稿。ThreeBackgroundScene 行数下降是诚实结果：其 TSX 全文只有 1 个 JSX 元素（src:111 的 `<Box>`），其余为 three.js 命令式场景代码，已以 DEFECT/bind 登记，旧稿 24 行含 6 处登记性填充。

### 1.2 残余未展开类（显式登记，沿 AE §2.3 口径）

1. 深层嵌套回调/对象字面量内的 JSX（菜单配置、columns render 函数等）仍只 bind 登记（含 src 行号），未展开；
2. 代码位（非 JSX 子节点位）的条件/.map 只有落在 return 表达式与 JSX 子节点位者被标记，纯数据变换的 .map/条件以 bind 出现——与 AE 的标记口径一致（标记只加在产生元素的构造上）；
3. 文本覆盖未满：CXU 文案多经 `t(...)` 调用与表达式插值，按约定 bind 登记；纯字面文本已恢复（ChatRow 38 处、ChatDiffView/Pty 各 1 处）；
4. return 编号计入回调内 return（ChatWaterfall 主组件达 #44），为登记噪声，不影响结构标记；
5. ChatWaterfall 的 `CHAT_ROW_FLASH_KEYFRAMES`（theme 函数常量）生成了一个空 `<Component>` 节（大写名 + 函数值所致），无 JSX 可展开，保留登记。

---

## 2. mui 图标挂载符号完整性排查（AE §3.5 第 7 项）— 已裁定，非库声明缺失

### 2.1 符号机制（出处：sa_plugin_react `src/react/lowerer.zig`）

- `appendComponentForwardDecls`（≈L1503 一带）：对编译集 `program_components` 中每个组件发 `@extern sax_<stem>_mount(parent_h: i64) -> ptr` 等前向声明；
- `emitMount`（≈L6532）：对每个被编译的组件发 `@export sax_<stem>_mount …` 定义；
- 使用点（≈L5356）：`node_N = call @sax_<stem>_mount(slot)`。
- 推论：被用组件若**不在编译集内**，调用点照常发出，但全文件无其 `@extern`/`@export` —— FFI 包装阶段才以 UnknownRegister (1007) 暴露，check 阶段无任何诊断。

### 2.2 静态枚举（脚本对账）

定义面：material.sax 153 组件、icons_material.sax 31 图标、material_kit_layout.sax 29、material_kit_views.sax 6。
使用面：demo `mui_all_components_from_library.sax` 共用 163 种组件 / 556 实例。

- 只对 material.sax 求差集：缺 12 个图标 —— AccessTimeIcon、AccountCircleIcon、AddIcon、ArrowForwardIosIcon、DashboardIcon、DoneAllIcon、NotificationsIcon、RestartAltIcon、**SearchIcon**、ShareIcon、ShoppingBagIcon、ShoppingCartIcon（另有 `<Component name=` 的计数伪影 1 项）；
- 对 material.sax + icons_material.sax 求差集：**∅**（除计数伪影）。12 个图标在 icons_material.sax 中全部有定义（SearchIcon 即该文件第 1 行）。

### 2.3 复现实验（本线在新盒实测，react/mui 插件现构建 + dev-install）

- 实验 (a) 只 `--include mui/material.sax`：**与 AE 的失败逐字复现** —— app.sa 生成后 trap UnknownRegister (1007)，`@ffi_wrapper sax_muiallcomponents_init_ffi()` 内 `line 9070: node_282 = call @sax_searchicon_mount(slot_281)`；其 app.sa 中 `sax_searchicon_mount` 仅 2 处调用、零声明零定义。证明 AE 对照构建用的是 material-only include（其交付 §3.2 的消费方式描述亦只列 material.sax）。
- 实验 (b) 按 mui README（L61）的规范命令双 include（material.sax + icons_material.sax）：**RC=0 全程通过** —— dist/app.sa 8,064,209 B（含 `@export sax_searchicon_mount` @L90787、`@export sax_*_mount` 共 164 个），app.wasm + airlock.js + index.html 全产物生成（161.8 s）。

### 2.4 归因与处置

1. **不是 mui 库声明缺失**：图标声明完整地在 icons_material.sax 里；material.sax 本就不含图标（分工如此）。**mui 库零修改、无提交**。
2. 直接原因 = 对照构建的 include 集漏了 icons_material.sax；SearchIcon 只是调用顺序上第一个未声明符号，其余 11 个图标符号同类（完整清单见 2.2）。
3. 生成器健壮性缺口（登记，归 sa_plugin_react 线，非本线范围）：lowerer 对不在编译集内的被用组件不发诊断、直接发出无声明调用，使错误推迟到 FFI 阶段且信息不含组件名以外的线索。最小修复面：在 lowerer 发出 user-component mount 调用前校验目标名 ∈ program_components，缺失时报编译期诊断（组件名 + 「未在 --include 文件中定义」）。本线未动 sa_plugin_react/sci/sa_plugin_sla。
4. AE §3.5 第 7 项据此结案；其余桥面项（事件 prop 转发、元素级条件/列表方言形、sx 降解等）不受影响。

---

## 3. 仍阻塞项（只登记不修）

- **emit_js/emit_c 的 InvalidOperand out-param 缺陷**（AE §4.4 之二）与 extern 结果 spill 误追踪（AE §4.4 之一）：属 sci 便携发射器编译器残余，本线只登记，未修；便携目标（JS/C）对 out-param 产物消费类程序的行为证据仍受此阻塞。
- §1.2 的未展开类与 §2.4.3 的生成器诊断缺口：前者待 .sax 真转换（react 方言化）阶段处理，后者待 sa_plugin_react 线立项（须带语料回归测试，按编译器缺陷纪律）。

## 4. 提交清单（bulk-fe3 本地，未推送）

- `eef3132` ThreeBackgroundScene.sax 重拉（24 → 17 行）
- `1464c15` PtyTerminalView.sax 重拉（34 → 52 行，if 0→1）
- `33b3bd5` ChatDiffView.sax 重拉（54 → 72 行，if 0→2、each 0→1）
- `096c032` ChatWaterfall.sax 重拉（230 → 822 行，if 0→36、each 0→7）
- `6cb398b` ChatRow.sax 重拉（1507 → 2066 行，if 0→85、each 0→16、else 28）
- 本文件随末笔提交入 `_defects/FIX_FRONTEND_PHASE2B.md`。
- mui 仓：零改动（排查结论为无需修改，见 §2.4.1）；盒上仅构建产物 zig-out 与 dev-install（react/mui 已装入 installed，与 sla 并列）。
