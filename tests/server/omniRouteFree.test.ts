import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildAllFreeGroups,
  buildClineFreeGroup,
  buildD2ApiFreeGroup,
  buildFreebuffGroup,
  buildKiloCodeGroup,
  buildOmniRouteFreeGroup,
  buildOpenCodeGroup,
  clearClineTokenCache,
  CLINE_CLIENT_VERSION,
  CLINE_FREE_BASE_URL,
  CLINE_RECOMMENDED_MODELS_URL,
  D2API_BASE_URL,
  D2API_DEFAULT_CONTEXT_WINDOW,
  D2API_DEFAULT_MODELS,
  DEFAULT_FREEBUFF_MODELS,
  eligibleClineFreeModels,
  eligibleKiloCodeFreeModels,
  eligibleOmniRouteFreeModels,
  fetchClineFreeModels,
  fetchD2ApiFreeModels,
  fetchFreebuffFreeModels,
  fetchKiloCodeFreeModels,
  fetchOmniRouteFreeModels,
  FREEBUFF_BASE_URL,
  KILOCODE_FREE_BASE_URL,
  OMNIROUTE_FREE_BASE_URL,
  resolveLocalClineToken,
  resolveLocalFreebuffCredentials,
  generateOpenCodeUlid,
  getOpenCodeProjectId,
  getOpenCodeSessionId,
  rotateOpenCodeSession,
  clearOpenCodeSession,
  applyOpenCodeHeaders,
  isOpenCodeGroup,
  isPremiumOpencodeModel,
  isGatedOpencodeFreeTierRequest,
  resolveOpencodeTargetFormat,
  applyOpencodeFreeTierRequestContract,
  stripOpencodeModelPrefix,
  parseOpencodeEffortLevel,
  buildOpencodeUpstreamBody,
  buildKernelBody,
  buildKernelChatBody,
  buildKernelResponsesBody,
  repairKernelChatToolPairing,
  buildOpencodeBackgroundHeaders,
  deriveOpenCodeSessionId,
  openCodeThreadHeaders,
  OPENCODE_BACKEND_USER_AGENTS,
  OPENCODE_CLI_BACKEND_HEADER,
  OPENCODE_CLIENT_VERSION,
  OPENCODE_DEFAULT_USER_AGENT
} from "../../backends/relay-config/src/relay/omniRouteFree.ts";

test("keeps only explicit keyless OpenCode models", () => {
  expect(eligibleOmniRouteFreeModels({ data: [
    { id: "big-pickle", owned_by: "opencode" },
    { id: "mimo-v2.5-free" },
    { id: "paid-model" },
    { id: "MIMO-V2.5-FREE" },
    { id: "" }
  ] })).toEqual([
    { id: "big-pickle", ownedBy: "opencode" },
    { id: "mimo-v2.5-free", ownedBy: undefined }
  ]);
});

test("eligibleOmniRouteFreeModels accepts opencode/ prefixed free models from local CLI", () => {
  expect(eligibleOmniRouteFreeModels([
    "opencode/big-pickle",
    "opencode/ling-3.0-flash-fin-free",
    "opencode-go/qwen3.6-plus",
    "opencode-go/beam-free",
    "kilocode/nvidia/nemotron-3.5-lightning:free",
    "myapi/claude-sonnet-4.6"
  ])).toEqual([
    { id: "opencode/big-pickle", ownedBy: undefined },
    { id: "opencode/ling-3.0-flash-fin-free", ownedBy: undefined }
  ]);
});

test("keeps only isFree or :free / -free KiloCode models", () => {
  expect(eligibleKiloCodeFreeModels({ data: [
    { id: "kilo-auto/free", isFree: true },
    { id: "stepfun/step-3.7-flash:free", isFree: true },
    { id: "paid/model", isFree: false },
    { id: "other-model-free", isFree: false },
    { id: "" }
  ] })).toEqual([
    { id: "kilo-auto/free", name: undefined },
    { id: "stepfun/step-3.7-flash:free", name: undefined },
    { id: "other-model-free", name: undefined }
  ]);
});

test("buildAllFreeGroups exposes only KiloCode by default (OpenCode free groups removed)", () => {
  const opencodeModels = ["mimo-v2.5-free", "big-pickle"];
  const kiloModels = ["kilo-auto/free", "stepfun/step-3.7-flash:free"];

  const kiloGroup = buildKiloCodeGroup(kiloModels);
  expect(kiloGroup).toMatchObject({
    id: "kilocode",
    name: "KiloCode",
    baseUrl: KILOCODE_FREE_BASE_URL,
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    authType: "none",
    keys: [],
    models: kiloModels
  });

  const groups = buildAllFreeGroups(opencodeModels, kiloModels);
  expect(groups).toHaveLength(1);
  expect(groups.map((g) => g.id)).toEqual(["kilocode"]);
  expect(groups.map((g) => g.name)).toEqual(["KiloCode"]);
  expect(groups[0]?.responseProtocol).toBe("openai-response");
});

