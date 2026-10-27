import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgyLineCapture,
  dumpAgyCapture,
  resolveAgyCaptureDir,
  sanitizeAgyCaptureName,
  shouldDumpAgyCapture,
} from "../../backends/agy/src/runtime/agyRawCapture";

describe("agyRawCapture", () => {
  test("ring keeps the most recent lines within cap", () => {
    const capture = createAgyLineCapture(3);
    capture.push("a");
    capture.push("b");
    capture.push("c");
    capture.push("d");
    expect(capture.size()).toBe(3);
    expect(capture.lines()).toEqual(["b", "c", "d"]);
  });

  test("clear resets the buffer", () => {
    const capture = createAgyLineCapture(10);
    capture.push("x");
    capture.clear();
    expect(capture.size()).toBe(0);
    expect(capture.lines()).toEqual([]);
  });

  test("dumping is gated by AGY_DEBUG_CAPTURE", () => {
    expect(shouldDumpAgyCapture({} as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldDumpAgyCapture({ AGY_DEBUG_CAPTURE: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldDumpAgyCapture({ AGY_DEBUG_CAPTURE: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  test("capture dir defaults to tmp and honors override", () => {
    expect(resolveAgyCaptureDir({} as NodeJS.ProcessEnv)).toBe(join(tmpdir(), "agy-captures"));
    expect(resolveAgyCaptureDir({ AGY_CAPTURE_DIR: "D:/tmp/cap" } as NodeJS.ProcessEnv)).toBe("D:/tmp/cap");
  });

  test("sanitizes file names", () => {
    expect(sanitizeAgyCaptureName("thread-1:turn/2")).toBe("thread-1_turn_2");
    expect(sanitizeAgyCaptureName("")).toBe("unknown");
  });

  test("dumps jsonl file with all captured lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agy-cap-"));
    try {
      const file = await dumpAgyCapture("thread-1", "turn-9", ["{\"event\":\"init\"}", "not-json"], {
        AGY_CAPTURE_DIR: dir,
      } as NodeJS.ProcessEnv);
      expect(file).toBe(join(dir, "thread-1-turn-9.jsonl"));
      const body = await readFile(file!, "utf8");
      expect(body.split("\n").filter(Boolean)).toHaveLength(2);
      expect(JSON.parse(body.split("\n")[0])).toEqual({ line: "{\"event\":\"init\"}" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dump failure returns null instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agy-cap-fail-"));
    try {
      const blocker = join(dir, "blocker");
      await Bun.write(blocker, "x");
      const file = await dumpAgyCapture("t", "u", ["x"], {
        AGY_CAPTURE_DIR: join(blocker, "sub"),
      } as NodeJS.ProcessEnv);
      expect(file).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
