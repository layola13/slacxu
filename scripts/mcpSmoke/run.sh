#!/bin/bash
# mcpSmoke: offline MCP client verification against fake_mcp.py.
set -u
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
cd "$(dirname "$0")"
cat > mcp.json <<'EOF'
{"servers":[{"name":"fake","cmdline":"python3 fake_mcp.py"}]}
EOF
export MINI_MCP_CONFIG="$PWD/mcp.json"
rm -f main main.sa main.sa.bc
timeout 600 sa build-exe main.sla || { echo "MCP SMOKE BUILD FAILED"; exit 1; }
export FAKE_MCP_LOG="$PWD/fake.log"
rm -f fake.log
timeout 60 ./main
RC=$?
if [ $RC -ne 0 ]; then echo "MCP SMOKE FAILED rc=$RC"; exit 1; fi
INIT_COUNT=$(grep -c "^initialize$" fake.log || true)
CALL_COUNT=$(grep -c "^tools/call$" fake.log || true)
if [ "$INIT_COUNT" != "1" ]; then echo "PERSIST FAILED (initialize x$INIT_COUNT, want 1)"; exit 1; fi
if [ "$CALL_COUNT" != "2" ]; then echo "PERSIST FAILED (tools/call x$CALL_COUNT, want 2)"; exit 1; fi
echo "mcp persistent ok"
cat > mcp.toml <<'EOF'
[mcp_servers.fake]
command = "python3"
args = ["fake_mcp.py"]
EOF
export MINI_MCP_CONFIG="$PWD/mcp.toml"
rm -f fake.log
timeout 60 ./main
RC=$?
if [ $RC -ne 0 ]; then echo "MCP TOML SMOKE FAILED rc=$RC"; exit 1; fi
INIT_COUNT=$(grep -c "^initialize$" fake.log || true)
CALL_COUNT=$(grep -c "^tools/call$" fake.log || true)
if [ "$INIT_COUNT" != "1" ]; then echo "TOML PERSIST FAILED (initialize x$INIT_COUNT, want 1)"; exit 1; fi
if [ "$CALL_COUNT" != "2" ]; then echo "TOML PERSIST FAILED (tools/call x$CALL_COUNT, want 2)"; exit 1; fi
echo "mcp toml ok"

cat > mcp.json <<'EOF'
{"servers":[{"name":"fake","cmdline":"python3 fake_mcp.py","disabled_tools":["workspace_fact"]}]}
EOF
export MINI_MCP_CONFIG="$PWD/mcp.json"
rm -f main3 main3.sa main3.sa.bc
timeout 600 sa build-exe main3.sla || { echo "MCP MAIN3 BUILD FAILED"; exit 1; }
export FAKE_MCP_PING=1
rm -f fake.log
timeout 60 ./main3
RC=$?
unset FAKE_MCP_PING
if [ $RC -ne 0 ]; then echo "MCP FILTER/PING SMOKE FAILED rc=$RC"; exit 1; fi
grep -q '^ping-reply ' fake.log || { echo "PING REPLY MISSING"; cat fake.log; exit 1; }
grep -q '"id":777' fake.log || { echo "PING REPLY WRONG ID"; cat fake.log; exit 1; }
grep -q '"result":{}' fake.log || { echo "PING REPLY WRONG RESULT"; cat fake.log; exit 1; }
echo "mcp filters+ping ok"
