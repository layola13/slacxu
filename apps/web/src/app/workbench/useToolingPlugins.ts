import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { DangerousPermissionAuditEvent, JsonValue } from "@codex-ui/shared";
import {
  createWorkspaceDirectory,
  fetchAuditEvents,
  parseApps,
  parseHookGroups,
  parseInstalledPluginMarketplaces,
  parseMcpResourceContents,
  parseMcpServers,
  parsePluginDetail,
  parsePluginInstallAuthNotice,
  parsePluginMarketplaces,
  parseSkillGroups,
  type ComposerMention,
  type McpResourceContentEntry,
  type PluginDetailEntry,
  type PluginEntry,
  type PluginInstallAuthNotice,
  type PluginMarketplace,
  type SkillEntry,
  type SkillGroup,
} from "../../state/codexClient";
import { asRecord, decodeBase64Text, encodeBase64Text, errorMessage, formatErrorText, isThreadNotFoundError } from "./appUtils";
import { normalizeWorkspaceCwd } from "../../workspacePaths";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useToolingPlugins(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  cwd: string;
  localWorkspaceDefaultPath: string;
  setPendingMention: Dispatch<SetStateAction<ComposerMention | null>>;
}) {
  const { state, dispatch, client, t, cwd, localWorkspaceDefaultPath, setPendingMention } = input;
  const [pluginDetails, setPluginDetails] = useState<Record<string, PluginDetailEntry>>({});
  const [pluginSkillPreviews, setPluginSkillPreviews] = useState<Record<string, string>>({});
 const [pluginAuthNotices, setPluginAuthNotices] = useState<Record<string, PluginInstallAuthNotice>>({});
  const [installingPluginIds, setInstallingPluginIds] = useState<Set<string>>(new Set());
 const [skillExtraRoots, setSkillExtraRoots] = useState<string[]>([]);
  const [skillPreviews, setSkillPreviews] = useState<Record<string, string>>({});
  const [auditEvents, setAuditEvents] = useState<DangerousPermissionAuditEvent[]>([]);
  const [mcpResourceContents, setMcpResourceContents] = useState<Record<string, McpResourceContentEntry[]>>({});
  const [mcpOauthUrls, setMcpOauthUrls] = useState<Record<string, string>>({});

  const loadTooling = useCallback(
    async (options?: { forceSkillReload?: boolean; skillExtraRoots?: string[] }) => {
      dispatch({ type: "toolingLoading", loading: true });
      const effectiveSkillExtraRoots = options?.skillExtraRoots ?? skillExtraRoots;
      const normalizedCwd = normalizeWorkspaceCwd(cwd) || localWorkspaceDefaultPath;
      const skillCwds = [normalizedCwd, ...effectiveSkillExtraRoots.map(normalizeWorkspaceCwd)]
        .filter((entry: string, index: number, entries: string[]) => entry && entries.indexOf(entry) === index);
      const [mcpResult, skillResult, hookResult, pluginResult, installedPluginResult, appResult] = await Promise.allSettled([
        client.rpc("mcpServerStatus/list", { detail: "full" }),
        client.rpc("skills/list", { threadId: state.activeThreadId, cwds: skillCwds, forceReload: options?.forceSkillReload ?? false }),
        client.rpc("hooks/list", { cwds: [normalizedCwd] }),
        client.rpc("plugin/list", {
          cwds: [normalizedCwd],
          marketplaceKinds: ["local"]
        }),
        client.rpc("plugin/installed", { cwds: [normalizedCwd], installSuggestionPluginNames: [] }),
        client.rpc("app/list", { threadId: state.activeThreadId, limit: 50, forceRefetch: options?.forceSkillReload ?? false })
      ]);

      const nextTooling: ClientState["tooling"] = {
        mcpServers: [],
        skillGroups: [],
        hookGroups: [],
        pluginMarketplaces: [],
        installedPluginMarketplaces: [],
        apps: [],
        featuredPluginIds: [],
        marketplaceErrors: []
      };
      const inventoryWarnings: string[] = [];
      const addInventoryWarning = (label: string, reason: unknown) => {
        const message = errorMessage(label, reason);
        inventoryWarnings.push(message);
        console.debug(`[tooling] ${message}`);
      };

      if (mcpResult.status === "fulfilled") {
        nextTooling.mcpServers = parseMcpServers(mcpResult.value);
      } else {
        addInventoryWarning("MCP inventory", mcpResult.reason);
      }

      if (skillResult.status === "fulfilled") {
        nextTooling.skillGroups = parseSkillGroups(skillResult.value);
      } else {
        addInventoryWarning("Skills inventory", skillResult.reason);
      }

      if (hookResult.status === "fulfilled") {
        nextTooling.hookGroups = parseHookGroups(hookResult.value);
      } else {
        addInventoryWarning("Hooks inventory", hookResult.reason);
      }

      if (pluginResult.status === "fulfilled") {
        Object.assign(nextTooling, parsePluginMarketplaces(pluginResult.value));
      } else {
        addInventoryWarning("Plugin inventory", pluginResult.reason);
      }

      if (installedPluginResult.status === "fulfilled") {
        const installed = parseInstalledPluginMarketplaces(installedPluginResult.value);
        nextTooling.installedPluginMarketplaces = installed.installedPluginMarketplaces;
        nextTooling.marketplaceErrors = [...nextTooling.marketplaceErrors, ...installed.marketplaceErrors];
      } else {
        nextTooling.installedPluginMarketplaces = nextTooling.pluginMarketplaces
          .map((marketplace: PluginMarketplace) => ({
            ...marketplace,
            plugins: marketplace.plugins.filter((plugin: PluginEntry) => plugin.installed)
          }))
          .filter((marketplace: PluginMarketplace) => marketplace.plugins.length > 0);
        addInventoryWarning("Installed plugins", installedPluginResult.reason);
      }

      if (appResult.status === "fulfilled") {
        nextTooling.apps = parseApps(appResult.value);
      } else if (!isThreadNotFoundError(appResult.reason)) {
        addInventoryWarning("App inventory", appResult.reason);
      }

      nextTooling.marketplaceErrors = [...nextTooling.marketplaceErrors, ...inventoryWarnings];
      dispatch({ type: "tooling", tooling: nextTooling });
    },
    [client, cwd, localWorkspaceDefaultPath, skillExtraRoots, state.activeThreadId]
  );

  const loadAuditEvents = useCallback(async () => {
    if (!state.token) {
      return;
    }
    try {
      setAuditEvents(await fetchAuditEvents(state.token));
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
    }
  }, [state.token]);

  const reloadMcp = useCallback(async () => {
    try {
      await client.rpc("config/mcpServer/reload");
      await loadTooling();
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
    }
  }, [client, loadTooling]);

  const toggleSkill = useCallback(
    async (skill: SkillEntry, enabled: boolean) => {
      try {
        await client.rpc("skills/config/write", { threadId: state.activeThreadId, path: skill.path || null, name: skill.path ? null : skill.name, enabled });
        await loadTooling({ forceSkillReload: true });
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, loadTooling, state.activeThreadId]
  );

  const saveSkillExtraRoots = useCallback(
    async (roots: string[]) => {
      const normalized = roots.map((entry: string) => entry.trim()).filter(Boolean);
      try {
        await client.rpc("skills/extraRoots/set", { threadId: state.activeThreadId, extraRoots: normalized });
        setSkillExtraRoots(normalized);
        await loadTooling({ forceSkillReload: true, skillExtraRoots: normalized });
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, loadTooling, state.activeThreadId]
  );

  const readSkillPreview = useCallback(
    async (skill: SkillEntry) => {
      if (!skill.path) {
        dispatch({ type: "error", message: `Skill ${skill.name} does not expose a local path` });
        return;
      }
      try {
        const result = await client.rpc("fs/readFile", { threadId: state.activeThreadId, cwd, path: skill.path });
        const dataBase64 = asRecord(result).dataBase64;
        setSkillPreviews((current: Record<string, string>) => ({
          ...current,
          [skill.path]: typeof dataBase64 === "string" ? decodeBase64Text(dataBase64) : "No preview available"
        }));
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, cwd, state.activeThreadId]
  );

  const createSkill = useCallback(
    async ({ name, description, instructions }: { name: string; description: string; instructions: string }) => {
      const normalizedName = name.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedName)) {
        throw new Error("Skill name must use lowercase letters, numbers, and hyphens only.");
      }
      if (!state.token) throw new Error("UI session token is not ready");
      const skillDirectory = `${cwd.replace(/[\\/]+$/, "")}${cwd.includes("\\") ? "\\" : "/"}.agents${cwd.includes("\\") ? "\\" : "/"}skills${cwd.includes("\\") ? "\\" : "/"}${normalizedName}`;
      const skillPath = `${skillDirectory}${cwd.includes("\\") ? "\\" : "/"}SKILL.md`;
      const existingSkill = state.tooling.skillGroups.flatMap((group: SkillGroup) => group.skills).find((skill: SkillEntry) => skill.path.toLowerCase() === skillPath.toLowerCase());
      if (existingSkill) throw new Error(`Skill '${normalizedName}' already exists.`);
      const content = `---
name: ${normalizedName}
description: ${description.trim()}
---

# ${normalizedName}

${instructions.trim()}
`;
      await createWorkspaceDirectory(state.token, { path: skillDirectory, recursive: true, threadId: state.activeThreadId ?? undefined, cwd });
      await client.rpc("fs/writeFile", { threadId: state.activeThreadId, cwd, path: skillPath, dataBase64: encodeBase64Text(content) });
      await loadTooling({ forceSkillReload: true });
    },
    [client, cwd, loadTooling, state.activeThreadId, state.token, state.tooling.skillGroups]
  );

 const installPlugin = useCallback(
   async (marketplace: PluginMarketplace, plugin: PluginEntry) => {
     try {
       setInstallingPluginIds((current: Set<string>) => new Set(current).add(plugin.id));
       const result = await client.rpc("plugin/install", {
         marketplacePath: marketplace.path ?? null,
         remoteMarketplaceName: marketplace.path ? null : marketplace.name,
         pluginName: plugin.name
       });
       const authNotice = parsePluginInstallAuthNotice(result);
       setPluginAuthNotices((current: Record<string, PluginInstallAuthNotice>) => ({ ...current, [plugin.id]: authNotice }));
       await loadTooling({ forceSkillReload: true });
     } catch (error) {
       dispatch({ type: "error", message: formatErrorText(error) });
     } finally {
       setInstallingPluginIds((current: Set<string>) => {
         const next = new Set(current);
         next.delete(plugin.id);
         return next;
       });
     }
   },
   [client, loadTooling]
 );

 const uninstallPlugin = useCallback(
   async (plugin: PluginEntry) => {
     try {
       setInstallingPluginIds((current: Set<string>) => new Set(current).add(plugin.id));
       await client.rpc("plugin/uninstall", { pluginId: plugin.id });
       await loadTooling({ forceSkillReload: true });
     } catch (error) {
       dispatch({ type: "error", message: formatErrorText(error) });
     } finally {
       setInstallingPluginIds((current: Set<string>) => {
         const next = new Set(current);
         next.delete(plugin.id);
         return next;
       });
     }
   },
   [client, loadTooling]
 );

  const readPluginDetail = useCallback(
    async (marketplace: PluginMarketplace, plugin: PluginEntry) => {
      try {
        const result = await client.rpc("plugin/read", {
          marketplacePath: marketplace.path ?? null,
          remoteMarketplaceName: marketplace.path ? null : marketplace.name,
          pluginName: plugin.name
        });
        const detail = parsePluginDetail(result);
        if (detail) {
          setPluginDetails((current: Record<string, PluginDetailEntry>) => ({ ...current, [plugin.id]: detail }));
        }
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client]
  );

  const readPluginSkill = useCallback(
    async (marketplace: PluginMarketplace, plugin: PluginEntry, skillName: string) => {
      if (!plugin.remotePluginId) {
        dispatch({ type: "error", message: "Skill preview is available for remote plugin skills only" });
        return;
      }
      try {
        const result = await client.rpc("plugin/skill/read", {
          remoteMarketplaceName: marketplace.name,
          remotePluginId: plugin.remotePluginId,
          skillName
        });
        const contents = asRecord(result).contents;
        setPluginSkillPreviews((current: Record<string, string>) => ({
          ...current,
          [`${plugin.id}:${skillName}`]: typeof contents === "string" ? contents : "No preview available"
        }));
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client]
  );

  const insertPluginMention = useCallback((marketplace: PluginMarketplace, plugin: PluginEntry) => {
    setPendingMention({
      name: plugin.displayName,
      path: `plugin://${plugin.name}@${marketplace.name}`,
      token: `@${plugin.name}`,
      kind: "plugin"
    });
  }, []);

  const startMcpOauth = useCallback(
    async (serverName: string) => {
      try {
        const result = await client.rpc("mcpServer/oauth/login", { name: serverName, threadId: state.activeThreadId, timeoutSecs: 120 });
        const authorizationUrl = asRecord(result).authorizationUrl;
        if (typeof authorizationUrl === "string") {
          setMcpOauthUrls((current: Record<string, string>) => ({ ...current, [serverName]: authorizationUrl }));
          window.open(authorizationUrl, "_blank", "noopener,noreferrer");
        }
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, state.activeThreadId]
  );

  const readMcpResource = useCallback(
    async (serverName: string, uri: string) => {
      try {
        const result = await client.rpc("mcpServer/resource/read", { server: serverName, uri, threadId: state.activeThreadId });
        setMcpResourceContents((current: Record<string, McpResourceContentEntry[]>) => ({
          ...current,
          [`${serverName}:${uri}`]: parseMcpResourceContents(result)
        }));
      } catch (error) {
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [client, state.activeThreadId]
  );

  const callMcpTool = useCallback(
    async (serverName: string, toolName: string, args: JsonValue) => {
      if (!state.activeThreadId) {
        throw new Error("Select a conversation before calling an MCP tool");
      }
      return client.rpc("mcpServer/tool/call", {
        threadId: state.activeThreadId,
        server: serverName,
        tool: toolName,
        arguments: args
      });
    },
    [client, state.activeThreadId]
  );
  return {
    pluginDetails,
    setPluginDetails,
    pluginSkillPreviews,
    setPluginSkillPreviews,
    pluginAuthNotices,
    setPluginAuthNotices,
    installingPluginIds,
    setInstallingPluginIds,
    skillExtraRoots,
    setSkillExtraRoots,
    skillPreviews,
    setSkillPreviews,
    auditEvents,
    setAuditEvents,
    mcpResourceContents,
    setMcpResourceContents,
    mcpOauthUrls,
    setMcpOauthUrls,
    loadTooling,
    loadAuditEvents,
    reloadMcp,
    toggleSkill,
    saveSkillExtraRoots,
    readSkillPreview,
    createSkill,
    installPlugin,
    uninstallPlugin,
    readPluginDetail,
    readPluginSkill,
    insertPluginMention,
    startMcpOauth,
    readMcpResource,
    callMcpTool,
  };
}
