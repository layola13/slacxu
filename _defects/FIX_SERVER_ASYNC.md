# FIX_SERVER_ASYNC — server-rest async 层专批（F1/I1 欠账）

Status: FRONTIER — adjudication complete for all 208 sites; 26 resolved,
164 blocked in place with root causes, 18 (index.sla) registered here per the
F3 disposition. No silent flattening added; no check regressed.
Base: bulk-convert 30ce512 (local worktree bulk-srv2-local; toolchain sci
1ec669ad / sa_plugin_sla 3de91932, same as Colab). Method per ASYNC_MODEL /
E1: read the TS sibling + the marked SLA fn body, classify (i) faithful async
retranslation, (ii) contract-layer blocking degeneration (R8) with per-site
semantic-equivalence notes, (iii) mislabeled sync; otherwise keep
`// DEFECT: async [BLOCKED: …]` with the precise root cause in place and in
this file. Adjudicated sites carry `// ASYNC-ADJ(i|ii|iii): …` with TS line
anchors.

## Headline numbers

- Census (verified by full-tree scan): **43 files / 208 `// DEFECT: async`
  sites, all under `apps/server/src`** (zero outside src).
- After: **182 DEFECT lines remain** = 164 blocked in place + 18 index.sla
  (doc-registered, file untouched per FIX_INDEX). Resolved: **26** —
  (i) 1, (ii) 24, (iii) 1. (The saVmSplitWorkflow outline call site carries
  both an (ii) callee note and its own site block; counted once in each.)
- Files fully cleared of DEFECT markers: 4 (threadSubscriptionRegistry,
  saVmTreeSitter, saVmCodeGraph, dataGarbageCleaner).
- Regression gates, final state (`.sla-cache` cleared, canonical env,
  serial, timeout-wrapped): **apps/server 97/97 PASS, failure name set ∅**;
  saVmTool.sla PASS, index.sla PASS (both inside the 97), miniBridge.sla
  PASS, backends/mini/src/server.sla PASS.

## The batch's central finding

The async *model* blocked nothing. Every awaited surface in these files
exists in sa_std (four-source check): fs (`fs.sai`), spawn capture
(`process.sai`), HTTP client (`http_client.sai` + stateful v1 client), SSE
turn (`sa_http_client_sse_turn_ex`), tree-sitter (`sa_ts_*`), bcrypt and
keyring (`crypto.sai`), randomUUID (`sa_deno_random_uuid`), sleep
(`time.sai: sa_time_sleep_ms`), PTY (`term.sai`), SQLite (plugin_sqlite
facade), global cells (`globals.sai`). What blocks 164 sites is that **most
apps/server files are conversion-era skeletons**: bodies hold the TS logic
as comments and return preset values, so there is no implemented body whose
awaits could be re-expressed. Those sites are registered, not papered over.

Two conversion-era claims were found stale and corrected in place:
bcrypt "not in sa_std" (runtime/password.sla header — `sa_bcrypt_hash` /
`sa_bcrypt_verify` exist, crypto.sai:11-12) and "async fs + randomUUID have
no sa_std counterpart" (cursorDesktopInjection.sla header).

## Resolved sites

### (i) Faithful retranslation — 1

- taskLiveness.sla `delay` (TS L34, Promise+setTimeout): the stub returned
  instantly, which would busy-spin its caller's poll loop — a real semantic
  loss. Now a true blocking sleep via `sa_time_sleep_ms` (time.sai:10),
  R13 form (harness polling loops: deadline/sleep, no select2).

### (ii) Contract-layer blocking degeneration (R8), per-site verified — 24

