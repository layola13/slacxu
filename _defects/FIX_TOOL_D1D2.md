# FIX: saVmTool D1 / D2 retranslation bugs + D3 localization

Agent W, 2026-10-26. Worktree `/content/bulk-toolfix` from bulk HEAD
`fff7938`. Scope: `apps/server/src/saVmTool.sla` and
`packages/cxu/src/vendor/saVmTool.sla` only (the two copies carried the
identical defects; vendor offsets are +3 lines; both copies patched with
the same edits and verified independently). Local commit only, not pushed.

Check env (canonical): cwd = worktree root, `SA_PLUGIN_DEV=1
SLA_NO_FRESHNESS_CACHE=1 SA_SLA_FIXTURE_DIR=<sla>/tests/import_fixtures/
SA_STD_DIR=<sci>/sa_std`, serial, timeout-wrapped.

## D1 — blocked tool names: underscore separator missing (security)

TS truth — `apps/server/src/saVmTool.ts` L12035:

```
/(?:^|[._:/-])(bash|shell|exec|python(?:\d+(?:\.\d+)?)?|py|node(?:js)?|bun(?:x)?|deno|ts-node|tsx|npx|javascript|typescript|js|powershell|pwsh|cmd|apply_patch|write_file|edit_file)(?:$|[._:/-])/i
```

One anchored alternation match; separators are `[._:/-]` on both sides;
alternatives are whole tokens (case-insensitive).

SLA site — `isSaVmBlockedToolName` (apps copy, ~L22916 pre-fix): splits
the name on separator bytes {46 `.`, 58 `:`, 47 `/`, 45 `-`} and compares
each lowercased segment against `blocked_segment`. Byte 95 `_` was
missing, so `my_bash` and `bash_tool` arrived as single segments
(`my_bash`, `bash_tool`) that match nothing — not blocked. TS blocks both.

Fix (both copies, minimal):

1. Segment separator set gains `|| b == 95`.
2. This alone would REGRESS TS semantics: `apply_patch`, `write_file`,
   `edit_file` are single regex alternatives that CONTAIN a separator.
   With `_` as a split point they would fragment into `apply`+`patch`
   etc. and stop matching (they previously matched only because `_` was
   not a separator). So before the segment loop, three whole-token checks
   run via two new helpers:
   - `blocked_sep_byte(b)` — the TS separator class as bytes (46/58/47/45/95).
   - `blocked_us_word(value, wp, wl)` — case-insensitive scan for the
     token at any position whose neighbours are string edges or
     separator bytes (the TS `(?:^|[._:/-]) token (?:$|[._:/-])` shape).
   Early `return true` for `apply_patch` / `write_file` / `edit_file`.
3. Nothing else changes: `blocked_segment`'s table (which already lists
   those three tokens; the segment path still reaches them when the name
   equals the token exactly) is untouched.

## D2 — parseGitBranchHeader: ahead swallowed the ", behind N" tail

TS truth — `saVmTool.ts` L7308–7316: `const aheadMatch = /ahead
(\d+)/.exec(flagsText)` and `/behind (\d+)/` — PREFIX captures: the digit
run right after the keyword, nothing more.

SLA site — `parseGitBranchHeader` (apps copy, ~L15208 pre-fix): after
locating `ahead ` at `ap`, it called `parse_i64_bytes(ptr, flags.len -
ap - 6, &ok)` — the WHOLE remainder (`2, behind 1`) into the strict
whole-string parser (`parse_i64_bytes` rejects any non-digit), so `ok`
was false and ahead stayed 0 whenever a behind part followed. Behind
only worked because it sits at the end of the flags text.

Fix (both copies): before each `parse_i64_bytes` call, scan the digit run
at the value position (`adig` / `bdig`) and pass exactly that length —
TS prefix-capture semantics for both values. Branch/upstream extraction
untouched.

## Probe verification (main-form build-exe probes)

`sa test` on a root file importing only saVmTool currently fails import
expansion with an unlocated `error.SyntaxError` (known compiler residual,
compiler-line item; V hit the same). Verification therefore uses
`fn main` probes built with `sa build-exe`; a failed assertion surfaces
as `PANIC: code=<n>`, success as exit 0. Probes placed in
`_defects/probes/` must import the Tool via a RELATIVE path
(`../../apps/...`): with the bare `apps/...` form the root body's struct
literals fail to parse (same expansion-seed surface).

Landed regression probes (run from the bulk tree root, canonical env):

