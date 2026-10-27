import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function createStoredTestZip(entries: Record<string, Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const records: Array<{ path: string; data: Buffer; crc: number; offset: number }> = [];
  let offset = 0;
  for (const [path, data] of Object.entries(entries)) {
    const name = Buffer.from(path);
    const crc = crc32(data);
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    name.copy(header, 30);
    localParts.push(header, data);
    records.push({ path, data, crc, offset });
    offset += header.length + data.length;
  }
  const centralOffset = offset;
  for (const record of records) {
    const name = Buffer.from(record.path);
    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(record.crc, 16);
    header.writeUInt32LE(record.data.length, 20);
    header.writeUInt32LE(record.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(record.offset, 42);
    name.copy(header, 46);
    centralParts.push(header);
    offset += header.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(offset - centralOffset, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function readStoredTestZip(zip: Buffer): Map<string, Buffer> {
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) {
    throw new Error("Missing ZIP end directory");
  }
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let cursor = zip.readUInt32LE(endOffset + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory");
    }
    const method = zip.readUInt16LE(cursor + 10);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (method !== 0) {
      throw new Error("Only stored ZIP entries are supported by this test helper");
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    files.set(name, zip.subarray(dataStart, dataStart + size));
  }
  return files;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const mockProvider = {
  id: "hubproxy-grok",
  kind: "responsesRelay",
  name: "HubProxy Grok",
  baseUrl: "https://api.astrdark.cyou/v1",
  apiKeyRef: "env:CODEX_UI_PROVIDER_HUBPROXY_GROK_API_KEY",
  apiKeyPreview: "key...ring",
  apiKeyStorage: "keyring",
  defaultModel: "codex",
  nativeModels: ["grok-4.5"],
  modelAliases: [
    { alias: "gpt-5.5", model: "grok-4.5" },
    { alias: "codex", model: "gpt-5.5" }
  ],
  createdAt: 1,
  updatedAt: 2
};

const importedProvider = {
  id: "imported-relay",
  kind: "responsesRelay",
  name: "Imported Relay",
  baseUrl: "https://relay.example.test/v1",
  apiKeyRef: "env:CODEX_UI_PROVIDER_IMPORTED_RELAY_API_KEY",
  apiKeyStorage: "none",
  defaultModel: "imported-model",
  nativeModels: ["imported-model"],
  modelAliases: [{ alias: "codex-imported", model: "imported-model" }],
  createdAt: 3,
  updatedAt: 4
};

const draftCapabilityCatalog = {
  schema: "codex-react-ui.relay-catalog.v1",
  success: true,
  auto_groups: [],
  data: [
    { model_name: "gpt-draft", quota_type: 0, enable_groups: ["default"], supported_endpoint_types: ["openai-response"] },
    { model_name: "claude-draft", quota_type: 0, enable_groups: ["claude"], supported_endpoint_types: ["anthropic"] }
  ],
  group_ratio: { default: 1, claude: 2 },
  usable_group: { default: "Default", claude: "Claude" },
  supported_endpoint: {},
  vendors: [],
  imported_at: 1,
  source_hash: "draft-fixture",
  warnings: []
};

const draftCatalogGroups = [
  {
    id: "catalog:default",
    name: "default",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    priority: 1,
    weight: 0,
    keyMode: "polling",
    models: ["gpt-draft"],
    supportedEndpointTypes: ["openai-response"],
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    authType: "inherit",
    credentialMode: "provider",
    catalogGroupName: "default",
    catalogManaged: true,
    keys: []
  },
  {
    id: "catalog:claude",
    name: "claude",
    kind: "text",
    status: "enabled",
    groupRatio: 2,
    priority: 2,
    weight: 0,
    keyMode: "polling",
    models: ["claude-draft"],
    supportedEndpointTypes: ["anthropic"],
    responseProtocol: "anthropic",
    responseProtocolMode: "fixed",
    authType: "inherit",
    credentialMode: "provider",
    catalogGroupName: "claude",
    catalogManaged: true,
    keys: []
  }
];

type TestJsonSchemaLike = TestJsonSchema | boolean;

type TestJsonSchema = {
  $ref?: string;
  allOf?: TestJsonSchemaLike[];
  properties?: Record<string, TestJsonSchemaLike>;
};

type TestCodexSchema = TestJsonSchema & {
  definitions?: Record<string, TestJsonSchemaLike>;
};

function flattenTestSchemaProperties(
  root: TestCodexSchema,
  properties: Record<string, TestJsonSchemaLike>,
  parentPath: string[] = []
): string[] {
  return Object.keys(properties)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((key) => {
      const keyPath = [...parentPath, key];
      const schema = resolveTestSchema(root, properties[key]);
      return [keyPath.join("."), ...flattenTestSchemaProperties(root, schema.properties ?? {}, keyPath)];
    });
}

function resolveTestSchema(root: TestCodexSchema, schema: TestJsonSchemaLike | undefined, seen = new Set<string>()): TestJsonSchema {
  if (!schema || typeof schema === "boolean") {
    return {};
  }
  let resolved: TestJsonSchema = schema;
  if (schema.$ref?.startsWith("#/definitions/")) {
    const name = schema.$ref.slice("#/definitions/".length);
    if (!seen.has(name)) {
      seen.add(name);
      resolved = mergeTestSchema(resolveTestSchema(root, root.definitions?.[name], seen), withoutTestRef(schema));
    }
  }
  if (resolved.allOf?.length) {
    return resolved.allOf.reduce<TestJsonSchema>((acc, entry) => mergeTestSchema(acc, resolveTestSchema(root, entry, seen)), withoutTestAllOf(resolved));
  }
  return resolved;
}

function mergeTestSchema(base: TestJsonSchema, override: TestJsonSchema): TestJsonSchema {
  return {
    ...base,
    ...override,
    properties: {
      ...(base.properties ?? {}),
      ...(override.properties ?? {})
    }
  };
}

function withoutTestRef(schema: TestJsonSchema): TestJsonSchema {
  const { $ref: _ref, ...rest } = schema;
  return rest;
}

function withoutTestAllOf(schema: TestJsonSchema): TestJsonSchema {
  const { allOf: _allOf, ...rest } = schema;
  return rest;
}

async function confirmWorkspace(page: Page, cwd = "~/"): Promise<void> {
  const panel = page.getByTestId("workspace-selection-panel");
  if (!(await panel.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false))) {
    return;
  }
  await panel.getByRole("textbox", { name: "Workspace" }).fill(cwd);
  await panel.getByRole("button", { name: "Use workspace" }).click();
  await expect(panel).toHaveCount(0, { timeout: 10_000 });
}

async function openSplitViewFromHistory(page: Page, conversation = "Second task"): Promise<void> {
  const splitButton = page.getByTestId("split-view-toolbar-button");
  await splitButton.click({ button: "right" });
  const search = page.getByLabel("Search conversations");
  await expect(search).toBeVisible();
  await search.fill(conversation);
  await page.getByRole("menuitem").filter({ hasText: conversation }).click();
}

async function mockWindowsDesktopSession(page: Page): Promise<void> {
  await page.unroute("/api/session");
  await page.route("/api/session", (route) => route.fulfill({
    json: {
      token: "test-token",
      desktopTrustedLocal: true,
      desktopRuntime: {
        platform: "win32",
        codexAvailable: true,
        codexInstallCommand: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
      }
    }
  }));
}

async function emitCodexServerRequest(page: Page, message: unknown): Promise<void> {
  await page.evaluate((serverRequest) => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const event = new MessageEvent("message", {
      data: JSON.stringify({ type: "codex.serverRequest", message: serverRequest })
    });
    socket.dispatchEvent(event);
    socket.onmessage?.(event);
  }, message);
}

async function emitCodexNotification(page: Page, method: string, params: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ notificationMethod, notificationParams }) => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const event = new MessageEvent("message", {
      data: JSON.stringify({
        type: "codex.notification",
        message: { method: notificationMethod, params: notificationParams }
      })
    });
    socket.dispatchEvent(event);
    socket.onmessage?.(event);
  }, { notificationMethod: method, notificationParams: params });
}

async function waitForServerResponse(page: Page, requestId: string): Promise<Record<string, unknown>> {
  await page.waitForFunction((expectedRequestId) => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ type?: string; requestId?: string }>;
    }).__codexUiOutbound ?? [];
    return messages.some((message) => message.type === "serverResponse" && message.requestId === expectedRequestId);
  }, requestId);
  return page.evaluate((expectedRequestId) => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ type?: string; requestId?: string; result?: Record<string, unknown> }>;
    }).__codexUiOutbound ?? [];
    return messages.find((message) => message.type === "serverResponse" && message.requestId === expectedRequestId)?.result ?? {};
  }, requestId);
}

async function assertMountedWaterfallRowsDoNotOverlap(page: Page): Promise<void> {
  const boxes = await page.locator('[data-testid^="conversation-item-"]').evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-testid") ?? "",
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height
        };
      })
      .filter((box) => box.height > 0)
      .sort((a, b) => a.top - b.top)
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1]!;
    const current = boxes[index]!;
    expect.soft(current.top, `${current.id} overlaps ${previous.id}`).toBeGreaterThanOrEqual(previous.bottom - 2);
  }
}

async function openTranscriptSearch(page: Page): Promise<void> {
  const promptMap = page.getByTestId("chat-prompt-map");
  if (await promptMap.isVisible().catch(() => false)) {
    await promptMap.getByRole("button", { name: "Close prompt map" }).click();
    await expect(promptMap).toHaveCount(0);
  }
  const overlay = page.getByTestId("chat-search-overlay");
  if (await overlay.isVisible().catch(() => false)) {
    return;
  }
  await page.getByTestId("chat-search-open").click();
  await expect(overlay).toBeVisible();
}

