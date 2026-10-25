# Architecture mapping — slacxu Mini Agent mirrors codex-react-ui

The rule from the user (2026-10-25): the rebuild's architecture
strictly follows the original codex-react-ui (CXU). This document
is the contract: every slacxu mini-agent module names the CXU
module whose shape it mirrors, and divergences are listed, never
silent.

Source of truth in CXU: `docs/mini_agent.md`, `apps/server/src/
miniBridge.ts`, `apps/server/src/saVmTool.ts`, `apps/server/src/
agentRuntime/*`, `apps/web` waterfall item rendering.

## The CXU shape

- **Turn model**: thread → turn → items. Item types: userMessage,
  agentMessage, reasoning, toolCall, plan. Nothing renders outside
  items; the frontend is a waterfall over items.
- **Event vocabulary** (bridge → frontend notifications):
  item/started, item/agentMessage/delta, item/reasoning/textDelta,
  item/completed, turn/plan/updated, turn/completed,
  thread/tokenUsage/updated. Mini threads reuse the codex
  frontend unchanged because the vocabulary is identical.
- **MiniBridge.runMiniTurn loop**: expand skill invocations →
  build messages from thread history → call the relay gateway
  (chat completions or responses, stream:true) → text becomes
  agentMessage segments (streamed as deltas); tool_calls execute
  and their results go back into the thread → next round. A
  text-only turn ends the turn (completed), subject to task/plan
  continuation checks in the full implementation.
- **Tools**: one multiplexed native tool, `sa_vm` (UI name
  "sa-vm"), with structured actions (list_dir, read_file,
  find_files, run_host {exe, args} — structured, never a command
  string), plus read_skill, update_plan (plan item +
  turn/plan/updated), the spawn_agent family, and MCP tools named
  mcp__<server>__<tool>. toolCall items are emitted (started →
  completed) so trajectories are visible.
- **Weak-model discipline** (0.1.1+): action-intent first turns
  send tool_choice:"required"; forceTool resets after a successful
  call; duplicate call suppression; no silent success — a turn
  that did nothing ends failed or corrected, never "completed"
  by default.
- **Persistence**: one file per thread (frontmatter + readable
  body + embedded JSON state) under the mini-agent data dir;
  the file is the recovery source of truth.
- **System prompt**: the shared fallback instructions plus a
  tool-adaptation tail; history is injected as context, the live
  task is the user item.

## The slacxu mirror (packages/mini-agent)

| CXU | slacxu | status |
|---|---|---|
| miniBridge.ts (turn loop) | src/miniBridge.sla | v2: loop + items + sa_vm subset |
| relay gateway (chat, stream) | Kilo gateway free channel via std sse_turn / sse stream | done (v1 relay proven) |
| saVmTool.ts (sa_vm actions) | src/saVmTool.sla — list_dir, read_file first | v2 |
| item event stream to web | server.sla emits the same method vocabulary as SSE lines | v2 |
| apps/web waterfall | www/index.html renders items (user / reasoning / toolCall / agent segments) | v2 |
| file-per-thread history | src/thread_store (slice B) | planned |
| read_skill / skills roots | — | later slice |
| update_plan / plan item | — | later slice |
| MCP (mcp__server__tool) | — | later slice |
| spawn_agent family | — | later slice |
| task-intent / plan continuation checks | — | later slice (v2 ends text turns as completed) |

## Stated divergences (v2)

- Transport: CXU drives the bridge over its server WS/HTTP RPC;
  slacxu v2 exposes POST /api/chat returning the item-event
  stream as SSE. The event vocabulary and item shapes match;
  the carrier is simpler.
- One process, threads in memory; file persistence is slice B.
- Tool subset: list_dir + read_file only; run_host and the rest
  follow as their own slices.
| reasoning items | apps/server/src/miniBridge.sla + std sse_turn_ex reasoning accumulation | done: item/started + item/reasoning/textDelta + item/completed per round when the channel streamed reasoning; the page renders reasoning blocks dimmed |


## v8 landing notes (2026-10-25)

