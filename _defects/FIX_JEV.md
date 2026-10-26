# FIX_JEV — Jev provider line: saVmJev inherited debt (Agent O, 2026-10-26)

Scope: `backends/jev/src/jev/saVmJev.sla` (provider) and
`packages/cxu/src/vendor/saVmJev.sla` (vendor copy). Base: bulk-convert
`a32e810`, worktree `/content/bulk-jev`. Both copies remain identical
modulo the vendor copy's 3-line header comment (verified by diff after
every patch round).

## Result

| file | baseline | final |
|---|---|---|
| backends/jev/src/jev/saVmJev.sla | FAIL (str_eq 4 args) | **PASS** |
| packages/cxu/src/vendor/saVmJev.sla | FAIL (str_eq 4 args) | **PASS** |
| apps/server/src/saVmTool.sla (importer, regression gate) | PASS | PASS |
| packages/cxu/src/vendor/saVmTool.sla (importer, regression gate) | PASS | PASS |
| packages/cxu/src/index.sla (barrel, regression gate) | PASS | PASS |
| backends/jev/src/server.sla (barrel, regression gate) | PASS | PASS |

The three Jev* struct names (JevRunInput / JevRunResult /
JevPolicyConfig) were NOT touched — they are load-bearing against the
sdk saVmTypes collision in saVmTool's import expansion.

## 1. The named item: `str_eq` rename (full table)

Root cause (found by Agent M, re-verified here): `str_eq` is an SLA
compiler builtin call name; a user fn with that name and a 4-arg
signature always fails with `InvalidArgsCount`, regardless of call
sites. Baseline first error on both copies, reproduced before any edit:
`checkExpr failed at call str_eq with 4 args (error.InvalidArgsCount)`.

One definition, one signature (byte-slice equality over two
(ptr, len) pairs, returning bool) — no overloads:

| item | provider | vendor |
|---|---|---|
| definition `fn str_eq(a_ptr, a_len, b_ptr, b_len) -> bool` | line 156, 1 | line 159, 1 |
| call sites `str_eq(` | 40 | 40 |
| total renamed to `jev_str_eq` | 41 | 41 |
| residual `\bstr_eq\b` after patch | 0 | 0 |

Real importers of saVmJev (grep-verified; other mentions are comments):
apps/server/src/saVmTool.sla, packages/cxu/src/vendor/saVmTool.sla,
backends/jev/src/server.sla.

## 2. Errors behind the first one, in the order the checker surfaced them

### 2.1 Fabricated extern `sa_ptr_store_byte` (2 sites per copy)
Byte-store calls in two copy loops. Rebound to the real sa_std macro
`PTR_WRITE_BYTES(p, b, 1)` (sa_std/ptr.sa, over @sa_mem_set). Same
loop structure kept.

### 2.2 Fabricated `sa_json_node_*` family + count/value-at helpers
The conversion targeted an invented extern family with a LOCAL kind
numbering (file comment: 0 null/absent, 1 string, 2 array, 3 object,
4 number, 5 boolean). The real `sa_json_kind` numbering is different
(0 null, 1 bool, 2 int, 3 float, 4 number_string, 5 string, 6 array,
7 object — sci sa_std.zig SA_JSON_KIND_*), so a plain rename would
have silently corrupted every kind test. Instead a local access layer
was added (jev_json_*), adapting the real externs to the local
convention; all call sites renamed:

| fabricated name | sites/copy | rebound to |
|---|---|---|
| sa_json_node_kind | 12 | jev_json_kind (sa_json_kind + numbering map) |
| sa_json_node_string | 6 | jev_json_string (sa_json_string_ptr/len, kind==5 gate) |
| sa_json_node_number | 4 | jev_json_number (sa_json_as_f64) |
| sa_json_node_bool | 2 | jev_json_bool (sa_json_as_bool) |
| sa_json_node_json_text | 3 | jev_json_text (sa_json_stringify + buffer_data/len) |
| sa_json_array_len | 2 | jev_json_count (sa_json_value_count) |
| sa_json_object_len | 2 | jev_json_count (sa_json_value_count) |
| sa_json_object_value_at | 1 | jev_json_object_value_at (key_at + object_get) |

Registered deviation: jev_json_text deliberately does not free the
stringify buffer (callers copy the bytes out immediately; freeing
would dangle the returned ptr) — same leak class as the
FIX_SAVMTOOL json_text deviation.

### 2.3 Fabricated time names
| fabricated name | sites/copy | rebound to |
|---|---|---|
| sa_time_now_ms | 8 calls (+1 comment) | jev_now_ms (sa_time_unix_ms, clamped >= 0, as u64) |
| sa_sleep_ms | 1 call (+2 comments) | jev_sleep_ms (sa_time_sleep_ms) |

### 2.4 `jev_http_post_json` — bound to the real HTTP client (not a seam)
The direct-upstream fetch (TS `fetch` with Bearer auth + JSON body)
is now a real local fn over the sa_std stateful client v2 surface
(sa_http_client_new_v2 / req_new_v2 method=2 / set_timeout_v2 from
timeoutMs / add_header_v2 Authorization + Content-Type /
set_body_v2 / req_send_v2 / resp_status / resp_body_ptr+len, all
handles freed). Any completed exchange returns 0 with
out.ok = 200<=status<300; a v2 timeout status (3) maps to
out.timed_out (the TS AbortError branch); other transport failures
return 1. Model follows the same-domain precedent
frontends/jev/src/jev/jevClient.sla (Agent N).

### 2.5 `jev_relay_executor_call` — registered HOST SEAM (explicit failure)
The relay executor is a host-registered function value in TS
(setJevRelayExecutor); SLA has no host-callback registry surface
(cf. FIX_INDEX B2, FIX_BACKENDS host fn-table note). The local fn
fails explicitly: returns 1 with the response zeroed, routing the
caller through the TS catch path ("JEV relay executor failed",
status 502) — the same observable outcome as a throwing executor.
Not a silent stub; wiring a real executor needs a host registration
surface that does not exist yet.

### 2.6 `sa_load_regression_cases` — registered HOST SEAM (cross-unit)
The sdk-backend unit owns the real loader
(sdk-backend/src/regressionCases.sla `loadRegressionCases`), but its
RegressionCaseSet representation ([RegressionCase; 256] of ~64 KiB
raw-JSON cases) cannot be adapted into this unit's JSON-text
RegressionCaseList across the @import boundary, and the vendor copy
must stay identical to the provider copy (adapting inside the Jev
unit would fork the two copies' dependency shapes). The local
loadRegressionCases fn now returns the empty list explicitly (out.len
= 0, out.json_len = 0 — the same result TS produces for a missing
cases directory), with the seam documented in-file and here.
Replay-case callers observe len 0.

### 2.7 One malformed merged template literal
One call site (jev_rank summary header) had a TS template literal's
three segments crushed into a single 4-arg buf_append_lit call (the
checker's `buf_append_lit with 4 args` error). Restored to the TS
shape: append literal segment 1, append the criterion buffer,
append literal segment 2. This was the last error; both copies then
verified clean.

## 3. Census / leftovers for this unit

- No remaining fabricated sa_* call names in either copy: the full
  call-name inventory (19 names) was audited against the imported
  .sai surfaces; everything left is a real extern or a local fn.
- Two registered host seams remain (2.5 relay executor, 2.6
  regression-case loader) plus the pre-existing in-file DEFECT
  registrations (dynamic-object approximations etc.), unchanged.
- Runtime behaviour was not exercised (check-level phase, same as
  the other fix domains); the relay seam and the loader seam are the
  two paths whose runtime outcomes differ from TS by design until
  host wiring lands.
