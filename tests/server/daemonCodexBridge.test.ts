import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { expect, test } from "bun:test";
import { resolveVirtualCodexConfigPath } from "../../backends/codex/src/runtime/virtualCodexConfig.ts";

test("resolves the virtual config.toml under Codex Ultra data", () => {
  expect(
    resolveVirtualCodexConfigPath(
      { CODEX_UI_DATA_DIR: "D:\\codex-ultra-data", CODEX_HOME: "C:\\Users\\zhan\\.codex" },
      "C:\\Users\\zhan"
    )
  ).toBe("D:\\codex-ultra-data\\virtual-codex\\config.toml");
});

test("does not derive the virtual config path from CODEX_HOME", () => {
  expect(
    resolveVirtualCodexConfigPath(
      { CODEX_HOME: "D:\\codex-home" },
      "C:\\Users\\zhan"
    )
  ).toBe("C:\\Users\\zhan\\.codex-ultra\\virtual-codex\\config.toml");
});
