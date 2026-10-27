import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  createTheme
} from "@mui/material";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import FlagIcon from "@mui/icons-material/Flag";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import RefreshIcon from "@mui/icons-material/Refresh";
import { CliBackendPicker } from "../../apps/web/src/components/CliBackendPicker";
import { FreeModelAccessDialog } from "../../apps/web/src/components/FreeModelAccessDialog";

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

function renderDialog(element: React.ReactElement): string {
  return renderToStaticMarkup(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
}

const t = (k: string, params?: Record<string, any>) => {
  if (k === "app.cliSwitchConfirmBody") {
    return `确定要切换至 ${params?.backend} ${params?.version} 引擎吗？`;
  }
  return k;
};

// ---------------------------------------------------------------------------
// 1. Danger New Chat Dialog (危险新会话弹窗)
// ---------------------------------------------------------------------------

function renderDangerDialog(props: {
  open?: boolean;
  acknowledged?: boolean;
  busy?: boolean;
  workspaceMode?: "local" | "ssh";
  cwd?: string;
  sshCwd?: string;
  sshCommand?: string;
  additionalRoots?: string[];
  onConfirm?: () => void;
  onUseSaferMode?: () => void;
  onClose?: () => void;
}) {
  const {
    open = true,
    acknowledged = false,
    busy = false,
    workspaceMode = "local",
    cwd = "/workspace/project",
    sshCwd = "/home/remote/project",
    sshCommand = "ssh remote-server",
    additionalRoots = [],
    onConfirm = () => {},
    onUseSaferMode = () => {},
    onClose = () => {}
  } = props;

  return renderDialog(
    <Dialog
      data-testid="danger-new-chat-dialog"
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <ErrorOutlineIcon color="primary" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="span" variant="h6" sx={{ fontWeight: 850 }}>
              Full Auto / Danger Bypass
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Bypass sandbox and approval gates
            </Typography>
          </Box>
          <Chip size="small" color="success" variant="outlined" label="DANGER" />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert icon={<ErrorOutlineIcon fontSize="inherit" />} severity="info">
            Full Auto allows agent to execute commands and write files without interactive confirmations.
          </Alert>
          <Box data-testid="danger-new-chat-details">
            <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>
              Workspace Configuration
            </Typography>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <ToggleButtonGroup size="small" exclusive value={workspaceMode}>
                <ToggleButton value="local">Local</ToggleButton>
                <ToggleButton value="ssh">SSH</ToggleButton>
              </ToggleButtonGroup>
              {workspaceMode === "ssh" && (
                <TextField size="small" label="SSH Command" value={sshCommand} />
              )}
              <TextField
                size="small"
                label={workspaceMode === "ssh" ? "Remote Folder" : "Working Directory"}
                value={workspaceMode === "ssh" ? sshCwd : cwd}
              />
              <Button variant="outlined" startIcon={<FolderOpenIcon />}>
                Browse
              </Button>
              {workspaceMode === "local" && (
                <Button variant="outlined" disabled={busy}>
                  Add Additional Root
                </Button>
              )}
            </Box>
            {workspaceMode === "local" && additionalRoots.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption">Additional Roots ({additionalRoots.length})</Typography>
                <Stack direction="row" spacing={0.75} data-testid="danger-new-chat-additional-roots-list">
                  {additionalRoots.map((root) => (
                    <Chip key={root} size="small" label={root} onDelete={() => {}} />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
          <FormControlLabel
            control={<Checkbox checked={acknowledged} inputProps={{ "aria-label": "Confirm Danger Bypass" }} />}
            label="I acknowledge the risks of running in Full Auto mode without sandbox"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="inherit" onClick={onUseSaferMode}>
          Use Safer Mode (Ask Always)
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!acknowledged || busy}
          onClick={onConfirm}
        >
          {busy ? <CircularProgress color="inherit" size={18} /> : "Create Full Auto Chat"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

test("Danger New Chat Dialog renders warnings and disables Create button when unacknowledged", () => {
  const html = renderDangerDialog({ acknowledged: false });

  expect(html).toContain('data-testid="danger-new-chat-dialog"');
  expect(html).toContain("Full Auto / Danger Bypass");
  expect(html).toContain("Bypass sandbox and approval gates");
  expect(html).toContain("I acknowledge the risks");
  expect(html).toContain("Create Full Auto Chat");
  // When not acknowledged, the button MUST have disabled attribute
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Create Full Auto Chat<\/button>/s);
});

test("Danger New Chat Dialog enables Create button when acknowledged", () => {
  const html = renderDangerDialog({ acknowledged: true });

  // Acknowledged and not busy -> button is NOT disabled
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Create Full Auto Chat<\/button>/s);
  expect(html).toContain("Create Full Auto Chat");
});

test("Danger New Chat Dialog displays loading indicator and disables actions during workspace setup busy", () => {
  const html = renderDangerDialog({ acknowledged: true, busy: true });

  // Busy state -> circular progress rendered and button disabled
  expect(html).toContain("MuiCircularProgress-root");
  expect(html).not.toContain("Create Full Auto Chat");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*MuiCircularProgress-root.*<\/button>/s);
});

test("Danger New Chat Dialog switches between Local and SSH workspace modes", () => {
  const localHtml = renderDangerDialog({
    workspaceMode: "local",
    cwd: "D:\\projects\\codex-ultra",
    additionalRoots: ["E:\\projects\\sci", "F:\\projects\\extra"]
  });

  expect(localHtml).toContain("Working Directory");
  expect(localHtml).toContain("D:\\projects\\codex-ultra");
  expect(localHtml).toContain("Add Additional Root");
  expect(localHtml).toContain("Additional Roots (2)");
  expect(localHtml).toContain("E:\\projects\\sci");
  expect(localHtml).toContain("F:\\projects\\extra");
  expect(localHtml).not.toContain("SSH Command");

  const sshHtml = renderDangerDialog({
    workspaceMode: "ssh",
    sshCwd: "/home/vscode/sci",
    sshCommand: "ssh vscode@45.129.8.163"
  });

  expect(sshHtml).toContain("SSH Command");
  expect(sshHtml).toContain("ssh vscode@45.129.8.163");
  expect(sshHtml).toContain("Remote Folder");
  expect(sshHtml).toContain("/home/vscode/sci");
  expect(sshHtml).not.toContain("Add Additional Root");
});

// ---------------------------------------------------------------------------
// 2. CLI Switcher Dialog (引擎切换确认弹窗)
// ---------------------------------------------------------------------------

function renderCliSwitchDialog(props: {
  target?: { backend: "codex" | "claude"; version?: string | null } | null;
  busy?: boolean;
  error?: string | null;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  const {
    target = { backend: "claude", version: "0.146.0" },
    busy = false,
    error = null,
    onCancel = () => {},
    onConfirm = () => {}
  } = props;

  return renderDialog(
    <Dialog
      data-testid="cli-switch-confirm-dialog"
      open={Boolean(target)}
      onClose={() => { if (!busy) onCancel(); }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{t("app.cliSwitchConfirmTitle")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            {t("app.cliSwitchConfirmBody", {
              backend: target?.backend === "claude" ? "Claude" : "Codex",
              version: target?.version ? `v${target.version}` : ""
            })}
          </Typography>
          <Alert severity="warning" variant="outlined">{t("app.cliSwitchConfirmWarning")}</Alert>
          {error && <Alert severity="error" variant="filled">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onCancel}>
          {t("app.cliSwitchConfirmCancel")}
        </Button>
        <Button
          data-testid="cli-switch-confirm-button"
          variant="contained"
          color="warning"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "正在切换引擎..." : t("app.cliSwitchConfirmAccept")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

test("CLI Switcher Dialog renders target engine info and warning", () => {
  const html = renderCliSwitchDialog({
    target: { backend: "claude", version: "2.1.0" }
  });

  expect(html).toContain('data-testid="cli-switch-confirm-dialog"');
  expect(html).toContain("确定要切换至 Claude v2.1.0 引擎吗？");
  expect(html).toContain("app.cliSwitchConfirmWarning");
  expect(html).toContain('data-testid="cli-switch-confirm-button"');
});

test("CLI Switcher Dialog renders error banner and busy disabling", () => {
  const errorHtml = renderCliSwitchDialog({
    error: "Failed to connect to local Claude CLI daemon on port 48000"
  });
  expect(errorHtml).toContain("Failed to connect to local Claude CLI daemon on port 48000");

  const busyHtml = renderCliSwitchDialog({ busy: true });
  expect(busyHtml).toContain("正在切换引擎...");
  expect(busyHtml).toMatch(/<button[^>]*disabled=""[^>]*>.*正在切换引擎...<\/button>/s);
});

// ---------------------------------------------------------------------------
// 3. SSH Install Dialog (SSH 远程环境依赖安装弹窗)
// ---------------------------------------------------------------------------

function renderSshInstallDialog(props: {
  connected?: boolean;
  os?: string;
  arch?: string;
  reasons?: string[];
  command?: string;
  confirming?: boolean;
  busy?: boolean;
  error?: string | null;
}) {
  const {
    connected = true,
    os = "Linux",
    arch = "x86_64",
    reasons = ["Codex binary not found in PATH on remote host"],
    command = "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    confirming = false,
    busy = false,
    error = null
  } = props;

  return renderDialog(
    <Dialog
      data-testid="ssh-codex-install-dialog"
      open={true}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>SSH Codex Installation</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Alert severity={connected ? "warning" : "error"}>
            {connected ? "Codex installation required on remote host" : "SSH connection required before install"}
          </Alert>
          <Stack direction="row" spacing={1}>
            <Chip label={`Remote OS: ${os}`} />
            <Chip label={`Remote Arch: ${arch}`} />
          </Stack>
          {reasons.map((r) => (
            <Typography key={r} variant="body2" color="text.secondary">• {r}</Typography>
          ))}
          {!connected ? (
            <Alert severity="info">Please check SSH host credentials, keys and network route.</Alert>
          ) : command ? (
            <TextField
              label="SSH Installation Command"
              value={command}
              multiline
              minRows={2}
              InputProps={{ readOnly: true }}
            />
          ) : (
            <Alert severity="error">Unsupported remote platform architecture.</Alert>
          )}
          {confirming && (
            <Alert severity="error">
              Installing will download and run the installer on the remote system. Proceed?
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy}>Cancel</Button>
        <Button disabled={busy} startIcon={busy ? <CircularProgress size={16} /> : <RefreshIcon />}>
          Recheck
        </Button>
        {connected && command && !confirming && (
          <Button variant="contained" disabled={busy}>Install</Button>
        )}
        {connected && command && confirming && (
          <Button color="error" variant="contained" disabled={busy}>
            Confirm Remote Installation
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

test("SSH Install Dialog renders unconnected guidance when remote node is unreachable", () => {
  const html = renderSshInstallDialog({
    connected: false,
    os: "Unknown",
    arch: "Unknown",
    reasons: ["Connection timed out to 45.129.8.163:22"]
  });

  expect(html).toContain('data-testid="ssh-codex-install-dialog"');
  expect(html).toContain("SSH connection required before install");
  expect(html).toContain("Connection timed out to 45.129.8.163:22");
  expect(html).toContain("Please check SSH host credentials");
  expect(html).not.toContain("SSH Installation Command");
});

test("SSH Install Dialog renders installation command, chips, confirmation step, and errors", () => {
  const connectedHtml = renderSshInstallDialog({
    connected: true,
    os: "Linux",
    arch: "x86_64",
    command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    confirming: false
  });

  expect(connectedHtml).toContain("Remote OS: Linux");
  expect(connectedHtml).toContain("Remote Arch: x86_64");
  expect(connectedHtml).toContain("curl -fsSL https://chatgpt.com/codex/install.sh | sh");
  expect(connectedHtml).toContain("Install");

  const confirmingHtml = renderSshInstallDialog({
    connected: true,
    confirming: true
  });
  expect(confirmingHtml).toContain("Installing will download and run the installer on the remote system");
  expect(confirmingHtml).toContain("Confirm Remote Installation");

  const errorHtml = renderSshInstallDialog({
    connected: true,
    error: "Remote permission denied: cannot write to /usr/local/bin"
  });
  expect(errorHtml).toContain("Remote permission denied: cannot write to /usr/local/bin");
});

// ---------------------------------------------------------------------------
// 4. Plan & Goal Dialogs (计划采纳与目标恢复弹窗)
// ---------------------------------------------------------------------------

test("Plan Implementation Dialog renders execution plan checklist and choice buttons", () => {
  const planText = "1. Update schema\n2. Add migration\n3. Run validation tests";
  const html = renderDialog(
    <Dialog open={true} maxWidth="sm" fullWidth data-testid="plan-implementation-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <ChecklistIcon color="primary" />
        Implement this plan?
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          The plan is ready. Start implementation in Default mode, or stay in Plan mode to revise it.
        </Typography>
        <Box component="pre" data-testid="plan-text-content">
          {planText}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button>Cancel and stay in Plan mode</Button>
        <Button variant="contained">Yes, implement this plan</Button>
      </DialogActions>
    </Dialog>
  );

  expect(html).toContain('data-testid="plan-implementation-dialog"');
  expect(html).toContain("Implement this plan?");
  expect(html).toContain("1. Update schema");
  expect(html).toContain("2. Add migration");
  expect(html).toContain("Cancel and stay in Plan mode");
  expect(html).toContain("Yes, implement this plan");
});

test("Goal Resume Dialog renders objective description and resume controls", () => {
  const objective = "Refactor all database queries to use parameterized prepared statements";
  const html = renderDialog(
    <Dialog open={true} maxWidth="sm" fullWidth data-testid="goal-resume-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <FlagIcon color="success" />
        Resume active goal?
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          An ongoing goal was found for this thread.
        </Typography>
        <Box data-testid="goal-objective-box">
          <Typography variant="caption">Objective</Typography>
          <Typography variant="body2">{objective}</Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button color="warning">Keep paused</Button>
        <Button color="success" variant="contained">Resume goal</Button>
      </DialogActions>
    </Dialog>
  );

  expect(html).toContain('data-testid="goal-resume-dialog"');
  expect(html).toContain("Resume active goal?");
  expect(html).toContain(objective);
  expect(html).toContain("Keep paused");
  expect(html).toContain("Resume goal");
});

// ---------------------------------------------------------------------------
// 5. Relay Share Export & Import Dialogs (中转配置分享/导入)
// ---------------------------------------------------------------------------

test("Relay Share Export Dialog handles password validation, busy progress, and export text", () => {
  const idleHtml = renderDialog(
    <Dialog open={true} fullWidth maxWidth="sm" data-testid="relay-share-export-dialog">
      <DialogTitle>分享中转站</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <TextField label="分享密码" type="password" value="" />
          <TextField label="确认密码" type="password" value="" />
          <Button variant="contained">生成分享内容</Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
  expect(idleHtml).toContain("分享中转站");
  expect(idleHtml).toContain("生成分享内容");

  const busyHtml = renderDialog(
    <Dialog open={true} fullWidth maxWidth="sm">
      <DialogTitle>分享中转站</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Button variant="contained" disabled={true}>正在生成分享内容…</Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
  expect(busyHtml).toContain("正在生成分享内容…");
  expect(busyHtml).toMatch(/<button[^>]*disabled=""[^>]*>.*正在生成分享内容…<\/button>/s);

  const errorHtml = renderDialog(
    <Dialog open={true} fullWidth maxWidth="sm">
      <DialogTitle>分享中转站</DialogTitle>
      <DialogContent dividers>
        <Alert severity="error">两次输入的密码不一致</Alert>
      </DialogContent>
    </Dialog>
  );
  expect(errorHtml).toContain("两次输入的密码不一致");
});

test("Relay Share Import Dialog disables submit on empty input and renders errors", () => {
  const emptyHtml = renderDialog(
    <Dialog open={true} fullWidth maxWidth="sm" data-testid="relay-share-import-dialog">
      <DialogTitle>导入分享中转站</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <TextField label="分享内容" value="" multiline />
          <TextField label="分享密码" type="password" value="" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button>取消</Button>
        <Button variant="contained" disabled={true}>直接导入</Button>
      </DialogActions>
    </Dialog>
  );
  expect(emptyHtml).toContain("导入分享中转站");
  expect(emptyHtml).toMatch(/<button[^>]*disabled=""[^>]*>.*直接导入<\/button>/s);

  const errorHtml = renderDialog(
    <Dialog open={true} fullWidth maxWidth="sm">
      <DialogTitle>导入分享中转站</DialogTitle>
      <DialogContent dividers>
        <Alert severity="error">解密失败：密码错误或分享内容已损坏</Alert>
      </DialogContent>
    </Dialog>
  );
  expect(errorHtml).toContain("解密失败：密码错误或分享内容已损坏");
});

// ---------------------------------------------------------------------------
// 6. Free Model Access Dialog (免费模型访问弹窗组件)
// ---------------------------------------------------------------------------

test("FreeModelAccessDialog renders synced models indicator and Discord CTA", () => {
  const html = renderDialog(
    <FreeModelAccessDialog
      open={true}
      token="test-token"
      syncedModels={["gpt-5.6-luna", "deepseek-v3-free", "claude-3-5-sonnet-free"]}
      onClose={() => {}}
      onOpenDiscord={() => {}}
      onSync={async () => ({ ok: true, providerId: "omniroute-free", importedCount: 3, models: [] })}
    />
  );

  expect(html).toContain('data-testid="free-model-access-dialog"');
  expect(html).toContain("刷新 CodexUltraFree 免费模型");
  expect(html).toContain("加入 Discord 群了解详情");
  expect(html).toContain("已同步 3 个真实模型");
  expect(html).toContain("稍后");
  expect(html).toContain("确定并同步");
});

test("CLI backend picker exposes workspace/new-chat choices", () => {
  const html = renderDialog(
    <CliBackendPicker
      value="codex"
      onChange={() => undefined}
      testId="workspace-cli-backend-toggle"
      codexEnabled
      agyEnabled
      grokEnabled
      opencodeEnabled
    />
  );
  expect(html).toContain('data-testid="workspace-cli-backend-toggle"');
  expect(html).toContain("Codex");
  expect(html).toContain("Antigravity");
  expect(html).toContain("Grok");
  expect(html).toContain("OpenCode");
  expect(html).toContain("Mini");
});

