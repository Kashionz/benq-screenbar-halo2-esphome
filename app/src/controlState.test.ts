import { describe, expect, it } from "vitest";
import type { Snapshot } from "./bridge";
import {
  beamColor,
  beamLevels,
  commandFeedback,
  lockReason,
  pendingDraft,
  previewValues,
  stageDraft,
  tempColor,
} from "./controlState";
import examples from "../../protocol/v1/examples.json";

const snapshot = examples.find((e) => e.schema === "Snapshot")!.body as unknown as Snapshot;
const desired = snapshot.desired.values;
const unknown = { code: "UNKNOWN_OUTCOME", message: "結果不明" };

describe("lockReason", () => {
  const ready = { online: true, snapshot, busy: false, fault: null };
  it("allows commands only when every condition holds", () => {
    expect(lockReason(ready)).toBeNull();
  });
  it("orders reasons offline → radio → busy → unknown", () => {
    const radio = { ...snapshot, radio_status: "error" };
    expect(lockReason({ ...ready, online: false, snapshot: radio, busy: true, fault: unknown })).toBe("已斷線");
    expect(lockReason({ ...ready, snapshot: null })).toBe("已斷線");
    expect(lockReason({ ...ready, snapshot: radio, busy: true, fault: unknown })).toBe("無線模組未就緒");
    expect(lockReason({ ...ready, busy: true, fault: unknown })).toBe("處理中");
    expect(lockReason({ ...ready, fault: unknown })).toBe("結果不明，請先查詢");
  });
  it("treats pairing, unverified power and another client's command as locked", () => {
    expect(lockReason({ ...ready, snapshot: { ...snapshot, pairing_status: "unpaired" } })).toBe("無線模組未就緒");
    expect(lockReason({ ...ready, snapshot: { ...snapshot, features: { ...snapshot.features, power: "experimental" } } })).toBe("無線模組未就緒");
    expect(lockReason({ ...ready, snapshot: { ...snapshot, active_command: snapshot.last_command ?? ({} as never) } })).toBe("處理中");
  });
  it("does not lock for ordinary command failures", () => {
    expect(lockReason({ ...ready, fault: { code: "RATE_LIMITED", message: "請稍候再操作。" } })).toBeNull();
  });
});

describe("draft", () => {
  it("keeps only fields that differ from the target", () => {
    let draft = stageDraft({}, desired, "front_brightness", 70);
    draft = stageDraft(draft, desired, "mode", desired.mode);
    expect(draft).toEqual({ front_brightness: 70 });
    expect(stageDraft(draft, desired, "front_brightness", desired.front_brightness)).toEqual({});
    expect(pendingDraft({ temperature_k: desired.temperature_k, back_brightness: 90 }, desired)).toEqual({ back_brightness: 90 });
    expect(previewValues(desired, { back_brightness: 90 })).toEqual({ ...desired, back_brightness: 90 });
  });
});

describe("preview colours", () => {
  it("interpolates beam and knob colours at the documented stops", () => {
    expect(beamColor(2700)).toBe("rgba(255,164,60,0.55)");
    expect(beamColor(4600)).toBe("rgba(255,214,140,0.55)");
    expect(beamColor(6500)).toBe("rgba(96,160,255,0.55)");
    expect(tempColor(2700)).toBe("#ffc466");
    expect(tempColor(6500)).toBe("#e0ecff");
  });
  it("lights a path only when power is on and the mode includes it", () => {
    expect(beamLevels(true, { ...desired, mode: "back", back_brightness: 100 })).toEqual({ front: 0, back: 1 });
    expect(beamLevels(true, { ...desired, mode: "both", front_brightness: 0 }).front).toBeCloseTo(0.3);
    expect(beamLevels(false, { ...desired, mode: "both" })).toEqual({ front: 0, back: 0 });
  });
});

describe("labels", () => {
  it("never reports an unknown status or fault as sent", () => {
    const base = { online: true, commanding: false, action: "關燈", result: null, fault: null };
    expect(commandFeedback({ ...base, fault: unknown })).toMatchObject({ title: "結果不明", lookup: true });
    expect(commandFeedback({ ...base, result: { status: "future_success" } as never }).title).toBe("結果不明");
    expect(commandFeedback({ ...base, commanding: true }).body).toBe("正在送出「關燈」");
    expect(commandFeedback({ ...base, result: { status: "transmitted" } as never })).toMatchObject({
      title: "指令已送出",
      body: "",
    });
  });
});
