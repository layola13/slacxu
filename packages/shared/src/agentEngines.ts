/**
 * Shared multi-engine agent catalog.
 *
 * History P0 is **read-only list + transcript** for every *-launch product CLI.
 * The same IDs and capability flags are the foundation for later multi-agent
 * chat runtime (spawn code-launch / claude-launch / agy-launch / …).
 */

export type AgentEngineId =
  | "codex"
  | "claude"
  | "agy"
  | "gemini"
  | "crush"
  | "auggie"
  | "grok"
  | "freebuff"
  | "coderabbit"
  | "pi"
  | "opencode";

/** How the product CLI speaks to models (proxy via *-launch). */
export type AgentProtocol =
  | "responses" // Codex Responses API
  | "anthropic_messages"
  | "gemini_generate"
  | "chat_completions"
  | "pi_rpc"
  | "unknown";

/**
 * Capability matrix — grow these without renaming engine ids.
 * P0 history only uses list + transcript.
 */
export type AgentEngineCapabilities = {
  /** Scan host session stores into history rail */
  listHistory: boolean;
  /** Parse a stored session into messages for the UI */
  readTranscript: boolean;
  /**
   * Resume / continue the session inside Codex React UI.
   * Only Codex is true today (via app-server thread/*).
   */
  resumeInUi: boolean;
  /**
   * Send new prompts through this engine from the UI (future multi-agent runtime).
   * Requires a bridge adapter (P1+).
   */
  chatRuntime: boolean;
  /** Session store can be mutated from UI (rename/delete) */
  mutateSessions: boolean;
};

export type AgentEngineDefinition = {
  id: AgentEngineId;
  /** Short UI label */
  label: string;
  /** Product name */
  product: string;
  /** Matching *-launch adapter id when one exists */
  launchId: string | null;
  /** Second launch id if the same product is dual-named (agent ≈ grok) */
  altLaunchIds?: string[];
  protocol: AgentProtocol;
  /** Avatar chip mark */
  mark: string;
  /** Brand-ish color for tabs / badges */
  color: string;
  capabilities: AgentEngineCapabilities;
  /** Human-readable host history roots (docs / debugging) */
  historyRoots: string[];
  notes?: string;
};

const CAP_CODEX: AgentEngineCapabilities = {
  listHistory: true,
  readTranscript: true,
  resumeInUi: true,
  chatRuntime: true,
  mutateSessions: true
};

const CAP_CLAUDE: AgentEngineCapabilities = {
  listHistory: true,
  readTranscript: true,
  resumeInUi: true,
  chatRuntime: true,
  mutateSessions: false
};

const CAP_HISTORY_ONLY: AgentEngineCapabilities = {
  listHistory: true,
  readTranscript: true,
  resumeInUi: false,
  chatRuntime: false,
  mutateSessions: false
};

const CAP_LOGS_ONLY: AgentEngineCapabilities = {
  listHistory: true,
  readTranscript: true, // log tail
  resumeInUi: false,
  chatRuntime: false,
  mutateSessions: false
};

/**
 * Canonical registry — single source for Settings engine switcher,
 * History tabs, and future multi-agent runtime.
 */