async function setTranscriptSearchScope(page: Page, scope: "All" | "User" | "Assistant" | "Tools" | "Files" | "Commands"): Promise<void> {
  const overlay = page.getByTestId("chat-search-overlay");
  await expect(overlay).toBeVisible();
  if (await page.getByRole("listbox").isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  await overlay.getByTestId("chat-search-scope").click();
  await page.getByRole("option", { name: scope }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

let providerApiList = [mockProvider];
let providerModelFetchRequests: Array<{ baseUrl?: string; apiKey?: string; kind?: string; providerId?: string }> = [];
let catalogPreviewRequests = 0;
let userPreferences: Record<string, unknown> = {};
let threadRuntimeMetadata: Record<string, Record<string, unknown>> = {};
const FIFTEEN_AGENT_SORTING_PROMPT =
  "先删除 E:\\projects\\sci\\bench\\sorting\\*.zig，然后开启 15 agents，每个 agent 实现一种排序算法并打印时间。";
let auditApiEvents: Array<{
  id: string;
  createdAt: number;
  method: "thread/start" | "turn/start";
  severity: "warning" | "critical";
  reasons: string[];
  cwd?: string;
  threadId?: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
  sandboxPolicyType?: string;
  inputSummary?: { items: number; textItems: number; imageItems: number; mentionItems: number };
}> = [];

test.beforeEach(async ({ page }) => {
  providerApiList = [mockProvider];
  providerModelFetchRequests = [];
  catalogPreviewRequests = 0;
  userPreferences = {};
  threadRuntimeMetadata = {};
  auditApiEvents = [];

  await page.addInitScript(() => {
    const outbound = ((window as unknown as { __codexUiOutbound: unknown[] }).__codexUiOutbound = []);
    const sockets = ((window as unknown as { __codexUiSockets: unknown[] }).__codexUiSockets = []);
    (window as unknown as { __codexUiHeartbeatResponsesEnabled: boolean }).__codexUiHeartbeatResponsesEnabled = true;
    let threadStartCount = 0;
    let turnStartCount = 0;
    let nativeGoalTurnCount = 0;
    let planContinuationTurnCount = 0;
    let tokenTotal = 0;
    const reconciledTurnsByThread = new Map<string, Array<Record<string, unknown>>>();
    (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread = reconciledTurnsByThread;

    class MockWebSocket extends EventTarget {
      public static readonly CONNECTING = 0;
      public static readonly OPEN = 1;
      public static readonly CLOSING = 2;
      public static readonly CLOSED = 3;
      public readonly CONNECTING = 0;
      public readonly OPEN = 1;
      public readonly CLOSING = 2;
      public readonly CLOSED = 3;
      public readyState = MockWebSocket.CONNECTING;
      public onopen: ((event: Event) => void) | null = null;
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public onclose: ((event: CloseEvent) => void) | null = null;
      public onerror: ((event: Event) => void) | null = null;
      private readonly commandExecRequests = new Map<string, string>();
      private ptyTerminalCount = 0;

      public constructor(public readonly url: string) {
        super();
        sockets.push(this);
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
          this.emit({ type: "engine.status", status: { phase: "ready", codexVersion: "mock-codex" } });
        }, 0);
      }

      public send(raw: string): void {
        const message = JSON.parse(raw) as {
          id?: string;
          method?: string;
          type?: string;
          sentAt?: number;
          providerId?: string;
          model?: string;
          provider?: {
            id?: string;
            kind?: string;
            name?: string;
            baseUrl?: string;
            apiKeyRef?: string;
            apiKeyPreview?: string;
            apiKeyStorage?: string;
            defaultModel?: string;
            nativeModels?: string[];
            modelAliases?: Array<{ alias: string; model: string }>;
            modelRates?: unknown[];
            remark?: string;
            createdAt?: number;
            updatedAt?: number;
          };
          apiKey?: string;
          params?: unknown;
        };
        outbound.push(message);
        if (message.type === "heartbeat.ping" && message.id && typeof message.sentAt === "number") {
          const heartbeatResponsesEnabled =
            (window as unknown as { __codexUiHeartbeatResponsesEnabled?: boolean })
              .__codexUiHeartbeatResponsesEnabled !== false;
          if (heartbeatResponsesEnabled) {
            setTimeout(() => this.emit({
              type: "heartbeat.pong",
              id: message.id,
              sentAt: message.sentAt,
              receivedAt: Date.now()
            }), 0);
          }
          return;
        }
        if (message.type === "heartbeat.pong") {
          return;
        }
        if (message.type === "provider.save" && message.id && message.provider) {
          const name = message.provider.name || "Saved relay";
          const providerId =
            message.provider.id ||
            name
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 40) ||
            "saved-relay";
          const preview =
            message.apiKey && message.apiKey.length > 8
              ? `${message.apiKey.slice(0, 4)}...${message.apiKey.slice(-4)}`
              : message.provider.apiKeyPreview;
          setTimeout(
            () =>
              this.emit({
                type: "provider.saved",
                id: message.id,
                provider: {
                  ...message.provider,
                  id: providerId,
                  name,
                  apiKeyRef: message.apiKey ? `env:CODEX_UI_PROVIDER_${providerId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY` : message.provider.apiKeyRef,
                  apiKeyPreview: preview,
                  apiKeyStorage: message.apiKey ? "keyring" : message.provider.apiKeyStorage ?? "none",
                  createdAt: message.provider.createdAt || Date.now(),
                  updatedAt: Date.now()
                }
              }),
            0
          );
          return;
        }
        if (message.type === "provider.activate" && message.id) {
          const activationDelayMs = Number((window as unknown as { __codexUiProviderActivationDelayMs?: number }).__codexUiProviderActivationDelayMs) || 0;
          setTimeout(
            () =>
              this.emit({
                type: "provider.activated",
                id: message.id,
                activation: {
                  providerId: message.providerId ?? "hubproxy-grok",
                  modelProvider: message.providerId ?? "hubproxy-grok",
                  model: message.model ?? "codex",
                  groupId: message.groupId,
                  restartedAt: Date.now()
                }
              }),
            activationDelayMs
          );
          return;
        }
        if (message.type !== "rpc" || !message.id) {
          return;
        }
        if (message.method === "command/exec") {
          const execParams = message.params as { processId?: string; command?: string[] } | undefined;
          const processId = execParams?.processId;
          if (processId) {
            this.commandExecRequests.set(processId, message.id);
            const script = execParams?.command?.join(" ") ?? "";
            setTimeout(() => {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "command/exec/outputDelta",
                  params: {
                    processId,
                    stream: "stdout",
                    deltaBase64: btoa("terminal-ready\n"),
                    capReached: false
                  }
                }
              });
            }, 0);
            // 普通短命令秒退（exit 0）；sleep 类长任务保持运行，供 Resize/Terminate 用例使用。
            if (!script.includes("sleep")) {
              const execRequestId = message.id;
              setTimeout(() => {
                this.emit({ type: "rpc.result", id: execRequestId, result: { exitCode: 0, stdout: "", stderr: "" } });
              }, 50);
            }
          }
          return;
        }
        if (message.method === "command/exec/write") {
          const params = message.params as { processId?: string; deltaBase64?: string } | undefined;
          if (params?.processId && params.deltaBase64) {
            const input = atob(params.deltaBase64);
            setTimeout(() => {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "command/exec/outputDelta",
                  params: {
                    processId: params.processId,
                    stream: "stdout",
                    deltaBase64: btoa(`stdin:${input}`),
                    capReached: false
                  }
                }
              });
            }, 0);
          }
          setTimeout(() => this.emit({ type: "rpc.result", id: message.id, result: {} }), 0);
          return;
        }
        if (message.method === "command/exec/resize") {
          setTimeout(() => this.emit({ type: "rpc.result", id: message.id, result: {} }), 0);
          return;
        }
        if (message.method === "command/exec/terminate") {
          const processId = (message.params as { processId?: string } | undefined)?.processId;
          const execRequestId = processId ? this.commandExecRequests.get(processId) : null;
          setTimeout(() => {
            this.emit({ type: "rpc.result", id: message.id, result: {} });
            if (execRequestId) {
              this.emit({ type: "rpc.result", id: execRequestId, result: { exitCode: 143, stdout: "", stderr: "" } });
            }
          }, 0);
          return;
        }
        if (message.method === "terminal/create") {
          const params = message.params as { cwd?: string; cols?: number; rows?: number } | undefined;
          this.ptyTerminalCount += 1;
          const terminalId = `pty-test-${this.ptyTerminalCount}`;
          setTimeout(() => {
            this.emit({
              type: "rpc.result",
              id: message.id,
              result: {
                id: terminalId,
                cwd: params?.cwd ?? "/root/projects",
                cols: params?.cols ?? 80,
                rows: params?.rows ?? 24,
                status: "running",
                createdAt: Date.now()
              }
            });
            this.emit({
              type: "codex.notification",
              message: {
                method: "terminal/data",
                params: { terminalId, chunkBase64: btoa("pty-ready\r\n") }
              }
            });
          }, 0);
          return;
        }
        if (message.method === "terminal/write") {
          const params = message.params as { terminalId?: string; data?: string } | undefined;
          if (params?.terminalId && typeof params.data === "string") {
            const terminalId = params.terminalId;
            const echoed = params.data;
            setTimeout(() => {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "terminal/data",
                  params: { terminalId, chunkBase64: btoa(`echo:${echoed}`) }
                }
              });
            }, 0);
          }
          setTimeout(() => this.emit({ type: "rpc.result", id: message.id, result: {} }), 0);
          return;
        }
        if (message.method === "terminal/resize") {
          setTimeout(() => this.emit({ type: "rpc.result", id: message.id, result: {} }), 0);
          return;
        }
        if (message.method === "terminal/kill") {
          const terminalId = (message.params as { terminalId?: string } | undefined)?.terminalId;
          setTimeout(() => {
            this.emit({ type: "rpc.result", id: message.id, result: {} });
            if (terminalId) {
              this.emit({
                type: "codex.notification",
                message: { method: "terminal/exit", params: { terminalId, exitCode: 143 } }
              });
            }
          }, 0);
          return;
        }
        if (message.method === "terminal/forget" || message.method === "terminal/read") {
          const params = message.params as { terminalId?: string } | undefined;
          setTimeout(
            () =>
              this.emit({
                type: "rpc.result",
                id: message.id,
                result: message.method === "terminal/read" ? { tail: "" } : { ok: true }
              }),
            0
          );
          void params;
          return;
        }
        const result = rpcResult(message.method ?? "", message.params);
        if (message.method === "thread/start") {
          const thread = (result as { thread?: { id?: string; preview?: string; status?: string } }).thread;
          const threadStartDelayMs = Number((window as unknown as { __codexUiThreadStartDelayMs?: number }).__codexUiThreadStartDelayMs) || 0;
          setTimeout(() => {
            this.emit({ type: "rpc.result", id: message.id, result });
            if (thread?.id) {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "thread/started",
                  params: { thread }
                }
              });
            }
          }, threadStartDelayMs);
          return;
        }
        if (message.method === "turn/interrupt") {
          const params = message.params as { threadId?: string; turnId?: string } | undefined;
          setTimeout(() => {
            this.emit({ type: "rpc.result", id: message.id, result: {} });
            if (params?.threadId && params.turnId) {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "turn/interrupted",
                  params: {
                    threadId: params.threadId,
                    turn: { id: params.turnId, threadId: params.threadId, status: "interrupted" }
                  }
                }
              });
            }
          }, 0);
          return;
        }
        if (message.method === "thread/goal/set") {
          const params = message.params as { threadId?: string; status?: string } | undefined;
          const threadId = params?.threadId ?? "thread-missing";
          const goal = (result as { goal?: Record<string, unknown> }).goal;
          setTimeout(() => {
            this.emit({ type: "rpc.result", id: message.id, result });
            if (goal) {
              this.emit({
                type: "codex.notification",
                message: { method: "thread/goal/updated", params: { goal } }
              });
            }
            if (params?.status !== "active") {
              return;
            }
            const hasClientGoalContinuation = ((window as unknown as {
              __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; input?: Array<{ text?: string }> } }>;
            }).__codexUiOutbound ?? []).some((outbound) =>
              outbound.method === "turn/start" &&
              outbound.params?.threadId === threadId &&
              outbound.params.input?.some((entry) => entry.text?.startsWith("[[codex-ultra:goal-continuation]]"))
            );
            if (hasClientGoalContinuation) {
              return;
            }
            const goalTurnIndex = ++nativeGoalTurnCount;
            const turnId = `native-goal-turn-${goalTurnIndex}`;
            const itemId = `native-goal-item-${goalTurnIndex}`;
            this.emit({
              type: "codex.notification",
              message: {
                method: "turn/started",
                params: { threadId, turn: { id: turnId, threadId, status: "inProgress" } }
              }
            });
            this.emit({
              type: "codex.notification",
              message: {
                method: "item/agentMessage/delta",
                params: { threadId, turnId, itemId, delta: `Continued native goal stage ${goalTurnIndex}.` }
              }
            });
            const goalCompletionDelayMs = Number((window as unknown as {
              __codexUiNativeGoalCompletionDelayMs?: number;
            }).__codexUiNativeGoalCompletionDelayMs) || 80;
            setTimeout(() => {
              const completedGoal = goal ? { ...goal, status: "complete", updatedAt: Math.floor(Date.now() / 1000) } : null;
              if (completedGoal) {
                threadGoals[threadId] = completedGoal as typeof threadGoals[string];
                this.emit({
                  type: "codex.notification",
                  message: { method: "thread/goal/updated", params: { goal: completedGoal } }
                });
              }
              this.emit({
                type: "codex.notification",
                message: {
                  method: "turn/completed",
                  params: { threadId, turn: { id: turnId, threadId, status: "completed" } }
                }
              });
            }, goalCompletionDelayMs);
          }, 0);
          return;
        }
        if (message.method === "turn/start") {
          const params = message.params as { threadId?: string; input?: Array<{ type?: string; text?: string; url?: string; path?: string; name?: string; detail?: string }> } | undefined;
          const threadId = params?.threadId ?? "thread-missing";
          const turnIndex = ++turnStartCount;
          const turnId = `turn-${turnIndex}`;
          const itemId = `item-${turnIndex}`;
          const inputText = params?.input?.find((entry) => entry.type === "text")?.text ?? "";
          const planContinuationPrompt = inputText.startsWith("[[codex-ultra:plan-continuation]]");
          const goalContinuationPrompt = inputText.startsWith("[[codex-ultra:goal-continuation]]");
          const planContinuationIndex = planContinuationPrompt ? ++planContinuationTurnCount : 0;
          const parallelAgentsPrompt = inputText.toLowerCase().includes("parallel agents");
          const workingStatusPrompt = inputText.toLowerCase().includes("working status probe");
          const retryStatusPrompt = inputText.toLowerCase().includes("retrying status probe");
          const backgroundRestartPrompt = inputText.toLowerCase().includes("background restart probe");
          const planRenderPrompt = inputText.toLowerCase().includes("plan render probe");
          setTimeout(() => {
            this.emit({ type: "rpc.result", id: message.id, result });
            const emitTurnStarted = () => this.emit({
              type: "codex.notification",
              message: {
                method: "turn/started",
                params: {
                  threadId,
                  turn: { id: turnId, threadId, status: "inProgress" }
                }
              }
            });
            const turnStartedDelayMs = goalContinuationPrompt
              ? Number((window as unknown as { __codexUiGoalContinuationStartedDelayMs?: number }).__codexUiGoalContinuationStartedDelayMs ?? 0)
              : 0;
            if (turnStartedDelayMs > 0) {
              setTimeout(emitTurnStarted, turnStartedDelayMs);
            } else {
              emitTurnStarted();
            }
            this.emit({
              type: "codex.notification",
              message: {
                method: "item/completed",
                params: {
                  threadId,
                  turnId,
                  item: {
                    type: "userMessage",
                    id: `${itemId}-user`,
                    content: params?.input ?? []
                  }
                }
              }
            });
            if (backgroundRestartPrompt) {
              setTimeout(() => {
                reconciledTurnsByThread.set(threadId, [
                  {
                    id: turnId,
                    threadId,
                    status: "completed",
                    startedAt: Math.floor(Date.now() / 1000) - 2,
                    completedAt: Math.floor(Date.now() / 1000),
                    items: [
                      {
                        id: `${itemId}-user`,
                        type: "userMessage",
                        content: params?.input ?? []
                      },
                      {
                        id: `${itemId}-command`,
                        type: "commandExecution",
                        status: "completed",
                        command: ["/bin/bash", "-lc", "nohup bun run launch >/tmp/server.log 2>&1 &"],
                        aggregatedOutput: "server listening"
                      }
                    ]
                  }
                ]);
              }, 500);
              return;
            }
            if (planRenderPrompt) {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "turn/plan/updated",
                  params: {
                    threadId,
                    turnId,
                    explanation: "Plan mode generated a checklist",
                    plan: [
                      { step: "Inspect plan mode protocol", status: "completed" },
                      { step: "Render plan waterfall row", status: "inProgress" },
                      { step: "Keep goal banner separate", status: "pending" }
                    ]
                  }
                }
              });
              this.emit({
                type: "codex.notification",
                message: {
                  method: "item/plan/delta",
                  params: {
                    threadId,
                    turnId,
                    itemId: `${itemId}-plan`,
                    delta: "- Confirm `/plan` uses collaborationMode\n- Verify plan delta rendering\n"
                  }
                }
              });
              this.emit({
                type: "codex.notification",
                message: {
                  method: "item/completed",
                  params: {
                    threadId,
                    turnId,
                    item: {
                      type: "plan",
                      id: `${itemId}-plan`,
                      text: "- Confirm `/plan` uses collaborationMode\n- Verify plan delta rendering\n",
                      status: "completed"
                    }
                  }
                }
              });
              this.emit({
                type: "codex.notification",
                message: {
                  method: "turn/completed",
                  params: {
                    threadId,
                    turn: { id: turnId, threadId, status: "completed" }
                  }
                }
              });
              return;
            }
            const planAutoCompleteAfter = Math.max(1, Number((window as unknown as {
              __codexUiPlanContinuationAutoCompleteAfter?: number;
            }).__codexUiPlanContinuationAutoCompleteAfter) || 1);
            if (planContinuationPrompt && planContinuationIndex >= planAutoCompleteAfter) {
              this.emit({
                type: "codex.notification",
                message: {
                  method: "item/agentMessage/delta",
                  params: {
                    turnId,
                    itemId,
                    delta: `Completed autonomous plan stage ${planContinuationIndex}.`
                  }
                }
              });
              this.emit({
                type: "codex.notification",
                message: {
                  method: "item/completed",
                  params: {
                    threadId,
                    turnId,
                    item: {
                      type: "plan",
                      id: `${itemId}-plan`,
                      text: "- Inspect the remaining context\n- Produce the final actionable plan\n- Wait for implementation confirmation\n",
                      status: "completed"
                    }
                  }
                }
              });
              this.emit({
                type: "codex.notification",
                message: {
                  method: "turn/completed",
                  params: {
                    threadId,
                    turn: { id: turnId, threadId, status: "completed" }
                  }
                }
              });
              return;
            }
            if (workingStatusPrompt || retryStatusPrompt) {
              const configuredCompletionDelay = Number((window as unknown as {
                __codexUiWorkingStatusCompletionDelayMs?: number;
              }).__codexUiWorkingStatusCompletionDelayMs);
              setTimeout(() => {
                this.emit({
                  type: "codex.notification",
                  message: {
                    method: "item/started",
                    params: {
                      threadId,
                      turnId,
                      item: {
                        type: "reasoning",
                        id: `${itemId}-reasoning`,
                        text: "Inspecting current workspace state",
                        status: "inProgress"
                      }
                    }
                  }
                });
              }, 350);
              if (retryStatusPrompt) {
                setTimeout(() => {
                  this.emit({
                    type: "codex.notification",
                    message: {
                      method: "error",
                      params: {
                        threadId,
                        turnId,
                        willRetry: true,
                        error: {
                          message: "Reconnecting... 2/5",
                          additionalDetails: "stream disconnected before completion"
                        }
                      }
                    }
                  });
                }, 450);
              }
              setTimeout(() => {
                this.emit({
                  type: "codex.notification",
                  message: {
                    method: "item/agentMessage/delta",
                    params: {
                      turnId,
                      itemId,
                      delta: "Accepted working status probe"
                    }
                  }
                });
              }, retryStatusPrompt ? 1500 : 700);
              setTimeout(() => {
                tokenTotal += 1234;
                this.emit({
                  type: "codex.notification",
                  message: {
                    method: "thread/tokenUsage/updated",
                    params: {
                      threadId,
                      turnId,
                      tokenUsage: {
                        total: {
                          totalTokens: tokenTotal,
                          inputTokens: Math.round(tokenTotal * 0.5),
                          cachedInputTokens: 100,
                          cacheWriteInputTokens: 20,
                          outputTokens: Math.round(tokenTotal * 0.35),
                          reasoningOutputTokens: Math.round(tokenTotal * 0.15)
                        },
                        last: {
                          totalTokens: 1234,
                          inputTokens: 617,
                          cachedInputTokens: 100,
                          cacheWriteInputTokens: 20,
                          outputTokens: 432,
                          reasoningOutputTokens: 185
                        },
                        modelContextWindow: 128000
                      }
                    }
                  }
                });
              }, retryStatusPrompt ? 1200 : 820);
              setTimeout(() => {
                this.emit({
                  type: "codex.notification",
                  message: {
                    method: "turn/completed",
                    params: {
                      threadId,
                      turn: { id: turnId, threadId, status: "completed" }
                    }
                  }
                });
              }, configuredCompletionDelay > 0 ? configuredCompletionDelay : retryStatusPrompt ? 1800 : 1100);
              return;
            }
            if (parallelAgentsPrompt) {
              const requestedAgentCount = /15\s*(?:个\s*)?agents?/i.test(inputText) ? 15 : 2;
              const parallelAgents = [
                {
                  id: "agent-review-thread",
                  turnId: "turn-agent-review",
                  itemId: "item-agent-review",
                  nickname: "Review",
                  role: "Reviewer",
                  text: "Review agent found missing tests for completion badges."
                },
                {
                  id: "agent-tests-thread",
                  turnId: "turn-agent-tests",
                  itemId: "item-agent-tests",
                  nickname: "Tests",
                  role: "Playwright",
                  text: "Test agent reproduced the parallel rail switching path."
                },
                ...Array.from({ length: Math.max(0, requestedAgentCount - 2) }, (_, index) => {
                  const position = index + 3;
                  return {
                    id: `agent-sort-${position}-thread`,
                    turnId: `turn-agent-sort-${position}`,
                    itemId: `item-agent-sort-${position}`,
                    nickname: `Sort ${position}`,
                    role: `Algorithm ${position}`,
                    text: `Sorting agent ${position} implemented an algorithm and printed its elapsed time.`
                  };
                })
              ];
              const receiverThreadIds = parallelAgents.map((agent) => agent.id);
              const parallelAgentMockState = {
                requestedAgentCount,
                scheduledAgentCount: parallelAgents.length,
                emittedAgentCount: 0,
                emittedOnLatestSocketCount: 0,
                socketCountAtStart: sockets.length
              };
              (window as unknown as {
                __codexUiParallelAgentMockState?: typeof parallelAgentMockState;
              }).__codexUiParallelAgentMockState = parallelAgentMockState;
              const runningAgentStates = Object.fromEntries(parallelAgents.map((agent) => [agent.id, {
                status: "running",
                message: `working as ${agent.role}`
              }]));
              const completionDelayMs = Math.max(120, Number((window as unknown as {
                __codexUiParallelAgentCompletionDelayMs?: number;
              }).__codexUiParallelAgentCompletionDelayMs) || 120);
              const streamBurstCount = Math.max(0, Math.floor(Number((window as unknown as {
                __codexUiParallelAgentStreamBurstCount?: number;
              }).__codexUiParallelAgentStreamBurstCount) || 0));
              const streamBurstIntervalMs = Math.max(16, Math.floor(Number((window as unknown as {
                __codexUiParallelAgentStreamBurstIntervalMs?: number;
              }).__codexUiParallelAgentStreamBurstIntervalMs) || 40));
              this.emit({
                type: "codex.notification",
                message: {
                  method: "item/started",
                  params: {
                    threadId,
                    turnId,
                    startedAtMs: Date.now(),
                    item: {
                      type: "collabAgentToolCall",
                      id: `${itemId}-spawn`,
                      tool: "spawnAgent",
                      status: "inProgress",
                      senderThreadId: threadId,
                      receiverThreadIds,
                      prompt: "Split the implementation into review and test agents",
                      model: "gpt-5.6-sol",
                      reasoningEffort: "medium",
                      agentsStates: runningAgentStates
                    }
                  }
                }
              });
              parallelAgents.forEach((agent, index) => {
                setTimeout(() => {
                  parallelAgentMockState.emittedAgentCount += 1;
                  if (sockets.at(-1) === this) parallelAgentMockState.emittedOnLatestSocketCount += 1;
                  this.emit({
                    type: "codex.notification",
                    message: {
                      method: "thread/started",
                      params: {
                        thread: {
                          id: agent.id,
                          parentThreadId: threadId,
                          preview: `${agent.nickname} agent`,
                          agentNickname: agent.nickname,
                          agentRole: agent.role,
                          status: "running"
                        }
                      }
                    }
                  });
                  this.emit({
                    type: "codex.notification",
                    message: {
                      method: "turn/started",
                      params: {
                        threadId: agent.id,
                        turn: { id: agent.turnId, threadId: agent.id, status: "inProgress" }
                      }
                    }
                  });
                  this.emit({
                    type: "codex.notification",
                    message: {
                      method: "item/agentMessage/delta",
                      params: {
                        threadId: agent.id,
                        turnId: agent.turnId,
                        itemId: agent.itemId,
                        delta: agent.text
                      }
                    }
                  });
                  let streamBurstIndex = 0;
                  const emitStreamBurst = () => {
                    streamBurstIndex += 1;
                    if (streamBurstIndex > streamBurstCount || streamBurstIndex * streamBurstIntervalMs >= completionDelayMs) return;
                    this.emit({
                      type: "codex.notification",
                      message: {
                        method: "item/agentMessage/delta",
                        params: {
                          threadId: agent.id,
                          turnId: agent.turnId,
                          itemId: agent.itemId,
                          delta: "."
                        }
                      }
                    });
                    setTimeout(emitStreamBurst, streamBurstIntervalMs);
                  };
                  if (streamBurstCount > 0) setTimeout(emitStreamBurst, streamBurstIntervalMs);
                  setTimeout(() => {
                    this.emit({
                      type: "codex.notification",
                      message: {
                        method: "item/completed",
                        params: {
                          threadId: agent.id,
                          turnId: agent.turnId,
                          completedAtMs: Date.now(),
                          item: {
                            type: "agentMessage",
                            id: agent.itemId,
                            text: agent.text,
                            phase: null,
                            memoryCitation: null
                          }
                        }
                      }
                    });
                    this.emit({
                      type: "codex.notification",
                      message: {
                        method: "turn/completed",
                        params: {
                          threadId: agent.id,
                          turn: { id: agent.turnId, threadId: agent.id, status: "completed" }
                        }
                      }
                    });
                  }, completionDelayMs);
                }, 40 + index * 20);
              });
              setTimeout(() => {
                this.emit({
                  type: "codex.notification",
                  message: {
                    method: "item/completed",
                    params: {
                      threadId,
                      turnId,
                      completedAtMs: Date.now(),
                      item: {
                        type: "collabAgentToolCall",
                        id: `${itemId}-spawn`,
                        tool: "spawnAgent",
                        status: "completed",
                        senderThreadId: threadId,
                        receiverThreadIds,
                        prompt: "Split the implementation into review and test agents",
                        model: "gpt-5.6-sol",
                        reasoningEffort: "medium",
                        agentsStates: Object.fromEntries(parallelAgents.map((agent) => [agent.id, {
                          status: "completed",
                          message: `${agent.nickname} complete`
                        }]))
                      }
                    }
                  }
                });
                this.emit({
                  type: "codex.notification",
                  message: {
                    method: "turn/completed",
                    params: {
                      threadId,
                      turn: { id: turnId, threadId, status: "completed" }
                    }
                  }
                });
              }, completionDelayMs + 160);
              return;
            }
            this.emit({
              type: "codex.notification",
              message: {
                method: "item/agentMessage/delta",
                params: {
                  turnId,
                  itemId,
                  delta: goalContinuationPrompt
                    ? "Continued persisted goal with the restored tools."
                    : planContinuationPrompt
                      ? `Continued autonomous plan stage ${planContinuationIndex}.`
                      : `Accepted ${inputText}`
                }
              }
            });
            const completionDelayMs = goalContinuationPrompt
              ? Math.max(250, Number((window as unknown as {
                  __codexUiGoalContinuationCompletionDelayMs?: number;
                }).__codexUiGoalContinuationCompletionDelayMs) || 250)
              : 250;
            setTimeout(() => {
              tokenTotal += 1234;
              this.emit({
                type: "codex.notification",
                message: {
                  method: "thread/tokenUsage/updated",
                  params: {
                    threadId,
                    turnId,
                    tokenUsage: {
                      total: {
                        totalTokens: tokenTotal,
                        inputTokens: Math.round(tokenTotal * 0.5),
                        cachedInputTokens: 100,
                        cacheWriteInputTokens: 20,
                        outputTokens: Math.round(tokenTotal * 0.35),
                        reasoningOutputTokens: Math.round(tokenTotal * 0.15)
                      },
                      last: {
                        totalTokens: 1234,
                        inputTokens: 617,
                        cachedInputTokens: 100,
                        cacheWriteInputTokens: 20,
                        outputTokens: 432,
                        reasoningOutputTokens: 185
                      },
                      modelContextWindow: 128000
                    }
                  }
                }
              });
              this.emit({
                type: "codex.notification",
                message: {
                  method: "turn/completed",
                  params: {
                    threadId,
                    turn: { id: turnId, threadId, status: "completed" }
                  }
                }
              });
            }, completionDelayMs);
          }, 0);
          return;
        }
        setTimeout(() => this.emit({ type: "rpc.result", id: message.id, result }), 0);
      }

      public close(): void {
        this.readyState = MockWebSocket.CLOSED;
        const event = new CloseEvent("close");
        this.dispatchEvent(event);
        this.onclose?.(event);
      }

      private emit(value: unknown): void {
        const event = new MessageEvent("message", { data: JSON.stringify(value) });
        this.dispatchEvent(event);
        this.onmessage?.(event);
      }
    }

    let skillExtraRoots: string[] = [];
    const threadGoals: Record<
      string,
      {
        threadId: string;
        objective: string;
        status: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
        tokenBudget: number | null;
        tokensUsed: number;
        timeUsedSeconds: number;
        createdAt: number;
        updatedAt: number;
      }
    > = {};
    const virtualFiles: Record<string, string> = {
      "/root/projects/README.md": "# Mock Project\n\nEditable from Playwright.\n",
      "/root/projects/logo.png": "",
      "/root/projects/src/App.tsx": "export const value = 1;\n"
    };
    let mockGitEntries = [
      {
        path: "README.md",
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false
      }
    ];
    const engineConfig: Record<string, unknown> = {
      model: "gpt-5.6-sol",
      review_model: "gpt-5.6-sol",
      model_provider: "openai",
      model_reasoning_effort: "medium",
      model_reasoning_summary: "auto",
      model_verbosity: "medium",
      approval_policy: "on-request",
      sandbox_mode: "workspace-write",
      web_search: "cached",
      service_tier: "default",
      instructions: "Be precise.",
      developer_instructions: "Prefer workspace-write tools.",
      history: {
        persistence: "save-all",
        max_bytes: 1048576
      },
      tui: {
        animations: true,
        alternate_screen: "auto"
      },
      memories: {
        generate_memories: true,
        max_rollouts_per_startup: 4
      },
      features: {
        web_search_request: true
      },
      runtime_only_config: {
        enabled: true
      }
    };
    const installedPlugin = {
      id: "mock-plugin@mock-market",
      remotePluginId: "remote-mock",
      name: "mock-plugin",
      version: "1.0.0",
      localVersion: "1.0.0",
      shareContext: null,
      source: { type: "remote" },
      installed: true,
      enabled: true,
      installPolicy: "AVAILABLE",
      installPolicySource: null,
      authPolicy: "ON_USE",
      availability: "AVAILABLE",
      interface: {
        displayName: "Mock Plugin",
        shortDescription: "Mock plugin",
        longDescription: null,
        developerName: "Mock Dev",
        category: "Search",
        capabilities: ["search"],
        websiteUrl: "https://example.test/mock-plugin",
        privacyPolicyUrl: null,
        termsOfServiceUrl: null,
        defaultPrompt: ["Search the mock catalog"],
        brandColor: null,
        composerIcon: null,
        composerIconUrl: null,
        logo: null,
        logoDark: null,
        logoUrl: null,
        logoUrlDark: null,
        screenshots: [],
        screenshotUrls: []
      },
      keywords: []
    };
    const authPlugin = {
      id: "auth-plugin@mock-market",
      remotePluginId: "remote-auth",
      name: "auth-plugin",
      version: "1.0.0",
      localVersion: null,
      shareContext: null,
      source: { type: "remote" },
      installed: false,
      enabled: false,
      installPolicy: "AVAILABLE",
      installPolicySource: null,
      authPolicy: "ON_INSTALL",
      availability: "AVAILABLE",
      interface: {
        displayName: "Auth Plugin",
        shortDescription: "Needs auth",
        longDescription: null,
        developerName: "Auth Dev",
        category: "Productivity",
        capabilities: ["calendar"],
        websiteUrl: null,
        privacyPolicyUrl: null,
        termsOfServiceUrl: null,
        defaultPrompt: null,
        brandColor: null,
        composerIcon: null,
        composerIconUrl: null,
        logo: null,
        logoDark: null,
        logoUrl: null,
        logoUrlDark: null,
        screenshots: [],
        screenshotUrls: []
      },
      keywords: []
    };
    let mockThreadRows: Array<Record<string, string | number>> = [
      { id: "thread-1", name: "Mock thread", preview: "Mock thread preview", status: "idle", cwd: "/root/projects", source: "cli", updatedAt: 1710000030, recencyAt: 1710000030 },
      { id: "thread-2", preview: "Second task", status: "idle", cwd: "/root/projects/codex-react-ui", source: "appServer", updatedAt: 1710000010, recencyAt: 1710000010 },
      { id: "thread-3", name: "Third task", preview: "Third task", status: "idle", cwd: "/root/projects/third", source: "cli", updatedAt: 1710000005, recencyAt: 1710000005 },
      {
        id: "019c2d47-4935-7423-a190-05691f566092",
        name: "Session Index Title",
        preview: "rollout preview fallback",
        status: "idle",
        cwd: "/root/projects/indexed",
        source: "vscode",
        modelProvider: "openai",
        createdAt: 1709900000,
        updatedAt: 1710000020,
        recencyAt: 1710000020
      }
    ];

    function rpcResult(method: string, params?: unknown): unknown {
      switch (method) {
        case "account/read":
          return { authMode: "mock" };
        case "config/read":
          return {
            config: { ...engineConfig },
            origins: {},
            layers: null
          };
        case "config/value/write": {
          const writeParams = params as { keyPath?: string; value?: unknown } | undefined;
          if (writeParams?.keyPath) {
            setConfigAtPath(engineConfig, writeParams.keyPath, writeParams.value);
          }
          return {};
        }
        case "config/batchWrite": {
          const batchParams = params as {
            edits?: Array<{ keyPath?: string; value?: unknown }>;
            reloadUserConfig?: boolean;
          } | undefined;
          for (const edit of batchParams?.edits ?? []) {
            if (edit.keyPath) {
              setConfigAtPath(engineConfig, edit.keyPath, edit.value);
            }
          }
          return { reloaded: Boolean(batchParams?.reloadUserConfig) };
        }
        case "model/list":
          return {
            data: [
              {
                model: "gpt-5.6-sol",
                displayName: "GPT 5.6 Sol",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "Fast low effort" },
                  { reasoningEffort: "medium", description: "Balanced effort" },
                  { reasoningEffort: "high", description: "Deep effort" }
                ]
              }
            ]
          };
        case "thread/list":
          {
            const injectedRows = (window as unknown as { __codexUiMockThreadRows?: Array<Record<string, string | number>> }).__codexUiMockThreadRows;
            const availableRows = Array.isArray(injectedRows) ? injectedRows : mockThreadRows;
            const searchTerm = typeof (params as { searchTerm?: unknown } | undefined)?.searchTerm === "string" ? String((params as { searchTerm?: string }).searchTerm).toLowerCase() : "";
            const filtered = searchTerm
              ? availableRows.filter((row) =>
                  [row.name, row.preview, row.cwd, row.source, row.modelProvider, row.id]
                    .filter((value): value is string => typeof value === "string")
                    .some((value) => value.toLowerCase().includes(searchTerm))
                )
              : availableRows;
            return { data: filtered };
          }
        case "thread/read": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "thread-1";
          const injectedRows = (window as unknown as { __codexUiMockThreadRows?: Array<Record<string, string | number>> }).__codexUiMockThreadRows;
          const row = (Array.isArray(injectedRows) ? injectedRows : mockThreadRows).find((entry) => entry.id === threadId);
          const largeHistory = Boolean((window as unknown as { __codexUiMockLargeHistory?: boolean }).__codexUiMockLargeHistory) && threadId === "thread-2";
          return {
            thread: {
              id: threadId,
              name: typeof row?.name === "string" ? row.name : undefined,
              preview: typeof row?.preview === "string" ? row.preview : undefined,
              status: typeof row?.status === "string" ? row.status : "idle",
              cwd: typeof row?.cwd === "string" ? row.cwd : "/root/projects",
              source: typeof row?.source === "string" ? row.source : "cli",
              path: largeHistory ? "C:\\mock\\large-rollout.jsonl" : undefined,
              updatedAt: typeof row?.updatedAt === "number" ? row.updatedAt : 1710000020,
              recencyAt: typeof row?.recencyAt === "number" ? row.recencyAt : 1710000020,
              turns: threadId === "019c2d47-4935-7423-a190-05691f566092"
                ? [
                    {
                      id: "indexed-history-turn",
                      threadId,
                      status: "completed",
                      startedAt: 1710000000,
                      completedAt: 1710000001,
                      items: [
                        { id: "indexed-history-user", type: "userMessage", content: [{ type: "text", text: "Indexed history prompt" }] },
                        { id: "indexed-history-agent", type: "agentMessage", text: "Indexed history response" }
                      ]
                    }
                  ]
                : reconciledTurnsByThread.get(threadId) ?? []
            }
          };
        }
        case "thread/history/fileInfo":
          return { path: "C:\\mock\\large-rollout.jsonl", sizeBytes: 1024 ** 3 + 1 };
        case "thread/history/tail": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "thread-2";
          return {
            thread: {
              id: threadId,
              name: "Second task",
              path: "C:\\mock\\large-rollout.jsonl",
              turns: [{
                id: "tail-turn",
                status: "completed",
                items: [{ id: "tail-user", type: "userMessage", content: [{ type: "text", text: "Recovered from the last 10 MiB" }] }]
              }]
            },
            tail: { sizeBytes: 1024 ** 3 + 1, loadedBytes: 10 * 1024 ** 2, requestedBytes: 10 * 1024 ** 2, truncated: true }
          };
        }
        case "thread/start": {
          const id = `thread-new-${++threadStartCount}`;
          return { thread: { id, preview: `New mock thread ${threadStartCount}`, status: "idle" } };
        }
        case "thread/name/set": {
          const nameParams = params as { threadId?: string; name?: string } | undefined;
          mockThreadRows = mockThreadRows.map((row) =>
            row.id === nameParams?.threadId ? { ...row, name: nameParams.name ?? row.name, updatedAt: 1710000040, recencyAt: 1710000040 } : row
          );
          return {};
        }
        case "thread/archive": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId;
          mockThreadRows = mockThreadRows.filter((row) => row.id !== threadId);
          return {};
        }
        case "thread/delete": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId;
          mockThreadRows = mockThreadRows.filter((row) => row.id !== threadId);
          return {};
        }
        case "review/start": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "thread-1";
          return {
            turn: { id: `review-turn-${Date.now()}`, threadId, status: "inProgress" },
            reviewThreadId: threadId
          };
        }
        case "gitDiffToRemote":
          return {
            sha: "abc123def456",
            diff: "diff --git a/README.md b/README.md\n+Slash command diff preview"
          };
        case "thread/compact/start":
          return {};
        case "thread/resume": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "thread-1";
          const injectedRows = (window as unknown as { __codexUiMockThreadRows?: Array<Record<string, string | number>> }).__codexUiMockThreadRows;
          const row = (Array.isArray(injectedRows) ? injectedRows : mockThreadRows).find((entry) => entry.id === threadId);
          const resumeTurns =
            threadId === "019c2d47-4935-7423-a190-05691f566092"
              ? [
                  {
                    id: "resume-history-turn",
                    threadId,
                    status: "completed",
                    startedAt: 1710000000,
                    completedAt: 1710000001,
                    items: [
                      { id: "resume-history-user", type: "userMessage", content: [{ type: "text", text: "Resume history prompt" }] },
                      { id: "resume-history-agent", type: "agentMessage", text: "Resume history response" }
                    ]
                  }
                ]
              : undefined;
          return {
            thread: {
              id: threadId,
              name: typeof row?.name === "string" ? row.name : undefined,
              preview: typeof row?.preview === "string" ? row.preview : undefined,
              status: typeof row?.status === "string" ? row.status : "idle",
              cwd: typeof row?.cwd === "string" ? row.cwd : "/root/projects",
              source: typeof row?.source === "string" ? row.source : "cli",
              turns: resumeTurns
            },
            model: "gpt-5.6-sol",
            modelProvider: "openai",
            serviceTier: null,
            cwd: typeof row?.cwd === "string" ? row.cwd : "/root/projects",
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "appServer",
            sandbox: { type: "workspaceWrite", writableRoots: ["/root/projects"], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
            reasoningEffort: "medium"
          };
        }
        case "thread/goal/set": {
          const goalParams = params as { threadId?: string; objective?: string | null; status?: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete" | null; tokenBudget?: number | null } | undefined;
          const threadId = goalParams?.threadId ?? "thread-missing";
          const existing = threadGoals[threadId];
          const now = Math.floor(Date.now() / 1000);
          const goal = {
            threadId,
            objective: goalParams?.objective ?? existing?.objective ?? "Mock goal",
            status: goalParams?.status ?? existing?.status ?? "active",
            tokenBudget: goalParams && "tokenBudget" in goalParams ? goalParams.tokenBudget ?? null : existing?.tokenBudget ?? null,
            tokensUsed: existing?.tokensUsed ?? 0,
            timeUsedSeconds: existing?.timeUsedSeconds ?? 0,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
          };
          threadGoals[threadId] = goal;
          const injectedGoals = (window as unknown as {
            __codexUiGoalByThread?: Record<string, typeof threadGoals[string]>;
          }).__codexUiGoalByThread;
          if (injectedGoals?.[threadId]) {
            injectedGoals[threadId] = goal;
          }
          return { goal };
        }
        case "thread/goal/get": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "";
          const injectedGoals = (window as unknown as {
            __codexUiGoalByThread?: Record<string, typeof threadGoals[string]>;
          }).__codexUiGoalByThread;
          return { goal: injectedGoals?.[threadId] ?? threadGoals[threadId] ?? null };
        }
        case "thread/goal/clear": {
          const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "";
          delete threadGoals[threadId];
          return { cleared: true };
        }
        case "turn/start":
          return {};
        case "mcpServerStatus/list":
          return {
            data: [
              {
                name: "mock-mcp",
                serverInfo: { name: "mock", version: "1.0.0" },
                authStatus: "unsupported",
                tools: {
                  ping: {
                    name: "ping",
                    title: "Ping",
                    description: "Ping tool",
                    inputSchema: {
                      type: "object",
                      properties: {
                        message: { type: "string", default: "hello" }
                      }
                    },
                    outputSchema: {
                      type: "object",
                      properties: {
                        ok: { type: "boolean" }
                      }
                    }
                  }
                },
                resources: [{ name: "readme", title: "Readme", uri: "mock://readme", description: "Mock resource" }],
                resourceTemplates: []
              }
            ],
            nextCursor: null
          };
        case "mcpServer/tool/call":
          return {
            content: [{ type: "text", text: "pong" }],
            structuredContent: {
              ok: true,
              echo: (params as { arguments?: { message?: string } } | undefined)?.arguments ?? null
            },
            _meta: null
          };
        case "skills/list":
          return {
            data: [
              {
                cwd: "/root/projects",
                skills: [{ name: "mock-skill", description: "Mock skill", path: "/tmp/mock/SKILL.md", scope: "user", enabled: true }],
                errors: []
              },
              ...skillExtraRoots.map((cwd) => ({
                cwd,
                skills: [{ name: "extra-skill", description: "Extra skill", path: `${cwd}/SKILL.md`, scope: "user", enabled: true }],
                errors: []
              }))
            ]
          };
        case "skills/extraRoots/set":
          skillExtraRoots = Array.isArray((params as { extraRoots?: string[] } | undefined)?.extraRoots)
            ? ((params as { extraRoots?: string[] }).extraRoots ?? []).map(String)
            : [];
          return {};
        case "hooks/list":
          return {
            data: [
              {
                cwd: "/root/projects",
                hooks: [
                  {
                    key: "/root/.codex/config.toml:pre_tool_use:0:0",
                    eventName: "pre_tool_use",
                    handlerType: "command",
                    matcher: "Bash",
                    command: "python3 /root/hooks/pre_tool_use.py",
                    timeoutSec: 5,
                    statusMessage: "checking command",
                    sourcePath: "/root/.codex/config.toml",
                    source: "user",
                    pluginId: null,
                    displayOrder: 0,
                    enabled: true,
                    isManaged: false,
                    currentHash: "sha256:mock-user-hook",
                    trustStatus: "trusted"
                  },
                  {
                    key: "plugin://mock-plugin@mock-market:post_turn:0:0",
                    eventName: "post_turn",
                    handlerType: "command",
                    matcher: null,
                    command: "node mock-plugin/hook.js",
                    timeoutSec: 10,
                    statusMessage: "sync plugin state",
                    sourcePath: "/root/.codex/plugins/mock-plugin/plugin.json",
                    source: "plugin",
                    pluginId: "mock-plugin@mock-market",
                    displayOrder: 1,
                    enabled: false,
                    isManaged: true,
                    currentHash: "sha256:mock-plugin-hook",
                    trustStatus: "untrusted"
                  }
                ],
                warnings: ["Mock hook warning"],
                errors: [{ path: "/root/projects/.codex/hooks.toml", message: "Mock hook parse warning" }]
              }
            ]
          };
        case "fs/readFile":
          if ((params as { path?: string } | undefined)?.path === "/tmp/mock/SKILL.md") {
            return {
              dataBase64: btoa("# Mock Skill\n\nLocal preview from Playwright.")
            };
          }
          return {
            dataBase64: btoa(virtualFiles[(params as { path?: string } | undefined)?.path ?? ""] ?? "")
          };
        case "fs/readDirectory": {
          const path = (params as { path?: string } | undefined)?.path ?? "/root/projects";
          const entries =
            path === "/root"
              ? [{ fileName: "projects", isDirectory: true, isFile: false }]
              : path === "/root/projects"
              ? [
                  { fileName: "src", isDirectory: true, isFile: false },
                  { fileName: "README.md", isDirectory: false, isFile: true },
                  { fileName: "logo.png", isDirectory: false, isFile: true }
                ]
              : path === "/root/projects/src"
                ? [{ fileName: "App.tsx", isDirectory: false, isFile: true }]
                : [];
          return { entries };
        }
        case "fs/writeFile": {
          const path = (params as { path?: string } | undefined)?.path;
          const dataBase64 = (params as { dataBase64?: string } | undefined)?.dataBase64;
          if (path && dataBase64) {
            virtualFiles[path] = atob(dataBase64);
          }
          return {};
        }
        case "ui/git/status":
          return {
            isRepository: true,
            repoRoot: "/root/projects",
            branch: "main",
            upstream: "origin/main",
            ahead: 1,
            behind: 0,
            entries: mockGitEntries
          };
        case "ui/git/diff":
          return {
            path: (params as { path?: string } | undefined)?.path ?? "",
            staged: (params as { staged?: boolean } | undefined)?.staged === true,
            patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Mock Project\n+# Mock Project Updated"
          };
        case "ui/git/history":
          return {
            repoRoot: "/root/projects",
            commits: [
              {
                sha: "0123456789abcdef",
                shortSha: "0123456",
                author: "Codex",
                email: "codex@example.test",
                timestamp: 1767225600,
                subject: "Add Git review",
                refs: ["HEAD -> main"]
              }
            ]
          };
        case "ui/git/show":
          return {
            repoRoot: "/root/projects",
            sha: "0123456789abcdef",
            patch: "commit 0123456789abcdef\nAuthor: Codex\n\n    Add Git review\n\ndiff --git a/README.md b/README.md\n+# Git history detail"
          };
        case "ui/git/stage": {
          const paths = (params as { paths?: string[] } | undefined)?.paths ?? [];
          mockGitEntries = mockGitEntries.map((entry) =>
            paths.includes(entry.path)
              ? { ...entry, indexStatus: "M", worktreeStatus: " ", staged: true, unstaged: false }
              : entry
          );
          return {
            isRepository: true,
            repoRoot: "/root/projects",
            branch: "main",
            upstream: "origin/main",
            ahead: 1,
            behind: 0,
            entries: mockGitEntries
          };
        }
        case "ui/git/unstage": {
          const paths = (params as { paths?: string[] } | undefined)?.paths ?? [];
          mockGitEntries = mockGitEntries.map((entry) =>
            paths.includes(entry.path)
              ? { ...entry, indexStatus: " ", worktreeStatus: "M", staged: false, unstaged: true }
              : entry
          );
          return {
            isRepository: true,
            repoRoot: "/root/projects",
            branch: "main",
            upstream: "origin/main",
            ahead: 1,
            behind: 0,
            entries: mockGitEntries
          };
        }
        case "ui/git/discard":
          mockGitEntries = [];
          return {
            isRepository: true,
            repoRoot: "/root/projects",
            branch: "main",
            upstream: "origin/main",
            ahead: 1,
            behind: 0,
            entries: mockGitEntries
          };
        case "ui/git/commit":
          mockGitEntries = [];
          return {
            message: "[main 0123456] Mock commit",
            status: {
              isRepository: true,
              repoRoot: "/root/projects",
              branch: "main",
              upstream: "origin/main",
              ahead: 2,
              behind: 0,
              entries: mockGitEntries
            }
          };
        case "plugin/list":
          return {
            marketplaces: [{ name: "mock-market", path: null, interface: { displayName: "Mock Market" }, plugins: [installedPlugin, authPlugin] }],
            marketplaceLoadErrors: [],
            featuredPluginIds: ["mock-plugin@mock-market"]
          };
        case "plugin/installed":
          return {
            marketplaces: [{ name: "mock-market", path: null, interface: { displayName: "Mock Market" }, plugins: [installedPlugin] }],
            marketplaceLoadErrors: []
          };
        case "plugin/read":
          return {
            plugin: {
              marketplaceName: "mock-market",
              marketplacePath: null,
              summary: installedPlugin,
              shareUrl: "https://example.test/share/mock-plugin",
              description: "Detailed mock plugin description.",
              skills: [{ name: "mock-skill", description: "Mock skill", enabled: true, path: "/tmp/mock/SKILL.md" }],
              hooks: [{ key: "on-turn", eventName: "turn" }],
              apps: [{ id: "mock-calendar", name: "Mock Calendar", description: "Calendar access", installUrl: "https://example.test/connect/calendar", category: "Calendar" }],
              appTemplates: [
                {
                  templateId: "calendar-template",
                  name: "Calendar Template",
                  description: "Template calendar app",
                  category: "Calendar",
                  canonicalConnectorId: "calendar",
                  logoUrl: null,
                  logoUrlDark: null,
                  materializedAppIds: ["mock-calendar"],
                  reason: null
                }
              ],
              mcpServers: ["mock-mcp"],
              scheduledTasks: []
            }
          };
        case "plugin/install":
          return {
            authPolicy: "ON_INSTALL",
            appsNeedingAuth: [{ id: "auth-console", name: "Auth Console", description: "Connect before use", installUrl: "https://example.test/connect/auth", category: "Auth" }]
          };
        case "app/list":
          return {
            data: [
              {
                id: "mock-calendar",
                name: "Mock Calendar",
                description: "Calendar access",
                logoUrl: null,
                logoUrlDark: null,
                iconAssets: null,
                iconDarkAssets: null,
                distributionChannel: "mock",
                branding: { category: "Calendar", developer: "Mock Dev", website: "https://example.test/calendar", privacyPolicy: null, termsOfService: null, isDiscoverableApp: true },
                appMetadata: null,
                labels: null,
                installUrl: "https://example.test/connect/calendar",
                isAccessible: false,
                isEnabled: true,
                pluginDisplayNames: ["Mock Plugin"]
              }
            ],
            nextCursor: null
          };
        default:
          return {};
      }
    }

    function setConfigAtPath(config: Record<string, unknown>, keyPath: string, value: unknown): void {
      const segments = keyPath.split(".").filter(Boolean);
      let cursor = config;
      segments.forEach((segment, index) => {
        if (index === segments.length - 1) {
          cursor[segment] = value;
          return;
        }
        const existing = cursor[segment];
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          cursor[segment] = {};
        }
        cursor = cursor[segment] as Record<string, unknown>;
      });
    }

    Object.defineProperty(window, "WebSocket", { value: MockWebSocket });
  });

  await page.route("/api/session", (route) => route.fulfill({ json: { token: "test-token" } }));
  await page.route("/api/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      userPreferences = { ...userPreferences, ...patch };
    }
    await route.fulfill({ json: { data: userPreferences } });
  });
  await page.route(/\/api\/thread-runtime(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PUT") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      const threadId = String(input.threadId ?? "");
      const existing = threadRuntimeMetadata[threadId];
      const now = Date.now();
      threadRuntimeMetadata[threadId] = {
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      await route.fulfill({ json: { data: threadRuntimeMetadata[threadId] } });
      return;
    }
    const threadId = new URL(route.request().url()).searchParams.get("threadId") ?? "";
    await route.fulfill({ json: { data: threadRuntimeMetadata[threadId] ?? null } });
  });
  await page.route("/api/providers", (route) => route.fulfill({ json: { data: providerApiList } }));
  await page.route("/api/workspace/roots", (route) => route.fulfill({
    json: { platform: "linux", home: "/home/tester", cwd: "/workspace", roots: [{ path: "/", label: "/" }] }
  }));
  await page.route("/api/workspace/list-directory", async (route) => {
    const body = route.request().postDataJSON() as { path?: string };
    await route.fulfill({
      json: {
        entries: body.path === "E:\\"
          ? [{ fileName: "projects", isDirectory: true, isFile: false }]
          : []
      }
    });
  });
  await page.route("/api/profile/export", (route) =>
    route.fulfill({
      json: {
        schema: "codex-react-ui.profile.v1",
        exportedAt: 123,
        providers: providerApiList.map(({ apiKeyPreview: _apiKeyPreview, ...provider }) => ({
          ...provider,
          apiKeyStorage: "none"
        }))
      }
    })
  );
  await page.route("/api/profile/import", async (route) => {
    const body = route.request().postDataJSON() as { providers?: typeof providerApiList };
    const imported = body.providers ?? [];
    providerApiList = [
      ...providerApiList.filter((provider) => !imported.some((entry) => entry.id === provider.id)),
      ...imported
    ];
    await route.fulfill({ json: { importedProviders: imported.length, providers: providerApiList } });
  });
  await page.route("/api/provider/fetch-models", async (route) => {
    const body = route.request().postDataJSON() as { baseUrl?: string; apiKey?: string; kind?: string; providerId?: string };
    providerModelFetchRequests.push(body);
    await route.fulfill({
      json: {
        endpoint: `${(body.baseUrl ?? "").replace(/\/+$/, "")}/models`,
        error: null,
        models: [
          { id: "deepseek-chat" },
          { id: "glm-4.5" },
          { id: "openai/gpt-5.5" }
        ]
      }
    });
  });
  await page.route("/api/provider/catalog/preview", async (route) => {
    catalogPreviewRequests += 1;
    await route.fulfill({
      json: {
        provider_id: "draft",
        counts: { models: 2, groups: 2, vendors: 0, endpoints: 0 },
        changes: { add: 2, update: 0, remove: 0, unchanged: 0 },
        groups: draftCatalogGroups,
        warnings: [],
        catalog: draftCapabilityCatalog
      }
    });
  });
  await page.route("/api/audit/events", (route) => route.fulfill({ json: { data: auditApiEvents } }));
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("codex-ultra.top-bar-pinned-v2", "true");
  });
});

test("renders the workbench and tooling panels", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("mock-codex")).toBeVisible();
  await expect(page.getByRole("tab", { name: "New task" })).toBeVisible();
  await expect(page.getByTestId("task-tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Second task" })).toHaveCount(0);
  await expect(page.getByTestId("right-workspace-panel")).toHaveCount(0);

  await page.getByLabel("Open right workspace").click();
  await expect(page.getByTestId("right-workspace-panel")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Side chat" }).first()).toBeVisible();
  // 服务器浏览器版无内嵌 Browser 页签（仅 Windows 桌面端保留）。
  await expect(page.getByRole("tab", { name: "Browser" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Terminal" })).toBeVisible();

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Plugins settings").click();
  await page.getByRole("tab", { name: "MCP 1" }).click();
  await expect(page.getByText("mock-mcp")).toBeVisible();

  await page.getByLabel("Open Skills settings").click();
  await expect(page.getByText("mock-skill")).toBeVisible();

  await page.getByLabel("Open Plugins settings").click();
  await page.getByRole("tab", { name: "Marketplace 2" }).click();
  await expect(page.getByRole("heading", { name: "Mock Plugin" })).toBeVisible();
});

test("shows working status while a turn is pending or thinking", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __codexUiWorkingStatusCompletionDelayMs?: number }).__codexUiWorkingStatusCompletionDelayMs = 10_000;
  });

  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("working status probe");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const indicator = page.getByTestId("composer-working-indicator");
  await expect(indicator).toContainText("Working");
  await expect(indicator).toContainText(/Working \d+s/);
  await expect(indicator).not.toContainText(/background terminals running/);
  await expect(indicator).not.toHaveAttribute("aria-label", /\/ps to view/);
  await expect(indicator).toHaveAttribute("aria-label", /\/stop to interrupt/);
  await expect(indicator).toContainText("Working");
  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("append while model is running");
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await page.waitForFunction(() => {
    const outbound = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ type?: string; text?: string }> } }> }).__codexUiOutbound ?? [];
    return outbound.some((message) => message.method === "turn/steer" && message.params?.input?.some((entry) => entry.type === "text" && entry.text === "append while model is running"));
  });
  await composer.press("Escape");
  await page.waitForFunction(() => {
    const outbound = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    return outbound.some((message) => message.method === "turn/interrupt");
  });
  const acceptedResponse = page.getByTestId("workbench-item-agentMessage").filter({ hasText: "Accepted working status probe" });
  await expect(acceptedResponse.getByText("Accepted working status probe")).toBeVisible();
  await expect(acceptedResponse.getByTestId("assistant-message-started-at")).toContainText(/\d{2}:\d{2}/);
  await expect(acceptedResponse.getByTestId("assistant-first-token")).toContainText(/first \d+(\.\d)?s/);
  await expect(acceptedResponse.getByTestId("assistant-token-usage")).toContainText(/in 617 · out 432 · hit 16\.2% · \d+(\.\d+)? tok\/s/);
  await expect(acceptedResponse.getByTestId("assistant-usage-details")).toHaveCount(0);
  await expect(page.getByTestId("history-sidebar")).toContainText(/cost \$\d+\.\d+/);
  await expect(page.getByText("completed", { exact: true })).toHaveCount(0);
  await expect(indicator).toHaveCount(0);
  await expect(acceptedResponse.getByTestId("assistant-message-header")).toHaveAttribute("data-live", "false");
});

test("Enter immediately steers a running turn", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const steerButton = page.getByRole("button", { name: "Steer", exact: true });
  await expect(steerButton).toHaveCount(0);
  await composer.fill("working status probe");
  await composer.press("Enter");
  await expect(page.getByTestId("composer-working-indicator")).toBeVisible();
  await expect(steerButton).toBeVisible();

  await composer.fill("append while model is running");
  await composer.press("Enter");
  const pendingAppend = page.getByTestId("workbench-item-pendingAppend").filter({ hasText: "append while model is running" });
  await expect(pendingAppend).toContainText("append while model is running");
  await expect(page.getByText("Queued", { exact: true })).toHaveCount(0);
  await page.waitForFunction(() => {
    const outbound = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ type?: string; text?: string }> } }>;
    }).__codexUiOutbound ?? [];
    return outbound.some((message) =>
      message.method === "turn/steer" &&
      message.params?.input?.some((entry) => entry.type === "text" && entry.text === "append while model is running")
    );
  });

  await page.evaluate(() => {
    const outbound = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; expectedTurnId?: string } }>;
    }).__codexUiOutbound ?? [];
    const steer = [...outbound].reverse().find((message) => message.method === "turn/steer");
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{ dispatchEvent: (event: MessageEvent) => boolean; onmessage?: ((event: MessageEvent) => void) | null }>;
    }).__codexUiSockets?.at(-1);
    if (!steer?.params?.threadId || !steer.params.expectedTurnId || !socket) throw new Error("Missing active steer request");
    const event = new MessageEvent("message", {
      data: JSON.stringify({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: steer.params.threadId,
            turnId: steer.params.expectedTurnId,
            item: { id: "steer-user-real", type: "userMessage", text: "append while model is running" }
          }
        }
      })
    });
    socket.dispatchEvent(event);
    socket.onmessage?.(event);
  });

  await expect(page.getByTestId("workbench-item-userMessage").filter({ hasText: "append while model is running" })).toHaveCount(1);
  await expect(pendingAppend).toHaveCount(0);
});

