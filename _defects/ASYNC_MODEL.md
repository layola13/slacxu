# ASYNC_MODEL — SLA async 权威映射规则

> 目的：纠正批量转换简报中「SLA 不支持 async、async 函数一律压平为同步函数 +
> 状态码」的误判。本文每条规则都给一手出处（编译器测试 / sa_std 源码 /
> sala 文档 / 本仓探针实测）；没有出处的映射一律标「未证实」，不许凭印象补。
> 配套审计清单见 ASYNC_AUDIT.md；探针源码在 `_defects/async_probe/`。

## 0. 证据基线

| 证据 | 位置 |
|---|---|
| 编译器 async 测试族（34 个文件） | `sa_plugin_sla/tests/test_unit_async_*.sla` |
| future 契约（SA 层布局） | `sci/sa_std/core/future.sal`、`core/future.sa`（777 行）、`core/waker.sa`、`core/task.sa`、`pin.sa` |
| SLA 层入口 | `sci/sa_std/future.sa`（转引 core）、`sci/sa_std/async.sla`（多线程执行器，纯 SLA） |
| sala 文档 | `sala/content/02_sla_lang/09_async.html`、`10_maturity.html`、`09_rust_compare/05_stdlib_errors_async.html`、`08_faq/05_limitations_roadmap.html` |
| 本仓探针（2026-10-26 实测） | `_defects/async_probe/probe_find_root.sla`，结果见附录 A |

本机实测口径（2026-10-26，运行时 986a7d79e415，规范调用：插件仓根 cwd、
`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_SLA_FIXTURE_DIR=<仓>/tests/import_fixtures/`、
`sa test tests/<file>.sla`）：抽查 15 个 async 测试文件全绿（await 2、nested_pending_resume 1、
join2_local_pending 1、while_let_queue 1、block_on_direct 1、executor 3、executor_vec 3、
poll 1、task_state 1、join2 2、select2 3、linear_three 1、pending_await 1、
defer_ready_task 1、param_await 2），rosetta 314 亦 PASS。
`test_unit_async_thread_pool.sla` 本轮未复跑：其文件头注明默认 SAB 路径对
`stack_alloc + PIN_MUT_NEW` 组合有既存 mis-lowering、需 SA 文本后端；sala 09_async
（2026-09-29 复核）称 strict SAB 已 34/34——此为文档口径，非本轮实测。

## 1. 模型要点（逐条带出处）

### 1.1 基本语法：async fn / future<T> / .await

- `async fn name(args) -> T { ... }` 声明异步函数；调用它**不执行函数体**，
  而是得到一个 `future<T>` 值；后缀 `.await` 取结果。
  出处：tests/test_unit_async_await.sla（`async fn step_one`、`run_async().await`、
  `let future: future<int> = step_one(); let result = future.await;`）；
  sala 09_async「基本写法」；09_rust_compare 对照表（async fn 语法/.await/future
  类型均「已落地」）。
- `.await` 的操作数可以是：调用表达式 `f(x).await`、局部 future 变量
  `fut.await`、future 参数 `fut.await`（test_unit_async_param_await）、
  组合子结果 `future::join2(l, r).await`（test_unit_async_join2_local_await /
  join2_local_pending_await）。

### 1.2 状态机语义：专用 lowering，不是通用 CPS

- 编译器按形态选专用状态机构造器（join2 → two-await → single-await →
  dynamic planner）。已验证形态：单个 await、连续两次 await、线性三/四连续
  await（跨阶段局部值保持）、join2、分支表达式中的 await、while-let 循环中
  的 await、动态 Pending/Ready 混合。
  出处：sala 09_async「源码快照」「成熟度与建议」；测试族文件名即形态清单
  （linear_three_await、defer_ready_branch_expr、defer_ready_two_await、
  defer_ready_capture_*、defer_ready_multi_capture、
  defer_ready_copy_struct_capture 等）。
- await 点前后的局部变量（含结构体值、多捕获）由状态机保存/恢复：
  defer_ready_capture_* 与 multi_capture、copy_struct_capture 系列专测此项；
  本仓探针进一步实测了「while 循环 + 循环内嵌套 await + 结构体局部跨
  await 变异」组合（附录 A）。
- 挂起中的借用会被释放：async fn 借用 `&RefCell` 后 await 一个永不就绪的
  future，被 poll 一次后借用计数归零。
  出处：test_unit_async_pending_exit_cleanup_direct.sla。

### 1.3 future<T> 的构造面（future:: 命名空间）

全部出处为 tests 实际用到的符号（`grep -rhoE "future::[a-z_0-9]+" tests/test_unit_async_*.sla`）：