| CXU | slacxu | status |
|---|---|---|
| spawn_agent family | apps/server/src/miniBridge.sla - spawn_agent tool, depth <= 1, child thread <parent>-sub-<n> with its own turn loop and item stream, final answer returned as the tool result | done: verified live on the deepkey grok-4.7 channel (child thread t-spawn-sub-1 ran list_dir and reported run.sh; the parent completed with the child answer). Child threads are not persisted (stated divergence); CXU concurrency <= 5 is not replicated - sub-agents run sequentially |
| relay gateway configuration | apps/server/src/miniBridge.sla - MINI_RELAY_URL / MINI_RELAY_KEY / MINI_MODEL env vars override the channel; defaults unchanged (keyless Kilo gateway, kilo-auto/free) | done: the whole verification suite ran through the env-configured deepkey channel |
| sa_vm find_files pattern | apps/server/src/saVmTool.sla - surrounding '*' of glob-style patterns are stripped before the substring match | done: grok sends "*bridge*"; Kilo-era models sent the bare substring |

Verification note (2026-10-25): in one clean run.sh run on
grok-4.7 the suite passed page, text, tool, thread file,
persistence recall, find_files, run_host, read_skill,
update_plan and token usage. The reasoning round cannot pass
on that channel because grok streams no reasoning deltas
there (its thinking is inline in the answer text); reasoning
items were verified on Kilo in v7. The spawn round passed
standalone with the complete child-thread event stream.


## v9 landing notes (2026-10-25)

Dual wire APIs, mirroring the CXU miniBridge gateway (chat /
responses): `MINI_WIRE_API=responses` switches request
construction to the Responses shape. Thread storage stays
chat-format (the canonical persisted shape); translation to
Responses input items happens only while building the request
(append_input_items in mini_bridge.sla): role messages pass
through, an assistant tool_calls message becomes one
function_call item per call, a tool message becomes a
function_call_output item. Tools use the flat responses schema
form, the request carries reasoning {summary: "auto"}, and std
is called with api_mode 0. Usage parsing accepts both key
families (prompt/completion_tokens and input/output_tokens).
Default stays chat (Kilo); responses is opt-in per channel.

