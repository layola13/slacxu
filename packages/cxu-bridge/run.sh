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
echo "cxu-bridge smoke ok"
