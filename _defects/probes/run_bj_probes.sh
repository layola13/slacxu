#!/bin/bash
# run_bj_probes.sh — build + run the BJ pluginHost/B3 wiring probes.
# Usage (on the box, from the slacxu tree root):
#   bash _defects/probes/run_bj_probes.sh
# Expects env.sh sourced (sa on PATH) and SA_STD_DIR set. Success = the
# script ends with BJ_PROBES_ALL_OK.
set -u
cd "$(dirname "$0")/../.." || exit 1
export SA_PLUGIN_DEV=1
export SLA_NO_FRESHNESS_CACHE=1
: "${SA_STD_DIR:=/content/sa_all/sci/sa_std}"
export SA_STD_DIR

rm -rf .sla-cache
FAIL=0

echo "[probe] build bj_probe"
timeout 300 sa build-exe _defects/probes/bj_probe.sla -o /tmp/bj_probe 2>&1 | tail -2
if [ ! -x /tmp/bj_probe ]; then echo "BJ_PROBE_BUILD_FAIL"; exit 1; fi
rm -f _defects/probes/bj_probe.sa

echo "[probe] build bj_b3_probe"
timeout 300 sa build-exe _defects/probes/bj_b3_probe.sla -o /tmp/bj_b3_probe 2>&1 | tail -2
if [ ! -x /tmp/bj_b3_probe ]; then echo "BJ_B3_PROBE_BUILD_FAIL"; exit 1; fi
rm -f _defects/probes/bj_b3_probe.sa

SCRATCH="$(mktemp -d /tmp/bj-scratch.XXXXXX)"
echo "[probe] bj_probe scratch=$SCRATCH"
BJ_SCRATCH="$SCRATCH" /tmp/bj_probe || FAIL=1

echo "[probe] bj_b3_probe mode=unset"
env -u CODEX_UI_CODEX_COMPATIBLE_CLI_ENABLED -u CODEX_UI_AGY_COMPATIBLE_CLI_ENABLED \
    BJ_B3_MODE=unset /tmp/bj_b3_probe || FAIL=1

echo "[probe] bj_b3_probe mode=set"
env -u CODEX_UI_AGY_COMPATIBLE_CLI_ENABLED -u CODEX_UI_CLINE_COMPATIBLE_CLI_ENABLED \
    CODEX_UI_CODEX_COMPATIBLE_CLI_ENABLED=1 BJ_B3_MODE=set /tmp/bj_b3_probe || FAIL=1

echo "[probe] bj_b3_probe mode=yes"
env -u CODEX_UI_CODEX_COMPATIBLE_CLI_ENABLED -u CODEX_UI_GROK_COMPATIBLE_CLI_ENABLED \
    CODEX_UI_AGY_COMPATIBLE_CLI_ENABLED=yes BJ_B3_MODE=yes /tmp/bj_b3_probe || FAIL=1

if [ "$FAIL" = 0 ]; then echo "BJ_PROBES_ALL_OK"; else echo "BJ_PROBES_FAILED"; exit 1; fi
