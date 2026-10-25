# @codex-ui/shared

Internal shared types and helpers for the Codex Ultra monorepo, consumed by the server, web UI, and protocol layers.

## Contents

- `src/index.ts` — JSON-RPC message shapes, engine lifecycle (`EnginePhase`, `EngineStatus`), and the shared workbench contracts used across apps.
- `src/agentEngines.ts` — multi-engine agent catalog (`codex`, `claude`, `agy`, `gemini`, `crush`, `auggie`, `grok`, `freebuff`, `coderabbit`, `pi`, `opencode`): engine IDs, transport protocols, and the capability matrix (history list, transcript read, and future multi-agent chat runtime flags).
- `src/modelCapabilities.ts` — model capability descriptors shared by relay configuration and the model picker.
- `src/tokenUsage.ts` / `src/tokenPricing.ts` — token-usage normalization plus pricing/billing helpers behind the usage & billing UI.

## Usage

This package is private (`"private": true`) and consumed through the monorepo workspaces. It is never published to npm.

```bash
bun --filter @codex-ui/shared build
bun --filter @codex-ui/shared typecheck
```

`bun run dev` / `bun run build` at the repo root always build this package first (`predev` / `build`), so the server and web apps resolve fresh shared types.
