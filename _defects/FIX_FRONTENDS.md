# FIX_FRONTENDS — frontends 域 phase1 修复交付（Agent N）

基点 `a6fd8d4`，worktree `/content/bulk-frn`。检查口径：`.sla` 用
`sa check`（规范环境：worktree 根 cwd、SA_PLUGIN_DEV=1、
SLA_NO_FRESHNESS_CACHE=1、SA_SLA_FIXTURE_DIR、SA_STD_DIR=sci/sa_std，
逐文件 timeout 60 串行）；`.sax` 用 `sa sax build <f> --out-dir`（理由见 §5）。

## 0. 范围勘误与构成

简报口径 46 个，实测恰 **46**（42 .sla + 4 .sax），无勘误。
构成：manifest.sla ×17 + web.sla ×17（17 个前端各一对）+ jev 域内
6 文件（jevConfig/jevClient/jevQuestions/jevAutoJudge/
jevTurnSnapshotDispatch/JevSettingsDialog.sax）+ free-mode 域内
3 文件（freeAutoCompactPreferences/freeCompactionReadiness/
VmContextSavingsTab.sax）+ muse 域内 1 文件（saVmChatActivity）
+ enhance/vmtool-security 各 1 个 .sax。合计 .sla 7,327 行中本域终态
约 8.1k 行（含修复增行）；TS 源 4,047 行。

## 1. 基线 / 终态（失败名字集合口径）

- **基线：PASS 0/46。FAIL 集合 = 全部 46 文件**（逐一列名见
  /content/frn_baseline.log，本节按族归纳）：
  - A 族 39 文件：首错 ExpectedDeclaration 于 `/**` 块注释
    （SLA 无块注释，探针实证：`/*`、`/**`、多行块注释三种形态
    在声明位置均 ExpectedDeclaration，无注释对照 PASS）。
  - B 族 4 .sax：经 `sa check` 时被 SLA flattener 以
    ForbiddenSyntax 拒（扩展名未分发，见 §5）；经 sax 正道
    复测为 SA-SAX-CHECK UnexpectedToken（根元素非 `<Component>`）。
  - C 族：jevAutoJudge:77 / jevQuestions:259 / saVmChatActivity:194
    UnexpectedToken（while/for 块后 `;`）；jevClient:118 /
    jevTurnSnapshotDispatch:33 SyntaxError（虚构 extern fn）；
    freeCompactionReadiness 首错为导入 FileNotFound。
- 中间轮 r1（块注释修复后）：PASS 2/46（freeAutoCompactPreferences、
  jevConfig——两者唯一阻塞即块注释）。
- 中间轮 r2（string.sa 补导入 + json 路径修复后）：PASS 36/46，
  FAIL = {freeCompactionReadiness, jevAutoJudge, jevClient,
  jevQuestions, jevTurnSnapshotDispatch, saVmChatActivity} ∪ 4 .sax。
- **终态：PASS 42/46（全部 42 个 .sla）。FAIL 集合 = 4 个 .sax**
  （EnhanceToolsDialog.sax、VmContextSavingsTab.sax、
  JevSettingsDialog.sax、VmToolsSettingsTab.sax），阻塞族见 §6-1。

## 2. a/b/c 语义桩普查

- **(a) 真实实现/纯声明：40 个 .sla**
  - manifest ×17：真实 loader（plugin.json 运行时读入 + sa_json
    按需解析）；登记的表示层接缝 2 处/文件（sdk-frontend 类型以
    原始 JSON 文本承载、JSON module import 改运行时文件读，
    路径 `../plugin.json` 相对 CWD——表示选择，已在文件内登记）。
  - web ×17：builder 真实填充插件描述结构；其中 5 个
    （enhance/free-mode/jev/relay-config/vmtool-security）各含
    1 个 render 桩函数——其 TS 原型即 `render: () => { throw … }`
    的 staging 声明，SLA 以状态码 90 + 错误文本注释转写，
    属忠实转写 + 登记，非伪造实现。
  - jevConfig.sla：纯 re-export shim（@import 转发 sdk 模块，
    0 函数即其正确形态）。
  - freeAutoCompactPreferences：常量访问器 + clamp 逻辑，真实。
  - 实质 6 文件中：freeCompactionReadiness（26 fn）、jevQuestions
    （54 fn）、saVmChatActivity（45 fn）、jevClient（9 fn）为 (a)。