| probe | covers | expected |
|---|---|---|
| `_defects/probes/tool_d1d2_regression.sla` | D1 core (my_bash, bash_tool), full G10 true mask, full G11 false mask, underscore-token preservation (edit_file, foo.apply_patch, foo_apply_patch, my_python blocked; xapply_patch, apply_patchx free), D2 five forms (both flags, no flags, ahead-only, behind-only, two-digit both) + plain + No-commits | prints `D1D2_OK`, exit 0 |
| `_defects/probes/tool_d1d2_regression_vendor.sla` | vendor copy: D1 core + token core, D2 both-flags + ahead-only + behind-only | prints `D1D2_VENDOR_OK`, exit 0 |
| `_defects/probes/tool_d3_execgit_regression.sla` | execGitSync on /tmp/vrepo: `git --version`, `git rev-parse --is-inside-work-tree` | prints `G17CORE_OK`, exit 0 |
| `_defects/probes/tool_d3_execgit_regression_vendor.sla` | same, vendor copy | prints `G17CORE_OK`, exit 0 |
| `_defects/probes/d3_argv_set_direct.sla` | D3 control (macro in owning fn) + run_cwd spawn | prints `R0_OK`, exit 0 |
| `_defects/probes/d3_argv_set_via_ref.sla` | D3 minimal repro (macro via &param helper) | segfault on current compiler (see D3); `E_OK` once fixed |

Results:

| case | pre-fix (apps) | post-fix apps | post-fix vendor |
|---|---|---|---|
| G12 my_bash / bash_tool blocked | PANIC 1201 (not blocked) | PASS | PASS |
| G10 true mask (12 names) | PASS | PASS | core PASS |
| G11 false mask (9 names) | PASS | PASS | core PASS |
| underscore tokens (apply_patch etc.) | PASS | PASS (no regression from adding 95) | PASS |
| G5 both flags ahead=2 behind=1 | PANIC 504 (ahead 0) | PASS | PASS |
| G5 ahead-only / behind-only / two-digit | — | PASS | PASS |
| G6 plain / No-commits | PASS | PASS | — |
| G17 core execGitSync (--version, rev-parse) | SIGSEGV after driver entry | PASS (`G17CORE_OK`) | PASS (`G17CORE_OK`) |
| sa check saVmTool (apps / vendor) + pkg-cxu barrel index | PASS | PASS | PASS |

## D3 — execGitSync runtime segfault: LOCALIZED to a compiler codegen shape

Symptom (V): `execGitSync` segfaults at runtime regardless of argv
content; markers at entry never return. V already exonerated the std
process surface (an equivalent direct-call probe returns PROC_OK).

Bisect (verbatim copies of execGitSync + helpers in scratch probes,
marker-instrumented):

- Crash isolated to the FIRST `git_argv_set(&a, 0, ...)` call; the spawn /
  wait / drain tail never runs.
- Variant A — identical function but with `PROCESS_ARGV_SET_PTR` inlined
  at the call sites (array is a local of the calling fn) and
  `git_argv_ptr` unchanged: FULL RUN OK (spawn + drain + correct
  output). So `git_argv_ptr`'s `PTR_BYTE_ADD` address computation through
  a `&GitArgvArr` parameter is CORRECT.
- Minimal repros (sa_std-only imports):
  - helper `set_via_ref(a: &ArrWrap, ...)` doing
    `PROCESS_ARGV_SET_PTR(&a.slots, idx, p, n)` segfaults deterministically
    (6/6) before returning; sentinel slots pre-filled in main are never
    updated.
  - helper receiving a plain `ptr` base param: same crash.
  - helper computing the base with `PTR_BYTE_ADD` first, macro applied to
    the ptr variable: same crash.
  - markers show `arr_base` (PTR_BYTE_ADD through the ref param) RETURNS
    fine — the fault is at the macro's STORE expansion itself.

Trigger shape (final): **`PROCESS_ARGV_SET_PTR`'s stores, expanded in a
function where the slots array is NOT a local of that function (base
arrives via any parameter form), segfault; the identical macro expanded
in the array-owning function works.** This is a compiler (SAB codegen)
shape defect in the same family as V's C3 (PTR_BYTE_ADD+PTR_WRITE_U8 on
a local array in straight-line code). It is NOT a Tool writing bug: the
helper indirection is ordinary, TS-faithful structure.

Affected Tool functions (all routed through `git_argv_set`; 6 call sites
per copy): `execGitSync`, `spawnHostProcess`, `spawnScriptRunner` — every
one was runtime-dead at its first argv write while `sa check`-green.

Resolution applied (the brief's documented-equivalent exception): the
macro call is textually identical (`PROCESS_ARGV_SET_PTR(&X.slots, idx,
p, n)` — same macro, same arguments, same slot layout), only its
EXPANSION SITE moved into the array-owning function, the shape proven
stable by variant A and the control probe. `git_argv_set` is deleted;
an explanatory comment at its former location points here and at the
minimal repro. Compiler-side fix remains owed (the via-ref probe is the
regression seed). With this, `execGitSync` is runtime-verified on both
copies (table above).

Incidental findings (not fixed here; compiler line):

- C1 blocks G17b: a build-exe root calling `nativeGitStatus` traps with
  SAB `FallthroughForbidden` in `@sla__pol_item_copy_from` (V's C1).
  G17b is therefore not runtime-verified this round; `sa check` passes.
- A build-exe root calling `spawnHostProcess` traps with SAB
  `PhiStateConflict` ("incoming control-flow states do not agree") —
  reproduced IDENTICALLY on pristine HEAD `fff7938` with no patches, so
  pre-existing and unrelated to D3. `spawnHostProcess` /
  `spawnScriptRunner` received the same D3 inlining (check-green); their
  runtime re-verification waits on that compiler item.
