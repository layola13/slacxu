#!/bin/bash
# mini-agent (apps/server) end-to-end check, v3 (CXU shape):
#   1. page served from apps/web
#   2. text turn (item events, completes with "ok")
#   3. tool turn (sa_vm list_dir toolCall, grounded summary)
#   4. persistence: a code word stored in thread t-persist must
#      survive a server restart (file-per-thread history) and be
#      recalled by the model from the restored history.
set -u
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
cd "$(dirname "$0")"

rm -f src/main src/main.sa src/main.sa.bc
timeout 600 sa build-exe src/main.sla || { echo "MINI BUILD FAILED"; exit 1; }
rm -rf threads

SRV_PID=""
start_server() {
  ./src/main & SRV_PID=$!
  curl -s --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:18086/ > /dev/null || { echo "SERVER START FAILED"; exit 1; }
}
stop_server() {
  [ -n "$SRV_PID" ] && kill $SRV_PID 2>/dev/null
  SRV_PID=""
}
trap stop_server EXIT

start_server
PAGE=$(curl -s http://127.0.0.1:18086/)
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
echo "$OUT2" | grep -q '"action":"list_dir"' || { echo "TOOL TURN FAILED (no list_dir)"; echo "$OUT2" | tail -3; exit 1; }
echo "$OUT2" | grep -q '"method":"turn/completed"' || { echo "TOOL TURN FAILED (no turn/completed)"; echo "$OUT2" | tail -3; exit 1; }
echo "mini-agent tool turn ok"

OUT3=$(timeout 120 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Remember this code word: BANANA42. Reply with exactly: stored","threadId":"t-persist"}')
echo "$OUT3" | grep -q '"method":"turn/completed"' || { echo "PERSIST TURN 1 FAILED"; echo "$OUT3" | tail -3; exit 1; }
[ -f threads/t-persist.md ] || { echo "PERSIST FAILED (no thread file)"; exit 1; }
grep -q "BANANA42" threads/t-persist.md || { echo "PERSIST FAILED (code word not in file)"; exit 1; }
echo "mini-agent thread file ok"

stop_server
sleep 1
start_server
OUT4=$(timeout 120 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What code word did I ask you to remember earlier? Reply with exactly the code word and nothing else.","threadId":"t-persist"}')
echo "$OUT4" | grep -q '"text":"BANANA42"' || { echo "PERSIST RECALL FAILED"; echo "$OUT4" | tail -3; exit 1; }
echo "mini-agent persistence recall ok"
echo "mini-agent e2e ok"
