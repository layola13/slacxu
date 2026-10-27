import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  findOpencodeBin,
  parseOpencodeModelsOutput,
  probeOpencodeCliCommand,
  isOpencodeFreeModel,
  filterOpencodeFreeModels,
  compareOpencodeVersion,
  isOpencodeVersionSupported,
  OPENCODE_MIN_SUPPORTED_VERSION,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProbe.js";

describe("opencodeCompatibleProbe", () => {
  test("findOpencodeBin respects OPENCODE_BIN env override", () => {
    const custom = "C:\\Tools\\opencode.exe";
    const bin = findOpencodeBin({ OPENCODE_BIN: custom });
    expect(bin).toBe(custom);
  });

  test("findOpencodeBin finds candidate from PATH ahead of non-executable script", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "opencode-bin-test-"));
    try {
      const shimName = process.platform === "win32" ? "opencode.cmd" : "opencode";
      const shimPath = path.join(tempDir, shimName);
      writeFileSync(shimPath, process.platform === "win32" ? "@echo off\r\necho 1.18.30\r\n" : "#!/bin/sh\necho 1.18.30\n");
      if (process.platform !== "win32") {
        chmodSync(shimPath, 0o755);
      }
      const bin = findOpencodeBin({
        PATH: tempDir,
        PATHEXT: ".CMD;.EXE;.BAT",
        USERPROFILE: "",
        HOME: "",
      });
      expect(bin).toBe(shimPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("parseOpencodeModelsOutput filters noise lines and deduplicates", () => {
    const sampleOutput = `
[claude-mem] OpenCode plugin loading (project: opencode)
opencode/big-pickle
opencode/ling-3.0-flash-fin-free
opencode/big-pickle
some invalid line without slash
myapi/claude-sonnet-4.6
`;
    const models = parseOpencodeModelsOutput(sampleOutput);
    expect(models).toEqual([
      "opencode/big-pickle",
      "opencode/ling-3.0-flash-fin-free",
      "myapi/claude-sonnet-4.6",
    ]);
  });

  test("probeOpencodeCliCommand handles nonexistent binary gracefully", () => {
    const res = probeOpencodeCliCommand("nonexistent_binary_xyz_123");
    expect(res.available).toBe(false);
    expect(res.binPath).toBe("nonexistent_binary_xyz_123");
    expect(res.error).toBeDefined();
  });

  test("compareOpencodeVersion orders semver numerically", () => {
    expect(compareOpencodeVersion("1.18.32", "1.0.0")).toBe(1);
    expect(compareOpencodeVersion("0.9.9", OPENCODE_MIN_SUPPORTED_VERSION)).toBe(-1);
    expect(compareOpencodeVersion("1.18.18", "1.18.18")).toBe(0);
    expect(compareOpencodeVersion("1.9", "1.10")).toBe(-1);
  });

  test("isOpencodeVersionSupported gates the floor, unknown passes", () => {
    expect(isOpencodeVersionSupported("1.18.32")).toBe(true);
    expect(isOpencodeVersionSupported("0.1.0")).toBe(false);
    expect(isOpencodeVersionSupported(undefined)).toBe(true);
    expect(isOpencodeVersionSupported("")).toBe(true);
  });

  test("isOpencodeFreeModel and filterOpencodeFreeModels identify local free models", () => {
    const models = [
      "opencode/big-pickle",
      "opencode/ling-3.0-flash-fin-free",
      "opencode/mimo-v2.5-free",
      "opencode/nemotron-3.5-lightning-free",
      "opencode-go/deepseek-v4-flash",
      "opencode-go/qwen3.6-plus",
      "myapi/claude-sonnet-4.6"
    ];
    expect(filterOpencodeFreeModels(models)).toEqual([
      "opencode/big-pickle",
      "opencode/ling-3.0-flash-fin-free",
      "opencode/mimo-v2.5-free",
      "opencode/nemotron-3.5-lightning-free"
    ]);

    expect(isOpencodeFreeModel("opencode/big-pickle")).toBe(true);
    expect(isOpencodeFreeModel("big-pickle")).toBe(true);
    expect(isOpencodeFreeModel("mimo-v2.6-flash-free")).toBe(true);
    expect(isOpencodeFreeModel("opencode/mimo-v2.6-flash-free")).toBe(true);
    expect(isOpencodeFreeModel("opencode-go/qwen3.6-plus")).toBe(false);
    expect(isOpencodeFreeModel("paid-model", { cost: { input: 0, output: 0 } })).toBe(true);
    expect(isOpencodeFreeModel("paid-model", { cost: { input: 0.1, output: 0.2 } })).toBe(false);
  });
});
