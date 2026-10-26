# 批量转换 → 分阶段修复：状态与恢复点（机器重启/会话丢失后从这里续）

更新：2026-10-26 11:05 CST。用户指令：禁止提问、主动完成、重启后自恢复续作。
**当前战场：tsgosa 全量编译 CXU 探坑（见「已定决策」战场转移条）；SLA 修复阶段已在检查点暂停，恢复点见待办 4。**

## 已定决策
- 源：codex-react-ui plugins @ f2cb649d（本机 + Colab 两克隆已对齐）。
- 策略：先批量转换（1:1 复刻、TS→SLA、TSX→SAX、缺陷只记不修）→ 提交推送
  （slacxu 新分支 bulk-convert）→ 分阶段修复；编译器缺失优先补。
- 目标形态 A：后端 SA native、前端 SA wasm。
- sa_std ts 库优先绑定（ts_string/ts_array/ts_math、sa_ts_* tree-sitter、
  async/future/sync 面）；清单 SA_TS_INVENTORY.md。
- Colab 保活 cron colab-keepalive 每 5 分钟；检查点 cron 每 15 分钟（仅三仓）。
- ts2sla 划线（用户 2026-10-26 10:35）：第三方库可先走包装（tsgosa 的 ts→sa
  产物 + 薄 SLA 包装）；本项目自有 TS 一律真 SLA，禁止以包装替代。
- 战场转移（用户 2026-10-26 10:39，目标不变）：SLA 修复阶段暂停；先以
  tsgosa 全量编译 CXU 后端面探坑，拒绝清单按 sci / sa_std / tsgosa 三分类
  修地基，完整后回 SLA 主战场。范围锁：仅后端面（apps/server、sdk-*、
  packages、backends、mini-codex、duck2api、free-key-server），前端 TSX 仅
  情报扫测不作门禁。判据锁：每条拒绝有归属与处置即收兵；原生插件
  （node-pty、sharp 等）以声明边界表面处理。已知边界：tsgosa 探不到 SLA
  层缺口；该层地图为 FIX_PHASE1 / CAPABILITY_MAP / ASYNC_MODEL /
  FIX_SERVER_REST / FIX_OTHER_APPS。

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
   - 进度检查点（2026-10-26 11:02，bulk-convert = 8e6b1a1）：sdk-backend
     26/26 ✅、sdk-frontend 8/8 ✅（692d15a）；server-rest 94/96（1d0320e，
     语法/写穿/借用三层 ✅；未过 saVmCodeGraph、saVmTool，恢复点见
     FIX_SERVER_REST.md；语义桩普查、44 文件 async 重译、fs_exists 全域
     扫描未做）；other-apps 5/33（8e6b1a1，余 28 个逐文件定分类：17 机械
     续修 + 9 真缺口（scrypt/HMAC-SHA1/AES-GCM/ed25519/QR/PNG 等），见
     FIX_OTHER_APPS.md；altB 三字段不匹配不在该域、待主线路由；
     convert.test 的 role 期望矛盾已再标记、语义未动）。**修复阶段在此
     暂停（战场转移）；回主战场从本条与两份 FIX 文档续行；F3
     （apps/server/src/index.sla）未开工。**
   - ⚠ F2 实测修正：@ts_* 是 SA 层函数、SLA 不可直调；转换日志的「已回绑
     ts 面」从未编译验证。回主战场时须以 SLA 本地复刻或 SA 层组合处理
     （other-apps 已以本地复刻落地）。
4.5. tsgosa 探坑战役（当前战场）：扫测驱动逐文件编译 CXU 后端面 → 坑普查
   三分类（sci / sa_std / tsgosa）→ 修地基（sci、sa_std 优先）→ 通过率达
   门槛后回待办 4 续修。
5. 修复阶段 2（wasm 前端）：SAX 渲染 + DOM 桥面。
6. tests/ 第二波转换（未纳入第一波）。

## 环境要点
- Colab：ssh -i /home/hatch/.ssh/id_ed25519 -p 25023 root@31.58.87.230，
  运行时 986a7d79e415（2026-10-26 08:29 起）；仓在 /content/sa_all/；
  bulk-convert 工作树 /content/bulk（另有 bulk-srv/bulk-apps/bulk-fe 三棵
  域工作树，基点 692d15a）。构建/测试只在盒上、串行、timeout 包裹。
- oaifree key 已 401（2026-10-25 ~23:47），验收走 Kilo（免 key）。
