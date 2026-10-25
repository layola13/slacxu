import { Button, FormControl, IconButton, MenuItem, Popover, Select, Slider, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import type { CompactMode } from "@codex-ui/shared";
import { describeFreeCompactionUnready, type CompactionChannelOption, type FreeCompactionReadiness } from "../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import { FREE_AUTOCOMPACT_MAX_THRESHOLD, FREE_AUTOCOMPACT_MIN_THRESHOLD } from "../../../../frontends/free-mode/src/free/freeAutoCompactPreferences";

export interface FreeSavingsActionProps {
  compactMode: CompactMode;
  setCompactMode: (mode: CompactMode) => void;
  freeAutoCompactThreshold: number;
  setFreeAutoCompactThreshold: (value: number) => void;
  freeAutoCompactProviderId: string | null;
  setFreeAutoCompactProvider: (providerId: string | null) => void;
  freeAutoCompactGroupId: string | null;
  setFreeAutoCompactGroup: (groupId: string | null) => void;
  freeAutoCompactModel: string | null;
  setFreeAutoCompactModel: (model: string | null) => void;
  jevCompressThreshold: number;
  setJevCompressThreshold: (value: number) => void;
  freeCompactMenuAnchor: HTMLElement | null;
  setFreeCompactMenuAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  freeCompactionProviderOptions: Array<{ providerId: string; providerName: string }>;
  freeCompactionGroupOptions: CompactionChannelOption[];
  freeCompactionModels: string[];
  freeCompactionReadiness: FreeCompactionReadiness;
  setFreeModelAccessOpen: Dispatch<SetStateAction<boolean>>;
  compactCapabilityWarning: string | null;
}

export function FreeSavingsAction({
  compactMode,
  setCompactMode,
  freeAutoCompactThreshold,
  setFreeAutoCompactThreshold,
  freeAutoCompactProviderId,
  setFreeAutoCompactProvider,
  freeAutoCompactGroupId,
  setFreeAutoCompactGroup,
  freeAutoCompactModel,
  setFreeAutoCompactModel,
  jevCompressThreshold,
  setJevCompressThreshold,
  freeCompactMenuAnchor,
  setFreeCompactMenuAnchor,
  freeCompactionProviderOptions,
  freeCompactionGroupOptions,
  freeCompactionModels,
  freeCompactionReadiness,
  setFreeModelAccessOpen,
  compactCapabilityWarning,
}: FreeSavingsActionProps) {
  return (

    <>
      <Tooltip title={compactMode === "off" ? "压缩策略：选择廉价模型压缩或JEV工具历史裁剪" : `压缩策略：${compactMode === "cheap" ? `廉价模型 (阈值 ${freeAutoCompactThreshold}%)` : compactMode === "jev-sub" ? `JEV订阅高频剪 (阈值 ${jevCompressThreshold}%)` : `JEV Token阈值剪 (阈值 ${jevCompressThreshold}%)`}`}>
        <IconButton
          size="small"
          color={compactMode !== "off" ? "success" : "default"}
          aria-label="省钱模式"
          aria-haspopup="menu"
          aria-expanded={freeCompactMenuAnchor ? "true" : undefined}
          data-testid="composer-free-savings-button"
          onClick={(event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => setFreeCompactMenuAnchor(event.currentTarget)}
          sx={{
            width: 32,
            height: 32,
            flex: "0 0 32px",
            border: "1px solid",
            borderColor: compactMode !== "off" ? "success.main" : "divider",
            bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.94)
          }}
        >
          <AttachMoneyIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(freeCompactMenuAnchor)}
        anchorEl={freeCompactMenuAnchor}
        onClose={() => setFreeCompactMenuAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 320 } } }}
      >
        <Stack spacing={1.25} sx={{ minWidth: 252 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={0.5} alignItems="center">
              <AttachMoneyIcon fontSize="small" color={compactMode !== "off" ? "success" : "disabled"} />
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>省钱模式</Typography>
            </Stack>
          </Stack>
          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            value={compactMode}
            onChange={(_event: ReactMouseEvent<HTMLElement>, v: CompactMode | null) => { if (v) setCompactMode(v); }}
            aria-label="压缩策略"
            sx={{ flexWrap: "wrap" }}
          >
            <ToggleButton value="off" aria-label="关闭压缩">关闭</ToggleButton>
            <ToggleButton value="cheap" aria-label="廉价模型压缩">廉价模型</ToggleButton>
            <ToggleButton value="jev-sub" aria-label="JEV订阅高频剪">JEV订阅</ToggleButton>
            <ToggleButton value="jev-token" aria-label="JEV Token阈值剪">JEV阈值</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            {compactMode === "cheap"
              ? `仅此对话：发送前拦截。上下文使用率 ≥ ${freeAutoCompactThreshold}% 时用廉价模型压缩。`
              : compactMode === "jev-sub"
                ? "仅此对话：每轮发送前注入JEV压缩指令，高频小剪工具历史。"
                : compactMode === "jev-token"
                  ? `仅此对话：上下文使用率 ≥ ${jevCompressThreshold}% 时注入JEV压缩指令。`
                  : "仅此对话：选择一种压缩策略；不影响其他对话。"}
          </Typography>
          {compactMode === "cheap" && (
          <>
          <FormControl size="small" fullWidth>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>压缩渠道</Typography>
            <Select
              value={freeAutoCompactProviderId ?? "__select__"}
              aria-label="压缩渠道"
              onChange={(event: import("@mui/material/Select").SelectChangeEvent<string>) => setFreeAutoCompactProvider(event.target.value === "__select__" ? null : event.target.value)}
              sx={{ fontSize: 13 }}
            >
              <MenuItem value="__select__">请选择压缩渠道和模型</MenuItem>
              {freeAutoCompactProviderId && !freeCompactionProviderOptions.some((option: { providerId: string; providerName: string; }) => option.providerId === freeAutoCompactProviderId) && (
                <MenuItem value={freeAutoCompactProviderId} disabled>{`${freeAutoCompactProviderId}（已不可用）`}</MenuItem>
              )}
              {freeCompactionProviderOptions.map((option: { providerId: string; providerName: string; }) => (
                <MenuItem key={option.providerId} value={option.providerId}>{option.providerName}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {freeAutoCompactProviderId && (
            <FormControl size="small" fullWidth>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>渠道分组</Typography>
              <Select
                value={freeAutoCompactGroupId ?? "__default__"}
                aria-label="压缩渠道分组"
                onChange={(event: import("@mui/material/Select").SelectChangeEvent<string>) => setFreeAutoCompactGroup(event.target.value === "__default__" ? null : event.target.value)}
                sx={{ fontSize: 13 }}
              >
                {freeAutoCompactGroupId && !freeCompactionGroupOptions.some((option: import("../../../../frontends/free-mode/src/free/freeCompactionReadiness").CompactionChannelOption) => option.groupId === freeAutoCompactGroupId) && (
                  <MenuItem value={freeAutoCompactGroupId} disabled>{`${freeAutoCompactGroupId}（已不可用）`}</MenuItem>
                )}
                {freeCompactionGroupOptions.map((option: import("../../../../frontends/free-mode/src/free/freeCompactionReadiness").CompactionChannelOption) => (
                  <MenuItem key={`${option.providerId}:${option.groupId ?? "default"}`} value={option.groupId ?? "__default__"}>{option.groupName}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {freeAutoCompactProviderId && (
            <FormControl size="small" fullWidth>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>压缩模型</Typography>
              <Select
                value={freeAutoCompactModel ?? ""}
                aria-label="压缩模型"
                onChange={(event: import("@mui/material/Select").SelectChangeEvent<string>) => setFreeAutoCompactModel(event.target.value)}
                sx={{ fontSize: 13 }}
              >
              {freeAutoCompactModel && !freeCompactionModels.includes(freeAutoCompactModel) && (
                <MenuItem value={freeAutoCompactModel} disabled>{`${freeAutoCompactModel}（已不可用）`}</MenuItem>
              )}
              {freeCompactionModels.map((model: string) => <MenuItem key={model} value={model}>{model}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {!freeCompactionReadiness.ok && (
            <Stack spacing={0.75}>
              <Typography variant="caption" color="warning.main">
                {describeFreeCompactionUnready(freeCompactionReadiness.reason, freeCompactionReadiness.detail)}
              </Typography>
              {!freeAutoCompactProviderId && ["provider-missing", "group-missing", "group-empty"].includes(freeCompactionReadiness.reason) && (
                <Button size="small" variant="outlined" onClick={() => setFreeModelAccessOpen(true)}>
                  获取或同步免费模型
                </Button>
              )}
            </Stack>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MIN_THRESHOLD}%</Typography>
            <Slider
              size="small"
              value={freeAutoCompactThreshold}
              min={FREE_AUTOCOMPACT_MIN_THRESHOLD}
              max={FREE_AUTOCOMPACT_MAX_THRESHOLD}
              step={1}
              valueLabelDisplay="auto"
              valueLabelFormat={(v: number) => `${v}%`}
              onChange={(_: Event, v: number) => setFreeAutoCompactThreshold(typeof v === "number" ? v : freeAutoCompactThreshold)}
              sx={{ flex: 1 }}
            />
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MAX_THRESHOLD}%</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
            仅在本地工作模式生效，不会修改 Codex CLI 全局 relay 或模型配置；所选模型下架后会要求重新选择。
          </Typography>
          </>)}
          {(compactMode === "jev-sub" || compactMode === "jev-token") && (
          <>
          {compactCapabilityWarning && (
            <Typography variant="caption" color="warning.main">
              {compactCapabilityWarning}
            </Typography>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MIN_THRESHOLD}%</Typography>
            <Slider
              size="small"
              value={jevCompressThreshold}
              min={FREE_AUTOCOMPACT_MIN_THRESHOLD}
              max={FREE_AUTOCOMPACT_MAX_THRESHOLD}
              step={1}
              valueLabelDisplay="auto"
              valueLabelFormat={(v: number) => `${v}%`}
              aria-label="JEV压缩阈值"
              onChange={(_: Event, v: number) => setJevCompressThreshold(typeof v === "number" ? v : jevCompressThreshold)}
              sx={{ flex: 1 }}
            />
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MAX_THRESHOLD}%</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
            {`JEV压缩阈值 ${jevCompressThreshold}%：订阅制每阶段边界剪，Token制到阈值才剪；剪前先外化要点，可按需回取。`}
          </Typography>
          </>)}
        </Stack>
      </Popover>
    </>
  
  );
}
