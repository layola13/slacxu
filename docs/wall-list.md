# 撞墙清单 (wall list) — P1 pilot, living document

Every wall the SLA bridge work has hit so far, with the cost and the
workaround in force. Updated per slice; the P1 acceptance requires
this list to be complete when the live codex turn lands.

## Protocol / bridge shape

1. **Request chaining is data-dependent.** RESOLVED in slice 5:
   the bridge reads until the `"id":3` result, extracts the id
   after `"thread":{"id":"`, splices it between CXU_REQ4_PRE /
   CXU_REQ4_POST, and reads the stream through turn/completed.
   Two corollaries fell out of the live work:
   (a) JSON-RPC notifications have no reply — reading for one
   deadlocks (fixed with the CXU_NOTIFY write-only step);
   (b) a per-round receive accumulator silently drops bytes read
   past a newline — notifications arrive back to back, so the
   receive path is now a persistent line buffer.
   (c) The Zen free tier's exhaustion surfaces through codex as
   a 429 with 5 internal retries (~2 min of error notifications,
   no turn/completed until retries lapse); the Kilo gateway free
   channel (kilo-auto/free, keyless) completes the same turn in
   seconds — channel choice is a runtime property, not a bridge
   property.
2. **Blocking reads only.** The pump reads reply lines with blocking
   `sa_io_read`; a child that never answers hangs the bridge until
   the outer `timeout` kills it. sa_std has poll/epoll surfaces
   (PTY work proved them), but the process-stdout handle is not yet
   integrated with them in the bridge. Cost: acceptable for the
   pilot (outer timeout), must fix before the bridge serves a UI.
3. **stderr is drained only at close.** The child's stderr pipe is
   held but never read during the session; a child that floods
   stderr (>64 KB pipe buffer) would block. Real agent CLIs log to
   stderr — the live round may hit this. Workaround when hit: spawn
   variant or a drainer thread (threads + mpsc are the house
   concurrency answer).

## SLA / SA toolchain (all hit during slices 1–4)

4. **Macro arguments are evaluated registers.** Passing an address
   offset as a macro argument puts a register in the offset slot and
   the SA flattener rejects it (`parseLayoutOffset failed`,
   ForbiddenSyntax). Offsets must be baked into macro bodies
   (ARGV_SET0..3 pattern). Recorded in AGENTS.md.
5. **Registers are near-SSA.** Reassigning a variable that a macro
   wrote traps RegisterRedefinition; releasing it first
   (`!var`) traps UseAfterMove at type check, because a macro write
   does not count as a rebinding. Each macro output needs a fresh
   variable.
6. **User-fn `ptr` params reject capability arguments.** Passing
   `&struct.buf` to a plain `ptr` parameter is a TypeMismatch;
   pass `&Struct` references and take field addresses only in
   extern/macro positions (the PumpAcc/ReqLine pattern).
7. **Env values are capped at 254 bytes** in the bridge's ReqLine
   (256-byte buffer minus newline). The real initialize line is
   ~199 bytes, so this holds for the handshake; a fat
   `turn/start` (system prompt inline) will exceed it. Cost: raise
   the buffer and add a length test when slice 5 lands.
8. **Command line tokenization is space-split, max 4 tokens, no
   quoting.** Fine for `codex app-server --stdio`; not fine for
   paths with spaces or `-c key=value` pairs containing spaces.
9. **The freshness cache hides compiler changes.** SLA test runs
   must set SLA_NO_FRESHNESS_CACHE=1 after any compiler edit, and
   corpus runs must start from the repo root (see AGENTS.md) —
   otherwise results describe the old compiler or a different
   import resolution, not the code just written.


## Imported-file limits (found by mini-agent v2, 2026-10-25)

- The SLA import expander rejects functions in @imported files
  that declare very large array locals (a 40960-byte array
  local fails with an unlocated error.SyntaxError; 4096 works;
  root files are exempt). Large scratch buffers must be
  caller-allocated and passed as &Struct parameters. Concatenating
  the imported file plus its caller into one root file restores
  located parse errors and is the reliable bisect method.
- A `while` block followed by `;` (notably inside if/else
  branches) trips "Unexpected prefix token: semicolon" in the
  same expansion path; `if` blocks may keep their `;`.

## mini-agent v3/v4 notes (2026-10-25)

- An SLA user function named `str_eq` collides with a checker
  intrinsic of the same name: calls report InvalidArgsCount
  against the 4-parameter definition. Rename user helpers to
  distinctive names (bytes_eq_str) instead of fighting it.
- sa_vm run_host drains stdout only; a child that fills its
  stderr pipe can block. CXU's runtime buffers both; a dual
  drain (or redirecting stderr into the capture) is future
  work, stated here rather than hidden.
- The live thread's 40960-byte message cap also bounds
  persisted threads: thread_store restores at most the same
  bytes the live thread enforces, so restore is lossless by
  construction.