test("buildAllFreeGroups prioritizes newly fetched models over existing models on refresh", () => {
  const existingGroups = [
    {
      ...buildOmniRouteFreeGroup(["stale-model-1", "stale-model-2"]),
      name: "UserCustomFreeName",
      modelMapping: [{ from: "gpt-5.6-luna", to: "fresh-mimo" }]
    },
    {
      ...buildOpenCodeGroup(["stale-model-1"]),
      name: "UserCustomOpenCodeName"
    },
    {
      ...buildKiloCodeGroup(["stale-kilo-1"]),
      name: "UserCustomKiloName"
    }
  ];

  const newlyFetchedOpenCode = ["fresh-mimo", "fresh-pickle"];
  const newlyFetchedKilo = ["kilo-new/free", "stepfun-new:free"];

  const updated = buildAllFreeGroups(newlyFetchedOpenCode, newlyFetchedKilo, existingGroups);
  expect(updated).toHaveLength(1);

  const kiloGroup = updated.find((g) => g.id === "kilocode");
  expect(kiloGroup?.models).toEqual(["kilo-new/free", "stepfun-new:free"]);
  expect(kiloGroup?.name).toBe("UserCustomKiloName");
  expect(kiloGroup?.responseProtocol).toBe("openai-response");
});

test("buildAllFreeGroups falls back to existing models when a source fetch fails", () => {
  const existingGroups = [
    buildOmniRouteFreeGroup(["stale-opencode-model"]),
    buildOpenCodeGroup(["stale-opencode-model"]),
    buildKiloCodeGroup(["stale-kilo-model"])
  ];

  // Case 1: OpenCode fetch failed (empty), KiloCode succeeded
  const partialKiloSuccess = buildAllFreeGroups([], ["new-kilo-model"], existingGroups);
  expect(partialKiloSuccess.find((g) => g.id === "kilocode")?.models).toEqual(["new-kilo-model"]);

  // Case 2: KiloCode fetch failed (empty), OpenCode succeeded
  const partialOpenCodeSuccess = buildAllFreeGroups(["new-opencode-model"], [], existingGroups);
  expect(partialOpenCodeSuccess.find((g) => g.id === "kilocode")?.models).toEqual(["stale-kilo-model"]);
});

test("lists free models without spending a chat request or sending machine identity", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? String(init.body) : undefined
    });
    return Response.json({ data: [{ id: "big-pickle" }, { id: "mimo-v2.5-free" }, { id: "paid" }] });
  }) as typeof fetch;

  await expect(fetchOmniRouteFreeModels({ fetchImpl, timeoutMs: 1_000 })).resolves.toEqual({
    models: ["big-pickle", "mimo-v2.5-free"],
    fetchedModels: 2
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(`${OMNIROUTE_FREE_BASE_URL}/models`);
  expect(calls[0]?.method).toBe("GET");
  expect(calls[0]?.body).toBeUndefined();
  for (const header of ["Authorization", "X-Machine-Hash", "X-Machine-Id", "X-Device-Id"]) {
    expect(calls[0]?.headers.has(header)).toBe(false);
  }
});

test("lists KiloCode free models with correct User-Agent", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const fetchImpl = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers)
    });
    return Response.json({ data: [
      { id: "kilo-auto/free", isFree: true },
      { id: "stepfun/step-3.7-flash:free", isFree: true },
      { id: "paid", isFree: false }
    ] });
  }) as typeof fetch;

  await expect(fetchKiloCodeFreeModels({ fetchImpl, timeoutMs: 1_000 })).resolves.toEqual({
    models: ["kilo-auto/free", "stepfun/step-3.7-flash:free"],
    fetchedModels: 2
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(`${KILOCODE_FREE_BASE_URL}/models`);
  expect(calls[0]?.headers.get("User-Agent")).toBe("opencode-kilo-provider");
});

