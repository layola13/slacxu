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
