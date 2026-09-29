import type { CommandRecord, Fault, LightState, Snapshot } from "./bridge";

export type LightPatch = Partial<Omit<LightState, "ultrasonic_enabled">>;
export type LightKey = "mode" | "front_brightness" | "back_brightness" | "temperature_k";
export type Draft = Partial<Pick<LightState, LightKey>>;
export type Tone = "ok" | "warn" | "err" | "info" | "busy" | "pending" | "idle";

export const LIGHT_KEYS: LightKey[] = ["mode", "front_brightness", "back_brightness", "temperature_k"];
export const MODES: Record<string, string> = { front: "前燈", back: "後燈", both: "前後燈" };

export const modeLabel = (mode: string) => MODES[mode] ?? mode;
/** 「前後燈 · 前 70% · 後 30% · 4300 K」 */
export const lightSummary = (v: Pick<LightState, LightKey>) =>
  `${modeLabel(v.mode)} · 前 ${v.front_brightness}% · 後 ${v.back_brightness}% · ${v.temperature_k} K`;
/** A preset matches when every lighting field equals the shown values. */
export const samePreset = (a: Pick<LightState, LightKey>, b: Pick<LightState, LightKey>) =>
  LIGHT_KEYS.every((key) => a[key] === b[key]);
/** 「前 60% · 後 35% · 4000 K」 */
export const levelSummary = (v: Pick<LightState, LightKey>) =>
  `前 ${v.front_brightness}% · 後 ${v.back_brightness}% · ${v.temperature_k} K`;

export type LockReason = "已斷線" | "無線模組未就緒" | "處理中" | "結果不明，請先查詢";

/**
 * Why controls are disabled, or null when commands may be sent. The order is
 * the display priority; every condition must hold before any control is usable.
 */
export function lockReason(input: {
  online: boolean;
  snapshot: Snapshot | null;
  busy: boolean;
  fault: Fault | null;
}): LockReason | null {
  const { online, snapshot, busy, fault } = input;
  if (!online || !snapshot) return "已斷線";
  if (
    snapshot.radio_status !== "ready" ||
    snapshot.pairing_status !== "ready" ||
    snapshot.features.power !== "verified"
  )
    return "無線模組未就緒";
  if (busy || snapshot.active_command) return "處理中";
  if (fault?.code === "UNKNOWN_OUTCOME") return "結果不明，請先查詢";
  return null;
}

export const supported = (snapshot: Snapshot, key: string) =>
  snapshot.features[key] === "verified" || snapshot.features[key] === "experimental";

/** Draft fields that still differ from the bridge's desired target. */
export function pendingDraft(draft: Draft, desired: LightState): Draft {
  const pending: Draft = {};
  for (const key of LIGHT_KEYS) {
    if (draft[key] !== undefined && draft[key] !== desired[key])
      (pending as Record<LightKey, unknown>)[key] = draft[key];
  }
  return pending;
}

/** Stage one value, dropping it again when it matches the desired target. */
export function stageDraft<K extends LightKey>(
  draft: Draft,
  desired: LightState,
  key: K,
  value: LightState[K],
): Draft {
  const next = { ...draft };
  if (desired[key] === value) delete next[key];
  else next[key] = value;
  return next;
}

export const previewValues = (desired: LightState, draft: Draft): LightState => ({
  ...desired,
  ...pendingDraft(draft, desired),
});

const clamp = (k: number) => Math.max(2700, Math.min(6500, k));
const hex = (rgb: number[]) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

/** Knob and lamp-bar glow colour: 2700 K #ffc466 ↔ 6500 K #e0ecff. */
export function tempColor(k: number) {
  const t = (clamp(k) - 2700) / 3800;
  const a = [255, 196, 102];
  const b = [224, 236, 255];
  return hex(a.map((c, i) => Math.round(c + (b[i] - c) * t)));
}

/** Beam colour at alpha .55, piecewise linear 2700 → 4600 → 6500 K. */
export function beamColor(k: number) {
  const stops: Array<[number, number[]]> = [
    [2700, [255, 164, 60]],
    [4600, [255, 214, 140]],
    [6500, [96, 160, 255]],
  ];
  const t = clamp(k);
  const i = t <= 4600 ? 0 : 1;
  const [k0, c0] = stops[i];
  const [k1, c1] = stops[i + 1];
  const p = (t - k0) / (k1 - k0);
  const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * p));
  return `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
}

/** Beam opacity: lit paths use 0.3 + 0.7 × brightness; power only from desired. */
export function beamLevels(power: boolean, preview: LightState) {
  const level = (on: boolean, brightness: number) => (power && on ? 0.3 + (0.7 * brightness) / 100 : 0);
  return {
    front: level(preview.mode !== "back", preview.front_brightness),
    back: level(preview.mode !== "front", preview.back_brightness),
  };
}

export interface Feedback {
  tone: Tone;
  title: string;
  body: string;
  lookup: boolean;
}

/** Recent-command card. Error codes are deliberately left to diagnostics. */
export function commandFeedback(input: {
  online: boolean;
  commanding: boolean;
  action: string;
  result: CommandRecord | null;
  fault: Fault | null;
}): Feedback {
  const { online, commanding, action, result, fault } = input;
  if (commanding)
    return { tone: "busy", title: "處理中", body: action ? `正在送出「${action}」` : "", lookup: false };
  if (fault?.code === "UNKNOWN_OUTCOME")
    return { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: true };
  if (fault) return { tone: "err", title: "發送失敗", body: fault.message, lookup: false };
  if (result) {
    switch (result.status) {
      case "transmitted":
        return { tone: "ok", title: "指令已送出", body: "掛燈不回報狀態，請以實際燈光為準。", lookup: false };
      case "failed":
        return { tone: "err", title: "發送失敗", body: "請稍後再試。", lookup: false };
      case "expired":
        return { tone: "warn", title: "指令已過期", body: "", lookup: false };
      case "superseded":
        return { tone: "warn", title: "指令已被新操作取代", body: "", lookup: false };
      case "accepted":
      case "executing":
        return { tone: "busy", title: "處理中", body: "", lookup: false };
      default:
        return { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: false };
    }
  }
  return { tone: "idle", title: online ? "就緒" : "等待連線", body: "", lookup: false };
}
