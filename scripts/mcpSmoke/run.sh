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
timeout 60 ./main