| 构造 | 语义 |
|---|---|
| `future::ready(v)` | 立即就绪 |
| `future::pending::<T>()` | 永不就绪（测试/占位用） |
| `future::defer_ready(v)` | 第一次 poll 返回 Pending、第二次返回 Ready(v)——制造一次真挂起 |
| `future::join2(l, r)` | 两者皆就绪才就绪，结果为 pair（`future::pair_left/pair_right` 取） |
| `future::select2(l, r)` | 先就绪者赢，结果为 either（`future::either_side` 1=左/2=右，`either_left/either_right` 取值） |
| async fn 调用 | 见 1.1 |

SA 层布局（core/future.sal）：`Poll{tag,value}`（PENDING=0/READY=1）、
`PollResult`（带 result_tag/ok/err 槽）、`Future{data,vtable}`、
`FutureJoin2State`、`FutureSelect2State` 等——即契约层预留了 Result 形
future 的布局，但 SLA 层组合未见专测（见 1.9）。

### 1.4 跨函数 / 跨线程移动

- future 是普通值：可作参数传入 async fn 并在其中 `.await`
  （test_unit_async_param_await），可存入数组/`Vec<Task<T>>`
  （executor_vec 测试），可被 `task::new` 包裹。
- 跨线程：`thread::spawn(^|| pool_worker(f, w_cell))` 把 future 移入 OS
  线程闭包，工作线程自行 block_on 驱动，结果经 `Arc<Mutex<i32>>` 回传
  （test_unit_async_thread_pool，含 1/2/4 线程 + 主线程同时驱动的用例；
  sala 09_async「跨线程的任务池」；async.sla 头注释「moved across
  functions AND across threads」）。
- ⚠ 驱动位置的注意事项：rosetta 314 文件内注释称「async 状态的 vtable
  是编译器侧元数据，future 作参数传给手写 poll 驱动时可能用错 poll fn」
  ——314 的解法是 future 的创建与 `task::new` 驱动写在**同一函数**内。
  与此并存的事实：future 作参数传入 **async fn 并被 .await** 有专测通过
  （param_await）；async.sla 的 `sched_block_on_timeout(future)` 也以
  future 为参数，但它用的是只读 ready 布局的 FUTURE_READY_POLL_STATE。
  结论：把 future 传给**另一个 async fn 去 await** 是已证实形态；把
  future 传给**手写 poll 驱动函数** 只在 ready/defer_ready 形态下被
  std/测试使用，动态 future 应优先用 FUTURE_POLL_STATE 分发或同函数
  task 驱动（sala 09_async 源码快照：动态状态必须经 FUTURE_POLL_STATE，
  不要把动态 outer future 交给 FUTURE_READY_POLL_STATE）。

### 1.5 同步边界：block_on 的五种已证实形态

SLA 没有内建的 `block_on` 关键字/标准函数（09_rust_compare 对照表：
「同步上下文里 await：不允许，需 block_on」——但紧接着的实测行又给出
await_from_sync 形态，二者按下面 (a) 的限定理解）。同步入口驱动 future
的已证实形态：

(a) **同步 fn 内直接 `.await`**（await_from_sync）：普通 fn 里写
    `let r = run_async().await;`。出处：test_unit_async_await.sla 的
    `await_from_sync` + sala 09_rust_compare「已支持（await_from_sync
    形态）」。限定：该用例的 future 链不含真挂起（step_one 立即
    返回）；含 defer_ready 真挂起的 future 在同步 fn 里直接 await
    是否同样成立**未见专测**，不要默认套用，优先 (b)。
(b) **task::new + task::poll 轮询**（规范形态）：`let t = task::new(f);`
    循环 `task::poll(t)` 直到 true，再 `task::result(t)`；另有
    `task::is_ready`、`task::state`（0/1）可查。出处：
    test_unit_async_task_runtime / nested_pending_resume /
    defer_ready_task_runtime / task_state_runtime；rosetta 314 的
    pending_resume_total（同函数创建+驱动，1ms 退避轮询，2s 截止）。
    本仓探针亦用此式（附录 A）。
(c) **手写 waker/pin 轮询**：RAW_WAKER_NEW → WAKER_FROM_RAW →
    CONTEXT_FROM_WAKER，Box + PIN_MUT_NEW 后 `FUTURE_POLL_STATE(pinned,
    context)` 轮询（动态 future 用此式）；只含 ready 布局的 future 可用
    `FUTURE_READY_POLL_STATE`（test_unit_async_block_on_direct 的
    block_ready；async.sla 的 sched_block_on_timeout）。出处见各文件。