- **(a) + 登记 (b) 宿主接缝：2 文件**
  - jevAutoJudge（33 fn）：scope getter provider（§4-3）、
    loadJevConfig 原始存储 JSON 接缝（§3-8）。
  - jevTurnSnapshotDispatch（3 fn）：snapshot source provider（§4-3）。
- **(b) 桩（独立计数）**：宿主接缝 provider 函数 2 个
  （cxu_jev_scope_active_thread、cxu_snapshot_source_get），
  均为显式文档化行为（返回 is_null / not-found，调用方走 TS
  同名兜底分支），非静默桩；render 桩 5 个（见上，TS 原型即
  throw-only）。修复中另关闭 1 处 (b)：jevClient 的
  jb_append_escaped 控制字符转义占位符（\u00XX 只写 "00" 不写
  十六进制位）已按字节真实 hex 位重写。
- **(c) 逐字 TS 体：0**。终态残留扫描：非注释行 `=>`、`export`、
  `import {` 均 0 命中。
- **.sax ×4：不入 a/b/c**——结构文档（见 §6-1），转换时即自带
  「SAX: no behavior counterpart」登记，属阶段 2 阻塞族。

## 3. 修复族（按病灶）

1. **块注释**：47 个 `/* */`/`/** */` 块 / 40 文件 → 逐行 `//`
   （脚本转换，转换前后 grep 双确认；唯一剩余 `/*` 在一行
   `//` 注释文本内，无害）。
2. **缺 string.sa 导入**：40 文件补 `@import "sa_std/string.sa"`
   （STR_PTR/STR_LEN 宏定义在 string.sa，未导入时 Undefined call）。
3. **错误 json 导入路径**：5 文件 `sa_std/json.sai` →
   `sa_std/encoding/json.sai`（前者不存在；同批审计全域 sa_std
   导入有效性，仅此一坏路径）。
4. **while/for 块后多余 `;`**：检查器逐点驱动删除 11 处
   （jevAutoJudge 4、saVmChatActivity 5、jevQuestions 1、
   jevClient 1——最后一处为本次新写代码自带，已同法清除）。
   `if` 块后 `;` 合法，未动。
5. **capability 实参提升**：`&x.bytes` 类借用实参传 plain ptr
   形参被 checker 拒（TypeMismatch）。按已验证域的规范式
   `let p: ptr = PTR_NULL(); PTR_BYTE_ADD(p, &x.bytes, 0);`
   提升：jevQuestions 40 处（sb_append 36 + slice_into 4）、
   saVmChatActivity 86 处（trim_into 3 + sb_append 72 +
   str_contains 11）、jevClient 3 处、jevAutoJudge 的
   parseJev*Verdict payload 实参 4 处。其中 3 处误提升
   （&emitted.verdict 是 &JevVerdict 形参的借用直传）已回退
   并逐一复检——教训：提升仅适用于数组字段地址，结构体借用
   形参不得提升。
6. **虚构 extern 三缝**：见 §4。
7. **JEV_MAX_AUTO_NUDGES 占位访问器**：bulk 转换在
   jevAutoJudge 内造了同名访问器 `fn JEV_MAX_AUTO_NUDGES()
   -> u64 { return 0; }`（返回值 0 是错的），与经 jevConfig
   链导入的 sdk 常量（sdk-frontend/src/jevConfig.sla:100，
   值 1000）在展开时 Redeclaration 相撞。改名前查导入图：
   域内仅 1 个调用点（jevAutoJudge:721）。处置：删占位
   访问器、调用点改直用常量——顺带修掉一个潜在的错值 bug
   （nudge 上限本应为 1000 而非 0）。
8. **loadJevConfig 签名漂移*
...[truncated 6185 chars]