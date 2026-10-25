import { GroupOutlined, SettingsOutlined } from "@mui/icons-material";
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { AgentRosterRole, ProviderConfig } from "@codex-ui/shared";
import { useEffect, useState } from "react";
import { AgentRosterEditor } from "./AgentRosterEditor";

type AgentRosterSetupControlProps = {
  roles: AgentRosterRole[];
  providers: ProviderConfig[];
  models: Array<{ id?: string; model?: string; displayName?: string }>;
  defaultModel: string;
  onChange: (roles: AgentRosterRole[]) => void;
};

export function AgentRosterSetupControl({ roles, providers, models, defaultModel, onChange }: AgentRosterSetupControlProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AgentRosterRole[]>(roles);

  useEffect(() => {
    if (!open) setDraft(roles);
  }, [open, roles]);

  const openDialog = () => {
    setDraft(roles);
    setOpen(true);
  };
  const cancel = () => {
    setDraft(roles);
    setOpen(false);
  };
  const apply = () => {
    onChange(draft);
    setOpen(false);
  };

  return <>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between" sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <GroupOutlined color={roles.length ? "primary" : "disabled"} />
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 750 }}>协作角色</Typography>
          <Typography variant="caption" color="text.secondary">
            {roles.length === 0 ? "未启用，创建普通单人对话" : `已配置 ${roles.length} 个角色，可在对话中继续增减`}
          </Typography>
        </Stack>
        {roles.length > 0 && <Chip size="small" label={roles.length} color="primary" variant="outlined" />}
      </Stack>
      <Stack direction="row" spacing={1}>
        {roles.length > 0 && <Button size="small" color="error" onClick={() => onChange([])}>清空</Button>}
        <Button size="small" variant="outlined" startIcon={<SettingsOutlined />} onClick={openDialog}>{roles.length > 0 ? "编辑" : "添加角色"}</Button>
      </Stack>
    </Stack>
    <Dialog open={open} onClose={cancel} maxWidth="md" fullWidth data-testid="agent-roster-setup-dialog">
      <DialogTitle>配置协作角色</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>仅添加当前任务需要的角色。角色默认折叠，展开后可配置渠道、模型、目录与候选兜底。</Typography>
        <AgentRosterEditor roles={draft} providers={providers} models={models} defaultModel={defaultModel} onChange={setDraft} />
      </DialogContent>
      <DialogActions>
        {draft.length > 0 && <Button color="error" onClick={() => setDraft([])} sx={{ mr: "auto" }}>移除全部角色</Button>}
        <Button onClick={cancel}>取消</Button>
        <Button variant="contained" onClick={apply}>应用</Button>
      </DialogActions>
    </Dialog>
  </>;
}
