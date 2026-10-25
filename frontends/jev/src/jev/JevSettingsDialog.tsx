import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { testJevConnection } from "./jevClient";
import {
  CLOUDFLARE_JEV_DEFAULT_BASE_URL,
  CLOUDFLARE_JEV_DEFAULT_MODEL,
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_MAX_AUTO_NUDGES,
  JEV_PLAN_REVIEW_OPTIONS,
  isCloudflareJevBaseUrl,
  normalizeJevBridgeProtocol,
  normalizeJevUpstreamProvider,
  normalizeMaxJevNudges,
  normalizePlanReviewMode,
  type JevConfig,
} from "./jevConfig";
import type { ProjectRelayProvider } from "@cxu/sdk-frontend";
import type { TranslateFn } from "@cxu/sdk-frontend";

type Props = {
  open: boolean;
  sessionToken?: string | null;
  config: JevConfig;
  onChange: (config: JevConfig) => void;
  onClose: () => void;
  t: TranslateFn;
  /** Host-provided relay directory loader (the dialog never calls host modules directly). */
  listRelayDirectory: (token: string) => Promise<ProjectRelayProvider[]>;
};

export function JevSettingsDialog({ open, sessionToken, config, onChange, onClose, t, listRelayDirectory }: Props) {
  const [draft, setDraft] = useState<JevConfig>(config);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [relayDirectory, setRelayDirectory] = useState<ProjectRelayProvider[]>([]);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult("");
      setTesting(false);
    }
  }, [open, config]);

  useEffect(() => {
    if (!open) return;
    if (!sessionToken) {
      setRelayDirectory([]);
      return;
    }
    let cancelled = false;
    setRelayLoading(true);
    setRelayError("");
    void listRelayDirectory(sessionToken)
      .then((providers) => {
        if (!cancelled) setRelayDirectory(Array.isArray(providers) ? providers : []);
      })
      .catch((error) => {
        if (!cancelled) {
          setRelayDirectory([]);
          setRelayError(error instanceof Error ? error.message : t("jev.settings.relayLoadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setRelayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionToken, t]);

  const activeProvider = relayDirectory.find((entry) => entry.providerId === draft.providerId) ?? null;
  const textGroups = (activeProvider?.groups ?? []).filter((group) => group.kind === "text" && group.enabled);
  const activeGroup = textGroups.find((group) => group.groupId === draft.groupId)
    ?? textGroups[0] ?? null;
  const groupModels = activeGroup && activeGroup.models.length > 0
    ? activeGroup.models
    : (activeProvider?.models ?? []);
  const modelOptions = Array.from(new Set([
    ...(draft.model.trim() ? [draft.model.trim()] : []),
    ...groupModels,
    ...(activeProvider?.defaultModel ? [activeProvider.defaultModel] : []),
  ])).slice(0, 100);

  const normalizedUpstream = normalizeJevUpstreamProvider(draft.upstream, draft.baseUrl);
  const baseUrlFallback = normalizedUpstream === "cloudflare"
    ? CLOUDFLARE_JEV_DEFAULT_BASE_URL
    : JEV_DEFAULT_BASE_URL;
  const modelFallback = normalizedUpstream === "cloudflare"
    ? CLOUDFLARE_JEV_DEFAULT_MODEL
    : JEV_DEFAULT_MODEL;

  const handleSave = (): void => {
    onChange({
      enabled: draft.enabled,
      upstream: normalizedUpstream,
      baseUrl: draft.baseUrl.trim() || baseUrlFallback,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim() || modelFallback,
      providerId: draft.providerId.trim(),
      groupId: (draft.groupId.trim() || activeGroup?.groupId || "").trim(),
      bridgeProtocol: normalizeJevBridgeProtocol(draft.bridgeProtocol),
      autoNudge: draft.autoNudge,
      maxNudges: normalizeMaxJevNudges(draft.maxNudges),
      planReview: draft.planReview,
      reviewBrief: draft.reviewBrief,
      reviewReport: draft.reviewReport,
      allowActiveTools: draft.allowActiveTools,
    });
    onClose();
  };

  const handleTest = async (): Promise<void> => {
    if (!draft.apiKey.trim() && !draft.providerId.trim()) {
      setTestResult(t("jev.settings.needKeyOrRelay"));
      return;
    }
    setTesting(true);
    setTestResult("");
    try {
      const started = Date.now();
      const result = await testJevConnection({
        sessionToken,
        baseUrl: draft.baseUrl.trim() || baseUrlFallback,
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim() || modelFallback,
        providerId: draft.providerId.trim() || undefined,
        groupId: (draft.groupId.trim() || activeGroup?.groupId || "").trim() || undefined,
        bridgeProtocol: normalizeJevBridgeProtocol(draft.bridgeProtocol),
      });
      const payload = result.data as { model?: string } | null;
      const ms = result.latencyMs ?? Date.now() - started;
      setTestResult(`200 OK (${ms} ms)${payload && typeof payload.model === "string" ? ` · ${payload.model}` : ""}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : t("jev.settings.connectionFailed"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="jev-settings-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flex: 1 }}>{t("jev.settings.title")}</Box>
        <IconButton size="small" aria-label={t("jev.settings.close")} onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={draft.enabled}
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
                data-testid="jev-enabled-switch"
              />
            }
            label={t("jev.settings.enabledLabel")}
          />
          <TextField
            select
            fullWidth
            size="small"
            label={t("jev.settings.upstreamLabel")}
            value={normalizedUpstream}
            onChange={(event) => {
              const next = normalizeJevUpstreamProvider(event.target.value, undefined, "jev");
              setDraft((current) => {
                if (next === "cloudflare") {
                  return {
                    ...current,
                    upstream: next,
                    baseUrl: isCloudflareJevBaseUrl(current.baseUrl) && current.baseUrl.trim()
                      ? current.baseUrl
                      : CLOUDFLARE_JEV_DEFAULT_BASE_URL,
                    model: current.model.trim() && current.model.trim() !== JEV_DEFAULT_MODEL
                      ? current.model
                      : CLOUDFLARE_JEV_DEFAULT_MODEL,
                  };
                }
                return {
                  ...current,
                  upstream: next,
                  baseUrl: !isCloudflareJevBaseUrl(current.baseUrl) && current.baseUrl.trim()
                    ? current.baseUrl
                    : JEV_DEFAULT_BASE_URL,
                  model: current.model.trim() && current.model.trim() !== CLOUDFLARE_JEV_DEFAULT_MODEL
                    ? current.model
                    : JEV_DEFAULT_MODEL,
                };
              });
            }}
            helperText={t("jev.settings.upstreamHelper")}
            data-testid="jev-upstream-select"
          >
            <MenuItem value="jev">{t("jev.settings.upstreamJev")}</MenuItem>
            <MenuItem value="cloudflare">{t("jev.settings.upstreamCloudflare")}</MenuItem>
          </TextField>
          <TextField
            fullWidth
            size="small"
            label="Base URL"
            value={draft.baseUrl}
            placeholder={baseUrlFallback}
            onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
            helperText={t("jev.settings.baseUrlHelper")}
            data-testid="jev-baseurl-input"
          />
          <TextField
            fullWidth
            size="small"
            label="API Key"
            type={showKey ? "text" : "password"}
            value={draft.apiKey}
            placeholder={normalizedUpstream === "cloudflare" ? t("jev.settings.apiKeyPlaceholderCloudflare") : "apikey_..."}
            onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
            data-testid="jev-apikey-input"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label={showKey ? t("jev.settings.hideKey") : t("jev.settings.showKey")} onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            fullWidth
            size="small"
            label="模型名称"
            value={draft.model}
            placeholder={modelFallback}
            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            data-testid="jev-model-input"
            helperText={t("jev.settings.modelHelper")}
          />
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            {t("jev.settings.bridgeTitle")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("jev.settings.bridgeDesc")}
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label={relayLoading ? t("jev.settings.relayLoadingLabel") : t("jev.settings.relayLabel")}
            value={draft.providerId}
            onChange={(event) => {
              const nextProviderId = event.target.value;
              const nextProvider = relayDirectory.find((entry) => entry.providerId === nextProviderId) ?? null;
              const nextGroups = (nextProvider?.groups ?? []).filter((group) => group.kind === "text" && group.enabled);
              const nextGroup = nextGroups[0] ?? null;
              const nextModel = nextGroup?.models[0] ?? nextProvider?.defaultModel ?? nextProvider?.models[0] ?? draft.model;
              setDraft((current) => ({
                ...current,
                providerId: nextProviderId,
                groupId: nextGroup?.groupId ?? "",
                model: (nextModel ?? current.model).trim() || current.model,
              }));
            }}
            helperText={relayError || (sessionToken ? t("jev.settings.relayHelper") : t("jev.settings.relayNoToken"))}
            data-testid="jev-relay-select"
            error={Boolean(relayError)}
          >
            <MenuItem value="">{t("jev.settings.relayDirect")}</MenuItem>
            {relayDirectory.map((entry) => (
              <MenuItem key={entry.providerId} value={entry.providerId}>
                {entry.providerName}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
            label={t("jev.settings.groupLabel")}
            value={draft.groupId || activeGroup?.groupId || ""}
            disabled={!activeProvider}
            onChange={(event) => {
              const nextGroupId = event.target.value;
              const nextGroup = textGroups.find((group) => group.groupId === nextGroupId) ?? null;
              const nextModel = nextGroup?.models[0] ?? activeProvider?.defaultModel ?? draft.model;
              setDraft((current) => ({
                ...current,
                groupId: nextGroupId,
                model: (nextModel ?? current.model).trim() || current.model,
              }));
            }}
            data-testid="jev-group-select"
          >
            <MenuItem value="" disabled>{t("jev.settings.groupPlaceholder")}</MenuItem>
            {textGroups.map((group) => (
              <MenuItem key={group.groupId} value={group.groupId}>
                {group.groupName} · x{group.groupRatio}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
            label={t("jev.settings.bridgeModelLabel")}
            value={modelOptions.includes(draft.model.trim()) ? draft.model.trim() : (modelOptions[0] ?? draft.model)}
            disabled={!activeProvider}
            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            helperText={t("jev.settings.bridgeModelHelper")}
            data-testid="jev-bridge-model-select"
          >
            {modelOptions.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
            label={t("jev.settings.bridgeProtocolLabel")}
            value={normalizeJevBridgeProtocol(draft.bridgeProtocol)}
            disabled={!activeProvider && !draft.providerId.trim()}
            onChange={(event) => setDraft((current) => ({
              ...current,
              bridgeProtocol: normalizeJevBridgeProtocol(event.target.value),
            }))}
            helperText={t("jev.settings.bridgeProtocolHelper")}
            data-testid="jev-bridge-protocol-select"
          >
            <MenuItem value="openai-chat">openai-chat（/v1/chat/completions）</MenuItem>
            <MenuItem value="openai-responses">openai-responses（/v1/responses）</MenuItem>
          </TextField>
          {draft.providerId.trim() && (
            <Alert severity="success">
              {t("jev.settings.bridgeActive", { provider: activeProvider?.providerName ?? draft.providerId, group: activeGroup?.groupName ?? draft.groupId, model: draft.model, protocol: normalizeJevBridgeProtocol(draft.bridgeProtocol) })}
            </Alert>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={draft.allowActiveTools}
                onChange={(event) => setDraft((current) => ({ ...current, allowActiveTools: event.target.checked }))}
                data-testid="jev-active-tools-switch"
              />
            }
            label={t("jev.settings.activeToolsLabel")}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            {t("jev.settings.activeToolsDesc")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {t("jev.settings.passiveTitle")}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={draft.autoNudge}
                onChange={(event) => setDraft((current) => ({ ...current, autoNudge: event.target.checked }))}
                data-testid="jev-autonudge-switch"
              />
            }
            label={t("jev.settings.autoNudgeLabel")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.planReview !== "off"}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  planReview: event.target.checked ? "created" : "off",
                }))}
                data-testid="jev-planreview-switch"
              />
            }
            label={t("jev.settings.planReviewLabel")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.reviewBrief}
                onChange={(event) => setDraft((current) => ({ ...current, reviewBrief: event.target.checked }))}
                data-testid="jev-brief-switch"
              />
            }
            label={t("jev.settings.briefLabel")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.reviewReport}
                onChange={(event) => setDraft((current) => ({ ...current, reviewReport: event.target.checked }))}
                data-testid="jev-report-switch"
              />
            }
            label={t("jev.settings.reportLabel")}
          />
          {draft.planReview !== "off" && (
            <TextField
              select
              size="small"
              label={t("jev.settings.planReviewTimingLabel")}
              value={draft.planReview}
              onChange={(event) => setDraft((current) => ({
                ...current,
                planReview: normalizePlanReviewMode(event.target.value, "created"),
              }))}
              helperText={t("jev.settings.planReviewTimingHelper")}
              data-testid="jev-planreview-mode"
              sx={{ maxWidth: 260 }}
            >
              {JEV_PLAN_REVIEW_OPTIONS.filter((option) => option.value !== "off").map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {t(`jev.planReview.${option.value}`)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {draft.autoNudge && (
            <TextField
              size="small"
              label={t("jev.settings.maxNudgesLabel")}
              type="number"
              value={draft.maxNudges}
              onChange={(event) => setDraft((current) => ({
                ...current,
                maxNudges: normalizeMaxJevNudges(Number(event.target.value)),
              }))}
              helperText={t("jev.settings.maxNudgesHelper", { max: JEV_MAX_AUTO_NUDGES })}
              data-testid="jev-maxnudges-input"
              sx={{ maxWidth: 220 }}
              slotProps={{ input: { inputProps: { min: 1, max: JEV_MAX_AUTO_NUDGES } } }}
            />
          )}
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button variant="outlined" size="small" onClick={() => void handleTest()} disabled={testing} data-testid="jev-test-button">
              {testing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
              {t("jev.settings.testButton")}
            </Button>
            {testResult && (
              <Typography
                variant="caption"
                color={testResult.startsWith("200 OK") ? "success.main" : "error.main"}
                data-testid="jev-test-result"
              >
                {testResult}
              </Typography>
            )}
          </Stack>
          {!draft.enabled && (
            <Alert severity="info">{t("jev.settings.disabledInfo")}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("jev.settings.cancel")}</Button>
        <Button variant="contained" onClick={handleSave} data-testid="jev-save-button">
          {t("jev.settings.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
