import { expect, test } from "bun:test";
import { normalizeLocalPreviewTarget } from "../../apps/server/src/webdevProbe.ts";

test("normalizes local preview URLs", () => {
  expect(normalizeLocalPreviewTarget("localhost:5173").toString()).toBe("http://localhost:5173/");
  expect(normalizeLocalPreviewTarget("http://127.0.0.1:3000/app").toString()).toBe("http://127.0.0.1:3000/app");
  expect(normalizeLocalPreviewTarget("http://[::1]:4173").toString()).toBe("http://[::1]:4173/");
});

test("rejects non-local preview probe targets", () => {
  expect(() => normalizeLocalPreviewTarget("https://example.com")).toThrow("localhost");
  expect(() => normalizeLocalPreviewTarget("http://0.0.0.0:5173")).toThrow("localhost");
  expect(() => normalizeLocalPreviewTarget("file:///tmp/index.html")).toThrow("http or https");
});

test("rejects preview URLs with credentials", () => {
  expect(() => normalizeLocalPreviewTarget("http://user:pass@localhost:5173")).toThrow("credentials");
});
