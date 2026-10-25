/**
 * Catalog of layola13 *-launch adapters.
 * Codex UI uses the Responses API; many OpenAI-compatible relays only speak
 * Chat Completions — users need code-launch (or a sibling launcher) as a bridge.
 */

export type LaunchAdapterId =
  | "code-launch"
  | "agy-launch"
  | "claude-launch"
  | "gemini-launch"
  | "crush-launch"
  | "auggie-launch"
  | "agent-launch"
  | "coderabbit-launch"
  | "freebuff-launch"
  | "grok-launch"
  | "pi-launch"
  | "opencode-launch";

export type LaunchAdapter = {
  id: LaunchAdapterId;
  /** Display name */
  name: string;
  /** Which product it wraps */
  product: string;
  /** GitHub repo under layola13 */
  repo: string;
  githubUrl: string;
  /** Required for using Codex React UI with Chat Completions-only relays */
  requiredForCodexUi: boolean;
  summaryEn: string;
  summaryCn: string;
  installHintEn: string;
  installHintCn: string;
  envPrefix: string;
};

const GITHUB_ORG = "https://github.com/layola13";

export const LAUNCH_ADAPTERS: LaunchAdapter[] = [
  {
    id: "code-launch",
    name: "code-launch",
    product: "Codex CLI / Codex React UI",
    repo: "code-launch",
    githubUrl: `${GITHUB_ORG}/code-launch`,
    requiredForCodexUi: true,
    summaryEn:
      "Translates Codex Responses API ↔ OpenAI Chat Completions. Required when a relay only supports /v1/chat/completions (e.g. many third-party keys).",
    summaryCn:
      "将 Codex Responses API 与 OpenAI Chat Completions 互转。当中转站只支持 /v1/chat/completions（多数第三方 key）时必须安装，否则本 UI 无法直接调用。",
    installHintEn:
      "git clone https://github.com/layola13/code-launch.git && cd code-launch && ./install.sh",
    installHintCn:
      "git clone https://github.com/layola13/code-launch.git && cd code-launch && ./install.sh",
    envPrefix: "CODE_LAUNCH_"
  },
  {
    id: "agy-launch",
    name: "agy-launch",
    product: "Antigravity (agy) CLI",
    repo: "agy-launch",
    githubUrl: `${GITHUB_ORG}/agy-launch`,
    requiredForCodexUi: false,
    summaryEn: "Routes agy model traffic through a local proxy to OpenAI-compatible Chat Completions.",
    summaryCn: "将 agy 模型流量经本地代理转发到 OpenAI 兼容 Chat Completions。",
    installHintEn: "git clone https://github.com/layola13/agy-launch.git && cd agy-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/agy-launch.git && cd agy-launch && ./install.sh",
    envPrefix: "AGY_LAUNCH_"
  },
  {
    id: "claude-launch",
    name: "claude-launch",
    product: "Claude Code CLI",
    repo: "claude-launch",
    githubUrl: `${GITHUB_ORG}/claude-launch`,
    requiredForCodexUi: false,
    summaryEn: "Translates Anthropic Messages API ↔ OpenAI Chat Completions for Claude Code.",
    summaryCn: "将 Claude Code 的 Anthropic Messages API 与 Chat Completions 互转。",
    installHintEn: "git clone https://github.com/layola13/claude-launch.git && cd claude-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/claude-launch.git && cd claude-launch && ./install.sh",
    envPrefix: "CLAUDE_LAUNCH_"
  },
  {
    id: "gemini-launch",
    name: "gemini-launch",
    product: "Gemini CLI",
    repo: "gemini-launch",
    githubUrl: `${GITHUB_ORG}/gemini-launch`,
    requiredForCodexUi: false,
    summaryEn: "Routes Gemini CLI traffic to OpenAI-compatible Chat Completions.",
    summaryCn: "将 Gemini CLI 流量转发到 OpenAI 兼容 Chat Completions。",
    installHintEn: "git clone https://github.com/layola13/gemini-launch.git && cd gemini-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/gemini-launch.git && cd gemini-launch && ./install.sh",
    envPrefix: "GEMINI_LAUNCH_"
  },
  {
    id: "crush-launch",
    name: "crush-launch",
    product: "Charm Crush",
    repo: "crush-launch",
    githubUrl: `${GITHUB_ORG}/crush-launch`,
    requiredForCodexUi: false,
    summaryEn: "Env/.env wrapper that generates crush.json for OpenAI-compatible providers.",
    summaryCn: "用 env/.env 生成 crush.json，对接 OpenAI 兼容服务商。",
    installHintEn: "git clone https://github.com/layola13/crush-launch.git && cd crush-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/crush-launch.git && cd crush-launch && ./install.sh",
    envPrefix: "CRUSH_LAUNCH_"
  },
  {
    id: "auggie-launch",
    name: "auggie-launch",
    product: "Augment Code (auggie)",
    repo: "auggie-launch",
    githubUrl: `${GITHUB_ORG}/auggie-launch`,
    requiredForCodexUi: false,
    summaryEn: "Local Augment-compatible proxy → OpenAI Chat Completions.",
    summaryCn: "本地 Augment 兼容代理 → OpenAI Chat Completions。",
    installHintEn: "git clone https://github.com/layola13/auggie-launch.git && cd auggie-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/auggie-launch.git && cd auggie-launch && ./install.sh",
    envPrefix: "AUGGIE_LAUNCH_"
  },
  {
    id: "agent-launch",
    name: "agent-launch",
    product: "Agent CLI family",
    repo: "agent-launch",
    githubUrl: `${GITHUB_ORG}/agent-launch`,
    requiredForCodexUi: false,
    summaryEn: "Generic launcher pattern for agent CLIs (see repo README).",
    summaryCn: "通用 agent CLI 启动器（详见仓库 README）。",
    installHintEn: "git clone https://github.com/layola13/agent-launch.git && cd agent-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/agent-launch.git && cd agent-launch && ./install.sh",
    envPrefix: "AGENT_LAUNCH_"
  },
  {
    id: "coderabbit-launch",
    name: "coderabbit-launch",
    product: "CodeRabbit CLI",
    repo: "coderabbit-launch",
    githubUrl: `${GITHUB_ORG}/coderabbit-launch`,
    requiredForCodexUi: false,
    summaryEn: "MITM proxy rewrite for CodeRabbit local chat-completions traffic.",
    summaryCn: "对 CodeRabbit 本地 chat-completions 流量做 MITM 重写。",
    installHintEn: "git clone https://github.com/layola13/coderabbit-launch.git && cd coderabbit-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/coderabbit-launch.git && cd coderabbit-launch && ./install.sh",
    envPrefix: "CODERABBIT_LAUNCH_"
  },
  {
    id: "freebuff-launch",
    name: "freebuff-launch",
    product: "Freebuff CLI",
    repo: "freebuff-launch",
    githubUrl: `${GITHUB_ORG}/freebuff-launch`,
    requiredForCodexUi: false,
    summaryEn: "HTTPS MITM proxy rewrite for Freebuff model traffic.",
    summaryCn: "对 Freebuff 模型流量做 HTTPS MITM 重写。",
    installHintEn: "git clone https://github.com/layola13/freebuff-launch.git && cd freebuff-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/freebuff-launch.git && cd freebuff-launch && ./install.sh",
    envPrefix: "FREEBUFF_LAUNCH_"
  },
  {
    id: "grok-launch",
    name: "grok-launch",
    product: "Grok / xAI style CLI",
    repo: "grok-launch",
    githubUrl: `${GITHUB_ORG}/grok-launch`,
    requiredForCodexUi: false,
    summaryEn: "Launcher for Grok-oriented CLI setups (repo: grok-launch).",
    summaryCn: "面向 Grok 类 CLI 的启动器（仓库 grok-launch）。",
    installHintEn: "git clone https://github.com/layola13/grok-launch.git && cd grok-launch && ./install.sh",
    installHintCn: "git clone https://github.com/layola13/grok-launch.git && cd grok-launch && ./install.sh",
    envPrefix: "GROK_LAUNCH_"
  },
  {
    id: "pi-launch",
    name: "pi-launch",
    product: "Pi coding agent",
    repo: "pi",
    githubUrl: "https://github.com/earendil-works/pi",
    requiredForCodexUi: false,
    summaryEn: "Runs Pi coding agent in RPC mode with pi-relay extension for custom relays.",
    summaryCn: "以 RPC 模式运行 Pi coding agent，并通过 pi-relay 扩展接入自定义中转。",
    installHintEn: "npm install -g @earendil-works/pi-coding-agent (or run from E:/projects/pi with Bun)",
    installHintCn: "npm install -g @earendil-works/pi-coding-agent（或直接通过 Bun 运行 E:/projects/pi 源码）",
    envPrefix: "PI_LAUNCH_"
  },
  {
    id: "opencode-launch",
    name: "opencode-launch",
    product: "OpenCode AI coding agent",
    repo: "opencode",
    githubUrl: "https://github.com/layola13/opencode",
    requiredForCodexUi: false,
    summaryEn: "Runs OpenCode in serve mode with REST and SSE streaming for full agent workflows.",
    summaryCn: "以 serve 模式运行 OpenCode，通过 REST 与 SSE 流式输出接入完整智能体工作流。",
    installHintEn: "npm install -g opencode (or run from E:/projects/opencode with Bun)",
    installHintCn: "npm install -g opencode（或直接通过 Bun 运行 E:/projects/opencode 源码）",
    envPrefix: "OPENCODE_LAUNCH_"
  }
];

