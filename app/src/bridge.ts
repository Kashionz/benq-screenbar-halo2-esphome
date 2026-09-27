import { invoke } from "@tauri-apps/api/core";

export interface LightState {
  power: boolean;
  mode: string;
  front_brightness: number;
  back_brightness: number;
  temperature_k: number;
  ultrasonic_enabled: boolean;
}
export type PresetValues = Pick<LightState, "mode" | "front_brightness" | "back_brightness" | "temperature_k">;
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
  desired: { values: LightState; source: string };
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
  presets: () => invoke<Preset[]>("list_presets"),
  savePreset: (name: string, values: PresetValues) => invoke<Preset[]>("save_preset", { name, values }),
  deletePreset: (id: string) => invoke<Preset[]>("delete_preset", { id }),
  saved: () => invoke<SavedConnection | null>("saved_connection"),
  remember: () => invoke<SavedConnection>("remember_connection"),
  forget: () => invoke<void>("forget_connection"),
  connectSaved: () => invoke<Snapshot>("connect_saved"),
  diagnostics: () => invoke<DiagnosticReport>("diagnostic_history"),
  exportDiagnostics: () => invoke<string>("export_diagnostics"),
  clearDiagnostics: () => invoke<void>("clear_diagnostics"),
  setState: (
    deviceId: string,
    patch: Partial<Omit<LightState, "ultrasonic_enabled">>,
    experimental: boolean,
  ) =>
    invoke<CommandRecord>("set_light_state", { deviceId, patch, experimental }),
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