- sse_turn's out buffers cannot be freed from SLA: the .sai
  free contract takes an owned capability pointer, and the out
  ptrs bind as plain ptrs (CapabilityMismatch at the call site).
  No SLA consumer frees them today (codexmini included); the
  mini-agent server leaks the per-round text/calls/usage buffers
  until a plain-ptr free variant exists in std. Stated, not
  hidden.
- Token usage needs std help: sse_turn discarded the channel's
  usage object, so sci gained sa_http_client_sse_turn_ex, which
  also returns the raw JSON span of the last top-level "usage"
  value. The bridge asks for it with
  stream_options.include_usage and emits
  thread/tokenUsage/updated only when the channel actually
  reported usage (absence is never rendered as zero).


- Slow time-to-first-byte upstreams broke sse_turn: std waited
  at most 200x50ms = 10s for the HTTP status and then returned
  a spurious "upstream error" without retrying. Measured on
  deepkey/grok-4.7: tool-call requests take ~14-20s to first
  byte (text ~3.5s, which is why only tool turns failed). sci
  raised the status-wait cap to 3600x50ms = 180s (a dead
  transfer still ends the wait via poll-done); the code comment
  in sa_http_client.zig carries the measurement. Kilo's fast
  free models never exposed this.
- Channel behaviour notes (deepkey, grok-4.7, 2026-10-25):
  models send glob-style find patterns ("*bridge*") and
  sometimes stuff structured fields into the wrong slot
  (run_host args as ["path", "."]); the find_files matcher now
  strips surrounding '*'. Grok on this relay streams no
  reasoning deltas (thinking is inline in the answer text),
  so reasoning items stay empty there. The Kilo promotion
  quota is per egress IP: the Colab box stayed limited
  (429 PROMOTION_MODEL_LIMIT_REACHED) while this machine's
  egress had already recovered.


## oaifree responses relay: tool_choice "required" is rejected

On https://hub.oaifree.com/v1/responses (measured 2026-10-25),
every tool_choice form except the string "auto" fails with
`Missing required parameter: 'tool_choice.type'` -- the string
"required", {"type":"required"} and {"type":"auto"} all fail
identically; omitting tool_choice works and the model still
calls functions. The bridge therefore sends "auto" on the
responses wire; the weak-model force-required discipline
applies to the chat wire only. The chat wire on the same relay
accepts "required" normally (and its chunks even carry resp_
ids: the relay translates between the two protocols).

## mini-agent v11 notes (2026-10-25)

- MCP sessions are per operation: discovery and every
  tools/call spawn a fresh server process and run initialize
  each time. Spec-legal for stdio servers and stateless tools;
  a stateful MCP server (server-side session state across
  calls) would need persistent connections — future work,
  stated rather than hidden.
- sa_print_bytes cannot take a dynamic buffer pointer from
  SLA: both &struct.field and a PTR_BYTE_ADD-derived ptr trap
  CapabilityMismatch in SAB codegen. Smoke harnesses print
  fixed println markers and use exit codes for diagnosis
  instead of dumping buffers.
- oaifree reasoning summaries are per-request variance on the
  relay side, worse in some windows: on 2026-10-25 evening,
  identical direct probes measured 4 summary deltas on one
  request and 0 on the next, while the bridge missed 11/11
  attempts (v9/v10 evenings it hit roughly 1 in 3 with tools
  attached). The bridge emits a reasoning item only when a
  summary actually streams, so a bad window reads as a
  reasoning failure without any code change.

## mini-agent v12 notes (2026-10-25)

- sa_term_epoll_* cannot be called from SLA as declared:
  term.sai declares sa_term_epoll_create(flags) -> ^ptr!, but
  the Zig export is (flags, out_handle) -> i32. Calling it in
  the declared style returns null or segfaults (the hidden
  out slot lands in the wrong register); the out-param style
  is rejected by the SLA checker (InvalidArgsCount). Until
  the declaration or the export is aligned, epoll is unusable
  from SLA; run_host drains stderr via a file redirect
  instead (see architecture v12).
- The std HTTP server lets several instances bind the same
  127.0.0.1 port at once (observed twice: two LISTEN sockets
  on 18086 with different pids, requests load-balanced
  between them). A stale server silently invalidates live
  tests pointed at the port — one capture experiment was
  poisoned this way. Harnesses must kill by pid from
  ss -tlnp and verify NO listener remains before starting.
- Reasoning summaries on oaifree, resolved as far as it
  goes: the bridge+std pipeline is correct (capture-double
  proof, 2026-10-25 evening). On the real relay the same
  evening, bridge turns went 0/15 while bare probes hit
  ~1/3; no isolated factor explains it (tools on/off, system
  item present/absent, tool_choice, thread history, prompt —
  each hit in isolation at least once). Counted as relay-side
  stochastic delivery; the suite reasoning round stays a
  lottery ticket, not a code signal.