(d) **sa_std/async.sla 的 sched_block_on_timeout(future<i32>, timeout_ms)**
    ：(c) 的 std 封装，超时 panic(96)；注意仅 i32 结果类型。async.sla
    另有基于 mpsc 管道 + thread::spawn 的 per-worker 执行器
    （sched_spawn_worker / sched_backoff_ms），任务是 u64 id + worker 侧
    poll fn 的 i32 协议，不是通用 future 执行器。
(e) **task executor 批量轮询**：`executor::new(tasks)`（数组或
    `Vec<Task<T>>`）+ `executor::poll_one(ex, i)` /
    `executor::poll_ready_count(ex)`。出处：test_unit_async_executor_
    runtime / executor_vec_runtime。语义是协作轮询计数，不是并发完成
    通知；无 reactor、公平性、背压（sala 09_async）。

### 1.6 async fn 内调用阻塞 extern / 同步代码

- 可以，且是既定形态：`async fn delayed_ready_value` 内直接调用
  `thread::sleep(Duration::from_millis(0))`（test_unit_async_block_on_
  direct）；本仓探针在 async fn 内直接调用阻塞 fs extern
  `sa_std_fs_exists` 并把结果送入状态机（附录 A）。
- 含义：TS 里 `await fs.promises.xxx()` / `await` 一个在 Node 中异步
  的操作，在 SLA 侧对应操作若只有阻塞 extern，就在 async fn 内直接
  调用它——await 点的「等待」在 SLA 侧退化为阻塞调用本身，控制流与
  顺序保持 1:1。不要为了形式上保留 await 而虚构挂起点。

### 1.7 Promise.all / race 的对应物

- `Promise.all([a, b])`（恰两个）→ `future::join2(a, b)`，
  结果用 pair_left/pair_right 拆。出处：join2_runtime、join2_await 系列。
- 三个以上：**没有 joinN 构造子**（34 个测试 + future:: 符号全集里
  不存在）。对应做法：task 数组/Vec + executor 轮询（1.5e），或按
  while-let future 队列逐个 `.await` 收集（test_unit_async_while_let_
  future_queue_direct——顺序 await、保序收集，语义是「全部完成后按序
  取值」，并发度低于 Promise.all，此差异必须在转换注释里写明）。
- `Promise.race([a, b])` → `future::select2(a, b)`（either_side 判赢家）。
  出处：select2_runtime。三个以上 race：未证实有对应物。
- 「并发」本身：SLA 的 future 是惰性轮询模型，没有自带调度器把多个
  future 同时推进到不同线程；真并发靠 thread::spawn 分线程驱动
  （1.4），或单线程 executor 交错 poll。转换 Promise.all 时若原代码
  依赖并发时序（如竞速写同一状态），必须逐案人工核对，不能机械套
  join2。

### 1.8 闭包 / 回调

- `^|| body` 是 move 闭包语法，用于 `thread::spawn(^|| ...)`，按值
  捕获环境（future、Arc 克隆等）。出处：test_unit_async_thread_pool、
  async.sla 头注释（`thread::spawn(^|| drive(f))`）。
- `|x| expr` 普通闭包用于组合子：sala 09_rust_compare 引 rosetta 18
  `Some(3).map(|x| x + 5)`（文档出处，非 async 测试族内）。
- async fn 本身对词法环境的捕获由状态机测试覆盖（defer_ready_capture_*
  系列：标量、结构体、多值捕获跨 await 保持）。
- **async 闭包字面量**（如 `async || { ... }` / 把 async 函数作为回调
  值传递）：34 个测试与 sala 文档中**未见此形态，未证实**。TS 的
  async 回调（如 `Array.map(async ...)`、事件处理器 async 化）转换
  时应改写为命名 async fn + 显式 future 收集（1.7 的队列/executor
  形态），不要假设闭包可直接 async 化。

### 1.9 错误：Result / 状态码，没有异常

- SLA 无 throw/try/catch、无 unwind、无 panic catch；panic 是数值码
  `panic(n)`（字符串变体走 sa_std panic_msg）。出处：sala
  09_rust_compare 错误处理节。
- 同步代码的错误模型是返回值驱动：`Result<T, E>` + `?` 后缀传播、
  `Option<T>`，均已落地（同页对照表 + rosetta 19 示例）。
- async 中的错误：**async fn 返回 `Result<T,E>`、在 async fn 内用 `?`
  传播、future<Result<..>> 的 poll 结果拆解——34 个 async 测试中没有
  专门用例，属未证实组合**（SA 契约层 PollResult 预留 ok/err 槽，
  见 1.3，仅说明布局存在）。转换规则按 R10 处理并逐案小探针验证，
  不许默认「肯定行」。
