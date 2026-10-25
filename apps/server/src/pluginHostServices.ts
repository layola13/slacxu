/**
 * The host's PluginHostServices implementation (R2): the ONLY bridge
 * between plugin projects and host capabilities. Importing this module
 * registers the services with the SDK; pluginHost.ts imports it at boot
 * before any plugin engine runs. Plugins never import this file — they
 * call the SDK surface (`tryPluginHostServices`) instead.
 */
import { setPluginHostServices, type PluginHostServices } from "@cxu/sdk-backend";
import { getCachedLatestCliPath, getPreferredCliBinary } from "./cliSelectionState.js";
import { enumerateCliCandidates } from "./cliVersions.js";
import { ensureSaVmProjectBundleInstalled } from "./saVmBundle.js";
import { runSaVmTool } from "./saVmTool.js";
import { CodeCliBridge } from "./codeCliBridge.js";
import { closeRemoteBunNodeTunnel, openRemoteBunNodeTunnel, requestRemoteBunNode } from "./remoteBunNode.js";
import {
  codexAppServerArgs,
  findCodexBinary,
  isCodexCliAvailable,
  resolveCodexSpawn,
  spawnCodexCommand,
} from "./codexCommand.js";
import { MiniBridge } from "../../../backends/mini/src/runtime/miniBridge.js";
import { runRelayChatRequestWithKeyFailover } from "../../../backends/relay-config/src/relay/relayProtocolGateway.js";
import { createApp as createDuck2ApiApp } from "../../duck2api/src/server.ts";

export const pluginHostServicesImpl: PluginHostServices = {
  cli: {
    getPreferredCliBinary,
    getCachedLatestCliPath,
    enumerateCliCandidates,
  },
  saVm: {
    ensureProjectBundleInstalled: (cwd: string) => ensureSaVmProjectBundleInstalled(cwd),
    runTool: (input, options, cwdOverride) => runSaVmTool(input, options, cwdOverride),
  },
  codeCli: {
    createBridge: (env: () => NodeJS.ProcessEnv) => new CodeCliBridge(env),
  },
  remoteBun: {
    openTunnel: (command: string, portInput?: number) => openRemoteBunNodeTunnel(command, portInput),
    closeTunnel: (tunnelId: string) => closeRemoteBunNodeTunnel(tunnelId),
    request: (tunnelId: string, method: string, path: string, body?: unknown, apiSession?: string) =>
      requestRemoteBunNode(tunnelId, method, path, body, apiSession),
  },
  codex: {
    findCodexBinary: (customBin?: string) => findCodexBinary(customBin),
    isCodexCliAvailable: (platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv) =>
      isCodexCliAvailable(platform, env),
    codexAppServerArgs,
    spawnCodexCommand,
    resolveCodexSpawn: (
      command: string,
      args: string[],
      platform?: NodeJS.Platform,
      env?: NodeJS.ProcessEnv,
    ) => resolveCodexSpawn(command, args, platform, env),
  },
  mini: {
    createFallbackBridge: () => new MiniBridge(),
  },
  relay: {
    runChatRequestWithKeyFailover: (input) => runRelayChatRequestWithKeyFailover(input),
    createDuck2ApiApp: () => createDuck2ApiApp(),
  },
};

setPluginHostServices(pluginHostServicesImpl);
