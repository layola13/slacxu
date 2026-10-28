# FIX_FRONTEND_PHASE2_BK — 阶段 2 批次 BK：下一批 10 个 .sax 结构恢复

线：Agent BK（2026-10-28，用户批准多线并行）。场地：Colab 盒 worktree
`/content/bulk-phase2-bk`（detached 于 bulk-convert 远端尖 `ecf8635`）；本机主本
`~/workspace/bk-local/`（先落本机再同步、sha256 双确认，cat 管道）。只本地提交、不推送、不建分支。
范围纪律：只动 apps/web 的 .sax；apps/server、sdk、插件仓一律未碰。

环境补记：本运行时 sa_plugin_react / sa_plugin_mui 未随 restore 安装，BK 线已在盒上构建
（`zig build -Doptimize=ReleaseFast`，rc=0）并 dev 安装；已装插件：sla、http-client、
http-server、node、react、mui。编译口径：`SA_PLUGIN_DEV=1 sa react check|build <file>
--include mui/material.sax --include mui/icons_material.sax`（AI 定性包含集），构建在
scratch 目录执行（dist/ 不落 worktree）。构建日志：盒上 `/tmp/bk_build/*.log`。

## 0. 批次选取（普查顺序，跳过已完成 7 个）

已完成 7 个（AE/AI）：ChatPanel、Composer、ChatRow、ChatWaterfall、ChatDiffView、
PtyTerminalView、ThreeBackgroundScene。本批按 FIX_FRONTEND_PHASE2 附录 A 顺序取其后 10 个：
App、StartupErrorBoundary、TopicConversationBoundary、TopicTranscriptBoundary、
useWorkbenchRuntime、AgentRosterEditor、AgentRosterManagerDialog、AgentRosterSetupControl、
AuthScreens、CliBackendIcon。

## 1. 本批裁定表

