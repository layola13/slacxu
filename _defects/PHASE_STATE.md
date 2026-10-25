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

## 转换单元进度（14 个）
完成 11：server-index（1 文件/14353 行/38 缺陷）、server-rest（95/44965/860）、
sdk（34/5755/43）、pkg-cxu（28/23876/240）、pkg-proto-shared（620/11120/894）、
backends-a（32/13142/288）、backends-c（44/25531/328）、backends-d（18/14677/879）、
frontends（46/4047/42）、web-tsx（104/50577/7748）、mini-codex（21/5178/347）。
进行中 3：server-other-apps（e0321e78）、backends-b（e878a2ba）、web-ts（a30abe1f）。
已知回炉点：server-rest 的 F/H 组为摘要式压缩、web-tsx 的 g3 组为骨架式——
修复阶段第一批逐行补全。

## 待办（按序）
1. 三单元落地 → 覆盖率审计（镜像内每个 .ts/.tsx 有同名 .sla/.sax、缺陷日志齐）。
2. 镜像 git init 提交 → 推 slacxu 分支 bulk-convert（本机 ~/.bashrc 的 PAT，
   只在 shell 内用、勿打印）。
3. ✅ slacxu v17 已提交推送（c8d47e1，2026-10-26 00:46）：MCP 协议加固 +
   docs；离线冒烟全绿，Kilo 全套件当时被中断未跑完（非失败，待修复期顺带补跑）。
4. 修复阶段 1（native 后端）：sdk+server 编译打通；先补编译器/stdlib 缺口
   （sa_json 键枚举+object-set、presence/可空语义、TOML 写面、正则评估），
   已完成单元的 ts 桩统一回绑 sa_ts/ts_* 面。
5. 修复阶段 2（wasm 前端）：SAX 渲染 + DOM 桥面。
6. tests/ 第二波转换（未纳入第一波）。

## 环境要点
- Colab：ssh -i /home/hatch/.ssh/id_ed25519 -p 25023 root@31.58.87.230，
  运行时 875391f43139；仓在 /content/sa_all/。构建/测试只在盒上、串行、timeout 包裹。
- oaifree key 已 401（2026-10-25 ~23:47），验收走 Kilo（免 key）。