test("shows Codex upstream retry state and live turn token counters", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("retrying status probe");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const indicator = page.getByTestId("composer-working-indicator");
  await expect(indicator).toContainText("Reconnecting... 2/5");
  await expect(page.getByRole("alert").filter({ hasText: "Reconnecting... 2/5" })).toHaveCount(0);
  await expect(indicator.getByTestId("working-input-tokens-icon")).toBeVisible();
  await expect(indicator.getByTestId("working-output-tokens-icon")).toBeVisible();
  await expect(indicator).toHaveAttribute("aria-label", /input 617 · output 432/);
  await expect(indicator).toContainText("Working");
});

test("reconciles a completed background command when the completion notification was lost", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("background restart probe");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const indicator = page.getByTestId("composer-working-indicator");
  await expect(indicator).toContainText("Working");
  await expect(indicator).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByTestId("workbench-item-commandExecution")).toContainText("Ran");
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { includeTurns?: boolean } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/read" && message.params?.includeTurns === true);
  });
});

test("shows native Codex approval and choice requests in the main chat", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    emit({
      type: "codex.serverRequest",
      message: {
        id: "permission-request-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "perm-1",
          cwd: "/tmp/workspace",
          reason: "Need temporary network access",
          permissions: { network: { enabled: true }, fileSystem: null }
        }
      }
    });
  });

  const panel = page.getByTestId("pending-server-requests");
  const blockingDialog = page.getByTestId("pending-server-requests-dialog");
  await expect(panel).toContainText("Permission request");
  await expect(panel).toContainText("Need temporary network access");
  await page.keyboard.press("Escape");
  await expect(blockingDialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(blockingDialog).toBeVisible();
  await panel.getByRole("button", { name: "Allow session" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; requestId?: string; result?: { scope?: string; permissions?: { network?: { enabled?: boolean } } } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.type === "serverResponse" && message.requestId === "permission-request-1" && message.result?.scope === "session" && message.result.permissions?.network?.enabled === true);
  });
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    emit({
      type: "codex.serverRequest",
      message: {
        id: "choice-request-1",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "choice-1",
          questions: [
            {
              id: "mode",
              header: "Mode",
              question: "Choose a mode",
              isOther: false,
              isSecret: false,
              options: [
                { label: "Fast", description: "Use low effort" },
                { label: "Careful", description: "Use more effort" }
              ]
            },
            {
              id: "fallback",
              header: "Fallback",
              question: "Choose a fallback strategy",
              isOther: true,
              isSecret: false,
              options: [
                { label: "Retry", description: "Retry the same approach" },
                { label: "Stop", description: "Stop and wait for input" }
              ]
            },
            {
              id: "secret",
              header: "Secret",
              question: "Provide a temporary secret",
              isOther: false,
              isSecret: true,
              options: null
            }
          ],
          autoResolutionMs: null
        }
      }
    });
  });
  await expect(panel).toContainText("Choose an option");
  await expect(panel).toContainText("Use more effort");
  await expect(panel.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Allow session" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Careful" }).click();
  await panel.getByRole("button", { name: "Other", exact: true }).click();
  await panel.getByLabel("Other answer").fill("Switch to the backup relay");
  await panel.getByLabel("Your answer").fill("temporary-token");
  await expect(panel.getByLabel("Your answer")).toHaveAttribute("type", "password");
  const submitChoice = panel.getByRole("button", { name: "Submit" });
  await expect(submitChoice).toBeEnabled();
  await submitChoice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "snapshot/request-user-input-other.png", fullPage: false, timeout: 10_000 });
  await submitChoice.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        type?: string;
        requestId?: string;
        result?: {
          answers?: {
            mode?: { answers?: string[] };
            fallback?: { answers?: string[] };
            secret?: { answers?: string[] };
          };
        };
      }>;
    }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.type === "serverResponse" &&
        message.requestId === "choice-request-1" &&
        message.result?.answers?.mode?.answers?.[0] === "Careful" &&
        message.result?.answers?.fallback?.answers?.length === 1 &&
        message.result?.answers?.fallback?.answers?.[0] === "user_note: Switch to the backup relay" &&
        message.result?.answers?.secret?.answers?.[0] === "user_note: temporary-token"
    );
  });
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const event = new MessageEvent("message", {
      data: JSON.stringify({
        type: "codex.serverRequest",
        message: {
          id: "choice-request-auto",
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "choice-auto",
            questions: [
              {
                id: "confirm",
                header: "Continue",
                question: "Continue automatically?",
                isOther: false,
                isSecret: false,
                options: [
                  { label: "Continue", description: "Continue immediately" },
                  { label: "Pause", description: "Wait for manual input" }
                ]
              }
            ],
            autoResolutionMs: 500
          }
        }
      })
    });
    socket.dispatchEvent(event);
    socket.onmessage?.(event);
  });
  await page.waitForTimeout(700);
  await expect(blockingDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(blockingDialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(blockingDialog).toBeVisible();
  const autoResponseBeforeCancel = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; requestId?: string }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.type === "serverResponse" && message.requestId === "choice-request-auto");
  });
  expect(autoResponseBeforeCancel).toBe(false);
  await panel.getByRole("button", { name: "Cancel" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ type?: string; requestId?: string; result?: { answers?: Record<string, unknown> } }>;
    }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.type === "serverResponse" &&
        message.requestId === "choice-request-auto" &&
        Object.keys(message.result?.answers ?? {}).length === 0
    );
  });
  await expect(panel).toHaveCount(0);
});

test("returns protocol-correct decisions for native and legacy Codex approvals", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  const panel = page.getByTestId("pending-server-requests");

  await emitCodexServerRequest(page, {
    id: "command-approval-v2",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "command-1",
      startedAtMs: Date.now(),
      command: "bun run typecheck",
      cwd: "/tmp/workspace",
      reason: "Run the project checks"
    }
  });
  await expect(panel).toContainText("Command approval");
  await expect(panel).toContainText("bun run typecheck");
  await panel.getByRole("button", { name: "Allow session" }).click();
  expect(await waitForServerResponse(page, "command-approval-v2")).toEqual({ decision: "acceptForSession" });
  await expect(panel).toHaveCount(0);

  await emitCodexServerRequest(page, {
    id: "file-approval-v2",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "file-1",
      startedAtMs: Date.now(),
      reason: "Update generated files",
      grantRoot: "/tmp/workspace"
    }
  });
  await expect(panel).toContainText("File change approval");
  await panel.getByRole("button", { name: "Decline" }).click();
  expect(await waitForServerResponse(page, "file-approval-v2")).toEqual({ decision: "decline" });
  await expect(panel).toHaveCount(0);

  await emitCodexServerRequest(page, {
    id: "command-approval-legacy",
    method: "execCommandApproval",
    params: { command: ["rm", "-rf", "/tmp/example"], cwd: "/tmp/workspace" }
  });
  await expect(panel).toContainText("Command approval");
  await panel.getByRole("button", { name: "Cancel" }).click();
  expect(await waitForServerResponse(page, "command-approval-legacy")).toEqual({ decision: "abort" });
  await expect(panel).toHaveCount(0);

  await emitCodexServerRequest(page, {
    id: "patch-approval-legacy",
    method: "applyPatchApproval",
    params: { reason: "Apply a compatibility patch", grantRoot: "/tmp/workspace" }
  });
  await expect(panel).toContainText("File change approval");
  await panel.getByRole("button", { name: "Allow", exact: true }).click();
  expect(await waitForServerResponse(page, "patch-approval-legacy")).toEqual({ decision: "approved" });
  await expect(panel).toHaveCount(0);

  await emitCodexServerRequest(page, {
    id: "permission-decline-v2",
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "permission-2",
      startedAtMs: Date.now(),
      cwd: "/tmp/workspace",
      reason: "Need write access",
      permissions: { network: null, fileSystem: { writableRoots: ["/tmp/workspace"] } }
    }
  });
  await expect(panel).toContainText("Permission request");
  await panel.getByRole("button", { name: "Decline" }).click();
  expect(await waitForServerResponse(page, "permission-decline-v2")).toEqual({ permissions: {}, scope: "turn" });
  await expect(panel).toHaveCount(0);
});

test("creates a Full Auto chat through the New Chat safe bypass dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "New task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reasoning strength" })).toContainText("Medium");

  await page.getByRole("button", { name: "Choose New Chat mode" }).first().click();
  await page.getByTestId("new-chat-mode-dangerBypass").click();

  const dialog = page.getByTestId("danger-new-chat-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Create Full Auto Chat");
  const workspace = dialog.getByRole("textbox", { name: "Workspace" });
  await expect(workspace).toBeVisible();
  const addAdditionalRoot = dialog.getByRole("button", { name: "Add additional writable folder" });
  await expect(addAdditionalRoot).toBeVisible();
  await workspace.fill("E:\\projects\\sci");
  await addAdditionalRoot.click();
  const folderPicker = page.getByTestId("workspace-folder-picker-dialog");
  await expect(folderPicker).toBeVisible();
  await folderPicker.getByRole("textbox", { name: "Current folder" }).fill("E:\\projects\\shared");
  await folderPicker.getByRole("button", { name: "Use this folder" }).click();
  await expect(folderPicker).toHaveCount(0);
  await expect(dialog.getByTestId("danger-new-chat-additional-roots-toggle")).toContainText("1");
  await expect(dialog.getByTestId("danger-new-chat-additional-roots-list")).toContainText("E:\\projects\\shared");
  const model = dialog.getByRole("combobox", { name: "Model" });
  const selectedModel = (await model.textContent())?.trim();
  expect(selectedModel).toBeTruthy();
  await expect(dialog).toContainText("Medium");
  await expect(dialog).toContainText("Full access");
  await expect(dialog).toContainText("No per-action prompts");

  const createButton = page.getByRole("button", { name: "Create Full Auto Chat" });
  await expect(createButton).toBeDisabled();
  await page.screenshot({
    path: "snapshot/new-chat-danger-bypass-dialog.png",
    fullPage: false
  });

  await page.getByLabel("Confirm Safe Bypass").check();
  await expect(createButton).toBeEnabled();
  await createButton.click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("danger-session-badge")).toContainText("Full Auto");
  await expect(page.getByTestId("workspace-selection-panel")).toHaveCount(0);
  await expect(page.getByTestId("composer-workspace-status-chip")).toHaveText("E:\\projects\\sci");

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await composer.fill("Run this in full auto");
  await expect(send).toBeEnabled();
  await send.click();

  await page.waitForFunction((expected) => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: {
            sandbox?: string;
            sandboxPolicy?: { type?: string };
            approvalPolicy?: string;
            effort?: string;
            model?: string;
            cwd?: string;
            collaborationMode?: {
              mode?: string;
              settings?: { model?: string; reasoning_effort?: string; developer_instructions?: string | null };
            };
          };
        }>;
      }
    ).__codexUiOutbound;
    const threadStart = messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "thread/start" &&
        message.params?.sandbox === "danger-full-access" &&
        message.params?.approvalPolicy === "never" &&
        message.params?.cwd === expected.cwd &&
        message.params?.model?.toLowerCase() === expected.model.toLowerCase()
    );
    const turnStart = messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.sandboxPolicy?.type === "dangerFullAccess" &&
        message.params?.approvalPolicy === "never" &&
        message.params?.effort === "medium" &&
        message.params?.model?.toLowerCase() === expected.model.toLowerCase() &&
        message.params?.collaborationMode?.mode === "default" &&
        message.params?.collaborationMode?.settings?.model?.toLowerCase() === expected.model.toLowerCase() &&
        message.params?.collaborationMode?.settings?.reasoning_effort === "medium" &&
        message.params?.collaborationMode?.settings?.developer_instructions === null
    );
    return threadStart && turnStart;
  }, { model: selectedModel!, cwd: "E:\\projects\\sci" });
});

test("opens setup for workspace and full access chats", async ({ page }) => {
  await page.goto("/");

  const modeButton = page.getByRole("button", { name: "Choose New Chat mode" }).first();
  await modeButton.click();
  await page.getByTestId("new-chat-mode-workspaceAsk").click();
  const workspaceSetup = page.getByTestId("new-chat-setup-dialog");
  await expect(workspaceSetup).toBeVisible();
  await expect(workspaceSetup.getByRole("button", { name: "Create chat" })).toBeVisible();
  await workspaceSetup.getByRole("button", { name: "Cancel" }).click();
  await expect(workspaceSetup).toHaveCount(0);

  await modeButton.click();
  await page.getByTestId("new-chat-mode-fullAsk").click();
  await expect(workspaceSetup).toBeVisible();
  await workspaceSetup.getByRole("button", { name: "Cancel" }).click();
  await expect(workspaceSetup).toHaveCount(0);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await composer.fill("Confirm the workspace before sending");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(workspaceSetup).toBeVisible();
});

test("supports settings, black theme, task tabs, and reasoning effort", async ({ page }) => {
  await page.goto("/");

  const reasoningButton = page.getByRole("button", { name: "Reasoning strength" });
  await expect(reasoningButton).toContainText("Medium");
  await reasoningButton.click();
  await expect(page.getByText("Reasoning strength")).toBeVisible();
  await page.getByRole("slider").press("End");
  await expect(page.locator("button").filter({ hasText: "High" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Open settings").click();
  await expect(page.getByLabel("Open Appearance settings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex Engine Config" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Default reasoning effort" })).toContainText("Medium");
  await expect(page.getByRole("combobox", { name: "Web search" })).toContainText("Cached");
  await page.getByLabel("Open Appearance settings").click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("button", { name: /System/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Light/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dark/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Install" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dream-rose");
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Official Black" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "official-black");
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("tab", { name: "Second task" }).click();
  await expect(page.getByRole("tab", { name: "Second task" })).toHaveAttribute("aria-selected", "true");

  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("Use high effort");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { effort?: string } }> })
      .__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "turn/start" && message.params?.effort === "high");
  });
});

test("tweens into an immersive waterfall with a floating composer and restores the standard layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await confirmWorkspace(page);
  const shell = page.getByTestId("workbench-shell");
  const appBar = page.getByTestId("primary-app-bar");
  const composerDock = page.getByTestId("composer-dock");
  const standardShellBox = await shell.boundingBox();
  await page.getByTestId("immersive-view-toggle").click();
  await expect(appBar).toHaveAttribute("data-immersive", "true");
  await expect(composerDock).toHaveAttribute("data-immersive", "true");
  await expect.poll(async () => (await shell.boundingBox())?.y ?? 999).toBeLessThan((standardShellBox?.y ?? 80) - 30);
  await expect.poll(async () => (await shell.boundingBox())?.height ?? 0).toBeGreaterThan(700);
  await expect(composerDock).toBeVisible();
  await expect(page.getByTestId("chat-waterfall-scroll")).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("chat-waterfall-scroll").boundingBox())?.height ?? 0).toBeGreaterThan(400);
  await expect(appBar).toBeHidden();
  await expect(page.getByRole("button", { name: "Exit immersive view" })).toBeVisible();
  const fullComposerHeight = (await composerDock.boundingBox())?.height ?? 0;
  await page.getByTestId("composer-compact-toggle").click();
  await expect(page.getByTestId("composer-runtime-status-bar")).toBeHidden();
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await expect.poll(async () => (await composerDock.boundingBox())?.height ?? 999).toBeLessThan(Math.max(70, fullComposerHeight - 40));
  await page.getByTestId("composer-compact-toggle").click();
  await expect(page.getByTestId("composer-runtime-status-bar")).toBeVisible();
  const floatingBox = await composerDock.boundingBox();
  expect(floatingBox?.width ?? 1440).toBeLessThan(1000);
  expect(await page.evaluate(() => localStorage.getItem("codex-ultra.immersive-view"))).toBe("true");
  await page.getByTestId("immersive-view-toggle").click();
  await expect(appBar).toHaveAttribute("data-immersive", "false");
  await expect(composerDock).toHaveAttribute("data-immersive", "false");
  expect(await page.evaluate(() => localStorage.getItem("codex-ultra.immersive-view"))).toBe("false");
  await page.getByTestId("composer-input").focus();
  await page.keyboard.press("F11");
  await expect(appBar).toHaveAttribute("data-immersive", "true");
  await expect(composerDock).toHaveAttribute("data-immersive", "true");
  await expect(shell).toBeVisible();
  await expect(page.getByTestId("chat-waterfall-scroll")).toBeVisible();
  await expect.poll(async () => (await shell.boundingBox())?.height ?? 0).toBeGreaterThan(700);
  await page.keyboard.press("F11");
  await expect(appBar).toHaveAttribute("data-immersive", "false");
  expect(await page.evaluate(() => localStorage.getItem("codex-ultra.immersive-view"))).toBe("false");
});

test("keeps the history toggle pinned before overflowing task tabs", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto("/");
  await confirmWorkspace(page);
  const historyToggle = page.getByTestId("history-toggle-button");
  const firstTaskTab = page.getByRole("tab", { name: /New task|Second task/ }).first();
  await expect(historyToggle).toBeVisible();
  await expect.poll(async () => {
    const toggleBox = await historyToggle.boundingBox();
    const tabBox = await firstTaskTab.boundingBox();
    return Boolean(toggleBox && tabBox && toggleBox.x < tabBox.x);
  }).toBe(true);
  await historyToggle.click();
  await expect(page.getByPlaceholder("Search history")).toBeVisible();
  await page.mouse.click(880, 740);
  await expect(page.getByPlaceholder("Search history")).toBeHidden();
});

test("keeps chat controls visible across compact desktop and phone widths", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);
  for (const width of [899, 600, 390]) {
    await page.setViewportSize({ width, height: 780 });
    await expect(page.getByTestId("workbench-shell")).toBeVisible();
    await expect(page.getByTestId("composer-dock")).toBeVisible();
    await expect(page.getByTestId("chat-waterfall-scroll")).toBeVisible();
    await expect(page.getByTestId("immersive-view-toggle")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show history panel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
    await page.getByRole("button", { name: "Show history panel" }).click();
    await expect(page.getByPlaceholder("Search history")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("loads only the last 10 MiB for a legacy history larger than 1 GiB", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __codexUiMockLargeHistory?: boolean }).__codexUiMockLargeHistory = true;
  }, { expectedModel: selectedModel!, expectedCwd: "E:\\projects\\sci" });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await expect(page.getByText("Recovered from the last 10 MiB")).toBeVisible({ timeout: 3_000 });

  const requests = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: Record<string, unknown> }> }).__codexUiOutbound ?? []);
  expect(requests.some((message) => message.method === "thread/history/tail" && message.params?.maxBytes === 10 * 1024 ** 2)).toBe(true);
  expect(requests.some((message) => message.method === "thread/read" && message.params?.threadId === "thread-2" && message.params?.includeTurns === true)).toBe(false);
});

test("keeps recently opened transcripts warm when switching task tabs", async ({ page }) => {
  test.setTimeout(60_000);
  providerApiList = [
    mockProvider,
    {
      ...importedProvider,
      groups: [{ id: "alternate", name: "Alternate", kind: "text", models: ["imported-model"], keys: [] }]
    }
  ];
  threadRuntimeMetadata = {
    "thread-1": {
      threadId: "thread-1",
      providerId: "hubproxy-grok",
      groupId: null,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      permission: "workspaceAsk"
    },
    "thread-2": {
      threadId: "thread-2",
      providerId: "imported-relay",
      groupId: "alternate",
      model: "imported-model",
      reasoningEffort: "low",
      permission: "workspaceAsk"
    }
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Show history panel" }).click();
  await page.evaluate(() => {
    const turns = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
      __codexUiOutbound?: unknown[];
    }).__codexUiReconciledTurnsByThread;
    turns?.set("thread-1", [{
      id: "warm-thread-turn-1",
      threadId: "thread-1",
      status: "completed",
      items: [{ id: "warm-thread-message-1", type: "agentMessage", text: "Warm transcript one" }]
    }]);
    turns?.set("thread-2", [{
      id: "warm-thread-turn-2",
      threadId: "thread-2",
      status: "completed",
      items: [{ id: "warm-thread-message-2", type: "agentMessage", text: "Warm transcript two" }]
    }]);
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByText("Warm transcript one")).toBeVisible();
  const waterfallScroll = page.getByTestId("chat-waterfall-scroll");
  await waterfallScroll.evaluate((element) => {
    element.scrollTop = 1;
    element.dispatchEvent(new Event("scroll"));
  });
  const savedScrollTop = await waterfallScroll.evaluate((element) => element.scrollTop);
  const basicsBeforeSwitch = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    const originalNow = Date.now;
    Date.now = () => originalNow() + 60_000;
    return {
      historyLists: messages.filter((message) => message.method === "thread/list").length,
      accountReads: messages.filter((message) => message.method === "account/read").length
    };
  });
  await page.getByRole("button", { name: "Show history panel" }).click();
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await expect(page.getByText("Warm transcript two")).toBeVisible();
  await expect(page.getByRole("button", { name: "Loading" })).toHaveCount(0);
  const switchSideEffects = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound ?? [];
    return {
      historyLists: messages.filter((message) => message.method === "thread/list").length,
      accountReads: messages.filter((message) => message.method === "account/read").length,
      providerActivations: messages.filter((message) => message.type === "provider.activate").length
    };
  });
  expect(switchSideEffects).toEqual({ ...basicsBeforeSwitch, providerActivations: 0 });

  const beforeReturn = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return {
      reads: messages.filter((message) => message.method === "thread/read" && message.params?.threadId === "thread-1").length,
      pages: messages.filter((message) => message.method === "thread/turns/list" && message.params?.threadId === "thread-1").length,
      resumes: messages.filter((message) => message.method === "thread/resume" && message.params?.threadId === "thread-1").length
    };
  });

  await page.getByRole("tab", { name: "Mock thread" }).click();
  await expect(page.getByText("Warm transcript one")).toBeVisible();
  await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);
  await expect.poll(() => waterfallScroll.evaluate((element) => element.scrollTop)).toBe(savedScrollTop);

  const afterReturn = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return {
      reads: messages.filter((message) => message.method === "thread/read" && message.params?.threadId === "thread-1").length,
      pages: messages.filter((message) => message.method === "thread/turns/list" && message.params?.threadId === "thread-1").length,
      resumes: messages.filter((message) => message.method === "thread/resume" && message.params?.threadId === "thread-1").length
    };
  });
  expect(afterReturn).toEqual(beforeReturn);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Official Black" }).click();
  await page.getByText(/Message spacing/).locator("..").getByRole("slider").press("ArrowRight");
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.getByLabel("Language").click();
  await page.getByRole("option", { name: "中文" }).click();
  await expect(page.getByText("Warm transcript one")).toBeVisible();
  await page.getByLabel("语言").click();
  await page.getByRole("option", { name: "English" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Open Relay settings").click();
  const relayRow = page.getByRole("row").filter({ hasText: "HubProxy Grok" }).first();
  await relayRow.getByRole("button", { name: "Use this channel" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByText("Warm transcript one")).toBeVisible();

  const afterSettingsChanges = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return {
      reads: messages.filter((message) => message.method === "thread/read" && message.params?.threadId === "thread-1").length,
      pages: messages.filter((message) => message.method === "thread/turns/list" && message.params?.threadId === "thread-1").length,
      resumes: messages.filter((message) => message.method === "thread/resume" && message.params?.threadId === "thread-1").length
    };
  });
  expect(afterSettingsChanges).toEqual(afterReturn);
});

