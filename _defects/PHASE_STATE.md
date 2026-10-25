# 批量转换 → 分阶段修复：状态与恢复点（机器重启/会话丢失后从这里续）

更新：2026-10-26 00:44 CST。用户指令：禁止提问、主动完成、重启后自恢复续作。

## 已定决策
- 源：codex-react-ui plugins @ f2cb649d（本机 + Colab 两克隆已对齐）。
- 策略：先批量转换（1:1 复刻、TS→SLA、TSX→SAX、缺陷只记不修）→ 提交推送
  （slacxu 新分支 bulk-convert）→ 分阶段修复；编译器缺失优先补。
- 目标形态 A：后端 SA native、前端 SA wasm。
- sa_std ts 库优先绑定（ts_string/ts_array/ts_math、sa_ts_* tree-sitter、
  async/future/sync 面）；清单 SA_TS_INVENTORY.md。
- Colab 保活 cron colab-keepalive 每 5 分钟；检查点 cron 每 15 分钟（仅三仓）。

## 转换单元进度（14 个）—— ✅ 全部完成（2026-10-26 01:20）
server-index（1/14353/38）、server-rest（95/44965/860）、server-other-apps（33/5142/56）、
sdk（34/5755/43）、pkg-cxu（28/23876/240）、pkg-proto-shared（620/11120/894）、
backends-a（32/13142/288）、backends-b（35/13473/82）、backends-c（44/25531/328）、
backends-d（18/14677/879）、frontends（46/4047/42）、web-ts（180/37200/923）、
web-tsx（104/50577/7748）、mini-codex（21/5178/347）。合计 1287 文件、≈26.9 万行源、
缺陷日志 ≈12,768 条。sa_ts 回绑已在 server-other-apps/backends-b/web-ts 落实一部分，
其余在修复阶段统一回绑（web-ts 注记：ts_math 为整数面、ts_arr 为 word 数组模型，
与 f64/对象数组不合处已逐项登记，不可硬绑）。
已知回炉点：server-rest 的 F/H 组为摘要式压缩、web-tsx 的 g3 组为骨架式——
修复阶段第一批逐行补全。

## 待办（按序）
1. ✅ 覆盖率审计：1287/1287（runtime/index.ts 2 行 barrel 由主会话补转；
   两 .d.ts 产物为 desktop.sla/extend-theme-types.sla 命名变体，内容在位）。
2. ✅ 镜像已提交推送：slacxu 分支 bulk-convert = 5b76b75（2026-10-26 01:23，
   ls-remote 核对一致）。本机镜像仓 ~/workspace/cxu-sla-mirror（git，分支 bulk-convert）。
   ⚠ 修复工作在 Colab 盒上做：盒上 slacxu 拉 bulk-convert 分支开工。
3. ✅ slacxu v17 已提交推送（c8d47e1，2026-10-26 00:46）：MCP 协议加固 +
   docs；离线冒烟全绿，Kilo 全套件当时被中断未跑完（非失败，待修复期顺带补跑）。
4. 修复阶段 1（native 后端）：sdk+server 编译打通；先补编译器/stdlib 缺口
   （presence/可空语义、TOML 写面、正则评估），
   已完成单元的 ts 桩统一回绑 sa_ts/ts_* 面。
   - ✅ 缺口 1（sa_json 键枚举+变更面）已关闭（2026-10-26，sci 6bc56b29，
     源码经检查点 a43c6b14 落盘）：新增 13 导出——object_set_{string,i64,
     f64,bool,null,node}、object_remove、array_push_{string,i64,f64,bool,
     null,node}；键枚举复用既有 value_count+object_key_at（插入序，此前已
     存在、转换审计未察）。JsonNodeHandle 改文档树路径寻址（acquire 按
     路径重解析→变更跨手柄可见；删键使指向该键的手柄失效报 InvalidHandle；
     set/push_node 深拷贝入目标文档 arena）。sa-std-unit 149/149（+3 新测）、
     sa-std-runtime 15/15、runtime-abi-check both PASS（header 597→610）；
     Windows 侧 13 符号登记 windows_unsupported（sa_std_windows.zig 未实现，
     待后续移植）。emit_js/emit_c 的 sa_json 已知名单未含新符号——js/c 后端
     暂不可用变更面，留待阶段 2 前补 shim。详见 _defects/FIX_PHASE1.md。
5. 修复阶段 2（wasm 前端）：SAX 渲染 + DOM 桥面。
6. tests/ 第二波转换（未纳入第一波）。

## 环境要点
- Colab：ssh -i /home/hatch/.ssh/id_ed25519 -p 25023 root@31.58.87.230，
  运行时 875391f43139；仓在 /content/sa_all/。构建/测试只在盒上、串行、timeout 包裹。
- oaifree key 已 401（2026-10-25 ~23:47），验收走 Kilo（免 key）。
