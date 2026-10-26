# FIX_PKG_CXU — pkg-cxu domain fix phase 1 (2026-10-26, Agent L)

Scope: `packages/cxu/**` — 28 `.sla` files (TS sources ≈23,876 lines, same
paths). Worktree `/content/bulk-pkgcxu` at base `b5578e9`. All checks:
`sa check` with `SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
SA_STD_DIR=/content/sa_all/sci/sa_std`, serial, timeout-wrapped, cwd =
worktree root. No files outside `packages/cxu/**` were modified; no sci /
sa_plugin_sla / sala changes.

## 1. Result: PASS 2/28 → 27/28 (failure NAME SETS)

Baseline PASS (2): `vendor/saVmProcess.sla`, `vendor/saVmTypes.sla` (bulk
model — later replaced by the sdk port, see §3).

Baseline FAIL (26): extensions/pi-relay/index, server-bundle/extensions/
pi-relay/index, src/bun-runtime, src/cli-doctor, src/cli, src/index,
src/postinstall, src/serve, src/server-build, src/shared-types,
src/vendor/{dataDir, memoryFilePaths, regressionCases, regressionRunner,
saVmAccountabilityLedger, saVmApplyPatch, saVmCodeGraph, saVmFindWorker,
saVmJev, saVmPolicy, saVmRequest, saVmResultKind, saVmSplitWorkflow,
saVmTool, saVmTreeSitter}, src/vendor/sdk-backend.

