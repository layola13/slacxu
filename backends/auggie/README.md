# cxu-backend-auggie

Server-side plugin project for the `auggie` backend (Augment Code CLI,
ACP transport). Implements `@cxu/sdk-backend`. Its frontend pair is
`cxu-frontend-auggie`. Runtime plugin id stays `auggie`.

Reopened 2026-10-24: the runtime cluster under `src/runtime/` was ported
from the pre-refactor host implementation (formerly
`apps/server/src/auggie*.ts` on the `auggie` branch). Auggie is an
EXTERNAL CLI backend like the others — the bridge spawns the user's own
`auggie` binary (npm `@augmentcode/auggie`); nothing is vendored or
embedded (only Mini Agent is embedded). The redirector in
`src/runtime/auggieRedirector.ts` is the loopback Augment-compatible
proxy the CLI is pointed at for relay stations; it also serves the
platform MCP servers (sa-vm / jev) and enforces indexing-disabled by
default.