test("keeps only promotional free models from Cline recommended-models payload", () => {
  expect(eligibleClineFreeModels({
    recommended: [{ id: "paid/gpt-5" }],
    free: [
      { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
      { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" },
      { id: "DEEPSEEK/DEEPSEEK-V4-FLASH" },
      "cline-free/longcat-2.0",
      { id: "" }
    ]
  })).toEqual([
    { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
    { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" },
    { id: "cline-free/longcat-2.0", name: undefined }
  ]);
});

test("creates cline-free group with correct openai protocol and authType bearer", () => {
  const models = ["deepseek/deepseek-v4-flash", "z-ai/glm-5.3-flash"];
  const group = buildClineFreeGroup(models, "workos:test-token");
  expect(group).toMatchObject({
    id: "cline-free",
    name: "ClineFree",
    baseUrl: CLINE_FREE_BASE_URL,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    authType: "bearer",
    keys: ["workos:test-token"],
    models
  });
});

test("buildAllFreeGroups exposes KiloCode and ClineFree when clineModels are provided", () => {
  const opencodeModels = ["opencode-model-1"];
  const kiloModels = ["kilo-model-1"];
  const clineModels = ["cline-model-1", "cline-model-2"];

  const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels);
  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.id)).toEqual(["kilocode", "cline-free"]);
  expect(groups.map((g) => g.name)).toEqual(["KiloCode", "ClineFree"]);
  expect(groups[1]?.responseProtocol).toBe("openai");
  expect(groups[1]?.models).toEqual(clineModels);
});

test("creates d2api group with openai protocol, no key, and 20K default context", () => {
  const models = ["gpt-5.4-mini", "claude-haiku-4-5"];
  const group = buildD2ApiFreeGroup(models);
  expect(group).toMatchObject({
    id: "d2api",
    name: "D2API",
    baseUrl: D2API_BASE_URL,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    authType: "none",
    keys: [],
    contextWindow: D2API_DEFAULT_CONTEXT_WINDOW,
    models
  });
  expect(D2API_DEFAULT_CONTEXT_WINDOW).toBe(20_000);
  expect(D2API_DEFAULT_MODELS).toContain("gpt-6-luna");
  expect(D2API_DEFAULT_MODELS).not.toContain("gpt-5.6-luna");
});

test("creates d2api group with bearer auth when an api key is given", () => {
  const group = buildD2ApiFreeGroup(["gpt-5.4-mini"], "d2api-secret", "http://10.0.0.5:44090");
  expect(group).toMatchObject({
    id: "d2api",
    baseUrl: "http://10.0.0.5:44090",
    authType: "bearer",
    keys: ["d2api-secret"],
    contextWindow: 20_000
  });
});

test("buildAllFreeGroups adds d2api group when d2apiModels are provided", () => {
  const groups = buildAllFreeGroups(["opencode-model-1"], ["kilo-model-1"], undefined, undefined, [], {
    d2apiModels: ["gpt-5.4-mini"],
    d2apiBaseUrl: "http://127.0.0.1:44090"
  });
  expect(groups.map((g) => g.id)).toEqual(["kilocode", "d2api"]);
  const d2api = groups.find((g) => g.id === "d2api")!;
  expect(d2api.models).toEqual(["gpt-5.4-mini"]);
  expect(d2api.baseUrl).toBe("http://127.0.0.1:44090");
  expect(d2api.contextWindow).toBe(20_000);
  expect(d2api.authType).toBe("none");
});

test("buildAllFreeGroups preserves an existing d2api group on refresh", () => {
  const existing = buildAllFreeGroups(["opencode-model-1"], ["kilo-model-1"], undefined, undefined, [], {
    d2apiModels: ["gpt-5.4-mini"],
    d2apiApiKey: "old-key",
    d2apiBaseUrl: "http://10.0.0.5:44090"
  });
  const refreshed = buildAllFreeGroups(["opencode-model-1"], ["kilo-model-1"], undefined, undefined, existing, {});
  const d2api = refreshed.find((g) => g.id === "d2api")!;
  expect(d2api.models).toEqual(["gpt-5.4-mini"]);
  expect(d2api.baseUrl).toBe("http://10.0.0.5:44090");
  expect(d2api.keys).toEqual(["old-key"]);
  expect(d2api.contextWindow).toBe(20_000);
});

test("lists D2API models from a local OpenAI-shaped directory", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ data: [{ id: "gpt-5.4-mini" }, { id: "claude-haiku-4-5" }] }), { status: 200 })) as typeof fetch;
  const result = await fetchD2ApiFreeModels({ baseUrl: "http://127.0.0.1:44090", fetchImpl });
  expect(result.models).toEqual(["gpt-5.4-mini", "claude-haiku-4-5"]);
  expect(result.fetchedModels).toBe(2);
});

test("fetchD2ApiFreeModels throws when the local instance is unreachable", async () => {
  const fetchImpl = (async () => { throw new Error("connection refused"); }) as typeof fetch;
  await expect(fetchD2ApiFreeModels({ baseUrl: "http://127.0.0.1:44090", fetchImpl, timeoutMs: 1000 })).rejects.toThrow();
});

test("lists Cline free models with correct User-Agent and endpoint", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const fetchImpl = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers)
    });
    return Response.json({
      free: [
        { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
        { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" }
      ]
    });
  }) as typeof fetch;

  await expect(fetchClineFreeModels({ fetchImpl, timeoutMs: 1_000 })).resolves.toEqual({
    models: ["deepseek/deepseek-v4-flash", "z-ai/glm-5.3-flash"],
    fetchedModels: 2
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(CLINE_RECOMMENDED_MODELS_URL);
  expect(calls[0]?.headers.get("User-Agent")).toBe(`Cline/${CLINE_CLIENT_VERSION}`);
});

