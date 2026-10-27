import { describe, expect, test } from "bun:test";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";
import { normalizeMiniCapabilities } from "../../backends/mini/src/runtime/miniCapabilities.ts";

describe("mini capability bridge", () => {
  test("filters unsafe names, duplicates, and malformed providers", () => {
    const valid = {
      name: "browser.open",
      kind: "browser" as const,
      description: "Open a page",
      schema: { type: "object" },
      invoke: async () => "ok",
    };
    const result = normalizeMiniCapabilities([
      valid,
      valid,
      { ...valid, name: "browser/open" },
      { ...valid, name: "unknown.open" },
      { ...valid, description: "" },
    ]);
    expect(result.map((entry) => entry.name)).toEqual(["browser.open"]);
  });

  test("lists capabilities for a live thread without exposing the resolver", async () => {
    const seen: Array<{ ownerId?: string; turnId: string }> = [];
    const bridge = new MiniBridge({
      allowedMiniCapabilityKinds: ["desktop"],
      resolveMiniCapabilities: ({ threadId, turnId, cwd, ownerId }) => {
        seen.push({ ownerId, turnId });
        return [{
        name: "desktop.screenshot",
        kind: "desktop",
        description: `Capture ${threadId}/${turnId}`,
        schema: { type: "object", properties: { display: { type: "string" } } },
        readOnly: true,
        invoke: async () => ({ cwd }),
        }, {
          name: "browser.open",
          kind: "browser",
          description: "Open a page",
          schema: { type: "object" },
          invoke: async () => "ok",
        }];
      },
    });
    try {
      const started = await bridge.request("thread/start", { cwd: "/tmp", model: "test-model", ownerId: "owner-a" }) as { threadId: string };
      const listed = await bridge.request("mini/capabilities/list", { threadId: started.threadId }) as {
        capabilities: Array<{ name: string; kind: string; readOnly: boolean }>;
      };
      expect(listed.capabilities).toEqual([
        expect.objectContaining({ name: "desktop.screenshot", kind: "desktop", readOnly: true }),
      ]);
      expect(seen).toEqual([{ ownerId: "owner-a", turnId: "capability-list" }]);
      const foreign = await bridge.request("mini/capabilities/list", { threadId: started.threadId, ownerId: "owner-b" }) as { capabilities: unknown[] };
      expect(foreign.capabilities).toEqual([]);
    } finally {
      bridge.stop();
    }
  });
});
