# @codex-ultra/cxu

One-command launcher for the **Codex Ultra** workbench: locally-compiled server + web UI. `cxu` starts it all.

Codex Ultra is a local-first workbench for Codex CLI (backed by `codex app-server`): React + MUI three-column UI (history, chat, composer, config/tools/files inspector), third-party relay channels, membership with per-member relay whitelists, usage & billing, sidechat tabs, SSH workspaces, real Codex slash commands (`/review`, `/compact`, `/resume`, `/model`, `/skills`, `/plugins`, `/mcp`, …), theme plugins, and an Electron desktop shell. This package ships the server binary (per-platform optional packages) together with the built web UI and starts them with a single command.

## Install

```bash
npm i -g @codex-ultra/cxu
```

Requires Node `>=18` and Bun `>=1.1`. No prebuilt binaries to download: `cxu` compiles the server for your machine with your local Bun on first run (one-time per version, cached under `~/.cxu/server/`).

## Quick start

```bash
cxu
# open http://127.0.0.1:43110/
```

The first run inspects your machine, offers to install what's missing, compiles the server locally if needed, then starts the workbench. No separate `cxu doctor` call needed.

```bash
cxu serve --port 43110 --data-dir ~/.codex-ultra
cxu --help
cxu --version
```

## Environment doctor

```bash
cxu doctor
```

Checks Bun plus the `codex` / `claude` / `agy` / `grok` / `pi` / `opencode` CLIs. `codex` is REQUIRED; the rest are optional (Bun is only needed for TypeScript-track execution). For Codex the doctor also verifies the managed standalone daemon (`~/.codex/packages/standalone/current/`) that the workbench app-server boots from — an npm-only Codex install is flagged with a `⚠` plus the official installer command. Missing tools print their official install command, and on a TTY you get an interactive prompt:

- `[a]` auto-install every missing tool with an official installer
- `[s]` skip and start the workbench (default)
- `[m]` show manual installation commands

```bash
cxu doctor --yes   # non-interactive one-click install (CI-friendly)
cxu doctor --no-prompt
```

Exit code is `2` when Codex CLI is absent.

```bash
cxu install [tool]        # print install command only, changes nothing
cxu install [tool] --yes  # run the official installer
cxu install --all --yes   # one-click: install every missing tool
```

## Library: file + AST toolkit

The same package is importable as a pure-TypeScript toolkit (runs on plain Node.js, zero embedded binaries):

- Single-step tools: `read_file`, `edit_file`, `grep_search`, `apply_patch`, `find_files`, `file_outline`, `find_definition`, `find_references`, `rename_symbol`, and 20+ more.
- AST via portable WebAssembly (`web-tree-sitter` + `tree-sitter-wasms`): TypeScript, TSX, JavaScript, Python, Rust, Go, Zig, JSON, TOML, YAML, Bash. `c` / `cpp` / `java` / `c_sharp` fall back to the built-in regex outline with the same output shape.
- Complex TypeScript tracks (`run_bun`) detect Bun on demand and print a cross-platform install hint instead of crashing.

Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1 | iex"`
macOS / Linux: `curl -fsSL https://bun.sh/install | bash`
Other: use your system package manager, or see https://bun.sh

## Platform support

Windows / Linux / macOS (Intel + Apple Silicon / ARM). The server is compiled on your machine with your local Bun (`bun build --compile`, current platform), so there are no per-platform packages to download; the file/AST library itself is pure TypeScript + `.wasm` and works everywhere Node `>=18` runs.

## Build / publish check (maintainers)

```bash
npm --workspace @codex-ultra/cxu run vendor
npm --workspace @codex-ultra/cxu run build
npm pack --dry-run --workspace @codex-ultra/cxu
```

`scripts/build.mjs` prefers `bun build --minify` (target node, ESM) and falls back to esbuild with `minify: true` when Bun is absent. `prepack` runs build and then `scripts/obfuscate.mjs`, so publishing ships a minified + obfuscated bundle.

Only `dist/` (+ `.d.ts`), `wasm/`, `web-dist/`, `server-bundle/` (the pre-bundled server JS compiled locally on first run), `README.md`, `LICENSE` ship. No `.exe` / `.dll` / `.so` / `.dylib`, no prebuilt binaries.

## Links

- Repository: https://github.com/layola13/codex-ultra
- Issues: https://github.com/layola13/codex-ultra/issues