test("keeps loading history after rapidly opening three different conversations", async ({ page }) => {
  test.setTimeout(20_000);
  await page.goto("/");
  await page.evaluate(() => {
    const turns = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread;
    for (const [threadId, label] of [["thread-1", "First history loaded"], ["thread-2", "Second history loaded"], ["thread-3", "Third history loaded"]] as const) {
      turns?.set(threadId, [{
        id: `${threadId}-rapid-turn`,
        threadId,
        status: "completed",
        items: [{ id: `${threadId}-rapid-agent`, type: "agentMessage", text: label }]
      }]);
    }
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await page.getByRole("button", { name: "Open history Third task" }).click();
  await expect(page.getByText("Third history loaded")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByText("First history loaded")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await expect(page.getByText("Second history loaded")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);
});

test("opens every conversation on the first history page without stale loads or freezes", async ({ page }) => {
  test.setTimeout(120_000);
  const firstPage = Array.from({ length: 10 }, (_, index) => ({
    id: `first-page-thread-${index + 1}`,
    name: `First page chat ${index + 1}`,
    preview: `First page chat ${index + 1}`,
    status: "idle",
    cwd: `/root/projects/first-page-${index + 1}`,
    source: index % 2 === 0 ? "cli" : "appServer",
    updatedAt: 1710001000 - index,
    recencyAt: 1710001000 - index
  }));
  await page.addInitScript((rows) => {
    (window as unknown as { __codexUiMockThreadRows?: typeof rows }).__codexUiMockThreadRows = rows;
  }, firstPage);
  await page.goto("/");
  await page.evaluate((rows) => {
    const turns = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread;
    for (const [index, row] of rows.entries()) {
      turns?.set(row.id, [{
        id: `${row.id}-turn`,
        threadId: row.id,
        status: "completed",
        items: [{ id: `${row.id}-agent`, type: "agentMessage", text: `Loaded first page chat ${index + 1}` }]
      }]);
    }
  }, firstPage);

  await expect(page.getByRole("button", { name: /^Open history First page chat / })).toHaveCount(10);
  const initialListCount = await page.evaluate(() => (
    (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []
  ).filter((message) => message.method === "thread/list").length);

  for (const [index, row] of firstPage.entries()) {
    const startedAt = Date.now();
    await page.getByRole("button", { name: `Open history ${row.name}`, exact: true }).click();
    await expect(page.getByText(`Loaded first page chat ${index + 1}`, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);
    const responsive = await page.evaluate(() => new Promise<boolean>((resolve) => {
      const deadline = performance.now() + 2_000;
      requestAnimationFrame(() => resolve(performance.now() <= deadline));
    }));
    expect(responsive, `${row.name} should keep producing animation frames`).toBe(true);
    expect(Date.now() - startedAt, `${row.name} should load within 30 seconds`).toBeLessThan(30_000);
  }

  const beforeWarmReturn = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return {
      lists: messages.filter((message) => message.method === "thread/list").length,
      reads: messages.filter((message) => message.method === "thread/read").length,
      pages: messages.filter((message) => message.method === "thread/turns/list").length
    };
  });
  expect(beforeWarmReturn.lists).toBe(initialListCount);

  for (const [index, row] of [...firstPage].reverse().entries()) {
    await page.getByRole("button", { name: `Open history ${row.name}`, exact: true }).click();
    await expect(page.getByText(`Loaded first page chat ${10 - index}`, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);
  }

  const afterWarmReturn = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    return {
      lists: messages.filter((message) => message.method === "thread/list").length,
      reads: messages.filter((message) => message.method === "thread/read").length,
      pages: messages.filter((message) => message.method === "thread/turns/list").length
    };
  });
  expect(afterWarmReturn.lists).toBe(beforeWarmReturn.lists);
  expect(afterWarmReturn).toEqual(beforeWarmReturn);
});

test("keeps producing animation frames while a populated task receives streaming deltas", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const turns = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread;
    turns?.set("thread-1", Array.from({ length: 60 }, (_, index) => ({
      id: `fps-history-${index}`,
      threadId: "thread-1",
      status: "completed",
      items: [
        { id: `fps-user-${index}`, type: "userMessage", text: `FPS prompt ${index}` },
        { id: `fps-agent-${index}`, type: "agentMessage", text: `FPS answer ${index}` }
      ]
    })));
  });
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect.poll(async () => Number(await page.getByTestId("conversation-waterfall").getAttribute("data-row-count"))).toBeGreaterThan(100);

  const result = await page.evaluate(() => new Promise<{ frames: number; deltas: number }>((resolve) => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{ dispatchEvent: (event: MessageEvent) => boolean; onmessage?: ((event: MessageEvent) => void) | null }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (method: string, params: Record<string, unknown>) => {
      const event = new MessageEvent("message", { data: JSON.stringify({ type: "codex.notification", message: { method, params } }) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const threadId = "thread-1";
    const turnId = "fps-live-turn";
    const itemId = "fps-live-agent";
    emit("turn/started", { threadId, turn: { id: turnId, threadId, status: "inProgress" } });
    emit("item/completed", { threadId, turnId, item: { id: "fps-live-user", type: "userMessage", text: "Keep streaming" } });
    emit("item/agentMessage/delta", { threadId, turnId, itemId, delta: "Streaming" });

    let frames = 0;
    let deltas = 0;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      deltas += 1;
      emit("item/agentMessage/delta", { threadId, turnId, itemId, delta: ` ${deltas}` });
    }, 12);
    const sample = (now: number) => {
      frames += 1;
      if (now - startedAt >= 1_200) {
        window.clearInterval(timer);
        emit("turn/completed", { threadId, turn: { id: turnId, threadId, status: "completed" } });
        resolve({ frames, deltas });
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));

  expect(result.deltas).toBeGreaterThan(10);
  expect(result.frames).toBeGreaterThan(15);
  await expect(page.getByTestId("conversation-item-fps-live-user")).toContainText("Keep streaming");
});

test("keeps web previews out of the chat waterfall and unloads inactive frames", async ({ page }) => {
  test.setTimeout(20_000);
  await page.goto("/");
  await page.evaluate(() => {
    const turns = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread;
    turns?.set("thread-1", [{
      id: "web-preview-turn",
      threadId: "thread-1",
      status: "completed",
      items: [{ id: "web-preview-agent", type: "agentMessage", text: "Game ready at http://localhost:3000" }]
    }]);
  });
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByTestId("web-preview-menu-button")).toBeVisible();

  await page.getByTestId("web-preview-menu-button").click();
  await expect(page.getByRole("menuitem", { name: "Preview in conversation" })).toHaveCount(0);
  await expect(page.getByTestId("inline-web-preview")).toHaveCount(0);
  await expect(page.getByTestId("conversation-waterfall").locator("iframe")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Open in side browser" }).click();
  await expect(page.getByTestId("right-workspace-panel")).toBeVisible();
  await expect(page.locator('iframe[title="Browser"]')).toHaveCount(1);
  await expect(page.locator("iframe")).toHaveCount(1);
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByTestId("conversation-waterfall").locator("iframe")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(1);

  await page.getByTestId("web-preview-menu-button").click();
  await page.getByRole("menuitem", { name: "Open preview window" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("arranges two task tabs in a persistent resizable split view", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);

  const left = page.getByTestId("split-view-left");
  const right = page.getByTestId("split-view-right");
  await expect(left).toHaveAttribute("data-thread-id", "thread-1");
  await expect(right).toHaveAttribute("data-thread-id", "thread-2");
  await expect(right).toHaveAttribute("data-focused", "true");
  await expect(page.getByTestId("chat-waterfall-scroll")).toHaveCount(2);
  await expect(page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...")).toHaveCount(1);
  await expect(page.getByTestId("conversation-waterfall").locator("iframe")).toHaveCount(0);
  await expect(page.getByText("/root/projects/codex-react-ui").last()).toBeVisible();
  const historyRpcCount = () => page.evaluate(() => (
    (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []
  ).filter((message) => ["thread/read", "thread/resume", "thread/turns/list"].includes(message.method ?? "")).length);
  const frames = await page.evaluate(() => new Promise<number>((resolve) => {
    let count = 0;
    const deadline = performance.now() + 750;
    const sample = () => {
      count += 1;
      if (performance.now() >= deadline) resolve(count);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  // Headless Windows software rendering may schedule RAF below 20 FPS even
  // when the UI remains responsive. The regression is a frozen waterfall;
  // require several callbacks while keeping the assertion environment-safe.
  expect(frames).toBeGreaterThan(5);

  await page.reload();
  await expect(left).toHaveAttribute("data-thread-id", "thread-1");
  await expect(right).toHaveAttribute("data-thread-id", "thread-2");
  await expect(right).toHaveAttribute("data-focused", "true");
  await expect(page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...")).toHaveCount(1);
  // Split restore loads each side once: metadata + the first transcript page.
  await expect.poll(historyRpcCount).toBeGreaterThanOrEqual(4);
  await page.evaluate(() => {
    const outbound = (window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound;
    outbound?.splice(0, outbound.length);
  });

  await left.click({ position: { x: 20, y: 18 } });
  await expect(left).toHaveAttribute("data-focused", "true");
  await expect(page.getByText("/root/projects").last()).toBeVisible();
  await right.click({ position: { x: 20, y: 18 } });
  await left.click({ position: { x: 20, y: 18 } });
  await expect.poll(historyRpcCount).toBe(0);

  await page.getByTestId("split-view-toolbar-button").click();
  await page.getByRole("menuitem", { name: "Reverse Views" }).click();
  await expect(left).toHaveAttribute("data-thread-id", "thread-2");
  await expect(right).toHaveAttribute("data-thread-id", "thread-1");

  await page.getByTestId("split-view-toolbar-button").click();
  await page.getByRole("menuitem", { name: "Close Left View" }).click();
  await expect(page.getByTestId("split-view-left")).toHaveCount(0);
  await expect(page.getByTestId("chat-waterfall-scroll")).toHaveCount(1);
});

test("offers directional splitting from a normal transcript and task tab context menu", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  const tab = page.getByTestId("task-tab").filter({ hasText: "Mock thread" });
  await tab.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Split down" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("conversation-context-surface").click({ button: "right", position: { x: 220, y: 160 } });
  await expect(page.getByRole("menuitem", { name: "Split right" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await page.getByLabel("Search conversations").fill("Second task");
  await page.getByRole("menuitem").filter({ hasText: "Second task" }).click();
  await expect(page.getByTestId("split-view-left")).toHaveAttribute("data-thread-id", "thread-1");
  await expect(page.getByTestId("split-view-right")).toHaveAttribute("data-thread-id", "thread-2");
});

test("collapses a context-menu pane close and allows switching and splitting again", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);

  await page.getByTestId("split-view-left").click({ button: "right", position: { x: 40, y: 18 } });
  await expect(page.getByRole("menuitem", { name: "官方网站" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "About" })).toBeVisible();
  await page.mouse.click(900, 900);
  await expect(page.getByRole("menuitem", { name: "Close pane" })).toHaveCount(0);
  await page.getByTestId("split-view-left").click({ button: "right", position: { x: 40, y: 18 } });
  await page.getByRole("menuitem", { name: "Close pane" }).click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(0);
  await expect(page.getByTestId("conversation-context-surface")).toBeVisible();

  await page.getByRole("button", { name: "Open history Third task" }).click();
  await expect(page.getByRole("tab", { name: "Third task" })).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("conversation-context-surface").click({ button: "right", position: { x: 220, y: 160 } });
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await page.getByLabel("Search conversations").fill("Mock thread");
  await page.getByRole("menuitem").filter({ hasText: "Mock thread" }).click();
  await expect(page.getByTestId("split-view-left")).toHaveAttribute("data-thread-id", "thread-3");
  await expect(page.getByTestId("split-view-right")).toHaveAttribute("data-thread-id", "thread-1");
});

test("replaces the focused split pane when selecting another history conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);
  await expect(page.getByTestId("split-view-right")).toHaveAttribute("data-focused", "true");
  await page.getByRole("button", { name: "Open history Third task" }).click();
  await expect(page.getByTestId("split-view-left")).toHaveAttribute("data-thread-id", "thread-1");
  await expect(page.getByTestId("split-view-right")).toHaveAttribute("data-thread-id", "thread-3");
  await expect(page.getByTestId("split-view-right")).toHaveAttribute("data-focused", "true");
});

test("splits a pane downward from its context menu and maximizes without mounting hidden panes", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);
  const left = page.getByTestId("split-view-left");
  await left.click({ button: "right", position: { x: 40, y: 18 } });
  await page.getByRole("menuitem", { name: "Split down" }).click();
  const search = page.getByLabel("Search conversations");
  await expect(search).toBeVisible();
  await search.fill("Third task");
  await page.getByRole("menuitem").filter({ hasText: "Third task" }).click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  const third = page.locator("[data-pane-id][data-thread-id=\"thread-3\"]");
  await expect(third).toBeVisible();
  await third.click({ button: "right", position: { x: 40, y: 18 } });
  await page.getByRole("menuitem", { name: "Maximize pane" }).click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(1);
  await expect(third).toBeVisible();
  await third.click({ button: "right", position: { x: 40, y: 18 } });
  await page.getByRole("menuitem", { name: "Restore pane" }).click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  await page.reload();
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  await expect(page.locator("[data-pane-id][data-thread-id=\"thread-3\"]")).toBeVisible();
  await expect(page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...")).toHaveCount(1);
});

test("clears drag interception when the desktop window loses focus", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  const tab = page.getByTestId("task-tab").filter({ hasText: "Mock thread" });
  const threadListsBefore = await page.evaluate(() => (
    (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []
  ).filter((message) => message.method === "thread/list").length);
  await tab.dispatchEvent("dragstart", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  await expect(page.getByTestId("split-view-drop-zones")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("split-view-drop-zones")).toHaveCount(0);
  await expect(page.getByTestId("topbar-session-stats-button")).toBeEnabled();
  const threadListsAfter = await page.evaluate(() => (
    (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []
  ).filter((message) => message.method === "thread/list").length);
  expect(threadListsAfter).toBe(threadListsBefore);
});

test("appends a message to the focused Split View transcript", async ({ page }) => {
  test.setTimeout(25_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);

  const left = page.getByTestId("split-view-left");
  const right = page.getByTestId("split-view-right");
  await left.click({ position: { x: 20, y: 18 } });
  await expect(left).toHaveAttribute("data-focused", "true");
  const baselineRows = await left.locator('[data-testid^="conversation-item-"]').count();
  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("focused split message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("workbench-item-userMessage").filter({ hasText: "focused split message" })).toHaveCount(1);
  await expect.poll(async () => {
    const rows = await left.locator('[data-testid^="conversation-item-"]').allTextContents();
    return rows.findIndex((text) => text.includes("focused split message"));
  }).toBeGreaterThanOrEqual(baselineRows);
  const rows = await left.locator('[data-testid^="conversation-item-"]').allTextContents();
  const messageIndex = rows.findIndex((text) => text.includes("focused split message"));
  expect(messageIndex).toBeGreaterThanOrEqual(baselineRows);
  await expect(right).toHaveAttribute("data-focused", "false");

  await right.click({ position: { x: 20, y: 18 } });
  await expect(right).toHaveAttribute("data-focused", "true");
  const rightBaselineRows = await right.locator('[data-testid^="conversation-item-"]').count();
  await composer.fill("focused right split message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("workbench-item-userMessage").filter({ hasText: "focused right split message" })).toHaveCount(1);
  const rightRows = await right.locator('[data-testid^="conversation-item-"]').allTextContents();
  const rightMessageIndex = rightRows.findIndex((text) => text.includes("focused right split message"));
  expect(rightMessageIndex).toBeGreaterThanOrEqual(rightBaselineRows);
  await expect(left.getByText("focused right split message")).toHaveCount(0);
});

test("keeps relay and model selections isolated when split panes are focused by right click", async ({ page }) => {
  providerApiList = [
    { ...mockProvider, nativeModels: ["gpt-5.6-sol"] },
    { ...importedProvider, groups: [{ id: "alternate", name: "Alternate", kind: "text", models: ["imported-model"], keys: [] }] }
  ];
  threadRuntimeMetadata = {
    "thread-1": {
      threadId: "thread-1", providerId: "hubproxy-grok", groupId: null,
      model: "gpt-5.6-sol", reasoningEffort: "medium", permission: "workspaceAsk"
    },
    "thread-2": {
      threadId: "thread-2", providerId: "imported-relay", groupId: "alternate",
      model: "imported-model", reasoningEffort: "low", permission: "workspaceAsk"
    }
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);

  const left = page.getByTestId("split-view-left");
  const right = page.getByTestId("split-view-right");
  const model = page.getByTestId("composer-model-select");
  await right.click({ button: "right", position: { x: 20, y: 18 } });
  await expect(right).toHaveAttribute("data-focused", "true");
  await expect(model).toContainText("imported-model");
  await left.click({ button: "right", position: { x: 20, y: 18 } });
  await expect(left).toHaveAttribute("data-focused", "true");
  await expect(model).toContainText("GPT 5.6 Sol");
  await right.click({ button: "right", position: { x: 20, y: 18 } });
  await expect(model).toContainText("imported-model");
});

test("lists running conversations first in the split history picker", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const turns = (window as unknown as { __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>> }).__codexUiReconciledTurnsByThread;
    turns?.set("thread-2", [{ id: "running-picker-turn", threadId: "thread-2", status: "inProgress", items: [{ id: "running-picker-item", type: "agentMessage", text: "Running picker task" }] }]);
  });
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await expect(page.getByTestId("task-tab").filter({ hasText: "Second task" }).getByTestId("running-thread-pulse")).toHaveCount(1);
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await page.getByTestId("split-view-toolbar-button").click({ button: "right" });
  const search = page.getByLabel("Search conversations");
  await expect(search).toBeVisible();
  const items = page.getByRole("menuitem").filter({ hasText: "Second task" });
  await expect(items).toHaveCount(1);
  await expect(items.getByTestId("running-thread-pulse")).toHaveCount(1);
});

test("keeps memory bounded while scrolling and reversing Split View panes", async ({ page }) => {
  test.setTimeout(40_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);
  await expect(page.getByTestId("chat-waterfall-scroll")).toHaveCount(2);

  const samples = await page.evaluate(async () => {
    const toolbar = document.querySelector<HTMLElement>('[data-testid="split-view-toolbar-button"]');
    if (!toolbar) throw new Error("Missing Split View toolbar");
    const scrolls = [...document.querySelectorAll<HTMLElement>('[data-testid="chat-waterfall-scroll"]')];
    const sample = () => ({
      heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      nodes: document.getElementsByTagName("*").length,
      iframes: document.querySelectorAll("iframe").length
    });
    const result = [sample()];
    for (let round = 0; round < 24; round += 1) {
      for (const scroll of scrolls) {
        scroll.scrollTop = round % 2 === 0 ? scroll.scrollHeight : 0;
        scroll.dispatchEvent(new Event("scroll"));
      }
      toolbar.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const reverse = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Reverse Views"));
      if (!reverse) throw new Error("Missing Reverse Views menu item");
      reverse.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      result.push(sample());
    }
    return result;
  });

  const heaps = samples.map((entry) => entry.heap).filter((value): value is number => value !== null);
  const nodeCounts = samples.map((entry) => entry.nodes);
  const iframeCounts = samples.map((entry) => entry.iframes);
  if (heaps.length > 3) {
    const baseline = heaps[0];
    // Chrome's concurrent GC can delay reclamation across repeated pane swaps;
    // DOM/iframe bounds below are the stable leak signal for this interaction.
    expect(Math.max(...heaps) - baseline).toBeLessThan(baseline * 1.25);
  }
  expect(Math.max(...nodeCounts) - Math.min(...nodeCounts)).toBeLessThan(500);
  expect(Math.max(...iframeCounts)).toBe(0);
});

test("drops a task tab onto a split edge without detaching it", async ({ page }) => {
  test.setTimeout(20_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await page.getByRole("tab", { name: "Mock thread" }).click();
  const secondTab = page.getByTestId("task-tab").filter({ hasText: "Second task" });
  const source = await secondTab.boundingBox();
  expect(source).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(source!.x + source!.width / 2 + 8, source!.y + source!.height + 80, { steps: 4 });
  const dropZone = page.getByTestId("split-view-drop-left");
  await expect(dropZone).toBeVisible();
  const target = await dropZone.boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("split-view-left")).toHaveAttribute("data-thread-id", "thread-2");
  await expect(page.getByTestId("split-view-right")).toHaveAttribute("data-thread-id", "thread-1");
});

test("keeps the surviving chat when a split tab closes or moves to a new window", async ({ page }) => {
  test.setTimeout(40_000);
  await page.addInitScript(() => {
    const detached: string[] = [];
    (window as unknown as { __detachedTaskIds: string[] }).__detachedTaskIds = detached;
    (window as unknown as { codexUltraDesktop: Record<string, unknown> }).codexUltraDesktop = {
      claimContextMenu() {},
      async notify() { return true; },
      async openExternal() { return true; },
      async detachTask(payload: { threadId: string }) { detached.push(payload.threadId); return true; },
      async attachTask() { return true; },
      async listDetachedTasks() { return []; },
      onDetachedTasksChanged() { return () => {}; },
      onTaskAttached() { return () => {}; }
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await openSplitViewFromHistory(page);
  await page.getByTestId("split-view-left").getByRole("button", { name: "Close Left View" }).click();
  await expect(page.getByTestId("split-view-left")).toHaveCount(0);
  await expect(page.getByTestId("chat-waterfall-scroll")).toHaveCount(1);

  const mockTab = page.getByTestId("task-tab").filter({ hasText: "Mock thread" });
  await mockTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add tab to new split view" }).click();
  await page.getByLabel("Search conversations").fill("Second task");
  await page.getByRole("menuitem").filter({ hasText: "Second task" }).click();
  await mockTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to new window" }).click();
  await expect(page.getByTestId("split-view-left")).toHaveCount(0);
  await expect(page.getByTestId("chat-waterfall-scroll")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __detachedTaskIds: string[] }).__detachedTaskIds)).toEqual(["thread-1"]);
});

test("exposes the Codex Ultra official website from the header, tab menu, and About settings", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (url?: string | URL) => {
        if (url) opened.push(String(url));
        return null;
      }
    });
    (window as unknown as { __codexUiOpenedExternalUrls?: string[] }).__codexUiOpenedExternalUrls = opened;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();

  await page.getByRole("button", { name: "Open Codex Ultra official website" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codexUiOpenedExternalUrls?: string[] }).__codexUiOpenedExternalUrls)).toContain("https://codex-ultra.top");

  await page.getByTestId("task-tab").filter({ hasText: "Mock thread" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "官方网站" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codexUiOpenedExternalUrls?: string[] }).__codexUiOpenedExternalUrls?.length ?? 0)).toBe(2);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open About settings").click();
  const website = page.getByRole("link", { name: /codex-ultra.top/ });
  await expect(website).toHaveAttribute("href", "https://codex-ultra.top");
});

test("hydrates a detached task window from the transferred transcript snapshot without history RPCs", async ({ page }) => {
  userPreferences = {
    workspace: {
      mode: "local",
      cwd: "/tmp/other-project",
      sshCommand: "ssh user@192.168.11.1",
      sshCwd: "/home/user"
    }
  };
  await page.addInitScript(() => {
    const snapshot = {
      threadId: "thread-1",
      thread: { id: "thread-1", title: "Mock thread", historyMode: "paginated", cwd: "/tmp/project" },
      turns: [{
        id: "detached-snapshot-turn",
        threadId: "thread-1",
        status: "completed",
        items: [{ id: "detached-snapshot-message", type: "agentMessage", text: "Detached snapshot transcript" }]
      }],
      pageState: { nextCursor: "older-page", loading: false, paginated: true },
      scrollTop: 17
    };
    (window as unknown as { codexUltraDesktop: Record<string, unknown> }).codexUltraDesktop = {
      claimContextMenu() {},
      async notify() { return true; },
      async openExternal() { return true; },
      async detachTask() { return true; },
      async takeDetachedTaskSnapshot(threadId: string) { return threadId === "thread-1" ? snapshot : null; },
      async attachTask() { return true; },
      async listDetachedTasks() { return ["thread-1"]; },
      onDetachedTasksChanged() { return () => {}; },
      onTaskAttached() { return () => {}; }
    };
  });
  await page.goto("/?detachedThread=thread-1");
  await expect(page.getByText("Detached snapshot transcript")).toBeVisible();
  await expect(page.getByTestId("composer-workspace-status-chip")).toHaveText("/tmp/project");
  await expect(page.getByTestId("composer-workspace-status-chip")).not.toContainText("/tmp/other-project");
  await expect.poll(() => page.getByTestId("chat-waterfall-scroll").evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(0);

  const historyCalls = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.filter((message) =>
      (message.method === "thread/read" || message.method === "thread/turns/list") && message.params?.threadId === "thread-1"
    );
  });
  expect(historyCalls).toEqual([]);
});

test("reorders task tabs, exposes Chrome-style tab actions, and configures Windows notifications", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await page.getByRole("button", { name: "Open history Second task" }).click();

  const mockTab = page.getByTestId("task-tab").filter({ hasText: "Mock thread" });
  const secondTab = page.getByTestId("task-tab").filter({ hasText: "Second task" });
  await expect(mockTab).toHaveCount(1);
  await expect(secondTab).toHaveCount(1);
  await secondTab.dragTo(mockTab);
  await expect(page.getByTestId("task-tab").nth(0)).toContainText("Second task");

  await page.getByTestId("task-tab").nth(0).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Close", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Close other tabs" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Close tabs to the right" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Hide inactive tabs" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Close tabs to the right" }).click();
  await expect(page.getByTestId("task-tab")).toHaveCount(1);
  await expect(page.getByTestId("task-tab").first()).toContainText("Second task");

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Notifications settings").click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  const notificationSwitches = page.getByRole("switch");
  await expect(notificationSwitches).toHaveCount(3);
  await expect(notificationSwitches.nth(0)).toBeChecked();
  await expect(notificationSwitches.nth(1)).toBeChecked();
  await expect(notificationSwitches.nth(2)).toBeChecked();
  await notificationSwitches.nth(2).uncheck();
  await expect(notificationSwitches.nth(2)).not.toBeChecked();
});

test("sends deduplicated desktop notifications for progress, completion, and remote HTTP errors", async ({ page }) => {
  await page.addInitScript(() => {
    const notifications: Array<{ title: string; body: string; tag?: string }> = [];
    (window as unknown as {
      __desktopNotifications: typeof notifications;
      codexUltraDesktop: { claimContextMenu: () => void; notify: (payload: typeof notifications[number]) => Promise<boolean> };
    }).__desktopNotifications = notifications;
    (window as unknown as {
      codexUltraDesktop: { claimContextMenu: () => void; notify: (payload: typeof notifications[number]) => Promise<boolean> };
    }).codexUltraDesktop = {
      claimContextMenu() {},
      async notify(payload) {
        notifications.push(payload);
        return true;
      }
    };
  });
  await page.goto("/");

  const plan = {
    threadId: "thread-1",
    turnId: "turn-notify",
    plan: [{ step: "Inspect relay", status: "completed" }, { step: "Package", status: "inProgress" }]
  };
  await emitCodexNotification(page, "turn/plan/updated", plan);
  await emitCodexNotification(page, "turn/plan/updated", plan);
  await emitCodexNotification(page, "error", {
    threadId: "thread-1",
    turnId: "turn-notify",
    willRetry: true,
    error: { message: "unexpected status 429 Too Many Requests" }
  });
  await emitCodexNotification(page, "error", {
    threadId: "thread-1",
    turnId: "turn-notify",
    willRetry: true,
    error: { message: "unexpected status 429 Too Many Requests" }
  });
  await emitCodexNotification(page, "turn/completed", {
    threadId: "thread-1",
    turn: { id: "turn-notify", threadId: "thread-1", status: "completed" }
  });

  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __desktopNotifications?: unknown[] }
  ).__desktopNotifications?.length ?? 0)).toBe(3);
  const notifications = await page.evaluate(() => (
    window as unknown as { __desktopNotifications: Array<{ body: string }> }
  ).__desktopNotifications);
  expect(notifications.map((entry) => entry.body)).toEqual([
    "Completed: Inspect relay",
    "unexpected status 429 Too Many Requests Codex will retry automatically.",
    "This task round has completed."
  ]);
});

test("restores relay, group, model, and reasoning independently for each thread", async ({ page }) => {
  providerApiList = [
    {
      ...mockProvider,
      groups: [{ id: "text-main", name: "Text Main", kind: "text", groupRatio: 1, keys: ["sk-text"] }]
    },
    {
      ...importedProvider,
      groups: [{ id: "alternate", name: "Alternate", kind: "text", groupRatio: 1.5, keys: ["sk-alt"] }]
    }
  ];
  await page.addInitScript(() => {
    localStorage.setItem("codex-ultra.thread-runtime-selections", JSON.stringify({
      __new__: { providerId: "hubproxy-grok", groupId: "text-main", model: "gpt-5.6-sol", reasoningEffort: "medium" },
      "thread-1": { providerId: "hubproxy-grok", groupId: "text-main", model: "gpt-5.6-sol", reasoningEffort: "high" },
      "thread-2": { providerId: "imported-relay", groupId: "alternate", model: "imported-model", reasoningEffort: "low" }
    }));
  });
  threadRuntimeMetadata = {
    "thread-1": {
      threadId: "thread-1", providerId: "hubproxy-grok", groupId: "text-main",
      model: "gpt-5.6-sol", reasoningEffort: "high", permission: "workspaceAsk"
    },
    "thread-2": {
      threadId: "thread-2", providerId: "imported-relay", groupId: "alternate",
      model: "imported-model", reasoningEffort: "low", permission: "workspaceAsk"
    }
  };

  await page.goto("/");
  await page.getByRole("tab", { name: "Mock thread" }).click();
  await expect(page.getByTestId("composer-provider-chip")).toContainText("HubProxy Grok");
  await expect(page.getByTestId("composer-provider-group-chip")).toContainText("Text Main");
  await expect(page.getByTestId("composer-model-select")).toContainText("GPT 5.6 Sol");
  await expect(page.getByTestId("composer-reasoning-button")).toContainText("High");

  await page.getByTestId("composer-provider-chip").click();
  await page.getByRole("button", { name: /Imported Relay/ }).click();
  await expect(page.getByTestId("composer-model-select")).toContainText("imported-model");
  await page.getByTestId("composer-reasoning-button").click();
  await page.getByRole("slider").press("Home");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("composer-reasoning-button")).toContainText("Minimal");

  await page.getByRole("tab", { name: "Second task" }).click();
  await expect(page.getByTestId("composer-provider-chip")).toContainText("Imported Relay");
  await expect(page.getByTestId("composer-provider-group-chip")).toContainText("Alternate");
  await expect(page.getByTestId("composer-model-select")).toContainText("imported-model");
  await expect(page.getByTestId("composer-reasoning-button")).toContainText("Low");

  await page.getByRole("tab", { name: "Mock thread" }).click();
  await expect(page.getByTestId("composer-provider-chip")).toContainText("Imported Relay");
  await expect(page.getByTestId("composer-model-select")).toContainText("imported-model");
  await expect(page.getByTestId("composer-reasoning-button")).toContainText("Minimal");
  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("thread runtime selection probe");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; model?: string; effort?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) =>
      message.method === "turn/start" &&
      message.params?.threadId === "thread-1" &&
      message.params?.model === "imported-model" &&
      message.params?.effort === "minimal"
    );
  });
});

test("restores the highest permission for legacy history and switches the current chat without creating a new one", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-ultra.thread-runtime-selections", JSON.stringify({
      __new__: { providerId: "hubproxy-grok", groupId: "text-main", model: "gpt-5.6-sol", reasoningEffort: "medium" },
      "thread-1": { providerId: "hubproxy-grok", groupId: "text-main", model: "gpt-5.6-sol", reasoningEffort: "high" }
    }));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true", { timeout: 3_000 });
  const permissionSelect = page.getByTestId("composer-permission-select");
  await expect(permissionSelect).toContainText("This chat · Safe bypass with full access");
  await page.waitForFunction(({ expectedModel, expectedCwd }) => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; approvalPolicy?: string; sandbox?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) =>
      message.method === "thread/resume" &&
      message.params?.threadId === "thread-1" &&
      message.params?.approvalPolicy === "never" &&
      message.params?.sandbox === "danger-full-access"
    );
  });

  const permissionSave = page.waitForRequest((request) =>
    request.url().includes("/api/thread-runtime") &&
    request.method() === "PUT" &&
    (request.postDataJSON() as { permission?: string }).permission === "fullAsk"
  );
  await permissionSelect.click();
  await page.getByRole("option", { name: /Full access \+ ask/ }).click();
  await permissionSave;
  await expect(page.getByTestId("new-chat-setup-dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");
  await expect(permissionSelect).toContainText("This chat · Full access + ask");
});

test("uses a compact runtime configuration menu on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const runtimeMenu = page.getByTestId("composer-runtime-menu-button");
  await expect(runtimeMenu).toBeVisible();
  await runtimeMenu.click();
  await expect(page.getByTestId("composer-model-select")).toBeVisible();
  await expect(page.getByTestId("composer-reasoning-button")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  const statusBox = await page.getByTestId("composer-runtime-status-bar").boundingBox();
  const inputBox = await page.getByTestId("composer-input").boundingBox();
  expect(statusBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(inputBox!.y);
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(844);
});

test("reconnects websocket after a disconnect and refreshes basics", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as { __codexUiSockets?: unknown[] }).__codexUiSockets?.length === 1);
  await page.evaluate(() => {
    (window as unknown as { __codexUiOutbound: unknown[] }).__codexUiOutbound.length = 0;
    const socket = (window as unknown as { __codexUiSockets: Array<{ close: () => void }> }).__codexUiSockets[0];
    socket.close();
  });
  await page.waitForFunction(() => (window as unknown as { __codexUiSockets?: unknown[] }).__codexUiSockets?.length >= 2);
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "account/read");
  });
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText("Ready");
  const reconnectRpcs = await page.evaluate(() =>
    (window as unknown as { __codexUiOutbound: Array<{ type?: string; method?: string }> }).__codexUiOutbound
      .filter((message) => message.type === "rpc")
      .map((message) => message.method)
  );
  expect(reconnectRpcs).not.toContain("thread/resume");
  expect(reconnectRpcs).not.toContain("thread/read");
  expect(reconnectRpcs).not.toContain("thread/list");

  // A delayed close from the superseded socket must not mark the live socket disconnected.
  await page.evaluate(() => {
    const oldSocket = (window as unknown as { __codexUiSockets: Array<EventTarget> }).__codexUiSockets[0];
    oldSocket.dispatchEvent(new CloseEvent("close"));
  });
  await page.waitForTimeout(50);
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText("Ready");
});

test("preserves an active long transcript across websocket reconnect without refreshing or duplicating it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (method: string, params: Record<string, unknown>) => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ type: "codex.notification", message: { method, params } })
      });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const threadId = "thread-1";
    for (let index = 0; index < 90; index += 1) {
      const turnId = `reconnect-history-turn-${index}`;
      emit("turn/started", { threadId, turn: { id: turnId, threadId, status: "inProgress" } });
      emit("item/completed", {
        threadId,
        turnId,
        item: { id: `reconnect-history-user-${index}`, type: "userMessage", text: `Reconnect prompt ${index}` }
      });
      emit("item/completed", {
        threadId,
        turnId,
        item: { id: `reconnect-history-agent-${index}`, type: "agentMessage", text: `Reconnect answer ${index}` }
      });
      emit("turn/completed", { threadId, turn: { id: turnId, threadId, status: "completed" } });
    }
    const liveTurnId = "reconnect-live-turn";
    emit("turn/started", { threadId, turn: { id: liveTurnId, threadId, status: "inProgress" } });
    emit("item/completed", {
      threadId,
      turnId: liveTurnId,
      item: { id: "reconnect-live-user", type: "userMessage", text: "Keep the reconnect task running" }
    });
    emit("item/agentMessage/delta", {
      threadId,
      turnId: liveTurnId,
      itemId: "reconnect-live-agent",
      delta: "Active before reconnect"
    });
  });

  const waterfall = page.getByTestId("conversation-waterfall");
  await expect.poll(async () => Number(await waterfall.getAttribute("data-row-count"))).toBeGreaterThan(180);
  const rowCountBefore = await waterfall.getAttribute("data-row-count");
  const mountedRowsBefore = await waterfall.locator('[data-chat-row-key]').count();
  await page.evaluate(() => {
    (window as unknown as { __codexUiOutbound: unknown[] }).__codexUiOutbound.length = 0;
    const socket = (window as unknown as { __codexUiSockets: Array<{ close: () => void }> }).__codexUiSockets.at(-1);
    socket.close();
  });

  await page.waitForFunction(() => (window as unknown as { __codexUiSockets?: unknown[] }).__codexUiSockets?.length >= 2);
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "account/read");
  });
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText(/Running|Working/);

  const reconnectMessages = await page.evaluate(() =>
    (window as unknown as { __codexUiOutbound: Array<{ type?: string; method?: string }> }).__codexUiOutbound
  );
  expect(reconnectMessages.some((message) => message.type === "rpc" && message.method === "thread/resume")).toBe(false);
  expect(reconnectMessages.some((message) => message.type === "rpc" && message.method === "thread/read")).toBe(false);
  expect(reconnectMessages.some((message) => message.type === "rpc" && message.method === "thread/list")).toBe(false);
  expect(reconnectMessages.some((message) => message.type === "thread.watch")).toBe(true);
  await expect(waterfall).toHaveAttribute("data-row-count", rowCountBefore!);
  expect(await waterfall.locator('[data-chat-row-key]').count()).toBeLessThanOrEqual(mountedRowsBefore + 4);

  await emitCodexNotification(page, "item/agentMessage/delta", {
    threadId: "thread-1",
    turnId: "reconnect-live-turn",
    itemId: "reconnect-live-agent",
    delta: " after reconnect"
  });
  const liveRow = page.getByTestId("conversation-item-reconnect-live-agent");
  await expect(liveRow).toContainText("Active before reconnect after reconnect");
  const liveText = await liveRow.textContent();
  expect(liveText?.match(/after reconnect/g) ?? []).toHaveLength(1);

  const mountedRows = await waterfall.locator('[data-chat-row-key]').count();
  expect(mountedRows).toBeLessThan(60);
  await page.waitForTimeout(200);
  const frameSample = await page.evaluate(() => new Promise<{ frames: number; longTasks: number; totalLongTaskMs: number; maxLongTaskMs: number }>((resolve) => {
    const startedAt = performance.now();
    const scroll = document.querySelector<HTMLElement>('[data-testid="chat-waterfall-scroll"]');
    const baselineScrollTop = scroll?.scrollTop ?? 0;
    let count = 0;
    let longTasks = 0;
    let totalLongTaskMs = 0;
    let maxLongTaskMs = 0;
    const observer = typeof PerformanceObserver === "function"
      ? new PerformanceObserver((list) => {
          const entries = list.getEntries();
          longTasks += entries.length;
          for (const entry of entries) { totalLongTaskMs += entry.duration; maxLongTaskMs = Math.max(maxLongTaskMs, entry.duration); }
        })
      : null;
    observer?.observe({ entryTypes: ["longtask"] });
    const tick = (now: number) => {
      count += 1;
      if (scroll) scroll.scrollTop = Math.max(0, baselineScrollTop - (count % 2));
      if (now - startedAt >= 1_000) {
        observer?.disconnect();
        if (scroll) scroll.scrollTop = baselineScrollTop;
        resolve({ frames: count, longTasks, totalLongTaskMs, maxLongTaskMs });
      }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  expect(frameSample.longTasks).toBeLessThan(4);
  expect(frameSample.maxLongTaskMs).toBeLessThan(100);
});

test("probes a delayed heartbeat before reconnecting the websocket", async ({ page }) => {
  await page.unroute("/api/session");
  await page.route("/api/session", (route) => route.fulfill({
    json: {
      token: "test-token",
      websocket: {
        profile: "server",
        path: "/ws",
        heartbeatIntervalMs: 100,
        heartbeatTimeoutMs: 300,
        handshakeTimeoutMs: 1_000,
        reconnectBaseDelayMs: 50,
        reconnectMaxDelayMs: 500
      }
    }
  }));

  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as { __codexUiSockets?: unknown[] }).__codexUiSockets?.length === 1);
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText("Ready");
  await page.evaluate(() => {
    (window as unknown as { __codexUiHeartbeatResponsesEnabled: boolean }).__codexUiHeartbeatResponsesEnabled = false;
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    (window as unknown as { __codexUiHeartbeatResponsesEnabled: boolean }).__codexUiHeartbeatResponsesEnabled = true;
  });
  await page.waitForTimeout(500);

  expect(await page.evaluate(() =>
    (window as unknown as { __codexUiSockets: unknown[] }).__codexUiSockets.length
  )).toBe(1);
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText("Ready");
});

test("switches and persists the history view density", async ({ page }) => {
  await page.goto("/");
  const historyList = page.getByTestId("history-thread-list");
  await expect(historyList).toHaveAttribute("data-history-view", "large");
  await page.getByRole("button", { name: "History view" }).click();
  await expect(page.getByRole("menuitem", { name: "Automatic" })).toBeVisible();
  await page.getByRole("menuitem", { name: "List", exact: true }).click();
  await expect(historyList).toHaveAttribute("data-history-view", "list");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("codex-ultra.history-view"))).toBe("list");
  await page.reload();
  await expect(page.getByTestId("history-thread-list")).toHaveAttribute("data-history-view", "list");
});

test("uses thread/list for unified history and never requests /api/engine-history", async ({ page }) => {
  let engineHistoryRequests = 0;
  await page.route(/\/api\/engine-history(?:\?.*)?$/, async (route) => {
    engineHistoryRequests += 1;
    await route.fulfill({ status: 404, body: "Not Found" });
  });

  await page.goto("/");
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText("Ready");

  const threadListCalls = await page.evaluate(() => {
    const outbound = (window as unknown as { __codexUiOutbound: Array<{ method?: string; params?: { sourceKinds?: string[] } }> }).__codexUiOutbound;
    return outbound.filter((message) => message.method === "thread/list");
  });

  expect(engineHistoryRequests).toBe(0);
  expect(threadListCalls.length).toBeGreaterThan(0);
  expect(threadListCalls[0]?.params?.sourceKinds).toEqual(["cli", "vscode"]);
  expect((threadListCalls[0]?.params as { modelProviders?: string[] } | undefined)?.modelProviders).toEqual([]);

  await page.evaluate(() => {
    localStorage.setItem("codex-ultra.include-automation-history", "true");
  });
  await page.reload();
  await expect(page.getByTestId("topbar-conversation-status")).toHaveText("Ready");
  const automationCalls = await page.evaluate(() => {
    const outbound = (window as unknown as { __codexUiOutbound: Array<{ method?: string; params?: { sourceKinds?: string[] } }> }).__codexUiOutbound;
    return outbound.filter((message) => message.method === "thread/list");
  });
  expect(automationCalls.some((message) => message.params?.sourceKinds?.join(",") === "cli,vscode,exec,appServer")).toBe(true);
});

test("searches Codex history by app-server metadata and opens selected rows read-only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  const sessionRow = page.getByRole("button", { name: "Open history Session Index Title" });
  await expect(sessionRow).toBeVisible();
  await expect(sessionRow).not.toContainText("rollout preview fallback");
  await page.getByLabel("Search history").first().fill("indexed");
  await expect(page.getByRole("button", { name: "Open history Session Index Title" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Open history Mock thread" })).toHaveCount(0);
  const indexedSearchCalls = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { searchTerm?: string } }> }).__codexUiOutbound ?? [];
    return messages.filter((message) => message.method === "thread/list" && message.params?.searchTerm === "indexed").length;
  });
  expect(indexedSearchCalls).toBe(0);

  await page
    .getByLabel("Search history")
    .first()
    .fill("Session renamed to codex-ui-5.6. To resume this session run codex resume, then select codex-ui-5.6 (019c2d47-4935-7423-a190-05691f566092)");
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.some(
      (message) => message.method === "thread/read" && message.params?.threadId === "019c2d47-4935-7423-a190-05691f566092"
    );
  });
  await expect(page.getByRole("button", { name: "Open history Session Index Title" }).first()).toBeVisible();

  const threadReadsBeforeOpen = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.filter(
      (message) =>
        message.method === "thread/read" &&
        message.params?.threadId === "019c2d47-4935-7423-a190-05691f566092"
    ).length;
  });
  await page.getByRole("button", { name: "Open history Session Index Title" }).first().click();
  await expect(page.getByTestId("thread-load-progress")).toBeVisible();
  await expect(page.getByTestId("thread-load-progress")).toContainText("%");
  await expect(page.getByRole("tab", { name: "Session Index Title" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);
  await expect(page.getByText("Indexed history response")).toBeVisible();
  const resumesAfterOpen = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.filter(
      (message) =>
        message.method === "thread/resume" &&
        message.params?.threadId === "019c2d47-4935-7423-a190-05691f566092"
    ).length;
  });
  expect(resumesAfterOpen).toBe(0);
  const threadReadsAfterOpen = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.filter(
      (message) =>
        message.method === "thread/read" &&
        message.params?.threadId === "019c2d47-4935-7423-a190-05691f566092"
    ).length;
  });
  expect(threadReadsAfterOpen).toBe(threadReadsBeforeOpen);

  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("Continue indexed thread");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; cwd?: string; input?: Array<{ text?: string }> } }>;
      }
    ).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "turn/start" &&
        message.params?.threadId === "019c2d47-4935-7423-a190-05691f566092" &&
        message.params?.cwd === "/root/projects/indexed" &&
        message.params?.input?.some((input) => input.text === "Continue indexed thread")
    );
  });

  await page.getByRole("button", { name: "Rename history Session Index Title" }).click();
  await page.getByLabel("Thread name").fill("Renamed history row");
  await page.getByRole("button", { name: "Save rename" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; name?: string } }> }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "thread/name/set" &&
        message.params?.threadId === "019c2d47-4935-7423-a190-05691f566092" &&
        message.params?.name === "Renamed history row"
    );
  });
  await expect(page.getByRole("tab", { name: "Renamed history row" })).toHaveAttribute("aria-selected", "true");

  await page.getByLabel("Search history").fill("");
  await expect(page.getByRole("button", { name: "Open history Second task" })).toBeVisible();
  await page.getByRole("button", { name: "Archive history Second task" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/archive" && message.params?.threadId === "thread-2");
  });
  await expect(page.getByRole("button", { name: "Open history Second task" })).toHaveCount(0);

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete history Mock thread" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/delete" && message.params?.threadId === "thread-1");
  });
  await expect(page.getByRole("button", { name: "Open history Mock thread" })).toHaveCount(0);
});

test("shows context compaction progress from started through completed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();

  const threadId = "thread-1";
  const turnId = "turn-context-compaction";
  await emitCodexNotification(page, "turn/started", {
    threadId,
    turn: { id: turnId, threadId, status: "inProgress" }
  });
  await emitCodexNotification(page, "item/started", {
    threadId,
    turnId,
    item: { id: "context-compaction-1", type: "contextCompaction" }
  });

  const progress = page.getByTestId("context-compaction-progress");
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("data-state", "in-progress");
  await expect(progress).toContainText("Compacting conversation context");
  await expect(progress.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");

  await emitCodexNotification(page, "item/completed", {
    threadId,
    turnId,
    item: { id: "context-compaction-1", type: "contextCompaction" }
  });
  await expect(progress).toHaveAttribute("data-state", "completed");
  await expect(progress).toContainText("Context compaction complete");
  await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

  const nextTurnId = "turn-context-compaction-next";
  await emitCodexNotification(page, "item/started", {
    threadId,
    turnId,
    item: { id: "context-compaction-orphan", type: "contextCompaction" }
  });
  await emitCodexNotification(page, "turn/started", {
    threadId,
    turn: { id: nextTurnId, threadId, status: "inProgress" }
  });
  await emitCodexNotification(page, "item/completed", {
    threadId,
    turnId: nextTurnId,
    item: { id: "context-compaction-new-id", type: "contextCompaction" }
  });
  await expect(page.getByTestId("context-compaction-progress").filter({ hasText: "Compacting conversation context" })).toHaveCount(0);
});

