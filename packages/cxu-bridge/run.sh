#!/usr/bin/env bash
# cxu-bridge smoke: build the bridge, run one pump round against
# /bin/cat (echo) and one against the stand-in agent (fixed reply).
set -u
cd "$(dirname "$0")"
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:/tools/node/bin:$PATH
export SA_PLUGIN_DEV=1

rm -f src/main src/main.sa src/main.sa.bc
timeout 300 sa build-exe src/main.sla || { echo "BRIDGE BUILD FAILED"; exit 1; }
# build-exe places the binary next to the source file.
[ -x ./src/main ] || { echo "BRIDGE BINARY MISSING"; ls src; exit 1; }

timeout 30 ./src/main || { echo "CAT ROUND FAILED rc=$?"; exit 1; }
CXU_AGENT_CMD="$PWD/fake_agent.sh" timeout 30 ./src/main || { echo "AGENT ROUND FAILED rc=$?"; exit 1; }
CXU_AGENT_CMDLINE="/bin/cat -u" timeout 30 ./src/main || { echo "CMDLINE ROUND FAILED rc=$?"; exit 1; }
# Codex app-server handshake shapes (extracted from the TS bridge):
# spawn `codex app-server --stdio`, send initialize, then the
# initialized notification. Echoed through cat here; the same env
# lines drive the live codex round unchanged.
CXU_AGENT_CMDLINE="/bin/cat -u" \
CXU_REQ1='{"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex-tui","title":"Codex TUI","version":"0.1.0"},"capabilities":{"experimentalApi":true,"mcpServerOpenaiFormElicitation":true}}}' \
CXU_REQ2='{"method":"initialized","params":{}}' \
timeout 30 ./src/main || { echo "CODEX SHAPE ROUND FAILED rc=$?"; exit 1; }
echo "cxu-bridge smoke ok"
