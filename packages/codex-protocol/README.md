# @codex-ui/codex-protocol

Internal TypeScript types for the Codex `app-server` protocol, shared by `@codex-ui/server` and `@codex-ui/web`.

## Contents

- `src/generated/` — protocol types generated from the Codex schema: client info, initialize, threads (`ThreadStart`, `ThreadList`), turns (`TurnStart`, user input), account, model list, server notifications/requests, plus the full `v2` surface (tools, approvals, MCP servers, fuzzy file search, realtime, settings, conversation summaries, …).
- `src/index.ts` — curated re-exports of the request/response/notification shapes the workbench actually speaks.

## Usage

This package is private (`"private": true`) and consumed through the monorepo workspaces. It is never published to npm.

```bash
bun --filter @codex-ui/codex-protocol build
bun --filter @codex-ui/codex-protocol typecheck
```

When the upstream Codex schema changes, regenerate `src/generated/` and run `typecheck` to catch breaking shapes before touching the server or web app.
