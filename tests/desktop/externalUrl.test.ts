import { expect, test } from "bun:test";

const { allowedExternalUrl } = require("../../desktop/external-url.cjs") as {
  allowedExternalUrl(value: unknown): string | null;
};

test("allows official HTTPS links used by the desktop UI", () => {
  expect(allowedExternalUrl("https://codex-ultra.top")).toBe("https://codex-ultra.top/");
  expect(allowedExternalUrl("https://discord.gg/QCNUx8FaV")).toBe("https://discord.gg/QCNUx8FaV");
  expect(allowedExternalUrl("https://github.com/layola13/codex-ultra")).toBe("https://github.com/layola13/codex-ultra");
  expect(allowedExternalUrl("https://chatgpt.com/auth/login?next=%2Fcodex")).not.toBeNull();
  expect(allowedExternalUrl("https://claude.ai/install.ps1")).not.toBeNull();
  expect(allowedExternalUrl("https://drive.google.com/file/d/example/view")).not.toBeNull();
});

test("rejects unsafe protocols and lookalike hosts", () => {
  expect(allowedExternalUrl("http://github.com/layola13/codex-ultra")).toBeNull();
  expect(allowedExternalUrl("https://github.com.evil.example/repository")).toBeNull();
  expect(allowedExternalUrl("javascript:alert(1)")).toBeNull();
  expect(allowedExternalUrl("not a url")).toBeNull();
});
