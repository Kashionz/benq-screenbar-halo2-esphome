import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FlyoutAck, FlyoutIntent, FlyoutState } from "./flyout";

export interface LightState {
  power: boolean;
  mode: string;
  front_brightness: number;
  back_brightness: number;
  temperature_k: number;
  ultrasonic_enabled: boolean;
  /** Absent from firmware that predates auto-dimming. */
  auto_dimming?: boolean;
}
/** Only the lit lamps' brightness is kept; temperature is shared by both. */
export type PresetValues = Pick<LightState, "mode" | "temperature_k"> &
  Partial<Pick<LightState, "front_brightness" | "back_brightness">>;
export interface Preset {
  id: string;
  name: string;
  values: PresetValues;
}
export interface CommandRecord {
  command_id: string;
  boot_id: string;
  status: string;
  effect: string;
  target: LightState;
  error: { code: string } | null;
  tx: {
    frames_planned: number;
    frames_attempted: number;
    frames_transmitted: number;
    irq: number | null;
    fifo: number | null;
  };
}
export interface Snapshot {
  device_id: string;
  boot_id: string;
  uptime_ms: number;
  state_version: number;
  control_revision: number;
  desired: {
    values: LightState;
    source: string;
    updated_at_uptime_ms: number;
    command_id: string | null;
  };
  observed_remote: { values: LightState; received_at_uptime_ms: number } | null;
  radio_status: string;
  radio_error_code: string | null;
  pairing_status: string;
  pairing_persisted: boolean;
  active_command: CommandRecord | null;
  last_command: CommandRecord | null;
  features: Record<string, string>;
}
export interface Fault {
  code: string;
  message: string;
  command_id?: string;
  boot_id?: string;
}
export interface SavedConnection {
  host: string;
  port: number;
  username: string;
  device_id: string;
}
export interface DiscoveredBridge {
  name: string;
  host: string;
  port: number;
}
export interface DiagnosticReport {
  events: Array<{
    unix_ms: number;
    kind: string;
    device_id: string | null;
    command_id: string | null;
    status: string;
    error_code: string | null;
    tx: CommandRecord["tx"] | null;
  }>;
  warning: Fault | null;
}
export const failure = (e: unknown): Fault =>
  e && typeof e === "object" && "code" in e
    ? (e as Fault)
    : { code: "APP_ERROR", message: "操作無法完成，請重新連線。" };
export const bridge = {
  discover: () => invoke<DiscoveredBridge[]>("discover_bridges"),
  presets: () => invoke<Preset[]>("list_presets"),
  savePreset: (name: string, values: PresetValues) => invoke<Preset[]>("save_preset", { name, values }),
  deletePreset: (id: string) => invoke<Preset[]>("delete_preset", { id }),
  /** Put a just-deleted preset back at its old position (undo). */
  restorePreset: (preset: Preset, index: number) => invoke<Preset[]>("restore_preset", { preset, index }),
  /** Match the native title bar to the App theme; main window only. */
  windowTheme: (dark: boolean) => invoke<void>("set_window_theme", { dark }),
  saved: () => invoke<SavedConnection | null>("saved_connection"),
  remember: () => invoke<SavedConnection>("remember_connection"),
  forget: () => invoke<void>("forget_connection"),
  connectSaved: () => invoke<Snapshot>("connect_saved"),
  diagnostics: () => invoke<DiagnosticReport>("diagnostic_history"),
  exportDiagnostics: () => invoke<string>("export_diagnostics"),
  clearDiagnostics: () => invoke<void>("clear_diagnostics"),
  setState: (deviceId: string, patch: Partial<Omit<LightState, "power">>) =>
    invoke<CommandRecord>("set_light_state", { deviceId, patch }),
  connect: (host: string, port: number, username: string, password: string) =>
    invoke<Snapshot>("connect_bridge", { host, port, username, password }),
  disconnect: () => invoke<void>("disconnect_bridge"),
  state: () => invoke<Snapshot>("bridge_state"),
  power: (deviceId: string, power: boolean) =>
    invoke<CommandRecord>("set_power", { deviceId, power }),
  lookup: () => invoke<CommandRecord | null>("lookup_command"),
};
export function resultLabel(record: CommandRecord): string {
  switch (record.status) {
    case "transmitted":
      return "指令已送出";
    case "failed":
      return "發送失敗";
    case "expired":
      return "指令已過期";
    case "superseded":
      return "指令已被新操作取代";
    case "accepted":
    case "executing":
      return "處理中";
    default:
      return "結果不明";
  }
}
// Listen only to events addressed to this window; a listener with the default
// "Any" target would also receive events meant for the other window.
const own = <T>(event: string, handler: (payload: T) => void) =>
  getCurrentWebviewWindow().listen<T>(event, (e) => handler(e.payload));
export const flyout = {
  // Main window side.
  publish: (state: FlyoutState) => emitTo("tray", "halo-flyout-state", state),
  ack: (ack: FlyoutAck) => emitTo("tray", "halo-flyout-ack", ack),
  onIntent: (handler: (payload: unknown) => void) => own<unknown>("halo-flyout-intent", handler),
  // Both windows: the flyout was just opened.
  onShown: (handler: () => void) => own<unknown>("halo-flyout-shown", () => handler()),
  // Flyout side.
  send: (intent: FlyoutIntent) => emitTo("main", "halo-flyout-intent", intent),
  onState: (handler: (payload: unknown) => void) => own<unknown>("halo-flyout-state", handler),
  onAck: (handler: (payload: unknown) => void) => own<unknown>("halo-flyout-ack", handler),
  openMain: () => invoke<void>("flyout_open_main"),
  hide: () => invoke<void>("flyout_hide"),
  resize: (height: number) => invoke<void>("flyout_resize", { height }),
  quit: () => invoke<void>("flyout_quit"),
};
