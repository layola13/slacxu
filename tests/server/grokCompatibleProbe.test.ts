import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the probes under test
import { describe, expect, test } from "bun:test";
import {
  buildGrokSpawnArgs,
  buildSafeGrokEnv,
  findGrokBin,
  isGrokLoggedIn
} from "../../backends/grok/src/runtime/grokCompatibleProbe";

describe("grokCompatibleProbe", () => {
  test("buildGrokSpawnArgs generates correct streaming-json and flag combinations", () => {
    const defaultArgs = buildGrokSpawnArgs({ prompt: "hello" });
    expect(defaultArgs).toContain("-p");
    expect(defaultArgs).toContain("hello");
    expect(defaultArgs).toContain("--output-format");
    expect(defaultArgs).toContain("streaming-json");
    expect(defaultArgs).toContain("--permission-mode");
    expect(defaultArgs).toContain("bypassPermissions");
    expect(defaultArgs).not.toContain("--always-approve");

    const customArgs = buildGrokSpawnArgs({
      prompt: "analyze plan",
      sessionId: "01a075cf-1234-5678",
      model: "grok-4.6",
      effort: "high",
      mode: "plan",
      cwd: "/repo/test"
    });

    expect(customArgs).toContain("-p");
    expect(customArgs).toContain("analyze plan");
    expect(customArgs).toContain("--resume");
    expect(customArgs).toContain("01a075cf-1234-5678");
    expect(customArgs).toContain("-m");
    expect(customArgs).toContain("grok-4.6");
    expect(customArgs).toContain("--reasoning-effort");
    expect(customArgs).toContain("high");
    expect(customArgs).toContain("--permission-mode");
    expect(customArgs).toContain("plan");
    expect(customArgs).toContain("--cwd");
    expect(customArgs).toContain("/repo/test");
  });

  test("buildSafeGrokEnv injects CI and FORCE_COLOR=0", () => {
    const env = buildSafeGrokEnv({ CUSTOM_VAR: "test" }, { BASE_VAR: "base" });
    expect(env.CUSTOM_VAR).toBe("test");
    expect(env.BASE_VAR).toBe("base");
    expect(env.CI).toBe("1");
    expect(env.FORCE_COLOR).toBe("0");
  });

  test("findGrokBin respects env override GROK_BIN", () => {
    const bin = findGrokBin({ GROK_BIN: "C:\\non-existent\\custom-grok.exe" } as NodeJS.ProcessEnv);
    expect(typeof bin).toBe("string");
    expect(bin.length).toBeGreaterThan(0);
  });

  test("isGrokLoggedIn returns false when user home has no auth.json", () => {
    const loggedIn = isGrokLoggedIn({ USERPROFILE: "C:\\non-existent-dir-for-test-xyz" });
    expect(loggedIn).toBe(false);
  });
});
