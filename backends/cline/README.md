# cxu-backend-cline

Server-side plugin project for the `cline` backend (Cline CLI). Implements
`@cxu/sdk-backend`. Its frontend pair is `cxu-frontend-cline`. Runtime
plugin id stays `cline`.

Cline is an EXTERNAL CLI backend like the others — nothing is embedded
(only Mini Agent is embedded). It is also NOT driven over ACP (user
decision 2026-10-24: ACP is too restrictive, and its session gate demands
a vendor login). Instead the bridge in `src/runtime/` speaks the Cline
CLI's own hub protocol, reverse-engineered from the cline 3.0.73 binary
and verified live against it:

- `clineHubClient.ts` — starts/reuses the detached hub daemon
  (`cline hub start`, state pinned by CLINE_DATA_DIR + a discovery file),
  connects over WebSocket with subprotocol auth, runs commands
  (client.register, session.create/get/list/messages/delete,
  run.enqueue, session.abort) and streams events.
- `clineAgentBridge.ts` — projects hub events (assistant.delta,
  run.completed/failed/aborted) onto the workbench runtime surface.
  Sessions select their provider/model through create metadata; turns
  run with autoApproveTools=true, the CLI's own headless posture.
- `clineProviders.ts` — relay stations are written into the data dir's
  `settings/providers.json` as OpenAI-compatible BYOK entries pointing at
  the loopback relay gateway, so cline threads work with NO Cline
  account login. The same settings dir carries
  `cline_mcp_settings.json`, which the host upserts the platform MCP
  servers (sa-vm / jev) into.
- `clineCommand.ts` — external binary discovery (preferred install →
  CLINE_BIN / CODEX_UI_CLINE_BIN → PATH) + version probe.
