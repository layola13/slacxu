import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { AgentRosterRole, ProviderConfig, ThreadAgentRoster } from "@codex-ui/shared";
import { fetchThreadAgentRoster, runThreadAgentMemberAction, saveThreadAgentRoster, type ModelEntry, type ThreadAgentMemberAction } from "../state/codexClient";
import { AgentRosterEditor } from "./AgentRosterEditor";

type AgentRosterManagerDialogProps = {
  open: boolean;
  token: string;
  threadId: string | null;
  providers: ProviderConfig[];
  models: ModelEntry[];
  defaultModel: string;
  onClose: () => void;
};

export function AgentRosterManagerDialog({ open, token, threadId, providers, models, defaultModel, onClose }: AgentRosterManagerDialogProps) {
  const [roster, setRoster] = useState<ThreadAgentRoster | null>(null);
  const [roles, setRoles] = useState<AgentRosterRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!open || !threadId || !token) return;
    if (!quiet) setLoading(true);
    try {
      const next = await fetchThreadAgentRoster(token, threadId);
      setRoster(next);
      if (!quiet) setRoles(next.roles);
      setError(null);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [open, threadId, token]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => window.clearInterval(timer);
  }, [load, open]);

  const save = async () => {
    if (!threadId) return;
    setBusyKey("save");
    try {
      const next = await saveThreadAgentRoster(token, threadId, roles, { startImmediate: true });
      setRoster(next);
      setRoles(next.roles);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey(null);
    }
  };

  const run = async (memberId: string, action: ThreadAgentMemberAction) => {
    if (!threadId) return;
    setBusyKey(`${memberId}:${action}`);
    try {
      const next = await runThreadAgentMemberAction(token, threadId, memberId, action);
      setRoster(next);
      setRoles(next.roles);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey(null);
    }
  };

  const unavailable = roster?.members.filter((member) => member.health && member.health.availability !== "online") ?? [];
  return <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth data-testid="agent-roster-manager-dialog">
    <DialogTitle>管理协作成员</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">随时增减角色或调整候选线路。退出成员会保留历史；替换会创建新的成员记录。</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {unavailable.map((member) => <Alert key={member.id} severity={member.health?.availability === "offline" ? "error" : "warning"}>
          <b>{member.name}</b> {member.health?.availability === "offline" ? "已下线" : "运行降级"}
          {member.health?.code != null ? ` (${member.health.code})` : ""}：{member.health?.message || "渠道暂时不可用"}
          {member.activeFallbackId ? `；当前由候选 ${member.activeFallbackId} 接管。` : "；尚无可用候选接管。"}
        </Alert>)}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>角色配置</Typography>
          <AgentRosterEditor roles={roles} providers={providers} models={models} defaultModel={defaultModel} onChange={setRoles} />
        </Box>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>成员状态</Typography>
          {loading && <CircularProgress size={20} />}
          {!loading && (roster?.members.length ?? 0) === 0 && <Typography variant="caption" color="text.secondary">尚未配置协作成员。</Typography>}
          <Stack spacing={1}>
            {roster?.members.map((member) => <Box key={member.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                <Typography sx={{ fontWeight: 750, minWidth: 130 }}>{member.name}</Typography>
                <Chip size="small" label={member.status} color={member.status === "offline" || member.status === "failed" ? "error" : member.status === "paused" || member.status === "exited" ? "default" : "success"} />
                <Typography variant="caption" sx={{ flex: 1 }}>{member.providerId || "继承渠道"} / {member.model || "继承模型"}{member.activeFallbackId ? ` · fallback: ${member.activeFallbackId}` : ""}</Typography>
                {(["configured", "failed", "offline", "exited"].includes(member.status)) && <Button size="small" disabled={busyKey !== null} onClick={() => void run(member.id, member.status === "exited" ? "replace" : "retry")}>{member.status === "exited" ? "替换" : "重试"}</Button>}
                {member.status === "paused" && <Button size="small" disabled={busyKey !== null} onClick={() => void run(member.id, "resume")}>恢复</Button>}
                {!["paused", "exited"].includes(member.status) && <Button size="small" disabled={busyKey !== null} onClick={() => void run(member.id, "pause")}>暂停</Button>}
                {member.status !== "exited" && <Button size="small" color="warning" disabled={busyKey !== null} onClick={() => void run(member.id, "exit")}>退出</Button>}
                {member.status !== "exited" && <Button size="small" color="error" disabled={busyKey !== null} onClick={() => void run(member.id, "force-exit")}>强退</Button>}
              </Stack>
            </Box>)}
          </Stack>
        </Box>
      </Stack>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>关闭</Button><Button variant="contained" disabled={busyKey !== null} onClick={() => void save()}>{busyKey === "save" ? <CircularProgress size={18} /> : "保存并应用"}</Button></DialogActions>
  </Dialog>;
}
