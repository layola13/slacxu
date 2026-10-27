import { test, expect } from "bun:test";
import {
  findBestFreebuffFallback,
  getFreebuffSessionStatus,
  type FreebuffSessionStatus
} from "../../backends/relay-config/src/relay/freebuffSession.js";
import {
  fetchClineBalance
} from "../../backends/relay-config/src/relay/omniRouteFree.js";

test("findBestFreebuffFallback: falls back from expensive to cheaper available model", () => {
  const status: FreebuffSessionStatus = {
    configured: true,
    active: true,
    freebucks: {
      balance: 10,
      prices: {
        "deepseek/deepseek-v4-flash": 25,
        "openai/gpt-5.6-luna": 20,
        "mimo/mimo-v2.5": 10,
        "z-ai/glm-5.3-flash": 5,
        "upstage/solar-pro4": 0
      }
    }
  };

  // Current model is DeepSeek (25 FB), user only has 10 FB
  const fallback = findBestFreebuffFallback("deepseek/deepseek-v4-flash", status);
  expect(fallback).not.toBeNull();
  expect(fallback?.id).toBe("mimo/mimo-v2.5");
  expect(fallback?.price).toBe(10);
});

test("findBestFreebuffFallback: falls back to Solar Pro 4 (0 FB) when balance is 0", () => {
  const status: FreebuffSessionStatus = {
    configured: true,
    active: true,
    freebucks: {
      balance: 0,
      prices: {
        "deepseek/deepseek-v4-flash": 25,
        "openai/gpt-5.6-luna": 20,
        "mimo/mimo-v2.5": 10,
        "z-ai/glm-5.3-flash": 5,
        "upstage/solar-pro4": 0
      }
    }
  };

  const fallback = findBestFreebuffFallback("openai/gpt-5.6-luna", status);
  expect(fallback).not.toBeNull();
  expect(fallback?.id).toBe("upstage/solar-pro-4");
  expect(fallback?.price).toBe(0);
});

test("findBestFreebuffFallback: never upgrades to a more expensive model", () => {
  const status: FreebuffSessionStatus = {
    configured: true,
    active: true,
    freebucks: {
      balance: 100, // Rich in balance
      prices: {
        "deepseek/deepseek-v4-flash": 25,
        "openai/gpt-5.6-luna": 20,
        "mimo/mimo-v2.5": 10,
        "z-ai/glm-5.3-flash": 5,
        "upstage/solar-pro4": 0
      }
    }
  };

  // Current model is GLM (5 FB). Even with 100 FB, it must NOT upgrade to Luna (20) or DeepSeek (25)!
  const fallback = findBestFreebuffFallback("z-ai/glm-5.3-flash", status);
  expect(fallback).not.toBeNull();
  expect(fallback?.price).toBeLessThanOrEqual(5);
  expect(fallback?.id).toBe("upstage/solar-pro-4");
});

test("findBestFreebuffFallback: skips models that have hit their rate limit", () => {
  const status: FreebuffSessionStatus = {
    configured: true,
    active: true,
    freebucks: {
      balance: 20,
      prices: {
        "deepseek/deepseek-v4-flash": 25,
        "openai/gpt-5.6-luna": 20,
        "mimo/mimo-v2.5": 10,
        "z-ai/glm-5.3-flash": 5,
        "upstage/solar-pro4": 0
      }
    },
    rateLimitsByModel: {
      // Luna is exhausted
      "openai/gpt-5.6-luna": {
        limit: 5,
        recentCount: 5
      }
    }
  };

  // From DeepSeek (25), Luna (20) would normally be candidate 1, but it's rate-limited
  const fallback = findBestFreebuffFallback("deepseek/deepseek-v4-flash", status);
  expect(fallback).not.toBeNull();
  expect(fallback?.id).toBe("mimo/mimo-v2.5");
  expect(fallback?.price).toBe(10);
});

test("getFreebuffSessionStatus: extracts freebucks and rate limits from upstream", async () => {
  const fetchImpl = (async () => {
    return Response.json({
      status: "active",
      instanceId: "inst_test_123",
      model: "z-ai/glm-5.3-flash",
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
      freebucks: {
        balance: 15,
        daily: { limit: 25, spent: 10, remaining: 15 },
        prices: { "z-ai/glm-5.3-flash": 5, "openai/gpt-5.6-luna": 20 }
      },
      rateLimitsByModel: {
        "deepseek/deepseek-v4-flash": { limit: 6, recentCount: 1 }
      }
    });
  }) as typeof fetch;

  const result = await getFreebuffSessionStatus({ fetchImpl });
  expect(result.active).toBe(true);
  expect(result.freebucks?.balance).toBe(15);
  expect(result.freebucks?.prices?.["z-ai/glm-5.3-flash"]).toBe(5);
  expect(result.rateLimitsByModel?.["deepseek/deepseek-v4-flash"]?.limit).toBe(6);
});

test("fetchClineBalance: converts microcredits to formatted credits and currency", async () => {
  const fetchImpl = (async (input) => {
    const url = String(input);
    if (url.includes("/users/me")) {
      return Response.json({
        data: { id: "usr-test-456", email: "test@cline.bot", displayName: "Tester" },
        success: true
      });
    }
    if (url.includes("/balance")) {
      return Response.json({
        data: { userId: "usr-test-456", balance: 500000 }, // 500000 microcredits = 50.00 credits
        success: true
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const result = await fetchClineBalance({ forceRefresh: true, fetchImpl });
  if (result.configured) {
    expect(result.userId).toBe("usr-test-456");
    expect(result.credits).toBe(50);
    expect(result.formattedBalance).toBe("$50.00");
  }
});
