# CXU → SLA/SAX 批量转换简报（所有转换单元共用）

策略（用户 2026-10-26 定）：先批量转换、后分阶段修复。本阶段**只转换不修复**：
不编译、不跑测试、不改 stdlib/编译器。发现的缺陷只记录，不停下来解决。

## 铁律：1:1 复刻，不要原创

- 源（只读）：`~/workspace/projects/codex-react-ui/<相对路径>`，plugins 分支 @ f2cb649d。
- 输出：`~/workspace/cxu-sla-mirror/<同一相对路径>`，每个 `.ts` → 同名 `.sla`，
  每个 `.tsx` → 同名 `.sax`，与已复制的源文件并排存放。
- 目录、文件、函数、类型一一对应：不改名、不重构、不合并、不拆分（单个巨型文件
  也在一个 .sla 内顺序转换）。TS 标识符尽量原样保留；语言不允许时才做最小
  变形（如 camelCase → 保持原名优先），并在缺陷日志里登记变形。

## 缺陷记录（双通道）

1. 行内：无法等价转换处在代码里留 `// DEFECT:` 注释，写明缺什么。
2. 日志：追加到 `~/workspace/cxu-sla-mirror/_defects/<你的单元名>.md`，
   每条格式：`源文件:行号范围 | TS 构造 | 缺失能力/问题 | 采用的近似`。
   典型缺陷：async/await、Promise、闭包捕获可变状态、类继承、泛型、动态 JSON、
   EventEmitter/流/定时器、DOM/React 钩子、Node API 无 sa_std 对应等。

## SLA 方言速查（以仓内现有 SLA 为准，可读
`~/workspace/colab-relink/v12/*.sla` 与 `~/workspace/colab-relink/*.sla` 样例）

- 导入：`@import "sa_std/io/print.sai"`、`@import "相对路径.sla"`。
- 函数：`fn name(a: &Struct, b: u64) -> i32 { ... }`；无类：TS class →
  `struct` + 以 `&Struct` 为首参的函数族；方法名保持原名。
- 类型：number→u64/i32/f64（按语义选），string→(ptr,len) 或定长字节数组字段，
  boolean→bool，数组→定长数组+len 字段（容量按源语义估并注释），
  Record/动态对象→JSON 文本缓冲 + `// DEFECT: dynamic object`。
- 控制流：计数循环 `for i in 0..n {}`；`while cond {}` 后**不加** `;`，
  `if {}` 块后**要加** `};`。字符串字面量经 `STR_PTR("...")`/`STR_LEN("...")`
  传给 extern；extern 风格见 sa_std 的 .sai（sa_json_*、sa_std_fs_*、
  sa_http_client_sse_turn_ex、sa_std_process_spawn_bidi 等）。
- async 函数 → 同步函数 + 返回状态码，签名处 `// DEFECT: async`；
  回调/Promise 链 → 顺序调用近似 + DEFECT。
- 每个 .sla 文件头注释：`// Converted 1:1 from <相对路径>.ts (CXU plugins @ f2cb649d). Bulk conversion pass — defects logged, not yet fixed.`

## SAX（.tsx → .sax）

- JSX 元素树 → SAX 元素树：标签、层级、文本、属性名 1:1 保留；
  组件名原样；`{expr}` 表达式 → 属性绑定注释 `<!-- bind: expr -->` + DEFECT 登记；
  hooks（useState/useEffect 等）、事件处理器 → 结构保留 + DEFECT 登记
  （SAX 目前是界面方言，行为层缺口统一记为 `SAX: no behavior counterpart`）。
- 文件头注释同 SLA 规则（.sax 写明源 .tsx 路径）。

## 交付标准（本阶段完成 = 转换覆盖率，不是可编译）

- 单元内**每一个** .ts/.tsx 都有对应 .sla/.sax（barrel/re-export 文件也要有
  对应文件：等价 @import 转发 + 注释）。
- 纯类型文件（interface/type 集合）→ struct/常量声明文件。
- 完成后在你的最终回复里报告：转换文件数、源总行数、缺陷条数与前 5 类缺陷。
- 不要动 `_defects/` 以外单元的文件；不要改源仓；不要提交 git。

## 追加指令（2026-10-26 00:37，用户）：优先用 sa_std 的 ts 库

sa_std 里有现成的 TS 语义库（清单见 _defects/SA_TS_INVENTORY.md）：
ts_string.sa / ts_array.sa / ts_math.sa（@ts_str_*/@ts_arr_*/@ts_math_*）、
tree_sitter.sai 的 sa_ts_* 16 个 extern、async.sla/future.sa/sync 面。
转换时 JS 的 String/Array/Math 方法、tree-sitter 调用、异步结构先查清单，
有对应的一律 @import 绑定，不再手写扫描近似或占位 extern；缺陷日志对应条目
改记为「已绑 sa_std ts 面」。已完成单元的同类桩将在修复阶段统一回绑。
