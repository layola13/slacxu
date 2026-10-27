import { expect, test } from "bun:test";
import { parseDynamicToolArguments } from "../../apps/server/src/dynamicToolProtocol";

test("parses Codex JSON-string dynamic-tool arguments", () => {
  expect(parseDynamicToolArguments('{"language":"sla","source":"fn main() -> i32 { return 0; }"}')).toEqual({
    language: "sla",
    source: "fn main() -> i32 { return 0; }"
  });
});

test("accepts object dynamic-tool arguments", () => {
  const value = { language: "sla", source: "fn main() -> i32 { return 0; }" };
  expect(parseDynamicToolArguments(value)).toBe(value);
});

test("rejects malformed, primitive, and array arguments", () => {
  expect(parseDynamicToolArguments("not-json")).toEqual({});
  expect(parseDynamicToolArguments("null")).toEqual({});
  expect(parseDynamicToolArguments("[]")).toEqual({});
  expect(parseDynamicToolArguments(42)).toEqual({});
  expect(parseDynamicToolArguments(null)).toEqual({});
});
