import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Chip,
  ClickAwayListener,
  Divider,
  LinearProgress,
  Paper,
  IconButton,
  Popper,
  Stack,
  Typography,
  alpha,
  useTheme
} from "@mui/material";
import MemoryIcon from "@mui/icons-material/Memory";
import StorageIcon from "@mui/icons-material/Storage";
import SpeedIcon from "@mui/icons-material/Speed";
import DnsIcon from "@mui/icons-material/Dns";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import type { SystemMetrics } from "@codex-ui/shared";
import {
  collectLowFpsPerformanceReport,
  createLowFpsState,
  evaluateLowFpsSample,
  type LongTaskStats
} from "../performance/lowFpsDiagnostics";
import { announcePerformancePressure, setPerformancePressureSource } from "../performance/animationBudget";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${mins}分`;
  return `${mins}分钟`;
}

function getProgressColor(percent: number): "success" | "warning" | "error" {
  if (percent >= 85) return "error";
  if (percent >= 65) return "warning";
  return "success";
}

type MetricsScope = { type: "local" } | { type: "ssh"; command: string; cwd: string };

export const SystemMetricsTopBarBadge: React.FC<{ token?: string; scope?: MetricsScope; compact?: boolean }> = ({ token, scope = { type: "local" }, compact = false }) => {
  const theme = useTheme();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [cxuVersion, setCxuVersion] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [gpuInfo, setGpuInfo] = useState<Awaited<ReturnType<NonNullable<typeof window.codexUltraDesktop>["gpuFeatureStatus"]>>>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isOpen = Boolean(anchorEl);
  const hoverTimeoutRef = useRef<number | null>(null);
  const metricsRef = useRef<SystemMetrics | null>(null);
  const lowFpsStateRef = useRef(createLowFpsState());
  const recentFpsSamplesRef = useRef<number[]>([]);
  const longTaskStatsRef = useRef<LongTaskStats>({ count: 0, totalDurationMs: 0, maxDurationMs: 0, lastDurationMs: 0 });
  const pressureActiveRef = useRef(false);
  const remote = scope.type === "ssh";
  const scopeKey = remote ? `${scope.command.trim()}\u0000${scope.cwd}` : "local";

  useEffect(() => {
    let active = true;
    const fetchMetrics = async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) {
          headers["x-codex-ui-token"] = token;
        }
        const res = remote
          ? await fetch("/api/ssh/system-metrics", {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify({ command: scope.command, cwd: scope.cwd })
            })
          : await fetch("/api/system/metrics", { headers });
        if (res.ok && active) {
          const data = (await res.json()) as SystemMetrics;
          metricsRef.current = remote ? null : data;
          setMetrics(data);
        }
      } catch {
        /* ignore transient errors */
      }
    };

    setMetrics(null);
    let interval = 0;
    let restartTimer = 0;
    const startPolling = () => {
      window.clearTimeout(restartTimer);
      restartTimer = 0;
      window.clearInterval(interval);
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      void fetchMetrics();
      interval = window.setInterval(fetchMetrics, 15_000);
    };
    const stopPolling = () => {
      window.clearTimeout(restartTimer);
      restartTimer = 0;
      window.clearInterval(interval);
    };
    const schedulePolling = () => {
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(startPolling, 1_000);
    };
    const onVisibilityChange = () => document.visibilityState === "visible" ? schedulePolling() : stopPolling();
    const onFocus = () => schedulePolling();
    startPolling();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", stopPolling);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      stopPolling();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", stopPolling);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearCloseTimer();
    };
  }, [remote, scopeKey, token]);

  useEffect(() => {
    let active = true;
    const refreshGpuInfo = () => {
      const read = window.codexUltraDesktop?.gpuFeatureStatus;
      if (!read) return;
      void read().then((next) => { if (active) setGpuInfo(next); }).catch(() => undefined);
    };
    refreshGpuInfo();
    return () => {
      active = false;
    };
  }, []);

  // cxu release version (local server only; fetched once for the top bar).
  useEffect(() => {
    if (remote) return;
    let active = true;
    const headers: Record<string, string> = {};
    if (token) {
      headers["x-codex-ui-token"] = token;
    }
    void fetch("/api/version", { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const version = data && typeof (data as Record<string, unknown>).version === "string"
          ? ((data as Record<string, unknown>).version as string)
          : null;
        if (active && version) setCxuVersion(version);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [remote, token]);

  useEffect(() => {
    let active = true;
    let recoveryTimer = 0;

    const cancelRecoveryProbe = () => {
      window.clearTimeout(recoveryTimer);
      recoveryTimer = 0;
    };
    const holdRecoveryPressure = () => {
      cancelRecoveryProbe();
      setPerformancePressureSource("window-recovery", true);
    };
    const probeRecoveredFrames = () => {
      cancelRecoveryProbe();
      if (!active || document.visibilityState !== "visible" || !document.hasFocus()) return;
      // Give Chromium one quiet second to rebuild the exposed surface. A RAF
      // benchmark here competed with GPU recovery and could itself prolong the
      // low-FPS state after Alt+Tab.
      recoveryTimer = window.setTimeout(() => {
        if (active && document.visibilityState === "visible" && document.hasFocus()) {
          setPerformancePressureSource("window-recovery", false);
        }
      }, 1_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") probeRecoveredFrames();
      else holdRecoveryPressure();
    };

    window.addEventListener("blur", holdRecoveryPressure);
    window.addEventListener("focus", probeRecoveredFrames);
    window.addEventListener("pagehide", holdRecoveryPressure);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      cancelRecoveryProbe();
      window.removeEventListener("blur", holdRecoveryPressure);
      window.removeEventListener("focus", probeRecoveredFrames);
      window.removeEventListener("pagehide", holdRecoveryPressure);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      setPerformancePressureSource("window-recovery", false);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let animationFrame = 0;
    let nextSampleTimer = 0;
    let sampleGeneration = 0;
    const sampleWindowMs = 1_000;
    const resolveSampleIntervalMs = () => document.documentElement.dataset.softwareRendering === "true" ? 10_000 : 5_000;

    const finalizeSample = (frameCount: number, elapsed: number) => {
      if (!active || elapsed <= 0) {
        return;
      }
        const measuredFps = Math.round((frameCount * 1_000) / elapsed);
        setFps((current) => Math.abs(current - measuredFps) >= 2 || measuredFps === 0 ? measuredFps : current);
        recentFpsSamplesRef.current = [...recentFpsSamplesRef.current.slice(-11), measuredFps];
        const foreground = document.visibilityState === "visible" && document.hasFocus();
        const decision = evaluateLowFpsSample(lowFpsStateRef.current, {
          fps: measuredFps,
          now: Date.now(),
          visible: foreground
        });
        lowFpsStateRef.current = decision.state;
        const pressured = decision.state.pressured;
        if (pressureActiveRef.current !== pressured) {
          pressureActiveRef.current = pressured;
          announcePerformancePressure(pressured);
        }
        if (decision.shouldReport) {
          const submitReport = () => {
            const report = collectLowFpsPerformanceReport({
              fps: measuredFps,
              consecutiveLowSamples: decision.state.consecutiveLowSamples,
              recentFpsSamples: recentFpsSamplesRef.current,
              metrics: metricsRef.current,
              longTasks: longTaskStatsRef.current,
              document,
              window
            });
            longTaskStatsRef.current = { count: 0, totalDurationMs: 0, maxDurationMs: 0, lastDurationMs: 0 };
            const headers: Record<string, string> = { "content-type": "application/json" };
            if (token) headers["x-codex-ui-token"] = token;
            void fetch("/api/runtime/performance-report", {
              method: "POST", headers, body: JSON.stringify(report), keepalive: true
            }).catch(() => undefined);
          };
          window.requestIdleCallback(submitReport, { timeout: 2_000 });
        }
    };

    const scheduleNextSample = (delayMs: number) => {
      window.clearTimeout(nextSampleTimer);
      nextSampleTimer = window.setTimeout(() => {
        if (!active) {
          return;
        }
        if (document.visibilityState !== "visible" || !document.hasFocus()) {
          scheduleNextSample(resolveSampleIntervalMs());
          return;
        }
        const generation = sampleGeneration;
        let frameCount = 0;
        const sampleStartedAt = performance.now();
        const measure = (now: number) => {
          if (!active || generation !== sampleGeneration || document.visibilityState !== "visible" || !document.hasFocus()) {
            animationFrame = 0;
            scheduleNextSample(resolveSampleIntervalMs());
            return;
          }
          frameCount += 1;
          const elapsed = now - sampleStartedAt;
          if (elapsed >= sampleWindowMs) {
            finalizeSample(frameCount, elapsed);
            animationFrame = 0;
            scheduleNextSample(Math.max(0, resolveSampleIntervalMs() - sampleWindowMs));
            return;
          }
          animationFrame = window.requestAnimationFrame(measure);
        };
        animationFrame = window.requestAnimationFrame(measure);
      }, delayMs);
    };
    const resetSamplingAfterFocusChange = () => {
      sampleGeneration += 1;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      recentFpsSamplesRef.current = [];
      longTaskStatsRef.current = { count: 0, totalDurationMs: 0, maxDurationMs: 0, lastDurationMs: 0 };
      lowFpsStateRef.current = createLowFpsState();
      if (pressureActiveRef.current) {
        pressureActiveRef.current = false;
        announcePerformancePressure(false);
      }
      scheduleNextSample(document.hasFocus() && document.visibilityState === "visible" ? 1_000 : resolveSampleIntervalMs());
    };

    scheduleNextSample(0);
    window.addEventListener("focus", resetSamplingAfterFocusChange);
    window.addEventListener("blur", resetSamplingAfterFocusChange);
    document.addEventListener("visibilitychange", resetSamplingAfterFocusChange);
    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(nextSampleTimer);
      window.removeEventListener("focus", resetSamplingAfterFocusChange);
      window.removeEventListener("blur", resetSamplingAfterFocusChange);
      document.removeEventListener("visibilitychange", resetSamplingAfterFocusChange);
      if (pressureActiveRef.current) announcePerformancePressure(false);
    };
  }, [token]);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      return;
    }
    const observer = new PerformanceObserver((list) => {
      const next = { ...longTaskStatsRef.current };
      for (const entry of list.getEntries()) {
        next.count += 1;
        next.totalDurationMs += entry.duration;
        next.maxDurationMs = Math.max(next.maxDurationMs, entry.duration);
        next.lastDurationMs = entry.duration;
      }
      longTaskStatsRef.current = next;
    });
    try {
      observer.observe({ type: "longtask" });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, []);

  const clearCloseTimer = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    hoverTimeoutRef.current = window.setTimeout(() => {
      setAnchorEl(null);
      hoverTimeoutRef.current = null;
    }, 260);
  };

  const openPanel = (element: HTMLElement) => {
    clearCloseTimer();
    setAnchorEl(element);
  };

  const handleMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
    openPanel(event.currentTarget);
  };

  const handleFocus = (event: React.FocusEvent<HTMLElement>) => {
    openPanel(event.currentTarget);
  };

  if (!metrics) {
    return null;
  }

  const cpuColor = getProgressColor(metrics.cpu.usagePercent);
  const memColor = getProgressColor(metrics.memory.usagePercent);
  const diskColor = getProgressColor(metrics.disk.usagePercent);
  const appCpuColor = getProgressColor(metrics.application.cpuUsagePercent);
  const fpsColor: "success" | "warning" | "error" = fps >= 50 ? "success" : fps >= 30 ? "warning" : "error";
  const gpuFeatures = gpuInfo?.features;
  const softwareRendering = !gpuFeatures || gpuFeatures.gpu_compositing === "disabled_software" || gpuFeatures.rasterization === "disabled_software";
  const renderMode = gpuInfo ? (softwareRendering ? "CPU" : "GPU") : "GPU?";
  const renderColor: "success" | "error" | "default" = !gpuInfo ? "default" : softwareRendering ? "error" : "success";
  const activeGpu = gpuInfo?.devices.find((device) => device.active) ?? gpuInfo?.devices[0];

  return (
    <>
      <Box
        onMouseEnter={handleMouseEnter}
        onMouseLeave={scheduleClose}
        sx={{
          display: compact ? "inline-flex" : { xs: "none", md: "inline-flex" },
          alignItems: "center",
          gap: compact ? 0 : 0.75,
          px: compact ? 0 : 1.25,
          py: compact ? 0 : 0.4,
          width: compact ? 32 : "auto",
          height: compact ? 32 : "auto",
          justifyContent: compact ? "center" : "flex-start",
          borderRadius: compact ? 1.5 : 2,
          border: "1px solid",
          borderColor: isOpen ? "primary.main" : "divider",
          bgcolor: (t) => alpha(t.palette.background.paper, 0.6),
          backdropFilter: "blur(8px)",
          cursor: "pointer",
          transition: "all 0.2s ease-in-out",
          "&:hover": {
            bgcolor: (t) => alpha(t.palette.action.hover, 0.12),
            boxShadow: theme.customShadows?.z4
          }
        }}
        onFocus={handleFocus}
      >
        {compact ? (
          <IconButton size="small" aria-label="System resource monitor" data-testid="immersive-system-monitor" sx={{ width: 30, height: 30, color: "primary.main" }}>
            <SpeedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        ) : (
          <>
        {/* Pulsing online indicator */}
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: "success.main",
            boxShadow: "0 0 8px rgba(76, 175, 80, 0.8)",
            animation: "pulse 2s infinite",
            "@keyframes pulse": {
              "0%": { opacity: 1 },
              "50%": { opacity: 0.35 },
              "100%": { opacity: 1 }
            }
          }}
        />

        <Chip
          size="small"
          variant="outlined"
          color={cpuColor}
          icon={<SpeedIcon style={{ fontSize: 14 }} />}
          label={`CPU ${metrics.cpu.usagePercent}%`}
          sx={{ height: 22, fontSize: 11.5, fontWeight: 750, border: 0 }}
        />

        {!remote && <Chip
          data-testid="render-mode-badge"
          size="small"
          variant="outlined"
          color={renderColor}
          icon={<MemoryIcon style={{ fontSize: 14 }} />}
          label={renderMode}
          sx={{ height: 22, fontSize: 11.5, fontWeight: 800, border: 0 }}
        />}

        <Chip
          size="small"
          variant="outlined"
          color={appCpuColor}
          icon={<DnsIcon style={{ fontSize: 14 }} />}
          label={remote
            ? `SSH ${metrics.host.hostname} · APP ${metrics.application.cpuUsagePercent}% · ${formatBytes(metrics.application.memoryBytes)}`
            : `APP ${metrics.application.cpuUsagePercent}% · ${formatBytes(metrics.application.memoryBytes)} · ${fps} FPS`}
          sx={{ height: 22, fontSize: 11.5, fontWeight: 750, border: 0 }}
        />

        {!remote && cxuVersion && (
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            data-testid="cxu-version-badge"
            label={`cxu v${cxuVersion}`}
            title={`cxu release ${cxuVersion}`}
            sx={{ height: 22, fontSize: 11.5, fontWeight: 800, border: 0 }}
          />
        )}

        <Chip
          size="small"
          variant="outlined"
          color={memColor}
          icon={<MemoryIcon style={{ fontSize: 14 }} />}
          label={`RAM ${metrics.memory.usagePercent}%`}
          sx={{ height: 22, fontSize: 11.5, fontWeight: 750, border: 0 }}
        />

        <Chip
          size="small"
          variant="outlined"
          color={diskColor}
          icon={<StorageIcon style={{ fontSize: 14 }} />}
          label={`Disk ${metrics.disk.usagePercent}%`}
          sx={{ height: 22, fontSize: 11.5, fontWeight: 750, border: 0 }}
        />
          </>
        )}
      </Box>

      <Popper
        open={isOpen}
        anchorEl={anchorEl}
        placement="bottom"
        disablePortal={false}
        modifiers={[
          { name: "offset", options: { offset: [0, 0] } },
          { name: "preventOverflow", options: { padding: 12 } }
        ]}
        sx={{
          zIndex: (t) => t.zIndex.tooltip,
          pointerEvents: "auto"
        }}
      >
        <ClickAwayListener onClickAway={() => setAnchorEl(null)}>
          <Box
            data-testid="system-metrics-panel"
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
            sx={{
              pt: 0.75,
              // Transparent hover bridge between the top-bar badge and panel.
              pointerEvents: "auto"
            }}
          >
            <Paper
              elevation={8}
              sx={{
                p: 2,
                width: 330,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: (t) => alpha(t.palette.background.paper, 0.95),
                backdropFilter: "blur(16px)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.36)",
                pointerEvents: "auto"
              }}
            >
              <Stack spacing={1.75}>
                {/* Header & Host Info */}
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <DnsIcon color="primary" fontSize="small" />
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 850, lineHeight: 1.2 }}>
                        {metrics.host.hostname || "VPS Host Server"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                        {metrics.host.platform} ({metrics.host.arch})
                        {!remote && cxuVersion ? ` · cxu v${cxuVersion}` : ""}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <AccessTimeIcon color="action" style={{ fontSize: 13 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, fontSize: 11 }}>
                      {formatUptime(metrics.host.uptimeSec)}
                    </Typography>
                  </Stack>
                </Stack>

                <Divider />

                <Box data-testid="application-process-metrics">
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <DnsIcon color={appCpuColor} fontSize="small" />
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        {remote ? "远端 Codex / Bun 占用" : "Codex Ultra 程序占用"}
                      </Typography>
                    </Stack>
                    <Typography variant="subtitle2" color={`${appCpuColor}.main`} sx={{ fontWeight: 900 }}>
                      {metrics.application.cpuUsagePercent}% CPU
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, metrics.application.cpuUsagePercent)}
                    color={appCpuColor}
                    sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
                  />
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      内存 {formatBytes(metrics.application.memoryBytes)} · {metrics.application.processCount} 个进程
                    </Typography>
                    <Typography variant="caption" color={metrics.application.includesCodexCli ? "success.main" : "text.secondary"}>
                      Codex CLI {metrics.application.includesCodexCli ? "已计入" : "未运行"}
                    </Typography>
                  </Stack>
                  {!remote && <Stack direction="row" justifyContent="space-between" alignItems="center" mt={0.75}>
                    <Typography variant="caption" color="text.secondary">
                      Electron 渲染帧率
                    </Typography>
                    <Chip size="small" color={fpsColor} label={`${fps} FPS`} sx={{ height: 20, fontWeight: 800, fontSize: 11 }} />
                  </Stack>}
                  {!remote && <Stack data-testid="render-mode-details" direction="row" justifyContent="space-between" alignItems="flex-start" mt={0.75} spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      渲染模式
                    </Typography>
                    <Box sx={{ minWidth: 0, textAlign: "right" }}>
                      <Typography variant="caption" color={softwareRendering ? "error.main" : "success.main"} sx={{ display: "block", fontWeight: 850 }}>
                        {gpuInfo ? (softwareRendering ? "CPU（软件合成）" : "GPU（硬件合成）") : "浏览器模式 / 待读取"}
                      </Typography>
                      {gpuInfo && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", maxWidth: 205, overflowWrap: "anywhere" }}>
                          {activeGpu ? `${activeGpu.driverVendor || `GPU ${activeGpu.vendorId.toString(16)}`}${activeGpu.driverVersion ? ` · ${activeGpu.driverVersion}` : ""}` : "Adapter unknown"}
                          {` · 合成 ${gpuFeatures?.gpu_compositing ?? "unknown"} · 光栅 ${gpuFeatures?.rasterization ?? "unknown"} · WebGL ${gpuFeatures?.webgl ?? "unknown"}`}
                        </Typography>
                      )}
                    </Box>
                  </Stack>}
                </Box>

                <Divider />

                {/* CPU Details */}
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <SpeedIcon color={cpuColor} fontSize="small" />
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        CPU 处理器
                      </Typography>
                    </Stack>
                    <Typography variant="subtitle2" color={`${cpuColor}.main`} sx={{ fontWeight: 900 }}>
                      {metrics.cpu.usagePercent}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={metrics.cpu.usagePercent}
                    color={cpuColor}
                    sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
                  />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                      {metrics.cpu.cores} 核心 · {metrics.cpu.model.slice(0, 24)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                      Load: {metrics.cpu.loadAvg.join(" / ")}
                    </Typography>
                  </Stack>
                </Box>

                {/* Memory Details */}
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <MemoryIcon color={memColor} fontSize="small" />
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        RAM 内存占用
                      </Typography>
                    </Stack>
                    <Typography variant="subtitle2" color={`${memColor}.main`} sx={{ fontWeight: 900 }}>
                      {metrics.memory.usagePercent}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={metrics.memory.usagePercent}
                    color={memColor}
                    sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
                  />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                      已用 {formatBytes(metrics.memory.usedBytes)} / 共 {formatBytes(metrics.memory.totalBytes)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      可用 {formatBytes(metrics.memory.freeBytes)}
                    </Typography>
                  </Stack>

                  {Boolean(metrics.memory.swapTotalBytes) && (
                    <Stack direction="row" justifyContent="space-between" mt={0.5}>
                      <Typography variant="caption" color="text.disabled">
                        Swap 交换空间
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {formatBytes(metrics.memory.swapUsedBytes || 0)} / {formatBytes(metrics.memory.swapTotalBytes || 0)} ({metrics.memory.swapUsagePercent || 0}%)
                      </Typography>
                    </Stack>
                  )}
                </Box>

                {/* Disk Details */}
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <StorageIcon color={diskColor} fontSize="small" />
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        Disk 磁盘使用 ({metrics.disk.mountPoint})
                      </Typography>
                    </Stack>
                    <Typography variant="subtitle2" color={`${diskColor}.main`} sx={{ fontWeight: 900 }}>
                      {metrics.disk.usagePercent}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={metrics.disk.usagePercent}
                    color={diskColor}
                    sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
                  />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                      已用 {formatBytes(metrics.disk.usedBytes)} / 总 {formatBytes(metrics.disk.totalBytes)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      剩余 {formatBytes(metrics.disk.freeBytes)}
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
            </Paper>
          </Box>
        </ClickAwayListener>
      </Popper>
    </>
  );
};
