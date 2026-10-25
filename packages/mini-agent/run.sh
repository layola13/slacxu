#!/bin/bash
# mini-agent end-to-end check: build the SLA server, serve the
# page, and stream one real chat round-trip through the Kilo free
# channel.
set -u
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
cd "$(dirname "$0")"

rm -f src/server src/server.sa src/server.sa.bc
timeout 600 sa build-exe src/server.sla || { echo "MINI BUILD FAILED"; exit 1; }

./src/server & SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null' EXIT

PAGE=$(curl -s --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:18086/)
echo "$PAGE" | grep -q "Mini Agent" || { echo "PAGE CHECK FAILED"; exit 1; }
echo "mini-agent page ok"

OUT=$(timeout 120 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Reply with exactly: ok"}')
echo "$OUT" | grep -q '\[DONE\]' || { echo "STREAM CHECK FAILED (no DONE)"; echo "$OUT" | tail -3; exit 1; }
echo "$OUT" | grep -q '"content":"ok"' || { echo "STREAM CHECK FAILED (no ok content)"; echo "$OUT" | tail -3; exit 1; }
echo "mini-agent chat ok"
echo "mini-agent e2e ok"
