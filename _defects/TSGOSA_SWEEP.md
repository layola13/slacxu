# TSGOSA_SWEEP — tsgosa 编译 CXU 后端面坑普查（第一轮）

日期：2026-10-26。执行：Colab 盒（运行时 `986a7d79e415`），全程串行。
定位：tsgosa 探坑战役第一步——只普查、不修坑。终局不变（CXU 自有 TS 最终真 SLA）；
本普查为后续「按 sci / sa_std / tsgosa 三分类修地基」提供坑地图。

## 头条数字

| 口径 | 数 |
|---|---|
| 扫测文件（.ts，后端面） | 938 |
| OK（tsgosa 零拒绝产出） | 640（68.2%） |
| REFUSE（响亮拒绝） | 298（31.8%） |
| FAIL / TIMEOUT | 0 / 0 |
| 拒绝行总数 | 4051（涉及 298 文件，中位 6 行/文件，最大 361 行） |
| 警告行总数 | 678（全部为 import 记录，见「宿主边界」） |
| OK 中产出 ≥1KB 实现的文件 | **仅 2 个**（其余 638 个产出 <300B，源内容为类型/声明，擦除为空是正确行为） |

两个通过率口径必须分开读：**按「零拒绝」是 68.2%，但其中 610 个来自
packages/codex-protocol 的生成协议类型文件（类型擦除即空产物）；CXU 的后端运行时
逻辑几乎全在 298 个被拒文件里**（backends 129 文件全灭、apps/server 仅 11.3% 通过）。

## 基线异常（如实记录，未强行改）

- 预期基线 `f2cb649d`；盒上 `/content/codex-react-ui` 实际 HEAD = `6e1228cf`
  （分支 `plugins`）= 基线 + 2 提交（`66ac1f78` cline 子代理工具路由、
  `6e1228cf` web 顶栏图标），`f2cb649d` 为其祖先。
- 工作树另有未提交修改，含扫测面内 3 个文件（backends/agy ×2、backends/command-code ×1）。
- 本普查按**工作树现状**执行；与基线的扫测面差异仅上述少量文件，结论不受影响。

## 第 0 步：调用面与冒烟

- 调用面：`tsgo --sa [--out <dir>] <file.ts> [...]`（`cmd/tsgo/main.go:28` →
  `internal/transpile/transpile.go` 的 `RunSA` → 单文件薄口 `TranspileSA`）。
  退出码：0 = 零拒绝；1 = 有拒绝（逐条写入 `subset-report.txt`，格式
  `文件:行:列: 原因`）；2 = 用法/IO 错误。另有整程序模式 `tsgo build <dir>`
  （多文件链接，其自述为 Phase 2），本轮按任务口径用单文件模式。
- **Go 工具链在本运行时缺失**（`/usr/local/go`、`/opt/go` 均无）：已按 AGENTS.md
  记录的位置从官方 tarball 装 Go 1.26.0 到 `/usr/local/go`；`go build ./cmd/tsgo`
  构建 tsgo（44MB，暂存 `/tmp/tsgo-bin/tsgo`，/tmp 不持久，换运行时需重建）。
- 冒烟：对 `demos/01_hello/main.ts` 重新生成，产物与仓内既有 `main.sai`
  **逐字节一致**，退出码 0、拒绝报告为空。调用面与既有门禁口径对齐。

## 扫测面口径

源：盒上 `/content/codex-react-ui`。根目录：`apps/server/src`、`sdk-backend/src`、
`sdk-frontend/src`、`packages/{cxu,codex-protocol,shared}`、`backends/*/src`、
`mini-codex`、`apps/duck2api`、`apps/free-key-server`。
排除：`node_modules`、同根下 `*.test.ts`（15 个）、`*.d.ts`（8 个）——后两类只计数不扫；
面内无 `.tsx`/`.mts`/`.cts`。逐文件串行、单文件超时 30s，零超时发生。

## 按目录分布

