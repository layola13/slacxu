import { expect, test } from "bun:test";
import { metricsFromValues, parseSshMetricsOutput } from "../../apps/server/src/sshSystemMetrics";

test("parses and projects SSH system metrics", () => {
  const values = parseSshMetricsOutput([
    "hostname=remote-one", "platform=Linux", "arch=x86_64", "uptime=7200",
    "cores=8", "cpuModel=Example CPU", "memTotalKib=1048576", "memAvailableKib=262144",
    "swapTotalKib=524288", "swapFreeKib=393216", "diskTotalKib=2097152", "diskUsedKib=1048576",
    "diskFreeKib=1048576", "diskPercent=50", "diskMount=/home", "appCpu=12.5", "appRssKib=65536",
    "appCount=3", "includesCodex=1", "load1=0.5", "load5=0.25", "load15=0.1"
  ].join("\n"));
  const metrics = metricsFromValues(values, 37, "/home/user/project");
  expect(metrics.host).toEqual({ hostname: "remote-one", platform: "Linux", arch: "x86_64", uptimeSec: 7200 });
  expect(metrics.cpu.usagePercent).toBe(37);
  expect(metrics.memory.usagePercent).toBe(75);
  expect(metrics.disk.usagePercent).toBe(50);
  expect(metrics.application).toEqual({ cpuUsagePercent: 12.5, memoryBytes: 67108864, processCount: 3, includesCodexCli: true });
});
