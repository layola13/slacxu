import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SystemMetrics } from "@codex-ui/shared";

const execFileAsync = promisify(execFile);
const CACHE_MS = 15_000;

type CpuSnapshot = { idle: number; total: number; usagePercent: number };
const cpuSnapshots = new Map<string, CpuSnapshot>();
const cache = new Map<string, { at: number; metrics: SystemMetrics }>();
const pending = new Map<string, Promise<SystemMetrics>>();

export async function getSshSystemMetrics(sshArgs: string[], cwd: string): Promise<SystemMetrics> {
  const hostKey = sshArgs.join("\u0000");
  const cacheKey = hostKey + "\u0000" + cwd;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.metrics;
  const active = pending.get(cacheKey);
  if (active) return active;
  const request = sampleSshSystemMetrics(sshArgs, cwd, hostKey)
    .then((metrics) => { cache.set(cacheKey, { at: Date.now(), metrics }); return metrics; })
    .finally(() => pending.delete(cacheKey));
  pending.set(cacheKey, request);
  return request;
}

async function sampleSshSystemMetrics(sshArgs: string[], cwd: string, hostKey: string): Promise<SystemMetrics> {
  const script = buildProbeScript(cwd);
  const { stdout } = await execFileAsync("ssh", [...sshArgs, script], {
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    windowsHide: true
  });
  const values = parseSshMetricsOutput(String(stdout));
  if (!values.hostname || !values.platform) throw new Error("Remote host did not return system metrics");
  const idle = numberValue(values.cpuIdle);
  const total = numberValue(values.cpuTotal);
  const previous = cpuSnapshots.get(hostKey);
  const usagePercent = previous && total > previous.total
    ? percent(total - previous.total - (idle - previous.idle), total - previous.total)
    : previous?.usagePercent ?? 0;
  cpuSnapshots.set(hostKey, { idle, total, usagePercent });
  return metricsFromValues(values, usagePercent, cwd);
}

export function parseSshMetricsOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return result;
}

export function metricsFromValues(values: Record<string, string>, cpuUsagePercent: number, cwd: string): SystemMetrics {
  const memTotal = numberValue(values.memTotalKib) * 1024;
  const memFree = numberValue(values.memAvailableKib) * 1024;
  const swapTotal = numberValue(values.swapTotalKib) * 1024;
  const swapFree = numberValue(values.swapFreeKib) * 1024;
  const diskTotal = numberValue(values.diskTotalKib) * 1024;
  const diskUsed = numberValue(values.diskUsedKib) * 1024;
  return {
    timestamp: Date.now(),
    cpu: {
      usagePercent: clampPercent(cpuUsagePercent),
      cores: Math.max(1, Math.round(numberValue(values.cores))),
      model: values.cpuModel || "CPU",
      loadAvg: [numberValue(values.load1), numberValue(values.load5), numberValue(values.load15)]
    },
    memory: {
      totalBytes: memTotal,
      freeBytes: memFree,
      usedBytes: Math.max(0, memTotal - memFree),
      usagePercent: percent(memTotal - memFree, memTotal),
      swapTotalBytes: swapTotal,
      swapUsedBytes: Math.max(0, swapTotal - swapFree),
      swapUsagePercent: percent(swapTotal - swapFree, swapTotal)
    },
    disk: {
      totalBytes: diskTotal,
      freeBytes: numberValue(values.diskFreeKib) * 1024,
      usedBytes: diskUsed,
      usagePercent: clampPercent(numberValue(values.diskPercent)),
      mountPoint: values.diskMount || cwd
    },
    host: {
      hostname: values.hostname || "unknown",
      platform: values.platform || "unknown",
      arch: values.arch || "unknown",
      uptimeSec: Math.max(0, Math.round(numberValue(values.uptime)))
    },
    application: {
      cpuUsagePercent: Math.max(0, Number(numberValue(values.appCpu).toFixed(1))),
      memoryBytes: numberValue(values.appRssKib) * 1024,
      processCount: Math.max(0, Math.round(numberValue(values.appCount))),
      includesCodexCli: values.includesCodex === "1"
    }
  };
}

function buildProbeScript(cwd: string): string {
  const directory = quoteShell(cwd);
  return [
    "echo hostname=$(hostname 2>/dev/null || printf unknown)",
    "echo platform=$(uname -s 2>/dev/null || printf unknown)",
    "echo arch=$(uname -m 2>/dev/null || printf unknown)",
    "echo uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null || printf 0)",
    "awk '/^cpu / {idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print \"cpuIdle=\" idle; print \"cpuTotal=\" total; exit}' /proc/stat 2>/dev/null",
    "echo cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 1)",
    "awk -F: '/model name|Hardware/ {sub(/^[ \t]+/, \"\", $2); print \"cpuModel=\" $2; exit}' /proc/cpuinfo 2>/dev/null",
    "awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} /^MemFree:/ {f=$2} /^Buffers:/ {b=$2} /^Cached:/ {c=$2} /^SwapTotal:/ {st=$2} /^SwapFree:/ {sf=$2} END {if(!a)a=f+b+c; print \"memTotalKib=\" t+0; print \"memAvailableKib=\" a+0; print \"swapTotalKib=\" st+0; print \"swapFreeKib=\" sf+0}' /proc/meminfo 2>/dev/null",
    "df -Pk " + directory + " 2>/dev/null | awk 'NR==2 {gsub(/%/,\"\",$5); print \"diskTotalKib=\" $2; print \"diskUsedKib=\" $3; print \"diskFreeKib=\" $4; print \"diskPercent=\" $5; print \"diskMount=\" $6}'",
    "ps -eo pcpu=,rss=,comm= 2>/dev/null | awk 'BEGIN{cpu=0;rss=0;n=0;c=0} $3 ~ /(^|\\/)(codex|bun)(\\.exe)?$/ {cpu+=$1;rss+=$2;n++;if($3 ~ /codex/)c=1} END{print \"appCpu=\" cpu; print \"appRssKib=\" rss; print \"appCount=\" n; print \"includesCodex=\" c}'",
    "awk '{print \"load1=\" $1; print \"load5=\" $2; print \"load15=\" $3}' /proc/loadavg 2>/dev/null"
  ].join("; ");
}

function quoteShell(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }
function numberValue(value: string | undefined): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function clampPercent(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }
function percent(used: number, total: number): number { return total > 0 ? clampPercent((Math.max(0, used) / total) * 100) : 0; }