test("virtualizes long main chat transcripts and keeps jump-to-latest usable", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) {
      throw new Error("Missing mock socket");
    }
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    for (let index = 0; index < 320; index += 1) {
      const turnId = `long-turn-${index}`;
      emit({
        type: "codex.notification",
        message: {
          method: "turn/started",
          params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "inProgress" } }
        }
      });
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId,
            item: { type: "userMessage", id: `long-user-${index}`, text: `Long user prompt ${index}` }
          }
        }
      });
      if (index === 310) {
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              turnId,
              item: { type: "reasoning", id: "long-reasoning-310", text: "Completed reasoning detail 310\n\n- checked files\n- prepared answer" }
            }
          }
        });
      }
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId,
            item: {
              type: "agentMessage",
              id: `long-agent-${index}`,
              text: `Long assistant answer ${index}\n\n\`\`\`ts\nexport const value${index} = ${index};\n\`\`\``
            }
          }
        }
      });
      if (index === 260) {
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              turnId,
              item: {
                type: "fileChange",
                id: "long-file-260",
                status: "modified",
                path: "apps/web/file-audit-260.ts",
                changes: [{ path: "apps/web/file-audit-260.ts", status: "modified" }],
                old_string: "old file audit line",
                new_string: "file audit diff marker 260"
              }
            }
          }
        });
      }
      if (index === 275) {
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              turnId,
              item: {
                type: "mcpToolCall",
                id: "long-tool-275",
                server: "filesystem",
                tool: "readFile",
                status: "completed",
                durationMs: 42,
                arguments: { path: "/tmp/tool-audit-275.txt" },
                result: {
                  structuredContent: {
                    message: "tool audit secret 275",
                    bytes: 2048
                  }
                }
              }
            }
          }
        });
      }
      if (index === 276) {
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              turnId,
              item: {
                type: "mcpToolCall",
                id: "long-edit-tool-276",
                tool: "Edit",
                status: "completed",
                arguments: {
                  path: "apps/web/tool-edit-276.ts",
                  old_string: "old tool edit line",
                  new_string: "tool edit diff marker 276"
                },
                result: {
                  structuredContent: {
                    status: "completed"
                  }
                }
              }
            }
          }
        });
      }
      if (index % 25 === 0) {
        const commandText =
          index === 300
            ? [
                "stdout line 300",
                ...Array.from({ length: 78 }, (_, lineIndex) => `long command line ${String(lineIndex + 1).padStart(2, "0")}`),
                "long command tail marker 300"
              ].join("\n")
            : `stdout line ${index}\ncompleted`;
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              turnId,
              item: { type: "commandExecution", id: `long-command-${index}`, command: "bun test", text: commandText, status: "completed" }
            }
          }
        });
        if (index === 225) {
          for (const suffix of [1, 2]) {
            emit({
              type: "codex.notification",
              message: {
                method: "item/completed",
                params: {
                  threadId: "thread-1",
                  turnId,
                  item: {
                    type: "commandExecution",
                    id: `long-command-${index}-folded-${suffix}`,
                    command: `bun run folded-${suffix}`,
                    text: `folded bash output ${suffix}\ncompleted`,
                    status: "completed"
                  }
                }
              }
            });
          }
        }
      }
      emit({
        type: "codex.notification",
        message: {
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "completed" } }
        }
      });
    }
  });

  const waterfall = page.getByTestId("conversation-waterfall");
  await expect(waterfall).toHaveAttribute("data-row-count", "656");
  await page.waitForTimeout(120);
  const mountedRows = await waterfall.locator('[data-testid^="conversation-item-"]').count();
  expect(mountedRows).toBeGreaterThan(0);
  expect(mountedRows).toBeLessThan(80);

  await expect(page.getByTestId("chat-floor-rail")).toBeVisible();
  const promptRail = page.getByTestId("chat-floor-rail");
  await expect(promptRail).toHaveAttribute("data-collapsed", "false");
  await promptRail.getByRole("button", { name: "Minimize prompts" }).click();
  await expect(promptRail).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("chat-floor-scroll")).toHaveCount(0);
  const railBoxBeforeDrag = await promptRail.boundingBox();
  const dragHandle = page.getByTestId("chat-floor-drag-handle");
  const dragBox = await dragHandle.boundingBox();
  expect(railBoxBeforeDrag).not.toBeNull();
  expect(dragBox).not.toBeNull();
  await page.mouse.move(dragBox!.x + 8, dragBox!.y + 12);
  await page.mouse.down();
  await page.mouse.move(dragBox!.x + 8, dragBox!.y + 62, { steps: 4 });
  await page.mouse.up();
  const railBoxAfterDrag = await promptRail.boundingBox();
  expect(railBoxAfterDrag).not.toBeNull();
  expect(railBoxAfterDrag!.y).toBeGreaterThan(railBoxBeforeDrag!.y + 10);

  const expandPrompts = promptRail.getByRole("button", { name: "Expand prompts" });
  const expandBox = await expandPrompts.boundingBox();
  const collapsedRailBox = await promptRail.boundingBox();
  expect(expandBox).not.toBeNull();
  expect(collapsedRailBox).not.toBeNull();
  expect(expandBox!.x).toBeGreaterThanOrEqual(collapsedRailBox!.x);
  expect(expandBox!.x + expandBox!.width).toBeLessThanOrEqual(collapsedRailBox!.x + collapsedRailBox!.width);
  await expandPrompts.click();
  await expect(promptRail).toHaveAttribute("data-collapsed", "false");

  const promptRailScroll = page.getByTestId("chat-floor-scroll");
  await promptRailScroll.evaluate((element) => {
    element.scrollTop = 149 * 27;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: /Jump to prompt 150: Long user prompt 149/ }).click();
  await expect(page.getByTestId("conversation-item-long-user-149").getByText("Long user prompt 149")).toBeVisible();
  await promptRailScroll.evaluate((element) => {
    element.scrollTop = 219 * 27;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(promptRail.getByRole("button", { name: /Jump to prompt 220: Long user prompt 219/ })).toBeVisible();
  await promptRail.getByRole("button", { name: /Jump to prompt 220: Long user prompt 219/ }).click();
  await expect(page.getByTestId("conversation-item-long-user-219").getByText("Long user prompt 219")).toBeVisible();

  await openTranscriptSearch(page);
  await page.getByLabel("Search transcript").fill("Long assistant answer 319");
  await expect(page.getByText("1/1 results in 656 rows")).toBeVisible();
  await expect(page.getByTestId("conversation-item-long-agent-319").getByText("Long assistant answer 319")).toBeVisible();
  await setTranscriptSearchScope(page, "Commands");
  await page.getByLabel("Search transcript").fill("stdout line 300");
  await expect(page.getByText("1/1 results in 656 rows")).toBeVisible();
  const longCommandRow = page.getByTestId("conversation-item-long-command-300");
  await expect(longCommandRow.getByText("Ran")).toBeVisible();
  await expect(longCommandRow.getByText("(bun test)")).toBeVisible();
  await expect(longCommandRow.getByTestId("command-output")).toHaveCount(0);
  await longCommandRow.getByRole("button", { name: "Expand Ran activity" }).click();
  await expect(longCommandRow.getByTestId("command-output")).toContainText("long command line 01");
  await expect(longCommandRow.getByTestId("command-output")).toContainText("long command tail marker 300");
  await longCommandRow.getByRole("button", { name: "Collapse Ran activity" }).evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect(longCommandRow.getByTestId("command-output")).toHaveCount(0);
  await page.getByLabel("Search transcript").fill("folded bash output 1");
  await expect(page.getByText("1/1 results in 656 rows")).toBeVisible();
  const commandGroupRow = page.locator('[data-testid^="conversation-item-command-group-"]').first();
  await expect(commandGroupRow.getByText("Ran", { exact: true })).toBeVisible();
  await expect(commandGroupRow).toContainText("3 commands");
  await expect(commandGroupRow).not.toContainText("bun run folded-1");
  await commandGroupRow.getByRole("button", { name: "Expand folded commands" }).evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect(commandGroupRow).toContainText("bun run folded-1");
  const foldedCommand = commandGroupRow.getByTestId(/grouped-command-.*-folded-1/);
  await foldedCommand.getByRole("button", { name: "Expand command output" }).click();
  await expect(foldedCommand).toContainText("folded bash output 1");
  await setTranscriptSearchScope(page, "User");
  await expect(page.getByText("No transcript rows match this search.")).toBeVisible();

  const scroll = page.getByTestId("chat-waterfall-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByRole("button", { name: /Jump to latest/ })).toBeVisible();
  for (let attempt = 0; attempt < 1; attempt += 1) {
    await page.getByRole("button", { name: /Jump to latest/ }).evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.getByText("Long assistant answer 319")).toBeVisible();
    await expect.poll(() => scroll.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 8)).toBe(true);
    const renderedFrames = await page.evaluate(() => new Promise<number>((resolve) => {
      const startedAt = performance.now();
      let frames = 0;
      const sample = (now: number) => {
        frames += 1;
        if (now - startedAt >= 300) {
          resolve(frames);
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    expect(renderedFrames).toBeGreaterThan(2);
  }

  await page.evaluate(() => {
    (window as unknown as { __copiedWaterfallText?: string }).__copiedWaterfallText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { __copiedWaterfallText?: string }).__copiedWaterfallText = value;
        }
      }
    });
  });
  const copyLatest = page.getByTestId("copy-conversation-item-long-agent-319");
  await copyLatest.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(copyLatest).toHaveAttribute("data-copied", "true");
  await expect(copyLatest.getByTestId("conversation-copy-success")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedWaterfallText?: string }).__copiedWaterfallText)).toContain("Long assistant answer 319");
});

test("keeps a long running tool turn virtualized without pinning an offscreen live tail", async ({ page }) => {
  test.setTimeout(20_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const turnId = "long-live-tool-turn";
    emit({
      type: "codex.notification",
      message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "inProgress" } } }
    });
    for (let index = 0; index < 160; index += 1) {
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId,
            item: {
              type: "commandExecution",
              id: `long-live-command-${index}`,
              command: `tool-command-${index}`,
              text: `tool output ${index}\ncompleted`,
              status: "completed"
            }
          }
        }
      });
    }
  });

  const waterfall = page.getByTestId("conversation-waterfall");
  await expect.poll(async () => Number(await waterfall.getAttribute("data-row-count"))).toBeGreaterThan(150);
  await expect(waterfall).toHaveAttribute("data-pinned-live-row-count", "0");
  const scroll = page.getByTestId("chat-waterfall-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const mountedRows = await waterfall.locator('[data-testid^="conversation-item-"]').count();
  expect(mountedRows).toBeGreaterThan(0);
  expect(mountedRows).toBeLessThan(60);
  // Measure sustained responsiveness after the batched reducer commit settles,
  // rather than counting the tail of the synthetic 160-message injection itself.
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => new Promise<number>((resolve) => {
    const startedAt = performance.now();
    let count = 0;
    const tick = (now: number) => {
      count += 1;
      if (now - startedAt >= 500) resolve(count);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  // Multiple frames prove the renderer recovered instead of entering the
  // reported persistent 0-FPS state. Headless Chromium may use software rasterization.
  expect(frames).toBeGreaterThan(1);
});

test("keeps waterfall rows aligned while a goal banner is active", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await composer.fill("/goal keep waterfall layout stable");
  await send.click();
  await expect(page.getByTestId("sticky-goal-bar")).toContainText("keep waterfall layout stable");

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) {
      throw new Error("Missing mock socket");
    }
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    for (let index = 0; index < 40; index += 1) {
      const turnId = `goal-layout-turn-${index}`;
      emit({
        type: "codex.notification",
        message: {
          method: "turn/started",
          params: { threadId: "thread-new-1", turn: { id: turnId, threadId: "thread-new-1", status: "inProgress" } }
        }
      });
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-new-1",
            turnId,
            item: { type: "userMessage", id: `goal-layout-user-${index}`, text: `Goal layout prompt ${index}` }
          }
        }
      });
      if (index === 18) {
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-new-1",
              turnId,
              item: {
                type: "commandExecution",
                id: "goal-layout-command-18",
                command: "bun run layout-check",
                text: Array.from({ length: 48 }, (_, line) => `goal command output line ${line + 1}`).join("\n"),
                status: "completed"
              }
            }
          }
        });
      }
      if (index === 38) {
        emit({
          type: "codex.notification",
          message: {
            method: "item/completed",
            params: {
              threadId: "thread-new-1",
              turnId,
              item: {
                type: "fileChange",
                id: "goal-layout-file-38",
                status: "modified",
                path: "apps/web/goal-layout.tsx",
                changes: [{ path: "apps/web/goal-layout.tsx", status: "modified" }],
                old_string: "const compact = false;",
                new_string: "const compact = true;"
              }
            }
          }
        });
      }
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-new-1",
            turnId,
            item: {
              type: "agentMessage",
              id: `goal-layout-agent-${index}`,
              text: `Goal layout answer ${index}\n\n` + "Measured row spacing remains local.\n".repeat(index === 26 ? 12 : 1)
            }
          }
        }
      });
      emit({
        type: "codex.notification",
        message: {
          method: index === 20 ? "turn/interrupted" : "turn/completed",
          params: {
            threadId: "thread-new-1",
            turn: {
              id: turnId,
              threadId: "thread-new-1",
              status: index === 20 ? "interrupted" : "completed"
            }
          }
        }
      });
    }
  });

  await expect(page.getByTestId("conversation-waterfall")).toHaveAttribute("data-row-count", "83");
  const initialGoalBox = await page.getByTestId("sticky-goal-bar").boundingBox();
  const initialScrollBox = await page.getByTestId("chat-waterfall-scroll").boundingBox();
  const initialInputBox = await page.getByTestId("composer-input").boundingBox();
  expect(initialGoalBox).not.toBeNull();
  expect(initialScrollBox).not.toBeNull();
  expect(initialInputBox).not.toBeNull();
  expect(initialGoalBox!.y + initialGoalBox!.height).toBeLessThanOrEqual(initialScrollBox!.y + 2);
  expect(initialScrollBox!.y + initialScrollBox!.height).toBeLessThanOrEqual(initialInputBox!.y + 2);

  await page.getByText("Goal layout answer 39").scrollIntoViewIfNeeded();
  await expect(page.getByText("Goal layout answer 39")).toBeVisible();
  await assertMountedWaterfallRowsDoNotOverlap(page);

  const fileRow = page.getByTestId("conversation-item-goal-layout-file-38");
  await fileRow.scrollIntoViewIfNeeded();
  await fileRow.getByRole("button", { name: "Expand file details" }).click();
  await expect(fileRow.getByTestId("file-diff-view")).toBeVisible();
  await assertMountedWaterfallRowsDoNotOverlap(page);

  const goalBox = await page.getByTestId("sticky-goal-bar").boundingBox();
  const scrollBox = await page.getByTestId("chat-waterfall-scroll").boundingBox();
  const inputBox = await page.getByTestId("composer-input").boundingBox();
  expect(goalBox).not.toBeNull();
  expect(scrollBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(goalBox!.y + goalBox!.height).toBeLessThanOrEqual(scrollBox!.y + 2);
  expect(scrollBox!.y + scrollBox!.height).toBeLessThanOrEqual(inputBox!.y + 2);

  const scroll = page.getByTestId("chat-waterfall-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(350);
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
      __goalPromptStressTimer?: number;
    }).__codexUiSockets?.at(-1);
    if (!socket) {
      throw new Error("Missing mock socket");
    }
    const emit = (method: string, params: Record<string, unknown>) => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ type: "codex.notification", message: { method, params } })
      });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const threadId = "thread-new-1";
    const turnId = "goal-prompt-navigation-live";
    const itemId = "goal-prompt-navigation-agent";
    emit("turn/started", { threadId, turn: { id: turnId, threadId, status: "inProgress" } });
    emit("item/completed", {
      threadId,
      turnId,
      item: { type: "userMessage", id: "goal-prompt-navigation-user", text: "Goal prompt navigation live turn" }
    });
    emit("item/agentMessage/delta", { threadId, turnId, itemId, delta: "Streaming goal navigation" });
    let index = 0;
    (window as unknown as { __goalPromptStressTimer?: number }).__goalPromptStressTimer = window.setInterval(() => {
      index += 1;
      emit("item/agentMessage/delta", { threadId, turnId, itemId, delta: ` update-${index}` });
      if (index >= 120) {
        window.clearInterval((window as unknown as { __goalPromptStressTimer?: number }).__goalPromptStressTimer);
      }
    }, 20);
  });

  const livePromptRailScroll = page.getByTestId("chat-floor-scroll");
  await livePromptRailScroll.evaluate((element) => {
    element.scrollTop = 5 * 27;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: /Jump to prompt \d+: Goal layout prompt 5/ }).click();
  await livePromptRailScroll.evaluate((element) => {
    element.scrollTop = 20 * 27;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: /Jump to prompt \d+: Goal layout prompt 20/ }).click();
  await livePromptRailScroll.evaluate((element) => {
    element.scrollTop = 34 * 27;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: /Jump to prompt \d+: Goal layout prompt 34/ }).click();
  await expect(page.getByTestId("conversation-item-goal-layout-user-34")).toBeVisible();
  const selectedPromptScrollTop = await scroll.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(180);
  expect(Math.abs(await scroll.evaluate((element) => element.scrollTop) - selectedPromptScrollTop)).toBeLessThan(600);

  await page.getByRole("button", { name: /Jump to latest/ }).click();
  await expect(page.getByTestId("conversation-item-goal-prompt-navigation-agent")).toBeVisible();
  await expect.poll(() => scroll.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 8)).toBe(true);
  const responsiveFrames = await page.evaluate(() => new Promise<number>((resolve) => {
    const startedAt = performance.now();
    let frames = 0;
    const sample = (now: number) => {
      frames += 1;
      if (now - startedAt >= 500) {
        resolve(frames);
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  expect(responsiveFrames).toBeGreaterThan(8);
  await page.evaluate(() => {
    const timer = (window as unknown as { __goalPromptStressTimer?: number }).__goalPromptStressTimer;
    if (timer) {
      window.clearInterval(timer);
    }
  });
});

test("applies user theme media plugins to the default workbench", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const heroImage =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MDAiIGhlaWdodD0iNDIwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB4Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iI2ZiY2ZlOCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2JhZTZmZCIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI5MDAiIGhlaWdodD0iNDIwIiBmaWxsPSJ1cmwoI2cpIi8+PGNpcmNsZSBjeD0iNzIwIiBjeT0iMTQwIiByPSIxMTAiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuNDUiLz48cGF0aCBkPSJNMTIwIDI1MCBDMjYwIDEyMCA0MjAgMzQwIDYyMCAxOTAiIHN0cm9rZT0iI2RiMjc3NyIgc3Ryb2tlLXdpZHRoPSIxOCIgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMC40NSIvPjwvc3ZnPg==";
  const avatarImage =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMjQwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjI0MCIgcng9IjI4IiBmaWxsPSIjZjlhOGQ0Ii8+PGNpcmNsZSBjeD0iMTIwIiBjeT0iOTIiIHI9IjQ4IiBmaWxsPSIjZmZmN2VkIi8+PHBhdGggZD0iTTcwIDE2OCBRMTIwIDIwNSAxNzAgMTY4IiBzdHJva2U9IiNiZTE4NWQiIHN0cm9rZS13aWR0aD0iMTYiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==";

  await page.goto("/");
  await expect(page.getByTestId("default-workbench-empty")).toBeVisible();
  await page.getByTestId("default-prompt-card-explore").click();
  await expect(page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...")).toHaveValue(/Explore this repository/);
  await expect(page.getByTestId("default-workbench-empty")).toHaveCount(0);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByRole("textbox", { name: "Name" }).fill("Sakura Builder");
  await page.getByRole("textbox", { name: "Primary" }).fill("#DB2777");
  await page.getByRole("textbox", { name: "Secondary", exact: true }).fill("#2563EB");
  await page.getByRole("textbox", { name: "Background", exact: true }).fill("#FFF7FB");
  await page.getByLabel("Main chat waterfall background").fill(heroImage);
  await page.getByLabel("Legacy hero image").fill(heroImage);
  await page.getByLabel("Corner image").fill(avatarImage);
  await page.getByLabel("Pet/avatar image").fill(avatarImage);
  await page.getByLabel("Decorations").click();
  await page.getByRole("option", { name: "Rich" }).click();
  await page.getByRole("button", { name: /Save plugin|Save changes/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-sakura-builder-/);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);

  await expect(page.getByTestId("default-workbench-empty")).toHaveCount(0);
  await expect(page.getByTestId("theme-pet-dock")).toBeVisible();
  await page.screenshot({
    path: "snapshot/theme-plugin-applied.png",
    fullPage: false
  });
});

test("supports uploaded background images and user theme switching", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByRole("textbox", { name: "Name" }).fill("Reference Rose");
  await page.getByRole("textbox", { name: "Primary" }).fill("#D94F75");
  await page.getByRole("textbox", { name: "Secondary", exact: true }).fill("#B76E79");
  await page.getByRole("textbox", { name: "Background", exact: true }).fill("#FFF4F7");
  await page.getByLabel("Background image file").setInputFiles(resolve(process.cwd(), "snapshot", "参考", "HNVjQXebIAI_AwK.jpg"));
  await expect(page.getByTestId("custom-theme-background-preview")).toContainText("local image");
  await expect(page.getByLabel("Theme background overlay opacity")).toHaveValue("0");
  await expect(page.getByLabel("Theme effects layer opacity")).toHaveValue("0");
  await expect(page.getByLabel("Theme tone opacity")).toHaveValue("0");
  await page.getByLabel("Background video file").setInputFiles({
    name: "reference-loop.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109])
  });
  await expect(page.getByTestId("custom-theme-background-preview")).toContainText("local video");
  await page.getByLabel("Theme background overlay opacity").fill("8");
  await page.getByLabel("Theme workspace surface opacity").fill("14");
  await page.getByLabel("Theme hero overlay opacity").fill("18");
  await page.getByLabel("Theme panel opacity").fill("72");
  await page.getByLabel("Theme glass blur").fill("6");
  await page.getByLabel("Tone color").fill("#D94F75");
  await page.getByLabel("Dynamic background").click();
  await page.getByRole("option", { name: "Three.js loop" }).click();
  await page.getByLabel("Scene preset").click();
  await page.getByRole("option", { name: "Orbit" }).click();
  await page.getByRole("button", { name: /Save plugin|Save changes/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-reference-rose-/);

  await expect.poll(() => JSON.stringify(userPreferences.customThemePlugins ?? [])).toContain("data:image/jpeg;base64,");
  const storedTheme = JSON.stringify(userPreferences.customThemePlugins ?? []);
  expect(storedTheme).toContain("data:video/mp4;base64,");
  expect(storedTheme).toContain("\"backgroundOverlayOpacity\":0.08");
  expect(storedTheme).toContain("\"workspaceSurfaceOpacity\":0.14");
  expect(storedTheme).toContain("\"renderer\":\"three\"");

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByTestId("default-workbench-empty")).toBeVisible();
  await expect(page.getByTestId("theme-background-media")).toBeVisible();
  await expect(page.getByTestId("theme-background-image")).toBeVisible();
  await expect(page.getByTestId("theme-background-video")).toBeVisible();
  await expect(page.getByTestId("theme-background-three")).toBeVisible();
  await page.screenshot({
    path: "snapshot/user-theme-background-switching.png",
    fullPage: false
  });

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Official Black" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "official-black");
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Reference Rose" }).last().click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-reference-rose-/);

  await page.getByRole("button", { name: "Edit theme Reference Rose" }).last().click();
  await expect(page.getByText("Edit theme plugin")).toBeVisible();
  await expect(page.getByLabel("Main chat waterfall background")).toHaveValue(/^data:image\/jpeg;base64,/);
  await expect(page.getByLabel("Workbench background video")).toHaveValue(/^data:video\/mp4;base64,/);
  await expect(page.getByLabel("Dynamic background")).toHaveText("Three.js loop");
  const [themeZipDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export ZIP" }).click()]);
  const themeZipPath = await themeZipDownload.path();
  if (!themeZipPath) {
    throw new Error("Theme ZIP download path was unavailable.");
  }
  const exportedThemeFiles = readStoredTestZip(await readFile(themeZipPath));
  const exportedThemeJson = exportedThemeFiles.get("theme.json");
  expect(exportedThemeJson?.toString("utf8")).toContain("\"name\": \"Reference Rose\"");
  expect(exportedThemeJson?.toString("utf8")).toContain("\"appBackgroundImage\": \"assets/appBackgroundImage.jpg\"");
  expect(exportedThemeJson?.toString("utf8")).toContain("\"appBackgroundVideo\": \"assets/appBackgroundVideo.mp4\"");
  expect(exportedThemeFiles.get("assets/appBackgroundImage.jpg")?.byteLength).toBeGreaterThan(1000);
  expect(exportedThemeFiles.get("assets/appBackgroundVideo.mp4")?.byteLength).toBeGreaterThan(0);
  await page.getByRole("textbox", { name: "Secondary", exact: true }).fill("#2563EB");
  await page.getByRole("button", { name: /Save plugin|Save changes/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-reference-rose-/);
  await expect(page.getByRole("button", { name: "Edit theme Reference Rose" }).last()).toBeVisible();

  const importedTheme = {
    name: "Imported Mint",
    description: "Imported user background theme.",
    preview: { primary: "#0F766E", secondary: "#F59E0B", background: "#ECFDF5" },
    dark: false,
    assets: {
      appBackgroundImage:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MDAiIGhlaWdodD0iMzIwIj48cmVjdCB3aWR0aD0iOTAwIiBoZWlnaHQ9IjMyMCIgZmlsbD0iI2VjZmRmNSIvPjxjaXJjbGUgY3g9IjY4MCIgY3k9IjEyMCIgcj0iOTAiIGZpbGw9IiMwZjc2NmUiIG9wYWNpdHk9IjAuMjUiLz48cGF0aCBkPSJNMTIwIDIyMCBDMjgwIDkwIDQ2MCAyNzAgNzIwIDEyMCIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjE4IiBmaWxsPSJub25lIiBvcGFjaXR5PSIwLjQ1Ii8+PC9zdmc+",
      appBackgroundVideo: "https://example.com/theme-loop.webm"
    },
    layout: {
      heroEnabled: true,
      petEnabled: true,
      decorationIntensity: "subtle",
      backgroundOverlayOpacity: 0.04,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 0.18,
      panelSurfaceOpacity: 0.7,
      toneColor: "#0F766E",
      toneOpacity: 0,
      backgroundScene: { renderer: "canvas", preset: "particles", color: "#0F766E", secondaryColor: "#F59E0B", speed: 0.8, density: 0.4, opacity: 0.5 }
    }
  };
  await page.getByLabel("Custom theme plugin JSON or ZIP file").setInputFiles({
    name: "imported-mint.theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedTheme))
  });
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Imported Mint");
  await expect(page.getByLabel("Workbench background video")).toHaveValue("https://example.com/theme-loop.webm");
  await expect(page.getByLabel("Dynamic background")).toHaveText("Canvas loop");
  await page.getByRole("button", { name: /Save plugin|Save changes/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-imported-mint-/);
  await page.getByLabel("Skin").click();
  await expect(page.getByRole("option", { name: "Reference Rose" }).last()).toBeVisible();
  await expect(page.getByRole("option", { name: "Imported Mint" })).toBeVisible();
  await page.keyboard.press("Escape");

  const zippedTheme = {
    name: "Zipped Mint",
    description: "ZIP theme with separate media assets.",
    preview: { primary: "#047857", secondary: "#F97316", background: "#F0FDFA" },
    dark: false,
    assets: {
      appBackgroundImage: "assets/waterfall.svg",
      composerBackgroundImage: "assets/composer.svg",
      appBackgroundVideo: "assets/loop.webm"
    },
    layout: {
      heroEnabled: true,
      petEnabled: true,
      decorationIntensity: "rich",
      backgroundOverlayOpacity: 0.02,
      workspaceSurfaceOpacity: 0.16,
      panelSurfaceOpacity: 0.68,
      toneColor: "#047857",
      toneOpacity: 0,
      backgroundScene: { renderer: "canvas", preset: "aurora", color: "#047857", secondaryColor: "#F97316", speed: 0.7, density: 0.45, opacity: 0.5 }
    }
  };
  const zippedThemeSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><rect width="360" height="180" fill="#ccfbf1"/><circle cx="270" cy="70" r="52" fill="#047857" opacity=".35"/></svg>'
  );
  const zippedThemeBuffer = createStoredTestZip({
    "theme.json": Buffer.from(JSON.stringify(zippedTheme)),
    "assets/waterfall.svg": zippedThemeSvg,
    "assets/composer.svg": zippedThemeSvg,
    "assets/loop.webm": Buffer.from([26, 69, 223, 163, 159, 66, 134, 129, 1, 66, 247, 129, 1])
  });
  await page.getByLabel("Custom theme plugin JSON or ZIP file").setInputFiles({
    name: "zipped-mint.theme.zip",
    mimeType: "application/zip",
    buffer: zippedThemeBuffer
  });
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Zipped Mint");
  await expect(page.getByLabel("Main chat waterfall background")).toHaveValue(/^data:image\/svg\+xml;base64,/);
  await expect(page.getByLabel("Composer input background")).toHaveValue(/^data:image\/svg\+xml;base64,/);
  await expect(page.getByLabel("Workbench background video")).toHaveValue(/^data:video\/webm;base64,/);
  await expect(page.getByLabel("Dynamic background")).toHaveText("Canvas loop");
  await page.getByRole("button", { name: /Save plugin|Save changes/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-zipped-mint-/);
});

test("supports drag and drop image attachments in the composer", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const dataTransfer = await page.evaluateHandle(() => {
    const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(tinyPngBase64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "drop.png", { type: "image/png" }));
    return data;
  });

  await composer.dispatchEvent("dragenter", { dataTransfer });
  await composer.dispatchEvent("dragover", { dataTransfer });
  await composer.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("drop.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove drop.png" })).toBeVisible();

  await composer.fill("Describe the dropped image");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { input?: Array<{ type?: string; text?: string; url?: string; detail?: string }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.input?.some((input) => input.type === "text" && input.text === "Describe the dropped image") &&
        message.params?.input?.some((input) => input.type === "image" && input.detail === "auto" && input.url?.startsWith("data:image/png;base64,"))
    );
  });
  await expect(page.locator('img[src^="data:image/png;base64,"]').first()).toBeVisible();
  await expect(page.getByTestId("pending-append-status")).toHaveCount(0);
  await expect(page.getByText("1 attachment", { exact: true })).toHaveCount(0);
  await expect(page.locator('img[src^="data:image/png;base64,"]')).toHaveCount(1);

  await page.locator('img[src^="data:image/png;base64,"]').click();
  const preview = page.getByRole("dialog");
  await expect(preview.getByRole("img")).toBeVisible();
  await page.screenshot({ path: "snapshot/uploaded-image-preview.png", fullPage: false });
  await page.getByRole("button", { name: "Close attachment preview" }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByTestId("conversation-waterfall")).not.toHaveCSS("height", "0px");
  const animationFrames = await page.evaluate(async () => {
    let frames = 0;
    await new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const sample = () => {
        frames += 1;
        if (performance.now() - startedAt >= 250) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  expect(animationFrames).toBeGreaterThan(0);
  await expect(page.getByText(/data:image\/png;base64/)).toHaveCount(0);
});

test("keeps context occupancy to the right of permissions without overlapping composer controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true", { timeout: 3_000 });

  const indicator = page.getByTestId("composer-context-usage");
  await expect(indicator).toBeVisible({ timeout: 3_000 });

  const assertComposerControlsDoNotOverlap = async () => {
    await expect(page.getByTestId("composer-add-menu-button")).toBeVisible();
    await expect(page.getByTestId("composer-permission-select")).toBeVisible();
    await expect(page.getByTestId("composer-waterfall-mode-button")).toBeVisible();
    await expect(indicator).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    const [add, permission, waterfallMode, context, send] = await Promise.all([
      page.getByTestId("composer-add-menu-button").boundingBox(),
      page.getByTestId("composer-permission-select").boundingBox(),
      page.getByTestId("composer-waterfall-mode-button").boundingBox(),
      indicator.boundingBox(),
      page.getByRole("button", { name: "Send", exact: true }).boundingBox()
    ]);
    expect(add).not.toBeNull();
    expect(permission).not.toBeNull();
    expect(waterfallMode).not.toBeNull();
    expect(context).not.toBeNull();
    expect(send).not.toBeNull();
    expect(add!.x + add!.width).toBeLessThanOrEqual(permission!.x);
    expect(permission!.x + permission!.width).toBeLessThanOrEqual(waterfallMode!.x);
    expect(waterfallMode!.x + waterfallMode!.width).toBeLessThanOrEqual(context!.x);
    expect(context!.x + context!.width).toBeLessThanOrEqual(send!.x);
  };

  await assertComposerControlsDoNotOverlap();
  await page.setViewportSize({ width: 430, height: 760 });
  await page.waitForTimeout(100);
  await assertComposerControlsDoNotOverlap();

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Cursor Minimal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "cursor-minimal");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.screenshot({ path: "snapshot/cursor-minimal-context-ring.png", fullPage: false });
});

test("switches all three waterfall display modes without reloading conversation history", async ({ page }) => {
  test.setTimeout(20_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true", { timeout: 3_000 });

  await page.evaluate(() => {
    (window as unknown as { __codexUiOutbound: unknown[] }).__codexUiOutbound.length = 0;
  });
  const modeButton = page.getByTestId("composer-waterfall-mode-button");
  await modeButton.click();
  await page.getByTestId("composer-waterfall-mode-full").click();
  await modeButton.click();
  await page.getByTestId("composer-waterfall-mode-post-compaction").click();
  await modeButton.click();
  await page.getByTestId("composer-waterfall-mode-recent-tools").click();

  await page.waitForTimeout(350);
  const historyRpcs = await page.evaluate(() =>
    (window as unknown as { __codexUiOutbound: Array<{ type?: string; method?: string }> }).__codexUiOutbound
      .filter((message) => message.type === "rpc" && ["thread/list", "thread/read", "thread/resume"].includes(message.method ?? ""))
  );
  expect(historyRpcs).toEqual([]);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Layout settings").click();
  await expect(page.getByRole("button", { name: "Compact", pressed: true })).toBeVisible();
});

test("supports pasting a clipboard screenshot into the composer", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.evaluate((element) => {
    const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(tinyPngBase64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });

  await expect(page.getByText("clipboard.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove clipboard.png" })).toBeVisible();

  await composer.fill("Describe the pasted screenshot");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { input?: Array<{ type?: string; text?: string; url?: string; detail?: string }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.input?.some((input) => input.type === "text" && input.text === "Describe the pasted screenshot") &&
        message.params?.input?.some((input) => input.type === "image" && input.detail === "auto" && input.url?.startsWith("data:image/png;base64,"))
    );
  });

  const pastedImage = page.locator('img[src^="data:image/png;base64,"]').first();
  await expect(pastedImage).toBeVisible();
  await pastedImage.click();
  const preview = page.getByRole("dialog");
  await expect(preview.getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "Close attachment preview" }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByTestId("conversation-waterfall")).not.toHaveCSS("height", "0px");
  const animationFrames = await page.evaluate(async () => {
    let frames = 0;
    await new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const sample = () => {
        frames += 1;
        if (performance.now() - startedAt >= 250) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  expect(animationFrames).toBeGreaterThan(0);
});

test("supports document attachments as uploaded file mentions without rendering base64", async ({ page }) => {
  await page.route("/api/attachments/upload", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        name: "report.pdf",
        path: "/tmp/codex-ui-attachments/report.pdf",
        mediaType: "application/pdf",
        size: 7
      }
    });
  });
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46])], "report.pdf", { type: "application/pdf" }));
    return data;
  });

  await composer.dispatchEvent("dragenter", { dataTransfer });
  await composer.dispatchEvent("dragover", { dataTransfer });
  await composer.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("report.pdf")).toBeVisible();

  await composer.fill("Summarize the attached report");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { input?: Array<{ type?: string; text?: string; path?: string; name?: string }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.input?.some((input) => input.type === "text" && input.text?.includes("Summarize the attached report") && input.text.includes("report.pdf")) &&
        message.params?.input?.some((input) => input.type === "mention" && input.name === "report.pdf" && input.path === "/tmp/codex-ui-attachments/report.pdf")
    );
  });
  await expect(page.getByText("/tmp/codex-ui-attachments/report.pdf").first()).toBeVisible();
  await expect(page.getByText(/base64/)).toHaveCount(0);
});