- TS async 函数的 throw → SLA 侧改成返回 Result/状态码并在调用点
  显式传播；TS 的 `.catch(() => {})`（吞错）对应「检查状态码后显式
  忽略」，必须在转换注释里标明吞的是哪类错误。

### 1.10 取消与超时

- future 取消/abort：语料中**无对应构造，未证实**（sala 09_async 提到
  的「HTTP client async ABI 有 poll/cancel」是插件句柄接口，不是 SLA
  future 面，不要混用）。
- 超时：手写截止时间轮询（rosetta 314 的 2s deadline、
  sched_block_on_timeout 的 timeout_ms，超时 panic）。TS 的
  AbortSignal.timeout / Promise.race 超时模式按此改写并注明语义差。

### 1.11 与 sala 文档快照的一处出入（重要）

sala 09_async / 10_maturity / 08_faq 的快照称「跨 async fn 边界的嵌套
await 仍是缺口，rosetta 314/315 双后端同 panic」。但在**当前树**
（2026-10-26 实测）：test_unit_async_nested_pending_resume_state_
machine（外层 async fn 连续 await 两个内层 async fn、内层含
defer_ready 真挂起、三轮 poll 后 Ready=42）PASS，rosetta 314 以
`sa test` 运行亦 PASS。因此「嵌套 await 一律不可用」不成立；准确
表述是：**task::poll 驱动下的嵌套 await 已实测可用；文档快照滞后于
当前树**。手写 poll 驱动跨函数传递 future 的注意事项见 1.4。
转换/修复中遇到嵌套 await 形态时，先用 (b) 式驱动小样验证再批量套用。

### 1.12 执行器成熟度（不要过度承诺）

sala 09_async 定性：async/await 是「专用 lowering，不是任意 async
函数的通用 CPS/状态机」；task.sa executor 是任务数组轮询，没有
Tokio 级 reactor、调度公平性、背压、结构化并发。已验证形态之外的
async 写法（深层嵌套组合、await 在复杂控制流交汇点、future 容器
的高阶组合）可能撞 `UnsupportedSabDirectFeature` 式的大声失败——
失败是显式的，不会静默回退；转换时逐形态验证即可，不要因此回到
「压平为同步」的老路。

## 2. TS → SLA async 映射规则集

| # | TS 形态 | SLA 映射 | 出处 / 置信度 |
|---|---|---|---|
| R1 | `async function f(): Promise<T>` | `async fn f(...) -> T`；调用点 `.await` 或同步边界 block_on（1.5） | test_unit_async_await；已证实 |
| R2 | `await expr` | 后缀 `expr.await`；expr 可为调用、局部 future 变量、参数、join2/select2 结果 | await / param_await / join2_local_await；已证实 |
| R3 | 函数体内顺序多个 await | 同一 async fn 内线性连续 await（局部跨 await 保持） | linear_three_await、two_await、nested_pending_resume；已证实 |
| R4 | `Promise.all([a,b])` | `future::join2(a,b)` + pair_left/right | join2_runtime；已证实（仅二元） |
| R5 | `Promise.all([a,b,c…])` | 无 joinN：task 数组/Vec + executor 轮询，或 while-let 队列顺序 await（注明并发度差异） | executor_runtime、while_let_queue；形态已证实，语义差需注释 |
| R6 | `Promise.race([a,b])` | `future::select2(a,b)` + either_* | select2_runtime；已证实（仅二元） |
| R7 | 同步入口需要 async 结果（main、同步回调、契约 fn 指针） | 同函数内 `task::new(f)` + poll 轮询 block_on（1.5b）；仅当 future 链无真挂起时可用 1.5a 的直接 .await | task_runtime、rosetta 314、本仓探针；已证实 |
| R8 | `await` 一个 Node 异步 API（fs/process/…），SLA 侧只有阻塞 extern | async fn 内直接调用阻塞 extern，await 点退化为该调用（1.6） | block_on_direct（thread::sleep）、本仓探针（fs exists）；已证实 |
| R9 | fire-and-forget（不 await 的 promise、后台 job） | `thread::spawn(^|| drive(f))` + `Arc<Mutex<T>>` 回传，或 async.sla 的 worker 执行器（限 i32 协议）；**禁止静默丢弃或假装同步完成** | thread_pool、async.sla；已证实（线程式） |
| R10 | async 中的 throw / try-catch / .catch | 返回 `Result<T,E>`/状态码 + 调用点显式传播（`?` 仅同步代码已证实；async 内 `?` 未证实，逐案验证）；吞错必须注释标明 | 09_rust_compare 错误节；部分未证实 |
| R11 | 用 Map<string, Promise> 做在途去重/串行化链、await 屏障（如 skillSyncInflight） | **无 1:1 对应**：需用显式状态（全局 cell——见缺口 2 的 sa_global_*）+ async 链重建，属人工再设计；**严禁**塌缩成「无状态、恒成功」的桩（反例见 ASYNC_AUDIT 的 saVmWorkspaceSkill） | 34 测试无此形态；由审计反例 + 模型边界（1.12）推出 |
| R12 | async 迭代（for await / 流） | future 集合可用 while-let + `.await` 逐个取（1.7）；真正的异步迭代器协议未证实 | while_let_queue；部分未证实 |
| R13 | setTimeout / 延时 | async fn 内 `thread::sleep(Duration::from_millis(n))`（阻塞驱动线程）；超时逻辑用截止时间轮询 | block_on_direct、rosetta 314；已证实（语义差需注释） |
| R14 | async 回调参数（handler: () => Promise<T>） | 改写为命名 async fn，把回调调用点变成产生 future 并按 R4/R5/R7 收集；async 闭包字面量未证实（1.8） | 由 1.8 边界推出 |