The local .sa macro files are gone. This is a full-SLA project:
shared SA belongs in sa_std. BYTES_EQ moved into sci
sa_std/mem.sa, BYTE_AT_OUT was upstreamed as PTR_BYTE_AT in
sa_std/ptr.sa, PTR_ADD_OUT call sites use the existing std
PTR_BYTE_ADD, and the ARGV_SET<i> family was replaced by std
process.sa PROCESS_ARGV_SET_PTR (slot-computed argv entries,
verified from SLA). Deleted: apps/server/src/{byteseq,ptradd,
argvfill}.sa and packages/cxu-bridge/src/{argv1,argvfill,
ptradd}.sa (argv1's ARGV_FILL1 had no call sites left).

Verification (2026-10-25): full suite 13/13 lines green in ONE run on the oaifree Responses wire (gpt-6-luna), including the reasoning round (summary deltas become reasoning items) and the spawn_agent round. The chat wire on the same relay passes everything except reasoning (not exposed there).

## v10 layout alignment (2026-10-25)

Directory layout and file names now mirror codex-react-ui
strictly for the Mini Agent scope: apps/server/src holds
index.sla (was main.sla), miniBridge.sla, saVmTool.sla and
codeCliBridge.sla (the P1 bridge kernel, moved out of the
former packages/cxu-bridge); thread persistence lives at
apps/server/src/runtime/threadStore.sla; apps/web is
index.html + src/main.js + public/favicon.svg, served at /,
/src/main.js and /favicon.svg; the smokes live under scripts/
(mini-agent-smoke.sh, codeCliBridgeSmoke/ with the harness
entry and protocol doubles). The packages/ layer is gone --
the root sa.mod lists apps/server only. The suite's find_files
expectation follows the rename (pattern "Bridge", path
miniBridge.sla).

Style: counted loops use SLA `for x in 0..n` throughout the
server sources (36 loops converted from hand-written while);
the remaining while loops are scans, polling or guard loops.

Operational note: MINI_RELAY_URL is a FULL endpoint URL
(.../chat/completions or .../responses); the bridge appends
nothing. Passing a bare base URL yields upstream 404s that
surface as "upstream error" (root-caused 2026-10-25 after
three mislaunched verification runs).

Verification (2026-10-25, after a full environment restore on
a fresh Colab runtime): full suite green in ONE run on the
oaifree Responses wire (gpt-6-luna) on the new layout --
page, web js, text, tool, thread file, persistence recall,
find_files, run_host, read_skill, update_plan, token usage,
reasoning, spawn_agent, e2e. The reasoning round is subject
to relay variance (measured 1-in-3 summary hit rate with
tools attached that evening); the bridge emits a reasoning
item only when the channel actually streams a summary.

## v11 MCP tools (2026-10-25)

CXU parity item closed: MCP tools. apps/server/src/mcpClient.sla
is a stdio JSON-RPC MCP client. Servers come from a JSON config
(MINI_MCP_CONFIG env path, default .mini-agent/mcp.json):
{"servers":[{"name":"demo","cmdline":"python3 server.py"}]}.
At each top-level turn the bridge discovers tools (spawn,
initialize, tools/list) and offers every tool to the model as
mcp__<server>__<tool> (CXU's naming), with the server's own
inputSchema as the parameters, on both wire forms. Calls run
session-per-call (spawn, initialize, tools/call) and flatten
result.content text into the tool result; JSON-RPC errors and
isError results surface as explicit "error: mcp ..." results,
and discovery failures emit thread/mcpFailed. Stated
divergences from CXU: sessions are per-call rather than
persistent connections, and the config is a JSON file rather
than [mcp_servers] TOML sections.

Verification (2026-10-25): scripts/mcpSmoke (offline harness
against fake_mcp.py) green — discover (2 tools recorded),
echo_text call, workspace_fact call, unknown-tool error.
Server build green. Live suite on the oaifree Responses wire:
every round green including the new MCP round
(mcp__fake__workspace_fact returned MCPWORD42 through the
bridge) — except the reasoning round, which missed on channel
variance all evening (see wall-list); the reasoning path is
unchanged since its v9/v10 green runs.

## v12 run_host stderr + spawn persistence (2026-10-25)

Two stated divergences closed:

1. run_host stderr (saVmTool.sla): the child now runs through
   a /bin/sh prelude ("exec 2>.runhost_err.tmp; exec $@") that
   redirects stderr to a scratch file, so a child flooding
   stderr can never block on a full pipe while the bridge
   drains stdout; argv is preserved verbatim (sh replaces
   itself via exec, exit code is the target's). After the
   child exits, the stderr TAIL (last 1500 bytes — diagnostics
   live at the end of a flood) is appended to the tool result
   after a "[stderr]" marker. Stdout draining is now unbounded
   (kept prefix still capped at 4000 bytes). Verified offline
   by scripts/vmSmoke: a child writing 200 KB to stderr
   completes, its tail surfaces, exit codes 0 and 3 propagate.
   The epoll surface in sa_std/term.sai could not be used for
   this — see wall-list.

2. spawn_agent child threads are persisted: the spawn branch
   now calls thread_save for the child thread right after its
   turn (thread/saveFailed is emitted on the parent stream if
   the save fails). This supersedes the v8 note that child
   threads were not persisted; the suite asserts the child
   thread file (threads/<parent>-sub-N.md) exists.

Live verification on the oaifree Responses wire (v12 build):
the full suite rounds page/text/tool/thread file/persistence/
find_files/run_host/read_skill/update_plan/token usage green,
then spawn_agent + spawn persist + MCP rounds green in the
tail run. The reasoning round missed again on relay variance;
the pipeline itself was re-verified the same evening with a
local capture double (a canned Responses stream containing a
reasoning summary delta produces item/reasoning/textDelta
through the bridge) — see wall-list for the full evidence.