test("uploads DOCX and XLSX attachments with paths visible to Codex", async ({ page }) => {
  const uploaded: string[] = [];
  await page.route("/api/attachments/upload", async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    const bodyText = body?.toString("latin1") ?? "";
    const isDocx = bodyText.includes('filename="default.docx"');
    const name = isDocx ? "default.docx" : "book.xlsx";
    uploaded.push(name);
    await route.fulfill({
      status: 201,
      json: {
        name,
        path: `C:\\Users\\zhan\\.codex-ultra\\attachments\\${name}`,
        mediaType: isDocx
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: body?.length ?? 0
      }
    });
  });
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([80, 75, 3, 4, 20, 0])], "default.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }));
    data.items.add(new File([new Uint8Array([80, 75, 3, 4, 20, 0])], "book.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
    return data;
  });

  await composer.dispatchEvent("dragenter", { dataTransfer });
  await composer.dispatchEvent("dragover", { dataTransfer });
  await composer.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("default.docx")).toBeVisible();
  await expect(page.getByText("book.xlsx")).toBeVisible();
  expect(uploaded.sort()).toEqual(["book.xlsx", "default.docx"]);

  await composer.fill("Compare the attached Office files");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        type?: string;
        method?: string;
        params?: { input?: Array<{ type?: string; text?: string; path?: string; name?: string }> };
      }>;
    }).__codexUiOutbound;
    const input = messages?.find((message) => message.type === "rpc" && message.method === "turn/start")?.params?.input ?? [];
    const text = input.find((entry) => entry.type === "text")?.text ?? "";
    return text.includes("default.docx") && text.includes("book.xlsx")
      && input.some((entry) => entry.type === "mention" && entry.name === "default.docx")
      && input.some((entry) => entry.type === "mention" && entry.name === "book.xlsx");
  });
});

test("local image views stay folded and load thumbnail and full preview on demand", async ({ page }) => {
  const imagePath = resolve("snapshot/website-desktop.png");
  const imageBytes = await readFile(imagePath);
  let imageRequests = 0;
  await page.route("/api/workspace/image", async (route) => {
    imageRequests += 1;
    await route.fulfill({ status: 200, contentType: "image/png", body: imageBytes });
  });
  await page.goto("/");
  await page.evaluate((path) => {
    const turns = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread;
    turns?.set("thread-1", [{
      id: "turn-image-view",
      threadId: "thread-1",
      status: "completed",
      items: [{ id: "image-view-1", type: "imageView", path }]
    }]);
  }, imagePath);

  await page.getByRole("tab", { name: "Mock thread" }).click();
  const row = page.getByTestId("workbench-item-imageView");
  await expect(row).toBeVisible();
  await expect(row.getByText("Image view")).toBeVisible();
  expect(imageRequests).toBe(0);

  await row.getByRole("button", { name: "Expand image preview" }).click();
  await expect.poll(() => imageRequests).toBe(1);
  const thumbnail = row.locator("img");
  await expect(thumbnail).toBeVisible();

  await thumbnail.click();
  await expect.poll(() => imageRequests).toBe(2);
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await row.getByRole("button", { name: "Collapse image preview" }).click();
  await expect(row.locator("img")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Expand image preview" })).toBeVisible();
  await expect(page.getByTestId("conversation-waterfall")).not.toHaveCSS("height", "0px");
  const animationFrames = await page.evaluate(async () => {
    let frames = 0;
    await new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const sample = () => {
        frames += 1;
        if (performance.now() - startedAt >= 250) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  expect(animationFrames).toBeGreaterThan(0);
});

test("supports dragging workspace explorer files and images into the composer as path mentions", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page, "/root/projects");
  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Explorer" }).click();

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const fileTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole("button", { name: "README.md" }).dispatchEvent("dragstart", { dataTransfer: fileTransfer });
  await composer.dispatchEvent("dragenter", { dataTransfer: fileTransfer });
  await composer.dispatchEvent("dragover", { dataTransfer: fileTransfer });
  await composer.dispatchEvent("drop", { dataTransfer: fileTransfer });

  await expect(page.getByText("File path")).toBeVisible();
  await expect(page.getByText("/root/projects/README.md")).toBeVisible();

  const imageTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole("button", { name: "logo.png" }).dispatchEvent("dragstart", { dataTransfer: imageTransfer });
  await composer.dispatchEvent("dragenter", { dataTransfer: imageTransfer });
  await composer.dispatchEvent("dragover", { dataTransfer: imageTransfer });
  await composer.dispatchEvent("drop", { dataTransfer: imageTransfer });

  await expect(page.getByText("Image path")).toBeVisible();
  await expect(page.getByText("/root/projects/logo.png")).toBeVisible();

  await composer.fill("Compare these workspace assets");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { input?: Array<{ type?: string; text?: string; path?: string; name?: string; url?: string }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.input?.some((input) => input.type === "text" && input.text === "Compare these workspace assets") &&
        message.params?.input?.some((input) => input.type === "mention" && input.name === "README.md" && input.path === "/root/projects/README.md") &&
        message.params?.input?.some((input) => input.type === "mention" && input.name === "logo.png" && input.path === "/root/projects/logo.png") &&
        !message.params?.input?.some((input) => input.type === "image" && input.url?.includes("logo.png"))
    );
  });
});

test("keeps the top workspace panel local-only while preserving SSH in New Chat setup", async ({ page }) => {
  await page.goto("/");

  const panel = page.getByTestId("workspace-selection-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "SSH" })).toHaveCount(0);
  await expect(panel.getByLabel("SSH command")).toHaveCount(0);
  await expect(panel.getByLabel("Workspace")).toBeVisible();

  await page.getByRole("button", { name: "Choose New Chat mode" }).first().click();
  await page.getByTestId("new-chat-mode-workspaceAsk").click();
  const setup = page.getByTestId("new-chat-setup-dialog");
  await expect(setup).toBeVisible();
  await expect(setup.getByRole("button", { name: "SSH" })).toBeVisible();
  await expect(setup.getByLabel("SSH command")).toBeVisible();
  await setup.getByRole("button", { name: "Cancel" }).click();
  await expect(setup).toHaveCount(0);
});

test("sidechat supports multiple isolated /goal windows and preserves slash command text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Open right workspace" }).click();
  await expect(page.getByRole("button", { name: "Hide side chat" })).toBeVisible();
  await expect(page.getByTestId("right-workspace-panel")).toBeVisible();
  await expect(page.getByTestId("sidechat-panel")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Side chat tabs" })).toBeVisible();

  const transcript = page.getByTestId("sidechat-transcript");
  const input = page.getByRole("textbox", { name: "Side chat message" });
  const sendSideChat = page.getByRole("button", { name: "Send side chat message" });
  const firstGoal = " /goal first side window  ";
  const secondGoal = "/goal second side window";
  const statusCommand = "/status preserve command shape";
  const slashTexts = [firstGoal, secondGoal, statusCommand];

  await input.fill(firstGoal);
  await sendSideChat.click();
  await expect(transcript.getByText("/goal first side window", { exact: true }).first()).toBeVisible();

  await page.getByLabel("New side chat").click();
  await page.getByRole("menuitem", { name: /Side chat/ }).click();
  await expect(transcript.getByText("/goal first side window", { exact: true })).toHaveCount(0);
  await input.fill(secondGoal);
  await sendSideChat.click();
  await expect(transcript.getByText(secondGoal, { exact: true }).first()).toBeVisible();

  await page.getByLabel("New side chat").click();
  await page.getByRole("menuitem", { name: /Side chat/ }).click();
  await input.fill(statusCommand);
  await sendSideChat.click();
  await expect(transcript.getByText(statusCommand, { exact: true }).first()).toBeVisible();

  await page.waitForFunction((expectedTexts) => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { threadId?: string; input?: Array<{ type?: string; text?: string }> };
        }>;
      }
    ).__codexUiOutbound ?? [];
    const threadIds = expectedTexts.map((expectedText) => {
      const message = messages.find(
        (entry) =>
          entry.type === "rpc" &&
          entry.method === "turn/start" &&
          entry.params?.input?.some((input) => input.type === "text" && input.text === expectedText)
      );
      return message?.params?.threadId;
    });
    return threadIds.every(Boolean) && new Set(threadIds).size === expectedTexts.length;
  }, slashTexts);

  const sidechatTurns = await page.evaluate((expectedTexts) => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { threadId?: string; input?: Array<{ type?: string; text?: string }> };
        }>;
      }
    ).__codexUiOutbound ?? [];
    return expectedTexts.map((expectedText) => {
      const message = messages.find(
        (entry) =>
          entry.type === "rpc" &&
          entry.method === "turn/start" &&
          entry.params?.input?.some((input) => input.type === "text" && input.text === expectedText)
      );
      return {
        text: expectedText,
        threadId: message?.params?.threadId ?? null
      };
    });
  }, slashTexts);

  expect(sidechatTurns.map((turn) => turn.text)).toEqual(slashTexts);
  expect(new Set(sidechatTurns.map((turn) => turn.threadId)).size).toBe(slashTexts.length);
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tablist", { name: "Task tabs" }).getByText("New mock thread")).toHaveCount(0);

  await page.getByTestId("sidechat-tab-sidechat-1").click();
  await expect(transcript.getByText("/goal first side window", { exact: true }).first()).toBeVisible();
  await expect(transcript.getByText(secondGoal, { exact: true })).toHaveCount(0);
  await page.getByTestId("sidechat-tab-sidechat-2").click();
  await expect(transcript.getByText(secondGoal, { exact: true }).first()).toBeVisible();
  await expect(transcript.getByText(statusCommand, { exact: true })).toHaveCount(0);

  await page.screenshot({
    path: "snapshot/sidechat-workbench.png",
    fullPage: false
  });
});

test("selects an active relay group from the composer runtime bar", async ({ page }) => {
  providerApiList = [
    {
      ...mockProvider,
      groups: [
        { id: "text-main", name: "Text Main", kind: "text", groupRatio: 1, keys: ["sk-text"] },
        { id: "image-main", name: "Image Main", kind: "image", groupRatio: 1.2, keys: ["sk-image"] }
      ]
    }
  ];

  await page.goto("/");
  await confirmWorkspace(page);
  await page.getByTestId("composer-provider-chip").click();
  await page.getByRole("button", { name: /HubProxy Grok/ }).click();
  await expect(page.getByTestId("composer-provider-group-chip")).toContainText("Text Main");
  await page.getByTestId("composer-provider-group-chip").click();
  await page.getByRole("button", { name: /Image Main/ }).click();
  await expect(page.getByTestId("composer-provider-group-chip")).toContainText("Image Main");
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; providerId?: string; groupId?: string }> }).__codexUiOutbound ?? [];
    return messages.some(
      (message) => message.type === "provider.activate" && message.providerId === "hubproxy-grok" && message.groupId === "image-main"
    );
  });
});

test("blocks image generation when the active relay has no image group", async ({ page }) => {
  let imageRequests = 0;
  await page.route("/api/images/generations", async (route) => {
    imageRequests += 1;
    await route.fulfill({ json: { data: [] } });
  });
  await page.goto("/");
  await confirmWorkspace(page);
  await page.getByTestId("composer-provider-chip").click();
  await page.getByRole("button", { name: /HubProxy Grok/ }).click();

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("/image draw a launch screen");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("当前中转站没有生图分组，请配置后继续").first()).toBeVisible();
  expect(imageRequests).toBe(0);
});

test("opens homepage session stats from the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);
  await expect(page.getByText("mock-codex")).toBeVisible();

  await page.getByTestId("topbar-session-stats-button").click();
  await expect(page.getByTestId("session-stats-dialog")).toBeVisible();
  await expect(page.getByTestId("slash-stats-panel")).toContainText("Session Status");
  await page.getByTestId("slash-stats-panel").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("session-stats-dialog")).toHaveCount(0);
});

test("routes Web slash commands to real actions and preserves unknown extensions", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const send = page.getByRole("button", { name: "Send", exact: true });
  async function sendUnknownSlashAndExpectForwarded(command: string) {
    await composer.fill(command);
    await send.click();
    await page.waitForFunction((expectedText) => {
      const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ type?: string; text?: string }> } }> }).__codexUiOutbound ?? [];
      return messages.some(
        (message) =>
          message.method === "turn/start" &&
          message.params?.input?.some((entry) => entry.type === "text" && entry.text === expectedText)
      );
    }, command);
  }
  await expect(page.getByText("mock-codex")).toBeVisible();
  await expect(composer).toBeEnabled();
  await composer.focus();
  await composer.press("Shift+Tab");
  await expect(page.getByTestId("composer-plan-badge")).toBeVisible();
  await composer.press("Shift+Tab");
  await expect(page.getByTestId("composer-plan-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "Attach files to this turn. Images, PDF, Office documents, and text files are supported." }).click();
  await expect(page.getByRole("menuitem").filter({ hasText: "/fast" })).toBeVisible();
  await page.getByRole("menuitem").filter({ hasText: "/status" }).click();
  await expect(page.getByTestId("slash-stats-panel")).toContainText("Session Status");
  let outbound = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []);
  expect(outbound.some((message) => message.method === "turn/start")).toBe(false);
  await page.getByTestId("slash-stats-panel").getByRole("button", { name: "Close" }).click();

  await page.evaluate(() => {
    ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
  });
  await composer.fill("/fast");
  await send.click();
  await expect(page.getByTestId("topbar-fast-badge")).toBeVisible();
  await expect(page.getByTestId("composer-fast-badge")).toBeVisible();
  outbound = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []);
  expect(outbound.some((message) => message.method === "turn/start")).toBe(false);

  await composer.fill("fast mode turn");
  await send.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { effort?: string; input?: Array<{ type?: string; text?: string }> } }> }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "turn/start" &&
        (message.params?.effort === "minimal" || message.params?.effort === "low") &&
        message.params?.input?.some((entry) => entry.type === "text" && entry.text === "fast mode turn")
    );
  });
  await expect(page.getByTestId("composer-working-indicator")).toHaveCount(0);

  await composer.fill("/goal keep slash command status visible");
  await send.click();
  await expect(page.getByTestId("sticky-goal-bar")).toContainText("keep slash command status visible");
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { objective?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/goal/set" && message.params?.objective === "keep slash command status visible");
  });
  await expect(page.getByTestId("composer-goal-badge")).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as {
      __codexUiPlanContinuationAutoCompleteAfter?: number;
    }).__codexUiPlanContinuationAutoCompleteAfter = 2;
  });
  await composer.fill("/plan inspect slash router states");
  await send.click();
  await expect(page.getByTestId("composer-plan-badge")).toBeVisible();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { collaborationMode?: { mode?: string; settings?: { reasoning_effort?: string; developer_instructions?: string | null } }; input?: Array<{ type?: string; text?: string }> } }> }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "turn/start" &&
        message.params?.collaborationMode?.mode === "plan" &&
        message.params?.collaborationMode?.settings?.reasoning_effort === "medium" &&
        message.params?.collaborationMode?.settings?.developer_instructions?.includes("autonomously") === true &&
        message.params?.input?.some((entry) => entry.type === "text" && entry.text === "inspect slash router states")
    );
  });
  await expect(page.getByTestId("composer-working-indicator")).toHaveCount(0);
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ text?: string }> } }>;
    }).__codexUiOutbound ?? [];
    return messages.filter((message) =>
      message.method === "turn/start"
      && message.params?.input?.some((entry) => entry.text?.startsWith("[[codex-ultra:plan-continuation]]"))
    ).length >= 2;
  });
  await expect(page.getByText("[[codex-ultra:plan-continuation]]", { exact: false })).toHaveCount(0);
  const planDialog = page.getByTestId("plan-implementation-dialog");
  await expect(planDialog).toBeVisible();
  await expect(planDialog).toContainText("Produce the final actionable plan");
  await planDialog.getByRole("button", { name: "Cancel and stay in Plan mode" }).click();
  await expect(planDialog).toHaveCount(0);

  await composer.fill("/plan off");
  await send.click();
  await expect(page.getByTestId("composer-plan-badge")).toHaveCount(0);
  outbound = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ type?: string; text?: string }> } }> }).__codexUiOutbound ?? []);
  expect(
    outbound.some(
      (message) =>
        message.method === "turn/start" &&
        message.params?.input?.some((entry) => entry.type === "text" && entry.text === "/plan off")
    )
  ).toBe(false);

  await composer.fill("/stats");
  await send.click();
  await expect(page.getByTestId("slash-stats-panel")).toContainText("Project Stats");
  await expect(page.getByTestId("slash-stats-panel")).toContainText("Fast on");
  await expect(page.getByTestId("slash-stats-panel")).toContainText("Goal Active");

  await composer.fill("/rename Focused slash work");
  await send.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { name?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/name/set" && message.params?.name === "Focused slash work");
  });

  await composer.fill("/review detached branch main");
  await send.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { delivery?: string; target?: { type?: string; branch?: string } } }>;
    }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "review/start" &&
        message.params?.delivery === "detached" &&
        message.params.target?.type === "baseBranch" &&
        message.params.target.branch === "main"
    );
  });

  await composer.fill("/diff");
  await send.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "gitDiffToRemote");
  });
  await expect(page.getByTestId("slash-command-result")).toContainText("Diff to remote");

  await composer.fill("/compact");
  await send.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/compact/start");
  });

  await composer.fill("/resume thread-2");
  await send.click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string } }> }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/resume" && message.params?.threadId === "thread-2");
  });

  await composer.fill("/theme");
  await send.click();
  await expect(page.getByTestId("slash-command-result")).toContainText("/theme is not available in Web");

  await sendUnknownSlashAndExpectForwarded("/custom-extension keep payload");

  await page.screenshot({
    path: "snapshot/slash-command-status-goal-plan.png",
    fullPage: false
  });
});

test("cancels a running goal turn and keeps the goal paused", async ({ page }) => {
  test.setTimeout(15_000);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await confirmWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __codexUiNativeGoalCompletionDelayMs?: number }).__codexUiNativeGoalCompletionDelayMs = 5_000;
  });

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("/goal keep cancellation recoverable");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const goal = page.getByTestId("sticky-goal-bar");
  await expect(goal).toContainText("keep cancellation recoverable");
  await goal.getByRole("button", { name: "Cancel and pause" }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { status?: string } }>;
    }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "turn/interrupt")
      && messages.some((message) => message.method === "thread/goal/set" && message.params?.status === "paused");
  });
  await expect(goal).toContainText("Paused");
  await expect(page.getByTestId("composer-goal-badge")).toBeVisible();
});

test("routes slash commands to matching settings and workspace surfaces", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const send = page.getByRole("button", { name: "Send", exact: true });
  const runSlash = async (command: string) => {
    await composer.fill(command);
    await send.click();
  };

  await runSlash("/usage");
  await expect(page.getByRole("heading", { name: "Usage & Billing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();

  await runSlash("/mcp verbose");
  await expect(page.getByRole("tab", { name: /^MCP / })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close settings" }).click();

  await runSlash("/mention");
  const workspace = page.getByTestId("right-workspace-panel");
  const workspaceTabs = workspace.getByRole("tablist", { name: "Right workspace tabs" });
  await expect(workspace).toBeVisible();
  await expect(workspaceTabs.getByRole("tab", { name: "Explorer" })).toHaveAttribute("aria-selected", "true");

  await runSlash("/side");
  await expect(workspaceTabs.getByRole("tab", { name: "Side chat" })).toHaveAttribute("aria-selected", "true");

  await runSlash("/ps");
  await expect(workspaceTabs.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");

  const outbound = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []);
  expect(outbound.some((message) => message.method === "turn/start")).toBe(false);
});

test("renders Codex plan mode updates as plan waterfall rows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("/plan plan render probe");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByTestId("composer-plan-badge")).toBeVisible();
  const waterfallPlan = page.getByTestId("workbench-item-plan").filter({ hasText: "Plan mode generated a checklist" });
  await expect(waterfallPlan).toBeVisible();
  await expect(waterfallPlan.getByText("Inspect plan mode protocol")).toBeVisible();
  await expect(waterfallPlan.getByText("Render plan waterfall row")).toBeVisible();
  const taskPlanPanel = page.getByTestId("task-plan-panel");
  await expect(taskPlanPanel).toBeVisible();
  await expect(taskPlanPanel).toContainText("1 of 3 complete");
  await expect(taskPlanPanel.getByTestId("task-plan-steps")).toBeVisible();
  await expect(page.getByTestId("conversation-item-item-1-plan")).toContainText("Confirm /plan uses collaborationMode");
  await expect(page.getByTestId("sticky-goal-bar")).toHaveCount(0);
  const implementationDialog = page.getByTestId("plan-implementation-dialog");
  await expect(implementationDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(implementationDialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(implementationDialog).toBeVisible();
  await implementationDialog.getByRole("button", { name: "Yes, implement this plan" }).click();
  await expect(page.getByTestId("composer-plan-badge")).toHaveCount(0);
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        method?: string;
        params?: {
          collaborationMode?: { mode?: string; settings?: { developer_instructions?: string | null } };
          input?: Array<{ type?: string; text?: string }>;
        };
      }>;
    }).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "turn/start" &&
        message.params?.collaborationMode?.mode === "default" &&
        message.params?.collaborationMode?.settings?.developer_instructions === null &&
        message.params?.input?.some((entry) => entry.type === "text" && entry.text === "Implement the plan.")
    );
  });
  const implementationDelivery = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ type?: string; text?: string }> } }>;
    }).__codexUiOutbound ?? [];
    return messages
      .filter((message) =>
        message.params?.input?.some(
          (entry) => entry.type === "text" && entry.text === "Implement the plan."
        )
      )
      .map((message) => message.method);
  });
  expect(implementationDelivery).toEqual(["turn/start"]);
  const implementationUser = page.getByTestId("workbench-item-userMessage").filter({ hasText: "Implement the plan." });
  const implementationReply = page.getByTestId("workbench-item-agentMessage").filter({ hasText: "Accepted Implement the plan." });
  await expect(implementationUser).toBeVisible();
  await expect(implementationReply).toBeVisible();
  await expect(page.getByTestId("workbench-item-pendingAppend")).toHaveCount(0);
  await assertMountedWaterfallRowsDoNotOverlap(page);
  await page.screenshot({ path: "snapshot/plan-implementation-waterfall.png", fullPage: false, timeout: 10_000 });
});

test("appends the first plan message without refreshing history or overlapping the reply", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);

  const threadListCountBeforeSend = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    (window as unknown as { __codexUiProviderActivationDelayMs?: number }).__codexUiProviderActivationDelayMs = 1_200;
    (window as unknown as { __codexUiThreadStartDelayMs?: number }).__codexUiThreadStartDelayMs = 1_200;
    return messages.filter((message) => message.method === "thread/list").length;
  });

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("/plan optimistic first plan message");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const optimisticUser = page.getByTestId("workbench-item-pendingAppend").filter({ hasText: "optimistic first plan message" });
  await expect(optimisticUser).toBeVisible({ timeout: 700 });
  await page.waitForTimeout(250);
  const threadListCountWhileSending = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    return messages.filter((message) => message.method === "thread/list").length;
  });
  expect(threadListCountWhileSending).toBe(threadListCountBeforeSend);

  await expect(page.getByTestId("workbench-item-agentMessage").filter({ hasText: "Accepted optimistic first plan message" })).toBeVisible({ timeout: 10_000 });
  await expect(optimisticUser).toHaveCount(0);
  await assertMountedWaterfallRowsDoNotOverlap(page);
  await page.screenshot({ path: "snapshot/plan-first-message-waterfall.png", fullPage: false, timeout: 10_000 });

  const threadListCountAfterReply = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? [];
    return messages.filter((message) => message.method === "thread/list").length;
  });
  expect(threadListCountAfterReply).toBe(threadListCountBeforeSend);
});

test("restores the confirmed workspace from SQLite preferences after reload", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page, "~/projects/persisted-workspace");
  await expect.poll(() => (userPreferences.workspace as { cwd?: string } | undefined)?.cwd).toBe("~/projects/persisted-workspace");

  await page.reload();
  await expect(page.getByTestId("workspace-selection-panel")).toHaveCount(0, { timeout: 10_000 });
  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("persisted workspace probe");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { cwd?: string } }>;
    }).__codexUiOutbound ?? [];
    return messages.some((message) => message.method === "thread/start" && message.params?.cwd === "~/projects/persisted-workspace");
  });
});

test("shows a collapsible responsive task plan and closes it after completion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Mock thread" }).click();

  const emitPlan = async (status: "active" | "complete") => {
    await page.evaluate((nextStatus) => {
      const socket = (window as unknown as {
        __codexUiSockets?: Array<{ dispatchEvent: (event: MessageEvent) => boolean; onmessage?: ((event: MessageEvent) => void) | null }>;
      }).__codexUiSockets?.at(-1);
      if (!socket) throw new Error("Missing mock socket");
      const emit = (method: string, params: Record<string, unknown>) => {
        const event = new MessageEvent("message", {
          data: JSON.stringify({ type: "codex.notification", message: { method, params } })
        });
        socket.dispatchEvent(event);
        socket.onmessage?.(event);
      };
      if (nextStatus === "active") {
        emit("turn/started", {
          threadId: "thread-1",
          turn: { id: "task-plan-overlay-turn", threadId: "thread-1", status: "inProgress", startedAt: Date.now() / 1000 }
        });
      }
      emit("turn/plan/updated", {
        threadId: "thread-1",
        turnId: "task-plan-overlay-turn",
        explanation: nextStatus === "complete" ? "Implementation complete" : "Implement the active checklist",
        plan: [
          { step: "Inspect structured plan events", status: "completed" },
          { step: "Render the floating task panel", status: nextStatus === "complete" ? "completed" : "inProgress" },
          { step: "Verify responsive completion animation", status: nextStatus === "complete" ? "completed" : "pending" }
        ]
      });
    }, status);
  };

  await emitPlan("active");
  const taskPlanPanel = page.getByTestId("task-plan-panel");
  const toggle = taskPlanPanel.getByTestId("task-plan-toggle");
  await expect(taskPlanPanel).toBeVisible();
  await expect(taskPlanPanel).toContainText("1 of 3 complete");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(taskPlanPanel.getByTestId("task-plan-steps")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const dragHandle = taskPlanPanel.getByTestId("task-plan-drag-handle");
  const initialBounds = await taskPlanPanel.boundingBox();
  expect(initialBounds).not.toBeNull();
  await dragHandle.hover();
  await page.mouse.move(initialBounds!.x + 90, initialBounds!.y + 20);
  await page.mouse.down();
  await page.mouse.move(initialBounds!.x + 310, initialBounds!.y + 180, { steps: 8 });
  await page.mouse.up();
  const draggedBounds = await taskPlanPanel.boundingBox();
  expect(draggedBounds).not.toBeNull();
  expect(draggedBounds!.x).toBeGreaterThan(initialBounds!.x + 100);
  expect(draggedBounds!.y).toBeGreaterThan(initialBounds!.y + 80);
  expect(draggedBounds!.x + draggedBounds!.width).toBeLessThanOrEqual(1440);
  expect(draggedBounds!.y + draggedBounds!.height).toBeLessThanOrEqual(960);

  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await taskPlanPanel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);

  await emitPlan("complete");
  await expect(taskPlanPanel).toHaveAttribute("data-completing", "true");
  await expect(taskPlanPanel).toContainText("Plan complete");
  await expect(taskPlanPanel).toHaveCount(0, { timeout: 3_000 });
});

test("prompts before opening a persisted goal and pauses it before loading the transcript", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as {
      __codexUiGoalByThread?: Record<string, unknown>;
      __codexUiOutbound?: unknown[];
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiGoalByThread = {
      "thread-1": {
        threadId: "thread-1",
        objective: "Keep the active goal idle until the user confirms",
        status: "active",
        tokenBudget: null,
        tokensUsed: 64,
        timeUsedSeconds: 12,
        createdAt: Math.floor(Date.now() / 1000) - 120,
        updatedAt: Math.floor(Date.now() / 1000)
      }
    };
    (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread?.set("thread-1", [{
      id: "persisted-goal-history",
      threadId: "thread-1",
      status: "completed",
      startedAt: 1710000000,
      completedAt: 1710000001,
      items: [
        { id: "persisted-goal-user", type: "userMessage", content: [{ type: "text", text: "Persisted goal history prompt" }] },
        { id: "persisted-goal-agent", type: "agentMessage", text: "Persisted goal history response" }
      ]
    }]);
    ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByTestId("goal-resume-dialog")).toBeVisible();
  const calls = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { status?: string } }>;
    }).__codexUiOutbound ?? [];
    return {
      pauseIndex: messages.findIndex((message) => message.method === "thread/goal/set" && message.params?.status === "paused"),
      resumeIndex: messages.findIndex((message) => message.method === "thread/resume"),
      turnStarts: messages.filter((message) => message.method === "turn/start").length
    };
  });
  expect(calls.pauseIndex).toBeGreaterThanOrEqual(0);
  expect(calls.resumeIndex).toBeGreaterThanOrEqual(0);
  expect(calls.turnStarts).toBe(0);

  ((await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? [];
    messages.length = 0;
    return true;
  })) as boolean);
  const dialog = page.getByTestId("goal-resume-dialog");
  await dialog.getByRole("button", { name: "Pause /goal" }).click();
  await expect(dialog).toHaveCount(0);
  const afterCancel = await page.evaluate(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { status?: string } }> }).__codexUiOutbound ?? [];
    return {
      turnStarts: messages.filter((message) => message.method === "turn/start").length,
      pausedGoalWrites: messages.filter((message) => message.method === "thread/goal/set" && message.params?.status === "paused").length
    };
  });
  expect(afterCancel.turnStarts).toBe(0);
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("conversation-waterfall")).toHaveAttribute("data-row-count", /[1-9]\d*/);
  await expect(page.getByTestId("sticky-goal-bar")).toContainText("Paused");
});

test("requires confirmation to continue a persisted goal even when the previous segment completed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() => {
    (window as unknown as { __codexUiGoalContinuationStartedDelayMs?: number }).__codexUiGoalContinuationStartedDelayMs = 1_000;
    localStorage.setItem("codex-ultra.thread-runtime-selections", JSON.stringify({
      __new__: { providerId: "hubproxy-grok", groupId: "text-main", model: "gpt-5.6-sol", reasoningEffort: "medium" },
      "thread-1": { providerId: "hubproxy-grok", groupId: "text-main", model: "gpt-5.6-sol", reasoningEffort: "high" }
    }));
  });
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as {
      __codexUiGoalByThread?: Record<string, unknown>;
      __codexUiOutbound?: unknown[];
    }).__codexUiGoalByThread = {
      "thread-1": {
        threadId: "thread-1",
        objective: "Resume the persisted goal without reloading the waterfall",
        status: "complete",
        tokenBudget: null,
        tokensUsed: 128,
        timeUsedSeconds: 42,
        createdAt: Math.floor(Date.now() / 1000) - 120,
        updatedAt: Math.floor(Date.now() / 1000)
      }
    };
    ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  const dialog = page.getByTestId("goal-resume-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);
  await expect(dialog).toContainText("Resume the persisted goal without reloading the waterfall");
  await expect(dialog.getByRole("button")).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Continue /goal" }).click();
  await page.waitForTimeout(100);
  await expect(dialog).toBeVisible();
  const prematureGoalActivationCount = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { status?: string } }>;
    }).__codexUiOutbound ?? [];
    return messages.filter((message) => message.method === "thread/goal/set" && message.params?.status === "active").length;
  });
  expect(prematureGoalActivationCount).toBe(0);
  await expect(dialog).toHaveCount(0);
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; status?: string } }>;
    }).__codexUiOutbound ?? [];
    return messages.filter((message) =>
      message.method === "thread/goal/set" &&
      message.params?.threadId === "thread-1" &&
      message.params?.status === "active"
    ).length === 1;
  });
  await expect(page.getByText("[[codex-ultra:goal-continuation]]", { exact: false })).toHaveCount(0);
  const resumeCalls = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        method?: string;
        params?: {
          status?: string;
          approvalPolicy?: string;
          sandboxPolicy?: { type?: string };
          collaborationMode?: { mode?: string };
          input?: Array<{ text?: string }>;
          runtimeWorkspaceRoots?: string[];
          environments?: Array<{ environmentId?: string; cwd?: string; runtimeWorkspaceRoots?: string[] }>;
        };
      }>;
    }).__codexUiOutbound ?? [];
    const continuationIndexes = messages.flatMap((message, index) =>
      message.method === "turn/start" &&
      message.params?.input?.some((entry) => entry.text?.startsWith("[[codex-ultra:goal-continuation]]"))
        ? [index]
        : []
    );
    const goalSetIndexes = messages.flatMap((message, index) =>
      message.method === "thread/goal/set" && message.params?.status === "active" ? [index] : []
    );
    return {
      continuationIndexes,
      goalSetIndexes,
      continuation: continuationIndexes.length === 1 ? messages[continuationIndexes[0]] : null
    };
  });
  expect(resumeCalls.continuationIndexes).toHaveLength(1);
  expect(resumeCalls.goalSetIndexes).toHaveLength(1);
  expect(resumeCalls.continuationIndexes[0]).toBeLessThan(resumeCalls.goalSetIndexes[0]);
  expect(resumeCalls.continuation?.params?.approvalPolicy).toBe("never");
  expect(resumeCalls.continuation?.params?.sandboxPolicy?.type).toBe("dangerFullAccess");
  expect(resumeCalls.continuation?.params?.collaborationMode?.mode).toBe("default");
  expect(resumeCalls.continuation?.params?.runtimeWorkspaceRoots).toEqual(["/root/projects"]);
  expect(resumeCalls.continuation?.params?.environments).toBeUndefined();
  await page.waitForTimeout(1_000);
  await expect.poll(async () => {
    return page.evaluate(() => {
      const messages = (window as unknown as {
        __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ text?: string }> } }>;
      }).__codexUiOutbound ?? [];
      return messages.filter((message) =>
        message.method === "turn/start" &&
        message.params?.input?.some((entry) => entry.text?.startsWith("[[codex-ultra:goal-continuation]]"))
      ).length;
    });
  }).toBe(1);
});

test("can pause a persisted goal while continuation is waiting to start", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __codexUiGoalContinuationStartedDelayMs?: number }).__codexUiGoalContinuationStartedDelayMs = 1_000;
  });
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { __codexUiGoalByThread?: Record<string, unknown>; __codexUiOutbound?: unknown[] }).__codexUiGoalByThread = {
      "thread-1": {
        threadId: "thread-1",
        objective: "Pause a continuation before its delayed turn starts",
        status: "active",
        tokenBudget: null,
        tokensUsed: 10,
        timeUsedSeconds: 5,
        createdAt: Math.floor(Date.now() / 1000) - 60,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    };
    ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  const dialog = page.getByTestId("goal-resume-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue /goal" }).click();
  await expect(dialog.getByRole("button", { name: "Pause /goal" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Continuing..." })).toBeDisabled();
  await dialog.getByRole("button", { name: "Pause /goal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("sticky-goal-bar")).toContainText("Paused");

  await page.waitForTimeout(1_200);
  const calls = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { status?: string } }>;
    }).__codexUiOutbound ?? [];
    return {
      activeWrites: messages.filter((message) => message.method === "thread/goal/set" && message.params?.status === "active").length,
      pausedWrites: messages.filter((message) => message.method === "thread/goal/set" && message.params?.status === "paused").length,
      interrupts: messages.filter((message) => message.method === "turn/interrupt").length,
    };
  });
  expect(calls.activeWrites).toBe(0);
  expect(calls.pausedWrites).toBeGreaterThanOrEqual(1);
  expect(calls.interrupts).toBe(1);
});

