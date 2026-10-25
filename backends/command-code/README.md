# cxu-backend-command-code

Server-side plugin project for the `command-code` backend (Command Code
CLI). Implements `@cxu/sdk-backend`. Its frontend pair is
`cxu-frontend-command-code`. Runtime plugin id stays `command-code`.

Command Code is an EXTERNAL CLI backend like the others — nothing is
embedded (only Mini Agent is embedded). The bridge in `src/runtime/`
spawns the user's own `command-code` binary once per turn in print mode
(`-p --output-format json`) and projects the NDJSON AgentEvent stream
(text_delta, tool_use/tool_result, the final result line) onto the
workbench runtime surface. Binary discovery uses `command-code` only —
never the bare `cmd` alias (cmd.exe on Windows).

No-login relay operation (verified live against command-code 1.88.0):

- The child runs with `HOME=<app data dir>/command-code`, so providers,
  sessions and MCP config are isolated from the user's real
  `~/.commandcode`.
- `COMMAND_CODE_API_KEY` is set to a placeholder: its presence satisfies
  the CLI's headless auth gate, `--local-only` guarantees no Command Code
  account traffic, and model calls go to the BYOK provider registered in
  `<home>/.commandcode/providers.json` by `commandCodeProviders.ts` —
  pointing at the loopback relay gateway, with its apiKey stored as an
  env reference (raw secrets are rejected by the CLI's config parser)
  to a placeholder the gateway ignores.
- Sessions persist as transcripts under
  `<home>/.commandcode/projects/<slug>/<sessionId>.jsonl`; a small
  mapping store (`cxu-threads.json`) ties workbench thread ids to CLI
  session ids for resume (`--resume`) and history.
- MCP / VM tool / JEV: project `.mcp.json` is read natively (the generic
  project bundle sync covers it), and the host upserts sa-vm (+jev) into
  the user-scope `<home>/.commandcode/mcp.json`. Skills root is
  `.commandcode/skills`.
