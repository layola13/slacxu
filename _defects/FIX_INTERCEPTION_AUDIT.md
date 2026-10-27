# FIX_INTERCEPTION_AUDIT — saVmInterception.sla spot-check fixes (Agent AK, 2026-10-27)

Scope: `backends/vmtool-security/src/security/saVmInterception.sla` only, plus the new
supplement test `tests/server/saVmInterception.test.sla`. Base: bulk-convert `a6cfa37`.
Semantic source: `saVmInterception.ts` in the same directory + its TS test suite
`tests/server/saVmInterception.test.ts` (case numbers cited as TS#n).

## Disposition of the five audit items

| # | Item | Disposition | Evidence |
|---|------|-------------|----------|
| 1 | Silent truncation fail-open (StrOut/StrItem/args caps) | **Fixed on the judgment paths in this file; remaining sites registered below** | StrOut `overflow` flag; intercept fail-closed deny reason; classify basename re-check; tests panic codes 11–15 (blocked at runtime by a pre-existing trap, see Gates) and 31–33 (passing) |
| 2 | `\s` inconsistency (space/tab only) | **Fixed** — one shared ASCII `\s` set `intc_is_space` = {9,10,11,12,13,32}, applied to every skip/terminator/prefix site | Tests 75–78, 87 pass; grep: no space/tab-only skip loops remain outside `intc_is_space` itself |
| 3 | `ap_head_tail` comment overstated approximation as equivalence | **Fixed** — comment rewritten as detection-only equivalence (see R17) | File comment at `ap_head_tail`; tests 65–68 |
| 4 | 27 anti-pattern rules re-audited against the TS regexes | **11 rules fixed (2,3,4,5,6,13,14,15,17,18,19), 16 signed green** | Per-rule table below; test groups per rule all pass (13/13 runnable groups) |
| 5 | `bool,bool` argument-order hazard at `extractCommandArgv` | **Verified correct — no change** | Policy signature `extractCommandArgv(value_doc, value_is_array, value_is_string, out)` (saVmPolicy.sla); the single call site passes `(raw, kind == 6, kind == 5, &argv)` = (array, string) in the right order. Kind numbering (5=string, 6=array, 7=object) is used consistently across the file. The only other tree reference is a comment in `apps/server/src/index.sla` (out of scope) |

## Item 1 — truncation register

Changed in this file:

- `StrOut` gains an `overflow: bool` field. `intc_out_append` and `intc_out_lit` set it
  whenever bytes are dropped at the 2048 cap. All five `StrOut` literals in the file updated.
  (The file's only importer, `backends/vmtool-security/src/server.sla`, does not construct
  `StrOut` — verified by grep — so the struct change has no external constructor fallout;
  `server.sla` still checks clean.)
- `interceptSaVmRequest`, direct-command branch: the anti-pattern scan runs on
  `build_full_cmd`'s output. If no rule hit **and** `full.overflow` is set, the request is
  denied with the explicit reason *"…(command exceeded the 2048-byte anti-pattern
  inspection buffer; denied fail-closed)"* instead of the generic direct-command reason.
  **This is a deliberate security-side deviation from the TS source, not TS fidelity:**
  TS uses unbounded strings and has no such case; the action was already `deny` for every
  direct command, so the functional delta is an honest, specific reason plus a guarantee
  that a partial scan is never silently trusted.
- `classifySaVmScriptToolRequest`, tool-name path: `node_str` caps the candidate copy at
  1024 bytes, hiding the basename of a longer path-like name. When the candidate node's
  full JSON string is longer than 1024, the language is now tested on the basename slice
  of the **full** string (slicing here, because `saVmScriptLanguage`'s own normalization
  in the policy unit also caps at 1024). Proven by test 31/32 (1100 filler bytes +
  `/python.exe` classifies as python) and the negative control 33 (`/notepad.exe` does not).

Registered, deliberately not changed:

- `classify` joined-args path (`joined_family_language` input): `joined` is a 2048-capped
  `StrOut`; it now records `joined.overflow`, and a code comment states the bounded
  consequence — a script name past the cap can be missed **by classify alone**; inside
  `interceptSaVmRequest` every direct command is denied anyway, so the miss cannot become
  an allow there.
