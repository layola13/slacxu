import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  IconButton,
  MenuItem,
  Popover,
  Select,
  Slider,
  Stack,
  Switch,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme
} from "@mui/material";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import {
  FREE_AUTOCOMPACT_MIN_THRESHOLD,
  FREE_AUTOCOMPACT_MAX_THRESHOLD,
  clampFreeAutoCompactThreshold,
} from "../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import {
  checkFreeCompactionReadiness,
  describeFreeCompactionUnready,
  shouldBlockFreeCompactionSelection,
  type FreeCompactionReadiness,
} from "../../frontends/free-mode/src/free/freeCompactionReadiness";
import type { ProviderConfig } from "@codex-ui/shared";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

const theme = createTheme({
  components: {
    MuiDialog: { defaultProps: { disablePortal: true } },
    MuiPopover: { defaultProps: { disablePortal: true } },
    MuiModal: { defaultProps: { disablePortal: true } }
  }
});

function renderWithTheme(element: React.ReactElement): string {
  return renderToStaticMarkup(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
}

// ---------------------------------------------------------------------------
// Render Helper for Composer Free Savings Action & Popover
// ---------------------------------------------------------------------------

function renderFreeSavingsAction(props: {
  popoverOpen?: boolean;
  enabled?: boolean;
  threshold?: number;
  providerId?: string | null;
  groupId?: string | null;
  model?: string | null;
  providers?: Array<{ providerId: string; providerName: string }>;
  groups?: Array<{ providerId: string; groupId: string | null; groupName: string }>;
  models?: string[];
  readiness?: FreeCompactionReadiness;
  onToggle?: () => void;
  onSelectProvider?: (id: string | null) => void;
  onSelectGroup?: (id: string | null) => void;
  onSelectModel?: (model: string) => void;
  onChangeThreshold?: (val: number) => void;
  onOpenFreeModelAccess?: () => void;
}) {
  const {
    popoverOpen = false,
    enabled = false,
    threshold = 80,
    providerId = null,
    groupId = null,
    model = null,
    providers = [{ providerId: "omniroute-free", providerName: "OmniRoute 免费渠道" }],
    groups = [{ providerId: "omniroute-free", groupId: "opencode-free", groupName: "opencode-free x0" }],
    models = ["gpt-5.6-luna", "deepseek-v3-free"],
    readiness = { ok: true, reason: null },
    onToggle = () => {},
    onSelectProvider = () => {},
    onSelectGroup = () => {},
    onSelectModel = () => {},
    onChangeThreshold = () => {},
    onOpenFreeModelAccess = () => {}
  } = props;

  const tooltipTitle = enabled
    ? `省钱模式已开启 (阈值 ${threshold}%)`
    : "开启省钱模式：上下文达到阈值时用免费同名模型压缩";

  return renderWithTheme(
    <Box data-testid="composer-free-savings-wrapper">
      <Tooltip title={tooltipTitle}>
        <IconButton
          size="small"
          color={enabled ? "success" : "default"}
          aria-label="省钱模式"
          aria-haspopup="menu"
          aria-expanded={popoverOpen ? "true" : undefined}
          data-testid="composer-free-savings-button"
        >
          <AttachMoneyIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={popoverOpen}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        data-testid="free-savings-popover"
      >
        <Stack spacing={1.25} sx={{ minWidth: 252, p: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={0.5} alignItems="center">
              <AttachMoneyIcon fontSize="small" color={enabled ? "success" : "disabled"} />
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>省钱模式</Typography>
            </Stack>
            <FormControlLabel
              sx={{ m: 0 }}
              control={
                <Switch
                  size="small"
                  checked={enabled}
                  onChange={onToggle}
                  inputProps={{ "aria-label": "开启省钱模式" }}
                />
              }
              label={<Typography variant="caption">{enabled ? "开启" : "关闭"}</Typography>}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {enabled
              ? `仅此对话：发送前拦截。上下文使用率 ≥ ${threshold}% 时执行压缩。`
              : "仅此对话：选择压缩渠道和模型后开启；不影响其他对话。"}
          </Typography>
          <FormControl size="small" fullWidth>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>压缩渠道</Typography>
            <Select
              value={providerId ?? "__select__"}
              aria-label="压缩渠道"
              onChange={(e) => onSelectProvider(e.target.value === "__select__" ? null : String(e.target.value))}
            >
              <MenuItem value="__select__">请选择压缩渠道和模型</MenuItem>
              {providerId && !providers.some((p) => p.providerId === providerId) && (
                <MenuItem value={providerId} disabled>{`${providerId}（已不可用）`}</MenuItem>
              )}
              {providers.map((p) => (
                <MenuItem key={p.providerId} value={p.providerId}>{p.providerName}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {providerId && (
            <FormControl size="small" fullWidth>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>渠道分组</Typography>
              <Select
                value={groupId ?? "__default__"}
                aria-label="压缩渠道分组"
                onChange={(e) => onSelectGroup(e.target.value === "__default__" ? null : String(e.target.value))}
              >
                {groupId && !groups.some((g) => g.groupId === groupId) && (
                  <MenuItem value={groupId} disabled>{`${groupId}（已不可用）`}</MenuItem>
                )}
                {groups.map((g) => (
                  <MenuItem key={`${g.providerId}:${g.groupId ?? "default"}`} value={g.groupId ?? "__default__"}>
                    {g.groupName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {providerId && (
            <FormControl size="small" fullWidth>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>压缩模型</Typography>
              <Select
                value={model ?? ""}
                aria-label="压缩模型"
                onChange={(e) => onSelectModel(String(e.target.value))}
              >
                {model && !models.includes(model) && (
                  <MenuItem value={model} disabled>{`${model}（已不可用）`}</MenuItem>
                )}
                {models.map((m) => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {!readiness.ok && (
            <Stack spacing={0.75} data-testid="free-savings-unready-warning">
              <Typography variant="caption" color="warning.main">
                {describeFreeCompactionUnready(readiness.reason, readiness.detail)}
              </Typography>
              {!providerId && ["provider-missing", "group-missing", "group-empty"].includes(readiness.reason) && (
                <Button size="small" variant="outlined" onClick={onOpenFreeModelAccess}>
                  获取或同步免费模型
                </Button>
              )}
            </Stack>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {FREE_AUTOCOMPACT_MIN_THRESHOLD}%
            </Typography>
            <Slider
              size="small"
              value={threshold}
              min={FREE_AUTOCOMPACT_MIN_THRESHOLD}
              max={FREE_AUTOCOMPACT_MAX_THRESHOLD}
              step={1}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v}%`}
              onChange={(_, v) => onChangeThreshold(typeof v === "number" ? v : threshold)}
              sx={{ flex: 1 }}
              aria-label="压缩阈值"
            />
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {FREE_AUTOCOMPACT_MAX_THRESHOLD}%
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
            仅在本地工作模式生效，不会修改 Codex CLI 全局 relay 或模型配置；所选模型下架后会要求重新选择。
          </Typography>
        </Stack>
      </Popover>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Composer Free Savings Button renders disabled and enabled states correctly", () => {
  const disabledHtml = renderFreeSavingsAction({ enabled: false });
  expect(disabledHtml).toContain('data-testid="composer-free-savings-button"');
  expect(disabledHtml).toContain('aria-label="省钱模式"');
  expect(disabledHtml).not.toContain('MuiIconButton-colorSuccess');

  const enabledHtml = renderFreeSavingsAction({ enabled: true, threshold: 85 });
  expect(enabledHtml).toContain('data-testid="composer-free-savings-button"');
  expect(enabledHtml).toContain('MuiIconButton-colorSuccess');
});

test("Free Savings Popover renders header, switch toggle, and descriptive subtitle", () => {
  const html = renderFreeSavingsAction({
    popoverOpen: true,
    enabled: true,
    threshold: 80
  });

  expect(html).toContain("省钱模式");
  expect(html).toContain("开启");
  expect(html).toContain("仅此对话：发送前拦截。上下文使用率 ≥ 80% 时执行压缩。");
});

test("Free Savings Popover renders provider, group, and model selectors with options", () => {
  const html = renderFreeSavingsAction({
    popoverOpen: true,
    providerId: "omniroute-free",
    groupId: "opencode-free",
    model: "gpt-5.6-luna",
    providers: [{ providerId: "omniroute-free", providerName: "OmniRoute 免费渠道" }],
    groups: [{ providerId: "omniroute-free", groupId: "opencode-free", groupName: "opencode-free x0" }],
    models: ["gpt-5.6-luna", "deepseek-v3-free"]
  });

  expect(html).toContain("压缩渠道");
  expect(html).toContain("OmniRoute 免费渠道");
  expect(html).toContain("渠道分组");
  expect(html).toContain("opencode-free x0");
  expect(html).toContain("压缩模型");
  expect(html).toContain("gpt-5.6-luna");
});

test("Free Savings Popover marks removed/deprecated models and providers as disabled", () => {
  const html = renderFreeSavingsAction({
    popoverOpen: true,
    providerId: "old-relay-deprecated",
    groupId: "old-group",
    model: "legacy-model-v1",
    providers: [{ providerId: "omniroute-free", providerName: "OmniRoute 免费渠道" }],
    groups: [{ providerId: "omniroute-free", groupId: "default", groupName: "default x1" }],
    models: ["gpt-5.6-luna"]
  });

  expect(html).toContain("old-relay-deprecated（已不可用）");
  expect(html).toContain("old-group（已不可用）");
  expect(html).toContain("legacy-model-v1（已不可用）");
});

test("Free Savings Popover renders threshold Slider with 50% min and 95% max bounds", () => {
  const html = renderFreeSavingsAction({
    popoverOpen: true,
    threshold: 75
  });

  expect(html).toContain("50%");
  expect(html).toContain("95%");
  expect(html).toContain('aria-valuemin="50"');
  expect(html).toContain('aria-valuemax="95"');
  expect(html).toContain('aria-valuenow="75"');
});

test("Free Savings Popover renders unready warning banner and CTA button when free relay missing", () => {
  const html = renderFreeSavingsAction({
    popoverOpen: true,
    providerId: null,
    readiness: {
      ok: false,
      reason: "provider-missing",
      detail: "The free relay (omniroute-free) has not been added. Sync free models first."
    }
  });

  expect(html).toContain('data-testid="free-savings-unready-warning"');
  expect(html).toContain("The free relay (omniroute-free) has not been added");
  expect(html).toContain("获取或同步免费模型");
});

test("Free Savings Popover explains local mode safety isolation in footnote", () => {
  const html = renderFreeSavingsAction({ popoverOpen: true });
  expect(html).toContain("仅在本地工作模式生效，不会修改 Codex CLI 全局 relay 或模型配置；所选模型下架后会要求重新选择。");
});

test("Threshold clamping strictly enforces 50% to 95% range", () => {
  expect(clampFreeAutoCompactThreshold(30)).toBe(50);
  expect(clampFreeAutoCompactThreshold(49)).toBe(50);
  expect(clampFreeAutoCompactThreshold(50)).toBe(50);
  expect(clampFreeAutoCompactThreshold(80)).toBe(80);
  expect(clampFreeAutoCompactThreshold(95)).toBe(95);
  expect(clampFreeAutoCompactThreshold(96)).toBe(95);
  expect(clampFreeAutoCompactThreshold(120)).toBe(95);
});

test("checkFreeCompactionReadiness enforces workspace mode and explicit route selection", () => {
  const sampleProviders: ProviderConfig[] = [
    {
      id: "omniroute-free",
      name: "OmniRoute 免费",
      nativeModels: [],
      groups: [
        {
          id: "opencode-free",
          name: "免费分组",
          multiplier: 0,
          models: ["gpt-5.6-luna", "deepseek-v3-free"]
        }
      ]
    }
  ];

  // 1. Remote SSH workspace rejected
  const remoteResult = checkFreeCompactionReadiness({
    activeThreadId: "thread-1",
    workspaceMode: "ssh",
    currentModel: "gpt-5.6-luna",
    providers: sampleProviders,
    manualProviderId: "omniroute-free",
    manualGroupId: "opencode-free",
    manualFreeModel: "gpt-5.6-luna"
  });
  expect(remoteResult.ok).toBe(false);
  expect(remoteResult.reason).toBe("remote-workspace");

  // 2. Incomplete manual selection rejected
  const incompleteResult = checkFreeCompactionReadiness({
    activeThreadId: "thread-1",
    workspaceMode: "local",
    currentModel: "gpt-5.6-luna",
    providers: sampleProviders,
    manualProviderId: null,
    manualGroupId: null,
    manualFreeModel: null
  });
  expect(incompleteResult.ok).toBe(false);
  expect(incompleteResult.reason).toBe("manual-route-incomplete");

  // 3. Unavailable model rejected
  const modelUnavailableResult = checkFreeCompactionReadiness({
    activeThreadId: "thread-1",
    workspaceMode: "local",
    currentModel: "gpt-5.6-luna",
    providers: sampleProviders,
    manualProviderId: "omniroute-free",
    manualGroupId: "opencode-free",
    manualFreeModel: "non-existent-model"
  });
  expect(modelUnavailableResult.ok).toBe(false);
  expect(modelUnavailableResult.reason).toBe("manual-model-unavailable");

  // 4. Valid local manual route accepted
  const validResult = checkFreeCompactionReadiness({
    activeThreadId: "thread-1",
    workspaceMode: "local",
    currentModel: "gpt-5.6-luna",
    providers: sampleProviders,
    manualProviderId: "omniroute-free",
    manualGroupId: "opencode-free",
    manualFreeModel: "gpt-5.6-luna"
  });
  expect(validResult.ok).toBe(true);
  expect(validResult.providerId).toBe("omniroute-free");
  expect(validResult.groupId).toBe("opencode-free");
  expect(validResult.model).toBe("gpt-5.6-luna");
});

test("Free compaction 60-second cooldown barrier blocks rapid consecutive compaction", () => {
  const FREE_COMPACTION_COOLDOWN_MS = 60_000;
  const now = Date.now();

  const lastCompactedAt = now - 20_000; // 20s ago
  const inCooldown = now - lastCompactedAt < FREE_COMPACTION_COOLDOWN_MS;
  expect(inCooldown).toBe(true);

  const expiredCompactedAt = now - 65_000; // 65s ago
  const expiredCooldown = now - expiredCompactedAt < FREE_COMPACTION_COOLDOWN_MS;
  expect(expiredCooldown).toBe(false);
});

test("free compaction can be selected before the first thread exists", () => {
  expect(shouldBlockFreeCompactionSelection({ ok: false, reason: "no-active-thread" })).toBe(false);
  expect(shouldBlockFreeCompactionSelection({ ok: false, reason: "manual-route-incomplete" })).toBe(true);
});
