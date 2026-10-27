#!/bin/bash
# fa_probe runner: builds the probe with the host verb and runs it.
set -u
cd "$(dirname "$0")/../.."
source /content/sa_all/env.sh
export SA_STD_DIR=/content/sa_all/sci/sa_std SLA_NO_FRESHNESS_CACHE=1
rm -rf .sla-cache apps/server/src/.sla-cache _defects/probes/.sla-cache
timeout 600 sa build-exe _defects/probes/fa_probe.sla -o /tmp/fa_probe_exe > /tmp/fa_build.log 2>&1
echo "BUILD_RC=$?"
tail -3 /tmp/fa_build.log
timeout 120 /tmp/fa_probe_exe; echo "PROBE_RC=$?"
