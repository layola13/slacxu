#!/bin/bash
# planSmoke: offline proof of the CXU 0.1.10 termination rule
# + plan persistence. The scripted double answers:
#   1 update_plan (steps unfinished)  2 text "stopping here"
#   3 update_plan (all completed)    4 text "all done"
# A correct bridge issues all four requests (the premature
# text round is nudged, not completed), completes exactly
# once, and persists the final plan in the thread file.
set -u
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/apps/server" || exit 1
rm -f src/index src/index.sa src/index.sa.bc
timeout 600 sa build-exe src/index.sla >/dev/null 2>&1 || { echo "server build failed"; exit 1; }
WORK=$(mktemp -d)
cd "$WORK" || exit 1
python3 "$ROOT/scripts/planSmoke/double.py" &
DOUBLE_PID=$!
MINI_WIRE_API=responses MINI_RELAY_URL=http://127.0.0.1:19093/v1/responses \
  MINI_RELAY_KEY= MINI_MODEL=planmock MINI_MCP_CONFIG=/nonexistent/mcp.json \
  MINI_HISTORY_DIR="$WORK/threads" "$ROOT/apps/server/src/index" &
SERVER_PID=$!
cleanup() { kill $DOUBLE_PID $SERVER_PID 2>/dev/null; }
trap cleanup EXIT
sleep 1
(exec 3<>/dev/tcp/127.0.0.1/18086) 2>/dev/null || { echo "server did not start"; exit 1; }
curl -s -N --max-time 60 -X POST http://127.0.0.1:18086/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"t-plan","prompt":"make a plan and do it"}' > stream.txt
COUNT=$(cat plan_requests.count 2>/dev/null || echo 0)
[ "$COUNT" = "4" ] || { echo "expected 4 upstream requests, got $COUNT"; cat stream.txt; exit 1; }
grep -q "all done" stream.txt || { echo "final text missing"; cat stream.txt; exit 1; }
[ "$(grep -c 'turn/completed' stream.txt)" = "1" ] || { echo "turn must complete exactly once"; cat stream.txt; exit 1; }
[ "$(grep -c 'turn/plan/updated' stream.txt)" = "2" ] || { echo "expected 2 plan updates"; cat stream.txt; exit 1; }
grep -q "mini-plan-begin" "$WORK/threads/t-plan.md" || { echo "plan not persisted"; exit 1; }
grep -qE '"status": ?"completed"' "$WORK/threads/t-plan.md" || { echo "final plan not persisted"; exit 1; }
echo "plan smoke ok"