test("resolveLocalClineToken resolves unexpired token from providers.json", async () => {
  clearClineTokenCache();
  const tempDir = join(import.meta.dir, "../../scratch/test-cline-auth");
  const settingsPath = join(tempDir, "providers-unexpired.json");
  const testData = {
    providers: {
      cline: {
        settings: {
          auth: {
            accessToken: "workos:jwt-valid-token-123",
            refreshToken: "refresh-token-456",
            expiresAt: Date.now() + 3600_000
          }
        }
      }
    }
  };

  const fs = await import("node:fs");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(testData, null, 2), "utf8");

  try {
    const token = await resolveLocalClineToken({ settingsPath });
    expect(token).toBe("workos:jwt-valid-token-123");
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

test("resolveLocalClineToken refreshes expired token and writes back to disk", async () => {
  clearClineTokenCache();
  const tempDir = join(import.meta.dir, "../../scratch/test-cline-refresh");
  const settingsPath = join(tempDir, "providers-expired.json");
  const testData = {
    providers: {
      cline: {
        settings: {
          auth: {
            accessToken: "workos:expired-token",
            refreshToken: "refresh-token-active",
            expiresAt: Date.now() - 10_000 // expired
          }
        }
      }
    }
  };

  const fs = await import("node:fs");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(testData, null, 2), "utf8");

  const refreshCalls: Array<{ url: string; body?: string }> = [];
  const fetchImpl = (async (input, init) => {
    refreshCalls.push({
      url: String(input),
      body: init?.body ? String(init.body) : undefined
    });
    return Response.json({
      success: true,
      data: {
        accessToken: "workos:new-refreshed-jwt-token",
        refreshToken: "refresh-token-active",
        expiresAt: Date.now() + 3600_000
      }
    });
  }) as typeof fetch;

  try {
    const token = await resolveLocalClineToken({ settingsPath, fetchImpl });
    expect(token).toBe("workos:new-refreshed-jwt-token");
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]?.url).toBe(`${CLINE_FREE_BASE_URL}/auth/refresh`);

    // Verify written back to disk
    const diskContent = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(diskContent.providers.cline.settings.auth.accessToken).toBe("workos:new-refreshed-jwt-token");
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

test("creates freebuff group with correct openai protocol and authType bearer", () => {
  const models = ["z-ai/glm-5.3-flash", "openai/gpt-5.6-luna"];
  const group = buildFreebuffGroup(models, "fb-test-token");
  expect(group).toMatchObject({
    id: "freebuff",
    name: "Freebuff",
    baseUrl: FREEBUFF_BASE_URL,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    authType: "bearer",
    keys: ["fb-test-token"],
    models
  });
});

test("buildAllFreeGroups exposes KiloCode, ClineFree, and Freebuff when optional models are provided", () => {
  const opencodeModels = ["opencode-model-1"];
  const kiloModels = ["kilo-model-1"];
  const clineModels = ["cline-model-1"];
  const freebuffModels = ["z-ai/glm-5.3-flash", "openai/gpt-5.6-luna"];

  const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels);
  expect(groups).toHaveLength(3);
  expect(groups.map((g) => g.id)).toEqual(["kilocode", "cline-free", "freebuff"]);
  expect(groups.map((g) => g.name)).toEqual(["KiloCode", "ClineFree", "Freebuff"]);
  expect(groups[2]?.responseProtocol).toBe("openai");
  expect(groups[2]?.models).toEqual(freebuffModels);
});

test("lists Freebuff free models from /freebuff/session endpoint", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const fetchImpl = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers)
    });
    return Response.json({
      freebucks: {
        prices: {
          "z-ai/glm-5.3-flash": 0,
          "openai/gpt-5.6-luna": 0,
          "mimo/mimo-v2.5": 0
        }
      }
    });
  }) as typeof fetch;

  const result = await fetchFreebuffFreeModels({ fetchImpl, token: "test-fb-token" });
  expect(result.fetchedModels).toBe(3);
  expect(result.models).toEqual(["z-ai/glm-5.3-flash", "openai/gpt-5.6-luna", "mimo/mimo-v2.5"]);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(`${FREEBUFF_BASE_URL}/freebuff/session`);
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer test-fb-token");
  expect(calls[0]?.headers.get("x-codebuff-api-key")).toBe("test-fb-token");
});

test("resolveLocalFreebuffCredentials reads default token from credentials.json", async () => {
  const tempDir = join(import.meta.dir, "../../scratch/test-freebuff-credentials");
  const credentialsPath = join(tempDir, "credentials.json");
  const testData = {
    default: {
      authToken: "fb-auth-token-999",
      id: "fb-user-888"
    }
  };

  const fs = await import("node:fs");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(credentialsPath, JSON.stringify(testData, null, 2), "utf8");

  try {
    const creds = await resolveLocalFreebuffCredentials({ credentialsPath });
    expect(creds).not.toBeNull();
    expect(creds?.token).toBe("fb-auth-token-999");
    expect(creds?.userId).toBe("fb-user-888");
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

test("buildAllFreeGroups hides cline-free and freebuff when credentials are false (easter egg)", () => {
  const opencodeModels = ["opencode-model-1"];
  const kiloModels = ["kilo-model-1"];
  const clineModels = ["cline-model-1"];
  const freebuffModels = ["freebuff-model-1"];

  const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels, [], {
    hasClineCredentials: false,
    hasFreebuffCredentials: false
  });

  expect(groups).toHaveLength(1);
  expect(groups.map((g) => g.id)).toEqual(["kilocode"]);
});

test("buildAllFreeGroups selectively lights up cline-free when hasClineCredentials is true", () => {
  const opencodeModels = ["opencode-model-1"];
  const kiloModels = ["kilo-model-1"];
  const clineModels = ["cline-model-1"];
  const freebuffModels = ["freebuff-model-1"];

  const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels, [], {
    hasClineCredentials: true,
    hasFreebuffCredentials: false
  });

  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.id)).toEqual(["kilocode", "cline-free"]);
  expect(groups[1]?.models).toEqual(clineModels);
});

test("buildAllFreeGroups selectively lights up freebuff when hasFreebuffCredentials is true", () => {
  const opencodeModels = ["opencode-model-1"];
  const kiloModels = ["kilo-model-1"];
  const clineModels = ["cline-model-1"];
  const freebuffModels = ["freebuff-model-1"];

  const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels, [], {
    hasClineCredentials: false,
    hasFreebuffCredentials: true
  });

  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.id)).toEqual(["kilocode", "freebuff"]);
  expect(groups[1]?.models).toEqual(freebuffModels);
});

test("buildAllFreeGroups lights up both easter eggs when both credentials exist", () => {
  const opencodeModels = ["opencode-model-1"];
  const kiloModels = ["kilo-model-1"];
  const clineModels = ["cline-model-1"];
  const freebuffModels = ["freebuff-model-1"];

  const groups = buildAllFreeGroups(opencodeModels, kiloModels, clineModels, freebuffModels, [], {
    hasClineCredentials: true,
    hasFreebuffCredentials: true
  });

  expect(groups).toHaveLength(3);
  expect(groups.map((g) => g.id)).toEqual(["kilocode", "cline-free", "freebuff"]);
});

