import type { LightState } from "./bridge";
import type { Draft, Feedback, LockReason, Tone } from "./controlState";

/**
 * Tray flyout protocol. The main window stays the only command coordinator:
 * it publishes a read-only view of its state, and the flyout sends intents
 * that the main window re-checks before using its normal command path.
 */
export interface FlyoutState {
  connected: boolean;
  online: boolean;
  badge: { tone: Tone; text: string };
  lock: LockReason | null;
  desired: LightState | null;
  features: Record<string, string>;
  feedback: Feedback;
  updated: string;
}

export type FlyoutIntent =
  | { id: string; kind: "power"; value: boolean }
  | { id: string; kind: "apply"; patch: Draft }
  | { id: string; kind: "sync" };

/** done: the flyout may drop its draft (sent and transmitted, or nothing to send). */
export interface FlyoutAck {
  id: string;
  done: boolean;
}

export const OFFLINE_FEEDBACK: Feedback = { tone: "idle", title: "等待連線", body: "", lookup: false };

const isInt = (v: unknown, min: number, max: number, step = 1): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max && (v - min) % step === 0;

/** Strictly parse an intent from the flyout; anything unexpected is dropped. */
export function parseIntent(payload: unknown): FlyoutIntent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id || p.id.length > 64) return null;
  if (p.kind === "sync") return { id: p.id, kind: "sync" };
  if (p.kind === "power") return typeof p.value === "boolean" ? { id: p.id, kind: "power", value: p.value } : null;
  if (p.kind !== "apply" || !p.patch || typeof p.patch !== "object") return null;
  const patch: Draft = {};
  for (const [key, value] of Object.entries(p.patch as Record<string, unknown>)) {
    if (key === "mode" && (value === "front" || value === "back" || value === "both")) patch.mode = value;
    else if ((key === "front_brightness" || key === "back_brightness") && isInt(value, 1, 100)) patch[key] = value;
    else if (key === "temperature_k" && isInt(value, 2700, 6500, 25)) patch.temperature_k = value;
    else return null;
  }
  return Object.keys(patch).length ? { id: p.id, kind: "apply", patch } : null;
}

export function parseState(payload: unknown): FlyoutState | null {
  if (!payload || typeof payload !== "object") return null;
  const s = payload as FlyoutState;
  return typeof s.connected === "boolean" && s.badge && s.feedback ? s : null;
}

export interface FlyoutStatus {
  tone: Tone;
  title: string;
  body: string;
  lookup: boolean;
}

/** The flyout's status row; null while ready with nothing to report. */
export function flyoutStatus(state: FlyoutState | null): FlyoutStatus | null {
  if (!state?.connected) return { tone: "idle", title: "未連線", body: "", lookup: false };
  if (state.lock === "已斷線")
    return { tone: "warn", title: "已斷線，重試中", body: `最後同步 ${state.updated}`, lookup: false };
  if (state.lock === "無線模組未就緒") return { tone: "warn", title: "無線模組未就緒", body: "", lookup: false };
  const { feedback } = state;
  if (feedback.tone === "idle") return null;
  return {
    tone: feedback.tone,
    title: feedback.title,
    body: feedback.tone === "warn" ? "" : feedback.body,
    lookup: feedback.lookup,
  };
}
