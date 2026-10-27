import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the probes under test
import { describe, expect, test } from "bun:test";
import {
  buildAgySpawnArgs,
  buildSafeAgyEnv,
  findAgyBin,
  isAgyLoggedIn
} from "../../backends/agy/src/runtime/agyCompatibleProbe";

describe("agyCompatibleProbe", () => {
  test("buildAgySpawnArgs generates correct stream-json and flag combinations", () => {
    const defaultArgs = buildAgySpawnArgs();
    expect(defaultArgs).not.toContain("--print");
    expect(defaultArgs).toContain("--input-format=stream-json");
    expect(defaultArgs).toContain("--output-format=stream-json");
    expect(defaultArgs).toContain("--dangerously-skip-permissions");

    const customArgs = buildAgySpawnArgs({
      conversationId: "conv-123",
      model: "gemini-2.5-pro",
      effort: "high",
      mode: "plan",
      dangerouslySkipPermissions: false
    });

    expect(customArgs).toContain("--conversation");
    expect(customArgs).toContain("conv-123");
    expect(customArgs).toContain("--model");
    expect(customArgs).toContain("gemini-2.5-pro");
    expect(customArgs).toContain("--effort");
    expect(customArgs).toContain("high");
    expect(customArgs).toContain("--mode");
    expect(customArgs).toContain("plan");
    expect(customArgs).not.toContain("--dangerously-skip-permissions");
  });

  test("buildSafeAgyEnv injects CI and FORCE_COLOR=0", () => {
    const env = buildSafeAgyEnv({ CUSTOM_VAR: "test" }, { BASE_VAR: "base" });
    expect(env.CUSTOM_VAR).toBe("test");
    expect(env.BASE_VAR).toBe("base");
    expect(env.CI).toBe("1");
    expect(env.FORCE_COLOR).toBe("0");
  });

  test("findAgyBin respects env override AGY_BIN", () => {
    const bin = findAgyBin({ AGY_BIN: "C:\\non-existent\\custom-agy.exe" } as NodeJS.ProcessEnv);
    // When path does not exist on disk, falls back gracefully
    expect(typeof bin).toBe("string");
    expect(bin.length).toBeGreaterThan(0);
  });

  test("isAgyLoggedIn returns false when user home has no credentials", () => {
    const loggedIn = isAgyLoggedIn({ USERPROFILE: "C:\\non-existent-dir-for-test-xyz" });
    expect(loggedIn).toBe(false);
  });

  test("buildAgySpawnArgs generates --add-dir flags for workspace directories", () => {
    const args = buildAgySpawnArgs({
      cwd: "D:\\projects\\codex-ultra",
      addDirs: ["D:\\projects\\codex-ultra", "D:\\projects\\extra-root"]
    });
    expect(args).toContain("--add-dir");
    expect(args).toContain("D:\\projects\\codex-ultra");
    expect(args).toContain("D:\\projects\\extra-root");
    // Verify no duplicates
    const addDirCount = args.filter((arg, idx) => args[idx - 1] === "--add-dir" && arg === "D:\\projects\\codex-ultra").length;
    expect(addDirCount).toBe(1);
  });

  test("buildAgySpawnArgs avoids conflicting --effort flag when model already has effort suffix", () => {
    // When model contains -high / -medium / -low, --effort MUST NOT be appended
    const argsWithSuffix = buildAgySpawnArgs({
      model: "gemini-3.8-flash-high",
      effort: "low"
    });
    expect(argsWithSuffix).toContain("--model");
    expect(argsWithSuffix).toContain("gemini-3.8-flash-high");
    expect(argsWithSuffix).not.toContain("--effort");

    // When Gemini model does NOT contain effort suffix, --effort should be passed
    const argsWithoutSuffix = buildAgySpawnArgs({
      model: "gemini-2.5-pro",
      effort: "high"
    });
    expect(argsWithoutSuffix).toContain("--model");
    expect(argsWithoutSuffix).toContain("gemini-2.5-pro");
    expect(argsWithoutSuffix).toContain("--effort");
    expect(argsWithoutSuffix).toContain("high");

    // When model is non-Gemini (e.g. Claude), --effort MUST NOT be passed because AGY CLI rejects it
    const nonGeminiArgs = buildAgySpawnArgs({
      model: "claude-sonnet-4-6",
      effort: "high"
    });
    expect(nonGeminiArgs).toContain("--model");
    expect(nonGeminiArgs).toContain("claude-sonnet-4-6");
    expect(nonGeminiArgs).not.toContain("--effort");
  });
});
