import type { LightState } from "./bridge";
import type { Draft, Feedback, LightKey, LockReason } from "./controlState";
import type { Line } from "./StatusCards";
import type { Theme } from "./theme";

/**
 * Tray flyout protocol. The main window stays the only command coordinator:
 * it publishes a read-only view of its state, and the flyout sends intents
 * that the main window re-checks before using its normal command path.
 */
export interface FlyoutState {
  connected: boolean;
  online: boolean;
  lock: LockReason | null;
  desired: LightState | null;
  /** desired ⊕ transmitted ⊕ unsent values, as the main window shows them. */
  values: LightState | null;
  adjusting: LightKey[];
  /** A command is in flight; power waits, lighting input is coalesced. */
  sending: boolean;
  features: Record<string, string>;
  /** The main window's power status line (sending, result, failure), or null when idle. */
  status: Feedback | null;
  updated: string;
  theme: Theme;
}

export type FlyoutIntent =
  | { id: string; kind: "power"; value: boolean }
  | { id: string; kind: "adjust"; patch: Draft }
  | { id: string; kind: "sync" };

/** done: power was transmitted, or an adjustment was accepted for live sending. */
export interface FlyoutAck {
  id: string;
  done: boolean;
}

const isInt = (v: unknown, min: number, max: number, step = 1): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max && (v - min) % step === 0;

/** Strictly parse an intent from the flyout; anything unexpected is dropped. */
export function parseIntent(payload: unknown): FlyoutIntent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id || p.id.length > 64) return null;
  if (p.kind === "sync") return { id: p.id, kind: "sync" };
  if (p.kind === "power") return typeof p.value === "boolean" ? { id: p.id, kind: "power", value: p.value } : null;
  if (p.kind !== "adjust" || !p.patch || typeof p.patch !== "object") return null;
  const patch: Draft = {};
  for (const [key, value] of Object.entries(p.patch as Record<string, unknown>)) {
    if (key === "mode" && (value === "front" || value === "back" || value === "both")) patch.mode = value;
    else if ((key === "front_brightness" || key === "back_brightness") && isInt(value, 1, 100)) patch[key] = value;
    else if (key === "temperature_k" && isInt(value, 2700, 6500, 25)) patch.temperature_k = value;
    else return null;
  }
  return Object.keys(patch).length ? { id: p.id, kind: "adjust", patch } : null;
}

export function parseState(payload: unknown): FlyoutState | null {
  if (!payload || typeof payload !== "object") return null;
  const s = payload as FlyoutState;
  return typeof s.connected === "boolean" && typeof s.updated === "string" ? s : null;
}

/**
 * The flyout's status line beside its power button. Offline and radio locks
 * come first; an unknown outcome sends the user to the main window to look up.
 */
export function trayLine(state: FlyoutState | null, next: string): Line & { lookup: boolean } {
  if (!state?.connected) return { tone: "idle", body: "未連線", lookup: false };
  if (state.lock === "已斷線" || state.lock === "無線模組未就緒")
    return { tone: "warn", title: state.lock, body: "", lookup: false };
  const { status } = state;
  if (!status) return { tone: "idle", body: `按一下${next}`, lookup: false };
  if (status.lookup) return { tone: "warn", title: status.title, body: "，請先查詢", lookup: true };
  return {
    tone: status.tone,
    title: status.title,
    body: status.body ? ` · ${status.body}` : "",
    lookup: false,
  };
}