| 目录 | 文件 | OK | REFUSE | 通过率 |
|---|---|---|---|---|
| packages/codex-protocol | 610 | 610 | 0 | 100.0% |
| sdk-frontend | 6 | 5 | 1 | 83.3% |
| sdk-backend | 26 | 8 | 18 | 30.8% |
| apps/duck2api | 13 | 2 | 11 | 15.4% |
| apps/server | 97 | 11 | 86 | 11.3% |
| apps/free-key-server | 9 | 1 | 8 | 11.1% |
| packages/cxu | 28 | 2 | 26 | 7.1% |
| mini-codex | 15 | 1 | 14 | 6.7% |
| backends | 129 | 0 | 129 | 0.0% |
| packages/shared | 5 | 0 | 5 | 0.0% |

被拒最多的文件：`apps/server/src/index.ts`（361 行）、
`backends/mini/src/runtime/miniBridge.ts`（240）、
`backends/relay-config/src/relay/omniRouteFree.ts`（197）、
`backends/relay-config/src/relay/relayProtocolGateway.ts`（160）、
`apps/server/src/saVmTool.ts` 与 `packages/cxu/src/vendor/saVmTool.ts`（各 146）。
72 个文件只有 1 行拒绝；19 个文件的拒绝全部是注解类。

## Top 10 拒绝签名（按根因聚合，322 个不同根因签名）

聚合方法：剥离「unsupported initializer:/condition kind:/ternary condition:」等上下文
前缀后按根因消息计数（数字归一化、kind 编号保留）。Top 10 合计 2978 行 = 全部拒绝的 73.5%。

| # | 根因签名 | 行数 |
|---|---|---|
| 1 | unsupported parameter annotation (i32/bool/arr/str/inst only) | 735 |
| 2 | step2 refuses kind 244 (only top-level functions) | 666 |
| 3 | unsupported return annotation | 659 |
| 4 | only direct function calls lowerable | 296 |
| 5 | unsupported return annotation: union | 176 |
| 6 | only +/==/!= operate on strings | 139 |
| 7 | typeof value is not statically known | 108 |
| 8 | only .length member access lowerable | 95 |
| 9 | array initializer must be literal or array | 54 |
| 10 | instanceof needs statically known types | 50 |

kind 244 已解码：`internal/ast/kind_generated.go` 中 `KindVariableStatement = 244`——
即顶层 `const/let/var` 声明（非纯量折叠、非顶层箭头、非 ambient 的）一律拒，
本质是**模块级状态/配置实例没有落点**（与 SLA 侧缺口 2「顶层可变全局」同源）。
注解家族（#1+#3+#5）合计 1570 行（38.8%）：单文件薄口只认
i32/bool/arr/str/inst 注解，接口/泛型/联合等富类型注解直接拒——这是单文件模式
无 checker 类型信息的结构性结果。

## 三分类（按拒绝行，依「修复落点」归类；文件数可跨类重叠）

| 类 | 行数 | 占比 | 涉及文件 | 说明 |
|---|---|---|---|---|
| tsgosa 发射器（单文件薄口模型） | 3929 | 97.0% | 297 | 注解面、顶层语句面、表达式子集、静态已知性等构造级拒绝，明细见 Top 10 与原始 TSV |
| sa_std — RegExp 引擎表达力 | 59 | 1.5% | 46 | 拒绝文案自陈「needs POSIX ERE」：JS 正则的 `\s` 类、lookahead、命名组等超出 sa_std `text/regex.sai` 的 POSIX ERE 子集；多为设计性拒绝，与 CAPABILITY_MAP 既有裁决一致 |
| 宿主边界 / 未解析名 | 32 | 0.8% | 25 | `unknown variable/class X`：宿主全局（Promise 8、Map 6、Headers 3、URL 3、AbortController 2）+ 跨文件项目名（单文件模式无解析）；另含 import defer / import=require 拒绝 |
| sa_std — 投影面未覆盖 | 31 | 0.8% | 21 | 文案自陈「is not a projected std surface」，具名表面见下 |
| sci 编译器 | 0 | 0% | 0 | 本轮只测发射层、未对产物跑链接；抽样探针（下）未见 sci 层拒绝。此层坑在整程序链接/`sa check` 阶段才暴露，是后续步骤 |
| 未分类 | 0 | — | — | 全部拒绝行均被规则覆盖；tsgosa 类为余量归类，其内部构成由 Top 10 与原始数据给出，长尾（322 个签名）全量保留在 `refusals_all.tsv` |