test("switches back to a running goal thread without reloading or resuming it again", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as {
      __codexUiGoalContinuationCompletionDelayMs?: number;
    }).__codexUiGoalContinuationCompletionDelayMs = 15_000;
  });
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as {
      __codexUiGoalByThread?: Record<string, unknown>;
      __codexUiOutbound?: unknown[];
    }).__codexUiGoalByThread = {
      "thread-1": {
        threadId: "thread-1",
        objective: "Keep the running goal in memory while switching tasks",
        status: "active",
        tokenBudget: null,
        tokensUsed: 96,
        timeUsedSeconds: 24,
        createdAt: Math.floor(Date.now() / 1000) - 120,
        updatedAt: Math.floor(Date.now() / 1000)
      }
    };
    (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread?.set("thread-1", [{
      id: "running-goal-history",
      threadId: "thread-1",
      status: "completed",
      startedAt: 1710000000,
      completedAt: 1710000001,
      items: [
        { id: "running-goal-user", type: "userMessage", content: [{ type: "text", text: "Running goal history prompt" }] },
        { id: "running-goal-agent", type: "agentMessage", text: "Running goal history response" }
      ]
    }]);
    ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  const dialog = page.getByTestId("goal-resume-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continue /goal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("conversation-waterfall")).toHaveAttribute("data-row-count", /[1-9]\d*/);
  await expect(page.getByText("Continued persisted goal with the restored tools.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Mock thread" }).getByTestId("running-thread-pulse")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open history Mock thread" }).getByTestId("running-thread-pulse")).toBeVisible();

  await page.getByRole("tab", { name: "New task" }).click();
  const workspaceSetup = page.getByTestId("new-chat-setup-dialog");
  await expect(workspaceSetup).toBeVisible({ timeout: 10_000 });
  await workspaceSetup.getByRole("button", { name: "Cancel" }).click();
  await expect(workspaceSetup).toHaveCount(0);

  const callsBeforeSwitch = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; status?: string } }>;
    }).__codexUiOutbound ?? [];
    return {
      reads: messages.filter((message) => message.method === "thread/read" && message.params?.threadId === "thread-1").length,
      resumes: messages.filter((message) => message.method === "thread/resume" && message.params?.threadId === "thread-1").length,
      pauses: messages.filter((message) => message.method === "thread/goal/set" && message.params?.threadId === "thread-1" && message.params?.status === "paused").length
    };
  });

  await page.getByRole("tab", { name: "Mock thread" }).click();
  await expect(page.getByText("Continued persisted goal with the restored tools.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Mock thread" }).getByTestId("running-thread-pulse")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open history Mock thread" }).getByTestId("running-thread-pulse")).toBeVisible();
  await expect(page.getByTestId("goal-resume-dialog")).toHaveCount(0);
  await expect(page.getByTestId("thread-load-progress")).toHaveCount(0);

  const callsAfterSwitch = await page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{ method?: string; params?: { threadId?: string; status?: string } }>;
    }).__codexUiOutbound ?? [];
    return {
      reads: messages.filter((message) => message.method === "thread/read" && message.params?.threadId === "thread-1").length,
      resumes: messages.filter((message) => message.method === "thread/resume" && message.params?.threadId === "thread-1").length,
      pauses: messages.filter((message) => message.method === "thread/goal/set" && message.params?.threadId === "thread-1" && message.params?.status === "paused").length
    };
  });
  expect(callsAfterSwitch).toEqual(callsBeforeSwitch);
});

test("reconciles lossy snapshots without duplicate assistant rows or misplaced tools", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Mock thread" }).click();

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiSockets?.at(-1);
    const snapshots = (window as unknown as {
      __codexUiReconciledTurnsByThread?: Map<string, Array<Record<string, unknown>>>;
    }).__codexUiReconciledTurnsByThread;
    if (!socket || !snapshots) throw new Error("Missing mock reconciliation state");
    const emit = (method: string, params: Record<string, unknown>) => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ type: "codex.notification", message: { method, params } })
      });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const threadId = "thread-1";
    const turnId = "lossy-reconcile-turn";
    emit("turn/started", {
      threadId,
      turn: { id: turnId, threadId, status: "inProgress", startedAt: 1710000100 }
    });
    for (const item of [
      { id: "reconcile-live-user", type: "userMessage", content: [{ type: "text", text: "Plan Windows support" }] },
      { id: "reconcile-live-agent-1", type: "agentMessage", text: "I will inspect the project first." },
      { id: "reconcile-live-tool-1", type: "commandExecution", command: "rg platform assumptions", aggregatedOutput: "build.zig", status: "completed" },
      { id: "reconcile-live-tool-2", type: "dynamicToolCall", namespace: "workspace", tool: "inspect", text: "Inspect runtime bindings", status: "completed" },
      { id: "reconcile-live-agent-2", type: "agentMessage", text: "The build currently assumes Linux paths." },
      { id: "reconcile-live-patch", type: "dynamicToolCall", namespace: "workspace", tool: "apply_patch", text: "Write the compatibility plan", status: "completed" },
      { id: "reconcile-live-agent-3", type: "agentMessage", text: "The plan is ready." }
    ]) {
      emit("item/completed", { threadId, turnId, item });
    }
    emit("turn/completed", {
      threadId,
      turn: { id: turnId, threadId, status: "completed", completedAt: 1710000110 }
    });

    snapshots.set(threadId, [{
      id: turnId,
      threadId,
      status: "completed",
      startedAt: 1710000100,
      completedAt: 1710000110,
      items: [
        { id: "item-1", type: "userMessage", content: [{ type: "text", text: "Plan Windows support" }] },
        { id: "item-2", type: "agentMessage", text: "I will inspect the project first." },
        { id: "item-3", type: "agentMessage", text: "The build currently assumes Linux paths." },
        { id: "item-4", type: "agentMessage", text: "The plan is ready." }
      ]
    }]);
  });

  await expect(page.getByText("The plan is ready.", { exact: true })).toHaveCount(1);
  await page.getByRole("tab", { name: "Second task" }).click();
  await page.getByRole("tab", { name: "Mock thread" }).click();
  await expect(page.getByText("I will inspect the project first.", { exact: true })).toHaveCount(1);
  await expect(page.getByText("The build currently assumes Linux paths.", { exact: true })).toHaveCount(1);
  await expect(page.getByText("The plan is ready.", { exact: true })).toHaveCount(1);

  const reconciledOrder = await page.locator('[data-testid^="conversation-item-reconcile-live-"]').evaluateAll((elements) =>
    elements
      .map((element) => ({
        id: element.getAttribute("data-testid")?.replace("conversation-item-", "") ?? "",
        index: Number(element.getAttribute("data-index"))
      }))
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.id)
  );
  expect(reconciledOrder).toEqual([
    "reconcile-live-user",
    "reconcile-live-agent-1",
    "reconcile-live-tool-1",
    "reconcile-live-tool-2",
    "reconcile-live-agent-2",
    "reconcile-live-patch",
    "reconcile-live-agent-3"
  ]);
  await assertMountedWaterfallRowsDoNotOverlap(page);
});

test("keeps plan and goal waterfall events in protocol order across untimed tools and late starts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Mock thread" }).click();
  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await composer.fill("/goal Keep goal and plan events chronological");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("sticky-goal-bar")).toContainText("Keep goal and plan events chronological");

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{ dispatchEvent: (event: MessageEvent) => boolean; onmessage?: ((event: MessageEvent) => void) | null }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (method: string, params: Record<string, unknown>) => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ type: "codex.notification", message: { method, params } })
      });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const threadId = "thread-1";
    const turnId = "order-turn";
    emit("turn/started", { threadId, turn: { id: turnId, threadId, status: "inProgress", startedAt: Date.now() / 1000 } });
    emit("item/completed", {
      threadId,
      turnId,
      item: { id: "order-user", type: "userMessage", text: "/goal continue the plan" }
    });
    emit("item/agentMessage/delta", { threadId, turnId, itemId: "order-assistant-first", delta: "First update" });
    emit("item/started", {
      threadId,
      turnId,
      item: { id: "order-command", type: "commandExecution", command: "rg ordering", status: "inProgress" }
    });
    emit("turn/plan/updated", {
      threadId,
      turnId,
      explanation: "Ordering checklist",
      plan: [{ step: "Keep all rows chronological", status: "inProgress" }]
    });
    emit("item/agentMessage/delta", { threadId, turnId, itemId: "order-assistant-later", delta: "Later update" });
    emit("turn/started", { threadId, turn: { id: turnId, threadId, status: "inProgress", startedAt: Date.now() / 1000 } });
  });

  const ids = [
    "conversation-item-order-user",
    "conversation-item-order-assistant-first",
    "conversation-item-order-command",
    "conversation-item-turn-plan-order-turn",
    "conversation-item-order-assistant-later"
  ];
  for (const id of ids) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("sticky-goal-bar")).toContainText("Keep goal and plan events chronological");
  await expect(page.getByTestId("task-plan-panel")).toContainText("Keep all rows chronological");
  await expect(page.getByTestId("conversation-item-turn-plan-order-turn")).toContainText("Ordering checklist");
  const selector = ids.map((id) => `[data-testid="${id}"]`).join(",");
  await expect.poll(() => page.locator(selector).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid")))).toEqual(ids);
  await page.screenshot({ path: "snapshot/waterfall-plan-goal-order.png", fullPage: false });
});

test("renders Codex-style activity verbs for commands, files, and terminal waits", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Mock thread" }).click();

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{ dispatchEvent: (event: MessageEvent) => boolean; onmessage?: ((event: MessageEvent) => void) | null }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (method: string, params: Record<string, unknown>) => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ type: "codex.notification", message: { method, params } })
      });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    const addTurn = (turnId: string, startedAt: number) => {
      emit("turn/started", { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "inProgress", startedAt } });
    };
    const addCompletedItem = (turnId: string, item: Record<string, unknown>) => {
      emit("item/completed", { threadId: "thread-1", turnId, item });
    };
    const startedAt = Date.now() / 1000;

    addTurn("activity-read-turn", startedAt + 1);
    addCompletedItem("activity-read-turn", {
      id: "activity-read",
      type: "commandExecution",
      command: "cat README.md",
      commandActions: [{ type: "read", name: "README.md", path: "/repo/README.md", command: "cat README.md" }],
      status: "completed"
    });
    addTurn("activity-editing-turn", startedAt + 2);
    emit("item/started", {
      threadId: "thread-1",
      turnId: "activity-editing-turn",
      item: { id: "activity-editing", type: "fileChange", changes: [{ path: "apps/web/src/live.ts", kind: "update" }], status: "inProgress" }
    });
    addTurn("activity-list-turn", startedAt + 3);
    addCompletedItem("activity-list-turn", {
      id: "activity-list",
      type: "commandExecution",
      command: "ls apps",
      commandActions: [{ type: "listFiles", path: "apps", command: "ls apps" }],
      status: "completed"
    });
    addTurn("activity-edited-turn", startedAt + 4);
    addCompletedItem("activity-edited-turn", {
      id: "activity-edited",
      type: "fileChange",
      changes: [{ path: "apps/web/src/done.ts", kind: "update" }],
      status: "completed"
    });
    addTurn("activity-search-turn", startedAt + 5);
    addCompletedItem("activity-search-turn", {
      id: "activity-search",
      type: "commandExecution",
      command: "rg plan apps",
      commandActions: [{ type: "search", query: "plan", path: "apps", command: "rg plan apps" }],
      status: "completed"
    });
    addTurn("activity-divider-turn", startedAt + 6);
    addCompletedItem("activity-divider-turn", {
      id: "activity-divider",
      type: "agentMessage",
      text: "Activity classification complete."
    });
    addTurn("activity-ran-turn", startedAt + 7);
    addCompletedItem("activity-ran-turn", {
      id: "activity-ran",
      type: "commandExecution",
      command: "bun test",
      commandActions: [{ type: "unknown", command: "bun test" }],
      status: "completed"
    });
    addTurn("activity-wait-turn", startedAt + 8);
    addCompletedItem("activity-wait-turn", {
      id: "activity-wait",
      type: "commandExecution",
      command: "bun run dev",
      commandActions: [{ type: "unknown", command: "bun run dev" }],
      status: "completed"
    });
    emit("item/commandExecution/terminalInteraction", {
      threadId: "thread-1",
      turnId: "activity-wait-turn",
      itemId: "activity-wait",
      processId: "process-dev",
      stdin: ""
    });
  });

  await expect(page.getByTestId("conversation-item-activity-read").getByText("Read", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-item-activity-list").getByText("List", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-item-activity-search").getByText("Search", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-item-activity-ran").getByText("Ran", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-item-activity-wait")).toContainText("Waited for background terminal");
  await expect(page.getByTestId("conversation-item-activity-editing").getByText("Editing", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-item-activity-edited").getByText("Edited", { exact: true })).toBeVisible();
});

test("routes /new danger through the Web permission confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await confirmWorkspace(page);
  await expect(page.getByRole("tab", { name: "Mock thread" })).toBeVisible();

  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  const send = page.getByRole("button", { name: "Send", exact: true });

  await page.evaluate(() => {
    ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
  });
  await composer.fill("/new danger");
  await send.click();

  await expect(page.getByTestId("danger-new-chat-dialog")).toBeVisible();
  const outbound = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ method?: string }> }).__codexUiOutbound ?? []);
  expect(outbound.some((message) => message.method === "turn/start")).toBe(false);
});

test("shares one virtual grid across fifteen agents and releases agent detail pages", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");

  await page.evaluate(() => {
    const testWindow = window as unknown as {
      __codexUiParallelAgentCompletionDelayMs?: number;
      __codexUiParallelAgentStreamBurstCount?: number;
      __codexUiParallelAgentStreamBurstIntervalMs?: number;
    };
    testWindow.__codexUiParallelAgentCompletionDelayMs = 30_000;
    testWindow.__codexUiParallelAgentStreamBurstCount = 400;
    testWindow.__codexUiParallelAgentStreamBurstIntervalMs = 30;
  });

  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill(
    `${FIFTEEN_AGENT_SORTING_PROMPT} Launch parallel agents.`
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect.poll(async () => page.evaluate(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        method?: string;
        params?: { input?: Array<{ type?: string; text?: string }> };
      }>;
    }).__codexUiOutbound ?? [];
    return messages
      .filter((message) => message.method === "turn/start")
      .flatMap((message) => message.params?.input ?? [])
      .find((entry) => entry.type === "text")?.text ?? null;
  })).toBe(`${FIFTEEN_AGENT_SORTING_PROMPT} Launch parallel agents.`);

  await expect.poll(async () => page.evaluate(() => (
    window as unknown as {
      __codexUiParallelAgentMockState?: {
        requestedAgentCount: number;
        scheduledAgentCount: number;
        emittedAgentCount: number;
        emittedOnLatestSocketCount: number;
        socketCountAtStart: number;
      };
    }
  ).__codexUiParallelAgentMockState ?? null)).toEqual({
    requestedAgentCount: 15,
    scheduledAgentCount: 15,
    emittedAgentCount: 15,
    emittedOnLatestSocketCount: 15,
    socketCountAtStart: 1
  });

  await expect(page.getByTestId("parallel-agent-rail")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("parallel-agent-button-agent-review-thread")).toBeVisible();
  await expect(page.getByTestId("parallel-agent-button-agent-tests-thread")).toBeVisible();
  await page.getByTestId("parallel-agent-all").click();
  await expect(page.getByTestId("parallel-agent-all-header")).toContainText("15 total");
  await expect(page.getByTestId("conversation-waterfall")).toHaveAttribute("data-row-count", "15");
  await expect(page.getByTestId("conversation-waterfall")).toHaveAttribute("data-agent-overview-grid", "true");
  await expect(page.getByTestId("chat-waterfall-scroll")).toHaveAttribute("data-agent-overview-lanes", "3");
  await expect(page.getByTestId("conversation-waterfall")).toHaveCount(1);
  await expect(page.locator('[data-chat-row-key^="agent-overview:"]')).toHaveCount(15);
  await expect(page.getByText("Review agent found missing tests for completion badges.")).toBeVisible();

  await page.getByTestId("agent-overview-row-agent-review-thread").getByRole("button").click();
  await expect(page.getByTestId("parallel-agent-header")).toContainText("Review");
  await expect(page.getByTestId("conversation-waterfall")).not.toHaveAttribute("data-agent-overview-grid", "true");
  await expect(page.getByTestId("conversation-waterfall")).toHaveCount(1);
  await expect(page.getByText("ManageTask").first()).toBeVisible();
  await expect(page.getByText("(spawnAgent)")).toBeVisible();

  const agentIds = [
    "agent-review-thread",
    "agent-tests-thread",
    ...Array.from({ length: 13 }, (_, index) => `agent-sort-${index + 3}-thread`)
  ];
  await page.requestGC();
  const stableHeapBeforeAgentSwitches = await page.evaluate(() => (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory?.usedJSHeapSize ?? null);
  const pageSamples: Array<{ nodes: number; waterfalls: number; scrolls: number; mountedRows: number; agentSlots: number }> = [];
  for (const agentId of agentIds) {
    await page.getByTestId(`parallel-agent-button-${agentId}`).click({ position: { x: 12, y: 30 } });
    await expect(page.locator("[data-agent-virtual-page]")).toHaveAttribute("data-agent-virtual-page", `thread-1:agent:${agentId}`);
    pageSamples.push(await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        nodes: document.getElementsByTagName("*").length,
        waterfalls: document.querySelectorAll('[data-testid="conversation-waterfall"]').length,
        scrolls: document.querySelectorAll('[data-testid="chat-waterfall-scroll"]').length,
        mountedRows: document.querySelectorAll('[data-testid="conversation-waterfall"] [data-chat-row-key]').length,
        agentSlots: document.querySelectorAll('[data-testid^="parallel-agent-slot-"]').length
      };
    }));
  }
  expect(pageSamples.every((sample) => sample.waterfalls === 1 && sample.scrolls === 1)).toBe(true);
  expect(Math.max(...pageSamples.map((sample) => sample.mountedRows))).toBeLessThan(8);
  expect(pageSamples.every((sample) => sample.agentSlots === 15)).toBe(true);
  expect(Math.max(...pageSamples.map((sample) => sample.nodes)) - Math.min(...pageSamples.map((sample) => sample.nodes))).toBeLessThan(400);
  await page.requestGC();
  const stableHeapAfterAgentSwitches = await page.evaluate(() => (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory?.usedJSHeapSize ?? null);
  if (stableHeapBeforeAgentSwitches !== null && stableHeapAfterAgentSwitches !== null) {
    expect(stableHeapAfterAgentSwitches - stableHeapBeforeAgentSwitches).toBeLessThan(32 * 1024 * 1024);
  }
  const framesAfterAgentSwitches = await page.evaluate(async () => {
    let frames = 0;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const sample = (now: number) => {
        frames += 1;
        if (now - startedAt >= 750) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  expect(framesAfterAgentSwitches).toBeGreaterThan(20);

  await page.screenshot({
    path: "snapshot/parallel-agents-workbench.png",
    fullPage: false
  });

  await page.getByTestId("parallel-agent-all").click();
  await page.getByTestId("agent-overview-row-agent-review-thread").getByRole("button").click();
  await expect(page.getByTestId("parallel-agent-header")).toContainText("Review");
  await expect(page.getByText("Review agent found missing tests for completion badges.")).toBeVisible();
  await expect(page.getByText("Test agent reproduced the parallel rail switching path.")).toHaveCount(0);

  await page.getByTestId("parallel-agent-button-agent-tests-thread").click({ position: { x: 12, y: 30 } });
  await expect(page.getByTestId("parallel-agent-header")).toContainText("Tests");
  await expect(page.getByText("Test agent reproduced the parallel rail switching path.")).toBeVisible();
  await expect(page.getByText("Review agent found missing tests for completion badges.")).toHaveCount(0);
  await expect(page.getByTestId("parallel-agent-button-agent-review-thread")).toHaveCount(0, { timeout: 35_000 });
  await expect(page.getByTestId("parallel-agent-header")).toContainText("Tests");

  await page.getByTestId("parallel-agent-main").click();
  await expect(page.getByText("ManageTask").first()).toBeVisible();
  await expect(page.getByTestId("parallel-agent-button-agent-tests-thread")).toHaveCount(0);
  await expect(page.getByTestId("parallel-agent-rail")).toBeVisible();
  await page.getByTestId("parallel-agent-all").click();
  await expect(page.getByTestId("parallel-agent-all-header")).toContainText("15 total");
  await expect(page.getByTestId("conversation-waterfall")).toHaveAttribute("data-row-count", "15");
});

test("loads live Codex config in Settings and persists edits via config/batchWrite", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByText("mock-codex")).toBeVisible();

  await page.getByLabel("Open settings").click();
  await expect(page.getByRole("heading", { name: "Codex Engine Config" })).toBeVisible();
  await expect(page.getByLabel("Default model")).toHaveValue("gpt-5.6-sol");
  await expect(page.getByLabel("Model provider")).toHaveValue("openai");
  await expect(page.getByRole("combobox", { name: "Default reasoning effort" })).toContainText("Medium");
  await expect(page.getByRole("combobox", { name: "Sandbox mode" })).toContainText("Workspace write");
  await expect(page.getByRole("combobox", { name: "Web search" })).toContainText("Cached");
  await expect(page.getByText("config/read", { exact: true })).toBeVisible();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "config/read");
  });

  await page.getByRole("combobox", { name: "Default reasoning effort" }).click();
  await page.getByRole("option", { name: "High", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: {
            edits?: Array<{ keyPath?: string; value?: unknown }>;
            reloadUserConfig?: boolean;
          };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "config/batchWrite" &&
        message.params?.reloadUserConfig === true &&
        message.params?.edits?.some((edit) => edit.keyPath === "model_reasoning_effort" && edit.value === "high")
    );
  });

  await expect(page.getByRole("combobox", { name: "Default reasoning effort" })).toContainText("High");

  await page.getByRole("combobox", { name: "Web search" }).click();
  await page.getByRole("option", { name: "Live" }).click();

  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { edits?: Array<{ keyPath?: string; value?: unknown }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "config/batchWrite" &&
        message.params?.edits?.some((edit) => edit.keyPath === "web_search" && edit.value === "live")
    );
  });

  await expect(page.getByRole("combobox", { name: "Web search" })).toContainText("Live");

  await page.getByLabel("User instructions").fill("Prefer concise answers.");
  await page.getByLabel("User instructions").blur();
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { edits?: Array<{ keyPath?: string; value?: unknown }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "config/batchWrite" &&
        message.params?.edits?.some((edit) => edit.keyPath === "instructions" && edit.value === "Prefer concise answers.")
    );
  });

  // Theme remains independent of config writes.
  await page.getByLabel("Open Appearance settings").click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Aurora Studio");
  await page.getByRole("textbox", { name: "Primary" }).fill("#0EA5E9");
  await page.getByRole("textbox", { name: "Secondary", exact: true }).fill("#F97316");
  await page.getByRole("textbox", { name: "Background", exact: true }).fill("#0B1220");
  await page.getByRole("switch", { name: "Dark" }).check();
  await page.getByRole("button", { name: /Save plugin|Save changes/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", /user-aurora-studio-/);

  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Official Black" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "official-black");

  const outbound = await page.evaluate(() => {
    return (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: unknown }> }).__codexUiOutbound ?? [];
  });
  const themeLeakedIntoConfig = outbound.some((message) => {
    if (message.type !== "rpc" || (message.method !== "config/batchWrite" && message.method !== "config/value/write")) {
      return false;
    }
    const raw = JSON.stringify(message.params ?? {});
    return raw.includes("theme") || raw.includes("official-black") || raw.includes("apiKey") || raw.includes("api_key");
  });
  expect(themeLeakedIntoConfig).toBe(false);

  await page.getByLabel("Open Codex Engine settings").click();
  await page.getByRole("button", { name: "Reload Codex config" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound ?? [];
    return messages.filter((message) => message.type === "rpc" && message.method === "config/read").length >= 2;
  });
  await expect(page.getByRole("combobox", { name: "Default reasoning effort" })).toContainText("High");
  await expect(page.getByRole("combobox", { name: "Web search" })).toContainText("Live");
  await expect(page.getByLabel("User instructions")).toHaveValue("Prefer concise answers.");

  await page.getByRole("button", { name: "All config" }).click();
  await expect(page.getByLabel("Search all Codex config")).toBeVisible();
  await expect(page.getByText("Codex JSON schema", { exact: true })).toBeVisible();
  await page.getByLabel("Search all Codex config").fill("history");
  await expect(page.getByText("history", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("History", { exact: true })).toHaveValue(/"max_bytes": 1048576/);
  await page
    .getByLabel("History", { exact: true })
    .fill('{\n  "persistence": "save-all",\n  "max_bytes": 1572864\n}');
  await page.getByLabel("History", { exact: true }).blur();
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { edits?: Array<{ keyPath?: string; value?: unknown }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "config/batchWrite" &&
        message.params?.edits?.some((edit) => {
          const value = edit.value as { max_bytes?: unknown } | undefined;
          return edit.keyPath === "history" && value?.max_bytes === 1572864;
        })
    );
  });

  await page.getByLabel("Search all Codex config").fill("history.max_bytes");
  await page.getByLabel("History / Max Bytes").fill("2097152");
  await page.getByLabel("History / Max Bytes").blur();
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: { edits?: Array<{ keyPath?: string; value?: unknown }> };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "config/batchWrite" &&
        message.params?.edits?.some((edit) => edit.keyPath === "history.max_bytes" && edit.value === 2097152)
    );
  });
  await expect(page.getByLabel("History / Max Bytes")).toHaveValue("2097152");

  await page.getByLabel("Search all Codex config").fill("runtime_only_config");
  await expect(page.getByRole("heading", { name: "runtime" })).toBeVisible();
  await expect(page.getByLabel("runtime Only Config", { exact: true })).toBeVisible();

  // Visual proof: Settings page with live engine config fields (material-kit-style section cards).
  await page.screenshot({
    path: "snapshot/codex-ui-settings-open.png",
    fullPage: true
  });

  await page.getByLabel("Open Appearance settings").click();
  await page.screenshot({
    path: "snapshot/codex-ui-settings-appearance.png",
    fullPage: true
  });

  await page.getByLabel("Open Layout settings").click();
  await expect(page.getByText("Right workspace")).toBeVisible();
  await expect(page.getByText("Toolbar controlled")).toBeVisible();
  await page.screenshot({
    path: "snapshot/codex-ui-settings-layout.png",
    fullPage: true
  });
});

test("exposes every bundled Codex schema setting in All config", async ({ page }) => {
  test.setTimeout(180_000);
  const schema = JSON.parse(await readFile("apps/web/src/state/codexConfigSchema.json", "utf8")) as TestCodexSchema;
  const topLevelKeys = Object.keys(schema.properties ?? {}).sort((a, b) => a.localeCompare(b));
  const schemaKeyPaths = flattenTestSchemaProperties(schema, schema.properties ?? {});
  expect(topLevelKeys).toHaveLength(93);
  expect(schemaKeyPaths.length).toBeGreaterThan(topLevelKeys.length);

  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByRole("button", { name: "All config" }).click();
  await expect(page.getByLabel("Search all Codex config")).toBeVisible();

  for (const keyPath of schemaKeyPaths) {
    await page.getByLabel("Search all Codex config").fill(keyPath);
    await expect(page.getByText(keyPath, { exact: true }).first(), `Settings All config should expose ${keyPath}`).toBeVisible();
  }
});

test("separates official provider fields from relay station fields", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();
  await page.getByRole("button", { name: "Add channel" }).click();

  const providerPicker = page.getByTestId("relay-provider-picker");
  await expect(providerPicker.getByLabel("Search service providers")).toBeVisible();
  await expect(providerPicker.getByLabel("Want it shown in the list by default? Contact an administrator.")).toBeVisible();
  const orderedProviderLabels = await providerPicker.locator('[data-testid^="relay-provider-template-"]').allTextContents();
  expect(orderedProviderLabels.map((label) => label.trim())).toEqual([
    "OpenAI",
    "Anthropic",
    "Gemini",
    "xAI (Grok)",
    "DeepSeek",
    "DeepKey",
    "Linux DO",
    "Custom +"
  ]);
  await expect(providerPicker.getByTestId("relay-provider-template-openrouter")).toHaveCount(0);

  const templateTypeFilter = providerPicker.getByLabel("Station Type");
  await templateTypeFilter.click();
  await page.getByRole("option", { name: /Official/ }).click();
  await page.keyboard.press("Escape");
  await expect(providerPicker.getByTestId("relay-provider-template-openai")).toBeVisible();
  await expect(providerPicker.getByTestId("relay-provider-template-deepkey")).toHaveCount(0);
  await templateTypeFilter.click();
  await page.getByRole("option", { name: /Third Party/ }).click();
  await page.keyboard.press("Escape");
  await expect(providerPicker.getByTestId("relay-provider-template-deepkey")).toBeVisible();

  await expect(page.getByLabel("API format")).toBeVisible();
  await expect(page.getByLabel("API Key")).toBeVisible();
  await expect(page.getByLabel("Native models")).toBeVisible();
  await expect(page.getByLabel("Group catalog URL")).toHaveCount(0);
  await expect(page.getByLabel("Total Quota / Max Usage Limit ($ USD)")).toHaveCount(0);
  await expect(page.getByText("Relay Groups", { exact: true })).toHaveCount(0);

  for (const templateId of ["anthropic", "gemini", "xai", "deepseek"]) {
    await providerPicker.getByTestId(`relay-provider-template-${templateId}`).click();
    await expect(page.getByLabel("API format"), `${templateId} should use official provider fields`).toBeVisible();
    await expect(page.getByText("Relay Groups", { exact: true }), `${templateId} should not expose relay groups`).toHaveCount(0);
  }

  await providerPicker.getByTestId("relay-provider-template-linuxdo").click();
  await expect(page.getByLabel("Base URL")).toHaveValue("https://hub.linux.do/v1");
  await expect(page.getByText("Relay Groups", { exact: true })).toBeVisible();

  await providerPicker.getByTestId("relay-provider-template-custom").click();
  await page.getByLabel("Provider name").fill("Acme AI");
  await page.getByLabel("Base URL").fill("https://acme.example/v1");
  await page.getByLabel("Group catalog URL").fill("https://acme.example/pricing.json");
  await page.getByLabel("Provider logo").setInputFiles({
    name: "acme.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  });
  await expect(page.getByTestId("custom-provider-logo-preview")).toBeVisible();
  await expect(providerPicker.getByTestId("relay-provider-template-custom")).toContainText("Acme AI");

  await page.getByRole("button", { name: /DeepKey/ }).click();
  await expect(page.getByLabel("API format")).toHaveCount(0);
  await expect(page.getByLabel("Group catalog URL")).toHaveValue("https://deepkey.top/api/pricing");
  await expect(page.getByLabel("Total Quota / Max Usage Limit ($ USD)")).toBeVisible();
  await expect(page.getByText("Relay Groups", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to channels" }).click();
  const providerFilterHelp = page.getByLabel("Want it shown in the list by default? Contact an administrator.");
  await providerFilterHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText("Contact an administrator");
  await page.mouse.move(0, 0);

  const serviceProviderFilter = page.getByLabel("Service provider");
  await serviceProviderFilter.click();
  await page.getByRole("option", { name: /Official/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row").filter({ hasText: "HubProxy Grok" })).toHaveCount(0);
  await serviceProviderFilter.click();
  await page.getByRole("option", { name: /Third Party/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row").filter({ hasText: "HubProxy Grok" }).first()).toBeVisible();
});

test("releases relay settings layout work immediately after closing", async ({ page }) => {
  await mockWindowsDesktopSession(page);
  await page.goto("/");
  const initialBodyStyle = await page.locator("body").getAttribute("style");

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();
  await expect(page.getByRole("heading", { name: "Relay channels" }).first()).toBeVisible();
  expect(await page.locator("body").getAttribute("style")).toBe(initialBodyStyle);

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("button", { name: "Close settings" })).toHaveCount(0);
  expect(await page.locator("body").getAttribute("style")).toBe(initialBodyStyle);

  const frames = await page.evaluate(async () => {
    let count = 0;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        count += 1;
        if (now - startedAt >= 750) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return count;
  });
  expect(frames).toBeGreaterThan(20);
});

test("keeps Windows pet Three.js disabled while performance work is pending", async ({ page }) => {
  await mockWindowsDesktopSession(page);
  userPreferences = {
    ...userPreferences,
    themeMode: "user-windows-three-test",
    installedThemePluginIds: ["user-windows-three-test"],
    customThemePlugins: [{
      id: "user-windows-three-test",
      name: "Windows Three Test",
      description: "Windows Three.js suppression fixture",
      source: "user-defined",
      dark: false,
      preview: { primary: "#0F766E", secondary: "#F59E0B", background: "#F8FAFC" },
      layout: {
        backgroundScene: {
          renderer: "three",
          preset: "orbit",
          color: "#0F766E",
          secondaryColor: "#F59E0B",
          speed: 0.65,
          density: 0.55,
          opacity: 0.54
        }
      }
    }]
  };
  await page.goto("/");

  await expect(page.getByTestId("theme-background-three")).toHaveCount(0);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Pet Dock settings").click();

  await expect(page.getByTestId("windows-pet-coming-soon")).toContainText("available soon");
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("uses a static no-blur theme surface in the Windows desktop software renderer", async ({ page }) => {
  test.setTimeout(15_000);
  await mockWindowsDesktopSession(page);
  userPreferences = {
    ...userPreferences,
    themeMode: "user-windows-canvas-test",
    installedThemePluginIds: ["user-windows-canvas-test"],
    customThemePlugins: [{
      id: "user-windows-canvas-test",
      name: "Windows Canvas Test",
      description: "Windows software-rendering fixture",
      source: "user-defined",
      dark: false,
      preview: { primary: "#0F766E", secondary: "#F59E0B", background: "#F8FAFC" },
      assets: { appBackgroundVideo: "https://example.com/loop.webm" },
      layout: {
        backgroundScene: {
          renderer: "canvas",
          preset: "particles",
          color: "#0F766E",
          secondaryColor: "#F59E0B",
          speed: 0.8,
          density: 0.5,
          opacity: 0.5
        }
      }
    }]
  };
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-software-rendering", "true");
  await expect(page.getByTestId("theme-background-canvas")).toHaveCount(0);
  await expect(page.getByTestId("theme-background-video")).toHaveCount(0);
  const effects = page.getByTestId("theme-background-effects");
  await expect(effects).toHaveCSS("backdrop-filter", "none");
});

test("repeatedly switches between a long chat waterfall and Windows relay settings without stalling", async ({ page }) => {
  test.setTimeout(30_000);
  await mockWindowsDesktopSession(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    for (let index = 0; index < 500; index += 1) {
      const turnId = `settings-stress-turn-${index}`;
      emit({
        type: "codex.notification",
        message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "inProgress" } } }
      });
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: { threadId: "thread-1", turnId, item: { type: "userMessage", id: `settings-stress-user-${index}`, text: `Settings stress prompt ${index}` } }
        }
      });
      emit({
        type: "codex.notification",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId,
            item: { type: "agentMessage", id: `settings-stress-agent-${index}`, text: `Settings stress answer ${index}\n\n- relay\n- waterfall\n- cleanup` }
          }
        }
      });
      emit({
        type: "codex.notification",
        message: { method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "completed" } } }
      });
    }
  });

  const waterfall = page.getByTestId("conversation-waterfall");
  await expect.poll(async () => Number(await waterfall.getAttribute("data-row-count"))).toBe(1000);
  const scroll = page.getByTestId("chat-waterfall-scroll");
  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight > element.clientHeight * 2)).toBe(true);

  const scrollSweepFrames = await scroll.evaluate(async (element) => {
    const samples: number[] = [];
    for (let sweep = 0; sweep < 4; sweep += 1) {
      const start = element.scrollTop;
      const target = sweep % 2 === 0 ? 0 : element.scrollHeight - element.clientHeight;
      let frames = 0;
      await new Promise<void>((resolve) => {
        const tick = () => {
          frames += 1;
          const progress = Math.min(1, frames / 24);
          element.scrollTop = start + (target - start) * progress;
          element.dispatchEvent(new Event("scroll"));
          if (progress >= 1) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      samples.push(frames);
    }
    return samples;
  });
  expect(scrollSweepFrames).toEqual([24, 24, 24, 24]);
  await expect.poll(() => waterfall.locator("[data-chat-row-key]").count()).toBeLessThan(32);

  for (let round = 0; round < 4; round += 1) {
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(page.getByRole("button", { name: /Jump to latest/ })).toBeVisible();

    await page.getByLabel("Open settings").click();
    await page.getByLabel("Open Relay settings").click();
    await expect(page.getByRole("heading", { name: "Relay channels" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Close settings" })).toHaveCount(1);

    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.getByRole("button", { name: "Close settings" })).toHaveCount(0);
    await expect(waterfall).toBeVisible();

    const jumpLatest = page.getByRole("button", { name: /Jump to latest/ });
    if (await jumpLatest.isVisible()) {
      await jumpLatest.click();
    }
    await expect(page.getByText("Settings stress answer 499")).toBeVisible();
    await expect.poll(() => scroll.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 8)).toBe(true);
  }

  const frames = await page.evaluate(async () => {
    let count = 0;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        count += 1;
        if (now - startedAt >= 750) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return count;
  });
  expect(frames).toBeGreaterThan(20);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("keeps long code responsive across Windows Explorer and Git panels", async ({ page }) => {
  test.setTimeout(120_000);
  await mockWindowsDesktopSession(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Mock thread" }).click();

  await page.evaluate(() => {
    const socket = (window as unknown as {
      __codexUiSockets?: Array<{
        dispatchEvent: (event: MessageEvent) => boolean;
        onmessage?: ((event: MessageEvent) => void) | null;
      }>;
    }).__codexUiSockets?.at(-1);
    if (!socket) throw new Error("Missing mock socket");
    const emit = (value: unknown) => {
      const event = new MessageEvent("message", { data: JSON.stringify(value) });
      socket.dispatchEvent(event);
      socket.onmessage?.(event);
    };
    for (let index = 0; index < 120; index += 1) {
      const turnId = `workspace-stress-turn-${index}`;
      emit({
        type: "codex.notification",
        message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "inProgress" } } }
      });
      emit({
        type: "codex.notification",
        message: { method: "item/completed", params: { threadId: "thread-1", turnId, item: { type: "userMessage", id: `workspace-stress-user-${index}`, text: `Workspace stress prompt ${index}` } } }
      });
      emit({
        type: "codex.notification",
        message: { method: "item/completed", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", id: `workspace-stress-agent-${index}`, text: `Workspace stress answer ${index}` } } }
      });
      emit({
        type: "codex.notification",
        message: { method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, threadId: "thread-1", status: "completed" } } }
      });
    }

    const codeTurnId = "workspace-stress-code-turn";
    const code = Array.from({ length: 1_800 }, (_, index) => `const workspace_line_${String(index).padStart(4, "0")} = ${index};`).join("\n");
    emit({
      type: "codex.notification",
      message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: codeTurnId, threadId: "thread-1", status: "inProgress" } } }
    });
    emit({
      type: "codex.notification",
      message: { method: "item/completed", params: { threadId: "thread-1", turnId: codeTurnId, item: { type: "agentMessage", id: "workspace-stress-code", text: `Large code result\n\n\`\`\`ts\n${code}\n\`\`\`` } } }
    });
    emit({
      type: "codex.notification",
      message: { method: "turn/completed", params: { threadId: "thread-1", turn: { id: codeTurnId, threadId: "thread-1", status: "completed" } } }
    });
  });

  const waterfall = page.getByTestId("conversation-waterfall");
  await expect.poll(async () => Number(await waterfall.getAttribute("data-row-count"))).toBeGreaterThan(240);
  const scroll = page.getByTestId("chat-waterfall-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const codeBlock = page.locator('.code-block[data-code-line-count="1800"]');
  await expect(codeBlock).toBeVisible();
  await expect(codeBlock).toHaveAttribute("data-code-expanded", "false");
  expect(await codeBlock.locator("pre code > span").count()).toBeLessThanOrEqual(28);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Explorer" }).click();
  await expect(page.getByTestId("workspace-explorer-panel")).toBeVisible();
  await page.getByRole("tab", { name: "Git" }).click();
  await expect(page.getByTestId("git-review-panel")).toBeVisible();

  await codeBlock.getByRole("button", { name: "Expand code" }).click();
  await expect(codeBlock).toHaveAttribute("data-code-expanded", "true");
  await expect(codeBlock).toHaveAttribute("data-code-render-mode", "plain");
  expect(await codeBlock.locator("pre code > span").count()).toBe(0);
  const expandedCodeHeight = await codeBlock.locator("pre").evaluate((element) => element.getBoundingClientRect().height);
  expect(expandedCodeHeight).toBeLessThanOrEqual(765);

  for (let round = 0; round < 4; round += 1) {
    await page.getByRole("tab", { name: "Explorer" }).click();
    await expect(page.getByTestId("workspace-explorer-panel")).toBeVisible();
    await page.getByRole("tab", { name: "Git" }).click();
    await expect(page.getByTestId("git-review-panel")).toBeVisible();
  }

  const frames = await page.evaluate(async () => {
    let count = 0;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        count += 1;
        if (now - startedAt >= 750) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return count;
  });
  expect(frames).toBeGreaterThan(20);

  await scroll.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByRole("button", { name: /Jump to latest/ })).toBeVisible();
  await page.getByRole("button", { name: /Jump to latest/ }).click();
  await expect(codeBlock).toBeVisible();
  await expect.poll(() => scroll.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 8)).toBe(true);
});