export const CODE_LAUNCH = LAUNCH_ADAPTERS.find((a) => a.id === "code-launch")!;

/** Pattern URL shown in docs: https://github.com/layola13/xxxxx-launch */
export const LAUNCH_REPO_PATTERN = "https://github.com/layola13/xxxxx-launch";
export const LAUNCH_ORG_URL = GITHUB_ORG;

/**
 * Heuristic: many third-party relays only support Chat Completions.
 * Codex React UI activates providers as Responses wire — users need code-launch.
 */
export function relayLikelyNeedsCodeLaunch(provider: {
  id?: string;
  kind?: string;
  baseUrl?: string;
  name?: string;
}): boolean {
  const kind = provider.kind ?? "";
  const base = (provider.baseUrl ?? "").toLowerCase();
  const id = (provider.id ?? "").toLowerCase();
  const name = (provider.name ?? "").toLowerCase();

  // Explicit OpenAI chat-style provider kind
  if (kind === "openai") {
    return true;
  }

  // Known chat-only / third-party hosts (extend as needed)
  const chatOnlyHostHints = [
    "shuaiapi.com",
    "api.deepseek.com",
    "open.bigmodel.cn",
    "api.moonshot.cn",
    "api.minimax.chat",
    "dashscope.aliyuncs.com",
    "api.groq.com",
    "api.together.xyz",
    "openrouter.ai"
  ];
  if (chatOnlyHostHints.some((h) => base.includes(h))) {
    return true;
  }

  // User-named test relays that are chat-only
  if (id.includes("shuaiapi") || name.includes("shuaiapi") || name.includes("grok")) {
    return true;
  }

  // Official OpenAI / Azure Responses-capable endpoints usually OK
  if (base.includes("api.openai.com") || base.includes("chatgpt.com")) {
    return false;
  }

  // Default for responsesRelay third-party: still warn (safe default)
  if (kind === "responsesRelay" && base && !base.includes("api.openai.com")) {
    return true;
  }

  return false;
}

export function codeLaunchCloneCommand(): string {
  return "git clone https://github.com/layola13/code-launch.git && cd code-launch && ./install.sh";
}