sa_std 投影面未覆盖的具名表面（31 行全量）：`fs.mkdirSync` 9、
`url.fileURLToPath` 5、`fs.statSync` 5、`fs.readFileSync` 4、`path.relative` 3、
`fs.readdirSync` 2、`fs.writeFileSync` 1、`fs.rmSync` 1、`crypto.randomInt` 1。
注：此类修复落点逐项二选一——sci 缺实现，或 tsgosa 投影表缺映射；已知
`fs.mkdirSync` 属后者（sa_std 已有 `sa_fs_mkdir_p`，2026-10-26 为 SLA 缺口 3 所补；
与本普查独立互证）。

## 宿主边界（警告流，import 全景）

678 行警告全部是 `local module import <spec> recorded; single-file lowering
continues (multi-file link is Phase 2)`——跨文件 import 不拒、只登记顺延，
被导入名在实际使用点以 unknown 拒（见上）。308 个不同 specifier 按行数分桶：

| 桶 | 行数 |
|---|---|
| 相对路径（项目内部，Phase 2 链接域） | 412 |
| `node:` 内置 | 155 |
| 项目别名（@cxu/*、@codex-ui/*） | 94 |
| npm 包 | 17 |

npm 仅 12 个包：ws 3、js-tiktoken 2、web-tree-sitter 2、typescript 2、hono 1、
@hono/zod-validator 1、zod 1、pngjs 1、qrcode 1、better-sqlite3 1、bcryptjs 1、
smol-toml 1——与既有第三方表面清单一致。内置模块全部走 `node:` 前缀
（裸 builtin 名 0 行）。

## sci 层抽样探针（附带，非普查口径）

对 30 个 OK 文件的产物（按产出体积抽样、跨目录）+ 仓内 demo 既有产物跑
`sci` 的 `sa check`（env：`SA_STD_DIR=/content/sa_all/sci/sa_std`、
`SA_PLUGIN_DEV=1`）：**31/31 退出码 0**。其中 28/30 样本 `instructions=0`
（类型擦除为空，与产出体积口径互证）；非空样本如
`apps/server/src/threadRpcRouting.ts`（产物 2884B）亦通过。
结论限于样本：已发射的 SA 未见 sci 拒绝；sci 层普查需整程序链接阶段另行组织。
原始探针结果见 `probe_sacheck.tsv`。

## 普查推论（供排修地基顺序参考）

1. 绑定约束是**单文件薄口的类型模型**，不是逐个构造：Top 3 签名合计 2060 行
   （50.9%）全是注解面 + 顶层变量声明。先给 tsgosa 喂 checker 类型信息或切
   整程序模式（`RunBuild`），预期可回收的拒绝远多于逐构造补 lowering。
2. sa_std 的坑面小而具体：9 个未投影表面 + RegExp ERE 边界，都是点状修复。
3. sci 层在本轮不可见：下一轮普查应以「产物整程序链接 + sa check」为口径，
   或直接在修 tsgosa 类型模型后复扫。

## 交付物

- `_defects/TSGOSA_SWEEP.md`：本报告。
- `_defects/sweep_results.tsv`：逐文件原始结果（路径、结果、退出码、拒绝/警告
  计数、产物字节、耗时、首拒绝签名与摘录）。
- `_defects/refusals_all.tsv`：全部 4051 行拒绝 + 678 行警告原文（逐行带文件）。
- `_defects/probe_sacheck.tsv`：sci 抽样探针原始结果。
