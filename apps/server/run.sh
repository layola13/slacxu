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

OUT5=$(timeout 180 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Find files with bridge in the name under the current directory using the find_files tool, then tell me one path you found.","threadId":"t-find"}')
echo "$OUT5" | grep -q '"action":"find_files"' || { echo "FIND TURN FAILED (no find_files)"; echo "$OUT5" | tail -3; exit 1; }
echo "$OUT5" | grep -q 'mini_bridge' || { echo "FIND TURN FAILED (no mini_bridge path)"; echo "$OUT5" | tail -3; exit 1; }
echo "$OUT5" | grep -q '"method":"turn/completed"' || { echo "FIND TURN FAILED (no turn/completed)"; echo "$OUT5" | tail -3; exit 1; }
echo "mini-agent find_files ok"

OUT6=$(timeout 180 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Use the run_host tool to run /bin/pwd with no arguments, then tell me exactly what it printed.","threadId":"t-exec"}')
echo "$OUT6" | grep -q '"action":"run_host"' || { echo "EXEC TURN FAILED (no run_host)"; echo "$OUT6" | tail -3; exit 1; }
echo "$OUT6" | grep -q 'apps/server' || { echo "EXEC TURN FAILED (no cwd in output)"; echo "$OUT6" | tail -3; exit 1; }
echo "$OUT6" | grep -q '"method":"turn/completed"' || { echo "EXEC TURN FAILED (no turn/completed)"; echo "$OUT6" | tail -3; exit 1; }
echo "mini-agent run_host ok"

mkdir -p .claude/skills/demo
printf 'DEMO SKILL BODY: always answer in haiku form.\n' > .claude/skills/demo/SKILL.md
OUT7=$(timeout 180 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Read the demo skill with the read_skill tool and tell me what the skill body says.","threadId":"t-skill"}')
rm -rf .claude
echo "$OUT7" | grep -q '"name":"read_skill"' || { echo "SKILL TURN FAILED (no read_skill)"; echo "$OUT7" | tail -3; exit 1; }
echo "$OUT7" | grep -qi 'haiku' || { echo "SKILL TURN FAILED (no haiku)"; echo "$OUT7" | tail -3; exit 1; }
echo "$OUT7" | grep -q '"method":"turn/completed"' || { echo "SKILL TURN FAILED (no turn/completed)"; echo "$OUT7" | tail -3; exit 1; }
echo "mini-agent read_skill ok"

OUT8=$(timeout 180 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"First call update_plan with a 2-step plan: step 1 list the files here, step 2 summarize them. Then do step 1 with the list_dir tool and give a one-line summary.","threadId":"t-plan"}')
echo "$OUT8" | grep -q '"method":"turn/plan/updated"' || { echo "PLAN TURN FAILED (no plan event)"; echo "$OUT8" | tail -3; exit 1; }
echo "$OUT8" | grep -q '"step"' || { echo "PLAN TURN FAILED (no steps)"; echo "$OUT8" | tail -3; exit 1; }
echo "$OUT8" | grep -q '"action":"list_dir"' || { echo "PLAN TURN FAILED (plan not executed)"; echo "$OUT8" | tail -3; exit 1; }
echo "$OUT8" | grep -q '"method":"turn/completed"' || { echo "PLAN TURN FAILED (no turn/completed)"; echo "$OUT8" | tail -3; exit 1; }
echo "mini-agent update_plan ok"

# usage round reuses the t-text thread output shape: a fresh text
# turn must carry thread/tokenUsage/updated with real numbers.
OUT9=$(timeout 120 curl -sN -X POST http://127.0.0.1:18086/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Reply with exactly: ok","threadId":"t-usage"}')
echo "$OUT9" | grep -q '"method":"thread/tokenUsage/updated"' || { echo "USAGE TURN FAILED (no usage event)"; echo "$OUT9" | tail -3; exit 1; }
echo "$OUT9" | grep -qE '"inputTokens":[1-9]' || { echo "USAGE TURN FAILED (no input tokens)"; echo "$OUT9" | tail -3; exit 1; }
echo "mini-agent token usage ok"
echo "mini-agent e2e ok"