test("generateOpenCodeUlid produces valid 26-character Crockford Base32 ULIDs", () => {
  const ulidPattern = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
  const id1 = generateOpenCodeUlid();
  const id2 = generateOpenCodeUlid();

  expect(id1).toHaveLength(26);
  expect(id2).toHaveLength(26);
  expect(ulidPattern.test(id1)).toBe(true);
  expect(ulidPattern.test(id2)).toBe(true);
  expect(id1).not.toBe(id2);
});

test("getOpenCodeProjectId and getOpenCodeSessionId maintain stable IDs and rotate on demand", () => {
  clearOpenCodeSession();

  const proj1 = getOpenCodeProjectId();
  const proj2 = getOpenCodeProjectId();
  expect(proj1).toBe(proj2);
  expect(proj1).toBe("global");

  const sess1 = getOpenCodeSessionId();
  const sess2 = getOpenCodeSessionId();
  expect(sess1).toBe(sess2);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  expect(uuidPattern.test(sess1)).toBe(true);

  rotateOpenCodeSession();
  const sess3 = getOpenCodeSessionId();
  expect(sess3).not.toBe(sess1);
  expect(uuidPattern.test(sess3)).toBe(true);
});

test("isOpenCodeGroup correctly identifies OpenCode free groups and baseUrls", () => {
  expect(isOpenCodeGroup({ id: "opencode-free", baseUrl: "https://opencode.ai/zen/v1" } as any)).toBe(true);
  expect(isOpenCodeGroup({ id: "opencode", baseUrl: "https://opencode.ai/zen/v1" } as any)).toBe(true);
  expect(isOpenCodeGroup({ id: "custom", baseUrl: "https://opencode.ai/zen/v1" } as any)).toBe(true);
  expect(isOpenCodeGroup({ id: "kilocode", baseUrl: "https://api.kilo.ai/api/openrouter" } as any)).toBe(false);
  expect(isOpenCodeGroup({ id: "cline-free", baseUrl: "https://api.cline.bot/api/v1" } as any)).toBe(false);
  expect(isOpenCodeGroup(null)).toBe(false);
});

test("applyOpenCodeHeaders sets User-Agent, omits Authorization for keyless, and sets required x-opencode-* headers", () => {
  clearOpenCodeSession();
  const headers = new Headers();
  applyOpenCodeHeaders(headers);

  expect(headers.get("User-Agent")).toBe(OPENCODE_DEFAULT_USER_AGENT);
  expect(headers.get("x-opencode-client")).toBe("desktop");
  expect(headers.has("Authorization")).toBe(false);

  const project = headers.get("x-opencode-project");
  const session = headers.get("x-opencode-session");
  const request = headers.get("x-opencode-request");

  const sesPattern = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
  const msgPattern = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
  expect(project).toBe("global");
  expect(session).toBeDefined();
  expect(request).toBeDefined();
  expect(sesPattern.test(session!)).toBe(true);
  expect(msgPattern.test(request!)).toBe(true);

  // If a custom apiKey is provided, zen Responses surface uses x-api-key (upstream #12633)
  const authHeaders = new Headers();
  applyOpenCodeHeaders(authHeaders, "my-custom-key");
  expect(authHeaders.get("x-api-key")).toBe("my-custom-key");
});

test("deriveOpenCodeSessionId is deterministic per thread and UUID-formatted", () => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const first = deriveOpenCodeSessionId("thread-abc");
  expect(uuidPattern.test(first)).toBe(true);
  expect(deriveOpenCodeSessionId("thread-abc")).toBe(first);
  expect(deriveOpenCodeSessionId("  thread-abc  ")).toBe(first);
  expect(deriveOpenCodeSessionId("thread-other")).not.toBe(first);
});

test("openCodeThreadHeaders sends dedicated UA and thread-stable session per backend", () => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const backend of ["pi", "grok", "agy", "claude", "openclaude"] as const) {
    const first = openCodeThreadHeaders("thread-1", backend);
    const second = openCodeThreadHeaders("thread-1", backend);
    expect(first["User-Agent"]).toBe(OPENCODE_BACKEND_USER_AGENTS[backend]);
    expect(first["User-Agent"]).not.toMatch(/^(curl|python|node|axios|got|undici|fetch)\//i);
    expect(first["x-opencode-client"]).toBe("desktop");
    expect(first["x-opencode-project"]).toBe("global");
    expect(first["x-opencode-session"]).toBe(deriveOpenCodeSessionId("thread-1"));
    expect(first["x-opencode-session"]).toBe(second["x-opencode-session"]);
    expect(uuidPattern.test(first["x-opencode-session"])).toBe(true);
    // Every request gets a fresh request id for tracing.
    expect(first["x-opencode-request"]).toBeDefined();
    expect(second["x-opencode-request"]).toBeDefined();
    expect(first["x-opencode-request"]).not.toBe(second["x-opencode-request"]);
    // No Authorization handling: callers keep their own key logic.
    expect("Authorization" in first).toBe(false);
  }
  expect(openCodeThreadHeaders("thread-2", "grok")["x-opencode-session"]).not.toBe(
    openCodeThreadHeaders("thread-1", "grok")["x-opencode-session"]
  );
});