export const AGENT_ENGINE_CATALOG: AgentEngineDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    product: "OpenAI Codex CLI",
    launchId: "code-launch",
    protocol: "responses",
    mark: "Cx",
    color: "#14b8a6",
    capabilities: CAP_CODEX,
    historyRoots: ["~/.codex/sessions", "~/.codex/session_index.jsonl"],
    notes: "Live engine in this UI via codex app-server."
  },
  {
    id: "claude",
    label: "Claude",
    product: "Claude Code CLI",
    launchId: "claude-launch",
    protocol: "anthropic_messages",
    mark: "Cl",
    color: "#f59e0b",
    capabilities: CAP_CLAUDE,
    historyRoots: ["~/.claude/history.jsonl", "~/.claude/projects/**/*.jsonl"],
    notes: "Live engine via Claude-compatible CLI runtime (stream-json). Feature flag required."
  },
  {
    id: "agy",
    label: "AGY",
    product: "Antigravity (agy) CLI",
    launchId: "agy-launch",
    protocol: "gemini_generate",
    mark: "Ag",
    color: "#8b5cf6",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: [
      "~/.gemini/antigravity-cli/cache/conversation_metadata.json",
      "~/.gemini/antigravity-cli/brain/<id>",
      "~/.gemini/antigravity-cli/conversations/<id>.db"
    ]
  },
  {
    id: "gemini",
    label: "Gemini",
    product: "Gemini CLI",
    launchId: "gemini-launch",
    protocol: "gemini_generate",
    mark: "Gm",
    color: "#3b82f6",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: ["~/.gemini/tmp/**/chats/session-*.jsonl", "~/.gemini/history"]
  },
  {
    id: "crush",
    label: "Crush",
    product: "Charm Crush",
    launchId: "crush-launch",
    protocol: "chat_completions",
    mark: "Cr",
    color: "#ec4899",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: ["<project>/.crush/crush.db", "~/.local/share/crush/projects.json"]
  },
  {
    id: "auggie",
    label: "Auggie",
    product: "Augment Code (auggie)",
    launchId: "auggie-launch",
    protocol: "unknown",
    mark: "Au",
    color: "#06b6d4",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: ["~/.augment/sessions/*.json"]
  },
  {
    id: "grok",
    label: "Grok",
    product: "xAI Grok / agent CLI",
    launchId: "grok-launch",
    altLaunchIds: ["agent-launch"],
    protocol: "chat_completions",
    mark: "X",
    color: "#64748b",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: ["~/.grok/sessions/**/summary.json", "~/.grok/sessions/**/chat_history.jsonl"]
  },
  {
    id: "freebuff",
    label: "Freebuff",
    product: "Freebuff / manicode",
    launchId: "freebuff-launch",
    protocol: "unknown",
    mark: "Fb",
    color: "#22c55e",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: ["~/.config/manicode/projects/**/chats/*/chat-meta.json"]
  },
  {
    id: "coderabbit",
    label: "CodeRabbit",
    product: "CodeRabbit CLI",
    launchId: "coderabbit-launch",
    protocol: "unknown",
    mark: "Rb",
    color: "#f97316",
    capabilities: CAP_LOGS_ONLY,
    historyRoots: ["~/.coderabbit/logs/*.log"],
    notes: "No durable chat sessions found; history lists CLI runs only."
  },
  {
    id: "pi",
    label: "Pi",
    product: "Pi coding agent",
    launchId: "pi-launch",
    protocol: "pi_rpc",
    mark: "Pi",
    color: "#a855f7",
    capabilities: CAP_HISTORY_ONLY,
    historyRoots: ["~/.pi/agent/sessions"],
    notes: "Experimental engine via Bun-spawned Pi RPC."
  },
  {
    id: "opencode",
    label: "OpenCode",
    product: "OpenCode CLI",
    launchId: "opencode-launch",
    protocol: "chat_completions",
    mark: "Oc",
    color: "#3b82f6",
    capabilities: {
      listHistory: true,
      readTranscript: true,
      resumeInUi: true,
      chatRuntime: true,
      mutateSessions: true,
    },
    historyRoots: ["~/.local/share/opencode/**", "~/.opencode/**"],
    notes: "Local opencode serve HTTP/SSE bridge."
  }
];

export function isAgentEngineId(value: string): value is AgentEngineId {
  return AGENT_ENGINE_CATALOG.some((e) => e.id === value);
}

export function getAgentEngine(id: AgentEngineId): AgentEngineDefinition {
  const found = AGENT_ENGINE_CATALOG.find((e) => e.id === id);
  if (!found) {
    throw new Error(`Unknown agent engine: ${id}`);
  }
  return found;
}

export function agentEngineByLaunchId(launchId: string): AgentEngineDefinition | undefined {
  return AGENT_ENGINE_CATALOG.find(
    (e) => e.launchId === launchId || e.altLaunchIds?.includes(launchId)
  );
}

/** Engines that can appear in the Settings multi-engine switcher (chat path). */
export function plannedChatEngines(): AgentEngineDefinition[] {
  return AGENT_ENGINE_CATALOG.filter((e) => e.capabilities.chatRuntime || e.capabilities.listHistory);
}

/**
 * Future multi-agent runtime hook shape (not implemented in P0).
 * Keep this type stable so server bridges can land without UI rewrites.
 */
export type AgentRuntimeBridgePlan = {
  engine: AgentEngineId;
  /** Preferred host binary */
  binaryCandidates: string[];
  /** Env prefix used by *-launch installers */
  launchEnvPrefix: string | null;
  /** How UI would start a session later */
  startMode: "app_server_stdio" | "cli_subprocess" | "unavailable";
};

export const AGENT_RUNTIME_BRIDGE_PLAN: AgentRuntimeBridgePlan[] = [
  {
    engine: "codex",
    binaryCandidates: ["codex"],
    launchEnvPrefix: "CODE_LAUNCH_",
    startMode: "app_server_stdio"
  },
  {
    engine: "claude",
    binaryCandidates: ["claude"],
    launchEnvPrefix: "CLAUDE_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "agy",
    binaryCandidates: ["agy"],
    launchEnvPrefix: "AGY_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "gemini",
    binaryCandidates: ["gemini"],
    launchEnvPrefix: "GEMINI_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "crush",
    binaryCandidates: ["crush"],
    launchEnvPrefix: "CRUSH_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "auggie",
    binaryCandidates: ["auggie"],
    launchEnvPrefix: "AUGGIE_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "grok",
    binaryCandidates: ["agent", "grok"],
    launchEnvPrefix: "GROK_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "freebuff",
    binaryCandidates: ["freebuff"],
    launchEnvPrefix: "FREEBUFF_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "coderabbit",
    binaryCandidates: ["coderabbit"],
    launchEnvPrefix: "CODERABBIT_LAUNCH_",
    startMode: "unavailable"
  },
  {
    engine: "pi",
    binaryCandidates: ["pi"],
    launchEnvPrefix: "PI_LAUNCH_",
    startMode: "cli_subprocess"
  },
  {
    engine: "opencode",
    binaryCandidates: ["opencode"],
    launchEnvPrefix: "OPENCODE_LAUNCH_",
    startMode: "cli_subprocess"
  }
];
