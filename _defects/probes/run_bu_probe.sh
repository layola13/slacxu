#!/bin/bash
# bu_probe runner (Agent AD3): fake HOME + fake claude CLI + PWD workspace.
set -u
WORK=/tmp/bu_probe_ws
HOME_DIR=/tmp/bu_probe_home
rm -rf "$WORK" "$HOME_DIR" /tmp/bu_probe_out
mkdir -p "$WORK/scripts" "$WORK/bin" "$WORK/proj" "$HOME_DIR/.gemini" /tmp/bu_probe_out
printf 'SCRIPT-CONTENT-V6\n' > "$WORK/scripts/sa-vm-mcp.mjs"
printf 'PI-EXT-CONTENT\n' > "$WORK/scripts/sa-vm-pi-extension.ts"
printf '{}' > "$HOME_DIR/.gemini/settings.json"
cat > "$WORK/bin/claude" <<'EOS'
#!/bin/bash
if [ "${1:-}" = "mcp" ] && [ "${2:-}" = "get" ]; then
  if [ -f "$BU_CLAUDE_STATE" ] && grep -q present "$BU_CLAUDE_STATE"; then
    printf 'sa-vm\nScope: User config\nCommand: node\nArgs: %s\n' "$BU_EXPECT_SCRIPT"
    exit 0
  fi
  echo "not found" >&2
  exit 1
fi
if [ "${1:-}" = "mcp" ] && [ "${2:-}" = "add" ]; then
  echo present > "$BU_CLAUDE_STATE"
  echo "$@" >> "$BU_CLAUDE_LOG"
  exit 0
fi
if [ "${1:-}" = "mcp" ] && [ "${2:-}" = "remove" ]; then
  echo absent > "$BU_CLAUDE_STATE"
  exit 0
fi
exit 1
EOS
chmod +x "$WORK/bin/claude"
SRC=/content/bulk-launch/_defects/probes/bu_probe.sla
BIN=/tmp/bu_probe_out/bu_probe
source /content/sa_all/env.sh
export SA_STD_DIR=/content/sa_all/sci/sa_std SLA_NO_FRESHNESS_CACHE=1
cd /content/bulk-launch && rm -rf .sla-cache
timeout 600 sa build-exe "$SRC" -o "$BIN" > /tmp/bu_probe_out/build.log 2>&1
echo "BUILD_RC=$?"
[ -x "$BIN" ] || { tail -5 /tmp/bu_probe_out/build.log; exit 1; }
cd "$WORK"
export PROBE_WS="$WORK" HOME="$HOME_DIR" PATH="$WORK/bin:$PATH"
export BU_CLAUDE_STATE="$WORK/claude_state" BU_CLAUDE_LOG="$WORK/claude_add.log"
export BU_EXPECT_SCRIPT="$WORK/gtarget/sa-vm-mcp.mjs"
rm -f "$BU_CLAUDE_STATE"
echo "-- mode A (JEV off) --"
timeout 120 "$BIN"; echo "RUN_A_RC=$?"
echo "-- mode B (JEV on) --"
BU_MODE=b JEV_MCP_ENABLED=1 timeout 120 "$BIN"; echo "RUN_B_RC=$?"
