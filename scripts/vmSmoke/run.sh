#!/bin/bash
# Offline smoke for sa_vm run_host: a child flooding stderr
# (200 KB, far beyond the 64 KB pipe buffer) must not deadlock,
# its stderr tail must surface in the result, and exit codes
# must propagate through the /bin/sh exec prelude.
set -u
export PATH=/content/sa_all/sci/zig-out/bin:/content/sa_all/sa_plugin_sla/zig-out/bin:$PATH
export SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1
cd "$(dirname "$0")"
rm -f main main.sa main.sa.bc
timeout 600 sa build-exe main.sla || { echo "VM SMOKE BUILD FAILED"; exit 1; }
timeout 60 ./main
