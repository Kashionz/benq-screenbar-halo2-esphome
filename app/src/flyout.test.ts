import { describe, expect, it } from "vitest";
import { flyoutStatus, parseIntent, type FlyoutState } from "./flyout";

const base: FlyoutState = {
  connected: true,
  online: true,
  badge: { tone: "ok", text: "已連線" },
  lock: null,
  desired: null,
  features: {},
  feedback: { tone: "idle", title: "就緒", body: "", lookup: false },
  updated: "21:14:08",
};

describe("parseIntent", () => {
  it("accepts only well-formed explicit intents", () => {
    expect(parseIntent({ id: "a", kind: "power", value: false })).toEqual({ id: "a", kind: "power", value: false });
    expect(parseIntent({ id: "a", kind: "apply", patch: { mode: "both", temperature_k: 4025 } })).toEqual({
      id: "a",
      kind: "apply",
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
      { id: "a", kind: "apply", patch: {} },
      { id: "a", kind: "apply", patch: { power: true } },
      { id: "a", kind: "apply", patch: { front_brightness: 0 } },
      { id: "a", kind: "apply", patch: { back_brightness: 50.5 } },
      { id: "a", kind: "apply", patch: { temperature_k: 4010 } },
      { id: "a", kind: "apply", patch: { mode: "side" } },
      { id: "a".repeat(65), kind: "sync" },
    ])
      expect(parseIntent(payload)).toBeNull();
  });
});

describe("flyoutStatus", () => {
  it("shows nothing while ready and idle", () => {
    expect(flyoutStatus(base)).toBeNull();
  });
  it("covers disconnected, offline, radio and command states", () => {
    expect(flyoutStatus(null)).toMatchObject({ title: "未連線" });
    expect(flyoutStatus({ ...base, connected: false })).toMatchObject({ title: "未連線" });
    expect(flyoutStatus({ ...base, lock: "已斷線" })).toMatchObject({ tone: "warn", body: "最後同步 21:14:08" });
    expect(flyoutStatus({ ...base, lock: "無線模組未就緒" })).toMatchObject({ title: "無線模組未就緒" });
    expect(
      flyoutStatus({ ...base, lock: "結果不明，請先查詢", feedback: { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: true } }),
    ).toEqual({ tone: "warn", title: "結果不明", body: "", lookup: true });
    expect(
      flyoutStatus({ ...base, feedback: { tone: "ok", title: "指令已送出", body: "燈具不回報狀態，請以實際燈光為準。", lookup: false } }),
    ).toMatchObject({ title: "指令已送出", body: "燈具不回報狀態，請以實際燈光為準。" });
  });
});