- `req_set_args` (4096 output buffer), `req_set_executable`, `dec_set_reason`: output-side
  copies written after the decision is made; the reason setters only ever receive fixed
  short literals in practice. Output fidelity only, no judgment impact.
- `StrItem` 1024 caps owned by the policy unit (`node_str` for argv elements and policy
  fields, `pol_norm_slash_lower`): cross-unit surfaces in `saVmPolicy.sla`, outside this
  line's scope. Consequence as before: policy checks evaluate the capped prefix. This is
  the same registered cap family as the ByteList caps noted in FIX_SAVMTOOL.
- Web-search bypass probe (`text` StrOut, 2048): truncation can only remove text, which
  weakens a *bypass* — the conservative direction. No change.

## Item 2 — `\s` unification

New predicate `intc_is_space` (ASCII `\s`: space, \t, \n, \v, \f, \r). Applied to:
`intc_prefix_class`, the `intc_pword_term_ci` terminator set, the skip loops of
`intc_word_then_char`, `intc_semi_then_word`, `intc_pipe_then_word`, `intc_word_ws_lit`,
`ap_where_with_arg`, `ap_head_tail`, `ap_select_first_last`, `ap_error_action`,
`ap_null_redirect`, `ap_redirection`, `ap_runtime_invoke`, the `ap_find_with_flags`
separator/segment logic, and every new helper. Note: JS `\s` also covers Unicode
whitespace; this byte-level matcher covers the ASCII subset — a pre-existing limitation
of the whole unit, now at least consistent.

## Item 3 — head/tail comment

The comment no longer presents the handling as equivalent argument parsing. It now
states: the source alternative ends in a bare `\s+` branch, so every whitespace-followed
form (`head -5`, `head -n 5`, `head --lines=5`, `head file`) is indistinguishable to the
detector — detection-level equivalence only; neither implementation parses the numeric
argument; a bare `head`/`tail` at end of input fires in neither. The one real detection
gap found here (pipe forms `| head.exe` / `| tail.exe`, allowed by the source's
`(?:\.exe)?` but missing in the SLA) is fixed under R17.

## Item 4 — per-rule conclusions (detectPowerShellAntiPattern, TS source order)

