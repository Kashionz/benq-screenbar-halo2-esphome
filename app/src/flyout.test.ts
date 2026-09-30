import { describe, expect, it } from "vitest";
import { parseIntent, parseState, trayLine, type FlyoutState } from "./flyout";
import { MESSAGES } from "./i18n";

const zh = MESSAGES["zh-TW"];

const base: FlyoutState = {
  connected: true,
  online: true,
  lock: null,
  desired: null,
  values: null,
  adjusting: [],
  sending: false,
  features: {},
  status: null,
  updated: "21:14:08",
  theme: "light",
  locale: "zh-TW",
};

describe("parseIntent", () => {
  it("accepts only well-formed explicit intents", () => {
    expect(parseIntent({ id: "a", kind: "power", value: false })).toEqual({ id: "a", kind: "power", value: false });
    expect(parseIntent({ id: "a", kind: "adjust", patch: { mode: "both", temperature_k: 4025 } })).toEqual({
      id: "a",
      kind: "adjust",
      patch: { mode: "both", temperature_k: 4025 },
    });
    expect(parseIntent({ id: "a", kind: "sync" })).toEqual({ id: "a", kind: "sync" });
  });
  it("rejects toggles, power inside a patch, bad values and unknown fields", () => {
    for (const payload of [
      null,
      "power",
      { kind: "power", value: true },
      { id: "a", kind: "toggle" },
      { id: "a", kind: "power", value: "on" },
      { id: "a", kind: "apply", patch: { front_brightness: 40 } },
      { id: "a", kind: "adjust", patch: {} },
      { id: "a", kind: "adjust", patch: { power: true } },
      { id: "a", kind: "adjust", patch: { front_brightness: 0 } },
      { id: "a", kind: "adjust", patch: { back_brightness: 50.5 } },
      { id: "a", kind: "adjust", patch: { temperature_k: 4010 } },
      { id: "a", kind: "adjust", patch: { mode: "side" } },
      { id: "a".repeat(65), kind: "sync" },
    ])
      expect(parseIntent(payload)).toBeNull();
  });
});

describe("parseState", () => {
  it("accepts the published view and drops anything else", () => {
    expect(parseState(base)).toBe(base);
    expect(parseState(null)).toBeNull();
    expect(parseState({ connected: "yes", updated: "" })).toBeNull();
    expect(parseState({ connected: true })).toBeNull();
  });
});

describe("trayLine", () => {
  it("hints the next explicit action while ready", () => {
    expect(trayLine(zh, base, "關燈")).toEqual({ tone: "idle", body: "按一下關燈", lookup: false });
  });
  it("covers disconnected, offline, radio and command states", () => {
    expect(trayLine(zh, null, "開燈")).toMatchObject({ body: "未連線" });
    expect(trayLine(zh, { ...base, connected: false }, "開燈")).toMatchObject({ body: "未連線" });
    expect(trayLine(zh, { ...base, lock: "offline" }, "關燈")).toMatchObject({ tone: "warn", title: "已斷線" });
    expect(trayLine(zh, { ...base, lock: "radio" }, "關燈")).toMatchObject({ title: "無線模組未就緒" });
    expect(
      trayLine(zh, 
        { ...base, lock: "unknown", status: { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: true } },
        "關燈",
      ),
    ).toEqual({ tone: "warn", title: "結果不明", body: "，請先查詢", lookup: true });
    expect(
      trayLine(zh, { ...base, status: { tone: "busy", title: "處理中", body: "正在送出「關燈」", lookup: false } }, "關燈"),
    ).toMatchObject({ tone: "busy", title: "處理中", body: " · 正在送出「關燈」" });
    expect(
      trayLine(zh, { ...base, status: { tone: "ok", title: "指令已送出", body: "", lookup: false } }, "關燈"),
    ).toMatchObject({ title: "指令已送出", body: "" });
  });
});
