#!/bin/bash
# li_probe_job runner: generates li_lib_job.sla from the CURRENT
# launchInstall.sla (install/detect/http middle stubbed,
# installLaunchAdapters replaced by a one-failed-result fake) and runs
# the jobs-family probe (opts round-trip + R9 job lifecycle).
set -e
cd /content/bulk-launch
python3 _defects/probes/stubgen3.py apps/server/src/launchInstall.sla home,defaultSourceRoot,li_dirs_push_unique,pathDirs,li_is_exec_file,findOnPath,configEnvPath,parseEnvFile,li_env_map_get,isPlaceholder,li_dir_qualifies,resolveSourceDir,li_status_json,detectAdapter,detectAll,li_parent_dir,upsertEnvKeys,writeAdapterEnv,li_level_name,li_log_line,createLineLogger,li_logger_emit,lineLoggerWrite,lineLoggerFlush,li_drain,runCmd,li_steps_push,li_join_texts,ensureCloned,runInstallSh,installOne,li_http_call,li_test_msg,testOpenAiApi,validateEnvModeBeforeSave,li_item_json,writeEnvsOnly,li_empty_status,li_empty_spec,installLaunchAdapters,createInstallJob _defects/probes/li_lib_job.sla
python3 - <<'PYEOF'
s = open('_defects/probes/li_lib_job.sla').read()
a = s.find('fn installLaunchAdapters')
assert a > 0
b = s.find('\n}\n', a)
sig = s[a:s.find('{', a) + 1]
fake = sig + '''
    out.results.len = 0;
    li_push(&out.results, STR_PTR("[{\\"id\\":\\"bogus\\",\\"ok\\":false}]"), STR_LEN("[{\\"id\\":\\"bogus\\",\\"ok\\":false}]"));
    out.resultsCount = 1;
    out.adapters.len = 0;
    li_push(&out.adapters, STR_PTR("{\\"sourceRoot\\":\\"\\",\\"adapters\\":[]}"), STR_LEN("{\\"sourceRoot\\":\\"\\",\\"adapters\\":[]}"));
    out.adaptersCount = 0;
    return 0;
}
'''
s = s[:a] + fake + s[b + 3:]
s = s.replace('@import "cliVersions.sla"', '@import "../../apps/server/src/cliVersions.sla"')
open('_defects/probes/li_lib_job.sla', 'w').write(s)
print('li_lib_job.sla generated with fake installLaunchAdapters')
PYEOF
source /content/sa_all/env.sh
export SA_STD_DIR=/content/sa_all/sci/sa_std SLA_NO_FRESHNESS_CACHE=1
rm -rf .sla-cache
rm -f _defects/probes/li_probe_job.sa
timeout 240 sa build-exe _defects/probes/li_probe_job.sla -o /tmp/li_probe_job_exe
set +e
timeout 60 /tmp/li_probe_job_exe; RC=$?
echo "JOB_PROBE_RC=$RC"