| Rule | Verdict | Notes / test evidence |
|------|---------|------------------------|
| 1 vm-read/vm_read | Green | `\b` word match both sides; equivalent |
| 2 git bypass via runners | **Fixed** | Was: any later `git` word after the token (superset false positives). Now the source call shape: token + `\s*` + `(` + `\bgit\b` after (`ap_token_call_git`), `python(?:.exe)?\s+-c` (`ap_python_c_git`), `\bbun\s+-e` (`ap_bun_e_git`). Tests 53/54 hit, 55/56 prose null. Registered residue: source's `Bun\s*\.\s*spawn` allows spaces around the dot; the SLA token is the literal `Bun.spawn` |
| 3 .git internals | **Fixed** | Was the documented two_part approximation (part word anywhere later + required right boundary — wrong in both directions). Now the exact form `.git\s*/\s*(HEAD\|config\|index\|refs\|objects\|FETCH_HEAD)` with **no** right boundary (`ap_git_internals`). Tests 57/58 hit (incl. `.git/configs`), 59 null. Baseline contrast: old code reports HIT on test 59's input (panic 59 in the baseline probe = the old over-match) |
| 4 loops (for/foreach) | **Fixed** | Two source alternatives were unimplemented: `for $ident in` (`ap_for_in`) and pipe-% ForEach alias `\|\s*%[\s{]` (`ap_pipe_pct`). TS#22 and TS#23 were missed by the old SLA. Tests 41–43 |
| 5 ;-chained file ops | **Fixed** | `ap_word_then_semi` scanned only the first unbounded substring occurrence. Now every `\b`-bounded occurrence is tried. Test 60 null (`xGet-Content … ;` — baseline HITs it, panic 60 in the baseline probe), 61 hit |
| 6 cmd /c\|/k | **Fixed** | Was plain `\b` adjacency (`intc_word_ws_lit`); now the anchored prefix-class form `cmd(?:.exe)?\s+\/[ck]\b` (`ap_cmd_wrapper`). Tests 62/64 hit, 63 null (`cmd/c` — no whitespace) |
| 7 cd/Set-Location/pushd/chdir | Green | After `\s` unification (terminator set). Test 75 (`cd\r…`) |
| 8 `&&` | Green | Verified equivalent, incl. `&&&`/`&&&&` non-matches (code audit) |
| 9 Get-Process/gps/ps | Green | Ordering vs R13 verified (TS#27 procWhere shape preserved) |
| 10 Get-Date/date | Green | Test 83 |
| 11 Format-*/Out-String | Green | Pure `\b` word match = source (code audit) |
| 12 Select-String | Green | Same (code audit) |
| 13 Where family | **Fixed** | (i) The source's 4th alternative `(?:^|["'\s;&\|()])\bWhere\s*\{` was missing — a string-initial `Where { … }` (TS#25) is now caught by `ap_where_brace` (test 44). (ii) Pipe-? was any `\|?` + non-word; now the source semantics (`ap_pipe_question`): `\s*\{` branch, or `\s+` + `[$\w-]` unless the `[\w$.]+` token is followed by `\s*:` (ternary exclusion). Tests 45 hit, 46/47 TS negatives null, 48 null. Get-ChildItem/gci guard unchanged (TS#27 shape) |
| 14 which/where | **Fixed** | Stop-word check compared the whole whitespace-delimited token; the source lookahead excludes on the **leading word** + `\b`. Now compares the leading `[A-Za-z0-9_]` run (`ap_where_with_arg`). The 21-word list (is, are, was, were, the, do, does, did, can, could, should, would, to, from, in, at, for, with, about, and, or, not) verified complete against the TS lookahead. Tests 49/52 hit (TS#26 shapes), 50 null (`where is, the file` — was a false hit), 51 null |
| 15 find | **Fixed** | Separator is the full `\s` set; segment stop set gained `\r` (source segment is `[^;&\|\r\n]*`). While re-checking, the separator structure was made exact: the leading `\s+` is consumed first (it may contain `\r\n`), then the segment is scanned for its own `\s-` flag introducer. Consequence: `find -name x` (one shared whitespace) is now **null**, matching the source (baseline over-matched); `find  -name x` (run ≥ 2, backtrack case) still hits; `find\n. -name x` now hits (was missed). Tests 80/81/87/88/89 |
| 16 rg/grep/findstr | Green | Prefix-class + `\b` = source (code audit) |
| 17 head/tail | **Fixed + comment (item 3)** | Pipe forms `head.exe`/`tail.exe` added (source allows `(?:\.exe)?` there too). Prefix form verified detection-equivalent (see item 3). Tests 65/66/68 hit, 67 null (TS negative `headless --version`) |
| 18 Select -First/-Last | **Fixed** | (i) The source requires `\s+` before the first flag — `Select-First` no longer fires. (ii) `-(?:First\|Last)\b`: `-First5` no longer fires (a word char after the name demotes the token to an ordinary flag, exactly as the source's backtracking behaves; flag *values* end the run in both). Tests 69/72 hit, 70/71 null, 76 hit (`\n` separator) |
| 19 -ErrorAction | **Fixed** | Added the source's `(?:^\|\s)` left context — `foo-ErrorAction` no longer fires. Tests 73 hit, 74 null |
| 20 error suppression | Green | After `\s` fix in `ap_null_redirect`. Test 82 (`*> $null`, TS#24 shape). `2>&1` substring, `\| Out-Host`, `$null`, `nul` forms verified |
| 21 redirection | Green | After `\s` fix; fd-digit prefix and the `=>`/`->`/`-->` global suppression match the source |
| 22 pipe/heredoc write | Green | Pipe + `\b` after-word; heredoc `@"`/`@'` + word match (code audit) |
| 23 Test-Path | Green | Word match = `\b..\b` (code audit) |
| 24 Get-ChildItem/gci/dir/ls | Green | Test 79 |
| 25 Get-Content/gc/cat/type | Green | After `\s` unification. Test 78 (`Get-Content\r…`) |
| 26 git verbs | Green | `\b` + `\s+` + verb + right boundary; all 11 verbs present. Test 85 |
| 27 runtime invoke | Green | After `\s` fix. Registered nit: the source's `.` excludes `\r`, the SLA line scan crosses `\r` within a line — no practical divergence found |

Rule ordering/precedence follows TS source order in both implementations (first hit
wins); TS#13/TS#27 expectations (Get-Process and Get-ChildItem guidance win over
Where-Object) are preserved.

## Findings recorded for other lines (not fixed here)

1. **SAB test-bundle trap in `interceptSaVmRequest`'s call graph (pre-existing).**
   Any `sa test` bundle that calls `interceptSaVmRequest` traps at bundle build with
   `PhiStateConflict` (register `tmp_31324`, SAB line 106752). Verified **byte-identical
   on the unpatched baseline** `a6cfa37` with an equivalent intercept-calling test — same
   registered compiler-residual family as the anthropicBudgetEffort / mb_free_doc traps.
   The two intercept `@test` groups in the new test file are written and `sa check`-clean
   but cannot execute until that residual is fixed; they are kept in the file with the
   status documented in its header, per the tree's existing convention.
2. **classify tool-name path does not fire for short names (pre-existing).**
   On baseline and patched trees alike, `classifySaVmScriptToolRequest` with
   `{"tool":"python.exe"}` returns `has=false` under `sa test`, although
   `saVmScriptLanguage("python.exe") == 0` and `rec_str` both work standalone, and the
   command/argv path of the same function works. Root cause not isolated (SAB execution
   of that function vs a port defect); it predates this audit and is outside its scope.
   Note the overlong-name fix in item 1 routes through the new basename branch and **does**
   fire (tests 31–33 pass), so the fix is effective despite this anomaly.
3. **Same-name pointer redeclaration segfaults under SAB (compiler evidence).**
   During this audit, `ap_error_action` segfaulted on plain prose inputs. Cause isolated:
   the function declared `let rest: ptr` twice (once in the occurrence loop, once in the
   tail); the second declaration's `PTR_BYTE_ADD` write-back was lost (the macro
   first-out-param lowering defect family — cf. the AG6 finding / Agent AL's line),
   leaving a NULL dereference. Fixed locally by renaming the tail variable to `rest2`
   (probes: before — signal 11 on `powershell hello`; after — pass, including hit and
   glued-occurrence cases). All other new helpers were audited for the same pattern;
   none redeclare a pointer name within one function. Recorded here as an additional
   reproducer shape for the compiler line: *two same-name `ptr` declarations in one fn,
   the first inside a while loop*.
4. **JSON kind magic numbers — rebind pending AJ's constants.** This file compares
   `sa_json_kind(...)` against bare literals (0/4/5/6/7). AJ's `SA_JSON_KIND_*` SLA
   constants have since landed in sci (`sa_std/encoding/json.sla`, sci main `33df6307`),
   but this worktree's std tree predates them; the literals are intentionally left as-is
   here and should be rebound to the named constants at integration time.

## Gates (canonical env: worktree-root cwd, SA_PLUGIN_DEV=1,
SLA_NO_FRESHNESS_CACHE=1, SA_STD_DIR=/content/sa_all/sci/sa_std, .sla-cache cleared,
timeout-wrapped, serial)

- `sa check backends/vmtool-security/src/security/saVmInterception.sla` — **PASS** (RC=0).
- `sa check tests/server/saVmInterception.test.sla` — **PASS** (RC=0).
- `sa test` on the runnable subset (12 detect groups + classify group, i.e. the full new
  test file minus the two trap-blocked intercept groups) — **13/13 PASS**, 0 failed.
  Assertion coverage: 49 detect assertions (panic codes 41–89) + classify 31–33.
- `sa test` on the full new test file — traps at bundle build with the pre-existing
  `PhiStateConflict` `tmp_31324` (finding 1; baseline-identical, so not a regression).
- Backends-domain regression samples — `sa check` on `saVmPolicy.sla` **PASS** and on the
  sole importer `server.sla` **PASS**.
- Baseline contrast probes (run in a pristine `a6cfa37` worktree): null-prose set 5/5
  pass on baseline and (after the R19 fix) on the patched tree; R3/R5 baseline probes
  panic 59/60, confirming the old over-matches that tests 59/60 now pin as null.

Diff: `saVmInterception.sla` +550/−113; new `tests/server/saVmInterception.test.sla`;
this file. Local commits only — no push, no new branches.
