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
| miniBridge.ts (turn loop) | src/mini_bridge.sla | v2: loop + items + sa_vm subset |
| relay gateway (chat, stream) | Kilo gateway free channel via std sse_turn / sse stream | done (v1 relay proven) |
| saVmTool.ts (sa_vm actions) | src/sa_vm.sla — list_dir, read_file first | v2 |
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
