import type { CommandRecord, Fault, LightState, PresetValues, Snapshot } from "./bridge";
import type { Messages } from "./i18n";

export type LightPatch = Partial<Omit<LightState, "power">>;
export type LightKey = "mode" | "front_brightness" | "back_brightness" | "temperature_k";
export type Draft = Partial<Pick<LightState, LightKey>>;
export type Tone = "ok" | "warn" | "err" | "info" | "busy" | "pending" | "idle";

export const LIGHT_KEYS: LightKey[] = ["mode", "front_brightness", "back_brightness", "temperature_k"];
export const MODES = ["front", "back", "both"] as const;

export const modeLabel = (m: Messages, mode: string) => m.modes[mode] ?? mode;

/** Which lamps a mode lights; only their brightness can be adjusted. */
export const litLamps = (mode: string) => ({ front: mode !== "back", back: mode !== "front" });
/** Whether a lighting key is adjustable in this mode. */
export const adjustable = (mode: string, key: string) =>
  key === "front_brightness" ? litLamps(mode).front : key === "back_brightness" ? litLamps(mode).back : true;
/** Drop the brightness of a lamp the resulting mode leaves unlit. */
export function litOnly<T extends Partial<Pick<LightState, LightKey>>>(patch: T, mode: string): T {
  const next = { ...patch };
  const lit = litLamps(patch.mode ?? mode);
  if (!lit.front) delete next.front_brightness;
  if (!lit.back) delete next.back_brightness;
  return next;
}
/** The values a preset keeps: mode, temperature and the lit lamps' brightness. */
export const presetValues = (v: PresetValues): PresetValues => {
  const { mode, front_brightness, back_brightness, temperature_k } = v;
  return litOnly({ mode, front_brightness, back_brightness, temperature_k }, mode);
};
const levels = (m: Messages, v: PresetValues) => {
  const lit = litLamps(v.mode);
  return [lit.front && m.level.front(v.front_brightness ?? 0), lit.back && m.level.back(v.back_brightness ?? 0)].filter(
    Boolean,
  );
};
/** 「前後燈 · 前 70% · 後 30% · 4300 K」, 「前燈 · 前 70% · 4300 K」 */
export const lightSummary = (m: Messages, v: PresetValues) =>
  [modeLabel(m, v.mode), ...levels(m, v), `${v.temperature_k} K`].join(" · ");
/** 「前 60% · 後 35% · 4000 K」 */
export const levelSummary = (m: Messages, v: PresetValues) => [...levels(m, v), `${v.temperature_k} K`].join(" · ");
/** A preset matches when its mode, temperature and lit lamps' brightness equal the shown values. */
export const samePreset = (preset: PresetValues, shown: Pick<LightState, LightKey>) => {
  const kept = presetValues(preset);
  return LIGHT_KEYS.every((key) => kept[key] === undefined || kept[key] === shown[key]);
};

/** Shown through Messages.lock; the tray menu only checks whether it is null. */
export type LockReason = "offline" | "radio" | "busy" | "unknown";

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
  if (!online || !snapshot) return "offline";
  if (
    snapshot.radio_status !== "ready" ||
    snapshot.pairing_status !== "ready" ||
    snapshot.features.power !== "verified"
  )
    return "radio";
  if (busy || snapshot.active_command) return "busy";
  if (fault?.code === "UNKNOWN_OUTCOME") return "unknown";
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
export function commandFeedback(
  m: Messages,
  input: {
    online: boolean;
    commanding: boolean;
    action: string;
    result: CommandRecord | null;
    fault: Fault | null;
  },
): Feedback {
  const { online, commanding, action, result, fault } = input;
  const f = m.feedback;
  if (commanding) return { tone: "busy", title: f.busy, body: action ? f.sending(action) : "", lookup: false };
  if (fault?.code === "UNKNOWN_OUTCOME") return { tone: "warn", title: f.unknown, body: f.unknownBody, lookup: true };
  if (fault) return { tone: "err", title: f.failed, body: m.fault(fault), lookup: false };
  if (result) {
    switch (result.status) {
      case "transmitted":
        return { tone: "ok", title: f.transmitted, body: "", lookup: false };
      case "failed":
        return { tone: "err", title: f.failed, body: f.failedBody, lookup: false };
      case "expired":
        return { tone: "warn", title: f.expired, body: "", lookup: false };
      case "superseded":
        return { tone: "warn", title: f.superseded, body: "", lookup: false };
      case "accepted":
      case "executing":
        return { tone: "busy", title: f.busy, body: "", lookup: false };
      default:
        return { tone: "warn", title: f.unknown, body: f.unknownBody, lookup: false };
    }
  }
  return { tone: "idle", title: online ? f.ready : f.waiting, body: "", lookup: false };
}
