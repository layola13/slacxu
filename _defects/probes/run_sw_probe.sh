#!/bin/bash
# sw_probe runner: scratch workspace + tiny TS source, cwd = workspace.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source /content/sa_all/env.sh
export SA_STD_DIR=/content/sa_all/sci/sa_std SLA_NO_FRESHNESS_CACHE=1
cd "$ROOT"
rm -rf .sla-cache apps/server/src/.sla-cache _defects/probes/.sla-cache
timeout 600 sa build-exe _defects/probes/sw_probe.sla -o /tmp/sw_probe_exe > /tmp/sw_build.log 2>&1
echo "BUILD_RC=$?"
tail -3 /tmp/sw_build.log
WS=/tmp/sw_ws
rm -rf "$WS"; mkdir -p "$WS/src"
printf 'export function alpha(x: number): number {\n  return x + 1;\n}\n' > "$WS/src/a.ts"
cd "$WS"
timeout 120 /tmp/sw_probe_exe; echo "PROBE_RC=$?"
