import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describeEvent } from "./DiagnosticsPanel";
import { SettingsPage } from "./SettingsPage";
import { bridge, type DiagnosticReport, type Snapshot } from "./bridge";
import examples from "../../protocol/v1/examples.json";
import { MESSAGES } from "./i18n";

const zh = MESSAGES["zh-TW"];
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { diagnostics: vi.fn(), exportDiagnostics: vi.fn(), clearDiagnostics: vi.fn() },
}));
const snapshot = examples.find((e) => e.schema === "Snapshot")!.body as unknown as Snapshot;
const tx = (sent: number, planned: number, irq: number | null, fifo: number | null) => ({
  frames_planned: planned,
  frames_attempted: sent,
  frames_transmitted: sent,
  irq,
  fifo,
});
const event = (patch: Partial<DiagnosticReport["events"][number]>): DiagnosticReport["events"][number] => ({
  unix_ms: Date.now(),
  kind: "command",
  device_id: null,
  command_id: null,
  status: "transmitted",
  error_code: null,
  tx: null,
  ...patch,
});
const report: DiagnosticReport = {
  events: [
    event({ kind: "state", status: "ready" }),
    event({ status: "failed", error_code: "RADIO_UNAVAILABLE", tx: tx(0, 12, null, null) }),
    event({ kind: "error", status: "failed", error_code: "UNKNOWN_OUTCOME" }),
    event({ status: "transmitted", tx: tx(12, 12, 0x2e, 0) }),
  ],
  warning: null,
};
const raw = { device_id: snapshot.device_id, boot_id: snapshot.boot_id, radio: "ready" };
const agent = navigator.userAgent;
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "userAgent", { value: agent, configurable: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bridge.diagnostics).mockResolvedValue(report);
});
function settings(overrides: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
  const props: Parameters<typeof SettingsPage>[0] = {
    compact: false,
    native: true,
    platform: "windows",
    snapshot,
    address: "desk.local:8080",
    online: true,
    updated: "21:14:08",
    busy: false,
    saved: null,
    settingsMessage: "",
    raw,
    theme: "light",
    setTheme: vi.fn(),
    locale: "zh-TW",
    setLocale: vi.fn(),
    refresh: vi.fn(),
    disconnect: vi.fn(),
    forget: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<SettingsPage {...props} />) };
}
const openDiagnostics = async () => {
  await userEvent.click(await screen.findByRole("tab", { name: /診斷紀錄/ }));
  return screen.getByRole("tabpanel");
};
it("reads local history only when its tab opens, and shows plain labels", async () => {
  settings();
  const tab = screen.getByRole("tab", { name: "診斷紀錄" });
  expect(tab).toHaveTextContent(/^診斷紀錄$/);
  expect(bridge.diagnostics).not.toHaveBeenCalled();
  const panel = await openDiagnostics();
  await within(panel).findByText("最近 4 筆 · 保留最近 200 筆");
  expect(bridge.diagnostics).toHaveBeenCalledTimes(1);
  expect(within(panel).getByText("最近 4 筆 · 保留最近 200 筆")).toBeInTheDocument();
  const counts = (label: string) => within(panel).getByText(label).parentElement!.textContent;
  expect(counts("成功")).toBe("成功2");
  expect(counts("結果不明")).toBe("結果不明1");
  expect(counts("失敗")).toBe("失敗1");
  expect(within(panel).getByText("· 發送失敗", { exact: false })).toBeInTheDocument();
  expect(within(panel).getByText("匯出檔不含帳號、IP 與密碼。")).toBeInTheDocument();
});
it("shows error codes, TX/IRQ/FIFO and JSON only after turning raw data on", async () => {
  const user = userEvent.setup();
  settings();
  await openDiagnostics();
  await screen.findByText(/最近 4 筆/);
  const hidden = [/RADIO_UNAVAILABLE/, /UNKNOWN_OUTCOME/, /TX 12\/12/, /IRQ/, /FIFO/, new RegExp(snapshot.boot_id)];
  for (const text of hidden) expect(screen.queryByText(text)).not.toBeInTheDocument();
  const toggle = screen.getByRole("switch", { name: "原始資料" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  await user.click(toggle);
  expect(screen.getByText("RADIO_UNAVAILABLE · TX 0/12 · IRQ — · FIFO —")).toBeInTheDocument();
  expect(screen.getByText("TX 12/12 · IRQ 2E · FIFO 0")).toBeInTheDocument();
  expect(screen.getByText("UNKNOWN_OUTCOME")).toBeInTheDocument();
  expect(screen.getByText(new RegExp(snapshot.boot_id))).toBeInTheDocument();
  await user.click(toggle);
  expect(screen.queryByText(/UNKNOWN_OUTCOME/)).not.toBeInTheDocument();
});
it("exports with the iPhone Files hint and clears history", async () => {
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone)", configurable: true });
  vi.mocked(bridge.exportDiagnostics).mockResolvedValue("HaloDesk/halo2-diagnostics.json");
  const user = userEvent.setup();
  settings();
  await openDiagnostics();
  await user.click(screen.getByRole("button", { name: "匯出 JSON" }));
  await screen.findByText("已匯出：HaloDesk/halo2-diagnostics.json");
  expect(screen.getByText("到「檔案」→「我的 iPhone」→「HaloDesk」→「HaloDesk」取用。")).toBeInTheDocument();
  vi.mocked(bridge.diagnostics).mockResolvedValue({ events: [], warning: null });
  await user.click(screen.getByRole("button", { name: "清除紀錄" }));
  await waitFor(() => expect(bridge.clearDiagnostics).toHaveBeenCalledTimes(1));
  await screen.findByText("沒有紀錄");
  expect(screen.getByText("最近 0 筆 · 保留最近 200 筆")).toBeInTheDocument();
  expect(screen.getByText("歷史紀錄已清除。")).toBeInTheDocument();
});
it("never labels an unknown command status as sent", () => {
  expect(describeEvent(zh, event({ status: "unknown" }))).toMatchObject({ status: "結果不明", tone: "warn" });
  expect(describeEvent(zh, event({ kind: "error", error_code: "NETWORK" }))).toMatchObject({ title: "連線", tone: "err" });
});
it("device tab shows bridge facts and hides forget without a saved profile", async () => {
  const { props, view } = settings({ native: false });
  expect(screen.getByRole("tab", { name: /裝置與連線/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("desk.local:8080")).toBeInTheDocument();
  expect(screen.getByText("21:14:08")).toBeInTheDocument();
  expect(screen.getByText("立即向控制盒讀取最新狀態。")).toBeInTheDocument();
  expect(screen.queryByText(/橋接器/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "忘記已保存連線" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重新整理" }));
  expect(props.refresh).toHaveBeenCalledOnce();
  view.rerender(
    <SettingsPage {...props} updated="" busy={true}
      saved={{ host: "desk.local", port: 8080, username: "u", device_id: snapshot.device_id }} />,
  );
  expect(screen.getByRole("button", { name: "忘記已保存連線" })).toBeDisabled();
  expect(screen.getByText("密碼存於 Windows 認證管理員。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新整理" })).toBeDisabled();
  expect(bridge.diagnostics).not.toHaveBeenCalled();
});
it("marks an unready radio and chooses the theme in the appearance tab", async () => {
  const { props } = settings({ snapshot: { ...snapshot, radio_status: "error" }, theme: "system" });
  expect(screen.getByRole("tab", { name: /裝置與連線/ })).toHaveTextContent("未就緒");
  const look = screen.getByRole("tab", { name: /外觀/ });
  expect(look).toHaveTextContent("跟隨系統");
  await userEvent.click(look);
  const themes = within(screen.getByRole("radiogroup", { name: "主題" }));
  expect(themes.getByRole("radio", { name: "跟隨系統" })).toHaveAttribute("aria-checked", "true");
  await userEvent.click(themes.getByRole("radio", { name: "深色" }));
  expect(props.setTheme).toHaveBeenCalledExactlyOnceWith("dark");
});
it("chooses the language in the appearance tab", async () => {
  const { props } = settings({ locale: "system" });
  await userEvent.click(screen.getByRole("tab", { name: /外觀/ }));
  const languages = within(screen.getByRole("radiogroup", { name: "語言" }));
  expect(languages.getByRole("radio", { name: "跟隨系統" })).toHaveAttribute("aria-checked", "true");
  await userEvent.click(languages.getByRole("radio", { name: "English" }));
  expect(props.setLocale).toHaveBeenCalledExactlyOnceWith("en");
});
it("stacks every section without tabs on a phone", async () => {
  settings({ compact: true });
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "裝置與連線" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "主題" })).toBeInTheDocument();
  expect(await screen.findByText("最近 4 筆 · 保留最近 200 筆")).toBeInTheDocument();
});
