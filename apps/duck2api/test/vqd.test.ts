import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { generateVQDHash, goSha256Base64 } from "../src/duckgo/vqd.js";

const sha = (s: string) => createHash("sha256").update(s).digest("base64");

describe("generateVQDHash", () => {
  test("hashes client_hashes and merges meta (client_hashes[0] stamped with UA)", async () => {
    const challenge = `({client_hashes: ["abc", "def"], meta: {v: 1}})`;
    const out = await generateVQDHash(Buffer.from(challenge, "utf8").toString("base64"));
    const payload = JSON.parse(Buffer.from(out, "base64").toString("utf8")) as {
      client_hashes: string[];
      meta: Record<string, unknown>;
    };
    expect(Object.keys(payload).sort()).toEqual(["client_hashes", "meta"]);
    // OmniRoute parity: solver stamps real UA into [0] before hashing.
    const ua =
      process.env["X_USER_AGENT"] ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
    expect(payload.client_hashes[0]).toBe(sha(ua));
    expect(payload.client_hashes[1]).toBe(sha("def"));
    expect(payload.meta["origin"]).toBe("https://duck.ai");
    expect(String(payload.meta["stack"]).startsWith("Error")).toBe(true);
    expect(payload.meta["v"]).toBe(1);
  });

  test("broken challenge falls back to btoa format", async () => {
    const bad = await generateVQDHash(Buffer.from("!!!not js!!!", "utf8").toString("base64"));
    const text = Buffer.from(bad, "base64").toString("utf8");
    expect(text.startsWith("!!!not js!!!::")).toBe(true);
    expect(text.endsWith("::https://duck.ai")).toBe(true);
  });

  test("goSha256Base64 matches node crypto", () => {
    expect(goSha256Base64("x")).toBe(sha("x"));
  });
});
