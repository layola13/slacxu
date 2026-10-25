import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  ListSubheader,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import AddIcon from "@mui/icons-material/Add";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import ThumbDownAltIcon from "@mui/icons-material/ThumbDownAlt";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import type { AgentProject, AgentProjectMember, AgentProjectMessage } from "@codex-ui/shared";
import { useI18n } from "../i18n";
import {
  appendAgentProjectMessage,
  castAgentProjectVote,
  createAgentProject,
  listAgentProjectMessages,
  listAgentProjects,
  listProjectRelayDirectory,
  pauseAgentProject,
  ProjectApiError,
  startAgentProject,
  updateAgentProject,
  type ProjectRelayProvider
} from "../state/codexClient";

type ProjectRouteDefaults = Pick<AgentProjectMember, "providerId" | "groupId" | "model">;

type Props = {
  token: string | null;
  open: boolean;
  onClose: () => void;
  defaultRoute: ProjectRouteDefaults;
  defaultWorkspace: string;
};

const roleNames: Array<[AgentProjectMember["role"], string]> = [
  ["boss", "老板"],
  ["product", "产品经理"],
  ["engineeringLead", "程序员首领"],
  ["engineer", "程序员团队"],
  ["art", "美术"],
  ["qa", "测试"],
  ["acceptance", "内部验收"],
  ["customerAcceptance", "第三方客户验收"]
];

const statusLabels: Record<AgentProjectMember["status"], [string, string]> = {
  draft: ["草稿", "Draft"],
  starting: ["启动中", "Starting"],
  active: ["在线", "Online"],
  paused: ["已暂停", "Paused"],
  completed: ["已完成", "Completed"],
  failed: ["失败", "Failed"]
};

const projectStatusLabels: Record<AgentProject["status"], [string, string]> = {
  draft: ["草稿", "Draft"],
  active: ["运行中", "Active"],
  paused: ["已暂停", "Paused"],
  archived: ["已归档", "Archived"]
};

const phaseLabels: Record<NonNullable<AgentProjectMessage["phase"]>, [string, string]> = {
  analysis: ["独立分析", "Independent analysis"],
  challenge: ["异构交叉质询", "Heterogeneous challenge"],
  synthesis: ["老板汇总", "Boss synthesis"]
};

function normalizedRouteValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function isForbiddenModel(model: string | null | undefined): boolean {
  return normalizedRouteValue(model).includes("fable5");
}

/**
 * Project members always route through a *group*, never a flat provider-native
 * model list. Models come from the selected group; when a group lists no
 * explicit models we fall back to the provider's native models but still scope
 * the choice to THAT group (matching how the main composer expresses the same
 * fallback). Leaving `groupId` null yields an empty list on purpose — there is
 * no "model without a group" for a Project.
 */
export function selectableModels(provider: ProjectRelayProvider | undefined, groupId: string | null): string[] {
  if (!provider || !groupId) return [];
  const group = provider.groups.find((entry) => entry.groupId === groupId && entry.kind === "text" && entry.enabled);
  if (!group) return [];
  const source = group.models.length ? group.models : provider.models;
  return [...new Set(source.filter((model) => !isForbiddenModel(model)))];
}

/**
 * The group a member's current model actually belongs to. Used so a stale
 * member.model (from an older config) still surfaces context rather than
 * silently dropping to an unrelated group's first model.
 */
export function resolvedGroupId(provider: ProjectRelayProvider, groupId: string | null, model: string): string | null {
  const groups = provider.groups.filter((group) => group.kind === "text" && group.enabled);
  const exact = groupId ? groups.find((group) => group.groupId === groupId) : undefined;
  if (exact) return exact.groupId;
  if (model) {
    const byModel = groups.find((group) => selectableModels(provider, group.groupId).includes(model));
    if (byModel) return byModel.groupId;
  }
  return groups[0]?.groupId ?? null;
}

export function providerHasProjectRoute(provider: ProjectRelayProvider): boolean {
  return provider.groups.some((group) => group.kind === "text" && group.enabled && selectableModels(provider, group.groupId).length > 0);
}

export function projectRouteIsValid(providers: ProjectRelayProvider[], route: ProjectRouteDefaults): boolean {
  const provider = providers.find((entry) => entry.providerId === route.providerId);
  return Boolean(provider && route.groupId && route.model && selectableModels(provider, route.groupId).includes(route.model));
}

