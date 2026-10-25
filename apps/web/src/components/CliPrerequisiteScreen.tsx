import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Stack,
  Typography
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TerminalIcon from "@mui/icons-material/Terminal";
import { useI18n } from "../i18n";

export type CliPrerequisites = {
  installDirectory: string;
  codex: { available: boolean; path?: string; version?: string };
  claude: { available: boolean; path?: string; version?: string };
  agy?: { available: boolean; path?: string; version?: string };
};

type Props = {
  onComplete: () => void;
};

const CODEX_ZIP_URL = "https://drive.google.com/file/d/1L9xIgVT-GLUxcQYtNor0mQbV22mR9gjV/view?usp=sharing";
const CODEX_INSTALL_COMMAND = 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"';
const CLAUDE_INSTALL_COMMAND = 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"';
const AGY_INSTALL_COMMAND = 'powershell -ExecutionPolicy ByPass -c "irm https://antigravity.google/cli/install.ps1 | iex"';

export function CliPrerequisiteScreen({ onComplete }: Props) {
  const { locale } = useI18n();
  const isCn = locale === "zh";
  const desktop = window.codexUltraDesktop;
  const [status, setStatus] = useState<CliPrerequisites | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState<"codex" | "claude" | "agy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [claudeSkipped, setClaudeSkipped] = useState(false);
  const [agySkipped, setAgySkipped] = useState(false);

  const check = useCallback(async () => {
    if (!desktop?.checkCliPrerequisites) return;
    setChecking(true);
    setError(null);
    try {
      const next = await desktop.checkCliPrerequisites();
      if (next) setStatus(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChecking(false);
    }
  }, [desktop]);

  useEffect(() => {
    void check();
  }, [check]);

  const codexReady = Boolean(status?.codex.available);
  const claudeReady = Boolean(status?.claude.available || claudeSkipped);
  const agyReady = Boolean(status?.agy?.available || agySkipped);
  const prerequisitesSatisfied = Boolean(claudeReady && agyReady);

  useEffect(() => {
    if (!prerequisitesSatisfied || installing || restartRequired) return;
    const timer = window.setTimeout(onComplete, 700);
    return () => window.clearTimeout(timer);
  }, [installing, onComplete, prerequisitesSatisfied, restartRequired]);

  const install = useCallback(async (kind: "codex" | "claude" | "agy") => {
    if (!desktop) return;
    setInstalling(kind);
    setError(null);
    try {
      const result = kind === "codex"
        ? await desktop.installCodexCli()
        : kind === "claude"
          ? await desktop.installClaudeCli()
          : (desktop.installAgyCli ? await desktop.installAgyCli() : { ok: false, error: "Installer not available" });
      if (!result.ok) {
        setError(result.error || (isCn ? "安装失败，请稍后重试" : "Installation failed. Please try again."));
        return;
      }
      setRestartRequired(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstalling(null);
    }
  }, [desktop, isCn]);

  const openExternal = useCallback((url: string) => {
    void desktop?.openExternal(url);
  }, [desktop]);

  const directory = status?.installDirectory || "codex-ultra.exe 同级目录";
  const title = isCn ? "检查命令行工具" : "Check command-line tools";
  const subtitle = isCn
    ? "内置 MiniAgent 开箱即用；Codex/Claude/Antigravity 均为可选外部 CLI，可安装也可跳过。"
    : "Built-in MiniAgent works out of the box. Codex, Claude and Antigravity are all optional.";

  const renderRow = useMemo(() => (kind: "codex" | "claude" | "agy", label: string, available: boolean, version?: string) => (
    <Stack direction="row" spacing={1.5} alignItems="flex-start" key={kind}>
      {available ? <CheckCircleIcon color="success" sx={{ mt: 0.3 }} /> : <TerminalIcon color="action" sx={{ mt: 0.3 }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{label}</Typography>
        {available ? (
          <Typography variant="body2" color="success.main">
            {isCn ? `已安装${version ? ` · ${version}` : ""}` : `Installed${version ? ` · ${version}` : ""}`}
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              {isCn ? "未检测到可用安装。" : "No usable installation was detected."}
            </Typography>
            <Box
              component="code"
              sx={{ px: 1, py: 0.75, borderRadius: 1, bgcolor: "action.hover", fontSize: 12, wordBreak: "break-all" }}
            >
              {kind === "codex" ? CODEX_INSTALL_COMMAND : kind === "claude" ? CLAUDE_INSTALL_COMMAND : AGY_INSTALL_COMMAND}
            </Box>
            <Button
              size="small"
              variant="contained"
              startIcon={installing === kind ? <CircularProgress size={15} color="inherit" /> : <DownloadIcon />}
              disabled={Boolean(installing) || restartRequired}
              onClick={() => void install(kind)}
              sx={{ alignSelf: "flex-start" }}
            >
              {installing === kind ? (isCn ? "安装中…" : "Installing…") : (isCn ? "同意并运行官方安装" : "Agree and run official installer")}
            </Button>
            {kind === "codex" ? (
              <Typography variant="caption" color="text.secondary">
                {isCn ? "也可以下载 codex-0.147.0.zip，解压到：" : "You can also download codex-0.147.0.zip and extract it to: "}
                <Box component="code" sx={{ wordBreak: "break-all" }}>{directory}</Box>
                <br />
                <Link component="button" type="button" onClick={() => openExternal(CODEX_ZIP_URL)}>
                  {isCn ? "下载压缩包" : "Download ZIP"}
                </Link>
              </Typography>
            ) : null}
          </Stack>
        )}
      </Box>
    </Stack>
  ), [directory, install, installing, isCn, openExternal, restartRequired]);

  return (
    <Dialog open fullWidth maxWidth="sm" data-testid="cli-prerequisite-screen" disableEscapeKeyDown>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
          {checking && !status ? <Stack alignItems="center" sx={{ py: 2 }}><CircularProgress size={28} /></Stack> : null}
          {status ? (
            <Stack spacing={2}>
              {renderRow("codex", "Codex CLI", status.codex.available, status.codex.version)}
              <Divider />
              {renderRow("claude", "Claude CLI", status.claude.available, status.claude.version)}
              <Divider />
              {renderRow("agy", "Antigravity CLI (AGY)", Boolean(status.agy?.available), status.agy?.version)}
            </Stack>
          ) : null}
          {prerequisitesSatisfied ? (
            <Alert severity="success">
              {status?.codex.available && status?.claude.available && status?.agy?.available
                ? (isCn ? "所有 CLI 组件均已安装，正在继续…" : "All CLI tools are installed. Continuing…")
                : (isCn ? "组件已就绪，正在继续…" : "Required tools ready. Continuing…")}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {restartRequired ? <Alert severity="success">{isCn ? "安装完成，请重启 Codex Ultra。" : "Installation complete. Please restart Codex Ultra."}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!prerequisitesSatisfied && !restartRequired ? <Button onClick={() => void check()} disabled={checking}>{isCn ? "重新检测" : "Check again"}</Button> : null}
        {status && !status.claude.available && !claudeSkipped && !restartRequired ? (
          <Button onClick={() => setClaudeSkipped(true)}>{isCn ? "暂不安装 Claude CLI" : "Skip Claude CLI"}</Button>
        ) : null}
        {status && !status.agy?.available && !agySkipped && !restartRequired ? (
          <Button onClick={() => setAgySkipped(true)}>{isCn ? "暂不安装 Antigravity" : "Skip Antigravity"}</Button>
        ) : null}
        {restartRequired ? <Button variant="contained" startIcon={<RestartAltIcon />} onClick={() => void desktop?.restartApp()}>{isCn ? "重启 Codex Ultra" : "Restart Codex Ultra"}</Button> : null}
      </DialogActions>
    </Dialog>
  );
}
