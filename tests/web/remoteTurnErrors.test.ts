import { expect, test } from "bun:test";
import { classifyRemoteTurnError } from "../../apps/web/src/remoteTurnErrors";

test("classifies truncated remote tool argument streams", () => {
  expect(classifyRemoteTurnError(
    "stream disconnected before completion: function_call arguments JSON parse error: unexpected end of data"
  )).toBe("incompleteToolArguments");
  expect(classifyRemoteTurnError("Remote model stream ended before tool arguments were complete (call_1, 1052 chars)")).toBe("incompleteToolArguments");
});

test("distinguishes relay credential rejection from UI session expiry", () => {
  expect(classifyRemoteTurnError("[401] Unauthorized")).toBe("relayUnauthorized");
  expect(classifyRemoteTurnError("Unauthorized relay gateway request")).toBe("relayUnauthorized");
  expect(classifyRemoteTurnError("CUX-AUTH-001 session expired")).toBeNull();
});

test("classifies revoked OpenAI refresh tokens as officialRefreshRevoked", () => {
  expect(classifyRemoteTurnError("Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.")).toBe("officialRefreshRevoked");
  expect(classifyRemoteTurnError("OpenAI refresh token was revoked")).toBe("officialRefreshRevoked");
});

test("classifies OpenCode free tier client restriction as opencodeClientRestricted", () => {
  expect(classifyRemoteTurnError('{"type":"error","error":{"type":"MissingSessionID","message":"Error from provider (Console): OpenCode\'s free tier can only be used in OpenCode"}}')).toBe("opencodeClientRestricted");
  expect(classifyRemoteTurnError("Error from provider (Console): OpenCode's free tier can only be used in OpenCode")).toBe("opencodeClientRestricted");
  expect(classifyRemoteTurnError("MissingSessionID error from opencode backend")).toBe("opencodeClientRestricted");
});