test("claude backends have dedicated OpenCode UAs distinct from the generic default", () => {
  expect(OPENCODE_BACKEND_USER_AGENTS.claude).toBe("codex-ultra-claude/1.0");
  expect(OPENCODE_BACKEND_USER_AGENTS.openclaude).toBe("codex-ultra-openclaude/1.0");
  expect(OPENCODE_BACKEND_USER_AGENTS.claude).not.toBe(OPENCODE_DEFAULT_USER_AGENT);
  expect(OPENCODE_CLI_BACKEND_HEADER).toBe("x-codex-cli-backend");
});

test("opencode upstream parity: free-tier gate matches OPENCODE_FREE_MODELS plus -free suffix", () => {
  // Known free catalog (upstream opencodeFreeTierContract.ts exact rows).
  for (const model of ["big-pickle", "deepseek-v4-flash-free", "mimo-v2.5-free", "hy3-free", "nemotron-3-ultra-free", "north-mini-code-free"]) {
    expect(isPremiumOpencodeModel(model, "opencode")).toBe(false);
    expect(isGatedOpencodeFreeTierRequest(model, "opencode", "zen")).toBe(true);
  }
  // -free suffix covers rotations without a deploy (e.g. mimo-v2.6-flash-free via gate, not catalog rows).
  expect(isPremiumOpencodeModel("mimo-v2.6-flash-free", "opencode")).toBe(false);
  expect(isPremiumOpencodeModel("muse-spark-1.3-contributor-free", "opencode")).toBe(false);
  // go surface has no free tier; premium models stay premium.
  expect(isPremiumOpencodeModel("big-pickle", "opencode-go")).toBe(true);
  expect(isPremiumOpencodeModel("gpt-5.6-luna", "opencode")).toBe(true);
  expect(isGatedOpencodeFreeTierRequest("big-pickle", "opencode", "go")).toBe(false);
});

test("kernel chat body injects reasoning_content for thinking families (zen.go zenInjectChatReasoning)", () => {
  const caller = {
    model: "opencode/deepseek-v4-pro-high",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ],
  };
  const deepseek = buildKernelChatBody(caller, "opencode/deepseek-v4-pro-high") as {
    model: string;
    messages: Array<Record<string, unknown>>;
  };
  // Kernel ids keep the effort suffix (zen.go zenKernelModelID only strips the
  // provider prefix); the split happens in the free-tier contract step.
  expect(deepseek.model).toBe("deepseek-v4-pro-high");
  const assistant = deepseek.messages.find((message) => message.role === "assistant");
  expect(typeof assistant?.reasoning_content).toBe("string");

  // Non-thinking families must not gain the placeholder field.
  const plain = buildKernelChatBody(caller, "opencode/big-pickle") as {
    messages: Array<Record<string, unknown>>;
  };
  const plainAssistant = plain.messages.find((message) => message.role === "assistant");
  expect(plainAssistant?.reasoning_content).toBeUndefined();
});

test("free-tier contract injects a genuine read tool instead of a placeholder", () => {
  // Chat surface: nested tool shape, caller tools preserved.
  const chat = applyOpencodeFreeTierRequestContract(
    { model: "big-pickle", tools: [{ type: "function", function: { name: "shell", parameters: { type: "object" } } }] },
    "openai",
    [],
  ) as { stream: boolean; tools: Array<Record<string, any>> };
  expect(chat.stream).toBe(true);
  expect(chat.tools.map((tool) => tool.function?.name)).toEqual(["shell", "read"]);
  const chatRead = chat.tools.find((tool) => tool.function?.name === "read");
  expect(chatRead?.function?.parameters?.properties?.filePath?.type).toBe("string");
  expect(chatRead?.function?.parameters?.required).toEqual(["filePath"]);

  // Responses surface: flat tool shape.
  const responses = applyOpencodeFreeTierRequestContract(
    { model: "big-pickle", tools: [{ type: "function", name: "shell", parameters: { type: "object" } }] },
    "openai-responses",
    [],
  ) as { tools: Array<Record<string, any>> };
  const responsesRead = responses.tools.find((tool) => tool.name === "read");
  expect(responsesRead?.parameters?.properties?.filePath?.type).toBe("string");

  // Tool-less calls still get the native tool; existing caller `read` is kept as-is.
  const bare = applyOpencodeFreeTierRequestContract({ model: "big-pickle" }, "openai-responses", []) as {
    tools: Array<Record<string, any>>;
  };
  expect(bare.tools.map((tool) => tool.name)).toEqual(["read"]);
  const callerRead = { type: "function", name: "read", description: "mine", parameters: { type: "object" } };
  const preserved = applyOpencodeFreeTierRequestContract(
    { model: "big-pickle", tools: [callerRead] },
    "openai-responses",
    [],
  ) as { tools: Array<Record<string, any>> };
  expect(preserved.tools).toEqual([callerRead]);
});

