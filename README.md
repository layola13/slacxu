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
three selection paths. Next: the live codex round (needs a codex
CLI install + login on the build machine).
