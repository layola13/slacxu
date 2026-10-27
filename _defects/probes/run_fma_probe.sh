#!/bin/bash
# run_fma_probe.sh — build + run the freeModelAccess probe in 4 env modes.
# Usage (on the box, from the bulk-launch tree root):
#   bash _defects/probes/run_fma_probe.sh
# Expects env.sh sourced (sa on PATH) and SA_STD_DIR set. Prints per-mode
# markers; success = every mode prints FMA_PROBE_OK and the script ends
# with FMA_PROBE_ALL_OK.
set -u
cd "$(dirname "$0")/../.." || exit 1
export SA_PLUGIN_DEV=1
export SLA_NO_FRESHNESS_CACHE=1
: "${SA_STD_DIR:=/content/sa_all/sci/sa_std}"
export SA_STD_DIR

rm -rf .sla-cache
echo "[probe] build fma_probe"
timeout 300 sa build-exe _defects/probes/fma_probe.sla -o /tmp/fma_probe 2>&1 | tail -2
if [ ! -x /tmp/fma_probe ]; then echo "FMA_PROBE_BUILD_FAIL"; exit 1; fi
rm -f _defects/probes/fma_probe.sa

run_mode() {
    local mode="$1"; shift
    echo "[probe] mode=$mode"
    env -u CODEX_ULTRA_FREE_KEY "$@" /tmp/fma_probe
    local rc=$?
    echo "[probe] mode=$mode rc=$rc"
    return $rc
}

FAIL=0

# hash mode: EXPECTED_HASH from python hashlib over the env-guid input,
# exactly as node:crypto would digest it in the TS implementation.
EXPECTED_HASH=$(python3 -c "import hashlib;print(hashlib.sha256(b'codex-ultra/free-model-access/v1:probeguid-1').hexdigest())")
env -u CODEX_ULTRA_FREE_KEY_SERVICE_URL -u CODEX_ULTRA_FREE_KEY \
    FMA_PROBE_MODE=hash CODEX_ULTRA_MACHINE_GUID=ProbeGuid-1 \
    EXPECTED_HASH="$EXPECTED_HASH" /tmp/fma_probe || FAIL=1
echo "[probe] expected_hash=$EXPECTED_HASH"

# machine-id mode: no guid -> /etc/machine-id chain, cross-checked the same way.
MID=$(cat /etc/machine-id 2>/dev/null | tr -d '[:space:]')
if [ -n "$MID" ]; then
    EXPECTED_MID=$(python3 -c "import hashlib,sys;print(hashlib.sha256(('codex-ultra/free-model-access/v1:'+sys.argv[1].lower()).encode()).hexdigest())" "$MID")
    env -u CODEX_ULTRA_MACHINE_GUID -u CODEX_ULTRA_FREE_KEY_SERVICE_URL -u CODEX_ULTRA_FREE_KEY \
        FMA_PROBE_MODE=hash EXPECTED_HASH="$EXPECTED_MID" /tmp/fma_probe || FAIL=1
    echo "[probe] expected_machine_id_hash=$EXPECTED_MID"
fi

# nosvc mode: no service URL anywhere.
env -u CODEX_ULTRA_FREE_KEY_SERVICE_URL -u CODEX_ULTRA_FREE_KEY \
    FMA_PROBE_MODE=nosvc CODEX_ULTRA_MACHINE_GUID=ProbeGuid-1 /tmp/fma_probe || FAIL=1

# svc mode: local python stub.
rm -f /tmp/fma_stub_auth.txt
python3 _defects/probes/fma_stub.py & STUB_PID=$!
sleep 1
env -u CODEX_ULTRA_FREE_KEY \
    FMA_PROBE_MODE=svc CODEX_ULTRA_MACHINE_GUID=ProbeGuid-1 \
    CODEX_ULTRA_FREE_KEY_SERVICE_URL=http://127.0.0.1:18741 \
    CODEX_ULTRA_FREE_KEY_SERVICE_SECRET=probe-secret /tmp/fma_probe || FAIL=1
kill $STUB_PID 2>/dev/null
grep -q "Bearer probe-secret" /tmp/fma_stub_auth.txt && echo "[probe] auth_header_ok=1" || { echo "[probe] auth_header MISSING"; FAIL=1; }

# down mode: service URL points at a closed port.
env -u CODEX_ULTRA_FREE_KEY \
    FMA_PROBE_MODE=down CODEX_ULTRA_MACHINE_GUID=ProbeGuid-1 \
    CODEX_ULTRA_FREE_KEY_SERVICE_URL=http://127.0.0.1:9 /tmp/fma_probe || FAIL=1

if [ "$FAIL" = "0" ]; then echo "FMA_PROBE_ALL_OK"; else echo "FMA_PROBE_SOME_FAIL"; exit 1; fi
