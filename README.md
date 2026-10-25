# slacxu — CXU rewritten in SLA/SA

CXU (Codex Ultra) reimplemented in SLA on the SA toolchain, behaviour-
aligned with the TypeScript original (codex-react-ui). Development is
demo-driven: each capability was first distilled into a standalone demo
in `sa_plugin_sla/demos/cxu/` (D1–D12, all landed 2026-10-25); this
repo is where those proven pieces become the real project.

## Phases (roadmap: sala 01_overview/08_cxu_rewrite_roadmap)

- **P1 — codex bridge pilot (current).** One CLI bridge as a vertical
  slice: an SLA process that spawns the agent CLI over bidirectional
  stdio, pumps JSON-RPC lines both ways, and serves the existing React
  frontend unmodified. Acceptance: a real codex CLI turn end-to-end.
- **P2 — remaining bridges + server surfaces** (config, sessions,
  static serving, free-key pool, VM tools — the D3–D11 surfaces).
- **P3 — frontend.** SAX grows into an application framework first;
  Monaco-class editing is its own sub-project. JS-island transitions
  are allowed but must be logged honestly.
- **P4 — desktop shell + release forms.**

## Ground rules

- Concurrency is threads + mpsc, never nested async/await (the SLA
  direct path does not support await across async-fn boundaries).
- No silent fallbacks: unsupported capability = explicit status.
- Foundational capability lives in sa_std (sci); this repo consumes
  it, never re-implements it.
- Push promptly; Colab runtimes expire.

## Layout

```
sa.mod                     workspace manifest
packages/
  cxu-bridge/              P1 pilot: stdio bridge to an agent CLI
    sa.mod
    src/main.sla           entry: CXU_AGENT_CMD selects the child
    src/bridge.sla         spawn/pump kernel (from demo D1)
    src/argv1.sa           argv fill macro
    fake_agent.sh          stand-in agent for offline runs
    run.sh                 build + smoke (cat echo + fake agent)
```

## Build & smoke

```sh
export PATH=<sci>/zig-out/bin:<sa_plugin_sla>/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1
cd packages/cxu-bridge && bash run.sh
```

The bridge child defaults to `/bin/cat` (echo smoke). Point
`CXU_AGENT_CMD` at a real agent CLI for the live slice; the command is
a single executable path in this slice (no argument splitting yet).

Slice 2 (landed): the pump is multi-round — stdin stays open while
replies are read line by line (two rounds, ids 1 and 2, per-round
framing checks; EOF mid-round is a hard failure).
Slice 3 (landed): child argument vectors — `CXU_AGENT_CMDLINE`
carries a full command line (space-tokenized, max 4 tokens, no
quoting), e.g. `CXU_AGENT_CMDLINE="/bin/cat -u"`; smoke covers all
three selection paths.
Slice 4 (landed): request lines are env-overridable — `CXU_REQ1` /
`CXU_REQ2` replace the default ping lines (newline appended when
missing), so protocol shapes need no recompile.

## Live codex round (ready to fire)

With a codex CLI installed and logged in on the build machine:

```sh
CXU_AGENT_CMDLINE="codex app-server --stdio" \
CXU_REQ1='{"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex-tui","title":"Codex TUI","version":"0.1.0"},"capabilities":{"experimentalApi":true,"mcpServerOpenaiFormElicitation":true}}}' \
CXU_REQ2='{"method":"initialized","params":{}}' \
./src/main
```

The two request lines are byte-for-byte the handshake the TS bridge
sends (extracted from apps/server codex bridge: spawn args
`app-server --stdio`, initialize params with the codex-tui clientInfo
and experimentalApi capability, then the `initialized`
notification). One protocol correction landed with the live run:
`initialized` is a notification and gets NO reply, so the bridge
gained a write-only step — `CXU_NOTIFY` is written after round 1
without a read (reading for it deadlocks the session).

**Live result (2026-10-25): PASS.** On the build machine, codex-cli
0.164.0 with a keyless custom provider (OpenCode Zen free channel,
`base_url = "https://opencode.ai/zen/v1"`, model `big-pickle`,
placeholder env key — no OpenAI login) answered initialize through
the SLA bridge (`userAgent: codex-tui/0.164.0`), accepted the
notification, and answered `thread/list`; the bridge printed
`cxu-bridge pump ok`, exit 0.

Slice 5 (landed): the chained turn phase. The receive path was
rebuilt around a persistent line buffer (bytes read past a newline
belong to the next line — agent CLIs emit notifications back to
back, and the per-round accumulator silently dropped them). When
`CXU_REQ3` is set, the bridge sends thread/start, reads until the
`"id":3` result, extracts the thread id after
`"thread":{"id":"`, splices it between `CXU_REQ4_PRE` /
`CXU_REQ4_POST` as turn/start, and reads the stream through
`turn/completed`. A protocol double (fake_codex.sh) completes the
turn only when the spliced id matches, and run.sh asserts the full
session round (`cxu-bridge turn ok`). Direct protocol recon
measured the live shapes: thread id at
`result.thread.id`; notifications thread/status/changed,
turn/started, item/started, item/completed.

**Live full turn (2026-10-25): PASS.** Channel correction: the
free channel that answers is the **Kilo gateway**
(`https://api.kilo.ai/api/gateway`, model `kilo-auto/free`,
keyless, serves both chat completions and the Responses API) —
not OpenCode Zen, whose free tier was exhausted from both egresses
at test time (FreeUsageLimitError; codex surfaced it as a 429 with
5 retries). With `model_provider = "kilo"` in
`~/.codex/config.toml` (placeholder env key, no login), the bridge
ran the whole session — initialize, initialized, thread/list,
thread/start, id extraction, turn/start, stream through
turn/completed — in ~11 s, exit 0. That is the P1 acceptance: a
real codex turn through the SLA backend.

## packages/mini-agent — Mini Agent, front and back (P2 focus)

The SLA rebuild of CXU's Mini Agent as one runnable service
(`packages/mini-agent/`, port 18086):

- **Backend** (`src/server.sla`): an SLA HTTP server. `GET /`
  serves the page; `POST /api/chat` with `{"prompt": "..."}`
  parses the JSON with std json, builds a chat-completions body
  (prompt JSON-escaped), calls the Kilo gateway free channel
  through the std SSE client (`sa_http_client_sse_*`, empty API
  key — the channel is keyless, and rejects bogus tokens), and
  relays the upstream SSE stream verbatim into a streamed
  response.
- **Frontend** (`www/index.html`): a single page that posts the
  prompt and renders streamed `delta.content` tokens live.

`run.sh` is the end-to-end check: build, serve, page contains
"Mini Agent", and a real prompt streams back `content:"ok"` plus
`[DONE]` — `mini-agent e2e ok`. v1 limits, stated plainly: one
request at a time (single-threaded accept loop), single-turn (no
history yet), no tool calls yet; the thread of work is making
this surface grow toward the TS Mini Agent's shape.