test("uses the Windows user folder and allows switching drives", async ({ page }) => {
  await page.unroute("/api/workspace/roots");
  await page.route("/api/workspace/roots", (route) => route.fulfill({
    json: {
      platform: "win32",
      home: "C:\\Users\\zhan",
      cwd: "E:\\projects\\codex-react-ui",
      roots: [
        { path: "C:\\", label: "C:" },
        { path: "E:\\", label: "E:" },
        { path: "F:\\", label: "F:" }
      ]
    }
  }));
  await page.goto("/");

  const panel = page.getByTestId("workspace-selection-panel");
  await expect(panel.getByLabel("Workspace")).toHaveValue("C:\\Users\\zhan");
  await expect(panel).toContainText("current Windows user folder");
  await panel.getByRole("button", { name: "Browse" }).click();

  const picker = page.getByTestId("workspace-folder-picker-dialog");
  await expect(picker.getByText("Available drives")).toBeVisible();
  await expect(picker.getByRole("button", { name: "Open drive C:" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Open drive E:" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Open drive F:" })).toBeVisible();
  await picker.getByRole("button", { name: "Open drive E:" }).click();
  await expect(picker.getByLabel("Current folder")).toHaveValue("E:\\");
  await expect(picker.getByRole("button", { name: "projects" })).toBeVisible();
  await picker.getByRole("button", { name: "projects" }).click();
  await picker.getByRole("button", { name: "Use this folder" }).click();
  await expect(panel.getByLabel("Workspace")).toHaveValue("E:\\projects");
});

test("loads and imports DeepKey catalog groups while creating a channel", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();
  await page.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByLabel("Stream retry limit")).toHaveValue("5");
  await page.getByLabel("Stream retry limit").fill("101");
  await page.getByLabel("Stream retry limit").blur();
  await expect(page.getByLabel("Stream retry limit")).toHaveValue("100");
  await page.getByRole("button", { name: /DeepKey/ }).click();

  await expect(page.getByText("Save the relay before importing a capability catalog.")).toHaveCount(0);
  await page.getByLabel("Expand group default").click();
  await page.getByLabel("Same-Group Key Rotation Pool (one key per line)").fill("sk-draft-deepkey");

  await page.getByRole("button", { name: "Add group" }).click();
  const browser = page.getByRole("dialog", { name: "Add groups from capability catalog" });
  await expect(browser).toBeVisible();
  await expect(browser.getByText("claude", { exact: true })).toBeVisible();
  expect(catalogPreviewRequests).toBe(1);
  await browser.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Merge import" }).click();
  await expect(page.getByText("Capability catalog merged into the channel groups.")).toBeVisible();
  await expect(page.getByText("Relay Groups (2)")).toBeVisible();

  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        type?: string;
        provider?: { capabilityCatalog?: { data?: unknown[] }; groups?: unknown[] };
      }>;
    }).__codexUiOutbound ?? [];
    return messages.some((message) =>
      message.type === "provider.save"
      && message.provider?.groups?.length === 2
      && message.provider?.capabilityCatalog?.data?.length === 2
    );
  });
});

test("creates relay channels with fetched active models, remarks, and model activation", async ({ page }) => {
  let directProviderProbeRequests = 0;
  let groupTestRequest: { providerId?: string; groupId?: string; model?: string; protocol?: string } | null = null;
  await page.route("/api/provider/fetch-models", async (route) => {
    const body = route.request().postDataJSON() as { baseUrl?: string; apiKey?: string; kind?: string; providerId?: string };
    providerModelFetchRequests.push(body);
    await route.fulfill({
      json: {
        endpoint: `${(body.baseUrl ?? "").replace(/\/+$/, "")}/models`,
        error: null,
        models: [
          { id: "deepseek-chat" },
          { id: "glm-4.5" },
          { id: "openai/gpt-5.5" },
          ...Array.from({ length: 300 }, (_, index) => ({ id: `nvidia/stress-model-${index}` }))
        ]
      }
    });
  });
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/provider/test" || pathname === "/api/provider/test-chat") {
      directProviderProbeRequests += 1;
    }
  });
  await page.route("/api/provider/test", async (route) => {
    groupTestRequest = route.request().postDataJSON() as typeof groupTestRequest;
    await route.fulfill({
      json: {
        ok: true,
        message: "Provider test passed",
        model: groupTestRequest?.model,
        endpoint: "https://axon.example/v1/responses",
        statusCode: 200,
        elapsedMs: 42
      }
    });
  });

  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();

  await page.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByRole("heading", { name: "Add channel" })).toBeVisible();

  await page.getByRole("button", { name: /DeepKey/ }).click();
  await page.getByLabel("Expand group default").click();

  await page.getByLabel("Channel name").fill("Axon Relay");
  await page.getByLabel("Base URL").fill("https://axon.example/v1");
  await page.getByLabel("Same-Group Key Rotation Pool (one key per line)").fill("sk-test-axon-relay");
  await expect(page.getByLabel("Context window")).toBeVisible();
  await page.getByLabel("Context window").fill("200000");
  await page.getByLabel("Group models").fill("");
  await page.getByLabel("Remark", { exact: true }).fill("integration smoke remark");

  await page.getByRole("button", { name: "Fetch models" }).click();
  await expect(page.getByText("Fetched models", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 11 · 303", { exact: true })).toBeVisible();
  await expect(page.getByText("nvidia/stress-model-250", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Deselect all" }).click();
  await page.getByPlaceholder("Search fetched models").fill("stress-model-250");
  await expect(page.getByText("nvidia/stress-model-250", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search fetched models").fill("");
  expect(providerModelFetchRequests).toContainEqual(expect.objectContaining({
    baseUrl: "https://axon.example/v1",
    apiKey: "sk-test-axon-relay",
    kind: "responsesRelay"
  }));

  await page.getByText("deepseek-chat", { exact: true }).click();
  await page.getByText("glm-4.5", { exact: true }).click();
  await page.getByRole("button", { name: "Add selected (2)" }).click();
  await expect(page.getByLabel("Group models")).toHaveValue("deepseek-chat, glm-4.5");

  await page.getByRole("button", { name: "Create" }).click();
  const createRiskDialog = page.getByTestId("relay-risk-confirmation-dialog");
  await createRiskDialog.getByRole("checkbox").check();
  await createRiskDialog.getByRole("button", { name: "I understand, save relay" }).click();
  await page.waitForFunction(() => (window as unknown as { __codexUiOutbound?: Array<{ type?: string }> })
    .__codexUiOutbound?.some((message) => message.type === "provider.save"));
  const saveMessage = await page.evaluate(() => (window as unknown as { __codexUiOutbound?: Array<{ type?: string }> })
    .__codexUiOutbound?.findLast((message) => message.type === "provider.save"));
  expect(saveMessage).toMatchObject({
    type: "provider.save",
    provider: {
      name: "Axon Relay",
      remark: "integration smoke remark",
      nativeModels: ["deepseek-chat", "glm-4.5"],
      groups: [expect.objectContaining({ keys: ["sk-test-axon-relay"], contextWindow: 200000 })]
    }
  });

  const axonRow = page.getByRole("row").filter({ hasText: "Axon Relay" }).first();
  await expect(axonRow).toBeVisible();
  await expect(axonRow.getByText("integration smoke remark")).toBeVisible();
  const modelSummary = axonRow.getByText("2 models", { exact: true });
  await expect(modelSummary).toBeVisible();
  await modelSummary.hover();
  await expect(page.getByRole("tooltip")).toContainText("deepseek-chat");
  await expect(page.getByRole("tooltip")).toContainText("glm-4.5");
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(axonRow.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "HubProxy Grok" }).getByText("Enabled", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByTestId("relay-provider-template-deepkey")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to channels" }).click();

  await axonRow.getByRole("button", { name: "Edit Axon Relay" }).click();
  const editProviderPicker = page.getByTestId("relay-provider-picker");
  await expect(editProviderPicker.getByLabel("Search service providers")).toHaveCount(0);
  await expect(editProviderPicker.getByRole("button")).toHaveCount(1);
  await expect(editProviderPicker.getByTestId("relay-provider-template-deepkey")).toBeVisible();
  await expect(editProviderPicker.getByTestId("relay-provider-template-openai")).toHaveCount(0);
  await expect(page.getByLabel("Group models")).toHaveValue("deepseek-chat, glm-4.5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const riskDialog = page.getByTestId("relay-risk-confirmation-dialog");
  await riskDialog.getByRole("checkbox").check();
  await riskDialog.getByRole("button", { name: "I understand, save relay" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as {
      __codexUiOutbound?: Array<{
        type?: string;
        provider?: { name?: string; nativeModels?: string[]; groups?: Array<{ models?: string[] }> };
      }>;
    }).__codexUiOutbound ?? [];
    return messages.filter((message) =>
      message.type === "provider.save"
      && message.provider?.name === "Axon Relay"
      && message.provider.nativeModels?.join(",") === "deepseek-chat,glm-4.5"
      && message.provider.groups?.[0]?.models?.join(",") === "deepseek-chat,glm-4.5"
    ).length >= 2;
  });

  await axonRow.getByRole("cell").first().getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Relay Groups" })).toBeVisible();
  await expect(page.getByText("integration smoke remark")).toHaveCount(2);

  await page.getByRole("button", { name: "Test connectivity for default" }).click();
  const groupTestDialog = page.getByRole("dialog", { name: "Test default" });
  await expect(groupTestDialog).toBeVisible();
  await groupTestDialog.getByLabel("Search models to test").fill("glm-4.5");
  await groupTestDialog.getByRole("button", { name: "glm-4.5" }).click();
  await groupTestDialog.getByRole("button", { name: "Test connectivity" }).click();
  await expect(groupTestDialog.getByRole("alert")).toContainText("passed with glm-4.5");
  expect(groupTestRequest).toEqual(expect.objectContaining({
    providerId: "axon-relay",
    groupId: expect.stringMatching(/^group-/),
    model: "glm-4.5",
    protocol: "openai-response"
  }));
  expect(directProviderProbeRequests).toBe(1);
  await groupTestDialog.getByRole("button", { name: "Close" }).click();

  await page.getByPlaceholder("Search relay channels, models, tags, or URLs").fill("integration smoke");
  await expect(page.getByRole("row").filter({ hasText: "Axon Relay" }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "HubProxy Grok" })).toHaveCount(0);

  await axonRow.getByRole("button", { name: "Test with Codex" }).click();
  await expect(page.getByRole("button", { name: "Close settings" })).toHaveCount(0);
  await expect(page.getByTestId("topbar-fast-badge")).toBeVisible();
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{
          type?: string;
          method?: string;
          params?: {
            model?: string;
            effort?: string;
            input?: Array<{ type?: string; text?: string }>;
          };
        }>;
      }
    ).__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.model === "deepseek-chat" &&
        message.params?.effort === "minimal" &&
        message.params?.input?.some((entry) => entry.type === "text" && entry.text === "Reply with exactly: CODEX_RELAY_OK")
    );
  });
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; providerId?: string; model?: string }> })
      .__codexUiOutbound;
    return messages?.some((message) => message.type === "provider.activate" && message.providerId === "axon-relay" && message.model === "deepseek-chat");
  });
  expect(directProviderProbeRequests).toBe(1);
});

test("keeps cached relay channels visible when provider reload temporarily fails", async ({ page }) => {
  await page.unroute("/api/providers");
  await page.route("/api/providers", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "rebuilding" }
    })
  );
  await page.addInitScript((provider) => {
    localStorage.setItem(
      "codex-ultra.providers-cache.local",
      JSON.stringify({
        cachedAt: Date.now(),
        providers: [provider]
      })
    );
  }, {
    id: "cached-relay",
    kind: "responsesRelay",
    name: "Cached Relay",
    baseUrl: "https://cached.example/v1",
    apiKeyStorage: "none",
    defaultModel: "cached-model",
    nativeModels: ["cached-model"],
    modelAliases: [],
    createdAt: 10,
    updatedAt: 11
  });

  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();

  await expect(page.getByRole("row").filter({ hasText: "Cached Relay" }).first()).toBeVisible();
  await expect(page.getByText("https://cached.example/v1")).toBeVisible();
});

test("resolves chained provider aliases before starting a turn", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Relay settings").click();
  await expect(page.getByText("HubProxy Grok")).toBeVisible();
  await expect(page.getByText("key...ring")).toBeVisible();
  await expect(page.getByText("codex -> gpt-5.5")).toBeVisible();

  await page.getByRole("button", { name: "Use this channel" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await confirmWorkspace(page);
  await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill("Use the relay alias");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { model?: string } }> })
      .__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "turn/start" && message.params?.model === "grok-4.5");
  });
});

test("supports direct MCP tool calls with JSON arguments", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Mock thread" }).click();
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Plugins settings").click();
  await page.getByRole("tab", { name: "MCP 1" }).click();

  await expect(page.getByRole("button", { name: "Call tool" })).toBeEnabled();
  await expect(page.getByText("Select a conversation to enable MCP tool calls.")).toHaveCount(0);

  const argsEditor = page.getByLabel("Arguments JSON").first();
  await argsEditor.fill('{"message":"from-playwright"}');
  await page.getByRole("button", { name: "Call tool" }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { server?: string; tool?: string; arguments?: { message?: string } } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "mcpServer/tool/call" &&
        message.params?.server === "mock-mcp" &&
        message.params?.tool === "ping" &&
        message.params?.arguments?.message === "from-playwright"
    );
  });

  await expect(page.getByText('"ok": true')).toBeVisible();
  await expect(page.getByText('"message": "from-playwright"')).toBeVisible();
});

test("manages Codex plugins and MCP servers from Settings while forwarding native slash entries", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);
  async function sendNativeSlash(command: string) {
    await page.evaluate(() => {
      ((window as unknown as { __codexUiOutbound?: unknown[] }).__codexUiOutbound ?? []).length = 0;
    });
    await page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...").fill(command);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction((expectedText) => {
      const messages = (window as unknown as { __codexUiOutbound?: Array<{ method?: string; params?: { input?: Array<{ type?: string; text?: string }> } }> }).__codexUiOutbound ?? [];
      return messages.some(
        (message) =>
          message.method === "turn/start" &&
          message.params?.input?.some((entry) => entry.type === "text" && entry.text === expectedText)
      );
    }, command);
  }

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Plugins settings").click();
  await expect(page.getByRole("heading", { name: "Codex Plugins" })).toBeVisible();
  await expect(page.getByText("Codex plugin settings")).toBeVisible();
  await expect(page.getByText("Customer customization")).toHaveCount(0);
  await expect(page.getByText("Theme plugins", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mock Plugin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auth Plugin" })).toBeVisible();

  await page.getByRole("button", { name: "Details" }).first().click();
  await expect(page.getByText("Detailed mock plugin description.")).toBeVisible();
  await expect(page.getByText("mcp 1", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Hooks 2" }).click();
  await expect(page.getByText("Codex hooks")).toBeVisible();
  await expect(page.getByRole("heading", { name: "pre_tool_use" })).toBeVisible();
  await expect(page.getByText("python3 /root/hooks/pre_tool_use.py")).toBeVisible();
  await expect(page.getByText("trusted", { exact: true })).toBeVisible();
  await expect(page.getByText("plugin mock-plugin@mock-market")).toBeVisible();
  await expect(page.getByText("Mock hook warning")).toBeVisible();
  await expect(page.getByText(/Mock hook parse warning/)).toBeVisible();

  await page.getByRole("tab", { name: "MCP 1" }).click();
  await expect(page.getByText("mock-mcp")).toBeVisible();
  await expect(page.getByText("Ping tool")).toBeVisible();

  await page.getByRole("button", { name: "Close settings" }).click();
  await sendNativeSlash("/plugins");
  await sendNativeSlash("/mcp");
  await sendNativeSlash("/hooks");
});

test("exports and imports UI profiles without API keys", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Privacy settings").click();

  await expect(page.getByText("UI profile")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export profile" }).click()
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const profileContents = await readFile(downloadPath!, "utf8");
  expect(profileContents).toContain('"schema": "codex-react-ui.profile.v1"');
  expect(profileContents).toContain("HubProxy Grok");
  expect(profileContents).not.toContain("key...ring");

  await page.getByLabel("Import profile file").setInputFiles({
    name: "profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schema: "codex-react-ui.profile.v1",
        exportedAt: 456,
        providers: [importedProvider]
      })
    )
  });

  await expect(page.getByText("Imported 1 providers.")).toBeVisible();
  await page.getByLabel("Open Relay settings").click();
  await expect(page.getByText("Imported Relay")).toBeVisible();
  await expect(page.getByText("https://relay.example.test/v1")).toBeVisible();
});

test("shows dangerous permission audit records", async ({ page }) => {
  auditApiEvents = [
    {
      id: "audit-1",
      createdAt: 123456789,
      method: "turn/start",
      severity: "critical",
      reasons: ["approvalPolicy=never", "sandboxPolicy=dangerFullAccess"],
      cwd: "/root/projects",
      threadId: "thread-1",
      model: "grok-4.5",
      approvalPolicy: "never",
      sandboxPolicyType: "dangerFullAccess",
      inputSummary: { items: 1, textItems: 1, imageItems: 0, mentionItems: 0 }
    }
  ];

  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Privacy settings").click();

  await expect(page.getByText("Dangerous permission audit")).toBeVisible();
  await expect(page.getByText("critical", { exact: true })).toBeVisible();
  await expect(page.getByText(/approvalPolicy=never/)).toBeVisible();
  await expect(page.getByText(/input 1 items/)).toBeVisible();
});

test("saves skill extra roots and previews local markdown", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Skills settings").click();

  const extraRoots = page.getByLabel("Extra roots");
  await extraRoots.fill("/root/projects/extra-skills\n/root/projects/more-skills");
  await page.getByRole("button", { name: "Save roots" }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { extraRoots?: string[] } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "skills/extraRoots/set" &&
        message.params?.extraRoots?.includes("/root/projects/extra-skills") &&
        message.params?.extraRoots?.includes("/root/projects/more-skills")
    );
  });

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { cwds?: string[] } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "skills/list" &&
        message.params?.cwds?.includes("/root/projects/extra-skills") &&
        message.params?.cwds?.includes("/root/projects/more-skills")
    );
  });

  await page.getByRole("button", { name: "Preview markdown" }).first().click();
  await expect(page.getByText("Local preview from Playwright.")).toBeVisible();
});

test("uses installed-only plugin mentions and shows plugin app auth state", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page);
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Plugins settings").click();
  await page.getByRole("tab", { name: "Installed 1" }).click();

  const installedPicker = page.getByRole("combobox").last();
  await expect(installedPicker).toHaveText(/Mock Plugin/);
  await installedPicker.click();
  await expect(page.getByRole("option", { name: "Mock Plugin" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Auth Plugin" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Insert mention" }).click();
  const composer = page.getByPlaceholder("Ask Codex to inspect, edit, test, or explain this workspace...");
  await expect(composer).toHaveValue(/@mock-plugin/);
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { input?: Array<{ type?: string; path?: string }> } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "turn/start" &&
        message.params?.input?.some((input) => input.type === "mention" && input.path === "plugin://mock-plugin@mock-market")
    );
  });

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Plugins settings").click();
  await page.getByRole("tab", { name: "Marketplace 2" }).click();
  await expect(page.getByRole("heading", { name: "Auth Plugin" })).toBeVisible();
  await page.getByRole("button", { name: "Details" }).first().click();
  await expect(page.getByText("auth on use")).toBeVisible();
  await expect(page.getByText("Mock Calendar").first()).toBeVisible();
  await expect(page.getByText("Calendar Template")).toBeVisible();

  await page.getByRole("button", { name: "Install", exact: true }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { pluginName?: string } }> })
      .__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "plugin/install" && message.params?.pluginName === "auth-plugin");
  });
  await expect(page.getByText("Authentication needed after install")).toBeVisible();
  await expect(page.getByText("Auth Console")).toBeVisible();
});

test("browses and edits files through filesystem RPCs", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page, "/root/projects");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Workspace settings").click();

  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
  await page.getByRole("button", { name: "README.md" }).click();
  await expect(page.getByText("Mock Project")).toBeVisible({ timeout: 10000 });

  const nextContent = "# Updated Project\n\nSaved from Playwright.\n";
  await page.getByRole("textbox", { name: "Editor content" }).focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(nextContent);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { path?: string; dataBase64?: string } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "fs/writeFile" &&
        message.params?.path === "/root/projects/README.md" &&
        typeof message.params.dataBase64 === "string" &&
        atob(message.params.dataBase64).includes("Saved from Playwright.")
    );
  });

  await expect(page.getByText("Saved").last()).toBeVisible();
});

test("keeps workspace files explorer and editor panes resizable", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page, "/root/projects");
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Workspace settings").click();
  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Select a file to preview or edit." })).toBeVisible();
  // Workspace file splits from react-resizable-panels expose data-group/data-panel attrs.
  await expect(page.locator("[data-group]").first()).toBeVisible();
  await expect(page.locator("[data-panel]").first()).toBeVisible();
  await page.mouse.move(1120, 120);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "snapshot/codex-ui-files-resizable.png",
    fullPage: true
  });
});

test("runs one-shot commands in one transcript plus a resident pty shell", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Terminal" }).click();

  // 普通命令：独立短进程执行，输出进同一 transcript，不建 tab
  await page.getByLabel("Terminal input").fill("printf terminal-ready");
  await page.getByLabel("Terminal input").press("Enter");

  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { processId?: string; command?: string[]; tty?: boolean } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) =>
        message.type === "rpc" &&
        message.method === "command/exec" &&
        message.params?.tty === true &&
        message.params?.command?.join(" ") === "/bin/bash -lc printf terminal-ready"
    );
  });
  await expect(page.getByText("$ printf terminal-ready")).toBeVisible();
  await expect(page.locator('[aria-label="Terminal sessions"]')).toHaveCount(0);

  await page.getByLabel("Terminal input").fill("echo second-command");
  await page.getByLabel("Terminal input").press("Enter");
  await expect(page.getByText("$ echo second-command")).toBeVisible();
  await expect(page.getByText("$ printf terminal-ready")).toBeVisible();
  await expect(page.locator('[aria-label="Terminal sessions"]')).toHaveCount(0);
  // 等短命令在 mock 中秒退，避免顶栏 running 状态干扰 shell 断言
  await page.waitForTimeout(500);

  // + 拉起服务端常驻 PTY：进页签；mock 回放 pty-ready 进 xterm
  await page.getByLabel("Open terminal").click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> })
      .__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "terminal/create");
  });
  await expect(page.locator('[aria-label="Terminal sessions"] [role="tab"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="pty-terminal-view"]')).toHaveCount(0);
  // 运行中 pty 存在时 + 号隐藏（不再无节制建 tab）
  await expect(page.getByLabel("Open terminal")).toHaveCount(0);
  await expect(page.locator(".xterm-rows")).toHaveCount(0);

  // 点中 shell 页签挂载 xterm，输出来自 terminal/data
  await page.locator('[aria-label="Terminal sessions"] [role="tab"]').click();
  await expect(page.locator('[data-testid="pty-terminal-view"]')).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("pty-ready");

  // 附着 shell 后行输入直写 PTY；mock 原样回显
  await page.getByLabel("Terminal input").fill("hello pty");
  await page.getByLabel("Terminal input").press("Enter");
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { data?: string } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) => message.type === "rpc" && message.method === "terminal/write" && message.params?.data === "hello pty\n"
    );
  });
  await expect(page.locator(".xterm-rows")).toContainText("hello pty");

  // Ctrl+C 经行输入框发 \x03（真 PTY 由内核投递 SIGINT，不杀 shell）
  await page.getByLabel("Terminal input").click();
  await page.getByLabel("Terminal input").press("Control+c");
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string; params?: { data?: string } }> })
      .__codexUiOutbound;
    return messages?.some(
      (message) => message.type === "rpc" && message.method === "terminal/write" && message.params?.data === "\x03"
    );
  });
  // shell 存活：页签仍在
  await expect(page.locator('[aria-label="Terminal sessions"] [role="tab"]')).toHaveCount(1);

  // 顶栏终止按钮杀掉 pty，mock 回放 terminal/exit
  await page.getByRole("button", { name: "Terminate terminal" }).click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "terminal/kill");
  });
  // 退出后页签保留（显示 exited），点 ✕ 移除并 forget
  await expect(page.locator('[aria-label="Terminal sessions"] [role="tab"]')).toHaveCount(1);
  await page.locator('[aria-label="Terminal sessions"] [role="tab"] .MuiChip-deleteIcon').click();
  await page.waitForFunction(() => {
    const messages = (window as unknown as { __codexUiOutbound?: Array<{ type?: string; method?: string }> }).__codexUiOutbound;
    return messages?.some((message) => message.type === "rpc" && message.method === "terminal/forget");
  });
  await expect(page.locator('[aria-label="Terminal sessions"] [role="tab"]')).toHaveCount(0);
});

test("browses workspace files from the right Explorer", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page, "/root/projects");
  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Explorer" }).click();

  await expect(page.getByTestId("workspace-explorer-panel")).toBeVisible();
  await page.getByRole("treeitem", { name: /src/ }).click();
  await expect(page.getByRole("treeitem", { name: /App.tsx/ })).toBeVisible();

  await page.getByLabel("Search workspace files").fill("README");
  await page.getByRole("button", { name: /README.md/ }).click();
  await expect(page.getByText("Mock Project")).toBeVisible();
});

test("reviews Git changes, diffs, staging, and history", async ({ page }) => {
  await page.goto("/");
  await confirmWorkspace(page, "/root/projects");
  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Git" }).click();

  await expect(page.getByTestId("git-review-panel")).toBeVisible();
  await expect(page.getByTestId("git-changes-entry")).toContainText("README.md");
  await page.getByTestId("git-changes-entry").getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.getByTestId("git-review-diff")).toContainText("# Mock Project Updated");

  await page.getByLabel("Stage README.md").click();
  await expect(page.getByTestId("git-staged-entry")).toContainText("README.md");

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("git-history-entry")).toContainText("Add Git review");
  await page.getByTestId("git-history-entry").click();
  await expect(page.getByTestId("git-review-diff")).toContainText("# Git history detail");
});

test("binds Explorer and Git review to the active conversation cwd", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open history Second task" }).click();
  await expect(page.getByRole("tab", { name: "Second task" })).toHaveAttribute("aria-selected", "true");

  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Git" }).click();
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{ method?: string; params?: { cwd?: string } }>;
      }
    ).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "ui/git/status" &&
        message.params?.cwd === "/root/projects/codex-react-ui"
    );
  });

  await page.getByRole("button", { name: "Open history Mock thread" }).click();
  await expect(page.getByRole("tab", { name: "Mock thread" })).toHaveAttribute("aria-selected", "true");
  await page.waitForFunction(() => {
    const messages = (
      window as unknown as {
        __codexUiOutbound?: Array<{ method?: string; params?: { cwd?: string } }>;
      }
    ).__codexUiOutbound ?? [];
    return messages.some(
      (message) =>
        message.method === "ui/git/status" &&
        message.params?.cwd === "/root/projects"
    );
  });
});

test("opens Web Dev workspace and manages a preview server", async ({ page }) => {
  const previewUrl = "http://127.0.0.1:4173/";
  const webDevSession = {
    id: "webdev-e2e",
    command: "bun run dev -- --host 127.0.0.1",
    cwd: "/root/projects",
    status: "running",
    output: `$ bun run dev -- --host 127.0.0.1\nVITE ready at ${previewUrl}\n`,
    url: previewUrl,
    pid: 4242,
    startedAt: 1710000100,
    updatedAt: 1710000101
  };
  let sessions: typeof webDevSession[] = [];
  let startRequest: { command?: string; cwd?: string } | null = null;
  let probeRequest: { url?: string } | null = null;

  await page.route("/api/webdev/servers", (route) => route.fulfill({ json: { data: sessions } }));
  await page.route("/api/webdev/servers/start", async (route) => {
    startRequest = route.request().postDataJSON() as { command?: string; cwd?: string };
    sessions = [{ ...webDevSession, command: startRequest.command ?? webDevSession.command, cwd: startRequest.cwd ?? webDevSession.cwd }];
    await route.fulfill({ status: 201, json: { data: sessions[0] } });
  });
  await page.route("/api/webdev/servers/stop", async (route) => {
    const body = route.request().postDataJSON() as { id?: string };
    sessions = sessions.map((session) => (session.id === body.id ? { ...session, status: "terminated", updatedAt: 1710000102 } : session));
    await route.fulfill({ json: { data: sessions[0] } });
  });
  await page.route("/api/webdev/probe", async (route) => {
    probeRequest = route.request().postDataJSON() as { url?: string };
    await route.fulfill({
      json: {
        ok: probeRequest.url === previewUrl,
        url: probeRequest.url ?? previewUrl,
        status: probeRequest.url === previewUrl ? 200 : 503,
        contentType: "text/html",
        title: "WebDev Preview",
        elapsedMs: 12
      }
    });
  });

  await page.goto("/");
  await confirmWorkspace(page, "/root/projects");
  await page.getByLabel("Open right workspace").click();
  await page.getByRole("tab", { name: "Web Dev" }).click();

  await expect(page.getByTestId("webdev-panel")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();
  await expect(page.getByTestId("webdev-preview-frame")).toBeVisible();

  await page.getByLabel("Command", { exact: true }).fill("bun run dev -- --host 127.0.0.1");
  await page.getByLabel("Command cwd").fill("/root/projects");
  await page.getByTestId("webdev-run-server").click();

  await expect.poll(() => startRequest).toMatchObject({
    command: "bun run dev -- --host 127.0.0.1",
    cwd: "/root/projects"
  });
  await expect(page.getByTestId("webdev-managed-server-session")).toContainText(previewUrl);
  await expect(page.getByTestId("webdev-preview-url").locator("input")).toHaveValue(previewUrl);
  await expect(page.getByTestId("webdev-preview-status")).toContainText("HTTP 200");
  await expect.poll(() => probeRequest).toMatchObject({ url: previewUrl });
  await expect(page.getByTestId("webdev-preview-frame")).toHaveAttribute("src", previewUrl);
});

test("matches desktop and mobile workbench screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByTestId("right-workspace-panel")).toHaveCount(0);
  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Plugins settings").click();
  await page.getByRole("tab", { name: "Marketplace 2" }).click();
  await expect(page.getByRole("heading", { name: "Mock Plugin" })).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-desktop.png", {
    animations: "disabled",
    fullPage: false
  });

  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByLabel("Open right workspace").click();
  await expect(page.getByTestId("right-workspace-panel")).toBeVisible();
  await page.mouse.move(900, 220);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "snapshot/sidechat-workbench.png",
    fullPage: true
  });
  await page.getByRole("banner").getByRole("button", { name: "Hide right workspace" }).click();
  await expect(page.getByTestId("right-workspace-panel")).toHaveCount(0);

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Atmospheric Codex" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "atmospheric-codex");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page).toHaveScreenshot("workbench-atmospheric-theme.png", {
    animations: "disabled",
    fullPage: false
  });

  await page.getByLabel("Open settings").click();
  await page.getByLabel("Open Appearance settings").click();
  await page.getByLabel("Skin").click();
  await page.getByRole("option", { name: "Official Black" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "official-black");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page).toHaveScreenshot("workbench-official-black-theme.png", {
    animations: "disabled",
    fullPage: false
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-mobile.png", {
    animations: "disabled",
    fullPage: false
  });
});