| # | 文件 | 裁定 | wasm 证据 / 阻塞根因 |
|---|---|---|---|
| 1 | apps/web/src/App.sax | 结构核验完成（bulk 标记式，本已 1:1）；wasm 阻塞 | 组合 `<AppRoot {...props}/>`，AppRoot.sax 仍 bulk 式、不在任何 react 编译集；BK react 式探针实证 FFI 阶段 trap UnknownRegister 1007（见 §3 登记 1） |
| 2 | apps/web/src/StartupErrorBoundary.sax | **结构恢复完成 + wasm 通过**（react 方言全量转换） | app.wasm **9,239 B**，check/build 均 PASS（/tmp/bk_build/StartupErrorBoundary.{check,build}.log） |
| 3 | apps/web/src/app/transcripts/TopicConversationBoundary.sax | 忠实重拉完成（标记式）；阻塞 | 文件无元素树：render-prop `children({transcript,usage},{stores})` + 双 hook 订阅，方言无此形态；Slot 直通会静默破坏源注释明示的「不延迟订阅」契约，拒绝冒充 |
| 4 | apps/web/src/app/transcripts/TopicTranscriptBoundary.sax | 忠实重拉完成（标记式）；阻塞 | 同族：`children(projection)` render-prop + useTopicTranscript + memo() 包装 |
| 5 | apps/web/src/app/workbench/useWorkbenchRuntime.sax | 忠实重拉完成（标记式，含补回 composerBackgroundControl 元素展开）；阻塞 | hook 返回 render-prop 函数族 + 7 个 shell/*.sax 视图全在编译集外（同 1007 形态）+ ~200 属性来自解构子 hook 返回（桥接 §3.5.4 无约定） |
| 6 | apps/web/src/components/AgentRosterEditor.sax | 忠实重拉完成（标记式，each 10 / if 2）；阻塞 | 运行时数据列表渲染无方言形态：roles.map→each（块体绑定 provider/group/routeSummary）、fallbacks.map 嵌套 each、providers/groups/models 三处 Select 内 each |
| 7 | apps/web/src/components/AgentRosterManagerDialog.sax | 忠实重拉完成（标记式，if 10 / each 2）；阻塞 | unavailable.map、members.map 两处运行时列表 + 子组件 AgentRosterEditor 本身阻塞（src:93） |
| 8 | apps/web/src/components/AgentRosterSetupControl.sax | 忠实重拉完成（标记式，if 5 / else 2）；阻塞 | 子组件 AgentRosterEditor 阻塞（src:57）+ 自身条件叶节点（roles.length Chip/清空、draft.length 保存钮、文本三元） |
| 9 | apps/web/src/components/AuthScreens.sax | **结构恢复完成 + wasm 通过**（react 方言全量转换） | app.wasm **25,883 B**（app.sa 237,189 B），check/build 均 PASS |
| 10 | apps/web/src/components/CliBackendIcon.sax | **结构恢复完成 + wasm 通过**（react 方言全量转换） | app.wasm **3,742 B**，check/build 均 PASS |

计数：wasm 通过 3/10；忠实重拉完成但阻塞 6/10（根因全部登记在文件头注与 §3）；结构核验 1/10（App）。
无静默跳过、无压平冒充。

## 2. react 方言转换规约（本批采用，3 个通过文件统一执行）

**初次渲染保真原则**：挂载的组件 = TSX 在初始状态下实际渲染的树；非初始分支不丢弃——
在同文件内全量转换为具名同级组件并在文件头登记；属性条件决定的叶节点（如本批
CliBackendIcon 的 aria-hidden）省略并登记。派生值（monogram 首字母、alt 模板串、标签的
i18n t() 调用结果）在 sax 侧预置为命名 state 槽，派生逻辑在头注登记。事件：能对应的
用方言真实机制（AuthScreens 的 @sax_event_target_value 读入 email/password/captcha、
@sax_event_prevent_default）；异步提交体（loginUser/registerUser/resetPassword 等主机
API）无 airlock 桥——只保留 prevent_default 骨架并逐个登记函数名与源行号，不冒充行为。
sx 对象、inputProps 等方言无槽位的属性一律省略并登记（桥接 §3.5.3）。

各通过文件登记要点（全文在各文件头注）：
- CliBackendIcon：`plugin.icon` 决定 image/monogram 两分支无元素条件形态——两分支均转换
  （image 分支挂载）；aria-hidden 条件属性省略；monogram/alt 派生预置槽；targetIconSize
  数字槽、Button 的 component="span" 字符串属性在方言内合法保留。
- AuthScreens：AuthLoadingScreen 静态树全量；LoginScreen 挂载 login 分支初始形态
  （含真实输入接线）；register/双因素分支全量转换为 LoginRegisterField/LoginTwoFaBranch/
  LoginModeToggle 同级组件并登记；authConfig 对象按 TSX 初始值拆为 i1 槽；初始邮箱串
  无槽初始化形态（登记）；验证码三路条件 + dangerouslySetInnerHTML 无形态，挂载兜底文案
  并登记；全部 sx/inputProps 省略登记。
- StartupErrorBoundary：StartupFailureScreen 全量转换（DOM 标签、静态 style 对象以
  style={{…}} 内联、px 归一为字符串；{code}/{message}/{diagnostic} 字符串槽）；错误边界
  语义（getDerivedStateFromError/componentDidCatch）与 failure?screen:children 切换无
  形态——边界组件以 Slot 直通壳登记；reload/copy 两个 handler 只有结构标签（无
  location/clipboard 的 airlock 桥）；8 个命令式 DOM/逻辑函数逐名登记（源行号在头注）。

## 3. 登记项（上报主会话 / BG 线口径）

1. **lowerer 诊断缺口新复现（AI FIX_FRONTEND_PHASE2B §2.4.3 的第二个实例）**：
   react 式 App（挂载 `<AppRoot config={{...}} />`，AppRoot 不在编译集）下 `sa react check`
   与 `build` 均穿过 lower 阶段、在 FFI wrap 处 trap：
   `error[UnknownRegister]: callee is not declared`，`@ffi_wrapper sax_app_init_ffi()`，
   失败行 `node_0 = call @sax_approot_mount(host)`。诊断不指出缺失组件名与包含集。
   探针源保留于盒上 /tmp/bk_probes（e2_app），修复归编译器/插件线（§2.4.3 已给最小修法）。
2. **桥接 §3.5.2（元素级条件/列表无方言形态）在本批的规模证据**：10 个文件中 6 个主要或
   部分因此阻塞——列表：AgentRosterEditor（10 处 each 语义）、AgentRosterManagerDialog
   （2 处 each + 5 处状态条件按钮）、AgentRosterSetupControl（条件叶节点）、
   Topic 两边界（render-prop 是其变体：以函数为子，无形态）、useWorkbenchRuntime
   （render-prop 函数族为返回值）。方言解析器子节点种类经源码核查只有
   文本/插值/JSON 展开/元素四种（sa_plugin_react src/sax_parser.zig），mui README 的
   特性清单亦与此一致；固定槽位展开（react_todolist 式）只适用于编译期已知长度，
   本批列表均为运行时数据。本项是阶段 2 后续批次的头号解锁项。
3. **render-prop 家族单列**：TopicConversationBoundary/TopicTranscriptBoundary/
   useWorkbenchRuntime 三个文件的核心语义都是「把数据或渲染函数交给子级」，其中
   Topic 两文件的 Slot 直通会静默改变订阅时序契约——裁定为阻塞而非降级通过，
   供主会话在方言裁定时参考（需要 render-prop 形态或等价的订阅组件形态）。
4. **§3.5.3 sx 降级**再确认：本批 3 个通过文件与 3 个 roster 文件的全部 sx 对象均无
   槽位（material.sax 组件无 sx 槽），已逐文件登记省略，未静默丢弃信息（源对象在
   对应 .tsx 中可查，头注给出代表性源行号）。
5. **§3.5.4 嵌套对象 state 约定**：useWorkbenchRuntime 的 ~200 个属性值来自 7 个子
   hook 的解构返回对象；方言只有扁平 state 槽 + 对象字面量 prop 两条路，hook 间以
   渲染函数与对象互传的组合模式无约定承载——与本项一并裁定。
6. bulk 标记式文件经 react check 的失败形态（数据点，非语义结论）：AgentRosterEditor
   → `error[SA-REACT-CHECK]: UnexpectedToken`；TopicTranscriptBoundary →
   `error[SA-REACT-CHECK]: InvalidStateType`（日志 /tmp/bk_build/bulk_*.check.log）。
   bulk 式与 react 式是两种方言（AE §1.2 已证），失败属预期；阻塞的语义根因以 §3.2/3.3
   的源码核查为准。

## 4. 文件级审计数（重拉前后 if/each 标记行数）

批量原件全数 0/0（普查附录 A）。重拉后（grep 实测）：AgentRosterEditor if 2 / each 10；
AgentRosterManagerDialog if 10 / each 2；AgentRosterSetupControl if 5 / else 2；
useWorkbenchRuntime 补回 composerBackgroundControl 元素展开（11 属性逐个 bind）；
Topic 两文件无 if/each 语义（其结构是 render-prop，已在头注按源行登记）。
行数：Editor 318、ManagerDialog 152、SetupControl 107、useWorkbenchRuntime 675（与源同）、
TopicConversationBoundary 36、TopicTranscriptBoundary 34、App 53。

## 5. 提交

worktree `/content/bulk-phase2-bk` 内逐文件本地提交（哈希见终报）；worktree 终态干净。
