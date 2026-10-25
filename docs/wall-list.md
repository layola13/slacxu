# 撞墙清单 (wall list) — P1 pilot, living document

Every wall the SLA bridge work has hit so far, with the cost and the
workaround in force. Updated per slice; the P1 acceptance requires
this list to be complete when the live codex turn lands.

## Protocol / bridge shape

1. **Request chaining is data-dependent.** A real turn is not two
   fixed lines: `thread/start` returns a thread id that
   `turn/start` must embed, and `turn/start` streams many
   notification lines before its result. The fixed two-round pump
   (slices 1–4) proves transport only. Next slice needs: read a
   response, extract a JSON string field, splice it into the next
   request, and read until a result id matches (not just one line).
   Cost: one slice. Owner: cxu-bridge.
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
