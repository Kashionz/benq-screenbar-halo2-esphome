import { describe, expect, it } from "vitest";
import { MESSAGES, resolveLocale } from "./i18n";

/** Every nested key, so a message added to one language cannot be missing from the other. */
const keys = (value: object, prefix = ""): string[] =>
  Object.entries(value).flatMap(([key, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${key}.`) : [`${prefix}${key}`],
  );

describe("i18n", () => {
  it("resolves the system language, with any Chinese mapped to Traditional Chinese", () => {
    expect(resolveLocale("system", ["zh-TW"])).toBe("zh-TW");
    expect(resolveLocale("system", ["zh-CN", "en"])).toBe("zh-TW");
    expect(resolveLocale("system", ["en-US", "zh-TW"])).toBe("en");
    expect(resolveLocale("system", ["ja-JP"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
    expect(resolveLocale("zh-TW", ["en-US"])).toBe("zh-TW");
    expect(resolveLocale("en", ["zh-TW"])).toBe("en");
  });
  it("keeps both languages in step", () => {
    expect(keys(MESSAGES.en).sort()).toEqual(keys(MESSAGES["zh-TW"]).sort());
  });
  it("keeps the native Chinese fault text but translates it in English by code", () => {
    const fault = { code: "NETWORK", message: "回應中斷。" };
    expect(MESSAGES["zh-TW"].fault(fault)).toBe("回應中斷。");
    expect(MESSAGES.en.fault(fault)).toMatch(/^Could not connect/);
    // A device error code the App does not know still gets English text.
    expect(MESSAGES.en.fault({ code: "SOMETHING_NEW", message: "裝置拒絕操作" })).toMatch(/^The device refused/);
  });
});