/**
 * Resolve a Project route from the current conversation's selection. We anchor
 * to the *preferred* relay first, and only when that relay has no usable text
 * group at all do we fall back to another relay — so opening the group chat no
 * longer silently swaps the relay you picked in the main composer. Within the
 * chosen relay we keep the current conversation's group when it is usable,
 * otherwise the relay's first usable text group.
 */
export function resolveProjectRoute(providers: ProjectRelayProvider[], preferred: ProjectRouteDefaults): ProjectRouteDefaults {
  const preferredProvider = providers.find((entry) => entry.providerId === preferred.providerId);
  const provider = preferredProvider && providerHasProjectRoute(preferredProvider)
    ? preferredProvider
    : (preferredProvider && preferredProvider.groups.some((group) => group.kind === "text" && group.enabled) ? preferredProvider : undefined)
      ?? providers.find(providerHasProjectRoute);
  if (!provider) return { providerId: null, groupId: null, model: "" };
  const usableGroups = provider.groups.filter((group) => group.kind === "text" && group.enabled && selectableModels(provider, group.groupId).length > 0);
  const group = (preferred.groupId ? usableGroups.find((entry) => entry.groupId === preferred.groupId) : undefined)
    ?? (preferred.groupId ? provider.groups.find((entry) => entry.groupId === preferred.groupId && entry.kind === "text" && entry.enabled) : undefined)
    ?? usableGroups[0];
  const models = group ? selectableModels(provider, group.groupId) : [];
  return {
    providerId: provider.providerId,
    groupId: group?.groupId ?? null,
    model: models.includes(preferred.model) ? preferred.model : models[0] ?? ""
  };
}

function defaultProjectAgents(providers: ProjectRelayProvider[], defaultRoute: ProjectRouteDefaults): AgentProjectMember[] {
  const route = resolveProjectRoute(providers, defaultRoute);
  return roleNames.map(([role, label], index) => ({
    id: `${role}-${index + 1}`,
    name: label,
    role,
    responsibility: `${label}负责项目中的${label}工作`,
    instructions: "请在群聊中明确结论、证据、风险、阻塞和下一步；涉及副作用时提出投票议题。",
    providerId: route.providerId,
    groupId: route.groupId,
    model: route.model,
    reasoningEffort: role === "boss" || role === "engineeringLead" ? "high" : role === "qa" || role === "acceptance" ? "low" : "medium",
    workspaceIds: [],
    threadId: null,
    status: "draft" as const
  }));
}

