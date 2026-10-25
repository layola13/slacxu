/** Workbench protocol types (R2: owned by the SDK).
 *
 * The thread/item/turn shapes the server returns and every web
 * plugin renders against, plus the project relay directory shape.
 * Extracted from the host's codexClient, which re-exports them.
 */
import type { JsonValue } from "@codex-ui/shared";

export type WorkbenchItem = {
  id: string;
  type: string;
  title: string;
  text: string;
  images?: WorkbenchImage[];
  files?: WorkbenchFile[];
  status?: string;
  /** Item-local start time. Assistant first-token latency must use this, not the turn start. */
  startedAt?: number;
  firstTokenAt?: number;
  /** Latest protocol/event update, used for live waterfall timestamps. */
  updatedAt?: number;
  agentId?: string;
  agentThreadId?: string;
  agentName?: string;
  agentRole?: string;
  agentStatus?: string;
  receiverThreadIds?: string[];
  payload?: JsonValue;
};

export type WorkbenchImage = {
  url: string;
  name?: string;
  detail?: string;
  revisedPrompt?: string;
  model?: string;
  providerName?: string;
  estimatedCostUsd?: number;
  unitPriceUsd?: number;
};

export type WorkbenchFile = {
  name: string;
  path?: string;
  url?: string;
  mediaType?: string;
  size?: number;
};

export type WorkbenchTurn = {
  id: string;
  threadId: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  items: WorkbenchItem[];
};

export type ProjectRelayGroup = {
  groupId: string;
  groupName: string;
  kind: "text" | "image";
  enabled: boolean;
  groupRatio: number;
  models: string[];
  supportedEndpointTypes: string[];
  responseProtocol: string | null;
  responseProtocolMode: string | null;
};

export type ProjectRelayProvider = {
  providerId: string;
  providerName: string;
  providerKind: string;
  defaultModel: string | null;
  models: string[];
  groups: ProjectRelayGroup[];
};