test("kernel bodies match goproxy: admission read tool, hollow repair, title calls tool-less", () => {
  const identity = { session: "ses_aaaaaaaaaaaabbbbbbbbbbbbbb", request: "msg_ccccccccccccdddddddddddddd" };
  // Chat surface: hollow caller tool gets `_compat`; genuine `read` is added.
  const chat = buildKernelBody(
    {
      model: "beam-free",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "shell", parameters: { type: "object", properties: {} } } }],
    },
    "beam-free",
    identity,
    "openai",
  ) as { tools: Array<Record<string, any>> };
  const chatNames = chat.tools.map((tool) => tool.function.name);
  expect(chatNames).toEqual(["shell", "read"]);
  const shell = chat.tools.find((tool) => tool.function.name === "shell");
  expect(shell?.function.parameters.properties).toEqual({
    _compat: { type: "string", description: "Reserved for compatibility; do not use." },
  });
  const read = chat.tools.find((tool) => tool.function.name === "read");
  expect(read?.function.parameters).toEqual({
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  });

  // Title-shaped calls must never receive the admission tool.
  const title = buildKernelBody(
    {
      model: "beam-free",
      messages: [{ role: "user", content: "name this chat" }],
      response_format: { type: "json_schema", json_schema: { schema: { type: "object", properties: { title: { type: "string" } } } } },
    },
    "beam-free",
    identity,
    "openai",
  ) as { tools?: unknown[] };
  expect(title.tools).toBeUndefined();
});

test("kernel responses body honours the Responses surface and drops stale reasoning", () => {
  const identity = { session: "ses_aaaaaaaaaaaabbbbbbbbbbbbbb", request: "msg_ccccccccccccdddddddddddddd" };
  const body = buildKernelBody(
    {
      model: "beam-free",
      input: [
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "reasoning", id: "rs_stale" },
        { encrypted_content: "xxx" },
        { id: "no-type-no-role" },
        { type: "function_call_output", call_id: "c1", output: "" },
        { type: "function_call_output", call_id: "c1", output: "real-bytes" },
        { type: "function_call_output", call_id: "c2", output: "same" },
        { type: "function_call_output", call_id: "c2", output: "same" },
      ],
    },
    "beam-free",
    identity,
    "openai-response",
  ) as {
    input: Array<Record<string, any>>;
    tools: Array<Record<string, any>>;
    include?: unknown;
    max_output_tokens?: number;
  };
  // Responses caller: input/response shape even for a chat-native model.
  expect(body.max_output_tokens).toBeGreaterThan(0);
  expect(body.include).toBeUndefined();
  expect(body.tools.map((tool) => tool.name)).toEqual(["read"]);
  const types = body.input.map((item) => item.type ?? item.role);
  expect(types).toEqual(["user", "function_call_output", "function_call_output"]);
  expect(body.input[1]!.output).toBe("real-bytes");
  expect(body.input[2]!.output).toBe("same");
});

test("kernel responses body uses the developer title template for title-shaped calls", () => {
  const identity = { session: "ses_aaaaaaaaaaaabbbbbbbbbbbbbb", request: "msg_ccccccccccccdddddddddddddd" };
  const body = buildKernelResponsesBody(
    {
      model: "muse-spark-1.3-contributor-free",
      input: [
        { role: "user", content: [{ type: "input_text", text: "summarize this" }] },
        { role: "system", content: [{ type: "input_text", text: "ignored" }] },
      ],
      output_config: { schema: { type: "object", properties: { title: { type: "string" } } } },
    },
    "muse-spark-1.3-contributor-free",
    identity,
  ) as { input: Array<Record<string, any>>; tools?: unknown };
  expect(body.tools).toBeUndefined();
  expect(body.input[0]!.role).toBe("developer");
  expect(body.input.slice(1).every((item) => item.role === "user")).toBe(true);
});

test("opencode upstream parity: targetFormat/stripOpencodePrefix mirror providerModels", () => {
  expect(resolveOpencodeTargetFormat("opencode", "muse-spark-1.3")).toBe("openai-responses");
  expect(resolveOpencodeTargetFormat("opencode", "muse-spark-1.2-contributor-free")).toBe("openai-responses");
  expect(resolveOpencodeTargetFormat("opencode", "muse-spark-1.3-contributor-xhigh")).toBe("openai-responses");
  expect(resolveOpencodeTargetFormat("opencode", "big-pickle")).toBe("openai");
  expect(resolveOpencodeTargetFormat("opencode", "deepseek-v4-flash-free")).toBe("openai");
  expect(stripOpencodeModelPrefix("opencode/big-pickle")).toBe("big-pickle");
  expect(stripOpencodeModelPrefix("oc/mimo-v2.5-free")).toBe("mimo-v2.5-free");
  expect(stripOpencodeModelPrefix("big-pickle")).toBe("big-pickle");
  expect(parseOpencodeEffortLevel("deepseek-v4-flash-low")).toEqual({ baseModel: "deepseek-v4-flash", effort: "low" });
  expect(parseOpencodeEffortLevel("muse-spark-1.3-contributor-xhigh")).toEqual({ baseModel: "muse-spark-1.3-contributor", effort: "xhigh" });
  expect(parseOpencodeEffortLevel("big-pickle")).toBeNull();
});

