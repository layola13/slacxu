import { expect, test } from "bun:test";
import { migrateLegacyBrowserStorage } from "../../apps/web/src/storageNamespace.ts";

test("copies legacy browser cache keys into the codex-ultra namespace", () => {
  const values = new Map<string, string>([
    ["codex-react-ui.locale", "zh"],
    ["codex-react-ui.thread-runtime-selections", "{\"thread\":{}}"],
    ["unrelated", "keep"]
  ]);
  const storage = {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); }
  } satisfies Storage;

  migrateLegacyBrowserStorage(storage);

  expect(values.get("codex-ultra.locale")).toBe("zh");
  expect(values.get("codex-ultra.thread-runtime-selections")).toBe("{\"thread\":{}}");
  expect(values.get("unrelated")).toBe("keep");
});
