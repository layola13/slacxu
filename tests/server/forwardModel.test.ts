import { describe, expect, test } from "bun:test";
import {
  buildForwardModelIds,
  formatForwardModelId,
  ForwardModelError,
  parseForwardModelId,
  splitForwardModelPositional,
  toParseInventory,
  type ForwardModelInventory,
} from "../../apps/server/src/forwardModel.ts";

const INVENTORY: ForwardModelInventory[] = [
  { providerId: "deepkey", groupId: "default", models: ["gpt-5.6-luna", "gpt-5.6-terra"] },
  { providerId: "deepkey", groupId: "codex-team", models: ["gpt-5.6-terra"] },
  { providerId: "jiji", groupId: "default", models: ["gpt-5.6-sol"] },
];

const PARSE = toParseInventory(INVENTORY);

describe("parseForwardModelId (库存 longest-match)", () => {
  test("基本四段解析", () => {
    expect(parseForwardModelId("codex-deepkey-default-gpt-5.6-luna", PARSE)).toEqual({
      cliBackend: "codex",
      providerId: "deepkey",
      groupId: "default",
      model: "gpt-5.6-luna",
    });
  });

  test("group 含横杠 (codex-team) 不被切错", () => {
    expect(parseForwardModelId("opencode-deepkey-codex-team-gpt-5.6-terra", PARSE)).toEqual({
      cliBackend: "opencode",
      providerId: "deepkey",
      groupId: "codex-team",
      model: "gpt-5.6-terra",
    });
  });

  test("model 含斜杠 (opencode provider 风格) 原样保留", () => {
    const inv = toParseInventory([{ providerId: "deepkey", groupId: "codex-team", models: [] }]);
    expect(parseForwardModelId("opencode-deepkey-codex-team-opencode/muse-spark-1.3", inv)).toEqual({
      cliBackend: "opencode",
      providerId: "deepkey",
      groupId: "codex-team",
      model: "opencode/muse-spark-1.3",
    });
  });

  test("未知 cli / provider / group / 缺模型 fail-fast 且信息可读", () => {
    expect(() => parseForwardModelId("bogus-deepkey-default-x", PARSE)).toThrow("未知 cli 后端");
    expect(() => parseForwardModelId("codex-nosuch-default-x", PARSE)).toThrow("未知中转站");
    expect(() => parseForwardModelId("codex-deepkey-nosuch-x", PARSE)).toThrow("未知分组");
    expect(() => parseForwardModelId("codex-deepkey-default", PARSE)).toThrow("缺少模型部分");
    expect(() => parseForwardModelId("nodefault", PARSE)).toThrow("非法");
    expect(() => parseForwardModelId("", PARSE)).toThrow("为空");
  });

  test("本地转发站再转一次直接回环拒绝 (禁无限自调)", () => {
    const inv = toParseInventory([
      ...INVENTORY,
      { providerId: "ultra-forward", groupId: "default", models: ["codex-deepkey-default-gpt-5.6-luna"] },
    ]);
    expect(() => parseForwardModelId("opencode-ultra-forward-default-codex-deepkey-default-gpt-5.6-luna", inv)).toThrow("回环拒绝");
    const failure = (() => {
      try {
        parseForwardModelId("opencode-ultra-forward-default-x", inv);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(ForwardModelError);
    expect((failure as ForwardModelError).code).toBe("loopback");
  });

  test("库存不含 ultra-forward 时同样回环拒绝 (不报未知中转站)", () => {
    expect(() => parseForwardModelId("opencode-ultra-forward-default-x", PARSE)).toThrow("回环拒绝");
  });

  test("无 cli 前缀或嵌套 ultra-forward 均提前回环拒绝", () => {
    expect(() => parseForwardModelId("ultra-forward-default-x", PARSE)).toThrow("回环拒绝");
    expect(() => parseForwardModelId("codex-deepkey-default-opencode-ultra-forward-x", PARSE)).toThrow("回环拒绝");
    const failure = (() => {
      try {
        parseForwardModelId("ultra-forward-default-x", PARSE);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(ForwardModelError);
    expect((failure as ForwardModelError).code).toBe("loopback");
  });
});

describe("format / build round-trip", () => {
  test("format 与 parse 互逆", () => {
    const id = formatForwardModelId({
      cliBackend: "pi",
      providerId: "deepkey",
      groupId: "codex-team",
      model: "gpt-5.6-terra",
    });
    expect(id).toBe("pi-deepkey-codex-team-gpt-5.6-terra");
    expect(parseForwardModelId(id, PARSE).model).toBe("gpt-5.6-terra");
  });

  test("build 笛卡尔展开并去重", () => {
    const ids = buildForwardModelIds(["codex", "opencode"], INVENTORY);
    // 2 cli × (2 + 1 + 1 models) = 8
    expect(ids).toHaveLength(8);
    expect(ids).toContain("codex-deepkey-codex-team-gpt-5.6-terra");
    expect(ids).toContain("opencode-jiji-default-gpt-5.6-sol");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("positional 切分只做提示用", () => {
    expect(splitForwardModelPositional("a-b")).toBeNull();
    expect(splitForwardModelPositional("codex-deepkey-default-gpt-5.6-luna")).toEqual({
      cli: "codex",
      provider: "deepkey",
      group: "default",
      model: "gpt-5.6-luna",
    });
  });
});
