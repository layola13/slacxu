# TSGOSA_SWEEP2 — 整程序路径重普查 + sci 链接层首普查

日期：2026-10-26。执行：Colab 盒（运行时 `986a7d79e415`），全程串行、逐程序 timeout 包裹。
定位：tsgosa 探坑战役第二步。第一步（单文件薄口）结论是「拒绝 97% 归单文件模型、
先喂 checker 的回收量最大」；本轮把扫测切换到整程序路径验证该推论，并首次把
发射产物送进 sci 做链接层普查。只普查、不修坑。

## 头条结论：第一步的推论被证伪

**回收量 = 0。** 第一步 298 个 REFUSE 文件，在整程序路径的全部视图
（规范入口 / 入口轮换 / reach-all 合成入口）下，没有一个变成 OK；
92 个被整程序路径实际尝试并以同一批签名再次拒绝，228 个根本没被任何
程序视图触达（被环阻断或不在入口可达集内）。

原因不是「checker 还没喂够」，而是结构性的：**tsgosa 根本不存在
「整程序 checker 喂给 lowering」的路径**（见下节查实）。参数/返回标注
只认 `i32/bool/arr/str/inst` 是 lowering 自身的标注子集纪律，与 checker
在不在场无关——整程序模式下同一批文件以逐字相同的签名被拒，就是证据。

整程序路径真正的产出是**四个单文件模式看不见的新层**：程序图环拒绝、
入口可达性塌缩、链接特性后置（link in a later stage）、以及 sci 消费层的
接缝问题。这四层才是本轮的真坑图。

## 第 0 步：整程序入口查实（以仓内代码为准）

tsgosa 的 SA 发射有两个入口（`cmd/tsgo/main.go`）：

| 入口 | 命令 | 机制 |
|---|---|---|
| 单文件薄口 | `tsgo --sa [--out dir] <file.ts>...` | `RunSA` → `TranspileSA`，第一步用的就是它 |
| 整程序 | `tsgo build [--out dir] [--entry f] [--mod name] <dir>` | `RunBuild` → `saLowerProgram` |

`saLowerProgram`（`internal/transpile/transpile.go:5047` 起）的工作方式：
走一棵目录树收全部 `.ts`（含 `.d.ts` 作类型单元）→ 用 `internal/module`
解析器（Bundler 口径、真实文件系统、含 node_modules）建跨文件图 →
从入口 DFS 求可达集与依赖序 → 逐文件经 `transpileSAInner` 降低，
跨文件信息靠 `saFileLink` 的 harvest 签名表（已降低文件的函数签名/
类布局/常量先行收割）→ 产出 linked SA workspace（`sa.mod` +
`packages/<mod>/src/*.{ts,sa}` 扁平前缀名产物 + `build.sh` +
`subset-report.txt`）。任一文件被拒 → 整程序 `refused=true`、退出码 1，
但 workspace 照常写出。

**关键事实**：逐文件降低时构造的 checker Program 仍然只有该文件本身
（`transpileSAInner`：内存 VFS、单文件、`NoLib/NoResolve/NoCheck`）；
checker 仅用于未标注函数的返回类型推断（`saTypeCtx`）。跨文件类型信息
只经 harvest 签名表流动，不经 checker。仓内没有第三条
「compiler.Program 覆盖整工作区再发射 SA」的路径；
`internal/compiler/emitter.go` 无 SA 钩子（AGENTS.md 铁律 2 描述的是
transpile 包内的管线形态，不是上游 tsc emit 路径）。

验证（动手前）：
- `demos/224_zod_subset` 副本整程序构建 rc=0，workspace 产物齐
  （`packages/zod_subset/src/main.sa` / `patterns.sa`）。
- `demos/01_hello` 整程序模式产物与单文件模式仓内既有 `main.sai`
  **逐字节一致**——两个模式共用同一降低核，差异只在文件集与链接环境。

## 依赖面核查（/content/codex-react-ui，HEAD 6e1228cf）

- `node_modules` 存在（bun.lock 对应的部分安装）：`@types/*` 在，
  `@codex-ui/*`、`@codex-ultra/cxu` 工作区链接在。