test("opencode upstream parity: message assembly order mirrors transformRequest", () => {
  // deepseek json_schema -> json_object + instruction (provider-gated).
  const deepseek = buildOpencodeUpstreamBody(
    { model: "deepseek-v4-flash-free", response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } } },
    "deepseek-v4-flash-free",
    false,
    "opencode",
    "zen",
  ) as Record<string, unknown>;
  expect((deepseek.response_format as { type: string }).type).toBe("json_object");
  // client_metadata dropped; stream_options gated to streaming chat only.
  // Note: gated free-tier models force stream:true via the contract, so
  // stream_options is KEPT there (matches upstream #13699). Use a premium
  // (non-gated) model to assert the non-streaming drop.
  const dropped = buildOpencodeUpstreamBody(
    { model: "gpt-5.6-luna", client_metadata: { a: 1 }, stream_options: { include_usage: true } } as Record<string, unknown>,
    "gpt-5.6-luna",
    false,
    "opencode",
    "zen",
  ) as Record<string, unknown>;
  expect("client_metadata" in dropped).toBe(false);
  expect("stream_options" in dropped).toBe(false);
  // Gated free-tier forces streaming: same payload on big-pickle keeps stream_options.
  const gatedKept = buildOpencodeUpstreamBody(
    { model: "opencode/big-pickle", stream_options: { include_usage: true } } as Record<string, unknown>,
    "big-pickle",
    false,
    "opencode",
    "zen",
  ) as Record<string, unknown>;
  expect(gatedKept.stream).toBe(true);
  expect("stream_options" in gatedKept).toBe(true);
  expect(gatedKept.model).toBe("big-pickle");
  // thinking family gets reasoning_content echo on assistant turns.
  const thinking = buildOpencodeUpstreamBody(
    { model: "deepseek-v4-flash-free", messages: [{ role: "assistant", content: "hi" }] },
    "deepseek-v4-flash-free",
    true,
    "opencode",
    "zen",
  ) as { messages: Array<{ reasoning_content?: string }> };
  expect(thinking.messages[0]?.reasoning_content).toBe(" ");
  // non-thinking family untouched.
  const plain = buildOpencodeUpstreamBody(
    { model: "big-pickle", messages: [{ role: "assistant", content: "hi" }] },
    "big-pickle",
    true,
    "opencode",
    "zen",
  ) as { messages: Array<{ reasoning_content?: string }> };
  expect(plain.messages[0]?.reasoning_content).toBeUndefined();
});

test("opencode upstream parity: background headers use bare opencode UA + canonical ses_/msg_ ids", () => {
  const headers = buildOpencodeBackgroundHeaders({ seed: "conn-1" });
  // Upstream literal is the bare "opencode" default (headers.ts buildOpencodeBackgroundHeaders).
  const ua = headers["User-Agent"] ?? "";
  expect(ua === "opencode" || ua.startsWith("opencode/")).toBe(true);
  expect(headers["x-opencode-client"]).toBe("desktop");
  expect(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(headers["x-opencode-session"] ?? "")).toBe(true);
});

function checkChatPairing(messages: Array<Record<string, any>>): void {
  // Strict chat upstream invariant: every assistant tool_calls id is followed
  // by a tool message with the same id before the tool block ends, and every
  // tool message answers a preceding call.
  const seen = new Set<string>();
  let pending = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      expect(pending.size).toBe(0);
      pending = new Set(message.tool_calls.map((call: any) => String(call?.id ?? "")));
      for (const call of message.tool_calls) seen.add(String(call?.id ?? ""));
    } else if (message.role === "tool") {
      const id = String(message.tool_call_id ?? "");
      expect(pending.has(id)).toBe(true);
      expect(seen.has(id)).toBe(true);
      pending.delete(id);
    } else {
      expect(pending.size).toBe(0);
    }
  }
  expect(pending.size).toBe(0);
}

test("kernel chat body repairs dangling tool_calls (interrupted turn) instead of 400", () => {
  const caller = {
    model: "big-pickle",
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
    messages: [
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "read", arguments: "{}" } },
        ],
      },
      // Only call_1 answered (partial parallel results); call_2 dangles,
      // then the client already moved on — the exact 400 shape upstream rejects.
      { role: "tool", tool_call_id: "call_1", content: "README.md" },
      { role: "user", content: "thanks" },
    ],
  };
  const out = buildKernelChatBody(caller, "big-pickle") as { messages: Array<Record<string, any>> };
  checkChatPairing(out.messages);
  const synthesized = out.messages.filter(
    (message) => message.role === "tool" && message.tool_call_id === "call_2",
  );
  expect(synthesized.length).toBe(1);
  // Original content untouched: real result kept verbatim, synthesis in position.
  expect(out.messages.find((message) => message.tool_call_id === "call_1")?.content).toBe("README.md");
});

test("kernel chat body demotes orphan tool results and strips empty tool_calls", () => {
  const caller = {
    model: "big-pickle",
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
    messages: [
      { role: "tool", tool_call_id: "ghost", content: "stale output" },
      { role: "assistant", content: "done", tool_calls: [] },
      { role: "user", content: "ok" },
    ],
  };
  const repaired = repairKernelChatToolPairing(
    (caller.messages as unknown[]).map((message) => ({ ...message })),
  );
  expect(repaired.orphaned).toBe(1);
  expect(repaired.strippedEmptyCalls).toBe(1);
  expect(repaired.synthesized).toBe(0);
  checkChatPairing(repaired.messages as Array<Record<string, any>>);
  const demoted = (repaired.messages as Array<Record<string, any>>).find(
    (message) => message.role === "user" && message.content === "stale output",
  );
  expect(demoted).toBeTruthy();
});

test("kernel chat body leaves healthy tool rounds untouched", () => {
  const caller = {
    model: "big-pickle",
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
      { role: "assistant", content: "done" },
    ],
  };
  const out = buildKernelChatBody(caller, "big-pickle") as { messages: Array<Record<string, any>> };
  checkChatPairing(out.messages);
  expect(out.messages.length).toBe(4);
});