- threadSubscriptionRegistry.sla (5): watch/close/ensureSubscribed/
  evaluateUnsubscribe/reAttachAll. Awaited op is `client.request`, carried
  by file-local host-seam stubs; control flow (replaced-entry recheck,
  catch branches, TS's own sequential loops) is 1:1. TS watch runs its
  first op as fire-and-forget (`void ensureSubscribed` L59) — inline
  blocking here matches the host's sequential pump.
- auggieRedirector.sla (3): ensure (L138, "listening" event → sync
  bind/status via the createRedirectorServer seam), stop (L159,
  server.close callback → sync state clear), readJson (L1246, for-await
  stream → caller's pre-read buffer seam).
- saVmTreeSitter.sla (6): initTreeSitter (L160; parserInitPromise dedup →
  parserInitDone flag + blocking `ts_parser_init`), loadLanguageForFile
  (L238), extractFileOutline (L770), renameSymbolInContent (L857),
  findDefinitionInContent (L990), getSyntaxDiagnostics (L1192) — all R8
  over blocking `sa_ts_*` externs via the file's host layer.
- saVmCodeGraph.sla (3): extractFileInfo (L461), buildScopedCodeGraph
  (L684), nativeCodeGraph (L1248) — continuation of the file's F1/I1-era
  R8 adjudication, now per-site.
- codeCliBridge.sla (5): childExitPromise field → settled flag + host poll
  (R7); controlRequest (L777) → slot registration consumed by handleLine +
  caller poll (Promise executor pattern, R7); restart (L1318) sequential
  composition; request (L1376) sequential blocking; notify (L1394) is
  exactly `return handleMethod(...)`.
- threadStartCompatibility.sla (1, header contract note): the
  Promise<JsonValue> contract is carried as fn id + status + out_result
  handle; implementations are the bridges' blocking request fns.
- saVmSplitWorkflow.sla (1, call site): `await extractFileOutline(...)` —
  callee adjudicated (ii) above; the enclosing body remains blocked.

### (iii) Mislabeled sync — 1

- dataGarbageCleaner.sla `cleanDataGarbage`: TS L388 is a pure async
  wrapper whose whole body is `return cleanDataGarbageSync(options)`
  (L389). The SLA fn now delegates identically (previously it returned 0
  without delegating). (A second sync-observation — launchInstall's
  createInstallJob is TS-sync L993 launching an R9 fire-and-forget IIFE —
  is recorded inside that site's BLOCKED text; its body is a stub, so the
  marker stays.)

## Per-file table

| file | before | DEFECT after | (i) | (ii) | (iii) | blocked |
|---|---|---|---|---|---|---|
| agentReadiness.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| auditLogStore.sla | 5 | 5 | 0 | 0 | 0 | 5 |
| auggieRedirector.sla | 8 | 5 | 0 | 3 | 0 | 5 |
| authStore.sla | 12 | 12 | 0 | 0 | 0 | 12 |
| cliVersions.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| codeCliBridge.sla | 11 | 6 | 0 | 5 | 0 | 6 |
| codexApiRuntime.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| codexCliUpdate.sla | 8 | 8 | 0 | 0 | 0 | 8 |
| commandBlacklist.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| cursorDesktopInjection.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| dataGarbageCleaner.sla | 1 | 0 | 0 | 0 | 1 | 0 |
| forwardApi.sla | 4 | 4 | 0 | 0 | 0 | 4 |
| forwardTurn.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| freeModelAccess.sla | 4 | 4 | 0 | 0 | 0 | 4 |
| gitWorkspace.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| imageProtocols.sla | 9 | 9 | 0 | 0 | 0 | 9 |
| index.sla | 18 | 18 | 0 | 0 | 0 | 0 (18 doc-registered) |
| launchInstall.sla | 10 | 10 | 0 | 0 | 0 | 10 |
| legacyImageViewHistory.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| providerModels.sla | 7 | 7 | 0 | 0 | 0 | 7 |
| providerStore.sla | 23 | 23 | 0 | 0 | 0 | 23 |
| regressionRunner.sla | 6 | 6 | 0 | 0 | 0 | 6 |
| remoteBunNode.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| remoteThreadLifecycle.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| runtime/password.sla | 3 | 3 | 0 | 0 | 0 | 3 |
| runtime/server.sla | 3 | 3 | 0 | 0 | 0 | 3 |
| saVmAccountabilityLedger.sla | 8 | 8 | 0 | 0 | 0 | 8 |
| saVmBundle.sla | 6 | 6 | 0 | 0 | 0 | 6 |
| saVmCodeGraph.sla | 3 | 0 | 0 | 3 | 0 | 0 |
| saVmExecutor.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| saVmFindWorker.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| saVmSplitWorkflow.sla | 5 | 4 | 0 | 1* | 0 | 5* |
| saVmTreeSitter.sla | 6 | 0 | 0 | 6 | 0 | 0 |
| sshCodeCliBridge.sla | 3 | 3 | 0 | 0 | 0 | 3 |
| sshHostDiscovery.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| sshSystemMetrics.sla | 3 | 3 | 0 | 0 | 0 | 3 |
| taskLiveness.sla | 6 | 5 | 1 | 0 | 0 | 5 |
| terminalPty.sla | 4 | 4 | 0 | 0 | 0 | 4 |
| threadHistoryTail.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| threadStartCompatibility.sla | 3 | 2 | 0 | 1 | 0 | 2 |
| threadSubscriptionRegistry.sla | 5 | 0 | 0 | 5 | 0 | 0 |
| webdevProbe.sla | 1 | 1 | 0 | 0 | 0 | 1 |
| workspaceAgents.sla | 2 | 2 | 0 | 0 | 0 | 2 |
| **total** | **208** | **182** | **1** | **24** | **1** | **164** |

*saVmSplitWorkflow: the outline call site is counted in both (ii) and
blocked (callee adjudicated; enclosing body blocked).

## Remaining registrations (blocked root causes, by class)

A. **Skeleton bodies — body retranslation is the blocker** (~140 sites):
   providerStore (23; read()/write() persistence layer itself untranslated),
   authStore (12), launchInstall (10 minus class C overlap), imageProtocols
   (9), saVmAccountabilityLedger (8), codexCliUpdate (8), providerModels
   (7), saVmBundle (6), regressionRunner (6), auditLogStore (5),
   saVmSplitWorkflow (5), forwardApi (4), freeModelAccess (4, one partial
   body), terminalPty (4 minus class B), taskLiveness (5: /proc + execFile
   probe bodies), runtime/server (3), sshCodeCliBridge (3), and the 1–2-site
   files (agentReadiness, gitWorkspace, workspaceAgents, sshHostDiscovery,
   remoteBunNode, legacyImageViewHistory — incl. a for-await readline
   stream with no implemented form, cursorDesktopInjection, forwardTurn,
   threadHistoryTail, remoteThreadLifecycle, webdevProbe, threadStart-
   Compatibility wrappers 2). In every case the awaited surface exists in
   sa_std; the SLA body was never written.
B. **Host seam unwired**: auggieRedirector callRelay/forwardJson/
   forwardStream/consumeResponsesSse (relay runner lives in backends/mini,
   no SLA import path wired), codeCliBridge start/handleMethod/
   startGoalContinuationTurn/runCompaction (fix-stage bodies; event
   handlers remodeled as host-fed sinks), saVmExecutor (child event model),
   saVmFindWorker (Worker host callback), terminalPty defaultPtyLoader
   (host-injected loader fn unwired) + spawnScriptBackend/createTerminalPty.
C. **R11 in-flight Promise state with no counterpart implemented**:
   launchInstall installLock spin-lock + ensureCliBridgeInstall
   single-flight; cliVersions in-flight cache; sshSystemMetrics shared
   in-flight sample; commandBlacklist writeQueue `.then` chain;
   codeCliBridge applyRuntimeConfig's awaited control requests are class B.
   (ASYNC_MODEL R11: these need explicit cell state + redesign per case,
   never an always-ok stub.)
D. **R7 host-pump waits**: codeCliBridge waitForExit (Promise.race of exit
   vs timer — a blocking spin would deadlock the single-threaded pump that
   must feed onChildExit); codexApiRuntime wait (long-poll design
   registered in place — status 1 pending + waiter registration — body
   still a stub returning 1 unconditionally).
E. **Password unit contract gap**: runtime/password.sla (3) — bcrypt
   surface exists (crypto.sai:11-12), but the unit's `out_hash: &u64`
   handle convention has no buffer registry and no wired SLA caller
   (authStore call sites are comments), so the sync+status form cannot be
   completed inside this unit alone.
F. **index.sla (18, file untouched)**: all 18 markers annotate the
   untranslated TS comment regions catalogued by FIX_INDEX (B2–B6 host
   blockers; the file's 27 defined fns were verified sync-in-TS by I2).
   They close when those regions are retranslated, not by marker edits.

## Discipline notes

- No new silent flattening: every retained marker states its root cause;
  every adjudicated site names its contract/extern and TS anchor.
- Compiler residuals respected: no join2×Loop, no sync-fn `.await` of
  Loop-plan futures, no loop-awaited child async fns with extern &out
  calls, no `Arc::new(user struct)` — the batch needed none of the four
  (all resolved sites are R7/R8/R13 forms or direct extern calls).
- No `str_eq` user fns introduced; no fs_exists polarity edits were needed
  (no site in scope touched an fs_exists call).
- Batches: cf2d263 (b1), 0d4b1b4 (b2), 4a6860e (b3), bafa65c (b4),
  1a9b512 (b5), a5ffd06 (b6), plus this document commit.
