import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

describe("MiniBridge fs/readFile and fs/writeFile", () => {
  test("fs/readFile and fs/writeFile read and write local workspace files", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mini-fs-test-"));
    try {
      const testFile = join(tempDir, "test.txt");
      writeFileSync(testFile, "hello mini fs", "utf8");

      const bridge = new MiniBridge();

      // Test fs/readFile with absolute path
      const readResult = await bridge.request("fs/readFile", { path: testFile, cwd: tempDir }) as { dataBase64: string };
      expect(readResult).toBeDefined();
      expect(Buffer.from(readResult.dataBase64, "base64").toString("utf8")).toBe("hello mini fs");

      // Test fs/readFile with relative path
      const readRelResult = await bridge.request("fs/readFile", { path: "test.txt", cwd: tempDir }) as { dataBase64: string };
      expect(Buffer.from(readRelResult.dataBase64, "base64").toString("utf8")).toBe("hello mini fs");

      // Test fs/writeFile with base64 data
      const newFileRel = "subdir/written.txt";
      const writeData = Buffer.from("saved content", "utf8").toString("base64");
      const writeResult = await bridge.request("fs/writeFile", { path: newFileRel, cwd: tempDir, dataBase64: writeData }) as { ok: boolean };
      expect(writeResult.ok).toBe(true);

      const savedOnDisk = readFileSync(join(tempDir, newFileRel), "utf8");
      expect(savedOnDisk).toBe("saved content");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fs/readFile rejects nonexistent files", async () => {
    const bridge = new MiniBridge();
    await expect(bridge.request("fs/readFile", { path: "nonexistent-file-12345.xyz", cwd: tmpdir() })).rejects.toThrow();
  });
});