Final FAIL (1): **`src/vendor/saVmJev.sla`** — first error
`checkExpr failed at call str_eq with 4 args (error.InvalidArgsCount)`,
byte-identical to the backends provider copy's recorded first error
(FIX_BACKENDS §7). Inherited cross-domain debt, NOT introduced here; its
importers (vendor/saVmTool, src/index) PASS because the checker admits
the import closure — the same pattern the backends tree shows. Fixing it
belongs to the Jev provider line, not this domain (renaming discipline:
the Jev\* names in the port are load-bearing for saVmTool's expansion).

Final PASS (27): everything else, including the barrel `src/index.sla`
(the whole domain import graph in one closure) and
`src/vendor/saVmTool.sla` (the 12,040-line TS copy, §3).

## 2. Method for the vendor copies (17 files)

TS provenance was diffed file-by-file against the originals the verified
translations were made from (apps/server/src, backends, sdk-backend):

- TS **identical** (7): dataDir, memoryFilePaths, regressionCases,
  saVmFindWorker, saVmProcess, saVmRequest, saVmResultKind.
- TS **import-path-only diffs** (8): saVmTypes (2 lines),
  saVmAccountabilityLedger / saVmApplyPatch / saVmCodeGraph /
  saVmSplitWorkflow (4 each), saVmJev / saVmPolicy (6 each), saVmTool
  (16) — all `./sdk-backend.js`-style re-points to vendor siblings.
- TS **real diffs**: saVmTreeSitter (4 path literals, §3) and
  regressionRunner (a different module, §4).

For the 15 portable files the SLA body is the VERIFIED counterpart
(apps/server, backends, sdk-backend fix-phase output) with only `@import`
paths remapped to vendor siblings; each port carries a header note.
The FIX_SAVMTOOL model (JsonBuf / path-addressed sa_json handles /
status codes for try-catch / POSIX-ERE / PATCH_OP_*) is therefore reused
verbatim, not reinvented. Counterpart baseline in-worktree before
porting: 15/16 PASS (only backends Jev failing, as recorded).

## 3. Vendor per-file disposition

| file | disposition |
|---|---|
| saVmTool | port of apps J1 tree (23,329 lines); imports remapped types/memoryFilePaths/policy/Jev → vendor siblings. PASS (with new regressionRunner, below). |
| saVmTypes | **bulk vendor model replaced by the sdk-backend port.** The bulk model carried 208 declarations with no in-domain consumer (186 ACTION_* consts + (bytes,len)-style shapes) and shapes incompatible with Tool's closure (sdk canonical: `json: [u8; 262144]`, `op: [u8; 16]`, …). TS type-only union erasure makes the sdk port the faithful form; registered as a deliberate difference. |
| saVmPolicy | port of backends (K) file; dataDir import remapped. PASS. |
| saVmCodeGraph | port of apps file; policy import remapped. PASS. |
| saVmJev | port of backends integrated file (Jev\* names kept — they prevent collision with sdk SaVm* types inside saVmTool's expansion; see b5578e9 integration note). FAIL standalone, inherited (see §1). |
| saVmTreeSitter | port of apps file. Registered diffs (comments at both fns): vendor TS block-2 first wasm candidate is `../wasm/tree-sitter.wasm` and language candidates are `../wasm/languages/<file>` ×3 depths, where apps TS probes `node_modules/web-tree-sitter/tree-sitter.wasm` and `node_modules/tree-sitter-wasms/out/<file>`. The SLA already approximates candidate probing (inherited DEFECT comments); the vendor literals are registered, not silently merged. PASS. |
| saVmRequest / saVmApplyPatch / saVmSplitWorkflow / saVmAccountabilityLedger / saVmResultKind / saVmFindWorker | ports of apps files. PASS. Ledger inherits J1's registered semantic note (accountability gate model) — deliberately NOT fixed in the vendor copy alone (would diverge from the provider). ResultKind additionally renamed (§6). |
| dataDir / memoryFilePaths / regressionCases | ports of sdk-backend files (dd_fs_exists form kept). PASS. |
| saVmProcess | bulk file was already PASS; untouched. |
| sdk-backend (barrel) | 4-line @import forwarding of types/memoryFilePaths/regressionCases/dataDir; passes once deps pass. |
| regressionRunner | **full retranslation from the vendor TS** (§4). |

## 4. regressionRunner: a different module, retranslated

The vendor TS (231 lines) shares only the export surface with
apps/server's runner (296 lines): it is self-contained (own
RegressionCase, own loader) and its `runRegressionCase` performs ONLY
the declarative evaluation (forbiddenPatterns × simulation.rounds
substring scan over the stringified round). The apps SLA is a (b)-class
skeleton (record/run/suite bodies `return 0`), so porting it would have
imported the wrong module AND a skeleton. The new vendor file
(1,323 lines) reuses the apps file's declaration surface verbatim
(identical struct shapes — required by saVmTool's record/run adapters)
with real implementations of the vendor semantics:

- resolve: `<cwd|PWD>/tests/cases/regression`; load: `.json` filter,
  per-file try/skip, `!id || !component` skip, filters id = CI-equal,
  component = CI-includes, category = strict, tag/tags = any-of.
  (The sdk regressionCases loader's component rule differs — basename
  compare — so the runner implements its own load, as the TS does.)
- record: trim id/title/component with ordered
  `Missing required '<field>' for regression case` errors; sanitized id
  `[^a-zA-Z0-9_-] → -`; defaults tags `[]`, category `"state_machine"`,
  description `""`, input/simulation/negativeMatcher/
  positiveInvariants `{}`, runner passthrough (key dropped when
  absent); writes `<id>.case.json` as 2-space pretty JSON (hand-rolled
  recursive pretty printer over sa_json, depth cap 24 → compact
  fallback); result record carries the compact doc + path.
- run: log lines `[replay] Starting case <id>: <title>`,
  `[replay] Executing declarative case evaluation`,
  `[replay] Finished <id>: PASS|FAIL (<ms>ms)`; violations
  `Negative matcher violation: found forbidden pattern "<p>" in
  simulation`; pattern-major / round-minor iteration, exactly as TS.
  forbiddenErrors/forbiddenStates/positiveInvariants are NOT evaluated
  — the vendor TS does not evaluate them either (faithful).
- suite: sequential streaming per file (no [RegressionCase; N] set —
  one case struct is ≈176 KB); aggregates + the exact Chinese summary
  block (🚨/✅ lines, `• 总耗时：<ms>ms`).
- Registered caps/deviations (header of the file): file 131,072 B,
  patterns 64, tags 32, results 512; ASCII-only case folding + trim;
  fs-write failure → `ok:false` + error text (TS throws; saVmTool
  renders both paths identically); verbatim early-return doc omits
  empty optional keys where TS would serialize the raw input object.

## 5. Own files (10) — what was wrong, what changed

Common bulk diseases, fixed domain-wide: missing `sa_std/string.sa`
imports (STR_PTR undefined — 7 files), 3-arg `PTR_BYTE_AT` out-form →
2-arg return form (34 sites), bare assignments to `&` out-params →
write-through `*param = …` (12 sites: cli ×4, server-build ×6,
serve ×2), fabricated 2-arg `sa_json_string_ptr/len` → kind-guarded
real forms (server-build), `print(` → `sa_print_bytes` (serve ×2,
postinstall ×1).

- **shared-types** (a): string.sa import; PTR_BYTE_AT forms;
  `*out_len` write-through; `json_set_text` split into
  `json_set_text_2048` / `json_set_text_1024` (array-typed params need
  exact size match; call sites retargeted by field size: fs json fields
  2048, env/exec/bun-profiles 1024). 4 struct renames (§6). PASS.
- **bun-runtime** (a): the `bunVersionProbe` (b)-stub (`return -1`,
  which made `isBunAvailable` permanently false) replaced by a real
  probe over `sa_std_process_exec_capture` with {data,len} argv
  records (`bun`, `--version`); spawn failure → -1 (TS catch path),
  else the child exit code. Registered: the TS 2,000 ms spawnSync
  timeout has no exec_capture counterpart and is dropped (same
  documented drop as backends/opencode's execFileSync face).
  `ByteBuf` → `BunByteBuf`, `buf_append_lit` → `bun_buf_append_lit`
  (§6). PASS.
- **cli** (a logic + b adapters): `cliGetCxuVersion` was a fabrication
  (wrote `"0.0.0-unknown"` unconditionally). TS reads
  `<pkgDir>/package.json` `.version` with that string as the failure
  fallback (cli.ts L6-15) — now implemented for real (fs read +
  sa_json `object_get_string`), fallback preserved. One `for … };`
  trailing-semicolon syntax error in the new code found and fixed
  (for/while blocks take no trailing `;`). Remaining (b): the
  cross-module wrapper adapters doctorW / listToolIdsW / printDoctorW /
  promptDoctorInteractiveW / runInstallW / serveHelpW / runServeW —
  cli.ts's imports were commented out by the bulk converter because
  the sibling SLA shapes differ from the TS call shapes (doctor's
  DoctorState model vs cli's DoctorView; runServe's (argv, argc,
  pkg_dir, exec_path, env) vs TS runServe(args); no environ-iteration
  surface for an EnvTable). They stay as registered adapters — the
  host-wiring family, cf. FIX_INDEX B2/B5 — NOT silent stubs: every
  one carries a DEFECT comment at its definition. PASS.
- **cli-doctor** (a): imports + PTR_BYTE_AT forms only. 35 fns,
  real detection logic; its async registration at L277
  (promptDoctorInteractive: readline Promise → synchronous line-read).
  PASS.
- **serve** (a): SBuf collision family — its buffer struct renamed
  `ServeBuf`, its five colliding helpers renamed `svb_*`
  (svb_append, svb_append_buf, svb_dirname, svb_join2, svb_reset —
  server-build keeps the `sb_*` names; the two families differ only
  by buffer type), `fs_exists` → `serve_fs_exists` (server-build owns
  `fs_exists`), fs.sai import added. The stale 1-arg
  `ensureServerBinary(&server)` call + old-shape literal replaced by
  the current struct shape with ServeBuf→SBuf conversions and the new
  adapter (§7); fallback selection now copies buffers
  (svb_append_buf) instead of move-assigning them (UseAfterMove).
  PASS.
- **server-build** (a): fs.sai + json.sai imports; np scope bug (the
  node_version pointer binding from the Bun-missing branch was reused
  in the Bun-failed branch — fresh binding added); `ByteBuf` literal
  → `BunByteBuf`; the context adapter (§7) appended. PASS.
- **postinstall** (a): main rewritten — full current
  EnsureServerBinaryResult literal; pkg_dir derived from
  `sa_env_current_dir` (npm runs postinstall with cwd = package root,
  the same directory TS derives from import.meta.url), exec_path from
  `sa_env_current_exe`; calls the adapter (§7); both TS log paths
  preserved (ok-false hint line; status≠0 → catch line). PASS.
- **index** (a): barrel; passes once the closure is collision-free
  (§6). PASS.
- **pi-relay ×2** (a logic + b host stub): the two copies differ only
  in the header comment (TS copies identical). Fixes applied to both:
  `ids[n_ids] = seg` move inside the split loop →
  reset+append copy (LoopConditionalConsume); `models[k].id/.name =
  ids[k]` double-move → sb_append copies; `registerProvider` models
  param `&ProviderModelConfig` → `&[ProviderModelConfig; 32]`
  (the call site passes the array). The `registerProvider` body
  remains the registered host stub (no Pi host exists in SLA; the
  payload assembly feeding it is real). PASS ×2.

## 6. Rename register (import-graph checked first)

All renames are file-local; every renamed file's importers were checked
before renaming (the saVmJev lesson). Canonical side kept in each case:

| rename | where | why / canonical kept |
|---|---|---|
| `SharedSaVmFsEntry`, `SharedSaVmHttpAllowRule`, `SharedSaVmProcessExecRule`, `SharedSaVmContextSavingsConfig` | shared-types.sla | collides with vendor policy/types models in the index closure; shared-types is imported only by index.sla; vendor/policy model canonical |
| `RkSaVmRunResult` + `rk_resultKind` | vendor/saVmResultKind.sla | TS declares a module-local SaVmRunResult (saVmResultKind.ts L1-12) distinct from saVmTypes'; Tool also owns a different `resultKind` fn. saVmTypes/Tool canonical |
| `ServeBuf` + `svb_*` ×5 | serve.sla | server-build owns SBuf/sb_*; nothing imports serve.sla |
| `serve_fs_exists` | serve.sla | server-build owns fs_exists |
| `BunByteBuf`, `bun_buf_append_lit` | bun-runtime.sla (+1 literal in server-build) | vendor Jev owns ByteBuf/buf_append_lit (J1 port — not touched) |

## 7. New adapter: ensureServerBinaryDefault (server-build.sla)

TS `ensureServerBinary()` takes no arguments; the bulk conversion
exploded its internal derivations into an 11-parameter signature and
left both callers (serve, postinstall) with a stale zero-context call
and an old-shape result literal. The adapter performs the TS
derivations from sa_std surfaces: dist_dir = pkg_dir/src (TS distDir =
dirname of server-build's module URL; bundle resolution joins
`dist_dir/../server-bundle`), home = $HOME via sa_env_get, cwd =
sa_env_current_dir, pid = sa_std_process_id, exec_path passed in
(serve has it; postinstall uses sa_env_current_exe). Registered
DEFECTs at the adapter: platform tag fixed to 2 (linux) and arch to
"x64" — sa_std exposes no process.platform/process.arch query
(env.sai/process.sai carry none; the domain convention is the tag
parameter, cf. bun-runtime); node_version empty (process.version has
no query; its only use is a log line); home via $HOME (win32
USERPROFILE divergence).

## 8. a/b/c census (28 files)

(a) real implementation / pure types — 25: shared-types, bun-runtime,
cli-doctor, serve, server-build, postinstall, index (barrel),
vendor/{saVmTypes, dataDir, memoryFilePaths, regressionCases,
regressionRun
...[truncated 3332 chars]