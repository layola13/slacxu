import {
  Add,
  ArrowDownward,
  ArrowUpward,
  Close,
  DeleteOutline,
  ExpandMore
} from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import type { AgentRoleFallback, AgentRosterRole, ProviderConfig } from "@codex-ui/shared";

export type AgentRosterEditorProps = {
  roles: AgentRosterRole[];
  providers: ProviderConfig[];
  models: Array<{ id?: string; model?: string; displayName?: string }>;
  defaultModel: string;
  onChange: (roles: AgentRosterRole[]) => void;
  labels?: Partial<Record<LabelKey, string>>;
};

type LabelKey = "role" | "responsibility" | "channel" | "group" | "model" | "reasoning" | "workspace" | "fallback" | "addFallback";

const efforts = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const copy = (role: AgentRosterRole, patch: Partial<AgentRosterRole>): AgentRosterRole => ({ ...role, ...patch });
const fallbackCopy = (entry: AgentRoleFallback, patch: Partial<AgentRoleFallback>): AgentRoleFallback => ({ ...entry, ...patch });

export function AgentRosterEditor({ roles, providers, models, defaultModel, onChange, labels = {} }: AgentRosterEditorProps) {
  const label = (key: LabelKey, fallback: string) => labels[key] ?? fallback;
  const updateRole = (id: string, patch: Partial<AgentRosterRole>) => onChange(roles.map((role) => role.id === id ? copy(role, patch) : role));
  const removeRole = (id: string) => onChange(roles.filter((role) => role.id !== id));
  const addRole = () => onChange([...roles, {
    id: `role-${Date.now().toString(36)}`,
    name: `角色 ${roles.length + 1}`,
    responsibility: "",
    model: defaultModel,
    reasoningEffort: "",
    instanceCount: 1,
    startPolicy: "onDemand",
    runtime: "native",
    enabled: true,
    fallbacks: []
  }]);
  const addFallback = (role: AgentRosterRole) => updateRole(role.id, {
    fallbacks: [...(role.fallbacks ?? []), {
      id: `fallback-${Date.now().toString(36)}`,
      label: `候选 ${(role.fallbacks?.length ?? 0) + 1}`,
      model: defaultModel,
      reasoningEffort: "",
      workspace: { mode: "inherit", cwd: "", workspaceMode: "local" }
    }]
  });
  const updateFallback = (role: AgentRosterRole, id: string, patch: Partial<AgentRoleFallback>) => updateRole(role.id, {
    fallbacks: (role.fallbacks ?? []).map((entry) => entry.id === id ? fallbackCopy(entry, patch) : entry)
  });
  const moveFallback = (role: AgentRosterRole, index: number, delta: number) => {
    const next = [...(role.fallbacks ?? [])];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateRole(role.id, { fallbacks: next });
  };

  return <Stack spacing={1.25}>
    {roles.length === 0 && <Box sx={{ py: 3, textAlign: "center", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1 }}>
      <Typography variant="body2" color="text.secondary">当前对话不使用协作角色</Typography>
    </Box>}
    {roles.map((role, roleIndex) => {
      const provider = providers.find((entry) => entry.id === role.providerId);
      const group = provider?.groups?.find((entry) => entry.id === role.groupId);
      const routeSummary = [provider?.name ?? "继承渠道", group?.name, role.model || "继承模型"].filter(Boolean).join(" · ");
      return <Accordion key={role.id} disableGutters defaultExpanded={roleIndex === roles.length - 1} sx={{ border: 1, borderColor: "divider", borderRadius: "4px !important", boxShadow: "none", "&::before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 52, "& .MuiAccordionSummary-content": { minWidth: 0, alignItems: "center", gap: 1 } }}>
          <Checkbox
            size="small"
            checked={role.enabled}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateRole(role.id, { enabled: event.target.checked })}
            inputProps={{ "aria-label": `${role.name} 是否启用` }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 750 }} noWrap>{role.name || `角色 ${roleIndex + 1}`}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{routeSummary}</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" }, whiteSpace: "nowrap" }}>
            {role.instanceCount ?? 1} 个实例{(role.fallbacks?.length ?? 0) > 0 ? ` · ${role.fallbacks?.length} 条候选` : ""}
          </Typography>
          <Tooltip title="删除角色">
            <IconButton
              size="small"
              color="error"
              onClick={(event) => { event.stopPropagation(); removeRole(role.id); }}
              aria-label={`删除 ${role.name || `角色 ${roleIndex + 1}`}`}
            >
              <DeleteOutline fontSize="small" />
            </IconButton>
          </Tooltip>
        </AccordionSummary>
        <AccordionDetails sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr)" }, gap: 1 }}>
            <TextField size="small" label={label("role", "角色名称")} value={role.name} onChange={(event) => updateRole(role.id, { name: event.target.value })} />
            <FormControl size="small"><Select displayEmpty value={role.providerId ?? ""} onChange={(event) => updateRole(role.id, { providerId: String(event.target.value) || null, groupId: null })}><MenuItem value="">{label("channel", "继承主对话渠道")}</MenuItem>{providers.map((entry) => <MenuItem key={entry.id} value={entry.id}>{entry.name}</MenuItem>)}</Select></FormControl>
            <FormControl size="small"><Select displayEmpty value={role.groupId ?? ""} disabled={!role.providerId} onChange={(event) => updateRole(role.id, { groupId: String(event.target.value) || null })}><MenuItem value="">{label("group", "继承分组")}</MenuItem>{(provider?.groups ?? []).filter((entry) => entry.kind !== "image").map((entry) => <MenuItem key={entry.id} value={entry.id}>{entry.name}</MenuItem>)}</Select></FormControl>
            <FormControl size="small"><Select displayEmpty value={role.model || ""} onChange={(event) => updateRole(role.id, { model: String(event.target.value) })}><MenuItem value="">{label("model", "继承主对话模型")}</MenuItem>{models.map((entry) => { const value = entry.model ?? entry.id ?? ""; return <MenuItem key={value} value={value}>{entry.displayName ?? value}</MenuItem>; })}</Select></FormControl>
            <FormControl size="small"><Select displayEmpty value={role.reasoningEffort} onChange={(event) => updateRole(role.id, { reasoningEffort: String(event.target.value) })}>{efforts.map((effort) => <MenuItem key={effort} value={effort}>{effort || "继承思考强度"}</MenuItem>)}</Select></FormControl>
            <TextField size="small" type="number" label="实例数" inputProps={{ min: 1, max: 12 }} value={role.instanceCount ?? 1} onChange={(event) => updateRole(role.id, { instanceCount: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} />
          </Box>
          <TextField fullWidth size="small" multiline minRows={2} sx={{ mt: 1 }} label={label("responsibility", "职责说明")} value={role.responsibility} onChange={(event) => updateRole(role.id, { responsibility: event.target.value })} />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5, mb: 0.75 }}>运行与工作目录</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
            <FormControl size="small"><Select value={role.startPolicy ?? "onDemand"} onChange={(event) => updateRole(role.id, { startPolicy: String(event.target.value) as "onDemand" | "immediate" })}><MenuItem value="onDemand">按需启动</MenuItem><MenuItem value="immediate">立即启动</MenuItem></Select></FormControl>
            <FormControl size="small"><Select value={role.runtime ?? "native"} onChange={(event) => updateRole(role.id, { runtime: String(event.target.value) as "native" | "independent" })}><MenuItem value="native">原生 Agent</MenuItem><MenuItem value="independent">独立线程</MenuItem></Select></FormControl>
            <FormControl size="small"><Select value={role.workspace?.mode ?? "inherit"} onChange={(event) => updateRole(role.id, { workspace: { ...role.workspace, mode: String(event.target.value) as "inherit" | "shared" | "private", cwd: role.workspace?.cwd ?? "", workspaceMode: role.workspace?.workspaceMode ?? "local" } })}><MenuItem value="inherit">继承主目录</MenuItem><MenuItem value="shared">共享目录</MenuItem><MenuItem value="private">独立目录</MenuItem></Select></FormControl>
            <FormControl size="small"><Select value={role.workspace?.workspaceMode ?? "local"} onChange={(event) => updateRole(role.id, { workspace: { ...role.workspace, mode: role.workspace?.mode ?? "inherit", cwd: role.workspace?.cwd ?? "", workspaceMode: String(event.target.value) as "local" | "ssh" } })}><MenuItem value="local">本地</MenuItem><MenuItem value="ssh">SSH</MenuItem></Select></FormControl>
            <TextField size="small" label={label("workspace", "工作目录")} value={role.workspace?.cwd ?? ""} onChange={(event) => updateRole(role.id, { workspace: { ...role.workspace, mode: role.workspace?.mode ?? "inherit", cwd: event.target.value, workspaceMode: role.workspace?.workspaceMode ?? "local" } })} />
            {role.workspace?.workspaceMode === "ssh" && <TextField size="small" label="SSH 命令" value={role.workspace?.sshCommand ?? ""} onChange={(event) => updateRole(role.id, { workspace: { ...role.workspace, mode: role.workspace?.mode ?? "inherit", cwd: role.workspace?.cwd ?? "", workspaceMode: "ssh", sshCommand: event.target.value } })} />}
            <TextField size="small" label="附加目录（每行一个）" multiline value={(role.workspace?.additionalRoots ?? []).join("\n")} onChange={(event) => updateRole(role.id, { workspace: { ...role.workspace, mode: role.workspace?.mode ?? "inherit", cwd: role.workspace?.cwd ?? "", workspaceMode: role.workspace?.workspaceMode ?? "local", additionalRoots: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) } })} />
          </Box>
          <Stack spacing={0.75} sx={{ mt: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" sx={{ fontWeight: 750 }}>{label("fallback", "候选兜底（按顺序接管）")}</Typography>
              <Button size="small" startIcon={<Add />} onClick={() => addFallback(role)}>{label("addFallback", "添加候选")}</Button>
            </Stack>
            {(role.fallbacks ?? []).map((entry, index) => <Accordion key={entry.id} disableGutters sx={{ boxShadow: "none", border: 1, borderColor: "divider", "&::before": { display: "none" } }}>
              <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 44 }}>
                <Typography variant="body2" sx={{ flex: 1 }}>{index + 1}. {entry.label || `候选 ${index + 1}`}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>{entry.model || "继承模型"}</Typography>
                <IconButton size="small" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveFallback(role, index, -1); }} aria-label="上移候选"><ArrowUpward fontSize="small" /></IconButton>
                <IconButton size="small" disabled={index === (role.fallbacks?.length ?? 1) - 1} onClick={(event) => { event.stopPropagation(); moveFallback(role, index, 1); }} aria-label="下移候选"><ArrowDownward fontSize="small" /></IconButton>
                <IconButton size="small" color="error" onClick={(event) => { event.stopPropagation(); updateRole(role.id, { fallbacks: (role.fallbacks ?? []).filter((item) => item.id !== entry.id) }); }} aria-label="删除候选"><Close fontSize="small" /></IconButton>
              </AccordionSummary>
              <AccordionDetails sx={{ borderTop: 1, borderColor: "divider" }}>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
                  <TextField size="small" label="候选名称" value={entry.label} onChange={(event) => updateFallback(role, entry.id, { label: event.target.value })} />
                  <FormControl size="small"><Select displayEmpty value={entry.providerId ?? ""} onChange={(event) => updateFallback(role, entry.id, { providerId: String(event.target.value) || null, groupId: null })}><MenuItem value="">继承角色渠道</MenuItem>{providers.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small"><Select displayEmpty value={entry.groupId ?? ""} disabled={!entry.providerId} onChange={(event) => updateFallback(role, entry.id, { groupId: String(event.target.value) || null })}><MenuItem value="">继承角色分组</MenuItem>{(providers.find((item) => item.id === entry.providerId)?.groups ?? []).filter((item) => item.kind !== "image").map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small"><Select displayEmpty value={entry.model || ""} onChange={(event) => updateFallback(role, entry.id, { model: String(event.target.value) })}><MenuItem value="">继承角色模型</MenuItem>{models.map((item) => { const value = item.model ?? item.id ?? ""; return <MenuItem key={value} value={value}>{item.displayName ?? value}</MenuItem>; })}</Select></FormControl>
                  <FormControl size="small"><Select displayEmpty value={entry.reasoningEffort} onChange={(event) => updateFallback(role, entry.id, { reasoningEffort: String(event.target.value) })}>{efforts.map((effort) => <MenuItem key={effort} value={effort}>{effort || "继承思考强度"}</MenuItem>)}</Select></FormControl>
                  <TextField size="small" label="候选工作目录" value={entry.workspace?.cwd ?? ""} onChange={(event) => updateFallback(role, entry.id, { workspace: { ...entry.workspace, mode: entry.workspace?.mode ?? "inherit", cwd: event.target.value, workspaceMode: entry.workspace?.workspaceMode ?? "local" } })} />
                </Box>
              </AccordionDetails>
            </Accordion>)}
          </Stack>
        </AccordionDetails>
      </Accordion>;
    })}
    <Button variant="outlined" startIcon={<Add />} onClick={addRole} sx={{ alignSelf: "flex-start" }}>添加角色</Button>
  </Stack>;
}
