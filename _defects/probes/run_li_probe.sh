#!/bin/bash
# li_probe_nj runner (steps 1-6): generates li_lib_nj.sla from the
# CURRENT launchInstall.sla with only the jobs family stubbed (the full
# build traps in the SAB flattener at createInstallJob's thread::spawn
# closure emission — see FIX_SERVER_LAUNCH.md) and runs the probe:
# spec table, parseEnvFile/isPlaceholder, detectAll, writeAdapterEnv,
# testOpenAiApi against li_stub.py, installLaunchAdapters end-to-end.
set -e
cd /content/bulk-launch
python3 _defects/probes/stubgen3.py apps/server/src/launchInstall.sla li_jobsdoc,li_stashdoc,li_rand64,li_uuid,li_opts_json,li_opts_from_json,li_job_drive,createInstallJob,getInstallJob _defects/probes/li_lib_nj.sla
sed -i 's|@import "cliVersions.sla"|@import "../../apps/server/src/cliVersions.sla"|' _defects/probes/li_lib_nj.sla
rm -rf /tmp/li_home /tmp/li_bin /tmp/li_src
mkdir -p /tmp/li_home/.config/claude-launch /tmp/li_bin /tmp/li_src/claude-launch
printf 'CLAUDE_LAUNCH_API_KEY=sk-probe\nCLAUDE_LAUNCH_BASE_URL=https://probe.example\n' > /tmp/li_home/.config/claude-launch/.env
printf '#!/bin/sh\nexit 0\n' > /tmp/li_bin/agy
printf '#!/bin/sh\nexit 0\n' > /tmp/li_bin/agy-launch
chmod +x /tmp/li_bin/agy /tmp/li_bin/agy-launch
printf '#!/bin/sh\nexit 0\n' > /tmp/li_src/claude-launch/install.sh
chmod +x /tmp/li_src/claude-launch/install.sh
python3 _defects/probes/li_stub.py &
STUB=$!
sleep 1
source /content/sa_all/env.sh
export SA_STD_DIR=/content/sa_all/sci/sa_std SLA_NO_FRESHNESS_CACHE=1
rm -rf .sla-cache
rm -f _defects/probes/li_probe_nj.sa
timeout 240 sa build-exe _defects/probes/li_probe_nj.sla -o /tmp/li_probe_nj_exe
set +e
HOME=/tmp/li_home PATH=/tmp/li_bin:$PATH timeout 120 /tmp/li_probe_nj_exe; RC=$?
kill $STUB 2>/dev/null || true
echo "NJ_PROBE_RC=$RC"