export function ProjectGroupChat({ token, open, onClose, defaultRoute, defaultWorkspace }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [project, setProject] = useState<AgentProject | null>(null);
  const [messages, setMessages] = useState<AgentProjectMessage[]>([]);
  const [name, setName] = useState(isZh ? "公司项目" : "Company project");
  const [draft, setDraft] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [relayDirectory, setRelayDirectory] = useState<ProjectRelayProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [memberDrafts, setMemberDrafts] = useState<AgentProjectMember[]>([]);
  const lastSequenceRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const projectIdRef = useRef<string | null>(null);

  const setProjectAndDraft = useCallback((next: AgentProject | null) => {
    setProject(next);
    setMemberDrafts(next?.agents ?? []);
    projectIdRef.current = next?.id ?? null;
  }, []);

  const reportError = useCallback((cause: unknown) => {
    if (cause instanceof ProjectApiError) {
      const code = cause.code;
      const descriptions: Record<string, [string, string]> = {
        "CUX-PROJECT-START-001": ["成员启动失败，请检查渠道、模型和工作目录。", "An agent could not start. Check the relay, model, and workspace."],
        "CUX-PROJECT-PAUSE-001": ["成员暂停失败，可能是网络或上游暂时不可用。", "An agent could not be paused. The network or upstream may be unavailable."],
        "CUX-PROJECT-DISPATCH-001": ["消息未能发送给部分成员，请检查成员状态。", "The message did not reach one or more agents. Check member status."],
        "CUX-PROJECT-DISPATCH-002": ["当前没有在线成员，请先启动 Project。", "No online agents are available. Start the project first."],
        "CUX-PROJECT-THREAD-001": ["成员线程执行失败，请稍后重试或重新启动该成员。", "An agent thread failed. Retry later or restart the member."],
        "CUX-PROJECT-DISCUSSION-001": ["该 Project 正在讨论中，请等待当前讨论完成。", "This Project already has an active discussion. Wait for it to finish."],
        "CUX-PROJECT-DISCUSSION-002": ["成员使用的渠道、分组和模型完全相同，无法进行异构交叉质询。请至少更换一条路线。", "All members use the same relay, group, and model. Change at least one route for cross-review."],
        "CUX-PROJECT-DISCUSSION-003": ["成员响应超时。请检查网络切换、VPN/代理、渠道上游和服务端日志。", "A member response timed out. Check network changes, VPN/proxy, the relay upstream, and server logs."],
        "CUX-PROJECT-MODEL-001": ["Project 禁止使用 Fable 5 模型，请为该成员选择其他模型。", "Fable 5 models are disabled for Project discussions. Select another model."]
      };
      const [cn, en] = descriptions[code] ?? [cause.message, cause.message];
      setError(`${code}: ${isZh ? cn : en}${cause.message && cause.message !== cn && cause.message !== en ? ` (${cause.message})` : ""}`);
      return;
    }
    const text = cause instanceof Error ? cause.message : String(cause);
    setError(`CUX-PROJECT-API-001: ${text}`);
  }, [isZh]);

  const mergeMessages = useCallback((incoming: AgentProjectMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) byId.set(message.id, message);
      const merged = [...byId.values()].sort((left, right) => left.sequence - right.sequence);
      lastSequenceRef.current = Math.max(lastSequenceRef.current, ...merged.map((message) => message.sequence));
      return merged.slice(-2000);
    });
  }, []);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    try {
      const items = await listAgentProjects(token);
      setProjects(items);
      if (!projectIdRef.current && items[0]) setProjectAndDraft(items[0]);
    } catch (cause) {
      reportError(cause);
    }
  }, [reportError, setProjectAndDraft, token]);

  const pollMessages = useCallback(async () => {
    if (!token || !projectIdRef.current) return;
    try {
      const incoming = await listAgentProjectMessages(token, projectIdRef.current, { after: lastSequenceRef.current, limit: 300 });
      mergeMessages(incoming);
    } catch (cause) {
      reportError(cause);
    }
  }, [mergeMessages, reportError, token]);

  useEffect(() => {
    if (!open || !token) return;
    void loadProjects();
    void listProjectRelayDirectory(token).then(setRelayDirectory).catch(() => setRelayDirectory([]));
  }, [loadProjects, open, token]);

  useEffect(() => {
    if (!open || !project || !token) return;
    projectIdRef.current = project.id;
    lastSequenceRef.current = 0;
    setMessages([]);
    void listAgentProjectMessages(token, project.id, { limit: 500 }).then(mergeMessages).catch(reportError);
    if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(() => void pollMessages(), 1200);
    return () => {
      if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [mergeMessages, open, project?.id, pollMessages, reportError, token]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const members = useMemo(() => project?.agents ?? [], [project]);
  const currentRoute = useMemo(() => resolveProjectRoute(relayDirectory, defaultRoute), [defaultRoute, relayDirectory]);
  const routeReady = projectRouteIsValid(relayDirectory, currentRoute);
  const membersReady = memberDrafts.length > 0 && memberDrafts.every((member) => projectRouteIsValid(relayDirectory, member));
  const relayGroups = useCallback((providerId: string | null) => relayDirectory.find((provider) => provider.providerId === providerId)?.groups ?? [], [relayDirectory]);
  const currentPhase = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const phase = messages[index]?.phase;
      if (phase) return phase;
    }
    return null;
  }, [messages]);

  const create = async () => {
    if (!token || creating) return;
    setCreating(true);
    try {
      let providers = relayDirectory;
      if (providers.length === 0) {
        providers = await listProjectRelayDirectory(token);
        setRelayDirectory(providers);
      }
      const route = resolveProjectRoute(providers, defaultRoute);
      if (!projectRouteIsValid(providers, route)) throw new Error(isZh ? "当前没有可用的中转站、分组和模型" : "No usable relay, group, and model are available");
      const workspacePath = defaultWorkspace.trim();
      const workspaces = workspacePath ? [{ id: `workspace-${Date.now().toString(36)}`, label: workspacePath, path: workspacePath, mode: "local" as const }] : [];
      const agents = defaultProjectAgents(providers, route).map((agent) => ({ ...agent, workspaceIds: workspaces[0] ? [workspaces[0].id] : [] }));
      const created = await createAgentProject(token, {
        name: name.trim() || (isZh ? "公司项目" : "Company project"),
        description: isZh ? "公司式多 Agent 协作项目" : "Company-style multi-agent collaboration project",
        workspaces,

        agents,
        coordinatorAgentId: agents[0]?.id ?? null
      });
      setProjects((items) => [created, ...items]);
      setProjectAndDraft(created);
    } catch (cause) {
      reportError(cause);
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    if (!token || !project || project.status !== "active" || !draft.trim() || loading) return;
    setLoading(true);
    try {
      const result = await appendAgentProjectMessage(token, project.id, {
        text: draft.trim(), agentId: null, threadId: null, turnId: null, itemId: null, kind: "human"
      });
      mergeMessages([result.message]);
      setDraft("");
      if (result.dispatch.length === 0 || result.dispatch.some((entry) => !entry.ok)) await pollMessages();
    } catch (cause) {
      reportError(cause);
    } finally {
      setLoading(false);
    }
  };

  const start = async () => {
    if (!token || !project || loading) return;
    if (!membersReady) {
      setError(isZh ? "请为所有成员选择有效的中转站、分组和模型" : "Select a valid relay, group, and model for every member");
      return;
    }
    setLoading(true);
    try {
      const updated = await startAgentProject(token, project.id);
      setProjectAndDraft(updated);
      setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
      await pollMessages();
    } catch (cause) {
      reportError(cause);
    } finally {
      setLoading(false);
    }
  };

  const pause = async () => {
    if (!token || !project || loading) return;
    setLoading(true);
    try {
      const updated = await pauseAgentProject(token, project.id);
      setProjectAndDraft(updated);
      setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
      await pollMessages();
    } catch (cause) {
      reportError(cause);
    } finally {
      setLoading(false);
    }
  };

  const addWorkspace = async () => {
    if (!token || !project || !workspacePath.trim()) return;
    try {
      const path = workspacePath.trim();
      const workspace = { id: `workspace-${Date.now().toString(36)}`, label: path, path, mode: "local" as const };
      const updated = await updateAgentProject(token, project.id, { workspaces: [...project.workspaces, workspace] });
      setProjectAndDraft(updated);
      setWorkspacePath("");
    } catch (cause) {
      reportError(cause);
    }
  };

  const saveMembers = useCallback(async (nextAgents: AgentProjectMember[]) => {
    if (!token || !projectIdRef.current) return;
    setSavingMembers(true);
    try {
      const updated = await updateAgentProject(token, projectIdRef.current, { agents: nextAgents });
      setProject((current) => current?.id === updated.id ? updated : current);
      setMemberDrafts(updated.agents);
      setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      reportError(cause);
    } finally {
      setSavingMembers(false);
    }
  }, [reportError, token]);

  const updateMemberLocal = (memberId: string, patch: Partial<AgentProjectMember>) => {
    const nextAgents = memberDrafts.map((member) => member.id === memberId ? { ...member, ...patch } : member);
    setMemberDrafts(nextAgents);
    setProject((current) => current ? { ...current, agents: nextAgents } : current);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveMembers(nextAgents), 600);
  };

  const applyCurrentRouteToAll = () => {
    const route = resolveProjectRoute(relayDirectory, defaultRoute);
    if (!route.providerId || !route.groupId || !route.model) return;
    const nextAgents = memberDrafts.map((member) => ({ ...member, ...route }));
    setMemberDrafts(nextAgents);
    setProject((current) => current ? { ...current, agents: nextAgents } : current);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    void saveMembers(nextAgents);
  };

  const vote = async (choice: "approve" | "reject") => {
    if (!token || !project) return;
    try {
      await castAgentProjectVote(token, project.id, {
        proposalId: "current",
        voterType: "human",
        voterId: "human",
        choice,
        comment: choice === "reject" ? (isZh ? "人类一票否决" : "Human veto") : ""
      });
      await pollMessages();
    } catch (cause) {
      reportError(cause);
    }
  };

  const statusLabel = (status: AgentProject["status"] | AgentProjectMember["status"]) => {
    const pair = (status in projectStatusLabels ? projectStatusLabels : statusLabels)[status as never];
    return isZh ? pair?.[0] ?? status : pair?.[1] ?? status;
  };

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xl" data-testid="project-group-chat-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}><GroupsIcon color="primary" />{isZh ? "公司 Project 群聊" : "Company project room"}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1.5, whiteSpace: "pre-wrap" }}>{error}</Alert>}
        {!project ? <Stack spacing={1.5}>
          <TextField label={isZh ? "Project 名称" : "Project name"} value={name} onChange={(event) => setName(event.target.value)} />
          <Button variant="contained" startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />} onClick={() => void create()} disabled={creating}>{isZh ? "创建公司项目" : "Create project"}</Button>
          {projects.length > 0 && <Stack direction="row" spacing={.75} flexWrap="wrap" useFlexGap><Typography variant="body2" sx={{ alignSelf: "center" }}>{isZh ? "已有项目：" : "Existing projects:"}</Typography>{projects.map((item) => <Chip key={item.id} label={`${item.name} · ${statusLabel(item.status)}`} onClick={() => setProjectAndDraft(item)} />)}</Stack>}
        </Stack> : <Stack spacing={1.5} sx={{ minHeight: 520 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <Typography variant="h6" sx={{ flex: 1 }}>{project.name}</Typography>
            <Chip label={`${members.length} ${isZh ? "位成员" : "members"}`} />
            {currentPhase && <Chip color="info" label={isZh ? phaseLabels[currentPhase][0] : phaseLabels[currentPhase][1]} />}
            <Chip label={statusLabel(project.status)} color={project.status === "active" ? "success" : project.status === "paused" ? "warning" : "default"} />
            <Button size="small" variant="outlined" startIcon={<AltRouteIcon />} onClick={applyCurrentRouteToAll} disabled={!routeReady || loading}>{isZh ? "全部使用当前路线" : "Use current route for all"}</Button>
            {project.status === "active" ? <Button size="small" color="warning" startIcon={<PauseCircleOutlineIcon />} onClick={() => void pause()} disabled={loading}>{isZh ? "暂停" : "Pause"}</Button> : <Button size="small" variant="contained" startIcon={<PlayCircleOutlineIcon />} onClick={() => void start()} disabled={loading || project.status === "archived" || !membersReady}>{isZh ? "启动成员" : "Start agents"}</Button>}
          </Stack>
          {!routeReady && <Alert severity="warning">{isZh ? "请先在主输入框选择可用的中转站、分组和模型，再同步到 Project 成员。" : "Select an available relay, group, and model in the main composer, then sync the Project members."}</Alert>}
          {!membersReady && <Alert severity="warning">{isZh ? "所有成员都需要选择当前可用的中转站、文本分组和模型后才能启动。" : "Every member needs a currently available relay, text group, and model before the Project can start."}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="stretch"><TextField size="small" fullWidth label={isZh ? "添加工作目录" : "Add workspace"} value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="E:\\projects\\my-app or /workspace/app" /><Button size="small" onClick={() => void addWorkspace()} disabled={!workspacePath.trim()}>{isZh ? "添加" : "Add"}</Button></Stack>
          {project.workspaces.length > 0 && <Stack direction="row" spacing={.75} flexWrap="wrap" useFlexGap>{project.workspaces.map((workspace) => <Chip key={workspace.id} label={workspace.path} variant="outlined" />)}</Stack>}
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Stack spacing={1.25}>{memberDrafts.map((member) => {
              const provider = relayDirectory.find((entry) => entry.providerId === member.providerId);
              const groups = relayGroups(member.providerId).filter((group) => group.kind === "text" && group.enabled);
              // Resolve the group this member actually runs through: keep the
              // member's explicit group when it is an enabled text group,
              // otherwise locate the group hosting its current model, otherwise
              // fall back to the relay's first usable text group. This is also
              // how the main composer resolves a model back to a group, so a
              // Project member and the active conversation express the same
              // "relay + group + model" triplet instead of a bare model list.
              const effectiveGroupId = provider ? resolvedGroupId(provider, member.groupId, member.model) : null;
              const effectiveGroup = groups.find((group) => group.groupId === effectiveGroupId);
              const models = provider && effectiveGroupId ? selectableModels(provider, effectiveGroupId) : [];
              const groupUsesRelayDefault = Boolean(effectiveGroup) && effectiveGroup!.models.length === 0 && models.length > 0;
              const modelIsStale = Boolean(member.model) && !models.includes(member.model);
              const selectedModelValue = models.includes(member.model) ? member.model : (member.model || models[0] || "");
              return <Stack key={member.id} spacing={.75}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                  <Stack direction="row" spacing={.75} alignItems="center" sx={{ minWidth: 180 }}><Typography sx={{ fontWeight: 750 }}>{member.name}</Typography><Chip size="small" label={statusLabel(member.status)} color={member.status === "active" ? "success" : member.status === "failed" ? "error" : "default"} /></Stack>
                  <TextField size="small" label={isZh ? "职责" : "Responsibility"} value={member.responsibility} onChange={(event) => updateMemberLocal(member.id, { responsibility: event.target.value })} sx={{ flex: 2 }} />
                  <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}><InputLabel>{isZh ? "中转站" : "Relay"}</InputLabel><Select label={isZh ? "中转站" : "Relay"} value={member.providerId ?? ""} onChange={(event) => {
                    // Anchor to the new relay while preserving group context:
                    // prefer the member's own group if it still exists there,
                    // then the current conversation's group, then let the route
                    // resolver pick the new relay's first usable text group. We
                    // never drop the model silently into a bare native list.
                    const nextProviderId = event.target.value || null;
                    const nextProvider = relayDirectory.find((entry) => entry.providerId === nextProviderId);
                    const ownGroupForNewRelay = nextProvider && member.groupId ? resolvedGroupId(nextProvider, member.groupId, member.model) : null;
                    const convGroupForNewRelay = nextProvider && defaultRoute.groupId ? resolvedGroupId(nextProvider, defaultRoute.groupId, member.model) : null;
                    const inheritGroupId = ownGroupForNewRelay ?? convGroupForNewRelay;
                    updateMemberLocal(member.id, resolveProjectRoute(relayDirectory, { providerId: nextProviderId, groupId: inheritGroupId, model: member.model }));
                  }}><MenuItem value="" disabled>{isZh ? "请选择中转站" : "Select a relay"}</MenuItem>{relayDirectory.filter(providerHasProjectRoute).map((entry) => <MenuItem key={entry.providerId} value={entry.providerId}>{entry.providerName}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small" sx={{ minWidth: 145, flex: 1 }}><InputLabel>{isZh ? "分组" : "Group"}</InputLabel><Select label={isZh ? "分组" : "Group"} value={member.groupId ?? ""} disabled={!provider} renderValue={(value) => groups.find((group) => group.groupId === (value as string))?.groupName ?? ((value as string) || (isZh ? "请选择分组" : "Select a group"))} onChange={(event) => { const groupId = event.target.value || null; updateMemberLocal(member.id, { groupId, model: selectableModels(provider, groupId)[0] ?? "" }); }}><MenuItem value="" disabled>{isZh ? "请选择分组" : "Select a group"}</MenuItem>{groups.map((group) => <MenuItem key={group.groupId} value={group.groupId}>{group.groupName} · x{group.groupRatio}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small" sx={{ minWidth: 150, flex: 1.3 }}><InputLabel>{isZh ? "模型" : "Model"}</InputLabel><Select label={isZh ? "模型" : "Model"} value={selectedModelValue} disabled={!provider || !effectiveGroupId || models.length === 0} renderValue={(value) => {
                    const shown = (value as string) || models[0] || "";
                    if (!shown) return isZh ? "无可用模型" : "No models";
                    if (groupUsesRelayDefault) return `${shown}${isZh ? " · 中转站默认" : " · relay default"}`;
                    return effectiveGroup ? `${shown} · ${effectiveGroup.groupName}` : shown;
                  }} onChange={(event) => updateMemberLocal(member.id, { model: event.target.value })}>
                    <ListSubheader>{effectiveGroup ? `${isZh ? "当前分组" : "Group"} · ${effectiveGroup.groupName}` : (isZh ? "请选择分组" : "Select a group")}{groupUsesRelayDefault ? (isZh ? "（中转站默认模型）" : " (relay default models)") : ""}</ListSubheader>
                    {models.map((model) => <MenuItem key={model} value={model}>{model}</MenuItem>)}
                    {models.length === 0 && <MenuItem value="" disabled>{isZh ? "该分组未配置模型" : "No models configured for this group"}</MenuItem>}
                    {modelIsStale && member.model && <MenuItem value={member.model} disabled>{`${member.model}${isZh ? "（已不在当前分组）" : " (not in this group)"}`}</MenuItem>}
                  </Select></FormControl>
                  <TextField size="small" label={isZh ? "思考强度" : "Reasoning"} value={member.reasoningEffort} onChange={(event) => updateMemberLocal(member.id, { reasoningEffort: event.target.value })} placeholder="medium" sx={{ minWidth: 110, flex: .8 }} />
                </Stack>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                  <FormControl size="small" sx={{ minWidth: 260, flex: 1 }}><InputLabel>{isZh ? "工作目录" : "Workspaces"}</InputLabel><Select multiple label={isZh ? "工作目录" : "Workspaces"} value={member.workspaceIds} onChange={(event) => updateMemberLocal(member.id, { workspaceIds: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value as string[] })} renderValue={(selected) => (selected as string[]).map((id) => project.workspaces.find((workspace) => workspace.id === id)?.label ?? id).join(", ")}><MenuItem value="">{isZh ? "未分配" : "Unassigned"}</MenuItem>{project.workspaces.map((workspace) => <MenuItem key={workspace.id} value={workspace.id}>{workspace.label}</MenuItem>)}</Select></FormControl>
                  <TextField size="small" fullWidth label={isZh ? "角色指令（可选）" : "Role instructions (optional)"} value={member.instructions} onChange={(event) => updateMemberLocal(member.id, { instructions: event.target.value })} sx={{ flex: 2 }} />
                </Stack>
              </Stack>;
            })}</Stack>
            {savingMembers && <Typography variant="caption" color="text.secondary">{isZh ? "正在保存成员配置…" : "Saving member settings…"}</Typography>}
          </Paper>
          <Divider />
          <Box sx={{ flex: 1, minHeight: 180, maxHeight: 420, overflowY: "auto", p: 1.25, bgcolor: "action.hover", borderRadius: 1 }}>
            {messages.length === 0 ? <Typography color="text.secondary">{isZh ? "群聊尚无消息。人类拥有一票否决权，涉及代码、部署、账单和客户承诺的议题应先投票。" : "No room messages yet. Human veto applies to code, deployment, billing, and customer commitments."}</Typography> : messages.map((message) => {
              const member = members.find((candidate) => candidate.id === message.agentId);
              const phase = message.phase ? (isZh ? phaseLabels[message.phase][0] : phaseLabels[message.phase][1]) : null;
              const route = message.providerId || message.groupId || message.model
                ? `${message.providerId ?? "inherit"}/${message.groupId ?? "default"}/${message.model ?? "default"}`
                : null;
              return <Paper key={message.id} variant="outlined" sx={{ mb: 1, p: 1, borderLeft: "3px solid", borderLeftColor: message.kind === "human" ? "primary.main" : message.kind === "system" ? "warning.main" : "success.main" }}><Stack direction="row" spacing={.75} alignItems="center" flexWrap="wrap" useFlexGap><Typography variant="caption" sx={{ fontWeight: 800 }}>{message.kind === "human" ? (isZh ? "你（老板）" : "You (boss)") : member?.name ?? (isZh ? "系统" : "System")}</Typography>{phase && <Chip size="small" color="info" variant="outlined" label={phase} />}{route && <Chip size="small" variant="outlined" label={route} />}{member && <Chip size="small" variant="outlined" label={statusLabel(member.status)} />}</Stack><Typography variant="caption" color="text.secondary">#{message.sequence} · {new Date(message.createdAt).toLocaleTimeString()}</Typography><Typography sx={{ whiteSpace: "pre-wrap", mt: .35 }}>{message.text}</Typography></Paper>;
            })}
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}><TextField fullWidth multiline maxRows={4} size="small" disabled={project.status !== "active"} placeholder={project.status === "active" ? (isZh ? "向公司团队发消息…" : "Message the company team…") : (isZh ? "请先启动成员" : "Start agents before messaging")} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><Button variant="contained" onClick={() => void send()} disabled={project.status !== "active" || !draft.trim() || loading}>{loading ? <CircularProgress size={18} color="inherit" /> : isZh ? "发送" : "Send"}</Button></Stack>
          <Stack direction="row" spacing={1}><Button size="small" startIcon={<ThumbUpAltIcon />} onClick={() => void vote("approve")}>{isZh ? "批准当前议题" : "Approve proposal"}</Button><Button size="small" color="error" startIcon={<ThumbDownAltIcon />} onClick={() => void vote("reject")}>{isZh ? "人类一票否决" : "Human veto"}</Button></Stack>
        </Stack>}
      </DialogContent>
      <DialogActions><Button onClick={() => { setProjectAndDraft(null); setMessages([]); }}>{isZh ? "新建/切换 Project" : "New / switch project"}</Button><Button onClick={onClose}>{isZh ? "关闭" : "Close"}</Button></DialogActions>
    </Dialog>;
}
