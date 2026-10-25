#!/bin/bash
# mini-agent (apps/server) end-to-end check, v2 (CXU shape):
# build the SLA server, serve the waterfall page from apps/web,
# then drive two real turns through the bridge:
#   1. a text turn (streams item events, completes with "ok")
#   2. a tool turn (sa_vm list_dir toolCall item, then completes)
set -u
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
cd "$(dirname "$0")"

rm -f src/main src/main.sa src/main.sa.bc
timeout 600 sa build-exe src/main.sla || { echo "MINI BUILD FAILED"; exit 1; }

./src/main & SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null' EXIT

PAGE=$(curl -s --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:18086/)
echo "$PAGE" | grep -q "Mini Agent" || { echo "PAGE CHECK FAILED"; exit 1; }
echo "mini-agent page ok"

OUT1=$(timeout 120 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Reply with exactly: ok","threadId":"t-text"}')
echo "$OUT1" | grep -q '"method":"turn/completed"' || { echo "TEXT TURN FAILED (no turn/completed)"; echo "$OUT1" | tail -3; exit 1; }
echo "$OUT1" | grep -q '"text":"ok"' || { echo "TEXT TURN FAILED (no ok text)"; echo "$OUT1" | tail -3; exit 1; }
echo "mini-agent text turn ok"

OUT2=$(timeout 180 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"List the files in the current directory using the sa_vm tool, then tell me one entry you found.","threadId":"t-tool"}')
echo "$OUT2" | grep -q '"type":"toolCall"' || { echo "TOOL TURN FAILED (no toolCall item)"; echo "$OUT2" | tail -3; exit 1; }
echo "$OUT2" | grep -q '"action":"list_dir"' || { echo "TOOL TURN FAILED (no list_dir)"; echo "$OUT2" | tail -3; exit 1; }
echo "$OUT2" | grep -q '"method":"turn/completed"' || { echo "TOOL TURN FAILED (no turn/completed)"; echo "$OUT2" | tail -3; exit 1; }
echo "mini-agent tool turn ok"
echo "mini-agent e2e ok"
