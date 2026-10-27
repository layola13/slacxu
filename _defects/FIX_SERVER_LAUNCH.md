# FIX_SERVER_LAUNCH — apps/server launch/install family (8/8) rebuild record

Agent AD3, 2026-10-27. This family was first completed by Agent AD on the
old Colab runtime (410dd20b5a78) and lost with it before integration
(commits 0d53650 / b450667 and the forwardApi working tree were never
pushed). Rebuilt from AD's 18:57 final-report spec and AD2's 19:07
interruption report, on base origin/bulk-convert @ 7dd3304, under the
local-master rule: every file written first in the local staging tree,
synced to the box worktree, verified there, committed in both trees.

Rebuild commits (box hashes; local staging commits carry the same
messages and byte-identical file contents):

- 959ce1e — freeModelAccess full body retranslation (family rebuild 1/4)
- 94a92ad (local b420cc1) — saVmBundle full body retranslation (2/4)
- c634676 (local 23dcf29) — forwardApi full body retranslation (7/8)
- 0b37030 (local a87b47b) — RR/SW fix replay
- 29f11b7 (local 40860b0) — launchInstall full body retranslation (8/8)
- 9f2f262 — taskLiveness &&-audit hardening (defect #15 audit)

(taskLiveness / codexCliUpdate / regressionRunner / saVmSplitWorkflow
were already integrated by the main session at a6cfa37 before the
runtime loss; their full retranslations stand. AD3 replayed the lost
RR/SW fix commit on top and re-verified them.)

## Per-file census — (a) real / (b) registered seam / (c) verbatim TS

Census doctrine: `sa check` pass ≠ translated. (c) must be 0 in every
file; it is 0 in all eight.

### taskLiveness.sla (574 lines, 22 fns) — (a) full
Process-table liveness over ps output + JSON state. Async model: sync
surfaces only. Re-verified `sa check` PASS in the final gate.
Step-6 audit: one hardening (see audit section).

### codexCliUpdate.sla (1057 lines, 44 fns) — (a) full
Update check via blocking HTTP v2 + process probes. R8 contract-layer
blocking throughout. The embedded POSIX shell script (line ~962) is
data, not SLA: its `||` are shell operators, not defect-#15 sites.

### freeModelAccess.sla (1211 lines, 55 fns) — (a) full
R8 blocking degeneration of the TS async surface. Machine code =
SHA-256 of /etc/machine-id (fallback chain per TS), cross-checked
against python hashlib: **c25cb20e22da0d74a5e2402117265669dea3ddda1292d12be2000d6725eeda0c**,
identical to AD's lost cross-check value. Dev override yields machine
code 260DA01345AC. Keyring is real in sa_std (collection
"codex-react-ui", key "free-model-access"). Error codes -1..-5 per TS.
Probe `_defects/probes/fma_probe.sla` + `fma_stub.py` +
`run_fma_probe.sh`: modes hash/nosvc/svc/down all PASS (FMA_PROBE_ALL_OK);
stub-verified `Authorization: Bearer probe-secret`. The original hash
bug (defect #15: `&&`/`||` do not short-circuit, so the digest path
executed on the wrong operand) is fixed by sequential ifs.

### saVmBundle.sla (1569 lines, 70 fns) — (a) full
Probe `_defects/probes/bu_probe.sla` + `bu_cand_probe.sla` +
`run_bu_probe.sh`: mode A (JEV off) and mode B (JEV_MCP_ENABLED=1)
both BU_PROBE_OK. TS quirks preserved verbatim and registered in the
file header, incl. the global-installer `installed=false` constant and
the MCP-source candidate behaviour of defect #18 (below).

### forwardApi.sla (2447 lines, 106 fns) — (a) real + (b) registered seams
Full retranslation; `sa check` PASS; probe `_defects/probes/fa_probe.sla`
+ `run_fa_probe.sh`: ~40 assertions, **FA_PROBE_OK**.

- (a) Pure surfaces are fully real: loopback set, sharing gate,
  credential resolution, relay provider builder with Set-dedup, prompt
  transforms (chatMessagesToPrompt / responsesInputToPrompt), response
  assembly, token estimation, usage accounting over the original
  payloads.
- (b) Host-callback dispatch is a registered B-class seam:
  `fa_install_inventory_json` / `fa_install_bridge` (mode 0=null,
  1=handle, 2=throw) backed by sa_global cells. Unwired inventory
  reproduces the TS 500 path; unwired bridge reproduces the TS null
  outcome (502). Wiring belongs to the host-integration line.
- (b) `forwardModel.sla` / `forwardTurn.sla` are skeleton providers,
  called verbatim. `runForwardTurn` preset returns 0 and leaves the
  caller-initialized neutral ForwardTurnResult (FA initializes it to
  neutral stop/empty before the call).
- Sequential SSE model (registered deviation): the full SSE body is
  materialized into Response.body_json with is_stream=true, a single
  full-text delta and `data: [DONE]`; the in-flight slot (sa_global
  cell "forwardapi.inflight", stored n+1) is released exactly once.
- Numeric-deps sentinel (registered): 0 = TS-undefined for
  turnTimeoutMs→600000, maxConcurrent→4, sseKeepaliveMs→20000.
- Null-body micro-deviation: an empty body yields 400 Invalid JSON
  body — the same net effect as the TS request.json() throw path.
- Probe-proven TS semantics (assertions initially written wrong, then
  corrected against forwardApi.ts): chatMessagesToPrompt /
  responsesInputToPrompt use **first-non-empty-bucket** semantics
  (user > tool > assistant, TS L244-266 / L319-360);
  estimateForwardTokens("") == 0 (TS L428-433); forwardChatUsage
  estimates over JSON.stringify of the ORIGINAL messages value.
- Registered micro-deviation: responsesInputToPrompt string entries
  are pre-trimmed by TS (`pushText(entry.trim(), …)`) while message
  texts are not; the SLA pushes untrimmed for all buckets. Observable
  only for multi-block mixes with padded string entries.

### regressionRunner.sla (1953 lines, 82 fns) — (a) full
Fix replayed from AD's lost commit: `rr_big_push_node_json` reads the
stringify handle via `sa_json_buffer_data/len/free` (the lost fix; the
pre-fix code used `sa_fmt_buffer_*`, which reads the wrong buffer
family). `sa check` PASS.

### saVmSplitWorkflow.sla (3230 lines, 105 fns) — (a) real + (b) provider blockers
Probe `_defects/probes/sw_probe.sla` + `run_sw_probe.sh`:
**SW_PROBE_OK** — `runSplitWorkflowAction(action="split_plan")` runs
end-to-end against a scratch workspace and emits a plan containing
"AST outline" with the coupling stage reported [BLOCKED:
analyzeFileCoupling]. Three stage-provider blockers are registered in
the file header, all pre-existing upstream (saVmTreeSitter /
backends/vmtool-security), NOT locally bypassed:

1. analyzeFileCoupling segfaults in saVmTreeSitter (call site ~L5141).
2. Outline symbol-pool corruption when outline results are read at
   the SW call sites (struct-array elements are read by value).
3. normalizeSaVmPolicy with no config zeroes fs.entries, after which
   checkSaVmPath segfaults (registered this rebuild).

**Patch-ops numbering disagreement — awaiting main-session
adjudication (do not silently pick one):** the SW provider header
numbers patch ops 0=write / 1=edit / 2=delete / 3=rename, while the
saVmTool contract numbers them 1=write / 2=edit / 3=delete / 4=rename.
SW follows its provider header; the contract side is owned by the
saVmTool line.

**Policy-root canonicalization divergence (probe finding):**
runSplitWorkflowAction's cwd must be passed absolute. Passing "."
fails with a policy denial `default_root_miss(roots=1)`: sw_resolve_self
canonicalizes "." to /private/tmp/sw_ws while the policy engine
derives its root differently (decision JSON kind sa_vm_policy,
allowed:false). Registered as defect #23 below.

### launchInstall.sla (2989 lines, 85 fns) — (a) real + (b) registered seams
Full retranslation of launchInstall.ts (1037 lines). `sa check` PASS.
Runtime evidence is split across two probes because the whole-file
build-exe traps in the SAB flattener (defect #19):

- `_defects/probes/run_li_probe.sh` (li_probe_nj.sla; jobs family
  stubbed in a generated lib copy): **LI_PROBE_OK** — spec table
  (ids are the TS `-launch` forms; pi repo "pi"), parseEnvFile /
  isPlaceholder, detectAll against a fake HOME (planted
  ~/.config/claude-launch/.env with CLAUDE_LAUNCH_API_KEY) + fake
  `agy-launch` on PATH, writeAdapterEnv (create / skip / force-upsert
  / template paths), testOpenAiApi against li_stub.py (200 + 401
  paths), and installLaunchAdapters end-to-end (prepared
  claude-launch checkout, real install.sh run, results ok, summary
  log 成功 1 个， install lock released).
- `_defects/probes/run_li_job_probe.sh` (li_probe_job.sla; install
  middle stubbed, installLaunchAdapters faked to one failed result):
  **LI_JOB_PROBE_OK** — opts JSON round-trip, li_uuid shape,
  jobsdoc/stash record format, REAL li_job_drive settle
  (progressStep "Completed 0/1 adapters."), getInstallJob
  reification (running→completed, results/adapters/createdAt),
  unknown-id → false.
- `_defects/probes/li_probe.sla` is the canonical full probe
  (steps 1–7 in one binary); it becomes runnable when defect #19 is
  fixed upstream.

Async model:
- installLaunchAdapters / installOne / runCmd / ensureCloned /
  runInstallSh / testOpenAiApi / validateEnvModeBeforeSave: TS async,
  every await on a process or HTTP completion → R8 blocking bodies
  (runCmd uses the defect-#1 workaround: run + try_wait poll + drain).
- installLock → R11 explicit cell state: sa_global cell
  "launchinstall.lock" (0/1), contenders poll with sa_time_sleep_ms(10);
  observable via installLockHeldNow(). NO constant-ok stub.
- createInstallJob → R9 fire-and-forget: `thread::spawn(^|| li_job_drive(token))`;
  the driver reconstructs opts from the stash doc and settles the job
  record under the jobs lock.
- Registered deviations: (i) job logs/progressStep settle at
  completion — mid-run progressStep stays "Starting installation
  job..." (the TS status also only settles at completion; the sink
  merges at settle); (ii) runCmd child-process env overrides are a
  seam (std process surface has no per-child env); (iii) win32
  branches are platform seams (POSIX is the implemented surface);
  (iv) toolchainDirCandidates (cliVersions.sla) is consumed
  defensively — its text output is re-parsed as a JSON string array;
  (v) testOpenAiApi: when the HTTP status text is unavailable it falls
  back to the body slice (micro-deviation, same net message shape).

## Async marker counts

All eight files were re-scanned at the final gate: verbatim-TS (c)
bodies = 0 in every file. Remaining (b) seam registrations:
forwardApi 2 (host-callback dispatch; skeleton providers) + the
registered SSE/sentinel/null-body deviations; saVmSplitWorkflow 3
provider blockers; launchInstall 5 registered deviations above;
saVmBundle 0 seams (TS quirks preserved are (a)-class behaviour, incl.
defect #18's). R8 blocking degenerations: FMA (whole surface), CU
(whole surface), BU (whole surface), LI (7 functions). R9
fire-and-forget: LI createInstallJob (1). R11 explicit cell state:
FA in-flight slot (1), LI install lock + jobs doc/lock/stash cells (4).

## Defect register 1–18

Entries 1, 2, 3, 11, 14, 15, 17, 18 are recorded below with the full
text carried from AD's register (verified against this rebuild's
evidence). The text of entries 4–10, 12, 13, 16 lived only in AD's
2026-10-27 18:57 report on the lost runtime and is NOT reconstructed
here — the numbers stay reserved; the main session can restore them
from its own transcript. Do not renumber.

1. **`sa_std_process_exec_capture` returns EMPTY stdout/stderr** for
   successful children. Workaround used everywhere in this family:
   `sa_std_process_run(_cwd)` + try_wait poll + read_stdout /
   read_stderr drain. (BU runCmd equivalent, LI runCmd.)
2. **Struct-array argv construction silently doesn't land at
   runtime.** Proven form: flat `[u64; 2N]` slots +
   `PROCESS_ARGV_SET_PTR(&slots, idx, ptr, len)` per element +
   `PTR_BYTE_ADD(sp, &slots, 0)` base for run/run_cwd.
   ⚠ Forwarded to the owning line: backends/claude's
   claudeCompatibleProbe.sla uses the struct-array form (check-only,
   probably runtime-broken the same way).
3. **`sa_std_fs_read_dir_json` returns an OBJECT doc
   `{"entries":[...]}`**, not a JSON array. Consumers that iterate it
   as a string array load 0 entries at runtime (sdk-backend
   regressionCases loader; packages/cxu vendor copy likewise).
11. **Macro first-out-param defect — FIXED UPSTREAM** by Agent AL in
    sa_plugin_sla master `59cbcfa8` (integrated). This rebuild's files
    were written against the fixed compiler.
14. **`sa sla build-exe` (SAB path) has a false trap**
    (UnknownRegister 1007) on valid files. Use the host verb
    `sa build-exe` (which drops a sibling `<name>.sa` to clean up).
    See also #19: the host path has its own closure-emission trap.
15. **SLA `&&` / `||` do NOT short-circuit.** Side-effect calls in
    non-first operands execute unconditionally. Caused the original
    FMA machine-hash bug. Audit of this family: step 6 below.
17. **`sa_json_object_set_node` snapshots the child at set time.**
    Build children fully, attach last; mutating a child after setting
    it into a parent does not propagate.
18. **sdk `resolveSaVmMcpSourceCandidates` returns count>0 with EMPTY
    items — HARD-CONFIRMED** by AD3's bu_cand_probe against the
    rebuilt saVmBundle: count=3, all three item_len=0. The sdk-backend
    surface is the owning line; saVmBundle preserves the TS-visible
    behaviour.

## New defects found by AD3 (19+)

19. **SAB flattener trap on `thread::spawn` closure emission
    (build-exe).** Any build-exe whose module includes launchInstall
    .sla's createInstallJob (`thread::spawn(^|| li_job_drive(token))`)
    traps deterministically: ForbiddenSyntax / InvalidMacroInvocation
    (trap_code 1001), reported at generated .sa line ~51100 (the
    closure's second, module-qualified emission region; the text at
    that line varies with unrelated source edits, and assembling the
    generated .sa directly reproduces it). Control experiments:
    stubbing only createInstallJob lets the same module build and run
    (li_probe_job); stubbing only the jobs family also builds
    (li_probe_nj); the reduced ~28k-line variant builds; comparable
    modules without a spawn closure (FA/BU/SW probes, up to 98k
    generated lines) build fine. `sa check` passes on the same file.
    Minimal repro is preserved in this tree: apps/server/src/
    launchInstall.sla @ 29f11b7 + _defects/probes/li_probe.sla.
20. **Checker branch-tail type unification (statement position).**
    An if/else used as a statement still unifies its branch tails:
    one branch ending in a bool-returning call vs the other in a void
    call is "if expression branch type mismatch". An if WITHOUT else
    is not branch-typed. Found in forwardApi; fixed by capturing
    returns (`let sink…`) or restructuring to sequential ifs.
21. **Checker deref-add mismatch through a &param in nested blocks.**
    `*outCount = *outCount + 1;` (outCount: &u64) inside while>if
    nesting fails with "binary expression type mismatch: op=add,
    left tag=borrow, right tag=primitive". The local-mediated form
    (`let oc = *outCount; *outCount = oc + 1;`) checks. Found in
    launchInstall writeEnvsOnly.
22. (Guidance, not a defect) PhiStateConflict family in this file:
    env-buffer handles (sa_env_get / sa_env_home_dir /
    sa_env_current_dir / sa_env_vars_json) freed inside a conditional
    branch trap the referee at the merge (Consumed vs Untracked).
    House form used here: guard-return free helpers
    (`li_free_env_buffer`, `li_free_doc`, `li_free_buffer`) called
    UNCONDITIONALLY on the single exit path. Whole-struct assignment
    from a borrow (`values = opts.sharedEnv`) likewise traps
    (Composite vs Uninitialized at the merge); field-wise copy is the
    safe form (installOne).
23. **Policy-root canonicalization divergence** (SW probe finding,
    above): sw_resolve_self canonicalizes "." to /private/tmp/<ws>
    while the saVmPolicy engine derives its root differently, so a
    relative cwd is denied with `default_root_miss(roots=1)`.
    Workaround: pass cwd absolute. Owning lines: SW +
    backends/vmtool-security.

## Step-6 audit — defect #15 (`&&` / `||` side-effect operands), TL/CU/RR/SW

166 sites audited (TL 22, CU 44, RR 50, SW 50). Classification:
side-effecting call in a non-first operand = defect; pure predicates,
comparisons, and getter calls in FIRST position (their out-params are
the idiom) = clean.

- TL: 1 fix — tl_set_contains' inner chain had `sa_json_as_i64` as a
  middle operand writing &v; safe only because v is pre-initialized
  and pid≠0 for real callers. Hardened to a nested if (commit 9f2f262).
  All other sites pure or get-first.
- CU: no fixes. All sites pure comparisons/flags or get-first; 2 hits
  are `||` inside the embedded shell-script string literal (data).
- RR: no fixes. Three benign registrations: L1282
  `rr_segments_preserved` is evaluated even when violations exist
  (its only side effect is freeing its own temporary doc; the result
  is gated by the first operand); L1695 `sa_json_object_get_string`
  as second operand writes two locals whose values are only read
  under the combined condition; L1861 `rr_filter_match` (pure) as
  second operand after the side-effecting parse in first position.
- SW: no fixes. All sites pure or get-first; `pathWithin` (imported
  from the policy surface) is a pure predicate.

FMA/BU/FA/LI were authored under the non-short-circuit discipline
from the start (sequential ifs wherever an operand can fail or
mutate); LI was re-scanned during this audit — no mutating
non-first operands.

## Final gates (2026-10-27, .sla-cache cleared, canonical env)

- apps/server (find apps/server -name '*.sla', 97 files): **96/97
  PASS. Failure name set = {apps/server/src/saVmTool.sla}** —
  `Redeclaration: struct StrBuf` (defined at saVmTreeSitter.sla:85,
  workbenchControlApi.sla:27, sdk-backend
  openCodeSessionProtocol.sla:54). This is the PRE-EXISTING failure
  measured on the pristine 7dd3304 baseline before AD3 touched
  anything — baseline-identical, NOT an AD3 regression and NOT
  claimed as a pass.
- Standing gates: index.sla PASS, miniBridge.sla PASS, mini
  server.sla PASS, saVmTool.sla FAIL (same baseline item above).
- Family probes: FMA_PROBE_ALL_OK, BU_PROBE_OK (modes A+B),
  FA_PROBE_OK, SW_PROBE_OK, LI_PROBE_OK (steps 1–6),
  LI_JOB_PROBE_OK (step 7 minus the #19-blocked spawn site).

## Open items for the main session

1. SW patch-ops numbering disagreement (0-based provider header vs
   1-based saVmTool contract) — adjudication owed; see SW section.
2. Defect #2: forward the claudeCompatibleProbe struct-array-argv
   suspicion to the backends/claude line.
3. Defect #19: route to the compiler line with the preserved repro;
   when fixed, run _defects/probes/li_probe.sla whole (and re-run the
   two split LI probes against the unstubbed file).
4. Defects 4–10, 12, 13, 16: restore text from AD's 18:57 report if
   still wanted in this register.
