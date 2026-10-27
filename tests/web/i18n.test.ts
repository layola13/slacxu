import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { localeOptions } from "../../apps/web/src/i18n";
import cnTranslations from "../../apps/web/src/locales/cn.json";
import tcTranslations from "../../apps/web/src/locales/tc.json";

describe("i18n multi-language support", () => {
  test("localeOptions includes Traditional Chinese and Simplified Chinese", () => {
    const zhOption = localeOptions.find((opt) => opt.value === "zh");
    const zhTwOption = localeOptions.find((opt) => opt.value === "zh-TW");

    expect(zhOption).toBeDefined();
    expect(zhOption?.label).toBe("简体中文");

    expect(zhTwOption).toBeDefined();
    expect(zhTwOption?.label).toBe("繁體中文");
  });

  test("tc.json exists and contains full translations matching cn.json keys", () => {
    const tcPath = join(import.meta.dir, "../../apps/web/src/locales/tc.json");
    expect(existsSync(tcPath)).toBe(true);

    const cnKeys = Object.keys(cnTranslations);
    const tcKeys = Object.keys(tcTranslations);

    expect(tcKeys.length).toBe(cnKeys.length);
    for (const key of cnKeys) {
      expect(key in tcTranslations).toBe(true);
    }
  });

  test("Traditional Chinese translations correctly convert vocabulary and characters", () => {
    const tc = tcTranslations as Record<string, string>;
    const cn = cnTranslations as Record<string, string>;

    expect(tc["app.language"]).toBe("語言");
    expect(cn["app.language"]).toBe("语言");

    expect(tc["composer.send"]).toBe("發送");
    expect(cn["composer.send"]).toBe("发送");

    expect(tc["vm.tools.readTitle"]).toBe("取代系統讀工具 (Replace System Read Tools)");
    expect(cn["vm.tools.readTitle"]).toBe("替换系统读工具 (Replace System Read Tools)");
  });

  test("Interpolation placeholders match between cn and tc", () => {
    const tc = tcTranslations as Record<string, string>;
    const cn = cnTranslations as Record<string, string>;

    for (const [key, cnVal] of Object.entries(cn)) {
      if (typeof cnVal === "string") {
        const cnMatches = Array.from(cnVal.matchAll(/\{([a-zA-Z0-9_-]+)\}/g), (m) => m[1]);
        const tcMatches = Array.from((tc[key] ?? "").matchAll(/\{([a-zA-Z0-9_-]+)\}/g), (m) => m[1]);
        expect(tcMatches).toEqual(cnMatches);
      }
    }
  });
});
