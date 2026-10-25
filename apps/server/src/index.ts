import { dirname, isAbsolute, join, resolve, sep } from "node:path";
// Baked at bundle time by apps/server/scripts/build.mjs (CXU_VERSION define
// from packages/cxu/package.json); "dev" when running from source.
declare const CXU_VERSION: string | undefined;
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, freemem, homedir, hostname, loadavg, platform, totalmem, uptime, userInfo } from "node:os";
import { appendFile, cp, mkdir, readdir, rename, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED,
  FREE_OLLAMA_ENABLED,
  classifyAgentFailure,
  createDefaultSaVmPolicyConfig,
  hasEnhanceToolsEnabled,
  healthyAgentMember,
  parseAgentRuntimeOverride,
  isProviderFeatureEnabled,
  stripModelContextVariant,
  type AgentRuntimeOverride,
  type AuthUser,
  type AgentProjectDiscussionPhase,
  type AgentProject,
  type AgentProjectMember,
  type AgentProjectMessage,
  type AgentRoleFallback,
  type ThreadAgentMember,
  type ThreadAgentRoster,
  type ChannelGroupConfig,
  type CliBackend,
  type ClientToServerMessage,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonValue,
  type ImageGenerationProtocol,
  type PermissionPresetId,
  type ProviderActivation,
  type ProviderConfig,
  type RelayAuthType,
  type RelayResponseProtocol,
  type SaVmPolicyConfig,
  type SaVmToolsConfig,
  type ServerToClientMessage,
  type SystemMetrics
} from "@codex-ui/shared";
import { normalizeTokenUsage, priceNormalizedTokenUsage } from "@codex-ui/shared";
import { createCodexRuntimeClient, type CodexRuntimeClient } from "../../../backends/codex/src/runtime/codexBridge.js";
import { cliDiscoveryForKind, cliPluginIdForSettingsSlug, cliSettingsEntries, cliSettingsLinks, pluginCatalog, serverPluginRegistry, setPluginInstalled } from "./pluginHost.js";
import { SshCodexBridge, type SshWorkspaceProfile } from "../../../backends/codex/src/runtime/sshCodexBridge.js";
import { prepareSshCodeCliLauncher, terminateSshCodeCliChild, type SshCodeCliLauncher } from "./sshCodeCliBridge.js";
import { CodeCliBridge, codeCliNeedsManagedConfigDir, codeCliNeedsRunningProcess, isCodeCliTerminalThreadMethod } from "./codeCliBridge.js";
import { ClaudeSkillInventory, expandClaudeSkillInput, skillGroupsJson } from "@cxu/sdk-backend";
import { ClaudeSessionStore } from "../../../backends/claude/src/runtime/claudeSessionStore.js";
import { AgySessionStore } from "../../../backends/agy/src/runtime/agySessionStore.js";
import { SshWorkspaceStore } from "./sshWorkspaceStore.js";
import { getSshSystemMetrics } from "./sshSystemMetrics.js";
import { discoverSshConfigHosts, probeSshConfigHost } from "./sshHostDiscovery.js";
import { RemoteThreadRouteStore } from "./remoteThreadRouteStore.js";
import { transitionRemoteThreadLifecycle } from "./remoteThreadLifecycle.js";
import { RemoteBunCodexBridge } from "../../../backends/codex/src/runtime/remoteBunCodexBridge.js";
import { buildClaudeDesktopRelayInjection, CLAUDE_DESKTOP_CONFIG_NOT_FOUND_CODE, writeClaudeDesktopInference } from "../../../backends/claude/src/runtime/claudeDesktopInjection.js";
import { CURSOR_INSTALL_DIR_NOT_FOUND_CODE, CursorInstallDirNotFoundError, writeCursorRelayLauncher } from "./cursorDesktopInjection.js";
import { probeLocalCodexCliUpdate, probeSshCodexCliUpdate, updateLocalCodexCli, updateSshCodexCli, checkLocalCodexCliUpdateStatus } from "./codexCliUpdate.js";
import {
  buildCliKindStatus,
  ensureCliInstallationsCached,
  getCachedCliInstallations,
  parseRequestedCliKinds,
} from "./cliVersions.js";
import { type CliSelectionKind, setPreferredCliBinary } from "./cliSelectionState.js";
import { findCodexBinary, isCodexCliAvailable } from "./codexCommand.js";
import { findClaudeBin, prepareClaudeThreadCwd } from "../../../backends/claude/src/runtime/claudeCompatibleProbe.js";
import { findAgyBin } from "../../../backends/agy/src/runtime/agyCompatibleProbe.js";
import { restoreAgySettings, snapshotAgySettings } from "../../../backends/agy/src/runtime/agySettingsGuard.js";
import { AgyBridge, AGY_OFFICIAL_PROVIDER_ID, buildAgyOfficialProvider } from "../../../backends/agy/src/runtime/agyBridge.js";
import { findAuggieBin } from "../../../backends/auggie/src/runtime/auggieCommand.js";
import type { AuggieAgentBridge } from "../../../backends/auggie/src/runtime/auggieAgentBridge.js";
import {
  AUGGIE_INDEXING_MODE,
  bindAuggieThreadBridge,
  defaultAuggieCacheDir,
  ensureAuggieBridgeForThread,
  existingAuggieBridgeForThread,
  releaseAuggieThreadBridge,
  stopAuggieRuntime,
} from "../../../backends/auggie/src/runtime/auggieRuntime.js";
import {
  configureAuggieRedirector,
  type AuggieRedirectorModelCatalogEntry,
} from "../../../backends/auggie/src/runtime/auggieRedirector.js";
import { findClineBin } from "../../../backends/cline/src/runtime/clineCommand.js";
import type { ClineAgentBridge } from "../../../backends/cline/src/runtime/clineAgentBridge.js";
import {
  bindClineThreadBridge,
  defaultClineDataDir,
  ensureClineBridgeForThread,
  existingClineBridgeForThread,
  releaseClineThreadBridge,
  stopClineRuntime,
} from "../../../backends/cline/src/runtime/clineRuntime.js";
import {
  ensureClineMcpSettingsFile,
  writeClineRelayProvider,
} from "../../../backends/cline/src/runtime/clineProviders.js";
import { findCommandCodeBin } from "../../../backends/command-code/src/runtime/commandCodeCommand.js";
import type { CommandCodeAgentBridge } from "../../../backends/command-code/src/runtime/commandCodeAgentBridge.js";
import {
  bindCommandCodeThreadBridge,
  defaultCommandCodeHomeDir,
  ensureCommandCodeBridgeForThread,
  existingCommandCodeBridgeForThread,
  releaseCommandCodeThreadBridge,
  stopCommandCodeRuntime,
} from "../../../backends/command-code/src/runtime/commandCodeRuntime.js";
import {
  ensureCommandCodeMcpFile,
  writeCommandCodeRelayProvider,
} from "../../../backends/command-code/src/runtime/commandCodeProviders.js";
import { GrokSessionStore } from "../../../backends/grok/src/runtime/grokSessionStore.js";
import { findGrokBin } from "../../../backends/grok/src/runtime/grokCompatibleProbe.js";
import { GrokBridge, GROK_OFFICIAL_PROVIDER_ID, buildGrokOfficialProvider } from "../../../backends/grok/src/runtime/grokBridge.js";
import { MuseSessionStore } from "../../../backends/muse/src/runtime/museSessionStore.js";
import { findMuseBin } from "../../../backends/muse/src/runtime/museCompatibleProbe.js";
import { MuseBridge, MUSE_OFFICIAL_PROVIDER_ID, buildMuseOfficialProvider } from "../../../backends/muse/src/runtime/museBridge.js";
import { MiniBridge, MINI_CODEX_VERSION, type MiniSnapshot } from "../../../backends/mini/src/runtime/miniBridge.js";
import { MiniSessionStore } from "../../../backends/mini/src/runtime/miniSessionStore.js";
import { MiniFileHistory, migrateMiniSqliteHistory, miniHistoryDisplayTitle, shouldRouteToMiniBackend } from "../../../backends/mini/src/runtime/miniFileHistory.js";
import { PiSessionStore } from "../../../backends/pi/src/runtime/piSessionStore.js";
import { PiBridge, PI_OFFICIAL_PROVIDER_ID } from "../../../backends/pi/src/runtime/piBridge.js";
import { OpencodeSessionStore } from "../../../backends/opencode/src/runtime/opencodeSessionStore.js";
import { isNativeOpencodeSessionId, listNativeOpencodeThreads } from "../../../backends/opencode/src/runtime/opencodeHistoryProjection.js";
import { listNativeMuseThreads } from "../../../backends/muse/src/runtime/museHistoryProjection.js";
import { OpencodeBridge, OPENCODE_OFFICIAL_PROVIDER_ID, OPENCODE_V1_GROUP_ID, OPENCODE_V2_GROUP_ID, resolveOpencodeLocalGroupId, buildOpencodeOfficialProvider, OPENCODE_FALLBACK_FREE_MODELS, OPENCODE_V2_FALLBACK_MODELS, type OpencodeSessionSnapshot } from "../../../backends/opencode/src/runtime/opencodeBridge.js";
import { findPiBin } from "../../../backends/pi/src/runtime/piCompatibleProbe.js";
import { findOpencodeBin, findOpencodeV2Bin, listOpencodeModelDetailsAsync, listOpencodeModelsAsync, filterOpencodeFreeModels, isOpencodeFreeModel, probeOpencodeCliCommand } from "../../../backends/opencode/src/runtime/opencodeCompatibleProbe.js";
import { codexPlatformRuntimeEnv } from "./codexRuntimeEnv.js";
import { prepareVirtualCodexConfig, resolveVirtualCodexConfigPath, resolveCodexUserConfigPath, syncModelProvidersToUserConfig } from "@cxu/sdk-backend";
import { diagnoseAgentReadiness, readAgentModelCatalog } from "./agentReadiness.js";
import { CODEX_ULTRA_MODEL_CATALOG_FILE, writeCodexModelCatalog, type CodexModelCatalogOptions } from "./codexModelCatalog.js";
import { ThreadSubscriptionRegistry } from "./threadSubscriptionRegistry.js";
import { CodexStreamRetryTracker, isBenignCodexStderr, parseCodexStderrLine } from "./codexStreamRetryMonitor.js";
import { SharedThreadBridgeRegistry } from "./sharedThreadBridgeRegistry.js";
import { ThreadWriterLeaseStore } from "./threadWriterLeaseStore.js";
import { isCodeWorkspacePath, parseCodeWorkspaceFolders, updateCodeWorkspaceFolders } from "./codeWorkspace.js";
import { codexUiDataDir, LocalDatabase } from "./localDatabase.js";
import { UserPreferencesStore } from "./userPreferencesStore.js";
import { setGlobalCodexEnvironment } from "./globalCodexEnvironment.js";
import { ThreadRuntimeMetadataStore } from "./threadRuntimeMetadataStore.js";
import { runSaVmTool, isSaVmBlockedToolName, type SaVmRunResult } from "./saVmTool.js";
import { buildCloudflareJevRequestUrl, buildJevConnectivityQuestions, cloudflareJevBodyModel, getSharedJevConfig, isCloudflareJevUpstream, padCloudflareJevQuestions, resolveCloudflareJevModel, setSharedJevConfig, setJevRelayExecutor, unwrapJevUpstreamPayload } from "../../../backends/jev/src/jev/saVmJev.js";
import { parseDynamicToolArguments } from "./dynamicToolProtocol.js";
import { parseAndCheckSaVmPatch } from "./saVmApplyPatch.js";
import { normalizeSaVmParallelTasks, validateSaVmRequestBody } from "./saVmRequest.js";
import { checkSaVmDelete, checkSaVmPath, checkSaVmProcess, classifySaVmExecutionRequest, extractCommandArgv, normalizeSaVmPolicy } from "../../../backends/vmtool-security/src/security/saVmPolicy.js";
import { isSystemWebSearchPermissionRequest } from "./systemWebSearch.js";
import { classifySaVmScriptToolRequest, detectPowerShellAntiPattern, isSaVmDirectCommandMethod, isSaVmScriptExecutable, saVmScriptLanguage } from "../../../backends/vmtool-security/src/security/saVmInterception.js";
import { syncSaVmWorkspaceSkillDirectory, SA_VM_WORKSPACE_SKILL_NAME } from "./saVmWorkspaceSkill.js";
import { ensureSaVmGlobalBundleInstalled, ensureSaVmProjectBundleInstalled, isJevMcpEnabled, resolveSaVmMcpScriptPath, upsertSaVmMcpServerJsonFile } from "./saVmBundle.js";
import { ThreadAgentRosterStore, type ThreadAgentMemberPatch } from "./threadAgentRosterStore.js";
import { createTerminalPty, forgetTerminalPty, isTerminalPtyEnabled, killTerminalPty, listTerminalPtys, readTerminalPty, resizeTerminalPty, writeTerminalPty } from "./terminalPty.js";
import { ProjectRoomStore } from "./projectRoomStore.js";
import { ImageHistoryStore, IMAGE_HISTORY_DEFAULT_LIMIT, IMAGE_HISTORY_MAX_LIMIT } from "./imageHistoryStore.js";
import { ProviderStore } from "./providerStore.js";
import { AuditLogStore } from "./auditLogStore.js";
import { extractRingTokenUsage, nextDirectUsageRequestId, parseAnalyticsRange, RequestUsageStore } from "./requestUsageStore.js";
import { GatewayRequestStore, type GatewayRequestEndpoint } from "./gatewayRequestStore.js";
import { CommandBlacklistPolicy, commandFromValue, type CommandBlacklistEvidence } from "./commandBlacklist.js";
import { AuthStore } from "./authStore.js";
import { LegalPolicyStore } from "./legalPolicyStore.js";
import {
  SecurityStore,
  generateTotpSecret,
  totpUri,
  verifyTotpCode
} from "./securityStore.js";
import {
  detectAll,
  writeEnvsOnly,
  testOpenAiApi,
  createInstallJob,
  getInstallJob,
  type InstallLaunchRequest,
  type LaunchEnvValues
} from "./launchInstall.js";
import { fetchProviderModels, testProvider } from "./providerModels.js";
import { probeWebDevPreviewUrl } from "./webdevProbe.js";
import { listWebDevServers, startWebDevServer, stopWebDevServer } from "./webdevServers.js";
import { runImageGeneration, normalizeImageApiResponse } from "./imageProtocols.js";
import { persistImageApiResult } from "./imagePersistence.js";
import { extractJsonToolCall, listRelayToolDiagnostics, runRelayAnthropicWithKeyFailover, runRelayChatRequestWithKeyFailover, runRelayJevRequestWithKeyFailover, runRelayProtocolRequestWithKeyFailover, setEmbeddedOpencodeRunner, withEffectiveGroupBaseUrl } from "../../../backends/relay-config/src/relay/relayProtocolGateway.js";
import { FORWARD_RELAY_PROVIDER_ID, FORWARD_SETTINGS_OWNER, FORWARD_TOKEN_ENV_KEY, buildForwardRelayProvider, handleForwardModelsRequest, isForwardSharingEnabled } from "./forwardApi.js";
import { handleForwardChatRequest, handleForwardResponsesRequest } from "./forwardApi.js";
import type { ForwardBridge } from "./forwardTurn.js";
import { buildForwardModelIds, FORWARD_ACTIVE_CLIS, type ForwardModelInventory } from "./forwardModel.js";
import { bridgeTextToJevData, buildJevBridgeChatBody, buildJevBridgeResponsesBody, extractChatText, extractResponsesText, isNativeJevUpstream, normalizeBridgeProtocol } from "../../../backends/jev/src/jev/jevOpenAiBridge.js";
import { resolveRelayGatewayTarget, resolveRelayRuntimeOwnerId } from "./relayRuntimeSelection.js";
import { FreeCompactionFallbackTracker, inspectCompactionRelayRequest, isFreeCompactionFallbackStatus, resolveCompactionRelayRoute, rewriteRelayRequestModel, rewriteRelayRequestToolsForSaVm } from "../../../backends/free-mode/src/free/compactionRelayRequest.js";
import { buildCatalogImportPreview, fetchRelayCapabilityCatalog, modelSupportsProtocol, resolveModelProtocol } from "../../../backends/relay-config/src/relay/relayCatalog.js";
import { buildFreeOllamaGroups, eligibleFreeOllamaEntries, probeFreeOllamaEntries } from "../../../backends/relay-config/src/relay/freeOllama.js";
import { buildAllFreeGroups, buildClineFreeGroup, buildFreebuffGroup, buildKiloCodeGroup, buildOmniRouteFreeGroup, buildOpenCodeGroup, CLINE_RECOMMENDED_MODELS_URL, D2API_BASE_URL, D2API_DEFAULT_CONTEXT_WINDOW, D2API_DEFAULT_MODELS, fetchClineBalance, fetchClineFreeModels, fetchD2ApiFreeModels, fetchFreebuffFreeModels, fetchKiloCodeFreeModels, fetchOmniRouteFreeModels, FREEBUFF_BASE_URL, KILOCODE_FREE_BASE_URL, OMNIROUTE_FREE_BASE_URL, OMNIROUTE_FREE_PROVIDER_ID, resolveLocalClineToken, resolveLocalFreebuffCredentials } from "../../../backends/relay-config/src/relay/omniRouteFree.js";
import { listModels as listEmbeddedDuck2ApiModels } from "../../duck2api/src/types.ts";
import { createApp as createEmbeddedDuck2ApiApp } from "../../duck2api/src/server.ts";
import { getFreebuffSessionStatus, releaseFreebuffSession } from "../../../backends/relay-config/src/relay/freebuffSession.js";
import { FreeModelAccessManager } from "./freeModelAccess.js";
import { ensureCodexConfigHealthy, type CodexConfigHealthResult } from "./codexConfigHealth.js";
import {
  handleWorkspaceGitRpc,
  isWorkspaceGitMethod,
  isWorkspaceGitMutation
} from "./gitWorkspace.js";
import { localWorkspaceInfo } from "./workspaceRoots.js";
import {
  isWebSocketOriginAllowed,
  publicWebSocketRuntimeConfig,
  resolveWebSocketRuntimeConfig,
  trustedLocalDesktopAuthEnabled
} from "./websocketRuntime.js";
import { startRuntimeServer, type RuntimeServer, type RuntimeSocket } from "./runtime/server.js";
import { sanitizeLowFpsPerformanceReport } from "./performanceReport.js";
import { restoreLegacyImageViews } from "./legacyImageViewHistory.js";
import {
  requestWithLocalAgentLoopRecovery,
  requestWithThreadStartHistoryFallback
} from "./threadStartCompatibility.js";
import { detailedRpcError } from "./rpcErrorContext.js";
import { isRemoteThreadHistoryMethod, selectThreadRpcBridgeKind } from "./threadRpcRouting.js";
import { staticAssetContentType } from "./staticAssetContentType.js";
import { cleanDataGarbage, cleanDataGarbageSync } from "./dataGarbageCleaner.js";
import { ensureWorkspaceAgentsFile, WINDOWS_POWERSHELL_UTF8_RULE } from "./workspaceAgents.js";
import { DEFAULT_HISTORY_TAIL_BYTES, readThreadHistoryTail } from "./threadHistoryTail.js";
import {
  CodexApiEventStore,
  CodexApiSessionStore,
  type CodexApiEvent,
  type CodexApiSession
} from "./codexApiRuntime.js";
import { createRelayDirectory, findRelayDirectoryProvider } from "./relayDirectory.js";
import {
  assertProjectModelsAllowed,
  buildProjectDiscussionPlan,
  discussionRouteLabel,
  isTransientProjectTurnReadError,
  isUnsupportedProjectTurnListError,
  permanentProjectTurnErrorMessage,
  ProjectDiscussionError,
  PROJECT_DISCUSSION_ERROR_CODES,
  type ProjectDiscussionPlan
} from "./projectDiscussion.js";
import {
  buildRelaySettingsProvider,
  relaySettingsListItem,
  relaySettingsView,
  selectFetchedRelayModels,
  setRelayGroupModels
} from "./relaySettings.js";
import {
  goalContinuationTurnParams,
  goalFromResult,
  planAnswers,
  planTurnParams,
  runningTurnIds
} from "./codexModeApi.js";
import {
  WORKBENCH_CONTROL_NOTIFICATION,
  contextUsageView,
  applyWorkbenchLayoutAction,
  isUnmaterializedThreadError,
  isTransientThreadMetadataError,
  parseWorkbenchRuntime,
  workbenchThreadStartParams,
  workbenchTurnStartParams
} from "./workbenchControlApi.js";
import {
  closeRemoteBunNodeTunnel,
  installRemoteBunNode,
  openRemoteBunNodeTunnel,
  probeRemoteBunNode,
  remoteBunNodeRuntime,
  requestRemoteBunNode,
  syncRelayToRemoteBunNode,
  type RemoteBunNodeProbe
} from "./remoteBunNode.js";

type SocketData = {
  clientId: string;
  user: AuthUser | null;
  token: string | null;
  connectedAt: number;
  lastHeartbeatAt: number;
  lastMessageAt: number;
  lastHeartbeatRttMs: number | null;
  serverCloseReason: string | null;
};

class HttpApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "HttpApiError";
  }
}

/**
 * Keep optional CLI adapters inert until a request actually touches them.
 * Listener registration is deliberately deferred too, so module startup does
 * not construct a bridge/runtime merely because the server wires its events.
 */
function createLazyBridge<T extends object>(factory: () => T): T {
  let instance: T | null = null;
  const deferredListeners: Array<{ method: "on" | "once" | "addListener"; args: unknown[] }> = [];
  const ensure = (): T => {
    if (!instance) {
      instance = factory();
      for (const listener of deferredListeners) {
        Reflect.apply((instance as Record<string, unknown>)[listener.method] as (...args: unknown[]) => unknown, instance, listener.args);
      }
      deferredListeners.length = 0;
    }
    return instance;
  };
  let proxy: T;
  proxy = new Proxy({} as T, {
    get(_target, property) {
      if (property === "on" || property === "once" || property === "addListener") {
        return (...args: unknown[]) => {
          if (instance) {
            return Reflect.apply((instance as Record<string, unknown>)[property as string] as (...args: unknown[]) => unknown, instance, args);
          }
          deferredListeners.push({ method: property, args });
          return proxy;
        };
      }
      if (property === "stop") {
        return (...args: unknown[]) => {
          if (!instance) return undefined;
          return Reflect.apply((instance as Record<string, unknown>).stop as (...args: unknown[]) => unknown, instance, args);
        };
      }
      if (property === "hasSession") {
        return (...args: unknown[]) => instance
          ? Reflect.apply((instance as Record<string, unknown>).hasSession as (...args: unknown[]) => unknown, instance, args)
          : false;
      }
      if (property === "deleteSession") {
        return (...args: unknown[]) => {
          if (instance) Reflect.apply((instance as Record<string, unknown>).deleteSession as (...args: unknown[]) => unknown, instance, args);
        };
      }
      const value = Reflect.get(ensure(), property);
      return typeof value === "function" ? value.bind(instance) : value;
    }
  });
  return proxy;
}
/** In-flight turns per user for concurrency enforcement. */
const activeTurnsByUser = new Map<string, Set<string>>();
// Codex may report a parent turn terminal before its spawned child threads
// finish. Hold that notification until every child turn reaches a terminal
// state so the UI never renders a completed parent with active work below it.
const codexChildParentByThread = new Map<string, string>();
const codexActiveChildrenByParent = new Map<string, Set<string>>();
const codexDeferredTerminalByTurn = new Map<string, JsonRpcMessage & { method: string; params?: JsonValue }>();

function trackCodexChildStarted(childThreadId: string | undefined, parentThreadId: string | undefined): void {
  if (!childThreadId || !parentThreadId || childThreadId === parentThreadId) return;
  codexChildParentByThread.set(childThreadId, parentThreadId);
  const children = codexActiveChildrenByParent.get(parentThreadId) ?? new Set<string>();
  children.add(childThreadId);
  codexActiveChildrenByParent.set(parentThreadId, children);
}

function trackCodexChildTerminal(childThreadId: string | undefined): string | undefined {
  if (!childThreadId) return undefined;
  const parentThreadId = codexChildParentByThread.get(childThreadId);
  if (!parentThreadId) return undefined;
  codexChildParentByThread.delete(childThreadId);
  const children = codexActiveChildrenByParent.get(parentThreadId);
  children?.delete(childThreadId);
  if (children?.size === 0) codexActiveChildrenByParent.delete(parentThreadId);
  return parentThreadId;
}

function codexParentHasActiveChildren(threadId: string): boolean {
  return (codexActiveChildrenByParent.get(threadId)?.size ?? 0) > 0;
}

function trackCodexChildrenFromItem(parentThreadId: string | undefined, item: Record<string, unknown>): void {
  if (!parentThreadId || stringValue(item.type) !== "collabAgentToolCall") return;
  const receiverThreadIds = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [];
  for (const receiverThreadId of receiverThreadIds) {
    if (typeof receiverThreadId === "string") trackCodexChildStarted(receiverThreadId, parentThreadId);
  }
}

function flushDeferredCodexParent(parentThreadId: string): void {
  if (codexParentHasActiveChildren(parentThreadId)) return;
  const deferred = codexDeferredTerminalByTurn.get(parentThreadId);
  if (!deferred) return;
  codexDeferredTerminalByTurn.delete(parentThreadId);
  routeCodexNotification(deferred);
}

function activeTurnCount(userId: string): number {
  return activeTurnsByUser.get(userId)?.size ?? 0;
}

function trackTurnStart(userId: string, turnKey: string): void {
  let set = activeTurnsByUser.get(userId);
  if (!set) {
    set = new Set();
    activeTurnsByUser.set(userId, set);
  }
  set.add(turnKey);
}

function trackTurnEnd(userId: string, turnKey: string): void {
  const set = activeTurnsByUser.get(userId);
  if (!set) return;
  set.delete(turnKey);
  if (set.size === 0) {
    activeTurnsByUser.delete(userId);
  }
}

function releaseAllTurnsForUser(userId: string): void {
  activeTurnsByUser.delete(userId);
}

function extractTurnKey(result: JsonValue, params: Record<string, unknown>): string | null {
  const record = asRecord(result);
  const turn = asRecord(record.turn);
  const turnId = stringValue(turn.id) ?? stringValue(record.turnId) ?? stringValue(record.id);
  const threadId = stringValue(params.threadId) ?? stringValue(asRecord(params.thread).id) ?? stringValue(turn.threadId);
  if (turnId) {
    return `turn:${turnId}`;
  }
  if (threadId) {
    return `thread:${threadId}:${Date.now()}`;
  }
  return null;
}

const PORT = Number(process.env.CODEX_UI_PORT ?? 43110);
const websocketRuntime = resolveWebSocketRuntimeConfig();
const publicWebSocketRuntime = publicWebSocketRuntimeConfig(websocketRuntime);
const HOST = websocketRuntime.host;
const WEBSOCKET_HEARTBEAT_INTERVAL_MS = websocketRuntime.heartbeatIntervalMs;
const WEBSOCKET_HEARTBEAT_TIMEOUT_MS = websocketRuntime.heartbeatTimeoutMs;
const sessionToken = process.env.CODEX_UI_TOKEN ?? randomBytes(24).toString("base64url");
process.env.CODEX_UI_TOKEN = sessionToken;
const RELAY_GATEWAY_ENV_KEY = "CODEX_UI_RELAY_GATEWAY_TOKEN";
// Cursor's "local mode" is a compile-time build flag (buildFlags.js localMode:!0)
// that only exists in Cursor's enterprise/on-prem builds; the consumer Windows
// build ignores --local-mode entirely, so injection cannot bypass its login wall.
// All Cursor injection entry points are disabled until that changes.
const CURSOR_INJECTION_ENABLED = false;
const relayGatewayToken = process.env[RELAY_GATEWAY_ENV_KEY]?.trim() || randomBytes(32).toString("base64url");
// 对外 /v1 转发 key (P2): 未配置则每启动随机, 回环调用免 key, 远端必须 Bearer。
const forwardToken = process.env[FORWARD_TOKEN_ENV_KEY]?.trim() || randomBytes(32).toString("base64url");
const freeCompactionFallbackTracker = new FreeCompactionFallbackTracker(3);
const localDatabase = new LocalDatabase();
let embeddedDuck2ApiImagesApp: ReturnType<typeof createEmbeddedDuck2ApiApp> | null = null;
function getEmbeddedDuck2ApiImagesApp(): ReturnType<typeof createEmbeddedDuck2ApiApp> {
  if (!embeddedDuck2ApiImagesApp) embeddedDuck2ApiImagesApp = createEmbeddedDuck2ApiApp();
  return embeddedDuck2ApiImagesApp;
}
const userPreferencesStore = new UserPreferencesStore(localDatabase);
const threadRuntimeMetadataStore = new ThreadRuntimeMetadataStore(localDatabase);
const claudeSessionStore = new ClaudeSessionStore(localDatabase.connection);
const agySessionStore = new AgySessionStore(localDatabase.connection);
const grokSessionStore = new GrokSessionStore(localDatabase.connection);
const museSessionStore = new MuseSessionStore(localDatabase.connection);
const miniSessionStore = new MiniSessionStore(localDatabase.connection);
// Mini chat history lives in markdown files, not the database (see
// backends/mini/src/runtime/miniFileHistory.ts). The SQLite store above is only read once
// at startup to migrate legacy rows, then stays empty.
const miniHistory = new MiniFileHistory();
try {
  const migrated = migrateMiniSqliteHistory(miniSessionStore, miniHistory);
  if (migrated.imported > 0 || migrated.failed > 0) {
    console.log(`[mini-history] migrated ${migrated.imported} sqlite rows to files (skipped ${migrated.skipped}, failed ${migrated.failed})`);
  }
} catch (error) {
  console.warn("[mini-history] sqlite migration failed, continuing with files only:", error);
}
const piSessionStore = new PiSessionStore(localDatabase.connection);
const opencodeSessionStore = new OpencodeSessionStore(localDatabase.connection);
const threadAgentRosterStore = new ThreadAgentRosterStore(localDatabase);
const projectRoomStore = new ProjectRoomStore(localDatabase);
const sshWorkspaceStore = new SshWorkspaceStore(localDatabase);
const remoteThreadRouteStore = new RemoteThreadRouteStore(localDatabase);
const imageHistoryStore = new ImageHistoryStore(localDatabase);
const providerStore = new ProviderStore(localDatabase);
const freeModelAccess = new FreeModelAccessManager();
const auditLogStore = new AuditLogStore(localDatabase);
const requestUsageStore = new RequestUsageStore(localDatabase.connection);
const gatewayRequestStore = new GatewayRequestStore(localDatabase.connection);
const requestUsageDebitInFlight = new Set<string>();
// 直连用量（`thread/tokenUsage/updated` 环信封）按 turn 计 seq，合成唯一 requestId。
const directUsageSeqByTurn = new Map<string, number>();
// turn/started 到达时间（直连旁路去重的时间窗口起点）。
const directTurnStartedAt = new Map<string, number>();
const commandBlacklistPolicy = new CommandBlacklistPolicy();
const authStore = AuthStore.fromEnv(process.env, localDatabase);
const legalPolicyStore = new LegalPolicyStore(localDatabase);
const securityStore = new SecurityStore(localDatabase);
void ensureSaVmGlobalBundleInstalled().catch((error) => {
  console.warn("[sa-vm] background global bundle installation failed", error);
});
try {
  const initialJevConfig = (userPreferencesStore.get("local").jev as Record<string, unknown> | undefined);
  if (initialJevConfig && typeof initialJevConfig === "object") {
    setSharedJevConfig(initialJevConfig);
  }
} catch {
  // Ignored on initial database setup
}
setJevRelayExecutor(async ({ state, model, questions, providerId, groupId, bridgeProtocol }) => {
  const provider = await providerStore.get(providerId);
  const group = provider?.groups?.find((entry) => entry.id === groupId)
    ?? provider?.groups?.find((entry) => entry.kind !== "image" && entry.status !== "disabled")
    ?? provider?.groups?.[0];
  if (!provider || !group) {
    return new Response(JSON.stringify({ error: "Relay provider or group not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  const apiKeys = await resolveGroupApiKeys(provider, group);
  const upstreamBase = (group.baseUrl || provider.baseUrl || "").trim();
  // Mirror handleJevRelayProxyRequest: non-native upstreams go through the
  // OpenAI bridge so sa-vm active tools (jev_choose/checklist/...) work with
  // any existing relay, not just TypeSafe endpoints.
  if (!isNativeJevUpstream(upstreamBase)) {
    const questionMap = (questions ?? {}) as Record<string, { type?: string; instructions?: string; criteria?: unknown }>;
    const selectedModel = (model || "").trim() || group.models?.[0] || provider.defaultModel || "";
    if (!selectedModel) {
      return new Response(JSON.stringify({ error: "Relay group has no model for JEV bridge" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const protocol = normalizeBridgeProtocol(bridgeProtocol || getSharedJevConfig()?.bridgeProtocol || "openai-chat");
    const bridgeStartedAt = Date.now();
    try {
      const bridgeBody = protocol === "openai-responses"
        ? buildJevBridgeResponsesBody(selectedModel, state, questionMap)
        : buildJevBridgeChatBody(selectedModel, state, questionMap);
      const bridgePath = protocol === "openai-responses" ? "responses" : "chat/completions";
      const bridgeRequest = new Request(`http://jev-bridge.local/v1/${bridgePath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bridgeBody),
      });
      const upstream = protocol === "openai-responses"
        ? await runRelayProtocolRequestWithKeyFailover({ request: bridgeRequest, provider, group, apiKeys })
        : await runRelayChatRequestWithKeyFailover({ request: bridgeRequest, provider, group, apiKeys });
      const rawText = await upstream.text();
      if (!upstream.ok) {
        return new Response(rawText || JSON.stringify({ error: `JEV bridge upstream ${upstream.status}` }), { status: upstream.status, headers: { "Content-Type": "application/json" } });
      }
      let payload: unknown = null;
      try { payload = rawText ? JSON.parse(rawText) : null; } catch {
        return new Response(JSON.stringify({ error: "JEV bridge upstream returned invalid JSON" }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
      const answerText = protocol === "openai-responses" ? extractResponsesText(payload) : extractChatText(payload);
      if (!answerText.trim()) {
        return new Response(JSON.stringify({ error: "JEV bridge upstream returned empty content" }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
      const jevData = bridgeTextToJevData(answerText, questionMap, selectedModel);
      return new Response(JSON.stringify({ data: jevData, latencyMs: Date.now() - bridgeStartedAt, bridge: { protocol, model: selectedModel } }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message || "JEV bridge failed" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  }
  const gatewayRequest = new Request("http://jev-relay.local/v1/jev/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, model, questions })
  });
  return await runRelayJevRequestWithKeyFailover({ request: gatewayRequest, provider, group, apiKeys });
});
const miniBridge = new MiniBridge({
  skillRoots: [homedir()],
  resolveCodexHome: () => {
    try {
      const home = bridge.getStatus().codexHome;
      return home && (process.platform !== "win32" || !home.startsWith("/")) ? home : null;
    } catch {
      return null;
    }
  },
  // Thread VM policy for Mini sa_vm calls: shield on => sandbox gates apply
  // (e.g. destructive-git guard); shield off => fully open, zero interception.
  // Resolved per call so toggle changes take effect without restarting turns.
  resolveThreadPolicy: (threadId: string) => {
    try {
      const meta = threadRuntimeMetadataStore.getAny(threadId) as
        | { vmEnabled?: boolean; vmPolicy?: SaVmPolicyConfig }
        | undefined;
      // Sandbox off => fully open, zero interception: never enforce a stale
      // persisted policy when the thread did not enable the VM sandbox.
      if (!meta || meta.vmEnabled !== true) return undefined;
      return meta.vmPolicy;
    } catch {
      return undefined;
    }
  },
  resolveRelayTarget: async (providerId: string, groupId?: string, model?: string) => {
    if (!providerId) return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    const group = groupId
      ? provider.groups?.find((g) => g.id === groupId || g.name === groupId
        || (provider.id === OPENCODE_OFFICIAL_PROVIDER_ID && resolveOpencodeLocalGroupId(groupId) === g.id))
      : provider.groups?.[0];
    if (!group || group.kind === "image" || group.status === "disabled") return undefined;
    // Route every relay through the loopback relay-gateway so Mini never
    // handles upstream credentials directly (placeholder key satisfies the
    // bridge's non-empty-key requirement; the gateway resolves the real
    // credential server-side). Context window follows the relay-group
    // setting (user-editable); the bridge resolves it per model.
    const relayModel = typeof model === "string" && model.trim() ? model.trim() : undefined;
    const relayBase = relayModel ? stripModelContextVariant(relayModel).baseModel : undefined;
    const relayCapability = relayModel && relayBase
      ? (group.modelCapabilities?.[relayModel] ?? group.modelCapabilities?.[relayBase] ?? null)
      : null;
    return {
      baseUrl: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
      apiKey: "loopback",
      protocol: group.responseProtocol === "openai-response" ? "responses" : "chat",
      contextWindow: typeof group.contextWindow === "number" && group.contextWindow > 0 ? Math.round(group.contextWindow) : null,
      modelCapability: relayCapability,
    };
  },
  onSnapshot: (snapshot) => {
    try {
      miniHistory.upsert({
        threadId: snapshot.threadId,
        ownerId: snapshot.ownerId ?? "local",
        model: snapshot.model ?? null,
        cwd: snapshot.cwd ?? null,
        snapshot,
      });
    } catch (error) {
      console.warn(`[mini-history] persist failed for ${snapshot.threadId}:`, error);
    }
  },
  loadSnapshot: (threadId: string, ownerId = "local") => {
    const record = miniHistory.get(ownerId, threadId)
      ?? (ownerId !== "local" ? miniHistory.get("local", threadId) : null);
    if (record?.stateJson) {
      try {
        return JSON.parse(record.stateJson);
      } catch {
        // ignore parse error and fall back to runtime metadata
      }
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model || "gpt-5-mini",
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
        effort: runtime.reasoningEffort ?? undefined,
        turns: [],
        messages: []
      };
    }
    return null;
  },
  loadMetadata: (threadId: string, ownerId = "local") => {
    const meta = miniHistory.getMetadata(ownerId, threadId);
    if (meta) {
      const { subStatus, ...rest } = meta;
      return {
        ...rest,
        subStatus: subStatus === "running" || subStatus === "completed" || subStatus === "failed" || subStatus === "interrupted"
          ? subStatus
          : undefined,
      };
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model,
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
        effort: runtime.reasoningEffort ?? undefined,
      };
    }
    return null;
  },
  setArchivedSnapshot: (threadId: string, ownerId: string, archived: boolean) => {
    try {
      return miniHistory.setArchived(ownerId, threadId, archived);
    } catch (error) {
      console.warn(`[mini-history] setArchived failed for ${threadId}:`, error);
      return false;
    }
  },
  listSnapshots: (ownerId = "local") => {
    return miniHistory.listForOwner(ownerId).flatMap((record) => {
      if (!record.stateJson) return [];
      try {
        return [JSON.parse(record.stateJson) as MiniSnapshot];
      } catch {
        return [];
      }
    });
  },
});
const pendingMiniServerRequests = new Map<string, { bridge: MiniBridge; remoteId: string | number }>();

miniBridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
miniBridge.on("message", (msg: any) => {
  if (msg && "method" in msg && "id" in msg) {
    const request = msg as JsonRpcRequest;
    const routedId = "mini:" + String(request.id);
    pendingMiniServerRequests.set(routedId, { bridge: miniBridge, remoteId: request.id });
    void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route mini server request", error));
  } else if (msg && "method" in msg) {
    routeCodexNotification(msg);
  }
});
const miniThreadBridges = new Map<string, MiniBridge>();

const bridge: CodexRuntimeClient = createCodexRuntimeClient(() => ({
  RUST_LOG: process.env.RUST_LOG || "warn",
  CODEX_LOG: process.env.CODEX_LOG || "warn",
  ...providerStore.runtimeEnv(),
  [RELAY_GATEWAY_ENV_KEY]: relayGatewayToken,
  ...codexPlatformRuntimeEnv(process.platform, localDatabase.dir)
}), process.platform, miniBridge);
const sshBridges = new Map<string, SshCodexBridge>();
const remoteBunThreadBridges = new Map<string, RemoteBunCodexBridge>();
const pendingRemoteCursorWrites = new Map<string, { cursor: number; timer: ReturnType<typeof setTimeout> }>();
const pendingSshServerRequests = new Map<string, { bridge: SshCodexBridge; remoteId: string | number }>();
const pendingClaudeServerRequests = new Map<string, { bridge: CodeCliBridge; remoteId: string | number }>();
const pendingRemoteBunServerRequests = new Map<string, { bridge: RemoteBunCodexBridge; remoteId: string | number }>();
const pendingOpencodeServerRequests = new Map<string, { bridge: OpencodeBridge; remoteId: string | number }>();
const pendingAgyServerRequests = new Map<string, { bridge: AgyBridge; remoteId: string | number }>();
const pendingAuggieServerRequests = new Map<string, { bridge: AuggieAgentBridge; remoteId: string | number }>();
const claudeConfigDirs = new Map<CodeCliBridge, string>();
const claudeSshLaunchers = new Map<CodeCliBridge, SshCodeCliLauncher>();
const claudeSkillInventories = new Map<CodeCliBridge, ClaudeSkillInventory>();
const claudeConfigCleanup = new Map<CodeCliBridge, Promise<void>>();
const claudeVirtualParentByThread = new Map<string, string>();
const claudeThreadBridges = new SharedThreadBridgeRegistry<CodeCliBridge>((releasedBridge) => {
  for (const [key, bridgeForProfile] of claudeBridges.entries()) {
    if (bridgeForProfile === releasedBridge) claudeBridges.delete(key);
  }
  for (const [requestId, pending] of pendingClaudeServerRequests) {
    if (pending.bridge === releasedBridge) pendingClaudeServerRequests.delete(requestId);
  }
  const configDir = claudeConfigDirs.get(releasedBridge);
  claudeConfigDirs.delete(releasedBridge);
  claudeSkillInventories.delete(releasedBridge);
  const launcher = claudeSshLaunchers.get(releasedBridge);
  claudeSshLaunchers.delete(releasedBridge);
  launcher?.dispose();
  if (configDir) {
    const cleanup = removeClaudeConfigDirAfterExit(releasedBridge, configDir).finally(() => {
      claudeConfigCleanup.delete(releasedBridge);
    });
    claudeConfigCleanup.set(releasedBridge, cleanup);
  }
});
const claudeBridges = new Map<string, CodeCliBridge>();

const grokBridge = createLazyBridge(() => new GrokBridge({
  resolveRelayProxyConfig: async (providerId: string, groupId?: string, model?: string) => {
    if (!providerId || providerId === "grok-official") return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    const group = groupId ? provider.groups?.find((g) => g.id === groupId || g.name === groupId) : provider.groups?.[0];
    if (!group) return undefined;
    const apiKey = await resolveGroupApiKey(provider, group);
    const apiKeys = (group.keys && group.keys.length > 0) ? group.keys : (apiKey ? [apiKey] : []);
    const baseUrl = group.baseUrl || provider.baseUrl || "";
    const targetModel = model || group.models?.[0] || provider.defaultModel || "grok-4.6";
    // Group protocol must reach the proxy: a responses-only relay rejects
    // chat/completions with ModelProtocolUnsupported. Resolve per-model so
    // model_auto groups pick the right wire protocol for the actual model.
    const baseTargetModel = stripModelContextVariant(targetModel).baseModel || targetModel;
    const catalogModel = provider.capabilityCatalog?.data.find(
      (entry) => entry.model_name === targetModel || entry.model_name === baseTargetModel
    );
    const groupProtocol = resolveModelProtocol(group, catalogModel);
    const wireApi = groupProtocol === "openai-response"
      ? "responses"
      : groupProtocol === "anthropic"
        ? "anthropic"
        : groupProtocol === "gemini"
          ? "gemini"
          : "chat";
    return {
      targetBaseUrl: baseUrl,
      targetModel,
      wireApi,
      apiKeys,
      provider,
      group,
      modelDisplayName: model,
    };
  },
  onSnapshot: (snapshot) => {
    grokSessionStore.upsert({
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId ?? "local",
      sessionId: snapshot.sessionId ?? null,
      model: snapshot.model ?? null,
      cwd: snapshot.cwd ?? null,
      permissionMode: snapshot.mode,
      stateJson: JSON.stringify(snapshot),
    });
  },
  loadMetadata: (threadId: string, ownerId = "local") => {
    const record = grokSessionStore.getMetadata(ownerId, threadId)
      ?? (ownerId !== "local" ? grokSessionStore.getMetadata("local", threadId) : null)
      ?? grokSessionStore.findBySessionId(threadId);
    if (record) {
      return {
        threadId: record.threadId,
        sessionId: record.sessionId ?? undefined,
        model: record.model ?? undefined,
        cwd: record.cwd ?? undefined,
      };
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model,
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
      };
    }
    return null;
  },
  loadSnapshot: (threadId: string, ownerId = "local") => {
    const record = grokSessionStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? grokSessionStore.get("local", threadId) : null)
      ?? grokSessionStore.findBySessionId(threadId);
    if (record?.stateJson) {
      try {
        return JSON.parse(record.stateJson);
      } catch {
        // fall through
      }
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model || "grok-4.6",
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
        turns: [],
        messages: [],
      };
    }
    return null;
  }
}));
grokBridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
const grokThreadBridges = new Map<string, GrokBridge>();

const museBridge = createLazyBridge(() => new MuseBridge({
  resolveRelayTarget: async (providerId: string, groupId?: string, model?: string) => {
    if (!providerId || providerId === "muse-official") return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    const group = groupId ? provider.groups?.find((g) => g.id === groupId || g.name === groupId) : provider.groups?.[0];
    if (!group || group.kind === "image" || group.status === "disabled") return undefined;
    const targetModel = model || group.models?.[0] || provider.defaultModel || "muse-spark-1.3";
    // Muse CLI requires resolving model metadata from `<origin>/muse-code/models`
    // and withholds bearer tokens on arbitrary origins. Third-party relays must always
    // route through our loopback relay-gateway (which serves the catalog at origin root
    // and proxies upstream with real credentials server-side).
    return {
      baseUrl: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
      apiKey: "loopback",
      model: targetModel,
    };
  },
  onSnapshot: (snapshot) => {
    museSessionStore.upsert({
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId ?? "local",
      sessionId: snapshot.museSessionId ?? null,
      model: snapshot.model ?? null,
      cwd: snapshot.cwd ?? null,
      stateJson: JSON.stringify(snapshot),
    });
  },
  loadSnapshot: (threadId: string, ownerId = "local") => {
    const record = museSessionStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? museSessionStore.get("local", threadId) : null)
      ?? museSessionStore.findBySessionId(threadId);
    if (!record?.stateJson) return null;
    try {
      return JSON.parse(record.stateJson);
    } catch {
      return null;
    }
  },
  loadMetadata: (threadId: string, ownerId = "local") => {
    const record = museSessionStore.getMetadata(ownerId, threadId)
      ?? (ownerId !== "local" ? museSessionStore.getMetadata("local", threadId) : null);
    if (!record) return null;
    return {
      threadId: record.threadId,
      museSessionId: record.sessionId ?? undefined,
      model: record.model ?? undefined,
      cwd: record.cwd ?? undefined,
    };
  },
}));
museBridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
const museThreadBridges = new Map<string, MuseBridge>();

/**
 * Every non-Mini CLI backend is an opt-in plugin: default off unless the
 * matching `CODEX_UI_*_ENABLED` env var is explicitly set to 1/true/yes.
 * The Settings UI can still enable them at runtime via PATCH.
 */
function cliPluginEnabledByDefault(envValue: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((envValue ?? "").trim());
}

/**
 * CLI plugin enablement (R3): one registry-driven store for every
 * plugin that declares a Settings toggle in its server plugin.
 * Seeded lazily from the plugin's declared env var; the Settings
 * UI flips entries at runtime via the generic toggle route.
 */
const cliPluginEnabledState = new Map<string, boolean>();

function isCliPluginEnabled(pluginId: string): boolean {
  let enabled = cliPluginEnabledState.get(pluginId);
  if (enabled === undefined) {
    const entry = cliSettingsEntries().find((candidate) => candidate.pluginId === pluginId);
    enabled = entry ? cliPluginEnabledByDefault(process.env[entry.enabledEnvVar]) : false;
    cliPluginEnabledState.set(pluginId, enabled);
  }
  return enabled;
}

function setCliPluginEnabled(pluginId: string, value: boolean): void {
  cliPluginEnabledState.set(pluginId, value);
}




const piBridge = createLazyBridge(() => new PiBridge({
  resolveRelayConfig: async (providerId?: string, groupId?: string, model?: string) => {
    if (!providerId || providerId === PI_OFFICIAL_PROVIDER_ID) return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    const group = groupId ? provider.groups?.find((g) => g.id === groupId || g.name === groupId) : provider.groups?.[0];
    if (!group) return undefined;
    const apiKey = await resolveGroupApiKey(provider, group);
    const baseUrl = group.baseUrl || provider.baseUrl || "";
    const targetModel = model || group.models?.[0] || provider.defaultModel || "pi-relay/default";
    let api: string | undefined;
    // Honor an explicit openai-response declaration: responses-only upstreams
    // (e.g. opencode.ai zen gateways) hard-reject chat/completions with
    // ModelProtocolUnsupported, and pi itself aborts on the mismatch.
    // Verified 2026-09-30: go/muse-spark-1.3-contributor fails via
    // completions, succeeds via responses.
    if (group.responseProtocol === "anthropic") {
      api = "anthropic-messages";
    } else if (group.responseProtocol === "gemini") {
      api = "google";
    } else if (group.responseProtocol === "openai-response") {
      api = "openai-responses";
    } else {
      api = "openai-completions";
    }
    const allModels = Array.from(
      new Set([targetModel, ...(group.models || []), provider.defaultModel].filter(Boolean))
    ) as string[];
    return {
      baseUrl,
      apiKey: apiKey || undefined,
      model: allModels.join(","),
      api,
    };
  },
  onSnapshot: (snapshot) => {
    piSessionStore.upsert({
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId ?? "local",
      sessionId: snapshot.sessionId ?? null,
      model: snapshot.model ?? null,
      cwd: snapshot.cwd ?? null,
      stateJson: JSON.stringify(snapshot),
    });
  },
  loadMetadata: (threadId: string, ownerId = "local") => {
    const record = piSessionStore.getMetadata(ownerId, threadId)
      ?? (ownerId !== "local" ? piSessionStore.getMetadata("local", threadId) : null)
      ?? piSessionStore.findBySessionId(threadId);
    if (record) {
      return {
        threadId: record.threadId,
        sessionId: record.sessionId ?? undefined,
        model: record.model ?? undefined,
        cwd: record.cwd ?? undefined,
      };
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model,
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
      };
    }
    return null;
  },
  loadSnapshot: (threadId: string, ownerId = "local") => {
    const record = piSessionStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? piSessionStore.get("local", threadId) : null)
      ?? piSessionStore.findBySessionId(threadId);
    if (record?.stateJson) {
      try {
        return JSON.parse(record.stateJson);
      } catch {
        // fall through
      }
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model || "pi-relay/default",
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
        turns: [],
        messages: [],
      };
    }
    return null;
  }
}));
piBridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
const piThreadBridges = new Map<string, PiBridge>();


const opencodeBridgeOptions = {
  resolveRelayTarget: async (providerId: string, groupId?: string, model?: string) => {
    if (!providerId) return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    const group = groupId
      ? provider.groups?.find((g) => g.id === groupId || g.name === groupId
        || (provider.id === OPENCODE_OFFICIAL_PROVIDER_ID && resolveOpencodeLocalGroupId(groupId) === g.id))
      : provider.groups?.[0];
    if (!group || (group as { kind?: string }).kind === "image" || group.status === "disabled") return undefined;
    const targetModel = model?.trim() || group.models?.[0] || provider.defaultModel || "";
    if (!targetModel) return undefined;
    // 与 Mini 一致：经 loopback relay-gateway 收敛，上游 credential 由网关
    // 服务端解析，opencode 侧只用占位 key。
    const relayModel = targetModel;
    const relayBase = stripModelContextVariant(relayModel).baseModel;
    const relayCapability = relayModel && relayBase
      ? (group.modelCapabilities?.[relayModel] ?? group.modelCapabilities?.[relayBase] ?? null)
      : null;
    return {
      baseUrl: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
      apiKey: "loopback",
      targetModel,
      contextWindow: typeof group.contextWindow === "number" && group.contextWindow > 0 ? Math.round(group.contextWindow) : null,
      modelCapability: relayCapability,
    };
  },
  onSnapshot: (snapshot: OpencodeSessionSnapshot) => {
    opencodeSessionStore.upsert({
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId ?? "local",
      sessionId: snapshot.sessionId ?? null,
      model: snapshot.model ?? null,
      cwd: snapshot.cwd ?? null,
      stateJson: JSON.stringify(snapshot),
    });
  },
  loadSnapshot: (threadId: string, ownerId = "local") => {
    const record = opencodeSessionStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? opencodeSessionStore.get("local", threadId) : null)
      ?? opencodeSessionStore.findByThreadId(threadId)
      ?? opencodeSessionStore.findBySessionId(threadId);
    if (record?.stateJson) {
      try {
        return JSON.parse(record.stateJson);
      } catch {
        // fall through
      }
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model || "default",
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
        turns: [],
        messages: [],
      };
    }
    return null;
  },
  loadMetadata: (threadId: string, ownerId = "local") => {
    const record = opencodeSessionStore.getMetadata(ownerId, threadId)
      ?? (ownerId !== "local" ? opencodeSessionStore.getMetadata("local", threadId) : null)
      ?? opencodeSessionStore.findMetadataByThreadId(threadId)
      ?? opencodeSessionStore.findMetadataBySessionId(threadId);
    if (record) {
      return {
        threadId: record.threadId,
        ownerId: record.ownerId,
        sessionId: record.sessionId ?? undefined,
        model: record.model ?? undefined,
        cwd: record.cwd ?? undefined,
      };
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        additionalRoots: runtime.additionalRoots,
        model: runtime.model,
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
      };
    }
    return null;
  },
  listSnapshots: (ownerId = "local") => {
    const records = opencodeSessionStore.listForOwner(ownerId);
    return records.flatMap((r) => {
      if (!r.stateJson) return [];
      try {
        return [JSON.parse(r.stateJson) as OpencodeSessionSnapshot];
      } catch {
        return [];
      }
    });
  }
};
const opencodeBridge = createLazyBridge(() => new OpencodeBridge(opencodeBridgeOptions));
// OpenCode v2 (`opencode-v2` backend): the same bridge logic driving the
// v2 binary/API generation. Snapshots and pooled serve processes stay
// separate per generation (the snapshot apiVersion guard and the process
// fingerprint both key on the generation).
const opencodeV2Bridge = createLazyBridge(() => new OpencodeBridge({ ...opencodeBridgeOptions, opencodeApiVersion: 2 }));
opencodeBridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
opencodeBridge.on("message", (msg: any) => {
  if (msg && "method" in msg && "id" in msg) {
    const request = msg as JsonRpcRequest;
    const routedId = "opencode:" + String(request.id);
    pendingOpencodeServerRequests.set(routedId, { bridge: opencodeBridge, remoteId: request.id });
    void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route OpenCode server request", error));
  } else if (msg && "method" in msg) {
    routeCodexNotification(msg);
  }
});
opencodeV2Bridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
opencodeV2Bridge.on("message", (msg: any) => {
  if (msg && "method" in msg && "id" in msg) {
    const request = msg as JsonRpcRequest;
    const routedId = "opencode-v2:" + String(request.id);
    pendingOpencodeServerRequests.set(routedId, { bridge: opencodeV2Bridge, remoteId: request.id });
    void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route OpenCode v2 server request", error));
  } else if (msg && "method" in msg) {
    routeCodexNotification(msg);
  }
});
const opencodeThreadBridges = new Map<string, OpencodeBridge>();

// mini-opencodex: external OpenAI-protocol CLIs reach opencode-local (Zen)
// through the shared relay-gateway URL. The gateway cannot HTTP-forward to
// the 4096 placeholder (serve password + wrong protocol), so it delegates
// to this runner: one disposable direct-serve turn on the in-process
// OpencodeBridge, assistant text collected from bridge notifications.
// Scratch cwd per call keeps file-tool blast radius inside an empty temp
// dir; the thread is always deleted afterwards. Gateway callers select this
// path explicitly via provider opencode-local (no plugin-flag gating).
const OPENCODE_GATEWAY_OWNER = "relay-gateway";
const OPENCODE_GATEWAY_TURN_TIMEOUT_MS = 150_000;

async function runEmbeddedOpencodeLocalTurn(input: { model: string; prompt: string; signal?: AbortSignal | null; onDelta?: (delta: string) => void; toolNames?: string[] }): Promise<{ text: string; toolCall?: { id: string; name: string; arguments: string } }> {
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) throw new Error("opencode-local gateway turn has no prompt text");
  const toolNames = [...new Set((input.toolNames ?? []).map((name) => String(name ?? "").trim()).filter(Boolean))];
  // The scratch session cannot see the user's project and there is no UI
  // for permission prompts. When the client declared functions, direct the
  // model to emit exactly one JSON tool call (recovered below into a real
  // tool_calls entry for the CLIENT to execute locally, in the user's own
  // working directory) instead of attempting local tools. Otherwise answer
  // from the conversation only.
  const relayNote = toolNames.length > 0
    ? `[Relay bridge directive: you are answering through a relay. Your callable functions for this turn are exactly: ${toolNames.join(", ")}. You have no other usable tools in this session. To call one, reply with ONLY one JSON object like {"name": "<one of the above>", "arguments": {...}} and no other text. If no call is needed, answer using only the conversation, in plain text.]`
    : "[Relay bridge note: you are answering through a relay. Your file/shell tools see only an empty temp dir, not the user's project — do not attempt them; answer using only the conversation above, in plain text.]";
  // Directive-first ordering: models weight leading instructions over
  // trailing notes; the tool-call format must read as authoritative,
  // not as user chatter appended at the end.
  const turnPrompt = toolNames.length > 0 ? `${relayNote}\n\n${prompt}` : `${prompt}\n\n${relayNote}`;
  const model = (input.model ?? "").trim() || "opencode/big-pickle";
  const scratch = join(process.env.TMPDIR?.trim() || "/tmp", `opencode-gateway-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  const started = await opencodeBridge.request("thread/start", {
    cwd: scratch, model, providerId: OPENCODE_OFFICIAL_PROVIDER_ID, groupId: OPENCODE_V1_GROUP_ID, ownerId: OPENCODE_GATEWAY_OWNER,
  }) as unknown as { threadId?: string; thread?: { id?: string } };
  const threadId = String(started?.threadId ?? started?.thread?.id ?? "");
  if (!threadId) {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    throw new Error("opencode-local gateway turn failed to start a thread");
  }
  const cleanup = async (): Promise<void> => {
    try { await opencodeBridge.request("thread/delete", { threadId }); } catch { /* ignore */ }
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  };
  try {
    const text = await new Promise<string>((resolve, reject) => {
      let settled = false;
      let collected = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const interrupt = (): void => {
        try { void opencodeBridge.request("turn/interrupt", { threadId }); } catch { /* ignore */ }
      };
      const detach = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        opencodeBridge.off("notification", handler);
        opencodeBridge.off("message", messageHandler);
        try { input.signal?.removeEventListener("abort", onAbort); } catch { /* ignore */ }
      };
      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        detach();
        fn();
      };
      const onAbort = (): void => {
        interrupt();
        done(() => reject(new Error("opencode-local gateway turn aborted")));
      };
      const handler = (msg: any): void => {
        if (settled) return;
        const record = (msg && typeof msg === "object" ? msg : {}) as Record<string, unknown>;
        const params = (record.params && typeof record.params === "object" ? record.params : {}) as Record<string, unknown>;
        if (params.threadId !== threadId) return;
        const method = String(record.method ?? "");
        if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
          collected += params.delta;
          try { input.onDelta?.(params.delta); } catch { /* ignore */ }
          return;
        }
        if (method === "turn/completed") done(() => resolve(collected));
        else if (method === "turn/failed") done(() => reject(new Error(`opencode-local gateway turn failed: ${typeof params.error === "string" && params.error ? params.error : "upstream error"}`)));
        else if (method === "turn/interrupted") {
          // Runtime self-interrupt (e.g. after our own interrupt()): keep
          // partial text when there is any, hard-fail only on empty.
          if (collected.trim()) done(() => resolve(collected));
          else done(() => reject(new Error("opencode-local gateway turn was interrupted")));
        }
      };
      timer = setTimeout(() => {
        interrupt();
        done(() => reject(new Error("opencode-local gateway turn timed out")));
      }, OPENCODE_GATEWAY_TURN_TIMEOUT_MS);
      // Headless gateway turns have no UI for permission/question prompts
      // (tool approvals, requestUserInput). Without this, a tool-attempting
      // turn hangs until the 150s cap. End gracefully instead: keep
      // whatever text arrived (the post-processing below may still recover
      // a JSON tool call from it); only hard-fail when nothing arrived.
      // Scoped strictly to this threadId so other sessions are untouched.
      const finishEarly = (reason: string): void => {
        interrupt();
        done(() => {
          if (collected.trim()) resolve(collected);
          else reject(new Error(reason));
        });
      };
      const messageHandler = (msg: any): void => {
        if (settled) return;
        if (!msg || typeof msg !== "object" || msg.id === undefined) return;
        const record = msg as Record<string, unknown>;
        const params = (record.params && typeof record.params === "object" ? record.params : {}) as Record<string, unknown>;
        if (params.threadId !== threadId) return;
        const method = String(record.method ?? "server-request");
        const toolName = typeof params.toolName === "string" && params.toolName ? ` tool=${params.toolName}` : "";
        finishEarly(`opencode-local gateway turn needs an interactive answer (${method}${toolName}): run tools on the client side instead`);
      };
      opencodeBridge.on("notification", handler);
      opencodeBridge.on("message", messageHandler);
      if (input.signal?.aborted) {
        onAbort();
        return;
      }
      try { input.signal?.addEventListener("abort", onAbort, { once: true }); } catch { /* ignore */ }
      opencodeBridge.request("turn/start", {
        threadId, ownerId: OPENCODE_GATEWAY_OWNER,
        input: [{ type: "text", text: turnPrompt }],
        model, providerId: OPENCODE_OFFICIAL_PROVIDER_ID, groupId: OPENCODE_V1_GROUP_ID,
      }).catch((error: unknown) => done(() => reject(error instanceof Error ? error : new Error(String(error)))));
    });
    await cleanup();
    if (toolNames.length > 0) {
      const call = extractJsonToolCall(text, toolNames);
      if (call) return { text: "", toolCall: call };
    }
    return { text };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

setEmbeddedOpencodeRunner(runEmbeddedOpencodeLocalTurn);



const agyBridge = createLazyBridge(() => {
  ensureAgySettingsSnapshot();
  return new AgyBridge({
  resolveRelayProxyConfig: async (providerId: string, groupId?: string, model?: string) => {
    if (!providerId || providerId === "agy-official") return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    const group = groupId ? provider.groups?.find((g) => g.id === groupId || g.name === groupId) : provider.groups?.[0];
    if (!group) return undefined;
    const apiKey = await resolveGroupApiKey(provider, group);
    const apiKeys = (group.keys && group.keys.length > 0) ? group.keys : (apiKey ? [apiKey] : []);
    const baseUrl = group.baseUrl || provider.baseUrl || "";
    const targetModel = model || group.models?.[0] || provider.defaultModel || "gpt-4o";
    const baseTargetModel = stripModelContextVariant(targetModel).baseModel || targetModel;
    const catalogModel = provider.capabilityCatalog?.data.find(
      (entry) => entry.model_name === targetModel || entry.model_name === baseTargetModel
    );
    const protocol = resolveModelProtocol(group, catalogModel);
    return {
      targetBaseUrl: baseUrl,
      targetModel,
      protocol,
      apiKeys,
      provider,
      group,
      modelDisplayName: model,
    };
  },
  resolveRelayEnv: async (providerId: string, groupId?: string, _model?: string): Promise<Record<string, string> | undefined> => {
    if (!providerId || providerId === "agy-official") return undefined;
    const provider = await providerStore.get(providerId);
    if (!provider) return undefined;
    // Check if this is an agy-launch provider (local proxy)
    if (provider.serviceProvider?.id === "agy-launch" || provider.id === "agy-launch") {
      // Return the local agy-launch proxy URL - port 0 means auto-select free port
      // The actual port will be determined when agy-launch starts
      return {
        CLOUD_CODE_URL: "http://127.0.0.1:0",
      };
    }
    const group = groupId ? provider.groups?.find((g) => g.id === groupId || g.name === groupId) : provider.groups?.[0];
    if (!group) return undefined;
    const apiKey = await resolveGroupApiKey(provider, group);
    const baseUrl = group.baseUrl || provider.baseUrl || "";
    // 免费分组 (authType none, 如 KiloCode) 无需 key：有 baseUrl 即可经网关代理，
    // 网关侧用服务端 token 解析上游凭证。此前 !apiKey 直接 return undefined，
    // 导致免费中转在 agy 上配置失败、turn 直接抛错/无反应。
    if (!baseUrl || (!apiKey && group.authType !== "none")) return undefined;
    // For other relays, route through the loopback relay gateway using
    // agy's LLM gateway mode (AGY_LLM_GATEWAY_*): agy authenticates via
    // the gateway and needs no Google OAuth login, while a bare
    // CLOUD_CODE_URL still makes agy demand an interactive login before
    // its first request. The gateway serves GET /v1/models discovery and
    // POST /v1/chat/completions, and resolves the real upstream
    // credential server-side, so the env key is the group key when one
    // exists and a placeholder otherwise.
    return {
      AGY_LLM_GATEWAY_URL: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
      AGY_LLM_GATEWAY_API_KEY: apiKey || "agy-relay-key",
      AGY_LLM_GATEWAY_WIRE_PROTOCOL: "openai",
    };
  },
  onSnapshot: (snapshot) => {
    agySessionStore.upsert({
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId ?? "local",
      conversationId: snapshot.conversationId ?? null,
      model: snapshot.model ?? null,
      cwd: snapshot.cwd ?? null,
      permissionMode: snapshot.mode,
      stateJson: JSON.stringify(snapshot),
    });
  },
  loadMetadata: (threadId: string, ownerId = "local") => {
    const record = agySessionStore.getMetadata(ownerId, threadId)
      ?? (ownerId !== "local" ? agySessionStore.getMetadata("local", threadId) : null)
      ?? agySessionStore.findMetadataByConversationId(threadId);
    if (record) {
      return {
        threadId: record.threadId,
        conversationId: record.conversationId ?? undefined,
        model: record.model ?? undefined,
        cwd: record.cwd ?? undefined,
      };
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        addDirs: runtime.additionalRoots,
        model: runtime.model,
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
      };
    }
    return null;
  },
  loadSnapshot: (threadId: string, ownerId = "local") => {
    const record = agySessionStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? agySessionStore.get("local", threadId) : null)
      ?? agySessionStore.findByConversationId(threadId);
    if (record?.stateJson) {
      try {
        return JSON.parse(record.stateJson);
      } catch {
        // fall through
      }
    }
    const runtime = threadRuntimeMetadataStore.get(ownerId, threadId)
      ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
      ?? threadRuntimeMetadataStore.getAny(threadId);
    if (runtime) {
      return {
        threadId,
        ownerId: ownerId ?? "local",
        cwd: runtime.cwd ?? process.cwd(),
        addDirs: runtime.additionalRoots,
        model: runtime.model || "gemini-3.8-flash-high",
        providerId: runtime.providerId ?? undefined,
        groupId: runtime.groupId ?? undefined,
        turns: [],
        messages: [],
      };
    }
    return null;
  }
  });
});
agyBridge.on("notification", (msg: any) => {
  routeCodexNotification(msg);
});
agyBridge.on("message", (msg: any) => {
  if (msg && "method" in msg && "id" in msg) {
    const request = msg as JsonRpcRequest;
    const routedId = "agy:" + String(request.id);
    pendingAgyServerRequests.set(routedId, { bridge: agyBridge, remoteId: request.id });
    void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route AGY server request", error));
  } else if (msg && "method" in msg) {
    routeCodexNotification(msg);
  }
});
function wireAuggieBridgeEvents(bridge: AuggieAgentBridge): void {
  bridge.on("notification", (msg: any) => {
    routeCodexNotification(msg);
  });
  bridge.on("message", (msg: any) => {
    if (msg && "method" in msg && "id" in msg) {
      const request = msg as JsonRpcRequest;
      const routedId = "auggie:" + String(request.id);
      pendingAuggieServerRequests.set(routedId, { bridge, remoteId: request.id });
      void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route Auggie server request", error));
    } else if (msg && "method" in msg) {
      routeCodexNotification(msg);
    }
  });
}
/**
 * The shared auggie process (embedded runtime owns the singleton and the
 * per-thread bindings). Sessions/cache stay inside the app data dir, never
 * the user's `~/.augment`.
 */
function auggieBridgeFor(threadId: string | null): AuggieAgentBridge {
  return ensureAuggieBridgeForThread(threadId, {
    runtimeEnv: () => ({ ...process.env, AUGMENT_CACHE_DIR: defaultAuggieCacheDir(codexUiDataDir()) }),
    onCreate: wireAuggieBridgeEvents,
  });
}
function wireClineBridgeEvents(bridge: ClineAgentBridge): void {
  bridge.on("message", (msg: any) => {
    if (msg && "method" in msg) {
      routeCodexNotification(msg);
    }
  });
  bridge.on("stderr", (chunk: any) => {
    console.warn("[cline]", String(chunk).trimEnd());
  });
}
/**
 * The shared cline bridge. Its hub daemon is detached and keeps cline's
 * state inside the app data dir (never the user's `~/.cline`).
 */
function clineBridgeFor(threadId: string | null): ClineAgentBridge {
  return ensureClineBridgeForThread(threadId, codexUiDataDir(), wireClineBridgeEvents);
}
function wireCommandCodeBridgeEvents(bridge: CommandCodeAgentBridge): void {
  bridge.on("message", (msg: any) => {
    if (msg && "method" in msg) {
      routeCodexNotification(msg);
    }
  });
  bridge.on("stderr", (chunk: any) => {
    console.warn("[command-code]", String(chunk).trimEnd());
  });
}
/**
 * The shared Command Code bridge. The CLI's state is isolated under the
 * app data dir via a HOME override at spawn time.
 */
function commandCodeBridgeFor(threadId: string | null): CommandCodeAgentBridge {
  return ensureCommandCodeBridgeForThread(threadId, codexUiDataDir(), wireCommandCodeBridgeEvents);
}
const agyThreadBridges = new Map<string, AgyBridge>();

let agySettingsSnapshotted = false;

function ensureAgySettingsSnapshot(): void {
  if (agySettingsSnapshotted) return;
  snapshotAgySettings();
  agySettingsSnapshotted = true;
}





const sshThreadBridges = new SharedThreadBridgeRegistry<SshCodexBridge>((releasedBridge) => {
  for (const [key, bridgeForProfile] of sshBridges) {
    if (bridgeForProfile === releasedBridge) sshBridges.delete(key);
  }
  for (const [requestId, pending] of pendingSshServerRequests) {
    if (pending.bridge === releasedBridge) pendingSshServerRequests.delete(requestId);
  }
});
// Reverse forwards live on the SSH host, so another Codex Ultra instance can
// occupy a port that is invisible to this local process. Randomize each
// process's allocation window instead of deterministically colliding at 46120.
let nextSshForwardPort = randomInt(46_120, 48_960);
function allocateSshForwardPort(): number {
  const port = nextSshForwardPort++;
  if (nextSshForwardPort > 49_000) nextSshForwardPort = 46_120;
  return port;
}
const writerLeases = new ThreadWriterLeaseStore(localDatabase.connection);
const subscriptionRegistry = new ThreadSubscriptionRegistry((threadId) => (threadId ? remoteBunThreadBridges.get(threadId) ?? sshThreadBridges.get(threadId) : undefined) ?? bridge, writerLeases);
subscriptionRegistry.registerClient(bridge);
const codexApiEvents = new CodexApiEventStore();
const codexApiSessions = new CodexApiSessionStore();
process.once("exit", () => {
  stopAuggieRuntime();
  stopClineRuntime();
  stopCommandCodeRuntime();
  for (const remote of sshBridges.values()) remote.stop();
  for (const remote of remoteBunThreadBridges.values()) remote.stop();
  for (const claude of claudeThreadBridges.values()) claude.stop();
  for (const claude of claudeBridges.values()) claude.stop();
  grokBridge.stop();
  for (const grok of grokThreadBridges.values()) grok.stop();
  piBridge.stop();
  for (const pi of piThreadBridges.values()) pi.stop();
  opencodeBridge.stop();
  opencodeV2Bridge.stop();
  for (const oc of opencodeThreadBridges.values()) oc.stop();
  for (const [threadId, pending] of pendingRemoteCursorWrites) {
    clearTimeout(pending.timer);
    remoteThreadRouteStore.setEventCursor(threadId, pending.cursor);
  }
  pendingRemoteCursorWrites.clear();
  writerLeases.close();
});
const clients = new Set<RuntimeSocket<SocketData>>();
const execFileAsync = promisify(execFile);
let heartbeatSequence = 0;
const websocketDisconnects: Array<{
  at: number;
  code: number;
  reason: string;
  source: "server" | "client/network";
  userId?: string;
}> = [];
let providerActivationQueue: Promise<void> = Promise.resolve();
const PROVIDER_CONFIG_WRITE_TIMEOUT_MS = 15_000;

await providerStore.initialize();
await providerStore.reserveTransient(OMNIROUTE_FREE_PROVIDER_ID);
const initialClineToken = await resolveLocalClineToken();
const initialFreebuffCreds = await resolveLocalFreebuffCredentials();
const initialHasCline = Boolean(initialClineToken);
const initialHasFreebuff = Boolean(initialFreebuffCreds?.token);

await providerStore.saveTransient({
  id: OMNIROUTE_FREE_PROVIDER_ID,
  name: "CodexUltraFree",
  kind: "responsesRelay",
  serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" },
  baseUrl: OMNIROUTE_FREE_BASE_URL,
  defaultModel: "",
  nativeModels: [],
  modelAliases: [],
  stationType: "charity",
  channelMode: "fast",
  remark: "Managed CodexUltraFree models",
  groups: buildAllFreeGroups([], [], initialHasCline ? [] : undefined, initialHasFreebuff ? [] : undefined, [], {
    hasClineCredentials: initialHasCline,
    hasFreebuffCredentials: initialHasFreebuff
  }),
  createdAt: Date.now(),
  updatedAt: Date.now()
});
await providerStore.reserveTransient(AGY_OFFICIAL_PROVIDER_ID);
await providerStore.saveTransient(buildAgyOfficialProvider());
await providerStore.reserveTransient(GROK_OFFICIAL_PROVIDER_ID);
await providerStore.saveTransient(buildGrokOfficialProvider());
await providerStore.reserveTransient(MUSE_OFFICIAL_PROVIDER_ID);
await providerStore.saveTransient(buildMuseOfficialProvider());
await providerStore.reserveTransient(OPENCODE_OFFICIAL_PROVIDER_ID);
// Load OpenCode's real provider catalog before exposing `/api/providers`.
// The CLI's `models` command is backed by OpenCode's models.dev/configured
// provider registry (and includes the free OpenCode/OpenCode Go entries). A
// fire-and-forget refresh after saving the four-item fallback used to race the
// first provider request, so the UI could cache the fallback permanently.
let initialOpencodeV1Models: string[] = [];
let initialOpencodeV2Models: string[] = [];
try {
  const v2Bin = findOpencodeV2Bin(process.env);
  const [v1Models, v2Models] = await Promise.all([
    listOpencodeModelsAsync(undefined, process.env, 10_000),
    v2Bin ? listOpencodeModelsAsync(v2Bin, process.env, 10_000) : Promise.resolve([] as string[]),
  ]);
  initialOpencodeV1Models = v1Models;
  initialOpencodeV2Models = v2Models;
} catch (error) {
  console.warn("[opencode-local] initial models refresh failed", error);
}
await providerStore.saveTransient(buildOpencodeOfficialProvider(initialOpencodeV1Models, initialOpencodeV2Models));

let opencodeModelsRefreshInFlight: Promise<void> | null = null;
async function refreshOpencodeModelsBackground(): Promise<void> {
  if (opencodeModelsRefreshInFlight) return opencodeModelsRefreshInFlight;
  opencodeModelsRefreshInFlight = (async () => {
    try {
      const existing = await providerStore.get(OPENCODE_OFFICIAL_PROVIDER_ID);
      if (!existing) return;
      const v2Bin = findOpencodeV2Bin();
      const [v1Models, v2Models] = await Promise.all([
        listOpencodeModelsAsync(),
        v2Bin ? listOpencodeModelsAsync(v2Bin, process.env, 10_000) : Promise.resolve([] as string[]),
      ]);
      if (v1Models.length > 0 || v2Models.length > 0) {
        const updated = buildOpencodeOfficialProvider(v1Models, v2Models);
        if (existing.createdAt) updated.createdAt = existing.createdAt;
        await providerStore.saveTransient(updated);
        console.info(`[opencode-local] models refreshed: v1=${v1Models.length}, v2=${v2Models.length}, default=${updated.defaultModel}`);
      }
    } catch (error) {
      console.warn("[opencode-local] models refresh failed", error);
    } finally {
      opencodeModelsRefreshInFlight = null;
    }
  })();
  return opencodeModelsRefreshInFlight;
}
void refreshOpencodeModelsBackground();

void (async () => {
  try {
    const existing = await providerStore.get(OMNIROUTE_FREE_PROVIDER_ID);
    const existingCline = existing?.groups?.find((g) => g.id === "cline-free");
    const existingFreebuff = existing?.groups?.find((g) => g.id === "freebuff");
    const existingD2Api = existing?.groups?.find((g) => g.id === "d2api");
    const d2apiBaseUrl = existingD2Api?.baseUrl?.trim() || process.env.D2API_BASE_URL?.trim() || D2API_BASE_URL;
    // 内嵌 duck2api：模型表来自进程内实现，无需探测外部服务，恒可用。
    const d2apiEmbeddedModels = listEmbeddedDuck2ApiModels().data.map((m) => m.id);

    const [localClineToken, localFreebuffCreds] = await Promise.all([
      resolveLocalClineToken(),
      resolveLocalFreebuffCredentials()
    ]);
    const hasCline = Boolean(localClineToken || (existingCline?.keys && existingCline.keys.length > 0));
    const hasFreebuff = Boolean(localFreebuffCreds?.token || (existingFreebuff?.keys && existingFreebuff.keys.length > 0));

    const [opencodeResult, kiloResult, clineResult, freebuffResult] = await Promise.allSettled([
      fetchOmniRouteFreeModels(),
      fetchKiloCodeFreeModels(),
      hasCline ? fetchClineFreeModels() : Promise.resolve({ models: [], fetchedModels: 0 }),
      hasFreebuff ? fetchFreebuffFreeModels({ token: localFreebuffCreds?.token }) : Promise.resolve({ models: [], fetchedModels: 0 })
    ]);
    const opencodeModels = opencodeResult.status === "fulfilled" ? opencodeResult.value.models : [];
    const kiloModels = kiloResult.status === "fulfilled" ? kiloResult.value.models : [];
    const clineModels = clineResult.status === "fulfilled" ? clineResult.value.models : [];
    const freebuffModels = freebuffResult.status === "fulfilled" ? freebuffResult.value.models : [];
    // d2api 内嵌：恒用进程内模型表（失败沿用已入库只是兜底，正常恒为内嵌表）。
    const d2apiModels = d2apiEmbeddedModels.length > 0 ? d2apiEmbeddedModels : (existingD2Api?.models ?? undefined);
    if (opencodeModels.length > 0 || kiloModels.length > 0 || (hasCline && clineModels.length > 0) || (hasFreebuff && freebuffModels.length > 0) || (d2apiModels && d2apiModels.length > 0)) {
      const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels, existing?.groups, {
        hasClineCredentials: hasCline,
        hasFreebuffCredentials: hasFreebuff,
        d2apiModels,
        d2apiBaseUrl
      });
      const allNativeModels = [...new Set(groups.flatMap((g) => g.models ?? []))];
      await providerStore.saveTransient({
        id: OMNIROUTE_FREE_PROVIDER_ID,
        name: "CodexUltraFree",
        kind: "responsesRelay",
        serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" },
        baseUrl: OMNIROUTE_FREE_BASE_URL,
        defaultModel: groups[0]?.models?.[0] ?? allNativeModels[0],
        nativeModels: allNativeModels,
        modelAliases: [],
        stationType: "charity",
        channelMode: "fast",
        remark: "Managed CodexUltraFree models",
        groups,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      });
      console.info(`[omniroute-free] startup background refresh complete: opencode=${opencodeModels.length}, kilo=${kiloModels.length}, cline=${hasCline ? clineModels.length : "(hidden/no-auth)"}, freebuff=${hasFreebuff ? freebuffModels.length : "(hidden/no-auth)"}`);
    }
  } catch (error) {
    console.warn("[omniroute-free] startup background refresh failed", error);
  }
})();
await authStore?.initialize();
legalPolicyStore.initialize();
securityStore.initialize();
if (process.platform === "win32") {
  try {
    setGlobalCodexEnvironment({ enabled: false, virtualCodexHome: dirname(resolveVirtualCodexConfigPath()), dataDir: localDatabase.dir });
  } catch {
    // Ignore cleanup failure
  }
}
const trustedLocalDesktopAuth = Boolean(authStore && trustedLocalDesktopAuthEnabled({
  env: process.env,
  platform: process.platform,
  deployment: websocketRuntime.deployment,
  host: HOST
}));
const desktopRuntime = /^(1|true|yes)$/i.test(process.env.CODEX_UI_DESKTOP ?? "")
  ? {
      platform: process.env.CODEX_UI_DESKTOP_PLATFORM?.trim() || process.platform,
      codexAvailable: isCodexCliAvailable(process.platform, process.env),
      codexInstallCommand: process.env.CODEX_UI_CODEX_INSTALL_COMMAND?.trim() || (
        process.platform === "win32"
          ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
          : "curl -fsSL https://chatgpt.com/codex/install.sh | sh"
      ),
      codexInstallDirectory: process.env.CODEX_UI_CODEX_INSTALL_DIRECTORY?.trim() || ""
    }
  : undefined;
logCodexConfigHealth(ensureCodexConfigHealthy(), "startup");

function resolveWebDist(): string {
  const fromEnv = process.env.CODEX_UI_WEB_DIST?.trim();
  const candidates: string[] = [];
  if (fromEnv) candidates.push(resolve(fromEnv));
  try {
    const exeDir = dirname(process.execPath);
    candidates.push(join(exeDir, "web-dist"));
    candidates.push(join(exeDir, "web", "dist"));
    candidates.push(join(exeDir, "apps", "web", "dist"));
  } catch {
    // Ignore execPath resolution failure and fall back to source-relative path.
  }
  candidates.push(join(dirname(fileURLToPath(import.meta.url)), "../../web/dist"));
  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, "index.html"))) return resolve(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return resolve(candidates[0] ?? join(dirname(fileURLToPath(import.meta.url)), "../../web/dist"));
}

const webDist = resolveWebDist();
const hasWebBuild = existsSync(join(webDist, "index.html"));
const webDistRoot = resolve(webDist);

bridge.on("status", (status) => {
  codexApiEvents.append("engineStatus", status, null);
  broadcast({ type: "engine.status", status });
});

bridge.on("message", (message: JsonRpcMessage) => {
  if ("method" in message && "id" in message) {
    void routeServerRequest(message as JsonRpcRequest).catch((error) => console.warn("Failed to route Codex server request", error));
  } else if ("method" in message) {
    routeCodexNotification(message as JsonRpcNotification & { method: string });
  }
});

const codexStreamRetryTracker = new CodexStreamRetryTracker();

bridge.on("stderr", (message) => {
  console.warn("[codex]", message as string);
  const text = String(message ?? "");
  if (!text.trim() || isBenignCodexStderr(text)) return;
  const parsed = parseCodexStderrLine(text);
  if (parsed.kind === "stream-retry" && parsed.turnId) {
    const storm = codexStreamRetryTracker.ingest(text);
    if (!storm) return;
    const threadId = turnToThreadMap.get(storm.turnId) ?? (turnToThreadMap.size === 1 ? turnToThreadMap.values().next().value : undefined);
    routeCodexNotification({
      method: "error",
      params: {
        threadId,
        turnId: storm.turnId,
        willRetry: true,
        error: {
          message: storm.stalled
            ? `Upstream stream disconnected, Codex retrying ${storm.attempt}x. You can Interrupt and fork from the last healthy turn instead of waiting.`
            : `Upstream stream disconnected, Codex retrying (${storm.attempt}x).`,
          additionalDetails: `${storm.lastError}${storm.retryDelayText ? ` retry_delay=${storm.retryDelayText}` : ""}`.slice(0, 2000),
        },
        retrySource: "codex-stream",
        attempt: storm.attempt,
        stalled: storm.stalled,
        elapsedMs: storm.elapsedMs,
        actionHint: "interrupt-and-fork-clean",
      },
    } as unknown as JsonRpcMessage & { method: string; params?: JsonValue });
    return;
  }
  if (parsed.kind === "graceful-timeout") {
    const terminal = codexStreamRetryTracker.terminalTask(parsed.taskId);
    if (!terminal) return;
    const threadId = (terminal.turnId ? turnToThreadMap.get(terminal.turnId) : undefined)
      ?? (turnToThreadMap.size === 1 ? turnToThreadMap.values().next().value : undefined);
    routeCodexNotification({
      method: "error",
      params: {
        threadId,
        turnId: terminal.turnId ?? terminal.taskId,
        willRetry: false,
        error: {
          message: "Codex turn did not complete gracefully after repeated stream retries. Fork from the last healthy turn before resending.",
          additionalDetails: `task ${terminal.taskId}`.slice(0, 2000),
        },
        retrySource: "codex-stream",
        exhausted: true,
        actionHint: "fork-clean",
      },
    } as unknown as JsonRpcMessage & { method: string; params?: JsonValue });
  }
});

const ORPHAN_CLAUDE_CONFIG_DIR_MIN_AGE_MS = 24 * 60 * 60 * 1000;

void pruneOrphanClaudeConfigDirs().catch((error) => {
  console.warn("Failed to prune orphaned Claude config directories", error);
});

void cleanDataGarbage({
  dataDir: localDatabase.dir,
  sessionRetentionDays: Number(process.env.CODEX_UI_SESSION_RETENTION_DAYS) || 3
}).catch((error) => {
  console.warn("[garbage-cleaner] Startup garbage cleanup failed", error);
});

let exitCleanupDone = false;
const cleanupGarbageOnExit = () => {
  if (exitCleanupDone) return;
  exitCleanupDone = true;
  try {
    restoreAgySettings();
  } catch {}
  try {
    cleanDataGarbageSync({
      dataDir: localDatabase.dir,
      exitMode: true
    });
  } catch {}
};
process.on("SIGINT", () => {
  cleanupGarbageOnExit();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupGarbageOnExit();
  process.exit(0);
});
process.on("beforeExit", () => {
  cleanupGarbageOnExit();
});

if (process.env.CODEX_UI_SKIP_CODEX_BOOT !== "1") {
  try {
    await prepareVirtualCodexConfig();
    const bootConfig = (await bridge.request("config/read", { includeLayers: false }, 20_000)) as JsonValue;
    const virtualCodexHome = dirname(resolveVirtualCodexConfigPath());
    await repairAgentModelCatalog(virtualCodexHome, bootConfig);
    const bootCatalogPath = join(virtualCodexHome, CODEX_ULTRA_MODEL_CATALOG_FILE);
    if (existsSync(bootCatalogPath)) {
      await bridge.request("config/value/write", {
        keyPath: "model_catalog_json",
        value: bootCatalogPath,
        mergeStrategy: "replace"
      }, PROVIDER_CONFIG_WRITE_TIMEOUT_MS);
    } else {
      console.warn(`[codex-catalog] WARNING: Model catalog missing at boot: ${bootCatalogPath}; Codex app-server will fall back to built-in models with code_mode_only.`);
    }
    await bridge.start();
    const runtimeCodexHome = bridge.getStatus().codexHome;
    if (runtimeCodexHome && runtimeCodexHome !== virtualCodexHome) {
      await ensureEngineModelCatalogAligned(runtimeCodexHome, { vmEnabled: false, bridge });
    }
  } catch (error) {
    console.warn("Codex app-server did not start during boot; UI can retry", error);
  }
}

await startRuntimeServer<SocketData>({
  hostname: HOST,
  port: PORT,
  // 对外 /v1 转发的非流 turn 可达 10 分钟 (FORWARD_DEFAULT_TIMEOUT_MS);
  // 空闲超时必须覆盖它, 否则 Bun 会在终态前掐连接。WS 另有心跳, 不受影响。
  // Bun 上限 255s: 默认 255, 可配 CODEX_UI_HTTP_IDLE_TIMEOUT_S (1~255)。
  // 更长的 turn 走 SSE (心跳续命, 不受此限)。
  idleTimeoutSeconds: Number(process.env.CODEX_UI_HTTP_IDLE_TIMEOUT_S) > 0
    ? Math.min(255, Math.floor(Number(process.env.CODEX_UI_HTTP_IDLE_TIMEOUT_S)))
    : 255,
  maxPayloadLength: websocketRuntime.maxMessageBytes,
  backpressureLimit: websocketRuntime.maxBackpressureBytes,
  fetch: handleHttpRequest,
  websocket: {
    open(ws) {
      const now = Date.now();
      ws.data.connectedAt = now;
      ws.data.lastHeartbeatAt = now;
      ws.data.lastMessageAt = now;
      ws.data.serverCloseReason = null;
      clients.add(ws);
      send(ws, { type: "engine.status", status: bridge.getStatus() });
    },
    async message(ws, raw) {
      try {
        ws.data.lastMessageAt = Date.now();
        if (ws.data.user && legalPolicyStore.status(ws.data.user.id).required) {
          send(ws, { type: "server.error", message: "Legal policy acceptance is required" });
          ws.data.serverCloseReason = "Legal policy acceptance required";
          ws.close(4403, "Legal policy acceptance required");
          return;
        }
        const message = JSON.parse(raw.toString()) as ClientToServerMessage;
        await handleClientMessage(ws, message);
      } catch (error) {
        send(ws, {
          type: "server.error",
          message: errorToMessage(error)
        });
      }
    },
    close(ws, code, reason) {
      recordWebSocketDisconnect(ws, code, reason);
      removeClient(ws);
    }
  }
});

setInterval(() => {
  const now = Date.now();
  for (const client of clients) {
    if (now - client.data.lastHeartbeatAt > WEBSOCKET_HEARTBEAT_TIMEOUT_MS) {
      console.warn("[websocket] closing stale client after heartbeat timeout", {
        userId: client.data.user?.id,
        email: client.data.user?.email,
        remoteAddress: client.remoteAddress,
        elapsedMs: now - client.data.lastHeartbeatAt,
        timeoutMs: WEBSOCKET_HEARTBEAT_TIMEOUT_MS
      });
      client.data.serverCloseReason = "Heartbeat timeout";
      removeClient(client);
      try {
        client.close(4000, "Heartbeat timeout");
      } catch {
        // The socket may already be gone.
      }
      continue;
    }
    send(client, {
      type: "heartbeat.ping",
      id: `server-${now}-${heartbeatSequence++}`,
      sentAt: now
    });
  }
}, WEBSOCKET_HEARTBEAT_INTERVAL_MS);

setInterval(() => {
  for (const session of codexApiSessions.sweep()) {
    subscriptionRegistry.unwatchAllForClient(session.clientId);
  }
}, Math.min(60_000, Math.max(5_000, Math.floor(codexApiSessions.ttlMs / 2))));

console.info(
  authStore
    ? `Codex React UI listening at http://${HOST}:${PORT}/ with membership login enabled`
    : `Codex React UI listening at http://${HOST}:${PORT}/?token=${sessionToken}`
);

// Standalone Bun exe never had auto-open: double-click only starts the HTTP
// server, so users feel "stuck" at the omniroute-free log line. Open the
// default browser for the standalone exe, or when CODEX_UI_AUTO_OPEN=1.
// Explicit CODEX_UI_AUTO_OPEN=0 always disables it (headless/CI safe).
{
  const flag = process.env.CODEX_UI_AUTO_OPEN?.trim().toLowerCase();
  const explicitlyDisabled = flag === "0" || flag === "false" || flag === "off" || flag === "no";
  const explicitlyEnabled = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  let isStandaloneExe = false;
  try {
    isStandaloneExe = /codex-standalone(\.exe)?$/i.test(process.execPath ?? "");
  } catch {
    isStandaloneExe = false;
  }
  if (!explicitlyDisabled && (explicitlyEnabled || isStandaloneExe)) {
    const browserHost = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
    const browserUrl = `http://${browserHost}:${PORT}/`;
    const opener = process.platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", browserUrl] }
      : process.platform === "darwin"
        ? { cmd: "open", args: [browserUrl] }
        : { cmd: "xdg-open", args: [browserUrl] };
    try {
      const child = spawn(opener.cmd, opener.args, { detached: true, stdio: "ignore" });
      child.on("error", (error) => {
        console.warn(`[standalone] Failed to open browser at ${browserUrl}`, error);
      });
      child.unref?.();
      console.info(`[standalone] Opened browser at ${browserUrl}`);
    } catch (error) {
      console.warn(`[standalone] Failed to open browser at ${browserUrl}`, error);
    }
  }
}

// Restore CLI version picks persisted in user preferences, then warm only the
// active backend cache. Codex is opt-in; when disabled we do not spawn its
// `--version` probe at startup. Other backends stay dormant until the UI asks
// for them explicitly (`GET /api/cli/installations?kinds=...`).
{
  const preferences = userPreferencesStore.get("local");
  const preferredCodex = typeof preferences.cliPreferredCodexPath === "string" ? preferences.cliPreferredCodexPath : null;
  const preferredClaude = typeof preferences.cliPreferredClaudePath === "string" ? preferences.cliPreferredClaudePath : null;
  const preferredAgy = typeof preferences.cliPreferredAgyPath === "string" ? preferences.cliPreferredAgyPath : null;
  const preferredGrok = typeof preferences.cliPreferredGrokPath === "string" ? preferences.cliPreferredGrokPath : null;
  const preferredPi = typeof preferences.cliPreferredPiPath === "string" ? preferences.cliPreferredPiPath : null;
  const preferredOpencode = typeof preferences.cliPreferredOpencodePath === "string" ? preferences.cliPreferredOpencodePath : null;
  const preferredAuggie = typeof (preferences as Record<string, unknown>).cliPreferredAuggiePath === "string" ? (preferences as Record<string, unknown>).cliPreferredAuggiePath as string : null;
  const preferredCline = typeof (preferences as Record<string, unknown>).cliPreferredClinePath === "string" ? (preferences as Record<string, unknown>).cliPreferredClinePath as string : null;
  const preferredCommandCode = typeof (preferences as Record<string, unknown>).cliPreferredCommandCodePath === "string" ? (preferences as Record<string, unknown>).cliPreferredCommandCodePath as string : null;
  if (preferredCodex) setPreferredCliBinary("codex", preferredCodex);
  if (preferredClaude) setPreferredCliBinary("claude", preferredClaude);
  if (preferredAgy) setPreferredCliBinary("agy", preferredAgy);
  if (preferredGrok) setPreferredCliBinary("grok", preferredGrok);
  const preferredMuse = typeof (preferences as Record<string, unknown>).cliPreferredMusePath === "string" ? (preferences as Record<string, unknown>).cliPreferredMusePath as string : null;
  if (preferredMuse) setPreferredCliBinary("muse", preferredMuse);
  if (preferredAuggie) setPreferredCliBinary("auggie", preferredAuggie);
  if (preferredCline) setPreferredCliBinary("cline", preferredCline);
  if (preferredCommandCode) setPreferredCliBinary("command-code", preferredCommandCode);
  if (preferredPi) setPreferredCliBinary("pi", preferredPi);
  if (preferredOpencode) setPreferredCliBinary("opencode", preferredOpencode);
  if (isCliPluginEnabled("codex")) void ensureCliInstallationsCached("codex");
}

// Keep the event loop active permanently so background server never exits
setInterval(() => {}, 60_000);

async function handleHttpRequest(request: Request, server: RuntimeServer<SocketData>): Promise<Response | undefined> {
  const url = new URL(request.url);
  const headers = securityHeaders();

  try {
    // Ultra 对外 /v1 转发 (与 workbench 同端口; 模型名见 forwardModel.ts)。
    if (url.pathname === "/v1/models" || url.pathname === "/v1/models/") {
      return await handleForwardModelsRequest(request, url, headers, {
        remoteAddress: server.requestIP(request)?.address,
        forwardToken,
        sharingEnabled: isForwardSharingEnabled(userPreferencesStore.get(FORWARD_SETTINGS_OWNER)),
        listInventory: listForwardModelInventory,
      });
    }
    // 对外 /v1 转发 chat (P3a 非流; stream:true 暂回 400, P3b 接 SSE)。
    if (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/chat/completions/") {
      return await handleForwardChatRequest(request, url, headers, {
        remoteAddress: server.requestIP(request)?.address,
        forwardToken,
        sharingEnabled: isForwardSharingEnabled(userPreferencesStore.get(FORWARD_SETTINGS_OWNER)),
        listInventory: listForwardModelInventory,
        getBridge: resolveForwardBridge,
        cwd: process.env.CODEX_UI_FORWARD_CWD?.trim() || process.cwd(),
        turnTimeoutMs: Number(process.env.CODEX_UI_FORWARD_TURN_TIMEOUT_MS) > 0
          ? Number(process.env.CODEX_UI_FORWARD_TURN_TIMEOUT_MS)
          : undefined,
        maxConcurrent: Number(process.env.CODEX_UI_FORWARD_MAX_CONCURRENT) > 0
          ? Math.floor(Number(process.env.CODEX_UI_FORWARD_MAX_CONCURRENT))
          : undefined,
      });
    }
    // 对外 /v1 转发 responses (P4 双模; previous_response_id 续聊 v1 不支持)。
    if (url.pathname === "/v1/responses" || url.pathname === "/v1/responses/") {
      return await handleForwardResponsesRequest(request, url, headers, {
        remoteAddress: server.requestIP(request)?.address,
        forwardToken,
        sharingEnabled: isForwardSharingEnabled(userPreferencesStore.get(FORWARD_SETTINGS_OWNER)),
        listInventory: listForwardModelInventory,
        getBridge: resolveForwardBridge,
        cwd: process.env.CODEX_UI_FORWARD_CWD?.trim() || process.cwd(),
        turnTimeoutMs: Number(process.env.CODEX_UI_FORWARD_TURN_TIMEOUT_MS) > 0
          ? Number(process.env.CODEX_UI_FORWARD_TURN_TIMEOUT_MS)
          : undefined,
        maxConcurrent: Number(process.env.CODEX_UI_FORWARD_MAX_CONCURRENT) > 0
          ? Math.floor(Number(process.env.CODEX_UI_FORWARD_MAX_CONCURRENT))
          : undefined,
      });
    }
    // Meta Muse CLI (`muse exec --provider meta --base-url <relay>`) speaks
    // OpenAI Responses (`POST <base>/responses`, SSE) but resolves model
    // metadata from a fixed catalog URL `<origin>/muse-code/models` (the
    // --base-url path prefix is NOT included). Serve the union of all
    // enabled text-group models so relay models validate; actual routing
    // still happens per group at the relay-gateway /v1/responses URL.
    // Loopback-only, same trust model as /api/relay-gateway.
    if (url.pathname === "/muse-code/models" && request.method === "GET") {
      const remoteAddress = server.requestIP(request)?.address;
      if (remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) {
        return jsonResponse({ error: "Muse catalog is available only through loopback" }, 403, headers);
      }
      const ids = new Set<string>();
      try {
        for (const provider of visibleProviders(await providerStore.list())) {
          for (const group of provider.groups ?? []) {
            if (group.kind === "image" || group.status === "disabled") continue;
            for (const model of group.models ?? []) {
              const id = stripModelContextVariant(model).baseModel.trim();
              if (id) ids.add(id);
            }
          }
        }
      } catch (error) {
        console.warn("[muse-catalog] union catalog failed", error instanceof Error ? error.message : error);
      }
      return jsonResponse({
        object: "list",
        data: [...ids].sort().map((id) => ({ id, object: "model", created: 0, owned_by: "codex-ultra" })),
      }, 200, headers);
    }
    if (url.pathname.startsWith("/api/relay-gateway/")) {
      return await handleRelayGatewayRequest(request, url, headers, server);
    }
    if (url.pathname === websocketRuntime.path) {
      if (!isWebSocketOriginAllowed(request, websocketRuntime)) {
        return jsonResponse({ error: "WebSocket origin is not allowed" }, 403, headers);
      }
      const auth = await resolveAuth(request, url);
      if (!auth.ok) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      if (auth.user && legalPolicyStore.status(auth.user.id).required) {
        return jsonResponse({ error: "Legal policy acceptance required" }, 428, headers);
      }
      if (
        server.upgrade(request, {
          data: {
            clientId: randomBytes(12).toString("base64url"),
            user: auth.user,
            token: auth.token,
            connectedAt: Date.now(),
            lastHeartbeatAt: Date.now(),
            lastMessageAt: Date.now(),
            lastHeartbeatRttMs: null,
            serverCloseReason: null
          }
        })
      ) {
        return;
      }
      return jsonResponse({ error: "WebSocket upgrade failed" }, 400, headers);
    }

    if (url.pathname === "/api/session" && request.method === "GET") {
      if (authStore) {
        const token = bearerOrUiToken(request, url);
        const user = await authStore.getUserByToken(token);
        if (!user) {
          const admin = trustedLocalDesktopAdmin();
          if (admin) {
            const session = authStore.issueSessionForUser(admin.id);
            return jsonResponse({
              authenticated: true,
              ...session,
              legalConsent: legalPolicyStore.status(session.user.id),
              websocket: publicWebSocketRuntime,
              desktopTrustedLocal: true,
              ...(desktopRuntime ? { desktopRuntime } : {})
            }, 200, headers);
          }
          return jsonResponse({
            authenticated: false,
            loginRequired: true,
            token: "",
            user: null,
            websocket: publicWebSocketRuntime,
            ...(desktopRuntime ? { desktopRuntime } : {})
          }, 200, headers);
        }
        // Sliding renewal: an app that stays open for days keeps polling this
        // endpoint, so a session past half its lifetime is rotated here instead
        // of expiring underneath a running workbench.
        const renewed = authStore.renewIfExpiring(token);
        return jsonResponse({
          authenticated: true,
          token: renewed?.token ?? token,
          user: renewed?.user ?? user,
          ...(renewed ? { expiresAt: renewed.expiresAt } : {}),
          legalConsent: legalPolicyStore.status(user.id),
          websocket: publicWebSocketRuntime,
          ...(desktopRuntime ? { desktopRuntime } : {}),
          ...(trustedLocalDesktopAuth ? { desktopTrustedLocal: true } : {})
        }, 200, headers);
      }
      return jsonResponse({
        authenticated: true,
        token: sessionToken,
        user: null,
        websocket: publicWebSocketRuntime,
        ...(desktopRuntime ? { desktopRuntime } : {})
      }, 200, headers);
    }

    if (url.pathname === "/api/runtime/health" && request.method === "GET") {
      return jsonResponse(runtimeHealth(), 200, headers);
    }

    if (url.pathname === "/api/system/metrics" && request.method === "GET") {
      const metrics = await getSystemMetrics();
      return jsonResponse(metrics, 200, headers);
    }

    // cxu release version for the top-bar badge (public; not sensitive).
    if (url.pathname === "/api/version" && request.method === "GET") {
      const version = typeof CXU_VERSION !== "undefined" && CXU_VERSION ? CXU_VERSION : "dev";
      return jsonResponse({ version }, 200, headers);
    }

    // Public auth config (registration / captcha / totp flags) — no auth required
    if (url.pathname === "/api/auth/config" && request.method === "GET") {
      if (!authStore) {
        return jsonResponse({ registrationEnabled: false, captchaEnabled: false, totpEnabled: false }, 200, headers);
      }
      return jsonResponse(securityStore.publicAuthConfig(), 200, headers);
    }

    if (url.pathname === "/api/auth/captcha" && request.method === "GET") {
      if (!authStore) {
        return jsonResponse({ error: "Auth disabled" }, 400, headers);
      }
      const captcha = securityStore.createCaptcha();
      const captchaHeaders = new Headers(headers);
      captchaHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      captchaHeaders.set("Pragma", "no-cache");
      captchaHeaders.set("Expires", "0");
      return jsonResponse(captcha, 200, captchaHeaders);
    }

    if (url.pathname === "/api/register" && request.method === "POST") {
      if (!authStore) {
        return jsonResponse({ error: "Auth disabled" }, 400, headers);
      }
      const settings = securityStore.getSettings();
      if (!settings.registrationEnabled) {
        return jsonResponse({ error: "Registration is closed" }, 403, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      if (settings.captchaEnabled) {
        const ok = securityStore.consumeCaptcha(stringValue(body.captchaId), stringValue(body.captchaAnswer));
        if (!ok) {
          return jsonResponse({ error: "Invalid captcha" }, 400, headers);
        }
      }
      try {
        const created = await authStore.createUser({
          email: stringValue(body.email) ?? "",
          password: stringValue(body.password) ?? "",
          username: stringValue(body.username),
          role: "user",
          status: "active",
          balance: settings.defaultMemberBalance,
          concurrency: settings.defaultMemberConcurrency,
          maxPermission: "workspaceAsk",
          allowWrite: true,
          allowNetwork: false,
          allowDangerBypass: false
        });
        return jsonResponse({ data: created }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      if (!authStore) {
        return jsonResponse({
          token: sessionToken,
          user: null,
          websocket: publicWebSocketRuntime
        }, 200, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const settings = securityStore.getSettings();
      if (settings.captchaEnabled) {
        const ok = securityStore.consumeCaptcha(stringValue(body.captchaId), stringValue(body.captchaAnswer));
        if (!ok) {
          return jsonResponse({ error: "Invalid captcha" }, 401, headers);
        }
      }
      const userRow = await authStore.verifyPassword(stringValue(body.email) ?? "", stringValue(body.password) ?? "");
      if (!userRow) {
        return jsonResponse({ error: "Invalid email or password" }, 401, headers);
      }
      const systemTotpOn = settings.totpEnabled;
      const userTotpOn = Boolean(userRow.totp_enabled) && Boolean(userRow.totp_secret);
      if (systemTotpOn && userTotpOn) {
        const pending = securityStore.createPendingLogin(userRow.id);
        return jsonResponse(
          {
            requires_2fa: true,
            pendingToken: pending.pendingToken,
            expiresAt: pending.expiresAt
          },
          200,
          headers
        );
      }
      if (systemTotpOn && settings.forceAdminTotp && userRow.role === "admin" && !userTotpOn) {
        // Still allow login, but client can prompt setup; do not block cold start.
      }
      const result = authStore.issueSessionForUser(userRow.id);
      return jsonResponse({ ...result, legalConsent: legalPolicyStore.status(result.user.id), websocket: publicWebSocketRuntime }, 200, headers);
    }

    if (url.pathname === "/api/login/2fa" && request.method === "POST") {
      if (!authStore) {
        return jsonResponse({ error: "Auth disabled" }, 400, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const pendingToken = stringValue(body.pendingToken) ?? "";
      const code = stringValue(body.totpCode) ?? stringValue(body.code) ?? "";
      const userId = securityStore.consumePendingLogin(pendingToken);
      if (!userId) {
        return jsonResponse({ error: "2FA session expired" }, 401, headers);
      }
      const secret = authStore.getTotpSecret(userId);
      if (!secret || !verifyTotpCode(secret, code)) {
        return jsonResponse({ error: "Invalid authenticator code" }, 401, headers);
      }
      const result = authStore.issueSessionForUser(userId);
      return jsonResponse({ ...result, legalConsent: legalPolicyStore.status(result.user.id), websocket: publicWebSocketRuntime }, 200, headers);
    }

    if (url.pathname === "/api/legal/policy" && request.method === "GET") {
      const auth = await resolveAuth(request, url);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const language = url.searchParams.get("lang") === "en" ? "en" : "cn";
      return jsonResponse({ data: legalPolicyStore.open(auth.user.id, language) }, 200, headers);
    }

    if (url.pathname === "/api/legal/accept" && request.method === "POST") {
      const auth = await resolveAuth(request, url);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const language = stringValue(body.language) === "en" ? "en" : "cn";
      try {
        const legalConsent = legalPolicyStore.accept(auth.user.id, stringValue(body.version) ?? "", language);
        return jsonResponse({ data: legalConsent }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error), legalConsent: legalPolicyStore.status(auth.user.id) }, 409, headers);
      }
    }

    if (url.pathname.startsWith("/api")) {
      const auth = await resolveAuth(request, url);
      if (!auth.ok) {
        return jsonResponse({
          error: "Unauthorized",
          code: "CUX-AUTH-001",
          loginRequired: Boolean(authStore)
        }, 401, headers);
      }
      if (auth.user && legalPolicyStore.status(auth.user.id).required) {
        return jsonResponse({ error: "Legal policy acceptance required", legalConsent: legalPolicyStore.status(auth.user.id) }, 428, headers);
      }
      return await handleApiRequest(request, url, headers, auth.user);
    }

    return serveStatic(request, url, headers);
  } catch (error) {
    if (error instanceof HttpApiError) {
      return jsonResponse({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status, headers);
    }
    console.error("Request failed", error);
    return jsonResponse({ error: errorToMessage(error) }, 500, headers);
  }
}

async function handleApiRequest(
  request: Request,
  url: URL,
  headers: Headers,
  user: AuthUser | null
): Promise<Response> {
  const ownerId = user?.id ?? "local";
  if (url.pathname === "/api/thread-usage" && request.method === "GET") {
    const threadId = url.searchParams.get("threadId")?.trim() ?? "";
    if (!threadId || threadId.length > 512) return jsonResponse({ error: "threadId is required" }, 400, headers);
    if (authStore && user && user.role !== "admin" && !authStore.ownsThread(threadId, user.id)) {
      return jsonResponse({ error: "Thread belongs to another member" }, 403, headers);
    }
    const threadOwnerId = authStore?.threadOwnerId(threadId) ?? ownerId;
    return jsonResponse({ data: requestUsageStore.list(threadOwnerId, threadId) }, 200, headers);
  }
  if (url.pathname === "/api/context-window-violation" && request.method === "POST") {
    const body = asRecord(await request.json().catch(() => ({})));
    const threadId = stringValue(body.threadId)?.trim();
    const pinned = numberValue(body.pinned);
    const reported = numberValue(body.reported);
    if (!threadId || pinned == null || reported == null || pinned <= 0 || reported <= 0) {
      return jsonResponse({ error: "Invalid context-window violation report" }, 400, headers);
    }
    appendContextWindowLog(
      `violation ownerId=${ownerId} threadId=${threadId} pinned=${pinned} reported=${reported} providerId=${stringValue(body.providerId) ?? ""} groupId=${stringValue(body.groupId) ?? ""} model=${stringValue(body.model) ?? ""} action=blocked-and-restored`
    );
    return jsonResponse({ data: { recorded: true } }, 200, headers);
  }
  if ((url.pathname === "/api/jev/evaluate" || url.pathname === "/api/jev/test") && request.method === "POST") {
    return await handleJevProxyRequest(request, headers, ownerId, user);
  }
  if (url.pathname === "/api/jev/config" && request.method === "GET") {
    const prefs = userPreferencesStore.get(user?.id ?? "local");
    const jevConfig = (prefs.jev as Record<string, unknown>) || {};
    return jsonResponse({ data: jevConfig }, 200, headers);
  }
  if (url.pathname === "/api/jev/config" && request.method === "POST") {
    const body = asRecord(await request.json().catch(() => ({})));
    const updated = userPreferencesStore.patch(user?.id ?? "local", { jev: body as Record<string, JsonValue> });
    setSharedJevConfig(body);
    return jsonResponse({ data: (updated.jev as Record<string, unknown>) || {} }, 200, headers);
  }
  const rosterPathMatch = url.pathname.match(/^\/api\/thread-agent-rosters\/([^/]+)(?:\/members\/([^/]+)(?:\/(start|pause|resume|exit|force-exit|retry|replace))?)?$/);
  if (rosterPathMatch) {
    const parentThreadId = decodeURIComponent(rosterPathMatch[1] ?? "").trim();
    const memberId = rosterPathMatch[2] ? decodeURIComponent(rosterPathMatch[2]).trim() : null;
    const action = rosterPathMatch[3] ?? null;
    assertWorkbenchThreadAccess(parentThreadId, user);
    if (!memberId && !action && request.method === "GET") {
      return jsonResponse({ data: threadAgentRosterStore.get(ownerId, parentThreadId) ?? emptyThreadAgentRoster(parentThreadId) }, 200, headers);
    }
    if (!memberId && !action && request.method === "PUT") {
      const body = asRecord(await request.json().catch(() => ({})));
      const roster = threadAgentRosterStore.putRoles(ownerId, parentThreadId, Array.isArray(body.roles) ? body.roles : []);
      const stored = threadRuntimeMetadataStore.get(ownerId, parentThreadId);
      if (stored) {
        threadRuntimeMetadataStore.put(ownerId, {
          ...stored,
          permission: stored.permission ?? "workspaceAsk",
          agents: parseAgentRuntimeOverride({ ...stored.agents, mode: roster.roles.length ? "enabled" : stored.agents?.mode ?? "inherit", roles: roster.roles })
        });
      }
      if (body.startImmediate !== false) await startImmediateThreadAgentMembers(ownerId, parentThreadId, user);
      const updated = threadAgentRosterStore.get(ownerId, parentThreadId) ?? roster;
      notifyThreadAgentRoster(user, updated);
      return jsonResponse({ data: updated }, 200, headers);
    }
    if (memberId && !action && request.method === "PATCH") {
      const body = asRecord(await request.json().catch(() => ({})));
      threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, body as ThreadAgentMemberPatch);
      const updated = threadAgentRosterStore.get(ownerId, parentThreadId)!;
      notifyThreadAgentRoster(user, updated);
      return jsonResponse({ data: updated }, 200, headers);
    }
    if (memberId && action && request.method === "POST") {
      await runThreadAgentMemberAction(ownerId, parentThreadId, memberId, action, user);
      const updated = threadAgentRosterStore.get(ownerId, parentThreadId)!;
      notifyThreadAgentRoster(user, updated);
      return jsonResponse({ data: updated }, 200, headers);
    }
    return jsonResponse({ error: "Thread agent roster route not found" }, 404, headers);
  }
  const projectPathMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(start|pause|messages|votes))?$/);
  if (url.pathname === "/api/projects" || projectPathMatch) {
    if (url.pathname === "/api/projects" && request.method === "GET") {
      return jsonResponse({ data: projectRoomStore.list(ownerId) }, 200, headers);
    }
    if (url.pathname === "/api/projects" && request.method === "POST") {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const project = projectRoomStore.create(ownerId, {
          name: stringValue(body.name) ?? "Untitled Project",
          description: stringValue(body.description) ?? "",
          workspaces: Array.isArray(body.workspaces) ? body.workspaces : [],
          agents: Array.isArray(body.agents) ? body.agents : [],
          coordinatorAgentId: typeof body.coordinatorAgentId === "string" ? body.coordinatorAgentId : null
        });
        return jsonResponse({ data: project }, 201, headers);
      } catch (error) {
        throw new HttpApiError(400, `Unable to create Project: ${errorToMessage(error)}`, "CUX-PROJECT-API-001");
      }
    }
    if (!projectPathMatch) return jsonResponse({ error: "Project route not found", code: "CUX-PROJECT-API-001" }, 404, headers);
    const projectId = decodeURIComponent(projectPathMatch[1] ?? "");
    const action = projectPathMatch[2];
    const project = projectRoomStore.get(ownerId, projectId);
    if (!project) return jsonResponse({ error: "Project not found", code: "CUX-PROJECT-API-001" }, 404, headers);
    if (!action && request.method === "GET") return jsonResponse({ data: project }, 200, headers);
    if (!action && request.method === "PATCH") {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const patch: import("./projectRoomStore.js").UpdateAgentProjectInput = {};
        if (body.name !== undefined) patch.name = stringValue(body.name) ?? "";
        if (body.description !== undefined) patch.description = stringValue(body.description) ?? "";
        if (body.workspaces !== undefined && Array.isArray(body.workspaces)) patch.workspaces = body.workspaces as never;
        if (body.agents !== undefined && Array.isArray(body.agents)) patch.agents = body.agents as never;
        if (body.coordinatorAgentId !== undefined) patch.coordinatorAgentId = typeof body.coordinatorAgentId === "string" ? body.coordinatorAgentId : null;
        // Status changes are limited to lifecycle transitions handled by the server.
        if (body.status === "draft" || body.status === "paused" || body.status === "archived") patch.status = body.status;
        const updated = projectRoomStore.update(ownerId, projectId, patch);
        return jsonResponse({ data: updated }, 200, headers);
      } catch (error) {
        throw new HttpApiError(400, `Unable to update Project: ${errorToMessage(error)}`, "CUX-PROJECT-API-001");
      }
    }
    if (!action && request.method === "DELETE") {
      try {
        await stopProjectMembers(ownerId, project, user, projectClientId(ownerId, project.id));
        projectRoomStore.delete(ownerId, projectId);
        return jsonResponse({ data: { deleted: true } }, 200, headers);
      } catch (error) {
        throw new HttpApiError(500, `Unable to delete Project: ${errorToMessage(error)}`, "CUX-PROJECT-API-001");
      }
    }
    if (action === "start" && request.method === "POST") {
      try {
        const started = await startProjectMembers(ownerId, project, user);
        return jsonResponse({ data: started }, 200, headers);
      } catch (error) {
        if (error instanceof ProjectDiscussionError) {
          throw new HttpApiError(error.status, error.message, error.code);
        }
        throw new HttpApiError(502, `Unable to start Project members: ${errorToMessage(error)}`, "CUX-PROJECT-START-001");
      }
    }
    if (action === "pause" && request.method === "POST") {
      try {
        await stopProjectMembers(ownerId, project, user, projectClientId(ownerId, project.id));
        const updated = projectRoomStore.update(ownerId, projectId, { status: "paused" });
        return jsonResponse({ data: updated }, 200, headers);
      } catch (error) {
        throw new HttpApiError(502, `Unable to pause Project members: ${errorToMessage(error)}`, "CUX-PROJECT-PAUSE-001");
      }
    }
    if (action === "messages" && request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "500");
      const after = Number(url.searchParams.get("after") ?? "0");
      try {
        return jsonResponse({ data: projectRoomStore.listMessages(ownerId, projectId, limit, after) }, 200, headers);
      } catch (error) {
        throw new HttpApiError(500, `Unable to read Project messages: ${errorToMessage(error)}`, "CUX-PROJECT-API-001");
      }
    }
    if (action === "messages" && request.method === "POST") {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const text = stringValue(body.text)?.trim() ?? "";
        if (!text) throw new HttpApiError(400, "Message text is required", "CUX-PROJECT-API-001");
        if (project.status !== "active") throw new HttpApiError(409, "Project must be active before messaging", "CUX-PROJECT-DISPATCH-002");
        const runKey = projectClientId(ownerId, projectId);
        if (projectDiscussionRuns.has(runKey)) {
          throw new HttpApiError(
            409,
            `${PROJECT_DISCUSSION_ERROR_CODES.RUNNING}: this Project already has an active discussion`,
            PROJECT_DISCUSSION_ERROR_CODES.RUNNING
          );
        }
        // Public callers can only speak as the human owner. Agent/system entries
        // are produced by the server notification coordinator and never accepted
        // from request JSON.
        const message = projectRoomStore.appendMessage(ownerId, {
          projectId,
          agentId: null,
          threadId: null,
          turnId: null,
          itemId: null,
          kind: "human",
          text
        });
        const dispatch = await dispatchProjectMessage(ownerId, projectId, message, user);
        const dispatchCode = dispatch.length === 0
          ? "CUX-PROJECT-DISPATCH-002"
          : dispatch.some((entry) => !entry.ok) ? "CUX-PROJECT-DISPATCH-001" : undefined;
        return jsonResponse({ data: { message, dispatch, ...(dispatchCode ? { code: dispatchCode } : {}) } }, 201, headers);
      } catch (error) {
        if (error instanceof HttpApiError) throw error;
        if (error instanceof ProjectDiscussionError) {
          throw new HttpApiError(error.status, error.message, error.code);
        }
        throw new HttpApiError(502, `Unable to dispatch Project message: ${errorToMessage(error)}`, "CUX-PROJECT-DISPATCH-001");
      }
    }
    if (action === "votes" && request.method === "GET") {
      const proposalId = url.searchParams.get("proposalId")?.trim() ?? "";
      if (!proposalId) return jsonResponse({ error: "proposalId is required", code: "CUX-PROJECT-API-001" }, 400, headers);
      try {
        return jsonResponse({ data: { votes: projectRoomStore.listVotes(ownerId, projectId, proposalId), summary: projectRoomStore.voteSummary(ownerId, projectId, proposalId) } }, 200, headers);
      } catch (error) {
        throw new HttpApiError(500, `Unable to read Project votes: ${errorToMessage(error)}`, "CUX-PROJECT-API-001");
      }
    }
    if (action === "votes" && request.method === "POST") {
      if (project.status !== "active") throw new HttpApiError(409, "Project must be active before voting", "CUX-PROJECT-DISPATCH-002");
      const body = asRecord(await request.json().catch(() => ({})));
      const proposalId = stringValue(body.proposalId)?.trim() ?? "";
      // Agent votes are internal-only. A browser can cast exactly one vote for
      // the authenticated human owner, making the veto identity unforgeable.
      const voterType = "human" as const;
      const voterId = `human:${ownerId}`;
      const choice = body.choice === "reject" || body.choice === "abstain" ? body.choice : body.choice === "approve" ? "approve" : null;
      if (!proposalId || !voterId || !choice) return jsonResponse({ error: "Valid proposalId, voterId and choice are required", code: "CUX-PROJECT-API-001" }, 400, headers);
      try {
        const vote = projectRoomStore.castVote(ownerId, { projectId, proposalId, voterId, voterType, choice, comment: stringValue(body.comment) ?? "" });
        return jsonResponse({ data: { vote, summary: projectRoomStore.voteSummary(ownerId, projectId, proposalId) } }, 201, headers);
      } catch (error) {
        throw new HttpApiError(400, `Unable to record Project vote: ${errorToMessage(error)}`, "CUX-PROJECT-API-001");
      }
    }
    return jsonResponse({ error: "Unsupported project method", code: "CUX-PROJECT-API-001" }, 405, headers);
  }
  if (url.pathname === "/api/image-history") {
    const ownerId = user?.id ?? "local";
    if (request.method === "GET") {
      const threadId = url.searchParams.get("threadId")?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      if (threadId.length > 512) return jsonResponse({ error: "threadId is too long" }, 400, headers);
      const limit = Math.max(1, Math.min(
        IMAGE_HISTORY_MAX_LIMIT,
        Number(url.searchParams.get("limit") ?? IMAGE_HISTORY_DEFAULT_LIMIT) || IMAGE_HISTORY_DEFAULT_LIMIT,
      ));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
      try {
        const page = imageHistoryStore.listPage(ownerId, threadId, { limit, offset });
        return jsonResponse({ data: page.entries, meta: { omittedOversized: page.omittedOversized, truncated: page.truncated } }, 200, headers);
      } catch (error) {
        const stats = safeImageHistoryStats(imageHistoryStore, ownerId, threadId);
        console.warn(`[image-history] list failed thread=${threadId.slice(0, 12)}... count=${stats?.count} totalBytes=${stats?.totalBytes} maxBytes=${stats?.maxBytes} error=${errorToMessage(error)}`);
        return jsonResponse({ error: "Image history is temporarily unavailable; retry later", code: "CUX-IMAGE-HISTORY-OVERLOADED" }, 503, headers);
      }
    }
    if (request.method === "PUT") {
      const body = asRecord(await request.json().catch(() => ({})));
      const threadId = stringValue(body.threadId) ?? "";
      const turnId = stringValue(body.turnId) ?? "";
      const requestId = stringValue(body.requestId) ?? "";
      const status = stringValue(body.status) ?? "completed";
      const items = Array.isArray(body.items) ? body.items : [];
      if (!threadId || !turnId || !requestId || threadId.length > 512 || turnId.length > 512 || requestId.length > 512) {
        return jsonResponse({ error: "Valid image history identifiers are required" }, 400, headers);
      }
      const serialized = JSON.stringify(items);
      if (
        Buffer.byteLength(serialized, "utf8") > 256 * 1024
        || /data:image\/|;base64,/i.test(serialized)
        || imageHistoryContainsInlineImage(items)
      ) {
        return jsonResponse({ error: "Image history must contain references, not inline image data" }, 413, headers);
      }
      if (authStore && user) authStore.claimThread(threadId, user.id);
      try {
        return jsonResponse({ data: imageHistoryStore.put(ownerId, { threadId, turnId, requestId, status, items }) }, 200, headers);
      } catch (error) {
        const stats = safeImageHistoryStats(imageHistoryStore, ownerId, threadId);
        console.warn(`[image-history] put failed thread=${threadId.slice(0, 12)}... requestId=${requestId.slice(0, 12)}... count=${stats?.count} totalBytes=${stats?.totalBytes} error=${errorToMessage(error)}`);
        return jsonResponse({ error: "Image history is temporarily unavailable; retry later", code: "CUX-IMAGE-HISTORY-OVERLOADED" }, 503, headers);
      }
    }
    if (request.method === "DELETE") {
      // Self-heal for threads poisoned by legacy oversized rows (inline base64
      // written before the PUT guard). Deletes only LENGTH(items_json) > 256KiB.
      const threadId = url.searchParams.get("threadId")?.trim() ?? "";
      if (!threadId || threadId.length > 512) return jsonResponse({ error: "Valid threadId is required" }, 400, headers);
      if (authStore && user && user.role !== "admin" && !authStore.ownsThread(threadId, user.id)) {
        return jsonResponse({ error: "Thread belongs to another member" }, 403, headers);
      }
      try {
        const purged = imageHistoryStore.purgeOversized(ownerId, threadId);
        return jsonResponse({ data: { purged } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: "Image history cleanup failed; retry later", code: "CUX-IMAGE-HISTORY-OVERLOADED" }, 503, headers);
      }
    }
  }
  if (url.pathname === "/api/tools/sa_vm_run" && request.method === "POST") {
    const body = asRecord(await request.json().catch(() => ({})));
    const threadId = stringValue(body.threadId)?.trim() ?? "";
    const ownerId = user?.id ?? "local";

    let effectiveCwd: string;
    let effectivePolicy: SaVmPolicyConfig | undefined;
    let effectiveAdditionalRoots: string[] | undefined;

    if (threadId) {
      if (authStore && user && user.role !== "admin" && !authStore.ownsThread(threadId, user.id)) {
        return jsonResponse({ error: "Thread belongs to another member" }, 403, headers);
      }
      const runtime = threadRuntimeMetadataStore.get(ownerId, threadId) ?? threadRuntimeMetadataStore.getAny(threadId);
      if (!runtime || (!runtime.vmEnabled && !runtime.enhanceEnabled && !hasEnhanceToolsEnabled(runtime.vmPolicy?.tools))) {
        return jsonResponse({ error: "SA-VM mode is not enabled for this thread", code: "CUX-SA-VM-DISABLED" }, 409, headers);
      }
      if (!runtime.cwd) {
        return jsonResponse({ error: "SA-VM requires a persisted workspace for this thread", code: "CUX-SA-VM-CWD-REQUIRED" }, 409, headers);
      }
      effectiveCwd = runtime.cwd;
      effectivePolicy = runtime.vmPolicy;
      effectiveAdditionalRoots = runtime.additionalRoots;
    } else {
      effectiveCwd = stringValue(body.cwd)?.trim() || process.cwd();
      effectivePolicy = createDefaultSaVmPolicyConfig();
      effectiveAdditionalRoots = undefined;
    }

    const validation = validateSaVmRequestBody(body);
    if (!validation.ok) return jsonResponse({ error: validation.error, code: validation.code }, 400, headers);
    // Tool callers frequently send `parallel` as a JSON-encoded string. Coerce
    // it here so the validator and the executor observe the same batch shape.
    const parallelTasks = normalizeSaVmParallelTasks(body.parallel);
    if (parallelTasks.ok && parallelTasks.tasks) body.parallel = parallelTasks.tasks;

    const { isJs: isJsReq, isPy: isPyReq } = classifySaVmExecutionRequest(body);
    if (isPyReq && effectivePolicy?.execution?.python !== true) {
      return jsonResponse({
        data: {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: "Python execution is disabled by VM policy and cannot bypass the VM sandbox",
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "python_execution_disabled" }],
          saVmViolation: { rule: "execution.python", blocked: true },
          durationMs: 0,
          terminal: true
        }
      }, 403, headers);
    }
    if (isJsReq && effectivePolicy?.execution?.javascript !== true) {
      return jsonResponse({
        data: {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: "JavaScript execution is disabled by VM policy and cannot bypass the VM sandbox",
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "javascript_execution_disabled" }],
          saVmViolation: { rule: "execution.javascript", blocked: true },
          durationMs: 0,
          terminal: true
        }
      }, 403, headers);
    }
    const rawPathCandidate = (
      body.path ??
      body.file ??
      body.target ??
      body.filePath ??
      body.file_path ??
      body.targetFile ??
      body.target_file ??
      body.filename ??
      body.fileName ??
      body.AbsolutePath ??
      body.absolute_path ??
      body.uri
    ) as string | undefined;

    let result: SaVmRunResult;
    try {
      result = await runSaVmTool({
        ...body,
        action: body.action as string | undefined,
        path: rawPathCandidate,
        file: typeof body.file === "string" ? body.file : rawPathCandidate,
        target: typeof body.target === "string" ? body.target : undefined,
        filePath: typeof body.filePath === "string" ? body.filePath : undefined,
        file_path: typeof body.file_path === "string" ? body.file_path : undefined,
        targetFile: typeof body.targetFile === "string" ? body.targetFile : undefined,
        target_file: typeof body.target_file === "string" ? body.target_file : undefined,
        filename: typeof body.filename === "string" ? body.filename : undefined,
        fileName: typeof body.fileName === "string" ? body.fileName : undefined,
        AbsolutePath: typeof body.AbsolutePath === "string" ? body.AbsolutePath : undefined,
        absolute_path: typeof body.absolute_path === "string" ? body.absolute_path : undefined,
        uri: typeof body.uri === "string" ? body.uri : undefined,
        content: body.content as string | undefined,
        profile: body.profile as string | undefined,
        subcommand: body.subcommand as string | undefined,
        filter: body.filter as string | undefined,
        test_file: body.test_file as string | undefined,
        diff: typeof body.diff === "string" ? body.diff : undefined,
        patch: (body.action === "apply_patch" || body.action === "patch" || !body.action)
          ? ((body.patch ?? body.diff) as string | undefined)
          : (body.patch as string | undefined),
        old_text: (body.old_text ?? body.oldText ?? body.old) as string | undefined,
        new_text: (body.new_text ?? body.newText ?? body.new) as string | undefined,
        start_line: typeof body.start_line === "number" ? body.start_line : (typeof body.startLine === "number" ? body.startLine : undefined),
        end_line: typeof body.end_line === "number" ? body.end_line : (typeof body.endLine === "number" ? body.endLine : undefined),
        offset: typeof body.offset === "number" ? body.offset : undefined,
        max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
        remaining_tokens: typeof body.remaining_tokens === "number" ? body.remaining_tokens : undefined,
        max_lines: typeof body.max_lines === "number" ? body.max_lines : (typeof body.maxLines === "number" ? body.maxLines : undefined),
        max_line_length: typeof body.max_line_length === "number" ? body.max_line_length : (typeof body.maxLineLength === "number" ? body.maxLineLength : undefined),
        numbered: body.numbered !== false,
        dir: (body.dir ?? body.directory ?? body.folder ?? body.searchDirectory ?? body.SearchDirectory) as string | undefined,
        pattern: (body.pattern ?? body.glob ?? body.Pattern) as string | undefined,
        query: (body.query ?? body.Query) as string | undefined,
        queries: Array.isArray(body.queries) ? body.queries as string[] : undefined,
        symbol: body.symbol as string | undefined,
        mode: body.mode as string | undefined,
        detail: typeof body.detail === "boolean" ? body.detail : undefined,
        max_results: typeof body.max_results === "number" ? body.max_results : (typeof body.limit === "number" ? body.limit : undefined),
        candidate_files: Array.isArray(body.candidate_files) ? body.candidate_files as string[] : (Array.isArray(body.files) ? body.files as string[] : undefined),
        files: Array.isArray(body.files) ? body.files as string[] : undefined,
        exclude_comments: typeof body.exclude_comments === "boolean" ? body.exclude_comments : undefined,
        include_declarations: typeof body.include_declarations === "boolean" ? body.include_declarations : undefined,
        keep_last_n_turns: typeof body.keep_last_n_turns === "number" ? body.keep_last_n_turns : undefined,
        filter_tools: Array.isArray(body.filter_tools) ? body.filter_tools as string[] : undefined,
        reason: body.reason as string | undefined,
        max_bytes: typeof body.max_bytes === "number" ? body.max_bytes : (typeof body.maxBytes === "number" ? body.maxBytes : undefined),
        max_entries: typeof body.max_entries === "number" ? body.max_entries : (typeof body.maxEntries === "number" ? body.maxEntries : undefined),
        max_depth: typeof body.max_depth === "number" ? body.max_depth : (typeof body.maxDepth === "number" ? body.maxDepth : undefined),
        depth: typeof body.depth === "number" ? body.depth : undefined,
        recursive: typeof body.recursive === "boolean" ? body.recursive : undefined,
        from: body.from as string | undefined,
        to: body.to as string | undefined,
        max_matches: typeof body.max_matches === "number" ? body.max_matches : undefined,
        url: body.url as string | undefined,
        method: body.method as string | undefined,
        headers: body.headers as Record<string, string> | undefined,
        body: body.body as string | undefined,
        question: typeof body.question === "string" ? body.question : undefined,
        options: body.options as Record<string, string> | string[] | undefined,
        checks: body.checks as Record<string, string> | string[] | undefined,
        criteria: body.criteria as Record<string, string> | Record<string, unknown> | undefined,
        choices: body.choices as Record<string, string> | string[] | undefined,
        context: (body.context ?? body.state) as number | string | undefined,
        goal: typeof body.goal === "string" ? body.goal : undefined,
        thoughts: body.thoughts as Record<string, string> | string[] | undefined,
        items: body.items as Record<string, string> | string[] | undefined,
        task: typeof body.task === "string" ? body.task : undefined,
        phases: body.phases as Record<string, string> | string[] | undefined,
        plan: typeof body.plan === "string" ? body.plan : undefined,
        constraints: body.constraints as Record<string, string> | string[] | undefined,
        code: typeof body.code === "string" ? body.code : undefined,
        error_summary: typeof body.error_summary === "string" ? body.error_summary : (typeof body.error === "string" ? body.error : undefined),
        hypotheses: body.hypotheses as Record<string, string> | string[] | undefined,
        proposed_fix: typeof body.proposed_fix === "string" ? body.proposed_fix : (typeof body.fix === "string" ? body.fix : undefined),
        user_request: typeof body.user_request === "string" ? body.user_request : (typeof body.request === "string" ? body.request : undefined),
        actual_work: typeof body.actual_work === "string" ? body.actual_work : (typeof body.work === "string" ? body.work : undefined),
        evidence: typeof body.evidence === "string" ? body.evidence : undefined,
        target_component: typeof body.target_component === "string" ? body.target_component : undefined,
        criterion: typeof body.criterion === "string" ? body.criterion : undefined,
        causes: body.causes as Record<string, string> | string[] | undefined,
        units: body.units as Record<string, string> | string[] | undefined,
        jev_model: typeof body.jev_model === "string" ? body.jev_model : (typeof body.model === "string" ? body.model : undefined),
        jev_provider_id: typeof body.jev_provider_id === "string" ? body.jev_provider_id : (typeof body.providerId === "string" ? body.providerId : undefined),
        jev_group_id: typeof body.jev_group_id === "string" ? body.jev_group_id : (typeof body.groupId === "string" ? body.groupId : undefined),
        api_key: typeof body.api_key === "string" ? body.api_key : (typeof body.apiKey === "string" ? body.apiKey : undefined),
        base_url: typeof body.base_url === "string" ? body.base_url : (typeof body.baseUrl === "string" ? body.baseUrl : undefined),
        questions: body.questions && typeof body.questions === "object" ? body.questions as Record<string, unknown> : undefined,
        source: body.source as string | undefined,
        language: (body.language as any) ?? "js",
        timeout_ms: typeof body.timeout_ms === "number" ? body.timeout_ms : (typeof body.timeout === "number" ? body.timeout : undefined),
        timeout: typeof body.timeout === "number" ? body.timeout : undefined,
        args: body.args as string[] | undefined,
        exe: body.exe as string | undefined,
        head_lines: typeof body.head_lines === "number" ? body.head_lines : undefined,
        tail_lines: typeof body.tail_lines === "number" ? body.tail_lines : undefined,
        lines: typeof body.lines === "number" ? body.lines : undefined,
        tail: typeof body.tail === "boolean" ? body.tail : undefined,
        requested_caps: body.requested_caps as never,
        limits: body.limits as never,
        parallel: Array.isArray(body.parallel)
          ? body.parallel.map((task) => ({
            ...asRecord(task),
            cwd: effectiveCwd,
            additionalRoots: effectiveAdditionalRoots,
            policy: effectivePolicy
          })) as never
          : undefined,
        concurrency: typeof body.concurrency === "number" ? body.concurrency : undefined,
        cwd: effectiveCwd,
        additionalRoots: effectiveAdditionalRoots,
        policy: effectivePolicy
      });
    } catch (err: any) {
      result = {
        ok: false,
        kind: "sa_error",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: 0
      };
    }
    return jsonResponse({ data: result }, result.kind === "unavailable" ? 503 : 200, headers);
  }
  if (url.pathname === "/api/thread-runtime") {
    const ownerId = user?.id ?? "local";
    if (request.method === "GET") {
      const threadId = url.searchParams.get("threadId")?.trim() ?? "";
      if (!threadId) {
        return jsonResponse({ error: "threadId is required" }, 400, headers);
      }
      assertWorkbenchThreadAccess(threadId, user);
      const currentOwner = threadRuntimeMetadataStore.get(ownerId, threadId);
      const ownerIdForThread = user ? authStore?.threadOwnerId(threadId) : null;
      const data = currentOwner
        ?? (ownerIdForThread ? threadRuntimeMetadataStore.get(ownerIdForThread, threadId) : null)
        ?? threadRuntimeMetadataStore.getAny(threadId);
      return jsonResponse({ data }, 200, headers);
    }
    if (request.method === "PUT") {
      const body = asRecord(await request.json().catch(() => ({})));
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      // Route fields are presence-checked: an omitted field stays undefined so
      // the store merges with the stored per-conversation route instead of
      // wiping it. Only an explicitly sent value replaces the stored one.
      const model = "model" in body ? stringValue(body.model)?.trim() ?? "" : undefined;
      const reasoningEffort = "reasoningEffort" in body ? stringValue(body.reasoningEffort)?.trim() ?? "" : undefined;
      if (!threadId || threadId.length > 512) {
        return jsonResponse({ error: "A valid threadId is required" }, 400, headers);
      }
      if ((model !== undefined && model.length > 512) || (reasoningEffort !== undefined && reasoningEffort.length > 64)) {
        return jsonResponse({ error: "Thread runtime metadata is too long" }, 400, headers);
      }
      const permission = body.permission === undefined
        ? threadRuntimeMetadataStore.get(ownerId, threadId)?.permission ?? "workspaceAsk"
        : permissionPresetId(body.permission);
      if (!permission) {
        return jsonResponse({ error: "A valid permission is required" }, 400, headers);
      }
      const providerId = "providerId" in body ? nullableShortString(body.providerId, 512) : undefined;
      const groupId = "groupId" in body ? nullableShortString(body.groupId, 512) : undefined;
      if (providerId === undefined && "providerId" in body) {
        return jsonResponse({ error: "Provider or group id is too long" }, 400, headers);
      }
      if (groupId === undefined && "groupId" in body) {
        return jsonResponse({ error: "Provider or group id is too long" }, 400, headers);
      }
      if (user && user.role !== "admin" && providerId && !securityStore.isProviderAllowed(user.id, providerId, false)) {
        return jsonResponse({ error: "Relay not assigned to this member" }, 403, headers);
      }
      const freeAutoCompactEnabled = body.freeAutoCompactEnabled === undefined
        ? undefined
        : typeof body.freeAutoCompactEnabled === "boolean"
          ? body.freeAutoCompactEnabled
          : null;
      const freeAutoCompactThreshold = body.freeAutoCompactThreshold === undefined
        ? undefined
        : numberValue(body.freeAutoCompactThreshold);
      const freeAutoCompactModel = body.freeAutoCompactModel === undefined
        ? undefined
        : nullableShortString(body.freeAutoCompactModel, 512);
      const freeAutoCompactProviderId = body.freeAutoCompactProviderId === undefined
        ? undefined
        : nullableShortString(body.freeAutoCompactProviderId, 512);
      const freeAutoCompactGroupId = body.freeAutoCompactGroupId === undefined
        ? undefined
        : nullableShortString(body.freeAutoCompactGroupId, 512);
      const compactMode = body.compactMode === undefined
        ? undefined
        : body.compactMode === "off" || body.compactMode === "cheap" || body.compactMode === "jev-sub" || body.compactMode === "jev-token"
          ? body.compactMode
          : null;
      const jevCompressThreshold = body.jevCompressThreshold === undefined
        ? undefined
        : numberValue(body.jevCompressThreshold);
      const vmEnabled = body.vmEnabled === undefined
        ? undefined
        : typeof body.vmEnabled === "boolean" ? body.vmEnabled : null;
      const vmPolicy = body.vmPolicy === undefined
        ? undefined
        : body.vmPolicy && typeof body.vmPolicy === "object" && !Array.isArray(body.vmPolicy)
          ? body.vmPolicy as SaVmPolicyConfig
          : null;
      if (
        freeAutoCompactEnabled === null
        || (body.freeAutoCompactThreshold !== undefined && freeAutoCompactThreshold === undefined)
        || (body.freeAutoCompactModel !== undefined && freeAutoCompactModel === undefined)
        || (body.freeAutoCompactProviderId !== undefined && freeAutoCompactProviderId === undefined)
        || (body.freeAutoCompactGroupId !== undefined && freeAutoCompactGroupId === undefined)
        || compactMode === null
        || (body.jevCompressThreshold !== undefined && jevCompressThreshold === undefined)
        || vmEnabled === null
        || vmPolicy === null
      ) {
        return jsonResponse({ error: "Free auto-compaction preference is invalid" }, 400, headers);
      }
      const cwd = optionalShortString(body.cwd, 4096);
      const additionalRoots = optionalStringArray(body.additionalRoots, 128, 4096);
      const workspaceFilePath = body.workspaceFilePath === "" ? "" : optionalShortString(body.workspaceFilePath, 4096);
      if (cwd === null || additionalRoots === null || workspaceFilePath === null) {
        return jsonResponse({ error: "Workspace directory metadata is invalid" }, 400, headers);
      }
      let agents: AgentRuntimeOverride;
      try {
        agents = body.agents === undefined
          ? threadRuntimeMetadataStore.get(ownerId, threadId)?.agents ?? parseAgentRuntimeOverride(undefined)
          : parseAgentRuntimeOverride(body.agents);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
      // A history created before membership was enabled has no thread owner.
      // Runtime selection is persisted immediately before a turn, so this is
      // the first authenticated point where it can be safely migrated.
      if (authStore && user) {
        authStore.claimThread(threadId, user.id);
      }
      return jsonResponse({
        data: threadRuntimeMetadataStore.put(ownerId, {
          threadId,
          ...(providerId === undefined ? {} : { providerId }),
          ...(groupId === undefined ? {} : { groupId }),
          ...(model === undefined ? {} : { model }),
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          ...(freeAutoCompactEnabled === undefined ? {} : { freeAutoCompactEnabled }),
          ...(freeAutoCompactThreshold === undefined ? {} : { freeAutoCompactThreshold }),
          ...(freeAutoCompactModel === undefined ? {} : { freeAutoCompactModel }),
          ...(freeAutoCompactProviderId === undefined ? {} : { freeAutoCompactProviderId }),
          ...(freeAutoCompactGroupId === undefined ? {} : { freeAutoCompactGroupId }),
           ...(compactMode === undefined ? {} : { compactMode }),
           ...(jevCompressThreshold === undefined ? {} : { jevCompressThreshold }),
           ...(vmEnabled === undefined ? {} : { vmEnabled }),
           ...(vmPolicy === undefined ? {} : { vmPolicy }),
          permission,
          agents,
          ...(cwd === undefined ? {} : { cwd }),
          ...(additionalRoots === undefined ? {} : { additionalRoots }),
          ...(workspaceFilePath === undefined ? {} : { workspaceFilePath }),
           ...(body.cliBackend === "claude" || body.cliBackend === "agy" || body.cliBackend === "codex" || body.cliBackend === "auggie" || body.cliBackend === "grok" || body.cliBackend === "muse" || body.cliBackend === "pi" || body.cliBackend === "opencode" || body.cliBackend === "opencode-v2" || body.cliBackend === "mini" || body.engine === "pi"
            ? { cliBackend: (body.cliBackend === "pi" || body.engine === "pi" ? "pi" : body.cliBackend) as CliBackend }
            : {})
        })
      }, 200, headers);
    }
    if (request.method === "PATCH") {
      const body = asRecord(await request.json().catch(() => ({})));
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      const cwd = optionalShortString(body.cwd, 4096);
      const additionalRoots = optionalStringArray(body.additionalRoots, 128, 4096);
      const workspaceFilePath = body.workspaceFilePath === "" ? "" : optionalShortString(body.workspaceFilePath, 4096);
      if (!threadId || threadId.length > 512) {
        return jsonResponse({ error: "A valid threadId is required" }, 400, headers);
      }
      if (cwd === null || additionalRoots === null || workspaceFilePath === null || cwd === undefined || additionalRoots === undefined) {
        return jsonResponse({ error: "Workspace directory metadata is invalid" }, 400, headers);
      }
      const updated = threadRuntimeMetadataStore.updateWorkspace(ownerId, { threadId, cwd, additionalRoots, workspaceFilePath });
      if (!updated) return jsonResponse({ error: "Thread runtime metadata not found" }, 404, headers);
      return jsonResponse({ data: updated }, 200, headers);
    }
  }
  const codexSessionMatch = url.pathname.match(/^\/api\/codex\/sessions\/([^/]+)$/);
  if (codexSessionMatch && request.method === "DELETE") {
    const session = codexApiSessions.delete(decodeURIComponent(codexSessionMatch[1] ?? ""), codexApiOwnerId(user));
    if (!session) return jsonResponse({ error: "Codex API session not found" }, 404, headers);
    subscriptionRegistry.unwatchAllForClient(session.clientId);
    return jsonResponse({ data: { closed: true } }, 200, headers);
  }
  const relayGroupsMatch = url.pathname.match(/^\/api\/codex\/relays\/([^/]+)\/groups$/);
  if (relayGroupsMatch && request.method === "GET") {
    const providerId = decodeURIComponent(relayGroupsMatch[1] ?? "").trim();
    if (!providerId || providerId.length > 512) {
      return jsonResponse({ error: "A valid providerId is required" }, 400, headers);
    }
    const allowedProviderIds = user && user.role !== "admin"
      ? new Set(securityStore.getAllowedProviders(user.id))
      : undefined;
    const provider = findRelayDirectoryProvider(visibleProviders(await providerStore.list()), providerId, allowedProviderIds);
    if (!provider) return jsonResponse({ error: "Relay not found" }, 404, headers);
    return jsonResponse({
      data: {
        providerId: provider.providerId,
        providerName: provider.providerName,
        groups: provider.groups
      }
    }, 200, headers);
  }
  if (url.pathname === "/api/codex/relay-settings/free-ollama/import" && request.method === "POST") {
    if (!FREE_OLLAMA_ENABLED) return jsonResponse({ error: "Free Ollama is disabled in this build" }, 404, headers);
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    try {
      const body = asRecord(await request.json().catch(() => ({})));
      const sourceUrl = stringValue(body.sourceUrl)?.trim()
        || "https://raw.githubusercontent.com/forrany/Awesome-Ollama-Server/main/public/data.json";
      const response = await fetch(sourceUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) return jsonResponse({ error: `Free Ollama source returned HTTP ${response.status}` }, 502, headers);
      const source = await response.json();
      if (!Array.isArray(source)) return jsonResponse({ error: "Free Ollama source must be an array" }, 400, headers);
      const sourceEntries = Array.isArray(source) ? source : [];
      const sourceEligibleEntries = eligibleFreeOllamaEntries(sourceEntries);
      const eligibleEntries = await probeFreeOllamaEntries(sourceEligibleEntries);
      const groups = buildFreeOllamaGroups(eligibleEntries);
      if (groups.length === 0) return jsonResponse({ error: "No usable Ollama services found" }, 400, headers);
      const models = [...new Set(groups.flatMap((group) => group.models ?? []))];
      const existing = await providerStore.get("free-ollama");
      const saved = await providerStore.save({
        ...(existing ?? {}),
        id: "free-ollama",
        name: "Free Ollama",
        kind: "ollama",
        serviceProvider: { id: "free-ollama", name: "Free Ollama" },
        baseUrl: groups[0]!.baseUrl,
        defaultModel: models[0],
        nativeModels: models,
        modelAliases: existing?.modelAliases ?? [],
        channelMode: "advanced",
        groups,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      });
      return jsonResponse({ data: {
        sourceUrl,
        minimumTps: 60,
        totalServers: sourceEntries.length,
        sourceEligibleServers: sourceEligibleEntries.length,
        eligibleServers: eligibleEntries.length,
        filteredServers: Math.max(0, sourceEntries.length - eligibleEntries.length),
        importedGroups: groups.length,
        importedModels: models.length,
        settings: relaySettingsView(saved)
      } }, existing ? 200 : 201, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  if (url.pathname === "/api/codex/free-model-access/status" && request.method === "GET") {
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: free model access" }, 403, headers);
    return jsonResponse({ data: await freeModelAccess.status() }, 200, headers);
  }
  if (url.pathname === "/api/codex/free-model-access/requirement" && request.method === "POST") {
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: free model access" }, 403, headers);
    try {
      return jsonResponse({ data: await freeModelAccess.createRequirement() }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  if (url.pathname === "/api/codex/free-model-access/license" && request.method === "POST") {
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: free model access" }, 403, headers);
    try {
      const body = asRecord(await request.json().catch(() => ({})));
      const key = stringValue(body.key)?.trim();
      if (!key) return jsonResponse({ error: "A free model key is required" }, 400, headers);
      return jsonResponse({ data: await freeModelAccess.saveKey(key) }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  if (url.pathname === "/api/codex/free-model-access/license" && request.method === "DELETE") {
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: free model access" }, 403, headers);
    return jsonResponse({ data: await freeModelAccess.clearKey() }, 200, headers);
  }
  if (url.pathname === "/api/codex/freebuff/session" && request.method === "GET") {
    try {
      const status = await getFreebuffSessionStatus();
      return jsonResponse({ data: status }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 500, headers);
    }
  }
  if (url.pathname === "/api/codex/freebuff/session/release" && request.method === "POST") {
    try {
      const result = await releaseFreebuffSession();
      return jsonResponse({ data: result }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 500, headers);
    }
  }
  if (url.pathname === "/api/codex/cline/balance" && request.method === "GET") {
    try {
      const force = url.searchParams.has("refresh") || url.searchParams.get("force") === "true";
      const balanceInfo = await fetchClineBalance({ forceRefresh: force });
      return jsonResponse({ data: balanceInfo }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 500, headers);
    }
  }
  if (url.pathname === "/api/codex/relay-settings/omniroute-free/import" && request.method === "POST") {
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    // The key/license gate is intentionally retained but disabled temporarily.
    // Set FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED to true to restore it.
    let authorizationId: string | undefined;
    if (FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED) {
      const authorization = await freeModelAccess.prepareRefresh();
      if (!authorization.allowed) {
        const status = !authorization.configured || authorization.serviceError ? 503 : 428;
        return jsonResponse({
          error: authorization.serviceError ?? (authorization.configured
            ? "A valid machine-bound Codex Ultra free key is required"
            : "Codex Ultra free-key service is not configured"),
          code: status === 503 ? "FREE_MODEL_KEY_SERVICE_UNAVAILABLE" : "FREE_MODEL_KEY_REQUIRED",
          access: authorization
        }, status, headers);
      }
      authorizationId = authorization.authorizationId;
    }
    try {
      const existingProvider = await providerStore.get(OMNIROUTE_FREE_PROVIDER_ID);
      const existingCline = existingProvider?.groups?.find((g) => g.id === "cline-free");
      const existingFreebuff = existingProvider?.groups?.find((g) => g.id === "freebuff");
      const existingD2Api = existingProvider?.groups?.find((g) => g.id === "d2api");
      const d2apiBaseUrl = existingD2Api?.baseUrl?.trim() || process.env.D2API_BASE_URL?.trim() || D2API_BASE_URL;
      // 内嵌 duck2api：模型表来自进程内实现，无需探测外部服务，恒可用。
      const d2apiEmbeddedModels = listEmbeddedDuck2ApiModels().data.map((m) => m.id);

      const [localClineToken, localFreebuffCreds] = await Promise.all([
        resolveLocalClineToken(),
        resolveLocalFreebuffCredentials()
      ]);
      const hasCline = Boolean(localClineToken || (existingCline?.keys && existingCline.keys.length > 0));
      const hasFreebuff = Boolean(localFreebuffCreds?.token || (existingFreebuff?.keys && existingFreebuff.keys.length > 0));

      const [opencodeResult, kiloResult, clineResult, freebuffResult] = await Promise.allSettled([
        fetchOmniRouteFreeModels(),
        fetchKiloCodeFreeModels(),
        hasCline ? fetchClineFreeModels() : Promise.resolve({ models: [], fetchedModels: 0 }),
        hasFreebuff ? fetchFreebuffFreeModels({ token: localFreebuffCreds?.token }) : Promise.resolve({ models: [], fetchedModels: 0 })
      ]);
      const opencodeModels = opencodeResult.status === "fulfilled" ? opencodeResult.value.models : [];
      const kiloModels = kiloResult.status === "fulfilled" ? kiloResult.value.models : [];
      const clineModels = clineResult.status === "fulfilled" ? clineResult.value.models : [];
      const freebuffModels = freebuffResult.status === "fulfilled" ? freebuffResult.value.models : [];
      const d2apiModels = d2apiEmbeddedModels.length > 0 ? d2apiEmbeddedModels : (existingD2Api?.models ?? undefined);

      if (opencodeModels.length === 0 && kiloModels.length === 0 && (!hasCline || clineModels.length === 0) && (!hasFreebuff || freebuffModels.length === 0) && (!d2apiModels || d2apiModels.length === 0)) {
        const firstError = opencodeResult.status === "rejected" ? opencodeResult.reason : (kiloResult.status === "rejected" ? kiloResult.reason : (clineResult.status === "rejected" ? clineResult.reason : (freebuffResult.status === "rejected" ? freebuffResult.reason : new Error("Failed to fetch free models"))));
        throw firstError;
      }

      const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels, existingProvider?.groups, {
        hasClineCredentials: hasCline,
        hasFreebuffCredentials: hasFreebuff,
        d2apiModels,
        d2apiBaseUrl
      });
      const allNativeModels = [...new Set(groups.flatMap((g) => g.models ?? []))];

      const saved = await providerStore.saveTransient({
        id: OMNIROUTE_FREE_PROVIDER_ID,
        name: "CodexUltraFree",
        kind: "responsesRelay",
        serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" },
        baseUrl: OMNIROUTE_FREE_BASE_URL,
        defaultModel: groups[0]?.models?.[0] ?? allNativeModels[0],
        nativeModels: allNativeModels,
        modelAliases: [],
        stationType: "charity",
        channelMode: "fast",
        remark: "Managed CodexUltraFree models",
        groups,
        createdAt: existingProvider?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      });
      if (FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED) {
        await freeModelAccess.completeRefresh(authorizationId, true, allNativeModels.length);
      }
      const fetchedCount = (opencodeResult.status === "fulfilled" ? opencodeResult.value.fetchedModels : 0)
        + (kiloResult.status === "fulfilled" ? kiloResult.value.fetchedModels : 0)
        + (clineResult.status === "fulfilled" ? clineResult.value.fetchedModels : 0)
        + (freebuffResult.status === "fulfilled" ? freebuffResult.value.fetchedModels : 0);
      return jsonResponse({ data: {
        providerId: saved.id,
        upstream: OMNIROUTE_FREE_BASE_URL,
        fetchedModels: fetchedCount,
        importedGroups: saved.groups?.length ?? 0,
        importedModels: allNativeModels.length,
        settings: relaySettingsView(saved)
      } }, 201, headers);
    } catch (error) {
      if (FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED && authorizationId) {
        await freeModelAccess.completeRefresh(authorizationId, false, 0).catch(() => undefined);
      }
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  if (url.pathname === "/api/codex/relay-settings/d2api/import" && request.method === "POST") {
    if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    try {
      const body = asRecord(await request.json().catch(() => ({})));
      const baseUrl = stringValue(body.baseUrl)?.trim() || D2API_BASE_URL;
      const apiKey = stringValue(body.apiKey)?.trim() ?? "";
      // d2api 是自托管服务：探测不到（还没启动）也不报错，用默认模型表建组，
      // 服务上线后自动可用；同步按钮可随时刷新。
      let probed: string[] = [];
      let reachable = false;
      try {
        const fetched = await fetchD2ApiFreeModels({ baseUrl });
        probed = fetched.models;
        reachable = true;
      } catch (error) {
        console.warn(`[d2api] local probe failed (${baseUrl}), using default model list: ${errorToMessage(error)}`);
      }
      const d2apiModels = probed.length > 0 ? probed : [...D2API_DEFAULT_MODELS];
      const existingProvider = await providerStore.get(OMNIROUTE_FREE_PROVIDER_ID);
      let groups = buildAllFreeGroups([], [], undefined, undefined, existingProvider?.groups ?? [], {
        d2apiModels,
        d2apiApiKey: apiKey,
        d2apiBaseUrl: baseUrl
      });
      if (!existingProvider) {
        groups = groups.filter((group) => group.id === "d2api" || (group.models?.length ?? 0) > 0);
      }
      const allNativeModels = [...new Set(groups.flatMap((group) => group.models ?? []))];
      const saved = await providerStore.saveTransient({
        ...(existingProvider ?? {}),
        id: OMNIROUTE_FREE_PROVIDER_ID,
        name: existingProvider?.name ?? "CodexUltraFree",
        kind: "responsesRelay",
        serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" },
        baseUrl: existingProvider?.baseUrl ?? OMNIROUTE_FREE_BASE_URL,
        defaultModel: groups.find((group) => group.id === "d2api")?.models?.[0] ?? groups[0]?.models?.[0] ?? allNativeModels[0],
        nativeModels: allNativeModels,
        modelAliases: existingProvider?.modelAliases ?? [],
        stationType: "charity",
        channelMode: "fast",
        remark: existingProvider?.remark ?? "Managed CodexUltraFree models",
        groups,
        createdAt: existingProvider?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      });
      const d2apiGroup = saved.groups?.find((group) => group.id === "d2api");
      return jsonResponse({ data: {
        providerId: saved.id,
        groupId: "d2api",
        baseUrl,
        reachable,
        fetchedModels: probed.length,
        models: d2apiGroup?.models ?? d2apiModels,
        contextWindow: D2API_DEFAULT_CONTEXT_WINDOW,
        settings: relaySettingsView(saved)
      } }, existingProvider ? 200 : 201, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  const relayModelFetchMatch = url.pathname.match(/^\/api\/codex\/relay-settings\/([^/]+)\/groups\/([^/]+)\/models\/fetch$/);
  if (relayModelFetchMatch && request.method === "POST") {
    if (user && user.role !== "admin") {
      return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    }
    try {
      const providerId = decodeURIComponent(relayModelFetchMatch[1] ?? "").trim();
      const groupId = decodeURIComponent(relayModelFetchMatch[2] ?? "").trim();
      const provider = await providerStore.get(providerId);
      if (!provider) return jsonResponse({ error: "Relay not found" }, 404, headers);
      const isOpencodeLocal = providerId === OPENCODE_OFFICIAL_PROVIDER_ID || providerId === "opencode-local";
      // 兼容旧 default/free 分组: opencode-local 已收敛为 v1/v2，仅这两个旧 id
      // 映射到 v1 后再发现全量列表；其它未知 id 仍 404（空串也不误命中 v1）。
      const legacyGroupId = (() => {
        const normalized = groupId.trim().toLowerCase();
        return isOpencodeLocal && (normalized === "default" || normalized === "free") ? OPENCODE_V1_GROUP_ID : null;
      })();
      const group = provider.groups?.find((entry) => entry.id === groupId
        || (legacyGroupId !== null && entry.id === legacyGroupId));
      if (!group) return jsonResponse({ error: "Relay group not found" }, 404, headers);
      const body = asRecord(await request.json().catch(() => ({})));
      const explicitKey = stringValue(body.apiKey)?.trim();
      const apiKey = await resolveGroupApiKey(provider, group, explicitKey || undefined);
      const isFreeRelay = providerId === OMNIROUTE_FREE_PROVIDER_ID;
      let result: Awaited<ReturnType<typeof fetchProviderModels>>;
      if (isFreeRelay && groupId === "kilocode") {
        const kilo = await fetchKiloCodeFreeModels().catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
        result = { models: kilo.models, error: "error" in kilo ? (kilo.error as string) : undefined, endpoint: `${group.baseUrl || KILOCODE_FREE_BASE_URL}/models` };
      } else if (isFreeRelay && (groupId === "opencode" || groupId === "opencode-free")) {
        const opencode = await fetchOmniRouteFreeModels().catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
        result = { models: opencode.models, error: "error" in opencode ? (opencode.error as string) : undefined, endpoint: `${group.baseUrl || OMNIROUTE_FREE_BASE_URL}/models` };
      } else if (isFreeRelay && groupId === "cline-free") {
        const cline = await fetchClineFreeModels().catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
        result = { models: cline.models, error: "error" in cline ? (cline.error as string) : undefined, endpoint: CLINE_RECOMMENDED_MODELS_URL };
      } else if (isFreeRelay && groupId === "freebuff") {
        const freebuff = await fetchFreebuffFreeModels({ token: apiKey }).catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
        result = { models: freebuff.models, error: "error" in freebuff ? (freebuff.error as string) : undefined, endpoint: `${FREEBUFF_BASE_URL}/freebuff/session` };
      } else if (isFreeRelay && groupId === "d2api") {
        const d2api = await fetchD2ApiFreeModels({ baseUrl: group.baseUrl }).catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
        result = { models: d2api.models, error: "error" in d2api ? (d2api.error as string) : undefined, endpoint: `${group.baseUrl || D2API_BASE_URL}/v1/models` };
      } else if (providerId === OPENCODE_OFFICIAL_PROVIDER_ID || providerId === "opencode-local") {
        // `group` 已是解析后的持久分组（旧 default/free 即 v1）：v1/v2 各自用
        // 对应二进制跑 `opencode models` 拉全量本地目录，不做免费子集过滤；
        // 仅当请求的就是旧 `free` 分组时才按免费规则过滤（读行为与之前一致）。
        const isV2Group = group.id === OPENCODE_V2_GROUP_ID;
        const bin = isV2Group ? findOpencodeV2Bin() : findOpencodeBin();
        let models: string[] = [];
        let fetchErr: string | undefined;
        try {
          models = bin ? await listOpencodeModelsAsync(bin, process.env, 15_000) : [];
          if (groupId === "free") {
            models = filterOpencodeFreeModels(models);
          }
        } catch (err) {
          fetchErr = errorToMessage(err);
        }
        const fallback = isV2Group ? OPENCODE_V2_FALLBACK_MODELS : OPENCODE_FALLBACK_FREE_MODELS;
        result = {
          models: models.length > 0 ? models : fallback,
          error: fetchErr,
          endpoint: bin || "opencode CLI"
        };
      } else {
        result = await fetchProviderModels({
          baseUrl: group.baseUrl || provider.baseUrl || "",
          apiKey: apiKey || undefined,
          kind: provider.kind,
          protocol: group.responseProtocol,
          authType: group.authType
        });
      }
      if (result.error && result.models.length === 0) {
        return jsonResponse({ error: result.error, models: [], endpoint: result.endpoint }, 400, headers);
      }
      const selectedInput = body.selectedModels === undefined
        ? undefined
        : stringArrayValue(body.selectedModels, "selectedModels");
      const selectedModels = selectFetchedRelayModels(result.models, selectedInput);
      const fetchedCapabilities = result.modelCapabilities
        ? Object.fromEntries(Object.entries(result.modelCapabilities).filter(([model]) => selectedModels.includes(model)))
        : undefined;
      const save = body.save !== false;
      // 存回解析后的持久分组 id，避免旧 default/free 字面量建出幽灵分组。
      const updatedProvider = setRelayGroupModels(provider, group.id, selectedModels, fetchedCapabilities);
      const saved = save
        ? (isFreeRelay ? await providerStore.saveTransient(updatedProvider) : await providerStore.save(updatedProvider))
        : provider;
      return jsonResponse({
        data: {
          providerId,
          groupId,
          models: result.models,
          ...(result.modelCapabilities ? { modelCapabilities: result.modelCapabilities } : {}),
          selectedModels,
          saved: save,
          endpoint: result.endpoint ?? null,
          settings: relaySettingsView(saved)
        }
      }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  const relayModelsMatch = url.pathname.match(/^\/api\/codex\/relay-settings\/([^/]+)\/groups\/([^/]+)\/models$/);
  if (relayModelsMatch && request.method === "PUT") {
    if (user && user.role !== "admin") {
      return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    }
    try {
      const providerId = decodeURIComponent(relayModelsMatch[1] ?? "").trim();
      const groupId = decodeURIComponent(relayModelsMatch[2] ?? "").trim();
      const provider = await providerStore.get(providerId);
      if (!provider) return jsonResponse({ error: "Relay not found" }, 404, headers);
      const body = asRecord(await request.json().catch(() => ({})));
      const models = stringArrayValue(body.models, "models");
      // 兼容旧 default/free 分组：opencode-local 已收敛为 v1/v2，仅这两个旧 id
      // 写回 v1；其它未知 id 仍由 setRelayGroupModels 抛 Group not found（400）。
      const normalizedPutGroup = groupId.trim().toLowerCase();
      const effectiveGroupId = (providerId === OPENCODE_OFFICIAL_PROVIDER_ID || providerId === "opencode-local")
        && (normalizedPutGroup === "default" || normalizedPutGroup === "free")
        ? OPENCODE_V1_GROUP_ID
        : groupId;
      const saved = await providerStore.save(setRelayGroupModels(provider, effectiveGroupId, models));
      return jsonResponse({ data: relaySettingsView(saved) }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  if (url.pathname === "/api/codex/relay-settings/trashed" && request.method === "GET") {
    if (user && user.role !== "admin") {
      return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    }
    return jsonResponse({ data: (await providerStore.listTrashed()).map(relaySettingsListItem) }, 200, headers);
  }
  const relaySettingsMatch = url.pathname.match(/^\/api\/codex\/relay-settings\/([^/]+)$/);
  if (relaySettingsMatch && (request.method === "GET" || request.method === "PUT")) {
    if (user && user.role !== "admin") {
      return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
    }
    const providerId = decodeURIComponent(relaySettingsMatch[1] ?? "").trim();
    const existing = await providerStore.get(providerId);
    if (!existing) return jsonResponse({ error: "Relay not found" }, 404, headers);
    if (request.method === "GET") {
      return jsonResponse({ data: relaySettingsView(existing) }, 200, headers);
    }
    try {
      const body = asRecord(await request.json().catch(() => ({})));
      const bodyProviderId = stringValue(body.providerId)?.trim();
      if (bodyProviderId && bodyProviderId !== providerId) {
        return jsonResponse({ error: "providerId cannot be changed" }, 400, headers);
      }
      const saved = await providerStore.save(buildRelaySettingsProvider(body, existing));
      return jsonResponse({ data: relaySettingsView(saved) }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  if (url.pathname === "/api/codex/relay-settings" && request.method === "GET") {
    const allowedProviderIds = user && user.role !== "admin"
      ? new Set(securityStore.getAllowedProviders(user.id))
      : undefined;
    const providers = (await providerStore.list()).filter((provider) => !allowedProviderIds || allowedProviderIds.has(provider.id));
    return jsonResponse({ data: providers.map(relaySettingsListItem) }, 200, headers);
  }
  // 对外共享 (/v1 转发) 总开关: 默认关闭, 仅管理员可读写。
  if (url.pathname === "/api/codex/forward-settings" && (request.method === "GET" || request.method === "PUT")) {
    if (user && user.role !== "admin") {
      return jsonResponse({ error: "Admin only: forward settings" }, 403, headers);
    }
    if (request.method === "GET") {
      const enabled = isForwardSharingEnabled(userPreferencesStore.get(FORWARD_SETTINGS_OWNER));
      return jsonResponse({
        data: {
          enabled,
          baseUrl: `http://127.0.0.1:${PORT}/v1`,
          // 回环自用 key, 可明文展示 (中转站设置对外共享卡)。
          token: forwardToken,
        }
      }, 200, headers);
    }
    try {
      const body = asRecord(await request.json().catch(() => ({})));
      const enabled = body.enabled;
      if (typeof enabled !== "boolean") {
        return jsonResponse({ error: "enabled must be a boolean" }, 400, headers);
      }
      userPreferencesStore.patch(FORWARD_SETTINGS_OWNER, { forwardSharingEnabled: enabled });
      // 打开即自动生成/刷新本地转发中转站 (回环 baseUrl + 当前 token + 模型快照),
      // 免手动录入；关闭只停 /v1, 不删站。
      let forwardRelay: { providerId: string; modelCount: number } | null = null;
      if (enabled) {
        const baseUrl = `http://127.0.0.1:${PORT}/v1`;
        const inventory = await listForwardModelInventory();
        const modelIds = buildForwardModelIds(FORWARD_ACTIVE_CLIS, inventory);
        const existing = await providerStore.get(FORWARD_RELAY_PROVIDER_ID);
        const saved = await providerStore.saveTransient(
          buildForwardRelayProvider(baseUrl, forwardToken, modelIds, existing?.createdAt)
        );
        forwardRelay = { providerId: saved.id, modelCount: modelIds.length };
      }
      return jsonResponse({
        data: { enabled, baseUrl: `http://127.0.0.1:${PORT}/v1`, token: forwardToken, forwardRelay }
      }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) }, 400, headers);
    }
  }
  const route = `${request.method} ${url.pathname}`;
  // CLI plugin Settings toggles (R3): one generic route serves every
  // plugin that declares a toggle — adding a CLI never adds a route.
  const cliSettingsMatch = /^\/api\/codex\/settings\/([a-z0-9-]+)$/.exec(url.pathname);
  if (cliSettingsMatch && (request.method === "GET" || request.method === "PATCH")) {
    const pluginId = cliPluginIdForSettingsSlug(cliSettingsMatch[1]!);
    if (pluginId) {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: Codex settings" }, 403, headers);
      }
      if (request.method === "PATCH") {
        const rawBody = await request.json().catch(() => null);
        setCliPluginEnabled(pluginId, asRecord(rawBody).enabled === true);
      }
      return jsonResponse({ data: { settings: { enabled: isCliPluginEnabled(pluginId) } } }, 200, headers);
    }
  }
  switch (route) {
    case "GET /api/health":
      return jsonResponse({ ok: true, status: bridge.getStatus(), auth: Boolean(authStore) }, 200, headers);
    case "POST /api/claude-desktop/inject-relay": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: Claude Desktop injection" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.providerId)?.trim() ?? "";
        if (!providerId) return jsonResponse({ error: "providerId is required" }, 400, headers);
        const provider = await providerStore.get(providerId);
        if (!provider) return jsonResponse({ error: "Relay not found" }, 404, headers);
        if (provider.kind === "chatgpt") {
          return jsonResponse({ error: "Claude Desktop requires an API relay" }, 400, headers);
        }
        const requestedGroupId = stringValue(body.groupId)?.trim();
        const group = requestedGroupId
          ? provider.groups?.find((entry) => entry.id === requestedGroupId)
          : provider.groups?.find((entry) => entry.kind !== "image" && entry.status !== "disabled")
            ?? provider.groups?.find((entry) => entry.kind !== "image");
        if (!group || group.kind === "image") {
          return jsonResponse({ error: "Relay text group not found" }, 404, headers);
        }
        if (group.status === "disabled") {
          return jsonResponse({ error: "Relay group is disabled" }, 400, headers);
        }
        const requestedModels = Array.isArray(body.models)
          ? body.models.map((value) => stringValue(value)?.trim() ?? "").filter(Boolean)
          : [];
        const legacyModel = stringValue(body.model)?.trim();
        const models = [...new Set(requestedModels.length > 0
          ? requestedModels
          : legacyModel
            ? [legacyModel]
            : [group.models?.[0] || provider.defaultModel?.trim() || provider.nativeModels[0]?.trim() || ""].filter(Boolean))];
        if (models.length === 0) return jsonResponse({ error: "At least one relay model is required" }, 400, headers);
        const requestedMappings = asRecord(body.modelMappings);
        const modelMappings = Object.fromEntries(Object.entries(requestedMappings).flatMap(([sourceModel, claudeModel]) => {
          const normalizedSource = sourceModel.trim();
          const normalizedClaude = stringValue(claudeModel)?.trim();
          return normalizedSource && normalizedClaude && /(?:^|[./:_-])claude-(?:fable|haiku|sonnet|opus)(?:[./:_-]|$)/i.test(normalizedClaude.replace(/\[1m\]$/i, ""))
            ? [[normalizedSource, normalizedClaude] as const]
            : [];
        }));
        if (Object.keys(requestedMappings).length !== Object.keys(modelMappings).length) {
          return jsonResponse({ error: "Claude model mappings must target a Claude fable, haiku, sonnet, or opus model" }, 400, headers);
        }
        const injection = buildClaudeDesktopRelayInjection(models, modelMappings);
        const injectedAliases = new Set(injection.groupModelMappings.map((entry) => entry.from));
        const nextGroup = {
          ...group,
          models: [...new Set([...(group.models ?? []), ...injection.groupModelMappings.map((entry) => entry.from)])],
          modelMapping: [
            ...(group.modelMapping ?? []).filter((entry) => !injectedAliases.has(entry.from)),
            ...injection.groupModelMappings
          ]
        };
        await providerStore.save({
          ...provider,
          groups: (provider.groups ?? []).map((entry) => entry.id === group.id ? nextGroup : entry)
        });
        const baseUrl = `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}`;
        const requestedConfigLibraryDir = stringValue(body.configLibraryDir)?.trim();
        const result = await writeClaudeDesktopInference({
          baseUrl,
          token: relayGatewayToken,
          models: injection.desktopModels,
          configLibraryDir: requestedConfigLibraryDir || undefined
        });
        return jsonResponse({ data: { ...result, providerId: provider.id, groupId: group.id, models, desktopModels: injection.desktopModels, baseUrl } }, 200, headers);
      } catch (error) {
        if (error instanceof Error && /config library directory was not found/i.test(error.message)) {
          return jsonResponse({ error: errorToMessage(error), code: CLAUDE_DESKTOP_CONFIG_NOT_FOUND_CODE }, 404, headers);
        }
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/cursor/inject-relay": {
      if (!CURSOR_INJECTION_ENABLED) {
        return jsonResponse({ error: "Cursor injection is disabled" }, 404, headers);
      }
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: Cursor injection" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.providerId)?.trim() ?? "";
        if (!providerId) return jsonResponse({ error: "providerId is required" }, 400, headers);
        const provider = await providerStore.get(providerId);
        if (!provider) return jsonResponse({ error: "Relay not found" }, 404, headers);
        if (provider.kind === "chatgpt") {
          return jsonResponse({ error: "Cursor requires an API relay" }, 400, headers);
        }
        const requestedGroupId = stringValue(body.groupId)?.trim();
        const group = requestedGroupId
          ? provider.groups?.find((entry) => entry.id === requestedGroupId)
          : provider.groups?.find((entry) => entry.kind !== "image" && entry.status !== "disabled")
            ?? provider.groups?.find((entry) => entry.kind !== "image");
        if (!group || group.kind === "image") {
          return jsonResponse({ error: "Relay text group not found" }, 404, headers);
        }
        if (group.status === "disabled") {
          return jsonResponse({ error: "Relay group is disabled" }, 400, headers);
        }
        // Cursor local mode consumes the relay's native model ids directly, so
        // no Claude alias mapping is needed here.
        const models = [...new Set((group.models ?? provider.nativeModels)
          .map((model) => model.trim())
          .filter(Boolean))];
        if (models.length === 0) return jsonResponse({ error: "Relay text group has no models" }, 400, headers);
        const baseUrl = `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}`;
        // Installs outside %LOCALAPPDATA% are not auto-discovered; the client is
        // expected to prompt for the real directory and retry with installDir.
        const result = await writeCursorRelayLauncher({
          baseUrl,
          token: relayGatewayToken,
          installDir: stringValue(body.installDir)?.trim() || undefined
        });
        return jsonResponse({ data: { ...result, providerId: provider.id, groupId: group.id, models, baseUrl } }, 200, headers);
      } catch (error) {
        if (error instanceof CursorInstallDirNotFoundError) {
          return jsonResponse({ error: error.message, code: CURSOR_INSTALL_DIR_NOT_FOUND_CODE, searchedPath: error.searchedPath }, 404, headers);
        }
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/system-metrics": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH system metrics" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const cwd = normalizeRemotePath(stringValue(body.cwd) ?? "");
        return jsonResponse(await getSshSystemMetrics(parseSshCommand(command), cwd), 200, headers);
      } catch (error) {
        return jsonResponse({ error: sshConnectionErrorMessage(error) }, 502, headers);
      }
    }
    case "GET /api/ssh/config-hosts": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH config discovery" }, 403, headers);
      const force = url.searchParams.get("force") === "1";
      return jsonResponse({ data: await discoverSshConfigHosts({ force }) }, 200, headers);
    }
    case "POST /api/ssh/config-hosts/probe": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH config discovery" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const alias = stringValue(body.alias)?.trim() ?? "";
        if (!alias) return jsonResponse({ error: "SSH config host alias is required" }, 400, headers);
        return jsonResponse({ data: await probeSshConfigHost(alias) }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: sshConnectionErrorMessage(error) }, 502, headers);
      }
    }
    case "GET /api/codex/capabilities":
      return jsonResponse({
        data: {
          version: 1,
          transport: "http-long-poll",
          miniVersion: MINI_CODEX_VERSION,
          maxEventWaitMs: 30_000,
          sessionTtlMs: codexApiSessions.ttlMs,
          latestEventId: codexApiEvents.latestId(),
          engine: bridge.getStatus(),
          endpoints: {
            sessions: "/api/codex/sessions",
            relays: "/api/codex/relays",
            relayGroups: "/api/codex/relays/{providerId}/groups",
            relaySettings: "/api/codex/relay-settings/{providerId}",
            relayModelFetch: "/api/codex/relay-settings/{providerId}/groups/{groupId}/models/fetch",
            relayModels: "/api/codex/relay-settings/{providerId}/groups/{groupId}/models",
            multiAgentV2Settings: "/api/codex/settings/multi-agent-v2",
            ...cliSettingsLinks(),
            agentsReadiness: "/api/codex/agents/readiness",
            providerActivation: "/api/codex/provider/activate",
            planStart: "/api/codex/plan/start",
            planRespond: "/api/codex/plan/respond",
            serverRequestRespond: "/api/codex/server-request/respond",
            goalStart: "/api/codex/goal/start",
            goalPause: "/api/codex/goal/pause",
            goalResume: "/api/codex/goal/resume",
            workbenchState: "/api/codex/workbench/state",
            workbenchThreads: "/api/codex/workbench/threads",
            workbenchSend: "/api/codex/workbench/send",
            workbenchStop: "/api/codex/workbench/stop",
            workbenchRuntime: "/api/codex/workbench/runtime",
            workbenchViewActivate: "/api/codex/workbench/view/activate",
            workbenchLayout: "/api/codex/workbench/layout",
            workbenchHistory: "/api/codex/workbench/history",
            workbenchHistoryOpen: "/api/codex/workbench/history/open",
            threadUsage: "/api/thread-usage?threadId={threadId}",
            rpc: "/api/codex/rpc",
            events: "/api/codex/events",
            watch: "/api/codex/watch",
            diagnostics: "/api/codex/diagnostics",
            cleanGarbage: "/api/codex/system/clean-garbage",
            freebuffSession: "/api/codex/freebuff/session",
            freebuffSessionRelease: "/api/codex/freebuff/session/release",
            serverResponse: "/api/codex/server-response"
          }
        }
      }, 200, headers);
    case "POST /api/codex/sessions": {
      const session = codexApiSessions.create(codexApiOwnerId(user));
      return jsonResponse({
        data: {
          sessionId: session.id,
          cursor: codexApiEvents.latestId(),
          expiresInMs: codexApiSessions.ttlMs
        }
      }, 201, headers);
    }
    case "GET /api/codex/relays": {
      const allowedProviderIds = user && user.role !== "admin"
        ? new Set(securityStore.getAllowedProviders(user.id))
        : undefined;
      return jsonResponse({
        data: createRelayDirectory(visibleProviders(await providerStore.list()), allowedProviderIds)
      }, 200, headers);
    }
    case "GET /api/codex/settings/multi-agent-v2":
    case "PATCH /api/codex/settings/multi-agent-v2": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: Codex settings" }, 403, headers);
      }
      if (request.method === "PATCH") {
        const rawBody = await request.json().catch(() => null);
        const settings = multiAgentV2SettingsPatch(rawBody);
        await bridge.request("config/batchWrite", {
          edits: Object.entries(settings).map(([key, value]) => ({
            keyPath: key === "default_subagent_model" || key === "default_subagent_reasoning_effort"
              ? `agents.${key}`
              : `features.multi_agent_v2.${key}`,
            value,
            mergeStrategy: "replace" as const
          })),
          reloadUserConfig: true
        }, 120_000);
      }
      const result = await bridge.request("config/read", { includeLayers: false });
      return jsonResponse({ data: { settings: multiAgentV2SettingsFromConfigRead(result) } }, 200, headers);
    }
    case "GET /api/codex/agents/readiness":
    case "POST /api/codex/agents/readiness": {
      const body = request.method === "POST" ? asRecord(await request.json().catch(() => ({}))) : {};
      let config: JsonValue | undefined;
      let configError: string | null = null;
      try {
        config = (await bridge.request("config/read", { includeLayers: false }, 20_000)) as JsonValue;
      } catch (error) {
        configError = errorToMessage(error);
      }
      const engine = bridge.getStatus();
      // Older installations may have a valid virtual config but no generated
      // V2 catalog. Rebuild it from the currently configured relay/model so
      // readiness reflects the actual runtime instead of a stale ENOENT.
      if (!body.skipCatalogRepair) {
        const homes = collectLocalCodexHomes();
        for (const home of homes) {
          await repairAgentModelCatalog(home, config, {
            providerId: stringValue(body.providerId),
            groupId: stringValue(body.groupId),
            model: stringValue(body.model)
          }).catch((error) => {
            console.warn(`[agents] failed to repair model catalog at ${home}`, error);
          });
          const expectedCatalog = join(home, CODEX_ULTRA_MODEL_CATALOG_FILE);
          if (!existsSync(expectedCatalog)) {
            console.warn(`[codex-catalog] WARNING: Model catalog missing at ${expectedCatalog}; Codex app-server will fall back to built-in models with code_mode_only.`);
          }
        }
        if (engine.codexHome) {
          const configuredCatalogPath = stringValue(asRecord(config ? asRecord(config).config : undefined).model_catalog_json)?.trim();
          const expectedCatalogPath = join(engine.codexHome, CODEX_ULTRA_MODEL_CATALOG_FILE);
          if (configuredCatalogPath !== expectedCatalogPath && existsSync(expectedCatalogPath)) {
            await bridge.request("config/value/write", {
              keyPath: "model_catalog_json",
              value: expectedCatalogPath,
              mergeStrategy: "replace"
            }, PROVIDER_CONFIG_WRITE_TIMEOUT_MS);
            config = (await bridge.request("config/read", { includeLayers: false }, 20_000)) as JsonValue;
          }
        }
      }
      const catalogPath = typeof engine.codexHome === "string" && engine.codexHome.trim()
        ? join(engine.codexHome, CODEX_ULTRA_MODEL_CATALOG_FILE)
        : null;
      const catalogResult = catalogPath ? await readAgentModelCatalog(catalogPath) : { catalog: null, error: "Codex home is unavailable" };
      const payload = diagnoseAgentReadiness({
        agentMode: body.agentMode === "enabled" || body.agentMode === "disabled" || body.agentMode === "inherit" ? body.agentMode : "inherit",
        config: config ? asRecord(config).config : undefined,
        configError,
        appServerReady: engine.phase === "ready",
        model: stringValue(body.model),
        reasoningEffort: stringValue(body.reasoningEffort),
        childCount: body.childCount === null ? null : numberValue(body.childCount),
        roles: Array.isArray(body.roles) ? body.roles.filter((role): role is Record<string, unknown> => Boolean(role && typeof role === "object")).map((role) => ({
          enabled: typeof role.enabled === "boolean" ? role.enabled : undefined,
          name: stringValue(role.name),
          model: stringValue(role.model),
          reasoningEffort: stringValue(role.reasoningEffort)
        })) : [],
        threadRunning: body.threadRunning === true,
        catalog: catalogResult.catalog
      });
      payload.checks = { ...payload.checks, appServerPhase: engine.phase, codexHome: engine.codexHome ?? null, configPath: resolveVirtualCodexConfigPath(), catalogPath, catalogError: catalogResult.error };
      return jsonResponse({ data: payload }, payload.ready ? 200 : 409, headers);
    }
    case "POST /api/codex/relay-settings": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: relay settings" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const requestedId = stringValue(body.providerId)?.trim() ?? stringValue(body.id)?.trim() ?? "";
        if (requestedId && await providerStore.get(requestedId)) {
          return jsonResponse({ error: `Relay already exists: ${requestedId}` }, 409, headers);
        }
        const saved = await providerStore.save(buildRelaySettingsProvider(body, null));
        return jsonResponse({ data: relaySettingsView(saved) }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/codex/provider/activate": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const providerId = stringValue(body.providerId)?.trim() ?? "";
      const model = stringValue(body.model)?.trim() || undefined;
      const groupId = stringValue(body.groupId)?.trim() || undefined;
      if (!providerId) return jsonResponse({ error: "providerId is required" }, 400, headers);
      if (user && user.role !== "admin" && !securityStore.isProviderAllowed(user.id, providerId, false)) {
        return jsonResponse({ error: "Relay not assigned to this member" }, 403, headers);
      }
      const activation = await runProviderActivationExclusive(() => activateProvider(providerId, model, groupId));
      return jsonResponse({ data: { sessionId: session.id, activation } }, 200, headers);
    }
    case "POST /api/codex/rpc": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const method = stringValue(body.method)?.trim() ?? "";
      if (!method || method.length > 256) return jsonResponse({ error: "A valid Codex RPC method is required" }, 400, headers);
      const params = body.params === undefined ? undefined : body.params as JsonValue;
      try {
        const result = await executeCodexRpc({ user, clientId: session.clientId, method, params });
        return jsonResponse({ data: { sessionId: session.id, result } }, 200, headers);
      } catch (error) {
        const rpcParams = asRecord(params);
        const workspace = asRecord(rpcParams.workspace);
        const errThreadId = stringValue(rpcParams.threadId);
        // The WS path (below) derives this honestly; the HTTP path used to
        // hardcode "remote-bun" for everything, mislabeling local spawn
        // failures. Mirror the WS derivation so the stable code names the
        // real execution site.
        const execution = errThreadId && remoteThreadRouteStore.get(errThreadId)
          ? "remote-bun"
          : workspace.type === "ssh" || sshProfileFromParams(params) || (errThreadId && sshWorkspaceStore.get(errThreadId))
          ? "ssh"
          : "local";
        const detail = detailedRpcError(error, { execution, method, stage: method === "thread/start" ? "create-thread" : method === "turn/start" ? "start-turn" : "rpc", threadId: stringValue(rpcParams.threadId), providerId: stringValue(rpcParams.modelProvider) ?? stringValue(workspace.providerId), groupId: stringValue(workspace.groupId) });
        return jsonResponse({ error: detail.message, data: detail.data }, detail.code === 401 ? 401 : 500, headers);
      }
    }
    case "POST /api/codex/plan/start": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const result = await executeCodexRpc({
        user,
        clientId: session.clientId,
        method: "turn/start",
        params: planTurnParams(body)
      });
      return jsonResponse({ data: { sessionId: session.id, result } }, 200, headers);
    }
    case "POST /api/codex/plan/respond": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const requestId = typeof body.requestId === "string" || typeof body.requestId === "number" ? body.requestId : null;
      if (requestId === null) return jsonResponse({ error: "requestId is required" }, 400, headers);
      const requestEvent = codexApiEvents.findLatest((event) =>
        event.kind === "serverRequest"
        && asRecord(event.payload).id === requestId
        && asRecord(event.payload).method === "item/tool/requestUserInput"
      );
      if (!requestEvent || !canReadCodexApiEvent(user, requestEvent)) {
        return jsonResponse({ error: "Plan user-input request not found" }, 404, headers);
      }
      respondToCodexServerRequest(requestId, planAnswers(body));
      return jsonResponse({ data: { sessionId: session.id, accepted: true } }, 202, headers);
    }
    // Answers any server request this node raised, not just Plan input. An
    // autonomous remote thread has no UI of its own: approvals reach the
    // operator through the event journal, so the reply has to come back in.
    case "POST /api/codex/server-request/respond": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const requestId = typeof body.requestId === "string" || typeof body.requestId === "number" ? body.requestId : null;
      if (requestId === null) return jsonResponse({ error: "requestId is required" }, 400, headers);
      const requestEvent = codexApiEvents.findLatest((event) =>
        event.kind === "serverRequest" && asRecord(event.payload).id === requestId
      );
      if (!requestEvent || !canReadCodexApiEvent(user, requestEvent)) {
        return jsonResponse({ error: "Server request not found" }, 404, headers);
      }
      const failure = asRecord(body.error);
      const errorMessage = stringValue(failure.message);
      respondToCodexServerRequest(
        requestId,
        errorMessage ? undefined : (body.result ?? {}) as JsonValue,
        errorMessage ? { message: errorMessage, ...(failure.code === undefined ? {} : { code: Number(failure.code) }) } : undefined
      );
      return jsonResponse({ data: { sessionId: session.id, accepted: true } }, 202, headers);
    }
    case "POST /api/codex/goal/start": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      const objective = stringValue(body.objective)?.trim() ?? "";
      if (!threadId || !objective) return jsonResponse({ error: "threadId and objective are required" }, 400, headers);
      const result = await executeCodexRpc({
        user,
        clientId: session.clientId,
        method: "thread/goal/set",
        params: { threadId, objective, status: "active" }
      });
      return jsonResponse({ data: { sessionId: session.id, result } }, 200, headers);
    }
    case "POST /api/codex/goal/pause": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      const turns = await readWorkbenchTurns(user, session.clientId, threadId);
      const interruptedTurnIds: string[] = [];
      for (const turnId of runningTurnIds(turns)) {
        await executeCodexRpc({ user, clientId: session.clientId, method: "turn/interrupt", params: { threadId, turnId } });
        interruptedTurnIds.push(turnId);
      }
      const result = await executeCodexRpc({
        user,
        clientId: session.clientId,
        method: "thread/goal/set",
        params: { threadId, status: "paused" }
      });
      return jsonResponse({ data: { sessionId: session.id, interruptedTurnIds, result } }, 200, headers);
    }
    case "POST /api/codex/goal/resume": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      const current = await executeCodexRpc({ user, clientId: session.clientId, method: "thread/goal/get", params: { threadId } });
      const goal = goalFromResult(current);
      const objective = stringValue(goal?.objective)?.trim() ?? "";
      if (!objective) return jsonResponse({ error: "No goal is available to resume" }, 409, headers);
      const turn = await executeCodexRpc({
        user,
        clientId: session.clientId,
        method: "turn/start",
        params: goalContinuationTurnParams(body, objective)
      });
      const result = await executeCodexRpc({
        user,
        clientId: session.clientId,
        method: "thread/goal/set",
        params: { threadId, status: "active" }
      });
      return jsonResponse({ data: { sessionId: session.id, turn, result } }, 200, headers);
    }
    case "GET /api/codex/workbench/state": {
      const session = requireCodexApiSession(request, url, {}, user);
      const ownerId = user?.id ?? "local";
      const threadId = url.searchParams.get("threadId")?.trim() ?? "";
      const runtime = threadId ? threadRuntimeMetadataStore.get(ownerId, threadId) : null;
      const tokenEvent = threadId ? codexApiEvents.findLatest((event) => {
        const payload = asRecord(event.payload);
        return event.kind === "notification"
          && payload.method === "thread/tokenUsage/updated"
          && stringValue(asRecord(payload.params).threadId) === threadId;
      }) : null;
      const tokenPayload = tokenEvent ? asRecord(tokenEvent.payload) : {};
      return jsonResponse({ data: {
        sessionId: session.id,
        threadId: threadId || null,
        runtime,
        context: contextUsageView(asRecord(tokenPayload.params).tokenUsage),
        preferences: userPreferencesStore.get(ownerId)
      } }, 200, headers);
    }
    case "GET /api/codex/workbench/history": {
      const session = requireCodexApiSession(request, url, {}, user);
      const cursor = url.searchParams.get("cursor")?.trim() || null;
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 20) || 20));
      const archived = url.searchParams.get("archived") === "1";
      const result = await executeCodexRpc({
        user,
        clientId: session.clientId,
        method: "thread/list",
        params: { cursor, limit, archived, sourceKinds: ["cli", "vscode", "exec", "appServer"], modelProviders: [] }
      });
      return jsonResponse({ data: { sessionId: session.id, result: mergeSshWorkspaceThreads(result, user?.id ?? "local") } }, 200, headers);
    }
    case "POST /api/codex/workbench/history/open": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      assertWorkbenchThreadAccess(threadId, user);
      const progress: Array<{ progress: number; stage: string; elapsedMs: number }> = [];
      const startedAt = performance.now();
      const mark = (value: number, stage: string) => progress.push({ progress: value, stage, elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100 });
      // Reading a stored history is intentionally read-only. A Codex
      // thread/resume keeps the thread materialized in the app-server for up
      // to thirty minutes, so an implicit resume for every history click can
      // grow both the app-server and UI service to gigabytes. Callers that
      // need live notifications can opt in explicitly and use /watch.
      const subscribe = body.subscribe === true;
      let watching = false;
      try {
        mark(8, "queued");
        if (subscribe) {
          subscriptionRegistry.watch(threadId, session.clientId);
          watching = true;
          mark(18, "watching");
        } else {
          mark(18, "read-only");
        }
        const metadata = await readWorkbenchThreadMetadata(user, session.clientId, threadId);
        mark(52, "metadata-loaded");
        const page = await readWorkbenchTurnsPage(user, session.clientId, threadId, null, metadata);
        mark(86, "history-loaded");
        mark(100, "completed");
        return jsonResponse({ data: { sessionId: session.id, threadId, itemsView: "summary", subscription: subscribe ? "scoped" : "read-only", progress, metadata, page } }, 200, headers);
      } catch (error) {
        mark(100, "failed");
        return jsonResponse({ error: errorToMessage(error), data: { sessionId: session.id, threadId, progress } }, 500, headers);
      } finally {
        if (watching) subscriptionRegistry.unwatch(threadId, session.clientId);
      }
    }
    case "POST /api/codex/workbench/threads": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      applyWorkbenchCwd(body, user);
      const pendingRuntime = parseWorkbenchRuntime({ ...body, threadId: "pending" });
      const started = await withWorkbenchRuntime(pendingRuntime, user, async (activation) => {
        const runtime = { ...pendingRuntime, model: activation.model ?? pendingRuntime.model };
        const result = await executeCodexRpc({
          user,
          clientId: session.clientId,
          method: "thread/start",
          params: workbenchThreadStartParams(body, runtime, activation.modelProvider)
        });
        return { result, runtime };
      });
      const { result, runtime: activatedRuntime } = started;
      const threadId = extractThreadId(result);
      if (!threadId) throw new Error("thread/start did not return a thread id");
      const runtime = threadRuntimeMetadataStore.put(user?.id ?? "local", { ...activatedRuntime, threadId });
      notifyWorkbenchControl(user, { action: "runtime", threadId, runtime: runtime as unknown as JsonValue });
      return jsonResponse({ data: { sessionId: session.id, threadId, thread: result, runtime } }, 201, headers);
    }
    case "POST /api/codex/workbench/send": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      applyWorkbenchCwd(body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      assertWorkbenchThreadAccess(threadId, user);
      const stored = threadId ? threadRuntimeMetadataStore.get(user?.id ?? "local", threadId) : null;
      const runtime = parseWorkbenchRuntime(body, stored ?? undefined);
      const turnParams = workbenchTurnStartParams(body, runtime);
      const turns = await readWorkbenchTurns(user, session.clientId, threadId);
      const runningTurnId = runningTurnIds(turns)[0];
      const method = runningTurnId ? "turn/steer" : "turn/start";
      const turnInput = turnParams.input;
      if (!turnInput) throw new Error("Turn input is required");
      const params: JsonValue = runningTurnId
        ? { threadId, expectedTurnId: runningTurnId, input: turnInput }
        : turnParams;
      const result = await withWorkbenchRuntime(runtime, user, async (activation) => {
        const activatedParams = method === "turn/start" && activation.model
          ? {
              ...asRecord(params),
              model: activation.model,
              ...(activation.modelProvider ? { modelProvider: activation.modelProvider } : {})
            }
          : params;
        return await executeCodexRpc({ user, clientId: session.clientId, method, params: activatedParams });
      });
      return jsonResponse({ data: { sessionId: session.id, threadId, mode: runningTurnId ? "steer" : "start", result } }, 200, headers);
    }
    case "POST /api/codex/workbench/stop": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      assertWorkbenchThreadAccess(threadId, user);
      const turns = await readWorkbenchTurns(user, session.clientId, threadId);
      const interruptedTurnIds: string[] = [];
      for (const turnId of runningTurnIds(turns)) {
        await executeCodexRpc({ user, clientId: session.clientId, method: "turn/interrupt", params: { threadId, turnId } });
        interruptedTurnIds.push(turnId);
      }
      return jsonResponse({ data: { sessionId: session.id, threadId, interruptedTurnIds } }, 200, headers);
    }
    case "PUT /api/codex/workbench/runtime": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      assertWorkbenchThreadAccess(threadId, user);
      const stored = threadId ? threadRuntimeMetadataStore.get(user?.id ?? "local", threadId) : null;
      const runtime = parseWorkbenchRuntime(body, stored ?? undefined);
      const activation = await withWorkbenchRuntime(runtime, user, async (value) => value);
      const saved = threadRuntimeMetadataStore.put(user?.id ?? "local", {
        ...runtime,
        model: activation.model ?? runtime.model
      });
      if (authStore && user) authStore.claimThread(threadId, user.id);
      notifyWorkbenchControl(user, { action: "runtime", threadId, runtime: saved as unknown as JsonValue });
      return jsonResponse({ data: { sessionId: session.id, runtime: saved } }, 200, headers);
    }
    case "POST /api/codex/workbench/view/activate": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      const paneId = stringValue(body.paneId)?.trim() || null;
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      assertWorkbenchThreadAccess(threadId, user);
      notifyWorkbenchControl(user, { action: "activate", threadId, paneId });
      return jsonResponse({ data: { sessionId: session.id, threadId, paneId } }, 202, headers);
    }
    case "PUT /api/codex/workbench/layout": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const currentLayout = userPreferencesStore.get(user?.id ?? "local").workspaceLayout;
      const layout = applyWorkbenchLayoutAction(currentLayout, body);
      for (const threadId of workbenchLayoutThreadIds(layout)) assertWorkbenchThreadAccess(threadId, user);
      const preferences = userPreferencesStore.patch(user?.id ?? "local", {
        workspaceLayout: layout,
        splitView: null
      });
      notifyWorkbenchControl(user, { action: "layout", workspaceLayout: layout });
      return jsonResponse({ data: { sessionId: session.id, workspaceLayout: layout, preferences } }, 200, headers);
    }
    case "POST /api/codex/watch":
    case "DELETE /api/codex/watch": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      if (authStore && user && user.role !== "admin" && !authStore.ownsThread(threadId, user.id)) {
        return jsonResponse({ error: "Thread belongs to another member" }, 403, headers);
      }
      if (request.method === "POST") subscriptionRegistry.watch(threadId, session.clientId);
      else subscriptionRegistry.unwatch(threadId, session.clientId);
      return jsonResponse({ data: { sessionId: session.id, threadId, watching: request.method === "POST" } }, 200, headers);
    }
    case "GET /api/codex/events": {
      const session = requireCodexApiSession(request, url, {}, user);
      const afterId = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
      const waitMs = Math.max(0, Math.min(30_000, Number(url.searchParams.get("waitMs") ?? 0) || 0));
      const limit = Math.max(1, Math.min(1_024, Number(url.searchParams.get("limit") ?? 256) || 256));
      const threadId = url.searchParams.get("threadId")?.trim() || null;
      const predicate = (event: CodexApiEvent) =>
        canReadCodexApiEvent(user, event)
        && (!threadId || codexApiEventThreadIds(event).includes(threadId) || event.kind === "engineStatus");
      const events = await codexApiEvents.wait(afterId, predicate, waitMs, limit);
      return jsonResponse({
        data: {
          sessionId: session.id,
          events,
          latestEventId: codexApiEvents.latestId()
        }
      }, 200, headers);
    }
    case "GET /api/codex/diagnostics": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: Codex API diagnostics" }, 403, headers);
      }
      const processMemory = process.memoryUsage();
      return jsonResponse({
        data: {
          capturedAt: Date.now(),
          engine: bridge.getStatus(),
          events: { latestId: codexApiEvents.latestId() },
          memory: {
            server: {
              rssBytes: processMemory.rss,
              heapTotalBytes: processMemory.heapTotal,
              heapUsedBytes: processMemory.heapUsed,
              externalBytes: processMemory.external,
              arrayBuffersBytes: processMemory.arrayBuffers
            },
            application: await getApplicationMetrics(url.searchParams.get("refreshApplication") === "1")
          },
          subscriptions: subscriptionRegistry.diagnostics(),
          activeTurnsByUser: Object.fromEntries(
            [...activeTurnsByUser].map(([userId, turns]) => [userId, turns.size])
          )
        }
      }, 200, headers);
    }
    case "POST /api/codex/server-response": {
      const body = asRecord(await request.json().catch(() => ({})));
      const session = requireCodexApiSession(request, url, body, user);
      const requestId = typeof body.requestId === "string" || typeof body.requestId === "number" ? body.requestId : null;
      if (requestId === null) return jsonResponse({ error: "requestId is required" }, 400, headers);
      const requestEvent = codexApiEvents.findLatest((event) => {
        if (event.kind !== "serverRequest") return false;
        return asRecord(event.payload).id === requestId;
      });
      if (!requestEvent || !canReadCodexApiEvent(user, requestEvent)) {
        return jsonResponse({ error: "Server request not found for this API session" }, 404, headers);
      }
      const errorRecord = asRecord(body.error);
      const errorMessage = stringValue(errorRecord.message);
      respondToCodexServerRequest(
        requestId,
        body.result as JsonValue | undefined,
        errorMessage ? {
          code: typeof errorRecord.code === "number" ? errorRecord.code : undefined,
          message: errorMessage,
          data: errorRecord.data as JsonValue | undefined
        } : undefined
      );
      return jsonResponse({ data: { sessionId: session.id, accepted: true } }, 202, headers);
    }
    case "POST /api/codex/system/clean-garbage": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: garbage cleaner" }, 403, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const result = await cleanDataGarbage({
        dataDir: localDatabase.dir,
        sessionRetentionDays: typeof body.sessionRetentionDays === "number" ? body.sessionRetentionDays : undefined,
        backupRetentionHours: typeof body.backupRetentionHours === "number" ? body.backupRetentionHours : undefined,
        cleanFileHistoryBackup: Boolean(body.cleanFileHistoryBackup),
        fileHistoryBackupPath: typeof body.fileHistoryBackupPath === "string" ? body.fileHistoryBackupPath : undefined,
        dryRun: Boolean(body.dryRun)
      });
      return jsonResponse({ data: result }, 200, headers);
    }
    case "GET /api/codex/system/clean-garbage": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: garbage cleaner" }, 403, headers);
      }
      const result = await cleanDataGarbage({
        dataDir: localDatabase.dir,
        dryRun: true
      });
      return jsonResponse({ data: result }, 200, headers);
    }
    case "GET /api/diagnostics/relay-tools": {
      if (process.env.CODEX_UI_RELAY_TOOL_DIAGNOSTICS !== "1") {
        return jsonResponse({ error: "Relay tool diagnostics are disabled" }, 404, headers);
      }
      const afterId = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
      return jsonResponse(listRelayToolDiagnostics(afterId), 200, headers);
    }
    case "POST /api/runtime/performance-report": {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
        return jsonResponse({ error: "Performance report is too large" }, 413, headers);
      }
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 64 * 1024) {
        return jsonResponse({ error: "Performance report is too large" }, 413, headers);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return jsonResponse({ error: "Invalid performance report JSON" }, 400, headers);
      }
      const report = sanitizeLowFpsPerformanceReport(parsed);
      if (!report) {
        return jsonResponse({ error: "Invalid performance report" }, 400, headers);
      }
      console.warn(`[performance] renderer-low-fps ${JSON.stringify({ receivedAt: new Date().toISOString(), ...report })}`);
      return jsonResponse({ recorded: true }, 202, headers);
    }
    case "GET /api/preferences":
      return jsonResponse({ data: userPreferencesStore.get(user?.id ?? "local") }, 200, headers);
    case "PATCH /api/preferences": {
      const body = asRecord(await request.json().catch(() => ({})));
      return jsonResponse({ data: userPreferencesStore.patch(user?.id ?? "local", body as Record<string, JsonValue>) }, 200, headers);
    }
    case "GET /api/ws/stats":
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: WebSocket stats" }, 403, headers);
      }
      return jsonResponse(webSocketStats(), 200, headers);
    case "GET /api/engine/status":
      return jsonResponse(bridge.getStatus(), 200, headers);
    case "POST /api/engine/start":
      logCodexConfigHealth(ensureCodexConfigHealthy(), "engine start");
      return jsonResponse(await bridge.start(), 200, headers);
    case "POST /api/ssh/remote-node/probe": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote Bun Server" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const remotePort = optionalRemoteNodePort(body.remotePort);
        return jsonResponse({ data: await probeRemoteBunNode(command, remotePort) }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/codex/cli-update/status": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: Codex CLI update status" }, 403, headers);
      try {
        return jsonResponse({ data: await checkLocalCodexCliUpdateStatus() }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/codex/cli-update/probe": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: Codex CLI update" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        return jsonResponse({ data: command ? await probeSshCodexCliUpdate(command) : await probeLocalCodexCliUpdate() }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/codex/cli-update/apply": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: Codex CLI update" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        if (body.confirm !== true) return jsonResponse({ error: "Explicit confirmation is required before updating Codex CLI" }, 409, headers);
        if ([...activeTurnsByUser.values()].some((turns) => turns.size > 0)) return jsonResponse({ error: "Codex CLI cannot be updated while turns are active" }, 409, headers);
        const command = stringValue(body.command)?.trim() ?? "";
        const result = command ? await updateSshCodexCli(command) : await updateLocalCodexCli();
        if (command) {
          for (const [key, remote] of sshBridges) { if (remote.profile.command === command) { remote.stop(); sshBridges.delete(key); } }
          for (const [threadId, remote] of remoteBunThreadBridges) { if (remote.route.command === command) { remote.stop(); remoteBunThreadBridges.delete(threadId); } }
        } else {
          await bridge.restart();
        }
        return jsonResponse({ data: result }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "GET /api/cli/installations": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: CLI installations" }, 403, headers);
      try {
        const kinds = parseRequestedCliKinds(url.searchParams.get("kinds"));
        if (kinds.includes("opencode")) {
          void refreshOpencodeModelsBackground();
        }
        await Promise.allSettled(kinds.map((kind) => ensureCliInstallationsCached(kind)));
        const data: Record<string, unknown> = {
        };
        if (kinds.includes("codex")) data.codex = buildCliKindStatus("codex", findCodexBinary(), getCachedCliInstallations("codex"));
        if (kinds.includes("claude")) data.claude = buildCliKindStatus("claude", findClaudeBin(), getCachedCliInstallations("claude"));
        if (kinds.includes("agy")) data.agy = buildCliKindStatus("agy", findAgyBin(), getCachedCliInstallations("agy"));
        if (kinds.includes("auggie")) data.auggie = buildCliKindStatus("auggie", findAuggieBin() ?? "", getCachedCliInstallations("auggie"));
        if (kinds.includes("cline")) data.cline = buildCliKindStatus("cline", findClineBin() ?? "", getCachedCliInstallations("cline"));
        if (kinds.includes("command-code")) data["command-code"] = buildCliKindStatus("command-code", findCommandCodeBin() ?? "", getCachedCliInstallations("command-code"));
        if (kinds.includes("grok")) data.grok = buildCliKindStatus("grok", findGrokBin(), getCachedCliInstallations("grok"));
        if (kinds.includes("muse")) data.muse = buildCliKindStatus("muse", findMuseBin(), getCachedCliInstallations("muse"));
        if (kinds.includes("pi")) data.pi = buildCliKindStatus("pi", findPiBin(), getCachedCliInstallations("pi"));
        if (kinds.includes("opencode")) data.opencode = buildCliKindStatus("opencode", findOpencodeBin(), getCachedCliInstallations("opencode"));
        if (kinds.includes("opencode-v2")) data["opencode-v2"] = buildCliKindStatus("opencode-v2", findOpencodeV2Bin(), getCachedCliInstallations("opencode-v2"));
        return jsonResponse({ data }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "GET /api/plugins": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: plugin catalog" }, 403, headers);
      try {
        return jsonResponse({ data: { plugins: pluginCatalog() } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/plugins/install":
    case "POST /api/plugins/uninstall": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: plugin management" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const id = stringValue(body.id)?.trim() ?? "";
        if (!id) return jsonResponse({ error: "plugin id is required" }, 400, headers);
        const plugins = setPluginInstalled(id, route === "POST /api/plugins/install");
        return jsonResponse({ data: { plugins } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "GET /api/opencode/models": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: opencode models" }, 403, headers);
      try {
        const bin = findOpencodeBin();
        const probe = probeOpencodeCliCommand(bin);
        // v2 走独立二进制 (`opencode2`),`--verbose` 在 v2 不存在, 始终用 plain 解析。
        const v2bin = findOpencodeV2Bin();
        const v2probe = v2bin ? probeOpencodeCliCommand(v2bin) : { available: false, binPath: "", error: "OpenCode v2 CLI not found" as string | undefined };
        const v2models = v2probe.available ? await listOpencodeModelsAsync(v2bin, process.env, 30_000) : [];
        const v2data = { v2bin, v2Available: v2probe.available, v2Version: v2probe.available ? v2probe.version : undefined, v2Models: v2models, ...(v2probe.available ? {} : { v2Error: v2probe.error ?? "OpenCode v2 CLI not found" }) };
        if (!probe.available) {
          return jsonResponse({ data: { bin, available: false, models: [], details: [], error: probe.error ?? "OpenCode CLI not found", ...v2data } }, 200, headers);
        }
        const verbose = url.searchParams.get("verbose") !== "0" && url.searchParams.get("verbose") !== "false";
        if (verbose) {
          const details = await listOpencodeModelDetailsAsync(bin, process.env, 30_000);
          return jsonResponse({ data: { bin, available: true, version: probe.version, models: details.map((d) => d.id), details, ...v2data } }, 200, headers);
        }
        const models = await listOpencodeModelsAsync(bin, process.env, 30_000);
        return jsonResponse({ data: { bin, available: true, version: probe.version, models, ...v2data } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/cli/select": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: CLI selection" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const backend = stringValue(body.backend);
        // Selectable backends come from the plugin registry (R3): any
        // registered plugin whose discovery declares a preference key.
        const selectable = serverPluginRegistry.list().filter((plugin) => plugin.discovery.preferredPathPrefKey);
        if (!selectable.some((plugin) => plugin.manifest.id === backend)) {
          return jsonResponse({ error: `backend must be one of: ${selectable.map((plugin) => plugin.manifest.id).join(", ")}` }, 400, headers);
        }
        const requestedPath = stringValue(body.path)?.trim() ?? "";
        if (requestedPath && !existsSync(requestedPath)) {
          return jsonResponse({ error: `CLI binary not found: ${requestedPath}` }, 400, headers);
        }
        setPreferredCliBinary(backend as CliSelectionKind, requestedPath || null);
        userPreferencesStore.patch(user?.id ?? "local", {
          [cliDiscoveryForKind(backend as CliSelectionKind).preferredPathPrefKey!]: requestedPath || null,
        });
        return jsonResponse({ data: { accepted: true } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/ssh/remote-node/install": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote Bun Server" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        if (body.confirm !== true) return jsonResponse({ error: "Explicit confirmation is required before installing the remote Bun Server" }, 409, headers);
        const result = await installRemoteBunNode({
          command: stringValue(body.command)?.trim() ?? "",
          remotePort: optionalRemoteNodePort(body.remotePort),
          artifactPath: stringValue(body.artifactPath)?.trim(),
          installBun: body.installBun === true,
          // Omitted means "follow the host": enable the Claude backend when the
          // remote host actually has the CLI. Both flags stay tri-state so an
          // omitted value never reads as an explicit "no".
          ...(body.enableClaude === undefined ? {} : { enableClaude: body.enableClaude === true }),
          ...(body.installClaude === undefined ? {} : { installClaude: body.installClaude === true })
        });
        return jsonResponse({ data: result }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/remote-node/tunnels": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote Bun Server" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const result = await openRemoteBunNodeTunnel(
          stringValue(body.command)?.trim() ?? "",
          optionalRemoteNodePort(body.remotePort)
        );
        return jsonResponse({ data: result }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "DELETE /api/ssh/remote-node/tunnels": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote Bun Server" }, 403, headers);
      const body = asRecord(await request.json().catch(() => ({})));
      const tunnelId = stringValue(body.tunnelId)?.trim() ?? "";
      return jsonResponse({ data: { tunnelId, closed: closeRemoteBunNodeTunnel(tunnelId) } }, 200, headers);
    }
    case "POST /api/ssh/remote-node/relay-sync": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote relay synchronization" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        if (body.confirm !== true) return jsonResponse({ error: "Explicit confirmation is required before copying a relay credential to the SSH host" }, 409, headers);
        const tunnelId = stringValue(body.tunnelId)?.trim() ?? "";
        const providerId = stringValue(body.providerId)?.trim() ?? "";
        const groupId = stringValue(body.groupId)?.trim() ?? "";
        if (!providerId || !groupId) return jsonResponse({ error: "providerId and groupId are required" }, 400, headers);
        const result = await syncRelayToRemoteBunNode(tunnelId, await buildRemoteRelayPayload(providerId, groupId));
        return jsonResponse({ data: { providerId, groupId, remote: result } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/remote-node/request": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote Bun Server request" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const tunnelId = stringValue(body.tunnelId)?.trim() ?? "";
        const method = (stringValue(body.method)?.trim() || "GET").toUpperCase();
        const path = stringValue(body.path)?.trim() ?? "";
        return jsonResponse({ data: await requestRemoteBunNode(tunnelId, method, path, body.body, stringValue(body.apiSession)) }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/remote-thread/start": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread routes" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        // Creating the thread on the host implies copying a relay credential to
        // it, so this carries the same explicit confirmation as relay-sync.
        if (body.confirm !== true) return jsonResponse({ error: "Explicit confirmation is required before starting a thread on the SSH host" }, 409, headers);
        const command = stringValue(body.command)?.trim() ?? "";
        const cwd = stringValue(body.cwd)?.trim() ?? "";
        if (!command || !cwd) return jsonResponse({ error: "command and cwd are required" }, 400, headers);
        const data = await startAutonomousRemoteThread({
          command,
          cwd,
          remotePort: optionalRemoteNodePort(body.remotePort),
          ...(stringValue(body.model)?.trim() ? { model: stringValue(body.model)!.trim() } : {}),
          ...(stringValue(body.providerId)?.trim() ? { providerId: stringValue(body.providerId)!.trim() } : {}),
          ...(stringValue(body.groupId)?.trim() ? { groupId: stringValue(body.groupId)!.trim() } : {}),
          ...(stringValue(body.cliBackend)?.trim() ? { cliBackend: stringValue(body.cliBackend)!.trim() } : {}),
          syncRelay: body.syncRelay !== false
        });
        return jsonResponse({ data }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/ssh/remote-thread-routes": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread routes" }, 403, headers);
      return jsonResponse({ data: remoteThreadRouteStore.list() }, 200, headers);
    }
    case "PUT /api/ssh/remote-thread-routes": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread routes" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const threadId = stringValue(body.threadId)?.trim() ?? "";
        const command = stringValue(body.command)?.trim() ?? "";
        const cwd = stringValue(body.cwd)?.trim() ?? "";
        const remotePort = optionalRemoteNodePort(body.remotePort);
        if (!threadId || !command || !cwd) return jsonResponse({ error: "threadId, command and cwd are required" }, 400, headers);
        const lifecycleMode = body.lifecycleMode === "foreground" ? "foreground" : "background";
        // A stated backend must be a registered plugin — an unknown
        // id is rejected, never silently reclassified as codex. An
        // absent stamp keeps the legacy default for remote nodes.
        const statedBackend = stringValue(body.cliBackend)?.trim() ?? "";
        const cliBackend = body.engine === "pi" && !statedBackend
          ? "pi"
          : statedBackend || "codex";
        if (!serverPluginRegistry.get(cliBackend)) {
          return jsonResponse({ error: `unknown cliBackend "${cliBackend}"` }, 400, headers);
        }
        return jsonResponse({ data: remoteThreadRouteStore.put({ threadId, command, cwd, remotePort, lifecycleMode, cliBackend: cliBackend as CliBackend }) }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "DELETE /api/ssh/remote-thread-routes": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread routes" }, 403, headers);
      const body = asRecord(await request.json().catch(() => ({})));
      const threadId = stringValue(body.threadId)?.trim() ?? "";
      if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
      return jsonResponse({ data: { threadId, deleted: remoteThreadRouteStore.delete(threadId) } }, 200, headers);
    }
    case "POST /api/ssh/remote-thread-routes/detach": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread routes" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const threadId = stringValue(body.threadId)?.trim() ?? "";
        const data = await switchRemoteThreadLifecycle(threadId, "background");
        return jsonResponse({ data }, 200, headers);
      } catch (error) {
        const message = errorToMessage(error);
        return jsonResponse({ error: message }, message.includes("route not found") ? 404 : 400, headers);
      }
    }
    case "POST /api/ssh/remote-thread-routes/lifecycle": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread lifecycle" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const threadId = stringValue(body.threadId)?.trim() ?? "";
        const lifecycleMode = body.lifecycleMode === "foreground" ? "foreground" : body.lifecycleMode === "background" ? "background" : null;
        if (!threadId || !lifecycleMode) return jsonResponse({ error: "threadId and lifecycleMode are required" }, 400, headers);
        const data = await switchRemoteThreadLifecycle(threadId, lifecycleMode);
        return jsonResponse({ data }, 200, headers);
      } catch (error) {
        const message = errorToMessage(error);
        return jsonResponse({ error: message }, message.includes("route not found") ? 404 : 400, headers);
      }
    }
    case "POST /api/ssh/remote-thread-routes/close": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread lifecycle" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const threadId = stringValue(body.threadId)?.trim() ?? "";
        const route = remoteThreadRouteStore.get(threadId);
        if (!route) return jsonResponse({ error: "Autonomous remote thread route not found" }, 404, headers);
        const remote = route.lifecycleMode === "foreground"
          ? await restoreRemoteBunThreadBridge(threadId)
          : remoteBunThreadBridges.get(threadId) ?? null;
        const interruptedTurnIds: string[] = [];
        if (route.lifecycleMode === "foreground" && remote) {
          const turns = asRecord(await remote.request("thread/turns/list", { threadId, limit: 100 }));
          for (const turnId of runningTurnIds(turns as JsonValue)) {
            await remote.request("turn/interrupt", { threadId, turnId });
            interruptedTurnIds.push(turnId);
          }
        }
        remote?.stop();
        remoteBunThreadBridges.delete(threadId);
        return jsonResponse({ data: { threadId, lifecycleMode: route.lifecycleMode, remoteContinues: route.lifecycleMode === "background", interruptedTurnIds } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/ssh/thread-bridges/close": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH thread lifecycle" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const threadId = stringValue(body.threadId)?.trim() ?? "";
        if (!threadId) return jsonResponse({ error: "threadId is required" }, 400, headers);
        await subscriptionRegistry.close(threadId);
        const data = { threadId, ...sshThreadBridges.release(threadId) };
        return jsonResponse({ data }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/ssh/remote-thread-routes/attach": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: remote thread routes" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const threadId = stringValue(body.threadId)?.trim() ?? "";
        const data = await switchRemoteThreadLifecycle(threadId, "foreground");
        return jsonResponse({ data }, 200, headers);
      } catch (error) {
        const message = errorToMessage(error);
        return jsonResponse({ error: message }, message.includes("route not found") ? 404 : 400, headers);
      }
    }
    case "POST /api/ssh/list-directory": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command) ?? "";
        const path = stringValue(body.path) ?? "";
        await assertProtectedReadPath(path, "workspace/ssh/list-directory");
        const data = await listSshDirectory(command, path);
        return jsonResponse(data, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/list-directory": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), path, "read", stringValue(body.cwd));
        await assertProtectedReadPath(path, "workspace/list-directory");
        const data = await listLocalWorkspaceDirectory(path, stringValue(body.cwd), user);
        return jsonResponse(data, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/code-workspace/read": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        assertThreadVmFilesystemPath(stringValue(body.threadId), stringValue(body.path) ?? "", "read", stringValue(body.cwd));
        const resolved = resolveLocalWorkspacePath(stringValue(body.path) ?? "", user);
        if (!isCodeWorkspacePath(resolved)) throw new Error("Only .code-workspace files can be opened");
        const info = statSync(resolved);
        if (!info.isFile()) throw new Error("Workspace file is not a file");
        if (info.size > 1024 * 1024) throw new Error("Workspace file exceeds the 1 MiB limit");
        const data = parseCodeWorkspaceFolders(readFileSync(resolved, "utf8"), resolved);
        for (const root of [data.cwd, ...data.additionalRoots]) {
          assertLocalWorkspacePathAllowed(root, user);
          if (!statSync(root).isDirectory()) throw new Error(`Workspace folder is not a directory: ${root}`);
        }
        return jsonResponse({ data: { path: resolved, ...data } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/code-workspace/write": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        assertThreadVmFilesystemPath(stringValue(body.threadId), stringValue(body.path) ?? "", "write", stringValue(body.cwd));
        const additionalRoots = optionalStringArray(body.additionalRoots, 128, 4096);
        if (additionalRoots === null) throw new Error("Additional workspace folders are invalid");
        const resolvedPath = resolveLocalWorkspacePath(stringValue(body.path) ?? "", user);
        if (!isCodeWorkspacePath(resolvedPath)) throw new Error("Only .code-workspace files can be written");
        const resolvedCwd = resolveLocalWorkspacePath(stringValue(body.cwd) ?? "", user);
        const resolvedRoots = (additionalRoots ?? []).map((root) => resolveLocalWorkspacePath(root, user));
        if (!statSync(resolvedCwd).isDirectory() || resolvedRoots.some((root) => !statSync(root).isDirectory())) {
          throw new Error("Every workspace folder must be an existing directory");
        }
        const existingContents = existsSync(resolvedPath) ? readFileSync(resolvedPath, "utf8") : null;
        await mkdir(dirname(resolvedPath), { recursive: true, mode: 0o755 });
        await writeFile(resolvedPath, updateCodeWorkspaceFolders(existingContents, resolvedPath, resolvedCwd, resolvedRoots), "utf8");
        return jsonResponse({ data: { path: resolvedPath } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/ensure-agents": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        const resolved = resolveLocalWorkspacePath(path, user);
        if (!statSync(resolved).isDirectory()) throw new Error("Workspace path is not a directory");
        const data = await ensureWorkspaceAgentsFile(join(resolved, "AGENTS.md"));
        return jsonResponse({ data }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/read-file": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        await assertProtectedReadPath(path, "workspace/ssh/read-file");
        const args = parseSshCommand(command);
        const script = `base64 -w 0 -- ${quoteRemotePath(path)} 2>/dev/null || base64 --wrap=0 ${quoteRemotePath(path)}`;
        const { stdout } = await execFileAsync("ssh", [...args, script], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
        return jsonResponse({ dataBase64: String(stdout).replace(/\s+/g, "") }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/ssh/write-file": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const dataBase64 = stringValue(body.dataBase64) ?? "";
        if (!/^[A-Za-z0-9+/=]*$/.test(dataBase64)) throw new Error("Invalid base64 file content");
        const args = parseSshCommand(command);
        const script = `printf %s ${quoteRemoteShell(dataBase64)} | base64 -d > ${quoteRemotePath(path)}`;
        await execFileAsync("ssh", [...args, script], { timeout: 30_000, maxBuffer: 256 * 1024 });
        return jsonResponse({ data: { path } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/ssh/ensure-agents": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const args = parseSshCommand(command);
        const encodedRule = Buffer.from(WINDOWS_POWERSHELL_UTF8_RULE, "utf8").toString("base64");
        const agentsPath = `${path.replace(/[\\/]$/, "")}/AGENTS.md`;
        const script = `if [ -f ${quoteRemotePath(agentsPath)} ]; then if grep -Fq -- ${quoteRemoteShell("在 Windows PowerShell 环境中处理包含中文的文件时，必须显式使用 UTF-8 编码。")} ${quoteRemotePath(agentsPath)}; then printf '%s' unchanged; else printf '\\n\\n' >> ${quoteRemotePath(agentsPath)}; printf '%s\\n' ${quoteRemoteShell(encodedRule)} | base64 -d >> ${quoteRemotePath(agentsPath)}; printf '%s' updated; fi; else printf '%s\\n' ${quoteRemoteShell(encodedRule)} | base64 -d > ${quoteRemotePath(agentsPath)}; printf '%s' created; fi`;
        const { stdout } = await execFileAsync("ssh", [...args, script], { timeout: 30_000, maxBuffer: 256 * 1024 });
        const status = String(stdout).trim();
        if (!["created", "updated", "unchanged"].includes(status)) throw new Error("Unable to update remote AGENTS.md");
        return jsonResponse({ data: { path: agentsPath, created: status === "created", updated: status !== "unchanged" } }, 200, headers);
      } catch (error) { return jsonResponse({ error: errorToMessage(error) }, 400, headers); }
    }
    case "POST /api/ssh/create-directory": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const parent = remoteParentPath(path);
        const probe = await preflightSshWorkspace(command, parent);
        await createSshDirectory(command, path, probe.os);
        return jsonResponse({ data: { path } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/create-file": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const args = parseSshCommand(command);
        const parent = remoteParentPath(path);
        const probe = await preflightSshWorkspace(command, parent);
        const script = probe.os.toLowerCase().includes("windows")
          ? powershellEncodedCommand(`$p = ${quotePowerShellLiteral(path)}; $d = Split-Path -Parent $p; if ($d -and -not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -LiteralPath $d | Out-Null }; if (Test-Path -LiteralPath $p) { throw 'exists' }; New-Item -ItemType File -Force -LiteralPath $p | Out-Null`)
          : `mkdir -p -- ${quoteRemotePath(parent)} && test ! -e ${quoteRemotePath(path)} && : > ${quoteRemotePath(path)}`;
        await execFileAsync("ssh", [...args, script], { timeout: 20_000, maxBuffer: 256 * 1024 });
        return jsonResponse({ data: { path } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/delete-path": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const args = parseSshCommand(command);
        const parent = remoteParentPath(path);
        const probe = await preflightSshWorkspace(command, parent);
        const script = probe.os.toLowerCase().includes("windows")
          ? powershellEncodedCommand(`Remove-Item -LiteralPath ${quotePowerShellLiteral(path)} -Recurse -Force`)
          : `rm -rf -- ${quoteRemotePath(path)}`;
        await execFileAsync("ssh", [...args, script], { timeout: 20_000, maxBuffer: 256 * 1024 });
        return jsonResponse({ data: { path } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/rename-path": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const source = normalizeRemotePath(stringValue(body.source) ?? stringValue(body.path) ?? "");
        const destination = normalizeRemotePath(stringValue(body.destination) ?? stringValue(body.newPath) ?? "");
        if (!destination) throw new Error("Destination path is required");
        const args = parseSshCommand(command);
        const probe = await preflightSshWorkspace(command, remoteParentPath(source));
        const destinationParent = remoteParentPath(destination);
        const script = probe.os.toLowerCase().includes("windows")
          ? powershellEncodedCommand(`$d = ${quotePowerShellLiteral(destinationParent)}; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -LiteralPath $d | Out-Null }; Move-Item -LiteralPath ${quotePowerShellLiteral(source)} -Destination ${quotePowerShellLiteral(destination)} -Force`)
          : `mkdir -p -- ${quoteRemotePath(destinationParent)} && mv -- ${quoteRemotePath(source)} ${quoteRemotePath(destination)}`;
        await execFileAsync("ssh", [...args, script], { timeout: 20_000, maxBuffer: 256 * 1024 });
        return jsonResponse({ data: { source, destination } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/copy-path": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const source = normalizeRemotePath(stringValue(body.source) ?? stringValue(body.path) ?? "");
        const destination = normalizeRemotePath(stringValue(body.destination) ?? stringValue(body.newPath) ?? "");
        if (!destination) throw new Error("Destination path is required");
        const args = parseSshCommand(command);
        const probe = await preflightSshWorkspace(command, remoteParentPath(source));
        const destinationParent = remoteParentPath(destination);
        const script = probe.os.toLowerCase().includes("windows")
          ? powershellEncodedCommand(`$d = ${quotePowerShellLiteral(destinationParent)}; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -LiteralPath $d | Out-Null }; Copy-Item -LiteralPath ${quotePowerShellLiteral(source)} -Destination ${quotePowerShellLiteral(destination)} -Recurse -Force`)
          : `mkdir -p -- ${quoteRemotePath(destinationParent)} && cp -r -- ${quoteRemotePath(source)} ${quoteRemotePath(destination)}`;
        await execFileAsync("ssh", [...args, script], { timeout: 20_000, maxBuffer: 256 * 1024 });
        return jsonResponse({ data: { source, destination } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/ssh/preflight": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const result = await preflightSshWorkspace(command, path);
        return jsonResponse({ data: result }, result.ready ? 200 : 409, headers);
      } catch (error) {
        return jsonResponse({
          data: {
            ready: false, connected: false, os: "", arch: "", codexPath: "", codexVersion: "",
            appServerAvailable: false, cwdExists: false, cwdReadable: false, cwdWritable: false,
            reasons: [sshConnectionErrorMessage(error)]
          }
        }, 409, headers);
      }
    }
    case "POST /api/ssh/install-codex": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: SSH workspaces" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const command = stringValue(body.command)?.trim() ?? "";
        const path = normalizeRemotePath(stringValue(body.path) ?? "");
        const before = await preflightSshWorkspace(command, path);
        if (before.ready) return jsonResponse({ data: { installed: false, alreadyInstalled: true, preflight: before } }, 200, headers);
        if (!before.connected) {
          return jsonResponse({ error: "Connect to the SSH host before installing Codex CLI", data: { preflight: before } }, 409, headers);
        }
        if (before.codexPath && !before.appServerAvailable) {
          return jsonResponse({ error: "An incompatible Codex CLI is installed. Upgrade it manually before continuing.", data: before }, 409, headers);
        }
        const output = await installCodexOnSshHost(command, before.os);
        const after = await preflightSshWorkspace(command, path);
        return jsonResponse({ data: { installed: true, alreadyInstalled: false, output, preflight: after } }, after.ready ? 200 : 409, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/workspace/roots":
      try {
        return jsonResponse(localWorkspaceInfo(user), 200, headers);
      } catch (error) {
        return jsonResponse({
          error: errorToMessage(error),
          code: "CUX-WORKSPACE-001"
        }, 500, headers);
      }
    case "POST /api/workspace/create-directory": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), path, "write", stringValue(body.cwd));
        const recursive = body.recursive !== false;
        await createLocalWorkspaceDirectory(path, stringValue(body.cwd), recursive, user);
        return jsonResponse({}, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/create-file": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), path, "write", stringValue(body.cwd));
        const trimmed = path.trim();
        const cwd = stringValue(body.cwd);
        const target = !isAbsolute(trimmed) && !trimmed.startsWith("~") && cwd ? join(cwd, trimmed) : trimmed;
        const resolved = resolveLocalWorkspacePath(target, user);
        const info = statSync(resolved, { throwIfNoEntry: false });
        if (info) throw new Error(`Workspace path already exists: ${path}`);
        await mkdir(dirname(resolved), { recursive: true, mode: 0o755 });
        await writeFile(resolved, "", "utf8");
        return jsonResponse({ data: { path: resolved } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/delete-path": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), path, "write", stringValue(body.cwd));
        const trimmed = path.trim();
        const cwd = stringValue(body.cwd);
        const target = !isAbsolute(trimmed) && !trimmed.startsWith("~") && cwd ? join(cwd, trimmed) : trimmed;
        const resolved = resolveLocalWorkspacePath(target, user);
        await rm(resolved, { recursive: true, force: true });
        return jsonResponse({ data: { path: resolved } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/rename-path": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const source = stringValue(body.source) ?? stringValue(body.path) ?? "";
        const destination = stringValue(body.destination) ?? stringValue(body.newPath) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), source, "write", stringValue(body.cwd));
        assertThreadVmFilesystemPath(stringValue(body.threadId), destination, "write", stringValue(body.cwd));
        if (!destination.trim()) throw new Error("Destination path is required");
        const cwd = stringValue(body.cwd);
        const srcTrimmed = source.trim();
        const dstTrimmed = destination.trim();
        const srcTarget = !isAbsolute(srcTrimmed) && !srcTrimmed.startsWith("~") && cwd ? join(cwd, srcTrimmed) : srcTrimmed;
        const dstTarget = !isAbsolute(dstTrimmed) && !dstTrimmed.startsWith("~") && cwd ? join(cwd, dstTrimmed) : dstTrimmed;
        const resolvedSource = resolveLocalWorkspacePath(srcTarget, user);
        const resolvedDestination = resolveLocalWorkspacePath(dstTarget, user);
        await mkdir(dirname(resolvedDestination), { recursive: true, mode: 0o755 });
        await rename(resolvedSource, resolvedDestination);
        return jsonResponse({ data: { source: resolvedSource, destination: resolvedDestination } }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/copy-path": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const source = stringValue(body.source) ?? stringValue(body.path) ?? "";
        const destination = stringValue(body.destination) ?? stringValue(body.newPath) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), source, "read", stringValue(body.cwd));
        assertThreadVmFilesystemPath(stringValue(body.threadId), destination, "write", stringValue(body.cwd));
        if (!destination.trim()) throw new Error("Destination path is required");
        const cwd = stringValue(body.cwd);
        const srcTrimmed = source.trim();
        const dstTrimmed = destination.trim();
        const srcTarget = !isAbsolute(srcTrimmed) && !srcTrimmed.startsWith("~") && cwd ? join(cwd, srcTrimmed) : srcTrimmed;
        const dstTarget = !isAbsolute(dstTrimmed) && !dstTrimmed.startsWith("~") && cwd ? join(cwd, dstTrimmed) : dstTrimmed;
        const resolvedSource = resolveLocalWorkspacePath(srcTarget, user);
        const resolvedDestination = resolveLocalWorkspacePath(dstTarget, user);
        await mkdir(dirname(resolvedDestination), { recursive: true, mode: 0o755 });
        await cp(resolvedSource, resolvedDestination, { recursive: true });
        return jsonResponse({ data: { source: resolvedSource, destination: resolvedDestination } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/read-file": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), path, "read", stringValue(body.cwd));
        const result = await readLocalWorkspaceFileRpc(path, stringValue(body.cwd), user);
        return jsonResponse(result, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/write-file": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = stringValue(body.path) ?? "";
        assertThreadVmFilesystemPath(stringValue(body.threadId), path, "write", stringValue(body.cwd));
        const result = await writeLocalWorkspaceFileRpc(
          path,
          stringValue(body.cwd),
          stringValue(body.dataBase64),
          stringValue(body.content) ?? stringValue(body.text),
          user
        );
        return jsonResponse(result, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/git": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const method = stringValue(body.method) ?? "";
        if (!isWorkspaceGitMethod(method)) {
          return jsonResponse({ error: `Unsupported workspace Git method: ${method}` }, 400, headers);
        }
        const params = asRecord(body.params);
        const threadId = stringValue(params.threadId);
        const vmRuntime = threadId ? threadRuntimeMetadataStore.getAny(threadId) : null;
        if (vmRuntime) {
          const denial = vmRpcPolicyDenial(method, params as unknown as JsonValue, vmRuntime);
          if (denial) throw new Error(`Policy guard denied ${method}: ${denial}`);
        }
        if (isWorkspaceGitMutation(method) && user && user.role !== "admin" && !user.allowWrite) {
          throw new Error("Member policy forbids Git writes");
        }
        const sshProfile = sshProfileFromParams(params as unknown as JsonValue);
        const result = await handleWorkspaceGitRpc(
          method,
          params,
          sshProfile,
          vmRuntime?.vmEnabled ? normalizeSaVmPolicy(vmRuntime.vmPolicy, stringValue(params.cwd) ?? vmRuntime.cwd ?? process.cwd(), vmRuntime.additionalRoots ?? []) : undefined
        );
        return jsonResponse({ data: result }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/workspace/sa-vm-status": {
      try {
        const url = new URL(request.url);
        const rawCwd = url.searchParams.get("cwd") ?? "";
        const backend = url.searchParams.get("backend")?.trim().toLowerCase() ?? "";
        if (!rawCwd.trim()) {
          return jsonResponse({ data: { hasSkill: false, skillPath: null } }, 200, headers);
        }
        const cwd = resolveLocalWorkspacePath(rawCwd, user);
        if (!existsSync(cwd)) {
          return jsonResponse({ data: { hasSkill: false, skillPath: null } }, 200, headers);
        }
        const claudeSkill = join(cwd, ".claude", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const geminiSkill = join(cwd, ".gemini", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const agentsSkill = join(cwd, ".agents", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const codexSkill = join(cwd, ".codex", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const grokSkill = join(cwd, ".grok", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const opencodeSkill = join(cwd, ".opencode", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const piSkill = join(cwd, ".pi", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
        const candidates = backend === "claude"
          ? [claudeSkill, agentsSkill, codexSkill, geminiSkill, grokSkill, opencodeSkill, piSkill]
          : backend === "agy"
            ? [geminiSkill, agentsSkill, codexSkill, claudeSkill, grokSkill, opencodeSkill, piSkill]
            : backend === "codex"
              ? [codexSkill, agentsSkill, claudeSkill, geminiSkill, grokSkill, opencodeSkill, piSkill]
              : backend === "opencode" || backend === "opencode-v2"
                ? [opencodeSkill, agentsSkill, codexSkill, claudeSkill, geminiSkill, grokSkill, piSkill]
                : backend === "pi"
                  ? [piSkill, agentsSkill, codexSkill, claudeSkill, geminiSkill, grokSkill, opencodeSkill]
                  : [agentsSkill, codexSkill, claudeSkill, geminiSkill, grokSkill, opencodeSkill, piSkill];
        const existingSkill = candidates.find((p) => existsSync(p)) ?? null;
        return jsonResponse({
          data: {
            hasSkill: Boolean(existingSkill),
            skillPath: existingSkill
          }
        }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/workspace/sa-vm-skill": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const cwd = resolveLocalWorkspacePath(stringValue(body.cwd) ?? "", user);
        const threadId = stringValue(body.threadId);
        const runtime = threadId ? threadRuntimeMetadataStore.get(user?.id ?? "local", threadId) : null;
        const requestedSalaRoot = typeof body.salaRoot === "string"
          ? body.salaRoot.trim() || undefined
          : runtime?.vmEnabled
            ? runtime.vmPolicy?.fs?.salaRoot
            : undefined;
        const effectivePolicy = (body.policy ?? runtime?.vmPolicy) as SaVmPolicyConfig | undefined;
        const isEnhanceActive = hasEnhanceToolsEnabled(effectivePolicy?.tools);
        const enabled = body.enabled === true || isEnhanceActive;
        const result = await syncSaVmWorkspaceSkillDirectory({
          cwd,
          threadId,
          enabled,
          salaRoot: requestedSalaRoot,
          policy: effectivePolicy,
          jevActiveTools: body.jevActiveTools === true
        });
        return jsonResponse({ data: result }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }    case "POST /api/workspace/image": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const path = resolveLocalWorkspacePath(stringValue(body.path) ?? "", user);
        await assertProtectedReadPath(path, "workspace/image");
        const info = statSync(path);
        if (!info.isFile()) {
          return jsonResponse({ error: "Image path is not a file" }, 400, headers);
        }
        const maxBytes = 128 * 1024 * 1024;
        if (info.size > maxBytes) {
          return jsonResponse({ error: "Image exceeds 128 MiB preview limit" }, 413, headers);
        }
        const mediaType = imageMediaTypeForLocalPath(path);
        if (!mediaType) {
          return jsonResponse({ error: "Unsupported image format" }, 415, headers);
        }
        const responseHeaders = new Headers(headers);
        responseHeaders.set("Content-Type", mediaType);
        responseHeaders.set("Content-Length", String(info.size));
        responseHeaders.set("Cache-Control", "private, no-store");
        return new Response(new Uint8Array(readFileSync(path)), { status: 200, headers: responseHeaders });
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/attachments/upload": {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return jsonResponse({ error: "Missing attachment file" }, 400, headers);
        }
        const saved = await saveUploadedAttachment(file);
        return jsonResponse(saved, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/webdev/probe": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const previewUrl = stringValue(body.url) ?? "";
        const result = await probeWebDevPreviewUrl(previewUrl);
        return jsonResponse(result, result.ok ? 200 : 400, headers);
      } catch (error) {
        return jsonResponse({ ok: false, error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/webdev/servers":
      return jsonResponse({ data: listWebDevServers() }, 200, headers);
    case "POST /api/webdev/servers/start": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const cwd = stringValue(body.cwd) ?? "";
        assertWebDevServerCwdAllowed(cwd, user);
        const session = startWebDevServer({
          id: stringValue(body.id),
          command: stringValue(body.command) ?? "",
          cwd
        });
        return jsonResponse({ data: session }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/webdev/servers/stop": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const session = stopWebDevServer(stringValue(body.id) ?? "");
        return jsonResponse({ data: session }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/images/generations": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.providerId);
        const { provider, group } = await resolveImageProvider(providerId, stringValue(body.groupId), user, "generations");
        // Embedded duck2api: no external key/URL; dispatch in-process to the
        // TS images endpoint (Go imageGenerations parity).
        if (group?.id === "d2api") {
          const d2prompt = stringValue(body.prompt)?.trim();
          if (!d2prompt) {
            return jsonResponse({ error: "Missing image prompt" }, 400, headers);
          }
          const d2model = stringValue(body.model) ?? group.models?.[0] ?? "gpt-6-luna";
          const prefix = (process.env.PREFIX ?? "").trim();
          const clean = prefix ? (prefix.startsWith("/") ? prefix : `/${prefix}`).replace(/\/+$/, "") : "";
          const duckRes = await getEmbeddedDuck2ApiImagesApp().request(`${clean}/v1/images/generations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: d2prompt, model: d2model }),
          });
          const duckBody = await duckRes.json().catch(() => ({ error: "Invalid embedded image response" }));
          const persisted = duckRes.ok
            ? await persistImageApiResult(duckBody, localDatabase.dir)
            : duckBody;
          return jsonResponse(
            duckRes.ok ? withImagePrice(persisted, group, d2model) : persisted,
            (duckRes.status >= 200 && duckRes.status <= 599 ? duckRes.status : 500),
            headers,
          );
        }
        const apiKey = await resolveGroupApiKey(provider, group, stringValue(body.apiKey));
        if (!apiKey) {
          return jsonResponse({ error: `Image group ${group.name} has no API key` }, 400, headers);
        }
        const prompt = stringValue(body.prompt)?.trim();
        if (!prompt) {
          return jsonResponse({ error: "Missing image prompt" }, 400, headers);
        }
        const imageConfig = imageConfigForGroup(provider, group);
        const model = stringValue(body.model) ?? imageConfig?.defaultModel ?? group.models?.[0] ?? "gpt-image-2";
        const options: Record<string, string | number | boolean> = {};
        for (const key of ["size", "quality", "background", "moderation", "output_format", "response_format", "n"]) {
          const value = body[key];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            options[key] = value;
          }
        }
        const timeout = AbortSignal.timeout(150_000);
        const signal = (AbortSignal as typeof AbortSignal & { any(signals: AbortSignal[]): AbortSignal }).any([request.signal, timeout]);
        const result = await runImageGeneration({ provider: { ...provider, image: imageConfig }, apiKey, prompt, model, options, protocol: imageProtocolValue(body.protocol), signal });
        const persisted = result.status >= 200 && result.status < 300
          ? await persistImageApiResult(result.body, localDatabase.dir)
          : result.body;
        return jsonResponse(withImagePrice(persisted, group, model), result.status, headers);
      } catch (error) {
        return imageRequestErrorResponse(error, request.signal, headers);
      }
    }
    case "POST /api/images/edits": {
      try {
        const form = await request.formData();
        const providerId = stringValue(form.get("providerId"));
        const { provider, group } = await resolveImageProvider(providerId, stringValue(form.get("groupId")), user, "edits");
        const imageConfig = imageConfigForGroup(provider, group);
        if (imageConfig?.protocols?.length && !imageConfig.protocols.includes("openaiImageEdits")) {
          return jsonResponse({ error: "Provider does not enable OpenAI image edits protocol" }, 400, headers);
        }
        const apiKey = await resolveGroupApiKey(provider, group, stringValue(form.get("apiKey")));
        if (!apiKey) {
          return jsonResponse({ error: `Image group ${group.name} has no API key` }, 400, headers);
        }
        const prompt = stringValue(form.get("prompt"))?.trim();
        if (!prompt) {
          return jsonResponse({ error: "Missing image edit prompt" }, 400, headers);
        }
        const imageFiles = form.getAll("image").filter((entry): entry is File => entry instanceof File);
        if (imageFiles.length === 0) {
          return jsonResponse({ error: "Missing source image" }, 400, headers);
        }
        const model = stringValue(form.get("model")) ?? imageConfig?.defaultModel ?? group.models?.[0] ?? "gpt-image-2";
        const upstream = new FormData();
        upstream.set("model", model);
        upstream.set("prompt", prompt);
        for (const file of imageFiles) {
          upstream.append("image", file, file.name || "image.png");
        }
        const mask = form.get("mask");
        if (mask instanceof File) {
          upstream.set("mask", mask, mask.name || "mask.png");
        }
        for (const key of ["size", "quality", "background", "output_format", "response_format", "n"]) {
          const value = form.get(key);
          if (typeof value === "string" && value.trim()) {
            upstream.set(key, value);
          }
        }
        const response = await fetch(`${providerBaseUrl(provider)}/images/edits`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`
          },
          body: upstream,
          signal: (AbortSignal as typeof AbortSignal & { any(signals: AbortSignal[]): AbortSignal }).any([request.signal, AbortSignal.timeout(180_000)])
        });
        const normalized = await normalizeImageApiResponse(response, { provider: { ...provider, image: imageConfig }, model, prompt, endpoint: "images/edits" });
        const persisted = response.ok ? await persistImageApiResult(normalized, localDatabase.dir) : normalized;
        return jsonResponse(withImagePrice(persisted, group, model), response.ok ? 200 : response.status, headers);
      } catch (error) {
        return imageRequestErrorResponse(error, request.signal, headers);
      }
    }
    case "GET /api/providers": {
      const data = visibleProviders(await providerStore.list());
      if (user && user.role !== "admin") {
        const allowed = new Set(securityStore.getAllowedProviders(user.id));
        // Members only see relays assigned by admin; secrets masked.
        return jsonResponse({
          data: data
            .filter((provider) => allowed.has(provider.id))
            .map((provider) => ({
              ...provider,
              apiKeyPreview: provider.apiKeyPreview ? "••••" : undefined,
              apiKeyRef: provider.apiKeyRef ? "env:REDACTED" : undefined,
              groups: provider.groups?.map((group) => ({
                ...group,
                keys: group.keys.map(() => "••••")
              }))
            }))
        }, 200, headers);
      }
      return jsonResponse({ data }, 200, headers);
    }
    case "GET /api/provider/details": {
      if (user && user.role !== "admin") return jsonResponse({ error: "Admin only: provider details" }, 403, headers);
      const providerId = url.searchParams.get("providerId")?.trim() ?? "";
      if (!providerId) return jsonResponse({ error: "providerId is required" }, 400, headers);
      const provider = await providerStore.get(providerId);
      return provider ? jsonResponse({ data: provider }, 200, headers) : jsonResponse({ error: "Relay not found" }, 404, headers);
    }
    case "GET /api/profile/export": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: profile export" }, 403, headers);
      }
      return jsonResponse(await providerStore.exportProfile(), 200, headers);
    }
    case "POST /api/profile/import": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: profile import" }, 403, headers);
      }
      try {
        return jsonResponse(await providerStore.importProfile(await request.json()), 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/relay-config/export": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: relay config export" }, 403, headers);
      }
      return jsonResponse(await providerStore.exportRelayConfig(), 200, headers);
    }
    case "POST /api/relay-config/import": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: relay config import" }, 403, headers);
      }
      try {
        return jsonResponse(await providerStore.importRelayConfig(await request.json()), 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/relay-backup/export": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: relay backup export" }, 403, headers);
      }
      return jsonResponse(await providerStore.exportRelayBackup(), 200, headers);
    }
    case "POST /api/relay-backup/import": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: relay backup import" }, 403, headers);
      }
      try {
        return jsonResponse(await providerStore.importRelayBackup(await request.json()), 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/provider/catalog/preview": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: capability catalog preview" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.provider_id) ?? stringValue(body.providerId);
        const catalogUrl = stringValue(body.catalog_url) ?? stringValue(body.catalogUrl);
        const catalog = catalogUrl
          ? await fetchRelayCapabilityCatalog(catalogUrl)
          : body.catalog ?? body.data;
        if (!providerId) {
          return jsonResponse(buildCatalogImportPreview("draft", [], catalog), 200, headers);
        }
        return jsonResponse(await providerStore.previewCapabilityCatalog(providerId, catalog), 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/provider/catalog/import": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: capability catalog import" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.provider_id) ?? stringValue(body.providerId);
        if (!providerId) return jsonResponse({ error: "Missing provider_id" }, 400, headers);
        const mode = body.mode === "replace" ? "replace" : "merge";
        const catalog = body.catalog ?? body.data;
        return jsonResponse(await providerStore.importCapabilityCatalog(providerId, catalog, mode), 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/provider/fetch-models": {
      // Mirror axonhub fetchModels: admin-only when membership is on.
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: fetch provider models" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.providerId) ?? stringValue(body.channelID);
        const existingProvider = providerId ? await providerStore.get(providerId) : null;
        const groupId = stringValue(body.groupId);
        const isOpencodeLocalProvider = providerId === OPENCODE_OFFICIAL_PROVIDER_ID || providerId === "opencode-local";
        // 兼容旧 default/free 分组：opencode-local 已收敛为 v1/v2，仅这两个旧 id 回退到 v1。
        const legacyFetchGroupId = (() => {
          const normalized = (groupId ?? "").trim().toLowerCase();
          return isOpencodeLocalProvider && (normalized === "default" || normalized === "free") ? OPENCODE_V1_GROUP_ID : null;
        })();
        const group = groupId
          ? existingProvider?.groups?.find((entry) => entry.id === groupId
            || (legacyFetchGroupId !== null && entry.id === legacyFetchGroupId))
          : existingProvider?.groups?.[0];
        const apiKey = stringValue(body.apiKey) ?? "";
        const kind = stringValue(body.kind) ?? stringValue(body.channelType) ?? "responsesRelay";
        const protocol = responseProtocolValue(body.protocol) ?? group?.responseProtocol;
        const authType = relayAuthTypeValue(body.authType) ?? group?.authType;
        const resolvedKey = group && existingProvider
          ? await resolveGroupApiKey(existingProvider, group, apiKey || undefined)
          : await resolveProviderApiKey(providerId, apiKey);

        const isFreeRelay = providerId === OMNIROUTE_FREE_PROVIDER_ID;
        let result: { models: string[]; error?: string | null; endpoint?: string };
        if (isFreeRelay && groupId === "kilocode") {
          const kilo = await fetchKiloCodeFreeModels().catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
          result = { models: kilo.models, error: "error" in kilo ? (kilo.error as string) : null, endpoint: `${group?.baseUrl || KILOCODE_FREE_BASE_URL}/models` };
        } else if (isFreeRelay && (groupId === "opencode" || groupId === "opencode-free")) {
          const opencode = await fetchOmniRouteFreeModels().catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
          result = { models: opencode.models, error: "error" in opencode ? (opencode.error as string) : null, endpoint: `${group?.baseUrl || OMNIROUTE_FREE_BASE_URL}/models` };
        } else if (isFreeRelay && groupId === "cline-free") {
          const cline = await fetchClineFreeModels().catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
          result = { models: cline.models, error: "error" in cline ? (cline.error as string) : null, endpoint: CLINE_RECOMMENDED_MODELS_URL };
        } else if (isFreeRelay && groupId === "freebuff") {
          const freebuff = await fetchFreebuffFreeModels({ token: resolvedKey }).catch((e) => ({ models: [], fetchedModels: 0, error: errorToMessage(e) }));
          result = { models: freebuff.models, error: "error" in freebuff ? (freebuff.error as string) : null, endpoint: `${FREEBUFF_BASE_URL}/freebuff/session` };
        } else if (providerId === OPENCODE_OFFICIAL_PROVIDER_ID || providerId === "opencode-local") {
          // `group` 已回退到解析后的持久分组（旧 default/free 即 v1）：v1/v2 各自用
          // 对应二进制跑 `opencode models` 拉全量本地目录；仅请求旧 `free` 时过滤。
          const isV2Group = group?.id === OPENCODE_V2_GROUP_ID;
          const bin = isV2Group ? findOpencodeV2Bin() : findOpencodeBin();
          let models: string[] = [];
          let fetchErr: string | null = null;
          try {
            models = bin ? await listOpencodeModelsAsync(bin, process.env, 15_000) : [];
            if (groupId === "free") {
              models = filterOpencodeFreeModels(models);
            }
          } catch (err) {
            fetchErr = errorToMessage(err);
          }
          const fallback = isV2Group ? OPENCODE_V2_FALLBACK_MODELS : OPENCODE_FALLBACK_FREE_MODELS;
          result = {
            models: models.length > 0 ? models : fallback,
            error: fetchErr,
            endpoint: bin || "opencode CLI"
          };
        } else {
          const baseUrl = stringValue(body.baseUrl) ?? stringValue(body.baseURL) ?? group?.baseUrl ?? existingProvider?.baseUrl ?? "";
          result = await fetchProviderModels({
            baseUrl,
            apiKey: resolvedKey || undefined,
            kind,
            protocol,
            authType
          });
        }
        return jsonResponse(
          {
            models: result.models.map((id) => ({ id })),
            error: result.error ?? null,
            endpoint: result.endpoint
          },
          result.error && result.models.length === 0 ? 400 : 200,
          headers
        );
      } catch (error) {
        return jsonResponse({ models: [], error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/provider/test":
    case "POST /api/provider/test-chat": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: test provider" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const providerId = stringValue(body.providerId) ?? stringValue(body.channelID);
        const existingProvider = providerId ? await providerStore.get(providerId) : null;
        const groupId = stringValue(body.groupId);
        // 兼容旧 default/free 分组：opencode-local 已收敛为 v1/v2，仅这两个旧 id 回退到 v1。
        const legacyTestGroupId = (() => {
          const normalized = (groupId ?? "").trim().toLowerCase();
          const isOpencodeLocal = providerId === OPENCODE_OFFICIAL_PROVIDER_ID || providerId === "opencode-local";
          return isOpencodeLocal && (normalized === "default" || normalized === "free") ? OPENCODE_V1_GROUP_ID : null;
        })();
        const group = groupId
          ? existingProvider?.groups?.find((entry) => entry.id === groupId
            || (legacyTestGroupId !== null && entry.id === legacyTestGroupId))
          : existingProvider?.groups?.[0];
        const baseUrl = stringValue(body.baseUrl) ?? stringValue(body.baseURL) ?? existingProvider?.baseUrl ?? "";
        const apiKey = stringValue(body.apiKey) ?? "";
        const kind = stringValue(body.kind) ?? stringValue(body.channelType) ?? "responsesRelay";
        const model = stringValue(body.model) ?? group?.models?.find((entry) => entry.trim()) ?? existingProvider?.defaultModel ?? "";
        const catalogModel = existingProvider?.capabilityCatalog?.data.find((entry) => entry.model_name === model);
        const protocol = responseProtocolValue(body.protocol) ?? (group ? resolveModelProtocol(group, catalogModel) : undefined);
        const resolvedKey = group && existingProvider
          ? await resolveGroupApiKey(existingProvider, group, apiKey || undefined)
          : await resolveProviderApiKey(providerId, apiKey);
        const result = await testProvider({
          baseUrl,
          apiKey: resolvedKey || undefined,
          kind,
          model,
          protocol,
          authType: group?.authType,
          endpointPathOverride: group?.endpointPathOverride,
          timeoutMs: 60_000
        });
        return jsonResponse(result, result.ok ? 200 : 400, headers);
      } catch (error) {
        return jsonResponse({ ok: false, message: errorToMessage(error), elapsedMs: 0 }, 400, headers);
      }
    }
    case "GET /api/audit/events": {
      if (user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: audit events" }, 403, headers);
      }
      return jsonResponse({ data: await auditLogStore.list() }, 200, headers);
    }
    case "GET /api/members": {
      if (!authStore) {
        return jsonResponse({ error: "Membership is disabled (CODEX_UI_AUTH=off)" }, 400, headers);
      }
      if (!user || user.role !== "admin") {
        return jsonResponse({ error: "Admin only" }, 403, headers);
      }
      const data = authStore.listUsers().map((member) => ({
        ...member,
        allowedProviderIds: securityStore.getAllowedProviders(member.id)
      }));
      return jsonResponse({ data }, 200, headers);
    }
    case "GET /api/admin/settings": {
      if (!authStore) {
        return jsonResponse({ error: "Membership is disabled" }, 400, headers);
      }
      if (!user || user.role !== "admin") {
        return jsonResponse({ error: "Admin only" }, 403, headers);
      }
      return jsonResponse({ data: securityStore.getSettings() }, 200, headers);
    }
    case "PATCH /api/admin/settings": {
      if (!authStore) {
        return jsonResponse({ error: "Membership is disabled" }, 400, headers);
      }
      if (!user || user.role !== "admin") {
        return jsonResponse({ error: "Admin only" }, 403, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const updated = securityStore.updateSettings({
        registrationEnabled: typeof body.registrationEnabled === "boolean" ? body.registrationEnabled : undefined,
        captchaEnabled: typeof body.captchaEnabled === "boolean" ? body.captchaEnabled : undefined,
        totpEnabled: typeof body.totpEnabled === "boolean" ? body.totpEnabled : undefined,
        forceAdminTotp: typeof body.forceAdminTotp === "boolean" ? body.forceAdminTotp : undefined,
        defaultMemberBalance: numberValue(body.defaultMemberBalance),
        defaultMemberConcurrency: numberValue(body.defaultMemberConcurrency)
      });
      return jsonResponse({ data: updated }, 200, headers);
    }
    case "GET /api/totp/status": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const settings = securityStore.getSettings();
      return jsonResponse(
        {
          systemEnabled: settings.totpEnabled,
          enabled: Boolean(user.totpEnabled),
          forceAdminTotp: settings.forceAdminTotp
        },
        200,
        headers
      );
    }
    case "POST /api/totp/setup": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      if (!securityStore.getSettings().totpEnabled) {
        return jsonResponse({ error: "TOTP is disabled by admin" }, 403, headers);
      }
      const secret = generateTotpSecret();
      securityStore.storeTotpSetup(user.id, secret);
      return jsonResponse(
        {
          secret,
          otpauthUrl: totpUri(secret, user.email),
          qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpUri(secret, user.email))}`
        },
        200,
        headers
      );
    }
    case "POST /api/totp/enable": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const code = stringValue(body.totpCode) ?? stringValue(body.code) ?? "";
      const secret = securityStore.takeTotpSetup(user.id);
      if (!secret) {
        return jsonResponse({ error: "Run /api/totp/setup first" }, 400, headers);
      }
      if (!verifyTotpCode(secret, code)) {
        // put secret back if failed
        securityStore.storeTotpSetup(user.id, secret);
        return jsonResponse({ error: "Invalid authenticator code" }, 400, headers);
      }
      const updated = authStore.enableTotp(user.id, secret);
      return jsonResponse({ data: updated }, 200, headers);
    }
    case "POST /api/totp/disable": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const code = stringValue(body.totpCode) ?? stringValue(body.code) ?? "";
      const password = stringValue(body.password) ?? "";
      const secret = authStore.getTotpSecret(user.id);
      if (secret) {
        if (!verifyTotpCode(secret, code)) {
          // allow password fallback
          const row = await authStore.verifyPassword(user.email, password);
          if (!row) {
            return jsonResponse({ error: "Invalid code or password" }, 400, headers);
          }
        }
      }
      const updated = authStore.disableTotp(user.id);
      return jsonResponse({ data: updated }, 200, headers);
    }
    case "POST /api/members": {
      if (!authStore) {
        return jsonResponse({ error: "Membership is disabled" }, 400, headers);
      }
      if (!user || user.role !== "admin") {
        return jsonResponse({ error: "Admin only" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const created = await authStore.createUser({
          email: stringValue(body.email) ?? "",
          password: stringValue(body.password) ?? "",
          username: stringValue(body.username),
          role: body.role === "admin" ? "admin" : "user",
          status: body.status === "disabled" ? "disabled" : "active",
          balance: numberValue(body.balance),
          concurrency: numberValue(body.concurrency),
          maxPermission:
            body.maxPermission === "readonlyAsk" ||
            body.maxPermission === "workspaceAsk" ||
            body.maxPermission === "fullAsk" ||
            body.maxPermission === "dangerBypass"
              ? body.maxPermission
              : undefined,
          allowWrite: typeof body.allowWrite === "boolean" ? body.allowWrite : undefined,
          allowNetwork: typeof body.allowNetwork === "boolean" ? body.allowNetwork : undefined,
          allowDangerBypass: typeof body.allowDangerBypass === "boolean" ? body.allowDangerBypass : undefined,
          notes: stringValue(body.notes)
        });
        let allowedProviderIds: string[] = [];
        if (Array.isArray(body.allowedProviderIds)) {
          allowedProviderIds = securityStore.setAllowedProviders(
            created.id,
            body.allowedProviderIds.filter((entry): entry is string => typeof entry === "string")
          );
        }
        return jsonResponse({ data: { ...created, allowedProviderIds } }, 201, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }

    case "GET /api/usage/summary": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const daysRaw = Number(url.searchParams.get("days") ?? "7");
      const days = Number.isFinite(daysRaw) ? daysRaw : 7;
      const filterUserId = stringValue(url.searchParams.get("userId"));
      const isAdmin = user.role === "admin";
      if (filterUserId && !isAdmin && filterUserId !== user.id) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      if (!isAdmin) {
        const scoped = authStore.getUsageSummary({ userId: user.id, days, isAdmin: false });
        return jsonResponse({ data: scoped }, 200, headers);
      }
      const summary = authStore.getUsageSummary({
        userId: filterUserId ?? undefined,
        days,
        isAdmin: true
      });
      return jsonResponse({ data: summary }, 200, headers);
    }
    case "GET /api/usage/ledger": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const limitRaw = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const filterUserId = stringValue(url.searchParams.get("userId"));
      if (user.role === "admin") {
        const data = authStore.listBalanceLedgerForAdmin(limit, filterUserId ?? undefined);
        return jsonResponse({ data }, 200, headers);
      }
      return jsonResponse({ data: authStore.listBalanceLedger(user.id, limit) }, 200, headers);
    }
    case "GET /api/me/ledger": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const limitRaw = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      return jsonResponse({ data: authStore.listBalanceLedger(user.id, limit) }, 200, headers);
    }
    // P2 网关统计（对标 axonhub dashboard/requests 的 count 层；token/cost 层仍读 /api/usage/*）。
    case "GET /api/gateway/overview": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const daysRaw = Number(url.searchParams.get("days") ?? "7");
      const days = Number.isFinite(daysRaw) ? daysRaw : 7;
      return jsonResponse({
        data: {
          overview: gatewayRequestStore.overview(scope.ownerId),
          daily: gatewayRequestStore.dailyCounts(scope.ownerId, days),
        }
      }, 200, headers);
    }
    case "GET /api/gateway/by": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const dimensionRaw = url.searchParams.get("dimension") ?? "model";
      if (dimensionRaw !== "provider" && dimensionRaw !== "group" && dimensionRaw !== "model" && dimensionRaw !== "endpoint") {
        return jsonResponse({ error: "Invalid dimension (provider|group|model|endpoint)" }, 400, headers);
      }
      const dimension = dimensionRaw as "provider" | "group" | "model" | "endpoint";
      const daysRaw = Number(url.searchParams.get("days") ?? "7");
      const days = Number.isFinite(daysRaw) ? daysRaw : 7;
      const limitRaw = Number(url.searchParams.get("limit") ?? "10");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
      return jsonResponse({
        data: gatewayRequestStore.byDimension(scope.ownerId, dimension, days, limit)
      }, 200, headers);
    }
    case "GET /api/gateway/by-status": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const daysRaw = Number(url.searchParams.get("days") ?? "7");
      const days = Number.isFinite(daysRaw) ? daysRaw : 7;
      const limitRaw = Number(url.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
      return jsonResponse({
        data: gatewayRequestStore.byStatus(scope.ownerId, days, limit)
      }, 200, headers);
    }
    case "GET /api/gateway/health": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const daysRaw = Number(url.searchParams.get("days") ?? "7");
      const days = Number.isFinite(daysRaw) ? daysRaw : 7;
      const limitRaw = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      return jsonResponse({
        data: gatewayRequestStore.healthByProvider(scope.ownerId, days, limit)
      }, 200, headers);
    }
    case "GET /api/gateway/requests": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const limitRaw = Number(url.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
      const okRaw = url.searchParams.get("ok");
      const endpointRaw = url.searchParams.get("endpoint");
      const statusRaw = url.searchParams.get("status");
      const sourceRaw = url.searchParams.get("source");
      const validStatus = statusRaw === "pending" || statusRaw === "processing" || statusRaw === "completed" || statusRaw === "failed" || statusRaw === "canceled" ? statusRaw : undefined;
      const validSource = sourceRaw === "api" || sourceRaw === "playground" || sourceRaw === "test" || sourceRaw === "direct" || sourceRaw === "unknown" ? sourceRaw : undefined;
      const page = gatewayRequestStore.listPage(scope.ownerId, {
        ...(stringValue(url.searchParams.get("providerId")) ? { providerId: stringValue(url.searchParams.get("providerId"))! } : {}),
        ...(stringValue(url.searchParams.get("groupId")) ? { groupId: stringValue(url.searchParams.get("groupId"))! } : {}),
        ...(stringValue(url.searchParams.get("model")) ? { modelContains: stringValue(url.searchParams.get("model"))! } : {}),
        ...(validStatus ? { status: validStatus } : okRaw === "true" ? { ok: true as const } : okRaw === "false" ? { ok: false as const } : {}),
        ...(validSource ? { source: validSource } : {}),
        ...(stringValue(url.searchParams.get("threadId")) ? { threadId: stringValue(url.searchParams.get("threadId"))! } : {}),
        ...(endpointRaw === "responses" || endpointRaw === "responses/compact" || endpointRaw === "messages" || endpointRaw === "chat/completions" || endpointRaw === "jev/evaluate" ? { endpoint: endpointRaw } : {}),
      }, {
        limit,
        ...(stringValue(url.searchParams.get("cursor")) ? { cursor: stringValue(url.searchParams.get("cursor"))! } : {}),
      });
      // 富化（对标 axonhub tokens/cost/duration 列）：按精确 turn 键 join 用量。
      // 禁止线程级回退：无 turnId 或 turn 无用量时保持未知，不把整线程用量重复
      // 挂到每条请求上（P0-2）。吞吐仅在 completed 且有生成耗时时按输出 Token 估算。
      try {
        const sums = requestUsageStore.sumForThreadTurns(scope.ownerId, page.entries.map((e) => ({ threadId: e.threadId, turnId: e.turnId })));
        const enriched = page.entries.map((entry) => {
          const key = `${entry.threadId ?? ""}\u0000${entry.turnId ?? ""}`;
          const sum = entry.turnId ? sums.get(key) : undefined;
          if (!sum) return entry;
          const total = sum.total ?? 0;
          const output = sum.output ?? 0;
          const input = sum.input ?? 0;
          const cachedRead = sum.cachedRead ?? 0;
          const cacheWrite = sum.cacheWrite ?? 0;
          const cacheHit = input > 0 ? Math.min(100, ((cachedRead + cacheWrite) / input) * 100) : 0;
          // 生成耗时 = latency - ttft（均为实测终态；直连未知延迟不估算）。
          const genMs = entry.latencyMs != null && entry.ttftMs != null
            ? entry.latencyMs - entry.ttftMs
            : null;
          const genSec = genMs != null && genMs > 0 ? genMs / 1000 : 0;
          return {
            ...entry,
            tokens: { total, input, output: sum.output ?? 0, cachedRead, cacheWrite: sum.cacheWrite ?? 0, reasoning: sum.reasoning ?? 0 },
            ...(sum.cost ? { costUsd: sum.cost } : {}),
            ...(sum.costBreakdown ? { costBreakdown: sum.costBreakdown } : {}),
            ...(genSec > 0 && output > 0 && entry.status === "completed" ? { tokensPerSecond: Math.round((output / genSec) * 10) / 10 } : {}),
            cacheHitRate: Math.round(cacheHit * 10) / 10,
          };
        });
        return jsonResponse({ data: { entries: enriched, nextCursor: page.nextCursor } }, 200, headers);
      } catch {
        return jsonResponse({ data: page }, 200, headers);
      }
    }
    // P4 词元/费用聚合（读 request_usage_ledger，对标 axonhub tokenStats/costStats）。
    case "GET /api/gateway/tokens/summary": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      return jsonResponse({ data: requestUsageStore.tokenSummary(scope.ownerId) }, 200, headers);
    }
    case "GET /api/gateway/tokens/daily": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const daysRaw = Number(url.searchParams.get("days") ?? "30");
      const days = Number.isFinite(daysRaw) ? daysRaw : 30;
      return jsonResponse({ data: requestUsageStore.tokenDaily(scope.ownerId, days) }, 200, headers);
    }
    case "GET /api/gateway/tokens/by": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const dimensionRaw = url.searchParams.get("dimension") ?? "model";
      if (dimensionRaw !== "provider" && dimensionRaw !== "group" && dimensionRaw !== "model" && dimensionRaw !== "owner") {
        return jsonResponse({ error: "Invalid dimension (provider|group|model|owner)" }, 400, headers);
      }
      const dimension = dimensionRaw as "provider" | "group" | "model" | "owner";
      const daysRaw = Number(url.searchParams.get("days") ?? "30");
      const days = Number.isFinite(daysRaw) ? daysRaw : 30;
      const limitRaw = Number(url.searchParams.get("limit") ?? "10");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
      return jsonResponse({
        data: requestUsageStore.tokenByDimension(scope.ownerId, dimension, days, limit)
      }, 200, headers);
    }
    // P5 Analytics 多维分析（对标 axonhub analyticsOverview/DailyStats/DimensionStats 子集）。
    // 过滤：startDate/endDate(YYYY-MM-DD, end含当天, 缺省近30天) + provider/group/model/owner 四维 AND。
    // 无 apiKey/project 概念，该两维直接忽略。非 admin 的 owner 作用域强制为自己。
    case "GET /api/gateway/analytics": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const modeRaw = url.searchParams.get("mode") ?? "overview";
      if (modeRaw !== "overview" && modeRaw !== "daily" && modeRaw !== "dimension") {
        return jsonResponse({ error: "Invalid mode (overview|daily|dimension)" }, 400, headers);
      }
      const dimensionRaw = url.searchParams.get("dimension") ?? "model";
      if (modeRaw === "dimension" && dimensionRaw !== "provider" && dimensionRaw !== "group" && dimensionRaw !== "model" && dimensionRaw !== "owner") {
        return jsonResponse({ error: "Invalid dimension (provider|group|model|owner)" }, 400, headers);
      }
      const { startMs, endMs } = parseAnalyticsRange(
        stringValue(url.searchParams.get("startDate")) ?? undefined,
        stringValue(url.searchParams.get("endDate")) ?? undefined
      );
      const filter = {
        startMs, endMs,
        ...(stringValue(url.searchParams.get("providerId")) ? { providerId: stringValue(url.searchParams.get("providerId"))! } : {}),
        ...(stringValue(url.searchParams.get("groupId")) ? { groupId: stringValue(url.searchParams.get("groupId"))! } : {}),
        ...(stringValue(url.searchParams.get("model")) ? { modelContains: stringValue(url.searchParams.get("model"))! } : {}),
        // admin 可按 ownerId 切分；普通用户 scope 已强制自己，忽略该参数。
        ...(scope.ownerId == null && stringValue(url.searchParams.get("ownerId")) ? { ownerId: stringValue(url.searchParams.get("ownerId"))! } : {}),
      };
      if (modeRaw === "overview") {
        return jsonResponse({ data: requestUsageStore.analyticsOverview(scope.ownerId, filter) }, 200, headers);
      }
      if (modeRaw === "daily") {
        return jsonResponse({ data: requestUsageStore.analyticsDaily(scope.ownerId, filter) }, 200, headers);
      }
      const limitRaw = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      return jsonResponse({
        data: requestUsageStore.analyticsDimension(scope.ownerId, filter, dimensionRaw as "provider" | "group" | "model" | "owner", limit)
      }, 200, headers);
    }
    // P6 性能榜（对标 axonhub fastestChannels/fastestModels 子集）。
    // throughput = 同维度输出 tokens / 网关总延迟秒数（输出口径，避免输入+缓存/TTFB
    // 虚高；分母仍为网关实测延迟上界，direct 未知延迟行已在聚合中排除）。
    case "GET /api/gateway/performance": {
      if (authStore && !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      const scope = authStore && user ? gatewayStatsScope(user, url.searchParams.get("userId")) : { ok: true as const, ownerId: null as string | null };
      if (!scope.ok) {
        return jsonResponse({ error: "Forbidden" }, 403, headers);
      }
      const dimensionRaw = url.searchParams.get("dimension") ?? "model";
      if (dimensionRaw !== "provider" && dimensionRaw !== "model") {
        return jsonResponse({ error: "Invalid dimension (provider|model)" }, 400, headers);
      }
      const daysRaw = Number(url.searchParams.get("days") ?? "30");
      const days = Number.isFinite(daysRaw) ? daysRaw : 30;
      const limitRaw = Number(url.searchParams.get("limit") ?? "5");
      const limit = Number.isFinite(limitRaw) ? limitRaw : 5;
      const perf = gatewayRequestStore.performanceByDimension(scope.ownerId, dimensionRaw as "provider" | "model", days, 50);
      const usageDays = Math.min(Math.max(Math.floor(days), 1), 90);
      const usageRows = requestUsageStore.tokenByDimension(
        scope.ownerId, dimensionRaw as "provider" | "model", usageDays, 100
      );
      const usageByName = new Map(usageRows.map((r) => [r.name, r.output]));
      const joined = perf.map((row) => {
        const tokensTotal = usageByName.get(row.name) ?? 0;
        const secs = row.totalLatencyMs > 0 ? row.totalLatencyMs / 1000 : 0;
        const throughput = secs > 0 && tokensTotal > 0 ? Math.round((tokensTotal / secs) * 10) / 10 : 0;
        return {
          ...row,
          tokensTotal,
          throughput,
          confidence: (row.requestCount >= 30 ? "high" : row.requestCount >= 10 ? "medium" : "low") as "high" | "medium" | "low",
        };
      });
      joined.sort((a, b) => b.throughput - a.throughput || b.requestCount - a.requestCount);
      return jsonResponse({ data: joined.slice(0, Math.min(Math.max(limit, 1), 50)) }, 200, headers);
    }
    case "POST /api/me/password": {
      if (!authStore || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        // Always require animated captcha for self-service password change.
        const captchaOk = securityStore.consumeCaptcha(stringValue(body.captchaId), stringValue(body.captchaAnswer));
        if (!captchaOk) {
          return jsonResponse({ error: "Invalid captcha" }, 401, headers);
        }
        const updated = await authStore.changeOwnPassword(
          user.id,
          stringValue(body.currentPassword) ?? stringValue(body.oldPassword) ?? "",
          stringValue(body.newPassword) ?? ""
        );
        return jsonResponse({ data: updated }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "GET /api/me": {
      if (!user) {
        return jsonResponse({ user: null }, 200, headers);
      }
      return jsonResponse({
        user: {
          ...user,
          allowedProviderIds: securityStore.getAllowedProviders(user.id)
        }
      }, 200, headers);
    }
    case "GET /api/launch-adapters": {
      // Host-local install detection; any authenticated session (or token mode) may read.
      return jsonResponse(detectAll(), 200, headers);
    }
    case "GET /api/launch-adapters/job-status": {
      const jobId = url.searchParams.get("jobId");
      if (!jobId) {
        return jsonResponse({ error: "Missing jobId parameter" }, 400, headers);
      }
      const job = getInstallJob(jobId);
      if (!job) {
        return jsonResponse({ error: `Job not found: ${jobId}` }, 404, headers);
      }
      return jsonResponse(job, 200, headers);
    }
    case "POST /api/launch-adapters/install": {
      // Mutates host filesystem (git clone, install.sh, ~/.config/*-launch/.env).
      // Prefer admin when membership is on; allow any authed session in token-only mode.
      if (authStore && user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: install launch adapters on the host" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((entry): entry is string => typeof entry === "string")
          : undefined;
        const envMode =
          body.envMode === "shared" || body.envMode === "separate" || body.envMode === "none"
            ? body.envMode
            : "none";
        const sharedEnv = parseLaunchEnv(body.sharedEnv);
        const separateEnv = parseSeparateLaunchEnv(body.separateEnv);
        const installRequest: InstallLaunchRequest = {
          ids,
          missingOnly: body.missingOnly === true || (!ids?.length && body.missingOnly !== false),
          skipCli: body.skipCli !== false,
          envMode,
          sharedEnv,
          separateEnv,
          forceEnv: body.forceEnv === true,
          sourceRoot: typeof body.sourceRoot === "string" ? body.sourceRoot : undefined,
          skipModelTest: body.skipModelTest === true
        };
        const jobId = createInstallJob(installRequest);
        return jsonResponse({ jobId, status: "running" }, 202, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/launch-adapters/test-model": {
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const values = parseLaunchEnv(body);
        if (!values) {
          return jsonResponse({ ok: false, message: "Missing baseUrl / model / apiKey" }, 400, headers);
        }
        const result = await testOpenAiApi(values);
        return jsonResponse(result, result.ok ? 200 : 400, headers);
      } catch (error) {
        return jsonResponse({ ok: false, message: errorToMessage(error) }, 400, headers);
      }
    }
    case "POST /api/launch-adapters/env": {
      if (authStore && user && user.role !== "admin") {
        return jsonResponse({ error: "Admin only: write launch adapter .env" }, 403, headers);
      }
      try {
        const body = asRecord(await request.json().catch(() => ({})));
        const mode = body.mode === "separate" ? "separate" : "shared";
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((entry): entry is string => typeof entry === "string")
          : undefined;
        const result = await writeEnvsOnly(
          mode,
          parseLaunchEnv(body.sharedEnv),
          parseSeparateLaunchEnv(body.separateEnv),
          ids,
          body.force === true
        );
        return jsonResponse({ ...result, adapters: detectAll().adapters }, 200, headers);
      } catch (error) {
        return jsonResponse({ error: errorToMessage(error) }, 400, headers);
      }
    }
    default: {
      // POST /api/members/:id/balance  admin allocate credit
      const balanceMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/balance$/);
      if (balanceMatch && request.method === "POST" && authStore) {
        if (!user || user.role !== "admin") {
          return jsonResponse({ error: "Admin only" }, 403, headers);
        }
        try {
          const memberId = decodeURIComponent(balanceMatch[1] ?? "");
          const body = asRecord(await request.json().catch(() => ({})));
          const operation = body.operation === "set" || body.operation === "add" || body.operation === "subtract" ? body.operation : "add";
          const amount = numberValue(body.amount) ?? numberValue(body.balance);
          if (amount === undefined) {
            return jsonResponse({ error: "amount is required" }, 400, headers);
          }
          const updated = authStore.adjustBalance(memberId, amount, operation, stringValue(body.notes) ?? "");
          return jsonResponse({ data: updated }, 200, headers);
        } catch (error) {
          return jsonResponse({ error: errorToMessage(error) }, 400, headers);
        }
      }
      const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/);
      if (memberMatch && authStore) {
        if (!user || user.role !== "admin") {
          return jsonResponse({ error: "Admin only" }, 403, headers);
        }
        const memberId = decodeURIComponent(memberMatch[1] ?? "");
        if (request.method === "PATCH") {
          try {
            const body = asRecord(await request.json().catch(() => ({})));
            const updated = await authStore.updateUser(memberId, {
              email: stringValue(body.email),
              username: stringValue(body.username),
              role: body.role === "admin" || body.role === "user" ? body.role : undefined,
              status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
              balance: numberValue(body.balance),
              concurrency: numberValue(body.concurrency),
              maxPermission:
                body.maxPermission === "readonlyAsk" ||
                body.maxPermission === "workspaceAsk" ||
                body.maxPermission === "fullAsk" ||
                body.maxPermission === "dangerBypass"
                  ? body.maxPermission
                  : undefined,
              allowWrite: typeof body.allowWrite === "boolean" ? body.allowWrite : undefined,
              allowNetwork: typeof body.allowNetwork === "boolean" ? body.allowNetwork : undefined,
              allowDangerBypass: typeof body.allowDangerBypass === "boolean" ? body.allowDangerBypass : undefined,
              notes: stringValue(body.notes),
              password: stringValue(body.password)
            });
            let allowedProviderIds = securityStore.getAllowedProviders(memberId);
            if (Array.isArray(body.allowedProviderIds)) {
              allowedProviderIds = securityStore.setAllowedProviders(
                memberId,
                body.allowedProviderIds.filter((entry): entry is string => typeof entry === "string")
              );
            }
            return jsonResponse({ data: { ...updated, allowedProviderIds } }, 200, headers);
          } catch (error) {
            return jsonResponse({ error: errorToMessage(error) }, 400, headers);
          }
        }
        if (request.method === "DELETE") {
          try {
            authStore.softDeleteUser(memberId);
            return jsonResponse({ ok: true }, 200, headers);
          } catch (error) {
            return jsonResponse({ error: errorToMessage(error) }, 400, headers);
          }
        }
      }
      return jsonResponse({ error: "Not found" }, 404, headers);
    }
  }
}

function projectClientId(ownerId: string, projectId: string): string {
  return `project:${ownerId}:${projectId}`;
}

type ProjectDispatchResult = {
  agentId: string;
  threadId: string;
  turnId: string | null;
  /** Event cursor captured before turn/start, used by notification-driven waits. */
  eventCursor?: number;
  ok: boolean;
  phase?: AgentProjectDiscussionPhase;
  providerId?: string | null;
  groupId?: string | null;
  model?: string | null;
  error?: string;
};

type ProjectDiscussionRun = {
  runId: string;
  ownerId: string;
  projectId: string;
  humanMessage: import("@codex-ui/shared").AgentProjectMessage;
  plan: ProjectDiscussionPlan;
  cancelled: boolean;
  phase: AgentProjectDiscussionPhase;
  activeTurns: Map<string, ProjectDispatchResult>;
  analysisAgentIds: string[];
  analysis: Map<string, string>;
  challenges: Array<{ reviewerId: string; subjectIds: string[]; text: string }>;
};

type ProjectTurnMetadata = {
  ownerId: string;
  projectId: string;
  agentId: string;
  phase: AgentProjectDiscussionPhase;
  providerId: string | null;
  groupId: string | null;
  model: string | null;
  threadId: string;
  runKey: string;
  runId: string;
  sequence: number;
  startedAt: number;
};

const projectDiscussionRuns = new Map<string, ProjectDiscussionRun>();
const projectTurnMetadata = new Map<string, ProjectTurnMetadata>();
let projectTurnSequence = 0;
const PROJECT_DISCUSSION_TURN_TIMEOUT_MS = 120_000;
const PROJECT_DISCUSSION_POLL_MS = 1_000;

class ProjectDiscussionCancelledError extends Error {
  public constructor() {
    super("Project discussion was cancelled");
    this.name = "ProjectDiscussionCancelledError";
  }
}

function emptyThreadAgentRoster(threadId: string): ThreadAgentRoster {
  return { threadId, roles: [], members: [], updatedAt: Date.now() };
}

function threadAgentClientId(ownerId: string, parentThreadId: string): string {
  return `thread-agent:${ownerId}:${parentThreadId}`;
}

function notifyThreadAgentRoster(user: AuthUser | null, roster: ThreadAgentRoster): void {
  notifyWorkbenchControl(user, {
    action: "agentRoster",
    threadId: roster.threadId,
    roster: roster as unknown as JsonValue
  });
}

function threadAgentOwnerUser(ownerId: string): AuthUser | null {
  return ownerId === "local" || !authStore ? null : authStore.getUser(ownerId);
}

function resolveThreadAgentRoute(
  ownerId: string,
  member: ThreadAgentMember,
  fallbackId?: string | null
): { providerId: string | null; groupId: string | null; model: string; reasoningEffort: string; workspace: ThreadAgentMember["workspace"]; fallbackId: string | null } {
  const parent = threadRuntimeMetadataStore.get(ownerId, member.parentThreadId);
  const role = threadAgentRosterStore.get(ownerId, member.parentThreadId)?.roles.find((entry) => entry.id === member.roleId);
  const fallback = fallbackId ? role?.fallbacks?.find((entry) => entry.id === fallbackId) : null;
  return {
    providerId: fallback?.providerId ?? role?.providerId ?? member.providerId ?? parent?.providerId ?? null,
    groupId: fallback?.groupId ?? role?.groupId ?? member.groupId ?? parent?.groupId ?? null,
    model: fallback?.model || role?.model || member.model || parent?.model || "",
    reasoningEffort: fallback?.reasoningEffort || role?.reasoningEffort || member.reasoningEffort || parent?.reasoningEffort || "medium",
    workspace: fallback?.workspace ?? role?.workspace ?? member.workspace,
    fallbackId: fallback?.id ?? null
  };
}

function threadAgentWorkspaceInput(ownerId: string, parentThreadId: string, workspace: ThreadAgentMember["workspace"]): Record<string, unknown> {
  const preferences = asRecord(userPreferencesStore.get(ownerId).workspace);
  const parentSsh = sshWorkspaceStore.get(parentThreadId);
  const inheritedCwd = parentSsh?.cwd
    ?? (stringValue(preferences.mode) === "ssh" ? stringValue(preferences.sshCwd) : stringValue(preferences.cwd));
  const cwd = workspace.cwd.trim() || inheritedCwd || process.cwd();
  if (workspace.workspaceMode === "ssh") {
    const sshCommand = workspace.sshCommand?.trim() || parentSsh?.command || stringValue(preferences.sshCommand) || "";
    if (!sshCommand) throw new Error("SSH agent workspace requires an SSH command");
    return { cwd, workspaceMode: "ssh", sshCommand, sshCwd: cwd };
  }
  return { cwd, workspaceMode: "local", runtimeWorkspaceRoots: [cwd, ...(workspace.additionalRoots ?? [])] };
}

async function startThreadAgentMember(
  ownerId: string,
  parentThreadId: string,
  memberId: string,
  user: AuthUser | null,
  fallbackId?: string | null
): Promise<ThreadAgentMember> {
  const member = threadAgentRosterStore.getMember(ownerId, parentThreadId, memberId);
  if (!member) throw new Error("Agent member not found");
  if (member.status === "exited") throw new Error("Exited agent member cannot be restarted; replace it first");
  if (member.runtime === "native") {
    return threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, {
      status: "active",
      health: healthyAgentMember(),
      activeFallbackId: null
    });
  }
  const parent = threadRuntimeMetadataStore.get(ownerId, parentThreadId);
  const route = resolveThreadAgentRoute(ownerId, member, fallbackId);
  if (!route.providerId) throw new Error("Agent providerId is required");
  if (!route.model) throw new Error("Agent model is required");
  threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, { status: "starting" });
  try {
    const workspaceInput = threadAgentWorkspaceInput(ownerId, parentThreadId, route.workspace);
    const runtime = parseWorkbenchRuntime({
      threadId: "pending",
      providerId: route.providerId,
      groupId: route.groupId,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
      permission: parent?.permission ?? "workspaceAsk",
      agents: { mode: "disabled", childCount: null, model: "", reasoningEffort: "", roles: [] }
    });
    const result = await withWorkbenchRuntime(runtime, user, async (activation) => {
      const params = workbenchThreadStartParams(workspaceInput, runtime, activation.modelProvider);
      params.model = activation.model ?? route.model;
      params.baseInstructions = [
        `你是主对话中的协作角色“${member.name}”。`,
        member.responsibility,
        `主对话线程：${parentThreadId}。完成任务时应返回结论、风险和下一步。`
      ].filter(Boolean).join("\n");
      const roots = workspaceInput.runtimeWorkspaceRoots;
      if (Array.isArray(roots)) params.runtimeWorkspaceRoots = roots as JsonValue;
      return executeCodexRpc({ user, clientId: threadAgentClientId(ownerId, parentThreadId), method: "thread/start", params });
    });
    const threadId = extractThreadId(result);
    if (!threadId) throw new Error("thread/start did not return an agent thread id");
    if (authStore && user) authStore.claimThread(threadId, user.id);
    threadRuntimeMetadataStore.put(ownerId, {
      threadId,
      providerId: route.providerId,
      groupId: route.groupId,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
      permission: parent?.permission ?? "workspaceAsk",
      agents: parseAgentRuntimeOverride({ mode: "disabled" })
    });
    return threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, {
      threadId,
      providerId: route.providerId,
      groupId: route.groupId,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
      workspace: route.workspace,
      activeFallbackId: route.fallbackId,
      status: "active",
      health: healthyAgentMember()
    });
  } catch (error) {
    const health = classifyAgentFailure(error, member.health);
    threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, {
      health,
      status: health.availability === "offline" ? "offline" : "failed"
    });
    throw error;
  }
}

async function interruptThreadAgentMember(ownerId: string, member: ThreadAgentMember, user: AuthUser | null): Promise<void> {
  if (!member.threadId) return;
  const clientId = threadAgentClientId(ownerId, member.parentThreadId);
  const turns = await readWorkbenchTurns(user, clientId, member.threadId);
  for (const turnId of runningTurnIds(turns)) {
    await executeCodexRpc({ user, clientId, method: "turn/interrupt", params: { threadId: member.threadId, turnId } });
  }
}

async function replaceThreadAgentWithFallback(
  ownerId: string,
  member: ThreadAgentMember,
  user: AuthUser | null,
  fallback: AgentRoleFallback
): Promise<ThreadAgentMember> {
  try { await interruptThreadAgentMember(ownerId, member, user); } catch { /* Preserve failover progress. */ }
  const replacement = threadAgentRosterStore.replaceMember(ownerId, member.parentThreadId, member.id);
  threadAgentRosterStore.patchMember(ownerId, member.parentThreadId, replacement.id, {
    providerId: fallback.providerId ?? null,
    groupId: fallback.groupId ?? null,
    model: fallback.model,
    reasoningEffort: fallback.reasoningEffort,
    workspace: fallback.workspace ?? member.workspace,
    activeFallbackId: fallback.id
  });
  return startThreadAgentMember(ownerId, member.parentThreadId, replacement.id, user, fallback.id);
}

async function tryThreadAgentFallback(ownerId: string, member: ThreadAgentMember): Promise<boolean> {
  const role = threadAgentRosterStore.get(ownerId, member.parentThreadId)?.roles.find((entry) => entry.id === member.roleId);
  const fallbacks = role?.fallbacks ?? [];
  const user = threadAgentOwnerUser(ownerId);
  let current = member;
  let lastError: unknown = null;
  while (true) {
    const currentIndex = current.activeFallbackId ? fallbacks.findIndex((entry) => entry.id === current.activeFallbackId) : -1;
    const fallback = fallbacks[currentIndex + 1];
    if (!fallback) {
      if (lastError) throw lastError;
      return false;
    }
    try {
      await replaceThreadAgentWithFallback(ownerId, current, user, fallback);
      const roster = threadAgentRosterStore.get(ownerId, current.parentThreadId);
      if (roster) notifyThreadAgentRoster(user, roster);
      return true;
    } catch (error) {
      lastError = error;
      const roster = threadAgentRosterStore.get(ownerId, current.parentThreadId);
      if (roster) notifyThreadAgentRoster(user, roster);
      const replacement = roster?.members
        .filter((entry) => entry.roleId === current.roleId && entry.instanceIndex === current.instanceIndex && entry.status !== "exited")
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      if (!replacement || replacement.id === current.id) throw error;
      current = replacement;
    }
  }
}

async function startThreadAgentMemberWithFallbacks(
  ownerId: string,
  parentThreadId: string,
  memberId: string,
  user: AuthUser | null,
  fallbackId?: string | null
): Promise<void> {
  try {
    await startThreadAgentMember(ownerId, parentThreadId, memberId, user, fallbackId);
  } catch (error) {
    const member = threadAgentRosterStore.getMember(ownerId, parentThreadId, memberId);
    if (!member || !await tryThreadAgentFallback(ownerId, member)) throw error;
  }
}

const threadAgentFallbackInFlight = new Set<string>();

async function handleThreadAgentFailure(threadId: string | null, value: unknown): Promise<void> {
  if (!threadId) return;
  const located = threadAgentRosterStore.getAnyByChildThread(threadId);
  if (!located) return;
  if (["paused", "draining", "exited"].includes(located.member.status)) return;
  const member = threadAgentRosterStore.recordFailureByThread(threadId, value);
  if (!member) return;
  const ownerId = located.ownerId;
  const user = threadAgentOwnerUser(ownerId);
  const roster = threadAgentRosterStore.get(ownerId, member.parentThreadId);
  if (roster) notifyThreadAgentRoster(user, roster);
  if (threadAgentFallbackInFlight.has(member.id)) return;
  threadAgentFallbackInFlight.add(member.id);
  try {
    await tryThreadAgentFallback(ownerId, member);
  } catch (error) {
    const currentRoster = threadAgentRosterStore.get(ownerId, member.parentThreadId);
    if (currentRoster) notifyThreadAgentRoster(user, currentRoster);
    console.warn("Failed to switch thread agent fallback", { threadId, memberId: member.id, error });
  } finally {
    threadAgentFallbackInFlight.delete(member.id);
  }
}

async function startImmediateThreadAgentMembers(ownerId: string, parentThreadId: string, user: AuthUser | null): Promise<void> {
  const roster = threadAgentRosterStore.get(ownerId, parentThreadId);
  if (!roster) return;
  for (const member of roster.members) {
    const role = roster.roles.find((entry) => entry.id === member.roleId);
    if (role?.startPolicy !== "immediate" || member.status !== "configured") continue;
    try { await startThreadAgentMemberWithFallbacks(ownerId, parentThreadId, member.id, user); } catch { /* Surface through roster health. */ }
  }
}

async function runThreadAgentMemberAction(
  ownerId: string,
  parentThreadId: string,
  memberId: string,
  action: string,
  user: AuthUser | null
): Promise<void> {
  const member = threadAgentRosterStore.getMember(ownerId, parentThreadId, memberId);
  if (!member) throw new Error("Agent member not found");
  if (action === "start" || action === "retry") {
    if (action === "retry" && member.health && await tryThreadAgentFallback(ownerId, member)) return;
    await startThreadAgentMemberWithFallbacks(ownerId, parentThreadId, memberId, user, member.activeFallbackId);
    return;
  }
  if (action === "replace") {
    const replacement = threadAgentRosterStore.replaceMember(ownerId, parentThreadId, memberId);
    await startThreadAgentMember(ownerId, parentThreadId, replacement.id, user);
    return;
  }
  if (action === "resume") {
    if (!member.threadId) {
      await startThreadAgentMember(ownerId, parentThreadId, memberId, user, member.activeFallbackId);
      return;
    }
    await executeCodexRpc({ user, clientId: threadAgentClientId(ownerId, parentThreadId), method: "thread/resume", params: { threadId: member.threadId } });
    threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, { status: "active", health: healthyAgentMember() });
    return;
  }
  if (action === "pause" || action === "exit" || action === "force-exit") {
    if (action !== "force-exit") await interruptThreadAgentMember(ownerId, member, user);
    else try { await interruptThreadAgentMember(ownerId, member, user); } catch { /* Force exit ignores interruption failure. */ }
    threadAgentRosterStore.patchMember(ownerId, parentThreadId, memberId, { status: action === "pause" ? "paused" : "exited" });
    return;
  }
  throw new Error(`Unsupported agent member action: ${action}`);
}

async function startProjectMembers(
  ownerId: string,
  project: import("@codex-ui/shared").AgentProject,
  user: AuthUser | null
): Promise<import("@codex-ui/shared").AgentProject> {
  if (project.agents.length < 2) {
    throw new ProjectDiscussionError("CUX-PROJECT-START-002", "CUX-PROJECT-START-002: a Project needs at least two members", 400);
  }
  assertProjectModelsAllowed(project.agents);
  const agents = project.agents.map((agent) => ({ ...agent }));
  const clientId = projectClientId(ownerId, project.id);
  for (const agent of agents) {
    const binding = projectRoomStore.listThreadBindings(ownerId, project.id).find((entry) => entry.agentId === agent.id);
    if (binding?.threadId || agent.threadId) {
      const threadId = binding?.threadId ?? agent.threadId!;
      if (!binding) projectRoomStore.bindThread(ownerId, project.id, agent.id, threadId);
      agent.threadId = threadId;
      agent.status = "active";
      subscriptionRegistry.watch(threadId, clientId);
      continue;
    }
    agent.status = "starting";
    projectRoomStore.setRuntime(ownerId, project.id, agents);
    try {
      const workspace = project.workspaces.find((entry) => agent.workspaceIds.includes(entry.id)) ?? project.workspaces[0];
      const cwd = workspace?.path?.trim() || process.cwd();
      const params: Record<string, JsonValue> = {
        cwd, sandbox: "workspace-write", approvalPolicy: "on-request", sessionStartSource: "startup", historyMode: "paginated",
        baseInstructions: [`你是公司项目“${project.name}”中的${agent.name}（${agent.role}）。`, agent.responsibility, agent.instructions, "每次回复应给出结论、风险和下一步；涉及决策时提出可投票议题。"].filter(Boolean).join("\n")
      };
      if (workspace?.mode === "ssh") {
        params.workspace = { type: "ssh", command: workspace.sshCommand ?? "", cwd, ...(agent.providerId ? { providerId: agent.providerId } : {}), ...(agent.groupId ? { groupId: agent.groupId } : {}) };
        params.remoteWorkspace = params.workspace;
      } else params.runtimeWorkspaceRoots = [cwd];
      const result = agent.providerId
        ? await runProviderActivationExclusive(async () => {
          const activation = await activateProvider(agent.providerId!, agent.model || undefined, agent.groupId || undefined);
          if (activation.model) params.model = activation.model;
          params.modelProvider = activation.modelProvider;
          agent.providerId = activation.providerId;
          agent.groupId = activation.groupId ?? agent.groupId;
          agent.model = activation.model ?? agent.model;
          assertProjectModelsAllowed([{ name: agent.name, model: agent.model }]);
          return await executeCodexRpc({ user, clientId, method: "thread/start", params: params as JsonValue });
        })
        : await executeCodexRpc({ user, clientId, method: "thread/start", params: params as JsonValue });
      const threadId = extractThreadId(result);
      if (!threadId) throw new Error("Codex did not return a thread id");
      agent.threadId = threadId;
      agent.status = "active";
      projectRoomStore.bindThread(ownerId, project.id, agent.id, threadId);
      threadRuntimeMetadataStore.put(ownerId, {
        threadId,
        providerId: agent.providerId,
        groupId: agent.groupId,
        model: stringValue(asRecord(params).model) ?? agent.model,
        reasoningEffort: normalizeProjectEffort(agent.reasoningEffort),
        permission: "fullAsk",
        agents: parseAgentRuntimeOverride(undefined)
      });
    } catch (error) {
      agent.status = "failed";
      projectRoomStore.appendMessage(ownerId, {
        projectId: project.id,
        agentId: agent.id,
        threadId: agent.threadId,
        turnId: null,
        itemId: `start-failed:${agent.id}`,
        kind: "system",
        text: `成员「${agent.name}」启动失败（${error instanceof ProjectDiscussionError ? error.code : "CUX-PROJECT-START-001"}）：${errorToMessage(error)}`
      });
      if (error instanceof ProjectDiscussionError) {
        projectRoomStore.setRuntime(ownerId, project.id, agents, "paused");
        throw error;
      }
    }
  }
  return projectRoomStore.setRuntime(
    ownerId,
    project.id,
    agents,
    agents.some((agent) => agent.status === "active") ? "active" : "paused"
  )!;
}

async function stopProjectMembers(
  ownerId: string,
  project: import("@codex-ui/shared").AgentProject,
  user: AuthUser | null,
  clientId: string
): Promise<void> {
  await cancelProjectDiscussion(ownerId, project.id, user);
  const bindings = projectRoomStore.listThreadBindings(ownerId, project.id);
  for (const binding of bindings) {
    try {
      const turns = await executeCodexRpc({
        user,
        clientId,
        method: "thread/turns/list",
        params: { threadId: binding.threadId, limit: 100 }
      });
      const running = runningTurnIds(turns)[0];
      if (running) {
        await executeCodexRpc({
          user,
          clientId,
          method: "turn/interrupt",
          params: { threadId: binding.threadId, turnId: running }
        });
      }
    } catch (error) {
      projectRoomStore.appendMessage(ownerId, {
        projectId: project.id,
        agentId: binding.agentId,
        threadId: binding.threadId,
        turnId: null,
        itemId: `pause-failed:${binding.agentId}`,
        kind: "system",
        text: `成员暂停失败（CUX-PROJECT-PAUSE-001）：${errorToMessage(error)}`
      });
    } finally {
      await subscriptionRegistry.close(binding.threadId);
      projectRoomStore.setMemberStatus(ownerId, project.id, binding.agentId, "paused");
    }
  }
}

async function dispatchProjectMessage(
  ownerId: string,
  projectId: string,
  humanMessage: AgentProjectMessage,
  user: AuthUser | null
): Promise<ProjectDispatchResult[]> {
  const project = projectRoomStore.get(ownerId, projectId);
  if (!project) throw new Error("Project not found");
  const runKey = projectClientId(ownerId, projectId);
  if (projectDiscussionRuns.has(runKey)) {
    throw new ProjectDiscussionError(
      PROJECT_DISCUSSION_ERROR_CODES.RUNNING,
      `${PROJECT_DISCUSSION_ERROR_CODES.RUNNING}: this Project already has an active discussion`,
      409
    );
  }
  assertProjectModelsAllowed(project.agents);
  const activeAgents = project.agents.filter((agent) => agent.threadId && agent.status === "active");
  if (activeAgents.length === 0) {
    projectRoomStore.appendMessage(ownerId, {
      projectId,
      agentId: null,
      threadId: null,
      turnId: null,
      itemId: `dispatch-empty:${humanMessage.id}`,
      kind: "system",
      text: "当前没有可用的在线成员（CUX-PROJECT-DISPATCH-002）。请检查成员状态或重新启动 Project。"
    });
    return [];
  }
  const plan = buildProjectDiscussionPlan(activeAgents);
  const clientId = projectClientId(ownerId, projectId);
  const run: ProjectDiscussionRun = {
    runId: randomBytes(12).toString("hex"),
    ownerId,
    projectId,
    humanMessage,
    plan,
    cancelled: false,
    phase: "analysis",
    activeTurns: new Map(),
    analysisAgentIds: activeAgents.map((agent) => agent.id),
    analysis: new Map(),
    challenges: []
  };
  projectDiscussionRuns.set(runKey, run);
  let analysisResults: ProjectDispatchResult[] = [];
  try {
    analysisResults = await startProjectPhase(run, project, user, "analysis");
    if (run.cancelled) {
      run.activeTurns.clear();
      return analysisResults;
    }
    run.activeTurns = new Map(analysisResults.filter((entry) => entry.ok).map((entry) => [entry.agentId, entry]));
    // The HTTP request only waits until turns are accepted. The remaining
    // rounds continue in the background and appear in the same timeline.
    void continueProjectDiscussion(run, user, clientId).catch((error) => {
      if (run.cancelled || error instanceof ProjectDiscussionCancelledError) return;
      appendDiscussionSystemMessage(run, `讨论未完成（${discussionErrorCode(error)}）：${errorToMessage(error)}`);
    });
    return analysisResults;
  } catch (error) {
    projectDiscussionRuns.delete(runKey);
    throw error;
  }
}

async function startProjectPhase(
  run: ProjectDiscussionRun,
  project: AgentProject,
  user: AuthUser | null,
  phase: AgentProjectDiscussionPhase,
  prompts?: Map<string, string>
): Promise<ProjectDispatchResult[]> {
  run.phase = phase;
  const clientId = projectClientId(run.ownerId, run.projectId);
  const results: ProjectDispatchResult[] = [];
  const agents = project.agents.filter((agent) => agent.threadId && agent.status === "active");
  for (const agent of agents) {
    if (run.cancelled) break;
    const threadId = agent.threadId!;
    const prompt = prompts
      ? prompts.get(agent.id)
      : projectDiscussionPrompt(run.ownerId, project, agent, run.humanMessage, phase);
    // A challenge turn is only meaningful when this reviewer received at
    // least one heterogeneous subject. Do not wake unrelated members.
    if (!prompt) continue;
    try {
      const started = await startProjectTurn(run, project, agent, threadId, prompt, phase, user, clientId);
      results.push(started);
    } catch (error) {
      if (run.cancelled || error instanceof ProjectDiscussionCancelledError) break;
      const text = `成员「${agent.name}」未能参加${discussionPhaseLabel(phase)}（CUX-PROJECT-DISPATCH-001）：${errorToMessage(error)}`;
      appendDiscussionSystemMessage(run, text, agent, phase);
      results.push({ agentId: agent.id, threadId, turnId: null, phase, providerId: agent.providerId, groupId: agent.groupId, model: agent.model || null, ok: false, error: text });
    }
  }
  return results;
}

async function startProjectTurn(
  run: ProjectDiscussionRun,
  project: AgentProject,
  agent: AgentProjectMember,
  threadId: string,
  prompt: string,
  phase: AgentProjectDiscussionPhase,
  user: AuthUser | null,
  clientId: string
): Promise<ProjectDispatchResult> {
  if (run.cancelled) throw new ProjectDiscussionCancelledError();
  const workspace = project.workspaces.find((entry) => agent.workspaceIds.includes(entry.id)) ?? project.workspaces[0];
  const cwd = workspace?.path?.trim() || process.cwd();
  const params: Record<string, JsonValue> = {
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    cwd,
    effort: normalizeProjectEffort(agent.reasoningEffort)
  };
  if (agent.model?.trim()) params.model = agent.model.trim();
  if (workspace?.mode === "ssh") {
    params.workspace = {
      type: "ssh",
      command: workspace.sshCommand ?? "",
      cwd,
      ...(agent.providerId ? { providerId: agent.providerId } : {}),
      ...(agent.groupId ? { groupId: agent.groupId } : {})
    };
  }
  let actualProviderId = agent.providerId;
  let actualGroupId = agent.groupId;
  let actualModel = agent.model?.trim() || null;
  const result = agent.providerId
    ? await runProviderActivationExclusive(async () => {
      if (run.cancelled) throw new ProjectDiscussionCancelledError();
      const activation = await activateProvider(agent.providerId!, agent.model || undefined, agent.groupId || undefined);
      if (run.cancelled) throw new ProjectDiscussionCancelledError();
      actualProviderId = activation.providerId;
      actualGroupId = activation.groupId ?? agent.groupId;
      actualModel = activation.model ?? agent.model?.trim() ?? null;
      assertProjectModelsAllowed([{ name: agent.name, model: actualModel ?? "" }]);
      threadRuntimeMetadataStore.put(run.ownerId, {
        threadId,
        providerId: actualProviderId,
        groupId: actualGroupId,
        model: actualModel ?? "",
        reasoningEffort: normalizeProjectEffort(agent.reasoningEffort),
        permission: "fullAsk",
        agents: parseAgentRuntimeOverride(undefined)
      });
      return executeCodexRpc({ user, clientId, method: "turn/start", params: { ...params, model: actualModel, modelProvider: activation.modelProvider } });
    })
    : await (async () => {
      const existing = threadRuntimeMetadataStore.get(run.ownerId, threadId);
      threadRuntimeMetadataStore.put(run.ownerId, {
        threadId,
        providerId: existing?.providerId ?? null,
        groupId: existing?.groupId ?? null,
        model: existing?.model ?? actualModel ?? "",
        reasoningEffort: normalizeProjectEffort(agent.reasoningEffort),
        permission: existing?.permission ?? "fullAsk",
        agents: existing?.agents ?? parseAgentRuntimeOverride(undefined)
      });
      actualProviderId = existing?.providerId ?? null;
      actualGroupId = existing?.groupId ?? null;
      actualModel = existing?.model || actualModel;
      assertProjectModelsAllowed([{ name: agent.name, model: actualModel ?? "" }]);
      return executeCodexRpc({ user, clientId, method: "turn/start", params });
    })();
  const turnId = extractTurnId(result, params);
  if (!turnId) throw new Error("Codex did not return a turn id");
  const dispatch: ProjectDispatchResult = { agentId: agent.id, threadId, turnId, phase, providerId: actualProviderId, groupId: actualGroupId, model: actualModel, ok: true };
  const turnKey = `${agent.id}:${phase}:${turnId}`;
  if (run.cancelled) {
    await interruptProjectTurn(dispatch, user, clientId);
    throw new ProjectDiscussionCancelledError();
  }
  run.activeTurns.set(turnKey, dispatch);
  projectTurnMetadata.set(turnId, {
    ownerId: run.ownerId,
    projectId: run.projectId,
    agentId: agent.id,
    phase,
    providerId: actualProviderId,
    groupId: actualGroupId,
    model: actualModel,
    threadId,
    runKey: projectClientId(run.ownerId, run.projectId),
    runId: run.runId,
    sequence: ++projectTurnSequence,
    startedAt: Date.now()
  });
  if (run.cancelled) {
    run.activeTurns.delete(turnKey);
    const metadata = projectTurnMetadata.get(turnId);
    if (metadata?.runId === run.runId) projectTurnMetadata.delete(turnId);
    await interruptProjectTurn(dispatch, user, clientId);
    throw new ProjectDiscussionCancelledError();
  }
  return dispatch;
}

async function interruptProjectTurn(
  dispatch: ProjectDispatchResult,
  user: AuthUser | null,
  clientId: string
): Promise<void> {
  if (!dispatch.turnId) return;
  try {
    await executeCodexRpc({
      user,
      clientId,
      method: "turn/interrupt",
      params: { threadId: dispatch.threadId, turnId: dispatch.turnId }
    });
  } catch {}
  subscriptionRegistry.removeTurnHold(dispatch.threadId, `turn:${dispatch.turnId}`);
  subscriptionRegistry.removeTurnHold(dispatch.threadId, `thread-active:${dispatch.threadId}`);
}

async function continueProjectDiscussion(run: ProjectDiscussionRun, user: AuthUser | null, clientId: string): Promise<void> {
  const project = projectRoomStore.get(run.ownerId, run.projectId);
  if (!project) throw new Error("Project not found");
  try {
    const analysisResults = [...run.activeTurns.values()].filter((entry) => entry.phase === "analysis");
    const analysisSettled = await Promise.allSettled(analysisResults.map(async (entry) => {
      const outcome = await waitForProjectTurn(run, entry, user, clientId);
      run.analysis.set(entry.agentId, outcome.text);
      appendDiscussionHandoff(run, entry, outcome.text, "analysis");
      return entry;
    }));
    for (const [index, settled] of analysisSettled.entries()) {
      if (settled.status === "rejected" && !(settled.reason instanceof ProjectDiscussionCancelledError)) {
        const entry = analysisResults[index];
        if (!entry) continue;
        const agent = project.agents.find((candidate) => candidate.id === entry.agentId);
        appendDiscussionSystemMessage(
          run,
          `成员「${agent?.name ?? entry.agentId}」独立分析失败（${discussionErrorCode(settled.reason)}）：${errorToMessage(settled.reason)}`,
          agent,
          "analysis"
        );
      }
    }
    if (run.cancelled) return;
    if (run.analysis.size === 0) {
      throw new ProjectDiscussionError(
        "CUX-PROJECT-DISPATCH-001",
        "CUX-PROJECT-DISPATCH-001: all member analysis turns failed",
        502
      );
    }
    run.activeTurns.clear();

    const challengePrompts = new Map<string, string>();
    for (const reviewer of project.agents) {
      const pairs = run.plan.byReviewer[reviewer.id] ?? [];
      const subjects = pairs.flatMap((pair) => {
        const text = run.analysis.get(pair.subjectId);
        const subject = project.agents.find((agent) => agent.id === pair.subjectId);
        return text && subject ? [{ subjectId: subject.id, name: subject.name, route: discussionRouteLabel(subject), text }] : [];
      });
      if (subjects.length === 0) continue;
      run.challenges.push({ reviewerId: reviewer.id, subjectIds: subjects.map((subject) => subject.subjectId), text: "" });
      challengePrompts.set(reviewer.id, [
        projectDiscussionPrompt(run.ownerId, project, reviewer, run.humanMessage, "challenge"),
        "请逐一质询下面这些异构路线成员的本轮分析。对每个对象指出可验证的漏洞、不同意之处、遗漏的企业风险，并给出可执行修正；不要重复泛泛赞同。",
        subjects.map((subject) => `质询对象：${subject.name}（${subject.subjectId}）\n实际路线：${subject.route}\n本轮分析：\n${subject.text}`).join("\n\n")
      ].join("\n\n"));
    }
    const challengeResults = await startProjectPhase(run, project, user, "challenge", challengePrompts);
    const challengeSettled = await Promise.allSettled(challengeResults.filter((candidate) => candidate.ok).map(async (entry) => {
      const outcome = await waitForProjectTurn(run, entry, user, clientId);
      const challenge = run.challenges.find((pair) => pair.reviewerId === entry.agentId);
      if (challenge) challenge.text = outcome.text;
      appendDiscussionHandoff(run, entry, outcome.text, "challenge", challenge?.subjectIds);
      return entry;
    }));
    for (const [index, settled] of challengeSettled.entries()) {
      if (settled.status === "rejected" && !(settled.reason instanceof ProjectDiscussionCancelledError)) {
        const successfulChallenges = challengeResults.filter((candidate) => candidate.ok);
        const entry = successfulChallenges[index];
        const agent = project.agents.find((candidate) => candidate.id === entry?.agentId);
        appendDiscussionSystemMessage(
          run,
          `成员「${agent?.name ?? entry?.agentId ?? "unknown"}」异构质询失败（${discussionErrorCode(settled.reason)}）：${errorToMessage(settled.reason)}`,
          agent,
          "challenge"
        );
      }
    }
    if (run.cancelled) return;
    run.activeTurns.clear();

    const coordinator = project.agents.find((agent) => agent.id === project.coordinatorAgentId) ?? project.agents.find((agent) => agent.role === "boss");
    if (!coordinator?.threadId || coordinator.status !== "active") throw new Error("Coordinator agent is offline");
    const synthesisPrompt = projectDiscussionPrompt(run.ownerId, project, coordinator, run.humanMessage, "synthesis") + "\n\n本轮各成员分析：\n" + [...run.analysis.entries()].map(([id, text]) => `${project.agents.find((agent) => agent.id === id)?.name ?? id}:\n${text}`).join("\n\n") + "\n\n异构质询摘要（以下为真实质询输出）：\n" + run.challenges.filter((entry) => entry.text.trim()).map((entry) => `${entry.reviewerId} 质询 ${entry.subjectIds.join(", ")}:\n${entry.text}`).join("\n\n");
    const synthesis = await startProjectTurn(run, project, coordinator, coordinator.threadId, synthesisPrompt, "synthesis", user, clientId);
    const outcome = await waitForProjectTurn(run, synthesis, user, clientId);
    appendDiscussionHandoff(run, synthesis, outcome.text, "synthesis");
  } catch (error) {
    if (!(error instanceof ProjectDiscussionCancelledError) && !run.cancelled) throw error;
  } finally {
    const runKey = projectClientId(run.ownerId, run.projectId);
    if (projectDiscussionRuns.get(runKey) === run) projectDiscussionRuns.delete(runKey);
    for (const [turnId, metadata] of projectTurnMetadata) {
      if (metadata.runKey === runKey && metadata.runId === run.runId) projectTurnMetadata.delete(turnId);
    }
  }
}

async function waitForProjectTurn(run: ProjectDiscussionRun, dispatch: ProjectDispatchResult, user: AuthUser | null, clientId: string): Promise<{ status: string; text: string }> {
  if (!dispatch.turnId) throw new ProjectDiscussionError(PROJECT_DISCUSSION_ERROR_CODES.TIMEOUT, `${PROJECT_DISCUSSION_ERROR_CODES.TIMEOUT}: turn was not created`, 504);
  const startedAt = projectTurnMetadata.get(dispatch.turnId)?.startedAt ?? Date.now();
  const deadline = Date.now() + PROJECT_DISCUSSION_TURN_TIMEOUT_MS;
  while (!run.cancelled && Date.now() < deadline) {
    const upstreamFailure = projectTurnPermanentFailure(dispatch.threadId, dispatch.turnId, startedAt);
    if (upstreamFailure) {
      await interruptProjectTurn(dispatch, user, clientId);
      throw new ProjectDiscussionError(
        PROJECT_DISCUSSION_ERROR_CODES.UPSTREAM,
        `${PROJECT_DISCUSSION_ERROR_CODES.UPSTREAM}: ${upstreamFailure}`,
        502
      );
    }
    const terminalTurn = projectTurnTerminalEvent(dispatch.threadId, dispatch.turnId, startedAt);
    if (terminalTurn) {
      const status = stringValue(terminalTurn.status)?.toLowerCase().replace(/[_-]/g, "") ?? "";
      if (["completed", "complete", "done"].includes(status)) return { status, text: projectTurnText(terminalTurn) || "（本轮没有文本输出）" };
      if (["failed", "error", "errored"].includes(status)) throw new ProjectDiscussionError("CUX-PROJECT-THREAD-001", `CUX-PROJECT-THREAD-001: ${projectTurnErrorText(terminalTurn) || "成员 turn 失败"}`, 502);
      if (["interrupted", "cancelled", "canceled"].includes(status)) throw new ProjectDiscussionError("CUX-PROJECT-PAUSE-001", "CUX-PROJECT-PAUSE-001: 成员 turn 被中断", 409);
    }
    let result: JsonValue;
    try {
      result = await executeCodexRpc({ user, clientId, method: "thread/turns/list", params: { threadId: dispatch.threadId, limit: 100 } });
    } catch (error) {
      if (!isTransientProjectTurnReadError(error) && !isUnsupportedProjectTurnListError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, PROJECT_DISCUSSION_POLL_MS));
      continue;
    }
    const turn = projectTurnFromResult(result, dispatch.turnId);
    if (turn) {
      const statusValue = typeof turn.status === "string" ? turn.status : stringValue(asRecord(turn.status).type);
      const status = (statusValue ?? "").toLowerCase().replace(/[_-]/g, "");
      if (["completed", "complete", "done"].includes(status)) return { status, text: projectTurnText(turn) || "（本轮没有文本输出）" };
      if (["failed", "error", "errored"].includes(status)) throw new ProjectDiscussionError("CUX-PROJECT-THREAD-001", `CUX-PROJECT-THREAD-001: ${projectTurnErrorText(turn) || "成员 turn 失败"}`, 502);
      if (["interrupted", "cancelled", "canceled"].includes(status)) throw new ProjectDiscussionError("CUX-PROJECT-PAUSE-001", "CUX-PROJECT-PAUSE-001: 成员 turn 被中断", 409);
    }
    await new Promise((resolve) => setTimeout(resolve, PROJECT_DISCUSSION_POLL_MS));
  }
  if (run.cancelled) throw new ProjectDiscussionCancelledError();
  throw new ProjectDiscussionError(PROJECT_DISCUSSION_ERROR_CODES.TIMEOUT, `${PROJECT_DISCUSSION_ERROR_CODES.TIMEOUT}: member turn timed out after ${PROJECT_DISCUSSION_TURN_TIMEOUT_MS}ms`, 504);
}

function projectTurnPermanentFailure(threadId: string, turnId: string, startedAt: number): string | null {
  const event = codexApiEvents.findLatest((candidate) => {
    if (candidate.kind !== "notification" || candidate.threadId !== threadId || candidate.recordedAt < startedAt) return false;
    const payload = asRecord(candidate.payload);
    const params = asRecord(payload.params);
    return stringValue(payload.method) === "error" && stringValue(params.turnId) === turnId;
  });
  if (!event) return null;
  const params = asRecord(asRecord(event.payload).params);
  return permanentProjectTurnErrorMessage(params.error);
}

function projectTurnTerminalEvent(threadId: string, turnId: string, startedAt: number): Record<string, unknown> | null {
  const event = codexApiEvents.findLatest((candidate) => {
    if (candidate.kind !== "notification" || candidate.threadId !== threadId || candidate.recordedAt < startedAt) return false;
    const payload = asRecord(candidate.payload);
    const params = asRecord(payload.params);
    const eventTurn = asRecord(params.turn);
    const eventTurnId = stringValue(eventTurn.id) ?? stringValue(params.turnId);
    const method = stringValue(payload.method) ?? "";
    return eventTurnId === turnId && /turn\/(?:completed|failed|error|interrupted)$/.test(method);
  });
  if (!event) return null;
  const payload = asRecord(event.payload);
  const params = asRecord(payload.params);
  const turn = asRecord(params.turn);
  if (Object.keys(turn).length > 0) return turn;
  const method = stringValue(payload.method) ?? "";
  const status = method.split("/").at(-1) ?? "failed";
  return { id: turnId, status, error: params.error ?? params.message };
}

function projectTurnFromResult(result: JsonValue, turnId: string): Record<string, unknown> | null {
  const record = asRecord(result);
  const thread = asRecord(record.thread);
  const turns = Array.isArray(record.turns)
    ? record.turns
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(thread.turns) ? thread.turns : [];
  return turns.map(asRecord).find((turn) => stringValue(turn.id) === turnId) ?? null;
}

function projectTurnText(turn: Record<string, unknown>): string {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const message = [...items].reverse().map(asRecord).find((item) => stringValue(item.type) === "agentMessage");
  return message ? projectNotificationText(message) : projectNotificationText(turn);
}

function projectDiscussionPrompt(ownerId: string, project: AgentProject, agent: AgentProjectMember, humanMessage: AgentProjectMessage, phase: AgentProjectDiscussionPhase): string {
  const timeline = projectRoomStore.listMessages(ownerId, project.id, 50, 0);
  const recent = timeline.length ? timeline : [];
  const context = recent.map((entry) => entry.text).join("\n");
  const phaseInstruction = phase === "analysis" ? "独立分析老板议题" : phase === "challenge" ? "进行跨渠道、跨分组、跨模型的同行质询" : "作为老板汇总并做出决策建议";
  return [`你正在参加公司项目「${project.name}」的统一群聊。你的角色是${agent.name}（${agent.role}）。`, agent.responsibility, agent.instructions, `当前阶段：${phaseInstruction}。`, "只代表自己的角色发言；回复包含结论、证据、风险、阻塞和下一步。涉及代码写入、部署、账单、合规或客户承诺时，先提出可投票议题。", context ? `历史上下文：\n${context}` : "", `人类老板最新消息：${humanMessage.text}`].filter(Boolean).join("\n\n");
}

function appendDiscussionHandoff(run: ProjectDiscussionRun, dispatch: ProjectDispatchResult, text: string, phase: AgentProjectDiscussionPhase, subjectIds?: string[]): void {
  const subjects = subjectIds?.filter(Boolean) ?? [];
  projectRoomStore.appendMessage(run.ownerId, { projectId: run.projectId, agentId: dispatch.agentId, threadId: dispatch.threadId, turnId: dispatch.turnId, itemId: `handoff:${run.humanMessage.id}:${phase}:${dispatch.agentId}:${subjects.join(",") || "all"}`, kind: "handoff", phase, providerId: dispatch.providerId, groupId: dispatch.groupId, model: dispatch.model, text: `[${discussionPhaseLabel(phase)}] ${subjects.length ? `质询对象：${subjects.join(", ")}\n` : ""}${text}` });
}

function appendDiscussionSystemMessage(run: ProjectDiscussionRun, text: string, agent?: AgentProjectMember, phase?: AgentProjectDiscussionPhase): void {
  projectRoomStore.appendMessage(run.ownerId, { projectId: run.projectId, agentId: agent?.id ?? null, threadId: agent?.threadId ?? null, turnId: null, itemId: `discussion-system:${run.humanMessage.id}:${phase ?? run.phase}:${agent?.id ?? "global"}:${Date.now()}`, kind: "system", phase, providerId: agent?.providerId, groupId: agent?.groupId, model: agent?.model || null, text });
}

function discussionPhaseLabel(phase: AgentProjectDiscussionPhase): string {
  return phase === "analysis" ? "独立分析" : phase === "challenge" ? "异构交叉质询" : "老板汇总";
}

function discussionErrorCode(error: unknown): string {
  return error instanceof ProjectDiscussionError ? error.code : "CUX-PROJECT-DISPATCH-001";
}

async function cancelProjectDiscussion(ownerId: string, projectId: string, user: AuthUser | null): Promise<void> {
  const runKey = projectClientId(ownerId, projectId);
  const run = projectDiscussionRuns.get(runKey);
  if (!run) return;
  run.cancelled = true;
  if (projectDiscussionRuns.get(runKey) === run) projectDiscussionRuns.delete(runKey);
  const turns = new Map<string, ProjectDispatchResult>();
  for (const entry of run.activeTurns.values()) if (entry.turnId) turns.set(entry.turnId, entry);
  for (const [turnId, metadata] of projectTurnMetadata) {
    if (metadata.runKey === runKey && metadata.runId === run.runId) {
      turns.set(turnId, { agentId: metadata.agentId, threadId: metadata.threadId, turnId, phase: metadata.phase, providerId: metadata.providerId, groupId: metadata.groupId, model: metadata.model, ok: true });
    }
  }
  run.activeTurns.clear();
  await Promise.all([...turns.values()].map(async (entry) => {
    await interruptProjectTurn(entry, user, runKey);
    if (!entry.turnId) return;
    const metadata = projectTurnMetadata.get(entry.turnId);
    if (metadata?.runId === run.runId) projectTurnMetadata.delete(entry.turnId);
  }));
}

function extractTurnId(result: JsonValue, params: Record<string, JsonValue>): string | null {
  const record = asRecord(result);
  return stringValue(record.turnId)
    ?? stringValue(asRecord(record.turn).id)
    ?? stringValue(record.id)
    ?? stringValue(params.turnId)
    ?? null;
}

function normalizeProjectEffort(value: string): string {
  const effort = value.trim().toLowerCase();
  return effort || "medium";
}

/**
 * Resolves an advanced cross-channel model mapping rule for the incoming
 * request. Returns the rewritten (provider, group, request, targetModel) when
 * a rule matches, otherwise undefined. In-group rewrites (rules without a
 * targetProviderId/targetGroupId) are not handled here — those remain the
 * responsibility of the legacy `resolveMappedModel` path because they only
 * change the model string within the current dispatch.
 *
 * Cycle safety: the resolved ExplicitTarget is only one hop (the gateway does
 * not re-run advanced resolution against the target group), so a request can
 * only cross channels once per gateway entry. Chains composed across groups
 * would require the target group's own advanced rules to fire on its own
 * incoming requests, which is the intended per-group semantics.
 */
async function resolveAdvancedModelDispatch(
  request: Request,
  provider: ProviderConfig,
  group: ChannelGroupConfig | undefined
): Promise<{ provider: ProviderConfig; group: ChannelGroupConfig; request: Request } | undefined> {
  const rules = group?.advancedModelMapping;
  if (!rules || rules.length === 0 || !group) return undefined;
  const body = asRecord(await request.clone().json().catch(() => ({})));
  const rawModel = stringValue(body.model) ?? "";
  if (!rawModel) return undefined;
  const baseModel = stripModelContextVariant(rawModel).baseModel;
  const rule = rules.find((entry) => (entry.enabled ?? true) && (entry.requestModel === rawModel || entry.requestModel === baseModel));
  if (!rule) return undefined;
  // Only true cross-channel/cross-group re-dispatch is handled here. Rules
  // that only rewrite the model within the current group are left to the
  // legacy in-group path to avoid double rewriting.
  const crossChannel = Boolean(rule.targetProviderId && rule.targetProviderId !== provider.id);
  const crossGroup = Boolean(rule.targetGroupId && rule.targetGroupId !== group.id);
  if (!crossChannel && !crossGroup) return undefined;
  const targetProviderId = rule.targetProviderId ?? provider.id;
  const targetGroupId = rule.targetGroupId ?? group.id;
  const targetProvider = await providerStore.get(targetProviderId);
  const targetGroup = targetProvider?.groups?.find((entry) => entry.id === targetGroupId);
  if (!targetProvider || !targetGroup || targetGroup.status === "disabled" || targetGroup.kind === "image") {
    console.warn("[advanced-mapping] rule target not found, ignoring rule", { requestModel: rule.requestModel, targetProviderId, targetGroupId });
    return undefined;
  }
  const rewrittenRequest = await rewriteRelayRequestModel(request, rule.targetModel);
  return { provider: targetProvider, group: targetGroup, request: rewrittenRequest };
}

/**
 * 对外 /v1 转发的模型库存: 仅共享 OpenCode 本地免费模型
 * (v1/v2 分组中经 isOpencodeFreeModel 过滤的 opencode/* 免费模型)。
 */
async function listForwardModelInventory(): Promise<ForwardModelInventory[]> {
  const inventory: ForwardModelInventory[] = [];
  for (const provider of await providerStore.list()) {
    // 仅保留 opencode-local, 严格跳过其他全部中转站与回环站
    if (provider.id !== OPENCODE_OFFICIAL_PROVIDER_ID) continue;
    for (const group of provider.groups ?? []) {
      // v1/v2 双分组各自贡献免费模型, 不再限定 default 分组
      // 过滤口径统一为 isOpencodeFreeModel (含 big-pickle 与 *-free/:free), 与探针/网桥一致 (JEV-a)。
      if (!group || group.kind === "image" || group.status === "disabled") continue;
      const models = [...new Set((group.models ?? provider.nativeModels)
        .map((model) => stripModelContextVariant(model).baseModel)
        .filter((m) => isOpencodeFreeModel(m)))];
      if (models.length === 0) continue;
      inventory.push({ providerId: provider.id, groupId: group.id, models });
    }
  }
  return inventory;
}

/**
 * 对外 /v1 转发的 CLI 网桥解析 (禁透传: 一律经选中 CLI 发送)。
 * claude 懒加载常驻单例 (ownerId=forward, 与用户线程隔离; 禁止按次建桥,
 * 否则 CodeCliBridge 进程泄漏); 其余走常驻单例。
 * 返回 null 表示该后端未启用, 由调用方转 502。
 */
let forwardClaudeBridge: CodeCliBridge | null = null;
async function resolveForwardBridge(cli: CliBackend): Promise<ForwardBridge | null> {
  switch (cli) {
    case "codex":
      return isCliPluginEnabled("codex") ? bridge : null;
    case "mini":
      return miniBridge;
    case "opencode":
      return isCliPluginEnabled("opencode") ? opencodeBridge : null;
    case "opencode-v2":
      return isCliPluginEnabled("opencode-v2") ? opencodeV2Bridge : null;
    case "pi":
      return isCliPluginEnabled("pi") ? piBridge : null;
    case "grok":
      return isCliPluginEnabled("grok") ? grokBridge : null;
    case "muse":
      return isCliPluginEnabled("muse") ? museBridge : null;
    case "agy":
      return isCliPluginEnabled("agy") ? agyBridge : null;
    case "auggie":
      return isCliPluginEnabled("auggie") ? auggieBridgeFor(null) : null;
    case "cline":
      return isCliPluginEnabled("cline") ? clineBridgeFor(null) : null;
    case "command-code":
      return isCliPluginEnabled("command-code") ? commandCodeBridgeFor(null) : null;
    case "claude": {
      if (!isCliPluginEnabled("claude")) return null;
      if (!forwardClaudeBridge) {
        forwardClaudeBridge = await createClaudeBridge({ ownerId: "forward" });
      }
      return forwardClaudeBridge;
    }
    default:
      return null;
  }
}

/**
 * 网关统计作用域：与 /api/usage/summary 同口径——普通用户只能看自己，
 * admin 可传 userId 看指定人，不传看全部。
 */
function gatewayStatsScope(user: AuthUser, filterUserId: string | null): { ok: true; ownerId: string | null } | { ok: false } {
  if (user.role === "admin") {
    return { ok: true, ownerId: filterUserId ? filterUserId : null };
  }
  if (filterUserId && filterUserId !== user.id) return { ok: false };
  return { ok: true, ownerId: user.id };
}

/**
 * P1 网关请求落库（对标 axonhub `requests` 表的调用级记录）。
 * 终态在流结束/非流响应头时结算：SSE 流包装 body，首个 chunk 标 TTFT，
 * 流正常结束按是否出现失败事件结算，流中断/取消标 failed/canceled；
 * 非流 JSON 仍在响应头结算（headers≈complete）。落库失败只 warn，绝不阻断转发。
 */
async function runGatewayRequestWithLog(options: {
  endpoint: GatewayRequestEndpoint;
  request: Request;
  providerId: string;
  groupId: string;
  ownerId: string;
  threadId?: string;
  turnId?: string;
  run: () => Promise<Response>;
}): Promise<Response> {
  const startedAt = Date.now();
  let loggedId: string | null = null;
  try {
    // 只解析小请求体的 model/stream 字段；大 body（compaction 长输入等）
    // 跳过解析，绝不把完整 body 常驻内存。
    const contentLength = Number(options.request.headers.get("content-length") ?? "0");
    const skipParse = Number.isFinite(contentLength) && contentLength > 524288;
    const body = skipParse
      ? null
      : await options.request.clone().json().catch(() => null) as Record<string, unknown> | null;
    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    // source 透传：调用方经 x-axon-source / x-source 声明 playground/test，否则默认 api。
    const sourceHeader = (options.request.headers.get("x-axon-source") ?? options.request.headers.get("x-source") ?? "").toLowerCase();
    const source = sourceHeader === "playground" || sourceHeader === "test" || sourceHeader === "api" ? sourceHeader : "api";
    loggedId = gatewayRequestStore.begin({
      ownerId: options.ownerId,
      ...(options.threadId ? { threadId: options.threadId } : {}),
      ...(options.turnId ? { turnId: options.turnId } : {}),
      endpoint: options.endpoint,
      providerId: options.providerId,
      groupId: options.groupId,
      ...(model ? { model } : {}),
      ...(body?.stream === true ? { stream: true } : {}),
      startedAt,
      status: "pending",
      source,
    }).id;
  } catch (error) {
    console.warn("[gateway-requests] begin log failed", error instanceof Error ? error.message : String(error));
  }
  const finishOk = (id: string, upstreamStatus: number, ok: boolean, error?: string): void => {
    try {
      gatewayRequestStore.finish(id, { upstreamStatus, ok, ...(error ? { error } : {}) });
    } catch (err) {
      console.warn("[gateway-requests] finish log failed", err instanceof Error ? err.message : String(err));
    }
  };
  try {
    const response = await options.run();
    if (!loggedId) return response;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    // 仅 SSE 按流结算：收紧判定，避免把 octet-stream 等二进制按 SSE 包装。
    const isStream = contentType.includes("text/event-stream");
    // 非流：响应头即终态（无后续失败事件）。
    if (!isStream || !response.body || !response.ok) {
      // HTTP 200 + response.failed 的 SSE 失败流走下方包装；此处非流 200 即完成，
      // 非 2xx 即失败（上游状态码原样落库，映射前的原始码由网关层保留）。
      if (!isStream) {
        gatewayRequestStore.markFirstToken(loggedId);
        finishOk(loggedId, response.status, response.ok);
        return response;
      }
      // 流式但上游已非 2xx：无 body 可结算，直接失败。
      gatewayRequestStore.markFirstToken(loggedId);
      finishOk(loggedId, response.status, false);
      return response;
    }
    // SSE 流：包装透传，首 chunk 标 TTFT，终态按流内失败事件/中断结算。
    const id = loggedId;
    const upstreamStatus = response.status;
    let settled = false;
    let sawFirstChunk = false;
    let sawFailure = false;
    const settle = (ok: boolean, error?: string): void => {
      if (settled) return;
      settled = true;
      finishOk(id, upstreamStatus, ok, error);
    };
    const checkFailure = (chunk: Uint8Array): void => {
      if (sawFailure) return;
      // 有界嗅探（首 4KB 足够覆盖事件名；避免全流解码常驻内存）。
      const len = Math.min(chunk.length, 4096);
      let text = "";
      try {
        text = new TextDecoder().decode(chunk.slice(0, len));
      } catch {
        return;
      }
      if (text.includes("response.failed") || text.includes('"status":"failed"') || text.includes('"status": "failed"')) {
        sawFailure = true;
      }
    };
    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        upstreamReader = reader;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              // 空流（无首 chunk）按失败结算，避免“0 字节 200”被计为成功。
              if (!sawFirstChunk) {
                settle(false, "upstream empty stream");
              } else {
                settle(!sawFailure, sawFailure ? "upstream response.failed" : undefined);
              }
              controller.close();
              return;
            }
            if (value && value.length > 0) {
              if (!sawFirstChunk) {
                sawFirstChunk = true;
                try {
                  gatewayRequestStore.markFirstToken(id);
                } catch {
                  // 忽略标记失败，终态仍可结算。
                }
              }
              checkFailure(value);
            }
            controller.enqueue(value!);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const canceled = /abort|cancel|close/i.test(msg) || options.request.signal.aborted;
          try {
            if (canceled) {
              gatewayRequestStore.cancel(id, msg);
              settled = true;
            } else {
              settle(false, msg);
            }
          } catch {
            // 忽略二次结算失败。
          }
          controller.error(error);
        } finally {
          reader.releaseLock();
          upstreamReader = null;
        }
      },
      cancel(reason) {
        try {
          void upstreamReader?.cancel(reason).catch(() => undefined);
          gatewayRequestStore.cancel(id, reason instanceof Error ? reason.message : String(reason ?? "canceled"));
          settled = true;
        } catch {
          // 忽略取消标记失败。
        }
      },
    });
    // 透传流长度未知：删除 content-length，避免下游按错误长度截断。
    const passthroughHeaders = new Headers(response.headers);
    passthroughHeaders.delete("content-length");
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: passthroughHeaders });
  } catch (error) {
    if (loggedId) {
      try {
        gatewayRequestStore.finish(loggedId, { ok: false, error: error instanceof Error ? error.message : String(error) });
      } catch (logError) {
        console.warn("[gateway-requests] error log failed", logError instanceof Error ? logError.message : String(logError));
      }
    }
    throw error;
  }
}

async function handleRelayGatewayRequest(request: Request, url: URL, security: Headers, server: RuntimeServer<SocketData>): Promise<Response> {
  const remoteAddress = server.requestIP(request)?.address;
  if (remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) {
    return jsonResponse({ error: "Relay gateway is available only through loopback" }, 403, security);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  const isLoopback = !remoteAddress || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
  const gatewayCredential = isLoopback || authorization === `Bearer ${relayGatewayToken}` || request.headers.get("x-api-key") === relayGatewayToken;
  if (!gatewayCredential) {
    return jsonResponse({ error: "Unauthorized relay gateway request" }, 401, security);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const isModels = request.method === "GET" && parts[0] === "api" && parts[1] === "relay-gateway"
    && parts[4] === "v1" && parts[5] === "models" && parts.length === 6;
  if (isModels) {
    const providerId = decodeURIComponent(parts[2] ?? "");
    const groupId = decodeURIComponent(parts[3] ?? "");
    const provider = await providerStore.get(providerId);
    // 兼容旧 default/free 分组: opencode-local 已收敛为 v1/v2。
    const effectiveGroupId = provider?.id === OPENCODE_OFFICIAL_PROVIDER_ID ? resolveOpencodeLocalGroupId(groupId) : groupId;
    const group = provider?.groups?.find((entry) => entry.id === effectiveGroupId);
    if (!provider || !group || group.kind === "image" || group.status === "disabled") {
      return jsonResponse({ error: "Relay provider or text group not found" }, 404, security);
    }
    const models = [...new Set((group.models ?? provider.nativeModels)
      .map((model) => stripModelContextVariant(model).baseModel)
      .filter(Boolean))];
    // Surface advanced mapping requestModels so clients can request a
    // cross-channel alias from this group's models endpoint.
    for (const rule of group.advancedModelMapping ?? []) {
      if ((rule.enabled ?? true) && rule.requestModel && !models.includes(rule.requestModel)) {
        models.push(stripModelContextVariant(rule.requestModel).baseModel || rule.requestModel);
      }
    }
    return jsonResponse({
      object: "list",
      data: models.map((id) => ({ id, object: "model", created: 0, owned_by: "codex-ultra" }))
    }, 200, security);
  }
  const isMessages = url.pathname.endsWith("/messages");
  const isResponses = url.pathname.endsWith("/responses");
  const isResponsesCompact = url.pathname.endsWith("/responses/compact");
  const isChat = url.pathname.endsWith("/chat/completions");
  const isJev = url.pathname.endsWith("/jev/evaluate");
  if (request.method !== "POST" || (!isMessages && !isResponses && !isResponsesCompact && !isChat && !isJev)) {
    return jsonResponse({ error: "Relay gateway only accepts GET /v1/models or POST /v1/messages, /v1/responses, /v1/responses/compact, /v1/chat/completions, /v1/jev/evaluate" }, 404, security);
  }
  const validPrefix = parts[0] === "api" && parts[1] === "relay-gateway" && parts[4] === "v1" && (parts[5] === "responses" || parts[5] === "messages" || parts[5] === "chat" || parts[5] === "jev");
  if (!validPrefix || (isMessages ? parts.length !== 6 || parts[5] !== "messages" : isResponses ? parts.length !== 6 : isResponsesCompact ? parts.length !== 7 || parts[6] !== "compact" : isJev ? parts.length !== 7 || parts[5] !== "jev" || parts[6] !== "evaluate" : parts.length !== 7 || parts[6] !== "completions")) {
    return jsonResponse({ error: "Malformed relay gateway path" }, 404, security);
  }
  const fallbackProviderId = decodeURIComponent(parts[2] ?? "");
  const fallbackGroupId = decodeURIComponent(parts[3] ?? "");
  // Codex keeps a model provider snapshot for the lifetime of a loaded thread,
  // so config hot reload alone cannot switch an existing conversation. Every
  // Responses request includes its session/thread id, however. Resolve the
  // latest UI runtime selection here so the next turn can change relay/group
  // without recreating the Codex thread (and therefore without losing history).
  const compactionRequest = await inspectCompactionRelayRequest(request);
  const routingHeaders = new Headers(request.headers);
  if (compactionRequest.threadId && !routingHeaders.has("session-id") && !routingHeaders.has("thread-id")) {
    routingHeaders.set("thread-id", compactionRequest.threadId);
  }
  let runtimeOwnerId = "local";
  const target = resolveRelayGatewayTarget(routingHeaders, { providerId: fallbackProviderId, groupId: fallbackGroupId }, (threadId) => {
    const ownerId = resolveRelayRuntimeOwnerId(threadId, Boolean(authStore), (id) => authStore?.threadOwnerId(id) ?? null);
    if (!ownerId) {
      return null;
    }
    runtimeOwnerId = ownerId;
    return threadRuntimeMetadataStore.get(runtimeOwnerId, threadId);
  }, (nativeSessionId) => {
    // OpenCode 原生 ses_* → Ultra thread：优先内存会话，其次持久化映射。
    try {
      const live = (opencodeBridge as unknown as { findThreadIdBySessionId?: (id: string) => string | null })
        .findThreadIdBySessionId?.(nativeSessionId);
      if (live) return live;
    } catch {
      // 忽略内存查找失败，走持久化。
    }
    try {
      return opencodeSessionStore.findBySessionId(nativeSessionId)?.threadId ?? null;
    } catch {
      return null;
    }
  });
  let { providerId, groupId } = target;
  const mainProviderId = providerId;
  const mainGroupId = groupId;
  let routedRequest = request;
  let usingFreeCompaction = false;
  const compactionOperationId = compactionRequest.turnId ?? "current";
  let compactionMainModel = "";
  if (compactionRequest.isCompaction) {
    appendContextWindowLog(`compaction-detected threadId=${target.threadId ?? ""} path=${url.pathname} fallbackProviderId=${fallbackProviderId} fallbackGroupId=${fallbackGroupId}`);
  }
  if (target.threadId && compactionRequest.isCompaction) {
    const metadata = threadRuntimeMetadataStore.get(runtimeOwnerId, target.threadId);
    compactionMainModel = metadata?.model ?? "";
    const compactRoute = resolveCompactionRelayRoute(metadata);
    if (metadata?.freeAutoCompactEnabled && !compactRoute) {
      return jsonResponse({ error: `No valid free compaction route exists for ${metadata.model}` }, 409, security);
    }
    if (freeCompactionFallbackTracker.shouldUseNative(target.threadId, compactionOperationId)) {
      appendContextWindowLog(`free-compaction-native-sticky threadId=${target.threadId} turnId=${compactionRequest.turnId ?? ""} mainProviderId=${mainProviderId} mainGroupId=${mainGroupId} mainModel=${metadata?.model ?? ""}`);
      notifyWorkbenchControl(threadAgentOwnerUser(runtimeOwnerId), { action: "compactionRoute", threadId: target.threadId, turnId: compactionRequest.turnId ?? "", source: "native", providerId: mainProviderId, model: metadata?.model ?? "", fallbackFrom: "free" });
    } else if (compactRoute && metadata) {
      providerId = compactRoute.providerId;
      groupId = compactRoute.groupId;
      routedRequest = await rewriteRelayRequestModel(request, compactRoute.model);
      usingFreeCompaction = true;
      appendContextWindowLog(`free-compaction-route threadId=${target.threadId} mainProviderId=${metadata.providerId ?? ""} mainGroupId=${metadata.groupId ?? ""} mainModel=${metadata.model} compactProviderId=${providerId} compactGroupId=${groupId} compactModel=${compactRoute.model}`);
      notifyWorkbenchControl(threadAgentOwnerUser(runtimeOwnerId), { action: "compactionRoute", threadId: target.threadId, turnId: compactionRequest.turnId ?? "", source: "free", providerId, model: compactRoute.model });
    } else {
      appendContextWindowLog(`native-compaction-route threadId=${target.threadId} turnId=${compactionRequest.turnId ?? ""} mainProviderId=${mainProviderId} mainGroupId=${mainGroupId} mainModel=${metadata?.model ?? ""}`);
      notifyWorkbenchControl(threadAgentOwnerUser(runtimeOwnerId), { action: "compactionRoute", threadId: target.threadId, turnId: compactionRequest.turnId ?? "", source: "native", providerId: mainProviderId, model: metadata?.model ?? "" });
    }
  }
  if (authStore && (providerId !== fallbackProviderId || groupId !== fallbackGroupId)) {
    const owner = authStore.getUser(runtimeOwnerId);
    if (!owner || !securityStore.isProviderAllowed(runtimeOwnerId, providerId, owner.role === "admin")) {
      return jsonResponse({ error: "Selected relay is not assigned to this member" }, 403, security);
    }
  }
  let provider = await providerStore.get(providerId);
  // 兼容旧 default/free 分组: opencode-local 已收敛为 v1/v2。
  if (provider?.id === OPENCODE_OFFICIAL_PROVIDER_ID) groupId = resolveOpencodeLocalGroupId(groupId);
  let group = provider?.groups?.find((entry) => entry.id === groupId);
  if (!provider || !group) {
    return jsonResponse({ error: "Relay provider or group not found" }, 404, security);
  }
  // A group without an override inherits the provider baseUrl (endpoint
  // resolution already uses `group.baseUrl ?? provider.baseUrl`). Normalize
  // once here so downstream decisions see the URL that will actually be
  // called — notably the OpenCode session-header gate, which inspects
  // group.baseUrl (a null group baseUrl previously skipped headers even when
  // the effective upstream was opencode.ai).
  group = withEffectiveGroupBaseUrl(group, provider.baseUrl);
  // P3 网关门禁（对标 axonhub enforceQuota）：配额在对话中途耗尽时按次拦截，
  // 不再向已超额的上游转发；超额行不进 gateway_requests（与其它 4xx 前置拒绝一致）。
  try {
    assertProviderQuotaAvailable(provider, group);
  } catch (error) {
    return jsonResponse({ error: errorToMessage(error), code: "QUOTA_EXCEEDED" }, 403, security);
  }
  if (provider.id === OMNIROUTE_FREE_PROVIDER_ID && FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED) {
    const access = await freeModelAccess.status();
    if (access.serviceError) {
      return jsonResponse({ error: access.serviceError, code: "FREE_MODEL_KEY_SERVICE_UNAVAILABLE", access }, 503, security);
    }
    if (!access.license.valid || access.refreshRequired) {
      return jsonResponse({
        error: access.license.valid
          ? `CodexUltraFree requires a model refresh every ${access.refreshIntervalHours} hours`
          : "A valid machine-bound Codex Ultra free key is required",
        code: access.license.valid ? "FREE_MODEL_REFRESH_REQUIRED" : "FREE_MODEL_KEY_REQUIRED",
        access
      }, 428, security);
    }
  }
  let apiKeys = await resolveGroupApiKeys(provider, group);
  if (apiKeys.length === 0 && group.authType !== "none" && group.id !== "freebuff") {
    return jsonResponse({ error: "Relay provider and group have no upstream credential" }, 400, security);
  }
  // JEV is native passthrough: skip compaction routing, advanced model
  // mapping, and tool rewrites — none of them understand {state, questions}.
  if (isJev) {
    // const 快照：闭包内 let 的收窄会失效，此处 provider/group 已由 404 检查收窄。
    const jevProvider = provider;
    const jevGroup = group;
    const jevApiKeys = apiKeys;
    const jevRequest = routedRequest;
    return runGatewayRequestWithLog({
      endpoint: "jev/evaluate",
      request: jevRequest,
      providerId: jevProvider.id,
      groupId: jevGroup.id,
      ownerId: runtimeOwnerId,
      ...(target.threadId ? { threadId: target.threadId } : {}),
      ...(compactionRequest.turnId ? { turnId: compactionRequest.turnId } : {}),
      run: () => runRelayJevRequestWithKeyFailover({ request: jevRequest, provider: jevProvider, group: jevGroup, apiKeys: jevApiKeys }),
    });
  }
  // Advanced cross-channel model mapping: if the resolved group has an
  // `advancedModelMapping` rule whose `requestModel` matches the model the
  // client requested (raw body model, falling back to its context-window
  // base model), re-dispatch the request to that rule's target channel/group
  // and send `targetModel` to the target's upstream. This mirrors the
  // free-compaction re-dispatch path already used above. In-group rewrites
  // (no cross target) stay on the legacy `resolveMappedModel` path below.
  // Compaction requests have their own routing (free-compaction above); leave
  // advanced mapping to regular turns so the two never stack.
  const advancedDispatch = !compactionRequest.isCompaction
    ? await resolveAdvancedModelDispatch(routedRequest, provider, group)
    : undefined;
  if (advancedDispatch) {
    provider = advancedDispatch.provider;
    group = advancedDispatch.group;
    apiKeys = await resolveGroupApiKeys(provider, group);
    if (apiKeys.length === 0 && group.authType !== "none" && group.id !== "freebuff") {
      return jsonResponse({ error: "Advanced mapping target relay has no upstream credential" }, 400, security);
    }
    if (authStore) {
      const owner = authStore.getUser(runtimeOwnerId);
      if (!owner || !securityStore.isProviderAllowed(runtimeOwnerId, provider.id, owner.role === "admin")) {
        return jsonResponse({ error: "Advanced mapping target relay is not assigned to this member" }, 403, security);
      }
    }
    routedRequest = advancedDispatch.request;
  }
  // P3：跨通道重映射后的最终目标同样执行按次配额门禁。
  try {
    assertProviderQuotaAvailable(provider, group);
  } catch (error) {
    return jsonResponse({ error: errorToMessage(error), code: "QUOTA_EXCEEDED" }, 403, security);
  }
  // Carry the resolved thread id into the gateway as an internal, stable
  // per-session identity the translate-path builders can hash into a
  // `prompt_cache_key` for OpenAI-compatible upstreams (mirrors cc-switch's
  // "explicit key wins, else a real client session id — never a per-request
  // UUID"). The gateway hashes it so the raw thread id is not forwarded
  // upstream. Only a real thread id is eligible; requests with no thread id
  // get nothing injected, which is the safe default for strict gateways.
  // Mutating the live headers avoids cloning the request body, which may
  // already have been read during compaction routing.
  const PROMPT_CACHE_KEY_HEADER = "x-codex-prompt-cache-key";
  const relayCacheKey = target.threadId?.trim() ?? "";
  if (relayCacheKey) {
    // The cache key is an optimization, not a correctness requirement; if a
    // Request's headers are immutable in some runtime path, skip injection
    // rather than failing the whole relay request.
    try {
      if (!request.headers.has(PROMPT_CACHE_KEY_HEADER)) request.headers.set(PROMPT_CACHE_KEY_HEADER, relayCacheKey);
      if (routedRequest !== request && !routedRequest.headers.has(PROMPT_CACHE_KEY_HEADER)) routedRequest.headers.set(PROMPT_CACHE_KEY_HEADER, relayCacheKey);
    } catch {
      // Headers immutable on this Request; leave the request untouched.
    }
  }
  const threadRuntime = target.threadId
    ? (threadRuntimeMetadataStore.get(runtimeOwnerId, target.threadId) ?? threadRuntimeMetadataStore.getAny(target.threadId))
    : null;
  if (threadRuntime?.vmEnabled) {
    routedRequest = await rewriteRelayRequestToolsForSaVm(routedRequest, threadRuntime.vmPolicy?.tools);
  }
  const gatewayProvider = provider;
  const gatewayGroup = group;
  const gatewayApiKeys = apiKeys;
  const gatewayRequest = routedRequest;
  const gatewayLogMeta = {
    request: gatewayRequest,
    providerId: gatewayProvider.id,
    groupId: gatewayGroup.id,
    ownerId: runtimeOwnerId,
    ...(target.threadId ? { threadId: target.threadId } : {}),
    ...(compactionRequest.turnId ? { turnId: compactionRequest.turnId } : {}),
  };
  if (isChat) {
    return runGatewayRequestWithLog({
      ...gatewayLogMeta,
      endpoint: "chat/completions",
      run: () => runRelayChatRequestWithKeyFailover({ request: gatewayRequest, provider: gatewayProvider, group: gatewayGroup, apiKeys: gatewayApiKeys }),
    });
  }
  if (isMessages) {
    return runGatewayRequestWithLog({
      ...gatewayLogMeta,
      endpoint: "messages",
      run: () => runRelayAnthropicWithKeyFailover({ request: gatewayRequest, provider: gatewayProvider, group: gatewayGroup, apiKeys: gatewayApiKeys }),
    });
  }
  let response = await runGatewayRequestWithLog({
    ...gatewayLogMeta,
    endpoint: isResponsesCompact ? "responses/compact" : "responses",
    run: () => runRelayProtocolRequestWithKeyFailover({ request: gatewayRequest, provider: gatewayProvider, group: gatewayGroup, apiKeys: gatewayApiKeys }),
  });
  if (target.threadId && compactionRequest.isCompaction && usingFreeCompaction) {
    if (response.ok) {
      freeCompactionFallbackTracker.clear(target.threadId);
    } else if (isFreeCompactionFallbackStatus(response.status)) {
      const failure = freeCompactionFallbackTracker.recordFailure(target.threadId, compactionOperationId);
      const responseText = await response.clone().text().catch(() => "");
      appendContextWindowLog(`free-compaction-failure threadId=${target.threadId} turnId=${compactionRequest.turnId ?? ""} attempt=${failure.failures} status=${response.status} compactProviderId=${providerId} compactGroupId=${groupId} error=${JSON.stringify(responseText.slice(0, 500))}`);
      if (failure.fallbackNow) {
        await response.body?.cancel().catch(() => undefined);
        const nativeProvider = await providerStore.get(mainProviderId);
        const nativeGroup = nativeProvider?.groups?.find((entry) => entry.id === mainGroupId);
        if (!nativeProvider || !nativeGroup) {
          return jsonResponse({ error: "Native compaction relay provider or group not found" }, 404, security);
        }
        const nativeApiKeys = await resolveGroupApiKeys(nativeProvider, nativeGroup);
        if (nativeApiKeys.length === 0 && nativeGroup.authType !== "none") {
          return jsonResponse({ error: "Native compaction relay has no upstream credential" }, 400, security);
        }
        appendContextWindowLog(`free-compaction-native-fallback threadId=${target.threadId} turnId=${compactionRequest.turnId ?? ""} failures=${failure.failures} mainProviderId=${mainProviderId} mainGroupId=${mainGroupId}`);
        notifyWorkbenchControl(threadAgentOwnerUser(runtimeOwnerId), { action: "compactionRoute", threadId: target.threadId, turnId: compactionRequest.turnId ?? "", source: "native", providerId: mainProviderId, model: compactionMainModel, fallbackFrom: "free" });
        response = await runRelayProtocolRequestWithKeyFailover({
          request,
          provider: nativeProvider,
          group: nativeGroup,
          apiKeys: nativeApiKeys
        });
        if (response.ok) {
          freeCompactionFallbackTracker.clear(target.threadId);
          appendContextWindowLog(`free-compaction-native-success threadId=${target.threadId} turnId=${compactionRequest.turnId ?? ""} status=${response.status} mainProviderId=${mainProviderId} mainGroupId=${mainGroupId}`);
        } else {
          appendContextWindowLog(`free-compaction-native-failure threadId=${target.threadId} turnId=${compactionRequest.turnId ?? ""} status=${response.status} mainProviderId=${mainProviderId} mainGroupId=${mainGroupId}`);
        }
      }
    }
  } else if (target.threadId && compactionRequest.isCompaction && response.ok) {
    freeCompactionFallbackTracker.clear(target.threadId);
  }
  const headers = new Headers(response.headers);
  security.forEach((value, key) => {
    if (!headers.has(key)) headers.set(key, value);
  });
  return new Response(response.body, { status: response.status, headers });
}

function serveStatic(request: Request, url: URL, headers: Headers): Response {
  if (!hasWebBuild || (request.method !== "GET" && request.method !== "HEAD")) {
    return jsonResponse({ error: "Not found" }, 404, headers);
  }

  const path = decodeURIComponent(url.pathname);
  const normalized = resolve(webDistRoot, `.${path === "/" ? "/index.html" : path}`);
  const isInsideWebDist = normalized === webDistRoot || normalized.startsWith(`${webDistRoot}${sep}`);
  const fileToServe = isInsideWebDist && existsSync(normalized) && statSync(normalized).isFile()
    ? normalized
    : join(webDistRoot, "index.html");

  const responseHeaders = new Headers(headers);
  responseHeaders.set("Vary", "Accept-Encoding");
  const contentType = staticAssetContentType(fileToServe);
  if (contentType) responseHeaders.set("Content-Type", contentType);

  const isIndexHtml = normalized.endsWith(`${sep}index.html`) || !existsSync(normalized);
  if (isIndexHtml || url.pathname === "/sw.js") {
    responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    responseHeaders.set("Pragma", "no-cache");
    responseHeaders.set("Expires", "0");
  } else if (/\/assets\/[^/]+-[a-z0-9]+\.[a-z0-9]+$/i.test(url.pathname)) {
    responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  const encoding = selectStaticEncoding(request.headers.get("accept-encoding"), fileToServe);
  const encodedFile = encoding ? `${fileToServe}.${encoding === "br" ? "br" : "gz"}` : null;
  const bodyPath = encodedFile && existsSync(encodedFile) ? encodedFile : fileToServe;
  if (bodyPath !== fileToServe && encoding) responseHeaders.set("Content-Encoding", encoding);
  return new Response(request.method === "HEAD" ? null : new Uint8Array(readFileSync(bodyPath)), { headers: responseHeaders });
}

function selectStaticEncoding(acceptEncoding: string | null, filePath: string): "br" | "gzip" | null {
  if (!/\.(?:css|html|js|json|svg|txt|webmanifest|xml)$/i.test(filePath) || !acceptEncoding) return null;
  const values = new Map<string, number>();
  for (const part of acceptEncoding.toLowerCase().split(",")) {
    const [name, ...parameters] = part.trim().split(";");
    if (!name) continue;
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const parsed = quality ? Number(quality.trim().slice(2)) : 1;
    values.set(name, Number.isFinite(parsed) ? parsed : 0);
  }
  const br = values.get("br") ?? values.get("*") ?? 0;
  const gzip = values.get("gzip") ?? values.get("*") ?? 0;
  if (br <= 0 && gzip <= 0) return null;
  return br >= gzip ? "br" : "gzip";
}

async function resolveAuth(
  request: Request,
  url: URL
): Promise<{ ok: true; user: AuthUser | null; token: string | null } | { ok: false }> {
  if (authStore) {
    const token = bearerOrUiToken(request, url);
    const user = await authStore.getUserByToken(token);
    if (!user) {
      // A Windows desktop build binds to loopback and already hands `/api/session`
      // an admin session without a password. Failing every other route on an
      // expired JWT would strand the local app on a login screen that it can
      // always walk straight through, so the same identity is resolved here.
      const admin = trustedLocalDesktopAdmin();
      return admin ? { ok: true, user: admin, token } : { ok: false };
    }
    return { ok: true, user, token };
  }
  const queryToken = url.searchParams.get("token");
  const headerToken = request.headers.get("x-codex-ui-token");
  const token = headerToken ?? queryToken;
  if (token && token !== sessionToken) {
    return { ok: false };
  }
  return { ok: true, user: null, token: sessionToken };
}

/** The machine account a trusted local desktop falls back to, or null elsewhere. */
function trustedLocalDesktopAdmin(): AuthUser | null {
  if (!trustedLocalDesktopAuth || !authStore) return null;
  return authStore.listUsers().find((candidate) => candidate.role === "admin" && candidate.status === "active") ?? null;
}

function bearerOrUiToken(request: Request, url: URL): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return request.headers.get("x-codex-ui-token") ?? url.searchParams.get("token");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function multiAgentV2SettingsPatch(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpApiError(400, "Multi Agent V2 settings must be a JSON object");
  }
  const body = value as Record<string, unknown>;
  const candidate = body.settings === undefined ? body : body.settings;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new HttpApiError(400, "settings must be a JSON object");
  }
  const entries = Object.entries(candidate as Record<string, unknown>);
  if (entries.length === 0) {
    throw new HttpApiError(400, "At least one Multi Agent V2 setting is required");
  }
  if (entries.length > 64) {
    throw new HttpApiError(400, "Too many Multi Agent V2 settings");
  }
  const settings: Record<string, JsonValue> = {};
  for (const [key, settingValue] of entries) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      throw new HttpApiError(400, `Invalid Multi Agent V2 setting: ${key}`);
    }
    if (key === "enabled" && settingValue !== null && typeof settingValue !== "boolean") {
      throw new HttpApiError(400, "enabled must be a boolean or null");
    }
    if (
      key === "max_concurrent_threads_per_session"
      && settingValue !== null
      && (!Number.isInteger(settingValue) || Number(settingValue) < 1)
    ) {
      throw new HttpApiError(400, "max_concurrent_threads_per_session must be a positive integer or null");
    }
    settings[key] = settingValue as JsonValue;
  }
  return settings;
}

function multiAgentV2SettingsFromConfigRead(result: JsonValue): Record<string, JsonValue> {
  const config = asRecord(asRecord(result).config);
  const rawSettings = asRecord(config.features).multi_agent_v2;
  const settings: Record<string, JsonValue> = typeof rawSettings === "boolean"
    ? { enabled: rawSettings }
    : rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? { ...rawSettings as Record<string, JsonValue> }
      : {};
  const agents = asRecord(config.agents);
  if (typeof agents.default_subagent_model === "string") settings.default_subagent_model = agents.default_subagent_model;
  if (typeof agents.default_subagent_reasoning_effort === "string") settings.default_subagent_reasoning_effort = agents.default_subagent_reasoning_effort;
  return settings;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableShortString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return undefined;
  return trimmed || null;
}

function permissionPresetId(value: unknown): PermissionPresetId | null {
  return value === "readonlyAsk" || value === "workspaceAsk" || value === "fullAsk" || value === "dangerBypass"
    ? value
    : null;
}

function resolveServerHomeDir(): string {
  try {
    const home = homedir();
    if (home && home.trim()) return home.trim();
  } catch {}
  const envHome = process.env.HOME ?? process.env.USERPROFILE;
  if (envHome && envHome.trim()) return envHome.trim();
  try {
    const info = userInfo();
    if (info?.homedir && info.homedir.trim()) return info.homedir.trim();
  } catch {}
  if (process.platform !== "win32") {
    const user = (process.env.USER ?? process.env.LOGNAME ?? "").trim();
    if (user && user !== "root") return `/home/${user}`;
    if (user === "root") return "/root";
    return "/root";
  }
  return "";
}

function expandLocalHomePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~" || trimmed === "~/" || trimmed === "~\\") {
    return resolveServerHomeDir() || path;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const home = resolveServerHomeDir();
    if (!home) return path;
    return join(home, trimmed.slice(2));
  }
  return path;
}

function resolveLocalWorkspacePath(path: string, user: AuthUser | null): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Missing workspace path");
  }
  const expanded = expandLocalHomePath(trimmed.replace(/\0/g, ""));
  const resolved = resolve(expanded);
  assertLocalWorkspacePathAllowed(resolved, user);
  return resolved;
}

function assertLocalWorkspacePathAllowed(path: string, user: AuthUser | null): void {
  if (!authStore || !user || user.role === "admin") {
    return;
  }
  const root = resolve(user.workspaceRoot);
  const attachmentRoot = resolve(localDatabase.dir, "attachments");
  const inWorkspace = path === root || path.startsWith(`${root}${sep}`);
  const inManagedAttachments = path === attachmentRoot || path.startsWith(`${attachmentRoot}${sep}`);
  if (!inWorkspace && !inManagedAttachments) {
    throw new Error(`Path outside member workspace: ${user.workspaceRoot}`);
  }
}

function assertThreadVmFilesystemPath(threadId: string | undefined, path: string, operation: "read" | "write", cwdHint?: string): void {
  if (!threadId) return;
  const runtime = threadRuntimeMetadataStore.getAny(threadId);
  if (!runtime?.vmEnabled) return;
  const threadCwd = runtime.cwd ?? cwdHint;
  if (!threadCwd) throw new Error("SA-VM requires a persisted workspace for this thread");
  const policy = normalizeSaVmPolicy(runtime.vmPolicy, threadCwd, runtime.additionalRoots ?? []);
  const decision = checkSaVmPath(policy, operation, path, threadCwd);
  if (!decision.allowed) throw new Error(`SA-VM policy denied filesystem ${operation}: ${decision.reason}`);
}

const LOCAL_FILE_RPC_READ_LIMIT_BYTES = 8 * 1024 * 1024;

// `fs/readFile` for backends that have no filesystem RPC of their own (agy,
// grok, pi, opencode, mini, and Claude non-skill files). Their bridges answer
// unknown methods with `{}`, which the Explorer rendered as an empty file.
async function readLocalWorkspaceFileRpc(path: string, cwd: string | undefined, user: AuthUser | null): Promise<JsonValue> {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Missing file path");
  // Relative paths belong to the thread workspace, not the server process cwd.
  const target = !isAbsolute(trimmed) && !trimmed.startsWith("~") && cwd ? join(cwd, trimmed) : trimmed;
  const resolved = resolveLocalWorkspacePath(target, user);
  const info = await fsStat(resolved);
  if (!info.isFile()) throw new Error(`Workspace path is not a file: ${path}`);
  if (info.size > LOCAL_FILE_RPC_READ_LIMIT_BYTES) {
    throw new Error(`Workspace file exceeds the ${LOCAL_FILE_RPC_READ_LIMIT_BYTES / (1024 * 1024)} MiB limit`);
  }
  return { dataBase64: readFileSync(resolved).toString("base64") } as JsonValue;
}

async function writeLocalWorkspaceFileRpc(
  path: string,
  cwd: string | undefined,
  dataBase64: string | undefined,
  content: string | undefined,
  user: AuthUser | null
): Promise<JsonValue> {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Missing file path");
  const target = !isAbsolute(trimmed) && !trimmed.startsWith("~") && cwd ? join(cwd, trimmed) : trimmed;
  const resolved = resolveLocalWorkspacePath(target, user);
  await mkdir(dirname(resolved), { recursive: true });
  if (typeof dataBase64 === "string") {
    writeFileSync(resolved, Buffer.from(dataBase64, "base64"));
  } else if (typeof content === "string") {
    writeFileSync(resolved, content, "utf8");
  } else {
    throw new Error("Missing file content");
  }
  return { ok: true } as JsonValue;
}

async function listLocalWorkspaceDirectory(path: string, cwd: string | undefined, user: AuthUser | null): Promise<{ entries: Array<{ fileName: string; isDirectory: boolean; isFile: boolean }> }> {
  const trimmed = path.trim();
  const target = !trimmed && cwd ? cwd : (!isAbsolute(trimmed) && !trimmed.startsWith("~") && cwd ? join(cwd, trimmed) : trimmed);
  const resolved = resolveLocalWorkspacePath(target, user);
  const entries = await readdir(resolved, { withFileTypes: true });
  // Symlinks (Linux) and junctions/symlinks (Windows, e.g. pnpm node_modules)
  // report neither isDirectory nor isFile on the Dirent; follow them with
  // stat so the Explorer can expand/open them. Broken links stay unknown.
  return {
    entries: await Promise.all(entries.map(async (entry) => {
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = await fsStat(join(resolved, entry.name));
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          // Dangling link: keep both false.
        }
      }
      return { fileName: entry.name, isDirectory, isFile };
    }))
  };
}

async function createLocalWorkspaceDirectory(path: string, cwd: string | undefined, recursive: boolean, user: AuthUser | null): Promise<void> {
  const trimmed = path.trim();
  const target = !isAbsolute(trimmed) && !trimmed.startsWith("~") && cwd ? join(cwd, trimmed) : trimmed;
  const resolved = resolveLocalWorkspacePath(target, user);
  await mkdir(resolved, { recursive, mode: 0o755 });
}

function expandFilesystemRpcParams(method: string, params: JsonValue): JsonValue {
  const pathBearingMethods = new Set([
    "fs/readDirectory",
    "fs/readFile",
    "fs/writeFile",
    "skills/list",
    "hooks/list",
    "plugin/list",
    "plugin/installed",
    // Thread lifecycle RPCs carry cwd for the local Codex app-server, whose
    // AbsolutePathBuf rejects non-absolute paths such as ~/. turn/start may
    // echo the thread cwd, and thread/resume rebuilds params from persisted
    // runtime metadata below, so every one of them must be normalized.
    // Remote (SSH/autonomous) calls never reach this function (see caller).
    "thread/start",
    "thread/resume",
    "thread/fork",
    "turn/start",
  ]);
  if (!pathBearingMethods.has(method)) {
    return params;
  }
  const record = asRecord(params);
  const next: Record<string, unknown> = { ...record };
  const toAbsoluteCwd = (value: string): string => {
    const expanded = expandLocalHomePath(value.trim());
    if (!expanded) return value;
    // Linux Codex app-server (AbsolutePathBuf) rejects "~" and relative
    // paths. Always forward an absolute path like /home/xxx or /root.
    try {
      return resolve(expanded);
    } catch {
      return expanded;
    }
  };
  if (typeof next.path === "string") {
    next.path = expandLocalHomePath(next.path);
  }
  if (typeof next.cwd === "string") {
    next.cwd = toAbsoluteCwd(next.cwd);
  }
  if (Array.isArray(next.cwds)) {
    next.cwds = next.cwds.map((entry) => (typeof entry === "string" ? toAbsoluteCwd(entry) : entry));
  }
  if (Array.isArray(next.additionalRoots)) {
    next.additionalRoots = next.additionalRoots.map((entry) => (typeof entry === "string" ? toAbsoluteCwd(entry) : entry));
  }
  return next as JsonValue;
}

function imageProtocolValue(value: unknown): ImageGenerationProtocol | undefined {
  switch (value) {
    case "openaiImages":
    case "openaiImageEdits":
    case "geminiChatCompletions":
    case "geminiGenerateContent":
    case "deepkeyAsyncVideos":
      return value;
    default:
      return undefined;
  }
}

function responseProtocolValue(value: unknown): RelayResponseProtocol | undefined {
  switch (value) {
    case "openai-response":
    case "openai":
    case "anthropic":
    case "gemini":
      return value;
    default:
      return undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function assertWebDevServerCwdAllowed(cwd: string, user: AuthUser | null): void {
  if (!authStore || !user || user.role === "admin") {
    return;
  }
  const root = resolve(user.workspaceRoot);
  const target = resolve(cwd);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("WebDev server cwd is outside the member workspace root");
  }
}

function parseLaunchEnv(value: unknown): LaunchEnvValues | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const out: LaunchEnvValues = {};
  if (typeof record.baseUrl === "string") out.baseUrl = record.baseUrl;
  if (typeof record.model === "string") out.model = record.model;
  if (typeof record.apiKey === "string") out.apiKey = record.apiKey;
  return out;
}

function parseSeparateLaunchEnv(value: unknown): Record<string, LaunchEnvValues> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const out: Record<string, LaunchEnvValues> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = parseLaunchEnv(entry);
    if (parsed) {
      out[key] = parsed;
    }
  }
  return out;
}

function jsonResponse(value: unknown, status = 200, headers = securityHeaders()): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_DEFAULT_MODEL = "jev-latest";

function resolveJevBaseUrl(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const candidate = trimmed || JEV_DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

/**
 * JEV over relay: the channel (provider/group/key) is resolved server-side
 * from the relay station, so stored keys never leave the server. Falls back
 * to the group's first text group when no groupId is given.
 */
async function handleJevRelayProxyRequest(
  _request: Request,
  headers: Headers,
  body: Record<string, unknown>,
  isTest: boolean,
  ownerId: string,
  user: AuthUser | null
): Promise<Response> {
  const relayProviderId = stringValue(body.providerId)?.trim() || "";
  if (!relayProviderId) {
    return jsonResponse({ error: "API key is required" }, 400, headers);
  }
  const provider = await providerStore.get(relayProviderId);
  const relayGroupId = stringValue(body.groupId)?.trim() || "";
  const group = provider?.groups?.find((entry) => entry.id === relayGroupId)
    ?? provider?.groups?.find((entry) => entry.kind !== "image" && entry.status !== "disabled")
    ?? provider?.groups?.[0];
  if (!provider || !group) {
    return jsonResponse({ error: "Relay provider or group not found" }, 404, headers);
  }
  if (group.kind === "image" || group.status === "disabled") {
    return jsonResponse({ error: "Relay group is not available for JEV" }, 409, headers);
  }
  if (authStore && user) {
    const owner = authStore.getUser(ownerId);
    if (!owner || !securityStore.isProviderAllowed(ownerId, provider.id, owner.role === "admin")) {
      return jsonResponse({ error: "Selected relay is not assigned to this member" }, 403, headers);
    }
  }
  const apiKeys = await resolveGroupApiKeys(provider, group);
  if (apiKeys.length === 0 && group.authType !== "none") {
    return jsonResponse({ error: "Relay provider and group have no upstream credential" }, 400, headers);
  }
  const model = stringValue(body.model)?.trim() || JEV_DEFAULT_MODEL;
  const questions = isTest
    ? { is_test: { type: "noul", instructions: "Is this a connectivity test?" } }
    : (body.questions && typeof body.questions === "object" ? body.questions : null);
  const state = isTest ? "test prompt" : (stringValue(body.state) ?? "");
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    return jsonResponse({ error: "questions must be an object" }, 400, headers);
  }
  if (!isTest && !state) {
    return jsonResponse({ error: "state is required" }, 400, headers);
  }
  // Bridge mode: any non-native relay (OpenAI chat/responses) serves JEV via
  // the jevOpenAiBridge converter. Native passthrough is kept only for real
  // TypeSafe SystemOne upstreams, unless the caller explicitly forces it.
  const upstreamBase = (group.baseUrl || provider.baseUrl || "").trim();
  const explicitBridge = body.bridge === true
    || body.bridge === "openai"
    || body.bridge === "bridge"
    || typeof body.bridgeProtocol === "string"
    || typeof (body as Record<string, unknown>).protocol === "string";
  const explicitNative = body.bridge === "native" || body.bridge === false;
  const useBridge = explicitNative ? false : (explicitBridge || !isNativeJevUpstream(upstreamBase));
  if (useBridge) {
    const questionMap = questions as Record<string, { type?: string; instructions?: string; criteria?: unknown }>;
    const selectedModel = model && model !== JEV_DEFAULT_MODEL
      ? model
      : (group.models?.[0] || provider.defaultModel || model);
    if (!selectedModel) {
      return jsonResponse({ error: "Relay group has no model for JEV bridge" }, 400, headers);
    }
    const bridgeStartedAt = Date.now();
    const protocol = normalizeBridgeProtocol(
      body.bridgeProtocol ?? (body as Record<string, unknown>).protocol ?? "openai-chat",
    );
    try {
      const bridgeBody = protocol === "openai-responses"
        ? buildJevBridgeResponsesBody(selectedModel, state, questionMap)
        : buildJevBridgeChatBody(selectedModel, state, questionMap);
      const bridgePath = protocol === "openai-responses" ? "responses" : "chat/completions";
      const bridgeRequest = new Request(`http://jev-bridge.local/v1/${bridgePath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bridgeBody),
      });
      const upstream = protocol === "openai-responses"
        ? await runRelayProtocolRequestWithKeyFailover({ request: bridgeRequest, provider, group, apiKeys })
        : await runRelayChatRequestWithKeyFailover({ request: bridgeRequest, provider, group, apiKeys });
      const rawText = await upstream.text();
      if (!upstream.ok) {
        let detail: unknown = null;
        try { detail = rawText ? JSON.parse(rawText) : null; } catch { detail = { raw: rawText.slice(0, 2000) }; }
        return jsonResponse({ error: `JEV bridge upstream ${upstream.status}`, status: upstream.status, data: detail, latencyMs: Date.now() - bridgeStartedAt }, upstream.status, headers);
      }
      let payload: unknown = null;
      try { payload = rawText ? JSON.parse(rawText) : null; } catch {
        return jsonResponse({ error: "JEV bridge upstream returned invalid JSON", latencyMs: Date.now() - bridgeStartedAt }, 502, headers);
      }
      const answerText = protocol === "openai-responses" ? extractResponsesText(payload) : extractChatText(payload);
      if (!answerText.trim()) {
        return jsonResponse({ error: "JEV bridge upstream returned empty content", latencyMs: Date.now() - bridgeStartedAt }, 502, headers);
      }
      const jevData = bridgeTextToJevData(answerText, questionMap, selectedModel);
      return jsonResponse({
        data: jevData,
        latencyMs: Date.now() - bridgeStartedAt,
        bridge: { protocol, model: selectedModel },
      }, 200, headers);
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error) || "JEV bridge failed", latencyMs: Date.now() - bridgeStartedAt }, 502, headers);
    }
  }
  const gatewayRequest = new Request("http://jev-relay.local/v1/jev/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, model, questions })
  });
  const response = await runRelayJevRequestWithKeyFailover({ request: gatewayRequest, provider, group, apiKeys });
  const outHeaders = new Headers(response.headers);
  headers.forEach((value, key) => {
    if (!outHeaders.has(key)) outHeaders.set(key, value);
  });
  return new Response(response.body, { status: response.status, headers: outHeaders });
}

async function handleJevProxyRequest(request: Request, headers: Headers, ownerId: string, user: AuthUser | null): Promise<Response> {
  const body = asRecord(await request.json().catch(() => ({})));
  const isTest = new URL(request.url).pathname === "/api/jev/test";
  const explicitApiKey = stringValue(body.apiKey)?.trim() || stringValue(body.key)?.trim() || "";
  if (!explicitApiKey) {
    return await handleJevRelayProxyRequest(request, headers, body, isTest, ownerId, user);
  }
  // Explicit-key path: direct upstream fetch, behavior unchanged.
  const baseUrl = resolveJevBaseUrl(body.baseUrl);
  if (!baseUrl) {
    return jsonResponse({ error: "Invalid baseUrl, must be http(s) URL" }, 400, headers);
  }
  const apiKey = explicitApiKey;
  const model = stringValue(body.model)?.trim() || JEV_DEFAULT_MODEL;
  // Cloudflare-hosted JEV (clef series) rejects single-question payloads, so
  // connectivity probes use two well-formed choice questions there.
  const cloudflareUpstream = isCloudflareJevUpstream(baseUrl);
  const requestedQuestions = isTest
    ? buildJevConnectivityQuestions(baseUrl)
    : (body.questions && typeof body.questions === "object" ? body.questions : null);
  const state = isTest ? "test prompt" : (stringValue(body.state) ?? "");
  if (!requestedQuestions || typeof requestedQuestions !== "object" || Array.isArray(requestedQuestions)) {
    return jsonResponse({ error: "questions must be an object" }, 400, headers);
  }
  const questions = cloudflareUpstream && !isTest
    ? padCloudflareJevQuestions(requestedQuestions as Record<string, unknown>)
    : (requestedQuestions as Record<string, unknown>);
  if (!isTest && !state) {
    return jsonResponse({ error: "state is required" }, 400, headers);
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    // Cloudflare-hosted JEV (clef series): POST {base}/@cf/cloudflare/{model}
    // with a bare body model name; JEV official posts to the base URL directly.
    const effectiveModel = cloudflareUpstream ? resolveCloudflareJevModel(model) : model;
    const requestUrl = cloudflareUpstream ? buildCloudflareJevRequestUrl(baseUrl, effectiveModel) : baseUrl;
    const requestBody = cloudflareUpstream
      ? { state, model: cloudflareJevBodyModel(effectiveModel), questions }
      : { state, model, questions };
    const upstream = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const text = await upstream.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 4000) };
    }
    const latencyMs = Date.now() - startedAt;
    if (!upstream.ok) {
      return jsonResponse({ error: `Upstream ${upstream.status}`, status: upstream.status, data: payload, latencyMs }, upstream.status, headers);
    }
    return jsonResponse({ data: unwrapJevUpstreamPayload(payload), latencyMs }, 200, headers);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error && error.name === "AbortError" ? "Upstream timeout (30s)" : errorToMessage(error);
    return jsonResponse({ error: message || "JEV proxy failed", latencyMs }, 502, headers);
  } finally {
    clearTimeout(timeout);
  }
}

async function listSshDirectory(command: string, path: string): Promise<{ entries: Array<{ fileName: string; isDirectory: boolean; isFile: boolean }> }> {
  const args = parseSshCommand(command);
  const remotePath = normalizeRemotePath(path);
  // Expand a remote home path inside the remote shell. Never let the local
  // process or SSH argument parser interpret `~` or `$HOME`.
  const remoteCommand = `dir=${quoteRemotePath(remotePath)}; [ -d "$dir" ] || { printf '__CODEX_SSH_DIR_ERROR__\\n' >&2; exit 3; }; for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do [ -e "$entry" ] || continue; name=\${entry##*/}; if [ -d "$entry" ]; then kind=d; elif [ -f "$entry" ]; then kind=f; else kind=o; fi; printf '%s\\t%s\\n' "$name" "$kind"; done`;
  const { stdout } = await execFileAsync("ssh", [...args, remoteCommand], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  const entries = String(stdout)
    .split(/\r?\n/)
    .flatMap((line) => {
      const [fileName, kind] = line.split("\t");
      if (!fileName) {
        return [];
      }
      return [
        {
          fileName,
          isDirectory: kind === "d",
          isFile: kind === "f"
        }
      ];
    });
  return { entries };
}

function parseSshCommand(command: string): string[] {
  const parts = splitCommandLine(command.trim());
  if (parts[0] !== "ssh" || parts.length < 2) {
    throw new Error("SSH command must look like: ssh user@host");
  }
  return parts.slice(1);
}

function splitCommandLine(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) {
    throw new Error("Unclosed quote in SSH command");
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Missing remote directory");
  }
  return trimmed.replace(/\0/g, "");
}

function optionalRemoteNodePort(value: unknown): number {
  if (value === undefined || value === null || value === "") return 43130;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Remote node port must be between 1024 and 65535");
  }
  return port;
}

function quoteRemoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteRemotePath(value: string): string {
  return value === "~" ? '"$HOME"' : value.startsWith("~/") ? '"$HOME"' + quoteRemoteShell("/" + value.slice(2)) : quoteRemoteShell(value);
}

async function saveUploadedAttachment(file: File): Promise<{ name: string; path: string; mediaType: string; size: number }> {
  const maxBytes = 64 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`Attachment exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB`);
  }
  const attachmentsDir = join(localDatabase.dir, "attachments");
  await mkdir(attachmentsDir, { recursive: true, mode: 0o700 });
  const name = sanitizeAttachmentName(file.name || "attachment.bin");
  const path = join(attachmentsDir, `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}-${name}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    name,
    path,
    mediaType: file.type || mimeTypeForAttachmentName(name),
    size: file.size
  };
}

function sanitizeAttachmentName(value: string): string {
  const base = value.split(/[\\/]/).pop() || "attachment.bin";
  return base.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "attachment.bin";
}

function mimeTypeForAttachmentName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "csv":
      return "text/csv";
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function securityHeaders(): Headers {
  return new Headers({
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // Strict CSP for the local renderer origin (http://127.0.0.1). All remote
    // model/provider calls are proxied through this local server, so the renderer
    // only needs same-origin connect/ws; fonts by origin; images as data/blob/https.
    "Content-Security-Policy": [
      "default-src 'self'",
      "connect-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com https://*.gstatic.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com https://*.gstatic.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'"
    ].join("; ")
  });
}

function remoteParentPath(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
    return index <= 2 ? normalized.slice(0, 3) : normalized.slice(0, index);
  }
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

async function createSshDirectory(command: string, path: string, os: string): Promise<void> {
  const args = parseSshCommand(command);
  const remoteCommand = os.toLowerCase().includes("windows")
    ? powershellEncodedCommand(`New-Item -ItemType Directory -Force -LiteralPath ${quotePowerShellLiteral(path)} | Out-Null`)
    : `mkdir -p -- ${quoteRemotePath(path)}`;
  await execFileAsync("ssh", [...args, remoteCommand], { timeout: 20_000, maxBuffer: 256 * 1024 });
}

async function preflightSshWorkspace(command: string, path: string): Promise<{
  ready: boolean;
  connected: boolean;
  os: string;
  arch: string;
  codexPath: string;
  codexVersion: string;
  appServerAvailable: boolean;
  cwdExists: boolean;
  cwdReadable: boolean;
  cwdWritable: boolean;
  reasons: string[];
}> {
  const args = parseSshCommand(command);
  const remotePath = normalizeRemotePath(path);
  const script = [
    "printf 'os=%s\\n' \"$(uname -s 2>/dev/null)\"",
    "printf 'arch=%s\\n' \"$(uname -m 2>/dev/null)\"",
    "codex_bin=\"$(command -v codex 2>/dev/null || true)\"; [ -n \"$codex_bin\" ] || codex_bin=\"$HOME/.local/bin/codex\"",
    "if [ -x \"$codex_bin\" ]; then printf 'codexPath=%s\\n' \"$codex_bin\"; printf 'codexVersion=%s\\n' \"$(\"$codex_bin\" --version 2>/dev/null | head -n 1)\"; else echo codexPath=; echo codexVersion=; fi",
    "if [ -x \"$codex_bin\" ] && \"$codex_bin\" app-server --help >/dev/null 2>&1; then echo appServerAvailable=1; else echo appServerAvailable=0; fi",
    `[ -d ${quoteRemotePath(remotePath)} ] && echo cwdExists=1 || echo cwdExists=0`,
    `[ -r ${quoteRemotePath(remotePath)} ] && echo cwdReadable=1 || echo cwdReadable=0`,
    `[ -w ${quoteRemotePath(remotePath)} ] && echo cwdWritable=1 || echo cwdWritable=0`
  ].join("; ");
  let values: Record<string, string> = {};
  try {
    const { stdout } = await execFileAsync("ssh", [...args, script], { timeout: 20_000, maxBuffer: 256 * 1024 });
    values = parseSshProbeOutput(String(stdout));
  } catch {
    // Windows OpenSSH commonly starts PowerShell rather than a POSIX shell.
  }
  if (!values.os) {
    const powershellScript = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "Write-Output 'os=Windows'",
      "Write-Output ('arch=' + [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString())",
      "$cmd = Get-Command codex -ErrorAction SilentlyContinue",
      "$codexPath = if ($cmd) { $cmd.Source } else { '' }",
      "Write-Output ('codexPath=' + $codexPath)",
      "$version = if ($cmd) { (& $codexPath --version 2>$null | Select-Object -First 1) } else { '' }",
      "Write-Output ('codexVersion=' + $version)",
      "$appServer = if ($cmd) { & $codexPath app-server --help *> $null; $LASTEXITCODE -eq 0 } else { $false }",
      "Write-Output ('appServerAvailable=' + $(if ($appServer) { '1' } else { '0' }))",
      `$cwd = ${quotePowerShellLiteral(remotePath)}`,
      "$exists = Test-Path -LiteralPath $cwd -PathType Container",
      "Write-Output ('cwdExists=' + $(if ($exists) { '1' } else { '0' }))",
      "Write-Output ('cwdReadable=' + $(if ($exists) { '1' } else { '0' }))",
      "Write-Output ('cwdWritable=' + $(if ($exists) { '1' } else { '0' }))"
    ].join("; " );
    const windowsProbe = await execFileAsync("ssh", [...args, powershellEncodedCommand(powershellScript)], { timeout: 20_000, maxBuffer: 256 * 1024 });
    values = parseSshProbeOutput(String(windowsProbe.stdout));
  }
  const reasons: string[] = [];
  if (!values.codexPath) reasons.push("Codex CLI is not installed or is not on PATH");
  if (values.codexPath && values.appServerAvailable !== "1") reasons.push("Remote Codex CLI does not support app-server");
  if (values.cwdExists !== "1") reasons.push("Remote workspace directory does not exist");
  if (values.cwdReadable !== "1") reasons.push("Remote workspace directory is not readable");
  if (values.cwdWritable !== "1") reasons.push("Remote workspace directory is not writable");
  return {
    ready: reasons.length === 0,
    connected: true,
    os: values.os ?? "",
    arch: values.arch ?? "",
    codexPath: values.codexPath ?? "",
    codexVersion: values.codexVersion ?? "",
    appServerAvailable: values.appServerAvailable === "1",
    cwdExists: values.cwdExists === "1",
    cwdReadable: values.cwdReadable === "1",
    cwdWritable: values.cwdWritable === "1",
    reasons
  };
}

function parseSshProbeOutput(output: string): Record<string, string> {
  return Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
}

function quotePowerShellLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function powershellEncodedCommand(script: string): string {
  return "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
}

async function installCodexOnSshHost(command: string, os: string): Promise<string> {
  const args = parseSshCommand(command);
  const normalizedOs = os.toLowerCase();
  let remoteCommand: string;
  if (normalizedOs.includes("windows")) {
    remoteCommand = powershellEncodedCommand("irm https://chatgpt.com/codex/install.ps1 | iex");
  } else if (normalizedOs === "linux" || normalizedOs === "darwin") {
    remoteCommand = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
  } else {
    throw new Error(`Automatic Codex installation is not supported on remote OS '${os || "unknown"}'`);
  }
  const { stdout, stderr } = await execFileAsync("ssh", [...args, remoteCommand], {
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024
  });
  return [stdout, stderr].map((entry) => String(entry).trim()).filter(Boolean).join("\n").slice(-16_384);
}

type ExecuteCodexRpcInput = {
  user: AuthUser | null;
  clientId: string;
  method: string;
  params?: JsonValue;
  onUserUpdated?: (user: AuthUser) => void;
};

const CLAUDE_HOST_SKILL_RPC_METHODS = new Set([
  "skills/list",
  "skills/config/write",
  "skills/extraRoots/set",
  "skills/invocation/expand",
  "fs/readFile",
]);

function isClaudeHostSkillRpc(method: string): boolean {
  return CLAUDE_HOST_SKILL_RPC_METHODS.has(method);
}

async function handleClaudeHostSkillRpc(claudeBridge: CodeCliBridge, method: string, params: JsonValue, user: AuthUser | null): Promise<JsonValue> {
  const inventory = claudeSkillInventories.get(claudeBridge);
  if (!inventory) throw new Error("Claude skill inventory is unavailable");
  const record = asRecord(params);
  const cwds = Array.isArray(record.cwds)
    ? record.cwds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const cwd = stringValue(record.cwd);
  switch (method) {
    case "skills/list":
      return skillGroupsJson(await inventory.list(cwds));
    case "skills/config/write": {
      const path = stringValue(record.path);
      if (!path) throw new Error("Claude skill configuration requires a discovered skill path");
      inventory.setEnabled(path, record.enabled !== false);
      return {} as JsonValue;
    }
    case "skills/extraRoots/set": {
      const roots = Array.isArray(record.extraRoots)
        ? record.extraRoots.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      inventory.setExtraRoots(roots);
      return { extraRoots: inventory.getExtraRoots() } as JsonValue;
    }
    case "skills/invocation/expand": {
      const text = stringValue(record.text) ?? "";
      const expandedText = await inventory.expandInvocation(text, cwd);
      return { matched: expandedText !== text, text: expandedText } as JsonValue;
    }
    case "fs/readFile": {
      const path = stringValue(record.path);
      if (!path) throw new Error("Missing file path");
      const skillCwds = cwds.length > 0 ? cwds : cwd ? [cwd] : [];
      // Only discovered skills come from the inventory. Any other file is a
      // normal workspace file and must be read from disk, not rejected.
      if (!(await inventory.isSkillPath(path, skillCwds))) return readLocalWorkspaceFileRpc(path, cwd, user);
      const text = await inventory.readSkill(path, skillCwds);
      return { dataBase64: Buffer.from(text, "utf8").toString("base64") } as JsonValue;
    }
    default:
      throw new Error(`Unsupported Claude skill RPC: ${method}`);
  }
}

async function expandClaudeSkillTurnInput(claudeBridge: CodeCliBridge, params: JsonValue): Promise<JsonValue> {
  const inventory = claudeSkillInventories.get(claudeBridge);
  if (!inventory) return params;
  const record = asRecord(params);
  const cwd = stringValue(record.cwd);
  const expanded = await expandClaudeSkillInput(inventory, record.input as JsonValue | undefined, cwd);
  return expanded.matched ? { ...record, input: expanded.input } as JsonValue : params;
}

const COMMAND_BLACKLIST_RPC_METHODS = new Set([
  "command/exec",
  "thread/shellCommand",
  "fs/readFile",
  "fs/readDirectory",
  "fs/getMetadata"
]);
// These RPCs carry a path rather than a shell command, so they are inspected
// through `inspectFileRpcPath`, which applies the raw-path rules on top of the
// command form.
const COMMAND_BLACKLIST_PATH_METHODS = new Set([
  "fs/readFile",
  "fs/readDirectory",
  "fs/getMetadata"
]);
const COMMAND_BLACKLIST_APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "execCommandApproval"
]);

type CommandBlacklistContext = {
  threadId?: string;
  providerId?: string;
  groupId?: string;
  providerName?: string;
  groupName?: string;
  model?: string;
  cwd?: string;
  workspaceMode?: string;
  group: ChannelGroupConfig | null;
};

async function resolveCommandBlacklistContext(params: JsonValue | undefined, user: AuthUser | null): Promise<CommandBlacklistContext> {
  const record = asRecord(params);
  const workspace = asRecord(record.workspace);
  const threadId = stringValue(record.threadId);
  const parentThreadId = stringValue(record.parentThreadId) ?? stringValue(asRecord(record.thread).parentThreadId);
  const threadIds = [threadId, parentThreadId].filter((value): value is string => Boolean(value));
  let runtime = threadId ? threadRuntimeMetadataStore.get(user?.id ?? "local", threadId) : null;
  if (!runtime) {
    for (const candidate of threadIds) {
      runtime = threadRuntimeMetadataStore.getAny(candidate);
      if (runtime) break;
    }
  }
  const sshProfile = sshProfileFromParams(params);
  const providerId = stringValue(record.providerId) ?? runtime?.providerId ?? sshProfile?.providerId;
  const groupId = stringValue(record.groupId) ?? runtime?.groupId ?? sshProfile?.groupId;
  let provider: ProviderConfig | null = null;
  if (providerId) provider = await providerStore.get(providerId);
  const group = provider?.groups?.find((entry) => entry.id === groupId)
    ?? (provider?.groups?.find((entry) => entry.kind !== "image") ?? provider?.groups?.[0] ?? null);
  return {
    threadId,
    providerId,
    groupId: group?.id ?? groupId,
    providerName: provider?.name,
    groupName: group?.name,
    model: stringValue(record.model) ?? runtime?.model,
    cwd: stringValue(record.cwd) ?? stringValue(workspace.cwd) ?? sshProfile?.cwd,
    workspaceMode: stringValue(workspace.type) ?? (sshProfile ? "ssh" : "local"),
    group
  };
}

function commandForBlacklist(method: string, params: JsonValue | undefined): string {
  if (!COMMAND_BLACKLIST_RPC_METHODS.has(method) && !COMMAND_BLACKLIST_APPROVAL_METHODS.has(method)) return "";
  if (COMMAND_BLACKLIST_PATH_METHODS.has(method)) {
    const path = stringValue(asRecord(params).path);
    return path ? `read ${path}` : "";
  }
  return commandFromValue(asRecord(params).command);
}

async function inspectCommandBlacklist(method: string, params: JsonValue | undefined, user: AuthUser | null): Promise<{
  command: string;
  context: CommandBlacklistContext;
  match: import("./commandBlacklist.js").CommandBlacklistMatch;
} | null> {
  const command = commandForBlacklist(method, params);
  if (!command) return null;
  const context = await resolveCommandBlacklistContext(params, user);
  const rawPath = COMMAND_BLACKLIST_PATH_METHODS.has(method) ? stringValue(asRecord(params).path) : undefined;
  const match = rawPath
    ? commandBlacklistPolicy.inspectFileRpcPath(rawPath, context.group)
    : commandBlacklistPolicy.inspect(command, context.group);
  return match ? { command, context, match } : null;
}

async function inspectNetworkPermissionBlacklist(params: JsonValue | undefined, user: AuthUser | null): Promise<Awaited<ReturnType<typeof inspectCommandBlacklist>>> {
  const record = asRecord(params);
  const permissions = asRecord(record.permissions);
  if (permissions.network == null || permissions.network === false || asRecord(permissions.network).enabled === false) return null;
  const reason = [
    stringValue(record.reason),
    stringValue(record.tool),
    stringValue(record.toolName),
    stringValue(record.title)
  ].filter(Boolean).join(" ");
  // Search tools are an explicit product capability and do not expose an
  // arbitrary URL command to the model. Keep those requests available.
  if (isSystemWebSearchPermissionRequest(reason)) return null;
  const context = await resolveCommandBlacklistContext(params, user);
  if (reason && commandBlacklistPolicy.networkCommandAllowed(reason, context.group)) return null;
  const match = commandBlacklistPolicy.inspectNetworkPermission(context.group);
  return match ? { command: `network permission request${reason ? `: ${reason}` : ""}`, context, match } : null;
}

async function recordBlockedCommand(
  method: string,
  blocked: Awaited<ReturnType<typeof inspectCommandBlacklist>>
): Promise<void> {
  if (!blocked) return;
  const evidence: CommandBlacklistEvidence = {
    method,
    command: blocked.command,
    cwd: blocked.context.cwd,
    threadId: blocked.context.threadId,
    providerId: blocked.context.providerId,
    groupId: blocked.context.groupId,
    providerName: blocked.context.providerName,
    groupName: blocked.context.groupName,
    model: blocked.context.model,
    workspaceMode: blocked.context.workspaceMode,
    match: blocked.match
  };
  await commandBlacklistPolicy.recordBlocked(evidence);
}

async function assertProtectedReadPath(path: string, method: string): Promise<void> {
  const match = commandBlacklistPolicy.inspectPath(path);
  if (!match) return;
  await commandBlacklistPolicy.recordBlocked({ method, command: `read ${path}`, cwd: path, match });
  throw new Error("Dangerous operation detected; execution was blocked.");
}

function blockedCommandNotification(
  params: JsonValue | undefined,
  blocked: Awaited<ReturnType<typeof inspectCommandBlacklist>>
): JsonRpcNotification | null {
  if (!blocked) return null;
  const record = asRecord(params);
  const threadId = blocked.context.threadId;
  const turnId = stringValue(record.turnId) ?? stringValue(asRecord(record.turn).id);
  if (!threadId || !turnId) return null;
  const itemId = `command-blacklist-${Date.now()}-${randomBytes(4).toString("hex")}`;
  return {
    method: "item/completed",
    params: {
      threadId,
      turnId,
      itemId,
      item: {
        id: itemId,
        type: "error",
        title: "Dangerous operation blocked",
        text: "Dangerous operation detected; execution was blocked.",
        status: "failed",
        commandBlacklist: {
          ruleId: blocked.match.ruleId,
          category: blocked.match.category,
          ...(blocked.context.providerId ? { providerId: blocked.context.providerId } : {}),
          ...(blocked.context.groupId ? { groupId: blocked.context.groupId } : {}),
          ...(blocked.context.providerName ? { providerName: blocked.context.providerName } : {}),
          ...(blocked.context.groupName ? { groupName: blocked.context.groupName } : {})
        }
      }
    } as JsonValue
  };
}

function antiPatternCommandNotification(
  params: JsonValue | undefined,
  threadId: string | null | undefined,
  antiPattern: string
): JsonRpcNotification | null {
  const record = asRecord(params);
  const effectiveThreadId = threadId ?? stringValue(record.threadId);
  const turnId = stringValue(record.turnId) ?? stringValue(asRecord(record.turn).id);
  if (!effectiveThreadId || !turnId) return null;
  const itemId = `anti-pattern-${Date.now()}-${randomBytes(4).toString("hex")}`;
  return {
    method: "item/completed",
    params: {
      threadId: effectiveThreadId,
      turnId,
      itemId,
      item: {
        id: itemId,
        type: "error",
        title: "Prohibited Shell Anti-Pattern",
        text: `Command blocked: ${antiPattern}`,
        status: "failed"
      }
    } as JsonValue
  };
}

function publishTerminalEvent(message: { method: string; params: Record<string, unknown> }, threadId?: string): void {
  const wire = { method: message.method, params: message.params as JsonValue };
  codexApiEvents.append("notification", wire, threadId ?? null);
  if (!authStore || !threadId) {
    broadcast({ type: "codex.notification", message: wire });
    return;
  }
  for (const client of clients) {
    const user = client.data.user;
    if (!user) {
      send(client, { type: "codex.notification", message: wire });
      continue;
    }
    if (user.role === "admin" || authStore.ownsThread(threadId, user.id)) {
      send(client, { type: "codex.notification", message: wire });
    }
  }
}

function terminalEventHandlers(threadId?: string): { onData: (terminalId: string, chunk: string) => void; onExit: (terminalId: string, exitCode: number, signal?: number) => void } {
  return {
    onData: (terminalId, chunk) => {
      publishTerminalEvent(
        { method: "terminal/data", params: { terminalId, chunkBase64: Buffer.from(chunk, "utf8").toString("base64") } },
        threadId
      );
    },
    onExit: (terminalId, exitCode, signal) => {
      publishTerminalEvent(
        {
          method: "terminal/exit",
          params: {
            terminalId,
            exitCode,
            ...(signal === undefined ? {} : { signal })
          }
        },
        threadId
      );
    }
  };
}

// Resident terminal RPCs (orca-style, server-owned PTYs). Handled locally
// at the top of executeCodexRpc — never forwarded to the upstream engine,
// whose command/exec is short-lived and timeout-bound.
async function executeTerminalRpc(method: string, params: JsonValue | undefined, user: AuthUser | null): Promise<JsonValue> {
  if (!isTerminalPtyEnabled()) {
    throw new Error("Resident terminal is disabled (CODEX_UI_TERMINAL_PTY=0)");
  }
  if (authStore && user && user.role !== "admin" && !user.allowWrite) {
    throw new Error("Member policy forbids terminal access");
  }
  const record = asRecord(params);
  const ownerId = user?.id ?? "local";
  const threadId = stringValue(record.threadId) ?? undefined;
  const terminalId = stringValue(record.terminalId);
  switch (method) {
    case "terminal/create": {
      const command = Array.isArray(record.command)
        ? record.command.filter((part): part is string => typeof part === "string" && part.length > 0)
        : undefined;
      const env = asRecord(record.env);
      const extraEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") extraEnv[key] = value;
      }
      const info = await createTerminalPty(
        {
          cwd: stringValue(record.cwd),
          cols: typeof record.cols === "number" ? record.cols : undefined,
          rows: typeof record.rows === "number" ? record.rows : undefined,
          term: stringValue(record.term),
          command,
          env: extraEnv,
          ownerId,
          threadId
        },
        terminalEventHandlers(threadId)
      );
      return info as unknown as JsonValue;
    }
    case "terminal/write": {
      if (!terminalId) throw new Error("terminalId is required");
      const data = stringValue(record.data) ?? "";
      writeTerminalPty(terminalId, data);
      return { ok: true } as unknown as JsonValue;
    }
    case "terminal/resize": {
      if (!terminalId) throw new Error("terminalId is required");
      const info = resizeTerminalPty(
        terminalId,
        typeof record.cols === "number" ? record.cols : NaN,
        typeof record.rows === "number" ? record.rows : NaN
      );
      return info as unknown as JsonValue;
    }
    case "terminal/kill": {
      if (!terminalId) throw new Error("terminalId is required");
      const info = killTerminalPty(terminalId);
      return info as unknown as JsonValue;
    }
    case "terminal/forget": {
      if (!terminalId) throw new Error("terminalId is required");
      return { ok: forgetTerminalPty(terminalId) } as unknown as JsonValue;
    }
    case "terminal/read": {
      if (!terminalId) throw new Error("terminalId is required");
      const limit = typeof record.limitBytes === "number" ? record.limitBytes : undefined;
      const { info, tail } = readTerminalPty(terminalId, limit);
      return { ...info, tail } as unknown as JsonValue;
    }
    case "terminal/list": {
      return listTerminalPtys() as unknown as JsonValue;
    }
    default:
      throw new Error(`Unsupported terminal RPC: ${method}`);
  }
}

async function executeCodexRpc(input: ExecuteCodexRpcInput): Promise<JsonValue> {
  const { clientId, method, onUserUpdated } = input;
  let user = input.user;
  let params = input.params;
  if (
    method === "terminal/create"
    || method === "terminal/write"
    || method === "terminal/resize"
    || method === "terminal/kill"
    || method === "terminal/forget"
    || method === "terminal/read"
    || method === "terminal/list"
  ) {
    return await executeTerminalRpc(method, params, user);
  }
  // Mini is the default agent: Codex-only account/model RPCs must not fall
  // through to miniBridge (which throws `Mini backend does not support ...`
  // and surfaces as CUX-RPC-LOCAL-001 stage=rpc on every startup).
  if (!isCliPluginEnabled("codex")) {
    if (method === "account/read" || method === "account/rateLimits/read") return null;
    if (method === "model/list") return { data: [] } as JsonValue;
  }
  const requestedThreadId = stringValue(asRecord(params).threadId);
  let requestedSshProfile = sshProfileFromParams(params);
  const storedSshProfile = requestedThreadId ? sshWorkspaceStore.get(requestedThreadId) : null;
  // An autonomous SSH thread owns a remote Bun bridge. The UI may retain the
  // historical workspace metadata on turn/start, but that must not downgrade
  // the request to a fresh direct Codex SSH bridge (which cannot see the
  // remote Bun thread and reports `thread not found`). Route identity wins for
  // every RPC against an existing autonomous thread.
  const autonomousRoute = requestedThreadId ? remoteThreadRouteStore.get(requestedThreadId) : null;
  const rpcOwnerId = user?.id ?? "local";
  const paramCliBackend = stringValue(asRecord(params).cliBackend) || (asRecord(params).engine === "pi" ? "pi" : undefined);
  // A Claude thread keeps its backend in runtime metadata (or in the Claude
  // session store for older threads). SSH routing must know the backend before
  // any bridge is built, otherwise a Claude SSH thread starts a remote Codex
  // app-server instead of a remote Claude CLI.
  let storedCliBackend = requestedThreadId
    ? threadRuntimeMetadataStore.get(rpcOwnerId, requestedThreadId)?.cliBackend
      ?? threadRuntimeMetadataStore.getAny(requestedThreadId)?.cliBackend
      ?? (claudeSessionStore.get(rpcOwnerId, requestedThreadId) ? "claude" : undefined)
      ?? (claudeSessionStore.get("local", requestedThreadId) ? "claude" : undefined)
      ?? (agySessionStore.get(rpcOwnerId, requestedThreadId) ? "agy" : undefined)
      ?? (agySessionStore.findByThreadId(requestedThreadId) ? "agy" : undefined)
      ?? (agyThreadBridges.has(requestedThreadId) ? "agy" : undefined)
      ?? (agyBridge.hasSession(requestedThreadId) ? "agy" : undefined)
      ?? (grokSessionStore.get(rpcOwnerId, requestedThreadId) ? "grok" : undefined)
      ?? (grokSessionStore.findByThreadId(requestedThreadId) ? "grok" : undefined)
      ?? (grokThreadBridges.has(requestedThreadId) ? "grok" : undefined)
      ?? (grokBridge.hasSession(requestedThreadId) ? "grok" : undefined)
      ?? (museSessionStore.get(rpcOwnerId, requestedThreadId) ? "muse" : undefined)
      ?? (museSessionStore.get("local", requestedThreadId) ? "muse" : undefined)
      ?? (museSessionStore.findByThreadId(requestedThreadId) ? "muse" : undefined)
      ?? (museSessionStore.findBySessionId(requestedThreadId) ? "muse" : undefined)
      ?? (museThreadBridges.has(requestedThreadId) ? "muse" : undefined)
      ?? (museBridge.hasSession(requestedThreadId) ? "muse" : undefined)
      ?? (piSessionStore.get(rpcOwnerId, requestedThreadId) ? "pi" : undefined)
      ?? (piSessionStore.findByThreadId(requestedThreadId) ? "pi" : undefined)
      ?? (piThreadBridges.has(requestedThreadId) ? "pi" : undefined)
      ?? (piBridge.hasSession(requestedThreadId) ? "pi" : undefined)
      ?? (opencodeV2Bridge.hasSession(requestedThreadId) ? "opencode-v2" : undefined)
      ?? (opencodeSessionStore.get(rpcOwnerId, requestedThreadId) ? "opencode" : undefined)
      ?? (opencodeSessionStore.get("local", requestedThreadId) ? "opencode" : undefined)
      ?? (opencodeSessionStore.findByThreadId(requestedThreadId) ? "opencode" : undefined)
      ?? (opencodeSessionStore.findBySessionId(requestedThreadId) ? "opencode" : undefined)
      ?? (opencodeThreadBridges.has(requestedThreadId) ? "opencode" : undefined)
      ?? (opencodeBridge.hasSession(requestedThreadId) ? "opencode" : undefined)
      ?? (isNativeOpencodeSessionId(requestedThreadId) ? "opencode" : undefined)
      ?? (miniHistory.exists(rpcOwnerId, requestedThreadId) ? "mini" : undefined)
      ?? (miniBridge.hasSession(requestedThreadId, rpcOwnerId) ? "mini" : undefined)
    : undefined;
  // Workflow/native subagent sessions are not CUX threads: they only exist as
  // Muse child logs. Route read-only opens to the Muse bridge instead of the
  // Codex app-server, which fails with `thread not loaded` for these ids.
  // Cline spawn cards resolve the same way against the daemon's per-agent
  // transcript files (see backends/cline clineChildSession.ts).
  if (!storedCliBackend && requestedThreadId
    && /^thread\/(read|resume|turns\/list|items\/list)$/.test(method)
    && museBridge.hasChildThread(requestedThreadId)) {
    storedCliBackend = "muse";
  }
  if (!storedCliBackend && requestedThreadId
    && /^thread\/(read|resume|turns\/list|items\/list)$/.test(method)) {
    try {
      if (clineBridgeFor(requestedThreadId).hasChildThread(requestedThreadId)) {
        storedCliBackend = "cline";
      }
    } catch {
      // Child resolution must never break routing.
    }
  }
  const paramProviderId = stringValue(asRecord(params).providerId);
  const paramModelProvider = stringValue(asRecord(params).modelProvider);
  const claudeBackendRequested = (isCliPluginEnabled("claude") || paramCliBackend === "claude" || storedCliBackend === "claude")
    && (paramCliBackend === "claude" || (requestedThreadId ? storedCliBackend === "claude" : false));
  const agyBackendRequested = (isCliPluginEnabled("agy") || paramCliBackend === "agy" || storedCliBackend === "agy")
    && (paramCliBackend === "agy"
      || paramProviderId === AGY_OFFICIAL_PROVIDER_ID
      || paramModelProvider === AGY_OFFICIAL_PROVIDER_ID
      || (requestedThreadId ? storedCliBackend === "agy" || agyThreadBridges.has(requestedThreadId) || agyBridge.hasSession(requestedThreadId) : false));
  const auggieBackendRequested = (isCliPluginEnabled("auggie") || paramCliBackend === "auggie" || storedCliBackend === "auggie")
    && (paramCliBackend === "auggie"
      || (requestedThreadId ? storedCliBackend === "auggie" || existingAuggieBridgeForThread(requestedThreadId) !== null : false));
  const clineBackendRequested = (isCliPluginEnabled("cline") || paramCliBackend === "cline" || storedCliBackend === "cline")
    && (paramCliBackend === "cline"
      || (requestedThreadId ? storedCliBackend === "cline" || existingClineBridgeForThread(requestedThreadId) !== null : false));
  const commandCodeBackendRequested = (isCliPluginEnabled("command-code") || paramCliBackend === "command-code" || storedCliBackend === "command-code")
    && (paramCliBackend === "command-code"
      || (requestedThreadId ? storedCliBackend === "command-code" || existingCommandCodeBridgeForThread(requestedThreadId) !== null : false));
  const grokBackendRequested = (isCliPluginEnabled("grok") || paramCliBackend === "grok" || storedCliBackend === "grok")
    && (paramCliBackend === "grok"
      || paramProviderId === GROK_OFFICIAL_PROVIDER_ID
      || paramModelProvider === GROK_OFFICIAL_PROVIDER_ID
      || (requestedThreadId ? storedCliBackend === "grok" || grokThreadBridges.has(requestedThreadId) || grokBridge.hasSession(requestedThreadId) : false));
  const museBackendRequested = (isCliPluginEnabled("muse") || paramCliBackend === "muse" || storedCliBackend === "muse")
    && (paramCliBackend === "muse"
      || paramProviderId === MUSE_OFFICIAL_PROVIDER_ID
      || paramModelProvider === MUSE_OFFICIAL_PROVIDER_ID
      || (requestedThreadId ? storedCliBackend === "muse" || museThreadBridges.has(requestedThreadId) || museBridge.hasSession(requestedThreadId) : false));
  const piBackendRequested = (isCliPluginEnabled("pi") || paramCliBackend === "pi" || storedCliBackend === "pi")
    && (paramCliBackend === "pi"
      || paramProviderId === PI_OFFICIAL_PROVIDER_ID
      || paramModelProvider === PI_OFFICIAL_PROVIDER_ID
      || (requestedThreadId ? storedCliBackend === "pi" || piThreadBridges.has(requestedThreadId) || piBridge.hasSession(requestedThreadId) : false));
  const opencodeBackendRequested = (isCliPluginEnabled("opencode") || paramCliBackend === "opencode" || storedCliBackend === "opencode")
    && (paramCliBackend === "opencode"
      || paramProviderId === OPENCODE_OFFICIAL_PROVIDER_ID
      || paramModelProvider === OPENCODE_OFFICIAL_PROVIDER_ID
      || (requestedThreadId ? storedCliBackend === "opencode" || opencodeThreadBridges.has(requestedThreadId) || opencodeBridge.hasSession(requestedThreadId) || isNativeOpencodeSessionId(requestedThreadId) : false));
  // v2 selection is explicit (`opencode-v2` backend id) — the official
  // provider id stays bound to the v1 flow so existing threads never
  // silently switch API generations.
  const opencodeV2BackendRequested = (isCliPluginEnabled("opencode-v2") || paramCliBackend === "opencode-v2" || storedCliBackend === "opencode-v2")
    && (paramCliBackend === "opencode-v2"
      || (requestedThreadId ? storedCliBackend === "opencode-v2" || opencodeV2Bridge.hasSession(requestedThreadId) : false));
  const codexBackendRequested = paramCliBackend === "codex" || storedCliBackend === "codex";
  const anyOtherCliRequested = codexBackendRequested
    || claudeBackendRequested
    || agyBackendRequested
    || auggieBackendRequested
    || clineBackendRequested
    || commandCodeBackendRequested
    || grokBackendRequested
    || museBackendRequested
    || piBackendRequested
    || opencodeBackendRequested
    || opencodeV2BackendRequested;
  const miniBackendRequested = shouldRouteToMiniBackend({
    paramCliBackend,
    storedCliBackend,
    threadId: requestedThreadId,
    ownerId: rpcOwnerId,
    historyExists: (ownerId, threadId) => miniHistory.exists(ownerId, threadId),
    hasSession: (threadId, ownerId) => miniBridge.hasSession(threadId, ownerId),
  });
  const effectiveMiniRequested = !anyOtherCliRequested && miniBackendRequested;
  const bridgeKind = selectThreadRpcBridgeKind({
    hasAutonomousRoute: Boolean(autonomousRoute),
    hasRequestedSshWorkspace: Boolean(requestedSshProfile),
    hasStoredSshWorkspace: Boolean(storedSshProfile),
    isClaudeBackend: claudeBackendRequested
  });
  if (autonomousRoute && !isWorkspaceGitMethod(method)) {
    requestedSshProfile = null;
  }
  if (!requestedSshProfile && storedSshProfile) {
    requestedSshProfile = storedSshProfile;
  }
  if (requestedSshProfile && requestedThreadId && !requestedSshProfile.providerId) {
    const storedProfile = storedSshProfile;
    if (storedProfile && storedProfile.command === requestedSshProfile.command && storedProfile.cwd === requestedSshProfile.cwd) {
      requestedSshProfile = storedProfile;
      const inputParams = asRecord(params);
      params = {
        ...inputParams,
        workspace: { type: "ssh", ...storedProfile },
        remoteWorkspace: { type: "ssh", ...storedProfile }
      } as JsonValue;
    }
  }
  const remoteBridge = bridgeKind === "direct-ssh" ? await sshBridgeForParams(params) : null;
  const autonomousBridge = bridgeKind === "autonomous" && requestedThreadId
    ? await restoreRemoteBunThreadBridge(requestedThreadId)
    : null;
  const restoredRemoteBridge = !remoteBridge && !autonomousBridge && bridgeKind !== "codecli-ssh" && requestedThreadId
    ? await restoreSshThreadBridge(requestedThreadId, user)
    : null;
  // SSH workspace of a Claude thread. The Claude bridge runs the CLI on the
  // remote host instead of delegating to the Codex SSH bridge.
  const claudeSshProfile = bridgeKind === "codecli-ssh" ? requestedSshProfile : null;
  const claudeBridgeForStart = !remoteBridge && !autonomousBridge && !restoredRemoteBridge && !requestedThreadId && paramCliBackend === "claude";
  const claudeBridge = !remoteBridge && !autonomousBridge && !restoredRemoteBridge
    ? (requestedThreadId
      ? await resolveClaudeBridgeForThread(requestedThreadId, rpcOwnerId, method, params, claudeSshProfile)
      : claudeBridgeForStart
        ? await createClaudeBridge({ ownerId: rpcOwnerId, ssh: claudeSshProfile, bypassEnabledCheck: true })
        : null)
    : null;
  // Backend dispatch table (R3e): priority order is the array order.
  // Singleton backends register the thread against their bridge after
  // winning; per-thread backends resolve through their factories and
  // manage their own registration. Adding a backend is one entry.
  const backendBridgeTable = [
    { id: "opencode", requested: opencodeBackendRequested, resolve: (_threadId: string | null) => opencodeBridge, registerThread: (threadId: string) => { opencodeThreadBridges.set(threadId, opencodeBridge); } },
    { id: "opencode-v2", requested: opencodeV2BackendRequested, resolve: (_threadId: string | null) => opencodeV2Bridge, registerThread: (threadId: string) => { opencodeThreadBridges.set(threadId, opencodeV2Bridge); } },
    { id: "pi", requested: piBackendRequested, resolve: (_threadId: string | null) => piBridge, registerThread: (threadId: string) => { piThreadBridges.set(threadId, piBridge); } },
    { id: "muse", requested: museBackendRequested, resolve: (_threadId: string | null) => museBridge, registerThread: (threadId: string) => { museThreadBridges.set(threadId, museBridge); } },
    { id: "grok", requested: grokBackendRequested, resolve: (_threadId: string | null) => grokBridge, registerThread: (threadId: string) => { grokThreadBridges.set(threadId, grokBridge); } },
    { id: "agy", requested: agyBackendRequested, resolve: (_threadId: string | null) => agyBridge, registerThread: (threadId: string) => { agyThreadBridges.set(threadId, agyBridge); } },
    { id: "auggie", requested: auggieBackendRequested, resolve: (threadId: string | null) => auggieBridgeFor(threadId), registerThread: undefined },
    { id: "cline", requested: clineBackendRequested, resolve: (threadId: string | null) => clineBridgeFor(threadId), registerThread: undefined },
    { id: "command-code", requested: commandCodeBackendRequested, resolve: (threadId: string | null) => commandCodeBridgeFor(threadId), registerThread: undefined },
  ];
  const winningBackend = backendBridgeTable.find((entry) => entry.requested);
  const runtimeBridge = effectiveMiniRequested
    ? miniBridge
    : winningBackend
      ? winningBackend.resolve(requestedThreadId ?? null)
      : (remoteBridge ?? autonomousBridge ?? restoredRemoteBridge ?? claudeBridge ?? bridgeForThread(requestedThreadId ?? null));
  if (effectiveMiniRequested && requestedThreadId) {
    miniThreadBridges.set(requestedThreadId, miniBridge);
  }
  if (requestedThreadId) {
    // Registration mirrors the pre-table semantics exactly: every
    // requesting singleton backend records the thread, not only the
    // dispatch winner.
    for (const entry of backendBridgeTable) {
      if (entry.requested) entry.registerThread?.(requestedThreadId);
    }
  }
  if (remoteBridge) {
    const { workspace: _workspace, remoteWorkspace: _remoteWorkspace, ...protocolParams } = asRecord(params);
    params = protocolParams as JsonValue;
  }
  if (authStore && user) {
    params = authStore.enforceMemberRpc(user, method, params) as JsonValue;
    if (method === "turn/start") authStore.assertCanStartTurn(user);
    if (
      method === "turn/start"
      || method === "thread/resume"
      || method === "thread/read"
      || method === "thread/fork"
      || method === "thread/turns/list"
      || method === "thread/items/list"
      || method === "thread/history/fileInfo"
      || method === "thread/history/tail"
      || method === "thread/archive"
      || method === "thread/delete"
      || method === "thread/name/set"
      || method === "thread/goal/set"
      || method === "thread/goal/get"
      || method === "thread/goal/clear"
      || method === "thread/inject_items"
    ) {
      const threadId = stringValue(asRecord(params).threadId);
      if (threadId && !authStore.ownsThread(threadId, user.id) && user.role !== "admin") {
        throw new Error("Thread belongs to another member");
      }
    }
    if (method === "fs/writeFile" && user.role !== "admin" && !user.allowWrite) {
      throw new Error("Member policy forbids filesystem writes");
    }
    if (isWorkspaceGitMutation(method) && user.role !== "admin" && !user.allowWrite) {
      throw new Error("Member policy forbids Git writes");
    }
  }
  if (requestedSshProfile && (method === "thread/start" || method === "thread/resume" || method === "thread/fork" || method === "turn/start")) {
    // Permission enforcement normally canonicalizes cwd against the local
    // Windows workspace root. SSH paths belong to the remote host and must
    // remain remote after the permission fields have been clamped.
    const enforced = asRecord(params);
    params = { ...enforced, cwd: requestedSshProfile.cwd } as JsonValue;
  }

  const vmRuntime = requestedThreadId ? threadRuntimeMetadataStore.getAny(requestedThreadId) : null;
  const requestedParamRecord = asRecord(params);
  const isVmExplicit = requestedParamRecord.vmEnabled === true || vmRuntime?.vmEnabled === true;
  const isEnhanceExplicit = requestedParamRecord.enhanceEnabled === true
    || vmRuntime?.enhanceEnabled === true
    || hasEnhanceToolsEnabled(asRecord(requestedParamRecord.vmPolicy)?.tools as SaVmToolsConfig)
    || hasEnhanceToolsEnabled(vmRuntime?.vmPolicy?.tools);
  const hasDynamicToolsSaVm = Array.isArray(requestedParamRecord.dynamicTools) && requestedParamRecord.dynamicTools.some((t) => asRecord(t).name === "sa_vm_run");

  const isVmEnabled = Boolean(
    isVmExplicit
    || (requestedParamRecord.vmEnabled !== false && vmRuntime?.vmEnabled !== false && !isEnhanceExplicit && hasDynamicToolsSaVm)
  );
  const isToolsActive = Boolean(isVmEnabled || isEnhanceExplicit || hasDynamicToolsSaVm);

  const effectiveCwd = vmRuntime?.cwd ?? (typeof requestedParamRecord.cwd === "string" && requestedParamRecord.cwd.trim() ? requestedParamRecord.cwd : process.cwd());
  const effectivePolicy = vmRuntime?.vmPolicy ?? (asRecord(requestedParamRecord.vmPolicy) as unknown as SaVmPolicyConfig | undefined);

  if (method === "turn/start" || method === "thread/start") {
    const homes = collectLocalCodexHomes();
    for (const home of homes) {
      await ensureEngineModelCatalogAligned(home, {
        vmEnabled: isToolsActive,
        bridge: runtimeBridge === bridge ? bridge : undefined
      }).catch((err) => {
        console.warn(`[codex-catalog] Failed aligning catalog at ${home}:`, err);
      });
    }
  }

  if (method === "thread/start" || method === "turn/start" || method === "thread/resume") {
    // 工程 MCP 保底：无害文件落盘，不写 home，门控外也执行，新机器 remote cwd 同样生效。
    // 回滚：SA_VM_BOOTSTRAP_DISABLED=1 时跳过，恢复纯全局链路。
    if (typeof effectiveCwd === "string" && effectiveCwd.trim() && process.env.SA_VM_BOOTSTRAP_DISABLED?.trim() !== "1") {
      void ensureSaVmProjectBundleInstalled(effectiveCwd).catch(() => {});
    }
    if (isToolsActive) {
      void syncSaVmWorkspaceSkillDirectory({
        cwd: effectiveCwd,
        threadId: requestedThreadId ?? "default",
        enabled: isVmEnabled,
        salaRoot: effectivePolicy?.fs?.salaRoot,
        policy: effectivePolicy ?? vmRuntime?.vmPolicy
      }).catch(() => {});
    }
  }

  if (isVmEnabled) {
    // The persisted thread workspace is authoritative in VM mode. Codex may
    // echo a stale/global cwd (especially immediately after a new chat is
    // created); forwarding it causes false "outside the thread VM roots"
    // denials and could steer a sidecar working directory. Absolute paths are
    // still checked against the thread policy below.
    params = {
      ...requestedParamRecord,
      ...(vmRuntime?.cwd && requestedParamRecord.cwd !== vmRuntime.cwd ? { cwd: vmRuntime.cwd } : {}),
      ...(method === "turn/start" || method === "thread/start" ? { approvalPolicy: "on-request" } : {})
    } as JsonValue;
    if (method === "turn/start" && requestedThreadId && (requestedParamRecord.vmEnabled === true || vmRuntime?.vmEnabled)) {
      const ownerId = user?.id ?? "local";
      const existingMeta = threadRuntimeMetadataStore.get(ownerId, requestedThreadId);
      if (existingMeta && (!existingMeta.vmEnabled || !existingMeta.vmPolicy)) {
        threadRuntimeMetadataStore.put(ownerId, {
          ...existingMeta,
          permission: existingMeta.permission ?? "dangerBypass",
          vmEnabled: true,
          vmPolicy: effectivePolicy ?? existingMeta.vmPolicy
        });
      }
    }
    if (vmRuntime) {
      const denial = vmRpcPolicyDenial(method, params, vmRuntime);
      if (denial) {
        await recordVmPolicyDenial(method, params, denial);
        throw new Error(`Policy guard denied ${method}: ${denial}`);
      }
    }
  }

  if (COMMAND_BLACKLIST_RPC_METHODS.has(method)) {
    const blocked = await inspectCommandBlacklist(method, params, user);
    if (blocked) {
      await recordBlockedCommand(method, blocked);
      const warning = blockedCommandNotification(params, blocked);
      if (warning) routeCodexNotification(warning);
      throw new Error("Dangerous operation detected; execution was blocked.");
    }
  }

  try {
    await auditLogStore.recordDangerousPermission(method, params);
  } catch (error) {
    console.warn("Failed to write dangerous permission audit event", { error, method });
  }

  if (authStore && user && method === "turn/start") {
    user = authStore.getUser(user.id) ?? user;
    onUserUpdated?.(user);
    const limit = authStore.getConcurrencyLimit(user.id);
    const inFlight = activeTurnCount(user.id);
    if (inFlight >= limit) {
      throw new Error(`Concurrency limit reached (${inFlight}/${limit}). Wait for a turn to finish or ask admin to raise concurrency.`);
    }
    if (user.role !== "admin" && !(Number(user.balance) > 0)) {
      throw new Error("Insufficient balance. Ask an admin to allocate credit.");
    }
  }

  // History listing is lazy per backend: the web sidebar asks for exactly one
  // scope at a time ("codex" first page on startup, "claude" only when its tab
  // is opened). Strip the scope before forwarding — the Codex app-server does
  // not know the field — and let mergeSshWorkspaceThreads honor it.
  const historyBackendScope = method === "thread/list"
    ? (stringValue(asRecord(params).cliBackend) === "claude" ? "claude" : stringValue(asRecord(params).cliBackend) === "agy" ? "agy" : stringValue(asRecord(params).cliBackend) === "grok" ? "grok" : stringValue(asRecord(params).cliBackend) === "muse" ? "muse" : stringValue(asRecord(params).cliBackend) === "pi" ? "pi" : stringValue(asRecord(params).cliBackend) === "opencode" ? "opencode" : stringValue(asRecord(params).cliBackend) === "opencode-v2" ? "opencode-v2" : stringValue(asRecord(params).cliBackend) === "mini" ? "mini" : stringValue(asRecord(params).cliBackend) === "codex" ? "codex" : stringValue(asRecord(params).cliBackend) === "cline" ? "cline" : stringValue(asRecord(params).cliBackend) === "command-code" ? "command-code" : stringValue(asRecord(params).cliBackend) === "auggie" ? "auggie" : undefined)
    : undefined;
  if (method === "thread/list") {
    const listParams = asRecord(params);
    params = {
      ...listParams,
      modelProviders: [],
      sourceKinds: Array.isArray(listParams.sourceKinds) && (listParams.sourceKinds as unknown[]).length > 0
        ? listParams.sourceKinds
        : ["cli", "vscode", "exec", "appServer"]
    } as JsonValue;
    delete (params as Record<string, JsonValue>).cliBackend;
    if (historyBackendScope === "claude") {
      return claudeThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "agy") {
      return agyThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "grok") {
      return grokThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "muse") {
      return museThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "pi") {
      return piThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "opencode") {
      return opencodeThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "opencode-v2") {
      return opencodeThreadListResult(rpcOwnerId, "opencode-v2");
    }
    if (historyBackendScope === "mini") {
      return miniThreadListResult(rpcOwnerId);
    }
    if (historyBackendScope === "cline") {
      return clineThreadListResult();
    }
    if (historyBackendScope === "command-code") {
      return commandCodeThreadListResult();
    }
    if (historyBackendScope === "auggie") {
      return auggieThreadListResult();
    }
  }
  // Remote SSH paths use the remote shell's home and separators. Never run
  // local Windows home expansion on them.
  if (!requestedSshProfile && !restoredRemoteBridge && !autonomousBridge) {
    params = expandFilesystemRpcParams(method, params as JsonValue);
  }
  if (method === "turn/start" && claudeBridge) {
    await claudeBridge.applyRuntimeConfig(params);
    params = await expandClaudeSkillTurnInput(claudeBridge, params as JsonValue);
  }
  const rpcParams = asRecord(params);
  const noTimeout = rpcParams.__codexUltraNoTimeout === true;
  const metadataOnlyFork = method === "thread/fork" && rpcParams.__codexUltraNoTurns === true;
  if ("__codexUltraNoTimeout" in rpcParams || "__codexUltraNoTurns" in rpcParams) {
    const {
      __codexUltraNoTimeout: _ignoredTimeout,
      __codexUltraNoTurns: _ignoredTurns,
      ...cleanParams
    } = rpcParams;
    params = cleanParams as JsonValue;
  }
  if (method === "thread/compact/start" && claudeBridge && requestedThreadId) {
    const metadata = threadRuntimeMetadataStore.get(user?.id ?? "local", requestedThreadId);
    if (!metadata) throw new Error("Claude compaction requires thread runtime metadata");
    const freeRoute = resolveCompactionRelayRoute(metadata);
    if (metadata.freeAutoCompactEnabled && !freeRoute) {
      throw new Error(`No valid free compaction route exists for ${metadata.model}`);
    }
    const route = freeRoute ?? (
      metadata.providerId && metadata.groupId && metadata.model
        ? { providerId: metadata.providerId, groupId: metadata.groupId, model: metadata.model }
        : null
    );
    if (!route) throw new Error("Claude compaction requires a thread-scoped relay and model");
    params = { ...asRecord(params), __claudeCompactionRoute: route } as JsonValue;
  }
  const codexRequestTimeoutMs = noTimeout
    ? 0
    : /^(thread\/(read|resume|turns\/list|items\/list))$/.test(method)
    ? 300_000
   : /^(config\/(batchWrite|value\/write))$/.test(method)
   ? 120_000
   : /^(plugin\/(install|uninstall))$/.test(method)
   ? 600_000
   : undefined;
  const resumedThreadId = method === "thread/resume" ? stringValue(asRecord(params).threadId) : null;
  const ownedResumeLease = resumedThreadId ? writerLeases.owns(resumedThreadId) : false;
  const turnStartThreadId = method === "turn/start" ? stringValue(asRecord(params).threadId) : null;
  const ownedTurnStartLease = turnStartThreadId ? writerLeases.owns(turnStartThreadId) : false;
  const reuseExistingSubscription = Boolean(
    resumedThreadId && ownedResumeLease && subscriptionRegistry.isSubscribed(resumedThreadId)
  );
  if (resumedThreadId && !writerLeases.acquire(resumedThreadId)) {
    throw new Error(`Thread ${resumedThreadId} is open in another Codex Ultra instance`);
  }
  if (turnStartThreadId && !writerLeases.acquire(turnStartThreadId)) {
    throw new Error(`Thread ${turnStartThreadId} is open in another Codex Ultra instance`);
  }

  if (method === "thread/start") {
    const paramRecord = asRecord(params);
    const rawModelProvider = stringValue(paramRecord.modelProvider)?.trim()
      || stringValue(paramRecord.providerId)?.trim();
    const effectiveModelProvider = rawModelProvider
      ? (rawModelProvider === "official-openai" || rawModelProvider === "chatgpt" || rawModelProvider === "openai" ? "openai" : rawModelProvider)
      : (claudeBackendRequested ? undefined : (grokBackendRequested ? "official-grok" : (museBackendRequested ? "official-muse" : (agyBackendRequested ? "agy" : undefined))));
    const effectiveModel = stringValue(paramRecord.model)?.trim();
    const existingConfig = asRecord(paramRecord.config);
    const nextConfig = { ...existingConfig };
    if (effectiveModelProvider) {
      nextConfig.model_provider = effectiveModelProvider;
    }
    if (effectiveModel) {
      nextConfig.model = effectiveModel;
    }
    params = {
      ...paramRecord,
      ...(effectiveModelProvider ? { modelProvider: effectiveModelProvider } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      config: nextConfig
    } as JsonValue;
  }

  if (method === "thread/resume") {
    params = localThreadResumeParams(params) ?? params;
  }
  if (method === "turn/start" && requestedThreadId) {
    const paramRecord = asRecord(params);
    const runtime = threadRuntimeMetadataStore.get(rpcOwnerId, requestedThreadId)
      ?? threadRuntimeMetadataStore.getAny(requestedThreadId);
    const nextParams = { ...paramRecord };
    if (!nextParams.model && runtime?.model) {
      nextParams.model = runtime.model;
    }
    if (!nextParams.modelProvider && runtime?.providerId) {
      const pid = runtime.providerId;
      nextParams.modelProvider = (pid === "official-openai" || pid === "chatgpt" || pid === "openai") ? "openai" : pid;
    }
    params = nextParams as JsonValue;
  }

  if (agyBackendRequested || grokBackendRequested || museBackendRequested || piBackendRequested || opencodeBackendRequested || opencodeV2BackendRequested || effectiveMiniRequested) {
    params = { ...asRecord(params), ownerId: rpcOwnerId } as JsonValue;
  }

  if (!requestedSshProfile && !restoredRemoteBridge && !autonomousBridge &&
      (method === "thread/start" || method === "thread/resume" || method === "thread/fork" || method === "turn/start")) {
    // The blocks above rebuild lifecycle params (thread/resume pulls the
    // persisted runtime cwd, thread/start enriches the model config), which
    // can reintroduce a "~" cwd after the first normalization. Expand again
    // right before dispatch so a stored tilde path never reaches the local
    // Codex app-server's AbsolutePathBuf.
    params = expandFilesystemRpcParams(method, params as JsonValue);
  }

  if (commandCodeBackendRequested && (method === "thread/start" || method === "thread/resume" || method === "thread/fork" || method === "turn/start")) {
    // Register the thread's relay station in the isolated Command Code
    // home before the bridge spawns the turn's process.
    await configureCommandCodeUpstream(rpcOwnerId, requestedThreadId ?? null, asRecord(params));
    if (requestedThreadId) bindCommandCodeThreadBridge(requestedThreadId, commandCodeBridgeFor(requestedThreadId));
  }

  if (clineBackendRequested && (method === "thread/start" || method === "thread/resume" || method === "thread/fork" || method === "turn/start")) {
    // Register the thread's relay station in the cline data dir and point
    // upcoming hub sessions at it before the bridge creates or prompts one.
    await configureClineUpstream(rpcOwnerId, requestedThreadId ?? null, asRecord(params));
    if (requestedThreadId) bindClineThreadBridge(requestedThreadId, clineBridgeFor(requestedThreadId));
  }

  if (auggieBackendRequested && (method === "thread/start" || method === "thread/resume" || method === "thread/fork" || method === "turn/start")) {
    // The redirector is a process-wide singleton: point it at this thread's
    // relay station before the bridge spawns or prompts the CLI.
    await configureAuggieUpstream(rpcOwnerId, requestedThreadId ?? null, asRecord(params));
    if (requestedThreadId) bindAuggieThreadBridge(requestedThreadId, auggieBridgeFor(requestedThreadId));
  }

  let result: JsonValue;
  try {
    if (method === "thread/start" && claudeBridgeForStart && claudeBridge && !claudeSshProfile) {
      // Own the workspace before the first spawn: phantom paths are created
      // now (fail-fast named error for file-blocked ones), so `thread/start`
      // never persists a cwd the CLI cannot start in. SSH threads use remote
      // paths and must never touch the local filesystem. Spawn-time
      // `ensureClaudeSpawnCwd` stays as the second layer for stale paths.
      // Inside the dispatch try so a failure still releases the pre-created
      // bridge/config dir via the catch below.
      const startCwd = stringValue(asRecord(params).cwd);
      if (startCwd?.trim()) prepareClaudeThreadCwd(startCwd);
    }
    const remoteHistoryRpc = Boolean(autonomousBridge) && isRemoteThreadHistoryMethod(method);
    const sshHistoryRpc = Boolean(remoteBridge || restoredRemoteBridge) && isRemoteThreadHistoryMethod(method);
    const claudeHistoryRpc = Boolean(claudeBridge) && isRemoteThreadHistoryMethod(method);
    const agyHistoryRpc = agyBackendRequested && isRemoteThreadHistoryMethod(method);
    const auggieHistoryRpc = auggieBackendRequested && isRemoteThreadHistoryMethod(method);
    const clineHistoryRpc = clineBackendRequested && isRemoteThreadHistoryMethod(method);
    const commandCodeHistoryRpc = commandCodeBackendRequested && isRemoteThreadHistoryMethod(method);
    const grokHistoryRpc = grokBackendRequested && isRemoteThreadHistoryMethod(method);
    const museHistoryRpc = museBackendRequested && isRemoteThreadHistoryMethod(method);
    const piHistoryRpc = piBackendRequested && isRemoteThreadHistoryMethod(method);
    const opencodeHistoryRpc = opencodeBackendRequested && isRemoteThreadHistoryMethod(method);
    result = claudeBridge && isClaudeHostSkillRpc(method)
      ? await handleClaudeHostSkillRpc(claudeBridge, method, params as JsonValue, user)
      : remoteHistoryRpc
      ? await runtimeBridge.request(method, params, codexRequestTimeoutMs)
      : opencodeHistoryRpc && method === "thread/history/fileInfo"
      ? await runtimeBridge.request("thread/history/fileInfo", params, codexRequestTimeoutMs)
      : (claudeHistoryRpc || agyHistoryRpc || auggieHistoryRpc || clineHistoryRpc || commandCodeHistoryRpc || grokHistoryRpc || museHistoryRpc || piHistoryRpc) && method === "thread/history/fileInfo"
      ? { exists: false }
      : claudeHistoryRpc && method === "thread/history/tail"
      ? await runtimeBridge.request("thread/history/tail", params, codexRequestTimeoutMs)
      : opencodeHistoryRpc && method === "thread/history/tail"
      ? await runtimeBridge.request("thread/history/tail", params, codexRequestTimeoutMs)
      : (sshHistoryRpc || agyHistoryRpc || grokHistoryRpc || museHistoryRpc || piHistoryRpc) && method === "thread/history/tail"
      ? await runtimeBridge.request("thread/read", { threadId: requiredThreadId(asRecord(params)), includeTurns: true }, codexRequestTimeoutMs)
      : method === "thread/history/fileInfo"
      ? await threadHistoryFileInfo(runtimeBridge, asRecord(params)) as JsonValue
      : method === "thread/history/tail"
      ? await threadHistoryTail(runtimeBridge, asRecord(params)) as JsonValue
      : isWorkspaceGitMethod(method)
      ? await handleWorkspaceGitRpc(
          method,
          asRecord(params),
          requestedSshProfile,
          vmRuntime?.vmEnabled ? normalizeSaVmPolicy(vmRuntime.vmPolicy, stringValue(asRecord(params).cwd) ?? vmRuntime.cwd ?? process.cwd(), vmRuntime.additionalRoots ?? []) : undefined
        ) as JsonValue
      : method === "fs/readFile" && !requestedSshProfile && (runtimeBridge !== bridge || !isCliPluginEnabled("codex") || agyBackendRequested || grokBackendRequested || piBackendRequested || opencodeBackendRequested || effectiveMiniRequested)
      ? await readLocalWorkspaceFileRpc(stringValue(asRecord(params).path) ?? "", stringValue(asRecord(params).cwd), user)
      : method === "fs/writeFile" && !requestedSshProfile && (runtimeBridge !== bridge || !isCliPluginEnabled("codex") || agyBackendRequested || grokBackendRequested || piBackendRequested || opencodeBackendRequested || effectiveMiniRequested)
      ? await writeLocalWorkspaceFileRpc(stringValue(asRecord(params).path) ?? "", stringValue(asRecord(params).cwd), stringValue(asRecord(params).dataBase64), stringValue(asRecord(params).content) ?? stringValue(asRecord(params).text), user)
      : await requestWithLocalAgentLoopRecovery({
          method: reuseExistingSubscription ? "thread/read" : method,
          params,
          local: runtimeBridge === bridge,
          resumeParams: method === "turn/start" ? localThreadResumeParams(params) : undefined,
          request: (requestMethod, requestParams) => requestWithThreadStartHistoryFallback({
            method: requestMethod,
            params: requestParams,
            request: (fallbackMethod, fallbackParams) => runtimeBridge.request(fallbackMethod, fallbackParams, codexRequestTimeoutMs)
          }),
          onResumed: (threadId) => subscriptionRegistry.markSubscribed(threadId)
        });
  } catch (error) {
    if (claudeBridgeForStart && claudeBridge) {
      claudeBridge.stop();
      const configDir = claudeConfigDirs.get(claudeBridge);
      claudeConfigDirs.delete(claudeBridge);
      if (configDir) void removeClaudeConfigDirAfterExit(claudeBridge, configDir);
    }
    if (resumedThreadId && !ownedResumeLease) writerLeases.release(resumedThreadId);
    if (turnStartThreadId && !ownedTurnStartLease) writerLeases.release(turnStartThreadId);
    await handleThreadAgentFailure(requestedThreadId ?? null, error);
    throw error;
  }

  if (method === "turn/interrupt" && (remoteBridge || agyBackendRequested || grokBackendRequested || museBackendRequested || piBackendRequested || opencodeBackendRequested || opencodeV2BackendRequested || effectiveMiniRequested || (requestedThreadId && (agyThreadBridges.has(requestedThreadId) || agyBridge.hasSession(requestedThreadId) || grokThreadBridges.has(requestedThreadId) || grokBridge.hasSession(requestedThreadId) || museThreadBridges.has(requestedThreadId) || museBridge.hasSession(requestedThreadId) || piThreadBridges.has(requestedThreadId) || piBridge.hasSession(requestedThreadId) || opencodeThreadBridges.has(requestedThreadId) || opencodeBridge.hasSession(requestedThreadId) || opencodeV2Bridge.hasSession(requestedThreadId) || miniThreadBridges.has(requestedThreadId) || miniBridge.hasSession(requestedThreadId, rpcOwnerId))))) {
    const interruptParams = asRecord(params);
    const threadId = stringValue(interruptParams.threadId);
    const turnId = stringValue(interruptParams.turnId);
    if (threadId) {
      routeCodexNotification({
        method: "turn/interrupted",
        params: {
          threadId,
          ...(turnId ? { turnId, turn: { id: turnId, threadId, status: "interrupted", completedAt: Math.floor(Date.now() / 1000) } } : {})
        }
      });
    }
  }

  if (method === "thread/resume" && resumedThreadId) {
    subscriptionRegistry.markSubscribed(resumedThreadId);
    subscriptionRegistry.watch(resumedThreadId, clientId);
  }
  if (method === "thread/start") {
    const startedThreadId = extractThreadId(result);
    if (startedThreadId) {
      // Fail fast when an explicit codex request was silently served by Mini
      // (AutoFallback active / Codex CLI unavailable). Persisting `codex`
      // metadata for a Mini-built thread mislabels it in the UI while every
      // later turn is hijacked back to Mini via the Mini session/file check.
      // Only explicit `codex` fails here; unspecified backends keep the old
      // fallback behavior so the app stays usable without a Codex CLI.
      if (
        !effectiveMiniRequested && !opencodeBackendRequested && !opencodeV2BackendRequested && !piBackendRequested
        && !agyBackendRequested && !grokBackendRequested && !claudeBridge
        && paramCliBackend === "codex"
      ) {
        const actualBackend = stringValue(asRecord(asRecord(result).thread).cliBackend);
        if (actualBackend === "mini") {
          // Best-effort cleanup so the orphan Mini session cannot hijack later turns.
          try {
            await miniBridge.request("thread/delete", { threadId: startedThreadId, ownerId: rpcOwnerId });
          } catch { /* ignore cleanup failures */ }
          throw new Error(
            `Codex runtime unavailable (fallback to Mini active): thread ${startedThreadId} was built by Mini, not Codex. Restart the Codex runtime and retry, or create the conversation with Mini explicitly.`
          );
        }
      }
      if (isVmEnabled || isEnhanceExplicit) {
        const startReq = asRecord(params);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        const effectiveCwd = vmRuntime?.cwd ?? (typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd());
        const effectivePolicy = vmRuntime?.vmPolicy ?? (asRecord(startReq.vmPolicy) as unknown as SaVmPolicyConfig | undefined);
        threadRuntimeMetadataStore.put(ownerId, {
          threadId: startedThreadId,
          permission: (stringValue(startReq.permission) as PermissionPresetId) ?? existingMeta?.permission ?? "dangerBypass",
          providerId: stringValue(startReq.providerId) ?? existingMeta?.providerId ?? null,
          groupId: stringValue(startReq.groupId) ?? existingMeta?.groupId ?? null,
          model: stringValue(startReq.model) ?? existingMeta?.model ?? "",
          reasoningEffort: existingMeta?.reasoningEffort ?? "medium",
          vmEnabled: isVmEnabled,
          enhanceEnabled: isEnhanceExplicit,
          vmPolicy: effectivePolicy ?? existingMeta?.vmPolicy,
          cwd: effectiveCwd,
          ...(effectiveMiniRequested ? { cliBackend: "mini" as const } : opencodeV2BackendRequested ? { cliBackend: "opencode-v2" as const } : opencodeBackendRequested ? { cliBackend: "opencode" as const } : piBackendRequested ? { cliBackend: "pi" as const } : agyBackendRequested ? { cliBackend: "agy" as const } : grokBackendRequested ? { cliBackend: "grok" as const } : museBackendRequested ? { cliBackend: "muse" as const } : claudeBridge ? { cliBackend: "claude" as const } : {})
        });
        void syncSaVmWorkspaceSkillDirectory({
          cwd: effectiveCwd,
          threadId: startedThreadId,
          enabled: isVmEnabled,
          salaRoot: effectivePolicy?.fs?.salaRoot,
          policy: effectivePolicy ?? existingMeta?.vmPolicy
        }).catch(() => {});
      }
      if (claudeBridge) {
        claudeThreadBridges.set(startedThreadId, claudeBridge);
      }
      if (agyBackendRequested) {
        agyThreadBridges.set(startedThreadId, agyBridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? AGY_OFFICIAL_PROVIDER_ID,
            groupId: stringValue(startReq.groupId) ?? "default",
            model: stringValue(startReq.model) ?? "",
            reasoningEffort: "medium",
            cliBackend: "agy",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
          });
        }
      }
      if (grokBackendRequested) {
        grokThreadBridges.set(startedThreadId, grokBridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? GROK_OFFICIAL_PROVIDER_ID,
            groupId: stringValue(startReq.groupId) ?? "default",
            model: stringValue(startReq.model) ?? "grok-4.6",
            reasoningEffort: "medium",
            cliBackend: "grok",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
          });
        }
      }
      if (museBackendRequested) {
        museThreadBridges.set(startedThreadId, museBridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta || !existingMeta.cliBackend) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            ...(existingMeta ?? {}),
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? existingMeta?.permission ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? existingMeta?.providerId ?? MUSE_OFFICIAL_PROVIDER_ID,
            groupId: stringValue(startReq.groupId) ?? existingMeta?.groupId ?? "default",
            model: stringValue(startReq.model) ?? existingMeta?.model ?? "muse-spark-1.3",
            reasoningEffort: existingMeta?.reasoningEffort ?? "medium",
            cliBackend: "muse",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : (existingMeta?.cwd ?? process.cwd())
          });
        }
      }
      if (piBackendRequested) {
        piThreadBridges.set(startedThreadId, piBridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? PI_OFFICIAL_PROVIDER_ID,
            groupId: stringValue(startReq.groupId) ?? "default",
            model: stringValue(startReq.model) ?? "pi-relay/default",
            reasoningEffort: "medium",
            cliBackend: "pi",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
          });
        }
      }
      if (opencodeBackendRequested) {
        opencodeThreadBridges.set(startedThreadId, opencodeBridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? OPENCODE_OFFICIAL_PROVIDER_ID,
            groupId: stringValue(startReq.groupId) ?? OPENCODE_V1_GROUP_ID,
            model: stringValue(startReq.model) ?? "default",
            reasoningEffort: "medium",
            cliBackend: "opencode",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
          });
        }
      }
      if (opencodeV2BackendRequested) {
        opencodeThreadBridges.set(startedThreadId, opencodeV2Bridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? OPENCODE_OFFICIAL_PROVIDER_ID,
            groupId: stringValue(startReq.groupId) ?? OPENCODE_V2_GROUP_ID,
            model: stringValue(startReq.model) ?? "default",
            reasoningEffort: "medium",
            cliBackend: "opencode-v2",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
          });
        }
      }
      if (effectiveMiniRequested) {
        miniThreadBridges.set(startedThreadId, miniBridge);
        const ownerId = user?.id ?? "local";
        const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
        if (!existingMeta) {
          const startReq = asRecord(params);
          threadRuntimeMetadataStore.put(ownerId, {
            threadId: startedThreadId,
            permission: (stringValue(startReq.permission) as PermissionPresetId) ?? "dangerBypass",
            providerId: stringValue(startReq.providerId) ?? null,
            groupId: stringValue(startReq.groupId) ?? "default",
            model: stringValue(startReq.model) ?? "gpt-5-mini",
            reasoningEffort: "medium",
            cliBackend: "mini",
            cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
          });
        }
      }
      const ownerId = user?.id ?? "local";
      const existingMeta = threadRuntimeMetadataStore.get(ownerId, startedThreadId);
      if (!existingMeta) {
        const startReq = asRecord(params);
        const effectiveProviderId = stringValue(startReq.providerId)
          ?? (stringValue(startReq.modelProvider) === "openai" ? "official-openai" : stringValue(startReq.modelProvider));
        // Store unconditionally like every other backend (agy/grok/pi/opencode/
        // mini): a relay-less codex thread previously persisted nothing, so a
        // reopen fell back to the history default (mini) and mislabeled/misrouted
        // the thread. An explicit "codex" row is also consistent with the
        // server's default route and the sidebar's `?? "codex"` display.
        threadRuntimeMetadataStore.put(ownerId, {
          threadId: startedThreadId,
          permission: (stringValue(startReq.permission) as PermissionPresetId) || "dangerBypass",
          providerId: effectiveProviderId ?? null,
          groupId: stringValue(startReq.groupId) ?? "default",
          model: stringValue(startReq.model) ?? "",
          reasoningEffort: stringValue(startReq.effort) ?? "medium",
          cliBackend: "codex",
          cwd: typeof startReq.cwd === "string" && startReq.cwd.trim() ? startReq.cwd : process.cwd()
        });
      }
      if (remoteBridge) sshThreadBridges.set(startedThreadId, remoteBridge);
      // Both remote backends persist the workspace so a reopened history can
      // rebuild the same bridge without the UI resending the SSH metadata.
      const startedSshProfile = remoteBridge ? requestedSshProfile : claudeBridge ? claudeSshProfile : null;
      if (startedSshProfile) sshWorkspaceStore.put(startedThreadId, startedSshProfile);
      if (startedSshProfile && result && typeof result === "object" && !Array.isArray(result)) {
        const resultRecord = asRecord(result);
        const thread = asRecord(resultRecord.thread);
        if (thread.id) {
          result = { ...resultRecord, thread: { ...thread, cwd: startedSshProfile.cwd, workspaceMode: "ssh", sshCommand: startedSshProfile.command, sshCwd: startedSshProfile.cwd } } as JsonValue;
        }
      }
      writerLeases.acquire(startedThreadId);
      subscriptionRegistry.markSubscribed(startedThreadId);
      subscriptionRegistry.watch(startedThreadId, clientId);
    }
  }
  if (method === "thread/fork") {
    const forkedThreadId = extractThreadId(result);
    if (forkedThreadId) {
      const parentThreadId = requestedThreadId;
      const ownerId = user?.id ?? "local";
      const parentMeta = parentThreadId ? (threadRuntimeMetadataStore.get(ownerId, parentThreadId) ?? threadRuntimeMetadataStore.getAny(parentThreadId)) : null;
      if (parentMeta) {
        threadRuntimeMetadataStore.put(ownerId, {
          ...parentMeta,
          permission: parentMeta.permission ?? "dangerBypass",
          threadId: forkedThreadId
        });
      }
      const parentSshBridge = parentThreadId ? sshThreadBridges.get(parentThreadId) : undefined;
      if (parentSshBridge) {
        sshThreadBridges.set(forkedThreadId, parentSshBridge);
        sshWorkspaceStore.put(forkedThreadId, parentSshBridge.profile, parentThreadId);
      }
      writerLeases.acquire(forkedThreadId);
      subscriptionRegistry.markSubscribed(forkedThreadId);
      subscriptionRegistry.watch(forkedThreadId, clientId);
    }
  }
  if (method === "thread/unsubscribe") {
    const unsubscribedThreadId = stringValue(asRecord(params).threadId);
    if (unsubscribedThreadId) subscriptionRegistry.markUnsubscribed(unsubscribedThreadId);
  }
  if (isCodeCliTerminalThreadMethod(method)) {
    const closedClaudeThreadId = stringValue(asRecord(params).threadId);
    if (closedClaudeThreadId) {
      const releasedBridge = claudeThreadBridges.get(closedClaudeThreadId) ?? claudeBridge;
      const releasedThreadIds = releaseClaudeThreadTree(closedClaudeThreadId);
      if (method === "thread/delete") {
        for (const releasedThreadId of releasedThreadIds) claudeSessionStore.deleteByThread(releasedThreadId);
        agySessionStore.deleteByThread(closedClaudeThreadId);
        agyBridge.deleteSession(closedClaudeThreadId);
        grokBridge.deleteSession(closedClaudeThreadId);
        museBridge.deleteSession(closedClaudeThreadId);
        museSessionStore.deleteByThread(closedClaudeThreadId);
        piBridge.deleteSession(closedClaudeThreadId);
        piSessionStore.deleteByThreadId(closedClaudeThreadId);
        opencodeBridge.deleteSession(closedClaudeThreadId);
        opencodeSessionStore.deleteByThreadId(closedClaudeThreadId);
      }
      if (releasedBridge) await claudeConfigCleanup.get(releasedBridge);
    }
  }
  if (method === "thread/delete") {
    // Mini history is file-based: deleting only the in-memory session would
    // leave the .md behind and resurrect the thread in the history list
    // after a restart (the old SQLite ghost bug). Remove the whole file tree.
    const deletedThreadId = stringValue(asRecord(params).threadId);
    const deletableMini = deletedThreadId
      ? miniHistory.get(rpcOwnerId, deletedThreadId)
        ?? (rpcOwnerId !== "local" ? miniHistory.get("local", deletedThreadId) : null)
      : null;
    if (deletedThreadId && (deletableMini || miniBridge.hasSession(deletedThreadId, rpcOwnerId))) {
      try {
        miniHistory.deleteTree(deletedThreadId);
      } catch (error) {
        console.warn(`[mini-history] delete failed for ${deletedThreadId}:`, error);
      }
      miniThreadBridges.delete(deletedThreadId);
    }
    if (deletedThreadId) releaseAuggieThreadBridge(deletedThreadId);
    if (deletedThreadId) releaseClineThreadBridge(deletedThreadId);
    if (deletedThreadId) releaseCommandCodeThreadBridge(deletedThreadId);
  }
  if (/^thread\/(read|resume|turns\/list)$/.test(method)) {
      result = await restoreLegacyImageViewsForRpc(runtimeBridge, method, asRecord(params), result);
  }
  if (method === "thread/read" || method === "thread/resume") {
    result = annotateSshThreadResult(result);
  }
  if (effectiveMiniRequested && requestedThreadId
    && (method === "thread/read" || method === "thread/resume" || method === "thread/turns/list" || method === "thread/items/list")
    && storedCliBackend !== "mini") {
    // Legacy mini threads carry no (or a mislabeled `codex`) runtime metadata.
    // The routing fallback above already rescued this open via the history
    // file; write the correct classification back so subsequent opens,
    // backend-dependent UI, and turn routing take the fast path.
    try {
      healMiniRuntimeBackend(rpcOwnerId, requestedThreadId);
    } catch {
      /* best-effort: the open itself already succeeded */
    }
  }
  // A writer-conflict recovery forks from a potentially very large history.
  // The UI immediately loads a bounded first page, so never send the complete
  // fork transcript back through the browser websocket.
  if (metadataOnlyFork) {
    result = stripThreadTurns(result);
  }
  if (method === "thread/list" && !stringValue(asRecord(params).cursor)) {
    result = mergeSshWorkspaceThreads(result, user?.id ?? "local", historyBackendScope);
  }

  if (authStore && user) {
    if (method === "thread/start") {
      const threadId = extractThreadId(result);
      if (threadId) authStore.claimThread(threadId, user.id);
    }
    if (method === "thread/fork") {
      const threadId = extractThreadId(result);
      if (threadId) authStore.claimThread(threadId, user.id);
    }
    if (method === "thread/list") {
      result = authStore.filterThreadsForUser(user, result) as JsonValue;
    }
    if (method === "turn/start") {
      const turnKey = extractTurnKey(result, asRecord(params));
      if (turnKey) {
        trackTurnStart(user.id, turnKey);
        const threadId = stringValue(asRecord(params).threadId);
        if (threadId) trackTurnStart(user.id, `thread-active:${threadId}`);
      }
    }
  }

  if (method === "turn/start") {
    const threadId = stringValue(asRecord(params).threadId);
    const turnKey = extractTurnKey(result, asRecord(params)) ?? (threadId ? `thread-active:${threadId}` : null);
    if (threadId && turnKey) {
      subscriptionRegistry.markSubscribed(threadId);
      subscriptionRegistry.addTurnHold(threadId, turnKey);
    }
  }

  return result;
}

async function handleClientMessage(ws: RuntimeSocket<SocketData>, message: ClientToServerMessage): Promise<void> {
  switch (message.type) {
    case "heartbeat.ping": {
      const now = Date.now();
      ws.data.lastHeartbeatAt = now;
      ws.data.lastHeartbeatRttMs = Math.max(0, now - message.sentAt);
      send(ws, {
        type: "heartbeat.pong",
        id: message.id,
        sentAt: message.sentAt,
        receivedAt: ws.data.lastHeartbeatAt
      });
      return;
    }
    case "heartbeat.pong": {
      const now = Date.now();
      ws.data.lastHeartbeatAt = now;
      ws.data.lastHeartbeatRttMs = Math.max(0, now - message.sentAt);
      return;
    }
    case "rpc": {
      try {
        const result = await executeCodexRpc({
          user: ws.data.user,
          clientId: ws.data.clientId,
          method: message.method,
          params: message.params,
          onUserUpdated: (user) => {
            ws.data.user = user;
          }
        });
        send(ws, { type: "rpc.result", id: message.id, result });
      } catch (error) {
        const params = asRecord(message.params);
        const workspace = asRecord(params.workspace);
        const errorThreadId = stringValue(params.threadId);
        const execution = errorThreadId && remoteThreadRouteStore.get(errorThreadId)
          ? "remote-bun"
          : workspace.type === "ssh" || (errorThreadId && sshWorkspaceStore.get(errorThreadId))
          ? "ssh"
          : "local";
        // Surface the offending path for create-thread failures (e.g. a
        // tilde-style cwd the local app-server's AbsolutePathBuf rejects),
        // so the message names the cause instead of only the Rust error.
        const rawThreadStartCwd = message.method === "thread/start" ? stringValue(params.cwd) : null;
        send(ws, {
          type: "rpc.error",
          id: message.id,
          error: detailedRpcError(error, {
            execution,
            method: message.method,
            stage: message.method === "thread/start" ? "create-thread" : message.method === "turn/start" ? "start-turn" : "rpc",
            threadId: stringValue(params.threadId),
            providerId: stringValue(params.modelProvider) ?? stringValue(workspace.providerId),
            groupId: stringValue(workspace.groupId),
            ...(rawThreadStartCwd ? { detail: `cwd="${rawThreadStartCwd}"` } : {})
          })
        });
      }
      return;
    }
    case "serverResponse": {
      respondToCodexServerRequest(message.requestId, message.result, message.error);
      return;
    }
    case "provider.save": {
      const officialOAuthProvider = message.provider.kind === "chatgpt" && message.provider.id === "official-openai";
      if (ws.data.user && ws.data.user.role !== "admin" && !officialOAuthProvider) {
        send(ws, { type: "server.error", id: message.id, message: "Admin only: provider management" });
        return;
      }
      const provider = await providerStore.save(message.provider, message.apiKey, message.mergeIntoProviderId);
      send(ws, { type: "provider.saved", id: message.id, provider });
      return;
    }
    case "provider.delete": {
      if (ws.data.user && ws.data.user.role !== "admin") {
        send(ws, { type: "server.error", id: message.id, message: "Admin only: provider management" });
        return;
      }
      await providerStore.delete(message.providerId);
      send(ws, { type: "provider.deleted", id: message.id, providerId: message.providerId });
      return;
    }
    case "provider.trash": {
      if (ws.data.user && ws.data.user.role !== "admin") {
        send(ws, { type: "server.error", id: message.id, message: "Admin only: provider management" });
        return;
      }
      await providerStore.trash(message.providerId);
      send(ws, { type: "provider.trashed", id: message.id, providerId: message.providerId });
      return;
    }
    case "provider.restore": {
      if (ws.data.user && ws.data.user.role !== "admin") {
        send(ws, { type: "server.error", id: message.id, message: "Admin only: provider management" });
        return;
      }
      const provider = await providerStore.restore(message.providerId);
      send(ws, { type: "provider.restored", id: message.id, provider });
      return;
    }
    case "provider.activate": {
      try {
        const actor = ws.data.user;
        if (actor && actor.role !== "admin") {
          const provider = await providerStore.get(message.providerId);
          if (provider?.kind !== "chatgpt" && !securityStore.isProviderAllowed(actor.id, message.providerId, false)) {
            send(ws, { type: "server.error", id: message.id, message: "Relay not assigned to this member" });
            return;
          }
        }
        const activation = await runProviderActivationExclusive(() => activateProvider(message.providerId, message.model, message.groupId));
        send(ws, { type: "provider.activated", id: message.id, activation });
      } catch (error) {
        send(ws, {
          type: "server.error",
          id: message.id,
          message: errorToMessage(error)
        });
      }
      return;
    }
    case "thread.watch": {
      subscriptionRegistry.watch(message.threadId, ws.data.clientId);
      return;
    }
    case "thread.unwatch": {
      subscriptionRegistry.unwatch(message.threadId, ws.data.clientId);
      return;
    }
  }
}

function extractThreadId(result: JsonValue): string | null {
  const record = asRecord(result);
  const thread = asRecord(record.thread);
  const id = stringValue(thread.id) ?? stringValue(record.id) ?? stringValue(record.threadId);
  return id ?? null;
}

function stripThreadTurns(result: JsonValue): JsonValue {
  const record = asRecord(result);
  const thread = asRecord(record.thread);
  if (!record.thread || !thread.id) return result;
  return {
    ...record,
    thread: {
      ...thread,
      turns: []
    }
  } as JsonValue;
}

function codexApiOwnerId(user: AuthUser | null): string | null {
  return user?.id ?? null;
}

function requireCodexApiSession(
  request: Request,
  url: URL,
  body: Record<string, unknown>,
  user: AuthUser | null
): CodexApiSession {
  const sessionId = (
    request.headers.get("x-codex-api-session")
    ?? url.searchParams.get("sessionId")
    ?? stringValue(body.sessionId)
    ?? ""
  ).trim();
  if (!sessionId) throw new HttpApiError(400, "Codex API session is required");
  const session = codexApiSessions.get(sessionId, codexApiOwnerId(user));
  if (!session) throw new HttpApiError(404, "Codex API session not found or expired");
  return session;
}

function canReadCodexApiEvent(user: AuthUser | null, event: CodexApiEvent): boolean {
  if (event.kind === "engineStatus" || !authStore) return true;
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!event.threadId) return event.kind === "notification";
  return codexApiEventThreadIds(event).some((threadId) => authStore.ownsThread(threadId, user.id));
}

function codexApiEventThreadIds(event: CodexApiEvent): string[] {
  const payload = asRecord(event.payload);
  const params = asRecord(payload.params);
  const thread = asRecord(params.thread);
  return [
    event.threadId,
    stringValue(params.parentThreadId),
    stringValue(thread.parentThreadId),
    stringValue(asRecord(params.turn).parentThreadId)
  ].filter((value): value is string => Boolean(value));
}

const latestThreadTokenUsage = new Map<string, unknown>();
const turnToThreadMap = new Map<string, string>();

async function routeServerRequest(message: JsonRpcRequest): Promise<void> {
  const params = asRecord(message.params);
  const turnId = stringValue(params.turnId)
    ?? stringValue(params.turn_id)
    ?? stringValue(asRecord(params.turn).id)
    ?? stringValue(asRecord(params.item).turnId);
  const threadId = stringValue(params.threadId)
    ?? stringValue(params.thread_id)
    ?? stringValue(asRecord(params.thread).id)
    ?? stringValue(asRecord(params.turn).threadId)
    ?? stringValue(asRecord(params.item).threadId)
    ?? (turnId ? turnToThreadMap.get(turnId) : null)
    ?? (turnToThreadMap.size === 1 ? turnToThreadMap.values().next().value : null);
  const vmRuntime = threadId ? threadRuntimeMetadataStore.getAny(threadId) : null;
  const isEnhanceActive = Boolean(vmRuntime?.enhanceEnabled || hasEnhanceToolsEnabled(vmRuntime?.vmPolicy?.tools));
  const isVmActive = Boolean(vmRuntime?.vmEnabled);
  if (threadId && vmRuntime && (isVmActive || isEnhanceActive) && message.method === "item/tool/call" && stringValue(params.tool) === "sa_vm_run") {
    const effectiveCwd = vmRuntime?.cwd ?? stringValue(params.cwd) ?? process.cwd();
    if (isVmActive && !vmRuntime?.cwd) {
      respondToCodexServerRequest(message.id, {
        contentItems: [{ type: "inputText", text: JSON.stringify({ ok: false, kind: "sa_error", exitCode: null, stdout: "", stderr: "SA-VM requires a persisted workspace for this thread", saVmEvents: [], saVmViolation: null, durationMs: 0 }) }],
        success: true
      });
      return;
    }
    const argumentsValue = parseDynamicToolArguments(params.arguments);
    const rawPathCandidate = (
      argumentsValue.path ??
      argumentsValue.file ??
      argumentsValue.target ??
      argumentsValue.filePath ??
      argumentsValue.file_path ??
      argumentsValue.targetFile ??
      argumentsValue.target_file ??
      argumentsValue.filename ??
      argumentsValue.fileName ??
      argumentsValue.AbsolutePath ??
      argumentsValue.absolute_path ??
      argumentsValue.uri
    ) as string | undefined;
    const hasAction = typeof argumentsValue.action === "string" || typeof rawPathCandidate === "string";
    const isParallel = Array.isArray(argumentsValue.parallel) || (typeof argumentsValue.parallel === "string" && argumentsValue.parallel.trim().length > 0);
    const hasSource = typeof argumentsValue.source === "string";
    if (!hasAction && !isParallel && !hasSource) {
      const result = {
        ok: false,
        kind: "sa_error",
        exitCode: null,
        stdout: "",
        stderr: "sa_vm_run requires an 'action' (e.g. read_file, find_files, write_file, edit_file, apply_patch, grep_search) or 'source' code",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: 0
      } as const;
      respondToCodexServerRequest(message.id, {
        contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
        // The VM broker handled the request and returned a deterministic
        // policy/input error. Mark the tool envelope as handled so the
        // upstream model does not enter an automatic retry loop.
        success: true
      });
      return;
    }
    const { isJs: isJsReq, isPy: isPyReq } = classifySaVmExecutionRequest(argumentsValue);
    if (isPyReq && vmRuntime.vmPolicy?.execution?.python !== true) {
      await recordVmPolicyDenial(message.method, message.params, "Python execution is disabled by VM policy");
      respondToCodexServerRequest(message.id, {
        contentItems: [{
          type: "inputText",
          text: JSON.stringify({
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: "SA-VM terminal policy denial: Python script execution (run_py) is disabled by VM policy and direct Python execution cannot bypass the VM sandbox. Do not retry run_py; use packaged native tools (e.g. find_files, grep_search, read_file, edit_file, apply_patch).",
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "python_execution_disabled" }],
            saVmViolation: { rule: "execution.python", blocked: true },
            durationMs: 0,
            terminal: true
          })
        }],
        success: true
      });
      return;
    }
    if (isJsReq && vmRuntime.vmPolicy?.execution?.javascript !== true) {
      await recordVmPolicyDenial(message.method, message.params, "JavaScript execution is disabled by VM policy");
      respondToCodexServerRequest(message.id, {
        contentItems: [{
          type: "inputText",
          text: JSON.stringify({
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: "SA-VM terminal policy denial: JavaScript execution (run_js) is disabled by VM policy and direct JavaScript execution cannot bypass the VM sandbox. Do not retry run_js; use packaged native tools.",
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "javascript_execution_disabled" }],
            saVmViolation: { rule: "execution.javascript", blocked: true },
            durationMs: 0,
            terminal: true
          })
        }],
        success: true
      });
      return;
    }
    const lastUsage = threadId ? latestThreadTokenUsage.get(threadId) : null;
    const contextInfo = lastUsage ? contextUsageView(lastUsage) : null;
    const computedRemainingTokens = contextInfo
      ? Math.max(0, Number(contextInfo.contextWindow) - Number(contextInfo.usedTokens))
      : undefined;

    const remainingTokens = typeof argumentsValue.remaining_tokens === "number"
      ? argumentsValue.remaining_tokens
      : (typeof argumentsValue.tokens_remaining === "number"
        ? argumentsValue.tokens_remaining
        : (typeof argumentsValue.tokens_left === "number" ? argumentsValue.tokens_left : computedRemainingTokens));

    const maxTokens = typeof argumentsValue.max_tokens === "number"
      ? argumentsValue.max_tokens
      : (typeof argumentsValue.max_token === "number"
        ? argumentsValue.max_token
        : (typeof argumentsValue.maxtoken === "number" ? argumentsValue.maxtoken : undefined));

    let result: SaVmRunResult;
    try {
      result = await runSaVmTool({
        ...argumentsValue,
        action: argumentsValue.action as string | undefined,
        path: rawPathCandidate,
        file: typeof argumentsValue.file === "string" ? argumentsValue.file : rawPathCandidate,
        target: typeof argumentsValue.target === "string" ? argumentsValue.target : undefined,
        filePath: typeof argumentsValue.filePath === "string" ? argumentsValue.filePath : undefined,
        file_path: typeof argumentsValue.file_path === "string" ? argumentsValue.file_path : undefined,
        targetFile: typeof argumentsValue.targetFile === "string" ? argumentsValue.targetFile : undefined,
        target_file: typeof argumentsValue.target_file === "string" ? argumentsValue.target_file : undefined,
        filename: typeof argumentsValue.filename === "string" ? argumentsValue.filename : undefined,
        fileName: typeof argumentsValue.fileName === "string" ? argumentsValue.fileName : undefined,
        AbsolutePath: typeof argumentsValue.AbsolutePath === "string" ? argumentsValue.AbsolutePath : undefined,
        absolute_path: typeof argumentsValue.absolute_path === "string" ? argumentsValue.absolute_path : undefined,
        uri: typeof argumentsValue.uri === "string" ? argumentsValue.uri : undefined,
        content: argumentsValue.content as string | undefined,
        profile: argumentsValue.profile as string | undefined,
        subcommand: argumentsValue.subcommand as string | undefined,
        filter: argumentsValue.filter as string | undefined,
        test_file: argumentsValue.test_file as string | undefined,
        diff: typeof argumentsValue.diff === "string" ? argumentsValue.diff : undefined,
        patch: (argumentsValue.action === "apply_patch" || argumentsValue.action === "patch" || !argumentsValue.action)
          ? ((argumentsValue.patch ?? argumentsValue.diff) as string | undefined)
          : (argumentsValue.patch as string | undefined),
        old_text: (argumentsValue.old_text ?? argumentsValue.oldText ?? argumentsValue.old) as string | undefined,
        new_text: (argumentsValue.new_text ?? argumentsValue.newText ?? argumentsValue.new) as string | undefined,
        start_line: typeof argumentsValue.start_line === "number" ? argumentsValue.start_line : (typeof argumentsValue.startLine === "number" ? argumentsValue.startLine : undefined),
        end_line: typeof argumentsValue.end_line === "number" ? argumentsValue.end_line : (typeof argumentsValue.endLine === "number" ? argumentsValue.endLine : undefined),
        offset: typeof argumentsValue.offset === "number" ? argumentsValue.offset : undefined,
        max_tokens: maxTokens,
        remaining_tokens: remainingTokens,
        max_lines: typeof argumentsValue.max_lines === "number" ? argumentsValue.max_lines : (typeof argumentsValue.maxLines === "number" ? argumentsValue.maxLines : undefined),
        max_line_length: typeof argumentsValue.max_line_length === "number" ? argumentsValue.max_line_length : (typeof argumentsValue.maxLineLength === "number" ? argumentsValue.maxLineLength : undefined),
        numbered: argumentsValue.numbered !== false,
        dir: (argumentsValue.dir ?? argumentsValue.directory ?? argumentsValue.folder ?? argumentsValue.searchDirectory ?? argumentsValue.SearchDirectory) as string | undefined,
        pattern: (argumentsValue.pattern ?? argumentsValue.glob ?? argumentsValue.Pattern) as string | undefined,
        max_bytes: typeof argumentsValue.max_bytes === "number" ? argumentsValue.max_bytes : (typeof argumentsValue.maxBytes === "number" ? argumentsValue.maxBytes : undefined),
        max_entries: typeof argumentsValue.max_entries === "number" ? argumentsValue.max_entries : (typeof argumentsValue.maxEntries === "number" ? argumentsValue.maxEntries : undefined),
        max_depth: typeof argumentsValue.max_depth === "number" ? argumentsValue.max_depth : (typeof argumentsValue.maxDepth === "number" ? argumentsValue.maxDepth : undefined),
        depth: typeof argumentsValue.depth === "number" ? argumentsValue.depth : undefined,
        recursive: typeof argumentsValue.recursive === "boolean" ? argumentsValue.recursive : undefined,
        from: argumentsValue.from as string | undefined,
        to: argumentsValue.to as string | undefined,
        query: (argumentsValue.query ?? argumentsValue.Query) as string | undefined,
        queries: Array.isArray(argumentsValue.queries) ? argumentsValue.queries as string[] : undefined,
        symbol: argumentsValue.symbol as string | undefined,
        mode: argumentsValue.mode as string | undefined,
        detail: typeof argumentsValue.detail === "boolean" ? argumentsValue.detail : undefined,
        max_results: typeof argumentsValue.max_results === "number" ? argumentsValue.max_results : (typeof argumentsValue.limit === "number" ? argumentsValue.limit : undefined),
        candidate_files: Array.isArray(argumentsValue.candidate_files) ? argumentsValue.candidate_files as string[] : (Array.isArray(argumentsValue.files) ? argumentsValue.files as string[] : undefined),
        files: Array.isArray(argumentsValue.files) ? argumentsValue.files as string[] : undefined,
        exclude_comments: typeof argumentsValue.exclude_comments === "boolean" ? argumentsValue.exclude_comments : undefined,
        include_declarations: typeof argumentsValue.include_declarations === "boolean" ? argumentsValue.include_declarations : undefined,
        keep_last_n_turns: typeof argumentsValue.keep_last_n_turns === "number" ? argumentsValue.keep_last_n_turns : undefined,
        filter_tools: Array.isArray(argumentsValue.filter_tools) ? argumentsValue.filter_tools as string[] : undefined,
        reason: argumentsValue.reason as string | undefined,
        max_matches: typeof argumentsValue.max_matches === "number" ? argumentsValue.max_matches : undefined,
        url: argumentsValue.url as string | undefined,
        method: argumentsValue.method as string | undefined,
        headers: argumentsValue.headers as Record<string, string> | undefined,
        body: argumentsValue.body as string | undefined,
        question: typeof argumentsValue.question === "string" ? argumentsValue.question : undefined,
        options: argumentsValue.options as Record<string, string> | string[] | undefined,
        checks: argumentsValue.checks as Record<string, string> | string[] | undefined,
        criteria: argumentsValue.criteria as Record<string, string> | Record<string, unknown> | undefined,
        choices: argumentsValue.choices as Record<string, string> | string[] | undefined,
        context: (argumentsValue.context ?? argumentsValue.state) as number | string | undefined,
        goal: typeof argumentsValue.goal === "string" ? argumentsValue.goal : undefined,
        thoughts: argumentsValue.thoughts as Record<string, string> | string[] | undefined,
        items: argumentsValue.items as Record<string, string> | string[] | undefined,
        task: typeof argumentsValue.task === "string" ? argumentsValue.task : undefined,
        phases: argumentsValue.phases as Record<string, string> | string[] | undefined,
        plan: typeof argumentsValue.plan === "string" ? argumentsValue.plan : undefined,
        constraints: argumentsValue.constraints as Record<string, string> | string[] | undefined,
        code: typeof argumentsValue.code === "string" ? argumentsValue.code : undefined,
        error_summary: typeof argumentsValue.error_summary === "string" ? argumentsValue.error_summary : (typeof argumentsValue.error === "string" ? argumentsValue.error : undefined),
        hypotheses: argumentsValue.hypotheses as Record<string, string> | string[] | undefined,
        proposed_fix: typeof argumentsValue.proposed_fix === "string" ? argumentsValue.proposed_fix : (typeof argumentsValue.fix === "string" ? argumentsValue.fix : undefined),
        user_request: typeof argumentsValue.user_request === "string" ? argumentsValue.user_request : (typeof argumentsValue.request === "string" ? argumentsValue.request : undefined),
        actual_work: typeof argumentsValue.actual_work === "string" ? argumentsValue.actual_work : (typeof argumentsValue.work === "string" ? argumentsValue.work : undefined),
        evidence: typeof argumentsValue.evidence === "string" ? argumentsValue.evidence : undefined,
        target_component: typeof argumentsValue.target_component === "string" ? argumentsValue.target_component : undefined,
        criterion: typeof argumentsValue.criterion === "string" ? argumentsValue.criterion : undefined,
        causes: argumentsValue.causes as Record<string, string> | string[] | undefined,
        units: argumentsValue.units as Record<string, string> | string[] | undefined,
        jev_model: typeof argumentsValue.jev_model === "string" ? argumentsValue.jev_model : (typeof argumentsValue.model === "string" ? argumentsValue.model : undefined),
        jev_provider_id: typeof argumentsValue.jev_provider_id === "string" ? argumentsValue.jev_provider_id : (typeof argumentsValue.providerId === "string" ? argumentsValue.providerId : undefined),
        jev_group_id: typeof argumentsValue.jev_group_id === "string" ? argumentsValue.jev_group_id : (typeof argumentsValue.groupId === "string" ? argumentsValue.groupId : undefined),
        api_key: typeof argumentsValue.api_key === "string" ? argumentsValue.api_key : (typeof argumentsValue.apiKey === "string" ? argumentsValue.apiKey : undefined),
        base_url: typeof argumentsValue.base_url === "string" ? argumentsValue.base_url : (typeof argumentsValue.baseUrl === "string" ? argumentsValue.baseUrl : undefined),
        questions: argumentsValue.questions && typeof argumentsValue.questions === "object" ? argumentsValue.questions as Record<string, unknown> : undefined,
        source: argumentsValue.source as string | undefined,
        language: (argumentsValue.language as any) ?? "js",
        timeout_ms: typeof argumentsValue.timeout_ms === "number" ? argumentsValue.timeout_ms : (typeof argumentsValue.timeout === "number" ? argumentsValue.timeout : undefined),
        timeout: typeof argumentsValue.timeout === "number" ? argumentsValue.timeout : undefined,
        args: argumentsValue.args as string[] | undefined,
        exe: argumentsValue.exe as string | undefined,
        head_lines: typeof argumentsValue.head_lines === "number" ? argumentsValue.head_lines : undefined,
        tail_lines: typeof argumentsValue.tail_lines === "number" ? argumentsValue.tail_lines : undefined,
        lines: typeof argumentsValue.lines === "number" ? argumentsValue.lines : undefined,
        tail: typeof argumentsValue.tail === "boolean" ? argumentsValue.tail : undefined,
        requested_caps: argumentsValue.requested_caps as never,
        limits: argumentsValue.limits as never,
        parallel: Array.isArray(argumentsValue.parallel)
          ? argumentsValue.parallel.map((task) => ({
            ...task,
            cwd: vmRuntime?.cwd ?? effectiveCwd,
            additionalRoots: vmRuntime?.additionalRoots,
            policy: vmRuntime?.vmPolicy
          })) as never
          : undefined,
        concurrency: argumentsValue.concurrency as number | undefined,
        cwd: vmRuntime?.cwd ?? effectiveCwd,
        additionalRoots: vmRuntime?.additionalRoots,
        policy: vmRuntime?.vmPolicy
      });
    } catch (err: any) {
      result = {
        ok: false,
        kind: "sa_error",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: 0
      };
    }
    const isTerminal = result.kind === "capability_denied" || (result as any).terminal === true;
    respondToCodexServerRequest(message.id, {
      contentItems: [{ type: "inputText", text: JSON.stringify({
        ...result,
        ...(isTerminal ? { terminal: true } : {})
      }) }],
      // Policy and capability failures are deliberate results, not transport
      // failures. Returning a handled envelope prevents Codex from replaying
      // the same forbidden request indefinitely.
      success: true
    });
    return;
  }
  const vmTools = vmRuntime?.vmPolicy?.tools;
  const vmReplaceRead = vmTools?.replaceRead === true;
  const vmReplaceApplyPatch = vmTools?.replaceApplyPatch === true;
  const vmReplaceWrite = vmTools?.replaceWrite === true;

  if (threadId && vmRuntime?.vmEnabled && vmReplaceApplyPatch && message.method === "item/tool/call" && ["apply_patch", "applyPatch"].includes(String(params.tool ?? params.toolName ?? params.name ?? asRecord(params.item).tool ?? asRecord(params.item).name))) {
    const raw = parseDynamicToolArguments(params.arguments);
    const patch = typeof raw.patch === "string" ? raw.patch : typeof raw.input === "string" ? raw.input : typeof params.patch === "string" ? params.patch : typeof params.input === "string" ? params.input : typeof params.arguments === "string" ? params.arguments : "";
    const checked = parseAndCheckSaVmPatch(patch, vmRuntime.cwd ?? process.cwd(), vmRuntime.vmPolicy, vmRuntime.additionalRoots ?? []);
    if (!checked.ok) {
      await recordVmPolicyDenial(message.method, message.params, `apply_patch denied: ${checked.reason}`);
      respondToCodexServerRequest(message.id, { contentItems: [{ type: "inputText", text: JSON.stringify({ ok: false, kind: "sa_error", stderr: `SA-VM terminal policy denial: ${checked.reason}. Do not retry; correct the patch or use sa_vm_run.`, terminal: true }) }], success: true });
      return;
    }
    let result: SaVmRunResult;
    try {
      result = await runSaVmTool({ action: "apply_patch", patch, cwd: vmRuntime.cwd ?? process.cwd(), additionalRoots: vmRuntime.additionalRoots, policy: vmRuntime.vmPolicy });
    } catch (err: any) {
      result = {
        ok: false,
        kind: "sa_error",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: 0
      };
    }
    respondToCodexServerRequest(message.id, { contentItems: [{ type: "inputText", text: JSON.stringify(result) }], success: true });
    return;
  }
  const rawToolCandidate = String(params.tool ?? params.toolName ?? params.name ?? asRecord(params.item).tool ?? asRecord(params.item).name ?? "");
  if (threadId && (isVmActive || isEnhanceActive) && message.method === "item/tool/call" && ["vm-read", "vm_read"].includes(rawToolCandidate)) {
    const raw = parseDynamicToolArguments(params.arguments);
    let result: SaVmRunResult;
    try {
      result = await runSaVmTool({
        action: "read_file",
        ...raw,
        cwd: vmRuntime?.cwd ?? process.cwd(),
        additionalRoots: vmRuntime?.additionalRoots,
        policy: vmRuntime?.vmPolicy
      });
    } catch (err: any) {
      result = {
        ok: false,
        kind: "sa_error",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: 0
      };
    }
    respondToCodexServerRequest(message.id, { contentItems: [{ type: "inputText", text: JSON.stringify(result) }], success: true });
    return;
  }
  if (threadId && vmRuntime?.vmEnabled && message.method === "item/tool/call") {
    const toolName = String(params.tool ?? params.toolName ?? params.name ?? asRecord(params.item).tool ?? asRecord(params.item).name ?? "");
    const isPatch = ["apply_patch", "applyPatch"].includes(toolName);
    const isRead = isReadToolName(toolName);
    const isWrite = toolName.includes("write") || toolName.includes("edit");

    if (isPatch && !vmReplaceApplyPatch) {
      // allow native apply_patch to proceed
    } else if (isRead && !vmReplaceRead) {
      // allow native read tool to proceed
    } else if (isWrite && !vmReplaceWrite && !vmReplaceApplyPatch) {
      // allow native write tool to proceed
    } else if (toolName !== "sa_vm_run") {
      await recordVmPolicyDenial(message.method, message.params, "only sa_vm_run is available in SA-VM mode; do not retry this tool call");
      respondToCodexServerRequest(message.id, {
        contentItems: [{ type: "inputText", text: JSON.stringify({
          ok: false,
          kind: "sa_error",
          exitCode: null,
          stdout: "",
          stderr: "SA-VM terminal policy denial: only sa_vm_run with packaged function tools is permitted. Do not retry this tool call with raw commands.",
          saVmEvents: [],
          saVmViolation: "dynamic tool is not sa_vm_run",
          durationMs: 0,
          terminal: true
        }) }],
        success: true
      });
      return;
    }
  }
  if (threadId && vmRuntime?.vmEnabled && await handleVmServerRequest(message, vmRuntime)) return;
  if (threadId && vmRuntime?.vmEnabled) {
    const denial = vmRpcPolicyDenial(message.method, message.params, vmRuntime);
    if (denial) {
      await recordVmPolicyDenial(message.method, message.params, denial);
      respondToCodexServerRequest(message.id, commandBlacklistPolicy.rejection(message.method));
      return;
    }
  }
  // Shell anti-pattern interception is part of the VM safe sandbox: when the
  // shield toggle (vmEnabled) is off, the native terminal stays fully open and
  // nothing here may intercept. (Enhance tools never intercept.)
  if (threadId && vmRuntime?.vmEnabled && isSaVmDirectCommandMethod(message.method)) {
    const rawCmd = params.command ?? params.cmd ?? params.argv;
    const fullCmd = Array.isArray(rawCmd) ? rawCmd.join(" ") : String(rawCmd ?? "");
    const antiPattern = detectPowerShellAntiPattern(fullCmd);
    if (antiPattern) {
      await recordVmPolicyDenial(message.method, message.params, `Prohibited shell anti-pattern detected: ${antiPattern}`);
      const warning = antiPatternCommandNotification(message.params, threadId, antiPattern);
      if (warning) routeCodexNotification(warning);
      respondToCodexServerRequest(message.id, commandBlacklistPolicy.rejection(message.method));
      return;
    }
  }
  if (threadId && vmRuntime?.vmEnabled && isSaVmDirectCommandMethod(message.method)) {
    await recordVmPolicyDenial(message.method, message.params, "direct host command execution is disabled in SA-VM mode; use sa_vm_run");
    respondToCodexServerRequest(message.id, commandBlacklistPolicy.rejection(message.method));
    return;
  }
  if (threadId && vmRuntime?.vmEnabled && isVmForbiddenServerRequest(message, vmRuntime)) {
    await recordVmBlockedRequest(message);
    respondToCodexServerRequest(message.id, commandBlacklistPolicy.rejection(message.method));
    return;
  }
  const blocked = await inspectCommandBlacklist(message.method, message.params, null)
    ?? (message.method === "item/permissions/requestApproval"
      ? await inspectNetworkPermissionBlacklist(message.params, null)
      : null);
  if (blocked) {
    await recordBlockedCommand(message.method, blocked);
    const warning = blockedCommandNotification(message.params, blocked);
    if (warning) routeCodexNotification(warning);
    respondToCodexServerRequest(message.id, commandBlacklistPolicy.rejection(message.method));
    return;
  }
  if (false) {
    if (message.method === "item/commandExecution/requestApproval" || message.method === "execCommandApproval") {
      const decision = message.method === "execCommandApproval" ? "approved" : "accept";
      respondToCodexServerRequest(message.id, { decision } as JsonValue);
      return;
    }
  }
  codexApiEvents.append("serverRequest", message, threadId ?? null);
  const clientMessage = threadId && (!params.threadId && !params.thread_id)
    ? {
      ...message,
      params: { ...params, threadId }
    } as JsonRpcRequest
    : message;
  for (const client of clients) {
    const user = client.data.user;
    if (!authStore || !user || user.role === "admin") {
      send(client, { type: "codex.serverRequest", message: clientMessage });
    } else if (threadId && authStore.ownsThread(threadId, user.id)) {
      send(client, { type: "codex.serverRequest", message: clientMessage });
    }
  }
}


function isReadToolName(toolName: string): boolean {
  if (!toolName || typeof toolName !== "string") return false;
  const normalized = toolName.toLowerCase().replace(/[_-]/g, "");
  return [
    "readfile", "viewfile", "getfile", "cat", "view", "read",
    "listdir", "listdirectory", "findbyname", "findfiles", "glob",
    "grepsearch", "searchcode", "ripgrep", "readurlcontent"
  ].some((candidate) => normalized.includes(candidate));
}

async function handleVmServerRequest(
  message: JsonRpcRequest,
  runtime?: NonNullable<ReturnType<ThreadRuntimeMetadataStore["getAny"]>>
): Promise<boolean> {
  if (!runtime?.vmEnabled) {
    return false;
  }
  const tools = runtime?.vmPolicy?.tools;
  const replaceApplyPatch = tools?.replaceApplyPatch === true;
  const replaceWrite = tools?.replaceWrite === true;

  if (message.method === "item/commandExecution/requestApproval" || message.method === "execCommandApproval") {
    await recordVmPolicyDenial(
      message.method,
      message.params,
      "native host command execution is disabled in SA-VM mode; use sa_vm_run(action=\"run_js\")"
    );
    respondToCodexServerRequest(message.id, {
      decision: message.method === "execCommandApproval" ? "denied" : "decline"
    } as JsonValue);
    return true;
  }
  if (message.method === "item/fileChange/requestApproval") {
    if (!replaceWrite && !replaceApplyPatch) {
      return false;
    }
    await recordVmPolicyDenial(message.method, message.params, "native file change/apply_patch execution is disabled in SA-VM mode; use packaged sa_vm_run tools");
    respondToCodexServerRequest(message.id, { decision: "decline" } as JsonValue);
    return true;
  }
  if (message.method === "applyPatchApproval") {
    if (!replaceApplyPatch) {
      return false;
    }
    await recordVmPolicyDenial(message.method, message.params, "VM policy cannot be expanded by an approval request");
    respondToCodexServerRequest(message.id, { decision: message.method === "applyPatchApproval" ? "denied" : "decline" } as JsonValue);
    return true;
  }
  if (message.method === "item/permissions/requestApproval") {
    await recordVmPolicyDenial(message.method, message.params, "VM policy cannot be expanded by an approval request");
    respondToCodexServerRequest(message.id, { decision: "decline" } as JsonValue);
    return true;
  }
  return false;
}

function isVmForbiddenServerRequest(message: JsonRpcRequest, runtime: NonNullable<ReturnType<ThreadRuntimeMetadataStore["getAny"]>>): boolean {
  if (!runtime.vmEnabled) {
    return false;
  }
  const tools = runtime.vmPolicy?.tools;
  const replaceRead = tools?.replaceRead === true;

  if (["mcpServer/tool/call", "mcpServer/resource/read"].includes(message.method)) return true;
  if (message.method === "fuzzyFileSearch" && replaceRead) return true;

  const params = asRecord(message.params);
  const command = extractCommandArgv(params.command ?? params.cmd ?? params.argv);
  if (command && isSaVmScriptExecutable(command.executable)) {
    return true;
  }
  const scriptReq = classifySaVmScriptToolRequest(message.method, message.params);
  if (scriptReq) {
    return true;
  }
  if (isSaVmDirectCommandMethod(message.method)) {
    return true;
  }

  if (runtime.vmEnabled) {
    return [params.tool, params.toolName, params.name, asRecord(params.item).tool]
      .some((value) => typeof value === "string" && isSaVmBlockedToolName(value));
  }
  return false;
}

function vmRpcPolicyDenial(method: string, params: JsonValue | undefined, runtime: NonNullable<ReturnType<ThreadRuntimeMetadataStore["getAny"]>>): string | null {
  const record = asRecord(params);
  const threadCwd = runtime.cwd ?? process.cwd();
  const requestedCwd = stringValue(record.cwd);
  const policy = normalizeSaVmPolicy(runtime.vmPolicy, threadCwd, runtime.additionalRoots ?? []);
  const isVm = runtime.vmPolicy?.engine === "vm";
  // Lifecycle requests are canonicalized before reaching this function.
  // For actual tool requests, reject an explicit cwd outside the persisted
  // thread roots instead of allowing the caller to steer the sidecar.
  const cwd = requestedCwd ?? threadCwd;
  if (requestedCwd && !checkSaVmPath(policy, "read", requestedCwd, threadCwd).allowed) return "tool cwd is outside the thread VM roots";
  const readMethods = new Set(["fs/readFile", "fs/readDirectory", "fs/getMetadata", "fs/watch"]);
  const writeMethods = new Set(["fs/writeFile", "fs/createDirectory", "fs/mkdir"]);
  const deleteMethods = new Set(["fs/delete", "fs/deleteFile", "fs/remove", "fs/removeFile", "fs/rename", "fs/move"]);
  if (readMethods.has(method)) {

    const path = stringValue(record.path);
    if (!path) return "filesystem path is required";
    const decision = checkSaVmPath(policy, "read", path, cwd);
    return decision.allowed ? null : decision.reason;
  }
  if (writeMethods.has(method)) {
    if (policy.tools?.replaceWrite !== true) return null;
    const path = stringValue(record.path);
    if (!path) return "filesystem path is required";
    const decision = checkSaVmPath(policy, "write", path, cwd);
    return decision.allowed ? null : decision.reason;
  }
  if (method === "applyPatchApproval") {
    if (policy.tools?.replaceApplyPatch !== true) return null;
    return "native apply_patch is disabled in SA-VM mode; use packaged sa_vm_run tools";
  }
  if (method === "gitDiffToRemote") {
    const processDecision = checkSaVmProcess(policy, "git", ["diff", "*"]);
    if (!processDecision.allowed) return processDecision.reason;
    return checkSaVmPath(policy, "read", cwd, cwd).allowed ? null : "workspace is not readable";
  }
  if (method === "fs/copy") {
    const source = stringValue(record.sourcePath) ?? stringValue(record.source);
    const destination = stringValue(record.destinationPath) ?? stringValue(record.destination);
    if (!source || !destination) return "copy sourcePath and destinationPath are required";
    const sourceDecision = checkSaVmPath(policy, "read", source, cwd);
    if (!sourceDecision.allowed) return sourceDecision.reason;
    const destinationDecision = checkSaVmPath(policy, "write", destination, cwd);
    return destinationDecision.allowed ? null : destinationDecision.reason;
  }
  if (method === "fs/rename" || method === "fs/move") {
    const source = stringValue(record.source) ?? stringValue(record.oldPath) ?? stringValue(record.path);
    const destination = stringValue(record.destination) ?? stringValue(record.destinationPath) ?? stringValue(record.newPath) ?? stringValue(record.to);
    if (!source || !destination) return "rename source and destination paths are required";
    const sourceDecision = checkSaVmDelete(policy, source, cwd);
    if (!sourceDecision.allowed) return sourceDecision.reason;
    const destinationDecision = checkSaVmPath(policy, "write", destination, cwd);
    return destinationDecision.allowed ? null : destinationDecision.reason;
  }
  if (method === "fuzzyFileSearch") {
    const roots = Array.isArray(record.roots)
      ? record.roots.filter((value): value is string => typeof value === "string")
      : [];
    if (roots.length === 0) return "search roots are required";
    for (const root of roots) {
      const decision = checkSaVmPath(policy, "read", root, cwd);
      if (!decision.allowed) return decision.reason;
    }
    return null;
  }
  if (isVm && (method === "mcpServer/tool/call" || method === "mcpServer/resource/read")) {
    return "MCP host tools/resources are disabled in SA-VM mode; use policy-approved sa_vm_run actions";
  }
  if (deleteMethods.has(method)) {
    const path = stringValue(record.path) ?? stringValue(record.source) ?? stringValue(record.oldPath);
    if (!path) return "filesystem path is required";
    const decision = checkSaVmDelete(policy, path, cwd);
    return decision.allowed ? null : decision.reason;
  }
  if (isSaVmDirectCommandMethod(method)) {
    const command = extractCommandArgv(record.command ?? record.cmd ?? record.argv);
    if (!command) return "command argv is required";
    const scriptReq = classifySaVmScriptToolRequest(method, params);
    if (scriptReq || isSaVmScriptExecutable(command.executable)) {
      const lang = scriptReq?.language ?? saVmScriptLanguage(command.executable) ?? "javascript";
      const isAllowed = lang === "bun"
        ? Boolean(policy.process.bun?.enabled || (policy.process.bunProfiles && policy.process.bunProfiles.length > 0))
        : lang === "javascript"
          ? policy.execution.javascript === true
          : policy.execution.python === true;
      const langLabel = lang === "bun" ? "Bun" : lang === "javascript" ? "JavaScript/Node" : "Python";
      if (!isAllowed) {
        return `direct ${langLabel} execution is disabled by VM policy and cannot bypass the VM sandbox; use packaged native tools (e.g. find_files, grep_search, read_file, edit_file, apply_patch)`;
      }
      return `direct ${langLabel} execution is disabled in SA-VM mode and cannot bypass the sandbox; use sa_vm_run`;
    }
    return "direct host command execution is disabled in SA-VM mode; use sa_vm_run";
  }
  if (isWorkspaceGitMethod(method)) {
    const gitCommand = method === "ui/git/stage" || method === "ui/git/stage-all" ? "add"
      : method === "ui/git/unstage" || method === "ui/git/unstage-all" || method === "ui/git/discard" ? "restore"
      : method === "ui/git/commit" ? "commit"
      : method === "ui/git/checkout" || method === "ui/git/branch-delete" || method === "ui/git/branches" ? "branch"
      : method === "ui/git/stash-push" || method === "ui/git/stash-apply" || method === "ui/git/stash-drop" || method === "ui/git/stash-list" ? "stash"
      : method === "ui/git/fetch" ? "fetch"
      : method === "ui/git/pull" ? "pull"
      : method === "ui/git/push" ? "push"
      : "status";
    const processDecision = checkSaVmProcess(policy, "git", [gitCommand]);
    if (!processDecision.allowed) return processDecision.reason;
    const pathValues = Array.isArray(record.paths)
      ? record.paths.filter((value): value is string => typeof value === "string")
      : [];
    if (method === "ui/git/status" || method === "ui/git/history" || method === "ui/git/diff" || method === "ui/git/show" || method === "ui/git/branches" || method === "ui/git/stash-list") {
      const path = stringValue(record.path);
      if (!path) return checkSaVmPath(policy, "read", cwd, cwd).allowed ? null : "workspace is not readable";
      const decision = checkSaVmPath(policy, "read", path, cwd);
      return decision.allowed ? null : decision.reason;
    }
    if (method === "ui/git/discard") {
      for (const path of pathValues) {
        const decision = checkSaVmDelete(policy, path, cwd);
        if (!decision.allowed) return decision.reason;
      }
      return pathValues.length > 0 ? null : "Git path list is required";
    }
    if (method === "ui/git/stage" || method === "ui/git/unstage" || method === "ui/git/stage-all" || method === "ui/git/unstage-all") {
      if (method === "ui/git/stage-all" || method === "ui/git/unstage-all") {
        return checkSaVmPath(policy, "write", cwd, cwd).allowed ? null : "workspace is not writable";
      }
      for (const path of pathValues) {
        const decision = checkSaVmPath(policy, "write", path, cwd);
        if (!decision.allowed) return decision.reason;
      }
      return pathValues.length > 0 ? null : "Git path list is required";
    }
    return checkSaVmPath(policy, "write", cwd, cwd).allowed ? null : "workspace is not writable";
  }
  return null;
}

async function recordVmPolicyDenial(method: string, params: JsonValue | undefined, reason: string): Promise<void> {
  try {
    await auditLogStore.recordDangerousPermission("sa-vm-policy-denied", {
      method,
      threadId: stringValue(asRecord(params).threadId),
      reason
    } as JsonValue);
  } catch (error) {
    console.warn("Failed to write SA-VM policy audit event", { error, method, reason });
  }
}

async function recordVmBlockedRequest(message: JsonRpcRequest): Promise<void> {
  try {
    await auditLogStore.recordDangerousPermission("sa-vm-blocked", {
      method: message.method,
      threadId: stringValue(asRecord(message.params).threadId),
      reason: "SA-VM mode permits only VM-backed tools"
    } as JsonValue);
  } catch (error) {
    console.warn("Failed to write SA-VM block audit event", { error, method: message.method });
  }
}

function routeCodexNotification(message: JsonRpcMessage & { method: string; params?: JsonValue }): void {
  const params = asRecord(message.params);
  const method = message.method;
  const threadId =
    stringValue(params.threadId) ??
    stringValue(asRecord(params.thread).id) ??
    stringValue(asRecord(params.turn).threadId);
  const turnId =
    stringValue(asRecord(params.turn).id) ??
    stringValue(params.turnId) ??
    stringValue(params.id);
  if (turnId && threadId) {
    turnToThreadMap.set(turnId, threadId);
    if (turnToThreadMap.size > 2000) {
      const firstKey = turnToThreadMap.keys().next().value;
      if (firstKey) turnToThreadMap.delete(firstKey);
    }
  }
  const parentThreadId =
    stringValue(params.parentThreadId)
    ?? stringValue(asRecord(params.thread).parentThreadId)
    ?? stringValue(asRecord(params.turn).parentThreadId);
  const item = asRecord(params.item);
  if (threadId && method === "item/started") {
    trackCodexChildrenFromItem(threadId, item);
  }
  if (threadId && parentThreadId && (method === "thread/started" || method === "turn/started")) {
    trackCodexChildStarted(threadId, parentThreadId);
  }
  if (turnId && method.includes("turn/started")) {
    directTurnStartedAt.set(turnId, Date.now());
    // Self-heal: a new turn proves the previous one ended. If its terminal is
    // still deferred (child leaked, overwrite skipped it), replay it now so
    // the UI and turn holds converge instead of sticking at Running forever.
    // Replay re-enters this function; a still-busy parent simply defers again.
    const stale = threadId ? codexDeferredTerminalByTurn.get(threadId) : undefined;
    const staleTurnId = stale ? stringValue(asRecord(stale.params).turnId) : null;
    if (stale && staleTurnId !== turnId) {
      codexDeferredTerminalByTurn.delete(threadId!);
      routeCodexNotification(stale);
    }
  }
  if (threadId && parentThreadId) {
    const parentSshBridge = sshThreadBridges.get(parentThreadId);
    if (parentSshBridge) {
      sshThreadBridges.set(threadId, parentSshBridge);
      sshWorkspaceStore.put(threadId, parentSshBridge.profile, parentThreadId);
    }
    registerClaudeVirtualThread(threadId, parentThreadId);
  }
  if (authStore && threadId && parentThreadId) {
    const parentOwnerId = authStore.threadOwnerId(parentThreadId);
    if (parentOwnerId) authStore.claimThread(threadId, parentOwnerId);
  }
  if (threadId && (method === "thread/closed" || method === "thread/archived" || method === "thread/deleted")) {
    subscriptionRegistry.markClosed(threadId);
    releaseAuggieThreadBridge(threadId);
    releaseClineThreadBridge(threadId);
    releaseCommandCodeThreadBridge(threadId);
    // A closed/deleted child would otherwise stay in its parent's active set
    // forever: every later parent terminal keeps deferring (UI stuck at
    // Running + leaked turn holds). Treat close as terminal for the maps.
    const closedParent = trackCodexChildTerminal(threadId);
    if (closedParent) flushDeferredCodexParent(closedParent);
    const releasedThreadIds = releaseClaudeThreadTree(threadId);
    if (method === "thread/deleted") {
      for (const releasedThreadId of releasedThreadIds) claudeSessionStore.deleteByThread(releasedThreadId);
      agySessionStore.deleteByThread(threadId);
      agyBridge.deleteSession(threadId);
      grokBridge.deleteSession(threadId);
      museBridge.deleteSession(threadId);
      museSessionStore.deleteByThread(threadId);
    }
  }
  // Free concurrency slots when turns complete / fail / are interrupted.
  const isTerminal =
    method.includes("turn/completed") ||
    method.includes("turn/failed") ||
    method.includes("turn/interrupted") ||
    method.endsWith("turn/complete") ||
    method.endsWith("turn/error") ||
    method === "turn/completed" ||
    method === "turn/failed";
  if (isTerminal && threadId) {
    if (turnId) {
      // Stats sidecar runs before UI deferral: a deferred-then-overwritten or
      // never-replayed terminal must not lose its gateway row. Replay stays a
      // no-op via the time-window dedup inside recordDirectGatewayRow.
      void recordDirectGatewayRow(threadId, turnId, method);
    }
    if (codexParentHasActiveChildren(threadId) && turnId) {
      // Keep this child registered under its own parent while descendants are
      // still active. Replaying the deferred terminal below will remove it
      // only after the complete subtree has settled.
      codexDeferredTerminalByTurn.set(threadId, message);
      return;
    }
    const childParent = trackCodexChildTerminal(threadId);
    if (childParent) flushDeferredCodexParent(childParent);
  }
  archiveProjectNotification(message, threadId, turnId);
  codexApiEvents.append("notification", message, threadId ?? null);
  if (threadId && params.tokenUsage) {
    latestThreadTokenUsage.set(threadId, params.tokenUsage);
  }
  if (threadId && turnId && (method === "rawResponse/completed" || method === "thread/tokenUsage/requestUpdated" || method === "thread/tokenUsage/updated")) {
    void recordRequestUsageNotification(message, threadId, turnId);
  }
  if (threadId && method === "turn/completed") {
    const locatedMember = threadAgentRosterStore.getAnyByChildThread(threadId);
    const healthyMember = threadAgentRosterStore.markHealthyByThread(threadId);
    if (healthyMember && locatedMember) {
      const healthyRoster = threadAgentRosterStore.get(locatedMember.ownerId, healthyMember.parentThreadId);
      if (healthyRoster) notifyThreadAgentRoster(threadAgentOwnerUser(locatedMember.ownerId), healthyRoster);
    }
  }
  if (threadId && (method === "turn/failed" || method === "turn/error" || method.endsWith("turn/failed") || method.endsWith("turn/error"))) {
    const turn = asRecord(params.turn);
    const failure = turn.error ?? params.error ?? params.message ?? message;
    void handleThreadAgentFailure(threadId, failure);
  }
  if (isTerminal && threadId) {
    if (turnId) {
      subscriptionRegistry.removeTurnHold(threadId, `turn:${turnId}`);
      codexStreamRetryTracker.markTurnTerminal(turnId);
      directUsageSeqByTurn.delete(turnId);
      directTurnStartedAt.delete(turnId);
    }
    subscriptionRegistry.removeTurnHold(threadId, `thread-active:${threadId}`);
  }

  if (isTerminal && authStore) {
    for (const userId of activeTurnsByUser.keys()) {
      const user = authStore.getUser(userId);
      if (user && threadId && (user.role === "admin" || authStore.ownsThread(threadId, user.id))) {
        if (turnId) {
          trackTurnEnd(user.id, `turn:${turnId}`);
        }
        if (threadId) {
          trackTurnEnd(user.id, `thread-active:${threadId}`);
        }
      }
    }
  }

  if (!authStore || !threadId) {
    broadcast({ type: "codex.notification", message });
    return;
  }

  for (const client of clients) {
    const user = client.data.user;
    if (!user) {
      send(client, { type: "codex.notification", message });
      continue;
    }
    if (
      user.role === "admin"
      || authStore.ownsThread(threadId, user.id)
      || Boolean(parentThreadId && authStore.ownsThread(parentThreadId, user.id))
    ) {
      send(client, { type: "codex.notification", message });
    }
  }
}

/**
 * 直连旁路计数：turn 终态时若同 thread+turn 在 gateway_requests 中没有任何行
 *（即未走 relay-gateway：opencode 官方/免费直连、Pi/Agy/Grok 直连、Mini 回退直连），
 * 则补一行 `endpoint=direct/<backend>`。纯统计，不触碰数据路径。
 * 判重按 turnId 精确匹配（替代旧时间窗口，避免上一轮记录落入下一轮窗口导致漏计）。
 * 中断保持 canceled，未知延迟/状态保持 null（禁止填 200/500/0ms）。
 */
async function recordDirectGatewayRow(threadId: string, turnId: string, method: string): Promise<void> {
  try {
    const ownerId = authStore?.threadOwnerId(threadId) ?? "local";
    if (gatewayRequestStore.existsByTurn(ownerId, threadId, turnId)) return;
    // 中转行多数不带 turn_id 时，旧窗口可能误判；turnId 精确判重已覆盖直连补计场景，
    // 此处保留线程级兜底：同线程在 turn 开始后确有网关行（压缩等带 turn_id 行除外）
    // 才视为走过网关，避免中转 turn 被重复补 direct。
    const sinceMs = (directTurnStartedAt.get(turnId) ?? Date.now() - 10 * 60_000) - 1000;
    if (gatewayRequestStore.countByThreadSince(ownerId, threadId, sinceMs) > 0) return;
    const metadata = threadRuntimeMetadataStore.get(ownerId, threadId) ?? threadRuntimeMetadataStore.get("local", threadId);
    // 注意：不能用 provider/group 是否存在来判断是否走网关（官方 opencode-local 等
    // 伪 provider 也有 default 分组，但流量直连）。唯一可靠信号就是有无网关行。
    const status = method.includes("turn/interrupted") || method.includes("turn/cancel")
      ? "canceled" as const
      : method.includes("turn/completed") || method.endsWith("turn/complete")
        ? "completed" as const
        : "failed" as const;
    const row = gatewayRequestStore.recordDirect({
      ownerId, threadId, turnId,
      ...(metadata?.providerId ? { providerId: metadata.providerId } : {}),
      ...(metadata?.groupId ? { groupId: metadata.groupId } : {}),
      ...(metadata?.model ? { model: metadata.model } : {}),
      ...(metadata?.cliBackend ? { backend: metadata.cliBackend } : {}),
      status,
      ...(status === "completed" ? {} : { error: method }),
    });
    if (row) {
      console.info(`[gateway-requests] direct row endpoint=${row.endpoint} provider=${row.providerId} status=${status} thread=${threadId.slice(0, 8)}`);
    }
  } catch (error) {
    console.warn("[gateway-requests] recordDirectGatewayRow failed", { threadId, turnId, error: error instanceof Error ? error.message : String(error) });
  }
}

async function recordRequestUsageNotification(message: JsonRpcMessage & { method: string; params?: JsonValue }, threadId: string, turnId: string): Promise<void> {
  const params = asRecord(message.params);
  const isRingUpdated = message.method === "thread/tokenUsage/updated";
  const requestId = message.method === "rawResponse/completed"
    ? (() => { const id = stringValue(params.responseId); return id ? `codex-${id}` : undefined; })()
    : isRingUpdated
      ? (stringValue(params.requestId) ?? (() => {
        // Fallback only: backends that attach no stable call identity
        // (mini rounds, agy/grok/pi steps) keep today's per-event rows.
        const seq = directUsageSeqByTurn.get(turnId) ?? 0;
        directUsageSeqByTurn.set(turnId, seq + 1);
        return nextDirectUsageRequestId(turnId, seq);
      })())
      : stringValue(params.requestId);
  const rawUsage = isRingUpdated ? extractRingTokenUsage(params) : params.usage;
  if (!requestId || rawUsage == null) return;
  // Opencode step 用量为非重叠拆分（input=未命中，output=可见），显式传 opencode
  // 口径，避免被当成包含式输入再次扣缓存、遗漏推理。
  const sourceHint = requestId.startsWith("opencode-") ? "opencode" as const : undefined;
  const normalized = normalizeTokenUsage(rawUsage, sourceHint);
  if (!normalized) return;
  const ownerId = authStore?.threadOwnerId(threadId) ?? "local";
  const metadata = threadRuntimeMetadataStore.get(ownerId, threadId) ?? threadRuntimeMetadataStore.get("local", threadId);
  const providerId = metadata?.providerId ?? undefined;
  const groupId = metadata?.groupId ?? undefined;
  const model = metadata?.model ?? stringValue(params.model) ?? "";
  const provider = providerId ? await providerStore.get(providerId) : null;
  const group = provider?.groups?.find((entry) => entry.id === groupId);
  const priced = priceNormalizedTokenUsage(normalized, provider?.modelRates ?? [], model, group?.groupRatio ?? 1);
  const stored = requestUsageStore.record({
    ownerId,
    threadId,
    turnId,
    requestId,
    source: normalized.source,
    providerId,
    groupId,
    model,
    usage: priced,
    ...(priced.estimatedCostUsd != null ? { costUsd: priced.estimatedCostUsd } : {}),
    ...(priced.billingSnapshot ? { billingSnapshot: priced.billingSnapshot } : {})
  });
  const cost = stored.record.costUsd;
  // P3 网关用量累加：单 request 首次落库且有费用时累加分组 usedQuota，
  // 使网关门禁的静态计数器真正转动（更新行 inserted=false 时不再重复加）。
  if (stored.inserted && cost && cost > 0 && providerId && groupId) {
    try {
      providerStore.addUsedQuota(providerId, groupId, cost);
    } catch (error) {
      console.warn("Gateway used-quota accumulation failed", { threadId, turnId, requestId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!(cost && cost > 0) || !authStore || ownerId === "local") return;
  if (stored.record.debitedAt) return;
  const debitKey = ownerId + "|" + threadId + "|" + requestId;
  if (requestUsageDebitInFlight.has(debitKey)) return;
  requestUsageDebitInFlight.add(debitKey);
  const user = authStore.getUser(ownerId);
  if (!user || user.role === "admin") { requestUsageDebitInFlight.delete(debitKey); return; }
  try {
    authStore.debitBalance(ownerId, cost, { reason: "token-usage", threadId, method: message.method, referenceId: requestId });
    requestUsageStore.markDebited(ownerId, threadId, requestId);
  } catch (error) {
    console.warn("Token usage debit failed", { threadId, turnId, requestId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    requestUsageDebitInFlight.delete(debitKey);
  }
}

async function resolveProviderApiKey(providerId: string | undefined, explicitApiKey: string): Promise<string> {
  if (explicitApiKey) {
    return explicitApiKey;
  }
  if (!providerId) {
    return "";
  }
  const existing = await providerStore.get(providerId);
  if (!existing) {
    return "";
  }
  // Read through the provider store so all supported secret backends are
  // covered: in-memory secrets, Windows keyring, and provider env vars.
  // Relying only on apiKeyRef/runtimeEnv can report a configured key as
  // missing when the keyring is the active storage backend.
  return providerStore.providerApiKey(providerId);
}

async function resolveImageProvider(
  providerId: string | undefined,
  groupId: string | undefined,
  user: AuthUser | null,
  capability: "generations" | "edits"
): Promise<{ provider: ProviderConfig; group: ChannelGroupConfig }> {
  if (!providerId) {
    throw new Error("Missing providerId");
  }
  if (user && user.role !== "admin" && !securityStore.isProviderAllowed(user.id, providerId, false)) {
    throw new Error("Relay not assigned to this member");
  }
  const provider = await providerStore.get(providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  const imageGroups = provider.groups?.filter((group) => capability === "edits"
    ? (group.capabilities?.imageEdits ?? group.image?.edits ?? group.kind === "image")
    : (group.capabilities?.imageGeneration ?? group.image?.generations ?? group.kind === "image")) ?? [];
  if (imageGroups.length === 0) {
    throw new Error("当前中转站没有生图分组，请配置后继续");
  }
  const group = groupId ? imageGroups.find((entry) => entry.id === groupId) : imageGroups[0];
  if (!group) {
    throw new Error("所选分组不是当前中转站的图片分组");
  }
  const imageConfig = imageConfigForGroup(provider, group);
  if (!imageConfig?.[capability]) {
    throw new Error(`Provider does not support image ${capability}`);
  }
  if (!provider.baseUrl) {
    throw new Error("Provider is missing baseUrl");
  }
  return { provider, group };
}

function imageConfigForGroup(provider: ProviderConfig, group: ChannelGroupConfig): ProviderConfig["image"] {
  return group.image ?? provider.image;
}

function withImagePrice(body: JsonValue, group: ChannelGroupConfig, model: string): JsonValue {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }
  const billing = group.image?.billing;
  const unitPrice = group.image?.modelPrices?.find((entry) => entry.model === model)?.usdPerImage
    ?? (billing?.mode === "per_image" ? billing.usdPerImage : undefined);
  const record = body as Record<string, JsonValue>;
  if (unitPrice == null) {
    return billing?.mode === "token_multiplier" ? { ...record, billingMode: billing.mode, billingMultiplier: billing.multiplier } : body;
  }
  const count = Array.isArray(record.data) ? record.data.length : 1;
  return {
    ...record,
    estimatedCostUsd: unitPrice * Math.max(1, count),
    imageUnitPriceUsd: unitPrice
  };
}

function firstGroupKey(group: ChannelGroupConfig): string {
  return group.keys.find((key) => key.trim())?.trim() ?? "";
}

async function resolveGroupApiKey(
  provider: ProviderConfig,
  group: ChannelGroupConfig,
  explicitApiKey?: string
): Promise<string> {
  if (explicitApiKey?.trim()) return explicitApiKey.trim();
  const groupKey = firstGroupKey(group);
  if (group.credentialMode !== "provider" && groupKey) return groupKey;
  if (group.id === "cline-free" || group.baseUrl?.includes("api.cline.bot")) {
    const localClineToken = await resolveLocalClineToken();
    if (localClineToken) return localClineToken;
  }
  if (group.id === "freebuff" || group.baseUrl?.includes("codebuff.com")) {
    const localFreebuffCreds = await resolveLocalFreebuffCredentials();
    if (localFreebuffCreds?.token) return localFreebuffCreds.token;
  }
  const providerKey = await resolveProviderApiKey(provider.id, "");
  return providerKey || groupKey;
}

function providerBaseUrl(provider: ProviderConfig): string {
  const baseUrl = provider.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Provider is missing baseUrl");
  }
  return baseUrl.replace(/\/+$/, "");
}

function optionalShortString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function optionalStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > maxLength) return null;
    if (!result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/** Project rooms use one durable timeline while each member remains a normal
 * Codex thread. Notifications are projected here so HTTP polling and the Web
 * UI observe the same canonical message, even when a notification is retried.
 */
function archiveProjectNotification(
  message: JsonRpcMessage & { method: string; params?: JsonValue },
  threadId: string | undefined,
  turnId: string | undefined
): void {
  if (!threadId) return;
  const binding = projectRoomStore.findThread(threadId);
  if (!binding) return;
  const params = asRecord(message.params);
  const method = message.method;
  const metadata = projectProjectTurnMetadata(threadId, turnId);
  const phase = metadata?.phase;
  const route = {
    providerId: metadata?.providerId ?? null,
    groupId: metadata?.groupId ?? null,
    model: metadata?.model ?? null
  };
  try {
    if (method === "item/agentMessage/delta") {
      const delta = stringValue(params.delta) ?? "";
      const itemId = stringValue(params.itemId);
      if (!delta || !itemId) return;
      projectRoomStore.appendAgentMessageDelta(binding.ownerId, {
        projectId: binding.projectId,
        agentId: binding.agentId,
        threadId,
        turnId: turnId ?? null,
        itemId,
        kind: "agent",
        phase,
        ...route,
        delta
      });
      return;
    }

    if (method === "item/completed") {
      const item = asRecord(params.item);
      if (stringValue(item.type) !== "agentMessage") return;
      const text = projectNotificationText(item);
      const itemId = stringValue(item.id) ?? stringValue(params.itemId);
      if (!text || !itemId) return;
      projectRoomStore.upsertAgentMessage(binding.ownerId, {
        projectId: binding.projectId,
        agentId: binding.agentId,
        threadId,
        turnId: turnId ?? null,
        itemId,
        kind: "agent",
        phase,
        ...route,
        text,
        createdAt: numberValue(params.completedAtMs) ?? undefined
      });
      projectRoomStore.setMemberStatus(binding.ownerId, binding.projectId, binding.agentId, "active");
      return;
    }

    if (method === "turn/completed") {
      const turn = asRecord(params.turn);
      const status = stringValue(turn.status) ?? "completed";
      const items = Array.isArray(turn.items) ? turn.items : [];
      // Some runtimes only include the final message on turn/completed.
      const finalMessage = [...items].reverse().map(asRecord).find((item) => stringValue(item.type) === "agentMessage");
      if (finalMessage) {
        const text = projectNotificationText(finalMessage);
        const itemId = stringValue(finalMessage.id);
        if (text && itemId) {
          projectRoomStore.upsertAgentMessage(binding.ownerId, {
            projectId: binding.projectId,
            agentId: binding.agentId,
            threadId,
            turnId: turnId ?? stringValue(turn.id) ?? null,
            itemId,
            kind: "agent",
            phase,
            ...route,
            text
          });
        }
      }
      if (status === "failed" || status === "interrupted") {
        const code = status === "failed" ? "CUX-PROJECT-THREAD-001" : "CUX-PROJECT-PAUSE-001";
        const detail = projectTurnErrorText(turn) || (status === "failed" ? "成员线程返回失败状态。" : "成员线程被中断。" );
        projectRoomStore.appendMessage(binding.ownerId, {
          projectId: binding.projectId,
          agentId: binding.agentId,
          threadId,
          turnId: turnId ?? stringValue(turn.id) ?? null,
          itemId: `turn-terminal:${turnId ?? stringValue(turn.id) ?? method}:${status}`,
          kind: "system",
          phase,
          ...route,
          text: status === "failed"
            ? `成员线程失败（${code}）：${detail}`
            : `成员线程已中断（${code}）：${detail}`
        });
        projectRoomStore.setMemberStatus(binding.ownerId, binding.projectId, binding.agentId, status === "failed" ? "failed" : "paused");
      }
    }
  } catch (error) {
    // A malformed upstream event must never take down the Codex notification
    // router. Keep the raw event available in diagnostics for investigation.
    console.warn("Failed to archive Project notification", { method, threadId, error });
  }
}

function projectProjectTurnMetadata(threadId: string, turnId?: string): ProjectTurnMetadata | null {
  if (turnId) {
    const exact = projectTurnMetadata.get(turnId);
    if (exact && exact.threadId === threadId) return exact;
  }
  let latest: ProjectTurnMetadata | null = null;
  for (const candidate of projectTurnMetadata.values()) {
    if (candidate.threadId !== threadId) continue;
    if (!latest || candidate.sequence > latest.sequence) latest = candidate;
  }
  return latest;
}

function projectNotificationText(item: Record<string, unknown>): string {
  const direct = stringValue(item.text)?.trim();
  if (direct) return direct;
  const content = item.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const record = asRecord(entry);
        return stringValue(record.text) ?? stringValue(record.value) ?? "";
      })
      .filter(Boolean)
      .join("")
      .trim();
  }
  return stringValue(item.message)?.trim() ?? "";
}

function projectTurnErrorText(turn: Record<string, unknown>): string {
  const error = asRecord(turn.error);
  return stringValue(error.message)?.trim()
    ?? stringValue(error.additionalDetails)?.trim()
    ?? stringValue(turn.message)?.trim()
    ?? "";
}

function visibleProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.filter((provider) => isProviderFeatureEnabled(provider.id));
}

async function activateProvider(providerId: string, model?: string, groupId?: string): Promise<ProviderActivation> {
  if (providerId === "muse-official" || providerId === "muse") {
    return {
      providerId: "muse-official",
      modelProvider: "muse",
      model: model || "muse-spark-1.3",
      groupId: groupId ?? "default",
      groupName: "Muse",
      groupKind: "text",
      responseProtocol: "openai",
      restartedAt: Date.now()
    };
  }
  if (providerId === "agy-official" || providerId === "agy") {
    return {
      providerId: "agy-official",
      modelProvider: "agy",
      model: model || "gemini-3.8-flash-high",
      groupId: groupId ?? "default",
      groupName: "Antigravity",
      groupKind: "text",
      responseProtocol: "gemini",
      restartedAt: Date.now()
    };
  }
  if (providerId === "agy-launch") {
    return {
      providerId: "agy-launch",
      modelProvider: "agy",
      model: model || "gemini-3.8-flash-high",
      groupId: groupId ?? "default",
      groupName: "Antigravity (agy-launch)",
      groupKind: "text",
      responseProtocol: "openai",
      restartedAt: Date.now()
    };
  }
  if (!isProviderFeatureEnabled(providerId)) {
    throw new Error(`Provider is disabled in this build: ${providerId}`);
  }
  const provider = await providerStore.get(providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  const groups = provider.groups ?? [];
  const normalizedGroup = groupId?.trim().toLocaleLowerCase();
  const group = groupId
    ? groups.find((entry) => entry.id === groupId)
      ?? groups.find((entry) => entry.name === groupId)
      ?? groups.find((entry) => entry.id.trim().toLocaleLowerCase() === normalizedGroup || entry.name.trim().toLocaleLowerCase() === normalizedGroup)
    : groups.find((entry) => entry.kind !== "image") ?? groups[0];
  if (groupId && !group) {
    throw new Error(`Group not found for ${provider.name}: ${groupId}`);
  }
  const fallbackModel = groups.length > 0 ? group?.models?.[0] : provider.defaultModel || provider.nativeModels[0];
  const requestedModelInput = model || fallbackModel;
  const requestedModel = requestedModelInput;
  const requestedBaseModel = stripModelContextVariant(requestedModel ?? "").baseModel;
  const catalogModel = provider.capabilityCatalog?.data.find((entry) => entry.model_name === requestedModel || entry.model_name === requestedBaseModel);
  if (group && requestedModel) {
    const protocol = resolveModelProtocol(group, catalogModel);
    if (!modelSupportsProtocol(catalogModel, protocol)) {
      throw new Error(`Model ${requestedModel} does not support ${protocol} in group ${group.name}`);
    }
  }
  const selectedModel = resolveProviderModel(group, requestedModel);
  assertProviderQuotaAvailable(provider, group);
  if (group) {
    const apiKey = await resolveGroupApiKey(provider, group);
    if (!apiKey && group.authType !== "none" && group.id !== "freebuff") {
      throw new Error(`Group ${group.name} and provider ${provider.name} have no API key`);
    }
    console.info("[provider] activating relay group", {
      providerId: provider.id,
      providerName: provider.name,
      groupId: group.id,
      groupName: group.name,
      groupKind: group.kind ?? "text",
      keyCount: group.keys.length,
      credentialSource: group.authType === "none"
        ? "none"
        : group.credentialMode === "provider" || group.keys.length === 0 ? "provider" : "group"
    });
  }

  logCodexConfigHealth(ensureCodexConfigHealthy(), "provider activation");
  // Relay routes authenticate through the stable local gateway URL. The
  // gateway reads the latest provider protocol on every request, so changing
  // Responses/Chat Completions applies to an existing thread's next turn.
  if (!group) {
    await bridge.restart();
  }

  const modelProvider = provider.kind === "chatgpt" ? "openai" : provider.id;
  const edits: Array<{ keyPath: string; value: JsonValue; mergeStrategy: "replace" }> = [];

  if (provider.kind !== "chatgpt") {
    edits.push({
      keyPath: `model_providers.${provider.id}`,
      value: providerToCodexConfig(provider, group),
      mergeStrategy: "replace"
    });
  }

  // Model and model_provider are thread-scoped and passed per turn/resume/start.
  // Never write Codex's global model, model_provider, or model_context_window during activation:
  // doing so lets a different channel overwrite an active conversation's settings.
  appendContextWindowLog(`activateProvider providerId=${provider.id} groupId=${group?.id ?? ""} model=${selectedModel ?? ""} model_context_window=skipped-global-write`);

  if (edits.length > 0) {
    await bridge.request("config/batchWrite", {
      edits,
      reloadUserConfig: true
    }, PROVIDER_CONFIG_WRITE_TIMEOUT_MS);
  }

  const homes = collectLocalCodexHomes();
  for (const home of homes) {
    if (group && selectedModel) {
      writeCodexModelCatalog(home, group, selectedModel);
    }
  }
  const catalogHome = bridge.getStatus().codexHome ?? homes[0];
  if (catalogHome && group && selectedModel) {
    const catalogPath = join(catalogHome, CODEX_ULTRA_MODEL_CATALOG_FILE);
    await bridge.request("config/value/write", {
      keyPath: "model_catalog_json",
      value: catalogPath,
      mergeStrategy: "replace"
    }, PROVIDER_CONFIG_WRITE_TIMEOUT_MS);
  }

  await syncModelProvidersToUserConfig(
    resolveVirtualCodexConfigPath(),
    resolveCodexUserConfigPath(),
    { modelProvider, model: selectedModel }
  );

  // Claude requests carry the owning thread id, so the relay gateway resolves
  // the latest provider/group without restarting a live CLI process.

  return {
    providerId: provider.id,
    modelProvider,
    model: selectedModel,
    groupId: group?.id,
    groupName: group?.name,
    groupKind: group?.kind,
    responseProtocol: group ? resolveModelProtocol(group, catalogModel) : undefined,
    restartedAt: Date.now()
  };
}

async function runProviderActivationExclusive<T>(task: () => Promise<T>): Promise<T> {
  const previous = providerActivationQueue;
  let release!: () => void;
  providerActivationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
  }
}

function sshProfileFromParams(params: JsonValue | undefined): SshWorkspaceProfile | null {
  const record = asRecord(params);
  const workspace = asRecord(record.workspace);
  if (stringValue(workspace.type) !== "ssh") return null;
  const command = stringValue(workspace.command)?.trim();
  const cwd = stringValue(workspace.cwd)?.trim();
  const providerId = stringValue(workspace.providerId)?.trim();
  const groupId = stringValue(workspace.groupId)?.trim();
  return command && cwd ? { command, cwd, providerId, groupId } : null;
}

async function sshBridgeForParams(params: JsonValue | undefined): Promise<SshCodexBridge | null> {
  const profile = sshProfileFromParams(params);
  if (!profile) return null;
  const key = [profile.command, profile.cwd, profile.providerId ?? "", profile.groupId ?? ""].join("\n");
  let remote = sshBridges.get(key);
  if (!remote) {
    if (!profile.providerId) throw new Error("SSH Codex workspace requires a selected relay provider");
    const provider = await providerStore.get(profile.providerId);
    if (!provider) throw new Error("SSH Codex relay provider was not found: " + profile.providerId);
    if (provider.kind === "chatgpt") throw new Error("SSH Codex currently requires a relay API provider; ChatGPT account auth is local-only");
    const group = profile.groupId
      ? provider.groups?.find((entry) => entry.id === profile.groupId)
      : provider.groups?.find((entry) => entry.kind !== "image") ?? provider.groups?.[0];
    if (!group) throw new Error("SSH Codex relay group was not found");
    const remoteForwardPort = allocateSshForwardPort();
    const remoteProviderConfig = {
      ...asRecord(providerToCodexConfig(provider, group)),
      base_url: "http://127.0.0.1:" + remoteForwardPort + "/api/relay-gateway/"
        + encodeURIComponent(provider.id) + "/" + encodeURIComponent(group.id) + "/v1",
      env_key: RELAY_GATEWAY_ENV_KEY
    };
    const configEdits: Array<{ keyPath: string; value: JsonValue; mergeStrategy: "replace" }> = [
      { keyPath: "model_providers." + provider.id, value: remoteProviderConfig, mergeStrategy: "replace" }
    ];
    remote = new SshCodexBridge(profile, {
      remoteForwardPort,
      localServerPort: PORT,
      relayGatewayToken,
      configEdits
    });
    sshBridges.set(key, remote);
    remote.on("status", (status) => codexApiEvents.append("engineStatus", { ...status, message: "[ssh] " + (status.message ?? "") }, null));
    remote.on("stderr", (message) => console.warn("[codex:ssh]", message));
    remote.on("message", (message: JsonRpcMessage) => {
      if ("method" in message && "id" in message) {
        const request = message as JsonRpcRequest;
        const routedId = "ssh:" + key + ":" + String(request.id);
        pendingSshServerRequests.set(routedId, { bridge: remote!, remoteId: request.id });
        void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route SSH Codex server request", error));
      } else if ("method" in message) {
        routeCodexNotification(message as JsonRpcNotification & { method: string });
      }
    });
  }
  if (remote.getStatus().phase !== "ready") await remote.start();
  return remote;
}

async function restoreSshThreadBridge(threadId: string, user: AuthUser | null): Promise<SshCodexBridge | null> {
  const existing = sshThreadBridges.get(threadId);
  if (existing) return existing;
  const profile = sshWorkspaceStore.get(threadId);
  if (!profile) return null;
  const runtime = threadRuntimeMetadataStore.get(user?.id ?? "local", threadId);
  const restored = await sshBridgeForParams({
    threadId,
    model: runtime?.model ?? "",
    workspace: { type: "ssh", ...profile }
  });
  if (restored) sshThreadBridges.set(threadId, restored);
  return restored;
}

async function restoreRemoteBunThreadBridge(threadId: string): Promise<RemoteBunCodexBridge | null> {
  const existing = remoteBunThreadBridges.get(threadId);
  if (existing) {
    if (existing.getStatus().phase !== "ready") await existing.start();
    return existing;
  }
  const route = remoteThreadRouteStore.get(threadId);
  if (!route) return null;
  const remote = new RemoteBunCodexBridge(route);
  remote.on("status", (status) => codexApiEvents.append("engineStatus", { ...status, message: "[remote-bun] " + (status.message ?? "") }, null));
  remote.on("stderr", (message) => console.warn("[remote-bun]", message as string));
  remote.on("cursor", (cursor) => scheduleRemoteCursorPersist(threadId, Number(cursor)));
  remote.on("message", (message: JsonRpcMessage) => {
    if ("method" in message && "id" in message) {
      const request = message as JsonRpcRequest;
      // Deterministic id: a reattach replays the journal from the last persisted
      // cursor, and an approval that nobody answered while the thread was in the
      // background must be routed again rather than suppressed as a duplicate.
      const routedId = "remote-bun:" + threadId + ":" + String(request.id);
      pendingRemoteBunServerRequests.set(routedId, { bridge: remote, remoteId: request.id });
      void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route remote Bun server request", error));
    } else if ("method" in message) {
      routeCodexNotification(message as JsonRpcNotification & { method: string });
    }
  });
  await remote.start();
  remoteBunThreadBridges.set(threadId, remote);
  remoteThreadRouteStore.touch(threadId);
  return remote;
}

/**
 * Attach or detach an autonomous remote thread. Detaching also drops this
 * node's pending server requests for it: the local bridge is gone and can no
 * longer deliver an answer, while the remote node keeps the request open, so
 * the next attach replays it from the event journal.
 */
async function switchRemoteThreadLifecycle(
  threadId: string,
  lifecycleMode: "foreground" | "background"
): Promise<Awaited<ReturnType<typeof transitionRemoteThreadLifecycle>>> {
  const result = await transitionRemoteThreadLifecycle(
    remoteThreadRouteStore,
    remoteBunThreadBridges,
    restoreRemoteBunThreadBridge,
    threadId,
    lifecycleMode
  );
  if (result.state === "background") {
    const prefix = "remote-bun:" + threadId + ":";
    for (const key of [...pendingRemoteBunServerRequests.keys()]) {
      if (key.startsWith(prefix)) pendingRemoteBunServerRequests.delete(key);
    }
  }
  return result;
}

/**
 * Builds the relay payload the remote node needs to reach the upstream provider
 * on its own. Shared by the explicit relay-sync route and by autonomous thread
 * creation, which cannot produce a working thread without it.
 */
async function buildRemoteRelayPayload(providerId: string, groupId: string): Promise<Record<string, unknown>> {
  const provider = await providerStore.get(providerId);
  if (!provider) throw new Error("Relay not found");
  if (provider.kind === "chatgpt") throw new Error("ChatGPT account authentication cannot be copied to a remote Bun Server");
  const group = provider.groups?.find((entry) => entry.id === groupId);
  if (!group) throw new Error("Relay group not found");
  const apiKey = await resolveGroupApiKey(provider, group);
  if (!apiKey) throw new Error("The selected relay group has no configured API key");
  return {
    providerId: provider.id,
    providerName: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    models: group.models ?? provider.nativeModels,
    replaceGroups: true,
    groups: [{
      groupId: group.id,
      groupName: group.name,
      baseUrl: group.baseUrl,
      kind: group.kind ?? "text",
      enabled: group.status !== "disabled",
      groupRatio: group.groupRatio,
      models: group.models ?? [],
      responseProtocol: group.responseProtocol,
      responseProtocolMode: group.responseProtocolMode,
      apiKey
    }]
  };
}

/** Both response shapes the remote node can return for an RPC call. */
function remoteRpcResult(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload as JsonValue);
  const data = asRecord(record.data as JsonValue);
  return Object.keys(data).length ? asRecord(data.result as JsonValue) : asRecord(record.result as JsonValue);
}

/**
 * Creates a thread that lives on the remote node instead of on this machine.
 * That placement is the whole point: the node owns the CLI process and journals
 * its events, so dropping the local bridge stops nothing and the thread can be
 * detached. A thread started locally — even one whose workspace is over SSH —
 * cannot be promoted afterwards, because its process is a child of this server.
 *
 * The order matters: the route may only be registered once the remote thread
 * exists, and the bootstrap tunnel may only close once the autonomous bridge
 * has opened its own.
 */
async function startAutonomousRemoteThread(input: {
  command: string;
  cwd: string;
  remotePort: number;
  model?: string;
  providerId?: string;
  groupId?: string;
  cliBackend?: string;
  syncRelay: boolean;
}): Promise<{ threadId: string; route: unknown; probe: RemoteBunNodeProbe }> {
  const probe = await probeRemoteBunNode(input.command, input.remotePort);
  if (!probe.installed || !probe.health) {
    throw new Error("The remote Bun Server is not ready on this host: " + (probe.reasons.join("; ") || "unknown reason"));
  }
  const tunnel = await openRemoteBunNodeTunnel(input.command, input.remotePort);
  let threadId = "";
  try {
    if (input.syncRelay && input.providerId && input.groupId) {
      await syncRelayToRemoteBunNode(tunnel.tunnelId, await buildRemoteRelayPayload(input.providerId, input.groupId));
    }
    const session = asRecord(await requestRemoteBunNode(tunnel.tunnelId, "POST", "/api/codex/sessions") as JsonValue);
    const sessionId = stringValue(asRecord(session.data as JsonValue).sessionId) ?? stringValue(session.sessionId) ?? "";
    if (!sessionId) throw new Error("The remote Bun Server did not return an API session");
    const started = await requestRemoteBunNode(tunnel.tunnelId, "POST", "/api/codex/rpc", {
      method: "thread/start",
      params: {
        cwd: input.cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.providerId ? { modelProvider: input.providerId } : {}),
        ...(input.cliBackend ? { cliBackend: input.cliBackend } : {})
      }
    }, sessionId);
    threadId = stringValue(asRecord(remoteRpcResult(started).thread as JsonValue).id) ?? "";
    if (!threadId) throw new Error("The remote Bun Server did not return a thread");
    const route = remoteThreadRouteStore.put({
      threadId,
      command: input.command,
      cwd: input.cwd,
      remotePort: input.remotePort,
      lifecycleMode: "foreground",
      cliBackend: input.cliBackend === "claude" ? "claude" : input.cliBackend === "agy" ? "agy" : input.cliBackend === "auggie" ? "auggie" : input.cliBackend === "grok" ? "grok" : input.cliBackend === "muse" ? "muse" : input.cliBackend === "pi" ? "pi" : "codex"
    });
    await switchRemoteThreadLifecycle(threadId, "foreground");
    return { threadId, route, probe };
  } catch (error) {
    // A route pointing at a thread we failed to attach would surface in the
    // thread list as an autonomous thread that cannot be opened.
    if (threadId) remoteThreadRouteStore.delete(threadId);
    throw error;
  } finally {
    // Only the bootstrap forwarding process closes here; the autonomous bridge
    // established its own tunnel during attach.
    closeRemoteBunNodeTunnel(tunnel.tunnelId);
  }
}

function scheduleRemoteCursorPersist(threadId: string, cursorValue: number): void {
  const cursor = Number.isSafeInteger(cursorValue) && cursorValue >= 0 ? cursorValue : 0;
  const pending = pendingRemoteCursorWrites.get(threadId);
  if (pending) {
    pending.cursor = Math.max(pending.cursor, cursor);
    return;
  }
  const timer = setTimeout(() => {
    const current = pendingRemoteCursorWrites.get(threadId);
    if (!current) return;
    pendingRemoteCursorWrites.delete(threadId);
    remoteThreadRouteStore.setEventCursor(threadId, current.cursor);
  }, 250);
  pendingRemoteCursorWrites.set(threadId, { cursor, timer });
}

function bridgeForThread(threadId: string | null): CodexRuntimeClient {
  if (threadId) {
    const metaBackend = threadRuntimeMetadataStore.getAny(threadId)?.cliBackend;
    if (metaBackend === "opencode") return opencodeBridge;
    if (metaBackend === "opencode-v2") return opencodeV2Bridge;
    if (metaBackend === "agy") return agyBridge;
    if (metaBackend === "auggie") return auggieBridgeFor(threadId);
    if (metaBackend === "cline") return clineBridgeFor(threadId);
    if (metaBackend === "command-code") return commandCodeBridgeFor(threadId);
    if (metaBackend === "grok") return grokBridge;
    if (metaBackend === "pi") return piBridge;
    if (metaBackend === "claude") {
      const claude = claudeThreadBridges.get(threadId);
      if (claude) return claude;
    }
    if (metaBackend === "codex") return bridge;
    if (metaBackend === "mini") return miniBridge;
  }
  if (threadId && !agyThreadBridges.has(threadId) && (agySessionStore.findByThreadId(threadId) || agyBridge.hasSession(threadId))) {
    agyThreadBridges.set(threadId, agyBridge);
  }
  if (threadId && !grokThreadBridges.has(threadId) && (grokSessionStore.findByThreadId(threadId) || grokBridge.hasSession(threadId))) {
    grokThreadBridges.set(threadId, grokBridge);
  }
  if (threadId && !museThreadBridges.has(threadId) && (museSessionStore.findByThreadId(threadId) || museBridge.hasSession(threadId))) {
    museThreadBridges.set(threadId, museBridge);
  }
  if (threadId && !piThreadBridges.has(threadId) && (piSessionStore.findByThreadId(threadId) || piBridge.hasSession(threadId))) {
    piThreadBridges.set(threadId, piBridge);
  }
  if (threadId && !opencodeThreadBridges.has(threadId) && (opencodeSessionStore.findByThreadId(threadId) || opencodeBridge.hasSession(threadId) || isNativeOpencodeSessionId(threadId))) {
    opencodeThreadBridges.set(threadId, opencodeBridge);
  }
  if (threadId && !miniThreadBridges.has(threadId) && miniBridge.hasSession(threadId)) {
    miniThreadBridges.set(threadId, miniBridge);
  }
  const fallbackBridge = bridge;
  return (threadId ? opencodeThreadBridges.get(threadId) ?? piThreadBridges.get(threadId) ?? grokThreadBridges.get(threadId) ?? agyThreadBridges.get(threadId) ?? remoteBunThreadBridges.get(threadId) ?? sshThreadBridges.get(threadId) ?? claudeThreadBridges.get(threadId) ?? miniThreadBridges.get(threadId) : undefined) ?? fallbackBridge;
}

function localThreadResumeParams(params: JsonValue | undefined): JsonValue | undefined {
  const record = asRecord(params);
  const threadId = stringValue(record.threadId);
  if (!threadId) return undefined;
  const sandboxPolicy = asRecord(record.sandboxPolicy);
  const rawSandbox = stringValue(sandboxPolicy.type) ?? stringValue(record.sandbox);
  const sandbox = rawSandbox === "readOnly" ? "read-only" : rawSandbox === "workspaceWrite" ? "workspace-write" : rawSandbox === "dangerFullAccess" ? "danger-full-access" : rawSandbox;
  const resume: Record<string, JsonValue> = { threadId };
  for (const key of ["cwd", "model", "modelProvider", "approvalPolicy", "config", "baseInstructions", "developerInstructions", "personality"]) {
    const value = record[key];
    if (value !== undefined) resume[key] = value as JsonValue;
  }
  if (sandbox) resume.sandbox = sandbox;

  const runtime = threadRuntimeMetadataStore.getAny(threadId);
  if (runtime) {
    if (!resume.model && runtime.model) {
      resume.model = runtime.model;
    }
    if (!resume.modelProvider && runtime.providerId) {
      const pid = runtime.providerId;
      resume.modelProvider = (pid === "official-openai" || pid === "chatgpt" || pid === "openai") ? "openai" : pid;
    }
    if (!resume.cwd && runtime.cwd) {
      resume.cwd = runtime.cwd;
    }
  }

  const resumeConfig = { ...asRecord(resume.config) };
  if (resume.modelProvider) {
    resumeConfig.model_provider = resume.modelProvider as string;
  }
  if (resume.model) {
    resumeConfig.model = resume.model as string;
  }
  resume.config = resumeConfig as unknown as JsonValue;

  return resume;
}

function registerClaudeVirtualThread(threadId: string, parentThreadId: string): void {
  const parentBridge = claudeThreadBridges.get(parentThreadId);
  if (!parentBridge) return;
  claudeVirtualParentByThread.set(threadId, parentThreadId);
  claudeThreadBridges.set(threadId, parentBridge);
}

function releaseClaudeThreadTree(threadId: string): string[] {
  const descendants: string[] = [];
  const pending = [threadId];
  while (pending.length > 0) {
    const parentThreadId = pending.pop()!;
    for (const [candidateThreadId, candidateParentId] of claudeVirtualParentByThread) {
      if (candidateParentId !== parentThreadId) continue;
      descendants.push(candidateThreadId);
      pending.push(candidateThreadId);
    }
  }
  for (const descendantThreadId of descendants.reverse()) {
    claudeVirtualParentByThread.delete(descendantThreadId);
    claudeThreadBridges.release(descendantThreadId);
  }
  claudeVirtualParentByThread.delete(threadId);
  claudeThreadBridges.release(threadId);
  return [threadId, ...descendants];
}

async function removeClaudeConfigDir(configDir: string): Promise<void> {
  const root = resolve(codexUiDataDir(), "virtual-claude");
  const target = resolve(configDir);
  if (target === root || !target.startsWith(root + sep)) {
    console.warn("Refusing to remove Claude config directory outside the managed root", target);
    return;
  }
  // Closing a thread only releases its bridge; the directory holds the CLI
  // transcript that `--resume` needs to reopen the thread later, so it may only
  // be discarded once no stored session points at it any more.
  if (claudeSessionStore.countByConfigDir(configDir) > 0) return;
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch((error) => {
    console.warn("Failed to remove Claude config directory", target, error);
  });
}

async function removeClaudeConfigDirAfterExit(bridge: CodeCliBridge, configDir: string): Promise<void> {
  const exited = await bridge.waitForExit();
  if (exited) {
    await removeClaudeConfigDir(configDir);
    return;
  }
  console.warn("Claude CLI did not exit before config cleanup timeout", configDir);
  void bridge.waitForExit(0).then(() => removeClaudeConfigDir(configDir));
}

/**
 * Managed Claude config directories now outlive the thread that created them so
 * `--resume` keeps working, which leaves behind the ones whose thread is gone.
 * Only sweep directories no stored session points at, and only once they have
 * gone untouched long enough that another process cannot still be in the window
 * between creating one and persisting its first session snapshot.
 */
async function pruneOrphanClaudeConfigDirs(): Promise<void> {
  const root = join(codexUiDataDir(), "virtual-claude");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const referenced = new Set(claudeSessionStore.listConfigDirs().map((dir) => resolve(dir)));
  const cutoff = Date.now() - ORPHAN_CLAUDE_CONFIG_DIR_MIN_AGE_MS;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = join(root, entry.name);
    if (referenced.has(resolve(target))) continue;
    const modifiedAt = statSync(target, { throwIfNoEntry: false })?.mtimeMs;
    if (modifiedAt === undefined || modifiedAt > cutoff) continue;
    await removeClaudeConfigDir(target);
  }
}

async function createClaudeBridge(options: { managedConfigDir?: boolean; ownerId?: string; ssh?: SshWorkspaceProfile | null; configDir?: string | null; bypassEnabledCheck?: boolean } = {}): Promise<CodeCliBridge> {
  if (!options.bypassEnabledCheck && !isCliPluginEnabled("claude")) throw new Error("Claude-compatible CLI runtime is not enabled");
  const sshProfile = options.ssh ?? null;
  const label = sshProfile ? "[claude:ssh] " : "[claude] ";
  // The remote host owns its own Claude configuration and skill directories, so
  // a managed local config dir would only leak a Windows path across SSH.
  // A reopened thread reuses the directory it was started with: `--resume` reads
  // the CLI transcript stored there, and a fresh directory would leave the CLI
  // unable to find the session it is asked to continue.
  const claudeConfigDir = sshProfile || options.managedConfigDir === false
    ? null
    : options.configDir ?? join(codexUiDataDir(), "virtual-claude", randomUUID());
  if (claudeConfigDir) await mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
  const launcher = sshProfile
    ? await prepareSshCodeCliLauncher(sshProfile, {
        localServerPort: PORT,
        allocateRemotePort: allocateSshForwardPort,
        onProgress: (message) => codexApiEvents.append("engineStatus", { phase: "starting", transport: "stdio", message: label + message }, null)
      })
    : null;
  const ownerId = options.ownerId ?? "local";
  const bridge = new CodeCliBridge(() => ({
    ...process.env,
    ...(claudeConfigDir ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {}),
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    [RELAY_GATEWAY_ENV_KEY]: relayGatewayToken,
    CODEX_UI_PORT: String(PORT)
  }), launcher?.spawn, launcher ? terminateSshCodeCliChild : undefined, undefined, (snapshot) => {
    claudeSessionStore.upsert({
      threadId: snapshot.threadId,
      ownerId,
      externalSessionId: snapshot.externalSessionId ?? null,
      model: snapshot.model ?? null,
      cwd: snapshot.cwd ?? null,
      permissionMode: snapshot.permissionMode,
      configDir: claudeConfigDir,
      stateJson: JSON.stringify(snapshot),
    });
  }, sshProfile !== null);
  if (claudeConfigDir) claudeConfigDirs.set(bridge, claudeConfigDir);
  if (launcher) claudeSshLaunchers.set(bridge, launcher);
  claudeSkillInventories.set(bridge, new ClaudeSkillInventory(claudeConfigDir ?? undefined));
  bridge.on("status", (status) => codexApiEvents.append("engineStatus", { ...status, message: label + (status.message ?? "") }, null));
  bridge.on("stderr", (message) => console.warn(sshProfile ? "[claude:ssh]" : "[claude]", message));
  bridge.on("message", (message: JsonRpcMessage) => {
    if ("method" in message && "id" in message) {
      const request = message as JsonRpcRequest;
      const routedId = "claude:" + String(request.id);
      pendingClaudeServerRequests.set(routedId, { bridge: bridge, remoteId: request.id });
      void routeServerRequest({ ...request, id: routedId }).catch((error) => console.warn("Failed to route Claude server request", error));
    } else if ("method" in message) {
      routeCodexNotification(message as JsonRpcNotification & { method: string });
    }
  });
  return bridge;
}

async function resolveClaudeBridgeForThread(threadId: string, ownerId: string, method: string, params?: JsonValue, sshProfile: SshWorkspaceProfile | null = null): Promise<CodeCliBridge | null> {
  const existing = claudeThreadBridges.get(threadId);
  if (existing) {
    // Keep the bridge's thread-relay identity current so the CLI child carries a
    // `thread-id` header enabling live relay/group switching at the gateway.
    existing.configure({ threadId } as JsonValue);
    if (existing.getStatus().phase !== "ready" && codeCliNeedsRunningProcess(method) && !isClaudeHostSkillRpc(method)) await existing.start();
    return existing;
  }
  const metadata = threadRuntimeMetadataStore.get(ownerId, threadId)
    ?? (ownerId !== "local" ? threadRuntimeMetadataStore.get("local", threadId) : null)
    ?? threadRuntimeMetadataStore.getAny(threadId);
  const storedClaudeSession = claudeSessionStore.get(ownerId, threadId)
    ?? (ownerId !== "local" ? claudeSessionStore.get("local", threadId) : null);
  const paramBackend = stringValue(asRecord(params).cliBackend);
  const cliBackend = metadata?.cliBackend ?? (storedClaudeSession ? "claude" : paramBackend === "claude" ? "claude" : undefined);
  if (cliBackend !== "claude") return null;
  const bridge = await createClaudeBridge({
    managedConfigDir: codeCliNeedsManagedConfigDir(method),
    ownerId,
    ssh: sshProfile,
    configDir: storedClaudeSession?.configDir ?? null,
    bypassEnabledCheck: true,
  });
  if (storedClaudeSession?.stateJson) {
    try {
      const snapshot = JSON.parse(storedClaudeSession.stateJson);
      if (snapshot && snapshot.threadId === threadId) bridge.restoreSession(snapshot);
    } catch (error) {
      console.warn("Failed to restore Claude session snapshot", threadId, error);
    }
  }
  if (metadata) {
    // Legacy rows carry no persisted permission preset; leave the snapshot-
    // restored sandbox/approvalPolicy untouched for those instead of forcing a
    // downgrade, otherwise a reopened dangerBypass thread silently loses the
    // highest permission level on the next CLI spawn.
    const permission = metadata.permission === "dangerBypass"
      ? { sandbox: "dangerFullAccess", approvalPolicy: "never" }
      : metadata.permission
        ? { sandbox: "workspaceWrite", approvalPolicy: "on-request" }
        : {};
    bridge.configure({
      model: metadata.model,
      reasoningEffort: metadata.reasoningEffort,
      cwd: metadata.cwd,
      providerId: metadata.providerId,
      groupId: metadata.groupId,
      threadId,
      ...(storedClaudeSession?.externalSessionId ? { externalSessionId: storedClaudeSession.externalSessionId } : {}),
      ...permission
    } as JsonValue);
  }
  if (method !== "turn/interrupt") claudeThreadBridges.set(threadId, bridge);
  return bridge;
}

/**
 * Point the auggie redirector at the relay station an auggie thread should
 * use: explicit turn params first, then the thread's persisted runtime
 * selection, then the first non-image group of the first configured provider
 * (the same defaulting rule activateProvider applies).
 */
async function configureAuggieUpstream(ownerId: string, threadId: string | null, params: Record<string, unknown>): Promise<void> {
  const workspace = asRecord(params.workspace);
  const metadata = threadId ? threadRuntimeMetadataStore.get(ownerId, threadId) : undefined;
  const providerId = stringValue(params.modelProvider)
    ?? stringValue(workspace.providerId)
    ?? metadata?.providerId
    ?? undefined;
  const groupId = stringValue(params.groupId)
    ?? stringValue(workspace.groupId)
    ?? metadata?.groupId
    ?? undefined;
  let provider = providerId ? await providerStore.get(providerId) : null;
  if (!provider) {
    const providers = await providerStore.list();
    provider = providers.find((entry) => (entry.groups ?? []).some((group) => group.kind !== "image")) ?? providers[0] ?? null;
  }
  if (!provider) {
    console.warn("[auggie] no relay provider configured; chat-stream will stay unconfigured until one is added");
    configureAuggieRedirector({ upstreamBaseUrl: "", upstreamModel: "auggie-default", indexingMode: AUGGIE_INDEXING_MODE });
    return;
  }
  const groups = provider.groups ?? [];
  const group = groupId
    ? groups.find((entry) => entry.id === groupId || entry.name === groupId)
    : groups.find((entry) => entry.kind !== "image") ?? groups[0];
  if (!group) {
    console.warn(`[auggie] provider ${provider.name} has no channel group; redirector stays without an upstream`);
    configureAuggieRedirector({ upstreamBaseUrl: "", upstreamModel: "auggie-default", indexingMode: AUGGIE_INDEXING_MODE });
    return;
  }
  const selectedModel = stringValue(params.model)
    || group.models?.[0]
    || provider.defaultModel
    || provider.nativeModels[0];
  const model = resolveProviderModel(group, selectedModel) ?? "auggie-default";
  // MCP / VM-tool / JEV compatibility: auggie pulls its MCP set from the
  // redirector's service-config endpoints, so advertise the platform MCP
  // servers (sa-vm, plus jev when JEV MCP is enabled) with the station.
  const mcpScriptPath = resolveSaVmMcpScriptPath(stringValue(params.cwd) ?? metadata?.cwd ?? undefined);
  const mcpServers = mcpScriptPath
    ? [
        { name: "sa-vm", command: "node", args: [mcpScriptPath] },
        ...(isJevMcpEnabled() ? [{ name: "jev", command: "node", args: [mcpScriptPath] }] : []),
      ]
    : [];
  configureAuggieRedirector({
    // Route through the loopback relay-gateway like every other backend:
    // the gateway resolves the station endpoint and credentials server-side,
    // so catalog-managed / keyless providers (e.g. omniroute-free, whose
    // groups carry no baseUrl or keys in the store) work too. Pointing the
    // redirector at group.baseUrl directly left it with an empty upstream
    // for those providers and every chat-stream was rejected.
    upstreamBaseUrl: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
    upstreamModel: model,
    apiKey: "auggie-relay-key",
    modelCatalog: buildAuggieModelCatalog(group, selectedModel, model),
    modelContextTokens: 200_000,
    modelMaxOutputTokens: 16_000,
    mcpServers,
    // "complete" is this redirector's deny-indexing answer: /find-missing
    // always reports nothing missing and max_upload_size_bytes is 0, so the
    // CLI never uploads repository content. Indexing is disabled by default.
    indexingMode: AUGGIE_INDEXING_MODE
  });
}

/**
 * Point cline hub sessions at the relay station a cline thread should
 * use: register the station as an OpenAI-compatible provider entry in the
 * cline data dir (loopback relay gateway + placeholder key — the gateway
 * resolves real upstream keys server-side), upsert the platform MCP
 * servers (sa-vm / jev) into cline's MCP settings, and hand the entry to
 * the bridge. No Cline account login is involved anywhere.
 */
async function configureClineUpstream(ownerId: string, threadId: string | null, params: Record<string, unknown>): Promise<void> {
  const workspace = asRecord(params.workspace);
  const metadata = threadId ? threadRuntimeMetadataStore.get(ownerId, threadId) : undefined;
  const providerId = stringValue(params.modelProvider)
    ?? stringValue(workspace.providerId)
    ?? metadata?.providerId
    ?? undefined;
  const groupId = stringValue(params.groupId)
    ?? stringValue(workspace.groupId)
    ?? metadata?.groupId
    ?? undefined;
  let provider = providerId ? await providerStore.get(providerId) : null;
  if (!provider) {
    const providers = await providerStore.list();
    provider = providers.find((entry) => (entry.groups ?? []).some((group) => group.kind !== "image")) ?? providers[0] ?? null;
  }
  if (!provider) {
    console.warn("[cline] no relay provider configured; sessions keep the cline data dir's own providers until one is added");
    return;
  }
  const groups = provider.groups ?? [];
  const group = groupId
    ? groups.find((entry) => entry.id === groupId || entry.name === groupId)
    : groups.find((entry) => entry.kind !== "image") ?? groups[0];
  if (!group) {
    console.warn(`[cline] provider ${provider.name} has no channel group; sessions keep the cline data dir's own providers`);
    return;
  }
  const selectedModel = stringValue(params.model)
    || group.models?.[0]
    || provider.defaultModel
    || provider.nativeModels[0];
  const model = resolveProviderModel(group, selectedModel) ?? "cline-default";
  const clineDataDir = defaultClineDataDir(codexUiDataDir());
  // The hub resolves session providers against cline's built-in provider
  // ids, so the relay station occupies the "openai-compatible" slot of
  // our isolated data dir (rewritten per configure, the same singleton
  // semantics as auggie's process-wide redirector).
  const entryId = "openai-compatible";
  writeClineRelayProvider(clineDataDir, entryId, {
    baseUrl: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
    apiKey: "cline-relay-key",
    model,
  });
  // MCP / VM-tool / JEV compatibility: cline sessions read MCP servers
  // from <dataDir>/settings/cline_mcp_settings.json.
  const mcpSettingsPath = ensureClineMcpSettingsFile(clineDataDir);
  const mcpScriptPath = resolveSaVmMcpScriptPath(stringValue(params.cwd) ?? metadata?.cwd ?? undefined);
  if (mcpScriptPath) {
    await upsertSaVmMcpServerJsonFile(mcpSettingsPath, mcpScriptPath);
  }
  clineBridgeFor(threadId).applyUpstream({ providerEntryId: entryId, model }, threadId);
}

/**
 * Point Command Code turns at the relay station a thread should use:
 * register the station as a BYOK provider in the isolated Command Code
 * home (loopback relay gateway; the apiKey is an env reference to a
 * placeholder the gateway ignores), upsert the platform MCP servers
 * (sa-vm / jev) into the user-scope mcp.json, and hand the slot to the
 * bridge. No Command Code account login is involved anywhere.
 */
async function configureCommandCodeUpstream(ownerId: string, threadId: string | null, params: Record<string, unknown>): Promise<void> {
  const workspace = asRecord(params.workspace);
  const metadata = threadId ? threadRuntimeMetadataStore.get(ownerId, threadId) : undefined;
  const providerId = stringValue(params.modelProvider)
    ?? stringValue(workspace.providerId)
    ?? metadata?.providerId
    ?? undefined;
  const groupId = stringValue(params.groupId)
    ?? stringValue(workspace.groupId)
    ?? metadata?.groupId
    ?? undefined;
  let provider = providerId ? await providerStore.get(providerId) : null;
  if (!provider) {
    const providers = await providerStore.list();
    provider = providers.find((entry) => (entry.groups ?? []).some((group) => group.kind !== "image")) ?? providers[0] ?? null;
  }
  if (!provider) {
    console.warn("[command-code] no relay provider configured; turns stay unconfigured until one is added");
    return;
  }
  const groups = provider.groups ?? [];
  const group = groupId
    ? groups.find((entry) => entry.id === groupId || entry.name === groupId)
    : groups.find((entry) => entry.kind !== "image") ?? groups[0];
  if (!group) {
    console.warn(`[command-code] provider ${provider.name} has no channel group; turns stay unconfigured`);
    return;
  }
  const selectedModel = stringValue(params.model)
    || group.models?.[0]
    || provider.defaultModel
    || provider.nativeModels[0];
  const model = resolveProviderModel(group, selectedModel) ?? "command-code-default";
  const homeDir = defaultCommandCodeHomeDir(codexUiDataDir());
  writeCommandCodeRelayProvider(homeDir, "cxu-relay", {
    baseUrl: `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`,
    model,
  });
  // MCP / VM-tool / JEV compatibility: user-scope MCP config lives at
  // <home>/.commandcode/mcp.json (project .mcp.json is synced separately
  // by the generic workspace bundle and read natively by the CLI).
  const mcpPath = ensureCommandCodeMcpFile(homeDir);
  const mcpScriptPath = resolveSaVmMcpScriptPath(stringValue(params.cwd) ?? metadata?.cwd ?? undefined);
  if (mcpScriptPath) {
    await upsertSaVmMcpServerJsonFile(mcpPath, mcpScriptPath);
  }
  commandCodeBridgeFor(threadId).applyUpstream({ providerId: "cxu-relay", model }, threadId);
}

/**
 * Build the `model_info_registry` catalog the redirector advertises via
 * `get-models`. The CLI parses that registry ONCE at process start and
 * resolves every `--model` / `session/set_model` id against it, while a
 * single long-lived CLI child serves all auggie threads — so the whole group
 * has to be present up front. Keys are the UI-facing (unmapped) ids; the
 * mapped id is included too so the bridge's spawn fallback also resolves.
 */
function buildAuggieModelCatalog(
  group: ChannelGroupConfig,
  selectedModel: string | undefined,
  mappedModel: string
): AuggieRedirectorModelCatalogEntry[] {
  const ids: string[] = [];
  for (const candidate of [selectedModel, ...(group.models ?? []), mappedModel]) {
    const id = typeof candidate === "string" ? candidate.trim() : "";
    if (id && !ids.includes(id)) ids.push(id);
  }
  const selected = selectedModel?.trim();
  return ids.map((id) => ({ id, ...(selected && id === selected ? { isDefault: true } : {}) }));
}

function respondToCodexServerRequest(
  requestId: string | number,
  result?: JsonValue,
  error?: Parameters<CodexRuntimeClient["respond"]>[2]
): void {
  const sshPending = pendingSshServerRequests.get(String(requestId));
  if (sshPending) {
    pendingSshServerRequests.delete(String(requestId));
    sshPending.bridge.respond(sshPending.remoteId, result, error);
    return;
  }
  const claudePending = pendingClaudeServerRequests.get(String(requestId));
  if (claudePending) {
    pendingClaudeServerRequests.delete(String(requestId));
    claudePending.bridge.respond(claudePending.remoteId, result, error);
    return;
  }
  const remoteBunPending = pendingRemoteBunServerRequests.get(String(requestId));
  if (remoteBunPending) {
    pendingRemoteBunServerRequests.delete(String(requestId));
    remoteBunPending.bridge.respond(remoteBunPending.remoteId, result, error);
    return;
  }
  const opencodePending = pendingOpencodeServerRequests.get(String(requestId));
  if (opencodePending) {
    pendingOpencodeServerRequests.delete(String(requestId));
    opencodePending.bridge.respond(opencodePending.remoteId, result, error);
    return;
  }
  const agyPending = pendingAgyServerRequests.get(String(requestId));
  if (agyPending) {
    pendingAgyServerRequests.delete(String(requestId));
    agyPending.bridge.respond(agyPending.remoteId, result, error);
    return;
  }
  const auggiePending = pendingAuggieServerRequests.get(String(requestId));
  if (auggiePending) {
    pendingAuggieServerRequests.delete(String(requestId));
    auggiePending.bridge.respond(auggiePending.remoteId, result, error);
    return;
  }
  const miniPending = pendingMiniServerRequests.get(String(requestId));
  if (miniPending) {
    pendingMiniServerRequests.delete(String(requestId));
    miniPending.bridge.respond(miniPending.remoteId, result, error);
    return;
  }
  bridge.respond(requestId, result, error);
}

/**
 * Build the Antigravity (AGY)-only history listing for the sidebar's AGY tab without
 * touching the Codex rollout store.
 */
function piThreadListResult(ownerId: string): JsonValue {
  const records = ownerId !== "local"
    ? [...piSessionStore.listByOwner(ownerId), ...piSessionStore.listByOwner("local")]
    : piSessionStore.listByOwner(ownerId);
  const seenIds = new Set<string>();
  const uniqueRecords = records.filter((r) => {
    if (seenIds.has(r.threadId)) return false;
    seenIds.add(r.threadId);
    return true;
  });
  const piThreads = uniqueRecords
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Pi conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "pi",
        source: "appServer",
        turns: []
      };
    })
    .sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0));
  return { data: piThreads } as JsonValue;
}

/** The shared opencode session store holds both generations; the runtime
 * metadata store is the identity source for which bridge owns a thread. */
function opencodeSessionBackend(threadId: string): "opencode" | "opencode-v2" {
  return threadRuntimeMetadataStore.getAny(threadId)?.cliBackend === "opencode-v2" ? "opencode-v2" : "opencode";
}

function opencodeThreadListResult(ownerId: string, backend: "opencode" | "opencode-v2" = "opencode"): JsonValue {
  const records = opencodeSessionStore.listForOwner(ownerId);
  const seenIds = new Set<string>();
  const uniqueRecords = records.filter((r) => {
    if (seenIds.has(r.threadId)) return false;
    seenIds.add(r.threadId);
    return true;
  }).filter((r) => opencodeSessionBackend(r.threadId) === backend);
  const opencodeThreads = uniqueRecords
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      const name = stringValue(snapshot.name);
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: stringValue(snapshot.parentThreadId) ?? null,
        agentRole: stringValue(snapshot.agentType) ?? null,
        agentNickname: stringValue(snapshot.taskName) ?? null,
        name: name ?? null,
        title: name ?? null,
        preview: name ?? stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "OpenCode conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        additionalRoots: Array.isArray(snapshot.additionalRoots) ? snapshot.additionalRoots : [],
        cliBackend: backend,
        source: "appServer",
        turns: []
      };
    })
    .filter((entry) => !entry.parentThreadId);
  // Native opencode sessions (`ses_*` from the opencode SQLite store) are
  // projected read-only alongside internally created threads. Internal ids
  // win on collision so a resumed native history keeps its materialized copy.
  // A web-created thread also runs its turns through a real native session
  // (persisted as sessionId): exclude those linked natives as well, or one
  // conversation renders as two history cards (snapshot UUID + native ses_*).
  for (const r of uniqueRecords) {
    if (r.sessionId) seenIds.add(r.sessionId);
  }
  let nativeThreads: JsonValue[] = [];
  try {
    nativeThreads = (backend === "opencode" ? listNativeOpencodeThreads(200) : []).filter((entry) => {
      const id = stringValue(asRecord(entry).id);
      const parentThreadId = stringValue(asRecord(entry).parentThreadId);
      return typeof id === "string" && !seenIds.has(id) && !parentThreadId;
    }) as unknown as JsonValue[];
  } catch (error) {
    console.warn("[opencode] native history listing unavailable", error instanceof Error ? error.message : error);
  }
  return {
    data: [...opencodeThreads, ...nativeThreads].sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0))
  } as JsonValue;
}

/**
 * History-scope listings for backends without a dedicated SQLite snapshot
 * store. Each delegates to its bridge's live `thread/list` (cline: hub
 * daemon sessions; command-code: persisted transcript mappings; auggie:
 * in-process sessions) and normalizes to the `{ data }` history shape.
 * Failures yield an empty listing rather than failing the whole sidebar.
 */
async function clineThreadListResult(): Promise<JsonValue> {
  try {
    const result = asRecord(await clineBridgeFor(null).request("thread/list", {}));
    const threads = Array.isArray(result.threads) ? result.threads : Array.isArray(result.data) ? result.data : [];
    return { data: threads } as JsonValue;
  } catch (error) {
    console.warn("[cline] history listing unavailable", error instanceof Error ? error.message : error);
    return { data: [] } as JsonValue;
  }
}

async function commandCodeThreadListResult(): Promise<JsonValue> {
  try {
    const result = asRecord(await commandCodeBridgeFor(null).request("thread/list", {}));
    const threads = Array.isArray(result.threads) ? result.threads : Array.isArray(result.data) ? result.data : [];
    return { data: threads } as JsonValue;
  } catch (error) {
    console.warn("[command-code] history listing unavailable", error instanceof Error ? error.message : error);
    return { data: [] } as JsonValue;
  }
}

async function auggieThreadListResult(): Promise<JsonValue> {
  try {
    const result = asRecord(await auggieBridgeFor(null).request("thread/list", {}));
    const threads = Array.isArray(result.threads) ? result.threads : Array.isArray(result.data) ? result.data : [];
    return { data: threads } as JsonValue;
  } catch (error) {
    console.warn("[auggie] history listing unavailable", error instanceof Error ? error.message : error);
    return { data: [] } as JsonValue;
  }
}

function grokThreadListResult(ownerId: string): JsonValue {  const grokThreads = grokSessionStore.listByOwner(ownerId)
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Grok conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "grok",
        source: "appServer",
        turns: []
      };
    })
    .sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0));
  return { data: grokThreads } as JsonValue;
}

function museThreadListResult(ownerId: string): JsonValue {
  const records = ownerId !== "local"
    ? [...museSessionStore.listByOwner(ownerId), ...museSessionStore.listByOwner("local")]
    : museSessionStore.listByOwner(ownerId);
  const seenIds = new Set<string>();
  const uniqueRecords = records.filter((r) => {
    if (seenIds.has(r.threadId)) return false;
    seenIds.add(r.threadId);
    return true;
  });
  const museThreads = uniqueRecords
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Muse conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "muse",
        source: "appServer",
        turns: []
      };
    })
    .sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0));
  for (const r of uniqueRecords) {
    if (r.sessionId) seenIds.add(r.sessionId);
  }
  let nativeThreads: JsonValue[] = [];
  try {
    nativeThreads = listNativeMuseThreads(200).filter((entry) => {
      const id = stringValue(asRecord(entry).id);
      const parentThreadId = stringValue(asRecord(entry).parentThreadId);
      return typeof id === 'string' && !seenIds.has(id) && !parentThreadId;
    }) as unknown as JsonValue[];
  } catch (error) {
    console.warn('[muse] native history listing unavailable', error instanceof Error ? error.message : error);
  }
  return {
    data: [...museThreads, ...nativeThreads].sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0))
  } as JsonValue;
}

/** Best-effort backfill of `cliBackend: "mini"` for legacy history files that
 * predate runtime-metadata persistence (or were mislabeled `codex`). Values
 * come from the history snapshot itself; existing metadata is preserved and
 * only the backend classification is corrected. Never throws. */
function healMiniRuntimeBackend(ownerId: string, threadId: string): void {
  const record = miniHistory.get(ownerId, threadId)
    ?? (ownerId !== "local" ? miniHistory.get("local", threadId) : null);
  if (!record?.stateJson) return;
  let snapshot: Record<string, unknown>;
  try {
    snapshot = asRecord(JSON.parse(record.stateJson) as JsonValue);
  } catch {
    return;
  }
  const existing = threadRuntimeMetadataStore.get(ownerId, threadId);
  if (existing?.cliBackend === "mini") return;
  const nullableString = (value: unknown, fallback: string | null): string | null =>
    typeof value === "string" && value ? value : fallback;
  const definedString = (value: unknown, fallback: string): string =>
    typeof value === "string" && value ? value : fallback;
  threadRuntimeMetadataStore.put(ownerId, {
    threadId,
    permission: existing?.permission ?? "dangerBypass",
    providerId: nullableString(snapshot.providerId, existing?.providerId ?? null),
    groupId: nullableString(snapshot.groupId, existing?.groupId ?? "default"),
    model: definedString(snapshot.model, existing?.model ?? "gpt-5-mini"),
    reasoningEffort: existing?.reasoningEffort ?? "medium",
    cliBackend: "mini",
    cwd: definedString(snapshot.cwd, existing?.cwd ?? process.cwd()),
  });
}

function miniThreadListResult(ownerId: string): JsonValue {
  const threads = miniHistory.listForOwner(ownerId)
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.threadId,
        // Sub-agent child threads stay attached to their parent so the catalog
        // renders them under the delegating conversation instead of as
        // standalone phantom conversations.
        parentThreadId: stringValue(snapshot.parentThreadId) ?? null,
        agentRole: stringValue(snapshot.agentType) ?? null,
        agentNickname: stringValue(snapshot.taskName) ?? null,
        preview: miniHistoryDisplayTitle(snapshot, stringValue(firstUserMessage?.text)),
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "mini",
        source: "appServer",
        turns: []
      };
    })
    .filter((entry) => !entry.parentThreadId)
    .sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0));
  return { data: threads } as JsonValue;
}

function agyThreadListResult(ownerId: string): JsonValue {
  const agyThreads = agySessionStore.listByOwner(ownerId)
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.conversationId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Antigravity conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "agy",
        source: "appServer",
        turns: []
      };
    })
    .sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0));
  return { data: agyThreads } as JsonValue;
}

/**
 * Build the Claude-only history listing for the sidebar's Claude tab without
 * touching the Codex rollout store. Mirrors the entry shape that
 * mergeSshWorkspaceThreads produces for Claude sessions so the web catalog can
 * consume both interchangeably.
 */
function claudeThreadListResult(ownerId: string): JsonValue {
  const storedById = new Map(sshWorkspaceStore.list().map((entry) => [entry.threadId, entry]));
  const claudeThreads = claudeSessionStore.listByOwner(ownerId)
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const conversation = Array.isArray(snapshot.conversation) ? snapshot.conversation : [];
      const firstUserMessage = conversation
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.role) === "user");
      const parentThreadId = stringValue(snapshot.parentThreadId);
      const sshProfile = storedById.get(entry.threadId)?.profile;
      return {
        id: entry.threadId,
        sessionId: entry.externalSessionId ?? entry.threadId,
        parentThreadId: parentThreadId ?? null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Claude conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: sshProfile?.cwd ?? entry.cwd,
        ...(sshProfile ? { workspaceMode: "ssh", sshCommand: sshProfile.command, sshCwd: sshProfile.cwd } : {}),
        cliBackend: "claude",
        source: "appServer",
        turns: []
      };
    })
    .filter((entry) => !entry.parentThreadId)
    .sort((left, right) =>
      (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
      - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0));
  return { data: claudeThreads } as JsonValue;
}

function mergeSshWorkspaceThreads(result: JsonValue, ownerId = "local", backendScope?: CliBackend): JsonValue {
  const record = asRecord(result);
  const localThreads = Array.isArray(record.data) ? record.data : Array.isArray(record.threads) ? record.threads : [];
  const known = new Set(localThreads.map((entry) => stringValue(asRecord(entry).id)).filter(Boolean));
  const claudeSessions = claudeSessionStore.listByOwner(ownerId);
  // A Claude SSH thread is stored in both the Claude session store and the SSH
  // workspace store. Render it once, from the Claude side, with SSH metadata.
  const claudeThreadIds = new Set(claudeSessions.map((entry) => entry.threadId));
  const stored = sshWorkspaceStore.list();
  const autonomous = remoteThreadRouteStore.list();
  const autonomousById = new Map(autonomous.map((entry) => [entry.threadId, entry]));
  const storedById = new Map(stored.map((entry) => [entry.threadId, entry]));
  const annotatedLocalThreads = localThreads.map((entry) => {
    const record = asRecord(entry);
    const id = stringValue(record.id) ?? "";
    const profile = storedById.get(id)?.profile;
    const route = autonomousById.get(id);
    const annotated = route
      ? { ...record, cwd: route.cwd, workspaceMode: "ssh", sshCommand: route.command, sshCwd: route.cwd, remoteExecutionMode: "autonomous", remoteLifecycleMode: route.lifecycleMode, cliBackend: route.cliBackend }
      : profile ? { ...record, cwd: profile.cwd, workspaceMode: "ssh", sshCommand: profile.command, sshCwd: profile.cwd } : entry;
    if (!id) return annotated;
    // Daemon-native threads are Codex threads, but the app-server has no
    // cliBackend field. Stamp it so a history opened on another device (no
    // local selection, no persisted metadata row) shows the Codex icon
    // instead of falling back to mini. Never overwrite an explicit backend.
    const annotatedRecord = asRecord(annotated);
    if (stringValue(annotatedRecord.cliBackend ?? annotatedRecord.cli_backend)) return annotated;
    return { ...annotatedRecord, cliBackend: "codex" };
  });
  const remoteThreads = stored
    .filter((entry) => !entry.parentThreadId && !known.has(entry.threadId) && !claudeThreadIds.has(entry.threadId))
    .map((entry) => ({
      id: entry.threadId,
      sessionId: entry.threadId,
      parentThreadId: null,
      preview: "SSH workspace · " + entry.profile.cwd,
      modelProvider: entry.profile.providerId ?? null,
      createdAt: Math.floor(entry.createdAt / 1000),
      updatedAt: Math.floor(entry.updatedAt / 1000),
      recencyAt: Math.floor(entry.updatedAt / 1000),
      status: { type: "notLoaded" },
      cwd: entry.profile.cwd,
      workspaceMode: "ssh",
      sshCommand: entry.profile.command,
      sshCwd: entry.profile.cwd,
      source: "appServer",
      turns: []
    }));
  const autonomousThreads = autonomous
    .filter((entry) => !known.has(entry.threadId) && !storedById.has(entry.threadId))
    .map((entry) => ({
      id: entry.threadId, sessionId: entry.threadId, parentThreadId: null,
      preview: "SSH background · " + entry.cwd, createdAt: Math.floor(entry.createdAt / 1000),
      updatedAt: Math.floor(entry.updatedAt / 1000), recencyAt: Math.floor(entry.updatedAt / 1000),
      status: { type: "notLoaded" }, cwd: entry.cwd, workspaceMode: "ssh", sshCommand: entry.command,
      sshCwd: entry.cwd, remoteExecutionMode: "autonomous", remoteLifecycleMode: entry.lifecycleMode, cliBackend: entry.cliBackend, source: "appServer", turns: []
    }));
  const claudeThreads = backendScope && backendScope !== "claude"
    ? []
    : claudeSessions
    .filter((entry) => !known.has(entry.threadId))
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const conversation = Array.isArray(snapshot.conversation) ? snapshot.conversation : [];
      const firstUserMessage = conversation
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.role) === "user");
      const parentThreadId = stringValue(snapshot.parentThreadId);
      const sshProfile = storedById.get(entry.threadId)?.profile;
      return {
        id: entry.threadId,
        sessionId: entry.externalSessionId ?? entry.threadId,
        parentThreadId: parentThreadId ?? null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Claude conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: sshProfile?.cwd ?? entry.cwd,
        ...(sshProfile ? { workspaceMode: "ssh", sshCommand: sshProfile.command, sshCwd: sshProfile.cwd } : {}),
        cliBackend: "claude",
        source: "appServer",
        turns: []
      };
    })
    .filter((entry) => !entry.parentThreadId);
  const agySessions = agySessionStore.listByOwner(ownerId);
  const agyThreads = backendScope && backendScope !== "agy"
    ? []
    : agySessions
    .filter((entry) => !known.has(entry.threadId))
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.conversationId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Antigravity conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "agy",
        source: "appServer",
        turns: []
      };
    });
  const grokSessions = grokSessionStore.listByOwner(ownerId);
  const grokThreads = backendScope && backendScope !== "grok"
    ? []
    : grokSessions
    .filter((entry) => !known.has(entry.threadId))
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Grok conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "grok",
        source: "appServer",
        turns: []
      };
    });
  const museSessions = museSessionStore.listByOwner(ownerId);
  const museThreads = backendScope && backendScope !== "muse"
    ? []
    : museSessions
    .filter((entry) => !known.has(entry.threadId))
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Muse conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "muse",
        source: "appServer",
        turns: []
      };
    });
  const piSessions = piSessionStore.listByOwner(ownerId);
  const piThreads = backendScope && backendScope !== "pi"
    ? []
    : piSessions
    .filter((entry) => !known.has(entry.threadId))
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: null,
        preview: stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "Pi conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "pi",
        source: "appServer",
        turns: []
      };
    });
  const opencodeSessions = opencodeSessionStore.listForOwner(ownerId);
  let nativeOpencodeThreads: JsonValue[] = [];
  if (!backendScope || backendScope === "opencode") {
    try {
      const internalIds = new Set(opencodeSessions.map((entry) => entry.threadId));
      // See above: linked native sessions (sessionId of an internal thread)
      // must also be excluded, otherwise a renamed conversation shows up
      // twice (internal UUID row + native ses_* row with the same title).
      for (const entry of opencodeSessions) {
        if (entry.sessionId) internalIds.add(entry.sessionId);
      }
      nativeOpencodeThreads = listNativeOpencodeThreads(200).filter((entry) => {
        const id = stringValue(asRecord(entry).id);
        const parentThreadId = stringValue(asRecord(entry).parentThreadId);
        return typeof id === "string" && !known.has(id) && !internalIds.has(id) && !parentThreadId;
      }) as unknown as JsonValue[];
    } catch (error) {
      console.warn("[opencode] native history merge unavailable", error instanceof Error ? error.message : error);
    }
  }
  const opencodeThreads = backendScope && backendScope !== "opencode" && backendScope !== "opencode-v2"
    ? []
    : opencodeSessions
    .filter((entry) => !known.has(entry.threadId))
    .filter((entry) => !backendScope || opencodeSessionBackend(entry.threadId) === backendScope)
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      const name = stringValue(snapshot.name);
      return {
        id: entry.threadId,
        sessionId: entry.sessionId ?? entry.threadId,
        parentThreadId: stringValue(snapshot.parentThreadId) ?? null,
        agentRole: stringValue(snapshot.agentType) ?? null,
        agentNickname: stringValue(snapshot.taskName) ?? null,
        name: name ?? null,
        title: name ?? null,
        preview: name ?? stringValue(snapshot.preview) ?? stringValue(firstUserMessage?.text) ?? "OpenCode conversation",
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        additionalRoots: Array.isArray(snapshot.additionalRoots) ? snapshot.additionalRoots : [],
        cliBackend: opencodeSessionBackend(entry.threadId),
        source: "appServer",
        turns: []
      };
    })
    .filter((entry) => !entry.parentThreadId);
  const miniSessions = miniHistory.listForOwner(ownerId);
  const miniThreads = backendScope && backendScope !== "mini"
    ? []
    : miniSessions
    .filter((entry) => !known.has(entry.threadId))
    .map((entry) => {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = entry.stateJson ? asRecord(JSON.parse(entry.stateJson) as JsonValue) : {};
      } catch {}
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const firstUserMessage = messages
        .map((item) => asRecord(item))
        .find((item) => stringValue(item.type) === "userMessage" || stringValue(item.role) === "user");
      return {
        id: entry.threadId,
        sessionId: entry.threadId,
        parentThreadId: stringValue(snapshot.parentThreadId) ?? null,
        agentRole: stringValue(snapshot.agentType) ?? null,
        agentNickname: stringValue(snapshot.taskName) ?? null,
        preview: miniHistoryDisplayTitle(snapshot, stringValue(firstUserMessage?.text)),
        model: entry.model,
        createdAt: Math.floor(entry.createdAt / 1000),
        updatedAt: Math.floor(entry.updatedAt / 1000),
        recencyAt: Math.floor(entry.updatedAt / 1000),
        status: { type: "notLoaded" },
        cwd: entry.cwd,
        cliBackend: "mini",
        source: "appServer",
        turns: []
      };
    })
    .filter((entry) => !entry.parentThreadId);
  const merged = [...claudeThreads, ...agyThreads, ...grokThreads, ...museThreads, ...piThreads, ...opencodeThreads, ...nativeOpencodeThreads, ...miniThreads, ...autonomousThreads, ...remoteThreads, ...annotatedLocalThreads].sort((left, right) =>
    (Number(asRecord(right).recencyAt) || Number(asRecord(right).updatedAt) || 0)
    - (Number(asRecord(left).recencyAt) || Number(asRecord(left).updatedAt) || 0)
  );
  return { ...record, ...(Array.isArray(record.data) ? { data: merged } : { threads: merged }) };
}

function annotateSshThreadResult(result: JsonValue): JsonValue {
  const record = asRecord(result);
  const thread = asRecord(record.thread);
  const threadId = stringValue(thread.id) ?? stringValue(record.id);
  if (!threadId) return result;
  const route = remoteThreadRouteStore.get(threadId);
  const profile = sshWorkspaceStore.get(threadId);
  if (!profile && !route) return result;
  const nextThread = route
    ? { ...thread, cwd: route.cwd, workspaceMode: "ssh", sshCommand: route.command, sshCwd: route.cwd, remoteExecutionMode: "autonomous", remoteLifecycleMode: route.lifecycleMode, cliBackend: route.cliBackend }
    : { ...thread, cwd: profile!.cwd, workspaceMode: "ssh", sshCommand: profile!.command, sshCwd: profile!.cwd };
  return record.thread ? { ...record, thread: nextThread } as JsonValue : { ...record, ...nextThread, id: threadId } as JsonValue;
}

async function withWorkbenchRuntime<T>(runtime: {
  providerId: string | null;
  groupId: string | null;
  model: string;
  cliBackend?: CliBackend;
}, user: AuthUser | null, task: (activation: ProviderActivation) => Promise<T>): Promise<T> {
  if (runtime.cliBackend === "agy") {
    return await task({
      providerId: runtime.providerId ?? AGY_OFFICIAL_PROVIDER_ID,
      modelProvider: AGY_OFFICIAL_PROVIDER_ID,
      model: runtime.model || "default",
      groupId: runtime.groupId ?? "default",
      groupName: "Antigravity",
      groupKind: "text",
      responseProtocol: "gemini",
      restartedAt: Date.now()
    });
  }
  if (runtime.cliBackend === "grok") {
    return await task({
      providerId: runtime.providerId ?? GROK_OFFICIAL_PROVIDER_ID,
      modelProvider: GROK_OFFICIAL_PROVIDER_ID,
      model: runtime.model || "grok-4.6",
      groupId: runtime.groupId ?? "default",
      groupName: "Grok",
      groupKind: "text",
      responseProtocol: "openai-response",
      restartedAt: Date.now()
    });
  }
  if (runtime.cliBackend === "muse") {
    return await task({
      providerId: runtime.providerId ?? MUSE_OFFICIAL_PROVIDER_ID,
      modelProvider: MUSE_OFFICIAL_PROVIDER_ID,
      model: runtime.model || "muse-spark-1.3",
      groupId: runtime.groupId ?? "default",
      groupName: "Muse",
      groupKind: "text",
      responseProtocol: "openai",
      restartedAt: Date.now()
    });
  }
  if (runtime.cliBackend === "mini") {
    if (!runtime.providerId) throw new Error("providerId is required");
    return await task({
      providerId: runtime.providerId,
      modelProvider: runtime.providerId,
      model: runtime.model || "default",
      groupId: runtime.groupId ?? "default",
      groupName: "Mini",
      groupKind: "text",
      responseProtocol: "openai",
      restartedAt: Date.now()
    });
  }
  if (runtime.cliBackend === "pi") {
    return await task({
      providerId: runtime.providerId ?? PI_OFFICIAL_PROVIDER_ID,
      modelProvider: PI_OFFICIAL_PROVIDER_ID,
      model: runtime.model || "pi-relay/default",
      groupId: runtime.groupId ?? "default",
      groupName: "Pi",
      groupKind: "text",
      responseProtocol: "openai",
      restartedAt: Date.now()
    });
  }
  if (!runtime.providerId) throw new Error("providerId is required");
  if (user && user.role !== "admin" && !securityStore.isProviderAllowed(user.id, runtime.providerId, false)) {
    throw new Error("Relay not assigned to this member");
  }
  if (runtime.cliBackend === "claude") {
    const provider = await providerStore.get(runtime.providerId);
    if (!provider) throw new Error(`Provider not found: ${runtime.providerId}`);
    const group = runtime.groupId
      ? provider.groups?.find((entry) => entry.id === runtime.groupId || entry.name === runtime.groupId)
      : provider.groups?.find((entry) => entry.kind !== "image") ?? provider.groups?.[0];
    if (!group) throw new Error(`Group not found for ${provider.name}: ${runtime.groupId ?? "default"}`);
    const selectedModel = resolveProviderModel(group, runtime.model || group.models?.[0] || provider.defaultModel || provider.nativeModels[0]);
    if (!selectedModel) throw new Error(`Model is required for Claude backend in ${group.name}`);
    const catalogModel = provider.capabilityCatalog?.data.find((entry) => entry.model_name === selectedModel || entry.model_name === stripModelContextVariant(selectedModel).baseModel);
    const protocol = resolveModelProtocol(group, catalogModel);
    if (!modelSupportsProtocol(catalogModel, protocol)) throw new Error(`Model ${selectedModel} does not support ${protocol} in group ${group.name}`);
    assertProviderQuotaAvailable(provider, group);
    const keys = await resolveGroupApiKeys(provider, group);
    if (keys.length === 0 && group.authType !== "none" && group.id !== "freebuff") throw new Error(`Group ${group.name} and provider ${provider.name} have no API key`);
    return await task({ providerId: provider.id, modelProvider: provider.id, model: selectedModel, groupId: group.id, groupName: group.name, groupKind: group.kind, responseProtocol: protocol, restartedAt: Date.now() });
  }
  return await runProviderActivationExclusive(async () => {
    const activation = await activateProvider(runtime.providerId!, runtime.model, runtime.groupId ?? undefined);
    return await task(activation);
  });
}

function notifyWorkbenchControl(user: AuthUser | null, payload: Record<string, JsonValue>): void {
  for (const client of clients) {
    if (!authStore || (user && client.data.user?.id === user.id)) {
      send(client, { type: "workbench.control", payload: { method: WORKBENCH_CONTROL_NOTIFICATION, ...payload } });
    }
  }
}

function assertWorkbenchThreadAccess(threadId: string, user: AuthUser | null): void {
  if (!threadId) throw new Error("threadId is required");
  if (authStore && user && user.role !== "admin" && !authStore.ownsThread(threadId, user.id)) {
    throw new Error("Thread belongs to another member");
  }
}

function applyWorkbenchCwd(body: Record<string, unknown>, user: AuthUser | null): void {
  if (stringValue(body.cwd)?.trim()) return;
  const workspace = asRecord(userPreferencesStore.get(user?.id ?? "local").workspace);
  const cwd = stringValue(workspace.mode) === "ssh" ? stringValue(workspace.sshCwd) : stringValue(workspace.cwd);
  if (cwd?.trim()) body.cwd = cwd.trim();
}

function workbenchLayoutThreadIds(layout: JsonValue | null): string[] {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return [];
  const panes = Array.isArray(layout.panes) ? layout.panes : [];
  return panes.flatMap((entry) => {
    const threadId = stringValue(asRecord(entry).threadId);
    return threadId ? [threadId] : [];
  });
}

async function readWorkbenchTurns(user: AuthUser | null, clientId: string, threadId: string): Promise<JsonValue> {
  const delays = [0, 50, 100, 200];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    try {
      return await executeCodexRpc({ user, clientId, method: "thread/turns/list", params: { threadId, limit: 100 } });
    } catch (error) {
      if (isUnmaterializedThreadError(error)) return { turns: [] };
      if (!isTransientThreadMetadataError(error) || attempt === delays.length - 1) throw error;
    }
  }
  return { turns: [] };
}

async function readWorkbenchTurnsPage(
  user: AuthUser | null,
  clientId: string,
  threadId: string,
  cursor: string | null,
  metadata?: JsonValue
): Promise<JsonValue> {
  const legacyPage = cursor === null ? await readLegacyWorkbenchTurnsPage(metadata) : null;
  if (legacyPage) return legacyPage;
  const delays = [0, 50, 100, 200];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    try {
      return await executeCodexRpc({
        user,
        clientId,
        method: "thread/turns/list",
        params: { threadId, cursor, limit: 32, sortDirection: "desc", itemsView: "summary" }
      });
    } catch (error) {
      if (isUnmaterializedThreadError(error)) return { data: [], nextCursor: null };
      if (!isTransientThreadMetadataError(error) || attempt === delays.length - 1) throw error;
    }
  }
  return { data: [], nextCursor: null };
}

async function readLegacyWorkbenchTurnsPage(metadata?: JsonValue): Promise<JsonValue | null> {
  const thread = asRecord(asRecord(metadata).thread);
  if (stringValue(thread.historyMode) !== "legacy") return null;
  const cliBackend = stringValue(thread.cliBackend ?? thread.cli_backend);
  const workspaceMode = stringValue(thread.workspaceMode ?? thread.workspace_mode);
  const remoteExecutionMode = stringValue(thread.remoteExecutionMode ?? thread.remote_execution_mode);
  if (cliBackend === "claude" || workspaceMode === "ssh" || remoteExecutionMode === "autonomous") return null;
  const rawPath = stringValue(thread.path);
  if (!rawPath) return null;
  const historyPath = resolve(expandLocalHomePath(rawPath));
  if (!existsSync(historyPath)) return null;
  try {
    const tail = await readThreadHistoryTail(historyPath, thread, DEFAULT_HISTORY_TAIL_BYTES);
    return {
      data: summarizeWorkbenchTurns(tail.thread.turns),
      nextCursor: null,
      backwardsCursor: null,
      source: "legacy-tail",
      tail: tail.tail
    } as JsonValue;
  } catch {
    // Some imported legacy files are not JSONL. Fall back to the app-server
    // reader so opening an old conversation remains best-effort compatible.
    return null;
  }
}

function summarizeWorkbenchTurns(turns: unknown[]): JsonValue[] {
  return turns.map((value) => {
    const turn = asRecord(value);
    const items = Array.isArray(turn.items) ? turn.items : [];
    const user = items.find((item) => stringValue(asRecord(item).type) === "userMessage");
    const assistant = [...items].reverse().find((item) => stringValue(asRecord(item).type) === "agentMessage");
    const summaryItems = user && assistant && user !== assistant ? [user, assistant] : user ? [user] : assistant ? [assistant] : [];
    return { ...turn, items: summaryItems as JsonValue[], itemsView: "summary" } as JsonValue;
  });
}

async function readWorkbenchThreadMetadata(user: AuthUser | null, clientId: string, threadId: string): Promise<JsonValue> {
  const delays = [0, 50, 100, 200];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    try {
      return await executeCodexRpc({ user, clientId, method: "thread/read", params: { threadId, includeTurns: false } });
    } catch (error) {
      if (!isTransientThreadMetadataError(error) || attempt === delays.length - 1) throw error;
    }
  }
  throw new Error(`Failed to read thread metadata: ${threadId}`);
}

function resolveProviderModel(group: ChannelGroupConfig | undefined, selectedModel?: string): string | undefined {
  if (!selectedModel) {
    return undefined;
  }
  let model = selectedModel;
  const variant = stripModelContextVariant(selectedModel);
  const suffix = variant.contextWindow ? selectedModel.slice(variant.baseModel.length) : "";
  const seen = new Set<string>();
  for (let index = 0; index < 8; index += 1) {
    if (seen.has(model)) {
      return model;
    }
    seen.add(model);
    const baseMapped = suffix && model === selectedModel
      ? group?.modelMapping?.find((entry) => entry.from === variant.baseModel)?.to
      : undefined;
    const next = group?.modelMapping?.find((entry) => entry.from === model)?.to
      ?? (baseMapped ? `${baseMapped}${suffix}` : undefined);
    if (!next || next === model) {
      return model;
    }
    model = next;
  }
  return model;
}

function providerToCodexConfig(provider: ProviderConfig, group?: ChannelGroupConfig): JsonValue {
  const config: Record<string, JsonValue> = {
    name: provider.name,
    wire_api: "responses",
    supports_websockets: false,
    stream_max_retries: Math.min(100, Math.max(5, Math.round(provider.streamMaxRetries ?? 5)))
  };
  if (group) {
    config.base_url = `http://127.0.0.1:${PORT}/api/relay-gateway/${encodeURIComponent(provider.id)}/${encodeURIComponent(group.id)}/v1`;
    config.env_key = RELAY_GATEWAY_ENV_KEY;
    if (relayGatewayToken) {
      config.experimental_bearer_token = relayGatewayToken;
    }
    return config;
  }
  if (provider.baseUrl) {
    config.base_url = provider.baseUrl;
  }
  if (provider.apiKeyRef?.startsWith("env:")) {
    config.env_key = provider.apiKeyRef.slice("env:".length);
  }
  return config;
}

async function resolveGroupApiKeys(
  provider: ProviderConfig,
  group: ChannelGroupConfig
): Promise<string[]> {
  const groupKeys = [...new Set(group.keys.map((key) => key.trim()).filter(Boolean))];
  if (group.credentialMode !== "provider" && groupKeys.length > 0) return groupKeys;
  if (group.id === "cline-free" || group.baseUrl?.includes("api.cline.bot")) {
    const localClineToken = await resolveLocalClineToken();
    if (localClineToken) return [localClineToken];
  }
  if (group.id === "freebuff" || group.baseUrl?.includes("codebuff.com")) {
    const localFreebuffCreds = await resolveLocalFreebuffCredentials();
    if (localFreebuffCreds?.token) return [localFreebuffCreds.token];
  }
  const providerKey = await resolveProviderApiKey(provider.id, "");
  return providerKey ? [providerKey] : groupKeys;
}

function assertProviderQuotaAvailable(provider: ProviderConfig, group: ChannelGroupConfig | undefined): void {
  if (quotaExceeded(provider.usedQuotaUsd, provider.quotaUsd)) {
    throw new Error(`Relay quota exhausted: ${provider.name}`);
  }
  if (group && quotaExceeded(group.usedQuotaUsd, group.quotaUsd)) {
    throw new Error(`Relay group quota exhausted: ${provider.name} / ${group.name}`);
  }
}

function quotaExceeded(used: number | undefined, quota: number | null | undefined): boolean {
  return typeof quota === "number" && Number.isFinite(quota) && quota >= 0 && typeof used === "number" && Number.isFinite(used) && used >= quota;
}

function send(ws: RuntimeSocket<SocketData>, message: ServerToClientMessage): void {
  try {
    const socketWithBuffer = ws as RuntimeSocket<SocketData> & {
      bufferedAmount?: number;
      getBufferedAmount?: () => number;
    };
    const bufferedAmount =
      typeof socketWithBuffer.getBufferedAmount === "function"
        ? socketWithBuffer.getBufferedAmount()
        : socketWithBuffer.bufferedAmount ?? 0;
    if (bufferedAmount > websocketRuntime.maxBackpressureBytes) {
      ws.data.serverCloseReason = "Backpressure limit exceeded; resync required";
      removeClient(ws);
      ws.close(4001, "Backpressure limit exceeded; resync required");
      return;
    }
    ws.send(JSON.stringify(message));
  } catch {
    removeClient(ws);
  }
}

function runtimeHealth() {
  const engine = bridge.getStatus();
  return {
    ok: true,
    deployment: websocketRuntime.deployment,
    platform: websocketRuntime.platform,
    host: HOST,
    port: PORT,
    node: remoteBunNodeRuntime(),
    websocket: {
      ...publicWebSocketRuntime,
      activeClients: clients.size,
      maxMessageBytes: websocketRuntime.maxMessageBytes,
      maxBackpressureBytes: websocketRuntime.maxBackpressureBytes,
      originValidation: true,
      trustProxy: websocketRuntime.trustProxy
    },
    engine: {
      phase: engine.phase,
      transport: engine.transport,
      realtimeSync: engine.realtimeSync
    }
  };
}

function webSocketStats() {
  const now = Date.now();
  return {
    ...runtimeHealth().websocket,
    clients: [...clients].map((client) => ({
      userId: client.data.user?.id ?? null,
      email: client.data.user?.email ?? null,
      remoteAddress: client.remoteAddress,
      connectedAt: client.data.connectedAt,
      connectedForMs: Math.max(0, now - client.data.connectedAt),
      lastHeartbeatAt: client.data.lastHeartbeatAt,
      heartbeatAgeMs: Math.max(0, now - client.data.lastHeartbeatAt),
      lastHeartbeatRttMs: client.data.lastHeartbeatRttMs,
      lastMessageAt: client.data.lastMessageAt
    })),
    recentDisconnects: websocketDisconnects
  };
}

function recordWebSocketDisconnect(
  ws: RuntimeSocket<SocketData>,
  code: number,
  reason: string,
): void {
  websocketDisconnects.unshift({
    at: Date.now(),
    code,
    reason: reason || "Connection closed",
    source: ws.data.serverCloseReason ? "server" : "client/network",
    ...(ws.data.user?.id ? { userId: ws.data.user.id } : {})
  });
  websocketDisconnects.splice(20);
}

function broadcast(message: ServerToClientMessage): void {
  for (const client of clients) {
    send(client, message);
  }
}

function logCodexConfigHealth(result: CodexConfigHealthResult, phase: string): void {
  if (!result.exists) {
    console.info(`[codex-config] ${phase}: ${result.path} not found; skipping config.toml health check`);
    return;
  }
  if (result.changed) {
    console.warn(
      `[codex-config] ${phase}: repaired duplicate config.toml entries at ${result.path}; backup: ${result.backupPath}`
    );
    if (result.removedDuplicateSections.length > 0) {
      console.warn(`[codex-config] removed duplicate tables: ${result.removedDuplicateSections.join(", ")}`);
    }
    if (result.removedDuplicateKeys.length > 0) {
      console.warn(`[codex-config] removed duplicate keys: ${result.removedDuplicateKeys.join(", ")}`);
    }
  }
  if (result.unresolvedDuplicates.length > 0) {
    console.warn(
      `[codex-config] ${phase}: found duplicate config.toml entries that were not auto-fixed: ${result.unresolvedDuplicates.join("; ")}`
    );
  }
}

function removeClient(ws: RuntimeSocket<SocketData>): void {
  if (!clients.delete(ws)) {
    return;
  }
  subscriptionRegistry.unwatchAllForClient(ws.data.clientId);
  if (ws.data.user?.id) {
    const userId = ws.data.user.id;
    const hasOtherSocket = [...clients].some((client) => client.data.user?.id === userId);
    if (!hasOtherSocket && !codexApiSessions.hasOwner(userId)) {
      releaseAllTurnsForUser(userId);
    }
  }
}

let contextWindowLogLock: Promise<void> = Promise.resolve();
function contextWindowLogPath(): string {
  return join(localDatabase.dir, "log.txt");
}

async function repairAgentModelCatalog(
  codexHome: string,
  configRead: JsonValue | undefined,
  override: { providerId?: string | null; groupId?: string | null; model?: string | null } = {},
  options?: CodexModelCatalogOptions
): Promise<void> {
  const config = asRecord(configRead ? asRecord(configRead).config : undefined);
  let model = override.model?.trim() || stringValue(config.model)?.trim();
  let modelProvider = override.providerId?.trim() || stringValue(config.model_provider)?.trim();
  if (!model || !modelProvider) {
    const activeProviders = (await providerStore.list()).filter((p) => isProviderFeatureEnabled(p.id));
    const firstProvider = activeProviders.find((p) => (p.groups ?? []).length > 0) ?? activeProviders[0];
    if (firstProvider) {
      modelProvider = firstProvider.kind === "chatgpt" ? "openai" : firstProvider.id;
      const firstGroup = (firstProvider.groups ?? []).find((g) => g.kind !== "image") ?? firstProvider.groups?.[0];
      model = firstGroup?.models?.[0] || firstProvider.defaultModel || firstProvider.nativeModels?.[0];
    }
  }
  if (!model || !modelProvider) return;
  if (modelProvider === OMNIROUTE_FREE_PROVIDER_ID) {
    const freeProvider = await providerStore.get(OMNIROUTE_FREE_PROVIDER_ID);
    const targetGroup = freeProvider?.groups?.find((g) => g.id === override.groupId)
      ?? freeProvider?.groups?.find((g) => g.models?.includes(model))
      ?? (override.groupId === "freebuff" ? buildFreebuffGroup([model]) : (override.groupId === "cline-free" ? buildClineFreeGroup([model]) : (override.groupId === "kilocode" ? buildKiloCodeGroup([model]) : (override.groupId === "opencode" ? buildOpenCodeGroup([model]) : buildOmniRouteFreeGroup([model])))));
    writeCodexModelCatalog(codexHome, targetGroup, model, options);
    return;
  }
  const providers = await providerStore.list();
  const provider = providers.find((entry) => entry.id === modelProvider)
    ?? (modelProvider === "openai" ? providers.find((entry) => entry.kind === "chatgpt") : undefined);
  if (!provider) return;
  const baseModel = stripModelContextVariant(model).baseModel;
  const groups = (provider.groups ?? []).filter((entry) => entry.kind !== "image");
  const requestedGroup = override.groupId?.trim() ? groups.find((entry) => entry.id === override.groupId || entry.name === override.groupId) : undefined;
  const matchingGroup = requestedGroup ?? groups.find((entry) => (entry.models ?? []).some((candidate) => candidate === model || candidate === baseModel));
  const source = matchingGroup ?? groups[0];
  if (!source) return;
  if (matchingGroup) {
    writeCodexModelCatalog(codexHome, source, model, options);
    return;
  }
  const models = [...new Set(groups.flatMap((entry) => entry.models ?? []).map((entry) => entry.trim()).filter(Boolean))];
  if (models.length === 0) return;
  // Do not reintroduce a removed current model into the catalog. Writing the
  // first still-synced model keeps the catalog valid while readiness reports
  // AGENTS_MODEL_NOT_SYNCED for the configured model.
  writeCodexModelCatalog(codexHome, { ...source, models }, models[0]!, options);
}

function collectLocalCodexHomes(): string[] {
  const homes = new Set<string>();
  try {
    const virtualHome = dirname(resolveVirtualCodexConfigPath());
    if (virtualHome) homes.add(virtualHome);
  } catch {}
  try {
    const runtimeHome = bridge.getStatus().codexHome;
    if (runtimeHome && (process.platform !== "win32" || !runtimeHome.startsWith("/"))) {
      homes.add(runtimeHome);
    }
  } catch {}
  return [...homes];
}

async function ensureEngineModelCatalogAligned(
  codexHome: string,
  options: {
    vmEnabled: boolean;
    bridge?: CodexRuntimeClient;
    group?: ChannelGroupConfig;
    model?: string;
  }
): Promise<string | null> {
  const catalogPath = join(codexHome, CODEX_ULTRA_MODEL_CATALOG_FILE);
  const targetToolMode = options.vmEnabled ? "direct" : null;
  let catalogNeedsUpdate = false;

  if (existsSync(catalogPath)) {
    try {
      const content = readFileSync(catalogPath, "utf8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed?.models) && parsed.models.length > 0) {
        const mismatch = parsed.models.some((m: Record<string, unknown>) => m.tool_mode !== targetToolMode);
        if (mismatch) {
          parsed.models = parsed.models.map((m: Record<string, unknown>) => ({
            ...m,
            tool_mode: targetToolMode
          }));
          const temporaryPath = `${catalogPath}.tmp`;
          writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
          renameSync(temporaryPath, catalogPath);
        }
      } else {
        catalogNeedsUpdate = true;
      }
    } catch {
      catalogNeedsUpdate = true;
    }
  } else {
    console.warn(`[codex-catalog] WARNING: Model catalog missing at ${catalogPath}; Codex app-server will fall back to built-in models with code_mode_only.`);
    catalogNeedsUpdate = true;
  }

  if (catalogNeedsUpdate) {
    const configRead = options.bridge
      ? await options.bridge.request("config/read", { includeLayers: false }, 5_000).catch(() => undefined) as JsonValue | undefined
      : undefined;
    await repairAgentModelCatalog(codexHome, configRead, {
      model: options.model,
      groupId: options.group?.id
    }, { vmEnabled: options.vmEnabled }).catch((error) => {
      console.warn(`[codex-catalog] Failed to align model catalog at ${codexHome}`, error);
    });
  }

  if (options.bridge && existsSync(catalogPath)) {
    try {
      await options.bridge.request("config/value/write", {
        keyPath: "model_catalog_json",
        value: catalogPath,
        mergeStrategy: "replace"
      }, PROVIDER_CONFIG_WRITE_TIMEOUT_MS);
    } catch (e) {
      console.warn(`[codex-catalog] Failed to update bridge model_catalog_json config`, e);
    }
  }

  return existsSync(catalogPath) ? catalogPath : null;
}

function relayAuthTypeValue(value: unknown): RelayAuthType | undefined {
  switch (value) {
    case "none":
    case "inherit":
    case "bearer":
    case "anthropic":
    case "google_api_key":
    case "google_query_key":
      return value;
    default:
      return undefined;
  }
}
function appendContextWindowLog(line: string): void {
  if (process.env.CODEX_UI_DEBUG_LOG !== "1") {
    return;
  }
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.info(`[context-window-audit] ${entry}`);
  contextWindowLogLock = contextWindowLogLock
    .catch(() => undefined)
    .then(() => appendFile(contextWindowLogPath(), entry + "\n", "utf8"))
    .catch((error) => {
      console.warn("[context-window-audit] failed to append log.txt", error);
    });
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

let lastCpuSnapshot: { idle: number; total: number } | null = null;
let lastCpuUsagePercent = 0;

function getCpuUsagePercent(): number {
  try {
    if (existsSync("/proc/stat")) {
      const line = readFileSync("/proc/stat", "utf-8").split("\n")[0];
      if (line) {
        const parts = line.trim().split(/\s+/).slice(1).map(Number);
        const idle = (parts[3] || 0) + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        if (lastCpuSnapshot) {
          const idleDelta = idle - lastCpuSnapshot.idle;
          const totalDelta = total - lastCpuSnapshot.total;
          if (totalDelta > 0) {
            lastCpuUsagePercent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
          }
        }
        lastCpuSnapshot = { idle, total };
        return lastCpuUsagePercent;
      }
    }
  } catch {
    /* fallback */
  }
  const cpusList = cpus();
  if (cpusList.length === 0) return 0;
  let idleSum = 0;
  let totalSum = 0;
  for (const cpu of cpusList) {
    const t = cpu.times;
    idleSum += t.idle;
    totalSum += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  if (lastCpuSnapshot) {
    const idleDelta = idleSum - lastCpuSnapshot.idle;
    const totalDelta = totalSum - lastCpuSnapshot.total;
    if (totalDelta > 0) {
      lastCpuUsagePercent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
    }
  }
  lastCpuSnapshot = { idle: idleSum, total: totalSum };
  return lastCpuUsagePercent;
}

type WindowsProcessSample = {
  ProcessId?: number | string;
  ParentProcessId?: number | string;
  KernelModeTime?: number | string;
  UserModeTime?: number | string;
  WorkingSetSize?: number | string;
  Name?: string;
};

let lastApplicationProcessTimes = new Map<number, number>();
let lastApplicationSampleAt = 0;
let cachedApplicationMetrics: SystemMetrics["application"] = {
  cpuUsagePercent: 0,
  memoryBytes: process.memoryUsage().rss,
  processCount: 1,
  includesCodexCli: false
};
let applicationMetricsPromise: Promise<SystemMetrics["application"]> | null = null;
let applicationMetricsCachedAt = 0;

async function getApplicationMetrics(forceRefresh = false): Promise<SystemMetrics["application"]> {
  // Windows full-table Get-CimInstance sampling spawns powershell.exe every
  // poll. On Bun 1.3.14 the 5s timeout SIGTERM kill path segfaults the host
  // (panic at 0xFFFFFFFFFFFFFFFF, RSS only ~0.15GB, not a JS OOM). Disabled by
  // default; opt in with CODEX_UI_ENABLE_WIN_PROC_TREE=1 only for debugging.
  // Keep one shared sample long enough for all clients instead of creating a
  // periodic process/IO spike for every metrics badge.
  if (!forceRefresh && Date.now() - applicationMetricsCachedAt < 60_000) return cachedApplicationMetrics;
  if (applicationMetricsPromise) return applicationMetricsPromise;
  const enableWinProcessTree =
    process.platform === "win32" && process.env.CODEX_UI_ENABLE_WIN_PROC_TREE === "1";
  applicationMetricsPromise = enableWinProcessTree
    ? sampleWindowsApplicationProcessTree(Number(process.env.CODEX_UI_DESKTOP_ROOT_PID ?? process.pid))
    : Promise.resolve(sampleCurrentServerProcess());
  try {
    cachedApplicationMetrics = await applicationMetricsPromise;
    applicationMetricsCachedAt = Date.now();
    return cachedApplicationMetrics;
  } catch {
    cachedApplicationMetrics = sampleCurrentServerProcess();
    applicationMetricsCachedAt = Date.now();
    return cachedApplicationMetrics;
  } finally {
    applicationMetricsPromise = null;
  }
}

function sshConnectionErrorMessage(error: unknown): string {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const source = stderr || errorToMessage(error);
  const meaningful = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse().find((line) =>
    /permission denied|connection refused|timed out|could not resolve|name or service not known|host key verification failed|no route to host|connection closed|connection reset/i.test(line)
  );
  return meaningful || "Unable to establish a non-interactive SSH connection";
}

function imageRequestErrorResponse(error: unknown, clientSignal: AbortSignal, headers: Headers): Response {
  const message = errorToMessage(error);
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const explicitStatus = Number(record?.status ?? record?.statusCode);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) {
    return jsonResponse({ error: message }, explicitStatus, headers);
  }
  if (clientSignal.aborted) {
    return jsonResponse({ error: "Image request cancelled" }, 499, headers);
  }
  const name = error instanceof Error ? error.name : String(record?.name ?? "");
  if (name === "TimeoutError" || /timed? out|timeout/i.test(message)) {
    return jsonResponse({ error: "Image request timed out" }, 504, headers);
  }
  if (name === "AbortError") {
    return jsonResponse({ error: "Image request cancelled" }, 499, headers);
  }
  return jsonResponse({ error: message }, 400, headers);
}

function safeImageHistoryStats(store: ImageHistoryStore, ownerId: string, threadId: string): { count?: number; totalBytes?: number; maxBytes?: number | null } | undefined {
  try {
    return store.stats(ownerId, threadId);
  } catch {
    return undefined;
  }
}

function imageHistoryContainsInlineImage(items: JsonValue[]): boolean {
  return items.some((item) => {
    const record = asRecord(item);
    if (stringValue(record.type) === "image_generation_call" && stringValue(record.result)) return true;
    if (record.b64Json != null || record.b64_json != null || record.base64 != null) return true;
    if (!Array.isArray(record.content)) return false;
    return record.content.some((part) => {
      const content = asRecord(part);
      const type = stringValue(content.type);
      return type === "input_image" || type === "inputImage" || type === "image" || type === "localImage";
    });
  });
}

function imageMediaTypeForLocalPath(path: string): string | null {
  switch (path.split(".").pop()?.toLowerCase()) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    default: return null;
  }
}

function requiredThreadId(params: Record<string, unknown>): string {
  const threadId = stringValue(params.threadId);
  if (!threadId) throw new Error("Thread id is unavailable");
  return threadId;
}

async function threadHistoryFileInfo(bridge: CodexRuntimeClient, params: Record<string, unknown>): Promise<{ path: string; sizeBytes: number }> {
  const { path } = await resolveThreadHistory(bridge, params);
  const info = statSync(path);
  return { path, sizeBytes: info.size };
}

async function threadHistoryTail(bridge: CodexRuntimeClient, params: Record<string, unknown>): Promise<JsonValue> {
  const { path, thread } = await resolveThreadHistory(bridge, params);
  const requestedBytes = typeof params.maxBytes === "number" ? params.maxBytes : DEFAULT_HISTORY_TAIL_BYTES;
  return await readThreadHistoryTail(path, thread, requestedBytes) as unknown as JsonValue;
}

async function resolveThreadHistory(bridge: CodexRuntimeClient, params: Record<string, unknown>): Promise<{ path: string; thread: Record<string, unknown> }> {
  const threadId = typeof params.threadId === "string" ? params.threadId.trim() : "";
  if (!threadId) {
    throw new Error("Thread id is unavailable");
  }
  const metadata = asRecord(await bridge.request("thread/read", { threadId, includeTurns: false }, 8_000));
  const thread = asRecord(metadata.thread);
  const rawPath = typeof thread.path === "string" ? thread.path.trim() : "";
  if (!rawPath) {
    throw new Error("Thread history path is unavailable");
  }
  const path = resolve(expandLocalHomePath(rawPath));
  const info = statSync(path);
  if (!info.isFile()) {
    throw new Error("Thread history path is not a file");
  }
  return { path, thread };
}

async function restoreLegacyImageViewsForRpc(bridge: CodexRuntimeClient, method: string, params: Record<string, unknown>, result: JsonValue): Promise<JsonValue> {
  const threadId = stringValue(params.threadId);
  if (!threadId) return result;
  const response = asRecord(result);
  const responseThread = asRecord(response.thread);
  // Metadata-only reads and resume calls with excludeTurns intentionally carry no
  // transcript. Scanning the complete JSONL file here made a single history click
  // read the same (sometimes very large) file several times before the UI could
  // render anything. Only perform legacy image recovery when this response really
  // contains turns that can receive the recovered items.
  const hasThreadTurns = Array.isArray(responseThread.turns) && responseThread.turns.length > 0;
  const hasPageTurns = Array.isArray(response.data) && response.data.length > 0;
  if (!hasThreadTurns && !hasPageTurns) return result;
  let rawPath = stringValue(responseThread.path);
  if (!rawPath && method === "thread/turns/list") {
    const metadata = asRecord(await bridge.request("thread/read", { threadId, includeTurns: false }, 30_000));
    rawPath = stringValue(asRecord(metadata.thread).path);
  }
  if (!rawPath) return result;
  const historyPath = resolve(expandLocalHomePath(rawPath));
  if (!existsSync(historyPath)) return result;
  return restoreLegacyImageViews(result, historyPath);
}

function sampleCurrentServerProcess(): SystemMetrics["application"] {
  const now = Date.now();
  const usage = process.cpuUsage();
  const totalMicros = usage.user + usage.system;
  const previousTotal = lastApplicationProcessTimes.get(process.pid);
  const elapsedMs = lastApplicationSampleAt > 0 ? now - lastApplicationSampleAt : 0;
  const cpuUsagePercent = previousTotal !== undefined && elapsedMs > 0
    ? Math.max(0, ((totalMicros - previousTotal) / 1_000 / elapsedMs / Math.max(1, cpus().length)) * 100)
    : 0;
  lastApplicationProcessTimes = new Map([[process.pid, totalMicros]]);
  lastApplicationSampleAt = now;
  return {
    cpuUsagePercent: Number(cpuUsagePercent.toFixed(1)),
    memoryBytes: process.memoryUsage().rss,
    processCount: 1,
    includesCodexCli: false
  };
}

async function sampleWindowsApplicationProcessTree(rootPid: number): Promise<SystemMetrics["application"]> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return sampleCurrentServerProcess();
  const script = [
    "$items = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize,Name",
    "[pscustomobject]@{ samplerPid = $PID; processes = @($items) } | ConvertTo-Json -Depth 3 -Compress"
  ].join("; ");
  const { stdout } = await execFileAsync(
    process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );
  const parsed = JSON.parse(stdout) as { samplerPid?: number; processes?: WindowsProcessSample[] | WindowsProcessSample };
  const allProcesses = Array.isArray(parsed.processes) ? parsed.processes : parsed.processes ? [parsed.processes] : [];
  const childrenByParent = new Map<number, number[]>();
  const processesById = new Map<number, WindowsProcessSample>();
  for (const item of allProcesses) {
    const pid = Number(item.ProcessId);
    const parentPid = Number(item.ParentProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    processesById.set(pid, item);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const samplerPid = Number(parsed.samplerPid);
  const processIds = new Set<number>();
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (!pid || processIds.has(pid) || pid === samplerPid) continue;
    processIds.add(pid);
    pending.push(...(childrenByParent.get(pid) ?? []));
  }
  const now = Date.now();
  const elapsedMs = lastApplicationSampleAt > 0 ? now - lastApplicationSampleAt : 0;
  let cpuDelta100ns = 0;
  let memoryBytes = 0;
  let includesCodexCli = false;
  const nextTimes = new Map<number, number>();
  for (const pid of processIds) {
    const item = processesById.get(pid);
    if (!item) continue;
    const total100ns = Number(item.KernelModeTime ?? 0) + Number(item.UserModeTime ?? 0);
    const previous = lastApplicationProcessTimes.get(pid);
    if (previous !== undefined && total100ns >= previous) cpuDelta100ns += total100ns - previous;
    nextTimes.set(pid, total100ns);
    memoryBytes += Math.max(0, Number(item.WorkingSetSize ?? 0));
    if (/^codex(?:\.exe)?$/i.test(String(item.Name ?? ""))) includesCodexCli = true;
  }
  lastApplicationProcessTimes = nextTimes;
  lastApplicationSampleAt = now;
  const cpuUsagePercent = elapsedMs > 0
    ? Math.max(0, (cpuDelta100ns / 10_000 / elapsedMs / Math.max(1, cpus().length)) * 100)
    : 0;
  return {
    cpuUsagePercent: Number(cpuUsagePercent.toFixed(1)),
    memoryBytes,
    processCount: nextTimes.size,
    includesCodexCli
  };
}

async function getSystemMetrics(): Promise<SystemMetrics> {
  const cpuPercent = getCpuUsagePercent();
  const application = await getApplicationMetrics();
  const cpusList = cpus();
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
  const loadAvgArray = loadavg() as [number, number, number];

  let diskTotal = 0;
  let diskFree = 0;
  let diskUsed = 0;
  let diskPercent = 0;
  let mountPoint = "/";
  try {
    if (typeof statfsSync === "function") {
      const stat = statfsSync("/");
      diskTotal = Number(stat.bsize) * Number(stat.blocks);
      diskFree = Number(stat.bsize) * Number(stat.bavail);
      diskUsed = Math.max(0, diskTotal - diskFree);
      diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
    }
  } catch {
    /* fallback */
  }

  let swapTotal = 0;
  let swapUsed = 0;
  let swapPercent = 0;
  try {
    if (existsSync("/proc/meminfo")) {
      const content = readFileSync("/proc/meminfo", "utf-8");
      let totalKib = 0;
      let freeKib = 0;
      for (const line of content.split("\n")) {
        if (line.startsWith("SwapTotal:")) {
          totalKib = parseInt(line.split(/\s+/)[1] || "0", 10);
        } else if (line.startsWith("SwapFree:")) {
          freeKib = parseInt(line.split(/\s+/)[1] || "0", 10);
        }
      }
      if (totalKib > 0) {
        swapTotal = totalKib * 1024;
        swapUsed = Math.max(0, (totalKib - freeKib) * 1024);
        swapPercent = Math.round((swapUsed / swapTotal) * 100);
      }
    }
  } catch {
    /* fallback */
  }

  return {
    timestamp: Date.now(),
    cpu: {
      usagePercent: cpuPercent,
      cores: cpusList.length || 1,
      model: cpusList[0]?.model?.trim() || "CPU",
      loadAvg: [
        Number((loadAvgArray[0] || 0).toFixed(2)),
        Number((loadAvgArray[1] || 0).toFixed(2)),
        Number((loadAvgArray[2] || 0).toFixed(2))
      ]
    },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usagePercent: memPercent,
      swapTotalBytes: swapTotal,
      swapUsedBytes: swapUsed,
      swapUsagePercent: swapPercent
    },
    disk: {
      totalBytes: diskTotal,
      freeBytes: diskFree,
      usedBytes: diskUsed,
      usagePercent: diskPercent,
      mountPoint
    },
    host: {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      uptimeSec: Math.floor(uptime())
    },
    application
  };
}








