import { expect, test } from "bun:test";
import { vendorLogoSlug } from "../../apps/web/src/components/VendorLogo.tsx";

test("maps catalog vendors and model names to local vendor logos", () => {
  expect(vendorLogoSlug("Anthropic")).toBe("anthropic");
  expect(vendorLogoSlug("Google")).toBe("google");
  expect(vendorLogoSlug("gpt-5.4")).toBe("openai");
  expect(vendorLogoSlug("deepseek-v3")).toBe("deepseek");
  expect(vendorLogoSlug("Kimi K2")).toBe("moonshot");
  expect(vendorLogoSlug("MiniMax M2")).toBe("minimax");
  expect(vendorLogoSlug("Qwen3 Coder")).toBe("qwen");
  expect(vendorLogoSlug("unknown vendor")).toBeNull();
});