## 附录 A：探针实证（findAgentsMdProjectRoot 模式）

源码：`_defects/async_probe/probe_find_root.sla`（与本文同提交）。
模式：自 cwd 向父级逐级找 `.git`，每级 await 一次存在性检查，找不到
回到 cwd 本身——即 backends/mini `agentsMdInventory.ts` 中
`findAgentsMdProjectRoot` 的控制流（其 .sla 转换件 L47 是本审计确认的
语义桩：函数体只剩 `out_len = cwd_len; return 0;`，逻辑仅存于注释）。

探针结构（全部为「转换时被压平掉」的形态，故意用最忠实写法）：
- `async fn git_exists(dir)`：拼 `<dir>/.git` → 阻塞 extern
  `sa_std_fs_exists` → `future::defer_ready(raw).await`（每级一次真挂起）；
- `async fn find_root_async(cwd, out)`：`while true` 循环内
  `git_exists(&dir).await`（嵌套 async await），局部结构体 `dir` 跨
  await 变异（逐级改 len 上溯），命中写 out、到根未命中写 cwd；
- 同步入口 `main` → `drive_case`：同函数内 `task::new(...)` +
  `task::poll` 1ms 轮询驱动（1.5b 形态），结果写文件供外部比对。

运行输出（2026-10-26，`sa build-exe` 编译后直接运行，EXIT=0）：

```
exists_raw_yes=0
exists_raw_no=3
case1_rc=0
case2_rc=0
PROBE_PASS
/tmp/async_probe_out1.txt -> /tmp/async_probe_t1/repo
/tmp/async_probe_out2.txt -> /tmp/async_probe_t2/x/y
```

断言 1（祖先命中）：cwd=`/tmp/async_probe_t1/repo/deep/deeper`，
`.git` 在 `/tmp/async_probe_t1/repo/.git` → 返回 `/tmp/async_probe_t1/repo` ✔
断言 2（无命中回 cwd）：cwd=`/tmp/async_probe_t2/x/y`，向上至 `/`
无 `.git` → 返回 cwd 本身 ✔

结论：循环 + 嵌套 await + 跨 await 状态变异 + 阻塞 extern 的组合
形态在当前编译器上成立，转换简报的压平规则没有语言层面的依据。

顺带实测（与 async 无关，但探针挖出，记录在案）：
`sa_std_fs_exists` 返回的是**状态码**不是布尔——存在返回
SA_STD_OK=0，不存在返回 3（FileNotFound）。实现出处：
sci/src/runtime/sa_std.zig `sa_std_fs_exists`（access + finish/
finishErr），windows 版同形。已转换代码中把它当布尔用的地方
（如 mini-codex/src/agentsMd.sla 的 `if sa_std_fs_exists(...) && ...`）
语义是反的，属另一条缺陷线，不在本任务修复范围。

## 附录 B：本轮未复跑 / 未证实清单

- test_unit_async_thread_pool：未复跑（见 §0 口径说明）。
- async fn 返回 Result / async 内 `?`：未证实（1.9）。
- future 取消、定时器 future（future::delay 类）：语料无，未证实（1.10）。
- 三元以上 join/race 构造子：不存在于 future:: 符号全集（1.7）。
- async 闭包字面量：未证实（1.8）。