- **`node_modules/@cxu/` 缺失**：已补两个工作区符号链接
  `@cxu/sdk-backend -> ../../sdk-backend`、`@cxu/sdk-frontend -> ../../sdk-frontend`
  （只动 node_modules，属装依赖）。补后仍有 16 个程序把
  `@cxu/sdk-backend` 记为 unresolved：其 package.json 运行时入口是
  `./dist/index.js`，而**该克隆从未构建过 dist/**；类型口径可解到
  `src/index.ts`（作类型单元），运行时口径无目标。仓内无 tsconfig
  `paths`（`tsconfig.base.json` 无 paths 段），且 tsgosa 解析器本就不读
  tsconfig paths。
- 工作树未提交文件共 5 个（扫测面内 3 个：backends/agy ×2、
  backends/command-code ×1；另 tests ×2），本轮照现状用、未动。

## 规范视图结果（25 个程序，各自默认入口）

程序级：**24/25 refused**。唯一 refused=false 的 codex-protocol 入口只
可达 1 个文件（见「入口可达性塌缩」）。

938 文件面（与第一步同口径）：

| 状态 | 文件数 | 说明 |
|---|---|---|
| OK | 3（0.3%） | 其中 ≥1KB 实现产物仅 1 个（`apps/free-key-server/src/adminPage.ts`，11692B） |
| REFUSE | 57 | 被入口可达并尝试、被拒 |
| BLOCKED_CYCLE | 129 | 程序在图阶段整程序被拒，0 文件降低 |
| NOT_IN_PROGRAM | 747 | 在目录内但不在入口可达集 |
| NO_PRODUCT | 2 | 可达、无拒绝、无产物（纯类型擦除：packages/cxu 与 codex-protocol 的 index 桶文件） |

### 新层 1：程序图环拒绝（tsgosa 发射器）

DFS 对可达图任一回边即整程序拒绝、0 文件产出。规范视图 3 个程序中招：

- `apps/server`：`pluginHost.ts -> pluginHostServices.ts -> cliVersions.ts -> pluginHost.ts`
- `sdk-backend`：`src/index.ts -> src/server.ts -> src/index.ts`
- `sdk-frontend`：`src/index.ts -> src/web.ts -> src/index.ts`

其中 **sdk-frontend 的环是纯类型环**：index→web 是 `export type {...} from`
加 `import type`，web→index 是 `import type { PluginManifest } from "./index.js"`
（逐行读源确认，两条边都是 type-only）。在副本上把全部本地说明符的
`.js` 后缀剥掉重跑，环依旧——**type-only 边进了运行时环检测图**，
与说明符形式无关。这是 CXU 的主导架构形态（桶文件 + 类型回引），
不是边角案例。

reach-all 视图下另有 **124 个后端文件被第三方依赖内部的环阻断**：
14 个 backends 程序在合成入口下全部死于
`node_modules/smol-toml/dist/struct.js -> extract.js -> struct.js`。
链路：后端值导入 `@cxu/sdk-backend` → 其类型单元 `src/index.ts` 的图边
跟随到 `codexVirtualConfig.ts`（`import { parse, stringify, ... } from "smol-toml"`，
sdk-backend 内唯一 smol-toml 导入点；backends/mini 另有直接导入
`miniMcp.ts`）→ 解析到 smol-toml 的 dist JS 运行时文件 → 库自身内部环
触发整程序拒绝。**任何带内部环的真实 JS 依赖都会 nuked 整个程序**，
与项目代码无关。

### 新层 2：入口可达性塌缩（程序定义问题）

整程序 = 入口可达集，不是包表面。18/25 个程序的可达集 ≤2 个文件：

- backends ×16：入口落到 `src/manifest.ts`（无 src/index.ts/main.ts 时的
  字典序兜底），manifest 只做类型导入 → 每个后端可达集 = 2 个文件，
  其余 127 个后端文件根本不在程序内。后端包是「插件形」的——运行时
  入口在宿主（CXU 装载器）手里，包内没有 main 可达根。
- `packages/codex-protocol`：`src/index.ts` 不转出 generated 文件
  （它们由消费者逐个导入），可达集 = 1。
- `mini-codex`：无桶文件，入口落到 `src/agentsMd.ts`（字典序第一），
  可达集 = 1。

### 新层 3：链接特性后置（tsgosa 发射器，单文件模式没有的新签名）

- `default imports link in a later stage`（17 文件）
- `re-exports link in a later stage`（7 文件；裸单元侧另 26 行）
- `namespace imports link in a later stage` / `export lists link in a later stage`（裸单元侧 2 / 10 行）
- `top-level executable statements are not lowerable in non-entry program files`
  （裸单元侧 42 行，第一名）——只有入口文件可以有顶层执行语句，
  其余文件顶层语句即拒。

### 旧层不变：lowering 子集（tsgosa 发射器）

被整程序路径实际尝试的第一步被拒文件，以同一批签名再拒。
最佳视图合并后 REFUSE 92 文件的签名 Top（按文件数）：

| 签名 | 文件 |
|---|---|
| step# refuses kind # (only top-level functions) | 53 |
| unsupported parameter annotation (i#/bool/arr/str/inst only) | 38 |
| unsupported return annotation | 32 |
| unsupported initializer: only direct function calls lowerable | 26 |
| unsupported return annotation: union | 21 |
| default imports link in a later stage | 17 |
| only direct function calls lowerable | 16 |
| array initializer must be literal or array | 10 |
| unsupported condition kind: only +/==/!= operate on strings | 9 |
| unsupported initializer: only .length member access lowerable | 8 |

与第一步 Top 签名对照：前列就是第一步的同一批（第一步口径下
参数标注 152 行、顶层语句 143 行、返回标注含 union 约 133 行……），
**整程序环境没有改变任何一条的判定**。

## 探针视图（只作差分，不并入规范口径）

- **入口轮换**（环程序各 4–6 个非环内入口）：apps/server 触达 14 文件
  全拒；sdk-backend 4 拒 + 1 NO_PRODUCT；sdk-frontend 1 OK
  （waterfallTypes，纯类型）+ 1 拒 + 1 NO_PRODUCT。
- **reach-all 合成入口**（副本 + `export *` 合成入口 + node_modules 链接）：
  codex-protocol **610/610 OK**（rc=0；其中 ≥1KB 产物 4 个，其余为
  类型擦除的近空产物，与第一步口径一致）；mini-codex 触达 15 文件
  1 OK / 14 拒；packages/shared 5 拒；backends/free-mode 3 拒、
  opencode-v2 2 拒；其余 14 个 backends 死于 smol-toml 环（见新层 1）。

## 最佳视图合并（全部程序模式的并集）

| 口径 | 第一步（单文件） | 本轮最佳视图 |
|---|---|---|
| OK | 640（68.2%） | 615（65.6%） |
| 其中 ≥1KB 实现产物 | 2 | 5（free-key adminPage + codex-protocol generated ×4） |
| REFUSE | 298 | 92（被尝试） |
| 从未被触达 | 0 | 228（NOT_IN_PROGRAM）+ 3 NO_PRODUCT |

注：615 的构成与第一步的 640 高度重合（610 个协议类型文件 + 5 个），
且第一步 OK 的文件有 25 个在所有程序视图下都不 OK（不可达/无产物）。
**两个模式的 OK 集合本质是同一批「类型擦除即空」的文件**；运行时实现
在两个模式下都几乎全军覆没，只是死法不同。

## sci 层首普查（48 个 workspace 的产物送 `sa build-workspace`）

| 结果 | workspace 数 | 说明 |
|---|---|---|
| BUILD_OK | 0 | — |
| LINK_NOMAIN | 17 | 编译层通过、链接缺 `main` 符号 |
| COMPILE_FAIL | 13 | FallthroughForbidden 6 + PackageNotResolved 6 + MemoryLeak 1 |
| NO_PRODUCTS | 18 | 环阻断/未产出，无从测起 |

三类 COMPILE_FAIL 的首例与归属：

1. **FallthroughForbidden（6 个 workspace）**——sci Referee 拒收
   tsgosa 发射的 SA。首例：backends/jev 产物 `main.sa` 中
   `@stringifyCriteria(criteria: i32) -> ptr`，末块 `L_then_4:` 无终结符
   （trap 1014）。产物违规，**归 tsgosa 发射器**；Referee 本身工作正常。
   同类：apps/duck2api、backends/free-mode（规范+RA）、backends/jev、
   packages/shared（规范+RA）。
2. **MemoryLeak（1 个）**——首例：backends/opencode-v2 RA 产物
   `@src_server__probe(bin: ptr) -> ptr`，参数寄存器 `bin` 在函数出口
   仍存活（发射端未释放/未转移参数所有权）。**归 tsgosa 发射器**。
3. **PackageNotResolved（6 个）**——首例已定位：packages/cxu 的产物有
   8 个文件 `@import "node.sai"`，生成的 workspace 没有提供这个
   宿主投影面，sci 解析失败。**归宿主边界**（Node 投影 .sai 未随
   workspace 落地/未声明 require），是脚手架与宿主面的接缝。
   其余 5 个（free-key-server、mini-codex ×2、apps/server 探针、
   sdk-backend 探针）同为该错误类，未逐个定位到具体导入名。

LINK_NOMAIN 的 17 个：生成的 `build.sh` 一律 `build-workspace -o main`
链可执行文件，而这些包全是库（无 `@main` 合成）——**脚手架模板问题
（tsgosa）**，不是 sci 缺陷；这 17 个的编译层（Flattener/Referee）是
通过的，是本轮 sci 侧唯一的正面信号。

**sci 编译器本体：零确诊坑。** Referee 的两类拒收都是产物真违规；
解析失败是宿主面未落地。第一步「sci 类 = 0」不是因为没测到——
测到了，确实不在 sci 本体。

## 未解析说明符（规范视图报告汇总，按程序数）

`@cxu/sdk-backend` ×16、`node:crypto` ×15、`@codex-ui/shared` ×15、
`node:child_process` ×13、`@cxu/sdk-backend/server` ×12、`node:events` ×11、
`node:fs/promises` ×7、`node:readline` ×6、`node:http` ×4、`bun:test` ×2 等。
其中 `@cxu/*` 与 `@codex-ui/shared` 是工作区包（运行时入口 dist 未构建，
见依赖面）；`node:*` 是宿主 builtin 的 SA 投影面在程序模式下未接
（报告原文 "no SA backend yet"）——**归 sa_std 投影面 / 宿主边界**。
另有确诊的投影缺口实例：mini-codex `agentsMd.ts:47`
`fs.readFileSync is not a projected std string value`（sa_std 投影表未映射）。

## 三分类汇总（沿用第一步口径）

| 类 | 本轮测得 |
|---|---|
| **tsgosa 发射器** | 绝对主体：lowering 子集签名全表（92 文件被尝试再拒）、程序图环不容忍（规范 129 + RA 124 文件被阻断；含 type-only 假环与第三方库内环两种形态）、链接特性后置（default/re-export/namespace/export-list）、非入口文件顶层语句禁令、发射产物 Referee 违规（Fallthrough 6 ws + MemoryLeak 1 ws）、脚手架库包链 exe（17 ws LINK_NOMAIN） |
| **sa_std（含投影表）** | `node:*` builtin 投影未接（15 个程序报 node:crypto 等 unresolved）；具名未投影实例 fs.readFileSync（mini-codex agentsMd.ts:47）。数量不大，但都是硬缺口 |
| **sci 编译器** | **0 确诊**。Flattener/Referee/链接层对合规产物全通（17 个 workspace 编译层通过）；两类拒收均为产物违规、一类为宿主面未落地 |
| **宿主边界** | 工作区包 dist 未构建 → `@cxu/sdk-backend` 等 unresolved（16 程序）；`node.sai` 投影面未随生成 workspace 落地 → PackageNotResolved（6 ws）；`bun:test` ×2 |
| **未分类** | 无实质项（Top 签名全部归类） |

## 对修复顺序的含义（只给普查结论，不动工）

第一步设想的「先喂 checker」没有对应实现可切——checker 接入不是杠杆点。
按本轮测得的质量排序，整程序路线的前置修复是：
(1) 程序图环容忍（至少 type-only 边不入运行时图；真实值环需 SCC
级处理而非整程序拒）——253 次文件阻断；
(2) 链接后置特性（default imports / re-exports 等）——数十文件；
(3) lowering 子集本身（与第一步同一张表）；
(4) 程序定义与包形态的适配（插件形包无入口可达根）。
sci 侧不需要为本路线修任何东西；sa_std 侧是 `node:*` 投影面的
成建制接入问题，不是逐个符号的缺口。

## 原始数据

- `sweep2_results.tsv`：逐文件 × 视图（canonical / rotation* / reachall /
  cyclebreak_jsstrip）的状态、产物字节、拒绝数、签名。
- `sweep2_programs.tsv`：61 行程序 × 视图汇总（入口、refused、环、
  可达集、各状态计数、unresolved 说明符）。
- `sweep2_refusals.tsv`：1266 行拒绝明细（程序、视图、文件、行列、
  归一化签名、原文）。
- `sweep2_sci.tsv`：48 个 workspace 的 sci 普查结果（gate refused、
  产物数、分类、首错）。
- 全部构建在盒上 `/tmp/sweep2/`（out/ 规范 workspace、probe/ 探针
  workspace 与副本），/tmp 不持久，结论以本报告与 TSV 为准。
- 本轮未改动：CXU 源树（仅补 node_modules/@cxu 两个链接）、
  tsgosa、sci、sala、sa_plugin_sla、slacxu main 与其他 bulk 工作树。
